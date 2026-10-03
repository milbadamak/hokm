import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newOldCtx, oracleAvailable } from './old-harness.js';
import { mulberry32, shuffleWith, buildScenario, applyPlay, SUITS, RANKS } from './shared.js';
import * as rules from '../src/rules.js';
import * as ai from '../src/ai.js';

// The oracle is the previous shipping build (../Hokm-main/index.html). When it is
// not checked out, these differential tests cannot run: skip with a reason instead
// of failing the suite. Everything else in the suite is oracle-independent.
const old = oracleAvailable() ? newOldCtx() : null;
const oracleTest = oracleAvailable() ? test : test.skip;

function eqJson(a, b, msg) { assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg); }

// Push engine state s into the old IIFE's G by mutating its fields (the old functions
// close over the G *binding*, not an exported copy, so field-mutation is the only hook).
function loadIntoOld(s) {
  const G = old.G;
  G.players = structuredClone(s.players);
  G.hakem = s.hakem; G.trump = s.trump; G.trumpMode = s.trumpMode;
  G.trick = structuredClone(s.trick); G.leadSuit = s.leadSuit;
  G.current = s.current; G.starter = s.starter;
  G.tricksWon = structuredClone(s.tricksWon); G.score = structuredClone(s.score);
  G.trickNum = s.trickNum; G.phase = s.phase;
  G.memory = structuredClone(s.memory);
  G.kotTeam = s.kotTeam; G.kotPoints = s.kotPoints; G.bamMode = s.bamMode;
}

oracleTest('old oracle loaded and exports internals', () => {
  assert.equal(typeof old.aiPick, 'function');
  assert.equal(typeof old.cardVal, 'function');
  assert.equal(typeof old.G, 'object');
});

oracleTest('cardVal equals old for every rank x mode', () => {
  for (const mode of ['normal', 'ners', 'asners', 'sers']) {
    for (const r of RANKS) {
      for (const s of SUITS) {
        const c = { suit: s, rank: r };
        assert.equal(rules.cardVal(c, mode), old.cardVal(c, mode), `cardVal ${r} ${s} ${mode}`);
      }
    }
  }
});

oracleTest('cmpCards equals old over all pairs x lead x mode x trump', () => {
  const cards = SUITS.flatMap((s) => RANKS.map((r) => ({ suit: s, rank: r })));
  for (const mode of ['normal', 'ners', 'asners', 'sers']) {
    for (const lead of SUITS) {
      for (const trump of (mode === 'normal' ? SUITS : [null])) {
        for (const a of cards) {
          for (const b of cards) {
            assert.equal(
              rules.cmpCards(a, b, lead, mode, trump),
              old.cmpCards(a, b, lead, mode, trump),
              `cmp ${a.suit[0]}${a.rank} vs ${b.suit[0]}${b.rank} lead=${lead[0]} mode=${mode} trump=${trump && trump[0]}`,
            );
          }
        }
      }
    }
  }
});

oracleTest('trickWinner equals old on random tricks', () => {
  const rng = mulberry32(11);
  for (let t = 0; t < 400; t++) {
    const trick = [1, 2, 3, 4].map((p) => ({ player: p, card: { suit: SUITS[Math.floor(rng() * 4)], rank: RANKS[Math.floor(rng() * 13)] } }));
    const lead = trick[0].card.suit;
    const mode = ['normal', 'ners', 'asners', 'sers'][Math.floor(rng() * 4)];
    const trump = mode === 'normal' ? SUITS[Math.floor(rng() * 4)] : null;
    eqJson(rules.trickWinner(trick, lead, mode, trump), old.trickWinner(trick, lead, mode, trump), `winner t${t}`);
  }
});

oracleTest('sortHand equals old', () => {
  const rng = mulberry32(12);
  for (let t = 0; t < 100; t++) {
    const hand = shuffleWith(SUITS.flatMap((s) => RANKS.map((r) => ({ suit: s, rank: r }))), rng).slice(0, 5 + Math.floor(rng() * 9));
    const mode = ['normal', 'ners', 'asners', 'sers'][Math.floor(rng() * 4)];
    const trump = mode === 'normal' ? SUITS[Math.floor(rng() * 4)] : null;
    eqJson(rules.sortHand(hand, trump, mode), old.sortHand(hand, trump, mode), `sortHand t${t}`);
  }
});

