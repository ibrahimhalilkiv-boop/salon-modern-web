// Execute the actual save preflight without a database/network.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('salon-modern.html','utf8'),starts=[...html.matchAll(/saveAppointment=async function\(event\)\{/g)];
const body=html.slice(starts[starts.length-2].index).split('  try{')[0];
const fields={appointmentCustomer:{value:'Test'},appointmentPhone:{value:'0500'},appointmentOperation:{value:'Service'},appointmentDate:{value:'2026-10-05'},appointmentTime:{value:'10:00'},appointmentStaff:{value:'Employee'},appointmentAmount:{value:'100'},appointmentRepeatWeeks:{value:'0'},appointmentOnDebt:{checked:false}};
let busy=true,closed=false,duration=45,toasts=[];
const ctx={document:{getElementById:id=>fields[id]},currentUser:{id:'manager',role:'yonetici'},editingAppointmentId:null,appts:[],remoteDebts:[],serviceByName:()=>({id:'s1'}),profileForEmployeeName:()=>({id:'e1'}),salonDateAfterWeeks:d=>d,appointmentFormDuration:()=>duration,appointmentDate:x=>x.date,closedSlotFor:()=>closed,appointmentOverlaps:()=>busy?[{}]:[],friendlyDate:d=>d,showAppToast:(t)=>toasts.push(t),appointmentOverlapText:()=> 'Conflict'};
vm.createContext(ctx);vm.runInContext(body+'return true;}',ctx);
(async()=>{
const run=()=>ctx.saveAppointment({preventDefault(){}});
assert.equal(await run(),false);assert.equal(toasts.pop(),'Bu saat dolu');
busy=false;assert.equal(await run(),true);
closed=true;assert.equal(await run(),undefined);assert.equal(toasts.pop(),'Kapalı saat');
ctx.editingAppointmentId='old';ctx.appts=[{id:'old',date:'2026-10-05',time:'10:00',employeeId:'e1',duration:45}];busy=true;
assert.equal(await run(),true,'Legacy overlap financial edit is allowed');
closed=false;fields.appointmentTime.value='10:15';assert.equal(await run(),false);
fields.appointmentTime.value='10:00';duration=60;assert.equal(await run(),false,'Duration change checks actual overlap');
console.log('PASS actual save preflight: busy create/edit, closed interval, free create, legacy financial edit and duration change');
})().catch(e=>{console.error(e);process.exitCode=1});
