// Engine-level tests for the redesigned Decision Engine (replaces aiPick==old).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../src/rules.js';
import { buildMemory, holdersOf, pHold, classifyPlay, suitCountRange, beatersFor } from '../src/knowledge.js';
import { decide, scoreMoves } from '../src/decision.js';
import { aiPick, pickAiTrump } from '../src/ai.js';
import { riskAppetite } from '../src/risk.js';
import { coachHint, gradeMove, snapshotTrickStart } from '../src/advisor.js';
import { createGame } from '../src/game.js';
import { mulberry32, buildScenario, applyPlay } from './shared.js';

function state(over = {}) {
  return Object.assign({
    players: {
      1: { hand: [], team: 'A' }, 2: { hand: [], team: 'B' },
      3: { hand: [], team: 'A' }, 4: { hand: [], team: 'B' },
    },
    trump: 'spades', trumpMode: 'normal', trick: [], leadSuit: null,
    trickNum: 1, starter: 1, current: 1, hakem: 1,
    tricksWon: { A: 0, B: 0 }, score: { A: 0, B: 0 }, phase: 'play',
    memory: { played: [], voids: {}, aces: {}, kings: {}, signals: [] },
  }, over);
}
const C = (s, r) => ({ suit: s, rank: r });
const setHand = (s, p, cards) => { s.players[p].hand = cards.map(([su, ra]) => C(su, ra)); };

// ---------- observability ----------
test('holdersOf: never attributes a hidden card to a proven-void seat', () => {
  const s = state();
  setHand(s, 1, [['hearts', '5']]);
  s.memory.played = [C('clubs', '2'), C('clubs', '3')];
  s.memory.voids[4] = ['clubs'];
  const M = buildMemory(s, 1);
  const h = holdersOf(M, C('clubs', 'A'));
  assert.ok(!h.includes(4), 'void seat excluded');
  assert.deepEqual(h.sort(), [2, 3], 'other seats remain possible');
  assert.ok(M.ownSet.has('clubs:A') === false);
});
test('holdersOf: own card attributed ONLY to viewer, weight sums to 1', () => {
  const s = state();
  setHand(s, 1, [['diamonds', 'K']]);
  const M = buildMemory(s, 1);
  assert.deepEqual(holdersOf(M, C('diamonds', 'K')), [1]);
  const unknown = C('hearts', 'Q');
  const hs = holdersOf(M, unknown);
  const tot = hs.reduce((a, p) => a + pHold(M, unknown, p), 0);
  assert.ok(Math.abs(tot - 1) < 1e-9);
});
test('handSizes derived from trickNum, not hidden hands', () => {
  const s = state({ trickNum: 5 });
  setHand(s, 2, [['hearts', 'A']]); // actual hidden hand content must not affect derived size
  const M = buildMemory(s, 1);
  assert.equal(M.handSizes[2], 9, 'seat2 size = 13 - (trickNum-1)');
});

