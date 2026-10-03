// src/positions.js — Position Policies (spec §4).
//
// One INDEPENDENT, individually testable policy per trick position. The position is
// the number of cards already on the table when the seat acts:
//
//   LEADER  (0 played) — chooses the lead suit; sets the agenda for the trick
//   SECOND  (1 played) — must follow if able; otherwise defends or ruffs
//   THIRD   (2 played) — middle hand: pressure or discard, partner-aware
//   FOURTH  (3 played) — last hand: knows exactly who is winning and what beats it
//
// Every policy is a pure function (state, pid) -> { card, reason, ... } reading only
// the knowledge layer. They never consult hidden cards and contain NO randomness
// (§7): same state in, same card out, forever. The shared scoring from decision.js
// is the backbone; each policy applies its positional constraints on top of it.
//
// Decision rights each policy OWNS (tested individually in tests/positions.test.js):
//   LEADER  : which suit to lead, trump included, from void/signal/pressure facts
//   SECOND  : follow-suit is forced; the choice is only WHICH card of the suit,
//             or — when void — ruff vs shed
//   THIRD   : overtaking partner vs ducking; forcing the 4th seat to pay
//   FOURTH  : "can I beat the current winner?" — if yes, take or duck deliberately;
//             if no, discard the card with the lowest future value
import { playable, cmpCards, cardVal, SYMBOLS } from './rules.js';
import { buildMemory, classifyPlay, stillToAct, beatersFor, ckey } from './knowledge.js';
import { scoreMoves, explain } from './decision.js';

export const LEADER = 'LEADER';
export const SECOND = 'SECOND';
export const THIRD = 'THIRD';
export const FOURTH = 'FOURTH';

// Position of `pid` within the current trick: the count of cards already played
// before this seat acts. Derived purely from s.trick (observable).
export function positionOf(s, pid) {
  const n = s.trick.filter((t) => t.player !== pid).length;
  return [LEADER, SECOND, THIRD, FOURTH][n] || LEADER;
}

// ---------- shared helpers ----------

// Card comparison goes through the single rules.cmpCards implementation. A local
// mirror used to live here and silently diverged in ners/asners rounds (it ranked
// cards by the normal-suit order, so the policies mis-identified the trick winner
// whenever the round was not played with the normal trump order). One source of truth.
function winnerOfTrick(M) {
  if (!M.trick.length) return null;
  let w = M.trick[0];
  for (const t of M.trick.slice(1)) {
    if (cmpCards(t.card, w.card, M.leadSuit, M.mode, M.trump) > 0) w = t;
  }
  return w;
}

// Mode-correct card value (rank order flips in ners/asners). Every "cheapest" /
// "lowest" decision in the policies must use this, not raw rank order.
const valOf = (M, c) => cardVal(c, M.mode);

// Does card c beat the current winning card, under led-suit + trump rules?
function beats(M, c, winnerCard) {
  return cmpCards(c, winnerCard, M.leadSuit, M.mode, M.trump) > 0;
}

// Cheapest card of `cards` that still beats `winnerCard` (a FOURTH/THIRD staple:
// take the trick with the smallest sufficient card, never waste an honor).
function cheapestBeater(M, cards, winnerCard) {
  return cards
    .filter((c) => beats(M, c, winnerCard))
    .sort((a, b) => valOf(M, a) - valOf(M, b))[0] || null;
}

// Human-readable card, e.g. "♠Q".
const nm = (c) => `${SYMBOLS[c.suit]}${c.rank}`;

