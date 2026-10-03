// Oracle harness: runs the REAL old game script from Hokm-main/index.html inside a VM
// with a minimal DOM/localStorage stub, and exposes its internals (G, aiPick, ...).
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  path.resolve(__dirname, '../../Hokm-main/index.html'),
  path.resolve(__dirname, '../../../Hokm-main/index.html'),
];
export const ORACLE_PATH = CANDIDATES.find(fs.existsSync) || null;
export function oracleAvailable() { return !!ORACLE_PATH; }

export function oldScriptText() {
  const file = ORACLE_PATH;
  if (!file) throw new Error('Hokm-main/index.html (oracle) not found. Checked: ' + CANDIDATES.join(' | '));
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<script>\r?\n([\s\S]*?)<\/script>/);
  if (!m) throw new Error('inline <script> block not found in ' + file);
  return m[1];
}

function makeEl(id) {
  return {
    id, textContent: '', innerHTML: '', className: '', style: {},
    children: [], title: '', dataset: {},
    classList: {
      _s: new Set(),
      add(...c) { for (const x of c) this._s.add(x); },
      remove(...c) { for (const x of c) this._s.delete(x); },
      toggle(c, force) { if (force === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { force ? this._s.add(c) : this._s.delete(c); } },
      contains(c) { return this._s.has(c); },
    },
    appendChild(ch) { this.children.push(ch); return ch; },
    querySelector() { return makeEl('q'); },
    setAttribute() {}, removeAttribute() {},
  };
}

export function newOldCtx() {
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Math, JSON, Date, Object, Array,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, String, Number,
    Set, Map, Symbol, RegExp, Error, Infinity, NaN, undefined,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { serviceWorker: undefined },
    location: { reload() {} },
    confirm: () => false,
    caches: undefined,
    fetch: undefined,
    document: {
      getElementById: (id) => makeEl(id),
      createElement: (t) => makeEl(t),
      querySelectorAll: () => [],
      addEventListener() {},
      body: makeEl('body'),
    },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext('var window = globalThis; var self = globalThis;', sandbox);
  // inject exports at the end of the old IIFE (last `})();` = close of main game IIFE)
  const EXPORTS = '{G, aiPick, cardVal, cmpCards, trickWinner, sortHand, playable, makeDeck, shuffle, unaccountedHigherRanks, suitThreatExists, trumpCutThreatExists, isSecureWin, riskAppetite, topTrumpRunLength, recordSignal, partnerSignalWeight, opponentsOf, stillToActPlayers, getKotPoints}';
  const script = oldScriptText();
  const idx = script.lastIndexOf('})();');
  if (idx === -1) throw new Error('unreachable: old script has no IIFE close');
  const patched = script.slice(0, idx) + `\nglobalThis.__HOKM = Object.assign({}, ${EXPORTS});\n` + script.slice(idx);
  vm.runInContext(patched, sandbox, { filename: 'old-index-inline.js' });
  return sandbox.__HOKM;
}
