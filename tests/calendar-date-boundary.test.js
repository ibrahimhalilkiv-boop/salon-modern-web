const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('salon-modern.html', 'utf8');
const start = html.indexOf('function salonCalendarToday(){');
const end = html.indexOf('function installCalendarDaySwipe(){', start);
assert(start > 0 && end > start);

let today = '2026-10-29', previews = 0;
const pastButton = {
  disabled: false, count: { textContent: '7 randevu' },
  getAttribute: () => "selectTeamDay('2026-10-28')",
  classList: { add() {} }, removeAttribute() { this.onclickRemoved = true; },
  querySelector: () => pastButton.count
};
const currentButton = {
  disabled: false, getAttribute: () => "selectTeamDay('2026-10-29')",
  classList: { add() { throw Error('Today disabled'); } },
  querySelector: () => null
};
const ctx = {
  Date,
  Intl: { DateTimeFormat: function() { return { format: () => today }; } },
  window: { salonPreviewCalendarMonth() { previews++; } },
  document: { querySelectorAll: () => [pastButton, currentButton] },
  renderCalendar() {}, teamCalendarDate: undefined, teamCalendarMode: 'day'
};
vm.createContext(ctx);
vm.runInContext(html.slice(start, end), ctx);

assert.equal(ctx.selectedTeamDate(), today);
ctx.moveTeamCalendar(-1);
ctx.selectTeamDay('2026-10-28');
assert.equal(ctx.selectedTeamDate(), today, 'past day cannot be opened by arrow or direct selection');
assert.equal(previews, 0);
ctx.moveTeamCalendar(1);
assert.equal(ctx.selectedTeamDate(), '2026-10-30');
ctx.moveTeamMonth(1);
assert.equal(ctx.selectedTeamDate(), '2026-11-01');
ctx.moveTeamMonth(-1);
assert.equal(ctx.selectedTeamDate(), today, 'returning to current month lands on today');
ctx.moveTeamMonth(-1);
assert.equal(ctx.selectedTeamDate(), today, 'previous month is blocked');
ctx.teamCalendarMode = 'month';
ctx.renderCalendar();
assert.equal(pastButton.disabled, true);
assert.equal(pastButton.count.textContent, '');
assert.equal(pastButton.onclickRemoved, true);
assert.equal(currentButton.disabled, false);
today = '2026-10-30';
assert.equal(ctx.selectedTeamDate(), today, 'Istanbul day rollover advances a stale selection');
console.log('PASS Istanbul today boundary blocks past navigation and month cells');
