const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(process.argv[2], 'playwright'));
const source = fs.readFileSync('salon-phase2-1.8.0.js', 'utf8');
const homeFunction = source.slice(source.indexOf('function phase2RenderHome(){'), source.indexOf('function phase2InstallPage('));
const previousSource = execFileSync('git', ['show', '9513176:salon-phase2-1.8.0.js'], { encoding: 'utf8' });
const previousHomeFunction = previousSource.slice(previousSource.indexOf('function phase2RenderHome(){'), previousSource.indexOf('function phase2InstallPage(')).replace('function phase2RenderHome(){', 'function phase2RenderHomeBeforeFix(){');
const html = fs.readFileSync('salon-modern.html', 'utf8');
const summaryFunction = html.slice(html.indexOf('function renderHomeSummary(){'), html.indexOf('function enterApp(){'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<section id="home"><div hidden id="legacyHomeBindings"><span id="todayText"></span><span id="nextTitle"></span></div></section>');
    await page.addScriptTag({ content: `var currentUser={role:'yonetici'};
      function phase2SummaryMetrics(){return {due:0,overdue:0,risk:0}}
      function phase2Actionable(){return []}
      function phase2IsManager(){return true}
      function phase2SummaryHtml(){return ''}
      function phase2AssistantHtml(){return ''}
      function phase2MoneyCard(){return ''}
      function phase2AttentionCards(){return ''}
      var staff=[],appts=[];function visibleAppointments(){return appts}
      ${summaryFunction}
      ${previousHomeFunction}
      ${homeFunction}` });
    const baseline = await page.evaluate(() => {
      phase2RenderHomeBeforeFix();
      try { renderHomeSummary(); return ''; }
      catch (error) { return error.stack; }
    });
    assert.match(baseline, /renderHomeSummary/);
    assert.match(baseline, /Cannot set properties of null \(setting 'textContent'\)/);
    await page.setContent('<section id="home"><div hidden id="legacyHomeBindings"><span id="todayText"></span><span id="nextTitle"></span></div></section>');
    const result = await page.evaluate(() => {
      const original = document.getElementById('legacyHomeBindings');
      phase2RenderHome(); phase2RenderHome();
      document.getElementById('todayText').textContent = '6 randevu';
      return { same: document.getElementById('legacyHomeBindings') === original,
        count: document.querySelectorAll('#legacyHomeBindings').length,
        text: document.getElementById('todayText').textContent };
    });
    assert.deepEqual(result, { same: true, count: 1, text: '6 randevu' });
    console.log('PASS repeated home redraw preserves legacy bindings used by background refresh');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
