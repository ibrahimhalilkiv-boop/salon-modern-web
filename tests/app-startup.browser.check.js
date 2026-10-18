const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(process.argv[2], 'playwright'));
const root = process.cwd();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };

(async () => {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 850 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://oxuwwjsakhcqimjsfris.supabase.co/**', route => {
      if (route.request().url().includes('bootstrap-salon'))
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"initialized":true}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/salon-modern.html`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#loginForm').isVisible(), true);
    assert.equal(await page.evaluate(() => !!window.SalonAppointmentData), true);
    assert.deepEqual(errors, []);
    console.log('PASS mobile cold startup loads versioned scripts and login without JavaScript exceptions');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
