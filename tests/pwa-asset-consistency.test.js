const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const worker = fs.readFileSync('sw.js', 'utf8');
const ctx = {};
vm.runInNewContext(worker.slice(0, worker.indexOf("self.addEventListener('install'")) + '\nthis.assets=APP_SHELL;', ctx);
for (const [file, prefix] of [['salon-modern.html', './'], ['randevu/index.html', './randevu/'], ['randevu/durum/index.html', './randevu/durum/']]) {
  const html = fs.readFileSync(file, 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css)\?v=\d+)"/g)) {
    if (/^(?:https?:|\.\.\/)/.test(match[1])) continue;
    assert(ctx.assets.includes(prefix + match[1].replace(/^\.\//, '')), `${file}: current asset missing from PWA shell: ${match[1]}`);
  }
}
assert.match(worker, /salon-modern-shell-pwa-v\d+/);
assert.equal(new Set(ctx.assets).size, ctx.assets.length);
console.log('PASS versioned app/booking assets match the PWA precache without duplicate entries');
