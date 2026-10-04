# Hokm Engine

موتور **قطعی و قابل بازپخش بازی حکم (Hokm)** با رابط کاربری مرورگر.

این پروژه یک بازی چهار نفره‌ی تیمی حکم است که در آن بازیکن در مقابل هوش مصنوعی مبتنی بر شمارش و تحلیل کارت‌ها بازی می‌کند. علاوه بر حالت کلاسیک حکم، سه حالت بدون حکم ایرانی **نرس / آس نرس / سرس** نیز پشتیبانی می‌شوند.

---

# 🇮🇷 مستندات فارسی

## معرفی پروژه

**Hokm Engine** یک موتور بازی حکم چهار نفره است که با هدف ایجاد یک هسته‌ی بازی **قطعی (Deterministic)، قابل آزمایش، قابل بازپخش و مستقل از رابط کاربری** طراحی شده است.

بازی دارای دو تیم دو نفره است و هوش مصنوعی بر اساس اطلاعات قابل استنتاج از روند بازی، کارت‌های بازی‌شده، خالی بودن خال‌ها، وضعیت امتیاز و موقعیت بازیکن تصمیم‌گیری می‌کند.

ویژگی اصلی پروژه این است که تصمیمات هوش مصنوعی به‌صورت تصادفی گرفته نمی‌شوند. برای یک وضعیت یکسان و یک Seed یکسان، نتیجه باید همیشه یکسان باشد.

### ویژگی‌های اصلی

* **قطعی (Deterministic)**
  با Seed یکسان، بازی و تصمیمات AI به‌صورت یکسان و قابل بازپخش تولید می‌شوند.
* **بدون تصادفی‌سازی پنهان**
  مسیر تصمیم‌گیری AI از randomness مخفی استفاده نمی‌کند.
* **اجرا در مرورگر**
  رابط کاربری تک‌صفحه‌ای، RTL، واکنش‌گرا و مناسب موبایل و دسکتاپ است.
* **کاملاً مستقل**
  فایل `index.html` به‌تنهایی Runtime کامل بازی است.
* **بدون CDN و Network Call**
  اجرای بازی برای خود بازی به اینترنت یا سرویس خارجی وابسته نیست.
* **بدون وابستگی Runtime خارجی**
  فونت‌ها، CSS و JavaScript مورد نیاز Runtime داخل Bundle قرار گرفته‌اند.
* **قابل اجرا با `file://`**
  با دوبار کلیک روی `index.html` بازی اجرا می‌شود.
* **قابل نصب به‌صورت PWA**
  در صورت سرو شدن پروژه روی HTTP/HTTPS، Service Worker و PWA فعال می‌شوند.
* **معماری ماژولار**
  Engine از UI جداست و می‌تواند بدون مرورگر نیز اجرا و تست شود.
* **تست‌های گسترده**
  قوانین، AI، Determinism، Simulation، Storage، Bundle و UI بررسی شده‌اند.
* **قابل بازپخش (Replayable)**
  روند بازی شامل Deal، حکم، بازی کارت‌ها، برنده هر Trick، امتیاز و برنده نهایی قابل ثبت و بازسازی است.

---

## اجرای پروژه

ساده‌ترین روش:

```text
index.html
```

فایل `index.html` را با هر مرورگر مدرن باز کنید.

این فایل **کل Runtime پروژه** است و نصب دیگری برای اجرای خود بازی نیاز ندارد.

### اجرای مستقیم با `file://`

می‌توان `index.html` را مستقیماً با دوبار کلیک اجرا کرد.

این حالت برای بازی کردن کاملاً کافی است.

تنها قابلیت‌هایی که به دلیل محدودیت امنیتی مرورگر روی `file://` در دسترس نیستند:

* نصب PWA
* Service Worker

این محدودیت مربوط به امنیت مرورگر و Origin مربوط به `file://` است و Bug پروژه محسوب نمی‌شود.

### اجرای نسخه HTTP

برای فعال شدن PWA و Service Worker:

```bash
node tools/serve.js
```

سپس:

```text
http://localhost:8642
```

