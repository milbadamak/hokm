// Shared test helpers: seeded RNG + a play-application mirroring old doPlayCard mutations.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWith(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Exactly mirrors old doPlayCard state mutations (minus UI/sfx/popup).
// Old source: index.html lines 1287-1309.
export function applyPlay(state, pid, c, recommended = null) {
  const mode = state.trumpMode, trump = state.trump;
  const h = state.players[pid].hand;
  const i = h.findIndex((x) => x.suit === c.suit && x.rank === c.rank);
  if (i > -1) h.splice(i, 1);
  const necessary = state.trick.length === 0 && mode === 'normal' && c.suit === trump;
  state.trick.push({ player: pid, card: c, necessary, recommended });
  if (state.trick.length === 1) state.leadSuit = c.suit;
  state.memory.played.push({ ...c });
  if (c.rank === 'A') state.memory.aces[c.suit] = true;
  if (c.rank === 'K') state.memory.kings[c.suit] = true;
  if (state.leadSuit && c.suit !== state.leadSuit) {
    if (!state.memory.voids[pid]) state.memory.voids[pid] = [];
    if (!state.memory.voids[pid].includes(state.leadSuit)) state.memory.voids[pid].push(state.leadSuit);
  }
  return necessary;
}

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Build a coherent mid-trick state: full deal done, trick of `playedCount` legal plays
// produced by driving seats 1..4 with the given picker.
export function buildScenario(rng, trickLen) {
  const deck = shuffleWith(
    SUITS.flatMap((s) => RANKS.map((r) => ({ suit: s, rank: r }))),
    rng,
  );
  const modes = ['normal', 'ners', 'asners', 'sers'];
  const trumpMode = modes[Math.floor(rng() * 4)];
  const trump = trumpMode === 'normal' ? SUITS[Math.floor(rng() * 4)] : null;
  const starter = 1 + Math.floor(rng() * 4);
  const s = {
    players: {
      1: { name: 'A', hand: [], team: 'A' },
      2: { name: 'B', hand: [], team: 'B' },
      3: { name: 'C', hand: [], team: 'A' },
      4: { name: 'D', hand: [], team: 'B' },
    },
    hakem: starter, trump, trumpMode,
    trick: [], leadSuit: null, current: starter, starter,
    tricksWon: { A: 0, B: 0 }, score: { A: 0, B: 0 },
    trickNum: 1 + Math.floor(rng() * 12), phase: 'play',
    deck: [], memory: { played: [], voids: {}, aces: {}, kings: {}, signals: [] },
    kotTeam: null, kotPoints: 0, bamMode: false, roundHistory: [], lastTrick: null,
  };
  let i = 0;
  for (const p of [1, 2, 3, 4]) s.players[p].hand = deck.slice(i, i + 13), (i += 13);
  void deck;
  return s;
}

export function freshMemoryState(s) {
  return structuredClone(s);
}
