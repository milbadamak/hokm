// Hokm game flow controller. Mirrors old index.html control flow (startGame ->
// startRound -> dealFirst -> selectTrump -> dealRest -> startTrick -> nextTurn ->
// endTrick -> handleKot/endRound -> checkGameEnd/showEnd) bit-for-bit, with all
// presentation effects (delay/sfx/render/popup) injected via `view`.
import {
  SUITS, NEXT, PARTNER, SYMBOLS, makeDeck, shuffle, sortHand, trickWinner,
  getKotPoints, cardVal, cmpCards, playable, recordSignal,
} from './rules.js';
import { aiPick, pickAiTrump } from './ai.js';
import { snapshotTrickStart, appendToSnapshot } from './advisor.js';

export function createState() {
  return {
    players: {
      1: { name: 'شما', hand: [], team: 'A' },
      2: { name: 'حریف۱', hand: [], team: 'B' },
      3: { name: 'یار', hand: [], team: 'A' },
      4: { name: 'حریف۲', hand: [], team: 'B' },
    },
    hakem: null, trump: null, trumpMode: 'normal',
    trick: [], leadSuit: null, current: null, starter: null,
    tricksWon: { A: 0, B: 0 }, score: { A: 0, B: 0 },
    trickNum: 0, phase: 'idle', processing: false,
    selectedCard: null, deck: [],
    memory: { played: [], voids: {}, aces: {}, kings: {}, signals: [], tricks: [] },
    kotTeam: null, kotPoints: 0, bamMode: false, roundHistory: [], lastTrick: null,
  };
}