را باز کنید.

---

# ساختار Repository

```text
index.html
```

Runtime نهایی و Release پروژه است. تمام CSS، فونت‌ها و JavaScript مورد نیاز داخل آن Bundle شده‌اند.

```text
index-dev.html
```

نسخه توسعه که `src/app.js` را به‌صورت ES Module بارگذاری می‌کند.

```text
manifest.json
```

Manifest مربوط به PWA با مسیرهای نسبی.

```text
sw.js
```

Service Worker برای حالت HTTP/HTTPS.

```text
favicon.ico
icon-192.png
icon-512.png
```

آیکون‌های پروژه.

```text
css/
  style.css
```

استایل کامل رابط کاربری شامل طراحی Glass / Neumorphic، حالت تاریک و روشن و Responsive Layout.

```text
fonts/
  Vazirmatn + Lalezar woff2
```

فونت‌های محلی پروژه برای اجرای Offline.

---

## Source Engine

```text
src/
  rules.js
  knowledge.js
  risk.js
  decision.js
  positions.js
  ai.js
  game.js
  simulate.js
  storage.js
  advisor.js
  app.js
  vendor/
    lz-string.min.js
```

### `rules.js`

هسته‌ی خالص قوانین بازی.

مسئول:

* محاسبات کارت
* ارزش کارت‌ها
* ترتیب Rank و Suit
* تعیین برنده Trick
* تشخیص کارت مجاز
* قوانین وابسته به Mode

این فایل هیچ وابستگی به DOM ندارد.

ترتیب کارت‌ها نیز وابسته به حالت بازی است.

برای مثال:

* در `ners`، کارت 2 بالاترین کارت است.
* در `asners`، آس پایین‌ترین کارت است.

---

### `knowledge.js`

حافظه و دانش قابل استنتاج AI.

اطلاعاتی مانند:

* کارت‌های بازی‌شده
* خال‌های خالی هر بازیکن
* کارت‌های باقی‌مانده
* دارندگان احتمالی هر خال
* تاریخچه Trickها

را مدیریت می‌کند.

---

### `risk.js`

زمینه‌ی ریسک و وضعیت امتیاز را محاسبه می‌کند.

از جمله:

* فاصله امتیازی
* وضعیت Endgame
* ریسک Kot
* جلوگیری از تصمیمات نامناسب در وضعیت‌های حساس امتیازی

---

### `decision.js`

هسته‌ی تصمیم‌گیری AI.

برای هر کارت مجاز، یک امتیاز قطعی محاسبه می‌شود و بهترین گزینه با `argmax` انتخاب می‌شود.

دلایل تصمیم نیز تولید می‌شوند تا تصمیم AI قابل مشاهده و تحلیل باشد.

در صورت مساوی بودن امتیازها، Tie-breaking بر اساس یک قانون ثابت انجام می‌شود و از Randomness استفاده نمی‌شود.

---

### `positions.js`

سیاست تصمیم‌گیری را بر اساس موقعیت بازیکن در Trick اعمال می‌کند.

چهار موقعیت:

```text
LEADER
SECOND
THIRD
FOURTH
```

را به‌صورت جداگانه مدیریت می‌کند.

---

### `ai.js`

رابط اصلی AI.

شامل:

* `aiPick`
* انتخاب کارت
* پیشنهاد / انتخاب حکم
* اتصال اجزای Knowledge، Risk، Decision و Position Policy

است.

AI روی State بازی کار می‌کند و از DOM مستقل است.

---

### `game.js`

کنترل‌کننده اصلی چرخه بازی.

مراحل اصلی:

```text
deal
  ↓
bid / trump
  ↓
trick
  ↓
kot / bam
  ↓
round
  ↓
game
```

این بخش قوانین بازی، قانونی بودن حرکت، جمع‌آوری Trick، امتیازدهی و پایان بازی را enforce می‌کند.

بازی تا رسیدن یک تیم به 7 Trick ادامه پیدا می‌کند.

---

### `simulate.js`

اجرای بازی کامل بدون نیاز به UI.

