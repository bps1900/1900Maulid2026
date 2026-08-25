// Kuis
// Maulid
const API = 'https://script.google.com/macros/s/AKfycbx8eCQYmP1lBnSEevtKl4CHGO3Pqkppnl0ECtwcsWmkOJmZLPBKzw28WQ9U24szPMZBSg/exec';

// Kuis Maulid
async function apiGet(action) {
  const res = await fetch(`${API}?action=${action}`);
  return res.json();
}
async function apiPost(action, payload) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

let state = {
  nip: null,
  nama: null,
  alias: null,
  soal: [],
  idx: 0,
  jawaban: {},
  terjawab: {}, // soalId -> { benar } hasil cek server (kunci jawaban TIDAK dikirim ke client)
  // ---- timer (hanya menghitung waktu efektif peserta melihat/menjawab soal) ----
  activeMs: 0,       // total waktu yang sudah terkumpul (saat timer sedang di-pause)
  timerStart: null,  // timestamp saat timer terakhir kali dijalankan (null = sedang pause)
  timerIntervalId: null,
};

// ---------- TIMER (dijeda otomatis selama nunggu server, biar fair) ----------
function startTimer() {
  state.activeMs = 0;
  state.timerStart = Date.now();
  updateTimerDisplay();
  if (state.timerIntervalId) clearInterval(state.timerIntervalId);
  state.timerIntervalId = setInterval(updateTimerDisplay, 250);
}
function pauseTimer() {
  if (state.timerStart !== null) {
    state.activeMs += Date.now() - state.timerStart;
    state.timerStart = null;
  }
}
function resumeTimer() {
  if (state.timerStart === null) {
    state.timerStart = Date.now();
  }
}
function stopTimer() {
  pauseTimer();
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
}
function getElapsedMs() {
  return state.activeMs + (state.timerStart !== null ? Date.now() - state.timerStart : 0);
}
function updateTimerDisplay() {
  const el = document.getElementById('quiz-timer');
  if (el) el.textContent = `⏱ ${Math.floor(getElapsedMs() / 1000)}s`;
}

// ---------- MUSIK LATAR ----------
// Musik selalu nyala, tidak bisa di-mute dari UI, dan langsung dicoba
// diputar begitu halaman selesai dimuat.
const bgMusic = document.getElementById('bg-music');

function playBgMusic() {
  bgMusic.volume = 0.35;
  bgMusic.play().catch(() => {
    // Kebanyakan browser blokir autoplay bersuara sebelum ada interaksi user.
    // Begitu ada klik/tap pertama di halaman manapun, coba mainkan lagi.
    const resumeOnInteract = () => {
      bgMusic.play().catch(() => {});
      document.removeEventListener('click', resumeOnInteract);
    };
    document.addEventListener('click', resumeOnInteract, { once: true });
  });
}

// Nyalakan musik segera setelah halaman selesai dimuat
window.addEventListener('DOMContentLoaded', playBgMusic);

const view = {
  login: document.getElementById('view-login'),
  quiz: document.getElementById('view-quiz'),
  result: document.getElementById('view-result'),
  leaderboard: document.getElementById('view-leaderboard'),
};

function showView(name) {
  Object.values(view).forEach(v => v.classList.add('hidden'));
  view[name].classList.remove('hidden');
}

// ---------- HELPER LOADING ----------
// Nyalain/matiin kondisi "loading" pada sebuah tombol: teks diganti,
// tombol dan sanak-saudaranya dikunci, dikasih class 'is-loading' buat CSS.
function setBtnLoading(btnEl, loadingText) {
  btnEl.dataset.originalText = btnEl.textContent;
  btnEl.textContent = loadingText;
  btnEl.classList.add('is-loading');
}
function clearBtnLoading(btnEl) {
  if (btnEl.dataset.originalText !== undefined) {
    btnEl.textContent = btnEl.dataset.originalText;
    delete btnEl.dataset.originalText;
  }
  btnEl.classList.remove('is-loading');
}

