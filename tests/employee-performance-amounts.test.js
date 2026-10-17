const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('salon-phase2-1.8.0.js','utf8');
const begin=source.indexOf('function phase2Periods(){'),end=source.indexOf('function phase2AuditText(');
assert(begin>=0&&end>begin,'performance functions available');
const holder={innerHTML:''};
const employeeId='employee-1';
let appointments=[];
const ctx=vm.createContext({
  document:{getElementById(id){assert.equal(id,'employeePerformanceContent');return holder}},
  currentUser:{role:'yonetici'},phase2IsManager:()=>true,phase2Today:()=> '2026-10-17',
  remoteProfiles:[{id:employeeId,username:'test',active:true,full_name:'Test çalışan',role:'employee'}],
  appts:appointments,Date,Number,String,Object,Math,
  appointmentDate:item=>item.date,
  remoteSchedule:(date,time)=> date+'T'+time+':00+03:00',
  phase2Money:amount=>amount.toLocaleString('tr-TR')+' TL',
  safe:String
});
vm.runInContext(source.slice(begin,end),ctx);
const row=(id,date,amount,status='confirmed',employeeIdOverride=employeeId)=>({id,date,time:'12:00',status,amount,employeeId:employeeIdOverride,duration:30,clientId:id});
appointments=[
  row('today','2026-10-17',250),
  row('earlier','2026-10-12',125.5),
  row('sunday','2026-10-18',124.5),
  row('next-week','2026-10-19',999),
  row('cancelled','2026-10-17',500,'cancelled'),
  row('other','2026-10-17',500,'confirmed','different-worker')
];
ctx.appts=appointments;
ctx.phase2RenderEmployeePerformance();
assert.match(holder.innerHTML,/<span>Bugün<\/span><small class="phase2-period-total">Toplam tutar<br>250 TL<\/small>/);
assert.match(holder.innerHTML,/<span>Bu hafta<\/span><small class="phase2-period-total">Toplam tutar<br>500 TL<\/small>/);
assert.match(holder.innerHTML,/<strong>3<\/strong><span>Bu hafta<\/span>/,'only current week bookings counted');
ctx.appts=[row('no_amount','2026-10-17',null)];
ctx.phase2RenderEmployeePerformance();
assert.match(holder.innerHTML,/<span>Bugün<\/span><small class="phase2-period-total">Toplam tutar<br>Yeterli veri yok<\/small>/,'missing recorded amount not guessed');
ctx.appts=[];
ctx.phase2RenderEmployeePerformance();
assert.match(holder.innerHTML,/<span>Bugün<\/span><small class="phase2-period-total">Toplam tutar<br>0 TL<\/small>/,'empty period is zero');
const html=fs.readFileSync('salon-modern.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
assert.match(html,/salon-phase2-1\.8\.0\.js\?v=132/);
assert.match(sw,/salon-modern-shell-pwa-v132/);
console.log('PASS staff today and week recorded booking totals, exclusions, missing amounts and PWA version');
