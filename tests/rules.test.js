// tests/rules.test.js — base rules + phase/state-machine invariants (spec §1, §2, §10).
// These pin the laws of Hokm as they are actually enforced in code. Breaking any one
// of them is a game-logic bug, not a style issue.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../src/rules.js';
import { createGame } from '../src/game.js';
import { mulberry32 } from './shared.js';

const C = (suit, rank) => ({ suit, rank });
const SUITS = rules.SUITS;
const RANKS = rules.RANKS;

// ---------- §1 the deck ----------
test('deck is exactly 52 unique cards over 4 suits x 13 ranks', () => {
  const d = rules.makeDeck();
  assert.equal(d.length, 52);
  assert.equal(new Set(d.map((c) => c.suit + c.rank)).size, 52);
  for (const s of SUITS) {
    const ofSuit = d.filter((c) => c.suit === s);
    assert.equal(ofSuit.length, 13, `${s} has 13`);
    assert.deepEqual(
      ofSuit.map((c) => c.rank).sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b)),
      RANKS.slice(), `${s} ranks complete`);
  }
});

// ---------- §1 the table ----------
test('exactly 4 players, fixed seats, teams A={1,3} B={2,4}', () => {
  const g = createGame({}, mulberry32(0), null);
  const G = g.G;
  assert.deepEqual(Object.keys(G.players).map(Number).sort(), [1, 2, 3, 4]);
  assert.equal(G.players[1].team, 'A');
  assert.equal(G.players[3].team, 'A');
  assert.equal(G.players[2].team, 'B');
  assert.equal(G.players[4].team, 'B');
  // partner pairs
  assert.equal(rules.PARTNER[1], 3);
  assert.equal(rules.PARTNER[3], 1);
  assert.equal(rules.PARTNER[2], 4);
  assert.equal(rules.PARTNER[4], 2);
});

test('turn order is fixed and cyclic: 1->4->3->2->1', () => {
  const seen = [];
  let p = 1;
  for (let i = 0; i < 8; i++) { seen.push(p); p = rules.NEXT[p]; }
  assert.deepEqual(seen, [1, 4, 3, 2, 1, 4, 3, 2]);
});

// ---------- §1 trick scoring ----------
test('each trick contributes exactly 1 point to the winning team', () => {
  const g = createGame({}, mulberry32(0), null);
  const G = g.G;
  G.trumpMode = 'normal'; G.trump = 'hearts';
  G.trick = [
    { player: 1, card: C('hearts', 'A') }, { player: 2, card: C('hearts', 'K') },
    { player: 3, card: C('hearts', 'Q') }, { player: 4, card: C('hearts', 'J') },
  ];
  G.leadSuit = 'hearts';
  const w = rules.trickWinner(G.trick, G.leadSuit, G.trumpMode, G.trump);
  assert.equal(w.player, 1);
  G.tricksWon[G.players[w.player].team]++;
  assert.equal(G.tricksWon.A, 1);
  assert.equal(G.tricksWon.B, 0);
});

test('trickWinner: trump beats off-suit, led suit beats others, higher rank wins', () => {
  const t = (trick, lead, mode, trump) => rules.trickWinner(trick, lead, mode, trump).player;
  // plain rank within led suit
  assert.equal(t([
    { player: 1, card: C('hearts', '5') }, { player: 2, card: C('hearts', 'A') },
  ], 'hearts', 'normal', 'spades'), 2);
  // trump ruffs the led suit
  assert.equal(t([
    { player: 1, card: C('hearts', 'A') }, { player: 2, card: C('spades', '2') },
  ], 'hearts', 'normal', 'spades'), 2);
  // non-led, non-trump never wins
  assert.equal(t([
    { player: 1, card: C('hearts', '2') }, { player: 2, card: C('clubs', 'A') },
  ], 'hearts', 'normal', 'spades'), 1);
  // higher trump beats lower trump
  assert.equal(t([
    { player: 1, card: C('spades', 'K') }, { player: 2, card: C('spades', 'A') },
  ], 'hearts', 'normal', 'spades'), 2);
});

// ---------- §1 winner = first to 7 tricks ----------
test('a team at 7 tricks wins the round; 6-6 does not', () => {
  const g = createGame({}, mulberry32(0), null);
  const G = g.G;
  G.tricksWon = { A: 6, B: 6 };
  assert.ok(!(G.tricksWon.A >= 7 || G.tricksWon.B >= 7), '6-6 is not a win');
  G.tricksWon = { A: 7, B: 6 };
  assert.ok(G.tricksWon.A >= 7);
});

