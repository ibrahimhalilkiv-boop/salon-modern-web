const assert=require('node:assert/strict'),fs=require('node:fs');
const shell=fs.readFileSync('salon-modern.html','utf8'),admin=fs.readFileSync('booking-schedule-admin-2.4.1.js','utf8');
for(const source of [shell,admin]){
  assert.match(source,/var units=Math.min\(slots.length-start,2\)/);
  const expression=source.match(/var units=(Math.min\(slots.length-start,2\))/)[1];
  const display=new Function('slots','start','item','return '+expression);
  for(const duration of [15,30,45,60,90]){
    const item={duration};
    assert.equal(display(Array(44),4,item),2);
    assert.equal(item.duration,duration,'Rendering must not alter actual duration');
  }
  assert.equal(display(Array(44),43,{duration:90}),1,'Clip only at the calendar boundary');
  assert.match(source,/new Date\(slot.ends_at\)/,'Closed blocks keep actual duration');
}
assert.match(admin,/finish=at\+Math.max\(15,Number\(item.duration\|\|30\)\)/,'Calendar extent still includes actual finish');
console.log('PASS calendar display-only 30 minutes, unchanged real durations and closed blocks');
