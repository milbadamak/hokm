// Hokm UI controller — wires DOM to the pure engine (src/game.js). All game rules
// and AI live in the engine; this file is rendering + input + persistence only.
import { SYMBOLS, sortHand, mulberry32 } from './rules.js';
import { createGame } from './game.js';
import { coachHint, gradeMove } from './advisor.js';
import * as storage from './storage.js';

const $ = (id) => document.getElementById(id);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const lz = window.LZString;

// ---------- sound (WebAudio, identical cues to the original, no files) ----------
let soundOn = storage && localStorage.getItem(storage.SOUND_KEY) !== '0';
// independent toggles — never touch state/score/AI; pure overlay features
let analysisOn = localStorage.getItem('hokm_analysis_v1') === '1';
let coachOn = localStorage.getItem('hokm_coach_v1') === '1';
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function playTone(freq, duration, type, gainVal, delayFromNow) {
  if (!soundOn) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime + (delayFromNow || 0);
    gain.gain.setValueAtTime(gainVal || 0.14, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  } catch (e) { /* ignore */ }
}
const SFX = {
  cardPlay: () => playTone(520, 0.07, 'triangle', 0.09, 0),
  trickWinUs: () => { playTone(660, 0.1, 'sine', 0.13, 0); playTone(880, 0.14, 'sine', 0.13, 0.09); },
  trickWinThem: () => playTone(340, 0.14, 'sine', 0.1, 0),
  kotUs: () => { playTone(523, 0.12, 'sine', 0.15, 0); playTone(659, 0.12, 'sine', 0.15, 0.1); playTone(784, 0.22, 'sine', 0.15, 0.2); },
  kotThem: () => { playTone(300, 0.16, 'sawtooth', 0.09, 0); playTone(220, 0.22, 'sawtooth', 0.09, 0.12); },
  bam: () => { playTone(523, 0.1, 'sine', 0.17, 0); playTone(659, 0.1, 'sine', 0.17, 0.09); playTone(784, 0.1, 'sine', 0.17, 0.18); playTone(1047, 0.32, 'sine', 0.17, 0.27); },
  win: () => { playTone(523, 0.12, 'sine', 0.16, 0); playTone(659, 0.12, 'sine', 0.16, 0.1); playTone(784, 0.12, 'sine', 0.16, 0.2); playTone(1047, 0.3, 'sine', 0.16, 0.3); },
  lose: () => { playTone(320, 0.2, 'sawtooth', 0.1, 0); playTone(210, 0.3, 'sawtooth', 0.1, 0.14); },
  tap: () => playTone(300, 0.04, 'square', 0.05, 0),
};

// ---------- view implementation ----------
const view = {
  delay,
  sfx: (name) => SFX[name] && SFX[name](),
  clearTable: () => { for (let i = 1; i <= 4; i++) $(`slot${i}`).innerHTML = ''; },
  renderTableCard: (pid, c, necessary = false) => {
    const slot = $(`slot${pid}`);
    slot.innerHTML = '';
    slot.appendChild(createCardEl(c, 'table-card enter'));
  },
  renderHand,
  updateUI,
  onTrickEnd: null, // set by analysis wiring below
  showPopup: (t) => { const p = $('winnerPopup'); p.textContent = t; p.classList.add('show'); },
  hidePopup: () => $('winnerPopup').classList.remove('show'),
  showTrumpPicker: (cards) => {
    const cont = $('previewCards');
    cont.innerHTML = '';
    for (const c of cards) cont.appendChild(createCardEl(c));
    $('trumpModal').classList.add('show');
  },
  showKot: (msg) => { $('kotMsg').textContent = msg; $('kotModal').classList.add('show'); },
  showRound: (title, html, tone) => {
    const t = $('roundTitle');
    t.textContent = title;
    t.className = `modal-title ${tone === 'us' ? 'us' : 'them'}`;
    $('roundMsg').innerHTML = html;
    $('roundMsg').className = `modal-msg ${tone === 'us' ? 'us' : 'them'}`;
    $('roundModal').classList.add('show');
  },
  showEnd: (title, html, w) => {
    const t = $('endTitle');
    t.textContent = title;
    t.className = `modal-title ${w === 'A' ? 'us' : 'them'}`;
    $('endMsg').innerHTML = html;
    renderHistory();
    const s = storage.updateStatsOnGameEnd(localStorage, w, G);
    const pct = Math.round((s.gamesWon / s.gamesPlayed) * 100);
    $('statsSummary').textContent = `مجموع شما: ${s.gamesWon} برد از ${s.gamesPlayed} بازی (٪${pct})`;
    storage.clearSave(localStorage);
    $('endModal').classList.add('show');
  },
};

