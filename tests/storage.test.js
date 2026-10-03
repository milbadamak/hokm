import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveGame, loadGame, clearSave, SAVE_KEY, updateStatsOnGameEnd, loadStats } from '../src/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/vendor/lz-string.min.js'), 'utf8'), ctx);
const lz = ctx.LZString;
assert.equal(typeof lz.compressToUTF16, 'function');

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}

test('save round-trips through UTF-16 compression', () => {
  const store = memStore();
  const state = { players: { 1: { hand: [{ suit: 'spades', rank: 'A' }] } }, phase: 'play', trickNum: 7, memory: { played: [], voids: {}, aces: { spades: true }, kings: {}, signals: [] } };
  saveGame(lz, store, state);
  assert.ok(store._m.get(SAVE_KEY).length < JSON.stringify(state).length + 50);
  const back = loadGame(lz, store);
  assert.deepEqual(back, state);
});

test('legacy plain-JSON save still loads', () => {
  const store = memStore();
  store.setItem(SAVE_KEY, JSON.stringify({ phase: 'play', x: 1 }));
  assert.deepEqual(loadGame(lz, store), { phase: 'play', x: 1 });
});

test('clearSave removes key; corrupt payload yields null', () => {
  const store = memStore();
  saveGame(lz, store, { a: 1 });
  clearSave(store);
  assert.equal(loadGame(lz, store), null);
  store.setItem(SAVE_KEY, '{{{not json');
  assert.equal(loadGame(lz, store), null);
});

test('stats update matches old formula', () => {
  const store = memStore();
  const G = { roundHistory: [{ kot: true, winner: 'A' }, { bam: true, winner: 'A' }, { kot: true, winner: 'B' }] };
  const s = updateStatsOnGameEnd(store, 'A', G);
  assert.deepEqual(s, { gamesPlayed: 1, gamesWon: 1, gamesLost: 0, kots: 1, bams: 1 });
  assert.deepEqual(loadStats(store), s);
});
