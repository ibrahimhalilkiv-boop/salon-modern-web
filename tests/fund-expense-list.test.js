const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('salon-finance-2.3.0.js','utf8');
const main = fs.readFileSync('salon-modern.html','utf8');
const worker = fs.readFileSync('sw.js','utf8');

assert.match(source,/from\('reserve_ledger'\)\.select\('id,entry_date,entry_type,amount,note,created_at'\)\.eq\('entry_type','main_expense'\)/);
assert.match(main,/salon-finance-2\.3\.0\.js\?v=106/);
assert.match(worker,/salon-finance-2\.3\.0\.js\?v=106/);
assert.match(worker,/salon-modern-shell-pwa-v191/);

const start=source.indexOf('function renderReserve(){');
const end=source.indexOf('async function saveFinance230Rule(',start);
assert.ok(start>=0&&end>start);
const holder={innerHTML:''};
const context={
  document:{getElementById:id=>id==='finance230Reserve'?holder:null},
  financeState:{
    rules:[],
    reserveSummary:{
      as_of:'2026-10-31',current_balance:86051,opening_balance:68832,
      contributions:17219,main_expenses:-100,adjustments:0,current_month_movement:17119
    },
    ledger:[
      {entry_type:'contribution',entry_date:'2026-10-31',amount:2000,note:'HIDDEN_DAILY_FUND_TOPUP'},
      {entry_type:'adjustment',entry_date:'2026-10-29',amount:-200,note:'HIDDEN_ADJUSTMENT'},
      {entry_type:'opening',entry_date:'2026-10-01',amount:500,note:'HIDDEN_OPENING'},
      ...Array.from({length:25},(_,i)=>({
        entry_type:'main_expense',entry_date:'2026-10-31',amount:-(i+1),note:'EXPENSE_'+i
      }))
    ]
  },
  esc:x=>String(x),
  money:x=>'TL'+Number(x).toFixed(2),
  finance230LedgerHtml:rows=>'<summary>'+JSON.stringify(rows)+'</summary>',
  today:()=>'2026-10-31'
};
vm.runInNewContext(source.slice(start,end),context);
context.renderReserve();
const html=holder.innerHTML;
const history=html.split('<h2>Fondan ödenen giderler</h2>')[1]?.split('<h2>Fon kuralları</h2>')[0];
assert.ok(history,'Expense list must exist');
assert.match(history,/EXPENSE_0/);
assert.doesNotMatch(history,/HIDDEN_DAILY_FUND_TOPUP|HIDDEN_ADJUSTMENT|HIDDEN_OPENING|EXPENSE_24/);
assert.equal((history.match(/<strong>Fondan ödenen gider<\/strong>/g)||[]).length,20);
assert.match(history,/20 gider/);
assert.match(html,/TL86051\.00/,'Running fund balance remains unchanged');
assert.match(html,/Bu ay fona eklenen/,'Monthly accounting still includes contributions');

context.financeState.ledger=[
  {entry_type:'contribution',entry_date:'2026-10-31',amount:2000,note:'HIDDEN_ONLY_CONTRIBUTION'}
];
context.renderReserve();
assert.match(holder.innerHTML,/Henüz fondan gider kaydı yok/);
assert.doesNotMatch(holder.innerHTML,/HIDDEN_ONLY_CONTRIBUTION/);
console.log('PASS: only main_expense movements appear; 20 latest expenses; totals and monthly contributions unchanged');
