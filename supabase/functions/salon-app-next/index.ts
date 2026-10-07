const UPSTREAM='https://oxuwwjsakhcqimjsfris.supabase.co/functions/v1/salon-app-next-base';
Deno.serve(async (req)=>{
  const upstream=await fetch(UPSTREAM);
  let html=await upstream.text();
  const patch=`<script>
  (function(){
    function waPhone(v){let p=String(v||'').replace(/\\D/g,'');if(p.startsWith('0'))p='90'+p.slice(1);else if(p.length===10)p='90'+p;return p}
    function msgFromForm(){
      const name=document.getElementById('customer')?.value.trim()||'';
      const date=document.getElementById('date')?.value||'';
      const time=document.getElementById('time')?.value||'';
      const employeeId=document.getElementById('employee')?.value||'';
      const amount=Number(document.getElementById('amount')?.value||0);
      const phone=document.getElementById('phone')?.value||'';
      const employee=(window.profiles||[]).find(x=>x.id===employeeId)?.full_name||document.getElementById('employee')?.selectedOptions?.[0]?.textContent||'Çalışan';
      const dateText=date?new Date(date+'T12:00:00').toLocaleDateString('tr-TR',{day:'numeric',month:'long',weekday:'long'}):'';
      const text='Merhaba '+name+'\nSalon Modern randevu bilgileriniz:\n📅 Tarih: '+dateText+'\n🕒 Saat: '+time+'\n👤 Çalışan: '+employee+'\n Ücret: ₺'+amount.toLocaleString('tr-TR')+'\nSizi bekliyoruz.';
      return {phone:waPhone(phone),text};
    }
    function install(){
      const form=document.getElementById('apptForm');
      if(!form||form.dataset.waInstalled)return;
      form.dataset.waInstalled='1';
      const original=form.onsubmit;
      form.onsubmit=async function(e){
        const share=msgFromForm();
        const beforeCount=Array.isArray(window.appointments)?window.appointments.length:0;
        await original.call(this,e);
        const afterCount=Array.isArray(window.appointments)?window.appointments.length:beforeCount;
        if(afterCount>=beforeCount){
          const url='https://wa.me/'+share.phone+'?text='+encodeURIComponent(share.text);
          window.location.href=url;
        }
      };
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
  })();
  </script>`;
  html=html.replace('</body>',patch+'</body>');
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
});
