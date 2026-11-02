(function () {
  var view = 'all';
  var loading = false;
  var originalRenderCustomers = window.renderCustomers;
  var originalRenderCustomerDetail = window.renderCustomerDetail;

  function manager() { return typeof currentUser !== 'undefined' && currentUser?.role === 'yonetici'; }

  function ensurePanels() {
    var count = document.getElementById('customerCountPanel');
    if (!count || document.getElementById('customerBlacklistTabs')) return;
    var tabs = document.createElement('div');
    tabs.id = 'customerBlacklistTabs';
    tabs.className = 'customer-blacklist-tabs';
    tabs.innerHTML = '<button type="button" data-view="all">Tüm müşteriler</button><button type="button" data-view="blocked">Kara liste</button>';
    tabs.onclick = function (event) {
      var button = event.target.closest('button[data-view]');
      if (!button || !manager()) return;
      view = button.dataset.view;
      renderCustomers();
      if (view === 'blocked') refreshBlockedClients();
    };
    count.parentNode.insertBefore(tabs, count);
    var list = document.createElement('div');
    list.id = 'customerBlacklistList';
    list.hidden = true;
    document.getElementById('customerList').after(list);
  }

  async function refreshBlockedClients() {
    if (loading || !manager()) return;
    loading = true;
    try {
      await smartLoadActiveClients(true);
      if (view === 'blocked') renderCustomers();
      renderCustomerDetail();
    } catch (error) {
      showAppToast('Kara liste yüklenemedi', error.message || 'Bağlantıyı kontrol edin.');
    } finally { loading = false; }
  }

  window.renderCustomers = function () {
    originalRenderCustomers();
    if (!manager()) return;
    ensurePanels();
    var blocked = view === 'blocked';
    document.querySelectorAll('#customerBlacklistTabs button').forEach(function (button) {
      button.classList.toggle('active', button.dataset.view === view);
    });
    document.getElementById('customerCountPanel').hidden = blocked;
    document.getElementById('customerSearch').closest('label').hidden = blocked;
    document.getElementById('customerList').hidden = blocked;
    var panel = document.getElementById('customerBlacklistList');
    panel.hidden = !blocked;
    if (!blocked) return;
    var list = uniqueRemoteClients().filter(function (client) { return client.online_booking_blocked === true; });
    panel.innerHTML = '<p class="customer-blacklist-info">Bu müşteriler online randevu talebi gönderemez. Salon içinden randevu oluşturabilirsiniz.</p>' +
      (list.map(function (client) {
        return '<div class="staff customer-card customer-blacklist-card" onclick="openCustomerDetail(' + jsAttr(client.id) + ')"><div class="avatar">' + safe(avatarFor(client.full_name)) + '</div><div class="item-main"><strong>' + safe(client.full_name) + '</strong><small>' + safe(client.phone || 'Telefon girilmemiş') + '</small></div><button type="button" class="back" onclick="event.stopPropagation();setCustomerOnlineBlacklist(' + jsAttr(client.id) + ',false)">Listeden çıkar</button></div>';
      }).join('') || '<div class="empty">Kara listede müşteri yok.</div>');
  };

  function renderBlacklistAction() {
    if (!manager()) return;
    var client = remoteClients.find(function (item) { return String(item.id) === String(selectedCustomerId); });
    var holder = document.getElementById('customerDetailContent');
    if (!client || !holder || document.getElementById('customerBlacklistAction')) return;
    var panel = document.createElement('section');
    panel.className = 'customer-blacklist-control';
    var heading = document.createElement('strong');
    heading.textContent = 'Online randevu';
    var status = document.createElement('small');
    status.textContent = client.online_booking_blocked ? 'Bu müşteri online randevu alamaz.' : 'Bu müşteri online randevu alabilir.';
    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'customerBlacklistAction';
    button.className = 'back customer-blacklist-action';
    button.textContent = client.online_booking_blocked ? 'Kara listeden çıkar' : 'Kara listeye ekle';
    button.onclick = function () { setCustomerOnlineBlacklist(client.id, !client.online_booking_blocked); };
    panel.append(heading, status, button);
    var title = holder.querySelector('.page-title');
    if (title) title.after(panel); else holder.prepend(panel);
  }

  window.renderCustomerDetail = function () {
    var result = originalRenderCustomerDetail.apply(this, arguments);
    if (result && typeof result.then === 'function') {
      result.then(renderBlacklistAction, function (error) { console.error('[customer-blacklist] detail render failed', error); });
    } else renderBlacklistAction();
    return result;
  };
  document.addEventListener('salon:customer-detail-rendered', function (event) {
    if (String(event.detail?.clientId) === String(selectedCustomerId)) renderBlacklistAction();
  });

  window.setCustomerOnlineBlacklist = async function (id, blocked) {
    if (!manager()) return;
    var client = remoteClients.find(function (item) { return String(item.id) === String(id); });
    if (!client || client.online_booking_blocked === blocked) return;
    var prompt = blocked
      ? client.full_name + ' kara listeye eklensin mi? Online randevu talebi gönderemeyecek.'
      : client.full_name + ' kara listeden çıkarılsın mı? Online randevu talebi gönderebilecek.';
    if (!window.confirm(prompt)) return;
    var result = await salonDb.from('clients').update({ online_booking_blocked: blocked })
      .eq('id', id).eq('online_booking_blocked', !blocked)
      .select('id,online_booking_blocked,online_booking_blocked_at').single();
    if (result.error) {
      showAppToast('Kara liste güncellenemedi', result.error.message || 'Tekrar deneyin.');
      return;
    }
    Object.assign(client, result.data);
    renderCustomers();
    renderCustomerDetail();
    showAppToast(blocked ? 'Kara listeye eklendi' : 'Kara listeden çıkarıldı', client.full_name);
  };

  var style = document.createElement('style');
  style.textContent = '#customers [hidden]{display:none!important}.customer-blacklist-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.customer-blacklist-tabs button{min-height:45px;border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);font-weight:700}.customer-blacklist-tabs button.active{background:#237d66;color:#fff;border-color:#237d66}.customer-blacklist-info{font-size:13px;color:var(--muted);line-height:1.5}.customer-blacklist-card{gap:8px}.customer-blacklist-card .back{margin:0;white-space:nowrap;font-size:12px}.customer-blacklist-control{display:grid;gap:5px;margin:12px 0;padding:13px;border:1px solid var(--line);border-radius:14px;background:#fff}.customer-blacklist-control small{color:var(--muted)}.customer-blacklist-action{display:block;width:100%;margin:8px 0 0;border:1px solid #a9514d;border-radius:11px;color:#8f443f;background:#fff6f4;min-height:44px;font-weight:700}@media(max-width:400px){.customer-blacklist-card{flex-wrap:wrap}.customer-blacklist-card .back{width:100%}}';
  document.head.appendChild(style);
})();
