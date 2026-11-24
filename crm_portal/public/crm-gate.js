/* Sign-in gate for the Smilecure CRM portal.
 * Uses HRMS logins and Portal Access → CRM Portal (or System Manager).
 */
(function () {
  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.';
  var KEY = 'crm_session';
  var META_KEY = 'crm_session_meta';
  var AUTH_CH = 'crm-auth-v1';
  var PEOPLE = 'https://people.e-remedium.in';
  var USER_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>';
  var root = document.documentElement;
  root.classList.add('crm-locked');

  /** Fallback paths if API omits module_paths (keep in sync with clinical_people_access.CRM_MODULE_PATHS). */
  var DEFAULT_CRM_PATHS = {
    Dashboard: ['/'],
    'Service Lead': ['/leads/service', '/leads/service/aesthetic', '/leads/service/care', '/leads/service/lab'],
    'Franchise Lead': ['/leads/franchise', '/leads/franchise/aesthetic', '/leads/franchise/care', '/leads/franchise/lab', '/leads/franchise/nexilab'],
    Contacts: ['/contacts'],
    Accounts: ['/accounts'],
    Deals: ['/deals'],
    'Service Followup': ['/activities/service', '/activities/service/aesthetic', '/activities/service/care', '/activities/service/lab'],
    'Franchise Followup': ['/activities/franchise', '/activities/franchise/aesthetic', '/activities/franchise/care', '/activities/franchise/lab', '/activities/franchise/nexilab'],
    'WhatsApp Centre': [
      '/whatsapp',
      '/whatsapp/all',
      '/whatsapp/all/all',
      '/whatsapp/franchise',
      '/whatsapp/service',
      /* legacy single-segment routes */
      '/whatsapp/aesthetic',
      '/whatsapp/care',
      '/whatsapp/lab',
      '/whatsapp/nexilab',
    ],
    Bookings: ['/bookings'],
    'Franchise (FFMS/RFMS)': ['/franchise'],
    'Partner Unit Bookings': ['/partner-bookings'],
    Campaigns: ['/campaigns'],
    'Reports & Analytics': ['/reports'],
    Settings: ['/settings'],
  };

  var style = document.createElement('style');
  style.textContent = [
    'html.crm-locked #root{display:none!important}',
    /* Match Care / Aesthetic portal login canvas */
    '.cg-wrap{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(circle at 20% 10%,#17a37a33,transparent 40%),linear-gradient(135deg,#0b3a3b,#0e5a52);font-family:"Plus Jakarta Sans","Segoe UI",sans-serif}',
    '.cg-card{width:min(410px,100%);background:#fff;border-radius:20px;padding:30px;box-shadow:0 30px 80px rgba(0,0,0,.25);display:grid;gap:12px}',
    '.cg-logo{display:block;background:#fff;border-radius:12px;padding:10px 12px;border:1px solid #e3ecee}',
    '.cg-logo img{display:block;width:100%;max-width:280px;height:auto;margin:0 auto}',
    '.cg-card h1{margin:10px 0 0;font-size:1.35rem;font-weight:800;color:#0b3a3b}',
    '.cg-card p{margin:0;color:#64748b;font-size:.9rem}',
    '.cg-card label{display:grid;gap:6px;font-size:.8rem;font-weight:700;color:#334155}',
    '.cg-card input{border:1px solid #cbd5e1;border-radius:10px;padding:11px 12px;font:inherit;font-weight:500}',
    '.cg-card button{border:0;border-radius:10px;padding:12px;background:#0e5a52;color:#fff;font:inherit;font-weight:800;cursor:pointer}',
    '.cg-card button:hover{background:#0b3a3b}',
    '.cg-card button:disabled{opacity:.6}',
    '.cg-card .cg-alt{background:#f2f6f7;color:#0b3a3b}',
    '.cg-err{color:#b91c1c!important;font-weight:600;min-height:1em}',
    '.cg-out{border:1px solid #d5e3e8;background:#fff;color:#0b3a3b;border-radius:10px;padding:7px 12px;font:inherit;font-weight:700;cursor:pointer;margin-left:8px}',
    '.main.cg-hr-on .content{display:none}',
    '.cg-hr{flex:1;min-height:0;display:flex;padding:0 0 0 4px}',
    '.cg-hr iframe{flex:1;width:100%;border:0;background:#f2f6f7;border-radius:14px 0 0 0}',
    '.cg-toast{position:fixed;z-index:10000;left:50%;bottom:24px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font:600 .88rem "Plus Jakarta Sans","Segoe UI",sans-serif}',
  ].join('\n');
  document.head.appendChild(style);

  function brandHtml() {
    return '<div class="cg-logo"><img src="/smilecure-logo.png?v=3" alt="Smilecure Lifestyle Private Limited"></div>';
  }

  function csrfToken() {
    try {
      var m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }

  function post(method, data) {
    var headers = {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Frappe-Site-Name': 'health.localhost',
    };
    var csrf = csrfToken();
    if (csrf) headers['X-Frappe-CSRF-Token'] = csrf;
    return fetch(API + method, {
      method: 'POST',
      credentials: 'include',
      headers: headers,
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

  function writeSession(s) {
    try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    try {
      localStorage.setItem(META_KEY, JSON.stringify({
        user: s.user,
        full_name: s.full_name,
        roles: s.roles || [],
        user_image: s.user_image || '',
      }));
      localStorage.removeItem(KEY);
    } catch (e) {}
    try {
      var bc = new BroadcastChannel(AUTH_CH);
      bc.postMessage({ type: 'crm-session-set', session: s });
      bc.close();
    } catch (e) {}
  }

  function saved() {
    try {
      var fromTab = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (fromTab && fromTab.sid) return fromTab;
    } catch (e) {}
    try {
      var legacy = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (legacy && legacy.sid) {
        writeSession(legacy);
        try { localStorage.removeItem(KEY); } catch (e2) {}
        return legacy;
      }
    } catch (e) {}
    return null;
  }

  try {
    var authBc = new BroadcastChannel(AUTH_CH);
    authBc.onmessage = function (ev) {
      var d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'crm-session-set' && d.session && d.session.sid) {
        try { sessionStorage.setItem(KEY, JSON.stringify(d.session)); } catch (e) {}
      }
      if (d.type === 'crm-session-clear') {
        try { sessionStorage.removeItem(KEY); } catch (e) {}
      }
      if (d.type === 'crm-session-request') {
        var mine = saved();
        if (mine && mine.sid) authBc.postMessage({ type: 'crm-session-set', session: mine });
      }
    };
    if (!saved()) authBc.postMessage({ type: 'crm-session-request' });
  } catch (e) {}

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
    /* True admins only — CRM Manager still respects selected mother modules. */
    if (!perms) return false;
    if (perms.exempt) return true;
    var roles = roleSet();
    return !!(roles['System Manager'] || roles['Administrator']);
  }

  function isCrmManager() {
    /* Manager = admin / Settings→Manage (crm_role from API). Module Manage stays Executive. */
    if (!perms) return false;
    if (perms.exempt) return true;
    if (perms.crm_role === 'Executive') return false;
    if (perms.crm_role === 'Manager') return true;
    var roles = roleSet();
    return !!(roles['System Manager'] || roles['Administrator']);
  }

  function publishPortalAccess() {
    var cats = (perms && perms.crm_categories) || null;
    var isMgr = isCrmManager();
    var ids = (cats && Array.isArray(cats.ids) ? cats.ids : []).filter(function (x) {
      return x === 'service' || x === 'franchise';
    });
    var all = !!(cats && cats.all) || (ids.indexOf('service') !== -1 && ids.indexOf('franchise') !== -1);
    if (!all && !ids.length) {
      /* Infer from enabled mother modules when HR has not ticked categories yet. */
      var mods = (perms.portal_modules && perms.portal_modules.crm) || {};
      var lvl = function (n) { return levelOf(mods[n]); };
      if (lvl('Service Lead') !== 'none' || lvl('Service Followup') !== 'none' || lvl('Bookings') !== 'none') ids.push('service');
      if (lvl('Franchise Lead') !== 'none' || lvl('Franchise Followup') !== 'none' || lvl('Franchise (FFMS/RFMS)') !== 'none' || lvl('Franchise') !== 'none') ids.push('franchise');
      /* Never invent both channels for executives — that leaks Franchise unread to Service staff. */
      if (!ids.length && isMgr) {
        all = true;
        ids = ['service', 'franchise'];
      }
      if (ids.indexOf('service') !== -1 && ids.indexOf('franchise') !== -1) all = true;
    }
    window.__crmPortalAccess = {
      isManager: isMgr,
      role: isMgr ? 'Manager' : 'Executive',
      categories: { all: all, ids: all ? ['service', 'franchise'] : ids },
    };
    try {
      window.dispatchEvent(new CustomEvent('crm-portal-access', { detail: window.__crmPortalAccess }));
    } catch (e) {}
  }

  function categoryAllowsPath(path) {
    var access = window.__crmPortalAccess;
    if (!access || access.categories.all) return true;
    var ids = access.categories.ids || [];
    path = normalizePath(path);
    var need = null;
    if (path.indexOf('/leads/service') === 0 || path.indexOf('/activities/service') === 0) need = 'service';
    else if (path.indexOf('/leads/franchise') === 0 || path.indexOf('/activities/franchise') === 0 || path === '/franchise' || path.indexOf('/franchise/') === 0 || path.indexOf('/partner-bookings') === 0) need = 'franchise';
    else if (path.indexOf('/bookings') === 0) need = 'service';
    else if (path.indexOf('/whatsapp/') === 0) {
      /* Routes: /whatsapp/:channel/:wing  (channel = franchise|service|all). Legacy: /whatsapp/:wing */
      var parts = path.split('/');
      var seg1 = parts[2] || 'all';
      var seg2 = parts[3] || '';
      var channel = null;
      if (seg1 === 'franchise' || seg1 === 'service' || seg1 === 'all') {
        channel = seg1;
      } else if (seg1 === 'nexilab') {
        channel = 'franchise';
      } else if (seg1 === 'aesthetic' || seg1 === 'care' || seg1 === 'lab') {
        /* Legacy brand tabs were Franchise Meta inbox. */
        channel = 'franchise';
      } else {
        channel = 'all';
      }
      if (channel === 'all') return ids.length > 0;
      need = channel;
      void seg2;
    }
    if (!need) return true;
    return ids.indexOf(need) !== -1;
  }

  function levelOf(entry) {
    if (entry == null) return 'none';
    if (typeof entry === 'string') return entry.toLowerCase();
    return String((entry && entry.level) || 'none').toLowerCase();
  }

  function pathsOf(name, entry) {
    var fromApi = entry && Array.isArray(entry.paths) ? entry.paths.filter(Boolean) : [];
    var fallback = DEFAULT_CRM_PATHS[name] || [];
    /* Mother modules must always cover every sidebar submodule path. */
    if (fallback.length) return fallback;
    return fromApi;
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
      brandHtml() +
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
        writeSession({ sid: d.sid, user: d.user, full_name: d.full_name, roles: d.roles || [] });
        check();
      }).catch(function (ex) {
        btn.disabled = false;
        err.textContent = ex.message || 'Sign in failed';
      });
    });
  }

  function showDenied(name) {
    var el = screen(
      brandHtml() +
      '<h1>No access</h1><p>' + esc(name || 'This login') + ' has not been given access to the CRM portal. ' +
      'Ask HR to add "CRM Portal" in Portal Access.</p><button type="button" class="cg-alt">Sign in as someone else</button>'
    );
    el.querySelector('button').addEventListener('click', signOut);
  }

  function clearCrmLocalData() {
    var keys = [
      KEY,
      META_KEY,
      'crm_leads_v1',
      'crm_contacts_v1',
      'crm_deals_v1',
      'crm_activities_v2',
      'crm_bookings_v1',
      'crm_team_v1',
      'crm_sheet_campaigns_v1',
      'crm_sync_logs_v1',
      'crm_mapping_templates_v1',
      'crm_settings_whatsapp_v1',
      'crm_settings_email_v1',
      'crm_settings_general_v1',
      'crm_settings_msg_tpl_v1',
      'crm_settings_email_tpl_v1',
      'crm_settings_docs_v1',
    ];
    keys.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
      try { sessionStorage.removeItem(k); } catch (e) {}
    });
    try {
      var doomed = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && /^crm_/i.test(k)) doomed.push(k);
      }
      doomed.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    try {
      /* Prevent demo campaigns from reappearing after logout wiped campaign storage. */
      localStorage.setItem('crm_sheet_campaigns_init_v1', '1');
    } catch (e) {}
    try {
      var bc = new BroadcastChannel(AUTH_CH);
      bc.postMessage({ type: 'crm-session-clear' });
      bc.close();
    } catch (e) {}
  }

  function signOut() {
    var s = saved();
    clearCrmLocalData();
    hrShow(false);
    perms = null;
    window.__crmUserImage = '';
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

  window.crmGate = {
    signOut: signOut,
    openHrWorkspace: function () { hrShow(true); },
    closeHrWorkspace: function () { hrShow(false); },
    getUserImage: function () {
      return photoUrl((perms && perms.user_image) || (saved() && saved().user_image) || window.__crmUserImage || '');
    },
  };

  function photoUrl(raw) {
    var src = String(raw || '').trim();
    if (!src) return '';
    // Never allow scriptable URL schemes in <img src>.
    if (/^(javascript|vbscript|data:text\/html)/i.test(src)) return '';
    // Broken gravatar placeholder — never use as avatar.
    if (/gravatar\.com/i.test(src) && /[?&]d=404\b/i.test(src)) return '';
    if (/^https?:\/\//i.test(src)) return src;
    if (/^data:image\//i.test(src)) return src;
    if (src.charAt(0) !== '/') src = '/' + src;
    // Encode path segments so spaces in file names work in <img src>.
    try {
      return src.split('/').map(function (part, i) {
        if (!part || i === 0) return part;
        return encodeURIComponent(decodeURIComponent(part));
      }).join('/');
    } catch (e) {
      return src;
    }
  }

  function persistPhoto(image) {
    try {
      var s = saved();
      if (!s || !s.sid) return;
      var src = photoUrl(image);
      window.__crmUserImage = src;
      if (s.user_image === src) {
        window.dispatchEvent(new CustomEvent('crm-session-updated', { detail: { user_image: src } }));
        return;
      }
      s.user_image = src;
      writeSession(s);
      window.dispatchEvent(new CustomEvent('crm-session-updated', { detail: { user_image: src } }));
    } catch (e) {}
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
    // Legacy HR rows used Leads / Activities / Franchise / Reports.
    function lift(from, toList) {
      var lvl = levelOf(out[from] || raw[from]);
      if (lvl === 'none') return;
      toList.forEach(function (name) {
        if (!out[name] || levelOf(out[name]) === 'none') {
          out[name] = { level: lvl, paths: DEFAULT_CRM_PATHS[name] || [] };
        }
      });
    }
    lift('Leads', ['Service Lead', 'Franchise Lead']);
    lift('Activities', ['Service Followup', 'Franchise Followup']);
    lift('Franchise', ['Franchise (FFMS/RFMS)']);
    lift('Partner Bookings', ['Partner Unit Bookings']);
    lift('Reports', ['Reports & Analytics']);
    // Ensure every known CRM mother module exists so new pages are gated consistently.
    Object.keys(DEFAULT_CRM_PATHS).forEach(function (name) {
      if (!out[name]) {
        out[name] = { level: hasFullCrmAccess() ? 'manage' : 'none', paths: DEFAULT_CRM_PATHS[name] };
      } else {
        out[name].paths = pathsOf(name, out[name]);
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
    if (!categoryAllowsPath(path)) return false;
    var mods = crmModules();
    if (!mods) return false;
    var m = moduleOf(path);
    if (!m) return false;
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
    var image = photoUrl(perms.user_image || (saved() && saved().user_image) || '');
    persistPhoto(image);
    var user = document.querySelector('.topbar .user');
    if (user && name) {
      var strong = user.querySelector('strong');
      if (strong && strong.textContent !== name) strong.textContent = name;
      /* Avatar is owned by React (Shell) — only sync via crm_session / crm-session-updated. */
      var legacyOut = document.querySelector('.cg-out');
      if (legacyOut) legacyOut.remove();
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
    /* Always rebuild the iframe so People receives the current CRM login (not a prior staff cookie). */
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.className = 'cg-hr';
    var s = saved();
    var q = 'pa_embed=1&tab=hr&_=' + Date.now();
    if (s && s.user) q += '&crm_user=' + encodeURIComponent(s.user);
    panel.innerHTML = '<iframe title="My HR Workspace" src="' + PEOPLE + '/people/profile?' + q + '" allow="geolocation *" referrerpolicy="strict-origin-when-cross-origin"></iframe>';
    main.appendChild(panel);
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
    /* People embed switches hec_web_session to this CRM login (same pattern as Care / Aesthetic). */
    frame.contentWindow.postMessage({
      type: 'pa-embed-session',
      session: {
        sid: s.sid,
        user: s.user || perms.user,
        fullName: perms.full_name || s.full_name,
        roles: perms.roles || s.roles || [],
      },
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
    perms.user_image = photoUrl(perms.user_image || (s && s.user_image) || '');
    persistPhoto(perms.user_image);
    publishPortalAccess();
    var mods = crmModules();
    var open = mods && Object.keys(mods).some(function (m) { return levelOf(mods[m]) !== 'none'; });
    var roles = roleSet();
    var crmOk = !!(roles['CRM Executive'] || roles['CRM Staff'] || roles['CRM Manager'] || roles['System Manager'] || roles['Administrator']);
    /* Require CRM role or at least one CRM Portal Access module — no bare Sales Rep bypass. */
    if (perms.exempt || open || crmOk) unlock();
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
        clearCrmLocalData();
        showLogin('Your session has ended. Please sign in again.');
      } else {
        screen(brandHtml() + '<h1>Smilecure CRM</h1><p class="cg-err">Could not reach the server. Check your connection and try again.</p><button type="button">Retry</button>')
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