// ===========================================================================
// LEADER — first to act. Owns the lead-suit decision.
// ===========================================================================
// Obligations (spec):
//   • picks the lead suit deliberately (never a random card)
//   • weighs trump: leading trump is only done to draw the opponents' trumps or to
//     press a known void — never gratuitously
//   • uses played cards, known voids and partner signals (knowledge layer only)
// Strategy: prefer a suit we hold LENGTH in where at least one opponent is known
// void (pure pressure: the trick cannot be ruffed by that opponent, and partner may
// still support); avoid leading a bare high card when a lower card of the same suit
// establishes it. Fallback: the engine's deterministic ranked list.
export function leaderPolicy(s, pid) {
  const { scored, M } = scoreMoves(s, pid);
  if (!scored.length) return null;
  const opponents = M.opponentsOf(pid);

  // Pressure suit: a non-trump suit in hand where some opponent is proven void.
  // Leading it can never be ruffed by that opponent and forces them to spend.
  const pressure = [];
  for (const c of M.own) {
    if (M.mode === 'normal' && c.suit === M.trump) continue;
    if (pressure.some((x) => x.suit === c.suit)) continue;
    if (opponents.some((p) => M.voids[p].includes(c.suit))) pressure.push(c);
  }
  if (pressure.length) {
    // highest-scoring card among pressure suits (scoreMoves already credits
    // pressureBonus; this guarantees the lead stays in a pressure suit)
    const inPressure = scored.filter((m) => pressure.some((p) => p.suit === m.card.suit));
    if (inPressure.length) {
      const pick = inPressure[0];
      return ok(pick, `lead ${nm(pick.card)} — حریف در این خال void شده و نمی‌تواند برش بزند`, 'PRESSURE_LEAD');
    }
  }

  // Partner signal: partner previously signalled strength in a suit.
  for (const m of scored) {
    const sig = M.signals.filter((g) => g.player === M.partnerOf(pid) && g.suit === m.card.suit)
      .reduce((a, g) => a + g.weight, 0);
    if (sig >= 2 && !(M.mode === 'normal' && m.card.suit === M.trump)) {
      return ok(m, `lead ${nm(m.card)} — سیگنال قوی یار در ${SYMBOLS[m.card.suit]}`, 'PARTNER_SIGNAL_LEAD');
    }
  }

  // No pressure and no signal: trust the engine's deterministic ranking. The engine
  // already penalizes gratuitous trump leads and preserves secondary honors.
  const pick = scored[0];
  return ok(pick, explain(pick), rankedGoals(pick));
}

