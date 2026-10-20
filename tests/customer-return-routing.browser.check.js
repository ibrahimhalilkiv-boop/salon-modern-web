// Local fixture: no Supabase login, live push or customer WhatsApp delivery.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(process.argv[2], 'playwright'));

const listSource = fs.readFileSync('salon-return-daily.js', 'utf8');
const pushSource = fs.readFileSync('salon-web-push.js', 'utf8');
const routeSource = pushSource.slice(pushSource.indexOf('async function openNotification(data){'), pushSource.indexOf('function clearNotificationUrl()'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="app"><section id="smartAnalysis" class="page"><h1 class="page-title">Akıllı Müşteri Analizi</h1></section><nav class="nav"></nav></div>');
    await page.evaluate(() => {
      window.currentUser = { username: 'halil.kiv', role: 'yonetici' };
      window.returnAutoEnabled = false;
      window.waDrafts = [];
      window.dbWrites = [];
      window.open = (...args) => { waDrafts.push(args); return null; };
      window.confirm = () => true;
      window.showPage = id => {
        document.querySelectorAll('.page').forEach(item => item.classList.remove('active'));
        document.getElementById(id).classList.add('active');
      };
      window.salonDb = {
        rpc: async name => name === 'salon_return_due_clients'
          ? { data: [{ client_id: 'fixture-client', client_name: 'Örnek Müşteri', phone: '905000000001', last_visit: '2026-10-01', average_days: 14, elapsed_days: 19, state: 'due', has_consent: true }] }
          : (dbWrites.push(name), { data: true }),
        from(table) {
          return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: table === 'booking_settings'
            ? { whatsapp_return_auto_enabled: window.returnAutoEnabled }
            : { content: 'Merhaba {musteri_adi}' } }) };
        }
      };
    });
    await page.evaluate(listSource);
    await page.addScriptTag({ content: routeSource + '\nwindow.fixtureOpenNotification = openNotification;' });
    await page.evaluate(() => fixtureOpenNotification({ kind: 'customer_return_due', notificationId: 'fixture-note' }));
    assert.equal(await page.locator('#salonReturnDue.active').count(), 1, 'Digest click opens the dedicated customer list');
    assert.match(await page.locator('#returnDueList').innerText(), /Örnek Müşteri/);
    assert.equal(await page.evaluate(() => waDrafts.length), 0, 'Opening a notification does not send WhatsApp');
    await page.locator('[data-return-action="whatsapp"]').click();
    assert.equal(await page.evaluate(() => waDrafts.length), 1, 'Only owner action opens a manual WhatsApp draft');
    assert.equal(await page.evaluate(() => dbWrites.length), 0, 'Opening a draft does not mark a message sent');
    await page.evaluate(() => { window.returnAutoEnabled = true; });
    await page.evaluate(() => SalonReturnDaily.refresh());
    assert.equal(await page.locator('[data-return-action]').count(), 0, 'Manual controls close when automatic mode is enabled');
    assert.equal(await page.evaluate(() => waDrafts.length), 1);
    console.log('PASS return digest click, correct owner list, manual-only WhatsApp, automatic-mode handover');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
