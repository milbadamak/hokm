// Proves the single-file bundle boots and a full game can be played — same way a
// browser would run it on file:// (classic scripts, no CORS, no module loader).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/bundle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = build();

// The committed bundle must be byte-identical to what the sources build today — a
// stale index.html silently ships an engine that differs from src/ (spec §11).
test('bundle: the on-disk index.html is in sync with the current sources', () => {
  const onDisk = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  assert.equal(onDisk, html,
    'index.html is stale — rebuild with `npm run bundle` (node tools/bundle.js)');
});

test('bundle: no module/external refs, fonts inlined', () => {
  assert.ok(!/type="module"/.test(html), 'no ES module tags');
  assert.ok(!/src="src\/app\.js"/.test(html), 'app.js inlined');
  assert.ok(!/href="css\/style\.css"/.test(html), 'css inlined');
  assert.ok(!/href="manifest\.json"/.test(html), 'manifest linked only at runtime under http');
  assert.ok(html.includes('data:font/woff2;base64,'), 'fonts base64-embedded');
});

function makeEl(id) {
  const el = {
    id, textContent: '', _innerHTML: '', className: '', style: {}, children: [],
    dataset: {}, title: '', onclick: null,
    classList: {
      _s: new Set(),
      add(...c) { for (const x of c) this._s.add(x); },
      remove(...c) { for (const x of c) this._s.delete(x); },
      toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(ch) { this.children.push(ch); return ch; },
    querySelector() { return makeEl('q'); },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._innerHTML; },
    set(v) { el._innerHTML = v; if (v === '') el.children = []; },
  });
  return el;
}

test('bundle: full game playable with the bundled scripts as the browser runs them', async () => {
  const idRe = /<[^>]*id="([\w]+)"[^>]*>/g;
  let mm;
  const byId = new Map();
  while ((mm = idRe.exec(html))) {
    const el = makeEl(mm[1]);
    const cls = mm[0].match(/class="([^"]*)"/);
    if (cls) for (const c of cls[1].split(/\s+/)) if (c) el.classList.add(c);
    byId.set(mm[1], el);
  }
  const trumpBtns = ['spades', 'hearts', 'diamonds', 'clubs'].map((t) => {
    const b = makeEl('tb'); b.dataset.trump = t; return b;
  });
  const store = new Map();
  const sandbox = {
    console, Math, JSON, Date, Promise, Object, Array, Set, Map, RegExp, Error, String, Number,
    parseInt, parseFloat, isNaN, Infinity, NaN, Symbol, encodeURIComponent,
    URLSearchParams,
    setTimeout: (fn) => { fn(); return 0; },
    setImmediate,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      getElementById: (id) => byId.get(id),
      createElement: (t) => makeEl(t),
      querySelectorAll: (s) => (s === '.trump-btn' ? trumpBtns : []),
      head: { appendChild() {} },
      addEventListener: () => {},
    },
    navigator: {},
    location: { protocol: 'file:', reload: () => {} },
    confirm: () => true,
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  // run every inline <script> exactly in document order, like the browser would
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 3, 'lz-string + app + pwa guard inlined');
  for (const s of scripts) vm.runInContext(s, sandbox, { filename: 'hokm-inline.js' });
  assert.equal(typeof sandbox.LZString, 'object', 'lz-string global present');

  byId.get('startBtn').onclick();
  let guard = 0;
  const pump = async (turns = 200) => { for (let i = 0; i < turns; i++) await null; };
  while (guard++ < 300 && !byId.get('endModal').classList.contains('show')) {
    if (byId.get('kotModal').classList.contains('show')) { byId.get('bamNo').onclick(); await pump(); continue; }
    if (byId.get('roundModal').classList.contains('show')) { byId.get('nextRoundBtn').onclick(); await pump(); continue; }
    if (byId.get('trumpModal').classList.contains('show')) { trumpBtns[0].onclick(); await pump(); continue; }
    const playableCards = byId.get('handCards').children.filter((el) => el.onclick && !el.classList.contains('disabled'));
    if (playableCards.length) { const el = playableCards[0]; el.onclick(); el.onclick(); }
    await pump(); // drain the engine's microtask chain (setTimeout is instant in the sandbox)
  }
  assert.ok(byId.get('endModal').classList.contains('show'), 'reached end screen (guard=' + guard + ')');
  assert.ok(store.has('hokm_stats_v1'), 'stats persisted');
});
