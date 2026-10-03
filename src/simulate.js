// src/simulate.js — Deterministic full-round simulation (spec §11).
//
// Runs a COMPLETE Hokm round with no UI, no timers and no randomness: the deck is
// handed in explicitly, every decision comes from the position policies, so the
// same input always produces byte-identical output (verified 100x in the tests).
//
//   simulateRound({ deck, hakem, trump }) -> { transcript, tricks, winner, kot, tricksWon }
//
// The transcript is a plain-JSON array — one entry per completed trick — which makes
// "the same game replays the same way" a one-line deepEqual assertion.
//
// Termination follows the rules, not a fixed trick count: the round ends the moment a
// team reaches 7 tricks, or after all 13 tricks if neither does. It never runs past
// the end, and never ends before a winner is known (spec §10 invariants).
import {
  SUITS, RANKS, NEXT, makeDeck, shuffle, sortHand, trickWinner, playable, getKotPoints,
  mulberry32,
} from './rules.js';
import { pickAiTrump, aiPick } from './ai.js';

const C = (suit, rank) => ({ suit, rank });
const ck = (c) => `${c.suit}:${c.rank}`;

// ---------- invariant engine (spec §10) ----------
// Checked after every play. Any violation throws with the offending detail — a
// property test in tests/simulate.test.js asserts these hold across 100s of games.
export function checkInvariants(st) {
  const errs = [];
  const seen = new Set();
  let onTable = 0;

  // 1. no card is played twice, and nothing is lost: every played card is a real,
  //    unique member of the 52-card deck
  const allPlayed = [];
  for (const t of st.tricks) for (const p of t.plays) allPlayed.push(p.card);
  for (const c of allPlayed) {
    if (seen.has(ck(c))) errs.push(`card played twice: ${ck(c)}`);
    seen.add(ck(c));
  }
  // 2. total accountability: hands + played + current trick = exactly 52 unique cards
  const hands = Object.values(st.players).flatMap((p) => p.hand);
  onTable = st.trick.length;
  const total = hands.length + allPlayed.length + onTable;
  if (total !== 52) errs.push(`card count != 52 (hands ${hands.length} + played ${allPlayed.length} + table ${onTable} = ${total})`);
  const uniq = new Set([...hands, ...allPlayed, ...st.trick.map((t) => t.card)].map(ck));
  if (uniq.size !== 52) errs.push(`duplicate/lost cards: unique set size ${uniq.size} != 52`);
  // 3. no player holds more than 13 cards
  for (const pid of Object.keys(st.players)) {
    const n = st.players[pid].hand.length + st.trick.filter((t) => t.player === Number(pid)).length;
    if (n > 13) errs.push(`player ${pid} holds ${n} cards (>13)`);
  }
  // 4. score is exactly the number of tricks won by each team
  const won = { A: 0, B: 0 };
  for (const t of st.tricks) won[t.team]++;
  for (const team of ['A', 'B']) {
    if (won[team] !== st.tricksWon[team]) errs.push(`score mismatch: ${team} has ${st.tricksWon[team]} but won ${won[team]}`);
  }
  // 5. no trick before the last has more/less than 4 cards; exactly one winner each
  for (const t of st.tricks) {
    if (t.plays.length !== 4) errs.push(`trick ${t.trickNum} has ${t.plays.length} plays (!= 4)`);
    if (!t.winner) errs.push(`trick ${t.trickNum} has no winner`);
  }
  // 6. the round did not end before a winner was decided
  if (st.over) {
    const decided = st.tricksWon.A >= 7 || st.tricksWon.B >= 7 || st.tricks.length === 13;
    if (!decided) errs.push('round ended with no winner');
  }
  return errs;
}

// ---------- core state ----------
function freshState(hakem) {
  return {
    players: {
      1: { name: 'A1', hand: [], team: 'A' },
      2: { name: 'B1', hand: [], team: 'B' },
      3: { name: 'A2', hand: [], team: 'A' },
      4: { name: 'B2', hand: [], team: 'B' },
    },
    hakem, trump: null, trumpMode: 'normal',
    trick: [], leadSuit: null, current: null, starter: null,
    tricksWon: { A: 0, B: 0 }, trickNum: 0,
    memory: { played: [], voids: {}, aces: {}, kings: {}, signals: [], tricks: [] },
    over: false, winner: null, kot: null,
    bamMode: false, bamAsked: false, kotTeam: null, bam: false,
    tricks: [],   // completed trick records (the transcript source)
  };
}

