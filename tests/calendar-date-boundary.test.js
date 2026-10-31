const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('salon-modern.html','utf8');
const start = html.indexOf('function salonCalendarToday(){');
const end = html.indexOf('function installCalendarDaySwipe(){',start);
assert.ok(start>0 && end>start);

let today='2026-11-01',previews=0;
function dayButton(date,count){
  const row={
    disabled:false,removed:false,
    count:{textContent:count||'3 randevu'},
    getAttribute:()=>`selectTeamDay('${date}')`,
    classList:{add(){}},
    removeAttribute(){this.removed=true},
    querySelector:()=>row.count
  };
  return row;
}
const older=dayButton('2026-10-30','7 randevu');
const yesterday=dayButton('2026-10-31','11 randevu');
const current=dayButton('2026-11-01','2 randevu');
const ctx={
  Date,
  Intl:{DateTimeFormat:function(){return {format:()=>today}}},
  window:{salonPreviewCalendarMonth(){previews++}},
  document:{querySelectorAll:()=>[older,yesterday,current]},
  renderCalendar(){},teamCalendarDate:undefined,teamCalendarMode:'day'
};
vm.createContext(ctx);
vm.runInContext(html.slice(start,end),ctx);

assert.equal(ctx.salonCalendarEarliestDay(),'2026-10-31','Istanbul previous day crosses month boundary');
assert.equal(ctx.selectedTeamDate(),'2026-11-01');
ctx.moveTeamCalendar(-1);
assert.equal(ctx.selectedTeamDate(),'2026-10-31','Yesterday is navigable');
assert.equal(previews,1);
ctx.moveTeamCalendar(-1);
assert.equal(ctx.selectedTeamDate(),'2026-10-31','Two days ago remains blocked');
assert.equal(previews,1);
ctx.selectTeamDay('2026-10-30');
assert.equal(ctx.selectedTeamDate(),'2026-10-31','Direct selection cannot open older dates');
ctx.selectTeamDay('2026-10-31');
assert.equal(ctx.selectedTeamDate(),'2026-10-31','Direct yesterday selection allowed');
ctx.moveTeamCalendar(1);
assert.equal(ctx.selectedTeamDate(),'2026-11-01');

ctx.moveTeamMonth(-1);
assert.equal(ctx.selectedTeamDate(),'2026-10-31','Previous month accessible only when yesterday is in it');
ctx.moveTeamMonth(-1);
assert.equal(ctx.selectedTeamDate(),'2026-10-31','September is not accessible');
ctx.moveTeamMonth(1);
assert.equal(ctx.selectedTeamDate(),'2026-11-01','Current month navigation returns to today');

ctx.teamCalendarMode='month';
ctx.renderCalendar();
assert.equal(older.disabled,true);
assert.equal(older.count.textContent,'');
assert.equal(older.removed,true);
assert.equal(yesterday.disabled,false,'Yesterday button must stay selectable');
assert.equal(yesterday.count.textContent,'11 randevu');
assert.equal(current.disabled,false);

today='2026-11-02';
assert.equal(ctx.salonCalendarEarliestDay(),'2026-11-01');
ctx.teamCalendarDate='2026-10-31';
assert.equal(ctx.selectedTeamDate(),'2026-11-02','Stale day outside the yesterday boundary resets to today');

today='2027-01-01';
assert.equal(ctx.salonCalendarEarliestDay(),'2026-12-31','Previous-year December allowed on January 1');
today='2024-03-01';
assert.equal(ctx.salonCalendarEarliestDay(),'2024-02-29','Leap-year February 29 allowed on March 1');
today='2025-03-01';
assert.equal(ctx.salonCalendarEarliestDay(),'2025-02-28','Non-leap February 28 allowed');

assert.match(html,/SalonAppointmentData\.loadVisible\(salonDb,'\*',date,salonCalendarEarliestDay\(\)\)/,
 'Preview should fetch yesterday appointments instead of clipping to today');
assert.match(html,/picker\.min=salonCalendarEarliestDay\(\)\.slice\(0,7\)/,
 'Month picker must allow prior month when yesterday belongs to it');
// Test the native month picker too: when yesterday is in the previous month,
// choosing that month must land on yesterday rather than silently reverting to today.
const pickerStart=html.indexOf('function pickTeamMonth(){');
const pickerEnd=html.indexOf('renderCalendar=function(){',pickerStart);
assert.ok(pickerStart>0&&pickerEnd>pickerStart);
const dom={};
const pickerCtx={
  document:{
    getElementById:id=>dom[id]||null,
    createElement:tag=>({tagName:tag,style:{},setAttribute(){},showPicker(){}}),
    body:{appendChild:node=>{dom[node.id]=node}}
  },
  salonCalendarToday:()=> '2026-11-01',
  salonCalendarEarliestDay:()=> '2026-10-31',
  selectedTeamDate:()=> '2026-11-01',
  window:{salonPreviewCalendarMonth(){previews++}},
  renderCalendar(){},teamCalendarDate:null,teamCalendarMode:'day'
};
vm.createContext(pickerCtx);
vm.runInContext(html.slice(pickerStart,pickerEnd),pickerCtx);
pickerCtx.pickTeamMonth();
assert.equal(dom.teamCalendarMonthPicker.min,'2026-10');
dom.teamCalendarMonthPicker.value='2026-10';
dom.teamCalendarMonthPicker.onchange();
assert.equal(pickerCtx.teamCalendarDate,'2026-10-31');
assert.equal(pickerCtx.teamCalendarMode,'month');
dom.teamCalendarMonthPicker.value='2026-09';
dom.teamCalendarMonthPicker.onchange();
assert.equal(pickerCtx.teamCalendarDate,'2026-10-31','Older months blocked in native picker');
dom.teamCalendarMonthPicker.value='2026-11';
dom.teamCalendarMonthPicker.onchange();
assert.equal(pickerCtx.teamCalendarDate,'2026-11-01');
console.log('PASS Istanbul yesterday-only boundary, native month picker, month/year rollover, leap day and preview records');
