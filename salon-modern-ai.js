(function () {
  'use strict';
  var voiceEnabled = true; try { voiceEnabled = localStorage.getItem('moriVoiceEnabled') !== 'false'; } catch (ignore) {}
  var state = { sessionId: crypto.randomUUID(), messages: [], all: [], summary: null, busy: false, listening: false, speaking: false, recognition: null, voiceEnabled: voiceEnabled, handsFree: false, voiceTurn: false, view: 'chat', loaded: false };
  var root = document.getElementById('salonAiRoot');
  if (!root) return;
  var escapeHtml = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var dateLabel = function (value) { return new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }); };

  function metric() {
    if (state.summary) return state.summary;
    try {
      var m = typeof window.salonPhase2SummaryMetrics === 'function' ? window.salonPhase2SummaryMetrics() : null;
      return m ? { appointments: m.appointments, due: m.due, overdue: m.overdue, risk: m.risk } : null;
    } catch (ignore) { return null; }
  }
  function draw() {
    var m = metric(), manager = typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'yonetici';
    root.innerHTML = '<div class="sm-ai"><header class="sm-ai-header"><button type="button" class="sm-ai-back" onclick="showPage(\'home\')" aria-label="Ana sayfaya dön">‹</button><div><small>SALON MODERN</small><h1>MORİ</h1></div><button type="button" class="sm-ai-new" id="smAiNew" aria-label="Yeni sohbet">＋</button></header>' +
      '<section class="sm-ai-summary" aria-label="Günlük işletme özeti"><div><small>GÜNLÜK İŞLETME ÖZETİ</small><strong>' + (m ? m.appointments : '—') + ' randevu</strong><span>Bugünün akışı bir bakışta</span></div><div class="sm-ai-summary-icon">✦</div></section>' +
      '<nav class="sm-ai-tabs" aria-label="AI bölümleri"><button type="button" data-view="chat" class="' + (state.view === 'chat' ? 'active' : '') + '">Sohbet</button><button type="button" data-view="alerts" class="' + (state.view === 'alerts' ? 'active' : '') + '">Uyarılar</button><button type="button" data-view="history" class="' + (state.view === 'history' ? 'active' : '') + '">Geçmiş</button></nav>' +
      '<div class="sm-ai-body">' + (state.view === 'chat' ? chatHtml() : state.view === 'alerts' ? alertsHtml(m, manager) : historyHtml()) + '</div>' +
      (state.view === 'chat' ? '<form class="sm-ai-composer" id="smAiForm"><label class="sr-only" for="smAiInput">Mesajınız</label><textarea id="smAiInput" rows="1" maxlength="1200" placeholder="MORİ’ye yazın…" enterkeyhint="send"></textarea><button type="submit" id="smAiSend" ' + (state.busy ? 'disabled' : '') + ' aria-label="Mesajı gönder">➤</button></form>' : '') + '</div>';
    root.querySelectorAll('[data-view]').forEach(function (button) { button.onclick = function () { state.view = button.dataset.view; draw(); if (state.view === 'history') loadHistory(); }; });
    root.querySelector('#smAiNew').onclick = newChat;
    var mic = root.querySelector('#smAiMic'); if (mic) mic.onclick = toggleMic;
    var voice = root.querySelector('#smAiVoice'); if (voice) voice.onclick = function () { state.voiceEnabled = !state.voiceEnabled; try { localStorage.setItem('moriVoiceEnabled', String(state.voiceEnabled)); } catch (ignore) {} if (!state.voiceEnabled) stopSpeaking(); draw(); };
    var hands = root.querySelector('#smAiHands'); if (hands) hands.onclick = function () { state.handsFree = !state.handsFree; if (!state.handsFree && state.listening && state.recognition) state.recognition.stop(); draw(); };
    var stop = root.querySelector('#smAiStop'); if (stop) stop.onclick = function () { stopSpeaking(); state.handsFree = false; draw(); };
    var form = root.querySelector('#smAiForm'); if (form) form.onsubmit = send;
    var input = root.querySelector('#smAiInput');
    if (input) input.onkeydown = function (event) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } };
    root.querySelectorAll('[data-session]').forEach(function (button) { button.onclick = function () { state.sessionId = button.dataset.session; state.messages = state.all.filter(function (message) { return message.session_id === state.sessionId; }); state.view = 'chat'; draw(); }; });
    root.querySelectorAll('[data-delete]').forEach(function (button) { button.onclick = function () { clearSession(button.dataset.delete); }; });
    root.querySelectorAll('[data-confirm]').forEach(function (button) { button.onclick = function () { confirmAction(button.dataset.confirm); }; });
    root.querySelectorAll('[data-appointment]').forEach(function (button) { button.onclick = function () { showPage('calendar'); if (typeof appointmentClick === 'function') appointmentClick(button.dataset.appointment); }; });
    root.querySelectorAll('[data-client]').forEach(function (button) { button.onclick = function () { showPage('customers'); if (typeof openCustomerDetail === 'function') openCustomerDetail(button.dataset.client); }; });
    root.querySelectorAll('[data-navigate]').forEach(function (button) { button.onclick = function () { showPage(button.dataset.navigate); }; });
    var scroll = root.querySelector('.sm-ai-thread'); if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }
  function chatHtml() {
    var messages = state.messages.map(function (item) { return '<div class="sm-ai-message ' + (item.role === 'user' ? 'user' : 'assistant') + '"><div class="sm-ai-bubble ' + (item.role === 'user' ? 'user' : 'assistant') + '"><span>' + escapeHtml(item.content) + '</span></div>' + (item.pending || []).map(function (a) { return '<div class="sm-ai-result"><strong>Onay bekliyor</strong><span>' + escapeHtml(a.description) + '</span><button type="button" data-confirm="' + escapeHtml(a.id) + '" ' + (state.busy ? 'disabled' : '') + '>Onayla</button></div>'; }).join('') + (item.cards || []).map(function (c) { return '<button type="button" class="sm-ai-result" data-' + (c.kind === 'client' ? 'client' : 'appointment') + '="' + escapeHtml(c.id) + '"><strong>' + escapeHtml(c.title) + '</strong><span>' + escapeHtml(c.detail) + '</span><small>Kaydı aç ›</small></button>'; }).join('') + (item.navigation || []).map(function (p) { return '<button type="button" class="sm-ai-result" data-navigate="' + escapeHtml(p) + '">Ekranı aç ›</button>'; }).join('') + '</div>'; }).join('');
    return '<div class="sm-ai-thread" aria-live="polite">' + (messages || '<div class="sm-ai-welcome"><div class="sm-ai-spark">✦</div><h2>Merhaba, nasıl yardımcı olabilirim?</h2><p>İşletmeniz hakkında konuşabilir veya aklınızdaki soruyu yazabilirsiniz.</p></div>') + (state.busy ? '<div class="sm-ai-bubble assistant sm-ai-thinking">Düşünüyorum<span>•••</span></div>' : '') + '</div><div class="sm-ai-voice"><button type="button" id="smAiMic" class="sm-ai-mic ' + (state.listening ? 'listening' : '') + ' ' + (state.speaking ? 'speaking' : '') + '" aria-label="' + (state.listening ? 'Mikrofonu kapat' : 'Konuşmaya başla') + '" aria-pressed="' + state.listening + '"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/></svg></button><span>' + (state.listening ? 'Dinliyorum…' : state.speaking ? 'MORİ konuşuyor…' : 'Konuşmak için dokunun') + '</span><div class="sm-ai-voice-controls"><button type="button" id="smAiVoice" aria-pressed="' + state.voiceEnabled + '">Sesli yanıt ' + (state.voiceEnabled ? 'açık' : 'kapalı') + '</button><button type="button" id="smAiHands" aria-pressed="' + state.handsFree + '">Karşılıklı konuşma ' + (state.handsFree ? 'açık' : 'kapalı') + '</button>' + (state.speaking ? '<button type="button" id="smAiStop">Sesi durdur</button>' : '') + '</div></div>';
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
  function newChat() { stopSpeaking(); if (state.recognition) state.recognition.abort(); state.listening = false; state.handsFree = false; state.sessionId = crypto.randomUUID(); state.messages = []; state.view = 'chat'; draw(); }
  async function invoke(body) {
    var result = await salonDb.functions.invoke('salon-modern-ai', { body: body });
    if (result.error) { var details = null; try { details = await result.error.context.clone().json(); } catch (ignore) {} throw new Error(details && details.error || 'AI servisine erişilemiyor.'); }
    if (result.data && result.data.error) throw new Error(result.data.error);
    return result.data;
  }
  async function loadSummary() {
    try {
      var data = await invoke({ action: 'summary' }), summary = data.summary;
      state.summary = { appointments: summary.count, due: summary.alerts && summary.alerts.due || 0, overdue: summary.alerts && summary.alerts.overdue || 0, risk: summary.alerts && summary.alerts.risk || 0 };
      draw();
    } catch (ignore) { /* Existing salon metrics remain available while AI is unreachable. */ }
  }
  async function loadHistory() {
    try { var data = await invoke({ action: 'history' }); state.all = data.messages || []; state.loaded = true; if (!state.messages.length) state.messages = state.all.filter(function (item) { return item.session_id === state.sessionId; }); draw(); }
    catch (error) { if (state.view === 'history') root.querySelector('.sm-ai-history').insertAdjacentHTML('beforeend', '<div class="sm-ai-error">' + escapeHtml(error.message) + '</div>'); }
  }
  async function clearSession(id) {
    try { await invoke({ action: 'clear', session_id: id }); state.all = state.all.filter(function (item) { return item.session_id !== id; }); if (state.sessionId === id) newChat(); else draw(); }
    catch (error) { alert(error.message); }
  }
  async function send(event) {
    event.preventDefault(); if (state.busy) return;
    var input = root.querySelector('#smAiInput'), message = input.value.trim(); if (!message) return;
    await sendMessage(message, false);
  }
  async function sendMessage(message, spoken) {
    if (state.busy || !message) return;
    if (!spoken) { state.voiceTurn = false; state.handsFree = false; }
    stopSpeaking();
    state.messages.push({ role: 'user', content: message }); state.busy = true; draw();
    try { var data = await invoke({ action: 'send', session_id: state.sessionId, message: message }); state.messages.push({ role: 'assistant', content: data.answer, cards: data.cards, pending: data.pending, navigation: data.navigation }); loadHistory(); if (spoken) speak(data.answer); }
    catch (error) { state.messages.push({ role: 'assistant', content: 'Şu anda yanıt veremiyorum. Takvim ve diğer işletme ekranlarını kullanmaya devam edebilirsiniz. ' + error.message }); }
    finally { state.busy = false; draw(); }
  }
  async function confirmAction(id) {
    if (state.busy) return;
    state.busy = true; draw();
    try { var data = await invoke({ action: 'confirm', session_id: state.sessionId, action_id: id }); state.messages.forEach(function (m) { m.pending = (m.pending || []).filter(function (a) { return a.id !== id; }); }); var card = data.result && data.result.appointment_id ? [{ kind: 'appointment', id: data.result.appointment_id, title: data.result.client_name || 'Randevu', detail: data.result.scheduled_at ? dateLabel(data.result.scheduled_at) + ' · ' + (data.result.service || '') : data.answer }] : []; state.messages.push({ role: 'assistant', content: data.answer, cards: card }); if (typeof reloadRemoteData === 'function') Promise.resolve().then(function () { return reloadRemoteData(); }).catch(function () {}); if (state.voiceEnabled) speak(data.answer); }
    catch (error) { state.messages.push({ role: 'assistant', content: 'İşlem uygulanamadı: ' + error.message }); }
    finally { state.busy = false; draw(); }
  }
  function stopSpeaking() { if (window.speechSynthesis) window.speechSynthesis.cancel(); state.speaking = false; }
  function speak(text) {
    if (!state.voiceEnabled || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    var utterance = new SpeechSynthesisUtterance(text.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ''));
    utterance.lang = 'tr-TR'; utterance.rate = 1; utterance.pitch = 1;
    var voices = window.speechSynthesis.getVoices(); var turkish = voices.find(function (v) { return /^tr(-|_)/i.test(v.lang); }); if (turkish) utterance.voice = turkish;
    utterance.onstart = function () { state.speaking = true; draw(); };
    utterance.onend = function () { state.speaking = false; draw(); if (state.handsFree && state.voiceTurn && state.view === 'chat') startMic(); };
    utterance.onerror = function () { state.speaking = false; draw(); };
    window.speechSynthesis.speak(utterance);
  }
  function toggleMic() {
    if (state.recognition && state.listening) { state.handsFree = false; state.recognition.abort(); state.listening = false; draw(); return; }
    stopSpeaking(); startMic();
  }
  function startMic() {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { alert('Bu tarayıcıda ses tanıma yok. Mesajınızı yazabilirsiniz.'); return; }
    var recognition = new Recognition(); state.recognition = recognition; recognition.lang = 'tr-TR'; recognition.interimResults = true; recognition.continuous = false;
    recognition.onstart = function () { state.listening = true; draw(); };
    recognition.onresult = function (event) { var text = Array.from(event.results).map(function (r) { return r[0].transcript; }).join(' ').trim(); var input = root.querySelector('#smAiInput'); if (input) input.value = text; if (Array.from(event.results).some(function (r) { return r.isFinal; }) && text) { state.voiceTurn = true; state.listening = false; recognition.stop(); sendMessage(text, true); } };
    recognition.onerror = function () { state.listening = false; state.handsFree = false; draw(); };
    recognition.onend = function () { state.listening = false; draw(); };
    try { recognition.start(); } catch (ignore) { state.listening = false; state.handsFree = false; draw(); }
  }
  var oldShowPage = window.showPage;
  window.showPage = function (id) { var result = oldShowPage.apply(this, arguments); if (id === 'salonAssistant') { draw(); loadSummary(); if (!state.loaded) loadHistory(); } return result; };
  var oldLogout = window.logout;
  window.logout = function () { stopSpeaking(); state.messages = []; state.all = []; state.summary = null; state.loaded = false; state.sessionId = crypto.randomUUID(); if (state.recognition) state.recognition.abort(); return oldLogout.apply(this, arguments); };
  draw();
})();
