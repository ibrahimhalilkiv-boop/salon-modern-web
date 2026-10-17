(function () {
  'use strict';
  var state = { sessionId: crypto.randomUUID(), messages: [], all: [], busy: false, listening: false, recognition: null, view: 'chat', loaded: false };
  var root = document.getElementById('salonAiRoot');
  if (!root) return;
  var escapeHtml = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var dateLabel = function (value) { return new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }); };

  function metric() {
    try {
      var m = typeof phase2SummaryMetrics === 'function' ? phase2SummaryMetrics() : null;
      return m ? { appointments: m.appointments, due: m.due, overdue: m.overdue, risk: m.risk } : null;
    } catch (ignore) { return null; }
  }
  function draw() {
    var m = metric(), manager = typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'yonetici';
    root.innerHTML = '<div class="sm-ai"><header class="sm-ai-header"><button type="button" class="sm-ai-back" onclick="showPage(\'home\')" aria-label="Ana sayfaya dön">‹</button><div><small>SALON MODERN</small><h1>Salon Modern AI</h1></div><button type="button" class="sm-ai-new" id="smAiNew" aria-label="Yeni sohbet">＋</button></header>' +
      '<section class="sm-ai-summary" aria-label="Günlük işletme özeti"><div><small>GÜNLÜK İŞLETME ÖZETİ</small><strong>' + (m ? m.appointments : '—') + ' randevu</strong><span>Bugünün akışı bir bakışta</span></div><div class="sm-ai-summary-icon">✦</div></section>' +
      '<nav class="sm-ai-tabs" aria-label="AI bölümleri"><button type="button" data-view="chat" class="' + (state.view === 'chat' ? 'active' : '') + '">Sohbet</button><button type="button" data-view="alerts" class="' + (state.view === 'alerts' ? 'active' : '') + '">Uyarılar</button><button type="button" data-view="history" class="' + (state.view === 'history' ? 'active' : '') + '">Geçmiş</button></nav>' +
      '<div class="sm-ai-body">' + (state.view === 'chat' ? chatHtml() : state.view === 'alerts' ? alertsHtml(m, manager) : historyHtml()) + '</div>' +
      (state.view === 'chat' ? '<form class="sm-ai-composer" id="smAiForm"><label class="sr-only" for="smAiInput">Mesajınız</label><textarea id="smAiInput" rows="1" maxlength="1200" placeholder="Salon Modern AI’a yazın…" enterkeyhint="send"></textarea><button type="submit" id="smAiSend" ' + (state.busy ? 'disabled' : '') + ' aria-label="Mesajı gönder">➤</button></form>' : '') + '</div>';
    root.querySelectorAll('[data-view]').forEach(function (button) { button.onclick = function () { state.view = button.dataset.view; draw(); if (state.view === 'history') loadHistory(); }; });
    root.querySelector('#smAiNew').onclick = newChat;
    var mic = root.querySelector('#smAiMic'); if (mic) mic.onclick = toggleMic;
    var form = root.querySelector('#smAiForm'); if (form) form.onsubmit = send;
    var input = root.querySelector('#smAiInput');
    if (input) input.onkeydown = function (event) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } };
    root.querySelectorAll('[data-session]').forEach(function (button) { button.onclick = function () { state.sessionId = button.dataset.session; state.messages = state.all.filter(function (message) { return message.session_id === state.sessionId; }); state.view = 'chat'; draw(); }; });
    root.querySelectorAll('[data-delete]').forEach(function (button) { button.onclick = function () { clearSession(button.dataset.delete); }; });
    var scroll = root.querySelector('.sm-ai-thread'); if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }
  function chatHtml() {
    var messages = state.messages.map(function (item) { return '<div class="sm-ai-bubble ' + (item.role === 'user' ? 'user' : 'assistant') + '"><span>' + escapeHtml(item.content) + '</span></div>'; }).join('');
    return '<div class="sm-ai-thread" aria-live="polite">' + (messages || '<div class="sm-ai-welcome"><div class="sm-ai-spark">✦</div><h2>Merhaba, nasıl yardımcı olabilirim?</h2><p>İşletmeniz hakkında konuşabilir veya aklınızdaki soruyu yazabilirsiniz.</p></div>') + (state.busy ? '<div class="sm-ai-bubble assistant sm-ai-thinking">Düşünüyorum<span>•••</span></div>' : '') + '</div><div class="sm-ai-voice"><button type="button" id="smAiMic" class="sm-ai-mic ' + (state.listening ? 'listening' : '') + '" aria-label="' + (state.listening ? 'Dinlemeyi durdur' : 'Konuşmaya başla') + '" aria-pressed="' + state.listening + '"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/></svg></button><span>' + (state.listening ? 'Dinliyorum…' : 'Konuşmak için dokunun') + '</span></div>';
  }
  function alertsHtml(m, manager) {
    if (!manager) return '<div class="sm-ai-empty">İşletme uyarıları yönetici hesabına açıktır.</div>';
    if (!m) return '<div class="sm-ai-empty">Uyarı özeti şu an yüklenemedi.</div>';
    return '<div class="sm-ai-alerts"><h2>Bugün ilgilenilecekler</h2><div><b>' + m.due + '</b><span>Geliş zamanı gelen</span></div><div><b>' + m.overdue + '</b><span>Geciken</span></div><div><b>' + m.risk + '</b><span>Kaybedilme riski</span></div><button type="button" onclick="showPage(\'recoveryCenter\')">Müşteri merkezini aç ›</button></div>';
  }
  function historyHtml() {
    var groups = new Map();
    state.all.forEach(function (message) { if (!groups.has(message.session_id)) groups.set(message.session_id, []); groups.get(message.session_id).push(message); });
    var entries = Array.from(groups.entries()).reverse();
    return '<div class="sm-ai-history"><h2>Konuşma geçmişi</h2><p>Yalnızca hesabınıza ait son 30 gün.</p>' + (entries.map(function (entry) { var first = entry[1].find(function (item) { return item.role === 'user'; }) || entry[1][0]; return '<div class="sm-ai-history-row"><button type="button" data-session="' + escapeHtml(entry[0]) + '"><strong>' + escapeHtml(first.content.slice(0, 65)) + '</strong><small>' + dateLabel(first.created_at) + '</small></button><button type="button" data-delete="' + escapeHtml(entry[0]) + '" aria-label="Sohbeti sil">×</button></div>'; }).join('') || '<div class="sm-ai-empty">Henüz kayıtlı sohbet yok.</div>') + '</div>';
  }
  function newChat() { if (state.recognition) state.recognition.abort(); state.listening = false; state.sessionId = crypto.randomUUID(); state.messages = []; state.view = 'chat'; draw(); }
  async function invoke(body) {
    var result = await salonDb.functions.invoke('salon-modern-ai', { body: body });
    if (result.error || result.data && result.data.error) throw new Error(result.data && result.data.error || 'AI servisine erişilemiyor.');
    return result.data;
  }
  async function loadHistory() {
    try { var data = await invoke({ action: 'history' }); state.all = data.messages || []; state.loaded = true; state.messages = state.all.filter(function (item) { return item.session_id === state.sessionId; }); draw(); }
    catch (error) { if (state.view === 'history') root.querySelector('.sm-ai-history').insertAdjacentHTML('beforeend', '<div class="sm-ai-error">' + escapeHtml(error.message) + '</div>'); }
  }
  async function clearSession(id) {
    try { await invoke({ action: 'clear', session_id: id }); state.all = state.all.filter(function (item) { return item.session_id !== id; }); if (state.sessionId === id) newChat(); else draw(); }
    catch (error) { alert(error.message); }
  }
  async function send(event) {
    event.preventDefault(); if (state.busy) return;
    var input = root.querySelector('#smAiInput'), message = input.value.trim(); if (!message) return;
    state.messages.push({ role: 'user', content: message }); state.busy = true; draw();
    try { var data = await invoke({ action: 'send', session_id: state.sessionId, message: message }); state.messages.push({ role: 'assistant', content: data.answer }); loadHistory(); }
    catch (error) { state.messages.push({ role: 'assistant', content: 'Şu anda yanıt veremiyorum. Takvim ve diğer işletme ekranlarını kullanmaya devam edebilirsiniz. ' + error.message }); }
    finally { state.busy = false; draw(); }
  }
  function toggleMic() {
    if (state.recognition && state.listening) { state.recognition.stop(); return; }
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { alert('Bu tarayıcıda ses tanıma yok. Mesajınızı yazabilirsiniz.'); return; }
    var recognition = new Recognition(); state.recognition = recognition; recognition.lang = 'tr-TR'; recognition.interimResults = false; recognition.continuous = false;
    recognition.onstart = function () { state.listening = true; draw(); };
    recognition.onresult = function (event) { var text = event.results[0][0].transcript; state.listening = false; draw(); var input = root.querySelector('#smAiInput'); if (input) { input.value = text; input.focus(); } };
    recognition.onerror = function () { state.listening = false; draw(); };
    recognition.onend = function () { state.listening = false; draw(); };
    recognition.start();
  }
  var oldShowPage = window.showPage;
  window.showPage = function (id) { var result = oldShowPage.apply(this, arguments); if (id === 'salonAssistant') { draw(); if (!state.loaded) loadHistory(); } return result; };
  var oldLogout = window.logout;
  window.logout = function () { state.messages = []; state.all = []; state.loaded = false; state.sessionId = crypto.randomUUID(); if (state.recognition) state.recognition.abort(); return oldLogout.apply(this, arguments); };
  draw();
})();
