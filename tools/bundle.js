// Single-file bundler for file:// double-click use (zero dependencies).
// The modular app (src/*.js as ES modules) requires http:// — that is a browser
// security rule, not a code bug. This tool produces the release entry `index.html`
// at repo root from the modular dev shell `index-dev.html`:
// CSS inlined, fonts base64-embedded, modules concatenated into one classic
// script, manifest+SW linked only when served over http(s) (silent on file://).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const B64 = (p) => fs.readFileSync(path.join(ROOT, p)).toString('base64');

function exportNames(code) {
  return [...code.matchAll(/^export\s+(?:async\s+)?(?:const|function|class)\s+(\w+)/gm)].map((m) => m[1]);
}

// Strip ES-module syntax; every file lands in one shared function scope.
function deModule(code, namespaces) {
  code = code.replace(/^import\s*\*\s*as\s*(\w+)\s*from\s*['"][^'"]+['"];?\s*$/gm, (_m, alias) => {
    const ns = namespaces[alias];
    if (!ns) throw new Error(`unknown namespace import: ${alias}`);
    return `const ${alias} = { ${ns.join(', ')} };`;
  });
  code = code.replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^export\s*\{[^}]*\};?\s*$/gm, ''); // export { a, b } re-exports: names already in scope
  code = code.replace(/^export\s+/gm, '');
  return code.trim();
}

function buildJs() {
  // Order matters: a file must appear before anything that imports it. simulate.js
  // is engine-only (tests/tools) and is intentionally absent from the browser bundle.
  const codes = ['src/rules.js', 'src/knowledge.js', 'src/risk.js', 'src/decision.js', 'src/positions.js', 'src/ai.js', 'src/advisor.js', 'src/game.js', 'src/storage.js', 'src/app.js'].map(SRC);
  const namespaces = { storage: exportNames(SRC('src/storage.js')) };
  const body = codes.map((c) => deModule(c, namespaces)).join('\n\n');
  return `(function(){'use strict';\n${body}\n})();`;
}

function buildCss() {
  return SRC('css/style.css').replace(/url\('\.\.\/fonts\/([^']+)'\)/g, (_m, name) =>
    `url(data:font/woff2;base64,${B64('fonts/' + name)})`);
}

export function build() {
  let html = SRC('index-dev.html');
  html = html.replace(/<link rel="stylesheet" href="css\/style\.css">/, () => `<style>\n${buildCss()}\n</style>`);
  html = html.replace(/\s*<link rel="manifest" href="manifest\.json">/, '');
  html = html.replace(/<script src="src\/vendor\/lz-string\.min\.js"><\/script>/, () => `<script>\n${SRC('src/vendor/lz-string.min.js')}\n</script>`);
  html = html.replace(/<script type="module" src="src\/app\.js"><\/script>/, () => `<script>\n${buildJs()}\n</script>`);
  html = html.replace(/<script>\s*if \('serviceWorker' in navigator\)[\s\S]*?<\/script>/, () => `<script>
if (location.protocol !== 'file:') {
  var mlink = document.createElement('link'); mlink.rel = 'manifest'; mlink.href = 'manifest.json'; document.head.appendChild(mlink);
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
    </script>`);
  return html;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\\/g, '/').endsWith('tools/bundle.js');
if (isMain) {
  const out = path.join(ROOT, 'index.html');
  fs.writeFileSync(out, build(), 'utf8');
  console.log(`built ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}