// ===========================================================================
// SECOND — one card on the table.
// ===========================================================================
// Obligations (spec):
//   • if the led suit is held, MUST follow it (rules.playable already forces this;
//     the policy only ever sees legal cards)
//   • when void, the choice is strategic — not "dump the cheapest card": ruff when
//     the trick is worth taking or the team must stop the opponents, otherwise shed
//     the card with the lowest future value while keeping trump
export function secondPolicy(s, pid) {
  const { scored, M } = scoreMoves(s, pid);
  if (!scored.length) return null;
  const legal = playable(s, pid);
  const hasSuit = M.leadSuit && legal.some((c) => c.suit === M.leadSuit);
  const w = winnerOfTrick(M);

  // --- Case 1: must follow the led suit. Which card of the suit? ---
  if (hasSuit) {
    const inSuit = legal.filter((c) => c.suit === M.leadSuit);
    // If partner led and is still winning, ride along with the lowest card that
    // does not overtake partner (never burn an honor needlessly).
    if (w && M.team(w.player) === M.team(pid) && inSuit.length > 1) {
      const under = inSuit.filter((c) => !beats(M, c, w.card)).sort((a, b) => valOf(M, a) - valOf(M, b))[0];
      if (under) return ok(scoredFor(scored, under),
        `یار برنده است؛ ${nm(under)} زیر یار بازی می‌شود تا افتخار آسیب نبیند`, 'DUCK_UNDER_PARTNER');
    }
    // An opponent is winning. If we can beat them cheaply, do it with the smallest
    // sufficient card; otherwise shed the lowest card of the suit (keep honors for a
    // trick we can actually win — never waste the A to capture a 2).
    if (w && M.team(w.player) !== M.team(pid)) {
      const cheap = cheapestBeater(M, inSuit, w.card);
      if (cheap && inSuit.length > 1) {
        return ok(scoredFor(scored, cheap),
          `${nm(cheap)} ارزان‌ترین کافی برای بردن دست است`, 'CHEAPEST_SUFFICIENT_WIN');
      }
      const lowest = inSuit.slice().sort((a, b) => valOf(M, a) - valOf(M, b))[0];
      return ok(scoredFor(scored, lowest),
        `امکان برد نیست؛ ${nm(lowest)} کم‌ارزش‌ترین کارت خال لید در دست است`, 'SHED_LOWEST_OF_SUIT');
    }
    // Nobody meaningful to chase: engine ranking decides.
    const pick = scored[0];
    return ok(pick, explain(pick), rankedGoals(pick));
  }

  // --- Case 2: void in the led suit. Ruff or shed? ---
  const trump = M.mode === 'normal' ? M.trump : null;
  const trumps = trump ? legal.filter((c) => c.suit === trump) : [];
  const oppWinning = w && M.team(w.player) !== M.team(pid);
  const teamWinning = w && M.team(w.player) === M.team(pid);

  if (trumps.length) {
    // Ruffing partner's winner is forbidden — the team already owns the trick.
    if (teamWinning) {
      const shed = legal.slice().sort((a, b) => shedCost(M, a) - shedCost(M, b))[0];
      return ok(scoredFor(scored, shed),
        `یار برنده است؛ برش زدن بی‌فایده است، ${nm(shed)} دور انداخته می‌شود`, 'SHED_KEEP_TRUMP');
    }
    // Opponent winning, or we are the first to commit: ruff with the smallest trump
    // that actually beats the current winner (never burn the A when the 2 suffices).
    const target = oppWinning ? w.card : null;
    const ruff = target
      ? trumps.slice().sort((a, b) => valOf(M, a) - valOf(M, b)).find((c) => beats(M, c, target)) || null
      : trumps.slice().sort((a, b) => valOf(M, a) - valOf(M, b))[0];
    if (ruff) {
      return ok(scoredFor(scored, ruff),
        `برش با ${nm(ruff)} — کمترین حکم کافی برای گرفتن دست`, 'RUFF_CHEAPEST');
    }
  }

  // No trump usable: discard the lowest-future-value card, preferring non-trump.
  const shed = legal.slice().sort((a, b) => shedCost(M, a) - shedCost(M, b))[0];
  return ok(scoredFor(scored, shed),
    `خال لید نداریم؛ ${nm(shed)} کم‌ارزش‌ترین کارت آینده است`, 'SHED_LOWEST_FUTURE');
}