// ---------- LOGIN (NIP + Alias jadi satu langkah) ----------
document.getElementById('btn-login').addEventListener('click', async () => {
  const kode = document.getElementById('input-nip').value.trim();
  const alias = document.getElementById('input-alias').value.trim();
  const errorEl = document.getElementById('login-error');
  const btnLogin = document.getElementById('btn-login');
  errorEl.textContent = '';

  if (!/^\d+$/.test(kode)) {
    errorEl.textContent = 'Kode hanya boleh berisi angka.';
    return;
  }
  // Pegawai: 5 digit terakhir NIP. Mahasiswa magang: NIM lengkap (9-18 digit).
  const isKodePegawai = kode.length === 5;
  const isKodeMahasiswa = kode.length >= 9 && kode.length <= 18;
  if (!isKodePegawai && !isKodeMahasiswa) {
    errorEl.textContent = 'Masukkan 5 digit terakhir NIP (pegawai) atau NIM lengkap (mahasiswa).';
    return;
  }
  if (!alias) {
    errorEl.textContent = 'Nama samaran tidak boleh kosong.';
    return;
  }
  if (alias.length < 3) {
    errorEl.textContent = 'Nama samaran minimal 3 karakter.';
    return;
  }

  btnLogin.disabled = true;
  setBtnLoading(btnLogin, '⏳ Memeriksa...');

  try {
    const data = await apiPost('login', { kode, alias });

    if (data.error) {
      errorEl.textContent = data.error;
      return;
    }

    state.nip = data.nip;
    state.nama = data.nama;
    state.alias = alias;

    setBtnLoading(btnLogin, '⏳ Menyiapkan soal...');
    await startQuiz();
  } catch (err) {
    errorEl.textContent = 'Tidak bisa terhubung ke server.';
  } finally {
    btnLogin.disabled = false;
    clearBtnLoading(btnLogin);
  }
});

document.getElementById('btn-show-leaderboard').addEventListener('click', (e) => loadLeaderboard(e.currentTarget));
document.getElementById('btn-back-home').addEventListener('click', () => showView('login'));
document.getElementById('btn-to-leaderboard').addEventListener('click', (e) => loadLeaderboard(e.currentTarget));

// ---------- QUIZ ----------
async function startQuiz() {
  const data = await apiGet('soal');
  state.soal = data.soal;
  state.idx = 0;
  state.jawaban = {};
  state.terjawab = {};

  document.getElementById('quiz-nama').textContent = state.nama;
  showView('quiz');
  renderSoal();
  startTimer(); // mulai hitung dari saat soal pertama benar-benar tampil
}

function renderSoal() {
  const soal = state.soal[state.idx];
  const container = document.getElementById('soal-container');
  document.getElementById('quiz-progress').textContent = `Soal ${state.idx + 1} / ${state.soal.length}`;

  const sudahDicek = state.terjawab[soal.id]; // { benar, kunci } kalau sudah dijawab

  let html = `<div class="soal-text">${soal.pertanyaan}</div>`;

  if (soal.tipe === 'pg') {
    Object.entries(soal.opsi).forEach(([key, val]) => {
      if (!val) return;
      html += `<button class="opsi-btn" data-value="${key}">${key}. ${val}</button>`;
    });
  } else {
    ['BENAR', 'SALAH'].forEach(opt => {
      html += `<button class="opsi-btn" data-value="${opt}">${opt}</button>`;
    });
  }

  container.innerHTML = html;

  const btnNext = document.getElementById('btn-next');
  clearBtnLoading(btnNext);

  if (sudahDicek) {
    // Soal ini sudah dijawab sebelumnya (misal user balik pakai next lalu balik lagi) - tampilkan hasil, kunci pilihan
    applyFeedbackStyle(container, soal, state.jawaban[soal.id], sudahDicek);
    btnNext.disabled = false;
  } else {
    container.querySelectorAll('.opsi-btn').forEach(btn => {
      btn.addEventListener('click', () => selectJawaban(soal, btn));
    });
    btnNext.disabled = true;
  }

  btnNext.textContent = state.idx === state.soal.length - 1 ? 'Selesai' : 'Selanjutnya';
}