// §4B determinism: every shuffle / deal / hakem pick / bam request draws from ONE
// RNG. With ?seed=N the whole game replays byte-for-byte; without it, Math.random.
// The Decision Engine never receives this — AI choices stay pure (§4A).
const seedParam = new URLSearchParams((typeof location !== 'undefined' && location && location.search) || '').get('seed');
const gameRng = seedParam ? mulberry32(Number(seedParam) >>> 0) : Math.random;

const game = createGame(view, gameRng, null);
// Single source of truth: the engine owns the state object; every reassignment
// inside the engine (startTrick/startRound/continueFrom) keeps this reference valid
// because those mutate fields of game.G, never replace game.G itself.
const G = game.G;

// ---------- card DOM ----------
function createCardEl(c, sizeClass = '') {
  const el = document.createElement('div');
  const isTrump = G.trumpMode === 'normal' && c.suit === G.trump;
  el.className = `card suit-${c.suit}${isTrump ? ' trump' : ''}${sizeClass ? ' ' + sizeClass : ''}`;
  el.dataset.card = `${c.suit}:${c.rank}`;
  el.innerHTML = `<span class="card-rank">${c.rank}</span>
    <span class="card-suit-center">${SYMBOLS[c.suit]}</span>
    <span class="card-rank bottom">${c.rank}</span>`;
  return el;
}

function renderHand() {
  const cont = $('handCards');
  cont.innerHTML = '';
  const h = sortHand(G.players[1].hand, G.trump, G.trumpMode);
  G.players[1].hand = h;
  const can = game.playable(1);
  const myTurn = G.phase === 'play' && G.current === 1 && !G.processing;
  for (const c of h) {
    const el = createCardEl(c);
    const ok = myTurn && can.some((x) => x.suit === c.suit && x.rank === c.rank);
    if (!ok) el.classList.add('disabled');
    if (ok) el.onclick = () => selectCard(c);
    if (G.selectedCard && G.selectedCard.suit === c.suit && G.selectedCard.rank === c.rank) el.classList.add('selected');
    cont.appendChild(el);
  }
  applyCoach(cont, myTurn);
}

