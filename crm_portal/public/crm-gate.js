/* Sign-in gate for the Smilecure CRM portal.
 * Uses HRMS logins and Portal Access → CRM Portal (or System Manager).
 */
(function () {
  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.';
  var KEY = 'crm_session';
  var PEOPLE = 'https://people.e-remedium.in';
  var USER_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>';
  var root = document.documentElement;
  root.classList.add('crm-locked');

  /** Fallback paths if API omits module_paths (keep in sync with clinical_people_access.CRM_MODULE_PATHS). */
  var DEFAULT_CRM_PATHS = {
    Dashboard: ['/'],
    Leads: ['/leads'],
    Contacts: ['/contacts'],
    Accounts: ['/accounts'],
    Deals: ['/deals'],
    Activities: ['/activities', '/follow-ups', '/followups'],
    Bookings: ['/bookings'],
    Franchise: ['/franchise'],
    'Partner Bookings': ['/partner-bookings'],
    Campaigns: ['/campaigns'],
    Reports: ['/reports'],
    Settings: ['/settings'],
  };

  var style = document.createElement('style');
  style.textContent = [
    'html.crm-locked #root{display:none!important}',
    '.cg-wrap{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;background:linear-gradient(135deg,#0b1f3a,#1e3a5f);font-family:"Plus Jakarta Sans","Segoe UI",sans-serif}',
    '.cg-card{width:min(400px,100%);background:#fff;border-radius:18px;padding:28px;box-shadow:0 24px 60px rgba(0,0,0,.25);display:grid;gap:14px}',
    '.cg-card h1{margin:0;font-size:1.3rem;color:#0b1f3a}',
    '.cg-card p{margin:0;color:#475569;font-size:.9rem}',
    '.cg-card label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#334155}',
    '.cg-card input{border:1px solid #cbd5e1;border-radius:10px;padding:11px 12px;font:inherit;font-weight:500}',
    '.cg-card button{border:0;border-radius:10px;padding:12px;background:#2563eb;color:#fff;font:inherit;font-weight:800;cursor:pointer}',
    '.cg-card button:disabled{opacity:.6}',
    '.cg-card .cg-alt{background:#f1f5f9;color:#0b1f3a}',
    '.cg-err{color:#b91c1c!important;font-weight:600;min-height:1em}',
    '.cg-out{border:1px solid #d5e3e8;background:#fff;color:#0b1f3a;border-radius:10px;padding:7px 12px;font:inherit;font-weight:700;cursor:pointer;margin-left:8px}',
    '.main.cg-hr-on .content{display:none}',
    '.cg-hr{flex:1;min-height:0;display:flex;padding:0 0 0 4px}',
    '.cg-hr iframe{flex:1;width:100%;border:0;background:#f4f8f8;border-radius:14px 0 0 0}',
    '.cg-toast{position:fixed;z-index:10000;left:50%;bottom:24px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font:600 .88rem "Plus Jakarta Sans","Segoe UI",sans-serif}',
  ].join('\n');
  document.head.appendChild(style);

  function post(method, data) {
    return fetch(API + method, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
      body: new URLSearchParams(data || {}),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (json) {
        var m = json && json.message && typeof json.message === 'object' ? json.message : json;
        if (!r.ok || !m || m.status === 'error') {
          var err = new Error(String((m && m.message) || 'Request failed').replace(/<[^>]+>/g, ''));
          err.status = r.status;
          throw err;
        }
        return m.data !== undefined ? m.data : m;
      });
    });
  }

  function saved() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  function roleSet() {
    var list = (perms && perms.roles) || (saved() && saved().roles) || [];
    var out = {};
    for (var i = 0; i < list.length; i++) out[list[i]] = true;
    return out;
  }

  function hasFullCrmAccess() {
    if (!perms) return false;
    if (perms.exempt) return true;
    var roles = roleSet();
    if (roles['System Manager'] || roles['Administrator'] || roles['CRM Manager'] || roles['Sales Manager']) return true;
    var raw = (perms.portal_modules && perms.portal_modules.crm) || null;
    if (!raw || typeof raw !== 'object') return !!(roles['CRM Staff'] || roles['Sales Representative']);
    var keys = Object.keys(raw);
    if (!keys.length) return !!(roles['CRM Staff'] || roles['Sales Representative']);
    return keys.every(function (m) { return levelOf(raw[m]) !== 'none'; });
  }

  function levelOf(entry) {
    if (entry == null) return 'none';
    if (typeof entry === 'string') return entry.toLowerCase();
    return String((entry && entry.level) || 'none').toLowerCase();
  }

  function pathsOf(name, entry) {
    var fromApi = entry && Array.isArray(entry.paths) ? entry.paths.filter(Boolean) : [];
    if (fromApi.length) return fromApi;
    return DEFAULT_CRM_PATHS[name] || [];
  }

  var perms = null;
  var lastToastAt = 0;
  var lastDeniedPath = '';
  var refreshTimer = null;

  function screen(html) {
    var el = document.querySelector('.cg-wrap');
    if (!el) {
      el = document.createElement('div');
      el.className = 'cg-wrap';
      document.body.appendChild(el);
    }
    el.innerHTML = '<div class="cg-card">' + html + '</div>';
    root.classList.add('crm-locked');
    return el;
  }

  function showLogin(message) {
    var el = screen(
      '<h1>Smilecure CRM</h1><p>Sign in with your Smilecure staff login. Telecallers use CRM Portal access from HR.</p>' +
      '<form class="cg-form" style="display:grid;gap:12px" autocomplete="on">' +
      '<label>Email or username<input name="usr" autocomplete="username" required></label>' +
      '<label>Password<input name="pwd" type="password" autocomplete="current-password" required></label>' +
      '<p class="cg-err">' + esc(message || '') + '</p>' +
      '<button type="submit">Sign in</button></form>'
    );
    var form = el.querySelector('form');
    form.usr.focus();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button');
      var err = form.querySelector('.cg-err');
      btn.disabled = true;
      err.textContent = '';
      post('api.authenticate_user', { usr: form.usr.value.trim(), pwd: form.pwd.value }).then(function (d) {
        if (!d || !d.sid) {
          btn.disabled = false;
          err.textContent = (d && d.two_factor)
            ? 'Enter the SMS verification code to finish signing in.'
            : 'Sign in failed. Check your email and password.';
          return;
        }
        localStorage.setItem(KEY, JSON.stringify({ sid: d.sid, user: d.user, full_name: d.full_name, roles: d.roles || [] }));
        check();
      }).catch(function (ex) {
        btn.disabled = false;
        err.textContent = ex.message || 'Sign in failed';
      });
    });
  }

  function showDenied(name) {
    var el = screen(
      '<h1>No access</h1><p>' + esc(name || 'This login') + ' has not been given access to the CRM portal. ' +
      'Ask HR to add "CRM Portal" in Portal Access.</p><button type="button" class="cg-alt">Sign in as someone else</button>'
    );
    el.querySelector('button').addEventListener('click', signOut);
  }

  function signOut() {
    var s = saved();
    localStorage.removeItem(KEY);
    hrShow(false);
    perms = null;
    if (s && s.sid) {
      fetch('/api/method/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
        body: new URLSearchParams({ sid: s.sid }),
      }).catch(function () {});
    }
    showLogin();
  }

  function crmModules() {
    var raw = (perms && perms.portal_modules && perms.portal_modules.crm) || null;
    if (!raw || typeof raw !== 'object') return null;
    var out = {};
    Object.keys(raw).forEach(function (name) {
      out[name] = {
        level: levelOf(raw[name]),
        paths: pathsOf(name, raw[name]),
      };
    });
    // Ensure every known CRM module exists so new pages are gated consistently.
    Object.keys(DEFAULT_CRM_PATHS).forEach(function (name) {
      if (!out[name]) {
        out[name] = { level: hasFullCrmAccess() ? 'manage' : 'none', paths: DEFAULT_CRM_PATHS[name] };
      } else if (!out[name].paths.length) {
        out[name].paths = DEFAULT_CRM_PATHS[name];
      }
    });
    return out;
  }

  function normalizePath(path) {
    path = String(path || '/').split('?')[0].split('#')[0];
    if (!path) return '/';
    // Strip trailing slash except root.
    if (path.length > 1) path = path.replace(/\/$/, '');
    return path || '/';
  }

  function moduleOf(path) {
    var mods = crmModules() || {};
    path = normalizePath(path);
    var best = null;
    var bestLen = -1;
    Object.keys(mods).forEach(function (name) {
      (mods[name].paths || []).forEach(function (p) {
        p = normalizePath(p);
        var hit = p === '/' ? path === '/' : path === p || path.indexOf(p + '/') === 0;
        if (hit && p.length > bestLen) { best = name; bestLen = p.length; }
      });
    });
    return best;
  }

  function allowed(path) {
    if (!perms) return false;
    if (perms.exempt || hasFullCrmAccess()) return true;
    var mods = crmModules();
    if (!mods) {
      // Unlocked via sales role without a CRM portal row — allow default CRM routes.
      var roles = roleSet();
      return !!(roles['Sales Representative'] || roles['Sales Manager'] || roles['CRM Staff'] || roles['CRM Manager']);
    }
    var m = moduleOf(path);
    if (!m) return true;
    return levelOf(mods[m]) !== 'none';
  }

  function toast(text) {
    var now = Date.now();
    if (now - lastToastAt < 4000) return;
    lastToastAt = now;
    if (document.querySelector('.cg-toast')) return;
    var n = document.createElement('div');
    n.className = 'cg-toast';
    n.textContent = text;
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 5000);
  }

  function decorate() {
    if (!perms || root.classList.contains('crm-locked')) return;
    hrLink();
    document.querySelectorAll('.sidebar a[href]:not([data-cg-hr])').forEach(function (a) {
      var href = a.getAttribute('href') || '/';
      // Ignore external / hash-only links.
      if (/^https?:/i.test(href) || href.charAt(0) === '#') {
        a.style.display = '';
        return;
      }
      var hide = !allowed(href);
      a.style.display = hide ? 'none' : '';
    });
    var name = perms.full_name || perms.user || '';
    var user = document.querySelector('.topbar .user');
    if (user && name) {
      var strong = user.querySelector('strong');
      if (strong && strong.textContent !== name) strong.textContent = name;
      var av = user.querySelector('.avatar');
      var initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
      if (av && initials && av.textContent !== initials) av.textContent = initials;
      if (!document.querySelector('.cg-out')) {
        var out = document.createElement('button');
        out.type = 'button';
        out.className = 'cg-out';
        out.textContent = 'Sign out';
        out.addEventListener('click', signOut);
        user.parentNode.insertBefore(out, user.nextSibling);
      }
    }
    var path = normalizePath(location.pathname);
    if (!allowed(path)) {
      var mods = crmModules() || {};
      var first = Object.keys(mods).filter(function (m) { return levelOf(mods[m]) !== 'none'; })[0];
      var dest = (first && mods[first] && mods[first].paths && mods[first].paths[0]) || '/';
      dest = normalizePath(dest);
      if (path !== dest) {
        history.replaceState(null, '', dest);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      if (lastDeniedPath !== path) {
        lastDeniedPath = path;
        toast('You do not have access to that module. Ask HR to update your portal permissions.');
      }
    } else {
      lastDeniedPath = '';
    }
  }

  var hrOpen = false;

  function hrShow(open) {
    hrOpen = open;
    var app = document.querySelector('.app');
    var main = document.querySelector('.main');
    var link = document.querySelector('[data-cg-hr]');
    if (link) link.classList.toggle('active', open);
    if (app) app.classList.toggle('cg-hr-on', open);
    if (!main) return;
    main.classList.toggle('cg-hr-on', open);
    var panel = main.querySelector('.cg-hr');
    if (!open) { if (panel) panel.remove(); return; }
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'cg-hr';
      panel.innerHTML = '<iframe title="My HR Workspace" src="' + PEOPLE + '/people/profile?pa_embed=1" allow="geolocation *"></iframe>';
      main.appendChild(panel);
    }
    var sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.remove('open');
  }

  function hrLink() {
    var nav = document.querySelector('.sidebar nav');
    if (!nav || nav.querySelector('[data-cg-hr]')) return;
    var link = document.createElement('a');
    link.href = '#my-hr-workspace';
    link.className = 'nav-link';
    link.setAttribute('data-cg-hr', '1');
    link.innerHTML = USER_ICON + 'My HR Workspace';
    link.addEventListener('click', function (e) {
      e.preventDefault();
      hrShow(true);
    });
    var settings = nav.querySelector('a[href="/settings"]');
    if (settings) nav.insertBefore(link, settings);
    else nav.appendChild(link);
  }

  document.addEventListener('click', function (e) {
    if (!hrOpen || !e.target.closest) return;
    var a = e.target.closest('.sidebar a[href], .topbar a[href]');
    if (a && !a.hasAttribute('data-cg-hr')) hrShow(false);
  }, true);

  window.addEventListener('message', function (e) {
    if (e.origin !== PEOPLE || !e.data || e.data.type !== 'pa-embed-ready') return;
    var frame = document.querySelector('.cg-hr iframe');
    var s = saved();
    if (!frame || e.source !== frame.contentWindow || !s || !s.sid || !perms) return;
    frame.contentWindow.postMessage({
      type: 'pa-embed-session',
      session: { sid: s.sid, user: s.user || perms.user, fullName: perms.full_name || s.full_name, roles: perms.roles || s.roles || [] },
    }, PEOPLE);
  });

  function unlock() {
    var el = document.querySelector('.cg-wrap');
    if (el) el.remove();
    root.classList.remove('crm-locked');
    decorate();
  }

  function applyPerms(d, s) {
    perms = d || {};
    perms.full_name = perms.full_name || (s && s.full_name) || '';
    var mods = crmModules();
    var open = mods && Object.keys(mods).some(function (m) { return levelOf(mods[m]) !== 'none'; });
    var roles = roleSet();
    var salesOk = !!(roles['Sales Representative'] || roles['Sales Manager']);
    var crmOk = !!(roles['CRM Staff'] || roles['CRM Manager']);
    if (perms.exempt || open || salesOk || crmOk) unlock();
    else showDenied(perms.full_name);
  }

  function check(opts) {
    var silent = opts && opts.silent;
    var s = saved();
    if (!s || !s.sid) { if (!silent) showLogin(); return; }
    post('clinical_people_access.get_my_portal_permissions', { sid: s.sid }).then(function (d) {
      applyPerms(d, s);
    }).catch(function (ex) {
      if (silent) return;
      if (ex.status === 401 || ex.status === 403) {
        localStorage.removeItem(KEY);
        showLogin('Your session has ended. Please sign in again.');
      } else {
        screen('<h1>Smilecure CRM</h1><p class="cg-err">Could not reach the server. Check your connection and try again.</p><button type="button">Retry</button>')
          .querySelector('button').addEventListener('click', check);
      }
    });
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      if (!root.classList.contains('crm-locked')) check({ silent: true });
    }, 400);
  }

  function start() {
    check();
    new MutationObserver(function () { if (perms && !root.classList.contains('crm-locked')) decorate(); })
      .observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', function () { if (perms) setTimeout(decorate, 0); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') scheduleRefresh();
    });
    window.addEventListener('focus', scheduleRefresh);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
