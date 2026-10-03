// Hokm persistence. Same localStorage keys as the original app; the in-progress
// game save is now LZ-compressed (UTF-16) to shrink the cached blob. Load falls
// back to plain JSON so old saves still resume.
export const SAVE_KEY = 'hokm_save_v1';
export const STATS_KEY = 'hokm_stats_v1';
export const SOUND_KEY = 'hokm_sound_v1';

export function saveGame(lz, store, state) {
  try { store.setItem(SAVE_KEY, lz.compressToUTF16(JSON.stringify(state))); } catch (e) { /* quota/no-store */ }
}

export function loadGame(lz, store) {
  const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
  try {
    const raw = store.getItem(SAVE_KEY);
    if (!raw) return null;
    return parse(lz.decompressFromUTF16(raw)) || parse(raw); // compressed first, legacy plain-JSON fallback
  } catch (e) { return null; }
}

export function clearSave(store) {
  try { store.removeItem(SAVE_KEY); } catch (e) { /* noop */ }
}

export function defaultStats() {
  return { gamesPlayed: 0, gamesWon: 0, gamesLost: 0, kots: 0, bams: 0 };
}

export function loadStats(store) {
  try {
    const raw = store.getItem(STATS_KEY);
    return raw ? Object.assign(defaultStats(), JSON.parse(raw)) : defaultStats();
  } catch (e) { return defaultStats(); }
}

export function saveStats(store, s) {
  try { store.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) { /* noop */ }
}

// old updateStatsOnGameEnd (index.html 1118-1128)
export function updateStatsOnGameEnd(store, winner, G) {
  const s = loadStats(store);
  s.gamesPlayed++;
  if (winner === 'A') s.gamesWon++; else s.gamesLost++;
  for (const r of G.roundHistory) {
    if (r.kot && r.winner === 'A') s.kots++;
    if (r.bam && r.winner === 'A') s.bams++;
  }
  saveStats(store, s);
  return s;
}