// Mirrors game.js doPlayCard mutations exactly (same memory/void bookkeeping) so the
// simulation's knowledge layer is identical to the live game's.
function playCard(st, pid, card) {
  const h = st.players[pid].hand;
  const i = h.findIndex((x) => x.suit === card.suit && x.rank === card.rank);
  if (i === -1) throw new Error(`player ${pid} cannot play ${ck(card)} — not in hand`);
  h.splice(i, 1);
  const necessary = st.trick.length === 0 && st.trumpMode === 'normal' && card.suit === st.trump;
  st.trick.push({ player: pid, card, necessary });
  if (st.trick.length === 1) st.leadSuit = card.suit;
  st.memory.played.push({ ...card });
  if (st.leadSuit && card.suit !== st.leadSuit) {
    if (!st.memory.voids[pid]) st.memory.voids[pid] = [];
    if (!st.memory.voids[pid].includes(st.leadSuit)) st.memory.voids[pid].push(st.leadSuit);
  }
}

function finishTrick(st) {
  const w = trickWinner(st.trick, st.leadSuit, st.trumpMode, st.trump);
  const team = st.players[w.player].team;
  st.tricksWon[team]++;
  const rec = {
    trickNum: st.trickNum,
    leadSuit: st.leadSuit,
    plays: st.trick.map((t) => ({ player: t.player, card: { ...t.card }, necessary: !!t.necessary })),
    winner: w.player, team,
  };
  st.tricks.push(rec);
  st.memory.tricks.push({
    trickNum: rec.trickNum, leadSuit: rec.leadSuit, winner: rec.winner, team: rec.team,
    plays: rec.plays.map((p) => ({ player: p.player, card: { ...p.card } })),
  });
  st.trick = [];
  st.leadSuit = null;
  st.starter = w.player;
}

// ---------- the round ----------
// Options:
//   deck  (required) — 52 cards in exact deal order. Determinism comes from here.
//   hakem — dealer/first leader (default 1)
//   trump — explicit trump suit; if omitted, the hakem seat picks via pickAiTrump
//           from its first 5 cards (same heuristic the live game uses)
export function simulateRound({ deck, hakem = 1, trump = null, bamPolicy = null } = {}) {
  if (!deck || deck.length !== 52) throw new Error(`simulateRound needs a 52-card deck (got ${deck ? deck.length : 0})`);
  if (new Set(deck.map(ck)).size !== 52) throw new Error('simulateRound: deck has duplicates');

  const st = freshState(hakem);
  // --- deal: 5 to each from the top, then the remaining 8 to each (same order as
  // game.js dealOrder: start after the dealer, dealer last) ---
  const order = [];
  {
    let p = hakem;
    for (let i = 0; i < 3; i++) { p = NEXT[p]; order.push(p); }
    order.push(hakem);
  }
  let di = 0;
  for (let r = 0; r < 5; r++) for (const pid of order) st.players[pid].hand.push(deck[di++]);
  for (const pid of order) st.players[pid].hand = sortHand(st.players[pid].hand, null, 'normal');

  // --- trump selection: explicit, or the hakem's deterministic heuristic ---
  st.trumpMode = 'normal';
  st.trump = trump || pickAiTrump(st.players[hakem].hand.slice(0, 5));
  for (const pid of Object.keys(st.players)) {
    st.players[pid].hand = sortHand(st.players[pid].hand, st.trump, 'normal');
  }
  for (let r = 0; r < 8; r++) for (const pid of order) st.players[pid].hand.push(deck[di++]);
  for (const pid of Object.keys(st.players)) {
    st.players[pid].hand = sortHand(st.players[pid].hand, st.trump, 'normal');
  }

  // --- play until a team hits 7 or all 13 tricks are gone ---
  st.trickNum = 1;
  st.starter = hakem;
  // bam request (game.js handleKot): after a 7-0 Kot the kot team may demand "bam" —
  // the round then continues until the kot team takes all 13 tricks or the round ends.
  // The policy is a callback so the single seeded RNG stays in the caller's hands.
  const askBam = (team) => { if (bamPolicy && bamPolicy(team)) { st.bamMode = true; st.kotTeam = team; st.bamAsked = true; } };
  let guard = 0;
  while (!st.over && guard++ < 200) {
    let pid = st.starter;
    for (let seat = 0; seat < 4; seat++) {
      st.current = pid;
      const legal = playable(st, pid);
      if (!legal.length) throw new Error(`player ${pid} has no legal play on trick ${st.trickNum}`);
      const card = aiPick(st, pid);
      // §10: the AI must never choose a card outside its legal set
      if (!legal.some((x) => x.suit === card.suit && x.rank === card.rank)) {
        throw new Error(`AI illegal play: P${pid} chose ${ck(card)}, legal = ${legal.map(ck).join(',')}`);
      }
      playCard(st, pid, card);
      pid = NEXT[pid];
    }
    finishTrick(st);
    // round end conditions, in the same order as game.js endTrick
    if (st.bamMode) {
      if (st.tricksWon[st.kotTeam] === 13) { st.over = true; st.winner = st.kotTeam; st.bam = true; break; }
      if (st.tricks.length === 13) { st.over = true; break; }   // bam failed: round scores normally
    } else {
      if (st.tricksWon.A === 7 && st.tricksWon.B === 0) {
        askBam('A');
        if (!st.bamMode) { st.over = true; st.winner = 'A'; st.kot = true; break; }
      } else if (st.tricksWon.B === 7 && st.tricksWon.A === 0) {
        askBam('B');
        if (!st.bamMode) { st.over = true; st.winner = 'B'; st.kot = true; break; }
      } else if (st.tricksWon.A >= 7) { st.over = true; st.winner = 'A'; break; }
      else if (st.tricksWon.B >= 7) { st.over = true; st.winner = 'B'; break; }
      else if (st.tricks.length === 13) { st.over = true; break; }
    }
    st.trickNum++;
  }
  if (!st.over) throw new Error('round did not terminate (guard exhausted)');

  const errs = checkInvariants(st);
  if (errs.length) throw new Error('invariant violations: ' + errs.join(' | '));

  return {
    tricks: st.tricks,
    tricksWon: { ...st.tricksWon },
    winner: st.winner,
    kot: !!st.kot,
    bam: !!st.bam,
    bamAsked: !!st.bamAsked,
    // transcript: a compact, JSON-portable record of the whole round — the object
    // that makes determinism a deepEqual check.
    transcript: st.tricks.map((t) => ({
      trick: t.trickNum,
      starter: t.plays[0].player,
      leadSuit: t.leadSuit,
      plays: t.plays.map((p) => [p.player, p.card.suit, p.card.rank]),
      winner: t.winner,
      team: t.team,
      scoreAfter: { A: 0, B: 0 },
    })),
  };
}

