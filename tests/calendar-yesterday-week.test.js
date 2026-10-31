const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');

const smart=fs.readFileSync('salon-calendar-smart.js','utf8');
const html=fs.readFileSync('salon-modern.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const weekStart=smart.indexOf('function week(target){');
const bindStart=smart.indexOf('function bind(target){');
const bindEnd=smart.indexOf('function panel(){',bindStart);
assert.ok(weekStart>0&&bindStart>weekStart&&bindEnd>bindStart);

const mock={
  Date,Intl,
  teamCalendarMode:'week',
  selectedTeamDate:()=> '2026-11-01',
  salonCalendarEarliestDay:()=> '2026-10-31',
  all:()=> [
    {id:'OLD_OCT30',when:'2026-10-30',time:'10:00'},
    {id:'YESTERDAY_OCT31',when:'2026-10-31',time:'10:30'},
    {id:'TODAY_NOV1',when:'2026-11-01',time:'11:00'}
  ],
  date:item=>item.when,
  card:item=>'<em>'+item.id+'</em>',
  esc:val=>String(val)
};
vm.createContext(mock);
vm.runInContext(smart.slice(weekStart,smart.indexOf('function decorate(target){',weekStart)),mock);
const target={innerHTML:''};
mock.week(target);
assert.match(target.innerHTML,/data-smart-day="2026-10-30" disabled/);
assert.match(target.innerHTML,/data-smart-day="2026-10-31"/);
assert.doesNotMatch(target.innerHTML,/data-smart-day="2026-10-31" disabled/);
assert.doesNotMatch(target.innerHTML,/OLD_OCT30/,'History beyond yesterday must not be shown');
assert.match(target.innerHTML,/YESTERDAY_OCT31/,'Yesterday appointment visible');
assert.match(target.innerHTML,/TODAY_NOV1/,'Today appointment visible');

const selected=[];
const days=[
  {dataset:{smartDay:'2026-10-30'},disabled:false},
  {dataset:{smartDay:'2026-10-31'},disabled:false},
  {dataset:{smartDay:'2026-11-01'},disabled:false}
];
const controls={
  querySelectorAll(selector){
    if(selector==='[data-smart-day]')return days;
    return [];
  }
};
mock.window={
  selectTeamDay:date=>selected.push(date),
  renderCalendar:()=>{},
  moveTeamCalendar:()=>{}
};
vm.runInContext(smart.slice(bindStart,bindEnd),mock);
mock.bind(controls);
days[0].onclick();days[1].onclick();days[2].onclick();
assert.deepEqual(selected,['2026-10-31','2026-11-01']);
assert.match(html,/salon-calendar-smart\.js\?v=12/);
assert.match(sw,/salon-calendar-smart\.js\?v=12/);
assert.match(sw,/salon-modern-shell-pwa-v194/);
console.log('PASS smart week: yesterday is available, older days muted and unselectable; live calendar asset cached');
