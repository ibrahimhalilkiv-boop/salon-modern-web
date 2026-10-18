const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('salon-phase2-1.8.0.js','utf8');
const from=src.indexOf('function phase2Periods(){'),to=src.indexOf('function phase2AuditText(');
assert(from>=0&&to>from,'employee performance function accessible');
const holder={innerHTML:''};
const profiles=[
 {id:'halil',username:'halil.kiv',role:'manager',active:true,full_name:'Halil Kıv',commission_pct:0},
 {id:'talip',username:'talip.kose',role:'employee',active:true,full_name:'Talip Köse',commission_pct:50},
 {id:'mehmet',username:'mehmet.safakoglu',role:'manager',active:true,full_name:'Mehmet Şafakoğlu',commission_pct:0},
 {id:'cengiz',username:'cengiz.bavkir',role:'employee',active:true,full_name:'Cengiz Bavkır',commission_pct:50}
];
const ctx=vm.createContext({document:{getElementById:()=>holder},currentUser:{role:'yonetici'},phase2IsManager:()=>true,phase2Today:()=> '2026-10-17',
 remoteProfiles:profiles,appts:[],Date,Number,Math,String,Object,
 appointmentDate:item=>item.date,remoteSchedule:(day,time)=>day+'T'+time+':00+03:00',
 phase2Money:x=>'₺ '+Number(x).toLocaleString('tr-TR',{maximumFractionDigits:2}),safe:String});
vm.runInContext(src.slice(from,to),ctx);
const make=(id,date,amount,status='confirmed')=>({employeeId:id,date,time:'10:00',status,amount,clientId:id,duration:30});
ctx.appts=[make('cengiz','2026-10-17',501),make('cengiz','2026-10-16',100),make('cengiz','2026-10-18',50),make('cengiz','2026-10-19',900),
 make('cengiz','2026-10-17',999,'cancelled'),make('talip','2026-10-17',200),make('halil','2026-10-17',400)];
ctx.phase2RenderEmployeePerformance();
const html=holder.innerHTML;
const c=html.indexOf('<h2>Cengiz Bavkır</h2>'),t=html.indexOf('<h2>Talip Köse</h2>'),h=html.indexOf('<h2>Halil Kıv</h2>');
assert(c>=0&&c<t&&t<h,'Cengiz then Talip then managers');
assert.match(html,/Prim toplamı<br>₺ 250,5/,'employee daily commission');
assert.match(html,/Prim toplamı<br>₺ 325,5/,'employee weekly commission excludes next Monday');
assert.match(html,/Prim toplamı<br>₺ 100/,'Talip commission');
assert.match(html,/Toplam tutar<br>₺ 400/,'manager keeps gross amount');
assert.match(html,/Aylık prim/);
assert.match(html,/Kayıtlı ciro/);
assert.equal(ctx.phase2PerformanceTotal([make('cengiz','2026-10-17',10.05)],profiles[3]),5.03,'round each commission');
assert.equal(ctx.phase2PerformanceTotal([make('cengiz','2026-10-17',null)],profiles[3]),null);
assert.equal(ctx.phase2PerformanceTotal([make('cengiz','2026-10-17',100)],{role:'employee',commission_pct:null}),null);
assert.equal(ctx.phase2PerformanceTotal([],{role:'employee',commission_pct:50}),0);
assert.match(fs.readFileSync('salon-modern.html','utf8'),/salon-phase2-1\.8\.0\.js\?v=142/);
assert.match(fs.readFileSync('sw.js','utf8'),/salon-modern-shell-pwa-v144/);
console.log('PASS employee commissions, order, exclusions, rounding, manager totals and version');
