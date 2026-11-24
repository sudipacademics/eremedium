/* Lab Technician portal: Test Master.
 * Adds "Test Master" to the lab sidebar and opens the Diagnostic Test Master (tests, parameters,
 * reference ranges) in the page area. Editing follows the server level: view, edit, or create.
 */
(function () {
  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.clinical_lab_test_master.';
  var PATH = '/dashboard/test-master';
  if (location.pathname === PATH) document.documentElement.setAttribute('data-lt-hold', 'test-master');
  var LEVELS = ['none', 'view', 'create', 'edit', 'approve', 'manage'];
  var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6"/><path d="M10 3v6.5L5.2 18a2 2 0 0 0 1.8 3h10a2 2 0 0 0 1.8-3L14 9.5V3"/><path d="M7.5 14h9"/></svg>';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
      body: body,
    }).then(function (r) { return r.json().then(function (json) { return { ok: r.ok, json: json }; }); }).then(function (pack) {
      var json = pack.json || {};
      var m = json.message && typeof json.message === 'object' ? json.message : null;
      if (m && m.status === 'error') throw new Error(String(m.message || 'Request failed').replace(/<[^>]+>/g, ''));
      if (m && m.status === 'success') return m.data !== undefined ? m.data : m;
      var server = '';
      try {
        var msgs = JSON.parse(json._server_messages || '[]');
        server = (msgs || []).map(function (x) {
          try { return JSON.parse(x).message; } catch (e) { return x; }
        }).join(' ').replace(/<[^>]+>/g, ' ').trim();
      } catch (e) {}
      if (!pack.ok || json.exc || server) throw new Error(server || String(json.exception || json.message || 'Request failed').replace(/<[^>]+>/g, ''));
      return m && m.data !== undefined ? m.data : m || json;
    });
  }

  var st = {
    open: false,
    view: 'list',
    q: '',
    department: '',
    status: 'Active',
    start: 0,
    list: null,
    level: 'none',
    detail: null,
    options: {},
    departments: [],
    original: '',
    busy: false,
    message: '',
    tone: '',
  };

  function can(level) { return LEVELS.indexOf(st.level) >= LEVELS.indexOf(level); }
  function opt(list, value) {
    var seen = false;
    var html = (list || []).map(function (o) {
      if (o === value) seen = true;
      return '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o || '—') + '</option>';
    }).join('');
    return (seen || !value ? '' : '<option value="' + esc(value) + '" selected>' + esc(value) + '</option>') + html;
  }
  function num(v) { return v === null || v === undefined ? '' : String(v); }

  /* ------------------------------------------------------------------ mounting */

  function labLayout() { return document.querySelector('.layout-labtech'); }
  function mainArea() { return document.querySelector('.layout-labtech .staff-main > main.staff-page'); }

  function linkPath(a) {
    var href = a.getAttribute('href') || '';
    try { href = new URL(href, location.origin).pathname; } catch (e) { /* keep */ }
    return href.replace(/\/$/, '') || '/';
  }
  function markLink() {
    document.querySelectorAll('.layout-labtech a.lt-side-link').forEach(function (a) {
      a.classList.toggle('active', linkPath(a) === PATH);
    });
  }
  var navigating = false;
  function goToTestMaster() {
    // The address is owned by the React route. Do not pushState over it.
    document.documentElement.setAttribute('data-lt-hold', 'test-master');
  }
  function addLink() {
    if (!labLayout()) return;
    var native = Array.prototype.filter.call(document.querySelectorAll('.layout-labtech a.lt-side-link'), function (a) {
      return linkPath(a) === PATH && !a.hasAttribute('data-tm-link');
    })[0];
    if (native) {
      if (native.getAttribute('data-tm-bound') !== '1') {
        native.setAttribute('data-tm-bound', '1');
        native.addEventListener('click', function () {
          document.documentElement.setAttribute('data-lt-hold', 'test-master');
        }, true);
      }
      if (st.open) markLink();
      return;
    }
    if (document.querySelector('[data-tm-link]')) return;
    var links = Array.prototype.slice.call(document.querySelectorAll('.layout-labtech a.lt-side-link'));
    if (!links.length) return;
    var anchor = links.filter(function (a) { return linkPath(a) === '/dashboard/pathologist'; })[0];
    if (!anchor) return;
    var link = document.createElement('a');
    link.className = 'lt-side-link';
    link.href = PATH;
    link.setAttribute('data-tm-link', '1');
    link.innerHTML = '<span class="lt-side-icon">' + ICON + '</span><span>Test Master</span>';
    link.addEventListener('click', function () {
      document.documentElement.setAttribute('data-lt-hold', 'test-master');
    });
    anchor.parentNode.insertBefore(link, anchor.nextSibling);
    if (st.open) markLink();
  }

  var savedTitle = null;
  var savedCrumb = null;

  function open() {
    var main = mainArea();
    if (!main) return;
    goToTestMaster();
    if (st.open && document.querySelector('[data-tm-panel]')) {
      main.classList.add('tm-hidden');
      markLink();
      return;
    }
    var keepView = st.open;
    st.open = true;
    main.classList.add('tm-hidden');
    var panel = document.createElement('section');
    panel.className = 'tm-panel page staff-page';
    panel.setAttribute('data-tm-panel', '1');
    main.parentNode.insertBefore(panel, main.nextSibling);
    markLink();
    var title = document.querySelector('.layout-labtech .staff-topbar-title');
    if (title && savedTitle === null) { savedTitle = title.textContent; title.textContent = 'Test Master'; }
    else if (title) title.textContent = 'Test Master';
    var crumb = document.querySelector('.layout-labtech .lt-crumbs > :last-child');
    if (crumb && savedCrumb === null) { savedCrumb = crumb.textContent; crumb.textContent = 'Test Master'; }
    else if (crumb) crumb.textContent = 'Test Master';
    if (!keepView) st.view = 'list';
    if (st.view === 'detail' && st.detail) drawDetail();
    else loadList();
  }

  function close(force) {
    if (!st.open) return true;
    if (!force && st.view === 'detail' && dirty() && !window.confirm('Leave without saving your changes to this test?')) return false;
    st.open = false;
    if (document.documentElement.getAttribute('data-lt-hold') === 'test-master') {
      document.documentElement.removeAttribute('data-lt-hold');
    }
    var panel = document.querySelector('[data-tm-panel]');
    if (panel) panel.remove();
    var main = mainArea();
    if (main) main.classList.remove('tm-hidden');
    document.querySelectorAll('.layout-labtech a.lt-side-link').forEach(function (a) {
      a.classList.toggle('active', linkPath(a) === location.pathname);
    });
    var title = document.querySelector('.layout-labtech .staff-topbar-title');
    if (title && savedTitle !== null) title.textContent = savedTitle;
    var crumb = document.querySelector('.layout-labtech .lt-crumbs > :last-child');
    if (crumb && savedCrumb !== null) crumb.textContent = savedCrumb;
    savedTitle = null;
    savedCrumb = null;
    return true;
  }

  document.addEventListener('click', function (e) {
    if (!st.open || !e.target.closest) return;
    var a = e.target.closest('.layout-labtech aside a[href], .layout-labtech .lt-topbar-tools a[href], .layout-labtech .lt-crumbs a[href]');
    if (!a || a.hasAttribute('data-tm-link') || linkPath(a) === PATH) return;
    if (!close(false)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.addEventListener('popstate', function () {
    if (navigating) return;
    if (location.pathname === PATH) open();
    else if (st.open) close(true);
  });

  function panel() { return document.querySelector('[data-tm-panel]'); }

  /* ------------------------------------------------------------------ list */

  function loadList() {
    var p = panel();
    if (!p) return;
    if (!st.list) p.innerHTML = '<p class="muted">Loading tests…</p>';
    call('get_lab_test_masters', { q: st.q, department: st.department, status: st.status, start: st.start, limit: 50 }).then(function (d) {
      if (!d || !Array.isArray(d.items)) throw new Error('Could not load tests');
      st.list = d;
      st.level = d.level || st.level;
      st.departments = d.departments || [];
      if (st.open && st.view === 'list') drawList();
    }).catch(function (err) {
      var el = panel();
      if (el) el.innerHTML = '<div class="tm-card"><p class="tm-error">' + esc(err.message) + '</p></div>';
    });
  }

  function drawList() {
    var p = panel();
    var d = st.list;
    if (!p || !d) return;
    var items = Array.isArray(d.items) ? d.items : [];
    var departments = Array.isArray(st.departments) ? st.departments : [];
    var pages = Math.max(1, Math.ceil((d.total || 0) / 50));
    var page = Math.floor(st.start / 50) + 1;
    p.innerHTML =
      '<div class="tm-head"><div><h2>Test Master</h2><p>' + (d.total || 0) + ' test' + ((d.total || 0) === 1 ? '' : 's') +
      ' · report parameters, reference ranges and report settings' + (can('edit') ? '' : ' · view only') + '</p></div>' +
      (can('create') ? '<button type="button" class="tm-btn primary" data-tm-new>+ New test</button>' : '') + '</div>' +
      '<div class="tm-card"><div class="tm-filters">' +
      '<input type="search" data-tm-q placeholder="Search test, parameter, LIS code or item…" value="' + esc(st.q) + '" />' +
      '<select data-tm-dept><option value="">All departments</option>' + departments.map(function (x) {
        return '<option value="' + esc(x) + '"' + (x === st.department ? ' selected' : '') + '>' + esc(x) + '</option>';
      }).join('') + '</select>' +
      '<select data-tm-status>' + ['Active', 'Disabled', 'All'].map(function (x) {
        return '<option' + (x === st.status ? ' selected' : '') + '>' + x + '</option>';
      }).join('') + '</select></div>' +
      '<div class="tm-table-wrap"><table class="tm-table"><thead><tr><th>Test</th><th>Department</th><th>Specimen</th><th>Parameters</th><th>Ranges</th><th>LIS code</th><th>TAT</th><th>NABL</th><th>Status</th><th></th></tr></thead><tbody>' +
      (items.length ? items.map(function (t) {
        return '<tr data-tm-open="' + esc(t.name) + '"><td><b>' + esc(t.test_name) + '</b>' + (t.nabl_discipline ? '<small>' + esc(t.nabl_discipline) + '</small>' : '') + '</td>' +
          '<td>' + esc(t.department || '—') + '</td><td>' + esc(t.specimen_material || '—') + '</td>' +
          '<td class="tm-num">' + t.parameters + '</td><td class="tm-num">' + t.ranges + '</td><td>' + esc(t.lis_code || '—') + '</td>' +
          '<td>' + esc(tatText(t.tat_days)) + '</td>' +
          '<td><span class="tm-pill ' + (Number(t.is_nabl) ? 'on' : 'off') + '">' + (Number(t.is_nabl) ? 'NABL' : 'Non-NABL') + '</span></td>' +
          '<td><span class="tm-pill ' + (t.disabled ? 'off' : 'on') + '">' + (t.disabled ? 'Disabled' : 'Active') + '</span></td>' +
          '<td><button type="button" class="tm-link">' + (can('edit') ? 'Open / edit' : 'View') + '</button></td></tr>';
      }).join('') : '<tr><td colspan="10" class="muted">No tests match.</td></tr>') +
      '</tbody></table></div>' +
      '<div class="tm-pager"><button type="button" class="tm-btn" data-tm-prev' + (page <= 1 ? ' disabled' : '') + '>Previous</button>' +
      '<span>Page ' + page + ' of ' + pages + '</span><button type="button" class="tm-btn" data-tm-next' + (page >= pages ? ' disabled' : '') + '>Next</button></div></div>';

    var timer = null;
    p.querySelector('[data-tm-q]').addEventListener('input', function (e) {
      clearTimeout(timer);
      var value = e.target.value;
      timer = setTimeout(function () { st.q = value.trim(); st.start = 0; loadList(); }, 350);
    });
    p.querySelector('[data-tm-dept]').addEventListener('change', function (e) { st.department = e.target.value; st.start = 0; loadList(); });
    p.querySelector('[data-tm-status]').addEventListener('change', function (e) { st.status = e.target.value; st.start = 0; loadList(); });
    p.querySelector('[data-tm-prev]').addEventListener('click', function () { st.start = Math.max(0, st.start - 50); loadList(); });
    p.querySelector('[data-tm-next]').addEventListener('click', function () { st.start += 50; loadList(); });
    p.querySelectorAll('[data-tm-open]').forEach(function (tr) {
      tr.addEventListener('click', function () { openTest(tr.getAttribute('data-tm-open')); });
    });
    var add = p.querySelector('[data-tm-new]');
    if (add) add.addEventListener('click', function () { openTest(''); });
    var q = p.querySelector('[data-tm-q]');
    if (q && st.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  /* ------------------------------------------------------------------ detail */

  function blankTest() {
    return { name: '', test_name: '', department: '', item: '', disabled: 0, is_nabl: 0, lis_code: '', report_category: 'CLINICAL BIOCHEMISTRY', nabl_discipline: '', specimen_material: '', result_layout: 'Numeric Profile', uses_age_related_ranges: 0, machine_method: '', tat_days: 0, report_heading_1: '', report_heading_2: '', description: '', interpretation: '', parameters: [], reference_ranges: [], tubes: [] };
  }

  function tatDays(v) {
    var n = parseInt(v, 10);
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }
  function tatText(v) {
    var n = tatDays(v);
    return n === 0 ? 'Same day' : (n === 1 ? '1 day' : n + ' days');
  }
  function tatHint(v) {
    return tatText(v) + '. Each number is one day.';
  }

  function editable() {
    var t = st.detail;
    return JSON.stringify({ h: [t.test_name, t.department, t.item, t.disabled, t.is_nabl, t.lis_code, t.report_category, t.nabl_discipline, t.specimen_material, t.result_layout, t.uses_age_related_ranges, t.machine_method, tatDays(t.tat_days), t.report_heading_1, t.report_heading_2, t.description], p: t.parameters, r: t.reference_ranges });
  }
  function dirty() { return st.detail && editable() !== st.original; }

  function openTest(name) {
    var p = panel();
    if (!p) return;
    p.innerHTML = '<p class="muted">Loading test…</p>';
    call('get_lab_test_master', { test: name }).then(function (d) {
      st.level = d.level;
      st.options = d.options || {};
      st.clinicalDepartments = d.clinical_departments || [];
      st.detail = d.test || blankTest();
      st.detail.tat_days = tatDays(st.detail.tat_days);
      st.original = editable();
      st.view = 'detail';
      st.message = '';
      st.expanded = {};
      drawDetail();
    }).catch(function (err) { p.innerHTML = '<div class="tm-card"><p class="tm-error">' + esc(err.message) + '</p></div>'; });
  }

  function field(label, key, html) {
    return '<label class="tm-field"><span>' + esc(label) + '</span>' + html + '</label>';
  }
  function input(key, value, ro, extra) {
    return '<input data-tm-h="' + key + '" value="' + esc(value) + '"' + (ro ? ' disabled' : '') + (extra || '') + ' />';
  }
  function select(key, list, value, ro) {
    return '<select data-tm-h="' + key + '"' + (ro ? ' disabled' : '') + '>' + opt(list, value) + '</select>';
  }

  var MORE = [
    ['choice_options', 'Choice options (one per line)', 'area'],
    ['default_value', 'Default value', 'text'],
    ['print_style', 'Print style', 'print_style'],
    ['before_heading', 'Heading printed before this row', 'text'],
    ['formula', 'Derivation equation, e.g. {TOTAL_BILI} - {DIRECT_BILI}', 'area'],
    ['machine_name', 'Machine name', 'text'],
    ['specimen_material', 'Specimen', 'specimen_material'],
    ['nabl_discipline', 'NABL discipline', 'nabl_discipline'],
    ['amr_min', 'AMR min', 'num'],
    ['amr_max', 'AMR max', 'num'],
    ['cv_percent', '%CV', 'num'],
    ['measurement_uncertainty', 'Measurement uncertainty', 'text'],
    ['delta_limit_percent', 'Delta limit %', 'num'],
    ['reagent_item', 'Reagent item code', 'text'],
    ['reagent_qty', 'Reagent qty / run', 'num'],
    ['description', 'Description', 'area'],
  ];

  function paramRows(ro) {
    var t = st.detail;
    if (!t.parameters.length) return '<tr><td colspan="12" class="muted">No parameters yet.</td></tr>';
    return t.parameters.map(function (r, i) {
      var cell = function (k, kind) {
        if (kind === 'sel') return '<td><select data-tm-p="' + i + '" data-k="' + k + '"' + (ro ? ' disabled' : '') + '>' + opt(st.options[k], r[k] || '') + '</select></td>';
        return '<td><input data-tm-p="' + i + '" data-k="' + k + '" value="' + esc(kind === 'num' ? num(r[k]) : r[k] || '') + '"' + (kind === 'num' ? ' inputmode="decimal" class="tm-n"' : '') + (ro ? ' disabled' : '') + ' /></td>';
      };
      var open = st.expanded[i];
      var more = open ? '<tr class="tm-more"><td></td><td colspan="11"><div class="tm-more-grid">' + MORE.map(function (m) {
        var k = m[0];
        var v = r[k];
        var ctl;
        if (m[2] === 'area') ctl = '<textarea data-tm-p="' + i + '" data-k="' + k + '" rows="2"' + (ro ? ' disabled' : '') + '>' + esc(v || '') + '</textarea>';
        else if (m[2] === 'num') ctl = '<input data-tm-p="' + i + '" data-k="' + k + '" inputmode="decimal" value="' + esc(num(v)) + '"' + (ro ? ' disabled' : '') + ' />';
        else if (m[2] === 'text') ctl = '<input data-tm-p="' + i + '" data-k="' + k + '" value="' + esc(v || '') + '"' + (ro ? ' disabled' : '') + ' />';
        else ctl = '<select data-tm-p="' + i + '" data-k="' + k + '"' + (ro ? ' disabled' : '') + '>' + opt(st.options[m[2]], v || '') + '</select>';
        return '<label class="tm-field"><span>' + esc(m[1]) + '</span>' + ctl + '</label>';
      }).join('') + '</div></td></tr>' : '';
      return '<tr><td class="tm-idx">' + (i + 1) + '</td>' + cell('parameter_code') + cell('parameter_name') + cell('result_input_type', 'sel') + cell('unit') +
        cell('normal_min', 'num') + cell('normal_max', 'num') + cell('critical_min', 'num') + cell('critical_max', 'num') + cell('method') + cell('parameter_kind', 'sel') +
        '<td class="tm-row-actions"><button type="button" class="tm-icon" data-tm-more="' + i + '" title="More settings">' + (open ? '▴' : '▾') + '</button>' +
        (ro ? '' : '<button type="button" class="tm-icon" data-tm-up="' + i + '" title="Move up"' + (i ? '' : ' disabled') + '>↑</button>' +
          '<button type="button" class="tm-icon danger" data-tm-del="' + i + '" title="Remove">×</button>') + '</td></tr>' + more;
    }).join('');
  }

  function rangeRows(ro) {
    var t = st.detail;
    if (!t.reference_ranges.length) return '<tr><td colspan="10" class="muted">No age / gender ranges. The parameter\'s default normal range is used.</td></tr>';
    var codes = t.parameters.map(function (p) { return p.parameter_code || p.parameter_name; }).filter(Boolean);
    return t.reference_ranges.map(function (r, i) {
      var cell = function (k, kind) {
        return '<td><input data-tm-r="' + i + '" data-k="' + k + '" value="' + esc(kind === 'num' ? num(r[k]) : r[k] || '') + '"' + (kind === 'num' ? ' inputmode="decimal" class="tm-n"' : '') + (ro ? ' disabled' : '') + ' /></td>';
      };
      return '<tr><td><select data-tm-r="' + i + '" data-k="parameter_code"' + (ro ? ' disabled' : '') + '>' + opt([''].concat(codes), r.parameter_code || '') + '</select></td>' +
        '<td><select data-tm-r="' + i + '" data-k="gender"' + (ro ? ' disabled' : '') + '>' + opt(st.options.gender, r.gender || 'Both') + '</select></td>' +
        cell('age_from_years', 'num') + cell('age_to_years', 'num') + cell('normal_min', 'num') + cell('normal_max', 'num') +
        cell('critical_min', 'num') + cell('critical_max', 'num') + cell('display_label') +
        '<td class="tm-row-actions">' + (ro ? '' : '<button type="button" class="tm-icon danger" data-tm-rdel="' + i + '" title="Remove">×</button>') + '</td></tr>';
    }).join('');
  }

  function drawDetail() {
    var p = panel();
    var t = st.detail;
    if (!p || !t) return;
    var creating = !t.name;
    var ro = creating ? !can('create') : !can('edit');
    var depts = st.clinicalDepartments.length ? st.clinicalDepartments : st.departments;
    p.innerHTML =
      '<div class="tm-head"><div><button type="button" class="tm-back" data-tm-back>← All tests</button>' +
      '<h2>' + esc(creating ? 'New test' : t.test_name) + '</h2>' +
      '<p>' + (creating ? 'Create a test in the Diagnostic Test Master.' : t.parameters.length + ' parameters · ' + t.reference_ranges.length + ' reference ranges' + (t.modified ? ' · last changed ' + esc(String(t.modified).slice(0, 16)) + ' by ' + esc(t.modified_by || '') : '')) + '</p></div>' +
      (ro ? '<span class="tm-pill off">View only</span>' : '') + '</div>' +
      '<div class="tm-card"><h3>Test details</h3><div class="tm-grid">' +
      (creating ? field('Test name', 'test_name', input('test_name', t.test_name, ro)) : '') +
      field('Department', 'department', select('department', [''].concat(depts), t.department || '', ro)) +
      field('Billable item code', 'item', input('item', t.item || '', ro)) +
      field('LIS machine code', 'lis_code', input('lis_code', t.lis_code || '', ro)) +
      field('Report category heading', 'report_category', input('report_category', t.report_category || '', ro)) +
      field('NABL discipline', 'nabl_discipline', select('nabl_discipline', st.options.nabl_discipline, t.nabl_discipline || '', ro)) +
      field('Specimen', 'specimen_material', select('specimen_material', st.options.specimen_material, t.specimen_material || '', ro)) +
      field('Result layout', 'result_layout', select('result_layout', st.options.result_layout, t.result_layout || 'Numeric Profile', ro)) +
      field('Method summary', 'machine_method', input('machine_method', t.machine_method || '', ro)) +
      field('TAT (days)', 'tat_days', '<input data-tm-h="tat_days" type="number" min="0" step="1" inputmode="numeric" value="' + tatDays(t.tat_days) + '"' + (ro ? ' disabled' : '') + ' /><span class="small muted" data-tm-tat-hint>' + esc(tatHint(t.tat_days)) + '</span>') +
      field('Report heading 1', 'report_heading_1', input('report_heading_1', t.report_heading_1 || '', ro)) +
      field('Report heading 2', 'report_heading_2', input('report_heading_2', t.report_heading_2 || '', ro)) +
      '<label class="tm-check"><input type="checkbox" data-tm-h="is_nabl"' + (Number(t.is_nabl) ? ' checked' : '') + (ro ? ' disabled' : '') + ' /> NABL accredited test</label>' +
      '<label class="tm-check"><input type="checkbox" data-tm-h="uses_age_related_ranges"' + (t.uses_age_related_ranges ? ' checked' : '') + (ro ? ' disabled' : '') + ' /> Uses age-related ranges</label>' +
      '<label class="tm-check"><input type="checkbox" data-tm-h="disabled"' + (t.disabled ? ' checked' : '') + (ro ? ' disabled' : '') + ' /> Disabled (not offered for new bookings)</label>' +
      '</div>' + field('Description', 'description', '<textarea data-tm-h="description" rows="2"' + (ro ? ' disabled' : '') + '>' + esc(t.description || '') + '</textarea>') +
      (t.tubes && t.tubes.length ? '<p class="muted">Sample tubes: ' + t.tubes.map(function (x) { return esc(x.tube) + (x.min_volume_ml ? ' (' + x.min_volume_ml + ' ml)' : '') + (x.preferred ? ' · preferred' : ''); }).join(', ') + '</p>' : '') +
      '</div>' +
      '<div class="tm-card"><div class="tm-card-head"><h3>Parameters</h3>' + (ro ? '' : '<button type="button" class="tm-btn" data-tm-add>+ Add parameter</button>') + '</div>' +
      '<div class="tm-table-wrap"><table class="tm-table tm-edit"><thead><tr><th>#</th><th>Code</th><th>Parameter</th><th>Input</th><th>Unit</th><th>Normal min</th><th>Normal max</th><th>Critical min</th><th>Critical max</th><th>Method</th><th>Type</th><th></th></tr></thead>' +
      '<tbody>' + paramRows(ro) + '</tbody></table></div><p class="muted small">▾ opens choice options, formula, AMR / %CV, reagent and print settings for a parameter.</p></div>' +
      '<div class="tm-card"><div class="tm-card-head"><h3>Reference ranges (age / gender)</h3>' + (ro ? '' : '<button type="button" class="tm-btn" data-tm-radd>+ Add range</button>') + '</div>' +
      '<div class="tm-table-wrap"><table class="tm-table tm-edit"><thead><tr><th>Parameter</th><th>Gender</th><th>Age from (y)</th><th>Age to (y)</th><th>Normal min</th><th>Normal max</th><th>Critical min</th><th>Critical max</th><th>Label</th><th></th></tr></thead>' +
      '<tbody>' + rangeRows(ro) + '</tbody></table></div></div>' +
      (ro ? '' : '<div class="tm-save"><button type="button" class="tm-btn primary" data-tm-save' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Saving…' : creating ? 'Create test' : 'Save changes') + '</button>' +
        '<span class="tm-status ' + esc(st.tone) + '">' + esc(st.message || (dirty() ? 'Unsaved changes' : '')) + '</span>' +
        '<span class="muted small">Changes apply to reports created after saving.</span></div>');
    bindDetail(ro);
  }

  function readValue(el) {
    if (el.type === 'checkbox') return el.checked ? 1 : 0;
    return el.value;
  }

  function bindDetail(ro) {
    var p = panel();
    var t = st.detail;
    p.querySelector('[data-tm-back]').addEventListener('click', function () {
      if (dirty() && !window.confirm('Leave without saving your changes to this test?')) return;
      st.view = 'list';
      st.detail = null;
      loadList();
      drawList();
    });
    if (ro) {
      p.querySelectorAll('[data-tm-more]').forEach(function (b) {
        b.addEventListener('click', function () { var i = +b.getAttribute('data-tm-more'); st.expanded[i] = !st.expanded[i]; drawDetail(); });
      });
      return;
    }
    var status = function () {
      var s = p.querySelector('.tm-status');
      if (s && !st.busy) { st.message = ''; st.tone = ''; s.className = 'tm-status'; s.textContent = dirty() ? 'Unsaved changes' : ''; }
    };
    p.querySelectorAll('[data-tm-h]').forEach(function (el) {
      var key = el.getAttribute('data-tm-h');
      var apply = function () {
        if (key === 'tat_days') {
          t.tat_days = el.value === '' ? '' : tatDays(el.value);
          var hint = p.querySelector('[data-tm-tat-hint]');
          if (hint) hint.textContent = tatHint(t.tat_days);
        } else {
          t[key] = readValue(el);
        }
        status();
      };
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', apply);
      if (key === 'tat_days') {
        el.addEventListener('change', apply);
        el.addEventListener('blur', function () {
          t.tat_days = tatDays(el.value);
          el.value = String(t.tat_days);
          var hint = p.querySelector('[data-tm-tat-hint]');
          if (hint) hint.textContent = tatHint(t.tat_days);
          status();
        });
      }
    });
    p.querySelectorAll('[data-tm-p]').forEach(function (el) {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
        t.parameters[+el.getAttribute('data-tm-p')][el.getAttribute('data-k')] = el.value;
        status();
      });
    });
    p.querySelectorAll('[data-tm-r]').forEach(function (el) {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
        t.reference_ranges[+el.getAttribute('data-tm-r')][el.getAttribute('data-k')] = el.value;
        status();
      });
    });
    p.querySelectorAll('[data-tm-more]').forEach(function (b) {
      b.addEventListener('click', function () { var i = +b.getAttribute('data-tm-more'); st.expanded[i] = !st.expanded[i]; drawDetail(); });
    });
    p.querySelectorAll('[data-tm-up]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-tm-up');
        var row = t.parameters.splice(i, 1)[0];
        t.parameters.splice(i - 1, 0, row);
        st.expanded = {};
        drawDetail();
      });
    });
    p.querySelectorAll('[data-tm-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-tm-del');
        if (!window.confirm('Remove parameter "' + (t.parameters[i].parameter_name || '') + '" from this test?')) return;
        t.parameters.splice(i, 1);
        st.expanded = {};
        drawDetail();
      });
    });
    p.querySelectorAll('[data-tm-rdel]').forEach(function (b) {
      b.addEventListener('click', function () { t.reference_ranges.splice(+b.getAttribute('data-tm-rdel'), 1); drawDetail(); });
    });
    var add = p.querySelector('[data-tm-add]');
    if (add) add.addEventListener('click', function () {
      t.parameters.push({ parameter_code: '', parameter_name: '', result_input_type: 'Numeric', unit: '', parameter_kind: 'Real', print_style: 'Normal', delta_limit_percent: 20 });
      drawDetail();
    });
    var radd = p.querySelector('[data-tm-radd]');
    if (radd) radd.addEventListener('click', function () {
      t.reference_ranges.push({ parameter_code: '', gender: 'Both', age_from_years: 0, age_to_years: 120 });
      drawDetail();
    });
    var save = p.querySelector('[data-tm-save]');
    if (save) save.addEventListener('click', saveTest);
  }

  function saveTest() {
    var t = st.detail;
    if (!t.name && !String(t.test_name || '').trim()) { st.message = 'Enter a test name'; st.tone = 'error'; drawDetail(); return; }
    if (!t.department) { st.message = 'Pick a department'; st.tone = 'error'; drawDetail(); return; }
    var blank = t.parameters.filter(function (r) { return !String(r.parameter_name || '').trim(); }).length;
    if (blank) { st.message = 'Every parameter needs a name'; st.tone = 'error'; drawDetail(); return; }
    st.busy = true;
    st.message = '';
    drawDetail();
    var payload = {};
    t.tat_days = tatDays(t.tat_days);
    ['test_name', 'department', 'item', 'disabled', 'is_nabl', 'lis_code', 'report_category', 'nabl_discipline', 'specimen_material', 'result_layout', 'uses_age_related_ranges', 'machine_method', 'tat_days', 'report_heading_1', 'report_heading_2', 'description', 'modified']
      .forEach(function (k) { payload[k] = t[k]; });
    payload.parameters = t.parameters;
    payload.reference_ranges = t.reference_ranges;
    call('save_lab_test_master', { test: t.name || '', data: JSON.stringify(payload) }).then(function (d) {
      st.busy = false;
      st.detail = d.test;
      st.original = editable();
      st.expanded = {};
      st.message = 'Saved. New reports use these settings.';
      st.tone = 'ok';
      st.list = null;
      drawDetail();
    }).catch(function (err) {
      st.busy = false;
      st.message = err.message || 'Could not save';
      st.tone = 'error';
      drawDetail();
    });
  }

  /* ------------------------------------------------------------------ boot */

  function tick() {
    if (!labLayout()) {
      if (st.open && location.pathname !== PATH) close(true);
      return;
    }
    addLink();
    if (location.pathname === PATH) {
      if (!document.querySelector('[data-tm-panel]')) open();
      else markLink();
    } else if (st.open) {
      close(true);
    }
  }
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  tick();
  window.addEventListener('load', tick);
})();
