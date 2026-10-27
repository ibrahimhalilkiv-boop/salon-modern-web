const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('appointment-form-actions-2.3.30.js', 'utf8');
const picker = source.slice(source.indexOf('  var saving='), source.indexOf('  async function saveNow'));
const timers = [];
const panel = {innerHTML:'',style:{},classList:{toggle(){},remove(){}},onclick:null};
const input = {value:'',removeAttribute(){},oninput:null,onfocus:null};
const phone = {value:''};
const nodes = {appointmentCustomer:input,appointmentPhone:phone,typedCustomerSuggestions:panel};
const requests = [];
let selected = null;
const context = {
  document:{getElementById:id=>nodes[id]},
  window:{salonDb:{rpc:async (name,args)=>{requests.push({name,args});return {data:[{id:'client-1',full_name:'Ayşe Yılmaz',phone:'05000000001'}],error:null}}},salonSelectClientForAppointment:id=>{selected=id}},
  currentUser:{role:'personel'},remoteClients:[],
  setTimeout:fn=>{const timer={fn,cancelled:false};timers.push(timer);return timer},
  clearTimeout:timer=>{timer.cancelled=true},
  applyCustomerHistory(){}
};
vm.createContext(context);
vm.runInContext(picker+'\nbindCustomerPicker();',context);

(async()=>{
  input.value='a';input.oninput();assert.equal(requests.length,0,'short search stays local');
  input.value='ayse';input.oninput();await timers.findLast(t=>!t.cancelled).fn();
  assert.equal(requests.length,1);
  assert.equal(requests[0].name,'staff_search_clients');
  assert.match(panel.innerHTML,/Ayşe Yılmaz/);
  assert.match(panel.innerHTML,/05000000001/);
  const button={getAttribute:()=> 'client-1'};
  panel.onclick({target:{closest:()=>button},preventDefault(){},stopImmediatePropagation(){}});
  assert.equal(input.value,'Ayşe Yılmaz');
  assert.equal(phone.value,'05000000001');
  assert.equal(selected,'client-1');
  context.remoteClients=[];input.value='ayse';input.onfocus();
  assert.match(panel.innerHTML,/05000000001/,'cached contact survives list refresh');
  assert.equal(requests.length,1,'same query does not spend another lookup');
  context.currentUser.role='yonetici';input.value='ayse';input.oninput();
  assert.equal(requests.length,1,'manager uses existing local list');
  console.log('PASS staff search, contact display, appointment selection, manager path');
})().catch(error=>{console.error(error);process.exitCode=1});
