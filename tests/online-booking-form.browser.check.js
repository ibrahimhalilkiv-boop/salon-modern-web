const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.join(process.argv[2], 'playwright'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 760 }, hasTouch: true, isMobile: true });
    let availabilityCalls = 0;
    await page.route('https://fixture.test/**', route => {
      const name = new URL(route.request().url()).pathname.split('/').pop() || 'index.html';
      if (name.endsWith('.png')) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) });
      const file = `randevu/${name}`;
      return route.fulfill({ status: 200, contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(file, 'utf8') });
    });
    await page.route('https://oxuwwjsakhcqimjsfris.supabase.co/**', route => {
      assert.equal(route.request().method(), 'GET', 'The form must not create a real appointment');
      const action = new URL(route.request().url()).searchParams.get('action');
      if (action === 'catalogue') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ services: [{ id: 's1', name: 'Saç sakal ağda maske yıkama ve uzun hizmet adı', price: 1000 }], employees: [{ id: 'e1', full_name: 'Halil Usta' }] }) });
      assert.equal(action, 'availability');
      availabilityCalls++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slots: availabilityCalls === 1 ? [] : [{ time: '10:00' }] }) });
    });
    await page.goto('https://fixture.test/randevu/');
    await page.locator('#services button').waitFor();
    const price = await page.locator('#services strong').evaluate(node => {
      const box = node.getBoundingClientRect();
      const button = node.closest('button').getBoundingClientRect();
      return { text: node.textContent, height: box.height, lineHeight: parseFloat(getComputedStyle(node).lineHeight), right: box.right, buttonRight: button.right };
    });
    assert.equal(price.text, '₺ 1.000');
    assert(price.height < 35, 'Price should fit on one line on a 320px screen');
    assert(price.buttonRight - price.right < 25, 'Price should remain right-aligned');
    await page.locator('#services button').click();
    assert(await page.locator('.step[data-step="2"]').isVisible());
    assert.equal(await page.locator('#nextButton').isVisible(), false);
    assert.equal(await page.locator('#employees button').last().innerText(), 'Fark etmez');
    await page.locator('#employees button').last().click();
    assert(await page.locator('.step[data-step="3"]').isVisible());
    assert.equal(await page.locator('#nextButton').isVisible(), false);
    assert.equal(await page.locator('#bookingDate').inputValue(), '', 'Missing date must not auto-advance');
    const date1 = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
    const date2 = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await page.locator('#bookingDate').fill(date1);
    assert(await page.locator('.step[data-step="3"]').isVisible(), 'No available slots must not advance');
    await page.locator('#bookingDate').fill(date2);
    await page.locator('.step[data-step="4"]').waitFor({ state: 'visible' });
    await page.locator('#backButton').click();
    assert.equal(await page.locator('#bookingDate').inputValue(), date2, 'Back navigation should keep the selected date');
    await page.locator('#backButton').click();
    await page.locator('#employees button').first().click();
    assert(await page.locator('.step[data-step="3"]').isVisible(), 'Changing employee should still advance');
    assert.equal(await page.locator('#bookingDate').inputValue(), '', 'Changing employee must require a fresh availability check');
    console.log('PASS online booking form: one-line mobile price, automatic steps, Fark etmez, empty slots, back and employee reselection');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