// Coach mode: mark the engine's suggestion on the hand + explain below it.
// Read-only: no state change, no forcing the player, engine = same aiPick logic.
function applyCoach(cont, myTurn) {
  const bar = $('coachBar');
  if (!coachOn || !myTurn || !G.players[1].hand.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  const hint = coachHint(G, 1);
  if (!hint) { bar.classList.add('hidden'); return; }
  const key = (c) => `${c.suit}:${c.rank}`;
  const sym = SYMBOLS[hint.best.suit];
  for (const el of cont.children) {
    if (el.dataset.card === key(hint.best)) el.classList.add('coach-best');
    if (hint.alt && el.dataset.card === key(hint.alt)) el.classList.add('coach-alt');
  }
  const sym2 = hint.alt ? SYMBOLS[hint.alt.suit] : null;
  bar.classList.remove('hidden');
  bar.innerHTML = `<span class="coach-line">🎓 پیشنهاد آموزشی: <b>${sym}${hint.best.rank}</b> — ${hint.bestReason}</span>` +
    (hint.alt ? `<span class="coach-line alt">گزینه دوم: <b>${sym2}${hint.alt.rank}</b> — ${hint.altReason}</span>` : '');
}

function selectCard(c) {
  if (G.selectedCard && G.selectedCard.suit === c.suit && G.selectedCard.rank === c.rank) {
    G.selectedCard = null;
    game.playHuman(c);
  } else {
    G.selectedCard = c;
    renderHand();
  }
}

// ---------- HUD ----------
function updateUI() {
  $('scoreA').textContent = G.score.A;
  $('scoreB').textContent = G.score.B;
  $('tricksA').textContent = G.tricksWon.A;
  $('tricksB').textContent = G.tricksWon.B;
  $('trickNum').textContent = G.trickNum;

  let td = '-';
  if (G.trump || G.trumpMode !== 'normal') {
    if (G.trumpMode === 'normal') td = SYMBOLS[G.trump];
    else if (G.trumpMode === 'ners') td = '(2)';
    else if (G.trumpMode === 'asners') td = '(A2)';
    else td = '(A)';
  }
  $('trumpDisplay').textContent = td;

  for (let i = 1; i <= 4; i++) {
    const box = $(`player${i}Box`);
    if (box) box.classList.toggle('active', G.current === i);
  }
  for (let i = 1; i <= 4; i++) {
    $(`crown${i}`).classList.add('hidden');
    $(`trumpBadge${i}`).classList.add('hidden');
  }
  if (G.hakem) {
    $(`crown${G.hakem}`).classList.remove('hidden');
    if (G.trump || G.trumpMode !== 'normal') {
      const b = $(`trumpBadge${G.hakem}`);
      b.classList.remove('hidden');
      b.textContent = G.trumpMode === 'normal' ? SYMBOLS[G.trump] : (G.trumpMode === 'ners' ? '2' : G.trumpMode === 'asners' ? 'A2' : 'A');
    }
  }
  if (G.phase !== 'idle') storage.saveGame(lz, localStorage, G);
  $('lastTrickBtn').classList.toggle('hidden', !G.lastTrick);
}

function renderHistory() {
  const cont = $('historyList');
  if (!G.roundHistory.length) { cont.classList.add('hidden'); cont.innerHTML = ''; return; }
  cont.classList.remove('hidden');
  cont.innerHTML = G.roundHistory.map((r, i) => `
    <div class="history-row">
      <span class="history-round">راند ${i + 1}</span>
      <span>${r.trump}</span>
      <span>${r.tricksA}-${r.tricksB}</span>
      <span class="history-winner ${r.winner === 'A' ? 'us' : 'them'}">${r.winner === 'A' ? 'ما' : 'آنها'} +${r.pts}${r.bam ? ' 🏆بام' : (r.kot ? ' کت' : '')}</span>
    </div>`).join('');
}

// ---------- last trick / analysis ----------
const QUALITY_LABEL = {
  excellent: ['عالی', 'good'],
  good: ['خوب', 'good'],
  improvable: ['قابل بهبود', 'warn'],
  mistake: ['اشتباه', 'bad'],
};

function showLastTrick() {
  if (!G.lastTrick) return;
  const cont = $('lastTrickCards');
  cont.innerHTML = '';
  const order = [1, 2, 3, 4];
  for (let pos = 0; pos < G.lastTrick.entries.length; pos++) {
    const entry = G.lastTrick.entries[pos];
    const pid = entry.player;
    const row = document.createElement('div');
    row.className = 'last-trick-row' + (pid === G.lastTrick.winner ? ' winner' : '');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'last-trick-name';
    nameSpan.textContent = G.players[pid].name + (pid === G.lastTrick.winner ? ' 🏆' : '');
    row.appendChild(nameSpan);
    const cardEl = createCardEl(entry.card, 'table-card');
    if (entry.necessary) {
      const tag = document.createElement('span');
      tag.className = 'necessary-tag';
      tag.textContent = 'ل';
      tag.title = 'حکم لازم';
      cardEl.appendChild(tag);
    }
    row.appendChild(cardEl);
    cont.appendChild(row);

    if (analysisOn) {
      // grade with decision-time info ONLY — no hindsight
      const snap = game.trickSnaps[G.lastTrick.trickNum];
      const g = snap && gradeMove(G, game.trickSnaps, G.lastTrick.trickNum, pos, pid, entry.card);
      const box = document.createElement('div');
      box.className = 'analysis-row';
      if (g) {
        const [label, tone] = QUALITY_LABEL[g.quality] || ['?', ''];
        box.classList.add(tone === 'good' ? 'good' : '');
        if (tone === 'bad') box.classList.add('bad');
        if (tone === 'warn') box.classList.add('warn');
        let html = `<span class="grade ${tone}">${label}</span> <span class="reason">${g.reason}</span>`;
        if (g.better) html += ` <span class="better">بهتر: ${SYMBOLS[g.better.suit]}${g.better.rank}</span>`;
        if (g.tacticLabels && g.tacticLabels.length) html += ` <span class="tactics">${g.tacticLabels.join(' · ')}</span>`;
        box.innerHTML = html;
      } else {
        box.innerHTML = '';
      }
      if (box.innerHTML) cont.appendChild(box);
    }
  }
  if (analysisOn) {
    const out = document.createElement('p');
    out.className = 'outcome-line';
    out.textContent = `نتیجهی واقعی: ${G.players[G.lastTrick.winner].name} برد.`;
    cont.appendChild(out);
  }
  void order;
  $('lastTrickModal').classList.add('show');
}

// ---------- start screen ----------
function renderStartStats() {
  const el = $('statsLine');
  const s = storage.loadStats(localStorage);
  if (!s.gamesPlayed) { el.textContent = ''; return; }
  const pct = Math.round((s.gamesWon / s.gamesPlayed) * 100);
  el.textContent = `${s.gamesWon} برد از ${s.gamesPlayed} بازی (٪${pct}) · ${s.kots} کت · ${s.bams} بام`;
}

function hideModals() {
  for (const id of ['trumpModal', 'roundModal', 'endModal', 'kotModal', 'lastTrickModal']) $(id).classList.remove('show');
}

function showGame() {
  $('startScreen').classList.add('hidden');
  $('gameWrapper').classList.remove('hidden');
}

// ---------- wiring ----------
$('startBtn').onclick = () => { storage.clearSave(localStorage); showGame(); hideModals(); game.startGame(); };
$('continueBtn').onclick = () => {
  const saved = storage.loadGame(lz, localStorage);
  if (!saved) { renderStartStats(); return; }
  showGame();
  game.continueFrom(saved);
};
$('nextRoundBtn').onclick = () => { $('roundModal').classList.remove('show'); game.startRound(); };
$('newGameBtn').onclick = () => {
  $('endModal').classList.remove('show');
  G.score = { A: 0, B: 0 };
  G.roundHistory = [];
  G.hakem = Math.floor(gameRng() * 4) + 1;
  game.startRound();
};
$('resetBtn').onclick = () => {
  if (!confirm('بازی از اول شروع بشه؟ امتیازها صفر میشن.')) return;
  hideModals();
  G.score = { A: 0, B: 0 };
  G.roundHistory = [];
  if (G.phase === 'idle') { showGame(); game.startGame(); return; }
  G.hakem = Math.floor(gameRng() * 4) + 1;
  game.startRound();
};
$('updateBtn').onclick = async () => {
  if (!confirm('نسخهی جدید بازی نصب بشه؟ صفحه رفرش میشه.')) return;
  try {
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    if ('serviceWorker' in navigator) await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()));
  } catch (e) { /* ignore */ }
  location.reload();
};
$('bamYes').onclick = () => { $('kotModal').classList.remove('show'); game.bamAccept(); };
$('bamNo').onclick = () => { $('kotModal').classList.remove('show'); game.bamDecline(); };
$('lastTrickBtn').onclick = showLastTrick;
$('closeLastTrick').onclick = () => $('lastTrickModal').classList.remove('show');
$('lastTrickModal').onclick = (e) => { if (e.target.id === 'lastTrickModal') $('lastTrickModal').classList.remove('show'); };

