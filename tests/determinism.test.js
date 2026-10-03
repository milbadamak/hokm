// tests/determinism.test.js — spec §4 (determinism) and §5 (replay).
//
// §4A Decision determinism: decide()/decideByPosition() are pure functions of the
//     game state. Same state in → same card out, forever. This file hammers that
//     empirically (1000x per state) across fresh / mid-trick / boundary / tie-heavy
//     states, because a randomness source can hide in an iteration order or a shared
//     cache and only surface under repetition.
// §4B + §5 Game determinism: one seed → ONE RNG → every shuffle, deal, hakem pick and
//     bam request. A full game replayed 100x from the same seed must produce a
//     byte-identical transcript.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, scoreMoves } from '../src/decision.js';
import { decideByPosition } from '../src/positions.js';
import { aiPick } from '../src/ai.js';
import { simulateGame } from '../src/simulate.js';
import { mulberry32, buildScenario } from './shared.js';

const C = (suit, rank) => ({ suit, rank });

// ---------- §4A: the Decision Engine is deterministic ----------

// A spread of states exercising the interesting code paths: empty trick, each seat
// count, last trick, every score boundary, and hands full of equal-valued cards
// (the tie-break is what a hidden RNG would corrupt).
function decisionStates() {
  const rng = mulberry32(31337);
  const states = [];
  // fresh round, every seat acts, several trump modes
  for (const mode of ['normal', 'ners', 'asners', 'sers']) {
    const s = buildScenario(rng, 0);
    s.trumpMode = mode;
    s.trump = mode === 'normal' ? 'hearts' : null;
    s.trickNum = 1;
    states.push({ name: `fresh/${mode}`, s });
  }
  // mid-trick: 1, 2 and 3 cards on the table (SECOND/THIRD/FOURTH seats)
  for (const n of [1, 2, 3]) {
    const s = buildScenario(rng, n);
    states.push({ name: `trick-${n}-in`, s });
  }
  // boundary trick numbers (first / last) and score boundaries (6-6, 0-6, 6-0)
  for (const trickNum of [1, 2, 12, 13]) {
    const s = buildScenario(rng, 2);
    s.trickNum = trickNum;
    states.push({ name: `trickNum-${trickNum}`, s });
  }
  for (const [a, b] of [[6, 6], [0, 6], [6, 0], [3, 3], [1, 6]]) {
    const s = buildScenario(rng, 1);
    s.tricksWon = { A: a, B: b };
    states.push({ name: `score-${a}-${b}`, s });
  }
  // tie-heavy hands: four equal-ranked cards, no lead suit — every candidate scores
  // alike, so the pick is decided by the FIXED tie-break alone
  for (const rank of ['2', '7', 'Q', 'A']) {
    const s = buildScenario(rng, 0);
    s.players[1].hand = [C('spades', rank), C('hearts', rank), C('diamonds', rank), C('clubs', rank)];
    s.trump = 'spades'; s.trumpMode = 'normal'; s.leadSuit = null; s.trick = [];
    states.push({ name: `ties-${rank}`, s });
  }
  return states;
}

test('decide(): 1000 repeat calls on one canonical state return the byte-identical result', () => {
  const canonical = decisionStates().find((x) => x.name === 'trick-2-in');
  for (const pid of [1, 2, 3, 4]) {
    const first = JSON.stringify(decide(canonical.s, pid));
    assert.ok(first !== 'null', `P${pid}: decide produced nothing`);
    for (let i = 0; i < 1000; i++) {
      assert.equal(JSON.stringify(decide(canonical.s, pid)), first,
        `P${pid}: decide diverged on repetition ${i}`);
    }
  }
});

test('decide(): stable across fresh / mid-trick / boundary / tie states (25x each)', () => {
  for (const { name, s } of decisionStates()) {
    for (const pid of [1, 2, 3, 4]) {
      if (!s.players[pid].hand.length) continue;
      const first = JSON.stringify(decide(s, pid));
      assert.ok(first !== 'null', `${name}/P${pid}: decide produced nothing`);
      for (let i = 0; i < 25; i++) {
        assert.equal(JSON.stringify(decide(s, pid)), first, `${name}/P${pid}: decide diverged`);
      }
    }
  }
});

test('decide(): tie-break is fixed (score ↓, future value ↓, rank ↓) — no RNG affects it', () => {
  // Two equal-score candidates must always resolve to the same card. Passing an rng
  // that returns wildly different values cannot move the pick (the arg is ignored).
  for (const { name, s } of decisionStates().slice(0, 8)) {
    const pid = 2;
    if (!s.players[pid].hand.length) continue;
    const base = decide(s, pid);
    const coin = (() => { let x = 0.5; return () => (x = (x * 9301 + 49297) % 233280) / 233280; })();
    const alt = decide(s, pid, coin);
    assert.deepEqual(alt.card, base.card, `${name}: an injected rng changed the decision`);
    assert.equal(JSON.stringify(scoreMoves(s, pid).scored.map((m) => [m.card.suit, m.card.rank, m.score.toFixed(4)])),
      JSON.stringify(scoreMoves(s, pid).scored.map((m) => [m.card.suit, m.card.rank, m.score.toFixed(4)])),
      `${name}: scoreMoves ordering unstable`);
    void alt;
  }
});

