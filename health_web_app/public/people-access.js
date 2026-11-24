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
    }).then(function (r) {
      return r.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : {}; } catch (e) {
          var snippet = String(text || '').replace(/\s+/g, ' ').slice(0, 160);
          throw new Error('Server error while saving (HTTP ' + r.status + '). ' + (snippet.indexOf('<html') !== -1 ? 'Please retry in a few seconds.' : snippet));
        }
        if (!r.ok) {
          var errMsg = (json && json.message && (json.message.message || json.message)) || ('Request failed (' + r.status + ')');
          throw new Error(String(errMsg).replace(/<[^>]+>/g, ''));
        }
        return json;
      });
    }).then(function (json) {
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

  function issuedPill(a) {
    var status = (a && a.status) || 'Issued';
    return '<span class="pa-pill ' + (status === 'Signed' ? 'ok' : 'warn') + '">' + esc(status) + '</span>';
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
        return [k, r.login_id, r.active, r.permissions, !!r.password, r.branches || []];
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
          portalModules(p).map(function (m) {
            var org = (p.org_modules || []).indexOf(m) !== -1;
            var meta = (p.module_meta && p.module_meta[m]) || {};
            var indent = meta.indent ? ' class="pa-mod-sub"' : '';
            var mark = meta.indent ? '<span class="pa-mod-indent">↳ </span>' : '';
            return '<tr' + indent + '><td>' + mark + esc(m) + (org ? ' <span class="pa-tag">HR menu</span>' : '') + '</td><td><select data-pa-module="' + esc(m) + '">' + levels.map(function (l) {
              return '<option value="' + l.value + '"' + ((r.permissions[m] || 'none') === l.value ? ' selected' : '') + '>' + esc(l.label) + '</option>';
            }).join('') + '</select></td></tr>';
          }).join('') + '</tbody></table>' +
          (k === 'care' || k === 'aesthetics' ? portalBranchesHtml(r, k) : '') +
          (k === 'crm' ? portalCrmCategoriesHtml(r, p) : '') +
          (k === 'labtech' ? portalLabtechUserTypeHtml(r, p) : '') +
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

    function careManager(r) {
      return Object.keys(r.permissions).some(function (m) { return r.permissions[m] === 'manage'; });
    }

    function aesManager(r) {
      return (r.permissions.Settings || 'none') !== 'none';
    }

    /* Mother modules only — grant covers all CRM sidebar submodules. */
    var CRM_MODULES_FALLBACK = [
      'Dashboard',
      'Service Lead',
      'Franchise Lead',
      'Contacts',
      'Accounts',
      'Deals',
      'Service Followup',
      'Franchise Followup',
      'WhatsApp Centre',
      'Bookings',
      'Franchise (FFMS/RFMS)',
      'Partner Unit Bookings',
      'Campaigns',
      'Reports & Analytics',
      'Settings',
    ];

    function portalModules(p) {
      var mods = (p && p.modules) || [];
      if (p && p.key === 'aesthetics') mods = mods.filter(function (m) { return m !== 'Employees'; });
      if (p && p.key === 'crm') {
        var stale = !mods.length || mods.indexOf('Leads') !== -1 || mods.indexOf('Service Lead · Aesthetic') !== -1 || mods.indexOf('Service Lead') === -1;
        if (stale) {
          p.modules = CRM_MODULES_FALLBACK.slice();
          p.module_meta = {};
          mods = p.modules;
        }
        var r = state.rows && state.rows.crm;
        if (r && r.permissions) {
          var perms = r.permissions;
          function lift(from, toList) {
            var lvl = perms[from];
            if (!lvl || lvl === 'none') return;
            toList.forEach(function (name) {
              if (!perms[name] || perms[name] === 'none') perms[name] = lvl;
            });
          }
          lift('Leads', ['Service Lead', 'Franchise Lead']);
          lift('Activities', ['Service Followup', 'Franchise Followup']);
          lift('Franchise', ['Franchise (FFMS/RFMS)']);
          lift('Partner Bookings', ['Partner Unit Bookings']);
          lift('Reports', ['Reports & Analytics']);
        }
      }
      return mods;
    }

    function crmManager(r) {
      var perms = (r && r.permissions) || {};
      return Object.keys(perms).some(function (m) { return perms[m] === 'manage'; });
    }

    function portalCrmCategoriesHtml(r, p) {
      var opts = (p && p.category_options) || state.access.crm_categories || [
        { id: 'service', name: 'Service', hint: 'Lab / Aesthetic / Care' },
        { id: 'franchise', name: 'Franchise', hint: 'Lab / Aesthetic / Care / NexiLab' },
      ];
      var picked = r.branches || [];
      var every = picked.indexOf('*') !== -1;
      var manager = crmManager(r);
      var roleHint = (p && p.role_labels && p.role_labels.hint) ||
        'Manager = Manage on any module (sees all activity in selected modules). Executive = only assigned modules and categories.';
      var roleLabel = manager ? 'Manager' : 'Executive';
      var allBox = manager
        ? '<label class="pa-branch' + (every ? ' on' : '') + '"><input type="checkbox" data-pa-crm-cat="*"' + (every ? ' checked' : '') + ' /> All categories <small>(Service + Franchise)</small></label>'
        : '';
      return '<div class="pa-branches"><div class="pa-branches-head"><b>CRM role &amp; categories</b><small>Role: <b>' + esc(roleLabel) + '</b> · ' + esc(roleHint) + '</small></div>' +
        '<div class="pa-branch-list">' + allBox +
        opts.map(function (c) {
          var on = !every && picked.indexOf(c.id) !== -1;
          return '<label class="pa-branch' + (on ? ' on' : '') + '"><input type="checkbox" data-pa-crm-cat="' + esc(c.id) + '"' + (on ? ' checked' : '') + (every ? ' disabled' : '') + ' /> ' +
            esc(c.name) + (c.hint ? ' <small>' + esc(c.hint) + '</small>' : '') + '</label>';
        }).join('') + '</div>' +
        '<p class="pa-muted">Executives only see WhatsApp chats for their assigned categories. Managers with Manage access see all chats for the modules you enable above.</p></div>';
    }

    var LABTECH_USER_TYPES_FALLBACK = [
      { id: 'lab_manager', name: 'Lab Manager', hint: 'Full lab operations · can sign & finalize reports', can_sign: 1 },
      { id: 'qc_manager', name: 'Quality Control Manager', hint: 'QC / NABL oversight · can sign & finalize reports', can_sign: 1 },
      { id: 'lab_technician', name: 'Lab Technician', hint: 'Result entry & bench work · cannot sign reports', can_sign: 0 },
      { id: 'accessor', name: 'Accessor', hint: 'Sample accession & bookings · cannot sign reports', can_sign: 0 },
    ];

    function labtechUserType(r) {
      var picked = (r && r.branches) || [];
      var known = LABTECH_USER_TYPES_FALLBACK.map(function (t) { return t.id; });
      for (var i = 0; i < picked.length; i++) {
        if (known.indexOf(picked[i]) !== -1) return picked[i];
      }
      return '';
    }

    function portalLabtechUserTypeHtml(r, p) {
      var opts = (p && p.user_types && p.user_types.length) ? p.user_types : LABTECH_USER_TYPES_FALLBACK;
      var chosen = labtechUserType(r);
      var hint = (p && p.role_labels && p.role_labels.hint) ||
        'Pick one LabTech user type. Only Lab Manager and Quality Control Manager can sign & finalize reports.';
      var chosenLabel = '';
      opts.forEach(function (t) { if (t.id === chosen) chosenLabel = t.name; });
      return '<div class="pa-branches"><div class="pa-branches-head"><b>LabTech user type</b><small>' +
        (chosenLabel ? 'Selected: <b>' + esc(chosenLabel) + '</b> · ' : '') + esc(hint) + '</small></div>' +
        '<div class="pa-branch-list pa-labtech-types">' +
        opts.map(function (t) {
          var on = chosen === t.id;
          var sign = Number(t.can_sign) ? ' <em class="pa-tag">Sign &amp; finalize</em>' : '';
          return '<label class="pa-branch' + (on ? ' on' : '') + '"><input type="radio" name="pa-labtech-type" data-pa-labtech-type="' +
            esc(t.id) + '"' + (on ? ' checked' : '') + ' /> <span><b>' + esc(t.name) + '</b>' + sign +
            (t.hint ? '<small>' + esc(t.hint) + '</small>' : '') + '</span></label>';
        }).join('') + '</div>' +
        '<p class="pa-muted">Pathologist sign &amp; finalize is allowed only for Lab Manager and Quality Control Manager.</p></div>';
    }

    function portalBranchesHtml(r, portal) {
      var aes = portal === 'aesthetics';
      var manager = aes ? aesManager(r) : careManager(r);
      var all = ((aes ? state.access.aes_branches : state.access.care_branches) || []).filter(function (b) { return b.active; });
      var picked = r.branches || [];
      var every = picked.indexOf('*') !== -1;
      if (aes && !manager && every) every = false;
      var unitId = aes ? state.access.aes_unit_branch : state.access.unit_branch;
      var unitBranch = all.filter(function (b) { return b.id === unitId; })[0];
      var kind = aes ? 'Aesthetic' : 'Remedium Care';
      var unitText = state.access.unit
        ? 'Unit / Centre in HRMS: <b>' + esc(state.access.unit) + '</b>' + (unitBranch ? ' → ' + esc(unitBranch.name) + ' branch' : ' (not a ' + kind + ' branch)')
        : 'No Unit / Centre is set in HRMS for this employee.';
      var hint = aes
        ? 'Leave every branch unticked to use the branch of the Unit / Centre. Staff work in one branch and cannot switch. All branches, or more than one, needs Settings access (clinic manager).'
        : 'Leave every branch unticked to use the branch of the Unit / Centre. Staff work in one branch; more than one, or All branches, needs Manage on at least one Care module (Care Manager).';
      var allBox = manager
        ? '<label class="pa-branch' + (every ? ' on' : '') + '"><input type="checkbox" data-pa-branch="*"' + (every ? ' checked' : '') + ' /> All branches <small>(including new ones)</small></label>'
        : '';
      return '<div class="pa-branches"><div class="pa-branches-head"><b>Branches</b><small>' + unitText + '</small></div>' +
        (all.length ? '<div class="pa-branch-list">' + allBox +
          all.map(function (b) {
            var on = !every && picked.indexOf(b.id) !== -1;
            return '<label class="pa-branch' + (on ? ' on' : '') + '"><input type="checkbox" data-pa-branch="' + b.id + '"' + (on ? ' checked' : '') + (every ? ' disabled' : '') + ' /> ' + esc(b.name) + (b.city && b.city !== b.name ? ' <small>' + esc(b.city) + '</small>' : '') + '</label>';
          }).join('') + '</div>' : '<p class="pa-err">Could not load the ' + kind + ' branches. Try again in a moment.</p>') +
        '<p class="pa-muted">' + hint + '</p></div>';
    }

    function summaryText(p, r) {
      var listed = portalModules(p);
      var on = listed.filter(function (m) { return (r.permissions[m] || 'none') !== 'none'; });
      var hr = on.some(function (m) { return (p.org_modules || []).indexOf(m) !== -1; }) ||
        on.some(function (m) { return ['approve', 'manage'].indexOf(r.permissions[m]) !== -1; });
      var menu = p.key === 'people' ? (hr ? ' · gets the HR menu' : ' · gets the employee self-service menu') : '';
      var crmRole = '';
      if (p.key === 'crm') {
        var mgr = on.some(function (m) { return r.permissions[m] === 'manage'; });
        var cats = (r.branches || []).filter(function (x) { return x === '*' || x === 'service' || x === 'franchise'; });
        var catText = cats.indexOf('*') !== -1 ? 'all categories' : (cats.length ? cats.join(' + ') : 'no category');
        crmRole = ' · ' + (mgr ? 'Manager' : 'Executive') + ' · ' + catText;
      }
      var labType = '';
      if (p.key === 'labtech') {
        var tid = labtechUserType(r);
        var trow = LABTECH_USER_TYPES_FALLBACK.filter(function (t) { return t.id === tid; })[0];
        labType = trow ? ' · ' + trow.name : ' · no user type';
      }
      return '<b>' + on.length + ' of ' + listed.length + '</b> modules enabled' + menu + crmRole + labType + (r.active ? '' : ' · portal disabled');
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

    function inferCrmCategories(r) {
      var perms = (r && r.permissions) || {};
      var cats = [];
      var has = function (m) { return (perms[m] || 'none') !== 'none'; };
      if (has('Service Lead') || has('Service Followup') || has('Bookings')) cats.push('service');
      if (has('Franchise Lead') || has('Franchise Followup') || has('Franchise (FFMS/RFMS)') || has('Franchise')) cats.push('franchise');
      if (!cats.length && (has('Contacts') || has('Accounts') || has('Deals') || has('WhatsApp Centre') || has('Dashboard'))) {
        cats = ['service', 'franchise'];
      }
      if (crmManager(r) && cats.length === 2) return ['*'];
      if (crmManager(r) && !cats.length) return ['*'];
      return cats;
    }

    function crmPermissionsForSave(r) {
      var perms = Object.assign({}, (r && r.permissions) || {});
      var rank = { none: 0, view: 1, create: 2, edit: 3, approve: 4, manage: 5 };
      var best = function () {
        var lvl = 'none', i, n, args = arguments;
        for (i = 0; i < args.length; i++) {
          n = perms[args[i]] || 'none';
          if ((rank[n] || 0) > (rank[lvl] || 0)) lvl = n;
        }
        return lvl;
      };
      // Dual-write legacy keys so a stale backend cannot wipe the assignment.
      perms.Leads = best('Leads', 'Service Lead', 'Franchise Lead');
      perms.Activities = best('Activities', 'Service Followup', 'Franchise Followup');
      perms.Franchise = best('Franchise', 'Franchise (FFMS/RFMS)');
      perms['Partner Bookings'] = best('Partner Bookings', 'Partner Unit Bookings');
      perms.Reports = best('Reports', 'Reports & Analytics');
      return perms;
    }

    function accessPayload() {
      return Object.keys(state.rows).map(function (k) {
        var r = state.rows[k];
        if (k === 'crm') {
          var cats = (r.branches || []).filter(function (x) { return x === '*' || x === 'service' || x === 'franchise'; });
          if (!cats.length) {
            r.branches = inferCrmCategories(r);
          }
        }
        var out = {
          portal: k,
          login_id: r.login_id,
          password: r.password || '',
          permissions: k === 'crm' ? crmPermissionsForSave(r) : r.permissions,
          active: r.active ? 1 : 0,
        };
        if (k === 'care' || k === 'aesthetics' || k === 'crm' || k === 'labtech') out.branches = r.branches || [];
        return out;
      });
    }

    function applySavedState(d) {
      state.access = d;
      state.rows = {};
      d.access.forEach(function (a) {
        state.rows[a.portal] = { login_id: a.login_id, permissions: a.permissions, active: a.active, existing: true, login_enabled: a.login_enabled, last_login: a.last_login, granted_by: a.granted_by, password: '', password2: '', branches: a.branches || [] };
      });
      state.original = snapshotAccess();
    }

    function saveAccessNow() {
      var status = accessBox.querySelector('[data-pa-status]');
      var btn = accessBox.querySelector('[data-pa-save]');
      if (!status) return;
      var invalid = validateAccess();
      if (invalid) {
        status.textContent = invalid;
        status.className = 'pa-save-status error';
        try { status.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Saving…';
      status.textContent = 'Saving…';
      status.className = 'pa-save-status dirty';
      var payload = accessPayload();
      call('save_employee_portal_access', { employee: employeeId, access: JSON.stringify(payload) }).then(function (res) {
        applySavedState(res.state);
        drawAccess();
        var s = accessBox.querySelector('[data-pa-status]');
        if (!s) return;
        s.textContent = 'Saved. The employee sees the new access the next time their portal loads.';
        s.className = 'pa-save-status ok';
        s.setAttribute('data-saved', '1');
        var saveBtn = accessBox.querySelector('[data-pa-save]');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save portal access'; }
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = 'Save portal access';
        status.textContent = (e && e.message) || 'Could not save portal access';
        status.className = 'pa-save-status error';
        try { status.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (err) {}
      });
    }

    function validateAccess() {
      var keys = Object.keys(state.rows);
      for (var i = 0; i < keys.length; i++) {
        var r = state.rows[keys[i]];
        var label = (state.access.portals.filter(function (x) { return x.key === keys[i]; })[0] || {}).label || keys[i];
        if (!r.login_id) return label + ': enter a login ID';
        if (r.password !== r.password2) return label + ': passwords do not match';
        if (keys[i] === 'care' && ((r.branches || []).indexOf('*') !== -1 || (r.branches || []).length > 1) && !careManager(r)) {
          return label + ': only a Care Manager (Manage on at least one module) can work in more than one branch';
        }
        if (keys[i] === 'aesthetics' && ((r.branches || []).indexOf('*') !== -1 || (r.branches || []).length > 1) && !aesManager(r)) {
          return label + ': only staff with Settings access can work in more than one branch';
        }
        if (keys[i] === 'crm') {
          var cats = (r.branches || []).filter(function (x) { return x === '*' || x === 'service' || x === 'franchise'; });
          if (!cats.length) {
            cats = inferCrmCategories(r);
            r.branches = cats;
          }
          if (!cats.length) {
            return label + ': tick Service and/or Franchise under CRM role & categories, then Save';
          }
          if (cats.indexOf('*') !== -1 && !crmManager(r)) {
            return label + ': only a CRM Manager (Manage on any module) can have all categories';
          }
        }
        if (keys[i] === 'labtech' && !labtechUserType(r)) {
          return label + ': pick a LabTech user type (Lab Manager, Quality Control Manager, Lab Technician, or Accessor)';
        }
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
            portalModules(p).forEach(function (m) { perms[m] = (p.defaults && p.defaults[m]) || 'none'; });
            var shared = Object.keys(state.rows).map(function (x) { return state.rows[x].login_id; }).filter(Boolean)[0];
            state.rows[k] = {
              login_id: shared || state.access.default_login || '',
              permissions: perms,
              active: 1,
              password: '',
              password2: '',
              branches: k === 'crm' ? ['service', 'franchise'] : (k === 'labtech' ? ['lab_technician'] : []),
            };
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
          sel.addEventListener('change', function () {
            r.permissions[sel.getAttribute('data-pa-module')] = sel.value;
            if (k === 'aesthetics' && sel.getAttribute('data-pa-module') === 'Settings') {
              if (!aesManager(r) && (r.branches || []).indexOf('*') !== -1) r.branches = [];
              drawAccess();
              return;
            }
            if (k === 'crm') {
              if (!crmManager(r) && (r.branches || []).indexOf('*') !== -1) r.branches = ['service', 'franchise'];
              drawAccess();
              return;
            }
            refreshSummaries();
          });
        });
        card.querySelectorAll('[data-pa-branch]').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var v = cb.getAttribute('data-pa-branch');
            var list = (r.branches || []).filter(function (x) { return x !== '*'; });
            if (v === '*') list = cb.checked ? ['*'] : [];
            else {
              var id = Number(v);
              list = list.filter(function (x) { return x !== id; });
              if (cb.checked) list.push(id);
            }
            r.branches = list;
            drawAccess();
          });
        });
        card.querySelectorAll('[data-pa-crm-cat]').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var v = cb.getAttribute('data-pa-crm-cat');
            var list = (r.branches || []).filter(function (x) { return x !== '*'; });
            if (v === '*') list = cb.checked ? ['*'] : [];
            else {
              list = list.filter(function (x) { return x !== v; });
              if (cb.checked) list.push(v);
            }
            r.branches = list;
            drawAccess();
          });
        });
        card.querySelectorAll('[data-pa-labtech-type]').forEach(function (rb) {
          rb.addEventListener('change', function () {
            if (!rb.checked) return;
            var tid = rb.getAttribute('data-pa-labtech-type');
            r.branches = tid ? [tid] : [];
            // Managers get the Pathologist module, which includes signed reports.
            var signers = { lab_manager: 1, qc_manager: 1 };
            if (signers[tid]) {
              if ((r.permissions.Pathologist || 'none') === 'none') r.permissions.Pathologist = 'approve';
              if ((r.permissions['Report lifecycle'] || 'none') === 'none') r.permissions['Report lifecycle'] = 'approve';
            } else {
              r.permissions.Pathologist = 'none';
            }
            drawAccess();
          });
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
          return '<div class="pa-agreement"><div><b>' + esc(a.id) + '</b> · ' + esc(fmtDate(a.issued_on)) + ' · ' + a.assets.length + ' asset(s) ' + issuedPill(a) +
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
          return '<div class="pa-agreement"><div><b>' + esc((a.assets || []).map(function (x) { return x.title; }).join(', ')) + '</b> ' + issuedPill(a) +
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
        applyLabGate();
        paintLabProfile();
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
      g.style.display = name === 'Employees' || (mods[name] && mods[name].level === 'none') ? 'none' : '';
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

  /* ------------------------------------------------------------ module permission gating (Lab Technician portal) */

  function matchModule(mods, path) {
    path = cleanPath(path);
    var best = null;
    var bestLen = -1;
    Object.keys(mods).forEach(function (name) {
      (mods[name].paths || []).forEach(function (p) {
        if ((path === p || path.indexOf(p + '/') === 0) && p.length > bestLen) { best = name; bestLen = p.length; }
      });
    });
    return best;
  }

  function profileName() {
    var session = {};
    try { session = JSON.parse(localStorage.getItem('hec_web_session') || 'null') || {}; } catch (e) {}
    var name = String((gate && gate.full_name) || session.fullName || session.full_name || '').trim();
    if (!name || name.indexOf('@') !== -1) {
      var alt = String(session.fullName || session.full_name || '').trim();
      if (alt && alt.indexOf('@') === -1) name = alt;
    }
    return name.indexOf('@') === -1 ? name : '';
  }

  function profilePhoto() {
    var raw = String((gate && gate.user_image) || '').trim();
    if (!raw || /gravatar\.com/i.test(raw)) return '';
    if (/^https?:\/\//i.test(raw) || raw.charAt(0) === '/') return raw;
    return '/' + raw;
  }

  function paintLabProfile() {
    if ((location.hostname || '').toLowerCase() !== 'labtech.e-remedium.in' || embedded) return;
    ensureGate();
    var name = profileName();
    var photo = profilePhoto();
    if (name) {
      document.querySelectorAll('.lt-user-name, .lt-user-menu-name, .layout-labtech .sidebar-user').forEach(function (el) {
        if (el.textContent !== name) el.textContent = name;
      });
    }
    if (!photo) return;
    document.querySelectorAll('.lt-avatar').forEach(function (el) {
      var img = el.querySelector('img.lt-avatar-img');
      if (!img) {
        el.textContent = '';
        img = document.createElement('img');
        img.className = 'lt-avatar-img';
        img.alt = '';
        img.addEventListener('error', function () {
          img.remove();
          if (!el.textContent) el.textContent = (name || 'U').split(/\s+/).filter(Boolean).slice(0, 2).map(function (p) { return p.charAt(0); }).join('').toUpperCase();
        });
        el.appendChild(img);
      }
      if (img.getAttribute('src') !== photo) img.setAttribute('src', photo);
    });
  }

  function applyLabGate() {
    if (location.hostname !== 'labtech.e-remedium.in' || embedded) return;
    if (!ensureGate() || !gate.managed) return;
    var mods = (gate.portal_modules || {}).labtech;
    if (!mods) return;
    function allowed(path) {
      // Report Template and Test Master stay on their own address after refresh.
      if (path === '/dashboard/settings' || path.indexOf('/dashboard/settings/') === 0) return true;
      if (path === '/dashboard/test-master' || path.indexOf('/dashboard/test-master/') === 0) return true;
      var m = matchModule(mods, path);
      return !m || mods[m].level !== 'none';
    }
    document.querySelectorAll('.lt-side-link[href]').forEach(function (a) {
      a.style.display = allowed(a.getAttribute('href')) ? '' : 'none';
    });
    if (!allowed(location.pathname)) {
      var first = Object.keys(mods).filter(function (m) { return mods[m].level !== 'none'; })[0];
      history.replaceState(null, '', first ? mods[first].paths[0] : '/dashboard/profile');
      window.dispatchEvent(new PopStateEvent('popstate'));
      denyToast();
    }
  }

  /* ------------------------------------------------------------ My HR Profile inside the Aesthetic console */

  var hrp = { open: false };
  var PEOPLE_ORIGIN = 'https://people.e-remedium.in';
  var PEOPLE_EMBED_PROFILE = PEOPLE_ORIGIN + '/people/profile?pa_embed=1&tab=hr';
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
    /* People is host-only — embed people.e-remedium.in and hand over hec_web_session (same as Reach). */
    if (!panel.querySelector('.pa-hrp-frame')) {
      panel.innerHTML =
        '<iframe class="pa-hrp-frame" title="My HR Workspace" src="' +
        PEOPLE_EMBED_PROFILE +
        '" allow="geolocation *"></iframe>';
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
    'https://crm.e-remedium.in',
    'https://ops.e-remedium.in',
    'https://care.e-remedium.in',
    'https://aesthetics.e-remedium.in',
    'https://aes.e-remedium.in',
    'https://reach.e-remedium.in',
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
    if (/[?&]pa_embed=1/.test(location.search)) sessionStorage.setItem('pa_embed', '1');
    var sameOrigin = false;
    try { sameOrigin = window.top.location.origin === location.origin; } catch (e) { sameOrigin = false; }
    // Cross-origin console embed (CRM / Ops / Care / …) — prefer known parent, fall back to ?pa_embed=1.
    if (!sameOrigin) return !!(embedParent() || sessionStorage.getItem('pa_embed') === '1');
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
      location.replace('/people/profile?pa_embed=1&tab=hr');
    });
    window.parent.postMessage({ type: 'pa-embed-ready' }, embedParent());
  }

  function applyProfileTabFromQuery() {
    if (!/\/people\/profile\/?$/.test(location.pathname)) return;
    var tab = '';
    try { tab = new URLSearchParams(location.search).get('tab') || ''; } catch (e) { tab = ''; }
    if (!tab || tab === 'profile') return;
    var labels = {
      hr: /hr\s*self\s*service/i,
      training: /training/i,
      assets: /assets/i,
      announce: /announce/i,
      settings: /settings/i,
      team: /my\s*team/i,
    };
    var re = labels[tab];
    if (!re) return;
    var buttons = document.querySelectorAll('.me-tabs button, [data-me-tabs] button, .me-subnav button');
    var btn = null;
    for (var i = 0; i < buttons.length; i++) {
      if (re.test(buttons[i].textContent || '')) { btn = buttons[i]; break; }
    }
    if (!btn || btn.classList.contains('on') || btn.getAttribute('aria-current') === 'page') return;
    if (btn.getAttribute('data-pa-tab-applied') === tab) return;
    btn.setAttribute('data-pa-tab-applied', tab);
    try { btn.click(); } catch (err) { /* ignore */ }
  }

  function unifySelfHrNav() {
    /* Only in portal embeds: fold self-service pills into Profile. Never rewrite native People sidebar
       (employee My attendance / My leave, or HR Attendance / Leave Management directory). */
    if (!embedded) return;
    var side = document.querySelector('.hrms-sidebar nav');
    if (!side) return;
    var links = side.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var label = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^My attendance$/i.test(label) && !/^My leave$/i.test(label) &&
          !/^Expenses$/i.test(label) && !/^Payslips$/i.test(label)) continue;
      a.setAttribute('href', '/people/profile?pa_embed=1&tab=hr');
    }
  }

  function embedTabs() {
    if (!embedded) return;
    /* Portal embeds: one Profile workspace (no separate attendance/leave chrome). Native People keeps full pages. */
    var path = cleanPath(location.pathname);
    if (path !== '/people/profile' && path !== '/login') {
      var keepTab = '';
      try { keepTab = new URLSearchParams(location.search).get('tab') || ''; } catch (e) { keepTab = ''; }
      if (!keepTab) {
        if (path.indexOf('/people/attendance') === 0 || path.indexOf('/people/leave') === 0 ||
            path.indexOf('/people/expenses') === 0 || path.indexOf('/people/payslips') === 0) keepTab = 'hr';
      }
      location.replace('/people/profile?pa_embed=1' + (keepTab ? '&tab=' + encodeURIComponent(keepTab) : '&tab=hr'));
      return;
    }
    document.documentElement.classList.add('pa-embed');
    var side = document.querySelector('.hrms-sidebar');
    if (side) side.setAttribute('hidden', '');
    var top = document.querySelector('.hrms-topbar');
    if (top) top.setAttribute('hidden', '');
    /* Drop the old fragmented Profile / My attendance / My leave embed pills — Profile page has its own tabs. */
    var bar = document.querySelector('.pa-embed-tabs');
    if (bar) bar.remove();
    applyProfileTabFromQuery();
  }

  /* ------------------------------------------------------------ My Profile in the lab / collection portals */

  function fitWorkspace() {
    var frame = document.querySelector('.pa-ws-frame');
    if (frame) frame.style.height = Math.max(480, window.innerHeight - frame.getBoundingClientRect().top - 8) + 'px';
  }
  window.addEventListener('resize', fitWorkspace);

  function profileWorkspace() {
    if (embedded || location.origin === PEOPLE_ORIGIN) return;
    var page = document.querySelector('.mp2-page');
    if (!page || !currentSid()) return;
    if (page.querySelector('.pa-ws, .pa-ws-frame, iframe[title="My HR Workspace"]')) return;
    page.classList.add('pa-ws-on');
    var box = document.createElement('div');
    box.className = 'pa-ws';
    box.innerHTML = '<iframe class="pa-ws-frame" title="My HR Workspace" src="' + PEOPLE_EMBED_PROFILE + '" allow="geolocation *"></iframe>';
    page.appendChild(box);
    fitWorkspace();
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== PEOPLE_ORIGIN || !e.data || e.data.type !== 'pa-embed-ready') return;
    var frame = document.querySelector('.pa-hrp-frame') || document.querySelector('.pa-ws-frame');
    if (!frame || e.source !== frame.contentWindow) return;
    var s = null;
    try { s = JSON.parse(localStorage.getItem('hec_web_session') || 'null'); } catch (err) { s = null; }
    if (!s || !s.sid) return;
    frame.contentWindow.postMessage({
      type: 'pa-embed-session',
      session: { sid: s.sid, user: s.user, fullName: s.fullName || s.full_name, roles: s.roles || [] },
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

  function fitReportFrame() {
    var frame = document.querySelector('.po-split.is-open .po-preview-frame iframe');
    if (!frame) return;
    frame.setAttribute('scrolling', 'no');
    if (frame.getAttribute('data-po-fit') !== '1') {
      frame.setAttribute('data-po-fit', '1');
      frame.addEventListener('load', fitReportFrame);
    }
    try {
      var doc = frame.contentDocument;
      if (!doc || !doc.documentElement) return;
      if (!doc.getElementById('po-fit-style')) {
        var st = doc.createElement('style');
        st.id = 'po-fit-style';
        st.textContent = 'html,body{overflow:hidden !important;height:auto !important;margin:0;}'
          + '#print-toolbar{display:none !important;}'
          + 'body.letterhead-plain .chrome-art,body.letterhead-plain .header-banner,body.letterhead-plain .footer-banner,body.letterhead-plain .header-table,body.letterhead-plain .nabl-strip,body.letterhead-plain .footer-fallback{display:none !important;}'
          + 'body.letterhead-plain .report-chrome-header,body.letterhead-plain .report-chrome-footer{display:none !important;height:0 !important;min-height:0 !important;}'
          + 'body.letterhead-plain .report-sheet{padding-top:4mm !important;padding-bottom:4mm !important;}'
          + 'body.po-awaiting-sign .sig-table{display:none !important;}';
        (doc.head || doc.documentElement).appendChild(st);
      }
      if (doc.body) {
        doc.body.classList.add('letterhead-plain');
        var signed = !!document.querySelector('.po-workspace .po-badge.tone-green');
        doc.body.classList.toggle('po-awaiting-sign', !signed);
      }
      var bar = doc.getElementById('print-toolbar');
      if (bar) bar.style.setProperty('display', 'none', 'important');
      var h = Math.max(doc.body ? doc.body.scrollHeight : 0, doc.documentElement.scrollHeight || 0);
      var scale = 1;
      var match = /scale\(([\d.]+)\)/.exec(frame.style.transform || '');
      if (match) scale = parseFloat(match[1]) || 1;
      if (h > 40) {
        frame.style.height = Math.ceil(h + 12) + 'px';
        frame.style.marginBottom = scale < 1 ? '0' : Math.ceil(h * (scale - 1) + 8) + 'px';
      }
    } catch (err) {}
  }

  function mountPathologistPopup() {
    var ws = document.querySelector('.po-split.is-open .po-workspace');
    var x = document.querySelector('.po-pop-x');
    if (!ws) {
      if (x) x.remove();
      document.documentElement.classList.remove('po-review-open');
      return;
    }
    document.documentElement.classList.add('po-review-open');
    document.querySelectorAll('.po-preview-tools button').forEach(function (btn) {
      if ((btn.textContent || '').trim() === 'Open') btn.hidden = true;
    });
    if (!x) {
      x = document.createElement('button');
      x.type = 'button';
      x.className = 'po-pop-x';
      x.textContent = 'Close';
      x.setAttribute('aria-label', 'Close review');
      x.addEventListener('click', function () {
        var close = document.querySelector('.po-split.is-open .po-workspace .po-actions .po-btn.ghost');
        if (close) close.click();
      });
      document.body.appendChild(x);
    }
    fitReportFrame();
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest || !document.querySelector('.po-split.is-open .po-workspace')) return;
    if (t.closest('.po-preview-tools')) setTimeout(fitReportFrame, 40);
    if (t.closest('.po-workspace, .po-modal, .po-pop-x, .po-table, .po-review')) return;
    var close = document.querySelector('.po-split.is-open .po-workspace .po-actions .po-btn.ghost');
    if (close && /^close$/i.test((close.textContent || '').trim())) close.click();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || document.querySelector('.po-modal')) return;
    var close = document.querySelector('.po-split.is-open .po-workspace .po-actions .po-btn.ghost');
    if (close && /^close$/i.test((close.textContent || '').trim())) close.click();
  });

  function bookingApi(moduleName, method, extra) {
    var body = new URLSearchParams(extra || {});
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      if (s && s.sid) body.set('sid', s.sid);
    } catch (e) {}
    return fetch('/api/method/health_ecosystem_core.health_ecosystem_core.' + moduleName + '.' + method, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
      body: body,
    }).then(function (r) {
      return r.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : {}; } catch (err) {
          throw new Error('Could not save patient details. Please retry.');
        }
        if (!r.ok) {
          var errMsg = (json && json.message && (json.message.message || json.message)) || ('Request failed (' + r.status + ')');
          throw new Error(String(errMsg).replace(/<[^>]+>/g, ''));
        }
        return json;
      });
    }).then(function (json) {
      var m = json && json.message && typeof json.message === 'object' ? json.message : json;
      if (!m || m.status === 'error') throw new Error(String((m && m.message) || 'Request failed').replace(/<[^>]+>/g, ''));
      return m.data !== undefined ? m.data : m;
    });
  }

  function bookingAgeText(years, months, days, gender) {
    var bits = [];
    years = Number(years) || 0;
    months = Number(months) || 0;
    days = Number(days) || 0;
    if (years) bits.push(years + (years === 1 ? ' Year' : ' Years'));
    if (months) bits.push(months + (months === 1 ? ' Month' : ' Months'));
    if (days) bits.push(days + (days === 1 ? ' Day' : ' Days'));
    if (!bits.length) bits.push('0 Years');
    var mark = gender ? String(gender).charAt(0).toUpperCase() : '';
    return bits.join(' ') + (mark ? ' / ' + mark : '');
  }

  function paintBookingPatient(trfId, saved) {
    var sub = bookingAgeText(saved.age, saved.age_months, saved.age_days, saved.gender);
    if (saved.patient_phone) sub += ' · ' + saved.patient_phone;
    var drawer = document.querySelector('.ab2-drawer');
    if (drawer) {
      var dd = drawer.querySelector('.ab2-facts div dd');
      if (dd) dd.innerHTML = esc(saved.patient_name) + '<small>' + esc(sub) + '</small>';
    }
    document.querySelectorAll('.ab2-table tbody tr').forEach(function (tr) {
      var id = tr.querySelector('.lt-trf');
      if (!id || (id.textContent || '').trim() !== trfId) return;
      var cell = tr.children[1];
      if (!cell) return;
      var strong = cell.querySelector('.ab2-strong');
      var line = cell.querySelector('.ab2-sub');
      if (strong) strong.textContent = saved.patient_name;
      if (line) line.textContent = sub;
    });
  }

  function closeBookingEditor() {
    var box = document.querySelector('.abp-editor');
    if (box) box.remove();
  }

  function openBookingEditor(trfId) {
    if (document.querySelector('.abp-editor')) return;
    var box = document.createElement('div');
    box.className = 'abp-editor';
    box.innerHTML = '<form class="abp-card"><h3>Edit patient details</h3><p class="abp-note">Saving updates this booking and the partner portal.</p><p class="abp-status">Loading…</p></form>';
    document.body.appendChild(box);
    var form = box.querySelector('form');
    box.addEventListener('click', function (e) {
      if (e.target === box) closeBookingEditor();
    });
    bookingApi('clinical_phase123_booking_lifecycle', 'get_booking_lifecycle_detail', { trf_id: trfId }).then(function (data) {
      var b = (data && data.booking) || {};
      form.innerHTML = ''
        + '<h3>Edit patient details</h3>'
        + '<p class="abp-note">Saving updates this booking and the partner portal.</p>'
        + '<label>Patient name<input name="patient_name" required value="' + esc(b.patient_name || '') + '"></label>'
        + '<label>Phone<input name="patient_phone" inputmode="tel" value="' + esc(b.patient_phone || '') + '"></label>'
        + '<div class="abp-age">'
        + '<label>Years<input name="age" type="number" min="0" max="130" value="' + esc(b.age || 0) + '"></label>'
        + '<label>Months<input name="age_months" type="number" min="0" max="11" value="' + esc(b.age_months || 0) + '"></label>'
        + '<label>Days<input name="age_days" type="number" min="0" max="31" value="' + esc(b.age_days || 0) + '"></label>'
        + '</div>'
        + '<label>Gender<select name="gender">'
        + ['Male', 'Female', 'Other'].map(function (g) {
          return '<option' + (b.gender === g ? ' selected' : '') + '>' + g + '</option>';
        }).join('')
        + '</select></label>'
        + '<p class="abp-err"></p>'
        + '<div class="abp-actions"><button type="button" class="abp-cancel">Cancel</button><button type="submit" class="abp-save">Save</button></div>';
      form.querySelector('.abp-cancel').addEventListener('click', closeBookingEditor);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var err = form.querySelector('.abp-err');
        var save = form.querySelector('.abp-save');
        err.textContent = '';
        save.disabled = true;
        save.textContent = 'Saving…';
        bookingApi('clinical_booking_patient', 'update_booking_patient', {
          trf_id: trfId,
          patient_name: form.patient_name.value,
          patient_phone: form.patient_phone.value,
          age: form.age.value,
          age_months: form.age_months.value,
          age_days: form.age_days.value,
          gender: form.gender.value,
        }).then(function (saved) {
          paintBookingPatient(trfId, saved || {});
          closeBookingEditor();
        }).catch(function (ex) {
          err.textContent = (ex && ex.message) || 'Could not save patient details';
          save.disabled = false;
          save.textContent = 'Save';
        });
      });
    }).catch(function (ex) {
      form.querySelector('.abp-status').textContent = (ex && ex.message) || 'Could not load patient details';
    });
  }

  function mountBookingPatientEdit() {
    if (location.pathname.indexOf('/dashboard/all-bookings') !== 0) {
      closeBookingEditor();
      return;
    }
    var drawer = document.querySelector('.ab2-drawer');
    if (!drawer) return;
    var facts = drawer.querySelector('.ab2-facts');
    var patient = facts && facts.querySelector('div');
    if (!patient || patient.querySelector('[data-ab-edit]')) return;
    var title = drawer.querySelector('h3');
    var trfId = title ? (title.textContent || '').trim() : '';
    if (!trfId) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'abp-edit';
    btn.setAttribute('data-ab-edit', '1');
    btn.textContent = 'Edit patient details';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openBookingEditor(trfId);
    });
    patient.appendChild(btn);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !document.querySelector('.abp-editor')) return;
    e.stopPropagation();
    closeBookingEditor();
  }, true);

  function tick() {
    profileBanner(); applyGate(); applyAestheticGate(); applyLabGate(); paintLabProfile(); mountPathologistPopup(); mountBookingPatientEdit(); aestheticProfileLink();
    embedTabs(); unifySelfHrNav(); applyProfileTabFromQuery(); profileWorkspace(); portalsCard();
  }
  new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
  tick();
  window.addEventListener('load', tick);
  window.addEventListener('popstate', function () { myLoaded = false; });

  window.PeopleAccess = { mountEditor: mountEditor, download: downloadAgreement };
})();
