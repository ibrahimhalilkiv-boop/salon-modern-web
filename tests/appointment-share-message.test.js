const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('salon-modern.html','utf8'),source=html.match(/function shareAppointmentWhatsApp\(id\)[^\r\n]+/)[0];
const appointment={id:'a1',clientId:'c1',customer:'Test Müşteri',date:'2026-10-02',time:'16:30',staff:'Talip',amount:700};let opened;
const context={appts:[appointment],remoteClients:[{id:'c1',full_name:'Test Müşteri',phone:'05321234567'}],friendlyDate:x=>x,whatsappPhone:()=> '905321234567',window:{open:url=>opened=url}};
vm.createContext(context);vm.runInContext(source,context);context.shareAppointmentWhatsApp('a1');
const url=new URL(opened),message=url.searchParams.get('text');assert.equal(url.pathname,'/905321234567');assert.match(message,/Test Müşteri/);assert.match(message,/16:30/);assert.match(message,/Talip/);assert.doesNotMatch(message,/Ücret|₺|700/);assert.equal(appointment.amount,700);
console.log('PASS WhatsApp share excludes price and preserves appointment amount');
