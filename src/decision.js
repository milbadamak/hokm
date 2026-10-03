// src/decision.js — the Decision Engine shared by AI seats, Analysis and Coach.
// Pipeline per turn (spec):
//   GameState → CardMemory/Inference (knowledge.js) → LegalMoves → TrickAnalysis →
//   PartnerSignals → GoalSelection → CandidateMoveScoring → Risk/FutureValue →
//   Decision (chosen card + ranked alternatives + short human reason)
//
// All evaluation uses decision-time observables only. Hidden cards are never
// consulted, so the same engine can grade a past decision without hindsight.
import { SUITS, RANKS, PARTNER, cardVal, cmpCards, playable } from './rules.js';
import {
  buildMemory, classifyPlay, stillToAct, futureValue, beatersFor, suitCountRange,
  signalScore, antiKotActive, ckey,
} from './knowledge.js';
import { riskAppetite, endgameWeights } from './risk.js';

export const GOALS = [
  'WIN_TRICK', 'PROTECT_PARTNER', 'FORCE_TRUMP', 'DRAW_TRUMPS', 'CREATE_VOID',
  'PRESERVE_HIGH_CARD', 'PARTNER_SUPPORT', 'BLEED_LOW_CARD', 'FORCE_EXPENSIVE_RESPONSE',
  // Tactical rules v2 (decision-time observables only)
  'THIRD_SEAT_MAX_PRESSURE', 'FORCE_OPPONENT_PREMIUM_RESPONSE', 'ESTABLISH_SECONDARY_HONOR',
  'TRUMP_CONTROL', 'ANTI_KOT', 'PARTNER_CONTINUATION_SIGNAL',
];

function shortnessBonus(M, pid, c) {
  // singleton/doubleton side suit → dumping creates a void for future ruffs
  if (M.mode !== 'normal' || c.suit === M.trump) return 0;
  const n = M.own.filter((x) => x.suit === c.suit).length;
  if (n === 1) return 0.5;
  if (n === 2) return 0.2;
  return 0;
}

function drawTrumpsBonus(M, pid, c) {
  if (M.mode !== 'normal' || !M.trump || c.suit !== M.trump) return 0;
  const opps = M.opponentsOf(pid);
  const bothVoidTrump = opps.length === 2 && opps.every((p) => M.voids[p].includes(M.trump));
  if (bothVoidTrump) return 0.6;
  const liveDesc = RANKS.slice().sort((a, b) => RANKS.indexOf(b) - RANKS.indexOf(a))
    .filter((r) => !M.playedSet.has(ckey({ suit: M.trump, rank: r })));
  let run = 0;
  for (const r of liveDesc) {
    if (M.own.some((x) => x.suit === M.trump && x.rank === r)) run++;
    else break;
  }
  return run >= 3 ? 0.45 : 0;
}

// Force-expensive-response: if an opponent CAN overtake my winning card, they must
// spend something that matters (top honors or a trump) — tactical gain even if I lose.
function expensiveResponseBonus(M, pid, card, cls) {
  if (!cls.iWin) return 0;
  let b = 0;
  for (const p of M.opponentsOf(pid).filter((q) => stillToAct(M, pid).includes(q))) {
    const bs = beatersFor(M, p, card, cls.lead);
    if (!bs.length) continue;
    const top = Math.max(...bs.map((x) => cardVal(x.card, M.mode)));
    const ruffBeat = M.mode === 'normal' && bs.some((x) => x.card.suit === M.trump && card.suit !== M.trump);
    if (top >= 12 || ruffBeat) b += 0.35;
  }
  return b;
}

// ---------- Tactical rules v2 (decision-time observables only) ----------
function trumpControlPair(M) {
  if (M.mode !== 'normal' || !M.trump) return false;
  const t = M.own.filter((x) => x.suit === M.trump);
  return t.some((x) => x.rank === 'A') && t.some((x) => x.rank === 'K');
}

// Cards pid could legally have played at decision time (follow suit if able).
function legalPool(M, pid) {
  const lead = M.leadSuit;
  const must = lead && M.own.some((x) => x.suit === lead);
  return must ? M.own.filter((x) => x.suit === lead) : M.own;
}

