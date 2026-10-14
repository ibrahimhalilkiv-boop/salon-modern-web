const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function conversationTest() {
  const nodes = Object.fromEntries(['salonAssistantInput', 'phase2AssistantInput', 'salonAssistantResult', 'phase2AssistantResult', 'appointmentDate', 'appointmentCustomer'].map(id => [id, { value: '', innerHTML: '' }]));
  let opened = 0, queries = 0;
  const query = { select() { return this }, gte() { return this }, lt() { return this }, neq() { return this }, order() { queries++; return Promise.resolve({ data: [], error: null }) } };
  const context = {
    window: { render() {}, SalonPhase2Test: { rows: () => [{ client_id: 'c1' }] } },
    document: { getElementById: id => nodes[id] || null, querySelectorAll: () => [], createElement: () => ({ style: {}, textContent: '' }), head: { appendChild() {} } },
    currentUser: { id: 'e1', role: 'yonetici' }, remoteClients: [{ id: 'c1', full_name: 'Ayhan Aslan', active: true }],
    remoteProfiles: [{ id: 'e1', full_name: 'Halil Kıv', username: 'halil', active: true }], appts: [],
    salonDb: { from: () => query }, localDate: () => '2026-10-14', friendlyDate: value => value,
    getServices: () => [{ duration: 60 }], appointmentConflictFor: () => false, remoteAppointment: value => value,
    openAppointmentModal: () => { opened++ }, reloadRemoteData: async () => {}, renderHomeSummary() {}, enterApp() {}, login() {}, startRemoteApp() {},
    setTimeout, clearTimeout, console
  };
  context.SalonPhase2Test = context.window.SalonPhase2Test;
  vm.runInNewContext(fs.readFileSync('salon-assistant-2.0.0.js', 'utf8'), context);
  assert.equal(context.window.SalonAssistantV2Test.parseTime('Akşam altı'), '18:00');
  nodes.salonAssistantInput.value = "Ayhan'a yarın randevu oluştur";
  await context.window.runSalonAssistant();
  assert.match(nodes.salonAssistantResult.innerHTML, /saat kaçta/i);
  assert.equal(context.window.SalonAssistantV2Test.getSession().pending, null);
  nodes.salonAssistantInput.value = 'Akşam altı';
  await context.window.runSalonAssistant();
  assert.match(nodes.salonAssistantResult.innerHTML, /Hangi çalışana/i);
  nodes.salonAssistantInput.value = "Halil'e";
  await context.window.runSalonAssistant();
  assert.match(nodes.salonAssistantResult.innerHTML, /Onay gerekli/);
  assert.equal(context.window.SalonAssistantV2Test.getSession().pending.time, '18:00');
  assert.equal(opened, 0, 'No appointment form or write before approval');
  assert.ok(queries > 0, 'Real calendar query is used before confirmation');
  nodes.salonAssistantInput.value = 'Evet';
  await context.window.runSalonAssistant();
  assert.equal(opened, 1, 'Approval only opens the existing appointment form');
  assert.equal(context.window.SalonAssistantV2Test.getSession().pending, null);
  nodes.salonAssistantInput.value = 'Evet';
  await context.window.runSalonAssistant();
  assert.equal(opened, 1, 'A repeated yes cannot approve again');
  nodes.salonAssistantInput.value = "Ayhan'a yarın randevu oluştur";
  await context.window.runSalonAssistant();
  nodes.salonAssistantInput.value = 'Vazgeç';
  await context.window.runSalonAssistant();
  assert.equal(context.window.SalonAssistantV2Test.getSession().followUp, null);
  assert.equal(opened, 1);
}

function speechTest() {
  let spoken = [], cancelled = 0, executed = 0, recognition;
  const storage = new Map();
  const inputs = {};
  function Recognition() { recognition = this }
  Recognition.prototype.start = function () {};
  Recognition.prototype.abort = function () {};
  const context = {
    window: {
      showPage() {}, salonAssistantCommandSource: 'voice_assistant', SpeechRecognition: Recognition,
      runSalonAssistant: async () => { executed++ },
      SpeechSynthesisUtterance: function (text) { this.text = text },
      speechSynthesis: { getVoices: () => [{ lang: 'tr-TR', name: 'Turkish' }], speak: utterance => spoken.push(utterance), cancel: () => { cancelled++ } }
    },
    document: { getElementById: id => inputs[id] || null, querySelectorAll: () => [], createElement: () => ({ textContent: '' }), head: { appendChild() {} } },
    SpeechSynthesisUtterance: function (text) { this.text = text },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout, clearTimeout, console
  };
  vm.runInNewContext(fs.readFileSync('salon-voice-2.1.0.js', 'utf8'), context);
  const content = { cloneNode: () => ({ textContent: 'Halil için 14:00 ve 16:30 uygun.', querySelectorAll: () => [] }) };
  const node = { querySelector: selector => selector === '.empty' ? null : content };
  context.window.onSalonAssistantRendered(node);
  context.window.onSalonAssistantRendered(node);
  assert.equal(spoken.length, 1, 'One answer is read once');
  assert.equal(spoken[0].lang, 'tr-TR');
  assert.equal(spoken[0].voice.lang, 'tr-TR');
  context.window.stopSalonVoiceSpeech();
  assert.ok(cancelled >= 1, 'Stop immediately cancels speech');
  inputs.salonAssistantInput = { value: '', closest: () => null };
  context.window.startSalonVoice('salonAssistantInput');
  assert.ok(cancelled >= 2, 'A new command stops the previous answer');
  recognition.onresult({ resultIndex: 0, results: [{ 0: { transcript: 'Bugünkü randevuları göster' }, isFinal: true }] });
  recognition.onend();
  assert.equal(executed, 1, 'A completed spoken command runs once after the microphone closes');
  recognition.onend();
  assert.equal(executed, 1, 'A repeated recognition end cannot execute twice');
  context.window.toggleSalonVoiceReply();
  assert.equal(storage.get('salonVoiceReplyEnabled'), 'false');
  context.window.SalonVoiceTest.getState().commandId++;
  context.window.onSalonAssistantRendered(node);
  assert.equal(spoken.length, 1, 'Disabled speech stays silent');
  delete context.window.speechSynthesis;
  context.window.toggleSalonVoiceReply();
  assert.doesNotThrow(() => context.window.onSalonAssistantRendered(node), 'Written result remains usable without synthesis');
}

conversationTest().then(() => { speechTest(); console.log('assistant voice conversation: passed') }).catch(error => { console.error(error); process.exitCode = 1 });