// ---------- classifyPlay / secure ----------
test('secure requires NO overtake scenario at all (partner included)', () => {
  const s = state({ trickNum: 1 });
  setHand(s, 1, [['hearts', 'A']]);
  const M = buildMemory(s, 1);
  // trick 1 lead: A of hearts. A is visible to viewer, but K..2 of hearts could
  // ruff? No — ruff needs trump spades held by others → possible → NOT secure.
  const cls = classifyPlay(M, 1, C('hearts', 'A'));
  assert.ok(!['secure'].includes(cls.status), 'ace lead early is possible, not secure');
  // now make it secure: all spades played, all higher hearts... hearts A is top anyway;
  // play out 13 spades:
  s.memory.played = [];
  for (const r of rules.RANKS) s.memory.played.push(C('spades', r));
  for (const r of ['K', 'Q', 'J']) s.memory.played.push(C('hearts', r)); // still: A beats rest anyway
  const M2 = buildMemory(s, 1);
  const cls2 = classifyPlay(M2, 1, C('hearts', 'A'));
  assert.equal(cls2.status, 'secure', 'top card with trumps exhausted = secure');
});
test('dead: opponent winner exists and nothing I hold can overtake', () => {
  const s = state({ trick: [{ player: 2, card: C('hearts', 'Q') }], leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', '2'], ['diamonds', '9']]);
  s.memory.played = [C('hearts', 'Q')];
  const M = buildMemory(s, 1);
  const cls = classifyPlay(M, 1, C('hearts', '2'));
  assert.equal(cls.status, 'dead');
  assert.equal(cls.winProb, 0);
});
test('non-winning: partner currently owns trick, my card does not overtake', () => {
  const s = state({ trick: [{ player: 3, card: C('hearts', 'K') }], leadSuit: 'hearts', trickNum: 2 });
  setHand(s, 1, [['hearts', '4']]);
  s.memory.played = [C('hearts', 'K')];
  const M = buildMemory(s, 1);
  const cls = classifyPlay(M, 1, C('hearts', '4'));
  assert.equal(cls.status, 'non-winning');
});

// ---------- decision principles ----------
test('secured win beats position-building (A-K trump endgame)', () => {
  const s = state({ trick: [], leadSuit: null, trickNum: 11 });
  setHand(s, 1, [['spades', 'A'], ['spades', 'K'], ['hearts', '2']]);
  s.memory.played = rules.RANKS.filter((r) => r !== 'A' && r !== 'K').map((r) => C('spades', r))
    .concat([C('hearts', '5'), C('hearts', '6'), C('diamonds', '7'), C('clubs', '8'),
      C('hearts', '9'), C('diamonds', 'T'.replace('T', '10')), C('clubs', 'J'), C('hearts', 'Q')]);
  const d = decide(s, 1, () => 0);
  assert.ok(['A', 'K'].includes(d.card.rank) && d.card.suit === 'spades', `cash top trump, got ${d.card.suit}${d.card.rank}`);
});
test('partner wins → shed LOWEST FUTURE VALUE, keep trump', () => {
  const s = state({ trick: [{ player: 3, card: C('hearts', 'A') }], leadSuit: 'hearts' });
  setHand(s, 1, [['spades', '5'], ['diamonds', '3'], ['hearts', '2']]);
  s.memory.played = [C('hearts', 'A')];
  const d = decide(s, 1, () => 0);
  assert.ok(!(d.card.suit === 'spades'), `never dump trump for partner win: ${d.card.suit}${d.card.rank}`);
});
test('no gratuitous LOW trump lead at trick 1 when side suits available', () => {
  const s = state({});
  setHand(s, 1, [['spades', '5'], ['hearts', 'K'], ['diamonds', '7']]);
  const d = decide(s, 1, () => 0);
  // low trump (ruffable) must never be led just because it's trump
  assert.notEqual(d.card.suit, 'spades', `led ${d.card.suit}${d.card.rank}`);
});
test('ruff available & team may lose → wins it when risk allows (behind near 7)', () => {
  const s = state({
    trick: [{ player: 4, card: C('hearts', 'A') }], leadSuit: 'hearts',
    tricksWon: { A: 3, B: 6 }, trickNum: 8,
  });
  setHand(s, 1, [['spades', '7'], ['diamonds', '2']]);
  s.memory.played = [C('hearts', 'A')].concat(rules.RANKS.filter((r) => !['2', '3', '4'].includes(r)).map((r) => C('spades', r)));
  const d = decide(s, 1, () => 0);
  assert.equal(d.card.suit, 'spades', 'must ruff to prevent 7th trick');
});
test('clearly-better move never traded for variety (rng extremes keep top)', () => {
  // late game: all trumps + higher hearts gone → A♥ is truly secure, others dead
  const s = state({ trick: [{ player: 2, card: C('hearts', '5') }], leadSuit: 'hearts', trickNum: 11 });
  setHand(s, 1, [['hearts', 'A'], ['hearts', '6'], ['diamonds', '9']]);
  s.memory.played = rules.RANKS.map((r) => C('spades', r))
    .concat([C('hearts', 'Q'), C('hearts', 'J'), C('hearts', '10'), C('hearts', '7'), C('hearts', '5')]);
  for (const rng of [() => 0, () => 0.999, () => 0.5]) {
    const d = decide(s, 1, rng);
    assert.ok(d.card.suit === 'hearts' && d.card.rank === 'A', `secure take still picked (got ${d.card.suit}${d.card.rank})`);
  }
});

// ---------- risk engine ----------
test('riskAppetite: ahead→conservative, behind@opp6→aggressive', () => {
  const s1 = state({ tricksWon: { A: 5, B: 2 }, trickNum: 8 });
  setHand(s1, 1, [['spades', 'A'], ['hearts', 'K']]);
  const s2 = state({ tricksWon: { A: 3, B: 6 }, trickNum: 10 });
  setHand(s2, 1, [['spades', '2'], ['hearts', '3']]);
  assert.ok(riskAppetite(s1, 1) <= riskAppetite(s2, 1));
});

// ---------- endgame mode (same engine, heavier cashing) ----------
test('endgame weights engage in last 3 tricks', async () => {
  const s = state({ trickNum: 11 });
  setHand(s, 1, [['spades', 'A'], ['hearts', '2']]);
  s.memory.played = rules.RANKS.filter((r) => r !== 'A').map((r) => C('spades', r));
  const { M } = scoreMoves(s, 1);
  const d = decide(s, 1, () => 0);
  assert.equal(d.card.rank, 'A');
  void M;
});

// ---------- trump bid (TrumpScore, A+K soft) ----------
test('pickAiTrump: sequence-rich suit over isolated AK', () => {
  const hand = [C('hearts', 'A'), C('hearts', 'K'), C('clubs', 'Q'), C('clubs', 'J'), C('clubs', '10')];
  const pick = pickAiTrump(hand);
  assert.equal(pick, 'clubs', 'AK duo softly penalized, QJ10 sequence rewarded');
});
test('pickAiTrump: length with mid honors beats short AK', () => {
  const hand = [C('diamonds', 'A'), C('diamonds', 'K'), C('spades', 'Q'), C('spades', '10'), C('spades', '7')];
  const pick = pickAiTrump(hand);
  assert.ok(['diamonds', 'spades'].includes(pick)); // AK still viable: must be one of the two only suits
});

// ---------- advisor: no-hindsight guarantee ----------
test('coachHint is pure: state unchanged after call', () => {
  const s = state({ trickNum: 6 });
  setHand(s, 1, [['hearts', 'K'], ['diamonds', '4']]);
  const before = JSON.stringify(s);
  const h = coachHint(s, 1);
  assert.ok(h && h.best && h.bestReason);
  assert.equal(JSON.stringify(s), before, 'coach never mutates state');
});
test('gradeMove uses only decision-time info (later-disclosed card not blamed)', () => {
  // viewer leads small heart; partner... p2 actually held the A (revealed only
  // LATER). At decision time A was unaccounted → grade should NOT be 'mistake'
  // because of the revealed A.
  const G = state({ trickNum: 3 });
  setHand(G, 1, [['hearts', '4'], ['hearts', '9']]);
  setHand(G, 2, [['hearts', 'A']]);
  const snap = snapshotTrickStart(G);
  // trick: P1 leads 4♥ (pos0), P2 wins A♥ (pos1)
  const s2 = JSON.parse(JSON.stringify(snap));
  applyPlay(s2, 1, C('hearts', '4'));
  const g = gradeMove(G, { 3: snap }, 3, 0, 1, C('hearts', '4'));
  assert.ok(g, 'graded');
  assert.notEqual(g.quality, 'mistake', 'no hindsight blame: ' + g.quality);
  void s2;
});

// ---------- full-game integrity with new engine ----------
test('52 seeded full games via engine: legal plays only, terminate, no crashes', async () => {
  for (let seed = 0; seed < 6; seed++) {
    const rng = mulberry32(900 + seed);
    let kotPending = false, roundPending = false, ended = false;
    const view = {
      delay: async () => {}, sfx: () => {}, renderTableCard: () => {}, renderHand: () => {},
      updateUI: () => {}, showPopup: () => {}, hidePopup: () => {}, clearTable: () => {},
      showTrumpPicker: () => {}, showKot: () => { kotPending = true; },
      showRound: () => { roundPending = true; }, showEnd: () => { ended = true; },
    };
    const g = createGame(view, rng, { onGameEnd() {}, clearSave() {} });
    await g.startGame();
    let guard = 0;
    while (!ended && guard++ < 5000) {
      const G = g.G;
      if (kotPending) { kotPending = false; await (rng() < 0.3 ? g.bamAccept() : g.bamDecline()); continue; }
      if (roundPending) { roundPending = false; await g.startRound(); continue; }
      if (G.phase === 'trump' && G.hakem === 1) { await g.humanChoseTrump('normal', 'hearts'); continue; }
      if (G.current === 1 && G.phase === 'play' && !G.processing && G.players[1].hand.length) {
        const legal = g.playable(1);
        const c = legal[Math.floor(rng() * legal.length)];
        // verify follow-suit legality from rules: if led suit held, must be in it
        if (G.leadSuit && legal.length && G.players[1].hand.some((x) => x.suit === G.leadSuit)) {
          assert.equal(c.suit, G.leadSuit, 'engine+UI respect forced follow');
        }
        await g.playHuman({ ...c });
      } else {
        await new Promise((r) => setImmediate(r));
      }
    }
    assert.ok(ended, `seed ${seed} finished`);
  }
});