// §1 + §2 + §4 — partner currently owns the trick and I hold a card that WOULD
// overtake it. Ducking a low card keeps partner on top and forces the player after
// me to pay a premium (top honor or a trump) — "maximum pressure" is NOT "biggest
// card". Acting last, the same duck is the positive PARTNER_CONTINUATION_SIGNAL
// ("this suit is guarded in my hand — lead it again").
function duckUnderPartner(M, pid, c, cls, kotRisk) {
  const out = { score: 0, tags: [] };
  if (cls.status !== 'non-winning' || !cls.partnerWasWinning || M.trick.length < 2) return out;
  const lead = M.leadSuit;
  if (!lead || c.suit !== lead) return out;
  let w = M.trick[0];
  for (const t of M.trick) if (cmpCards(t.card, w.card, lead, M.mode, M.trump) > 0) w = t;
  if (w.player !== M.partnerOf(pid)) return out;
  // I must actually hold a higher usable card of that suit (real, keepable power)
  const higher = legalPool(M, pid).some((x) => cmpCards(x, w.card, lead, M.mode, M.trump) > 0);
  if (!higher) return out;
  if (cardVal(c, M.mode) >= cardVal(w.card, M.mode)) return out; // strictly under partner
  const rest = stillToAct(M, pid);
  // one opponent still to act behind me: they must spend A/K or a trump
  if (rest.length === 1 && M.team(rest[0]) !== M.team(pid)) {
    const bs = beatersFor(M, rest[0], w.card, lead);
    const premium = bs.filter((b) => cardVal(b.card, M.mode) >= 13 ||
      (M.mode === 'normal' && b.card.suit === M.trump && w.card.suit !== M.trump));
    if (premium.length) {
      out.score += kotRisk ? 0.2 : 0.7;
      out.tags.push('THIRD_SEAT_MAX_PRESSURE', 'FORCE_OPPONENT_PREMIUM_RESPONSE');
    }
  }
  // I act last: partner takes the trick, low card = guarded-suit signal
  if (rest.length === 0) { out.score += 0.7; out.tags.push('PARTNER_CONTINUATION_SIGNAL'); }
  return out;
}

// §3 first-trick lead adjustment: TRUMP_CONTROL, TRUMP_ACE avoidance, SECONDARY_HONOR setup
function firstTrickLeadAdjust(M, pid, c, kotRisk) {
  const out = { score: 0, tags: [] };
  const isTrump = M.mode === 'normal' && !!M.trump && c.suit === M.trump;
  const trumps = M.mode === 'normal' && M.trump ? M.own.filter((x) => x.suit === M.trump) : [];
  const akPair = trumps.some((x) => x.rank === 'A') && trumps.some((x) => x.rank === 'K');
  if (isTrump) {
    if (akPair) out.tags.push('TRUMP_CONTROL');
    if (c.rank === 'A') {
      const controlOurs = akPair && trumps.length >= 3;
      if (!kotRisk) out.score -= controlOurs ? 2 : 6;
    } else if (c.rank === 'K' && akPair && !kotRisk) out.score -= 1.5;
    return out;
  }
  if (kotRisk) return out;
  if (c.rank === 'K' || c.rank === 'Q') {
    const lower = M.own.some((x) => x.suit === c.suit && cardVal(x, M.mode) < cardVal(c, M.mode));
    if (lower) { out.score -= 2; out.tags.push('ESTABLISH_SECONDARY_HONOR'); }
  } else if (M.mode === 'normal' && cardVal(c, 'normal') < 11 &&
             M.own.some((x) => x.suit === c.suit && (x.rank === 'K' || x.rank === 'Q'))) {
    // any card below the honor (8/9/10/J included, not just 2-7) draws the higher
    // opposition card out and keeps our K/Q for later suit control
    out.score += 0.6; out.tags.push('ESTABLISH_SECONDARY_HONOR');
  }
  return out;
}

function pressureBonus(M, pid, card) {
  let b = 0;
  for (const p of M.opponentsOf(pid)) {
    const r = suitCountRange(M, p, card.suit);
    if (r.hi === 0) b += 0.45;
    else if (r.lo === 0 && r.hi <= 2) b += 0.15;
  }
  return Math.min(0.5, b);
}

