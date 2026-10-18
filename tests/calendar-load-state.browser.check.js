const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(process.argv[2], 'playwright'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="calendarContent"></div>');
    await page.addScriptTag({ content: 'window.renderCalendar=function(){document.getElementById("calendarContent").innerHTML="<button>09:00</button>"}' });
    await page.addScriptTag({ content: fs.readFileSync('salon-calendar-status.js', 'utf8') });
    for (const status of ['loading', 'error', 'ready']) {
      const result = await page.evaluate(status => {
        window.salonCalendarLoadState = { status };
        renderCalendar();
        const root = document.getElementById('calendarContent');
        return { notice: root.querySelector('#salonCalendarLoadNotice')?.textContent || '',
          busy: root.getAttribute('aria-busy'), blocked: root.style.pointerEvents };
      }, status);
      if (status === 'ready') assert.deepEqual(result, { notice: '', busy: 'false', blocked: '' });
      else {
        assert.match(result.notice, /boş olarak doğrulanmadı/);
        assert.equal(result.blocked, 'none');
        assert.equal(result.busy, status === 'loading' ? 'true' : 'false');
      }
    }
    console.log('PASS calendar differentiates loading, failed and genuinely empty days');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
