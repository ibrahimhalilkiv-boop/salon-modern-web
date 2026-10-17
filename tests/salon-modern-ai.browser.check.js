const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(process.argv[2], 'playwright'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page.on('pageerror', error => console.error('BROWSER ERROR', error.message));
    const calls = [];
    await page.setContent('<section id="salonAiRoot"></section>');
    await page.evaluate(() => {
      Object.defineProperty(window.crypto, 'randomUUID', { value: () => '00000000-0000-4000-8000-000000000001' });
      window.currentUser = { id: 'u1', role: 'yonetici' };
      window.phase2SummaryMetrics = () => ({ appointments: 5, due: 2, overdue: 1, risk: 0 });
      window.showPage = () => {};
      window.logout = () => {};
      window.salonDb = { functions: { invoke: async (_name, { body }) => {
        window.__calls.push(body);
        if (body.action === 'history') return { data: { messages: window.__messages } };
        if (body.action === 'send') { window.__messages.push({ session_id: body.session_id, role: 'user', content: body.message, created_at: new Date().toISOString() }, { session_id: body.session_id, role: 'assistant', content: 'Bugün 5 randevu var.', created_at: new Date().toISOString() }); return { data: { answer: 'Bugün 5 randevu var.' } }; }
        return { data: { ok: true } };
      } } };
      window.__calls = [];
      window.__messages = [];
    });
    await page.addScriptTag({ content: fs.readFileSync('salon-modern-ai.js', 'utf8') });
    assert.equal(await page.locator('h1').innerText(), 'MORİ');
    assert.equal(await page.locator('.sm-ai-summary strong').innerText(), '5 randevu');
    assert.equal(await page.locator('#smAiMic').count(), 1);
    assert.equal(await page.locator('#salonAssistantInput, .assistant-examples, .salon-voice-controls').count(), 0);
    await page.locator('#smAiInput').fill('Bugün işler nasıl?');
    await page.locator('#smAiSend').click();
    await page.locator('.sm-ai-bubble.assistant').waitFor();
    assert.match(await page.locator('.sm-ai-thread').innerText(), /Bugün 5 randevu var/);
    const sent = await page.evaluate(() => window.__calls.find(item => item.action === 'send'));
    assert.equal(sent.message, 'Bugün işler nasıl?');
    await page.locator('[data-view="alerts"]').click();
    assert.match(await page.locator('.sm-ai-alerts').innerText(), /Geciken/);
    await page.locator('[data-view="history"]').click();
    assert.match(await page.locator('.sm-ai-history').innerText(), /30 gün/);
    console.log('PASS MORİ: mobile shell, text chat, alerts, history, legacy UI absent');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
