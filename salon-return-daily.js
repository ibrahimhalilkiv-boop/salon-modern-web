(function () {
  'use strict';
  var items = [], template = '', busy = false, autoEnabled = false;
  var pageId = 'salonReturnDue';

  function isOwner() {
    return typeof currentUser !== 'undefined' && currentUser &&
      currentUser.username === 'halil.kiv' && currentUser.role === 'yonetici';
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function dateTr(value) {
    var parts = String(value || '').slice(0, 10).split('-');
    return parts.length === 3 ? parts.reverse().join('.') : '—';
  }
  function mount() {
    var area = document.getElementById(pageId);
    if (area) return area;
    var app = document.getElementById('app');
    if (!app) return null;
    area = document.createElement('section');
    area.id = pageId;
    area.className = 'page';
    area.innerHTML =
      '<div class="content">' +
      '<button class="back" type="button" id="returnDueBack">‹ Akıllı Müşteri Analizi</button>' +
      '<h1 class="page-title">Tıraş süresi dolan müşteriler</h1>' +
      '<p class="return-due-help">Tıraş zamanı gelen ve gelecekte randevusu bulunmayan müşteriler. WhatsApp mesajları yalnızca sizin dokunmanızla hazırlanır, otomatik gönderilmez.</p>' +
      '<div id="returnDueList"><div class="empty">Liste yükleniyor…</div></div>' +
      '<button type="button" class="fab" id="returnDueRefresh">Listeyi yenile</button>' +
      '</div>';
    var nav = app.querySelector('.nav');
    if (nav) app.insertBefore(area, nav); else app.appendChild(area);
    area.querySelector('#returnDueBack').addEventListener('click', function () { showPage('smartAnalysis'); });
    area.querySelector('#returnDueRefresh').addEventListener('click', load);
    area.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-return-action]');
      if (!button || !area.contains(button)) return;
      var client = items.find(function (item) { return item.client_id === button.dataset.client; });
      if (!client) return;
      if (button.dataset.returnAction === 'whatsapp') openWhatsApp(client);
      if (button.dataset.returnAction === 'handled') markHandled(client);
    });
    if (!document.getElementById('salonReturnDueStyle')) {
      var style = document.createElement('style'); style.id = 'salonReturnDueStyle';
      style.textContent =
        '.return-due-help{color:var(--muted);line-height:1.5;margin:0 0 16px}' +
        '.return-due-item{padding:14px;margin-bottom:10px;border:1px solid var(--line);background:var(--paper);border-radius:15px}' +
        '.return-due-item strong{display:block;font-size:15px}.return-due-item small{color:var(--muted);line-height:1.5;display:block;margin-top:5px}' +
        '.return-due-head{display:flex;justify-content:space-between;align-items:center;gap:8px}' +
        '.return-due-status{font-size:11px;font-weight:750;border-radius:8px;padding:5px 7px;background:#f4ecdf;white-space:nowrap}' +
        '.return-due-controls{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}' +
        '.return-due-controls button{flex:1;min-width:105px;border:0;border-radius:10px;padding:10px;font-weight:700;cursor:pointer}' +
        '.return-due-controls .send{background:#1f7a5b;color:white}' +
        '.return-due-controls .handled{background:#ede9e1;color:#39413c}' +
        '.return-due-note{font-size:12px;color:var(--muted);line-height:1.5;padding:12px;border-radius:10px;background:#f4ecdf}';
      document.head.appendChild(style);
    }
    return area;
  }
  function render() {
    var target = document.getElementById('returnDueList');
    if (!target) return;
    if (!isOwner()) {
      target.innerHTML = '<div class="empty">Bu liste yalnızca hesabınız için yetkilendirilmiş yöneticiye açıktır.</div>';
      return;
    }
    var label = { risk: 'Kaybedilme Riski', overdue: 'Gecikti', due: 'Zamanı Geldi' };
    target.innerHTML =
      '<div class="return-due-note"><strong>' + items.length + ' müşteri</strong> · En az 3 farklı ziyaret esas alınır. ' +
      (autoEnabled ? 'Otomatik geri çağırma açık; manuel WhatsApp işlemleri kapalı.' : 'Eski randevuların bir kısmı tamamlandı olarak işaretlenmediği için listeyi kontrol edin. İleti iznini doğrulamadan mesaj göndermeyin.') + '</div>' +
      (items.length ? items.map(function (item) {
        return '<article class="return-due-item">' +
          '<div class="return-due-head"><strong>' + escapeHtml(item.client_name) + '</strong><span class="return-due-status">' + escapeHtml(label[item.state] || 'Zamanı Geldi') + '</span></div>' +
          '<small>' + escapeHtml(item.phone) + ' · Son ziyaret: ' + dateTr(item.last_visit) +
          '<br>Ortalama ' + Number(item.average_days) + ' günde bir · ' + Number(item.elapsed_days) + ' gündür gelmedi' +
          '<br>' + (item.has_consent ? 'WhatsApp pazarlama izni kayıtlı' : 'WhatsApp iletişim izni sistemde kayıtlı değil') + '</small>' +
          (autoEnabled ? '' : '<div class="return-due-controls">' +
            '<button class="send" type="button" data-return-action="whatsapp" data-client="' + escapeHtml(item.client_id) + '">WhatsApp’ta hazırla</button>' +
            '<button class="handled" type="button" data-return-action="handled" data-client="' + escapeHtml(item.client_id) + '">Mesajı gönderdim</button>' +
          '</div>') + '</article>';
      }).join('') : '<div class="empty">Şu anda hatırlatılacak müşteri yok.</div>');
  }
  async function load() {
    if (busy) return;
    mount();
    if (!isOwner()) { render(); return; }
    busy = true;
    var list = document.getElementById('returnDueList');
    if (list) list.innerHTML = '<div class="empty">Liste güncelleniyor…</div>';
    try {
      var results = await Promise.all([
        salonDb.rpc('salon_return_due_clients'),
        salonDb.from('message_templates').select('content').eq('template_key', 'customer_return_reminder').maybeSingle(),
        salonDb.from('booking_settings').select('whatsapp_return_auto_enabled').eq('id', true).maybeSingle()
      ]);
      if (results[0].error) throw results[0].error;
      items = results[0].data || [];
      if (results[1].error) throw results[1].error;
      if (results[2].error || !results[2].data) throw results[2].error || new Error('Geri çağırma modu alınamadı.');
      template = results[1].data && results[1].data.content || '';
      autoEnabled = results[2].data.whatsapp_return_auto_enabled === true;
      render();
    } catch (error) {
      if (list) list.innerHTML = '<div class="empty">Müşteri listesi yüklenemedi. ' + escapeHtml(error.message || 'Bağlantıyı kontrol edin.') + '</div>';
    } finally { busy = false; }
  }
  function openWhatsApp(item) {
    if (!isOwner() || autoEnabled || !item.phone || !/^905[0-9]{9}$/.test(item.phone)) return;
    if (!item.has_consent && !window.confirm('Bu müşterinin WhatsApp üzerinden geri çağırma mesajı almayı kabul ettiğini teyit ediyor musunuz? Kayıtlı pazarlama izni bulunmuyor.')) return;
    var message = String(template || '').trim();
    if (!message) { alert('Müşteri hatırlatma şablonu yüklenemedi. Listeyi yenileyin.'); return; }
    var replacements = {
      '{musteri_adi}': item.client_name, '{son_gelis_tarihi}': dateTr(item.last_visit),
      '{gecen_gun}': String(item.elapsed_days), '{ortalama_gelis_gunu}': String(item.average_days)
    };
    Object.keys(replacements).forEach(function (token) {
      message = message.split(token).join(replacements[token]);
    });
    window.open('https://wa.me/' + item.phone + '?text=' + encodeURIComponent(message), '_blank', 'noopener');
  }
  async function markHandled(item) {
    if (!isOwner() || autoEnabled || !window.confirm(item.client_name + ' için WhatsApp mesajını gerçekten gönderdiniz mi?')) return;
    try {
      var response = await salonDb.rpc('salon_mark_return_contact', {
        p_client_id: item.client_id, p_last_visit: item.last_visit
      });
      if (response.error) throw response.error;
      await load();
      if (typeof showAppToast === 'function') showAppToast(response.data ? 'İşaretlendi' : 'Zaten işaretlenmiş', response.data ? 'Müşteri yeni ziyaretine kadar geri çağırma listesinden çıkarıldı.' : 'Bu ziyaret için ikinci bir kayıt açılmadı.');
    } catch (error) {
      if (typeof showAppToast === 'function') showAppToast('İşaretlenemedi', error.message || 'Tekrar deneyin.');
    }
  }
  async function open() {
    if (!isOwner()) return;
    mount();
    showPage(pageId);
    await load();
  }
  function analysisShortcut() {
    if (!isOwner()) return;
    var root = document.getElementById('smartAnalysis');
    var heading = root && root.querySelector('.page-title');
    if (!heading || document.getElementById('returnDueShortcut')) return;
    var btn = document.createElement('button');
    btn.id = 'returnDueShortcut'; btn.type = 'button'; btn.className = 'fab';
    btn.textContent = 'Tıraş süresi dolan müşteriler ›';
    btn.addEventListener('click', open);
    heading.insertAdjacentElement('afterend', btn);
  }
  var previousShowPage = window.showPage;
  window.showPage = function (id) {
    if (id === pageId) mount();
    var result = previousShowPage.apply(this, arguments);
    if (id === 'smartAnalysis') analysisShortcut();
    return result;
  };
  window.SalonReturnDaily = { open: open, refresh: load };
  analysisShortcut();
})();
