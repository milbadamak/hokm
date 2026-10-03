// src/risk.js — RiskEngine. Combines score gap, tricks remaining, hand quality,
// trump control, secure-win availability, partner support and endgame pressure.
// Ahead → conservative; behind (especially near the opponent's 7th trick) →
// aggressive. Returns a number: >0 accept risk, <=0 safety first.
import { buildMemory, stillToAct, beatersFor, trumpSeen, antiKotActive } from './knowledge.js';
import { cardVal } from './rules.js';

// ANTI_KOT_MODE (§6): our side still on 0 tricks while the opponents are close to
// the 7-0 KOT line. Retention of A/K stops mattering, gambles open up.
export function antiKOTMode(s, pid) {
  const M = buildMemory(s, pid);
  return antiKotActive(M, pid);
}

export function riskAppetite(s, pid) {
  const M = buildMemory(s, pid);
  const team = M.team(pid);
  const opp = team === 'A' ? 'B' : 'A';
  const ahead = M.tricksWon[team] - M.tricksWon[opp];
  const tricksLeft = Math.max(0, 13 - (M.trickNum - 1));
  const oppAt6 = M.tricksWon[opp] === 6;
  const antiKOTActive = antiKotActive(M, pid);

  let score = -ahead * 2;
  if (oppAt6) score += 3;
  if (ahead >= 2) score -= 2;
  if (tricksLeft <= 4) score += ahead < 0 ? 2 : -1;

  // §6 ANTI_KOT_MODE: getting at least one trick dominates safety — risk rises.
  if (antiKOTActive) {
    score += 2;
    if (tricksLeft <= 3) score += 2;
  }

  if (M.mode === 'normal' && M.trump) {
    const myT = M.own.filter((c) => c.suit === M.trump);
    score += Math.min(2, myT.length) - (trumpSeen(M).length > 6 ? 1 : 0);
    const top = Math.max(0, ...myT.map((c) => cardVal(c, 'normal')));
    if (top >= 12) score += 1;
  } else {
    score += 0.5; // no trump suit to control: flatter risk
  }

  // secure wins available right now (own hand vs remaining seats, observables only)
  const lead = M.leadSuit;
  let secures = 0;
  for (const c of M.own) {
    if (lead && c.suit !== lead && (M.mode !== 'normal' || c.suit !== M.trump)) continue;
    let safe = true;
    for (const p of M.opponentsOf(pid).filter((q) => stillToAct(M, pid).includes(q))) {
      if (beatersFor(M, p, c, lead || c.suit).length) { safe = false; break; }
    }
    if (safe) secures++;
  }
  if (secures === 0) score += 1;
  if (secures >= 3) score -= 1;

  let support = 0;
  for (const sg of M.signals) if (sg.player === M.partnerOf(pid) && sg.weight >= 2) support += 1;
  score -= Math.min(1, support * 0.5);

  return score;
}

// Endgame mode: last 3 tricks of a round. Same Decision Engine, shifted weights.
export function endgameWeights(s) {
  const tricksLeft = Math.max(0, 13 - (s.trickNum - 1));
  if (tricksLeft > 3) return null;
  return {
    tricksLeft,
    winNowMult: 1.6,
    futureMult: 0.5,
    controlMult: 1.2,
  };
}