oracleTest('playable equals old', () => {
  const rng = mulberry32(13);
  for (let t = 0; t < 200; t++) {
    const s = buildScenario(rng, 0);
    s.leadSuit = rng() < 0.5 ? null : SUITS[Math.floor(rng() * 4)];
    if (s.leadSuit) s.trick.push({ player: s.starter, card: { suit: s.leadSuit, rank: RANKS[0] } });
    loadIntoOld(s);
    const pid = 1 + Math.floor(rng() * 4);
    eqJson(rules.playable(s, pid), old.playable(pid), `playable t${t}`);
  }
});

// aiPick & trump-bid are INTENTIONALLY redesigned (Decision Engine spec) â€” their
// old==new tests were removed on purpose. Rules below must still match the oracle.

oracleTest('memory/threat helpers equal old', () => {
  const rng = mulberry32(777);
  for (let t = 0; t < 80; t++) {
    const s = buildScenario(rng, Math.floor(rng() * 4));
    // seed some signals + voids variety
    s.memory.signals = Array.from({ length: Math.floor(rng() * 4) }, () => ({
      player: 1 + Math.floor(rng() * 4),
      suit: SUITS[Math.floor(rng() * 4)],
      weight: 1 + Math.floor(rng() * 2),
    }));
    loadIntoOld(s);
    for (let i = 0; i < 8; i++) {
      const pid = 1 + Math.floor(rng() * 4);
      const suit = SUITS[Math.floor(rng() * 4)];
      const val = 1 + Math.floor(rng() * 13);
      assert.equal(rules.unaccountedHigherRanks(s, pid, suit, val, s.trumpMode), old.unaccountedHigherRanks(pid, suit, val, s.trumpMode), `unacc ${t}/${i}`);
      assert.equal(rules.suitThreatExists(s, pid, suit, val, s.trumpMode), old.suitThreatExists(pid, suit, val, s.trumpMode), `threat ${t}/${i}`);
      assert.equal(rules.trumpCutThreatExists(s, pid, s.trumpMode, s.trump), old.trumpCutThreatExists(pid, s.trumpMode, s.trump), `cut ${t}/${i}`);
      assert.equal(rules.riskAppetite(s, pid), old.riskAppetite(pid), `risk ${t}/${i}`);
      assert.equal(rules.topTrumpRunLength(s, pid, s.trump, s.trumpMode), old.topTrumpRunLength(pid, s.trump, s.trumpMode), `run ${t}/${i}`);
      const card = { suit, rank: RANKS[Math.floor(rng() * 13)] };
      assert.equal(rules.isSecureWin(s, pid, card, s.trumpMode, s.trump), old.isSecureWin(pid, card, s.trumpMode, s.trump), `secure ${t}/${i}`);
      assert.equal(rules.partnerSignalWeight(s, pid, suit), old.partnerSignalWeight(pid, suit), `sig ${t}/${i}`);
      assert.equal(rules.partnerSignalWeight(s, pid, suit), old.partnerSignalWeight(pid, suit), `sig ${t}/${i}`);
    }
  }
});

// old inline AI trump-bid heuristic (index.html 1866-1887) reproduced verbatim as reference
function oldBid(h) {
  const SU = ['spades', 'hearts', 'diamonds', 'clubs'];
  const cv = (c) => { const o = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']; return o.indexOf(c.rank) + 1; };
  const counts = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  const midSum = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  const hasAce = { spades: false, hearts: false, diamonds: false, clubs: false };
  const hasKing = { spades: false, hearts: false, diamonds: false, clubs: false };
  for (const c of h) {
    counts[c.suit]++;
    if (c.rank === 'A') hasAce[c.suit] = true;
    else if (c.rank === 'K') { hasKing[c.suit] = true; midSum[c.suit] += cv(c); }
    else midSum[c.suit] += cv(c);
  }
  const scores = {};
  for (const s of SU) scores[s] = counts[s] * 5 + midSum[s] - (hasAce[s] ? 15 : 0) - (hasKing[s] ? 5 : 0);
  let best = 'spades', bs = -Infinity;
  for (const s of SU) if (scores[s] > bs) { bs = scores[s]; best = s; }
  return best;
}

// (trump-bid heuristic intentionally redesigned into TrumpScore â€” no old==new test;
// its new behavior is pinned in tests/engine.test.js)

oracleTest('makeDeck: 52 unique cards', () => {
  const d = rules.makeDeck();
  assert.equal(d.length, 52);
  assert.equal(new Set(d.map((c) => c.suit + c.rank)).size, 52);
});
