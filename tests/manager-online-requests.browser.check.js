const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(path.join(process.argv[2], 'playwright'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const id = '11111111-1111-4111-8111-111111111111';
    const calls = [];
    let status = 'pending';
    await page.route('https://oxuwwjsakhcqimjsfris.supabase.co/functions/v1/customer-booking-request**', async route => {
      const action = new URL(route.request().url()).searchParams.get('action');
      const body = route.request().postDataJSON();
      calls.push({ action, body });
      if (action === 'approve') status = 'approved';
      const request = { id, status, customer_name: 'Test Müşteri', customer_phone: '905000000000',
        service_id: '22222222-2222-4222-8222-222222222222', employee_id: '33333333-3333-4333-8333-333333333333',
        service_name: 'Kesim', requested_start_at: '2026-11-01T07:30:00Z', created_at: '2026-10-26T09:00:00Z',
        note: 'Müşteri notu' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(action === 'admin-list' ? { requests: [request] } : { ok: true }) });
    });
    await page.goto('about:blank');
    await page.setContent('<div id="app"><div class="nav"></div></div><section id="managedAppointments" class="active"><div id="managedOnlineRequestsList"></div><span id="managedOnlineRequestCount"></span></section>');
    await page.evaluate(() => {
      window.currentUser = { id: 'manager', role: 'yonetici' };
      window.remoteProfiles = [{ id: '33333333-3333-4333-8333-333333333333', full_name: 'Çalışan', active: true }];
      window.remoteServices = [{ id: '22222222-2222-4222-8222-222222222222', name: 'Kesim', active: true }];
      window.enterApp = () => {};
      window.showPage = id => { document.querySelectorAll('.page').forEach(node => node.classList.remove('active')); document.getElementById(id)?.classList.add('active') };
      window.salonDb = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) },
        channel: () => ({ on() { return this }, subscribe() { return this } }) };
    });
    await page.addScriptTag({ path: path.resolve('booking-requests-admin-2.4.0.js') });
    await page.locator('#managedOnlineRequestsList .booking-request-card').waitFor();
    assert.equal(await page.locator('#managedOnlineRequestCount').innerText(), '1');
    assert.equal(await page.locator('#managedOnlineRequestsList input[type="time"]').inputValue(), '10:30');
    await page.locator('#managedOnlineRequestsList input[type="time"]').fill('11:00');
    await page.locator('#managedOnlineRequestsList button').filter({ hasText: 'Güncelle' }).click();
    await page.waitForFunction(() => document.querySelector('#managedOnlineRequestsList .booking-request-card'));
    const update = calls.find(call => call.action === 'update');
    assert.equal(update.body.startAt, '2026-11-01T08:00:00.000Z');
    await page.locator('#managedOnlineRequestsList button').filter({ hasText: 'Onayla' }).click();
    await page.waitForFunction(() => document.querySelector('#managedOnlineRequestCount')?.textContent === '0');
    assert.deepEqual(calls.map(call => call.action).filter(action => action !== 'admin-list'), ['update', 'update', 'approve']);
    console.log('PASS manager online requests: pending card, half-hour time, update, approval and refresh');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
