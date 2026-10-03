// Hokm engine — rules & card logic. Pure functions over an explicit game state `s`.
// Behavior ported bit-for-bit from Hokm-main/index.html (oracle); names preserved.

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
export const SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
// seat order per game spec: حریف۱ → شما → حریف۲ → یار — from the player's view:
// شما → حریف۲(4) → یار(3) → حریف۱(2). Counter-clockwise, as in real Hokm.
export const NEXT = { 1: 4, 4: 3, 3: 2, 2: 1 };
export const PARTNER = { 1: 3, 2: 4, 3: 1, 4: 2 };

export function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ suit: s, rank: r });
  return d;
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deterministic seeded RNG (mulberry32). The ONLY randomness source the game is
// ever handed: createGame(view, rng) threads it through every shuffle, deal, hakem
// pick and bam request, so a seed replays the whole game byte-for-byte (spec §4B/§5).
// The Decision Engine never receives it — decisions stay pure (spec §4A).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// old index.html cardVal (lines 1177-1189)
export function cardVal(c, mode) {
  if (mode === 'ners') {
    const o = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    return o.length - o.indexOf(c.rank);
  }
  if (mode === 'asners') {
    const o = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    return o.length - o.indexOf(c.rank);
  }
  return RANKS.indexOf(c.rank) + 1;
}

// old index.html cmpCards (lines 1191-1207)
export function cmpCards(a, b, lead, mode, trump) {
  const ta = mode === 'normal' && a.suit === trump;
  const tb = mode === 'normal' && b.suit === trump;
  if (mode === 'sers') {
    if (a.suit === lead && b.suit !== lead) return 1;
    if (a.suit !== lead && b.suit === lead) return -1;
    if (a.suit !== lead && b.suit !== lead) return 0;
    return cardVal(a, mode) - cardVal(b, mode);
  }
  if (ta && !tb) return 1;
  if (!ta && tb) return -1;
  if (ta && tb) return cardVal(a, mode) - cardVal(b, mode);
  if (a.suit === lead && b.suit !== lead) return 1;
  if (a.suit !== lead && b.suit === lead) return -1;
  if (a.suit === lead) return cardVal(a, mode) - cardVal(b, mode);
  return 0;
}

// old index.html trickWinner (lines 1209-1215)
export function trickWinner(trick, lead, mode, trump) {
  let w = trick[0];
  for (let i = 1; i < trick.length; i++) {
    if (cmpCards(trick[i].card, w.card, lead, mode, trump) > 0) w = trick[i];
  }
  return w;
}

// old index.html sortHand (lines 1217-1229)
export function sortHand(hand, trump, mode) {
  const bins = { spades: [], hearts: [], diamonds: [], clubs: [] };
  for (const c of hand) bins[c.suit].push(c);
  for (const s of SUITS) bins[s].sort((a, b) => cardVal(b, mode) - cardVal(a, mode));
  const out = [];
  if (mode === 'normal' && trump) {
    out.push(...bins[trump]);
    for (const s of SUITS.filter((x) => x !== trump)) out.push(...bins[s]);
  } else {
    for (const s of SUITS) out.push(...bins[s]);
  }
  return out;
}

// old index.html playable (lines 1243-1248)
export function playable(s, pid) {
  const h = s.players[pid].hand;
  if (!s.leadSuit || s.trick.length === 0) return h;
  const f = h.filter((c) => c.suit === s.leadSuit);
  return f.length ? f : h;
}

// ---------- AI counting helpers (old lines 1361-1451) ----------

export function opponentsOf(s, pid) {
  const team = s.players[pid].team;
  return [1, 2, 3, 4].filter((p) => s.players[p].team !== team);
}

export function stillToActPlayers(s, pid) {
  const played = new Set(s.trick.map((t) => t.player));
  const rest = [];
  for (let p = 1; p <= 4; p++) if (p !== pid && !played.has(p)) rest.push(p);
  return rest;
}

export function unaccountedHigherRanks(s, pid, suit, val, mode) {
  const played = new Set(s.memory.played.filter((c) => c.suit === suit).map((c) => c.rank));
  const mine = new Set(s.players[pid].hand.filter((c) => c.suit === suit).map((c) => c.rank));
  let count = 0;
  for (const r of RANKS) {
    if (played.has(r) || mine.has(r)) continue;
    if (cardVal({ rank: r, suit }, mode) > val) count++;
  }
  return count;
}

export function suitThreatExists(s, pid, suit, val, mode) {
  if (unaccountedHigherRanks(s, pid, suit, val, mode) === 0) return false;
  const rest = stillToActPlayers(s, pid);
  for (const p of rest) {
    const voids = s.memory.voids[p] || [];
    if (!voids.includes(suit)) return true;
  }
  return false;
}

export function trumpCutThreatExists(s, pid, mode, trump) {
  if (mode !== 'normal' || !trump) return false;
  if (unaccountedHigherRanks(s, pid, trump, 0, mode) === 0) return false;
  const rest = stillToActPlayers(s, pid);
  for (const p of rest) {
    const voids = s.memory.voids[p] || [];
    if (!voids.includes(trump)) return true;
  }
  return false;
}

export function isSecureWin(s, pid, card, mode, trump) {
  if (suitThreatExists(s, pid, card.suit, cardVal(card, mode), mode)) return false;
  if (mode === 'normal' && card.suit !== trump && trumpCutThreatExists(s, pid, mode, trump)) return false;
  return true;
}

export function riskAppetite(s, pid) {
  const team = s.players[pid].team;
  const opp = team === 'A' ? 'B' : 'A';
  const behindBy = s.tricksWon[opp] - s.tricksWon[team];
  const tricksLeft = 13 - s.trickNum;
  let score = behindBy * 2;
  if (tricksLeft <= 4) score += behindBy > 0 ? 3 : -1;
  return score;
}

export function topTrumpRunLength(s, pid, trump, mode) {
  const live = RANKS
    .filter((r) => !s.memory.played.some((c) => c.suit === trump && c.rank === r))
    .sort((a, b) => cardVal({ rank: b }, mode) - cardVal({ rank: a }, mode));
  let run = 0;
  for (const r of live) {
    if (s.players[pid].hand.some((c) => c.suit === trump && c.rank === r)) run++;
    else break;
  }
  return run;
}

export function recordSignal(s, player, suit, weight) {
  s.memory.signals.push({ player, suit, weight });
}

export function partnerSignalWeight(s, pid, suit) {
  const partner = PARTNER[pid];
  return s.memory.signals
    .filter((sg) => sg.player === partner && sg.suit === suit)
    .reduce((sum, sg) => sum + sg.weight, 0);
}

// old index.html getKotPoints (lines 1686-1689)
export function getKotPoints(s, winnerTeam) {
  const hTeam = s.players[s.hakem].team;
  return winnerTeam !== hTeam ? 3 : 2;
}