export function scoreMoves(s, pid) {
  const M = buildMemory(s, pid);
  const legal = playable(s, pid);
  const lead = M.trick.length === 0;
  const risk = riskAppetite(s, pid);
  const endg = endgameWeights(s);
  const winMult = endg ? endg.winNowMult : 1;
  const futMult = endg ? endg.futureMult : 1;
  const ctrlMult = endg ? endg.controlMult : 1;
  const partner = M.partnerOf(pid);
  const kotRisk = antiKotActive(M, pid);

  const scored = legal.map((c) => {
    const cls = classifyPlay(M, pid, c);
    const v = cardVal(c, M.mode);
    const fv = futureValue(M, c);
    const goals = [];
    let sc = 0;

    if (cls.status === 'secure') {
      // secured trick win outranks future positioning unless clearly justified
      sc += 10 * winMult;
      goals.push('WIN_TRICK');
      sc += expensiveResponseBonus(M, pid, c, cls) * 0.5;
    } else if (cls.status === 'possible') {
      sc += (3.5 + 3 * cls.winProb) * winMult * (risk > 0 ? 1 : 0.6);
      goals.push('WIN_TRICK');
      sc += expensiveResponseBonus(M, pid, c, cls);
    } else if (cls.status === 'low') {
      sc += 0.5 * cls.winProb * Math.max(0, risk);
    } else if (cls.status === 'non-winning') {
      // partner/team keeps it: shed the card with the LOWEST future value;
      // never dump a valuable trump unnecessarily
      goals.push('PROTECT_PARTNER');
      sc += 8 - 3 * fv;
      if (M.mode === 'normal' && c.suit === M.trump && M.leadSuit !== M.trump) sc -= 4;
    } else {
      // dead for this trick: bleed lowest future value, preserve real cards
      goals.push('BLEED_LOW_CARD');
      sc += 5 - 2.5 * fv;
    }

    if (cls.iWin && cls.status !== 'secure' && v >= 12 && lead) {
      // cashing a big card as lead while it could wait: preserve unless it secures
      sc -= 1.2 * futMult;
      goals.push('PRESERVE_HIGH_CARD');
    }

    if (lead) {
      const dt = drawTrumpsBonus(M, pid, c);
      if (dt > 0) { sc += dt * 2.2 * ctrlMult; goals.push('DRAW_TRUMPS'); }
      const sb = shortnessBonus(M, pid, c);
      if (sb > 0) { sc += sb * 2; goals.push('CREATE_VOID'); }
      sc += pressureBonus(M, pid, c) * 1.5;
      const sig = signalScore(M, pid, c.suit);
      if (sig >= 2 && !(M.mode === 'normal' && c.suit === M.trump)) { sc += Math.min(3, sig); goals.push('PARTNER_SUPPORT'); }
      if (M.mode === 'normal' && c.suit === M.trump && dt <= 0) sc -= 2; // no gratuitous trump leads
    }

    // cheapest sufficient trump when ruffing (spec: کمترین حکم کافی)
    if (M.mode === 'normal' && M.trump && c.suit === M.trump && cls.iWin &&
        (!M.leadSuit || !M.own.some((x) => x.suit === M.leadSuit && x !== c))) {
      goals.push('FORCE_TRUMP');
      const cheaperWorks = M.own.some((x) => x.suit === M.trump && cardVal(x, 'normal') < v &&
        classifyPlay(M, pid, x).iWin);
      if (cheaperWorks) sc -= 1.5; // a smaller trump does the same job
      // §5 — A+K held together is a TRUMP_CONTROL_PAIR: never burn one of them on a
      // ruff a smaller trump already wins, unless the team is fighting a KOT.
      if (cheaperWorks && !kotRisk && trumpControlPair(M) && (c.rank === 'A' || c.rank === 'K')) {
        sc -= 2.5;
        goals.push('TRUMP_CONTROL');
      }
      if (risk <= 0 && !cls.secureTeamWin) sc -= 2.5; // conservative: skip coin-flip ruffs
      sc += expensiveResponseBonus(M, pid, c, cls);    // forcing big trump spend = gain
    }

    if (endg && cls.status === 'secure') sc += endg.tricksLeft <= 2 ? 3 : 1.5;

    // never overtake the partner's winning trick
    if (cls.partnerWasWinning && cls.iWin) sc -= 6;

    // §6 ANTI_KOT_MODE — taking ANY trick outranks preserving honors or safety
    if (kotRisk && (cls.iWin || cls.secureTeamWin)) { sc += 2.5; goals.push('ANTI_KOT'); }
    if (kotRisk && cls.status === 'possible') sc += 1.2 * (1 - cls.winProb); // gamble is the point

    // §2 positional 3rd seat winning = max pressure applied (tag only, no bias)
    if (M.trick.length === 2 && cls.iWin && !cls.partnerWasWinning) {
      const rest = stillToAct(M, pid);
      if (rest.length === 1 && M.team(rest[0]) !== M.team(pid)) {
        const bs = beatersFor(M, rest[0], c, cls.lead);
        if (bs.some((b) => cardVal(b.card, M.mode) >= 13 ||
            (M.mode === 'normal' && b.card.suit === M.trump && c.suit !== M.trump))) {
          sc += 0.7;
          goals.unshift('THIRD_SEAT_MAX_PRESSURE', 'FORCE_OPPONENT_PREMIUM_RESPONSE');
        } else {
          goals.unshift('THIRD_SEAT_MAX_PRESSURE');
        }
      } else {
        goals.unshift('THIRD_SEAT_MAX_PRESSURE');
      }
    }

    // §3/§5 first-trick lead context (trump A / A+K pair / secondary honor setup)
    if (lead && M.trickNum === 1) {
      const ft = firstTrickLeadAdjust(M, pid, c, kotRisk);
      sc += ft.score;
      for (const t of ft.tags) if (!goals.includes(t)) goals.push(t);
    }

    return { card: c, score: sc, goals: [...new Set(goals)], cls, fv, v };
  });

  scored.sort((a, b) => b.score - a.score || a.fv - b.fv || a.v - b.v);
  return { scored, M, risk, endg };
}

