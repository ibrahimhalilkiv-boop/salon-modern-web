const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.join(process.argv[2], 'playwright'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 760 }, hasTouch: true, isMobile: true });
    let availabilityCalls = 0, codeRequests = 0;
    await page.route('https://fixture.test/**', route => {
      const name = new URL(route.request().url()).pathname.split('/').pop() || 'index.html';
      if (name.endsWith('.png')) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) });
      const file = `randevu/${name}`;
      return route.fulfill({ status: 200, contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(file, 'utf8') });
    });
    await page.route('https://oxuwwjsakhcqimjsfris.supabase.co/**', route => {
      const action = new URL(route.request().url()).searchParams.get('action');
      if (action === 'catalogue') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ services: [{ id: 's1', name: 'Saç sakal ağda maske yıkama ve uzun hizmet adı', price: 1000 }], employees: [] }) });
      if (action === 'booking-identity') { const body = JSON.parse(route.request().postData()); assert.equal(body.serviceId, 's1'); const registered = body.name === 'Kayıtlı Müşteri'; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ employees: [{ id: 'c1', full_name: 'Cengiz' }, { id: 'h1', full_name: 'Halil' }, { id: 'm1', full_name: 'Mehmet' }, { id: 't1', full_name: 'Talip' }], recommendedEmployeeId: registered ? 'h1' : null }) }); }
      assert.equal(route.request().method(), 'GET', 'The test must not create a real appointment');
      assert.equal(action, 'availability');
      availabilityCalls++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allSlots: [{ time: '10:00', available: availabilityCalls !== 1, status: availabilityCalls === 1 ? 'busy' : 'available' }], slots: availabilityCalls === 1 ? [] : [{ time: '10:00' }] }) });
    });
    await page.goto('https://fixture.test/randevu/');
    await page.locator('#services button').waitFor({ state: 'attached' });
    const price = await page.locator('#services strong').evaluate(node => {
      const box = node.getBoundingClientRect();
      const button = node.closest('button').getBoundingClientRect();
      return { text: node.textContent, height: box.height, lineHeight: parseFloat(getComputedStyle(node).lineHeight), right: box.right, buttonRight: button.right };
    });
    assert.equal(price.text, '₺ 1.000');
    assert(price.height < 35, 'Price should fit on one line on a 320px screen');
    assert(price.buttonRight - price.right < 25, 'Price should remain right-aligned');
    assert(await page.locator('.step[data-step="1"]').isVisible());
    await page.locator('#customerName').fill('Örnek Müşteri');
    await page.locator('#customerPhone').fill('0555 111 22 33');
    await page.locator('#continueCustomerButton').click();
    assert(await page.locator('.step[data-step="2"]').isVisible());
    await page.locator('#services button').click();
    await page.locator('.step[data-step="3"]').waitFor({ state: 'visible' });
    assert(await page.locator('.step[data-step="3"]').isVisible());
    assert.equal(codeRequests, 0, 'No verification code should be requested');
    assert.deepEqual(await page.locator('#employees button').allInnerTexts(), ['Cengiz', 'Halil', 'Mehmet', 'Talip']);
    await page.locator('#employees button').first().click();
    assert(await page.locator('.step[data-step="4"]').isVisible());
    assert.equal(await page.locator('#nextButton').isVisible(), false);
    assert.equal(await page.locator('#bookingDate').inputValue(), '', 'Missing date must not auto-advance');
    const date1 = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
    const date2 = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await page.locator('#bookingDate').fill(date1);
    await page.locator('.step[data-step="5"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#slots button:not([disabled])').count(), 0, 'Empty availability must not expose bookable hours');
    await page.locator('#nextButton').click();
    assert(await page.locator('.step[data-step="5"]').isVisible(), 'No booking can advance without a selected available hour');
    await page.locator('#backButton').click();
    await page.locator('#bookingDate').fill(date2);
    await page.locator('.step[data-step="5"]').waitFor({ state: 'visible' });
    await page.locator('#backButton').click();
    assert.equal(await page.locator('#bookingDate').inputValue(), date2, 'Back navigation should keep the selected date');
    await page.locator('#backButton').click();
    await page.locator('#employees button').last().click();
    assert(await page.locator('.step[data-step="4"]').isVisible(), 'Changing employee should still advance');
    assert.equal(await page.locator('#bookingDate').inputValue(), '', 'Changing employee must require a fresh availability check');
    await page.locator('#backButton').click();
    await page.locator('#backButton').click();
    await page.locator('#backButton').click();
    await page.locator('#customerName').fill('Kayıtlı Müşteri');
    await page.locator('#continueCustomerButton').click();
    await page.locator('#services button').click();
    await page.locator('.step[data-step="3"]').waitFor({ state: 'visible' });
    assert.match(await page.locator('#employees button.selected').innerText(), /Halil.*Önerilen çalışan/s);
    await page.locator('#nextButton').click();
    assert(await page.locator('.step[data-step="4"]').isVisible(), 'Öneri tek dokunuşla kabul edilebilmeli');
    await page.locator('#backButton').click();
    await page.locator('#employees button').first().click();
    assert(await page.locator('.step[data-step="4"]').isVisible(), 'Önerilen çalışan değiştirilebilir olmalı');
    assert.equal(codeRequests, 0, 'No verification code should be requested');
    console.log('PASS online booking form: mobile price, code-free customer details, staff routing, empty slots, back and employee reselection');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
