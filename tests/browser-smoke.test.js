// tests/browser-smoke.test.js — real-browser smoke test of the built bundle.
//
// Loads index.html in headless Chrome/Edge over the DevTools protocol and plays full
// games to completion through the live DOM, capturing uncaught exceptions, console
// errors and failed asset loads. Skips gracefully when no Chromium browser is found.
//
// Presentation pacing (the AI's between-card delays) is collapsed to instant via a
// pre-document setTimeout wrapper — the same technique tests/app-smoke.test.js uses
// in its VM sandbox. The shipped bundle itself is never modified.
// browser smoke: real Chromium plays a full, seeded game through the live DOM.
//
// ?seed=N pins the whole game (hakem, deal, every AI decision) so the flow is
// reproducible: seed 7 makes the human the hakem, which forces the trump picker
// modal onto the exercised path. A game ends when a team reaches score 7.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const BUNDLE = path.resolve(root, 'index.html');

const CANDIDATES = [
  process.env.HOKM_BROWSER,
  path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);

function findBrowser() {
  for (const c of CANDIDATES) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch { /* permission/encoding quirk */ }
  }
  return null;
}

let nextId = 1;
class Cdp {
  constructor() { this.ws = null; this.pending = new Map(); this.events = []; }
  connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onerror = () => reject(new Error('CDP websocket error'));
      ws.onopen = () => resolve();
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        } else if (msg.method) {
          this.events.push(msg);
        }
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

const DRIVER = `(async () => {
  const log = [];
  document.getElementById('startBtn').click();
  let guard = 0, humanPlays = 0;
  // load → new game → deal → choose trump → play trick → next trick → rounds → game end.
  while (guard++ < 50000) {
    if (document.getElementById('endModal').classList.contains('show')) { log.push('END'); break; }
    if (document.getElementById('kotModal').classList.contains('show')) {
      document.getElementById('bamNo').click(); log.push('kot-declined'); continue;
    }
    if (document.getElementById('roundModal').classList.contains('show')) {
      log.push('round'); document.getElementById('nextRoundBtn').click(); continue;
    }
    if (document.getElementById('trumpModal').classList.contains('show')) {
      const b = document.querySelector('.trump-btn');
      if (!b) { log.push('trump-modal-no-button'); break; }
      log.push('trump:' + b.dataset.trump); b.click(); continue;
    }
    const hand = document.getElementById('handCards');
    const playable = Array.from(hand.children)
      .filter((el) => !el.classList.contains('disabled') && el.onclick);
    if (playable.length) {
      // select, then confirm — the same two-click gesture the UI requires
      playable[0].click(); playable[0].click(); humanPlays++; continue;
    }
    // not our turn: yield to the timer-driven AI chain
    await new Promise((r) => setTimeout(r, 5));
  }
  return {
    log,
    humanPlays,
    endVisible: document.getElementById('endModal').classList.contains('show'),
    endTitle: (document.getElementById('endTitle') || { textContent: '' }).textContent,
    endMsg: (document.getElementById('endMsg') || { textContent: '' }).textContent.trim(),
    scoreA: document.getElementById('scoreA').textContent,
    scoreB: document.getElementById('scoreB').textContent,
  };
})()`;