async function selectJawaban(soal, btnEl) {
  const container = document.getElementById('soal-container');
  const nilaiPilihan = btnEl.dataset.value;

  // Kunci semua tombol dulu supaya tidak bisa diklik dobel selama nunggu server,
  // dan kasih tanda loading khusus di tombol yang diklik biar user tau ini lagi diproses.
  container.querySelectorAll('.opsi-btn').forEach(b => (b.disabled = true));
  container.classList.add('checking');
  setBtnLoading(btnEl, '⏳ Mengecek...');

  state.jawaban[soal.id] = nilaiPilihan;

  // Jeda timer selama nunggu server, biar delay jaringan tidak mengurangi "waktu berpikir" peserta
  pauseTimer();

  let hasil;
  try {
    hasil = await apiPost('jawab', { soalId: soal.id, jawaban: nilaiPilihan });
  } catch (err) {
    hasil = null;
  }

  container.classList.remove('checking');
  clearBtnLoading(btnEl);

  if (!hasil || hasil.error) {
    // Kalau gagal cek ke server, tetap lanjut tanpa efek supaya kuis tidak macet.
    // Timer dilanjutkan lagi karena peserta masih harus mencoba menjawab soal ini.
    resumeTimer();
    container.querySelectorAll('.opsi-btn').forEach(b => (b.disabled = false));
    document.getElementById('btn-next').disabled = false;
    return;
  }

  // Jawaban sudah dicek (benar/salah). Timer TETAP dijeda selama peserta melihat
  // feedback dan mikir sebelum klik "Selanjutnya" — baru jalan lagi saat soal
  // berikutnya benar-benar tampil (lihat renderSoal / handler btn-next).
  state.terjawab[soal.id] = hasil;
  applyFeedbackStyle(container, soal, nilaiPilihan, hasil);
  document.getElementById('btn-next').disabled = false;
}

function applyFeedbackStyle(container, soal, jawabanUser, hasil) {
  container.querySelectorAll('.opsi-btn').forEach(btn => {
    btn.disabled = true;
    const val = btn.dataset.value;

    if (val === jawabanUser && hasil.benar) {
      btn.classList.add('correct');
    } else if (val === jawabanUser && !hasil.benar) {
      // Kunci jawaban tidak dikirim server, jadi opsi yang benar tidak
      // disorot otomatis di sini -- itu sengaja, biar kunci tidak bisa
      // "dicuri" lewat Network tab. Kunci lengkap tetap tersimpan di
      // Google Sheet dan bisa dilihat peserta lewat leaderboard/rekap nanti.
      btn.classList.add('incorrect');
    }
  });
}

document.getElementById('btn-next').addEventListener('click', async (e) => {
  const btnNext = e.currentTarget;

  if (state.idx < state.soal.length - 1) {
    state.idx += 1;
    renderSoal();
    resumeTimer(); // waktu mulai jalan lagi persis saat soal berikutnya tampil
  } else {
    btnNext.disabled = true;
    setBtnLoading(btnNext, '⏳ Mengirim hasil...');
    pauseTimer(); // waktu kirim ke server tidak dihitung
    try {
      await submitQuiz();
    } finally {
      // Kalau submitQuiz sukses, view sudah pindah ke 'result' jadi ini tidak kelihatan.
      // Kalau gagal (mis. error alert), kembalikan tombol seperti semula.
      btnNext.disabled = false;
      clearBtnLoading(btnNext);
    }
  }
});

async function submitQuiz() {
  const durasiDetik = Math.round(getElapsedMs() / 1000);

  const data = await apiPost('submit', {
    nip: state.nip,
    alias: state.alias,
    durasiDetik,
    jawaban: state.jawaban,
  });

  if (data.error) {
    resumeTimer(); // kuis lanjut lagi (misal alias ternyata baru saja kepakai orang lain), waktu jalan lagi
    alert(data.error);
    return;
  }

  stopTimer();
  document.getElementById('result-score').textContent = `${data.nilai} / ${data.totalSoal}`;
  document.getElementById('result-durasi').textContent = `Waktu pengerjaan: ${data.durasiDetik} detik`;
  showView('result');
}

// ---------- LEADERBOARD ----------
async function loadLeaderboard(triggerBtn) {
  if (triggerBtn) {
    triggerBtn.disabled = true;
    setBtnLoading(triggerBtn, '⏳ Memuat...');
  }

  try {
    const data = await apiGet('leaderboard');
    const tbody = document.getElementById('leaderboard-body');
    tbody.innerHTML = '';

    data.leaderboard.forEach((row, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${row.alias}</td>
        <td>${row.nilai}/${row.totalSoal}</td>
        <td>${row.durasiDetik}s</td>
      `;
      tbody.appendChild(tr);
    });

    showView('leaderboard');
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      clearBtnLoading(triggerBtn);
    }
  }
}
