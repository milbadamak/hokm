// Integration smoke test: boots src/app.js against a minimal DOM stub built from the
// real index-dev.html element IDs, then plays a whole game through the DOM handlers.
// Proves UI wiring (ids, modals, handlers, storage glue) works without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function makeEl(id) {
  const el = {
    id, textContent: '', _innerHTML: '', className: '', style: {}, children: [],
    dataset: {}, title: '', onclick: null,
    classList: {
      _s: new Set(),
      add(...c) { for (const x of c) this._s.add(x); },
      remove(...c) { for (const x of c) this._s.delete(x); },
      toggle(c, force) { force ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(ch) { this.children.push(ch); return ch; },
    querySelector() { return makeEl('q'); },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._innerHTML; },
    set(v) { this._innerHTML = v; if (v === '') el.children = []; },
  });
  return el;
}

const html = fs.readFileSync(path.resolve(root, 'index-dev.html'), 'utf8');
const idRe = /<[^>]*id="([\w]+)"[^>]*>/g;
let mm;
const byId = new Map();
while ((mm = idRe.exec(html))) {
  const el = makeEl(mm[1]);
  const cls = mm[0].match(/class="([^"]*)"/);
  if (cls) for (const c of cls[1].split(/\s+/)) if (c) el.classList.add(c);
  byId.set(mm[1], el);
}
assert.ok(byId.size > 30, 'parse element ids from index-dev.html');
const trumpBtns = ['spades', 'hearts', 'diamonds', 'clubs', 'ners', 'asners', 'sers'].map((t) => {
  const b = makeEl('trump-btn');
  b.dataset.trump = t;
  return b;
});

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  getElementById: (id) => { if (!byId.has(id)) throw new Error('missing #' + id); return byId.get(id); },
  createElement: (t) => makeEl(t),
  querySelectorAll: (sel) => (sel === '.trump-btn' ? trumpBtns : []),
  addEventListener: () => {},
};
globalThis.confirm = () => true;
globalThis.location = { reload: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn) => { fn(); return 0; }; // make delay() instant for the test

const lzCtx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(root, 'src/vendor/lz-string.min.js'), 'utf8'), lzCtx);
globalThis.window = globalThis;
globalThis.LZString = lzCtx.LZString;

await import('../src/app.js');

async function tick(n = 30) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

test('boot: start screen visible, continue hidden without save', () => {
  assert.ok(byId.get('startScreen').classList.contains('hidden') === false);
  assert.ok(byId.get('continueBtn').classList.contains('hidden'));
});

test('start game, play to completion through DOM handlers', { timeout: 60000 }, async () => {
  byId.get('startBtn').onclick();
  await tick();
  let guard = 0;
  const played = [];
  while (guard++ < 3000) {
    if (byId.get('endModal').classList.contains('show')) break;
    if (byId.get('kotModal').classList.contains('show')) { byId.get('bamNo').onclick(); await tick(); continue; }
    if (byId.get('roundModal').classList.contains('show')) { byId.get('nextRoundBtn').onclick(); await tick(); continue; }
    if (byId.get('trumpModal').classList.contains('show')) { trumpBtns[0].onclick(); await tick(); continue; }
    const hand = byId.get('handCards');
    const playableCards = hand.children.filter((el) => !el.classList.contains('disabled') && el.onclick);
    if (playableCards.length) {
      const el = playableCards[0];
      el.onclick(); el.onclick();
      played.push(el._innerHTML);
      await tick();
    } else {
      await new Promise((r) => realSetTimeout.call(globalThis, r, 0));
    }
  }
  assert.ok(byId.get('endModal').classList.contains('show'), 'reached end screen (played ' + played.length + ' tricks)');
  assert.ok(played.length >= 13, 'human played full rounds');
  const stats = JSON.parse(store.get('hokm_stats_v1'));
  assert.ok(stats.gamesPlayed >= 1);
  assert.equal(store.has('hokm_save_v1'), false, 'save cleared at game end');
});