// ===========================================================================
// THIRD — two cards on the table.
// ===========================================================================
// Obligations (spec): middle hand balances attack and defense.
//   • if partner is winning, duck under them (signal "I have the suit guarded") and
//     force the fourth seat to spend a premium card to take it
//   • if an opponent is winning and we can beat them, apply maximum pressure: win as
//     cheaply as suffices so the last opponent must pay an honor or a trump
//   • if nothing can be won, discard/defend — shed the lowest future value, keep trump
export function thirdPolicy(s, pid) {
  const { scored, M } = scoreMoves(s, pid);
  if (!scored.length) return null;
  const legal = playable(s, pid);
  const w = winnerOfTrick(M);
  const last = stillToAct(M, pid)[0] || null; // the FOURTH seat, if any
  const hasSuit = M.leadSuit && legal.some((c) => c.suit === M.leadSuit);

  if (w && M.team(w.player) === M.team(pid)) {
    // Partner owns the trick. Duck: play the lowest card that does NOT overtake
    // partner, while still holding a higher one (the "guarded suit" continuation
    // signal). The fourth seat must then beat partner's card with a premium.
    const pool = hasSuit ? legal.filter((c) => c.suit === M.leadSuit) : legal;
    const duck = pool.filter((c) => !beats(M, c, w.card)).sort((a, b) => valOf(M, a) - valOf(M, b))[0];
    if (duck) {
      const stillHigher = pool.some((c) => beats(M, c, w.card) && c !== duck);
      if (last && M.team(last) !== M.team(pid) && stillHigher) {
        return ok(scoredFor(scored, duck),
          `${nm(duck)} زیر یار — نفر چهارم مجبور است کارت باارزش خرج دهد`, 'THIRD_MAX_PRESSURE');
      }
      return ok(scoredFor(scored, duck),
        `${nm(duck)} زیر یار بازی می‌شود؛ دست برای یار امن است`, 'DUCK_UNDER_PARTNER');
    }
    // Everything overtakes partner (we only hold winners of the suit): it is still
    // partner's trick — do not burn a winner when the team already wins.
    const shed = pool.slice().sort((a, b) => shedCost(M, a) - shedCost(M, b))[0];
    return ok(scoredFor(scored, shed),
      `یار برنده است؛ ${nm(shed)} دور انداخته می‌شود`, 'SHED_KEEP_TRUMP');
  }

  // An opponent is winning (or the trick is open). Try to beat them cheaply.
  if (w && M.team(w.player) !== M.team(pid)) {
    const pool = hasSuit ? legal.filter((c) => c.suit === M.leadSuit) : legal;
    const trump = M.mode === 'normal' ? M.trump : null;
    let cheap = cheapestBeater(M, pool, w.card);
    // void in the led suit: a trump ruff is the beater
    if (!cheap && trump && pool.some((c) => c.suit === trump)) {
      cheap = pool.filter((c) => c.suit === trump).sort((a, b) => valOf(M, a) - valOf(M, b))
        .find((c) => beats(M, c, w.card)) || null;
    }
    if (cheap) {
      const tag = last && M.team(last) !== M.team(pid)
        ? 'THIRD_MAX_PRESSURE'
        : 'CHEAPEST_SUFFICIENT_WIN';
      return ok(scoredFor(scored, cheap),
        `${nm(cheap)} برنده فعلی را با کمترین هزینه می‌برد`, tag);
    }
  }

  // Nothing wins: discard/defense — lowest future value, keep trump for later.
  const shed = legal.slice().sort((a, b) => shedCost(M, a) - shedCost(M, b))[0];
  return ok(scoredFor(scored, shed),
    `امکان برد این دست نیست؛ ${nm(shed)} دفاعی دور انداخته می‌شود`, 'DISCARD_DEFENSE');
}

// ===========================================================================
// FOURTH — last to act, three cards on the table.
// ===========================================================================
// Obligations (spec): the decisive question — CAN fourth beat the current winner?
//   • if YES: decide from the game state and the trick's value. Take it with the
//     cheapest sufficient card when the trick matters or the team needs it; if
//     partner is already winning, deliberately do NOT overtake them
//   • if NO: discard the lowest-value card; never waste an honor on a lost trick
export function fourthPolicy(s, pid) {
  const { scored, M } = scoreMoves(s, pid);
  if (!scored.length) return null;
  const legal = playable(s, pid);
  const w = winnerOfTrick(M);
  const hasSuit = M.leadSuit && legal.some((c) => c.suit === M.leadSuit);
  const pool = hasSuit ? legal.filter((c) => c.suit === M.leadSuit) : legal;
  const team = M.team(pid);

  // --- can we beat the current winner at all? ---
  const canBeat = w ? pool.filter((c) => beats(M, c, w.card)) : pool;

  // Partner is winning: never overtake. The team already has the trick; burning a
  // winner here costs a trick later. Duck the lowest non-overtaking card.
  if (w && team === M.team(w.player)) {
    const ducks = pool.filter((c) => !beats(M, c, w.card));
    const pick = (ducks.length ? ducks : pool).slice().sort((a, b) => shedCost(M, a) - shedCost(M, b))[0];
    return ok(scoredFor(scored, pick),
      `یار برنده است؛ ${nm(pick)} بدون قاپیدن دست یار بازی می‌شود`, 'DO_NOT_OVERTAKE_PARTNER');
  }

  if (w && canBeat.length) {
    // Take with the cheapest sufficient card.
    const cheap = canBeat.slice().sort((a, b) => valOf(M, a) - valOf(M, b))[0];
    // Is the trick worth taking right now? Late game or a close score → yes, always.
    // Early with a dominant position → still yes: a guaranteed trick is a guaranteed
    // trick, and fourth seat taking cheaply costs the opponents a premium.
    const worth = trickWorthTaking(M, pid);
    if (worth) {
      return ok(scoredFor(scored, cheap),
        `${nm(cheap)} برنده را می‌برد — نفر چهارم با کمترین کارت کافی دست را می‌گیرد`, 'FOURTH_TAKE_CHEAPEST');
    }
    // Not worth committing a winner: still take it if the card we'd use is not a
    // future winner (cheap small card), otherwise duck and keep the honor.
    if (valOf(M, cheap) <= 8) {
      return ok(scoredFor(scored, cheap),
        `${nm(cheap)} ارزان است و دست را می‌برد`, 'FOURTH_TAKE_CHEAPEST');
    }
    const ducks = pool.filter((c) => !beats(M, c, w.card));
    if (ducks.length) {
      const pick = ducks.slice().sort((a, b) => shedCost(M, a) - shedCost(M, b))[0];
      return ok(scoredFor(scored, pick),
        `ارزش این دست برد ندارد؛ ${nm(pick)} نگه داشته می‌شود و عقب‌نشینی می‌کنیم`, 'FOURTH_STRATEGIC_DUCK');
    }
    return ok(scoredFor(scored, cheap),
      `${nm(cheap)} تنها گزینه برای بردن است`, 'FOURTH_TAKE_CHEAPEST');
  }

  // --- cannot beat anyone: discard/defense ---
  const shed = pool.slice().sort((a, b) => shedCost(M, a) - shedCost(M, b))[0];
  return ok(scoredFor(scored, shed),
    `نمی‌توان برنده فعلی را زد؛ ${nm(shed)} کم‌ارزش‌ترین کارت آینده است`, 'FOURTH_DISCARD_LOW');
}

