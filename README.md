# 🃏 Hokm — بازی حکم

**Hokm** یک بازی چهار نفره‌ی حکم ایرانی است؛ با رابط کاربری فارسی و راست‌به‌چپ، بازی تیمی، هوش مصنوعی، حالت‌های مختلف حکم و امکان اجرای کاملاً آفلاین.

در این بازی شما در یک تیم دو نفره قرار می‌گیرید و در مقابل دو بازیکن دیگر بازی می‌کنید. هدف، بردن Trickها و رسیدن به **۷ امتیاز** پیش از تیم مقابل است.

بازی برای اجرای خود به سرور، حساب کاربری، اینترنت یا نصب برنامه نیاز ندارد.

کافی است:

```text
index.html
```

را با یک مرورگر مدرن باز کنید و بازی را شروع کنید.

---

# 🇮🇷 فارسی

## 🎴 درباره بازی

Hokm یک بازی چهار نفره‌ی تیمی است که در آن دو تیم دو نفره در مقابل یکدیگر بازی می‌کنند.

بازیکن با یار خود یک تیم را تشکیل می‌دهد و دو بازیکن دیگر تیم مقابل هستند.

در هر Trick، هر چهار بازیکن یک کارت بازی می‌کنند و برنده Trick مشخص می‌شود.

هر Trick یک امتیاز دارد و تیمی که زودتر به **۷ Trick** برسد، برنده بازی خواهد بود.

### ویژگی‌های بازی

* 🎴 بازی چهار نفره‌ی تیمی
* 🤖 حریف‌های هوش مصنوعی
* 🏆 هدف بازی: رسیدن به ۷ Trick
* 👑 انتخاب حکم
* 🧠 AI مبتنی بر وضعیت واقعی بازی
* 🎲 بازی‌های قابل تکرار با Seed
* 📱 رابط کاربری مناسب موبایل
* 💻 پشتیبانی از دسکتاپ
* 🌙 حالت تاریک و روشن
* 🇮🇷 رابط راست‌به‌چپ
* 📡 قابلیت اجرای کاملاً آفلاین
* 💾 ذخیره بازی در مرورگر
* 💡 Advisor و راهنمای تصمیم‌گیری
* 📱 قابلیت PWA در صورت اجرای بازی روی HTTP/HTTPS

---

## 🤖 هوش مصنوعی

حریف‌های بازی به‌صورت تصادفی کارت بازی نمی‌کنند.

هوش مصنوعی روند بازی را دنبال می‌کند و از اطلاعاتی که در طول بازی آشکار شده‌اند استفاده می‌کند.

از جمله:

* کارت‌های بازی‌شده
* خال‌های خالی بازیکنان
* کارت‌های باقی‌مانده
* وضعیت Trick
* امتیاز دو تیم
* مرحله بازی
* موقعیت بازیکن در Trick

AI برای هر حرکت کارت‌های قانونی را بررسی کرده و بهترین گزینه را بر اساس منطق بازی انتخاب می‌کند.

تصمیمات AI نیز تصادفی نیستند؛ بنابراین یک وضعیت یکسان با Seed یکسان می‌تواند دوباره همان نتیجه را تولید کند.

---

# 🏆 حالت‌های بازی

بازی علاوه بر حکم کلاسیک، از سه حالت بدون حکم ایرانی نیز پشتیبانی می‌کند.

### حکم کلاسیک

حالت استاندارد حکم با یک خال حکم مشخص.

### Ners

یکی از حالت‌های بدون حکم ایرانی که در آن ترتیب قدرت کارت‌ها تغییر می‌کند.

در این حالت:

```text
2
```

بالاترین کارت است.

### Asners

حالت بدون حکم دیگری با ترتیب متفاوت کارت‌ها.

در این حالت:

```text
A
```

پایین‌ترین کارت است.

### Sers

یکی دیگر از حالت‌های بدون حکم ایرانی با قوانین مخصوص خود.

---

# 🎮 اجرای بازی

ساده‌ترین روش اجرای بازی این است که فایل:

```text
index.html
```

را با یک مرورگر مدرن باز کنید.

در Windows می‌توانید روی آن دوبار کلیک کنید.

### بدون نصب

برای بازی کردن نیازی به نصب موارد زیر نیست:

* Node.js
* npm package
* PHP
* Database
* CDN
* سرویس خارجی
* حساب کاربری
* اینترنت

نسخه نهایی بازی تمام فایل‌های مورد نیاز Runtime را در خود دارد.

---

# 🌐 بازی آفلاین

Hokm برای اجرای اصلی به اینترنت نیاز ندارد.

CSS، JavaScript و فونت‌های مورد استفاده در نسخه نهایی داخل بازی قرار گرفته‌اند.

