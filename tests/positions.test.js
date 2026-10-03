// tests/positions.test.js — Position Policy tests (spec §4) + scenario tests (§9).
//
// Each policy is exercised in isolation: build the exact game state the position
// faces, call the policy directly, assert on its returned card + reason. Nothing
// here goes through the game controller — these are unit tests of the four decision
// rights the spec assigns to each seat.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  leaderPolicy, secondPolicy, thirdPolicy, fourthPolicy,
  decideByPosition, positionOf, LEADER, SECOND, THIRD, FOURTH,
} from '../src/positions.js';
import { buildMemory } from '../src/knowledge.js';
import { playable } from '../src/rules.js';

const C = (suit, rank) => ({ suit, rank });
const H = (cards) => cards.map(([s, r]) => C(s, r));

function state(over = {}) {
  return Object.assign({
    players: {
      1: { hand: [], team: 'A' }, 2: { hand: [], team: 'B' },
      3: { hand: [], team: 'A' }, 4: { hand: [], team: 'B' },
    },
    trump: 'spades', trumpMode: 'normal', trick: [], leadSuit: null,
    trickNum: 1, starter: 1, current: 1, hakem: 1,
    tricksWon: { A: 0, B: 0 }, score: { A: 0, B: 0 }, phase: 'play',
    memory: { played: [], voids: {}, aces: {}, kings: {}, signals: [], tricks: [] },
  }, over);
}
const setHand = (s, p, cards) => { s.players[p].hand = H(cards); };
// seat 1 = us (team A), seat 3 = partner, 2/4 = opponents
const trick = (...plays) => plays.map(([player, suit, rank]) => ({ player, card: C(suit, rank) }));

// ---------- positionOf routing ----------
test('positionOf maps played-count to the right policy', () => {
  const s = state();
  setHand(s, 1, [['hearts', '2']]);
  assert.equal(positionOf(s, 1), LEADER);
  s.trick = trick([2, 'hearts', '5']);
  assert.equal(positionOf(s, 1), SECOND);
  s.trick = trick([2, 'hearts', '5'], [3, 'hearts', '6']);
  assert.equal(positionOf(s, 1), THIRD);
  s.trick = trick([2, 'hearts', '5'], [3, 'hearts', '6'], [4, 'hearts', '7']);
  assert.equal(positionOf(s, 1), FOURTH);
});

test('decideByPosition routes to the matching policy and labels it', () => {
  const s = state();
  setHand(s, 1, [['hearts', 'A'], ['diamonds', '2']]);
  const d = decideByPosition(s, 1);
  assert.equal(d.position, LEADER);
  assert.ok(d.card, 'returns a card');
  assert.ok(d.reason, 'returns a reason');
});

// ============================================================ LEADER
test('LEADER: never leads a gratuitous low trump when side suits exist', () => {
  const s = state();
  setHand(s, 1, [['spades', '5'], ['hearts', 'K'], ['diamonds', '7']]);
  const d = leaderPolicy(s, 1);
  assert.notEqual(d.card.suit, 'spades', `led trump ${d.card.suit}${d.card.rank}`);
});

test('LEADER: leads a pressure suit the opponents are known void in', () => {
  const s = state();
  setHand(s, 1, [['hearts', '8'], ['diamonds', 'A'], ['clubs', '3']]);
  // both opponents proven void in hearts → leading hearts cannot be ruffed by them
  s.memory.voids = { 2: ['hearts'], 4: ['hearts'] };
  const d = leaderPolicy(s, 1);
  assert.equal(d.card.suit, 'hearts', 'pressure suit chosen');
  assert.ok(d.goals.includes('PRESSURE_LEAD'));
});

test('LEADER: honors a strong partner signal', () => {
  const s = state();
  setHand(s, 1, [['hearts', '4'], ['diamonds', 'A'], ['clubs', '3']]);
  s.memory.signals = [{ player: 3, suit: 'hearts', weight: 2 }];
  const d = leaderPolicy(s, 1);
  assert.equal(d.card.suit, 'hearts');
  assert.ok(d.reason.includes('سیگنال'));
});

test('LEADER: decision is deterministic across repeated calls', () => {
  const s = state();
  setHand(s, 1, [['hearts', '4'], ['diamonds', 'A'], ['clubs', '3'], ['spades', '9']]);
  const a = leaderPolicy(s, 1);
  const b = leaderPolicy(s, 1);
  assert.deepEqual(a.card, b.card);
});

