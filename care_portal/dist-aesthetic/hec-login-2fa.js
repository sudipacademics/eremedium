/* SMS code step for staff password logins. authenticate_user answers { two_factor: true } for admin and
   manager roles; this asks for the code, verifies it, and hands the page the normal signed-in response.
   Same file as health_web_app/public/hec-login-2fa.js. */
(function () {
  if (window.__hecLogin2fa) return;
  window.__hecLogin2fa = true;

  var BASE = '/api/method/health_ecosystem_core.health_ecosystem_core.clinical_login_2fa.';
  var prior = window.fetch;

  function post(method, data) {
    return prior.call(window, BASE + method, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
      body: new URLSearchParams(data),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (json) {
        var m = json && json.message && typeof json.message === 'object' ? json.message : {};
        return { ok: r.ok && m.status === 'success', status: r.status, json: json, m: m };
      });
    });
  }

  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
  }

  function node(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }

  function ask(challenge) {
    return new Promise(function (resolve) {
      var shade = node('div', 'position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;font-family:inherit');
      var card = node('form', 'background:#fff;border-radius:14px;padding:22px;width:min(360px,calc(100vw - 32px));box-shadow:0 20px 50px rgba(15,23,42,.25);display:grid;gap:12px;color:#142033');
      card.setAttribute('autocomplete', 'off');
      card.appendChild(node('h2', 'margin:0;font-size:18px', 'Enter verification code'));
      var info = node('p', 'margin:0;color:#475569;font-size:14px', 'We sent a 6-digit code by SMS to ' + (challenge.mobile_hint || 'your registered mobile') + '.');
      card.appendChild(info);
      var input = node('input', 'font-size:22px;letter-spacing:6px;text-align:center;padding:10px;border:1px solid #cbd5e1;border-radius:10px');
      input.inputMode = 'numeric';
      input.autocomplete = 'one-time-code';
      input.maxLength = 6;
      input.setAttribute('aria-label', 'Verification code');
      card.appendChild(input);
      var err = node('p', 'margin:0;color:#b91c1c;font-size:13px;min-height:16px', '');
      card.appendChild(err);
      var row = node('div', 'display:flex;gap:8px;justify-content:space-between;align-items:center');
      var resend = node('button', 'font:inherit;border:0;background:none;color:#0f766e;font-weight:600;cursor:pointer;padding:0', 'Send a new code');
      resend.type = 'button';
      var actions = node('div', 'display:flex;gap:8px');
      var cancel = node('button', 'font:inherit;border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:8px 14px;cursor:pointer', 'Cancel');
      cancel.type = 'button';
      var go = node('button', 'font:inherit;border:0;background:#0f766e;color:#fff;border-radius:8px;padding:8px 16px;cursor:pointer;font-weight:600', 'Verify');
      go.type = 'submit';
      actions.append(cancel, go);
      row.append(resend, actions);
      card.appendChild(row);
      shade.appendChild(card);
      document.body.appendChild(shade);
      setTimeout(function () { input.focus(); }, 30);

      function done(response) {
        shade.remove();
        resolve(response);
      }

      input.addEventListener('input', function () { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
      cancel.addEventListener('click', function () {
        done(jsonResponse({ message: { status: 'error', message: 'Sign-in cancelled', data: {} } }, 401));
      });
      resend.addEventListener('click', function () {
        resend.disabled = true;
        err.textContent = '';
        post('resend_login_code', { token: challenge.tfa_token }).then(function (r) {
          resend.disabled = false;
          if (r.ok) info.textContent = 'We sent a new code to ' + ((r.m.data && r.m.data.mobile_hint) || challenge.mobile_hint) + '.';
          else err.textContent = r.m.message || 'Could not send a new code';
        }, function () { resend.disabled = false; err.textContent = 'Network error. Try again.'; });
      });
      card.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (input.value.length !== 6) { err.textContent = 'Enter the 6-digit code.'; return; }
        go.disabled = true;
        err.textContent = '';
        post('verify_login_code', { token: challenge.tfa_token, code: input.value }).then(function (r) {
          go.disabled = false;
          if (r.ok) { done(jsonResponse(r.json, 200)); return; }
          var msg = r.m.message || 'Verification failed';
          if (/expired|sign in again/i.test(msg)) { done(jsonResponse(r.json, 401)); return; }
          err.textContent = msg;
          input.select();
        }, function () { go.disabled = false; err.textContent = 'Network error. Try again.'; });
      });
    });
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var pending = prior.apply(window, arguments);
    if (url.indexOf('authenticate_user') === -1) return pending;
    return pending.then(function (res) {
      return res.clone().json().then(function (json) {
        var m = json && json.message && typeof json.message === 'object' ? json.message : null;
        var data = m && m.data;
        if (!data || !data.two_factor || !data.tfa_token) return res;
        return ask(data);
      }, function () { return res; });
    });
  };
})();