قابلیت‌ها:

* شبیه‌سازی کامل Round
* اجرای AI
* بررسی Invariantها
* بررسی حفظ کارت‌ها
* بررسی قانونی بودن حرکت‌ها
* بررسی Determinism

---

### `storage.js`

مدیریت ذخیره‌سازی مرورگر.

از:

```text
localStorage
```

به همراه فشرده‌سازی:

```text
LZ-UTF16
```

استفاده می‌کند.

---

### `advisor.js`

سیستم Analysis و Coach Hint.

از همان Engine اصلی استفاده می‌کند و تصمیمات را با نگاه آینده‌نگر و بدون استفاده از اطلاعاتی که در لحظه بازی در دسترس نبوده‌اند، تحلیل می‌کند.

---

### `app.js`

تنها ماژولی است که مستقیماً با DOM ارتباط دارد.

مسئول:

* Render
* Input
* تعامل کاربر
* صدا
* اتصال UI به Engine

است.

---

### `vendor/lz-string.min.js`

نسخه Offline کتابخانه LZ-String برای فشرده‌سازی ذخیره‌های بازی.

---

# Runtime در برابر Source

یک اصل مهم پروژه:

> `index.html` Runtime نهایی است و هنگام بازی هیچ فایل دیگری را نمی‌خواند.

فایل‌های:

```text
src/
css/
fonts/
index-dev.html
```

برای توسعه، خوانایی، تست و نگهداری پروژه در Repository قرار دارند.

Runtime نهایی تمام وابستگی‌های مورد نیاز خود را داخل `index.html` دارد.

بنابراین:

```text
index.html
```

به‌تنهایی برای اجرای بازی کافی است.

---

# معماری Engine

معماری پروژه به‌صورت Pipeline لایه‌ای طراحی شده است:

```text
rules.js
    │
    ▼
knowledge.js
    │
    ▼
risk.js
    │
    ▼
decision.js
    │
    ▼
positions.js
    │
    ▼
ai.js
    │
    ▼
game.js
    │
    ├──────────────► app.js
    │                  │
    │                  ▼
    │                 DOM
    │
    └──────────────► advisor.js
```

### جریان مسئولیت‌ها

```text
rules.js
کارت و قوانین پایه
        ↓
knowledge.js
دانش و حافظه بازی
        ↓
risk.js
وضعیت امتیاز و ریسک
        ↓
decision.js
امتیازدهی حرکات
        ↓
positions.js
سیاست موقعیتی
        ↓
ai.js
انتخاب نهایی
        ↓
game.js
کنترل چرخه بازی
```

این تفکیک باعث می‌شود Engine بدون UI نیز قابل اجرا باشد.

---

# اصل Determinism

یکی از اهداف اصلی پروژه این است که Engine رفتار قطعی داشته باشد.

برای یک State یکسان:

```text
State + Seed
```

باید همیشه به نتیجه یکسان برسد.

بنابراین:

* تصمیمات AI تصادفی نیستند.
* Tie-breaking ثابت است.
* بازی قابل Replay است.
* Simulation قابل تکرار است.
* خطاها قابل بازتولید هستند.
* تست‌های Regression قابل اعتمادتر هستند.

---

# Verification

وضعیت فعلی تست‌ها:

```text
Tests:      103 passed
            0 failed
            8 skipped
            0 todo
```

تست‌ها بر اساس فایل:

```text
positions       36
engine          18
simulate         9
rules           12
determinism      7
observability    6
game             5
storage          4
bundle           3
app-smoke        2
browser-smoke    1
```

هشت تست Skip شده، تست‌های Differential هستند که به Oracle تاریخی پروژه وابسته‌اند.

---

# Simulation و Invariants

تست Simulation:

```text
1000 full rounds simulated
0 invariant violations
```

بیش از:

```text
4000+ legal plays checked
0 illegal plays
```

بررسی شده‌اند.

`simulate.js` در هر Round تابع `checkInvariants` را اجرا می‌کند و در صورت مشاهده هرگونه نقض، تست را Fail می‌کند.

از جمله موارد بررسی‌شده:

* حفظ تعداد کارت‌ها
* بازی نشدن یک کارت بیش از یک بار
* تعداد صحیح کارت‌های دست‌ها
* قانونی بودن حرکت‌ها
* وضعیت صحیح Trickها

اصل Card Conservation نیز بررسی می‌شود:

```text
هر کارت دقیقاً یک بار وجود دارد.
هیچ دستی بیش از 13 کارت ندارد.
```

---

# Determinism Verification

Determinism با:

```text
1000× byte-identical decisions
```

روی یک State ثابت بررسی شده است.

همچنین بازی‌های Seed شده با:

```text
10 distinct seeds
```

دوباره اجرا شده‌اند و Replay یکسان تأیید شده است.

---

# Replay Verification

Transcript بازی اطلاعات زیر را ثبت می‌کند:

```text
deal
trump
every play
trick winner
score
final winner
```

بنابراین روند کامل بازی قابل بازسازی و بررسی است.

---

# Bundle / Source Synchronization

Bundle نهایی نیز بررسی شده است.

تأیید شده که:

```text
index.html
```

Commit شده، از نظر بایت به بایتی با خروجی فعلی:

```text
tools/bundle.js
```

مطابقت دارد.

در نتیجه Bundle قدیمی نمی‌تواند بدون شناسایی وارد Release شود.

تست:

```text
tests/bundle.test.js
```

در صورت Out-of-sync بودن Runtime و Source شکست می‌خورد.

---

# Differential Verification

در حال حاضر Differential Verification کامل انجام نمی‌شود، زیرا Oracle تاریخی پروژه در محیط فعلی وجود ندارد.

Oracle مورد انتظار:

```text
../Hokm-main/index.html
```

است.

وضعیت:

```text
8 differential tests skipped
0 differential tests passed
```

این تست‌ها **Passed محسوب نمی‌شوند**.

هیچ ادعایی مبنی بر Equivalence بین Engine فعلی و Oracle تاریخی مطرح نمی‌شود.

فایل‌های زیر همچنان برای حفظ تاریخچه و امکان Verification آینده نگهداری می‌شوند:

```text
tests/equivalence.test.js
tests/old-harness.js
```

اگر Repository قدیمی در کنار این پروژه قرار گیرد:

```text
../Hokm-main/index.html
```

تست‌های Differential به‌صورت خودکار فعال خواهند شد و Engine جدید را با Oracle قبلی مقایسه خواهند کرد.

هیچ Oracle جعلی یا فایل ساختگی برای سبز کردن تست‌ها ایجاد نشده است.

---

# Browser Test

تست Browser با Headless Chromium / Edge و DevTools Protocol انجام می‌شود.

سناریوی کامل:

```text
load
  ↓
new game
  ↓
deal
  ↓
trump picker
  ↓
tricks
  ↓
rounds
  ↓
kot handling
  ↓
end screen
```

نتیجه:

```text
0 uncaught exceptions
0 console.error calls
0 failed asset loads
```

تست روی:

```text
file://
```

نیز اجرا شده است.

---

# Seeded Browser Test

با استفاده از:

```text
?seed=N
```

می‌توان کل بازی را Pin کرد.

Seed روی موارد زیر اثر تعیین‌کننده دارد:

* Hakem
* Deal
* تصمیمات AI
* روند بازی

برای مثال:

```text
seed 7
```

بازیکن انسانی را Hakem قرار می‌دهد و بنابراین Modal انتخاب حکم نیز در تست Browser پوشش داده می‌شود.

این Replay به یک پایان ثابت در بازه:

```text
6–7
```

می‌رسد.

اگر مرورگر Chromium-family روی سیستم نصب نباشد، تست Browser به‌صورت Graceful Skip می‌شود و به‌عنوان Passed جعلی گزارش نمی‌شود.

---

# Browser-Free Smoke Test

علاوه بر Browser Smoke Test، یک تست بدون Browser نیز وجود دارد:

```text
tests/app-smoke.test.js
```

این تست Handlerهای DOM را داخل Node VM اجرا می‌کند.