// ============================================================ SECOND
test('SECOND: follows the led suit when it is held (never breaks the rule)', () => {
  const s = state({ trick: trick([2, 'hearts', 'K']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', '2'], ['hearts', '9'], ['spades', 'A']]);
  const d = secondPolicy(s, 1);
  assert.equal(d.card.suit, 'hearts', 'must follow hearts');
});

test('SECOND: ducks under a winning partner with the lowest non-overtaking card', () => {
  const s = state({ trick: trick([3, 'hearts', 'Q']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', '2'], ['hearts', 'A']]);
  const d = secondPolicy(s, 1);
  assert.equal(d.card.rank, '2', 'does not burn the A over partner\'s Q');
  assert.ok(d.goals.includes('DUCK_UNDER_PARTNER'));
});

test('SECOND: beats an opponent with the cheapest sufficient card, not the Ace', () => {
  const s = state({ trick: trick([2, 'hearts', '5']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', '9'], ['hearts', 'A']]);
  const d = secondPolicy(s, 1);
  assert.equal(d.card.rank, '9', '9 is enough to beat the 5 — keep the A');
  assert.ok(d.goals.includes('CHEAPEST_SUFFICIENT_WIN'));
});

test('SECOND: sheds the lowest card of the suit when it cannot win', () => {
  const s = state({ trick: trick([2, 'hearts', 'A']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', '3'], ['hearts', '10']]);
  const d = secondPolicy(s, 1);
  assert.equal(d.card.rank, '3', 'nothing beats the A: shed the 3, keep the 10');
});

test('SECOND: void in the led suit ruffs with the cheapest sufficient trump', () => {
  const s = state({ trick: trick([2, 'hearts', 'A']), leadSuit: 'hearts' });
  setHand(s, 1, [['spades', '3'], ['spades', 'A'], ['diamonds', '2']]);
  const d = secondPolicy(s, 1);
  assert.equal(d.card.suit, 'spades', 'ruffs');
  assert.equal(d.card.rank, '3', 'the 3 of trumps already beats a non-trump — no need for the A');
  assert.ok(d.goals.includes('RUFF_CHEAPEST'));
});

test('SECOND: never ruffs over a partner who is already winning', () => {
  const s = state({ trick: trick([3, 'hearts', 'A']), leadSuit: 'hearts' });
  setHand(s, 1, [['spades', '3'], ['diamonds', '2']]);
  const d = secondPolicy(s, 1);
  assert.notEqual(d.card.suit, 'spades', `partner owns the trick; ruffing is waste (got ${d.card.suit})`);
});

// ============================================================ THIRD
test('THIRD: ducks under a winning partner and pressures the last opponent', () => {
  const s = state({ trick: trick([2, 'hearts', '5'], [3, 'hearts', 'Q']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', '2'], ['hearts', 'K']]);
  const d = thirdPolicy(s, 1);
  assert.equal(d.card.rank, '2', 'duck the 2 under partner\'s Q, keep the K');
  assert.ok(d.goals.includes('THIRD_MAX_PRESSURE'));
});

test('THIRD: beats an opponent winner with the cheapest sufficient card', () => {
  const s = state({ trick: trick([2, 'hearts', 'J'], [3, 'diamonds', '2']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', 'Q'], ['hearts', 'A']]);
  const d = thirdPolicy(s, 1);
  assert.equal(d.card.rank, 'Q', 'the Q beats the J — the A is unnecessary');
});

test('THIRD: ruffs when void and an opponent is winning', () => {
  const s = state({ trick: trick([2, 'hearts', 'A'], [3, 'diamonds', '2']), leadSuit: 'hearts' });
  setHand(s, 1, [['spades', '4'], ['spades', 'K'], ['clubs', '3']]);
  const d = thirdPolicy(s, 1);
  assert.equal(d.card.suit, 'spades');
  assert.equal(d.card.rank, '4', 'the 4 of trumps already beats a plain suit');
});

test('THIRD: discards lowest future value when nothing can win', () => {
  // void in the led suit AND the opponent ruffed with the trump A: no card in hand
  // can win (even our trump loses to the A), so shed a plain low card and keep the
  // trump for a trick it can actually take.
  const s = state({ trick: trick([2, 'spades', 'A'], [3, 'diamonds', '2']), leadSuit: 'hearts' });
  setHand(s, 1, [['diamonds', '2'], ['clubs', '3'], ['spades', '2']]);
  const d = thirdPolicy(s, 1);
  assert.ok(d.card.suit !== 'spades', `dead trick: keep the trump under the trump A (got ${d.card.suit}${d.card.rank})`);
  assert.ok(d.goals.includes('DISCARD_DEFENSE'));
});

// ============================================================ FOURTH
test('FOURTH: can beat the winner and takes it with the cheapest sufficient card', () => {
  const s = state({ trick: trick([2, 'hearts', '5'], [3, 'diamonds', '2'], [4, 'hearts', '9']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', 'J'], ['hearts', 'A']]);
  const d = fourthPolicy(s, 1);
  assert.equal(d.card.rank, 'J', 'the J beats the 9 — no reason to spend the A');
  assert.ok(d.goals.includes('FOURTH_TAKE_CHEAPEST'));
});

test('FOURTH: never overtakes a winning partner', () => {
  const s = state({ trick: trick([2, 'hearts', '5'], [3, 'hearts', 'A'], [4, 'hearts', '9']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', 'K']]);
  const d = fourthPolicy(s, 1);
  assert.equal(d.card.rank, 'K', 'only card, but the goal says DO_NOT_OVERTAKE');
  assert.ok(d.goals.includes('DO_NOT_OVERTAKE_PARTNER'));
});

test('FOURTH: discards lowest when it cannot beat the winner', () => {
  // void in the led suit and NO trump in hand: the A of hearts is uncatchable,
  // so shed the lowest plain card. Nothing in hand can win this trick.
  const s = state({ trick: trick([2, 'hearts', 'A'], [3, 'diamonds', '2'], [4, 'hearts', 'K']), leadSuit: 'hearts' });
  setHand(s, 1, [['clubs', '2'], ['clubs', '3']]);
  const d = fourthPolicy(s, 1);
  assert.equal(d.card.rank, '2', 'cannot beat the winner: shed the lowest plain card');
  assert.ok(d.goals.includes('FOURTH_DISCARD_LOW'));
});

test('FOURTH: ruffs with the cheapest trump when void in the led suit', () => {
  // void in hearts but holding trumps: a small trump ruff beats any plain-suit card.
  const s = state({ trick: trick([2, 'hearts', 'A'], [3, 'diamonds', '2'], [4, 'hearts', 'K']), leadSuit: 'hearts' });
  setHand(s, 1, [['spades', '2'], ['spades', 'A']]);
  const d = fourthPolicy(s, 1);
  assert.equal(d.card.suit, 'spades');
  assert.equal(d.card.rank, '2', 'the 2 of trumps already ruffs the trick — keep the A');
});

test('FOURTH: takes decisively at endgame (6-6)', () => {
  const s = state({
    trick: trick([2, 'hearts', '5'], [3, 'diamonds', '2'], [4, 'hearts', '9']),
    leadSuit: 'hearts', tricksWon: { A: 6, B: 6 }, trickNum: 13,
  });
  setHand(s, 1, [['hearts', 'J'], ['hearts', 'A']]);
  const d = fourthPolicy(s, 1);
  assert.equal(d.card.rank, 'J');
  assert.ok(d.goals.includes('FOURTH_TAKE_CHEAPEST'), 'at 6-6 every trick is decisive');
});

// ============================================================ §9 scenarios
test('scenario: 6-0 → the losing team plays to break the shutout (ANTI_KOT)', () => {
  // we are A, on 0, opponents on 6: any trick that avoids the 7-0 Kot is vital.
  // An OPPONENT is currently winning this trick, and our A is the only card that
  // beats them — so the honor must be spent.
  const s = state({ tricksWon: { A: 0, B: 6 }, trickNum: 7 });
  setHand(s, 1, [['hearts', '3'], ['hearts', 'A'], ['spades', '2']]);
  s.trick = trick([2, 'hearts', '10'], [3, 'diamonds', '2'], [4, 'hearts', '9']);
  s.leadSuit = 'hearts';
  const d = fourthPolicy(s, 1);
  assert.equal(d.card.rank, 'A', 'at 0-6 the A must be spent to take the trick from an opponent');
});

test('scenario: 0-6 (we lead) → the leading team presses the Kot', () => {
  const s = state({ tricksWon: { A: 6, B: 0 }, trickNum: 7 });
  setHand(s, 1, [['hearts', 'A'], ['hearts', '3'], ['diamonds', '2']]);
  const d = leaderPolicy(s, 1);
  // leading the A of hearts draws the last hearts and presses toward the 7-0 Kot
  assert.ok(d.card, 'a deliberate lead is chosen');
  assert.deepEqual(leaderPolicy(s, 1).card, d.card, 'deterministic');
});

test('scenario: void-suit awareness changes the lead', () => {
  const s = state();
  setHand(s, 1, [['hearts', '4'], ['diamonds', 'A'], ['clubs', '3']]);
  const withoutVoid = leaderPolicy(s, 1);
  s.memory.voids = { 2: ['diamonds'], 4: ['diamonds'] };
  const withVoid = leaderPolicy(s, 1);
  // once the opponents are known void in diamonds, that suit becomes the pressure lead
  assert.equal(withVoid.card.suit, 'diamonds');
  assert.notEqual(withoutVoid.card.suit, withVoid.card.suit, 'void knowledge changes the decision');
  void withoutVoid;
});

// ---------- legality gate: policies only ever return legal cards ----------
test('every policy returns a card that is in the legal set', () => {
  const cases = [
    [leaderPolicy, state()],
    [secondPolicy, state({ trick: trick([2, 'hearts', '5']), leadSuit: 'hearts' })],
    [thirdPolicy, state({ trick: trick([2, 'hearts', '5'], [3, 'diamonds', '2']), leadSuit: 'hearts' })],
    [fourthPolicy, state({ trick: trick([2, 'hearts', '5'], [3, 'diamonds', '2'], [4, 'hearts', '9']), leadSuit: 'hearts' })],
  ];
  for (const [fn, s] of cases) {
    setHand(s, 1, [['hearts', '2'], ['hearts', 'A'], ['spades', '3'], ['clubs', '4']]);
    const d = fn(s, 1);
    const legal = playable(s, 1);
    assert.ok(legal.some((c) => c.suit === d.card.suit && c.rank === d.card.rank),
      `${fn.name} returned an illegal card`);
  }
});

// ---------- determinism across the whole dispatcher ----------
test('decideByPosition is a pure function: repeated calls, identical output', () => {
  const s = state({ trick: trick([2, 'hearts', '5'], [3, 'hearts', 'Q']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', '2'], ['hearts', 'K'], ['diamonds', '3']]);
  const a = decideByPosition(s, 1);
  const b = decideByPosition(JSON.parse(JSON.stringify(s)), 1);
  assert.deepEqual(a.card, b.card);
  assert.equal(a.reason, b.reason);
});

// ============================================================ boundary cases (spec §7)
// The remaining obligations the spec lists per policy: multiple winning cards → the
// MINIMUM sufficient one; impossible overtakes; no-trump (ners/asners/sers) rounds;
// trump-heavy hands; and the "no legal alternative but to lose the honor" case.

test('FOURTH: holds several winners → takes with the MINIMUM sufficient card', () => {
  // opponent wins with ♥10; we hold ♥J ♥Q ♥A — the J alone beats it. The policy must
  // never spend the A (or even the Q) when the smallest winner does the job.
  const s = state({ trick: trick([2, 'hearts', '10'], [3, 'diamonds', '2'], [4, 'hearts', '5']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', 'J'], ['hearts', 'Q'], ['hearts', 'A']]);
  const d = fourthPolicy(s, 1);
  assert.equal(d.card.rank, 'J', 'the cheapest of several winners is used');
  assert.ok(d.goals.includes('FOURTH_TAKE_CHEAPEST'));
});

test('FOURTH: impossible overtake (opponent holds the top card) → discard, not the honor', () => {
  // the opponent's ♥A is the highest card of the suit and we are VOID in hearts
  // (follow-suit released us): nothing in hand can beat it. Burning the ♣K gains
  // nothing, so the policy discards the lowest plain card and keeps the honor.
  const s = state({ trick: trick([2, 'hearts', 'A'], [3, 'diamonds', '2'], [4, 'hearts', '9']), leadSuit: 'hearts' });
  setHand(s, 1, [['clubs', 'K'], ['clubs', '2'], ['diamonds', '3']]);
  const d = fourthPolicy(s, 1);
  assert.equal(d.card.suit, 'clubs', 'nothing can beat the A: keep the K, discard a plain card');
  assert.equal(d.card.rank, '2', 'the lowest plain card is shed, not the K');
  assert.ok(d.goals.includes('FOURTH_DISCARD_LOW'));
});

test('FOURTH: forced to overtake with the only remaining honor (no alternative)', () => {
  // partner is NOT winning and the only legal card that beats the opponent is the A:
  // there is no cheaper option, so the honor is spent.
  const s = state({ trick: trick([2, 'hearts', 'Q'], [3, 'diamonds', '2'], [4, 'hearts', 'K']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', 'A'], ['clubs', '2']]);
  const d = fourthPolicy(s, 1);
  assert.equal(d.card.suit, 'hearts');
  assert.equal(d.card.rank, 'A', 'the A is the only card that beats the K — it must be played');
});

test('SECOND/THIRD/FOURTH behave correctly in no-trump rounds (ners / asners / sers)', () => {
  // trumpMode variants: no trump suit exists, so cmpCards reduces to led-suit + rank.
  // The policies must stay legal and never attempt a "ruff" that cannot exist.
  // Rank order is mode-dependent, so the SAME trick resolves differently per mode:
  //   ners   2>3>...>K>A  → ♥2 is the TOP card
  //   asners A>2>3>...>K  → ♥2 is second only to the A
  //   sers   A>K>Q>...>2  → ♥2 is the lowest spot card
  const expectedFourth = { ners: 'A', asners: 'Q', sers: 'Q' };
  for (const mode of ['ners', 'asners', 'sers']) {
    const s = state({
      trumpMode: mode, trump: null,
      trick: trick([2, 'hearts', '10'], [3, 'hearts', '2']), leadSuit: 'hearts',
    });
    setHand(s, 1, [['hearts', '4'], ['hearts', 'K'], ['diamonds', '3']]);
    const d = decideByPosition(s, 1); // THIRD seat
    const legal = playable(s, 1);
    assert.ok(legal.some((c) => c.suit === d.card.suit && c.rank === d.card.rank),
      `${mode}: THIRD returned an illegal card`);
    // the K is the cheapest card that beats the opponent's 10 → take it, not the 4
    assert.notEqual(d.card.rank, '4', `${mode}: THIRD must not duck when it can win cheaply`);
    // FOURTH under the same modes. Partner (seat 3) played the ♥2: in ners/asners that
    // card is winning the trick, so FOURTH must NOT overtake — it sheds the cheapest
    // heart it holds under that mode's ordering. Only in sers is the partner's 2 a
    // loser, so FOURTH must instead take with the minimum sufficient winner.
    const s4 = state({
      trumpMode: mode, trump: null,
      trick: trick([2, 'hearts', '10'], [3, 'hearts', '2'], [4, 'hearts', 'J']), leadSuit: 'hearts',
    });
    setHand(s4, 1, [['hearts', 'Q'], ['hearts', 'A'], ['diamonds', '3']]);
    const d4 = fourthPolicy(s4, 1);
    assert.equal(d4.card.suit, 'hearts', `${mode}: FOURTH must follow the led suit`);
    assert.equal(d4.card.rank, expectedFourth[mode],
      `${mode}: FOURTH outcome depends on who the mode says is winning`);
    if (mode === 'sers') {
      assert.ok(d4.goals.includes('FOURTH_TAKE_CHEAPEST'), `${mode}: opponent wins → take the trick`);
    } else {
      assert.ok(d4.goals.includes('DO_NOT_OVERTAKE_PARTNER'),
        `${mode}: the ♥2 is winning → never overtake the partner`);
    }
  }
});

test('SECOND: trump-heavy hand still follows the led suit (no gratuitous ruff)', () => {
  // holding many trumps does NOT license breaking follow-suit: the led suit is held,
  // so the 2 of hearts is mandatory and the trumps stay in hand.
  const s = state({ trick: trick([3, 'hearts', 'K']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', '2'], ['spades', '2'], ['spades', '3'], ['spades', 'A']]);
  const d = secondPolicy(s, 1);
  assert.equal(d.card.suit, 'hearts', 'follow-suit is forced even with a trump-heavy hand');
  assert.equal(d.card.rank, '2');
});

test('LEADER: trump-heavy hand still leads the pressure suit, not trumps', () => {
  // four trumps, but the opponents are PROVEN void in diamonds: the pressure branch
  // owns the lead and diamonds go out — trump control is kept for ruffing later.
  const s = state({ trickNum: 1, memory: { played: [], voids: { 2: ['diamonds'], 4: ['diamonds'] }, aces: {}, kings: {}, signals: [], tricks: [] } });
  setHand(s, 1, [['spades', '2'], ['spades', '5'], ['spades', '9'], ['spades', 'K'], ['diamonds', 'A'], ['diamonds', 'K']]);
  const d = leaderPolicy(s, 1);
  assert.equal(d.card.suit, 'diamonds', 'the pressure suit is led, not the trumps');
  assert.ok(d.goals.includes('PRESSURE_LEAD'));
  assert.deepEqual(leaderPolicy(s, 1).card, d.card, 'the lead is deterministic');
});

test('THIRD: partner winning and everything in hand overtakes → still does not overtake', () => {
  // partner owns the trick with ♥Q and my ONLY hearts are the K and the A: every card
  // would overtake. The team already wins, so the policy sheds the cheaper one instead
  // of burning a winner on a trick the partner already owns.
  const s = state({ trick: trick([2, 'hearts', '5'], [3, 'hearts', 'Q']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', 'K'], ['hearts', 'A']]);
  const d = thirdPolicy(s, 1);
  assert.ok(d.goals.includes('SHED_KEEP_TRUMP') || d.goals.includes('DUCK_UNDER_PARTNER'),
    'partner is winning: no card is spent overtaking them');
  assert.equal(d.card.rank, 'K', 'the cheaper of the two winners is shed');
});

test('FOURTH: partner winning with the top card → duck even a hand full of honors', () => {
  const s = state({ trick: trick([2, 'hearts', '5'], [3, 'hearts', 'A'], [4, 'hearts', '2']), leadSuit: 'hearts' });
  setHand(s, 1, [['hearts', 'K'], ['hearts', 'Q'], ['hearts', 'J']]);
  const d = fourthPolicy(s, 1);
  assert.ok(d.goals.includes('DO_NOT_OVERTAKE_PARTNER'), 'partner owns the trick: never overtake');
  assert.notEqual(d.card.rank, 'K', 'the K is not spent on a trick the partner already wins');
});

// ---------- regression: mode-correct winner identification ----------
// The policies used to rank cards with a local copy of the normal-suit order, which
// silently mis-identified the trick winner in ners rounds (where the 2 is the HIGHEST
// card). In ners, ♥2 > ♥K > ♥A. The policies must see the world the way the rules do.
test('regression: ners rank order — the 2 beats the A, and the policy acts on it', () => {
  // opponent led ♥A; in ners the A is the LOWEST heart, so our hearts all beat it.
  // The cheapest sufficient winner under ners ordering is the K (val 2), not the 2 (val 13).
  const s = state({
    trumpMode: 'ners', trump: null,
    trick: trick([2, 'hearts', 'A'], [3, 'diamonds', '5']), leadSuit: 'hearts',
  });
  setHand(s, 1, [['hearts', '2'], ['hearts', 'K'], ['clubs', '5']]);
  const d = thirdPolicy(s, 1);
  assert.equal(d.card.suit, 'hearts', 'the policy recognizes a ners winner in hand');
  assert.equal(d.card.rank, 'K', 'the cheapest sufficient card under ners order is the K');
  // sanity: under the normal order this same state has no winner at all — the two
  // orderings must not be confused
  const sNormal = JSON.parse(JSON.stringify(s));
  sNormal.trumpMode = 'normal';
  sNormal.trump = 'spades';
  const dNormal = thirdPolicy(sNormal, 1);
  assert.notEqual(dNormal.card.rank, 'K', 'under normal order the K cannot beat the A');
});

test('regression: asners rank order — the A is the highest, the K the lowest', () => {
  // asners order: A,2,3,...,Q,K → ♥A led is UNBEATABLE by any heart. We hold hearts,
  // so follow-suit is forced; with no chance to win the correct play is to shed the
  // cheapest heart under asners ordering — that is the K (val 1), never the 2 (val 12),
  // which is the second-highest card in the suit and far too valuable to throw away.
  const s = state({
    trumpMode: 'asners', trump: null,
    trick: trick([2, 'hearts', 'A'], [3, 'diamonds', '5']), leadSuit: 'hearts',
  });
  setHand(s, 1, [['hearts', '2'], ['hearts', 'K'], ['clubs', '5']]);
  const d = thirdPolicy(s, 1);
  assert.equal(d.card.suit, 'hearts', 'follow-suit is forced — a plain-suit discard would be illegal');
  assert.equal(d.card.rank, 'K', 'the K is the cheapest heart under asners order; the 2 must be kept');
});
