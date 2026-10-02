const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('salon-modern.html','utf8'),source=html.slice(html.indexOf('var deliveredNativeNotifications=new Set();'),html.indexOf('async function deliverUnreadAssignmentNotifications()'));
const storage=new Map(),writes=[],toasts=[];
function boot(fail=false){
 const salonDb={from(){return {update(value){return {eq(key,id){return {eq(key,user){writes.push({id,user,value});return Promise.resolve({error:fail?{message:'offline'}:null})}}}}}}}};
 const context={currentUser:{id:'u1'},Date,Set,JSON,Promise,console,window:{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},showAppToast:(title,body)=>toasts.push({title,body}),salonDb};
 vm.createContext(context);vm.runInContext(source,context);return context
}
const item={id:'n1',recipient_id:'u1',kind:'appointment',title:'Yeni randevu',body:'Saat: 15.10.2099 19:00'};
let app=boot(true);app.deliverAssignmentNotification(item);app.deliverAssignmentNotification(item);assert.equal(toasts.length,1);assert.equal(writes[0].user,'u1');
app=boot();app.deliverAssignmentNotification(item);assert.equal(toasts.length,1,'Reload after failed read update must not replay toast');assert.equal(writes.length,2,'Read acknowledgement retried');
app.deliverAssignmentNotification({...item,id:'n2'});assert.equal(toasts.length,2,'New assignment still shown');
app.deliverAssignmentNotification({...item,id:'n3',recipient_id:'u2'});assert.equal(toasts.length,2,'Other account isolated');
app.currentUser={id:'u2'};app.deliverAssignmentNotification({...item,recipient_id:'u2'});assert.equal(toasts.length,3,'Device history scoped per user');
console.log('PASS assignment toast: once per account across reload, failed acknowledgement retry, new notification preserved');
