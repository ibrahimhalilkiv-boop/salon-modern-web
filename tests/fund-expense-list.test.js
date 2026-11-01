const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('salon-finance-2.3.0.js','utf8');
const main=fs.readFileSync('salon-modern.html','utf8');
const worker=fs.readFileSync('sw.js','utf8');

assert.match(source,/from\('reserve_ledger'\)[\s\S]{0,180}\.eq\('entry_type','main_expense'\)/);
assert.match(source,/\.range\(offset,offset\+pageSize-1\)/);
assert.doesNotMatch(source,/from\('reserve_ledger'\)[\s\S]{0,270}\.limit\(50\)/);
assert.match(main,/salon-finance-2\.3\.0\.js\?v=106/);
assert.match(worker,/salon-finance-2\.3\.0\.js\?v=106/);
assert.match(worker,/salon-modern-shell-pwa-v\d+/);

const start=source.indexOf('function finance230ExpensesByMonthHtml(');
const end=source.indexOf('async function saveFinance230Rule(',start);
assert.ok(start>0&&end>start,'The grouped history renderer must exist');

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
      {entry_type:'adjustment',entry_date:'2026-09-29',amount:-200,note:'HIDDEN_ADJUSTMENT'},
      {entry_type:'opening',entry_date:'2026-08-01',amount:500,note:'HIDDEN_OPENING'},
      {entry_type:'main_expense',entry_date:'2026-11-02',amount:-64562,note:'EXPENSE_NOVEMBER'},
      ...Array.from({length:25},(_,i)=>({entry_type:'main_expense',entry_date:'2026-10-31',amount:-(i+1),note:'EXPENSE_OCTOBER_'+i})),
      {entry_type:'main_expense',entry_date:'2026-09-19',amount:-900,note:'EXPENSE_SEPTEMBER'},
      {entry_type:'main_expense',entry_date:'2026-08-18',amount:-100,note:'EXPENSE_AUGUST'}
    ]
  },
  esc:x=>String(x),
  money:x=>'TL'+Number(x).toFixed(2),
  finance230LedgerHtml:rows=>'<summary>'+JSON.stringify(rows)+'</summary>',
  today:()=>'2026-10-31',
  Map,Intl,Date
};
vm.runInNewContext(source.slice(start,end),context);
context.renderReserve();
const html=holder.innerHTML;
const history=html.split('<h2>Fondan ödenen giderler</h2>')[1]?.split('<h2>Fon kuralları</h2>')[0];
assert.ok(history,'Grouped expense history must exist');
assert.match(history,/28 gider · Tüm aylar/);
assert.match(history,/EXPENSE_NOVEMBER|EXPENSE_OCTOBER_24|EXPENSE_SEPTEMBER|EXPENSE_AUGUST/);
assert.doesNotMatch(history,/HIDDEN_DAILY_FUND_TOPUP|HIDDEN_ADJUSTMENT|HIDDEN_OPENING/);
assert.equal((history.match(/<strong>Fondan ödenen gider<\/strong>/g)||[]).length,28);
assert.ok(
 history.indexOf('Kasım 2026')<history.indexOf('Ekim 2026') &&
 history.indexOf('Ekim 2026')<history.indexOf('Eylül 2026') &&
 history.indexOf('Eylül 2026')<history.indexOf('Ağustos 2026'),
 'All months must appear from newest to oldest'
);
assert.match(history,/25 gider · Toplam TL325\.00/,'Monthly sum is based on fund expenses only');
assert.match(html,/TL86051\.00/,'Cumulative fund balance must remain intact');
assert.match(html,/Bu ay fona eklenen/,'Monthly fund summary still includes contributions');

context.financeState.ledger=[{entry_type:'contribution',entry_date:'2026-10-31',amount:2000,note:'HIDDEN_ONLY_CONTRIBUTION'}];
context.renderReserve();
assert.match(holder.innerHTML,/Henüz fondan gider kaydı yok/);
assert.doesNotMatch(holder.innerHTML,/HIDDEN_ONLY_CONTRIBUTION/);

(async()=>{
 const records=Array.from({length:1205},(_,i)=>({
  id:String(i),entry_date:i<500?'2026-11-02':i<1000?'2026-10-15':'2026-09-12',
  entry_type:'main_expense',amount:-1,created_at:'2026-10-31T21:00:00Z'
 }));
 const pages=[];
 const query={
  select(){return this},
  eq(field,value){assert.equal(field,'entry_type');assert.equal(value,'main_expense');return this},
  order(){return this},
  range(start,end){pages.push([start,end]);return Promise.resolve({data:records.slice(start,end+1),error:null})}
 };
 const loaderStart=source.indexOf('async function finance230LoadAllReserveExpenses(){');
 const loaderEnd=source.indexOf('async function loadFinance230(force){',loaderStart);
 assert.ok(loaderStart>0&&loaderEnd>loaderStart);
 const pageContext={salonDb:{from(name){assert.equal(name,'reserve_ledger');return query}}};
 vm.runInNewContext(source.slice(loaderStart,loaderEnd),pageContext);
 const result=await pageContext.finance230LoadAllReserveExpenses();
 assert.equal(result.data.length,1205,'No historical month may be cut off by limit 50 or server page limit');
 assert.deepEqual(pages,[[0,499],[500,999],[1000,1499]]);
 console.log('PASS fund expense-only grouped history across all months, month totals, all 1205 paginated expenses, balance untouched');
})().catch(error=>{console.error(error);process.exitCode=1});