document.querySelectorAll('.trump-btn').forEach((b) => {
  b.onclick = () => {
    const t = b.dataset.trump;
    $('trumpModal').classList.remove('show');
    game.humanChoseTrump(['ners', 'asners', 'sers'].includes(t) ? t : 'normal', ['ners', 'asners', 'sers'].includes(t) ? null : t);
  };
});

function updateSoundBtnIcon() {
  const b = $('soundBtn');
  if (!b) return;
  b.innerHTML = soundOn ? '<svg class="ic"><use href="#i-sound-on"/></svg>' : '<svg class="ic"><use href="#i-sound-off"/></svg>';
}
$('soundBtn').onclick = () => {
  soundOn = !soundOn;
  try { localStorage.setItem(storage.SOUND_KEY, soundOn ? '1' : '0'); } catch (e) { /* noop */ }
  updateSoundBtnIcon();
  if (soundOn) SFX.tap();
};
updateSoundBtnIcon();

// ---------- boot ----------
renderStartStats();
// mode toggles (start screen)
const ta = $('toggleAnalysis'), tc = $('toggleCoach');
ta.checked = analysisOn; tc.checked = coachOn;
ta.onchange = () => { analysisOn = ta.checked; try { localStorage.setItem('hokm_analysis_v1', analysisOn ? '1' : '0'); } catch (e) {} };
tc.onchange = () => { coachOn = tc.checked; try { localStorage.setItem('hokm_coach_v1', coachOn ? '1' : '0'); } catch (e) {} };
const saved = storage.loadGame(lz, localStorage);
if (saved && saved.phase === 'play' && saved.players && saved.players[1] && saved.players[1].hand && saved.players[1].hand.length) {
  const cb = $('continueBtn');
  cb.classList.remove('hidden');
}
