(function(){
  'use strict';
  var groups=[],members=[],selectedGroupId=null,busy=false;
  window.remoteDebtAccountGroups=groups;
  window.remoteDebtAccountGroupMembers=members;

  function manager(){return window.currentUser&&window.currentUser.role==='yonetici'}
  function byId(id){return (window.remoteClients||[]).find(function(c){return String(c.id)===String(id)})}
  function clientLabel(c){var digits=String(c&&c.phone||'').replace(/\D/g,''),tail=digits.slice(-4);return String(c&&c.full_name||'Müşteri')+(tail?' · •••• '+tail:'')}
  function memberFor(clientId){return members.find(function(m){return String(m.client_id)===String(clientId)})}
  function groupMembers(groupId){return members.filter(function(m){return String(m.group_id)===String(groupId)})}
  function groupClientIds(groupId){return groupMembers(groupId).map(function(m){return String(m.client_id)})}
  function debtsForClients(ids){return (window.remoteDebts||[]).filter(function(d){return d.client_id&&ids.includes(String(d.client_id))})}
  function openTotal(items){return items.filter(function(d){return d.status==='open'}).reduce(function(s,d){return s+Number(d.amount||0)},0)}
  function esc(v){return typeof window.safe==='function'?window.safe(String(v==null?'':v)):String(v==null?'':v).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]})}
  function js(v){return typeof window.jsAttr==='function'?window.jsAttr(v):JSON.stringify(String(v))}

  async function load(){
    if(!manager()||!window.salonDb){groups=[];members=[];syncGlobals();return}
    var result=await Promise.all([
      salonDb.from('debt_account_groups').select('id,name,created_at,updated_at').order('name'),
      salonDb.from('debt_account_group_members').select('group_id,client_id,relationship_label,created_at')
    ]);
    if(result[0].error||result[1].error){
      var error=result[0].error||result[1].error;
      console.error('[debt-groups] load failed',error);
      if(window.showAppToast)showAppToast('Borç ilişkileri yüklenemedi',error.message||'Tekrar deneyin.');
      return;
    }
    groups=result[0].data||[];members=result[1].data||[];syncGlobals();
  }
  function syncGlobals(){window.remoteDebtAccountGroups=groups;window.remoteDebtAccountGroupMembers=members}

  function ensureModal(){
    var modal=document.getElementById('debtAccountGroupModal');if(modal)return modal;
    modal=document.createElement('div');modal.id='debtAccountGroupModal';modal.className='modal';
    modal.innerHTML='<div class="sheet debt-group-sheet"><h2>Kişileri ilişkilendir</h2><p class="notice">Müşteriler ayrı kalır; yalnız açık borçları ortak toplamda gösterilir.</p><label class="field">Grup adı<input id="debtGroupName" maxlength="120" placeholder="Örn. Yılmaz Ailesi"></label><label class="field">1. kişi<input id="debtGroupClientA" list="debtGroupClientOptions" autocomplete="off" placeholder="Müşteri ara"></label><label class="field">Yakınlık<input id="debtGroupRelationA" maxlength="60" placeholder="Örn. Baba"></label><label class="field">2. kişi<input id="debtGroupClientB" list="debtGroupClientOptions" autocomplete="off" placeholder="Müşteri ara"></label><label class="field">Yakınlık<input id="debtGroupRelationB" maxlength="60" placeholder="Örn. Oğul"></label><datalist id="debtGroupClientOptions"></datalist><button id="debtGroupSave" type="button" class="save" onclick="saveDebtAccountGroup()">İlişkiyi kaydet</button><button type="button" class="back" onclick="closeDebtAccountGroupModal()">Vazgeç</button></div>';
    document.body.appendChild(modal);return modal;
  }
  function token(c){return clientLabel(c)+' ['+String(c.id)+']'}
  function idFromInput(value){var m=String(value||'').match(/\[([^\]]+)\]\s*$/);return m&&m[1]||''}
  window.openDebtAccountGroupModal=function(clientId){
    if(!manager())return;var modal=ensureModal(),options=document.getElementById('debtGroupClientOptions');
    options.innerHTML=(window.remoteClients||[]).map(function(c){return '<option value="'+esc(token(c))+'"></option>'}).join('');
    document.getElementById('debtGroupName').value='';document.getElementById('debtGroupClientA').value='';document.getElementById('debtGroupClientB').value='';document.getElementById('debtGroupRelationA').value='';document.getElementById('debtGroupRelationB').value='';
    var client=byId(clientId);if(client)document.getElementById('debtGroupClientA').value=token(client);modal.classList.add('show')
  };
  window.closeDebtAccountGroupModal=function(){document.getElementById('debtAccountGroupModal')?.classList.remove('show')};
  window.saveDebtAccountGroup=async function(){
    if(!manager()||busy)return;var a=idFromInput(document.getElementById('debtGroupClientA').value),b=idFromInput(document.getElementById('debtGroupClientB').value),ca=byId(a),cb=byId(b),name=document.getElementById('debtGroupName').value.trim()||((ca&&ca.full_name||'')+' / '+(cb&&cb.full_name||''));
    if(!ca||!cb||a===b){showAppToast('Kişileri kontrol edin','İki farklı kayıtlı müşteri seçin.');return}
    var ma=memberFor(a),mb=memberFor(b);if(ma||mb){showAppToast('İlişki kurulamadı',ma&&mb&&ma.group_id===mb.group_id?'Bu kişiler zaten aynı grupta.':'Seçilen kişilerden biri başka bir borç grubunda.');return}
    busy=true;var button=document.getElementById('debtGroupSave');button.disabled=true;button.textContent='Kaydediliyor…';
    var created=await salonDb.from('debt_account_groups').insert({name:name,created_by:currentUser.id}).select('id,name,created_at,updated_at').single();
    if(created.error){finish();showAppToast('İlişki kaydedilemedi',created.error.message);return}
    var rows=[{group_id:created.data.id,client_id:a,relationship_label:document.getElementById('debtGroupRelationA').value.trim()||null},{group_id:created.data.id,client_id:b,relationship_label:document.getElementById('debtGroupRelationB').value.trim()||null}],saved=await salonDb.from('debt_account_group_members').insert(rows).select('group_id,client_id,relationship_label,created_at');
    if(saved.error){await salonDb.from('debt_account_groups').delete().eq('id',created.data.id);finish();showAppToast('İlişki kaydedilemedi',saved.error.message);return}
    closeDebtAccountGroupModal();await load();renderDebts();finish();showAppToast('Borç ilişkisi kuruldu',name+' açık borçları artık ortak toplamda görünecek.');
    function finish(){busy=false;button.disabled=false;button.textContent='İlişkiyi kaydet'}
  };

  window.openDebtAccountGroupDetail=function(id){selectedGroupId=String(id);window.selectedDebtCustomerKey='group:'+String(id);showPage('debtDetail')};
  window.removeDebtAccountGroup=async function(id){
    if(!manager()||busy)return;var group=groups.find(function(g){return String(g.id)===String(id)});if(!group)return;
    if(!confirm(group.name+' borç ilişkisi kaldırılsın mı?\n\nMüşteriler ve borç kayıtları silinmeyecek.'))return;
    busy=true;var result=await salonDb.from('debt_account_groups').delete().eq('id',group.id).select('id');busy=false;
    if(result.error||!result.data||!result.data.length){showAppToast('İlişki kaldırılamadı',result.error&&result.error.message||'Yetki veya bağlantıyı kontrol edin.');return}
    await load();showPage('debts');renderDebts();showAppToast('İlişki kaldırıldı','Kişilerin borç kayıtları ayrı ayrı korunuyor.')
  };

  var baseLoad=window.loadV151Supplement;
  window.loadV151Supplement=async function(){await baseLoad.apply(this,arguments);await load()};
  var groupChannel=null,baseSubscribe=window.subscribeSalon;
  window.subscribeSalon=function(){
    baseSubscribe.apply(this,arguments);if(groupChannel)salonDb.removeChannel(groupChannel);
    groupChannel=salonDb.channel('salon-modern-debt-account-groups')
      .on('postgres_changes',{event:'*',schema:'public',table:'debt_account_groups'},async function(){await load();renderDebts()})
      .on('postgres_changes',{event:'*',schema:'public',table:'debt_account_group_members'},async function(){await load();renderDebts()})
      .subscribe();
  };
  var baseLogout=window.logout;
  window.logout=async function(){if(groupChannel){salonDb.removeChannel(groupChannel);groupChannel=null}return baseLogout.apply(this,arguments)};
  var baseRender=window.renderDebts;
  window.renderDebts=function(){
    if(!manager())return baseRender.apply(this,arguments);var holder=document.getElementById('debtList');if(!holder)return;
    var all=window.remoteDebts||[],open=all.filter(function(d){return d.status==='open'}),linkedIds=new Set(members.map(function(m){return String(m.client_id)})),groupCards=groups.map(function(g){var ms=groupMembers(g.id),ids=ms.map(function(m){return String(m.client_id)}),items=debtsForClients(ids),names=ms.map(function(m){var c=byId(m.client_id);return (c&&c.full_name||'Müşteri')+(m.relationship_label?' ('+m.relationship_label+')':'')});return '<div class="staff debt-customer debt-open debt-family" onclick="openDebtAccountGroupDetail('+js(g.id)+')"><div class="avatar">⌂</div><div class="item-main"><strong>'+esc(g.name)+'</strong><small>'+esc(names.join(' · '))+'</small><small>Ortak açık borç: '+formatTry(openTotal(items))+'</small></div><span class="link">Detay ›</span></div>'}).join(''),individual={};
    all.forEach(function(d){if(d.client_id&&linkedIds.has(String(d.client_id)))return;var key=debtCustomerKey(d);if(!individual[key])individual[key]={key:key,name:d.client_name||'Müşteri',items:[]};individual[key].items.push(d)});
    var cards=Object.keys(individual).map(function(k){return individual[k]}).sort(function(a,b){return a.name.localeCompare(b.name,'tr')}).map(function(g){var oi=g.items.filter(function(d){return d.status==='open'}),clientId=g.items.find(function(d){return d.client_id})?.client_id||'';return '<div class="staff debt-customer '+(oi.length?'debt-open':'debt-paid')+'"><div class="debt-card-open" onclick="openDebtDetail('+js(g.key)+')"><div class="avatar">'+esc(avatarFor(g.name))+'</div><div class="item-main"><strong>'+esc(g.name)+'</strong><small>'+g.items.length+' borç kaydı · Açık: '+formatTry(openTotal(g.items))+'</small></div></div>'+(clientId?'<button class="debt-link-person" onclick="event.stopPropagation();openDebtAccountGroupModal('+js(clientId)+')">İlişkilendir</button>':'')+'</div>'}).join('');
    holder.innerHTML='<button type="button" class="fab debt-group-create" onclick="openDebtAccountGroupModal()">＋ Kişileri ilişkilendir</button><div class="total"><small>Toplam açık borç</small><strong>'+formatTry(openTotal(all))+'</strong><small>'+open.length+' açık kayıt</small></div>'+groupCards+cards+(!groupCards&&!cards?'<div class="empty">Borç kaydı yok.</div>':'')
  };
  var baseDetail=window.renderDebtDetail;
  window.renderDebtDetail=function(){
    var key=String(window.selectedDebtCustomerKey||'');if(key.indexOf('group:')!==0)return baseDetail.apply(this,arguments);var id=key.slice(6),group=groups.find(function(g){return String(g.id)===id}),holder=document.getElementById('debtDetailContent');if(!group||!holder)return baseDetail.apply(this,arguments);
    var ms=groupMembers(id),ids=groupClientIds(id),items=debtsForClients(ids),open=items.filter(function(d){return d.status==='open'}),memberRows=ms.map(function(m){var c=byId(m.client_id),own=debtsForClients([String(m.client_id)]);return '<div class="staff" onclick="openDebtDetail('+js('id:'+m.client_id)+')"><div class="avatar">'+esc(avatarFor(c&&c.full_name||'Müşteri'))+'</div><div class="item-main"><strong>'+esc(c&&c.full_name||'Müşteri')+'</strong><small>'+esc(m.relationship_label||'Bağlı kişi')+' · Açık: '+formatTry(openTotal(own))+'</small></div><span class="link">Kişi detayı ›</span></div>'}).join('');
    holder.innerHTML='<h1 class="page-title">'+esc(group.name)+'</h1><div class="customer-metrics"><div class="stat-box"><small>Ortak açık borç</small><strong>'+formatTry(openTotal(items))+'</strong></div><div class="stat-box"><small>Bağlı kişi</small><strong>'+ms.length+'</strong></div><div class="stat-box"><small>Açık kayıt</small><strong>'+open.length+'</strong></div></div><div class="section"><h2>Kişiler</h2></div>'+memberRows+'<button type="button" class="back debt-group-remove" onclick="removeDebtAccountGroup('+js(group.id)+')">İlişkiyi kaldır</button>'
  };
  var style=document.createElement('style');style.textContent='.debt-group-create{width:100%;margin:0 0 12px}.debt-family{border:1px solid #d5b477;background:#fffaf0}.debt-family .item-main small{display:block}.debt-card-open{display:flex;align-items:center;gap:10px;min-width:0;flex:1;cursor:pointer}.debt-link-person{border:1px solid var(--line);background:#fff;color:#8a6228;border-radius:10px;padding:8px;font-weight:700}.debt-group-sheet{max-height:92vh;overflow:auto}.debt-group-remove{display:block;width:100%;margin-top:18px;color:#a33f3a}.debt-customer{gap:10px}';document.head.appendChild(style);
})();
