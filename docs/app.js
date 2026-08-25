// GANTI URL DI BAWAH INI dengan URL Web App hasil deploy Google Apps Script kamu
// (Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone)
const API = 'https://script.google.com/macros/s/AKfycbx8eCQYmP1lBnSEevtKl4CHGO3Pqkppnl0ECtwcsWmkOJmZLPBKzw28WQ9U24szPMZBSg/exec';

// Helper: GET pakai query string action, POST pakai text/plain (hindari CORS preflight)
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
  waktuMulai: null,
};

// ---------- MUSIK LATAR ----------
const bgMusic = document.getElementById('bg-music');
const btnMute = document.getElementById('btn-mute');
let musicMuted = false;

// Simpan status musik (posisi & mute) supaya bisa lanjut lagi setelah reload
// (mis. saat user menekan Ctrl+Shift+R / hard refresh, yang selalu memuat ulang
// seluruh halaman dari nol -- ini perilaku bawaan browser dan tidak bisa dicegah
// oleh JS, tapi kita bisa membuatnya *terasa* nyambung dengan menyimpan posisinya).
const MUSIC_KEY = 'kuisMaulidMusicState';

function saveMusicState() {
  try {
    sessionStorage.setItem(MUSIC_KEY, JSON.stringify({
      time: bgMusic.currentTime,
      muted: musicMuted,
    }));
  } catch (e) {}
}

btnMute.addEventListener('click', () => {
  musicMuted = !musicMuted;
  bgMusic.muted = musicMuted;
  btnMute.textContent = musicMuted ? '🔇' : '🔊';
  saveMusicState();
});

function playBgMusic() {
  bgMusic.volume = 0.35;

  // Pulihkan posisi & status mute dari sesi sebelumnya (kalau ada)
  try {
    const saved = JSON.parse(sessionStorage.getItem(MUSIC_KEY));
    if (saved) {
      if (typeof saved.time === 'number' && isFinite(saved.time)) {
        bgMusic.currentTime = saved.time;
      }
      musicMuted = !!saved.muted;
      bgMusic.muted = musicMuted;
      btnMute.textContent = musicMuted ? '🔇' : '🔊';
    }
  } catch (e) {}

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

function stopBgMusic() {
  bgMusic.pause();
  bgMusic.currentTime = 0;
  try { sessionStorage.removeItem(MUSIC_KEY); } catch (e) {}
}

// Simpan posisi musik secara berkala & sesaat sebelum halaman ditinggalkan/reload
setInterval(saveMusicState, 2000);
window.addEventListener('pagehide', saveMusicState);
window.addEventListener('beforeunload', saveMusicState);

// Coba nyalakan musik segera setelah halaman selesai dimuat
window.addEventListener('DOMContentLoaded', playBgMusic);

const view = {
  login: document.getElementById('view-login'),
  alias: document.getElementById('view-alias'),
  quiz: document.getElementById('view-quiz'),
  result: document.getElementById('view-result'),
  leaderboard: document.getElementById('view-leaderboard'),
};

function showView(name) {
  Object.values(view).forEach(v => v.classList.add('hidden'));
  view[name].classList.remove('hidden');
}

// ---------- LOGIN ----------
document.getElementById('btn-login').addEventListener('click', async () => {
  const nip5 = document.getElementById('input-nip').value.trim();
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  if (nip5.length !== 5) {
    errorEl.textContent = 'Masukkan tepat 5 digit NIP.';
    return;
  }

  try {
    const data = await apiPost('login', { nip5 });

    if (data.error) {
      errorEl.textContent = data.error;
      return;
    }

    state.nip = data.nip;
    state.nama = data.nama;

    document.getElementById('alias-nama-asli').textContent = data.nama;
    document.getElementById('input-alias').value = '';
    document.getElementById('alias-error').textContent = '';
    showView('alias');
  } catch (err) {
    errorEl.textContent = 'Tidak bisa terhubung ke server.';
  }
});

document.getElementById('btn-show-leaderboard').addEventListener('click', loadLeaderboard);
document.getElementById('btn-back-home').addEventListener('click', () => showView('login'));
document.getElementById('btn-to-leaderboard').addEventListener('click', loadLeaderboard);

// ---------- ALIAS ----------
document.getElementById('btn-start-quiz').addEventListener('click', async () => {
  const alias = document.getElementById('input-alias').value.trim();
  const errorEl = document.getElementById('alias-error');

  if (!alias) {
    errorEl.textContent = 'Nama samaran tidak boleh kosong.';
    return;
  }
  if (alias.length < 3) {
    errorEl.textContent = 'Nama samaran minimal 3 karakter.';
    return;
  }

  state.alias = alias;
  await startQuiz();
});

// ---------- QUIZ ----------
async function startQuiz() {
  const data = await apiGet('soal');
  state.soal = data.soal;
  state.idx = 0;
  state.jawaban = {};
  state.terjawab = {};
  state.waktuMulai = new Date().toISOString();

  document.getElementById('quiz-nama').textContent = state.nama;
  showView('quiz');
  renderSoal();
  playBgMusic();
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

  // Kunci semua tombol dulu supaya tidak bisa diklik dobel selama nunggu server
  container.querySelectorAll('.opsi-btn').forEach(b => (b.disabled = true));

  state.jawaban[soal.id] = nilaiPilihan;

  let hasil;
  try {
    hasil = await apiPost('jawab', { soalId: soal.id, jawaban: nilaiPilihan });
  } catch (err) {
    hasil = null;
  }

  if (!hasil || hasil.error) {
    // Kalau gagal cek ke server, tetap lanjut tanpa efek supaya kuis tidak macet
    container.querySelectorAll('.opsi-btn').forEach(b => (b.disabled = false));
    document.getElementById('btn-next').disabled = false;
    return;
  }

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

document.getElementById('btn-next').addEventListener('click', async () => {
  if (state.idx < state.soal.length - 1) {
    state.idx += 1;
    renderSoal();
  } else {
    await submitQuiz();
  }
});

async function submitQuiz() {
  const data = await apiPost('submit', {
    nip: state.nip,
    alias: state.alias,
    waktuMulai: state.waktuMulai,
    jawaban: state.jawaban,
  });

  if (data.error) {
    alert(data.error);
    return;
  }

  document.getElementById('result-score').textContent = `${data.nilai} / ${data.totalSoal}`;
  document.getElementById('result-durasi').textContent = `Waktu pengerjaan: ${data.durasiDetik} detik`;
  stopBgMusic();
  showView('result');
}

// ---------- LEADERBOARD ----------
async function loadLeaderboard() {
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
}