بنابراین حتی در محیطی که Chromium در دسترس نیست، Wiring مربوط به UI نیز بررسی می‌شود.

---

# اجرای Test Suite

برای اجرای کامل تست‌ها:

```bash
npm test
```

که معادل اجرای:

```bash
node --test tests/*.test.js
```

است.

---

# Development

پروژه عمداً دو Entry Point دارد.

## Release Runtime

```text
index.html
```

این فایل Runtime نهایی است.

بعد از تغییر در:

```text
src/
css/
index-dev.html
```

باید Bundle مجدداً ساخته شود.

```bash
npm run bundle
```

که در نهایت:

```text
tools/bundle.js
```

را اجرا کرده و `index.html` جدید تولید می‌کند.

---

## Development Runtime

```text
index-dev.html
```

نسخه Modular برای توسعه است و ES Moduleها را از:

```text
src/app.js
```

بارگذاری می‌کند.

از آنجا که ES Moduleها روی `file://` محدودیت مرورگر دارند، برای Development باید پروژه با HTTP سرو شود.

```bash
npm run serve
```

سپس:

```text
http://localhost:8642
```

---

# وابستگی‌ها

پروژه هیچ npm dependency خارجی ندارد.

```text
node_modules/
```

در پروژه وجود ندارد.

تنها نیاز:

```text
Node.js
```

است.

Node برای موارد زیر استفاده می‌شود:

* Test Runner
* Bundle Tool
* Local HTTP Server

خود بازی برای اجرا در Browser به نصب Package نیاز ندارد.

---

# دستورات اصلی توسعه

اجرای تست:

```bash
npm test
```

ساخت Bundle:

```bash
npm run bundle
```

اجرای Local Server:

```bash
npm run serve
```

---

# Deploy روی GitHub Pages

برای انتشار:

### 1. Repository را به GitHub Push کنید

کل پروژه را در یک Repository قرار دهید.

### 2. فعال‌سازی GitHub Pages

در:

```text
Settings → Pages
```

گزینه:

```text
Deploy from a branch
```

را انتخاب کنید.

Branch:

```text
main
```

و Folder:

```text
/
```

باشد.

### 3. آدرس انتشار

GitHub Pages برنامه را در آدرسی مشابه زیر منتشر می‌کند:

```text
https://<user>.github.io/<repo>/
```

تمام مسیرهای پروژه Relative هستند.

بنابراین این موارد در Subpath نیز باید درست کار کنند:

```text
manifest
service worker
icons
assets
```

GitHub Pages نیز فشرده‌سازی gzip/brotli را به‌صورت خودکار انجام می‌دهد.

Service Worker نیز Responseهای ارائه‌شده را Cache می‌کند.

---

# License

در حال حاضر فایل License در Repository قرار نگرفته است.

بنابراین تا زمانی که License مشخصی اضافه نشود:

```text
All rights reserved.
```

---

# 🇬🇧 English Documentation

## Hokm Engine

