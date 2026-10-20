const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(path.join(process.argv[2], 'playwright'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [320, 375, 591]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<style>:root{--line:#e7e2d8;--red:#a9514d}.app{max-width:440px;margin:auto}.content{padding:20px}.appointment{background:#fffdf9;border-radius:15px;padding:13px;display:flex;gap:11px;align-items:center;margin-bottom:9px}.item-main{flex:1;min-width:0}.item-main strong,.item-main small{display:block}.link,.remove{border:0;background:none}</style><div id="app" class="app"></div>');
      await page.addStyleTag({ path: path.resolve('appointment-list-management.css') });
      await page.evaluate(() => {
        window.currentUser = { id: 'staff', role: 'calisan' };
        window.appts = [];
        window.enterApp = () => {};
        window.showPage = () => {};
        window.toggleDrawer = () => {};
        window.logout = () => {};
        window.closeAppointmentModal = () => {};
        window.closeAppointmentDeleteModal = () => {};
        window.reloadRemoteData = async () => {};
        window.canManageOwnAppointment = () => true;
        window.SalonNoShow = { canMark: () => true, canUndo: () => false, mark: () => {} };
        window.remoteAppointment = a => ({ id: a.id, customer: a.client_name, operation: a.service_name,
          employeeId: a.employee_id, staff: 'Halil Kıv', date: '2026-10-19', time: '09:00', amount: 800,
          status: a.status });
        window.salonDb = {
          auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) },
          from: () => ({ select() { return this; }, gte() { return this; }, lt() { return this; },
            neq() { return this; }, order() { return this; }, eq() { return this; },
            range: async () => ({ data: [{ id: 'one', client_name: 'Mustafa Çalar',
              service_name: 'Saç sakal kesim yıkama', employee_id: 'staff',
              scheduled_at: '2026-10-19T09:00:00+03:00', status: 'confirmed', amount: 800 }], error: null }) }),
        };
        window.fetch = async () => ({ ok: true, json: async () => ({ sourceAppointmentIds: [] }) });
      });
      await page.addScriptTag({ path: path.resolve('appointment-list-management-2.4.4.js') });
      await page.evaluate(() => window.SalonAppointmentList.load());
      const result = await page.evaluate(() => {
        const card = document.querySelector('.managed-appointment');
        const cardBox = card.getBoundingClientRect();
        return { cardLeft: cardBox.left, cardRight: cardBox.right,
          textRight: card.querySelector('.item-main').getBoundingClientRect().right,
          actions: [...card.querySelectorAll('.managed-actions button')].map(button => {
            const b = button.getBoundingClientRect();
            return { left: b.left, right: b.right, top: b.top };
          }) };
      });
      assert.equal(result.actions.length, 4);
      assert(result.actions.every(b => b.left >= result.cardLeft && b.right <= result.cardRight),
        width + 'px: actions must remain inside their card');
      assert(result.textRight <= result.cardRight, width + 'px: detail must not be squeezed outside the card');
      assert(result.actions[0].top > 0);
      await page.close();
    }
    console.log('PASS appointment action layout at 320, 375 and 591 px');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
