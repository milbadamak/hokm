# Hokm Engine

A deterministic [Hokm](https://en.wikipedia.org/wiki/Hokm) (حکم) card-game engine
with a browser UI. Four-player partnership play against a card-counting AI, with
three Iranian no-trump variants (ners / asners / sers) beside classic trump play.

- **Deterministic** — the same seed replays byte-identically; zero hidden randomness
  in the decision path.
- **Browser-based** — a single-page RTL app, dark/light themes, mobile-first layout.
- **Self-contained** — `index.html` is the whole runtime. No CDN, no network calls,
  no build step required to play.
- **No external runtime dependency** — fonts, CSS, and JavaScript are all inlined.

## Run

Open **`index.html`** in any modern browser. That is the entire installation.

```
index.html
```

This works over `file://` by double-click — that is the point of the bundle. The
only browser features unavailable on `file://` are PWA install and the service
worker (a browser security rule for `file://` origins, not a bug in this project).
For the installable/offline PWA, serve the folder over HTTP:

```bash
node tools/serve.js        # http://localhost:8642
```

## Repository layout

```
index.html               RELEASE RUNTIME — bundled app (CSS+fonts+JS inlined)
index-dev.html           modular dev shell (loads src/app.js as an ES module)
manifest.json            PWA manifest (relative paths, works on any base path)
sw.js                    service worker (http(s) only)
favicon.ico              icons
icon-192.png
icon-512.png
css/style.css            glass + neumorphic design (dark/light, mobile-first)
fonts/                   Vazirmatn + Lalezar woff2 (offline)
src/
  rules.js               pure engine: cards, ranks, trick winner (no DOM)
  knowledge.js           played cards, voids, holders, trick history
  risk.js                score gap, endgame, anti-kot
  decision.js            move scoring + reasons (deterministic)
  positions.js           per-position policies: LEADER/SECOND/THIRD/FOURTH
  ai.js                  aiPick + trump bidding (pure over state)
  game.js                phase controller: deal → bid → trick → kot/bam → round → game
  simulate.js            deterministic full-round simulation + invariant checker
  storage.js             localStorage + LZ-UTF16 save compression
  advisor.js             analysis + coach hints (same engine, no hindsight)
  app.js                 DOM controller (render/input/sound)
  vendor/lz-string.min.js  offline LZ-string compression
tests/                   node --test suite (see Verification)
tools/
  bundle.js              zero-dependency bundler: index-dev.html → index.html
  serve.js               zero-dependency static server for local PWA testing
```

**Runtime vs source.** `index.html` is the shipped runtime and does not read any
other file at play time. `src/`, `css/`, `fonts/`, and `index-dev.html` are the
human-readable sources it is built from; they are kept in the repository for
readability and development, not because the runtime needs them.

## Architecture

The engine is a layered pipeline, each layer pure over game state:

```
rules.js ──► knowledge.js ──► risk.js ──► decision.js ──► positions.js ──► ai.js
   card math    memory of play    score context   move scoring    seat policy    choice
                                                                        │
                                                          game.js ◄──────┘
                                                     (phase controller)
                                                          │
                                               app.js (DOM) + advisor.js (hints)
```

- **`rules.js`** is the pure core: card values, suit/rank ordering (mode-aware —
  under `ners` the 2 is highest, under `asners` the ace is lowest), trick winning,
  playable-card validation. No DOM, no state.
- **`knowledge.js`** tracks what each player has shown: played cards, voids,
  remaining cards, who holds which suit.
- **`decision.js`** scores every candidate move with a deterministic argmax and
  emits human-readable reasons; ties break by a fixed rule, never by randomness.
- **`positions.js`** applies per-seat policy (the player who leads, and each
  follower in turn-order position) on top of the raw score.
- **`game.js`** drives the phase machine and enforces the rules (legal play,
  trick collection, kot/bam, scoring to 7).
- **`app.js`** is the only module that touches the DOM; the engine above it is
  UI-independent and runs headless under `simulate.js`.

## Verification

```text
Tests:      103 passed
            0 failed
            8 skipped
            0 todo
```

Per file: positions 36 · engine 18 · simulate 9 · rules 12 · determinism 7 ·
observability 6 · game 5 · storage 4 · bundle 3 · app-smoke 2 · browser-smoke 1.
The 8 skips are all differential tests gated on the absent oracle (see below).

Simulation and invariants:

```text
1000 full rounds simulated
0 invariant violations

4000+ legal plays checked
0 illegal plays
```

`simulate.js` runs `checkInvariants` on every simulated round and throws on any
violation. Card conservation is verified: every played card appears exactly once,
no hand exceeds 13.

```text
Determinism:        verified — 1000× byte-identical decisions on a fixed state;
                              seeded games replay identically (10 distinct seeds)
Replay:             verified — transcript records deal, trump, every play, trick
                              winner, score, final winner
Browser smoke:      verified — full game in headless Chromium over file://
Bundle/source sync: verified — the committed index.html is byte-identical to what
                              `tools/bundle.js` builds from the current sources
```

Run the suite yourself:

```bash
npm test                    # node --test tests/*.test.js
```

## Differential verification

```text
Differential verification is currently blocked because the historical
Hokm-main oracle is not present in this repository/environment.
The 8 differential tests are skipped rather than passed.
No differential equivalence claim is made.
```

The oracle is the previous shipping build (`../Hokm-main/index.html`). It is not
part of this repository. `tests/equivalence.test.js` and `tests/old-harness.js`
remain in the suite as verification history: when the oracle is checked out next
to this repository, the 8 differential tests run automatically and compare the
engine against it bit-for-bit. Until then they skip with a stated reason rather
than falsely passing. No equivalence is claimed, and no oracle file is fabricated.

## Browser test

`tests/browser-smoke.test.js` loads `index.html` in headless Chromium/Edge over
the DevTools protocol and plays a full seeded game through the live DOM:

```text
load → new game → deal → trump picker → tricks → rounds → kot handling → end screen
0 uncaught exceptions
0 console.error calls
0 failed asset loads
```

`?seed=N` pins the entire game (hakem, deal, every AI decision); seed 7 makes the
human the hakem so the trump-picker modal is exercised, and replays to a fixed
6–7 finish. If no Chromium-family browser is installed, the test **skips
gracefully** rather than failing — it never reports a false pass.

A second, browser-free smoke test (`tests/app-smoke.test.js`) drives the same
full game through the DOM handlers inside a Node VM, so UI wiring is covered even
where Chromium is unavailable.

## Development

Two entry points, deliberately:

- **`index.html`** — the bundled runtime. Rebuild it after editing `src/`, `css/`,
  or `index-dev.html`:

  ```bash
  npm run bundle            # node tools/bundle.js → index.html
  ```

  `tests/bundle.test.js` fails if the committed `index.html` is out of sync with
  the sources, so a stale bundle cannot ship silently. Rebuild before committing.

- **`index-dev.html`** — the modular app. ES modules are blocked on `file://`
  (browser security rule), so serve it over HTTP for live development:

  ```bash
  npm run serve             # http://localhost:8642  (serves index-dev.html at '/')
  ```

No packages to install — the project has zero npm dependencies and `node_modules/`
does not exist. Only Node.js is required (the test runner and both tools are
built-in).

```bash
npm test                   # full suite
npm run bundle             # rebuild the release bundle
npm run serve              # local dev/PWA server
```

## Deploy (GitHub Pages)

1. Push this folder to a GitHub repository.
2. Settings → Pages → Source: `Deploy from a branch` → `main` / root.
3. The app is published at `https://<user>.github.io/<repo>/`.

All paths are relative, so the manifest, service worker, and icons resolve on any
base path including a project subpath. GitHub Pages serves gzip/brotli
automatically; the service worker caches responses as delivered.

## Licensing

No license file is included with this repository. All rights are reserved by
default until one is added.
#   h o k m  
 