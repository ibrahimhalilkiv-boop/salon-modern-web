const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const calls=[];
const actor={id:'staff-1',role:'personel'};
const context={
  currentUser:actor,appts:[],console,Date,
  document:{querySelector:()=>null,getElementById:()=>null},
  window:{remoteSchedule:(date,time)=>`${date}T${time}:00+03:00`,salonDb:{rpc:async(name,args)=>{calls.push([name,args]);return {data:{status:name==='mark_appointment_no_show'?'no_show':'confirmed'}}}},reloadRemoteData:async()=>{calls.push(['reload'])},showAppToast:()=>{},closeAppointmentModal:()=>{}},
  confirm:()=>true,prompt:()=> 'Yanlışlıkla işaretlendi',
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('appointment-no-show-2.4.7.js','utf8'),context);
const api=context.window.SalonNoShow;
const past=new Date(Date.now()-60000).toISOString();
const future=new Date(Date.now()+60000).toISOString();
const own={id:'a1',employeeId:'staff-1',customer:'Ayşe',status:'confirmed',scheduledAt:past};
assert.equal(api.canMark(own),true);
assert.equal(api.canMark({...own,scheduledAt:future}),false);
assert.equal(api.canMark({...own,employeeId:'staff-2'}),false);
assert.equal(api.canMark({...own,status:'completed'}),false);
assert.equal(api.canMark({...own,status:'cancelled'}),false);
assert.equal(api.canMark({...own,status:'no_show'}),false);
assert.equal(api.canUndo({...own,status:'no_show'}),false);
(async()=>{
  await api.mark(own);
  assert.equal(calls[0][0],'mark_appointment_no_show');
  assert.equal(calls[0][1].p_appointment_id,'a1');
  assert.equal(calls[1][0],'reload');
  actor.role='yonetici';
  assert.equal(api.canMark({...own,employeeId:'staff-2'}),true);
  const missed={...own,status:'no_show',employeeId:'staff-2'};
  assert.equal(api.canUndo(missed),true);
  await api.undo(missed);
  assert.equal(calls[2][0],'undo_appointment_no_show');
  assert.equal(calls[2][1].p_reason,'Yanlışlıkla işaretlendi');
  assert.equal(calls[3][0],'reload');
  const sql=fs.readFileSync('supabase/migrations/20261020120000_appointment_no_show_actions.sql','utf8');
  assert.match(sql,/old\.status<>'confirmed' or new\.scheduled_at>now\(\)/);
  assert.match(sql,/not private\.is_active_salon_user\(\)/);
  assert.match(sql,/old\.employee_id is distinct from v_actor/);
  assert.match(sql,/old\.status='no_show'/);
  assert.match(sql,/not private\.is_manager\(\)/);
  assert.match(sql,/nullif\(trim\(new\.no_show_reversal_reason\),''\)/);
  assert.doesNotMatch(sql,/whatsapp_message_logs|enqueue_whatsapp_message/i);
  console.log('PASS appointment no-show: time, role, status, RPC and manager reversal');
})().catch(error=>{console.error(error);process.exitCode=1});