A deterministic [Hokm](https://en.wikipedia.org/wiki/Hokm) card-game engine with a browser UI.

Four-player partnership play against a card-counting AI, with three Iranian no-trump variants (`ners` / `asners` / `sers`) alongside classic trump play.

### Core properties

* **Deterministic** — the same seed replays byte-identically; zero hidden randomness in the decision path.
* **Browser-based** — a single-page RTL app with dark/light themes and a mobile-first layout.
* **Self-contained** — `index.html` is the complete runtime.
* **No CDN or network calls required** for the game runtime.
* **No external runtime dependency** — fonts, CSS, and JavaScript are bundled into the runtime.
* **Runs directly from `file://`** by double-clicking `index.html`.
* **PWA-capable** when served over HTTP/HTTPS.
* **Headless-engine capable** — the engine can run without a browser UI.
* **Replayable** — seeded games produce reproducible transcripts.
* **Tested** across rules, AI, determinism, simulation, storage, bundle synchronization, and UI wiring.

---

## Run

Open:

```text
index.html
```

in any modern browser.

That is the entire installation.

### `file://`

The game works by double-clicking `index.html`.

The only browser features unavailable on `file://` are:

* PWA installation
* Service Worker

This is a browser security restriction for `file://` origins, not a project bug.

### HTTP / PWA

For local PWA and Service Worker testing:

```bash
node tools/serve.js
```

Then open:

```text
http://localhost:8642
```

---

## Repository layout

```text
index.html               RELEASE RUNTIME — bundled app
index-dev.html           modular development shell
manifest.json            PWA manifest
sw.js                    service worker
favicon.ico              favicon
icon-192.png             PWA icon
icon-512.png             PWA icon

css/
  style.css              glass + neumorphic design

fonts/
  Vazirmatn + Lalezar     offline WOFF2 fonts

src/
  rules.js               pure engine: cards, ranks, trick winner
  knowledge.js            played cards, voids, holders, trick history
  risk.js                score gap, endgame, anti-kot
  decision.js             deterministic move scoring + reasons
  positions.js            per-position policies
  ai.js                   AI move selection + trump bidding
  game.js                 phase controller
  simulate.js             deterministic simulation + invariants
  storage.js              localStorage + LZ-UTF16 compression
  advisor.js              analysis + coach hints
  app.js                  DOM controller
  vendor/lz-string.min.js offline compression library

tests/
  node --test suite

tools/
  bundle.js               zero-dependency bundler
  serve.js                zero-dependency local static server
```

---

## Runtime vs source

`index.html` is the shipped runtime.

It does not read any other project file during play.

The following directories/files are maintained for development and readability:

```text
src/
css/
fonts/
index-dev.html
```

They are source material for the bundled runtime, not runtime dependencies.

---

## Architecture

The engine is organized as a layered pipeline:

```text
rules.js ──► knowledge.js ──► risk.js ──► decision.js ──► positions.js ──► ai.js
   card math    memory of play    score context   move scoring    seat policy    choice
                                                                        │
                                                          game.js ◄──────┘
                                                     phase controller
                                                          │
                                               app.js + advisor.js
```

### `rules.js`

The pure rules core.

It handles:

* card values
* rank/suit ordering
* mode-aware ordering
* trick winning
* playable-card validation

There is no DOM dependency.

Mode-specific ordering is supported. For example:

* under `ners`, 2 is highest;
* under `asners`, ace is lowest.

### `knowledge.js`

Tracks information exposed by play:

* played cards
* void suits
* remaining cards
* likely suit holders
* trick history

### `risk.js`

Models score context and risk:

* score gap
* endgame state
* anti-kot behavior
* score-sensitive decisions

### `decision.js`

Scores each legal candidate move using a deterministic argmax.

It also emits human-readable decision reasons.

Ties are resolved through a fixed rule and never through randomness.

### `positions.js`

Applies per-seat policy on top of the raw move score:

```text
LEADER
SECOND
THIRD
FOURTH
```

### `ai.js`

Provides the AI decision interface, including:

* `aiPick`
* card selection
* trump bidding / selection

It is pure over game state and independent from the DOM.

### `game.js`

Controls the game state machine:

```text
deal → bid/trump → trick → kot/bam → round → game
```

It enforces legal play, trick collection, scoring, and game completion.

A game is won when a team reaches 7 tricks.

### `simulate.js`

Provides deterministic full-round simulation and invariant checking.

### `storage.js`

Provides browser persistence using:

```text
localStorage
```

with:

```text
LZ-UTF16
```

compression.

### `advisor.js`

Provides analysis and coach hints using the same engine without hindsight.

### `app.js`

The only module that directly touches the DOM.

It handles:

* rendering
* input
* UI interaction
* sound
* engine/UI integration

---

## Determinism

The engine is designed so that:

```text
same state + same seed
```

produces the same result.

There is no hidden randomness in the AI decision path.

This makes the engine:

* reproducible
* testable
* debuggable
* replayable
* suitable for regression testing

---

## Verification

Current test status:

```text
Tests:      103 passed
            0 failed
            8 skipped
            0 todo
```

Per test file:

```text
positions       36
engine          18
simulate         9
rules           12
determinism      7
observability    6
game             5
storage          4
bundle           3
app-smoke        2
browser-smoke    1
```

The 8 skipped tests are differential tests gated on the historical oracle being absent.

---

## Simulation and invariants

```text
1000 full rounds simulated
0 invariant violations
```

More than:

```text
4000+ legal plays checked
0 illegal plays
```

`simulate.js` runs `checkInvariants` on every simulated round and throws on violations.

Card conservation is verified:

```text
every played card appears exactly once
no hand exceeds 13 cards
```

---

## Determinism verification

Verified:

```text
1000× byte-identical decisions on a fixed state
```

Seeded games also replay identically across:

```text
10 distinct seeds
```

---

## Replay verification

Replay transcripts record:

```text
deal
trump
every play
trick winner
score
final winner
```

This makes complete game playback and verification possible.

---

## Bundle/source synchronization

The committed `index.html` has been verified byte-identical to the output generated by:

```text
tools/bundle.js
```

from the current source tree.

`tests/bundle.test.js` prevents a stale bundle from silently shipping.

---

## Differential verification

Differential verification is currently blocked because the historical Hokm-main oracle is not present in the repository/environment.

Expected oracle:

```text
../Hokm-main/index.html
```

Current status:

```text
8 differential tests skipped
0 differential tests passed
```

No differential equivalence claim is made.

The following files remain as verification history:

```text
tests/equivalence.test.js
tests/old-harness.js
```

When the historical oracle is checked out next to this repository, the differential tests automatically become active and compare the current engine against it.

No oracle file is fabricated to make tests pass.

---

## Browser test

`tests/browser-smoke.test.js` loads `index.html` in headless Chromium/Edge over the DevTools Protocol and plays a full seeded game through the live DOM.

Test flow:

```text
load
→ new game
→ deal
→ trump picker
→ tricks
→ rounds
→ kot handling
→ end screen
```

Verified:

```text
0 uncaught exceptions
0 console.error calls
0 failed asset loads
```

The test runs over `file://`.

If no Chromium-family browser is installed, the test skips gracefully rather than reporting a false pass.

---

## Seeded browser test

The complete game can be pinned with:

```text
?seed=N
```

The seed determines:

* hakem
* deal
* AI decisions
* game progression

For example:

```text
seed 7
```

makes the human player the hakem, exercising the trump-picker modal.

It replays to a fixed 6–7 finish.

---

## Browser-free smoke test

`tests/app-smoke.test.js` drives the same UI handlers inside a Node VM.

This covers UI wiring even when Chromium is unavailable.

---

## Development

The project deliberately has two entry points.

### Release runtime

```text
index.html
```

After modifying:

```text
src/
css/
index-dev.html
```

rebuild:

```bash
npm run bundle
```

This runs:

```text
node tools/bundle.js
```

and regenerates `index.html`.

---

### Development runtime

```text
index-dev.html
```

This is the modular development application and loads ES modules from:

```text
src/app.js
```

ES modules are restricted on `file://`, so use:

```bash
npm run serve
```

Then:

```text
http://localhost:8642
```

---

## Dependencies

The project has zero npm dependencies.

There is no:

```text
node_modules/
```

Only Node.js is required for:

* the built-in test runner
* the bundler
* the local static server

The game itself requires no package installation.

---

## Commands

Run tests:

```bash
npm test
```

Build release bundle:

```bash
npm run bundle
```

Run local development server:

```bash
npm run serve
```

---

## Deploy to GitHub Pages

1. Push the project folder to a GitHub repository.
2. Open:

```text
Settings → Pages
```

3. Select:

```text
Deploy from a branch
```

4. Select:

```text
main / root
```

The application will be available at:

```text
https://<user>.github.io/<repo>/
```

All paths are relative, so the manifest, service worker, icons, and other assets resolve correctly on project subpaths.

GitHub Pages provides gzip/brotli compression automatically.

The service worker caches responses as delivered.

---

## Licensing

No license file is currently included.

All rights are reserved by default until an explicit license is added.