async function launchAndPlay(exe, bundleUrl) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hokm-smoke-'));
  // Bind and release a TCP port, then hand it to the browser: this Chrome build does
  // not write DevToolsActivePort, so port 0 + a port-file poll would hang.
  const port = await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
  const proc = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  // Never leak a headless browser if the test times out or throws.
  const killBrowser = () => { try { proc.kill('SIGKILL'); } catch { /* */ } };
  const watchdog = setTimeout(killBrowser, 90000);
  watchdog.unref();

  const browserWs = await new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const tryFetch = async () => {
      if (Date.now() > deadline) { reject(new Error('browser did not start')); return; }
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
        resolve((await r.json()).webSocketDebuggerUrl);
      } catch { setTimeout(tryFetch, 200); }
    };
    setTimeout(tryFetch, 300);
  });

  const cdp = new Cdp();
  await cdp.connect(browserWs);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  // Collapse presentation delays to instant so a full multi-round game finishes in
  // seconds. Injected before navigation, so it applies to the bundle's own timers.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'const o = window.setTimeout; window.setTimeout = (fn) => o(fn, 0);',
  }, sessionId);
  await cdp.send('Page.navigate', { url: bundleUrl }, sessionId);
  await new Promise((r) => setTimeout(r, 1500));

  const res = await cdp.send('Runtime.evaluate', {
    expression: DRIVER, awaitPromise: true, returnByValue: true,
  }, sessionId);
  if (res.exceptionDetails) {
    throw new Error('driver failed: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
  }
  const run = res.result.value;

  // Every error class CDP surfaces: uncaught exceptions, console.error, and Log entries
  // (the latter include failed resource loads such as missing fonts/icons).
  const exceptions = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
  const consoleErrors = cdp.events.filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
    .map((e) => e.params.args.map((a) => a.value || a.description || '').join(' '));
  const logErrors = cdp.events.filter((e) => e.method === 'Log.entryAdded')
    .map((e) => e.params.entry)
    .filter((en) => en.level === 'error' || en.level === 'severe' || /Failed to load|net::ERR|404/i.test(en.text))
    .map((en) => en.text);

  clearTimeout(watchdog);
  try { await cdp.send('Target.closeTarget', { targetId }); } catch { /* already gone */ }
  killBrowser();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* */ }

  return { run, exceptions, consoleErrors, logErrors };
}

const exe = findBrowser();
const hasBundle = fs.existsSync(BUNDLE);
const SEED = 7; // human is hakem → the trump picker modal is exercised

test('browser smoke: full game in headless Chromium, zero runtime errors', {
  skip: (!exe || !hasBundle)
    ? `skipped: ${!exe ? 'no Chromium browser found' : 'no index.html bundle'}`
    : undefined,
  timeout: 120000,
}, async () => {
  const bundleUrl = 'file:///' + BUNDLE.replace(/\\/g, '/') + '?seed=' + SEED;
  const r = await launchAndPlay(exe, bundleUrl);
  const { run } = r;

  assert.ok(run.endVisible, 'game reached the end screen; log tail: ' + JSON.stringify(run.log.slice(-5)));
  assert.ok(run.log.includes('END'), 'the driver saw the end modal');
  assert.ok(run.humanPlays >= 13, 'the human played at least a full round (>= 13 cards), got ' + run.humanPlays);
  assert.ok(run.log.some((x) => x.startsWith('trump:')), 'the trump picker modal was reached and used');
  assert.ok(run.log.some((x) => x === 'round'), 'at least one round completed and was acknowledged');
  // a game ends exactly when a team reaches score 7
  assert.ok(Number(run.scoreA) === 7 || Number(run.scoreB) === 7,
    `game ended at ${run.scoreA}-${run.scoreB}, expected a team at 7`);
  // seed 7 is fully determined — pinning the final score proves the seeded browser
  // game replays (the controller-level byte-identical check is in tests/game.test.js)
  assert.equal(run.scoreA, '6', 'seed 7 replays to a fixed score');
  assert.equal(run.scoreB, '7', 'seed 7 replays to a fixed score');
  assert.ok(run.endTitle.trim().length > 0, 'the winner screen shows a title');
  assert.ok(run.endMsg.trim().length > 0, 'the winner screen shows the final score line');

  assert.deepEqual(r.exceptions, [], 'uncaught exceptions: ' + JSON.stringify(r.exceptions));
  assert.deepEqual(r.consoleErrors, [], 'console.error calls: ' + JSON.stringify(r.consoleErrors));
  assert.deepEqual(r.logErrors, [], 'browser log errors / failed asset loads: ' + JSON.stringify(r.logErrors));
});