// ===========================================================================
// Dispatcher: the single entry point the AI uses. Routes by position, so a seat can
// NEVER decide outside its position's state machine (spec §1/§4).
// ===========================================================================
export function decideByPosition(s, pid) {
  const pos = positionOf(s, pid);
  const fn = { LEADER: leaderPolicy, SECOND: secondPolicy, THIRD: thirdPolicy, FOURTH: fourthPolicy }[pos];
  const out = fn(s, pid);
  if (!out) return null;
  return { ...out, position: pos };
}

// ---------- internals ----------

// Shed cost: lowest future value first, but never prefer trump when a non-trump can
// be shed (keeping trump is almost always worth more than keeping a small spot card).
function shedCost(M, c) {
  let v = valOf(M, c);
  if (M.mode === 'normal' && c.suit === M.trump) v += 20;
  return v;
}

// Is taking THIS trick worth committing a winner for? Decision-time observables:
// score gap, trick number, and whether the team is at a Kot boundary.
function trickWorthTaking(M, pid) {
  const team = M.team(pid);
  const opp = team === 'A' ? 'B' : 'A';
  const gap = M.tricksWon[opp] - M.tricksWon[team]; // >0 means we are behind
  const tricksLeft = Math.max(0, 13 - M.trickNum + 1);
  if (M.tricksWon[team] >= 6 || M.tricksWon[opp] >= 6) return true; // endgame: every trick is decisive
  if (gap > 0) return true;       // behind: take what we can
  if (tricksLeft <= 4) return true; // few chances left
  return false;                   // early and ahead: the trick is not worth an honor
}

// Find the scored entry whose card matches `card` (same suit+rank).
function scoredFor(scored, card) {
  return scored.find((m) => ckey(m.card) === ckey(card)) || { card, score: 0, goals: [] };
}

function ok(scoredEntry, reason, goal) {
  const goals = scoredEntry.goals || [];
  return {
    card: scoredEntry.card,
    pick: scoredEntry,
    reason,
    goals: goal && !goals.includes(goal) ? [goal, ...goals] : goals,
  };
}
const rankedGoals = (m) => m.goals && m.goals.length ? m.goals[0] : null;
