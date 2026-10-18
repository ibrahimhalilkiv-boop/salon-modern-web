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
      window.salonPhase2SummaryMetrics = () => ({ appointments: 5, due: 2, overdue: 1, risk: 0 });
      window.showPage = () => {};
      window.logout = () => {};
      window.__voiceLog = [];
      window.SpeechRecognition = class {
        start() { window.__recognition = this; this.onstart?.(); }
        stop() { this.onend?.(); }
        abort() { this.onend?.(); }
      };
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [{ lang: 'tr-TR', name: 'Türkçe' }],
        speak: utterance => { window.__lastUtterance = utterance; window.__voiceLog.push(['speak', utterance.lang, utterance.text]); utterance.onstart?.(); },
        cancel: () => window.__voiceLog.push(['cancel'])
      } });
      window.salonDb = { functions: { invoke: async (_name, { body }) => {
        window.__calls.push(body);
        if (body.action === 'summary') return { data: { summary: { count: 5, alerts: { due: 2, overdue: 1, risk: 0 } } } };
        if (body.action === 'proactive_alerts') return { data: { events: [{ id: '00000000-0000-4000-8000-000000000010', category: 'calendar', severity: 'critical', title: 'Takvimde randevu çakışması', detail: 'Yarın 08:00 saatinde iki randevu var.', route: 'calendar', state: 'active', read_at: null, last_seen_at: '2026-10-18T08:00:00Z' }], digests: [{ business_date: '2026-10-18', facts: { appointments: 5, pending_requests: 1, active_alerts: 1, yesterday_turnover: 3000, staff: [{ name: 'Cengiz', appointments: ['08:00'] }], performance: [] } }] } };
        if (body.action === 'follow_settings') return { data: { settings: { enabled: true, categories: ['calendar','booking','daily'], digest_time: '09:00', quiet_start: '22:00', quiet_end: '08:00' } } };
        if (body.action === 'history') return { data: { messages: window.__messages } };
        if (body.action === 'send') { window.__messages.push({ session_id: body.session_id, role: 'user', content: body.message, created_at: new Date().toISOString() }, { session_id: body.session_id, role: 'assistant', content: 'Bugün 5 randevu var.', created_at: new Date().toISOString() }); return { data: body.message.includes('randevu oluştur') ? { answer: 'Onay gerekiyor.', pending: [{ id: '00000000-0000-4000-8000-000000000002', kind: 'appointment_create', description: 'Test randevusu' }] } : { answer: 'Bugün 5 randevu var.' } }; }
        if (body.action === 'confirm') return { data: { answer: 'Randevu oluşturuldu.', result: { kind: 'appointment_create', appointment_id: '00000000-0000-4000-8000-000000000003', client_name: 'Test', service: 'Saç sakal', scheduled_at: '2026-10-19T05:00:00Z' } } };
        return { data: { ok: true } };
      } } };
      window.__calls = [];
      window.__messages = [];
    });
    await page.addScriptTag({ content: fs.readFileSync('salon-modern-ai.js', 'utf8') });
    assert.equal(await page.locator('h1').innerText(), 'MORİ');
    assert.equal(await page.locator('.sm-ai-summary strong').innerText(), '5 randevu');
    await page.evaluate(() => window.showPage('salonAssistant'));
    await page.waitForFunction(() => window.__calls.some(item => item.action === 'summary'));
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
    await page.locator('[data-mori-event]').click();
    assert.match(await page.locator('.sm-ai-event-detail').innerText(), /Devam ediyor/);
    assert.ok(await page.evaluate(() => window.__calls.some(item => item.action === 'read_proactive_alert')));
    await page.locator('[data-mori-ask]').click();
    assert.equal(await page.locator('#smAiInput').inputValue(), 'Bu uyarı neden önemli, nasıl çözebiliriz?');
    await page.locator('#smAiSettings').click();
    await page.locator('#smAiSettingsForm').waitFor();
    await page.locator('#smAiSettingsForm button[type="submit"]').click();
    assert.ok(await page.evaluate(() => window.__calls.some(item => item.action === 'save_follow_settings' && item.digest_time === '09:00')));
    await page.locator('[data-view="history"]').click();
    assert.match(await page.locator('.sm-ai-history').innerText(), /30 gün/);
    await page.locator('[data-view="chat"]').click();
    await page.locator('#smAiMic').click();
    assert.equal(await page.evaluate(() => window.__recognition.lang), 'tr-TR');
    await page.evaluate(() => window.__recognition.onresult({ results: [Object.assign([{ transcript: 'Bugünkü randevuları söyle' }], { isFinal: true })] }));
    await page.waitForFunction(() => window.__calls.filter(item => item.action === 'send').length === 2);
    await page.waitForFunction(() => window.__voiceLog.some(item => item[0] === 'speak'));
    assert.match(await page.locator('.sm-ai-thread').innerText(), /Bugünkü randevuları söyle/);
    await page.locator('#smAiHands').click();
    await page.evaluate(() => { window.__firstRecognition = window.__recognition; });
    await page.evaluate(() => window.__lastUtterance.onend());
    assert.equal(await page.locator('#smAiMic').getAttribute('aria-pressed'), 'true');
    assert.ok(await page.evaluate(() => window.__recognition !== window.__firstRecognition));
    await page.locator('#smAiMic').click();
    await page.locator('#smAiVoice').click();
    assert.equal(await page.locator('#smAiVoice').getAttribute('aria-pressed'), 'false');
    await page.locator('#smAiVoice').click();
    await page.evaluate(() => window.__lastUtterance.onstart());
    await page.locator('#smAiStop').click();
    assert.ok(await page.evaluate(() => window.__voiceLog.some(item => item[0] === 'cancel')));
    await page.locator('#smAiInput').fill('Test randevu oluştur');
    await page.locator('#smAiSend').click();
    await page.locator('[data-confirm]').click();
    await page.locator('[data-appointment]').waitFor();
    assert.match(await page.locator('.sm-ai-thread').innerText(), /Randevu oluşturuldu/);
    console.log('PASS MORİ: mobile shell, voice, approvals, proactive alert detail/read, settings, history, legacy UI absent');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
