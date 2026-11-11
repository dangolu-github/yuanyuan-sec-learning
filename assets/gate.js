// Course access for the learner pages. The password is checked by the course service and never stored
// here: the browser keeps an opaque trust credential and a short-lived access token.
// Every call is a POST with a JSON body (text/plain, so no CORS preflight): passwords, tokens and answers never
// travel in a URL, and the endpoint can be a narrow relay for access from mainland China.
// Remembered sign-in (2026-11-11): the credential is sent with every request and accepted on its own when
// the short token has gone, so the password is asked for once per browser. It is forgotten only when the
// course says explicitly that this browser is unknown or was signed out; a connection problem keeps it and
// offers to try again.
(() => {
  const trustedBrowserKey = 'yy-sec-trusted-browser-v1';
  const deviceTokenKey = 'yy-sec-device-token-v1';
  const tokenKey = 'yy-sec-access-token';
  const expiryKey = 'yy-sec-access-expires-at';
  const config = window.YY_PORTAL_CONFIG || {};
  let resolveReady;
  let renewal = null;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  const readStorage = (storage, key) => {
    try { return storage.getItem(key) || ''; }
    catch { return ''; }
  };
  const writeStorage = (storage, key, value) => {
    try { storage.setItem(key, value); return true; }
    catch { return false; }
  };
  const removeStorage = (storage, key) => {
    try { storage.removeItem(key); } catch { /* nothing stored */ }
  };
  // Only an explicit answer from the course ends a remembered browser (the error carries `reason`).
  const forgetBrowser = () => {
    removeStorage(window.localStorage, deviceTokenKey);
    removeStorage(window.localStorage, trustedBrowserKey);
    removeStorage(window.sessionStorage, tokenKey);
    removeStorage(window.sessionStorage, expiryKey);
  };
  const getToken = () => readStorage(window.sessionStorage, tokenKey);
  const getDeviceToken = () => readStorage(window.localStorage, deviceTokenKey);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomId = (prefix) => prefix + '-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(16) + Math.random().toString(16).slice(2).padEnd(16, '0'));

  const setAccess = (token, deviceToken, expiresIn) => {
    if (token) writeStorage(window.sessionStorage, tokenKey, token);
    if (token) writeStorage(window.sessionStorage, expiryKey, String(Date.now() + Number(expiresIn || 21600) * 1000));
    writeStorage(window.localStorage, trustedBrowserKey, 'granted');
    if (deviceToken) writeStorage(window.localStorage, deviceTokenKey, deviceToken);
  };

  const consumeTrustedDevice = () => {
    try {
      const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const token = String(parameters.get('yy-trusted-device') || '').replace(/[^a-f0-9]/gi, '').slice(0, 128);
      if (!token) return '';
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return token;
    }
    catch { return ''; }
  };

  // One call to the course service. Resolves with its JSON answer; rejects when it cannot be reached.
  const requestData = async (action, parameters, timeoutMs) => {
    if (!config.endpoint) throw new Error('The course service is not connected yet.');
    const controller = window.AbortController ? new AbortController() : null;
    const timeout = window.setTimeout(() => { if (controller) controller.abort(); }, timeoutMs || 30000);
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST', redirect: 'follow', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({}, parameters, { action })),
        signal: controller ? controller.signal : undefined
      });
      return await response.json();
    } catch (error) {
      throw new Error(error && error.name === 'AbortError' ? 'The course service did not answer. Check your connection and try again.' : 'The course service could not be reached. Check your connection and try again.');
    } finally { window.clearTimeout(timeout); }
  };

  // A refusal from the course carries `reason` ('unknown' or 'revoked'); a request that never got an answer
  // does not, and is never taken as a refusal.
  const requestAccess = async (action, parameters) => {
    const data = await requestData(action, parameters);
    if (!data || !data.ok || !data.accessToken) {
      const error = new Error((data && data.error) || 'Access could not be confirmed.');
      if (data && data.reason) error.reason = data.reason;
      throw error;
    }
    return data;
  };
  const authorize = (code) => requestAccess('authorizeAccess', { code });
  const renewAccess = (deviceToken) => requestAccess('renewAccess', { deviceToken });
  const OFFLINE = 'We could not reach your course. Check your connection and try again.';

  async function ensureFreshAccess(force) {
    if (renewal) return renewal;
    const token = getToken();
    const expiresAt = Number(readStorage(window.sessionStorage, expiryKey));
    if (!force && token && expiresAt > Date.now() + 60000) return token;
    const device = getDeviceToken();
    if (!device) {
      showGate();
      throw new Error('Please enter the course password again. Nothing you saved is lost.');
    }
    renewal = renewAccess(device).then((access) => {
      setAccess(access.accessToken, device, access.expiresIn);
      reveal();
      resolveReady();
      return access.accessToken;
    }).catch((error) => {
      if (error && error.reason) {
        forgetBrowser();
        showGate();
        throw new Error('Please enter the course password again. Nothing you saved is lost.');
      }
      // No answer: the remembered browser stays remembered. An old token still goes with the credential,
      // which the course accepts on its own.
      if (!force && token) return token;
      throw new Error(OFFLINE);
    }).finally(() => { renewal = null; });
    return renewal;
  }

  async function request(action, parameters, timeoutMs) {
    let token = await ensureFreshAccess(false);
    let data = await requestData(action, Object.assign({}, parameters, { accessToken: token, deviceToken: getDeviceToken() }), timeoutMs);
    if (data && !data.ok && /course access expired/i.test(data.error || '')) {
      token = await ensureFreshAccess(true);
      data = await requestData(action, Object.assign({}, parameters, { accessToken: token, deviceToken: getDeviceToken() }), timeoutMs);
    }
    if (!data || !data.ok) throw new Error((data && data.error) || 'The request could not be confirmed. Please try again.');
    return data;
  }

  // Write: the server's answer is read directly. If the connection drops before it arrives, the outcome is read
  // back as a receipt stored under this request's ID, so a save is never sent twice by mistake.
  async function post(action, payload, retried) {
    const token = await ensureFreshAccess(false);
    const requestId = randomId('req');
    let result = null;
    try { result = await requestData(action, Object.assign({}, payload, { accessToken: token, deviceToken: getDeviceToken(), requestId }), 90000); }
    catch (error) {
      for (let attempt = 0; attempt < 6 && !result; attempt += 1) {
        await sleep(800 + attempt * 600);
        try {
          const receipt = await requestData('getReceipt', { requestId });
          if (receipt && receipt.found) result = receipt.result || {};
        } catch (again) { /* try again */ }
      }
      if (!result) throw new Error('We could not confirm that this was saved. Check your connection and try again.');
    }
    if (result.ok) return result;
    if (!retried && /course access expired/i.test(result.error || '')) {
      await ensureFreshAccess(true);
      return post(action, payload, true);
    }
    throw new Error(result.error || 'The request was not accepted.');
  }

  // A write nobody waits for (the page moves on at once; the server works in the background).
  async function fire(action, payload) {
    try {
      const token = await ensureFreshAccess(false);
      fetch(config.endpoint, {
        method: 'POST', keepalive: true, credentials: 'omit',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({}, payload, { action, accessToken: token, deviceToken: getDeviceToken() }))
      }).catch(() => {});
    } catch (error) { /* nothing depends on this request */ }
  }

  window.YyAccess = { ready, ensureFreshAccess, request, post, fire, getToken, randomId, siteUrl: config.siteUrl || '' };

  const reveal = () => {
    document.body.dataset.access = 'granted';
    document.documentElement.classList.remove('access-pending');
    document.body.classList.remove('access-locked');
    document.querySelectorAll('body > [inert]').forEach((node) => { node.inert = false; });
    document.querySelector('.access-gate')?.remove();
  };

  const showGate = () => {
    if (document.querySelector('.access-gate')) return;
    document.body.dataset.access = 'locked';
    document.body.classList.add('access-locked');
    Array.from(document.body.children).forEach((node) => { node.inert = true; });
    const gate = document.createElement('div');
    gate.className = 'access-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'access-title');
    gate.innerHTML = `
      <form class="access-card">
        <p class="access-kicker">Yuanyuan | SEC English</p>
        <h1 id="access-title">Welcome</h1>
        <p>Enter your course password.</p>
        <label for="course-password">Password</label>
        <div class="access-row">
          <input id="course-password" name="password" type="password" autocomplete="current-password" required>
          <button type="submit">Continue</button>
        </div>
        <p class="access-error" role="alert" aria-live="polite"></p>
      </form>`;
    document.body.append(gate);
    gate.inert = false;
    document.documentElement.classList.remove('access-pending');
    const form = gate.querySelector('form');
    const input = gate.querySelector('input');
    const error = gate.querySelector('.access-error');
    input.focus();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      const button = form.querySelector('button');
      button.disabled = true;
      button.textContent = 'Opening...';
      try {
        const access = await authorize(input.value.trim());
        setAccess(access.accessToken, access.deviceToken, access.expiresIn);
      } catch (accessError) {
        const message = (accessError && accessError.message) || '';
        const wrong = /incorrect course password/i.test(message);
        error.textContent = wrong ? 'That password does not match. Please try again.'
          : /too many attempts/i.test(message) ? message
            : 'We could not connect to your course. Check your connection and try again.';
        if (wrong) input.select();
        button.disabled = false;
        button.textContent = wrong ? 'Continue' : 'Try again';
        return;
      }
      reveal();
      resolveReady();
    });
  };

  // A remembered browser that cannot reach the course right now is offered another try, never the
  // password box: nothing is forgotten until the course itself says so.
  const showRetry = (retry) => {
    document.querySelector('.access-gate')?.remove();
    document.body.dataset.access = 'locked';
    document.body.classList.add('access-locked');
    Array.from(document.body.children).forEach((node) => { node.inert = true; });
    const gate = document.createElement('div');
    gate.className = 'access-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'access-title');
    gate.innerHTML = `
      <div class="access-card">
        <p class="access-kicker">Yuanyuan | SEC English</p>
        <h1 id="access-title">Welcome</h1>
        <p>${OFFLINE}</p>
        <div class="access-row"><button type="button">Try again</button></div>
      </div>`;
    document.body.append(gate);
    gate.inert = false;
    document.documentElement.classList.remove('access-pending');
    const button = gate.querySelector('button');
    button.focus();
    button.addEventListener('click', () => { button.disabled = true; button.textContent = 'Opening...'; retry(); });
  };

  const trustedDevice = consumeTrustedDevice() || getDeviceToken();
  if (trustedDevice) {
    const start = () => renewAccess(trustedDevice).then((access) => {
      setAccess(access.accessToken, trustedDevice, access.expiresIn);
      reveal();
      resolveReady();
    }).catch((error) => {
      if (error && error.reason) { forgetBrowser(); document.querySelector('.access-gate')?.remove(); showGate(); return; }
      showRetry(start);
    });
    start();
    return;
  }
  showGate();
})();
