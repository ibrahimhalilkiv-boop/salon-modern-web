const PROD='https://oxuwwjsakhcqimjsfris.supabase.co/functions/v1/salon-app';
const patch=`<script>
(function(){
  function norm(v){return String(v||'').trim().toLocaleLowerCase('tr-TR')}
  function lastAppointmentFor(name){
    const key=norm(name);
    if(!key||!Array.isArray(window.appts)) return null;
    const items=window.appts.filter(function(a){return norm(a.customer)===key});
    if(!items.length) return null;
    items.sort(function(a,b){
      const ak=String(a.date||'')+'T'+String(a.time||'00:00');
      const bk=String(b.date||'')+'T'+String(b.time||'00:00');
      return ak.localeCompare(bk);
    });
    return items[items.length-1];
  }
  function fillFromCustomer(){
    const customer=document.getElementById('appointmentCustomer');
    if(!customer) return;
    const last=lastAppointmentFor(customer.value);
    if(!last) return;
    const operation=document.getElementById('appointmentOperation');
    if(operation){
      const exists=Array.from(operation.options||[]).some(function(o){return o.value===last.operation});
      if(exists){operation.value=last.operation;}
    }
    const amount=document.getElementById('appointmentAmount');
    if(amount && last.amount!==undefined && last.amount!==null){amount.value=Number(last.amount);}
    const note=document.getElementById('customerLastInfo');
    if(note) note.textContent='Son işlem: '+last.operation+' · Son ücret: ₺'+Number(last.amount||0).toLocaleString('tr-TR');
    if(typeof window.refreshAppointmentTimeAvailability==='function') window.refreshAppointmentTimeAvailability();
  }
  function bindCustomerAutoFill(){
    const customer=document.getElementById('appointmentCustomer');
    if(!customer || customer.dataset.lastFillBound) return;
    customer.dataset.lastFillBound='1';
    customer.addEventListener('change',fillFromCustomer);
    customer.addEventListener('blur',fillFromCustomer);
    customer.addEventListener('input',function(){
      clearTimeout(customer._lastFillTimer);
      customer._lastFillTimer=setTimeout(function(){
        if(lastAppointmentFor(customer.value)) fillFromCustomer();
      },180);
    });
    if(!document.getElementById('customerLastInfo')){
      const info=document.createElement('small');
      info.id='customerLastInfo';
      info.style.cssText='display:block;margin-top:6px;color:#6e7778';
      customer.closest('label')?.appendChild(info);
    }
  }
  function install(){
    if(typeof window.openAppointmentModal!=='function'){setTimeout(install,100);return;}
    const original=window.openAppointmentModal;
    if(original._customerAutofillPatched) return;
    function wrapped(){
      const result=original.apply(this,arguments);
      setTimeout(bindCustomerAutoFill,0);
      return result;
    }
    wrapped._customerAutofillPatched=true;
    window.openAppointmentModal=wrapped;
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install); else install();
})();
</script>`;
Deno.serve(async (req)=>{
  const url=new URL(req.url);
  if(url.search){
    const upstream=await fetch(PROD+url.search,{headers:{'User-Agent':'SalonModernTestProxy/1.0'}});
    return new Response(upstream.body,{status:upstream.status,headers:upstream.headers});
  }
  const upstream=await fetch(PROD,{headers:{'User-Agent':'SalonModernTestProxy/1.0'}});
  let html=await upstream.text();
  html=html.replace('</body>',patch+'</body>');
  return new Response(html,{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
});
