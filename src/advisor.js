// src/advisor.js — Analysis + Coach. BOTH reuse the exact Decision Engine
// (decision.js) over the exact knowledge layer (knowledge.js). No second engine,
// no contradiction, no hindsight, zero side effects:
//   • gradeMove: reconstruct the decision-time view (cards played BEFORE that
//     trick's own plays are included only up to the moment of the move), so the
//     hidden cards that were still hidden are still unaccounted holders here.
//     The ACTUAL outcome is compared separately — outcome ≠ decision quality.
//   • coachHint: what the engine would play right now for seat pid, plus reason.
import { playable } from './rules.js';
import { decide, explain } from './decision.js';

// Build the state as it looked AT THE MOMENT of a recorded move.
// Gnow: current live state. entry: recorded trick entry (player, card, trickNum,
// position). We rewind memory to before that trick's plays from that position.
function decisionTimeView(Gnow, trickSnapshot, position) {
  // trickSnapshot: a deep copy of state as it was at START of that trick
  // (trick=[], leadSuit=null, memory = played up to before this trick)
  const s = JSON.parse(JSON.stringify(trickSnapshot));
  for (let i = 0; i < position; i++) {
    const e = s.trickStartEntries[i];
    // replay earlier plays of this trick exactly as doPlayCard does — including
    // REMOVING the played card from that seat's hand, so the viewer's decision-time
    // hand is the hand they actually had then
    const h = s.players[e.player].hand;
    const hi = h.findIndex((x) => x.suit === e.card.suit && x.rank === e.card.rank);
    if (hi > -1) h.splice(hi, 1);
    s.trick.push({ player: e.player, card: e.card });
    if (s.trick.length === 1) s.leadSuit = e.card.suit;
    s.memory.played.push({ ...e.card });
    if (s.leadSuit && e.card.suit !== s.leadSuit) {
      if (!s.memory.voids[e.player]) s.memory.voids[e.player] = [];
      if (!s.memory.voids[e.player].includes(s.leadSuit)) s.memory.voids[e.player].push(s.leadSuit);
    }
  }
  delete s.trickStartEntries;
  return s;
}

// gradeMove compares the HUMAN's recorded choice against the engine's ranking at
// decision time. quality: excellent / good / improvable / mistake.
export function gradeMove(Gnow, trickSnapshots, trickNum, position, pid, playedCard) {
  const snap = trickSnapshots[trickNum];
  if (!snap) return null;
  const s = decisionTimeView(Gnow, snap, position);
  const legal = playable(s, pid);
  const chosen = legal.find((c) => c.suit === playedCard.suit && c.rank === playedCard.rank);
  if (!chosen) return null;
  const d = decide(s, pid, () => 0); // deterministic: no variation in grading
  if (!d) return null;
  const top = d.top;
  const pick = d.ranked.find((x) => x.card.suit === chosen.suit && x.card.rank === chosen.rank);
  const gap = top.score - (pick ? pick.score : -Infinity);
  let quality;
  if (pick && pick.card === top.card || gap <= 0.0001) quality = 'excellent';
  else if (gap <= 1.5) quality = 'good';
  else if (gap <= 4) quality = 'improvable';
  else quality = 'mistake';
  // the better move, if any, and the reason from decision-time info ONLY
  const better = quality === 'excellent' ? null : top;
  // §8 Tactic recognition: the goals the chosen move carries, computed by the same
  // Decision Engine over the same decision-time view — no hindsight, no second
  // engine. This is how the Analyzer sees "♥3 under partner's ♥Q" as a deliberate
  // THIRD_SEAT_MAX_PRESSURE / PARTNER_CONTINUATION_SIGNAL rather than a low-card dump.
  const tactics = (pick ? pick.goals : []).filter((g) => TACTIC_GOALS.has(g));
  return {
    quality, gap,
    played: playedCard,
    better: better ? better.card : null,
    reason: better ? explain(top) : explain(pick),
    tactics,
    tacticLabels: tactics.map((g) => TACTIC_LABELS[g] || g),
    outcomeNote: null, // filled by the UI with the ACTUAL trick winner — kept separate from decision quality
  };
}

// §9 goals surfaced as named tactics in Analysis (subset of decision.js GOALS —
// the positional/tactical ones worth showing next to a graded move).
const TACTIC_GOALS = new Set([
  'THIRD_SEAT_MAX_PRESSURE', 'FORCE_OPPONENT_PREMIUM_RESPONSE',
  'ESTABLISH_SECONDARY_HONOR', 'TRUMP_CONTROL', 'ANTI_KOT',
  'PARTNER_CONTINUATION_SIGNAL', 'FORCE_EXPENSIVE_RESPONSE',
]);
const TACTIC_LABELS = {
  THIRD_SEAT_MAX_PRESSURE: 'فشار نفر سوم',
  FORCE_OPPONENT_PREMIUM_RESPONSE: 'مجبور کردن حریف به خرج A/K',
  ESTABLISH_SECONDARY_HONOR: 'برقراری جایزهٔ دوم (K/Q بعداً)',
  TRUMP_CONTROL: 'حفظ کنترل حکم',
  ANTI_KOT: 'استراتژی ضد کت',
  PARTNER_CONTINUATION_SIGNAL: 'سیگنال ادامه به یار',
  FORCE_EXPENSIVE_RESPONSE: 'پاسخ گران برای حریف',
};

// coach: current best suggestion + optional second. Reads nothing but observables;
// touches no state; the player may ignore it entirely. decide() is a pure function
// of the state (verified in tests/determinism.test.js + tests/observability.test.js),
// so the state is passed by reference — cloning it here would needlessly materialize
// the OTHER seats' hidden hands into a copy the engine never reads (spec §8).
export function coachHint(Gnow, pid) {
  const d = decide(Gnow, pid);
  if (!d) return null;
  const second = d.ranked[1] && d.ranked[1].score >= d.top.score - 3 ? d.ranked[1] : null;
  return {
    best: d.top.card, bestReason: explain(d.top),
    alt: second ? second.card : null, altReason: second ? explain(second) : null,
  };
}

// Snapshot the full observable state at the START of a trick so that Analysis can
// later re-grade each seat's move with ONLY the information that seat had then.
export function snapshotTrickStart(G) {
  return {
    players: JSON.parse(JSON.stringify(G.players)),
    trump: G.trump, trumpMode: G.trumpMode, trickNum: G.trickNum,
    starter: G.starter, tricksWon: { ...G.tricksWon },
    score: { ...G.score }, hakem: G.hakem,
    memory: JSON.parse(JSON.stringify(G.memory)),
    trick: [], leadSuit: null,
    trickStartEntries: [],
  };
}

// record an entry into the snapshot as plays happen (positions 0..3)
export function appendToSnapshot(snap, entry) {
  snap.trickStartEntries.push({ player: entry.player, card: entry.card });
}