// view: { delay(ms), sfx(name), renderTableCard(pid, card), renderHand(), updateUI(),
//         showPopup(text), hidePopup(), showTrumpPicker(), showKot(msg), showRound(title, html),
//         showEnd(title, html), saveG(s), clearTable() }
export function createGame(view, rng = Math.random, storage = null) {
  const G = createState();
  // decision-time snapshots per trick (for Analysis) — kept OUTSIDE G so saves
  // stay small; exposed via getTrickSnap().
  const trickSnaps = {};

// deal order follows play order: start at the seat after the dealer (hakem), end
// at hakem itself. With NEXT = 1→4→3→2→1 this is counter-clockwise (real Hokm).
function dealOrder(hakem) {
  const seq = [];
  let p = hakem;
  for (let i = 0; i < 3; i++) { p = NEXT[p]; seq.push(p); }
  seq.push(hakem);
  return seq; // e.g. hakem=1 → [4, 3, 2, 1]
}
  async function doPlayCard(pid, c, recommended = null) {
    view.sfx('cardPlay');
    const h = G.players[pid].hand;
    const i = h.findIndex((x) => x.suit === c.suit && x.rank === c.rank);
    if (i > -1) h.splice(i, 1);
    const necessary = G.trick.length === 0 && G.trumpMode === 'normal' && c.suit === G.trump;
    // signal-quality bookkeeping: was this follow-suit card FORCED (no lower card
    // in the led suit available)? voluntary strong cards are real partner signals.
    let forcedFollow = false;
    if (G.leadSuit && c.suit === G.leadSuit) {
      const same = h.filter((x) => x.suit === G.leadSuit);
      forcedFollow = same.every((x) => cardVal(x, G.trumpMode) >= cardVal(c, G.trumpMode));
    }
    // §4 PARTNER_CONTINUATION_SIGNAL candidate: I follow the led suit with a LOWER
    // card than partner's currently-winning one while STILL holding a higher card of
    // that suit ("the suit is guarded — lead it again"). Recorded as a signal only if
    // the partner actually takes the trick (endTrick). Own-hand info only, no hiding.
    let contSignal = false;
    if (G.trick.length && G.leadSuit && c.suit === G.leadSuit) {
      let w = G.trick[0];
      for (const t of G.trick) if (cmpCards(t.card, w.card, G.leadSuit, G.trumpMode, G.trump) > 0) w = t;
      if (w.player === PARTNER[pid] &&
          cardVal(c, G.trumpMode) < cardVal(w.card, G.trumpMode) &&
          h.some((x) => x.suit === c.suit && cardVal(x, G.trumpMode) > cardVal(c, G.trumpMode))) {
        contSignal = true;
      }
    }
    G.trick.push({ player: pid, card: c, necessary, recommended, forcedFollow, contSignal });
    if (G.trick.length === 1) G.leadSuit = c.suit;
    if (trickSnaps[G.trickNum]) appendToSnapshot(trickSnaps[G.trickNum], { player: pid, card: c });
    G.memory.played.push({ ...c });
    if (c.rank === 'A') G.memory.aces[c.suit] = true;
    if (c.rank === 'K') G.memory.kings[c.suit] = true;
    if (G.leadSuit && c.suit !== G.leadSuit) {
      if (!G.memory.voids[pid]) G.memory.voids[pid] = [];
      if (!G.memory.voids[pid].includes(G.leadSuit)) G.memory.voids[pid].push(G.leadSuit);
    }
    view.renderTableCard(pid, c, necessary);
    if (pid === 1) view.renderHand();
    if (necessary) {
      view.showPopup(`${G.players[pid].name}: لازم!`);
      await view.delay(900);
      view.hidePopup();
    }
  }

  async function nextTurn() {
    if (G.trick.length === 4) { await endTrick(); return; }
    G.current = NEXT[G.current];
    view.updateUI();
    if (G.current !== 1) {
      await view.delay(550);
      await doPlayCard(G.current, aiPick(G, G.current));
      await nextTurn();
    } else {
      G.processing = false;
      G.selectedCard = null;
      view.renderHand();
    }
  }

  async function endTrick() {
    G.phase = 'trickEnd';
    const w = trickWinner(G.trick, G.leadSuit, G.trumpMode, G.trump);
    G.lastTrick = { entries: G.trick.map((t) => ({ player: t.player, card: t.card, necessary: t.necessary, recommended: t.recommended, forcedFollow: t.forcedFollow })), winner: w.player, trickNum: G.trickNum };

    // partner-answer signals (quality-aware, per AI spec):
    // • hakem leads trick 1 in a non-trump suit voluntarily → strong signal (2)
    // • a strong card played when the player COULD have played lower in that suit
    //   (voluntary) → signal weight 2; if it was their lowest / forced follow → 1.
    // • a trump ruff-win already recorded the suit void in doPlayCard; trump SIZE
    //   is never treated as strength evidence unless enough was observed.
    const leaderEntry = G.trick[0];
    if (G.trickNum === 1 && leaderEntry.player === G.hakem && !leaderEntry.necessary) {
      recordSignal(G, leaderEntry.player, leaderEntry.card.suit, 2);
    }
    for (const t of G.trick) {
      if (t.player === leaderEntry.player) continue;
      if (t.card.suit !== G.leadSuit) continue; // following only, never ruffs
      if (t.player === w.player) continue;       // they actually won — real trick, not a signal
      if (cardVal(t.card, G.trumpMode) >= 7) {
        // quality: forced (no lower card in suit to shed) → weak signal 1,
        // voluntary strong card → full signal 2 (ruff-size never = trump strength)
        recordSignal(G, t.player, t.card.suit, t.forcedFollow ? 1 : 2);
      }
    }
    // §4 PARTNER_CONTINUATION_SIGNAL: the duck happened AND the partner actually took
    // the trick → "this suit is guarded in my hand, lead it again" (weight 2).
    for (const t of G.trick) {
      if (t.contSignal && w.player === PARTNER[t.player]) {
        recordSignal(G, t.player, t.card.suit, 2);
      }
    }

    G.tricksWon[G.players[w.player].team]++;
    // §6 knowledge: completed-trick history — leadSuit, every play, the winner and
    // her team. This is exactly what a human at the table would remember; the AI
    // reads it via buildMemory().tricks.
    if (!G.memory.tricks) G.memory.tricks = [];
    G.memory.tricks.push({
      trickNum: G.trickNum,
      leadSuit: G.leadSuit,
      winner: w.player,
      team: G.players[w.player].team,
      plays: G.trick.map((t) => ({ player: t.player, card: { ...t.card } })),
    });
    view.sfx(G.players[w.player].team === 'A' ? 'trickWinUs' : 'trickWinThem');
    view.updateUI();
    view.showPopup(`${G.players[w.player].name} برد!`);
    await view.delay(1000);
    view.hidePopup();
    G.starter = w.player;

    if (G.bamMode) {
      if (G.tricksWon[G.kotTeam] === 13) {
        logRound({ tricksA: G.tricksWon.A, tricksB: G.tricksWon.B, winner: G.kotTeam, pts: G.kotPoints, trump: currentTrumpLabel(), kot: true, bam: true });
        showEnd(G.kotTeam, true);
        return;
      }
      if (G.trickNum === 13) { await endRound(); return; }
      await startTrick();
      return;
    }

    if (G.tricksWon.A === 7 && G.tricksWon.B === 0) { await handleKot('A'); return; }
    if (G.tricksWon.B === 7 && G.tricksWon.A === 0) { await handleKot('B'); return; }
    if (G.tricksWon.A >= 7 || G.tricksWon.B >= 7) { await endRound(); return; }
    if (G.trickNum === 13) { await endRound(); return; }
    await startTrick();
  }

  function currentTrumpLabel() {
    if (G.trumpMode === 'normal') return G.trump ? SYMBOLS[G.trump] : '-';
    if (G.trumpMode === 'ners') return '(2) نرس';
    if (G.trumpMode === 'asners') return '(A2) آسنرس';
    return '(A) سرس';
  }

  function logRound(entry) { G.roundHistory.push(entry); }

  async function handleKot(team) {
    G.kotTeam = team;
    G.kotPoints = getKotPoints(G, team);
    if (team === 'A') {
      view.sfx('kotUs');
      view.showKot(`کت کردید! (+${G.kotPoints} امتیاز)`);
    } else {
      view.sfx('kotThem');
      G.score[team] += G.kotPoints;
      view.updateUI();
      if (rng() < 0.15) {
        G.bamMode = true;
        view.showPopup('حریف درخواست بام!');
        await view.delay(1500);
        view.hidePopup();
        await startTrick();
      } else {
        logRound({ tricksA: G.tricksWon.A, tricksB: G.tricksWon.B, winner: team, pts: G.kotPoints, trump: currentTrumpLabel(), kot: true, bam: false });
        const hTeam2 = G.players[G.hakem].team;
        if (team !== hTeam2) G.hakem = NEXT[G.hakem];
        if (checkGameEnd()) return;
        view.showRound('کت شدید!', `+${G.kotPoints} امتیاز حریف<br><br>کل: ${G.score.A} - ${G.score.B}`, 'them');
      }
    }
  }

  async function endRound() {
    G.phase = 'roundEnd';
    let winner = null, pts = 0;
    if (G.tricksWon.A >= 7) { winner = 'A'; pts = 1; G.score.A += 1; }
    else if (G.tricksWon.B >= 7) { winner = 'B'; pts = 1; G.score.B += 1; }
    logRound({ tricksA: G.tricksWon.A, tricksB: G.tricksWon.B, winner, pts, trump: currentTrumpLabel(), kot: !!G.kotTeam, bam: false });
    view.updateUI();
    const hTeam = G.players[G.hakem].team;
    if (winner && winner !== hTeam) G.hakem = NEXT[G.hakem];
    if (checkGameEnd()) return;
    view.showRound(winner === 'A' ? 'برنده شدید!' : 'باختید', `دستها: ${G.tricksWon.A} - ${G.tricksWon.B}<br>امتیاز: +${pts}<br><br>کل: ${G.score.A} - ${G.score.B}`, winner === 'A' ? 'us' : 'them');
  }

  function checkGameEnd() {
    if (G.score.A >= 7) { showEnd('A', false); return true; }
    if (G.score.B >= 7) { showEnd('B', false); return true; }
    return false;
  }

  function showEnd(w, isBam) {
    let title, msg;
    if (isBam) {
      title = w === 'A' ? '🎉 بام! برنده شدید!' : '💀 بام! باختید!';
      msg = 'با گرفتن ۱۳ دست، بازی تمام شد!';
      view.sfx(w === 'A' ? 'bam' : 'lose');
    } else {
      title = w === 'A' ? '🎉 برنده شدید!' : 'باختید!';
      msg = `${G.score.A} - ${G.score.B}`;
      view.sfx(w === 'A' ? 'win' : 'lose');
    }
    view.showEnd(title, msg, w);
    if (storage) storage.onGameEnd(w, G);
    if (storage) storage.clearSave();
  }

  async function startTrick() {
    G.trickNum++;
    G.trick = [];
    G.leadSuit = null;
    G.phase = 'play';
    G.processing = false;
    G.selectedCard = null;
    trickSnaps[G.trickNum] = snapshotTrickStart(G); // decision-time base for Analysis
    view.clearTable();
    if (G.trickNum === 1) G.starter = G.hakem;
    G.current = G.starter;
    view.updateUI();
    view.renderHand();
    if (G.current !== 1) {
      G.processing = true;
      await view.delay(550);
      await doPlayCard(G.current, aiPick(G, G.current));
      await nextTurn();
    }
  }

  async function dealRest() {
    const order = dealOrder(G.hakem);
    let i = 0;
    for (let r = 0; r < 8; r++) {
      for (const pid of order) {
        G.players[pid].hand.push(G.deck[20 + i++]);
      }
    }
    for (let p = 1; p <= 4; p++) G.players[p].hand = sortHand(G.players[p].hand, G.trump, G.trumpMode);
    view.renderHand();
    await view.delay(300);
    await startTrick();
  }

  function setTrump(mode, suit) {
    G.trumpMode = mode;
    G.trump = suit;
    view.updateUI();
  }

  async function selectTrump() {
    G.phase = 'trump';
    if (G.hakem === 1) {
      view.showTrumpPicker(sortHand(G.players[1].hand.slice(0, 5), null, 'normal'));
    } else {
      await view.delay(700);
      setTrump('normal', pickAiTrump(G.players[G.hakem].hand.slice(0, 5), G));
      await dealRest();
    }
  }

  async function dealFirst() {
    G.phase = 'deal';
    G.deck = shuffle(makeDeck(), rng);
    const order = dealOrder(G.hakem);
    let i = 0;
    for (let r = 0; r < 5; r++) {
      for (const pid of order) {
        G.players[pid].hand.push(G.deck[i++]);
      }
    }
    view.renderHand();
    await selectTrump();
  }

  async function startRound() {
    G.tricksWon = { A: 0, B: 0 };
    G.trickNum = 0;
    G.trump = null;
    G.trumpMode = 'normal';
    G.trick = [];
    G.leadSuit = null;
    G.kotTeam = null;
    G.kotPoints = 0;
    G.bamMode = false;
    G.lastTrick = null;
    G.processing = false;
    G.selectedCard = null;
    G.memory = { played: [], voids: {}, aces: {}, kings: {}, signals: [], tricks: [] };
    for (let i = 1; i <= 4; i++) G.players[i].hand = [];
    view.updateUI();
    view.clearTable();
    await dealFirst();
  }

  function startGame() {
    if (storage) storage.clearSave();
    G.score = { A: 0, B: 0 };
    G.roundHistory = [];
    G.hakem = Math.floor(rng() * 4) + 1;
    return startRound();
  }

  // Human picks a card via UI. Mirrors old playCardHuman.
  async function playHuman(c) {
    G.processing = true;
    const recommended = aiPick(G, 1);
    await doPlayCard(1, c, recommended);
    await nextTurn();
  }

  // Human declarer finished picking trump in the modal.
  async function humanChoseTrump(mode, suit) {
    setTrump(mode, suit);
    await dealRest();
  }

  async function continueFrom(loaded) {
    Object.assign(G, createState());
    G.players = loaded.players; G.hakem = loaded.hakem; G.trump = loaded.trump;
    G.trumpMode = loaded.trumpMode; G.trick = loaded.trick; G.leadSuit = loaded.leadSuit;
    G.current = loaded.current; G.starter = loaded.starter; G.tricksWon = loaded.tricksWon;
    G.score = loaded.score; G.trickNum = loaded.trickNum; G.phase = loaded.phase;
    G.processing = false; G.selectedCard = null;
    G.deck = loaded.deck || [];
    G.memory = loaded.memory || { played: [], voids: {}, aces: {}, kings: {}, signals: [], tricks: [] };
    if (!G.memory.signals) G.memory.signals = [];
    G.kotTeam = loaded.kotTeam; G.kotPoints = loaded.kotPoints; G.bamMode = loaded.bamMode;
    G.roundHistory = loaded.roundHistory || []; G.lastTrick = loaded.lastTrick || null;
    view.clearTable();
    for (const t of G.trick) view.renderTableCard(t.player, t.card, t.necessary);
    view.renderHand();
    view.updateUI();
    if (G.current !== 1 && G.phase === 'play') {
      G.processing = true;
      await view.delay(550);
      await doPlayCard(G.current, aiPick(G, G.current));
      await nextTurn();
    }
  }

  // UI answers bam request (bamYes / bamNo)
  async function bamAccept() {
    G.score[G.kotTeam] += G.kotPoints;
    view.updateUI();
    G.bamMode = true;
    await startTrick();
  }
  async function bamDecline() {
    G.score[G.kotTeam] += G.kotPoints;
    view.updateUI();
    logRound({ tricksA: G.tricksWon.A, tricksB: G.tricksWon.B, winner: G.kotTeam, pts: G.kotPoints, trump: currentTrumpLabel(), kot: true, bam: false });
    const hTeam = G.players[G.hakem].team;
    if (G.kotTeam !== hTeam) G.hakem = NEXT[G.hakem];
    if (checkGameEnd()) return;
    view.showRound('کت کردید!', `+${G.kotPoints} امتیاز<br><br>کل: ${G.score.A} - ${G.score.B}`, 'us');
  }

  return {
    G, playable: (pid) => playable(G, pid), doPlayCard, nextTurn, startTrick, endTrick,
    startGame, startRound, playHuman, humanChoseTrump, continueFrom, bamAccept, bamDecline,
    currentTrumpLabel, checkGameEnd,
    trickSnaps, // read by Analysis (src/advisor.js → gradeMove)
  };
}
