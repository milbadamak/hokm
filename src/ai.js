// src/ai.js — public AI surface (facade over the Decision Engine).
// aiPick stays signature-compatible with the game controller. The engine reads
// ONLY the observable knowledge layer (src/knowledge.js) — opponents' hidden
// hands are never consulted.
//
// Two layers, both deterministic (§7):
//   decide()            — the scorer: ranks every legal move with a fixed tie-break.
//   decideByPosition()  — the Position Policies (LEADER/SECOND/THIRD/FOURTH), each
//                         owning its decision rights and individually testable.
// aiPick plays through the position policies; decide() stays available to the
// Analysis/Coach features that want the ranked list.
import { SUITS, cardVal } from './rules.js';
import { decide, scoreMoves } from './decision.js';
import { decideByPosition } from './positions.js';

export function aiPick(s, pid) {
  const d = decideByPosition(s, pid) || decide(s, pid);
  return d ? d.card : s.players[pid].hand[0];
}

// Exposed for the Coach + Analysis features (they share this exact engine).
export { decide, scoreMoves, decideByPosition };

// ---------- Trump selection (declarer AI) ----------
// TrumpScore: length + raw strength + sequences (QJ10 / KQJ10 worth more than
// isolated J/10) + honors + future value + score context. Project heuristic kept
// as SOFT tie-break only: A+K together in a suit is slightly penalized because
// they nearly win without trumps — never decisive.
export function pickAiTrump(hand5, s = null) {
  const bySuit = { spades: [], hearts: [], diamonds: [], clubs: [] };
  for (const c of hand5) bySuit[c.suit].push(c);
  let best = 'spades', bs = -Infinity;
  for (const suit of SUITS) {
    const cards = bySuit[suit].slice().sort((a, b) => cardVal(b, 'normal') - cardVal(a, 'normal'));
    if (!cards.length) continue;
    const ranks = cards.map((c) => c.rank);
    let sc = cards.length * 5;
    for (const c of cards) sc += cardVal(c, 'normal') * 0.7;
    if (seqRun(ranks, 'AKQJ')) sc += 6;
    else if (seqRun(ranks, 'KQJ10')) sc += 6;
    else if (seqRun(ranks, 'QJ10')) sc += 4;
    else if (seqRun(ranks, 'J10')) sc += 2;
    const hasA = ranks.includes('A'), hasK = ranks.includes('K');
    if (hasA) sc += 3;
    if (hasK) sc += 1.5;
    if (hasA && hasK && cards.length >= 2) sc -= 4;      // soft A+K heuristic
    if (cards.length >= 4) sc += 2;                       // ruff potential (future value)
    if (s) {
      const team = s.players ? s.players[s.hakem].team : null;
      if (team) {
        const opp = team === 'A' ? 'B' : 'A';
        const gap = s.score[team] - s.score[opp];
        if (gap <= -2 && cards.length >= 4) sc += 1.5;    // behind → bet on length
        if (gap >= 2 && (hasA || hasK)) sc += 1;          // ahead → bet on control
      }
    }
    if (sc > bs) { bs = sc; best = suit; }
  }
  return best;
}

// ranks sorted descending; pattern must appear as a (gap-free) ordered subsequence
function seqRun(descRanks, pat) {
  const chars = pat === 'J10' ? ['J', '10'] : pat === 'QJ10' ? ['Q', 'J', '10']
    : pat === 'KQJ10' ? ['K', 'Q', 'J', '10'] : ['A', 'K', 'Q', 'J'];
  let i = 0;
  for (const r of descRanks) { if (r === chars[i]) i++; if (i === chars.length) return true; }
  return false;
}
