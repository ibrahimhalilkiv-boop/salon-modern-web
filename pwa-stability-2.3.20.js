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

  window.SalonAuthState = AUTH;
  window.getSalonAuthState = function () { return authState; };

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
    var status = Number(error && (error.status || error.statusCode));
    var message = String(error && error.message || '').toLowerCase();
    return status === 400 || status === 401 ||
      /refresh.*token.*(not found|invalid|expired|revoked)|invalid.*refresh.*token/.test(message);
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
    try { await window.salonDb.auth.signOut({ scope: 'local' }); } catch (_) {}
    currentUser = null;
  }

  async function loadProfile(user, requestId) {
    var result = await window.salonDb.from('profiles')
      .select('id,username,full_name,role,commission_pct,active')
      .eq('id', user.id).maybeSingle();
    if (requestId !== authRequest) return false;
    if (result.error) throw result.error;
    if (!result.data || !result.data.active) {
      await localSignOut();
      setState(AUTH.UNAUTHENTICATED);
      window.setRemoteAuth(false);
      window.remoteError?.('Bu kullanıcı hesabı aktif değil.');
      return false;
    }
    currentUser = window.profileToUser(result.data);
    return true;
  }

  window.loadRemoteSession = async function () {
    var requestId = ++authRequest;
    try {
      var verifiedUser = await getVerifiedUser();
      if (requestId !== authRequest) return;
      if (!(await loadProfile(verifiedUser, requestId))) return;
      await window.reloadRemoteData();
      if (requestId !== authRequest) return;
      window.subscribeSalon();
      window.enterApp();
      window.showPage('home');
      hideConnectionProblem();
      setState(AUTH.AUTHENTICATED);
      window.showAppToast?.('Canlı bağlantı açık', 'Randevu ve bildirimler anlık eşitlenir.');
    } catch (error) {
      if (requestId !== authRequest) return;
      if (isTemporary(error)) return showConnectionProblem(error);
      if (error && error.salonIrrecoverableSession) await localSignOut();
      setState(AUTH.UNAUTHENTICATED);
      window.setRemoteAuth(false);
      window.remoteError?.('Oturum doğrulanamadı. Lütfen yeniden giriş yapın.');
    }
  };

  window.startRemoteApp = async function () {
    var requestId = ++authRequest;
    clearTimeout(retryTimer);
    setState(AUTH.INITIALIZING);
    showInitializing();
    try {
      var sessionResult = await window.salonDb.auth.getSession();
      if (requestId !== authRequest) return;
      if (sessionResult.error) throw sessionResult.error;
      if (sessionResult.data && sessionResult.data.session) {
        authRequest--;
        await window.loadRemoteSession();
        return;
      }
      setState(AUTH.UNAUTHENTICATED);
      hideConnectionProblem();
      window.setRemoteAuth(false);
    } catch (error) {
      if (requestId !== authRequest) return;
      if (isTemporary(error)) return showConnectionProblem(error);
      if (error && error.salonIrrecoverableSession) await localSignOut();
      setState(AUTH.UNAUTHENTICATED);
      window.setRemoteAuth(false);
      window.remoteError?.('Oturum açılamadı. Lütfen yeniden giriş yapın.');
    }
  };

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
      updateRequested = true;
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
