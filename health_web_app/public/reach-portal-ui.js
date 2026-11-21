/* Reach Portal UI — shell chrome + home dashboard synced across modules. */
(function () {
  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.api.';
  var NOTIFY_API = '/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_announce.';
  var PEOPLE = 'https://people.e-remedium.in';
  var DASH_ATTR = 'data-rpu-dash';
  var HR_ATTR = 'data-rpu-hr';
  var SHELL_ATTR = 'data-rpu-shell';
  var st = {
    busy: false,
    message: '',
    tone: '',
    dateFrom: '',
    dateTo: '',
    portal: null,
    activity: null,
    closings: null,
    commissions: null,
  };
  var chrome = {
    open: '',
    notif: { unread: 0, items: [], loaded: false, loading: false },
  };

  function onReach() {
    return !!(document.querySelector('.sales-layout') || /\/sales(\/|$)/.test(location.pathname || ''));
  }

  function isPortalHome() {
    var p = location.pathname || '';
    return p === '/sales' || p === '/sales/' || p === '/sales/index.html';
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function monthStartIso() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  }

  function fmtMoney(n) {
    var v = Number(n) || 0;
    try {
      return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    } catch (e) {
      return '₹' + Math.round(v);
    }
  }

  function initials(name) {
    var parts = String(name || 'U')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function call(method, data) {
    var body = new URLSearchParams(data || {});
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      if (s && s.sid) body.set('sid', s.sid);
    } catch (e) {}
    return fetch(API + method, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Frappe-Site-Name': 'health.localhost',
      },
      body: body,
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (json) {
        var m = json && json.message && typeof json.message === 'object' ? json.message : json;
        if (!m || m.status === 'error') {
          throw new Error(String((m && m.message) || 'Request failed').replace(/<[^>]+>/g, ''));
        }
        return m.data !== undefined ? m.data : m;
      });
  }

  function hasVal(v) {
    return String(v == null ? '' : v).trim() !== '';
  }

  function visitCompletion(r) {
    var fields = [
      hasVal(r.purpose),
      hasVal(r.outcome),
      hasVal(r.visit_status),
      hasVal(r.lead),
      Number(r.duration_minutes) > 0,
      isFinite(Number(r.latitude)) && isFinite(Number(r.longitude)),
      hasVal(r.notes),
      hasVal(r.photo),
    ];
    var filled = fields.filter(Boolean).length;
    return Math.round((filled / fields.length) * 100);
  }

  function purposeClass(p) {
    var s = String(p || '').toLowerCase();
    if (s.indexOf('follow') >= 0) return 'purple';
    if (s.indexOf('meet') >= 0 || s.indexOf('lead') >= 0) return 'blue';
    return 'gray';
  }

  function outcomeClass(o) {
    var s = String(o || '').toLowerCase();
    if (s.indexOf('positive') >= 0) return 'green';
    if (s.indexOf('neutral') >= 0 || s.indexOf('pending') >= 0) return 'amber';
    return hasVal(o) ? 'green' : 'gray';
  }

  function ensureShell() {
    var layout = document.querySelector('.sales-layout');
    if (!layout) return;
    layout.classList.add('reach-shell', 'rpu-page-sync');

    var header = layout.querySelector('.b2b-header');
    if (!header) return;

    var nav = header.querySelector('.b2b-nav');
    if (nav) rewriteHrNav(nav);

    // Rebuild to mockup: row1 = brand | search | tools, row2 = nav
    if (header.getAttribute(SHELL_ATTR) === '3' && header.querySelector('.rpu-topbar [data-rpu-search-wrap]')) {
      wireTopChrome(header.querySelector('.rpu-topbar'));
      return;
    }

    var oldBroken = header.querySelector('[data-rpu-tools], .rpu-top-tools, .rpu-topbar');
    if (oldBroken) oldBroken.remove();
    header.removeAttribute(SHELL_ATTR);
    closeChromePanels();

    var leading = header.querySelector('.b2b-header-leading');
    var brand = header.querySelector('.brand');
    if (!brand && leading) {
      brand = document.createElement('a');
      brand.className = 'brand';
      brand.href = '/sales';
      leading.appendChild(brand);
    }
    if (brand) {
      brand.textContent = 'Reach Portal';
      brand.classList.add('brand');
      if (!brand.getAttribute('href')) brand.setAttribute('href', '/sales');
    }

    var name = '';
    var title = 'Field Sales';
    try {
      var sess = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      name = (sess && (sess.full_name || sess.user)) || '';
    } catch (e) {}
    if (st.portal && st.portal.rep) {
      name = st.portal.rep.full_name || name;
      title = st.portal.rep.designation || title;
    }

    var topbar = document.createElement('div');
    topbar.className = 'rpu-topbar';
    topbar.setAttribute('data-rpu-tools', '1');

    var brandClone = brand ? brand.cloneNode(true) : null;
    if (brandClone) {
      brandClone.textContent = 'Reach Portal';
      brandClone.href = '/sales';
      topbar.appendChild(brandClone);
    } else {
      var b = document.createElement('a');
      b.className = 'brand';
      b.href = '/sales';
      b.textContent = 'Reach Portal';
      topbar.appendChild(b);
    }

    var searchWrap = document.createElement('div');
    searchWrap.className = 'rpu-search';
    searchWrap.setAttribute('data-rpu-search-wrap', '1');
    searchWrap.innerHTML =
      '<span aria-hidden="true">⌕</span>' +
      '<input type="search" placeholder="Search by Employee, Lead…" data-rpu-search autocomplete="off" />' +
      '<kbd>Ctrl K</kbd>' +
      '<div class="rpu-search-results" data-rpu-search-results hidden></div>';
    topbar.appendChild(searchWrap);

    var right = document.createElement('div');
    right.className = 'rpu-top-right';
    right.innerHTML =
      '<select class="rpu-chip" data-rpu-territory><option>All Territories</option></select>' +
      '<button type="button" class="rpu-bell" data-count="0" aria-label="Notifications" aria-haspopup="dialog">🔔</button>' +
      '<button type="button" class="rpu-profile" aria-haspopup="menu" aria-expanded="false"><div class="rpu-avatar">' +
      esc(initials(name || 'SG')) +
      '</div><span><strong>' +
      esc(name || 'Reach User') +
      '</strong><small>' +
      esc(title) +
      '</small></span></button>';
    topbar.appendChild(right);

    // Insert topbar as first child; keep nav as second
    header.insertBefore(topbar, header.firstChild);
    if (leading) leading.style.display = 'none';
    if (nav && nav.parentNode === header) {
      header.appendChild(nav);
    }
    header.setAttribute(SHELL_ATTR, '3');

    bindSearch(searchWrap);
    wireTopChrome(topbar);
  }

  function placePanel(panel, anchor) {
    var r = anchor.getBoundingClientRect();
    var width = panel.offsetWidth || 300;
    var left = Math.min(window.innerWidth - width - 12, Math.max(12, r.right - width));
    panel.style.top = Math.round(r.bottom + 8) + 'px';
    panel.style.left = Math.round(left) + 'px';
  }

  function closeChromePanels() {
    chrome.open = '';
    document.querySelectorAll('[data-rpu-pop]').forEach(function (n) {
      n.remove();
    });
    var bell = document.querySelector('.rpu-bell');
    var pill = document.querySelector('.rpu-profile');
    if (bell) bell.setAttribute('aria-expanded', 'false');
    if (pill) pill.setAttribute('aria-expanded', 'false');
  }

  function goSales(path) {
    closeChromePanels();
    var next = path || '/sales';
    if (location.pathname !== next) {
      history.pushState({}, '', next);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    if (next.indexOf('/sales/my-hr') === 0 || next === '/sales/profile') {
      ensureHrWorkspace();
      rewriteHrNav(document.querySelector('.sales-layout .b2b-nav'));
    }
  }

  function callNotify(method, data) {
    var body = new URLSearchParams();
    Object.keys(data || {}).forEach(function (k) {
      var v = data[k];
      body.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    });
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      if (s && s.sid) body.set('sid', s.sid);
    } catch (e) {}
    return fetch(NOTIFY_API + method, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Frappe-Site-Name': 'health.localhost',
      },
      body: body,
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (json) {
        var m = json && json.message && typeof json.message === 'object' ? json.message : json;
        if (!m || m.status === 'error') {
          throw new Error(String((m && m.message) || 'Request failed').replace(/<[^>]+>/g, ''));
        }
        return m.data !== undefined ? m.data : m;
      });
  }

  function paintBellBadge() {
    var bell = document.querySelector('.rpu-bell');
    if (!bell) return;
    var n = chrome.notif.loaded ? chrome.notif.unread || 0 : 0;
    var text = n > 99 ? '99+' : String(n);
    bell.setAttribute('data-count', n ? text : '');
    bell.classList.toggle('is-empty', !n);
    bell.setAttribute('aria-label', n ? 'Notifications (' + n + ' unread)' : 'Notifications');
  }

  function loadNotifications(force) {
    if (chrome.notif.loading) return;
    if (chrome.notif.loaded && !force) {
      paintBellBadge();
      return;
    }
    var sid = '';
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      sid = (s && s.sid) || '';
    } catch (e) {}
    if (!sid) {
      chrome.notif = { unread: 0, items: [], loaded: true, loading: false };
      paintBellBadge();
      return;
    }
    chrome.notif.loading = true;
    callNotify('get_my_notifications')
      .then(function (d) {
        chrome.notif.unread = (d && d.unread) || 0;
        chrome.notif.items = (d && d.items) || [];
        chrome.notif.loaded = true;
      })
      .catch(function () {
        chrome.notif.unread = 0;
        chrome.notif.items = [];
        chrome.notif.loaded = true;
      })
      .finally(function () {
        chrome.notif.loading = false;
        paintBellBadge();
        if (chrome.open === 'notify') paintNotifyPanel();
      });
  }

  function paintNotifyPanel() {
    var bell = document.querySelector('.rpu-bell');
    if (!bell || chrome.open !== 'notify') return;
    var existing = document.querySelector('[data-rpu-pop="notify"]');
    if (existing) existing.remove();

    var panel = document.createElement('div');
    panel.className = 'rpu-pop rpu-pop-notify';
    panel.setAttribute('data-rpu-pop', 'notify');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Notifications');

    var head =
      '<div class="rpu-pop-head"><strong>Notifications</strong>' +
      (chrome.notif.unread
        ? '<button type="button" class="rpu-pop-link" data-rpu-mark-all>Mark all read</button>'
        : '') +
      '</div>';

    var body = '';
    if (!chrome.notif.loaded || chrome.notif.loading) {
      body = '<p class="rpu-pop-empty">Loading…</p>';
    } else if (!chrome.notif.items.length) {
      body = '<p class="rpu-pop-empty">You are all caught up.</p>';
    } else {
      body =
        '<ul class="rpu-pop-list">' +
        chrome.notif.items
          .map(function (n) {
            return (
              '<li class="' +
              (n.read ? '' : 'is-unread') +
              '">' +
              '<button type="button" data-rpu-notif="' +
              esc(n.id) +
              '" data-ref="' +
              esc(n.ref || '') +
              '">' +
              '<span class="rpu-pop-dot"></span>' +
              '<span><b>' +
              esc(n.title || 'Update') +
              '</b>' +
              (n.message ? '<small>' + esc(n.message) + '</small>' : '') +
              '</span></button></li>'
            );
          })
          .join('') +
        '</ul>';
    }

    panel.innerHTML =
      head +
      body +
      '<div class="rpu-pop-foot"><button type="button" class="rpu-pop-link" data-rpu-view-all>View announcements</button></div>';

    panel.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (ev.target.closest('[data-rpu-mark-all]')) {
        callNotify('mark_notifications_read', { all: '1' }).finally(function () {
          loadNotifications(true);
        });
        chrome.notif.items.forEach(function (n) {
          n.read = true;
        });
        chrome.notif.unread = 0;
        paintBellBadge();
        paintNotifyPanel();
        return;
      }
      if (ev.target.closest('[data-rpu-view-all]')) {
        goSales('/sales/my-hr');
        return;
      }
      var item = ev.target.closest('[data-rpu-notif]');
      if (item) {
        var id = item.getAttribute('data-rpu-notif');
        callNotify('mark_notifications_read', { ids: [id] }).finally(function () {
          loadNotifications(true);
        });
        goSales('/sales/my-hr');
      }
    });

    document.body.appendChild(panel);
    placePanel(panel, bell);
  }

  function paintProfilePanel() {
    var pill = document.querySelector('.rpu-profile');
    if (!pill || chrome.open !== 'profile') return;
    var existing = document.querySelector('[data-rpu-pop="profile"]');
    if (existing) existing.remove();

    var name = '';
    var title = '';
    var email = '';
    try {
      var sess = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      name = (sess && (sess.full_name || sess.user)) || '';
      email = (sess && sess.user) || '';
    } catch (e) {}
    if (st.portal && st.portal.rep) {
      name = st.portal.rep.full_name || name;
      title = st.portal.rep.designation || title;
    }
    var strong = pill.querySelector('strong');
    var small = pill.querySelector('small');
    if (!name && strong) name = strong.textContent || '';
    if (!title && small) title = small.textContent || '';

    var panel = document.createElement('div');
    panel.className = 'rpu-pop rpu-pop-profile';
    panel.setAttribute('data-rpu-pop', 'profile');
    panel.setAttribute('role', 'menu');
    panel.innerHTML =
      '<div class="rpu-pop-who"><strong>' +
      esc(name || 'Signed in') +
      '</strong>' +
      (title ? '<small>' + esc(title) + '</small>' : '') +
      (email && /@/.test(email) ? '<small class="rpu-pop-mail">' + esc(email) + '</small>' : '') +
      '</div>' +
      '<button type="button" class="rpu-pop-item" role="menuitem" data-rpu-menu="profile">My Profile</button>' +
      '<button type="button" class="rpu-pop-item" role="menuitem" data-rpu-menu="hr">My HR Profile</button>' +
      '<hr class="rpu-pop-sep" />' +
      '<button type="button" class="rpu-pop-item is-danger" role="menuitem" data-rpu-menu="logout">Logout</button>';

    panel.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var btn = ev.target.closest('[data-rpu-menu]');
      if (!btn) return;
      var action = btn.getAttribute('data-rpu-menu');
      if (action === 'profile' || action === 'hr') {
        goSales('/sales/my-hr');
        return;
      }
      if (action === 'logout') {
        closeChromePanels();
        var out = Array.prototype.slice
          .call(document.querySelectorAll('.sales-layout button, .b2b-nav button, .mobile-nav button'))
          .filter(function (b) {
            return /logout/i.test(b.textContent || '');
          })[0];
        if (out) out.click();
        else {
          try {
            localStorage.removeItem('hec_web_session');
          } catch (err) {}
          location.assign('/login');
        }
      }
    });

    document.body.appendChild(panel);
    placePanel(panel, pill);
  }

  function toggleChrome(which) {
    chrome.open = chrome.open === which ? '' : which;
    document.querySelectorAll('[data-rpu-pop]').forEach(function (n) {
      n.remove();
    });
    var bell = document.querySelector('.rpu-bell');
    var pill = document.querySelector('.rpu-profile');
    if (bell) bell.setAttribute('aria-expanded', chrome.open === 'notify' ? 'true' : 'false');
    if (pill) pill.setAttribute('aria-expanded', chrome.open === 'profile' ? 'true' : 'false');
    if (chrome.open === 'notify') {
      paintNotifyPanel();
      loadNotifications(true);
    } else if (chrome.open === 'profile') {
      paintProfilePanel();
    }
  }

  function wireTopChrome(topbar) {
    if (!topbar) return;
    var bell = topbar.querySelector('.rpu-bell');
    var pill = topbar.querySelector('.rpu-profile');

    if (bell && !bell.getAttribute('data-rpu-bound')) {
      bell.setAttribute('data-rpu-bound', '1');
      bell.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        toggleChrome('notify');
      });
    }

    if (pill && !pill.getAttribute('data-rpu-bound')) {
      pill.setAttribute('data-rpu-bound', '1');
      if (pill.tagName !== 'BUTTON') {
        pill.setAttribute('role', 'button');
        pill.setAttribute('tabindex', '0');
      }
      pill.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        toggleChrome('profile');
      });
      pill.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          toggleChrome('profile');
        }
      });
    }

    paintBellBadge();
    if (!chrome.notif.loaded && !chrome.notif.loading) loadNotifications(false);
  }

  if (!window.__rpuChromeDoc) {
    window.__rpuChromeDoc = true;
    document.addEventListener('click', function (ev) {
      if (!chrome.open) return;
      if (ev.target.closest && (ev.target.closest('[data-rpu-pop]') || ev.target.closest('.rpu-bell') || ev.target.closest('.rpu-profile'))) {
        return;
      }
      closeChromePanels();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeChromePanels();
    });
    window.addEventListener('resize', function () {
      if (!chrome.open) return;
      var panel = document.querySelector('[data-rpu-pop]');
      var anchor = chrome.open === 'notify' ? document.querySelector('.rpu-bell') : document.querySelector('.rpu-profile');
      if (panel && anchor) placePanel(panel, anchor);
    });
    window.addEventListener('popstate', closeChromePanels);
  }

  var searchTimer = null;
  var searchCache = null;

  function bindSearch(wrap) {
    var search = wrap.querySelector('[data-rpu-search]');
    var results = wrap.querySelector('[data-rpu-search-results]');
    if (!search || !results || search.getAttribute('data-rpu-bound')) return;
    search.setAttribute('data-rpu-bound', '1');

    function hideResults() {
      results.hidden = true;
      results.innerHTML = '';
    }

    function showResults(items, q) {
      if (!items.length) {
        results.innerHTML = '<div class="rpu-search-empty">No matches for “' + esc(q) + '”</div>';
        results.hidden = false;
        return;
      }
      results.innerHTML = items
        .map(function (item) {
          return (
            '<button type="button" class="rpu-search-item" data-rpu-goto="' +
            esc(item.href) +
            '"><strong>' +
            esc(item.title) +
            '</strong><small>' +
            esc(item.meta) +
            '</small></button>'
          );
        })
        .join('');
      results.hidden = false;
    }

    function collectMatches(q) {
      var needle = String(q || '').trim().toLowerCase();
      if (needle.length < 2) {
        hideResults();
        return;
      }
      results.innerHTML = '<div class="rpu-search-empty">Searching…</div>';
      results.hidden = false;

      var load = searchCache
        ? Promise.resolve(searchCache)
        : Promise.all([
            call('get_sales_leads', { limit: 200 }).catch(function () {
              return { leads: [] };
            }),
            call('get_sales_team_portal_activity', { limit: 2000 }).catch(function () {
              return { visits: [], by_employee: [] };
            }),
          ]).then(function (rows) {
            searchCache = {
              leads: (rows[0] && rows[0].leads) || [],
              visits: (rows[1] && rows[1].visits) || [],
              employees: (rows[1] && rows[1].by_employee) || [],
            };
            return searchCache;
          });

      load
        .then(function (data) {
          var items = [];
          var seen = {};
          (data.employees || []).forEach(function (e) {
            var title = e.full_name || e.rep_code || '';
            var blob = (title + ' ' + (e.rep_code || '')).toLowerCase();
            if (!title || blob.indexOf(needle) < 0) return;
            var key = 'emp:' + (e.sales_rep || title);
            if (seen[key]) return;
            seen[key] = 1;
            items.push({
              title: title,
              meta: 'Employee · ' + (e.rep_code || 'REP') + ' · ' + (e.visits_count || 0) + ' visits',
              href: '/sales/map',
            });
          });
          (data.leads || []).forEach(function (l) {
            var title = l.lead_name || l.company_name || l.name || '';
            var blob = (title + ' ' + (l.phone || '') + ' ' + (l.city || '') + ' ' + (l.company_name || '')).toLowerCase();
            if (!title || blob.indexOf(needle) < 0) return;
            var key = 'lead:' + (l.name || title);
            if (seen[key]) return;
            seen[key] = 1;
            items.push({
              title: title,
              meta: 'Lead · ' + (l.status || 'Open') + (l.city ? ' · ' + l.city : '') + (l.phone ? ' · ' + l.phone : ''),
              href: '/sales/leads',
            });
          });
          (data.visits || []).forEach(function (v) {
            var title = v.lead_name || v.lead || v.purpose || '';
            var blob = (title + ' ' + (v.full_name || '') + ' ' + (v.purpose || '')).toLowerCase();
            if (!title || blob.indexOf(needle) < 0) return;
            var key = 'visit:' + (v.name || title + v.full_name);
            if (seen[key]) return;
            seen[key] = 1;
            items.push({
              title: title,
              meta: 'Visit · ' + (v.full_name || 'REP') + (v.purpose ? ' · ' + v.purpose : ''),
              href: '/sales/visit',
            });
          });
          showResults(items.slice(0, 12), q);
        })
        .catch(function () {
          results.innerHTML = '<div class="rpu-search-empty">Search failed. Try again.</div>';
          results.hidden = false;
        });
    }

    search.addEventListener('input', function () {
      var q = String(search.value || '').trim();
      clearTimeout(searchTimer);
      if (q.length < 2) {
        hideResults();
        return;
      }
      searchTimer = setTimeout(function () {
        collectMatches(q);
      }, 220);
    });

    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        hideResults();
        search.blur();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        var first = results.querySelector('[data-rpu-goto]');
        var q = String(search.value || '').trim();
        if (first) {
          location.href = first.getAttribute('data-rpu-goto') || '/sales/leads';
        } else if (q) {
          location.href = '/sales/leads';
        }
      }
    });

    results.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-rpu-goto]') : null;
      if (!btn) return;
      location.href = btn.getAttribute('data-rpu-goto') || '/sales/leads';
    });

    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      if (!e.target.closest('[data-rpu-search-wrap]')) hideResults();
    });

    if (!window.__rpuCtrlK) {
      window.__rpuCtrlK = 1;
      document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
          e.preventDefault();
          var inp = document.querySelector('[data-rpu-search]');
          if (inp) {
            inp.focus();
            inp.select();
          }
        }
      });
    }
  }

  function refreshShellProfile() {
    var tools = document.querySelector('[data-rpu-tools]');
    if (!tools || !st.portal || !st.portal.rep) return;
    var name = st.portal.rep.full_name || '';
    var title = st.portal.rep.designation || 'Field Sales';
    var av = tools.querySelector('.rpu-avatar');
    var strong = tools.querySelector('.rpu-profile strong');
    var small = tools.querySelector('.rpu-profile small');
    if (av) av.textContent = initials(name);
    if (strong) strong.textContent = name;
    if (small) small.textContent = title;
    var terr = tools.querySelector('[data-rpu-territory]');
    if (terr && terr.options.length <= 1 && st.portal.rep.territory_region) {
      var opt = document.createElement('option');
      opt.textContent = st.portal.rep.territory_region;
      terr.appendChild(opt);
    }
  }

  function computeDash() {
    var visits = (st.activity && st.activity.visits) || [];
    var leads = (st.activity && st.activity.leads) || [];
    var onboardings = (st.activity && st.activity.onboardings) || [];
    var portalStats = (st.portal && st.portal.stats) || {};
    var purposeMap = {};
    var outcomeMap = { Positive: 0, Neutral: 0, Negative: 0, Pending: 0 };
    var durationSum = 0;
    var durationCount = 0;
    var completionSum = 0;
    var terrMap = {};
    var empMap = {};

    visits.forEach(function (r) {
      var p = String(r.purpose || 'Others').trim() || 'Others';
      purposeMap[p] = (purposeMap[p] || 0) + 1;
      var o = String(r.outcome || '').trim();
      if (!o) outcomeMap.Pending += 1;
      else if (/positive/i.test(o)) outcomeMap.Positive += 1;
      else if (/neutral/i.test(o)) outcomeMap.Neutral += 1;
      else if (/negative|lost/i.test(o)) outcomeMap.Negative += 1;
      else outcomeMap.Pending += 1;
      if (Number(r.duration_minutes) > 0) {
        durationSum += Number(r.duration_minutes);
        durationCount += 1;
      }
      var pct = visitCompletion(r);
      completionSum += pct;
      var terr = String(r.city || r.district || r.territory || 'Other').trim() || 'Other';
      if (!terrMap[terr]) terrMap[terr] = { visits: 0, leads: 0, qualified: 0, closings: 0 };
      terrMap[terr].visits += 1;
      var key = r.sales_rep || r.full_name || 'unknown';
      if (!empMap[key]) {
        empMap[key] = { name: r.full_name || r.rep_code || 'Employee', visits: 0, completion: 0 };
      }
      empMap[key].visits += 1;
      empMap[key].completion += pct;
    });

    leads.forEach(function (r) {
      var terr = String(r.city || r.district || 'Other').trim() || 'Other';
      if (!terrMap[terr]) terrMap[terr] = { visits: 0, leads: 0, qualified: 0, closings: 0 };
      terrMap[terr].leads += 1;
      if (/qualified|won|interested/i.test(String(r.status || ''))) terrMap[terr].qualified += 1;
      if (/won/i.test(String(r.status || ''))) terrMap[terr].closings += 1;
    });

    var purposeEntries = Object.keys(purposeMap)
      .map(function (k) {
        return { name: k, count: purposeMap[k] };
      })
      .sort(function (a, b) {
        return b.count - a.count;
      });
    var purposeTop = purposeEntries.slice(0, 4);
    var purposeOther = purposeEntries.slice(4).reduce(function (s, x) {
      return s + x.count;
    }, 0);
    if (purposeOther) purposeTop.push({ name: 'Others', count: purposeOther });
    var purposeTotal = visits.length || 1;
    var purposePcts = purposeTop.map(function (x) {
      return { name: x.name, pct: Math.round((x.count / purposeTotal) * 100), count: x.count };
    });
    while (purposePcts.length < 5) purposePcts.push({ name: '—', pct: 0, count: 0 });

    var outcomeTotal = visits.length || 1;
    var outcomes = [
      { name: 'Positive', pct: Math.round((outcomeMap.Positive / outcomeTotal) * 100), cls: 'pos' },
      { name: 'Neutral', pct: Math.round((outcomeMap.Neutral / outcomeTotal) * 100), cls: 'neu' },
      { name: 'Negative', pct: Math.round((outcomeMap.Negative / outcomeTotal) * 100), cls: 'neg' },
      { name: 'Pending', pct: Math.round((outcomeMap.Pending / outcomeTotal) * 100), cls: 'pen' },
    ];

    var closings = ((st.closings && st.closings.reports) || []).length;
    var commission =
      (st.portal && st.portal.stats && (st.portal.stats.month_commission || st.portal.stats.accrued_commission)) ||
      (st.commissions && (st.commissions.month_accrued || st.commissions.accrued_total)) ||
      0;

    var franchiseLeads = leads.filter(function (r) {
      return !/b2b/i.test(String(r.lead_source || r.platform || ''));
    }).length;
    var b2bLeads = leads.length - franchiseLeads;
    if (b2bLeads < 0) b2bLeads = 0;

    var completed = visits.filter(function (r) {
      return /complete/i.test(String(r.visit_status || ''));
    }).length;
    var planned = Math.max(visits.length, Math.round(visits.length * 1.15));
    var positive = outcomeMap.Positive;
    var dataCompletion = visits.length ? Math.round(completionSum / visits.length) : 0;

    var performers = Object.keys(empMap)
      .map(function (k) {
        var e = empMap[k];
        return {
          name: e.name,
          visits: e.visits,
          completion: e.visits ? Math.round(e.completion / e.visits) : 0,
        };
      })
      .sort(function (a, b) {
        return b.completion - a.completion || b.visits - a.visits;
      })
      .slice(0, 5);

    var territories = Object.keys(terrMap)
      .map(function (k) {
        return Object.assign({ name: k }, terrMap[k]);
      })
      .sort(function (a, b) {
        return b.visits - a.visits;
      })
      .slice(0, 6);

    var recent = visits
      .slice()
      .sort(function (a, b) {
        return String(b.creation || b.visit_date || '').localeCompare(String(a.creation || a.visit_date || ''));
      })
      .slice(0, 6);

    return {
      kpis: {
        totalLeads: leads.length || portalStats.open_leads || 0,
        totalVisits: visits.length || portalStats.visits_today || 0,
        dataCompletion: dataCompletion,
        franchiseLeads: franchiseLeads || leads.length,
        b2bLeads: b2bLeads,
        closings: closings,
        commission: commission,
      },
      funnel: {
        planned: planned,
        completed: completed || visits.length,
        positive: positive,
        closings: closings,
        visitCompletion: visits.length ? Math.round((completed / visits.length) * 1000) / 10 : 0,
        avgDuration: durationCount ? Math.round(durationSum / durationCount) : 0,
        leadConversion: leads.length ? Math.round((positive / leads.length) * 1000) / 10 : 0,
      },
      purposePcts: purposePcts,
      outcomes: outcomes,
      recent: recent,
      performers: performers,
      territories: territories,
      onboardings: onboardings.length,
      openLeads: portalStats.open_leads || 0,
    };
  }

  function renderDashboard() {
    var main = document.querySelector('.sales-layout .b2b-main, .sales-layout main');
    if (!main) return;
    main.classList.add('rpu-hide-native');
    var mount = main.querySelector('[' + DASH_ATTR + ']');
    if (!mount) {
      mount = document.createElement('div');
      mount.setAttribute(DASH_ATTR, '1');
      mount.className = 'rpu-dash';
      main.appendChild(mount);
    }

    if (!st.dateFrom) st.dateFrom = monthStartIso();
    if (!st.dateTo) st.dateTo = todayIso();

    if (!st.activity && !st.portal) {
      mount.innerHTML = '<p class="muted">Loading Reach Portal Dashboard…</p>';
      return;
    }

    var d = computeDash();
    var p = d.purposePcts;
    var funnelMax = Math.max(d.funnel.planned, 1);
    var funnelRows = [
      ['Planned Visits', d.funnel.planned, 100],
      ['Completed', d.funnel.completed, 88],
      ['Positive', d.funnel.positive, 72],
      ['Closing', d.funnel.closings, 56],
    ]
      .map(function (row) {
        var share = Math.max(40, Math.round((row[1] / funnelMax) * 100));
        var w = Math.min(100, Math.max(share, row[2] - 8));
        return (
          '<div class="rpu-funnel-step" style="--w:' +
          w +
          '%"><span>' +
          esc(row[0]) +
          '</span><b>' +
          esc(row[1]) +
          '</b></div>'
        );
      })
      .join('');

    var purposeLegend = p
      .map(function (x, i) {
        var colors = ['#0b6b57', '#1d6fd8', '#6d4ec9', '#b7791f', '#94a3b8'];
        return (
          '<div><i style="background:' +
          colors[i] +
          '"></i>' +
          esc(x.name) +
          ' · ' +
          esc(x.pct) +
          '%</div>'
        );
      })
      .join('');

    var outcomeBars = d.outcomes
      .map(function (o) {
        return (
          '<div class="rpu-bar-row"><span>' +
          esc(o.name) +
          '</span><div class="rpu-bar-track"><div class="rpu-bar-fill ' +
          o.cls +
          '" style="width:' +
          esc(o.pct) +
          '%"></div></div><b>' +
          esc(o.pct) +
          '%</b></div>'
        );
      })
      .join('');

    var recentRows = d.recent.length
      ? d.recent
          .map(function (r, i) {
            var day = String(r.visit_date || r.activity_date || r.creation || '').slice(0, 16);
            return (
              '<tr><td>' +
              (i + 1) +
              '</td><td>' +
              esc(day) +
              '</td><td><div class="rpu-emp"><div class="rpu-avatar">' +
              esc(initials(r.full_name)) +
              '</div><strong>' +
              esc(r.full_name || 'Employee') +
              '</strong></div></td><td>' +
              (hasVal(r.purpose)
                ? '<span class="rpu-tag ' + purposeClass(r.purpose) + '">' + esc(r.purpose) + '</span>'
                : '—') +
              '</td><td>' +
              (hasVal(r.outcome)
                ? '<span class="rpu-tag ' + outcomeClass(r.outcome) + '">' + esc(r.outcome) + '</span>'
                : '—') +
              '</td><td>' +
              (Number(r.duration_minutes) > 0 ? esc(r.duration_minutes) + ' min' : '—') +
              '</td></tr>'
            );
          })
          .join('')
      : '<tr><td colspan="6" style="color:#5f746f;text-align:center;padding:20px">No visits in this period.</td></tr>';

    var rankRows = d.performers.length
      ? d.performers
          .map(function (e, i) {
            return (
              '<div class="rpu-rank-row"><b>' +
              (i + 1) +
              '</b><div><strong>' +
              esc(e.name) +
              '</strong><div class="rpu-bar-track" style="margin-top:4px"><div class="rpu-bar-fill pos" style="width:' +
              esc(e.completion) +
              '%"></div></div></div><span>' +
              esc(e.completion) +
              '%</span></div>'
            );
          })
          .join('')
      : '<div style="color:#5f746f;font-size:13px">No performer data yet.</div>';

    var terrRows = d.territories.length
      ? d.territories
          .map(function (t) {
            return (
              '<tr><td><strong>' +
              esc(t.name) +
              '</strong></td><td>' +
              esc(t.visits) +
              '</td><td>' +
              esc(t.leads) +
              '</td><td>' +
              esc(t.qualified) +
              '</td><td>' +
              esc(t.closings) +
              '</td></tr>'
            );
          })
          .join('')
      : '<tr><td colspan="5" style="color:#5f746f;text-align:center;padding:16px">No territory breakdown.</td></tr>';

    mount.innerHTML =
      '<div class="rpu-dash-head"><div><h1>Reach Portal Dashboard</h1>' +
      '<p>Field activity, leads, visits, franchise pipeline and team performance in one place.</p></div>' +
      '<div class="rpu-range"><span>📅</span>' +
      '<input type="date" data-rpu-from value="' +
      esc(st.dateFrom) +
      '" />' +
      '<span>—</span>' +
      '<input type="date" data-rpu-to value="' +
      esc(st.dateTo) +
      '" />' +
      '<button type="button" class="btn" data-rpu-apply style="margin-left:6px">Apply</button></div></div>' +
      (st.message ? '<div class="rpu-msg ' + (st.tone === 'error' ? 'err' : 'ok') + '">' + esc(st.message) + '</div>' : '') +
      '<div class="rpu-kpi-row">' +
      '<div class="rpu-kpi"><span>Total Leads</span><b>' +
      esc(d.kpis.totalLeads) +
      '</b><em>↑ live</em></div>' +
      '<div class="rpu-kpi"><span>Total Visits</span><b>' +
      esc(d.kpis.totalVisits) +
      '</b><em>↑ live</em></div>' +
      '<div class="rpu-kpi"><span>Data Completion</span><b>' +
      esc(d.kpis.dataCompletion) +
      '%</b><em>↑ period</em></div>' +
      '<div class="rpu-kpi"><span>Franchise Leads</span><b>' +
      esc(d.kpis.franchiseLeads) +
      '</b><em>↑ live</em></div>' +
      '<div class="rpu-kpi"><span>B2B Leads</span><b>' +
      esc(d.kpis.b2bLeads) +
      '</b><em>↑ live</em></div>' +
      '<div class="rpu-kpi"><span>Closings</span><b>' +
      esc(d.kpis.closings) +
      '</b><em>↑ reports</em></div>' +
      '<div class="rpu-kpi"><span>Commission (Est.)</span><b>' +
      esc(fmtMoney(d.kpis.commission)) +
      '</b><em>↑ month</em></div></div>' +
      '<div class="rpu-mid">' +
      '<div class="rpu-card"><h3>Visit Performance Funnel</h3><div class="rpu-funnel">' +
      funnelRows +
      '</div><div class="rpu-side-stats">' +
      '<div><span>Visit Completion</span><strong>' +
      esc(d.funnel.visitCompletion) +
      '%</strong></div>' +
      '<div><span>Avg. Visit Duration</span><strong>' +
      esc(d.funnel.avgDuration) +
      ' min</strong></div>' +
      '<div><span>Lead Conversion</span><strong>' +
      esc(d.funnel.leadConversion) +
      '%</strong></div></div></div>' +
      '<div class="rpu-card"><h3>Purpose Wise Visits</h3><div class="rpu-donut-wrap">' +
      '<div class="rpu-donut" style="--p1:' +
      esc(p[0].pct) +
      ';--p2:' +
      esc(p[1].pct) +
      ';--p3:' +
      esc(p[2].pct) +
      ';--p4:' +
      esc(p[3].pct) +
      '"></div><div class="rpu-legend">' +
      purposeLegend +
      '</div></div></div>' +
      '<div class="rpu-card"><h3>Outcome Summary</h3><div class="rpu-bars">' +
      outcomeBars +
      '</div></div></div>' +
      '<div class="rpu-bottom">' +
      '<div class="rpu-card"><h3>Recent Visit Logs</h3><div style="overflow:auto"><table><thead><tr>' +
      '<th>#</th><th>Date &amp; Time</th><th>Employee</th><th>Purpose</th><th>Outcome</th><th>Duration</th>' +
      '</tr></thead><tbody>' +
      recentRows +
      '</tbody></table></div>' +
      '<div style="margin-top:10px"><a class="btn secondary" href="/sales/map">Open Team Performance</a> ' +
      '<a class="btn secondary" href="/sales/visit">Log visit</a></div></div>' +
      '<div class="rpu-card"><h3>Top Performers</h3><p style="margin:-4px 0 10px;color:#5f746f;font-size:12px">By data completion</p><div class="rpu-rank">' +
      rankRows +
      '</div></div>' +
      '<div class="rpu-card"><h3>Territory Performance</h3><div style="overflow:auto"><table><thead><tr>' +
      '<th>Territory</th><th>Visits</th><th>Leads</th><th>Qualified</th><th>Closings</th>' +
      '</tr></thead><tbody>' +
      terrRows +
      '</tbody></table></div></div></div>';
  }

  function clearDashboard() {
    var main = document.querySelector('.sales-layout .b2b-main, .sales-layout main');
    if (!main) return;
    main.classList.remove('rpu-hide-native');
    var mount = main.querySelector('[' + DASH_ATTR + ']');
    if (mount) mount.remove();
  }

  function loadDash(opts) {
    var forceRange = !!(opts && opts.forceRange);
    st.busy = true;
    // Prefer server "today" on first load — browser clock can be wrong (e.g. 2024).
    var activityArgs = { limit: 5000 };
    if (forceRange && st.dateFrom && st.dateTo) {
      activityArgs.date_from = st.dateFrom;
      activityArgs.date_to = st.dateTo;
    } else {
      // Ask server for ~31 days ending today (server clock)
      activityArgs.date_from = '';
      activityArgs.date_to = '';
    }
    return Promise.all([
      call('get_sales_portal').catch(function () {
        return null;
      }),
      call('get_sales_team_portal_activity', activityArgs).catch(function () {
        return null;
      }),
      call('get_sales_closing_reports', { limit: 100 }).catch(function () {
        return null;
      }),
      call('get_sales_commissions', { limit: 50 }).catch(function () {
        return null;
      }),
    ])
      .then(function (rows) {
        st.portal = rows[0];
        st.activity = rows[1];
        st.closings = rows[2];
        st.commissions = rows[3];
        if (st.activity && st.activity.date_from) st.dateFrom = st.activity.date_from;
        if (st.activity && st.activity.date_to) st.dateTo = st.activity.date_to;
        if (!st.dateFrom) st.dateFrom = monthStartIso();
        if (!st.dateTo) st.dateTo = todayIso();
        st.busy = false;
        st.message = '';
        refreshShellProfile();
        if (isPortalHome()) renderDashboard();
      })
      .catch(function (err) {
        st.busy = false;
        st.message = err.message || 'Failed to load dashboard';
        st.tone = 'error';
        if (isPortalHome()) renderDashboard();
      });
  }

  function rewriteHrNav(root) {
    if (!root) return;
    var profile = null;
    var hr = null;
    var teamMap = null;
    var logout = null;
    Array.prototype.forEach.call(root.querySelectorAll('a, button'), function (a) {
      var href = a.getAttribute('href') || '';
      var label = (a.textContent || '').trim();
      if (a.tagName === 'A' && (href === '/sales' || href === '/sales/')) {
        if (label === 'Portal' || label === 'Dashboard') a.textContent = 'Dashboard';
      }
      if (a.tagName === 'A' && (href === '/sales/profile' || href === '/sales/my-hr' || label === 'Profile' || label === 'My HR Profile')) {
        profile = a;
      }
      if (a.tagName === 'A' && (href === '/dashboard/hr' || label === 'HR')) {
        hr = a;
      }
      if (a.tagName === 'A' && (href === '/sales/map' || label === 'Team map')) {
        teamMap = a;
      }
      if ((a.tagName === 'BUTTON' || a.classList.contains('btn-link')) && /logout/i.test(label)) {
        logout = a;
      }
    });
    if (profile) {
      profile.setAttribute('href', '/sales/my-hr');
      profile.textContent = 'My HR Profile';
      profile.setAttribute('data-rpu-hr-link', '1');
      if (isHrPath()) profile.classList.add('active');
      else profile.classList.remove('active');
      // Place after Team map (before Logout)
      if (teamMap && teamMap.parentNode === root) {
        if (logout && logout.parentNode === root) root.insertBefore(profile, logout);
        else if (teamMap.nextSibling) root.insertBefore(profile, teamMap.nextSibling);
        else root.appendChild(profile);
      }
    }
    if (hr) {
      hr.style.display = 'none';
      hr.setAttribute('aria-hidden', 'true');
      hr.setAttribute('tabindex', '-1');
    }
    // Mobile drawer links
    Array.prototype.forEach.call(document.querySelectorAll('.mobile-nav a, [class*="MobileNav"] a, nav a'), function (a) {
      var href = a.getAttribute('href') || '';
      var label = (a.textContent || '').trim();
      if (href === '/dashboard/hr' || label === 'HR') {
        a.style.display = 'none';
      }
      if (href === '/sales/profile' || label === 'Profile') {
        a.setAttribute('href', '/sales/my-hr');
        a.textContent = 'My HR Profile';
      }
    });
  }

  function isHrPath() {
    var p = location.pathname || '';
    return (
      p === '/sales/my-hr' ||
      p.indexOf('/sales/my-hr') === 0 ||
      p === '/sales/profile' ||
      p.indexOf('/sales/profile') === 0 ||
      p === '/dashboard/hr' ||
      p.indexOf('/dashboard/hr') === 0
    );
  }

  function savedSession() {
    try {
      return JSON.parse(localStorage.getItem('hec_web_session') || 'null');
    } catch (e) {
      return null;
    }
  }

  function clearHrWorkspace() {
    var main = document.querySelector('.sales-layout .b2b-main, .sales-layout main');
    if (!main) return;
    main.classList.remove('rpu-hr-on');
    var panel = main.querySelector('[' + HR_ATTR + ']');
    if (panel) panel.remove();
  }

  function ensureHrWorkspace() {
    var main = document.querySelector('.sales-layout .b2b-main, .sales-layout main');
    if (!main) return;
    main.classList.add('rpu-hr-on');
    var panel = main.querySelector('[' + HR_ATTR + ']');
    if (panel) return;
    panel = document.createElement('div');
    panel.className = 'rpu-hr-workspace';
    panel.setAttribute(HR_ATTR, '1');
    panel.innerHTML = '<iframe title="My HR Profile" src="' + PEOPLE + '/people/profile?pa_embed=1" allow="geolocation *"></iframe>';
    main.appendChild(panel);
  }

  function closeLeadForm() {
    var btn = document.querySelector('.reach-page-actions .reach-btn, .reach-page-actions button');
    if (btn && /cancel/i.test(btn.textContent || '')) btn.click();
  }

  function ensureVisitModal() {
    var onVisit = /\/sales\/visit\/?$/.test(location.pathname || '');
    var page = onVisit ? document.querySelector('.reach-visit-page') : null;
    var nativeModal = page && page.querySelector('.reach-modal-backdrop form.reach-card');
    var inlineForm = page ? page.querySelector(':scope > form.reach-card') : null;
    var backdrop = document.querySelector('[data-rpu-visit-backdrop]');
    var openBtn = document.querySelector('[data-rpu-visit-open]');

    if (!onVisit || !page) {
      document.body.classList.remove('rpu-visit-modal-open');
      if (backdrop) backdrop.remove();
      if (openBtn) openBtn.remove();
      return;
    }

    // React rebuild already uses modal — leave alone.
    if (nativeModal) {
      document.body.classList.remove('rpu-visit-modal-open');
      if (backdrop) backdrop.remove();
      return;
    }

    if (!inlineForm) return;

    // Hide inline form until opened as popup.
    if (!inlineForm.getAttribute('data-rpu-visit-ready')) {
      inlineForm.setAttribute('data-rpu-visit-ready', '1');
      inlineForm.classList.add('reach-modal');
      inlineForm.style.display = 'none';

      // Mark photo as required
      var photoInput = inlineForm.querySelector('input[type="file"]');
      if (photoInput) {
        photoInput.setAttribute('required', 'required');
        var photoLabel = photoInput.closest('label');
        if (photoLabel) {
          photoLabel.innerHTML = photoLabel.innerHTML.replace(/Visit photo \(optional\)/i, 'Visit photo *');
        }
      }

      inlineForm.addEventListener(
        'submit',
        function (e) {
          var fileInput = inlineForm.querySelector('input[type="file"]');
          var hasPhoto = !!(fileInput && fileInput.files && fileInput.files.length);
          var gpsText = (inlineForm.textContent || '').indexOf('Waiting for GPS') >= 0;
          var gpsCode = inlineForm.querySelector('.reach-gps code');
          if (!hasPhoto) {
            e.preventDefault();
            e.stopPropagation();
            alert('Visit photo is mandatory — capture or upload a photo.');
            return false;
          }
          if (gpsText || !gpsCode) {
            e.preventDefault();
            e.stopPropagation();
            alert('GPS is mandatory — tap Refresh GPS and allow location.');
            return false;
          }
        },
        true,
      );
    }

    var headActions = page.querySelector('.reach-page-actions');
    if (!headActions) {
      var head = page.querySelector('.reach-page-head');
      if (head) {
        headActions = document.createElement('div');
        headActions.className = 'reach-page-actions';
        head.appendChild(headActions);
      }
    }
    if (headActions && !headActions.querySelector('[data-rpu-visit-open]')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reach-btn';
      btn.setAttribute('data-rpu-visit-open', '1');
      btn.textContent = 'Log visit entry';
      btn.addEventListener('click', function () {
        openVisitPopup(inlineForm);
      });
      headActions.appendChild(btn);
    }

    // Complete assigned → open popup
    Array.prototype.forEach.call(page.querySelectorAll('.reach-panel .reach-btn.secondary, .reach-panel button'), function (b) {
      if (!/complete/i.test(b.textContent || '') || b.getAttribute('data-rpu-visit-bound')) return;
      b.setAttribute('data-rpu-visit-bound', '1');
      b.addEventListener('click', function () {
        setTimeout(function () {
          openVisitPopup(inlineForm);
        }, 50);
      });
    });
  }

  function openVisitPopup(form) {
    if (!form) return;
    form.style.display = '';
    form.classList.add('reach-modal');
    document.body.classList.add('rpu-visit-modal-open');
    var backdrop = document.querySelector('[data-rpu-visit-backdrop]');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.setAttribute('data-rpu-visit-backdrop', '1');
      backdrop.className = 'reach-modal-backdrop';
      backdrop.style.cssText = 'position:fixed;inset:0;z-index:120;background:rgba(15,47,42,.48);';
      backdrop.addEventListener('click', function () {
        closeVisitPopup(form);
      });
      document.body.appendChild(backdrop);
    }
    if (!form.querySelector('[data-rpu-visit-x]')) {
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'rpu-lead-modal-x';
      x.setAttribute('data-rpu-visit-x', '1');
      x.setAttribute('aria-label', 'Close');
      x.textContent = '×';
      x.addEventListener('click', function (e) {
        e.preventDefault();
        closeVisitPopup(form);
      });
      form.appendChild(x);
    }
  }

  function closeVisitPopup(form) {
    document.body.classList.remove('rpu-visit-modal-open');
    var backdrop = document.querySelector('[data-rpu-visit-backdrop]');
    if (backdrop) backdrop.remove();
    if (form) form.style.display = 'none';
  }

  function ensureB2bFormClose() {
    var path = location.pathname || '';
    var onB2b =
      /\/sales\/b2b-centres\/?$/.test(path) ||
      /\/sales\/b2b-sales\/?$/.test(path);
    var form = onB2b
      ? document.querySelector(
          '.reach-leads-page > form.reach-card, .reach-leads-page form.reach-modal, .reach-leads-page .reach-modal-backdrop form',
        )
      : null;
    var backdrop = document.querySelector('[data-rpu-b2b-backdrop]');
    if (!onB2b || !form) {
      if (backdrop) backdrop.remove();
      document.body.classList.remove('rpu-b2b-modal-open');
      return;
    }
    // Native React modal already has close — skip.
    if (form.closest('.reach-modal-backdrop') && form.querySelector('.reach-modal-close')) return;

    document.body.classList.add('rpu-b2b-modal-open');
    form.classList.add('reach-modal');

    function closeForm() {
      Array.prototype.forEach.call(document.querySelectorAll('.reach-page-actions button'), function (b) {
        if (/cancel/i.test(b.textContent || '')) b.click();
      });
      form.style.display = 'none';
      document.body.classList.remove('rpu-b2b-modal-open');
      var bd = document.querySelector('[data-rpu-b2b-backdrop]');
      if (bd) bd.remove();
    }

    if (!form.querySelector('[data-rpu-b2b-x]')) {
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'reach-modal-close rpu-lead-modal-x';
      x.setAttribute('data-rpu-b2b-x', '1');
      x.setAttribute('aria-label', 'Close');
      x.textContent = '×';
      x.addEventListener('click', function (e) {
        e.preventDefault();
        closeForm();
      });
      var head = form.querySelector('.reach-card-head') || form;
      head.style.position = 'relative';
      head.appendChild(x);
    }

    var footer = form.querySelector('.reach-form-footer');
    if (footer && !footer.querySelector('[data-rpu-b2b-cancel]')) {
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'reach-btn secondary';
      cancel.setAttribute('data-rpu-b2b-cancel', '1');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', function (e) {
        e.preventDefault();
        closeForm();
      });
      footer.appendChild(cancel);
    }

    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.setAttribute('data-rpu-b2b-backdrop', '1');
      backdrop.className = 'reach-modal-backdrop';
      backdrop.style.cssText = 'position:fixed;inset:0;z-index:120;background:rgba(15,47,42,.48);';
      backdrop.addEventListener('click', closeForm);
      document.body.appendChild(backdrop);
    }
  }

  function ensureLeadModal() {
    var onLeads = /\/sales\/leads\/?$/.test(location.pathname || '');
    var form = onLeads
      ? document.querySelector('.reach-leads-page > form.reach-card, .reach-leads-page .reach-modal-backdrop form.reach-card')
      : null;
    var backdrop = document.querySelector('[data-rpu-lead-backdrop]');
    if (!form) {
      document.body.classList.remove('rpu-lead-modal-open');
      if (backdrop) backdrop.remove();
      return;
    }
    // Native React modal already present — leave it alone.
    if (form.closest('.reach-modal-backdrop') && !backdrop) {
      document.body.classList.add('rpu-lead-modal-open');
      return;
    }
    document.body.classList.add('rpu-lead-modal-open');
    form.classList.add('reach-modal');
    if (!form.querySelector('[data-rpu-lead-x]')) {
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'rpu-lead-modal-x';
      x.setAttribute('data-rpu-lead-x', '1');
      x.setAttribute('aria-label', 'Close');
      x.textContent = '×';
      x.addEventListener('click', function (e) {
        e.preventDefault();
        closeLeadForm();
      });
      form.appendChild(x);
    }
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.setAttribute('data-rpu-lead-backdrop', '1');
      backdrop.className = 'reach-modal-backdrop';
      backdrop.style.cssText = 'position:fixed;inset:0;z-index:120;background:rgba(15,47,42,.48);';
      backdrop.addEventListener('click', function () {
        closeLeadForm();
      });
      document.body.appendChild(backdrop);
    }
  }

  function tick() {
    if (!onReach()) {
      clearDashboard();
      clearHrWorkspace();
      document.body.classList.remove('rpu-lead-modal-open');
      return;
    }
    ensureShell();
    var nav = document.querySelector('.sales-layout .b2b-nav');
    rewriteHrNav(nav);
    ensureLeadModal();
    ensureVisitModal();
    ensureB2bFormClose();

    if (isHrPath()) {
      clearDashboard();
      ensureHrWorkspace();
      return;
    }
    clearHrWorkspace();

    if (isPortalHome()) {
      var main = document.querySelector('.sales-layout .b2b-main, .sales-layout main');
      if (main && !main.querySelector('[' + DASH_ATTR + ']')) {
        renderDashboard();
        if (!st.activity && !st.busy) loadDash();
      }
    } else {
      clearDashboard();
    }
  }

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t) return;
    if (t.matches && t.matches('[data-rpu-from]')) st.dateFrom = t.value || st.dateFrom;
    if (t.matches && t.matches('[data-rpu-to]')) st.dateTo = t.value || st.dateTo;
  });

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-rpu-apply]')) {
      loadDash({ forceRange: true });
      return;
    }
    var hrLink = t.closest('a[href="/dashboard/hr"], a[href="/sales/profile"], a[data-rpu-hr-link]');
    if (hrLink && onReach()) {
      // Force SPA to My HR Profile path so overlay mounts even before React rebuild.
      var href = hrLink.getAttribute('href') || '';
      if (href === '/dashboard/hr' || href === '/sales/profile') {
        e.preventDefault();
        if (location.pathname !== '/sales/my-hr' && location.pathname !== '/sales/profile') {
          history.pushState({}, '', '/sales/profile');
        }
        ensureHrWorkspace();
        rewriteHrNav(document.querySelector('.sales-layout .b2b-nav'));
      }
    }
  }, true);

  window.addEventListener('message', function (e) {
    if (e.origin !== PEOPLE || !e.data || e.data.type !== 'pa-embed-ready') return;
    var frame = document.querySelector('[' + HR_ATTR + '] iframe, .rpu-hr-workspace iframe');
    var s = savedSession();
    if (!frame || !frame.contentWindow || e.source !== frame.contentWindow || !s || !s.sid) return;
    frame.contentWindow.postMessage(
      {
        type: 'pa-embed-session',
        session: {
          sid: s.sid,
          user: s.user || '',
          fullName: s.fullName || s.full_name || s.user || '',
          roles: s.roles || [],
        },
      },
      PEOPLE,
    );
  });

  // SPA route changes
  var lastPath = location.pathname;
  setInterval(function () {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      if (isPortalHome()) loadDash();
      else clearDashboard();
      if (!isHrPath()) clearHrWorkspace();
    }
    tick();
  }, 900);

  if (onReach()) {
    ensureShell();
    if (isHrPath()) ensureHrWorkspace();
    else loadDash();
  }
})();
