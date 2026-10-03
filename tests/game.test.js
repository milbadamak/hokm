import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game.js';
import { SUITS } from '../src/rules.js';
import { mulberry32 } from './shared.js';

function makeView() {
  const v = {
    pendingKot: false, pendingRound: false, ended: null,
    delay: async () => {}, sfx: () => {},
    renderTableCard: () => {}, renderHand: () => {}, updateUI: () => {},
    showPopup: () => {}, hidePopup: () => {}, clearTable: () => {},
    showTrumpPicker: () => {},
    showKot: () => { v.pendingKot = true; },
    showRound: () => { v.pendingRound = true; },
    showEnd: (title, msg, w) => { v.ended = { title, w }; },
  };
  return v;
}

const autoStorage = () => ({ onGameEnd() {}, clearSave() {} });

// A view that records the complete play-by-play: every card played, every trick won,
// every Kot/round/end event. Two runs from the same seed must produce identical logs.
function makeLoggingView() {
  const v = {
    log: [],
    pendingKot: false, pendingRound: false, ended: null,
    delay: async () => {}, sfx: () => {},
    renderTableCard: (pid, c) => { v.log.push(['play', pid, c.suit, c.rank]); },
    renderHand: () => {}, updateUI: () => {},
    showPopup: (t) => { v.log.push(['trick', t]); },
    hidePopup: () => {}, clearTable: () => {},
    showTrumpPicker: () => {},
    showKot: () => { v.log.push(['kot']); v.pendingKot = true; },
    showRound: (title) => { v.log.push(['round', title]); v.pendingRound = true; },
    showEnd: (title, msg, w) => { v.log.push(['end', w]); v.ended = { title, w }; },
  };
  return v;
}

// Drive one full game through the LIVE game controller (createGame) with a seeded RNG:
// the human's trump pick, card choice and bam decision all draw from the same rng, so
// the whole match — shuffle, deal, hakem, every AI and human play, kot/bam — is a pure
// function of the seed (spec §4B/§5).
async function playSeededGame(seed) {
  const rng = mulberry32(seed);
  const view = makeLoggingView();
  const g = createGame(view, rng, autoStorage());
  await g.startGame();
  let guard = 0;
  while (!view.ended && guard++ < 5000) {
    const G = g.G;
    if (view.pendingKot) {
      view.pendingKot = false;
      if (rng() < 0.3) { view.log.push(['bam', 'accept']); await g.bamAccept(); }
      else { view.log.push(['bam', 'decline']); await g.bamDecline(); }
    } else if (view.pendingRound) {
      view.pendingRound = false;
      await g.startRound();
    } else if (G.phase === 'trump' && G.hakem === 1) {
      const pick = SUITS[Math.floor(rng() * 4)];
      view.log.push(['trump', pick]);
      await g.humanChoseTrump('normal', pick);
    } else if (G.phase === 'play' && G.current === 1 && !G.processing) {
      const can = g.playable(1);
      if (!can.length) break;
      await g.playHuman({ ...can[Math.floor(rng() * can.length)] });
    } else {
      await new Promise((r) => setImmediate(r)); // let the async AI cascade progress
    }
  }
  return { log: view.log, ended: view.ended, score: { ...g.G.score } };
}

test('full seeded games terminate with consistent outcome', async () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const rng = mulberry32(seed);
    const view = makeView();
    const g = createGame(view, rng, autoStorage());
    await g.startGame();
    let guard = 0;
    while (!view.ended && guard++ < 5000) {
      const G = g.G;
      if (view.pendingKot) {
        view.pendingKot = false;
        rng() < 0.3 ? await g.bamAccept() : await g.bamDecline();
      } else if (view.pendingRound) {
        view.pendingRound = false;
        await g.startRound();
      } else if (G.phase === 'trump' && G.hakem === 1) {
        await g.humanChoseTrump('normal', SUITS[Math.floor(rng() * 4)]);
      } else if (G.phase === 'play' && G.current === 1 && !G.processing) {
        const can = g.playable(1);
        assert.ok(can.length, 'human always has a card');
        await g.playHuman({ ...can[Math.floor(rng() * can.length)] });
      } else {
        await new Promise((r) => setImmediate(r)); // let async AI cascade progress
      }
    }
    assert.ok(view.ended, `seed ${seed}: game reached end`);
    assert.ok(['A', 'B'].includes(view.ended.w));
    assert.ok(g.G.score.A >= 7 || g.G.score.B >= 7, `seed ${seed}: winner reached 7`);
  }
});

test('deal distributes a full 52-card deck', async () => {
  const rng = mulberry32(9);
  const view = makeView();
  const g = createGame(view, rng, autoStorage());
  g.G.hakem = 3;
  await g.startRound();
  const all = [...g.G.players[1].hand, ...g.G.players[2].hand, ...g.G.players[3].hand, ...g.G.players[4].hand, ...g.G.memory.played];
  assert.equal(all.length, 52);
  assert.equal(new Set(all.map((c) => c.suit + c.rank)).size, 52);
  assert.equal(g.G.phase, 'play');
});

test('kot at 7-0 for declarer team scores 2; non-declarer 3', async () => {
  const view = makeView();
  const g = createGame(view, mulberry32(1), autoStorage());
  const G = g.G;
  G.hakem = 1; G.phase = 'play'; G.starter = 1;
  Object.assign(G, { trickNum: 6, tricksWon: { A: 6, B: 0 }, trumpMode: 'normal', trump: 'spades' });
  G.trick = [
    { player: 1, card: { suit: 'spades', rank: 'A' }, necessary: false, recommended: null },
    { player: 2, card: { suit: 'hearts', rank: '2' }, necessary: false, recommended: null },
    { player: 3, card: { suit: 'hearts', rank: '3' }, necessary: false, recommended: null },
    { player: 4, card: { suit: 'hearts', rank: '4' }, necessary: false, recommended: null },
  ];
  G.leadSuit = 'spades';
  await g.endTrick();
  assert.equal(G.kotTeam, 'A');
  assert.equal(G.kotPoints, 2);
  assert.equal(view.pendingKot, true);
  await g.bamDecline();
  assert.equal(G.score.A, 2);
  assert.equal(view.pendingRound, true);
});

// ---------- §5 replay through the live controller ----------
test('a seeded game replays byte-identically through the live game controller (10x)', async () => {
  const seed = 11;
  const first = JSON.stringify(await playSeededGame(seed));
  assert.ok(first.includes('["end"'), 'the game reached an end event');
  for (let i = 0; i < 10; i++) {
    const again = JSON.stringify(await playSeededGame(seed));
    assert.equal(again, first, `replay ${i} of seed ${seed} diverged from the first`);
  }
});

test('several seeds each replay identically through the controller (3x each)', async () => {
  for (const seed of [21, 22, 23, 24, 25]) {
    const first = JSON.stringify(await playSeededGame(seed));
    for (let i = 0; i < 3; i++) {
      assert.equal(JSON.stringify(await playSeededGame(seed)), first,
        `seed ${seed} did not replay identically`);
    }
  }
});