// ---------- full game (spec §5): one seed, one RNG, one replayable transcript ----------
// Mirrors game.js's match loop: rounds are played until a team reaches 7 points (or a
// Kot-bam ends the match). ALL match randomness — initial hakem, every shuffle/deal
// and every bam request — is drawn from the single seeded RNG, so the same seed
// replays the identical game forever. The Decision Engine never touches the RNG.
//
// Modeling note: in the live game a HUMAN declarer picks trump and decides bam
// requests interactively; a headless replay has no human, so both are taken from the
// seeded RNG / the declarer heuristic. That keeps the transcript a pure function of
// the seed.
const TEAM_OF = { 1: 'A', 2: 'B', 3: 'A', 4: 'B' };

export function simulateGame({ seed, rng: rngIn } = {}) {
  const rng = rngIn || mulberry32(seed >>> 0);
  const score = { A: 0, B: 0 };
  let hakem = Math.floor(rng() * 4) + 1;   // game.js startGame
  const rounds = [];
  let guard = 0;
  while (score.A < 7 && score.B < 7 && guard++ < 80) {
    const deck = shuffle(makeDeck(), rng);           // startRound → dealFirst
    // the hakem's first 5 dealt cards (dealOrder deals the hakem last in each of the
    // 5 initial rounds → deck indices 3,7,11,15,19) select trump, as in the live game
    const first5 = [3, 7, 11, 15, 19].map((i) => deck[i]);
    const trump = pickAiTrump(first5);
    const r = simulateRound({ deck, hakem, trump, bamPolicy: () => rng() < 0.15 });

    // apply the round exactly as game.js endRound/handleKot/bamAccept/bamDecline do
    const roundWinner = r.winner || (r.tricksWon.A >= 7 ? 'A' : 'B');
    const pts = r.kot ? getKotPoints({ hakem, players: { [hakem]: { team: TEAM_OF[hakem] } } }, roundWinner) : 1;
    score[roundWinner] += pts;
    if (r.bamAsked && !r.bam) score[roundWinner] += 1; // bam failed → endRound adds the trick point

    rounds.push({
      round: rounds.length + 1, hakem, trump, deck,
      kot: !!r.kot, bam: !!r.bam, bamAsked: !!r.bamAsked,
      tricks: r.tricks, tricksWon: r.tricksWon,
      winner: roundWinner, points: pts, scoreAfter: { ...score },
    });

    if (r.bam) return { rounds, score, winner: roundWinner, bam: true, seed: seed ?? null };
    // endRound/handleKot: the dealer's seat keeps the deal when their team won the round
    if (roundWinner !== TEAM_OF[hakem]) hakem = NEXT[hakem];
  }
  const winner = score.A >= 7 ? 'A' : score.B >= 7 ? 'B' : null;
  return { rounds, score, winner, bam: false, seed: seed ?? null };
}

// Post-process the transcript with running scores (kept out of the hot loop).
export function withRunningScore(res) {
  let a = 0, b = 0;
  for (const t of res.transcript) {
    if (t.team === 'A') a++; else b++;
    t.scoreAfter = { A: a, B: b };
  }
  return res;
}

// Deterministic seeded deck for repeatable runs: mulberry32 over a full shuffle.
// The AI itself never calls this — randomness lives ONLY in deck construction.
export function seededDeck(seed) {
  return shuffle(makeDeck(), mulberry32(seed));
}
