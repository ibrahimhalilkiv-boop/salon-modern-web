const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('salon-holiday-hours-20261101.js','utf8');
const html=fs.readFileSync('salon-modern.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261101002000_staff_occupancy_default_sunday_closed.sql','utf8');

assert.match(html,/salon-holiday-hours-20261101\.js\?v=1/);
assert.match(sw,/salon-holiday-hours-20261101\.js\?v=1/);
assert.match(sw,/salon-modern-shell-pwa-v196/);
assert.match(sql,/EXTRACT\(ISODOW FROM d\.day::date\)=7/);
assert.match(sql,/o\.schedule_date IS NULL/);
assert.match(sql,/booking_schedule_overrides/);
assert.match(sql,/a\.status='completed'/);
assert.match(source,/from\('booking_schedule_overrides'\)/);
assert.doesNotMatch(source,/booking_settings'\)\s*\.update/);
assert.match(source,/isManager\(\)/);

const helperStart=source.indexOf('function datesBetween(');
const helperEnd=source.indexOf('function render(',helperStart);
const helpers=vm.runInNewContext(source.slice(helperStart,helperEnd)+'\nthis.helpers={datesBetween,validHour}',{}).helpers;
assert.deepEqual(Array.from(helpers.datesBetween('2026-05-21','2026-05-25')),[
 '2026-05-21','2026-05-22','2026-05-23','2026-05-24','2026-05-25'
]);
assert.deepEqual(Array.from(helpers.datesBetween('2026-12-30','2027-01-02')),[
 '2026-12-30','2026-12-31','2027-01-01','2027-01-02'
]);
assert.deepEqual(Array.from(helpers.datesBetween('2028-02-28','2028-03-01')),[
 '2028-02-28','2028-02-29','2028-03-01'
]);
assert.throws(()=>helpers.datesBetween('2026-12-07','2026-12-06'),/Bitiş tarihi/);
assert.throws(()=>helpers.datesBetween('2026-01-01','2026-02-02'),/en fazla 31/);
assert.throws(()=>helpers.datesBetween('2026-02-30','2026-03-03'),/Geçerli tarih/);
assert.equal(helpers.validHour('09:00'),true);
assert.equal(helpers.validHour('22:30'),true);
assert.equal(helpers.validHour('22:15'),false);

const fields={
 holidayRangeStart:{value:'2026-05-21'},
 holidayRangeEnd:{value:'2026-05-25'},
 holidayRangeOpen:{value:'09:00'},
 holidayRangeClose:{value:'22:00'},
 holidayRangeSave:{disabled:false,textContent:'Seçilen günlere uygula'},
 holidayRangeResult:{textContent:'',style:{}}
};
const writes=[];
const context={
  currentUser:{id:'manager-uuid',role:'yonetici'},
  document:{getElementById:id=>fields[id]||null},
  window:{confirm:()=>true,renderCalendar:()=>{},showAppToast:()=>{}},
  Intl,Date,Number,String,Array,Math,Promise,
  salonDb:{from(table){
    assert.equal(table,'booking_schedule_overrides');
    return {
      select(){return {in(name,values){assert.equal(name,'schedule_date');return Promise.resolve({data:[],error:null})}}},
      upsert(rows,opts){
        writes.push({rows,opts});
        return {select(){return Promise.resolve({data:rows,error:null})}};
      }
    };
  }}
};
const executeSource='var saving=false;function isManager(){return currentUser&&currentUser.role===\'yonetici\'}\n'+
 source.slice(helperStart,helperEnd)+
 source.slice(source.indexOf('function formValues()'),source.indexOf('async function removeRange()'))+
 '\nthis.saveHolidayHours=save;';
vm.runInNewContext(executeSource,context);
(async()=>{
 await context.saveHolidayHours({preventDefault(){}});
 assert.equal(writes.length,1);
 assert.equal(writes[0].rows.length,5);
 assert.equal(writes[0].rows[3].schedule_date,'2026-05-24','Sunday must be included and explicitly opened');
 assert.ok(writes[0].rows.every(r=>!r.is_closed&&r.open_time==='09:00'&&r.close_time==='22:00'));
 assert.equal(writes[0].opts.onConflict,'schedule_date');
 assert.match(fields.holidayRangeResult.textContent,/5 gün kaydedildi/);
 assert.equal(fields.holidayRangeSave.disabled,false);

 fields.holidayRangeClose.value='21:15';
 await context.saveHolidayHours({preventDefault(){}});
 assert.equal(writes.length,1,'Invalid half-hour inputs must not write overrides');
 fields.holidayRangeClose.value='22:00';

 context.currentUser.role='employee';
 await context.saveHolidayHours({preventDefault(){}});
 assert.equal(writes.length,1,'Employees must not update manager-only schedule');
 console.log('PASS: five-day temporary hours, Sunday override, year/leap boundaries, manager-only and input checks');
})().catch(error=>{console.error(error);process.exitCode=1});