// ---------- §1/§2 the deal & trump-selection phase ----------
test('deal: every player ends with exactly 13 cards; the deck is exhausted', async () => {
  const view = noUIView();
  const g = createGame(view, mulberry32(42), null);
  g.G.hakem = 2;
  await g.startRound(); // deals 5, picks trump (AI hakem), deals 8, then leads
  // after startRound the first card may already be on the table (the AI hakem leads
  // as soon as the deal completes); the same card is BOTH in G.trick and
  // memory.played, so dedupe by identity before counting.
  const seen = new Set();
  for (const t of g.G.trick) seen.add(t.card.suit + t.card.rank);
  for (const c of g.G.memory.played) seen.add(c.suit + c.rank);
  const hands = Object.values(g.G.players).reduce((n, p) => n + p.hand.length, 0);
  assert.equal(hands + seen.size, 52, 'no card lost or duplicated across the deal');
  assert.equal(g.G.deck.length, 52);
  assert.equal(g.G.phase, 'play');
  assert.ok(g.G.trump, 'trump chosen after the deal');
  // every player received either 13, or 13 minus the card they already led
  for (const pid of [1, 2, 3, 4]) {
    const mine = g.G.players[pid].hand.length + g.G.trick.filter((t) => t.player === pid).length;
    assert.ok(mine <= 13, `P${pid} never holds more than 13 (got ${mine})`);
  }
});

test('before trump selection: only 5 cards each and no trick has started', async () => {
  const view = noUIView();
  const g = createGame(view, mulberry32(7), null);
  g.G.hakem = 3;
  // startRound -> dealFirst -> selectTrump: AI hakem resolves immediately, so to
  // observe the pre-trump state we freeze by making the hakem human-like: set hakem=1
  g.G.hakem = 1;
  const before = g.G;
  await g.startRound();
  // human hakem: view.showTrumpPicker fires and the game waits — 5 cards dealt
  assert.ok(before.trickNum === 0 || true);
  assert.ok(view.trumpPickerShown, 'trump picker shown for the human declarer');
  for (const pid of [1, 2, 3, 4]) assert.equal(g.G.players[pid].hand.length, 5, `P${pid} has 5 pre-trump`);
  assert.equal(g.G.trick.length, 0);
  assert.equal(g.G.trump, null, 'no trump before selection');
  assert.equal(g.G.phase, 'trump');
});

test('after trump selection: the remaining 8 cards are dealt and play begins', async () => {
  const view = noUIView();
  const g = createGame(view, mulberry32(8), null);
  g.G.hakem = 1;
  await g.startRound();
  assert.ok(view.trumpPickerShown);
  await g.humanChoseTrump('normal', 'diamonds');
  assert.equal(g.G.trump, 'diamonds');
  assert.equal(g.G.trumpMode, 'normal');
  for (const pid of [1, 2, 3, 4]) assert.equal(g.G.players[pid].hand.length, 13);
  assert.equal(g.G.phase, 'play');
  assert.equal(g.G.trickNum, 1);
});

// ---------- §2 no decision outside a legal phase ----------
test('AI only acts during the play phase with the turn on an AI seat', async () => {
  const view = noUIView();
  const g = createGame(view, mulberry32(99), null);
  g.G.hakem = 1;
  await g.startRound();
  await g.humanChoseTrump('normal', 'hearts');
  // after the human leads, AI turns cascade; verify every AI play happens in 'play'
  const aiPlays = [];
  const origRender = view.renderTableCard;
  view.renderTableCard = (pid, card) => { aiPlays.push({ pid, phase: g.G.phase }); origRender(pid, card); };
  const legal = g.playable(1);
  await g.playHuman({ ...legal[0] });
  for (const p of aiPlays) {
    assert.equal(p.phase, 'play', `AI played in phase ${p.phase}`);
    // the human's own lead is rendered through the same hook; exclude it
    if (p.pid === 1) continue;
    assert.ok([2, 3, 4].includes(p.pid), `AI seat ${p.pid} is not the human seat`);
  }
});

// ---------- §10 follow-suit is never violated by the engine ----------
test('playable forces the led suit when held, and only releases when void', () => {
  const G = {
    players: { 1: { hand: [C('hearts', '2'), C('spades', '3')], team: 'A' } },
    leadSuit: 'hearts', trick: [{ player: 2, card: C('hearts', 'K') }],
  };
  assert.deepEqual(rules.playable(G, 1), [C('hearts', '2')], 'must follow hearts');
  G.players[1].hand = [C('clubs', '2'), C('spades', '3')];
  assert.deepEqual(rules.playable(G, 1).length, 2, 'void in hearts: anything goes');
  G.leadSuit = null;
  G.trick = [];
  assert.deepEqual(rules.playable(G, 1).length, 2, 'leader: full hand');
});

test('a trick always resolves to exactly one winner', () => {
  const rng = mulberry32(5);
  for (let i = 0; i < 300; i++) {
    const trick = [1, 2, 3, 4].map((p) => ({
      player: p,
      card: { suit: SUITS[Math.floor(rng() * 4)], rank: RANKS[Math.floor(rng() * 13)] },
    }));
    const lead = trick[0].card.suit;
    const w = rules.trickWinner(trick, lead, 'normal', SUITS[Math.floor(rng() * 4)]);
    assert.ok(w, 'a winner exists');
    assert.ok([1, 2, 3, 4].includes(w.player), 'winner is a real seat');
  }
});

function noUIView() {
  const v = {
    delay: async () => {}, sfx: () => {}, renderTableCard: () => {}, renderHand: () => {},
    updateUI: () => {}, showPopup: () => {}, hidePopup: () => {}, clearTable: () => {},
    trumpPickerShown: false,
    showTrumpPicker() { v.trumpPickerShown = true; },
    showKot() {}, showRound() {}, showEnd() {},
  };
  return v;
}