بنابراین می‌توانید `index.html` را روی سیستم خود نگه دارید و حتی بدون اینترنت بازی کنید.

---

# 📱 موبایل و دسکتاپ

رابط بازی برای موبایل و دسکتاپ طراحی شده است.

ویژگی‌های رابط:

* RTL
* Responsive
* Mobile-first
* Dark / Light Theme
* مناسب نمایشگرهای کوچک و بزرگ

---

# 🎲 Seed و Replay

بازی از Seed پشتیبانی می‌کند.

Seed می‌تواند روند بازی را قابل تکرار کند؛ از جمله:

* Hakem
* Deal
* تصمیمات AI
* روند کلی بازی

برای مثال:

```text
?seed=7
```

می‌تواند یک بازی مشخص را دوباره ایجاد کند.

این قابلیت برای Replay، بررسی بازی و آزمایش AI استفاده می‌شود.

---

# 💾 ذخیره بازی

اطلاعات بازی می‌توانند در مرورگر ذخیره شوند.

ذخیره‌سازی با:

```text
localStorage
```

انجام می‌شود و داده‌ها برای کاهش حجم با LZ-UTF16 فشرده می‌شوند.

---

# 💡 Advisor

بازی دارای سیستم Advisor و Coach Hint نیز هست.

Advisor می‌تواند وضعیت فعلی بازی را بررسی کرده و برای تصمیم‌گیری بازیکن پیشنهاد و تحلیل ارائه کند.

تحلیل از اطلاعاتی استفاده می‌کند که بازیکن در همان لحظه بازی می‌توانسته در اختیار داشته باشد و از اطلاعات آینده بازی برای تقلب در تحلیل استفاده نمی‌کند.

---

# 🧪 وضعیت تست بازی

نسخه فعلی با مجموعه‌ای از تست‌ها و شبیه‌سازی‌های خودکار بررسی شده است.

نتیجه فعلی:

```text
103 passed
0 failed
8 skipped
0 todo
```

همچنین:

```text
1000 بازی کامل شبیه‌سازی شد
0 خطای منطقی

4000+ حرکت قانونی بررسی شد
0 حرکت غیرقانونی
```

تکرارپذیری نیز بررسی شده است:

```text
1000 تصمیم یکسان روی یک وضعیت ثابت
10 Seed متفاوت با Replay یکسان
```

---

# 🌐 تست اجرای واقعی در مرورگر

یک بازی کامل در مرورگر به‌صورت خودکار اجرا شده است:

```text
Start
↓
Deal
↓
Trump
↓
Tricks
↓
Rounds
↓
Kot / Bam
↓
End
```

نتیجه:

```text
0 uncaught exceptions
0 console.error
0 failed asset loads
```

---

# ⚙️ PWA

اگر بازی روی HTTP یا HTTPS اجرا شود، قابلیت PWA و Service Worker نیز قابل استفاده هستند.

اجرای محلی:

```bash
node tools/serve.js
```

سپس:

```text
http://localhost:8642
```

---

# 📂 ساختار پروژه

```text
index.html
index-dev.html

manifest.json
sw.js

favicon.ico
icon-192.png
icon-512.png

css/
  style.css

fonts/
  Vazirmatn
  Lalezar

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

tests/

tools/
  bundle.js
  serve.js
```

`index.html` نسخه نهایی و قابل اجرای بازی است.

تمام CSS، JavaScript و فونت‌های مورد نیاز Runtime در آن Bundle شده‌اند.

---

# 🔧 جزئیات فنی

بخش فنی برای توسعه‌دهندگان پروژه است.

### Engine

```text
rules.js
```

قوانین پایه کارت‌ها و Trickها را مدیریت می‌کند.

### Knowledge

```text
knowledge.js
```

کارت‌های بازی‌شده، خال‌های خالی و اطلاعات قابل استنتاج را نگهداری می‌کند.

### Decision

```text
decision.js
```

حرکت‌های قانونی را امتیازدهی کرده و بهترین حرکت را انتخاب می‌کند.

### Positions

```text
positions.js
```

تصمیم AI را بر اساس موقعیت بازیکن در Trick تنظیم می‌کند:

```text
LEADER
SECOND
THIRD
FOURTH
```

### AI

```text
ai.js
```

انتخاب کارت و تصمیمات مربوط به حکم را مدیریت می‌کند.

### Game

```text
game.js
```

چرخه کامل بازی را مدیریت می‌کند:

```text
Deal
→ Trump
→ Trick
→ Kot / Bam
→ Round
→ Game
```

### Simulation

```text
simulate.js
```

بازی‌های کامل را بدون رابط کاربری اجرا و Invariantها را بررسی می‌کند.

---

# 🔁 Differential Verification