// §7 DETERMINISM: the Decision Engine contains NO source of randomness. Given the
// same game state it always returns the same card. The softmax/rng variation that
// used to break near-ties is gone: the argmax is taken with the fixed tie-break in
// scoreMoves (score desc, then lowest future value, then lowest rank value). A tie
// is resolved by that fixed order — never by Math.random or a seeded rng.
// `rng` is accepted only for signature compatibility with older callers and is
// never consulted; passing one would not change the answer.
export function decide(s, pid, rng) {
  void rng;
  const { scored } = scoreMoves(s, pid);
  if (!scored.length) return null;
  const pick = scored[0];
  return {
    card: pick.card, pick, top: pick, second: scored[1] || null, ranked: scored,
    goals: pick.goals, reason: explain(pick),
  };
}

// Short, human, decision-time-only reason (used by Coach + Analysis + last-trick).
const SYM = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
export function explain(mv) {
  const c = mv.card, sym = SYM[c.suit], g = mv.goals[0] || 'BLEED_LOW_CARD';
  const t = Math.round((mv.cls.winProb || 0) * 100);
  switch (g) {
    case 'WIN_TRICK':
      return mv.cls.status === 'secure'
        ? `${sym}${c.rank} برد قطعی است — هیچ بازیکن باقی‌مانده‌ای با اطلاعات موجود نمی‌تواند ببراند.`
        : `${sym}${c.rank} با احتمال ≈${t}٪ دست را می‌برد.`;
    case 'PROTECT_PARTNER':
      return `یار در حال بردن است؛ کم‌ارزش‌ترین کارت از نظر آینده (${sym}${c.rank}) پاس داده می‌شود.`;
    case 'FORCE_TRUMP':
      return `برش با ${sym}${c.rank} برای گرفتن دست.`;
    case 'DRAW_TRUMPS':
      return `کشیدن حکم؛ کنترل ترمپ در این وضعیت ارزش بالایی دارد.`;
    case 'CREATE_VOID':
      return `خالی‌کردن ${sym} تا در دست‌های بعد بتوانی برش بزنی.`;
    case 'PRESERVE_HIGH_CARD':
      return `نگه داشتن ارزش برای آینده؛ برد فعلی ضروری نیست.`;
    case 'PARTNER_SUPPORT':
      return `سیگنال یار در ${sym} قوی است؛ همان خال لید می‌شود.`;
    case 'BLEED_LOW_CARD':
      return `این دست با اطلاعات فعلی بردنی نیست؛ ${sym}${c.rank} کمارزش‌ترین کارت آینده است.`;
    case 'FORCE_EXPENSIVE_RESPONSE':
      return `اگر حریف بخواهد این را بگیرد، مجبور است کارت باارزش خرج کند.`;
    case 'THIRD_SEAT_MAX_PRESSURE':
      return `نفر سوم نهایت فشار را وارد می‌کند — مجبور کردن حریف به خرج A/K.`;
    case 'FORCE_OPPONENT_PREMIUM_RESPONSE':
      return `فشار وارد کردن روی حریف برای خروج کارت باارزش A/K.`;
    case 'ESTABLISH_SECONDARY_HONOR':
      return `برقرار کردن یک جایزه دوم -- K/Q بالاتر بعد.`;
    case 'PARTNER_CONTINUATION_SIGNAL':
      return `سیگنال به یار -- همان خال لید می‌شود.`;
    case 'TRUMP_CONTROL':
      return `کنترل ترمپ -- حفظ کنترل حکم در این وضعیت.`;
    case 'ANTI_KOT':
      return `ضد کت -- جلوگیری از اینکه حریف به K/SX برسه.`;
    default:
      return `امتیاز ${mv.score.toFixed(1)}`;
  }
}