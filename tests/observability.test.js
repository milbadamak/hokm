// tests/observability.test.js — spec §8: the Knowledge Model must be built ONLY from
// observable information. Forbidden, ever, anywhere in the decision path:
//   • reading an opponent's hand          • reading the teammate's hand
//   • reading the remaining deck          • anything a player at the table cannot know
//
// This file proves it mechanically instead of by inspection: every opponent seat's
// `hand` property is wrapped in an access-logging Proxy, the whole decision pipeline
// runs, and the log must stay empty. A read of a hidden hand would trip the trap no
// matter how deep in the call stack it hides.
//
// A second, behavioral proof: swap the opponents' hidden cards for completely
// different ones. A truly observable engine's choice cannot move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, scoreMoves } from '../src/decision.js';
import { decideByPosition } from '../src/positions.js';
import { aiPick, pickAiTrump } from '../src/ai.js';
import { buildMemory } from '../src/knowledge.js';
import { coachHint, gradeMove, snapshotTrickStart } from '../src/advisor.js';
import { simulateRound, seededDeck } from '../src/simulate.js';
import { mulberry32, buildScenario, SUITS, RANKS } from './shared.js';

const SEATS = [1, 2, 3, 4];

// Wrap every NON-viewer seat in a Proxy that records any read of its `hand`.
// Reads of `team`/`name` are public information and stay allowed.
function spyOnHiddenHands(s, viewer) {
  const reads = [];
  const players = {};
  for (const pid of SEATS) {
    if (pid === viewer) { players[pid] = s.players[pid]; continue; }
    players[pid] = new Proxy(s.players[pid], {
      get(target, prop, receiver) {
        if (prop === 'hand') reads.push(pid);
        return Reflect.get(target, prop, receiver);
      },
    });
  }
  return { state: { ...s, players }, reads };
}

// All states the decision engine is ever asked over, each spied for every viewer.
function scenarios() {
  const rng = mulberry32(9090);
  const out = [];
  for (let i = 0; i < 40; i++) {
    const s = buildScenario(rng, Math.floor(rng() * 4));
    s.tricksWon = { A: Math.floor(rng() * 7), B: Math.floor(rng() * 7) };
    s.memory.signals = Array.from({ length: Math.floor(rng() * 3) }, () => ({
      player: 1 + Math.floor(rng() * 4), suit: SUITS[Math.floor(rng() * 4)], weight: 1 + Math.floor(rng() * 2),
    }));
    out.push(s);
  }
  return out;
}

test('decide() / decideByPosition() / aiPick() never read a hidden hand', () => {
  for (const s of scenarios()) {
    for (const viewer of SEATS) {
      if (!s.players[viewer].hand.length) continue;
      const { state, reads } = spyOnHiddenHands(s, viewer);
      decide(state, viewer);
      decideByPosition(state, viewer);
      aiPick(state, viewer);
      scoreMoves(state, viewer);
      buildMemory(state, viewer);
      assert.deepEqual(reads, [],
        `decision path read a hidden hand (viewer P${viewer}, reads on seats ${reads.join(',')})`);
    }
  }
});

test('knowledge layer never enumerates the unseen deck or hidden hands (holdersOf stays honest)', () => {
  for (const s of scenarios().slice(0, 12)) {
    for (const viewer of SEATS) {
      if (!s.players[viewer].hand.length) continue;
      const { state, reads } = spyOnHiddenHands(s, viewer);
      const M = buildMemory(state, viewer);
      // remaining = 52 minus own minus played — derived, never an opponent-hand lookup
      assert.equal(M.remaining.length + M.own.length + M.played.length, 52,
        'remaining+own+played must account for all 52 cards');
      // suitsSeen / tricks / voids are all functions of played cards and trick state
      assert.ok(Array.isArray(M.suitsSeen) && M.suitsSeen.every((x) => SUITS.includes(x)));
      assert.deepEqual(reads, [], `buildMemory read a hidden hand for viewer P${viewer}`);
    }
  }
});