نسخه تاریخی:

```text
Hokm-main
```

در Repository فعلی وجود ندارد.

به همین دلیل ۸ تست مربوط به مقایسه با نسخه تاریخی:

```text
SKIPPED
```

می‌شوند.

این تست‌ها به‌صورت جعلی Passed اعلام نشده‌اند.

Oracle مورد انتظار:

```text
../Hokm-main/index.html
```

است.

تا زمان بازگرداندن نسخه تاریخی، هیچ ادعایی مبنی بر برابری کامل با نسخه قبلی مطرح نمی‌شود.

---

# 🛠️ توسعه

برای توسعه از:

```text
index-dev.html
```

استفاده می‌شود.

بعد از تغییر Source:

```bash
npm run bundle
```

نسخه نهایی `index.html` را مجدداً تولید می‌کند.

برای اجرای Development Server:

```bash
npm run serve
```

---

# 📦 وابستگی‌ها

بازی برای Runtime هیچ npm dependency خارجی ندارد.

```text
node_modules/
```

وجود ندارد.

Node.js فقط برای ابزارهای تست، Bundle و Local Server مورد استفاده قرار می‌گیرد.

دستورات اصلی:

```bash
npm test
npm run bundle
npm run serve
```

---

# 🚀 انتشار روی GitHub Pages

برای انتشار:

1. پروژه را روی GitHub قرار دهید.
2. به:

```text
Settings → Pages
```

بروید.
3. گزینه:

```text
Deploy from a branch
```

را انتخاب کنید.
4. Branch را روی:

```text
main
```

و Folder را روی:

```text
/
```

قرار دهید.

بازی در آدرسی مشابه زیر منتشر می‌شود:

```text
https://<user>.github.io/<repo>/
```

مسیرهای پروژه Relative هستند و در Subpath نیز کار می‌کنند.

---

# 📌 نسخه

## Hokm v5.3

نسخه **5.3** نسخه مرجع فعلی بازی است.

نسخه‌های قبلی که روی GitHub Pages منتشر شده بودند به دلیل بسته‌شدن Page قبلی دیگر در دسترس نیستند.

بنابراین این Repository و Release نسخه **v5.3** نقطه مرجع فعلی بازی محسوب می‌شوند.

---

# 📜 License

در حال حاضر License جداگانه‌ای برای پروژه تعریف نشده است.

تا زمان اضافه شدن License:

```text
All rights reserved.
```

---

# 🇬🇧 English

# 🃏 Hokm — The Card Game

**Hokm** is a four-player Iranian card game with team-based gameplay, AI opponents, multiple Hokm variants, a Persian RTL interface, and full offline play.

You play as part of a two-player team against another two-player team.

The goal is simple:

> Win tricks and reach **7 points** before the opposing team.

The game does not require a server, account, internet connection, or installation.

Just open:

```text
index.html
```

in a modern browser and start playing.

---

## 🎴 About the Game

Hokm is a four-player partnership card game.

Two players form your team and the other two players form the opposing team.

Each trick consists of one card played by each player. The winning player takes the trick.

Each trick counts as one point, and the first team to reach **7 tricks** wins the game.

### Game Features

* 🎴 Four-player partnership gameplay
* 🤖 AI opponents
* 🏆 First team to 7 tricks wins
* 👑 Trump selection
* 🧠 Game-aware AI decisions
* 🎲 Seeded and replayable games
* 📱 Mobile-friendly interface
* 💻 Desktop support
* 🌙 Dark and light themes
* 🇮🇷 RTL interface
* 📡 Full offline gameplay
* 💾 Browser-based save data
* 💡 Advisor and coaching hints
* 📱 PWA support over HTTP/HTTPS

---

## 🤖 AI Opponents

The AI does not simply play random cards.

It follows the information revealed during the game, including:

* Played cards
* Void suits
* Remaining cards
* Current trick state
* Team scores
* Game phase
* Player position within the trick

For each legal move, the AI evaluates the available cards and selects a move according to the game's decision logic.

AI decisions are deterministic rather than random, meaning the same state and seed can produce the same result again.

---

# 🏆 Game Modes

In addition to classic Hokm, the game supports three Iranian no-trump variants.

### Classic Hokm

The traditional Hokm mode with a selected trump suit.

### Ners

An Iranian no-trump variant with a different card ranking.

In this mode:

```text
2
```

is the highest card.

### Asners

Another no-trump variant with a different ranking.

In this mode:

```text
A
```

is the lowest card.

### Sers

Another Iranian no-trump variant with its own card-ordering rules.

---

# 🎮 Running the Game

Open:

```text
index.html
```

with a modern browser.

On Windows, simply double-click the file.

### No Installation Required

You do not need:

