/* People HRMS: portal access (logins + module permissions), asset assignment and signed asset forms. */
(function () {
  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_access.';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function call(method, extra) {
    var body = new URLSearchParams(extra || {});
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      if (s && s.sid) body.set('sid', s.sid);
    } catch (e) {}
    return fetch(API + method, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
      body: body,
    }).then(function (r) { return r.json(); }).then(function (json) {
      var m = json && json.message && typeof json.message === 'object' ? json.message : json;
      if (!m || m.status === 'error') throw new Error(String((m && m.message) || 'Request failed').replace(/<[^>]+>/g, ''));
      return m.data !== undefined ? m.data : m;
    });
  }

  function strongPassword() {
    var sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '@#$%&*!?'];
    var all = sets.join('');
    var out = sets.map(function (s) { return s[rand(s.length)]; });
    while (out.length < 14) out.push(all[rand(all.length)]);
    for (var i = out.length - 1; i > 0; i--) { var j = rand(i + 1); var t = out[i]; out[i] = out[j]; out[j] = t; }
    return out.join('');
  }

  function rand(n) {
    var a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  }

  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(String(v).replace(' ', 'T'));
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ------------------------------------------------------------ PDF download */

  function downloadAgreement(id) {
    return call('get_asset_agreement_pdf', { agreement: id }).then(function (d) {
      var bin = atob(d.data);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
      var a = document.createElement('a');
      a.href = url;
      a.download = d.file_name || 'asset-assignment.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    }).catch(function (e) { alert((e && e.message) || 'Could not download the form'); });
  }

  function viewAgreement(id) {
    var win = window.open('', '_blank');
    return call('get_asset_agreement_pdf', { agreement: id }).then(function (d) {
      var bin = atob(d.data);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
      if (win) win.location.href = url;
      else downloadAgreement(id);
    }).catch(function (e) { if (win) win.close(); alert((e && e.message) || 'Could not open the form'); });
  }

  /* ------------------------------------------------------------ editor (inside Edit employee) */

  function issuedPill() {
    var cls = a.status === 'Signed' ? 'ok' : 'warn';
    return '<span class="pa-pill ' + cls + '">' + esc(a.status) + '</span>';
  }

  function mountEditor(container, employeeId) {
    var box = document.createElement('div');
    box.className = 'pa-editor';
    box.innerHTML = '<h4>Portal access</h4><div data-pa-access><p class="pa-muted">Loading portal access…</p></div>' +
      '<h4>Assign assets</h4><div data-pa-assets><p class="pa-muted">Loading assets…</p></div>';
    container.appendChild(box);
    var accessBox = box.querySelector('[data-pa-access]');
    var assetBox = box.querySelector('[data-pa-assets]');
    var state = { access: null, rows: {}, original: '', assets: null, picked: {}, originalAssets: '', q: '', open: false };

    function snapshotAccess() {
      return JSON.stringify(Object.keys(state.rows).sort().map(function (k) {
        var r = state.rows[k];
        return [k, r.login_id, r.active, r.permissions, !!r.password];
      }));
    }

    function drawAccess() {
      var portals = state.access.portals;
      var selected = Object.keys(state.rows);
      var levels = state.access.levels;
      var chips = selected.length ? selected.map(function (k) {
        var p = portals.filter(function (x) { return x.key === k; })[0];
        return '<span class="pa-chip">' + esc(p ? p.label : k) + '</span>';
      }).join('') : '<span class="pa-muted">No portals selected</span>';
      var menu = state.open ? '<div class="pa-menu">' + portals.map(function (p) {
        return '<label class="' + (p.available ? '' : 'off') + '"><input type="checkbox" data-pa-portal="' + esc(p.key) + '"' + (state.rows[p.key] ? ' checked' : '') + (p.available ? '' : ' disabled') + ' />' +
          '<span><b>' + esc(p.label) + '</b><small>' + esc(p.url.replace('https://', '')) + (p.available ? '' : ' · not set up on this server') + (p.elevated ? ' · HR-level access' : '') + '</small></span></label>';
      }).join('') + '</div>' : '';
      var cards = selected.map(function (k) {
        var p = portals.filter(function (x) { return x.key === k; })[0];
        var r = state.rows[k];
        var existing = !!r.existing;
        return '<div class="pa-portal" data-pa-card="' + esc(k) + '">' +
          '<div class="pa-portal-head"><div><b>' + esc(p.label) + '</b><small>' + esc(p.url) + '</small></div>' +
          '<label class="pa-toggle"><input type="checkbox" data-pa-active' + (r.active ? ' checked' : '') + ' /> Active</label></div>' +
          (existing ? '<p class="pa-muted">Login ' + (r.login_enabled ? 'enabled' : 'disabled') + (r.last_login ? ' · last sign-in ' + esc(fmtDate(r.last_login)) : ' · never signed in') + (r.granted_by ? ' · set by ' + esc(r.granted_by) : '') + '</p>' : '') +
          '<div class="pa-grid">' +
          '<label>Login ID (email)<input data-pa-login type="email" autocomplete="off" value="' + esc(r.login_id || '') + '" placeholder="name@company.com" /></label>' +
          '<label>' + (existing ? 'New password' : 'Password') + '<span class="pa-row"><input data-pa-pw type="password" autocomplete="new-password" value="' + esc(r.password || '') + '" placeholder="' + (existing ? 'Leave blank to keep current' : 'At least 8 characters') + '" />' +
          '<button type="button" class="pa-link" data-pa-gen>Generate</button><button type="button" class="pa-link" data-pa-show>Show</button></span></label>' +
          '<label>Confirm password<input data-pa-pw2 type="password" autocomplete="new-password" value="' + esc(r.password2 || '') + '" /></label>' +
          '</div>' +
          '<table class="pa-perms"><thead><tr><th>Module</th><th>Access <select data-pa-all><option value="">Set all…</option>' +
          levels.map(function (l) { return '<option value="' + l.value + '">' + esc(l.label) + '</option>'; }).join('') + '</select></th></tr></thead><tbody>' +
          p.modules.map(function (m) {
            var org = (p.org_modules || []).indexOf(m) !== -1;
            return '<tr><td>' + esc(m) + (org ? ' <span class="pa-tag">HR menu</span>' : '') + '</td><td><select data-pa-module="' + esc(m) + '">' + levels.map(function (l) {
              return '<option value="' + l.value + '"' + ((r.permissions[m] || 'none') === l.value ? ' selected' : '') + '>' + esc(l.label) + '</option>';
            }).join('') + '</select></td></tr>';
          }).join('') + '</tbody></table>' +
          '<p class="pa-summary" data-pa-summary="' + esc(k) + '">' + summaryText(p, r) + '</p></div>';
      }).join('');
      accessBox.innerHTML = '<div class="pa-ms"><button type="button" class="pa-ms-btn" data-pa-toggle>' + chips + '<span class="pa-caret">▾</span></button>' + menu + '</div>' +
        '<p class="pa-muted">Each portal can use the employee\'s main login or its own login ID. Module access: View → Create → Edit → Approve → Manage. Modules marked “HR menu”, or Approve / Manage on any module, give the HR menu; otherwise the employee gets their own self-service menu.</p>' + cards +
        (selected.length || state.original !== '[]'
          ? '<div class="pa-save-row"><button type="button" class="pa-btn primary" data-pa-save>Save portal access</button><span class="pa-save-status" data-pa-status></span></div>'
          : '');
      bindAccess();
      markDirty();
    }

    function summaryText(p, r) {
      var on = p.modules.filter(function (m) { return (r.permissions[m] || 'none') !== 'none'; });
      var hr = on.some(function (m) { return (p.org_modules || []).indexOf(m) !== -1; }) ||
        on.some(function (m) { return ['approve', 'manage'].indexOf(r.permissions[m]) !== -1; });
      var menu = p.key === 'people' ? (hr ? ' · gets the HR menu' : ' · gets the employee self-service menu') : '';
      return '<b>' + on.length + ' of ' + p.modules.length + '</b> modules enabled' + menu + (r.active ? '' : ' · portal disabled');
    }

    function markDirty() {
      var status = accessBox.querySelector('[data-pa-status]');
      if (!status || status.getAttribute('data-saved') === '1') return;
      var dirty = state.access && snapshotAccess() !== state.original;
      status.textContent = dirty ? 'Unsaved changes' : '';
      status.className = 'pa-save-status' + (dirty ? ' dirty' : '');
    }

    function refreshSummaries() {
      Object.keys(state.rows).forEach(function (k) {
        var p = state.access.portals.filter(function (x) { return x.key === k; })[0];
        var el = accessBox.querySelector('[data-pa-summary="' + k + '"]');
        if (p && el) el.innerHTML = summaryText(p, state.rows[k]);
      });
      var status = accessBox.querySelector('[data-pa-status]');
      if (status) status.removeAttribute('data-saved');
      markDirty();
    }

    function accessPayload() {
      return Object.keys(state.rows).map(function (k) {
        var r = state.rows[k];
        return { portal: k, login_id: r.login_id, password: r.password || '', permissions: r.permissions, active: r.active ? 1 : 0 };
      });
    }

    function applySavedState(d) {
      state.access = d;
      state.rows = {};
      d.access.forEach(function (a) {
        state.rows[a.portal] = { login_id: a.login_id, permissions: a.permissions, active: a.active, existing: true, login_enabled: a.login_enabled, last_login: a.last_login, granted_by: a.granted_by, password: '', password2: '' };
      });
      state.original = snapshotAccess();
    }

    function saveAccessNow() {
      var status = accessBox.querySelector('[data-pa-status]');
      var btn = accessBox.querySelector('[data-pa-save]');
      var invalid = validateAccess();
      if (invalid) {
        status.textContent = invalid;
        status.className = 'pa-save-status error';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Saving…';
      call('save_employee_portal_access', { employee: employeeId, access: JSON.stringify(accessPayload()) }).then(function (res) {
        applySavedState(res.state);
        drawAccess();
        var s = accessBox.querySelector('[data-pa-status]');
        s.textContent = 'Saved. The employee sees the new access the next time their portal loads.';
        s.className = 'pa-save-status ok';
        s.setAttribute('data-saved', '1');
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = 'Save portal access';
        status.textContent = (e && e.message) || 'Could not save portal access';
        status.className = 'pa-save-status error';
      });
    }

    function validateAccess() {
      var keys = Object.keys(state.rows);
      for (var i = 0; i < keys.length; i++) {
        var r = state.rows[keys[i]];
        var label = (state.access.portals.filter(function (x) { return x.key === keys[i]; })[0] || {}).label || keys[i];
        if (!r.login_id) return label + ': enter a login ID';
        if (r.password !== r.password2) return label + ': passwords do not match';
      }
      return '';
    }

    function bindAccess() {
      accessBox.querySelector('[data-pa-toggle]').addEventListener('click', function () { state.open = !state.open; drawAccess(); });
      accessBox.querySelectorAll('[data-pa-portal]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var k = cb.getAttribute('data-pa-portal');
          if (cb.checked) {
            var p = state.access.portals.filter(function (x) { return x.key === k; })[0];
            var perms = {};
            p.modules.forEach(function (m) { perms[m] = (p.defaults && p.defaults[m]) || 'none'; });
            var shared = Object.keys(state.rows).map(function (x) { return state.rows[x].login_id; }).filter(Boolean)[0];
            state.rows[k] = { login_id: shared || state.access.default_login || '', permissions: perms, active: 1, password: '', password2: '' };
          } else {
            delete state.rows[k];
          }
          drawAccess();
        });
      });
      accessBox.querySelectorAll('[data-pa-card]').forEach(function (card) {
        var k = card.getAttribute('data-pa-card');
        var r = state.rows[k];
        card.querySelector('[data-pa-active]').addEventListener('change', function (e) { r.active = e.target.checked ? 1 : 0; refreshSummaries(); });
        card.querySelector('[data-pa-login]').addEventListener('input', function (e) { r.login_id = e.target.value.trim(); refreshSummaries(); });
        card.querySelector('[data-pa-pw]').addEventListener('input', function (e) { r.password = e.target.value; refreshSummaries(); });
        card.querySelector('[data-pa-pw2]').addEventListener('input', function (e) { r.password2 = e.target.value; });
        card.querySelector('[data-pa-gen]').addEventListener('click', function () {
          var pw = strongPassword();
          r.password = pw;
          r.password2 = pw;
          card.querySelector('[data-pa-pw]').value = pw;
          card.querySelector('[data-pa-pw2]').value = pw;
          card.querySelector('[data-pa-pw]').type = 'text';
          card.querySelector('[data-pa-pw2]').type = 'text';
        });
        card.querySelector('[data-pa-show]').addEventListener('click', function () {
          var a = card.querySelector('[data-pa-pw]');
          var b = card.querySelector('[data-pa-pw2]');
          var t = a.type === 'password' ? 'text' : 'password';
          a.type = t;
          b.type = t;
        });
        card.querySelector('[data-pa-all]').addEventListener('change', function (e) {
          if (!e.target.value) return;
          Object.keys(r.permissions).forEach(function (m) { r.permissions[m] = e.target.value; });
          drawAccess();
        });
        card.querySelectorAll('[data-pa-module]').forEach(function (sel) {
          sel.addEventListener('change', function () { r.permissions[sel.getAttribute('data-pa-module')] = sel.value; refreshSummaries(); });
        });
      });
      var saveBtn = accessBox.querySelector('[data-pa-save]');
      if (saveBtn) saveBtn.addEventListener('click', saveAccessNow);
    }

    function drawAssets() {
      var list = state.assets.assets;
      var q = state.q.toLowerCase();
      var shown = list.filter(function (a) {
        return !q || (a.title + ' ' + a.category + ' ' + a.serial + ' ' + a.id + ' ' + a.location).toLowerCase().indexOf(q) !== -1;
      });
      var pickedCount = Object.keys(state.picked).filter(function (k) { return state.picked[k]; }).length;
      var agreements = state.assets.agreements || [];
      assetBox.innerHTML =
        '<div class="pa-asset-bar"><input type="search" data-pa-q placeholder="Search assets by name, serial, ID…" value="' + esc(state.q) + '" />' +
        '<span class="pa-muted">' + pickedCount + ' selected</span></div>' +
        '<div class="pa-asset-list">' + (shown.length ? shown.map(function (a) {
          return '<label class="pa-asset' + (state.picked[a.id] ? ' on' : '') + '"><input type="checkbox" data-pa-asset="' + esc(a.id) + '"' + (state.picked[a.id] ? ' checked' : '') + ' />' +
            '<span><b>' + esc(a.title) + '</b><small>' + esc([a.category, a.serial ? 'S/N ' + a.serial : '', a.id, a.location].filter(Boolean).join(' · ')) + '</small></span>' +
            (a.assigned ? '<em>Assigned' + (a.assign_date ? ' ' + esc(fmtDate(a.assign_date)) : '') + '</em>' : '<em class="free">Available</em>') + '</label>';
        }).join('') : '<p class="pa-muted">No available assets match.</p>') + '</div>' +
        '<p class="pa-muted">Untick an assigned asset to collect it back. Newly assigned assets create an Asset Assignment form (PDF) in the employee\'s Documents.</p>' +
        (agreements.length ? '<div class="pa-agreements"><b>Asset forms</b>' + agreements.map(function (a) {
          return '<div class="pa-agreement"><div><b>' + esc(a.id) + '</b> · ' + esc(fmtDate(a.issued_on)) + ' · ' + a.assets.length + ' asset(s) ' + issuedPill() +
            '<small>' + esc((a.assets || []).map(function (x) { return x.title; }).join(', ')) + '</small></div>' +
            '<span class="pa-agreement-actions"><button type="button" class="pa-link" data-pa-dl="' + esc(a.id) + '">Download PDF</button>' +
            '</span></div>';
        }).join('') + '</div>' : '');
      var qInput = assetBox.querySelector('[data-pa-q]');
      qInput.addEventListener('input', function () {
        state.q = qInput.value;
        var pos = qInput.selectionStart;
        drawAssets();
        var again = assetBox.querySelector('[data-pa-q]');
        again.focus();
        again.setSelectionRange(pos, pos);
      });
      assetBox.querySelectorAll('[data-pa-asset]').forEach(function (cb) {
        cb.addEventListener('change', function () { state.picked[cb.getAttribute('data-pa-asset')] = cb.checked; drawAssets(); });
      });
      assetBox.querySelectorAll('[data-pa-dl]').forEach(function (b) { b.addEventListener('click', function () { downloadAgreement(b.getAttribute('data-pa-dl')); }); });
    }

    function pickedIds() {
      return Object.keys(state.picked).filter(function (k) { return state.picked[k]; }).sort();
    }

    function loadAssets() {
      return call('get_employee_asset_options', { employee: employeeId }).then(function (d) {
        state.assets = d;
        state.picked = {};
        d.assets.forEach(function (a) { if (a.assigned) state.picked[a.id] = true; });
        state.originalAssets = JSON.stringify(pickedIds());
        drawAssets();
      }).catch(function (e) { assetBox.innerHTML = '<p class="pa-err">' + esc(e.message) + '</p>'; });
    }

    call('get_employee_portal_access', { employee: employeeId }).then(function (d) {
      applySavedState(d);
      drawAccess();
    }).catch(function (e) { accessBox.innerHTML = '<p class="pa-err">' + esc(e.message) + '</p>'; });
    loadAssets();

    return {
      validate: function () {
        if (!state.access) return '';
        var msg = validateAccess();
        return msg ? 'Portal access — ' + msg : '';
      },
      save: function () {
        var jobs = [];
        var result = { agreement: null };
        if (state.access && snapshotAccess() !== state.original) {
          jobs.push(call('save_employee_portal_access', { employee: employeeId, access: JSON.stringify(accessPayload()) }).catch(function (e) {
            throw new Error('Portal access was not saved: ' + ((e && e.message) || 'error'));
          }));
        }
        return Promise.all(jobs).then(function () {
          if (!state.assets || JSON.stringify(pickedIds()) === state.originalAssets) return null;
          return call('save_employee_assets', { employee: employeeId, assets: JSON.stringify(pickedIds()) });
        }).then(function (assetResult) {
          if (assetResult && assetResult.agreement) result.agreement = assetResult.agreement;
          return result;
        });
      },
    };
  }

  /* ------------------------------------------------------------ employee self-service: asset forms on profile */

  var myLoaded = false;
  function profileBanner() {
    if (!/\/people\/profile\/?$/.test(location.pathname) || new URLSearchParams(location.search).get('employee')) {
      myLoaded = false;
      return;
    }
    if (document.querySelector('[data-pa-mine]') || myLoaded) return;
    var anchor = document.querySelector('.me-fields') || document.querySelector('.me-hero');
    if (!anchor) return;
    myLoaded = true;
    call('get_my_asset_agreements').then(function (d) {
      var list = (d && d.agreements) || [];
      if (!list.length || document.querySelector('[data-pa-mine]')) return;
      var host = document.querySelector('.me-hero') || anchor;
      var card = document.createElement('section');
      card.className = 'pa-mine';
      card.setAttribute('data-pa-mine', '1');
      function draw() {
        card.innerHTML = '<h3>My asset forms</h3>' + list.map(function (a) {
          return '<div class="pa-agreement"><div><b>' + esc((a.assets || []).map(function (x) { return x.title; }).join(', ')) + '</b> ' + issuedPill() +
            '<small>' + esc(a.id) + ' · issued ' + esc(fmtDate(a.issued_on)) + '</small></div>' +
            '<span class="pa-agreement-actions"><button type="button" class="pa-link" data-pa-dl="' + esc(a.id) + '">Download PDF</button>' +
            '</span></div>';
        }).join('');
        card.querySelectorAll('[data-pa-dl]').forEach(function (b) { b.addEventListener('click', function () { downloadAgreement(b.getAttribute('data-pa-dl')); }); });
      }
      draw();
      host.parentNode.insertBefore(card, host.nextSibling);
    }).catch(function () { myLoaded = false; });
  }

  /* ------------------------------------------------------------ module permission gating (People portal) */

  var gate = null;
  var gateLoading = false;

  function cleanPath(p) {
    return String(p || '').split('#')[0].split('?')[0].replace(/\/$/, '') || '/';
  }

  function moduleFor(path) {
    var mods = (gate && gate.people_modules) || {};
    var best = null;
    var bestLen = -1;
    Object.keys(mods).forEach(function (name) {
      (mods[name].paths || []).forEach(function (p) {
        var hit = p === '/people' ? path === '/people' : path === p || path.indexOf(p + '/') === 0;
        if (hit && p.length > bestLen) { best = name; bestLen = p.length; }
      });
    });
    return best;
  }

  function pathAllowed(path) {
    if (!gate || !gate.managed) return true;
    path = cleanPath(path);
    if ((gate.always_paths || []).some(function (p) { return path === p || path.indexOf(p + '/') === 0; })) return true;
    var m = moduleFor(path);
    if (!m) return true;
    return (gate.people_modules[m].level || 'none') !== 'none';
  }

  function navTo(href) {
    history.pushState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  function denyToast() {
    if (document.querySelector('[data-pa-denied]')) return;
    var n = document.createElement('div');
    n.setAttribute('data-pa-denied', '1');
    n.className = 'pa-denied';
    n.textContent = 'You do not have access to that module. Ask HR to update your portal permissions.';
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 5000);
  }

  function addSelfServiceLinks(nav) {
    if (nav.querySelector('a[href="/people/employees"]')) return;
    var profile = nav.querySelector('a[href="/people/profile"]');
    if (!profile) return;
    var present = {};
    nav.querySelectorAll('a[href]').forEach(function (a) { present[cleanPath(a.getAttribute('href'))] = true; });
    var anchor = profile;
    Object.keys(gate.people_modules).forEach(function (name) {
      var mod = gate.people_modules[name];
      var first = (mod.paths || [])[0];
      if (!first || first === '/people' || mod.level === 'none' || present[first]) return;
      if (nav.querySelector('[data-pa-added="' + first + '"]')) return;
      var link = profile.cloneNode(true);
      link.setAttribute('href', first);
      link.setAttribute('data-pa-added', first);
      link.classList.remove('active');
      link.removeAttribute('aria-current');
      var label = link.querySelector('span');
      if (label) label.textContent = name;
      link.addEventListener('click', function (e) { e.preventDefault(); navTo(first); });
      anchor.parentNode.insertBefore(link, anchor.nextSibling);
      anchor = link;
    });
    nav.querySelectorAll('[data-pa-added]').forEach(function (a) {
      a.classList.toggle('active', cleanPath(location.pathname) === a.getAttribute('data-pa-added'));
    });
  }

  var gateSid = null;
  function currentSid() {
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      return (s && s.sid) || '';
    } catch (e) { return ''; }
  }

  function ensureGate() {
    var sid = currentSid();
    if (sid !== gateSid) { gate = null; gateLoading = false; gateSid = sid; }
    if (!sid) return false;
    if (!gate && !gateLoading) {
      gateLoading = true;
      call('get_my_portal_permissions').then(function (d) {
        if (gateSid !== sid) return;
        gate = d || {};
        gateLoading = false;
        applyGate();
        applyAestheticGate();
      }).catch(function () { if (gateSid === sid) { gate = {}; gateLoading = false; } });
      return false;
    }
    return !!gate;
  }

  function applyGate() {
    if (!/^\/people(\/|$)/.test(location.pathname)) return;
    if (!ensureGate() || !gate.managed) return;
    var nav = document.querySelector('.hrms-sidebar nav') || document.querySelector('aside nav');
    if (nav) {
      addSelfServiceLinks(nav);
      nav.querySelectorAll('a[href]').forEach(function (a) {
        var hide = !pathAllowed(a.getAttribute('href'));
        if (hide && a.style.display !== 'none') a.style.display = 'none';
        if (!hide && a.style.display === 'none') a.style.display = '';
      });
      nav.querySelectorAll('.hrms-nav-group').forEach(function (g) {
        var visible = Array.prototype.some.call(g.querySelectorAll('a[href]'), function (a) { return a.style.display !== 'none'; });
        g.style.display = visible ? '' : 'none';
      });
    }
    document.querySelectorAll('.mobile-bottom-nav a[href], nav[class*="bottom"] a[href]').forEach(function (a) {
      if (!pathAllowed(a.getAttribute('href'))) a.style.display = 'none';
    });
    if (!pathAllowed(location.pathname)) {
      history.replaceState(null, '', '/people/profile');
      window.dispatchEvent(new PopStateEvent('popstate'));
      denyToast();
    }
  }

  /* ------------------------------------------------------------ module permission gating (Aesthetic Backend) */

  function aestheticBase() {
    if (location.hostname === 'aesthetics.e-remedium.in') return '';
    if (/^\/aesthetic-admin(\/|$)/.test(location.pathname)) return '/aesthetic-admin';
    return null;
  }

  function aestheticBlock(show) {
    var el = document.querySelector('[data-pa-ae-block]');
    if (!show) { if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement('div');
    el.setAttribute('data-pa-ae-block', '1');
    el.className = 'pa-block';
    el.innerHTML = '<div class="pa-block-card"><h2>No access to Aesthetic Backend</h2>' +
      '<p>Your login has not been given access to this portal. Ask HR to add Aesthetic Backend in your Portal Access.</p>' +
      '<a class="pa-btn primary" href="https://people.e-remedium.in/people/profile">Go to my HRMS profile</a></div>';
    document.body.appendChild(el);
  }

  function applyAestheticGate() {
    var base = aestheticBase();
    if (base === null) { aestheticBlock(false); return; }
    if (!ensureGate()) { if (!currentSid()) aestheticBlock(false); return; }
    if (!gate.managed) { aestheticBlock(false); return; }
    var mods = (gate.portal_modules || {}).aesthetics;
    var open = mods && Object.keys(mods).some(function (m) { return mods[m].level !== 'none'; });
    aestheticBlock(!open);
    if (!open) return;
    function moduleOf(path) {
      path = cleanPath(path);
      if (base && path.indexOf(base) === 0) path = path.slice(base.length) || '/';
      var best = null;
      var bestLen = -1;
      Object.keys(mods).forEach(function (name) {
        (mods[name].paths || []).forEach(function (p) {
          var hit = p === '/' ? path === '/' : path === p || path.indexOf(p + '/') === 0;
          if (hit && p.length > bestLen) { best = name; bestLen = p.length; }
        });
      });
      return best;
    }
    function allowed(path) {
      var m = moduleOf(path);
      return !m || mods[m].level !== 'none';
    }
    document.querySelectorAll('.aea-nav a[href]:not([data-pa-hrp])').forEach(function (a) {
      var hide = !allowed(a.getAttribute('href'));
      a.style.display = hide ? 'none' : '';
    });
    document.querySelectorAll('.aea-nav-group').forEach(function (g) {
      var btn = g.querySelector('.aea-nav-group-btn');
      var name = btn ? btn.textContent.trim() : '';
      g.style.display = mods[name] && mods[name].level === 'none' ? 'none' : '';
    });
    if (!allowed(location.pathname)) {
      var first = Object.keys(mods).filter(function (m) { return mods[m].level !== 'none'; })[0];
      var target = (mods[first].paths || ['/'])[0];
      target = base ? (target === '/' ? base : base + target) : target;
      history.replaceState(null, '', target);
      window.dispatchEvent(new PopStateEvent('popstate'));
      denyToast();
    }
  }

  /* ------------------------------------------------------------ My HR Profile inside the Aesthetic console */

  var hrp = { open: false };
  var USER_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>';

  function fitFrame() {
    var frame = document.querySelector('.pa-hrp-frame');
    if (frame) frame.style.height = Math.max(420, window.innerHeight - frame.getBoundingClientRect().top) + 'px';
  }
  window.addEventListener('resize', fitFrame);

  function hrpShow(open) {
    hrp.open = open;
    var main = document.querySelector('.aea-main');
    var link = document.querySelector('[data-pa-hrp]');
    if (link) link.classList.toggle('is-active', open);
    var shell = document.querySelector('.aea-shell');
    if (shell) shell.classList.toggle('pa-hrp-on', open);
    if (!main) return;
    main.classList.toggle('pa-hrp-on', open);
    var panel = main.querySelector('.pa-hrp');
    if (!open) { if (panel) panel.remove(); return; }
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'pa-hrp';
      var content = main.querySelector('.aea-content');
      if (content) content.parentNode.insertBefore(panel, content.nextSibling);
      else main.appendChild(panel);
    }
    if (!panel.querySelector('.pa-hrp-frame')) {
      panel.innerHTML = '<iframe class="pa-hrp-frame" title="My HR Workspace" src="/people/profile?pa_embed=1"></iframe>';
    }
    window.scrollTo(0, 0);
    fitFrame();
  }

  function aestheticProfileLink() {
    if (aestheticBase() === null || !currentSid()) return;
    var nav = document.querySelector('.aea-nav');
    if (!nav || nav.querySelector('[data-pa-hrp]')) {
      if (hrp.open && !document.querySelector('.aea-main.pa-hrp-on')) hrpShow(true);
      return;
    }
    var link = document.createElement('a');
    link.href = '#my-hr-profile';
    link.className = 'aea-nav-link';
    link.setAttribute('data-pa-hrp', '1');
    link.innerHTML = USER_ICON + '<span>My HR Workspace</span>';
    link.addEventListener('click', function (e) {
      e.preventDefault();
      hrpShow(true);
      document.querySelector('.aea-shell') && document.querySelector('.aea-shell').classList.remove('nav-open');
    });
    var settings = Array.prototype.filter.call(nav.querySelectorAll('a.aea-nav-link'), function (a) { return /\/settings$/.test(a.getAttribute('href') || ''); })[0];
    if (settings) nav.insertBefore(link, settings);
    else nav.appendChild(link);
    if (hrp.open) hrpShow(true);
  }

  document.addEventListener('click', function (e) {
    if (!hrp.open || !e.target.closest) return;
    var a = e.target.closest('.aea-sidebar a[href], .aea-top a[href]');
    if (a && !a.hasAttribute('data-pa-hrp')) hrpShow(false);
  }, true);
  window.addEventListener('popstate', function () { if (hrp.open) hrpShow(false); });

  /* ------------------------------------------------------------ HR workspace embedded in another console */

  // Other Smilecure consoles (on their own domain) that may embed this workspace and hand over their sign-in.
  var EMBED_PARENTS = [
    'https://ops.e-remedium.in',
    'https://labtech.e-remedium.in',
    'https://collect.remediumlabs.in',
    'https://www.remediumlabs.in',
    'https://remediumlabs.in',
  ];

  function embedParent() {
    var origin = '';
    var ancestors = location.ancestorOrigins;
    if (ancestors && ancestors.length) {
      origin = ancestors[0];
    } else {
      // No ancestorOrigins (Firefox): the first load's referrer is the parent; later in-frame loads reuse it.
      try { origin = new URL(document.referrer).origin; } catch (e) { origin = ''; }
      if (EMBED_PARENTS.indexOf(origin) === -1) origin = sessionStorage.getItem('pa_embed_parent') || '';
    }
    if (EMBED_PARENTS.indexOf(origin) === -1) return '';
    sessionStorage.setItem('pa_embed_parent', origin);
    return origin;
  }

  var embedded = (function () {
    if (window.self === window.top) return false;
    var sameOrigin = false;
    try { sameOrigin = window.top.location.origin === location.origin; } catch (e) { sameOrigin = false; }
    if (!sameOrigin) return !!embedParent();
    if (/[?&]pa_embed=1/.test(location.search)) sessionStorage.setItem('pa_embed', '1');
    return sessionStorage.getItem('pa_embed') === '1';
  })();
  if (embedded) document.documentElement.classList.add('pa-embed');

  if (embedded && embedParent()) {
    window.addEventListener('message', function (e) {
      if (e.origin !== embedParent() || !e.data || e.data.type !== 'pa-embed-session') return;
      var s = e.data.session || {};
      if (!s.sid || s.sid === currentSid()) return;
      localStorage.setItem('hec_web_session', JSON.stringify({
        sid: String(s.sid),
        user: String(s.user || ''),
        fullName: String(s.fullName || s.user || ''),
        roles: Array.isArray(s.roles) ? s.roles.map(String) : [],
        franchisee: null,
      }));
      location.replace('/people/profile');
    });
    window.parent.postMessage({ type: 'pa-embed-ready' }, embedParent());
  }

  function embedTabs() {
    if (!embedded) return;
    if (!/^\/(people|login)(\/|$)/.test(location.pathname)) {
      location.replace('/people/profile');
      return;
    }
    var content = document.querySelector('.hrms-content');
    if (!content) return;
    var group = Array.prototype.filter.call(document.querySelectorAll('.hrms-sidebar .hrms-nav-group'), function (g) {
      return g.querySelector('a[href="/people/profile"]');
    })[0];
    var items = (group ? Array.prototype.slice.call(group.querySelectorAll('a[href]')) : [])
      .filter(function (a) { return a.style.display !== 'none'; })
      .map(function (a) { return { href: a.getAttribute('href'), label: a.textContent.trim() }; });
    if (!items.length) items = [{ href: '/people/profile', label: 'Profile' }];
    var path = cleanPath(location.pathname);
    var sig = JSON.stringify(items) + path;
    var bar = document.querySelector('.pa-embed-tabs');
    if (bar && bar.getAttribute('data-sig') === sig && bar.nextElementSibling === content) return;
    if (!bar) {
      bar = document.createElement('nav');
      bar.className = 'pa-embed-tabs';
      bar.setAttribute('aria-label', 'My HR workspace');
      bar.addEventListener('click', function (e) {
        var a = e.target.closest('a[href]');
        if (!a) return;
        e.preventDefault();
        navTo(a.getAttribute('href'));
      });
    }
    bar.setAttribute('data-sig', sig);
    bar.innerHTML = items.map(function (it) {
      var on = path === it.href || path.indexOf(it.href + '/') === 0;
      return '<a href="' + esc(it.href) + '"' + (on ? ' class="on" aria-current="page"' : '') + '>' + esc(it.label) + '</a>';
    }).join('');
    content.parentNode.insertBefore(bar, content);
  }

  /* ------------------------------------------------------------ My Profile in the lab / collection portals */

  var PEOPLE_ORIGIN = 'https://people.e-remedium.in';

  function fitWorkspace() {
    var frame = document.querySelector('.pa-ws-frame');
    if (frame) frame.style.height = Math.max(480, window.innerHeight - frame.getBoundingClientRect().top - 8) + 'px';
  }
  window.addEventListener('resize', fitWorkspace);

  function profileWorkspace() {
    if (embedded || location.origin === PEOPLE_ORIGIN) return;
    var page = document.querySelector('.mp2-page');
    if (!page || !currentSid()) return;
    if (page.querySelector('.pa-ws')) return;
    page.classList.add('pa-ws-on');
    var box = document.createElement('div');
    box.className = 'pa-ws';
    box.innerHTML = '<iframe class="pa-ws-frame" title="My Profile" src="' + PEOPLE_ORIGIN + '/people/profile?pa_embed=1"></iframe>';
    page.appendChild(box);
    fitWorkspace();
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== PEOPLE_ORIGIN || !e.data || e.data.type !== 'pa-embed-ready') return;
    var frame = document.querySelector('.pa-ws-frame');
    if (!frame || e.source !== frame.contentWindow) return;
    var s = null;
    try { s = JSON.parse(localStorage.getItem('hec_web_session') || 'null'); } catch (err) { s = null; }
    if (!s || !s.sid) return;
    frame.contentWindow.postMessage({
      type: 'pa-embed-session',
      session: { sid: s.sid, user: s.user, fullName: s.fullName, roles: s.roles || [] },
    }, PEOPLE_ORIGIN);
  });

  var portalsShown = false;
  function portalsCard() {
    if (!/\/people\/profile\/?$/.test(location.pathname) || new URLSearchParams(location.search).get('employee')) { portalsShown = false; return; }
    if (!gate || !(gate.portals || []).length || document.querySelector('[data-pa-portals]')) return;
    var host = document.querySelector('.me-hero');
    if (!host || portalsShown) return;
    portalsShown = true;
    var card = document.createElement('section');
    card.className = 'pa-mine';
    card.setAttribute('data-pa-portals', '1');
    card.innerHTML = '<h3>My portals</h3>' + gate.portals.map(function (p) {
      var allowed = Object.keys(p.permissions || {}).filter(function (m) { return p.permissions[m] !== 'none'; });
      return '<div class="pa-agreement"><div><b>' + esc(p.label) + '</b><small>' + esc(allowed.length ? allowed.join(', ') : 'No modules enabled') + '</small></div>' +
        '<span class="pa-agreement-actions"><a class="pa-link" href="' + esc(p.url) + '" target="_blank" rel="noopener">Open</a></span></div>';
    }).join('');
    host.parentNode.insertBefore(card, host.nextSibling);
  }

  function tick() { profileBanner(); applyGate(); applyAestheticGate(); aestheticProfileLink(); embedTabs(); profileWorkspace(); portalsCard(); }
  new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
  tick();
  window.addEventListener('load', tick);
  window.addEventListener('popstate', function () { myLoaded = false; });

  window.PeopleAccess = { mountEditor: mountEditor, download: downloadAgreement };
})();
