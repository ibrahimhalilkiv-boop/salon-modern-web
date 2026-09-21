(function () {
  'use strict';

  var AUTH = Object.freeze({
    INITIALIZING: 'INITIALIZING',
    AUTHENTICATED: 'AUTHENTICATED',
    UNAUTHENTICATED: 'UNAUTHENTICATED',
    TEMPORARY_NETWORK_ERROR: 'TEMPORARY_NETWORK_ERROR'
  });
  var authState = AUTH.INITIALIZING;
  var authRequest = 0;
  var retryTimer = null;
  var updateRequested = false;
  var startupPromise = null;
  var sessionLoadPromise = null;
  var startupCount = 0;
  var loadCount = 0;
  var LAST_PAGE_KEY = 'salonModernLastPageV1';
  var TRACE_KEY = 'salonModernAuthTraceV1';

  window.SalonAuthState = AUTH;
  window.getSalonAuthState = function () { return authState; };

  function trace(stage, details) {
    var entry = Object.assign({ time: new Date().toISOString(), stage: stage }, details || {});
    console.info('[Salon auth]', entry);
    try {
      var history = JSON.parse(sessionStorage.getItem(TRACE_KEY) || '[]');
      history.push(entry);
      sessionStorage.setItem(TRACE_KEY, JSON.stringify(history.slice(-100)));
    } catch (_) {}
  }

  function storedAuthSnapshot() {
    var snapshot = { keyCount: 0, hasStoredSession: false, hasAccessToken: false, hasRefreshToken: false };
    try {
      Object.keys(localStorage).filter(function (key) {
        return /^sb-.*-auth-token$/i.test(key);
      }).forEach(function (key) {
        snapshot.keyCount++;
        try {
          var parsed = JSON.parse(localStorage.getItem(key) || 'null');
          var session = parsed && (parsed.currentSession || parsed.session || parsed);
          snapshot.hasAccessToken = snapshot.hasAccessToken || Boolean(session && session.access_token);
          snapshot.hasRefreshToken = snapshot.hasRefreshToken || Boolean(session && session.refresh_token);
        } catch (_) {}
      });
    } catch (_) {}
    snapshot.hasStoredSession = snapshot.hasAccessToken && snapshot.hasRefreshToken;
    return snapshot;
  }

  function readStoredSession() {
    try {
      var keys = Object.keys(localStorage).filter(function (key) { return /^sb-.*-auth-token$/i.test(key); });
      for (var index = 0; index < keys.length; index++) {
        var parsed = JSON.parse(localStorage.getItem(keys[index]) || 'null');
        var session = parsed && (parsed.currentSession || parsed.session || parsed);
        if (session && session.access_token && session.refresh_token) return session;
      }
    } catch (_) {}
    return null;
  }

  function setState(next) {
    authState = next;
    document.documentElement.dataset.authState = next;
    window.dispatchEvent(new CustomEvent('salon:auth-state', { detail: { state: next } }));
  }

  function isTemporary(error) {
    var status = Number(error && (error.status || error.statusCode));
    var message = String(error && (error.message || error.name) || '').toLowerCase();
    return !navigator.onLine || status >= 500 || status === 408 || status === 429 ||
      /network|fetch|timeout|timed out|connection|abort|offline|failed to fetch/.test(message);
  }

  function isInvalidSession(error) {
    var status = Number(error && (error.status || error.statusCode));
    var message = String(error && error.message || '').toLowerCase();
    return status === 401 || /invalid.*(jwt|token|refresh)|refresh.*token.*not found|jwt.*expired/.test(message);
  }

  function isIrrecoverableRefresh(error) {
    var message = String(error && error.message || '').toLowerCase();
    var code = String(error && error.code || '').toLowerCase();
    return /refresh.*token.*(not found|invalid|expired|revoked)|invalid.*refresh.*token|session.*not.*found/.test(message) ||
      /refresh_token_(not_found|invalid|expired|revoked)|session_not_found/.test(code);
  }

  async function recoverStoredSession() {
    var stored = readStoredSession();
    if (!stored) return null;
    trace('stored-session-recovery-start', storedAuthSnapshot());
    var result = await window.salonDb.auth.setSession({
      access_token: stored.access_token,
      refresh_token: stored.refresh_token
    });
    if (result.error) throw result.error;
    trace('stored-session-recovery-complete', { hasSession: Boolean(result.data && result.data.session) });
    return result.data && result.data.session;
  }

  async function getVerifiedUser() {
    var userResult = await window.salonDb.auth.getUser();
    if (!userResult.error && userResult.data && userResult.data.user) return userResult.data.user;
    if (!userResult.error || !isInvalidSession(userResult.error)) throw userResult.error || new Error('Oturum kullanıcısı bulunamadı.');

    // A short-lived access token may expire while the remembered device session is still valid.
    // Refresh once before deciding that the user must sign in again.
    var refreshResult = await window.salonDb.auth.refreshSession();
    if (refreshResult.error || !refreshResult.data || !refreshResult.data.session) {
      var refreshError = refreshResult.error || new Error('Yenileme oturumu bulunamadı.');
      refreshError.salonIrrecoverableSession = isIrrecoverableRefresh(refreshError);
      throw refreshError;
    }

    userResult = await window.salonDb.auth.getUser();
    if (userResult.error || !userResult.data || !userResult.data.user) {
      var verificationError = userResult.error || new Error('Yenilenen oturum doğrulanamadı.');
      verificationError.salonIrrecoverableSession = isInvalidSession(verificationError);
      throw verificationError;
    }
    return userResult.data.user;
  }

  function showInitializing() {
    document.getElementById('auth')?.classList.add('hidden');
    document.getElementById('app')?.classList.add('hidden');
  }

  function showConnectionProblem(error) {
    setState(AUTH.TEMPORARY_NETWORK_ERROR);
    if (typeof currentUser !== 'undefined' && currentUser) {
      document.getElementById('auth')?.classList.add('hidden');
      document.getElementById('app')?.classList.remove('hidden');
      window.showAppToast?.('Bağlantı bekleniyor', 'Oturumunuz korunuyor. İnternet gelince yeniden denenecek.');
      return;
    }
    var auth = document.getElementById('auth');
    auth?.classList.remove('hidden');
    document.getElementById('loginForm')?.classList.add('hidden');
    document.getElementById('setupForm')?.classList.add('hidden');
    var box = document.getElementById('pwaConnectionState');
    if (!box && auth) {
      box = document.createElement('div');
      box.id = 'pwaConnectionState';
      box.style.cssText = 'max-width:440px;margin:24px auto;padding:20px;border:1px solid #ddd7ca;border-radius:18px;background:#fff;text-align:center';
      box.innerHTML = '<strong>Bağlantı bekleniyor</strong><p style="margin:10px 0">Oturumunuz silinmedi. İnternet bağlantısı gelince otomatik yeniden denenecek.</p><button type="button" id="pwaAuthRetry">Tekrar dene</button>';
      auth.appendChild(box);
      box.querySelector('#pwaAuthRetry').addEventListener('click', function () { window.startRemoteApp(); });
    }
    if (box) box.hidden = false;
    console.warn('[PWA auth] temporary error; session preserved', error && error.message);
  }

  function hideConnectionProblem() {
    var box = document.getElementById('pwaConnectionState');
    if (box) box.hidden = true;
  }

  async function localSignOut() {
    trace('confirmed-invalid-session-local-signout');
    try { await window.salonDb.auth.signOut({ scope: 'local' }); } catch (_) {}
    currentUser = null;
  }

  async function loadProfile(user, requestId) {
    var result = await window.salonDb.from('profiles')
      .select('id,username,full_name,role,commission_pct,active')
      .eq('id', user.id).maybeSingle();
    if (requestId !== authRequest) return false;
    if (result.error) throw result.error;
    if (!result.data) {
      var missingProfile = new Error('Kullanıcı profili geçici olarak alınamadı.');
      missingProfile.salonDataLoadError = true;
      throw missingProfile;
    }
    if (result.data.active === false) {
      await localSignOut();
      setState(AUTH.UNAUTHENTICATED);
      window.setRemoteAuth(false);
      window.remoteError?.('Bu kullanıcı hesabı aktif değil.');
      return false;
    }
    currentUser = window.profileToUser(result.data);
    return true;
  }

  async function runLoadRemoteSession() {
    var requestId = ++authRequest;
    var verifiedSession = false;
    loadCount++;
    trace('loadRemoteSession-start', Object.assign({ count: loadCount, requestId: requestId }, storedAuthSnapshot()));
    try {
      var verifiedUser = await getVerifiedUser();
      verifiedSession = true;
      trace('getUser-complete', { requestId: requestId, hasUser: Boolean(verifiedUser), userId: verifiedUser && verifiedUser.id });
      if (requestId !== authRequest) return;
      if (!(await loadProfile(verifiedUser, requestId))) return;
      trace('profile-complete', { requestId: requestId, role: currentUser && currentUser.role });
      await window.reloadRemoteData();
      trace('reloadRemoteData-complete', { requestId: requestId });
      if (requestId !== authRequest) return;
      window.subscribeSalon();
      trace('realtime-subscribe-requested', { requestId: requestId });
      window.enterApp();
      var savedPage = sessionStorage.getItem(LAST_PAGE_KEY) || 'home';
      window.showPage(document.getElementById(savedPage) ? savedPage : 'home');
      hideConnectionProblem();
      setState(AUTH.AUTHENTICATED);
      trace('authenticated', { requestId: requestId, page: savedPage });
      window.showAppToast?.('Canlı bağlantı açık', 'Randevu ve bildirimler anlık eşitlenir.');
    } catch (error) {
      if (requestId !== authRequest) return;
      trace('loadRemoteSession-error', { requestId: requestId, message: String(error && error.message || ''), temporary: isTemporary(error), verifiedSession: verifiedSession });
      if (isTemporary(error) || verifiedSession || error && error.salonDataLoadError) return showConnectionProblem(error);
      if (error && error.salonIrrecoverableSession) await localSignOut();
      if (storedAuthSnapshot().hasStoredSession && !(error && error.salonIrrecoverableSession)) return showConnectionProblem(error);
      setState(AUTH.UNAUTHENTICATED);
      window.setRemoteAuth(false);
      window.remoteError?.('Oturum doğrulanamadı. Lütfen yeniden giriş yapın.');
    }
  }

  window.loadRemoteSession = function () {
    if (sessionLoadPromise) return sessionLoadPromise;
    sessionLoadPromise = runLoadRemoteSession().finally(function () { sessionLoadPromise = null; });
    return sessionLoadPromise;
  };

  async function runStartRemoteApp() {
    var requestId = ++authRequest;
    startupCount++;
    clearTimeout(retryTimer);
    setState(AUTH.INITIALIZING);
    showInitializing();
    trace('startRemoteApp-start', Object.assign({ count: startupCount, requestId: requestId }, storedAuthSnapshot()));
    try {
      var sessionResult = await window.salonDb.auth.getSession();
      trace('getSession-complete', Object.assign({ requestId: requestId, hasSession: Boolean(sessionResult.data && sessionResult.data.session), hasError: Boolean(sessionResult.error) }, storedAuthSnapshot()));
      if (requestId !== authRequest) return;
      if (sessionResult.error) throw sessionResult.error;
      var session = sessionResult.data && sessionResult.data.session;
      if (!session && storedAuthSnapshot().hasStoredSession) session = await recoverStoredSession();
      if (session) {
        authRequest--;
        await window.loadRemoteSession();
        return;
      }
      setState(AUTH.UNAUTHENTICATED);
      hideConnectionProblem();
      window.setRemoteAuth(false);
    } catch (error) {
      if (requestId !== authRequest) return;
      trace('startRemoteApp-error', { requestId: requestId, message: String(error && error.message || ''), temporary: isTemporary(error) });
      if (isTemporary(error)) return showConnectionProblem(error);
      if (error && error.salonIrrecoverableSession) await localSignOut();
      if (storedAuthSnapshot().hasStoredSession && !(error && error.salonIrrecoverableSession)) return showConnectionProblem(error);
      setState(AUTH.UNAUTHENTICATED);
      window.setRemoteAuth(false);
      window.remoteError?.('Oturum açılamadı. Lütfen yeniden giriş yapın.');
    }
  }

  window.startRemoteApp = function () {
    if (startupPromise) return startupPromise;
    startupPromise = runStartRemoteApp().finally(function () { startupPromise = null; });
    return startupPromise;
  };

  window.addEventListener('beforeunload', function () {
    var active = document.querySelector('.page.active');
    if (active && active.id) sessionStorage.setItem(LAST_PAGE_KEY, active.id);
    trace('beforeunload', Object.assign({ page: active && active.id || '' }, storedAuthSnapshot()));
  });

  window.addEventListener('online', function () {
    if (authState !== AUTH.TEMPORARY_NETWORK_ERROR) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () { window.startRemoteApp(); }, 400);
  });

  function formIsBusy() {
    var active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && String(active.value || '').trim()) return true;
    return !!document.querySelector('.modal:not(.hidden), dialog[open], form[data-dirty="true"]');
  }

  function showUpdate(registration) {
    if (!registration || !registration.waiting || document.getElementById('pwaUpdateBanner')) return;
    var banner = document.createElement('div');
    banner.id = 'pwaUpdateBanner';
    banner.style.cssText = 'position:fixed;left:12px;right:12px;bottom:18px;z-index:100000;padding:12px 14px;background:#12352f;color:#fff;border-radius:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-shadow:0 8px 28px #0004';
    banner.innerHTML = '<span>Yeni sürüm hazır.</span><button type="button" style="min-height:42px;padding:8px 16px;border:0;border-radius:10px;font-weight:700">Güncelle</button>';
    banner.querySelector('button').addEventListener('click', function () {
      if (formIsBusy() && !window.confirm('Açık formdaki değişiklikler kaybolabilir. Yine de güncellensin mi?')) return;
      var button=banner.querySelector('button');
      updateRequested = true;
      if(button){button.disabled=true;button.textContent='Güncelleniyor…'}
      var fallback=setTimeout(function(){
        updateRequested=false;
        if(button){button.disabled=false;button.textContent='Güncelle'}
        banner.querySelector('span').textContent='Güncelleme hazır. Tekrar deneyin.';
      },8000);
      var onControllerChange=function(){
        clearTimeout(fallback);
        navigator.serviceWorker.removeEventListener('controllerchange',onControllerChange);
      };
      navigator.serviceWorker.addEventListener('controllerchange',onControllerChange);
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
    document.body.appendChild(banner);
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (updateRequested) location.reload();
    });
    navigator.serviceWorker.ready.then(function (registration) {
      if (registration.waiting) showUpdate(registration);
      registration.addEventListener('updatefound', function () {
        var worker = registration.installing;
        worker?.addEventListener('statechange', function () {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(registration);
        });
      });
      registration.update().catch(function () {});
    });
  }
})();