* Node.js
* npm packages
* PHP
* a database
* a CDN
* an external service
* an account
* an internet connection

The release bundle contains everything required by the game runtime.

---

# 🌐 Offline Gameplay

The game does not require an internet connection for normal gameplay.

CSS, JavaScript, and fonts required by the runtime are bundled locally.

You can keep `index.html` on your computer and play completely offline.

---

# 📱 Mobile and Desktop

The interface is designed for both mobile and desktop screens.

It provides:

* RTL layout
* Responsive design
* Mobile-first layout
* Dark / Light themes
* Small and large screen support

---

# 🎲 Seeds and Replay

The game supports seeded runs.

A seed can make the following reproducible:

* Hakem
* Deal
* AI decisions
* Game progression

For example:

```text
?seed=7
```

can reproduce a specific game.

This is useful for replay, debugging, AI evaluation, and testing.

---

# 💾 Save Data

Game data can be stored in the browser using:

```text
localStorage
```

Data is compressed using LZ-UTF16 to reduce storage size.

---

# 💡 Advisor

The game includes an Advisor and Coach Hint system.

It can analyze the current game state and provide suggestions for the player's decision-making.

The advisor uses information available at the current point in the game and does not use future information to cheat in its analysis.

---

# 🧪 Game Verification

The current release has been tested through automated tests and full-game simulations.

Current results:

```text
103 passed
0 failed
8 skipped
0 todo
```

Additional simulation verification:

```text
1000 full games simulated
0 invariant violations

4000+ legal plays checked
0 illegal plays
```

Determinism verification:

```text
1000 identical decisions on a fixed state
10 different seeds replayed identically
```

---

# 🌐 Browser Verification

A complete game has also been played automatically through the browser:

```text
Start
↓
Deal
↓
Trump
↓
Tricks
↓
Rounds
↓
Kot / Bam
↓
End
```

Result:

```text
0 uncaught exceptions
0 console.error calls
0 failed asset loads
```

---

# ⚙️ PWA

When served over HTTP or HTTPS, the game can also use PWA and Service Worker features.

Run locally:

```bash
node tools/serve.js
```

Then open:

```text
http://localhost:8642
```

---

# 📂 Project Structure

```text
index.html
index-dev.html

manifest.json
sw.js

favicon.ico
icon-192.png
icon-512.png

css/
  style.css

fonts/
  Vazirmatn
  Lalezar

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

tests/

tools/
  bundle.js
  serve.js
```

`index.html` is the final playable release.

All CSS, JavaScript, and fonts required by the runtime are bundled into it.

---

# 🔧 Technical Details

The following section is primarily for developers maintaining the game.

### Rules

`rules.js` handles card rules, rankings, legal plays, and trick winners.

### Knowledge

`knowledge.js` tracks played cards, void suits, remaining information, and trick history.

### Decision

`decision.js` scores legal moves and selects the best deterministic move.

### Positions

`positions.js` adjusts AI decisions according to trick position:

```text
LEADER
SECOND
THIRD
FOURTH
```

### AI

`ai.js` handles card selection and trump-related decisions.

### Game

`game.js` controls the complete game flow:

```text
Deal
→ Trump
→ Trick
→ Kot / Bam
→ Round
→ Game
```

### Simulation

`simulate.js` runs complete games without the browser UI and verifies game invariants.

---

# 🔁 Differential Verification

The historical:

```text
Hokm-main
```

version is not currently present in this repository.

Therefore, the 8 tests that depend on the historical version are:

```text
SKIPPED
```

They are not falsely reported as passed.

Expected oracle:

```text
../Hokm-main/index.html
```

No claim of complete equivalence with the historical version is made until that oracle is available again.

---

# 🛠️ Development

Use:

```text
index-dev.html
```

for modular development.

After changing the source:

```bash
npm run bundle
```

rebuilds the final `index.html`.

For the development server:

```bash
npm run serve
```

---

# 📦 Dependencies

The game has no external npm runtime dependencies.

There is no:

```text
node_modules/
```

Node.js is only used for testing, bundling, and the local development server.

Main commands:

```bash
npm test
npm run bundle
npm run serve
```

---

# 🚀 GitHub Pages

To publish the game:

1. Push the project to a GitHub repository.
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

The game will be available at an address similar to:

```text
https://<user>.github.io/<repo>/
```

All project paths are relative and work correctly under a repository subpath.

---

# 📌 Version

## Hokm v5.3

**v5.3** is the current reference release of the game.

Previous GitHub Pages versions became unavailable after the previous GitHub Page was closed.

Therefore, this repository and the **v5.3 release** serve as the current reference point for the game.

---

# 📜 License

No separate license is currently included.

Until an explicit license is added:

```text
All rights reserved.
```