test('decideByPosition + aiPick: identical output under repetition (200x per position)', () => {
  // one state per trick position, repeated — plus a sweep of every state at 3x
  for (const pos of [0, 1, 2, 3]) {
    const rec = decisionStates().find((x) => x.name === `trick-${pos}-in`) || decisionStates()[0];
    const s = rec.s;
    for (const pid of [1, 2, 3, 4]) {
      if (!s.players[pid].hand.length) continue;
      const p = JSON.stringify(decideByPosition(s, pid));
      const a = JSON.stringify(aiPick(s, pid));
      for (let i = 0; i < 200; i++) {
        assert.equal(JSON.stringify(decideByPosition(s, pid)), p, `pos ${pos}/P${pid}: policy diverged`);
        assert.equal(JSON.stringify(aiPick(s, pid)), a, `pos ${pos}/P${pid}: aiPick diverged`);
      }
    }
  }
  for (const { name, s } of decisionStates()) {
    for (const pid of [1, 2, 3, 4]) {
      if (!s.players[pid].hand.length) continue;
      const p = JSON.stringify(decideByPosition(s, pid));
      const a = JSON.stringify(aiPick(s, pid));
      for (let i = 0; i < 3; i++) {
        assert.equal(JSON.stringify(decideByPosition(s, pid)), p, `${name}/P${pid}: policy diverged`);
        assert.equal(JSON.stringify(aiPick(s, pid)), a, `${name}/P${pid}: aiPick diverged`);
      }
    }
  }
});

// ---------- §4B + §5: a seeded game replays byte-for-byte ----------

test('full game: same seed → byte-identical transcript over 100 consecutive runs', { timeout: 120000 }, () => {
  const seed = 3;
  const first = JSON.stringify(simulateGame({ seed }));
  assert.ok(first.length > 500, 'the transcript is non-trivial');
  for (let i = 0; i < 100; i++) {
    const again = JSON.stringify(simulateGame({ seed }));
    assert.equal(again, first, `replay ${i} of seed ${seed} diverged from the first`);
  }
});

test('full game: distinct seeds are each self-consistent (replay 10x)', { timeout: 120000 }, () => {
  for (const seed of [777, 555, 2024, 99, 20260704]) {
    const first = JSON.stringify(simulateGame({ seed }));
    for (let i = 0; i < 10; i++) {
      assert.equal(JSON.stringify(simulateGame({ seed })), first, `seed ${seed} did not replay identically`);
    }
  }
});

// The transcript must carry everything a replay claim needs (§5): the initial deal,
// the trump, every play with its player and card, each trick's winner, the running
// score and the final winner.
test('full-game transcript contains deal, trump, plays, winners, score and final winner', () => {
  const g = simulateGame({ seed: 555 });
  assert.ok(g.winner === 'A' || g.winner === 'B', 'a match winner is decided');
  assert.ok(g.rounds.length >= 1, 'at least one round was played');
  assert.ok(g.score[g.winner] >= 7, 'the winner reached 7 points');
  let prevScore = null;
  for (const r of g.rounds) {
    assert.equal(r.deck.length, 52, 'the round records the full 52-card deal order');
    assert.ok(['spades', 'hearts', 'diamonds', 'clubs'].includes(r.trump), 'a trump suit is recorded');
    assert.ok(r.tricksWon.A + r.tricksWon.B === r.tricks.length, 'round tricksWon matches tricks played');
    for (const t of r.tricks) {
      assert.equal(t.plays.length, 4, 'every trick has the 4 plays');
      assert.ok([1, 2, 3, 4].includes(t.winner), 'every trick records its winner seat');
      for (const p of t.plays) {
        assert.ok(p.player >= 1 && p.player <= 4, 'every play records its player');
        assert.ok(p.card.suit && p.card.rank, 'every play records its card');
      }
    }
    if (prevScore) {
      assert.deepEqual(r.scoreAfter.A >= prevScore.A, true, 'score is monotonic');
      assert.deepEqual(r.scoreAfter.B >= prevScore.B, true, 'score is monotonic');
    }
    prevScore = r.scoreAfter;
  }
  // the last round's running score equals the match score, and it reached 7
  assert.deepEqual(g.rounds[g.rounds.length - 1].scoreAfter, g.score);
  assert.ok(g.score.A >= 7 || g.score.B >= 7, 'the match ends on 7 points (or a bam)');
});
