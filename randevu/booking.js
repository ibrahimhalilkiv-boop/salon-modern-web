(function(){
'use strict';
var API='https://oxuwwjsakhcqimjsfris.supabase.co/functions/v1/customer-booking-request',step=1,catalogue={services:[],employees:[]},state={serviceId:'',employeeId:'',employeeChosen:false,date:'',time:''};
var submissionKey='',submissionToken='';
var q=function(id){return document.getElementById(id)},escapeHtml=function(value){return String(value||'').replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]})};
function error(message){q('formError').textContent=message||''}
async function json(url,options){var response=await fetch(url,options),data=await response.json().catch(function(){return {}});if(!response.ok)throw new Error(data.error||'Sunucuya ulaşılamadı.');return data}
function service(){return catalogue.services.find(function(item){return item.id===state.serviceId})}
function employee(){return catalogue.employees.find(function(item){return item.id===state.employeeId})}
function choose(container,key,value){state[key]=value;Array.from(q(container).querySelectorAll('button')).forEach(function(button){button.classList.toggle('selected',button.dataset.value===value)});error('')}
function renderCatalogue(){var services=catalogue.services.slice();q('services').innerHTML=services.map(function(item){return '<button type="button" class="choice" data-value="'+escapeHtml(item.id)+'"><span><b>'+escapeHtml(item.name)+'</b></span><strong>₺ '+Number(item.price||0).toLocaleString('tr-TR')+'</strong></button>'}).join('')||'<p class="muted">Aktif hizmet bulunamadı.</p>';q('employees').innerHTML=catalogue.employees.map(function(item){return '<button type="button" class="choice" data-value="'+escapeHtml(item.id)+'"><span><b>'+escapeHtml(item.full_name)+'</b></span></button>'}).join('')+'<button type="button" class="choice" data-value="">Fark etmez</button>';q('services').addEventListener('click',function(event){var button=event.target.closest('button');if(button&&services.some(function(item){return item.id===button.dataset.value})){choose('services','serviceId',button.dataset.value);state.time='';show(2)}});q('employees').addEventListener('click',function(event){var button=event.target.closest('button');if(button&&(button.dataset.value===''||catalogue.employees.some(function(item){return item.id===button.dataset.value}))){choose('employees','employeeId',button.dataset.value);state.employeeChosen=true;state.date='';state.time='';q('bookingDate').value='';show(3)}})}
async function loadCatalogue(){try{catalogue=await json(API+'?action=catalogue',{cache:'no-store'});if(catalogue.onlineBookingEnabled===false){q('bookingCard').innerHTML='<div class="success"><div class="success-mark">⏸</div><h2>Online randevu geçici olarak kapalı</h2><p>Şu anda online randevu oluşturulamıyor. Lütfen daha sonra tekrar deneyin.</p></div>';return}var notice=q('todayClosedNotice');if(catalogue.todaySchedule&&catalogue.todaySchedule.closed){notice.innerHTML='Bugün salon kapalı<small>Başka bir açık tarih için online randevu alabilirsiniz.</small>';notice.hidden=false}else if(catalogue.todaySchedule&&catalogue.todaySchedule.hasRemainingWindow===false){notice.innerHTML='Bugün için randevu saatleri sona erdi<small>Başka bir açık tarih için online randevu alabilirsiniz.</small>';notice.hidden=false}else notice.hidden=true;renderCatalogue()}catch(ex){q('services').innerHTML='<p class="error">'+escapeHtml(ex.message)+'</p>'}}
function show(next){step=next;document.querySelectorAll('.step').forEach(function(node){node.classList.toggle('active',Number(node.dataset.step)===step)});document.querySelectorAll('.steps span').forEach(function(node,index){node.classList.toggle('active',index<step)});q('backButton').hidden=step===1;q('nextButton').hidden=step!==4;q('submitButton').hidden=step!==5;error('');window.scrollTo({top:q('bookingCard').offsetTop-12,behavior:'smooth'})}
async function loadSlots(){
  var requestedDate=state.date;
  q('slots').innerHTML='<p class="loading">Saatler kontrol ediliyor…</p>';
  try{
    var url=API+'?action=availability&date='+encodeURIComponent(state.date)+'&service='+encodeURIComponent(state.serviceId)+(state.employeeId?'&employee='+encodeURIComponent(state.employeeId):'');
    var data=await json(url,{cache:'no-store'});
    if(step!==3||state.date!==requestedDate)return false;
    var available=data.slots||[];
    var all=Array.isArray(data.allSlots)&&data.allSlots.length?data.allSlots:[];
    // Always present a full hour grid even if a cached API version returns only available slots.
    if(!all.length&&data.schedule){
      var opening=Number(data.schedule.open),closing=Number(data.schedule.close);
      if(Number.isFinite(opening)&&Number.isFinite(closing)&&closing>opening){
        var isFriday=/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)&&new Date(requestedDate+'T12:00:00Z').getUTCDay()===5;
        for(var minute=Math.ceil(opening/60)*60;minute<closing;minute+=60){
          var time=String(Math.floor(minute/60)).padStart(2,'0')+':00';
          var free=available.some(function(slot){return slot.time===time});
          var withinBreak=isFriday&&minute>=720&&minute<840;
          all.push({time:time,available:free&&!data.schedule.closed&&!withinBreak,
            status:data.schedule.closed||withinBreak?'closed':free?'available':'busy'});
        }
      }
    }
    if(!all.length)all=available.map(function(slot){return {time:slot.time,available:true,status:'available'}});
    if(!all.length){
      var empty=data.schedule&&data.schedule.closed?'Seçtiğiniz tarihte salon kapalı. Lütfen başka bir tarih seçin.':'Bu tarih için gösterilecek saat bulunamadı.';
      q('slots').innerHTML='<p class="muted">'+escapeHtml(empty)+'</p>';
      q('pendingHint').hidden=true;error(empty);return false;
    }
    q('slots').innerHTML=all.map(function(item){
      var active=item.available===true&&available.some(function(slot){return slot.time===item.time});
      var label=active?'Müsait':item.status==='closed'?'Kapalı':item.status==='past'?'Geçti':'Dolu';
      return '<button type="button" class="slot'+(active?'':' slot-unavailable')+'" data-value="'+escapeHtml(item.time)+'" aria-label="'+escapeHtml(item.time+' '+label)+'"'+(active?'':' disabled aria-disabled="true"')+'><strong>'+escapeHtml(item.time)+'</strong><small>'+label+'</small></button>';
    }).join('');
    var hint=q('pendingHint');
    hint.hidden=false;
    hint.textContent=available.length?'Yalnızca müsait saatler seçilebilir. Müsaitlik kayıt sırasında yeniden kontrol edilir.':'Bu tarihte seçilebilir saat yok. Dolu ve kapalı saatler görüntülenir; başka tarih veya çalışan seçebilirsiniz.';
    if(data.schedule&&data.schedule.closed)hint.textContent='Salon seçili gün kapalı. Saatler yalnızca bilgi amaçlı gösteriliyor.';
    q('slots').onclick=function(event){var button=event.target.closest('button');if(button&&!button.disabled)choose('slots','time',button.dataset.value)};
    return true;
  }catch(ex){
    if(step!==3||state.date!==requestedDate)return false;
    q('slots').innerHTML='<p class="error">'+escapeHtml(ex.message)+'</p>';
    error(ex.message);return false;
  }
}
function validate(){if(step===1&&!state.serviceId)return 'Bir hizmet seçin.';if(step===2&&!state.employeeChosen)return 'Bir çalışan seçin.';if(step===3&&!q('bookingDate').value)return 'Bir tarih seçin.';if(step===4&&!state.time)return 'Müsait bir saat seçin.';return ''}
function summary(){var s=service(),e=employee();q('summary').innerHTML='<p><b>Hizmet:</b> '+escapeHtml(s&&s.name)+'</p><p><b>Çalışan:</b> '+escapeHtml(e?e.full_name:'Fark etmez')+'</p><p><b>Tarih:</b> '+escapeHtml(state.date)+'</p><p><b>Saat:</b> '+escapeHtml(state.time)+'</p>'}
q('nextButton').onclick=function(){if(step!==4)return;var message=validate();if(message)return error(message);summary();show(5)};
q('backButton').onclick=function(){show(Math.max(1,step-1))};
q('bookingDate').onchange=async function(){state.date=this.value;state.time='';if(step!==3||!this.value||!this.checkValidity())return;var selectedDate=this.value;var available=await loadSlots();if(available&&step===3&&state.date===selectedDate)show(4)};
q('customerPhone').oninput=function(){var d=this.value.replace(/\D/g,'').slice(0,11);this.value=d.replace(/^(\d{4})(\d{3})(\d{2})(\d{0,2}).*/,function(_,a,b,c,e){return [a,b,c,e].filter(Boolean).join(' ')})};
q('bookingForm').onsubmit=async function(event){event.preventDefault();var button=q('submitButton');if(button.disabled)return;var name=q('customerName').value.trim(),phone=q('customerPhone').value;if(name.length<3)return error('Ad soyad bilgisini kontrol edin.');if(!/^0?5\d{9}$/.test(phone.replace(/\D/g,'')))return error('Telefon numarasını 05XX XXX XX XX biçiminde girin.');var payload={customerName:name,customerPhone:phone,serviceId:state.serviceId,employeeId:state.employeeId||null,date:state.date,time:state.time,note:q('customerNote').value},key=JSON.stringify(payload);if(key!==submissionKey){submissionKey=key;submissionToken=crypto.randomUUID()}payload.submissionToken=submissionToken;button.disabled=true;button.textContent='Kaydediliyor…';try{var data=await json(API+'?action=create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(data.status!=='approved'||!/^[0-9a-f-]{36}$/i.test(data.statusToken||''))throw new Error('Güvenli takip bağlantısı doğrulanamadı. Lütfen salonla iletişime geçin.');var link=new URL('durum/?token='+encodeURIComponent(data.statusToken),location.href).href;q('bookingCard').hidden=true;q('requestNumber').textContent=data.requestNumber;q('statusLink').href=link;q('trackingLink').value=link;q('copyMessage').textContent='';q('successCard').hidden=false;window.scrollTo({top:0,behavior:'smooth'})}catch(ex){error(ex.message)}finally{button.disabled=false;button.textContent='Randevuyu oluştur'}};
q('copyTrackingLink').onclick=async function(){var input=q('trackingLink');try{if(navigator.clipboard&&navigator.clipboard.writeText)await navigator.clipboard.writeText(input.value);else{input.select();if(!document.execCommand('copy'))throw new Error('Kopyalama başarısız');input.setSelectionRange(0,0)}q('copyMessage').textContent='Takip bağlantısı kopyalandı.'}catch(ex){q('copyMessage').textContent='Bağlantı kopyalanamadı. Yukarıdaki bağlantıyı seçip kopyalayın.'}};
var today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul'}).format(new Date());q('bookingDate').min=today;q('bookingDate').max=new Date(Date.now()+90*86400000).toISOString().slice(0,10);loadCatalogue();
})();