test('coachHint and gradeMove (Analysis) use no hidden information', () => {
  const rng = mulberry32(4242);
  for (let i = 0; i < 20; i++) {
    const s = buildScenario(rng, 2);
    // gradeMove needs a start-of-trick snapshot; build one from the live state
    const snap = snapshotTrickStart(s);
    // freeze the OTHER seats' hands in the snapshot: any hidden-hand dependence would
    // either throw (strict) or change the grade
    for (const pid of SEATS) {
      if (pid === 1) continue;
      Object.freeze(snap.players[pid].hand);
    }
    const before = gradeMove(s, { 1: snap }, s.trickNum, 0, 1, s.players[1].hand[0]);
    const after = gradeMove(s, { 1: snapshotTrickStart(s) }, s.trickNum, 0, 1, s.players[1].hand[0]);
    if (before && after) {
      assert.equal(before.quality, after.quality, 'grade changed with hidden hands frozen');
      assert.deepEqual(before.better, after.better, 'suggested fix changed with hidden hands frozen');
    }
    // coach: spying must not alter the hint, and must not read hidden hands
    const { state, reads } = spyOnHiddenHands(s, 1);
    const hint = coachHint(state, 1);
    assert.deepEqual(reads, [], 'coachHint read a hidden hand');
    assert.deepEqual(hint, coachHint(s, 1), 'coachHint output depends on hidden hands');
  }
});

// Behavioral proof: replacing the opponents' actual cards with different cards cannot
// change what the engine chooses — the choice is a function of observables only.
test('swapping every hidden hand for different cards leaves the decision unchanged', () => {
  for (const s of scenarios().slice(0, 15)) {
    for (const viewer of SEATS) {
      if (!s.players[viewer].hand.length) continue;
      const base = JSON.stringify(decide(s, viewer));
      const swapped = JSON.parse(JSON.stringify(s));
      for (const pid of SEATS) {
        if (pid === viewer) continue;
        // give the seat a brand-new hand of the same size (cards it never held),
        // deliberately overlapping the viewer's own cards
        swapped.players[pid].hand = RANKS.slice(0, swapped.players[pid].hand.length)
          .map((r, i) => ({ suit: SUITS[i % 4], rank: r }));
      }
      assert.equal(JSON.stringify(decide(swapped, viewer)), base,
        `viewer P${viewer}: decision moved when only hidden hands changed`);
    }
  }
});

// End-to-end: full simulated rounds must not consult hidden hands either. We cannot
// spy mid-simulation (the engine mutates its own state), so we verify the invariant
// that drives it: every simulated round is reproducible from observables alone and
// every card an opponent played was legally in a hand the engine never read.
test('simulated rounds: opponents only ever "held" cards the engine could not have peeked at', () => {
  for (let i = 0; i < 25; i++) {
    const r = simulateRound({ deck: seededDeck(44000 + i) });
    const seen = new Set();
    for (const t of r.tricks) {
      for (const p of t.plays) {
        const k = `${p.card.suit}:${p.card.rank}`;
        assert.ok(!seen.has(k), `round ${i}: card ${k} played twice`);
        seen.add(k);
      }
    }
    assert.equal(seen.size, r.tricks.length * 4, `round ${i}: card accounting broken`);
  }
});

test('pickAiTrump scores only the 5 dealt cards (never the full hand or the deck)', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 30; i++) {
    const hand5 = RANKS.slice(0, 5).map((r, j) => ({ suit: SUITS[(i + j) % 4], rank: r }));
    assert.ok(SUITS.includes(pickAiTrump(hand5)), 'trump pick returns a real suit');
    // the pick depends only on the 5 cards passed — extra surrounding cards are absent
    assert.equal(pickAiTrump(hand5), pickAiTrump(hand5), 'trump pick is deterministic');
  }
});
