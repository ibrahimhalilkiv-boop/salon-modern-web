const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('salon-modern.html','utf8');
const source=html.split(/\r?\n/).filter(line=>line.startsWith('whatsappReminderUrl=function(')).join('\n');
const template='Merhaba {customer} 👋\n\n⏰ Salon Modern randevunuzu hatırlatmak isteriz.\n\n📅 Tarih: 14 Ekim Çarşamba\n🕒 Saat: 16:00\n👤 Berber: Halil Kıv\n\n📍 Yol tarifi:\nhttps://www.google.com/maps/dir/?api=1&destination=Salon+Modern\n\nGörüşmek üzere! 💈';
for(const [agent,origin] of [['Mozilla/5.0 (Linux; Android 15; Mobile)','https://api.whatsapp.com'],['Mozilla/5.0 (Windows NT 10.0; Win64; x64)','https://web.whatsapp.com']]){
  const ctx={navigator:{userAgent:agent},whatsappPhone:()=> '905355038544',appointmentTemplateValues:customer=>({customer}),renderSavedTemplate:(_key,values)=>template.replace('{customer}',values.customer)};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const url=new URL(ctx.whatsappReminderUrl('Şefik Çığ Öztürk','05355038544','2026-10-14','16:00','Halil Kıv',0));
  const message=url.searchParams.get('text');
  assert.equal(url.origin,origin);assert.equal(url.pathname,'/send/');assert.equal(url.searchParams.get('phone'),'905355038544');
  for(const text of ['Şefik Çığ Öztürk','14 Ekim Çarşamba','16:00','Halil Kıv','👋','⏰','📅','🕒','👤','📍','💈'])assert.ok(message.includes(text),'Lost text: '+text);
  assert.doesNotMatch(message,/\uFFFD/);assert.ok(url.search.includes('%F0%9F%91%8B'));assert.doesNotMatch(message,/Ücret/);
}
console.log('PASS UTF-8 reminder emoji and Turkish text on Android and desktop links');
