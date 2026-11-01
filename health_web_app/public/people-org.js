(function () {
  var METHOD = '/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_org.';
  var CHAIN = ['Wing', 'Division', 'Department', 'Designation', 'Unit', 'Position'];
  var WING_ORDER = ['LAB', 'AESTHETIC', 'CARE'];
  var DIVISION_ORDER = ['COCO', 'FOCO', 'BACKOFFICE'];
  var LEVEL = { Wing: 'Wing', Division: 'Division', Department: 'Department', Designation: 'Designation', Unit: 'Unit/Centre', Position: 'Position' };
  var state = { tab: 'Structure', data: null, message: '', error: '', draft: blankDraft(), loading: false, filters: blankFilters() };

  function blankFilters() {
    return { wing: '', division: '', department: '', designation: '', unit: '', position: '' };
  }

  function blankDraft() {
    return { name: '', kind: 'Wing', title: '', wing: '', division: '', department: '', designation: '', unit: '', active: '1' };
  }

  function byOrder(rows, order, key) {
    return rows.slice().sort(function (a, b) {
      var ai = order.indexOf(a[key || 'title']);
      var bi = order.indexOf(b[key || 'title']);
      if (ai < 0) ai = 99;
      if (bi < 0) bi = 99;
      return ai - bi || String(a.title).localeCompare(String(b.title));
    });
  }

  function sidBody(extra) {
    var body = new URLSearchParams(extra || {});
    try {
      var session = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      if (session && session.sid) body.set('sid', session.sid);
    } catch (e) {}
    return body;
  }

  function post(method, extra) {
    return fetch(METHOD + method, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Frappe-Site-Name': 'health.localhost',
      },
      body: sidBody(extra),
    }).then(function (res) { return res.json(); }).then(function (json) {
      var nested = json && json.message && typeof json.message === 'object' ? json.message : json;
      if (nested && nested.status === 'error') throw new Error(nested.message || 'Request failed');
      return nested && nested.data ? nested.data : nested;
    });
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function masters(kind) {
    return ((state.data && state.data.masters) || []).filter(function (row) { return row.kind === kind; });
  }

  function corporateWing(row) {
    return row.title === 'Corporate / Back Office' || row.area === 'Corporate';
  }

  function businessWings() {
    return masters('Wing').filter(function (row) { return !corporateWing(row); });
  }

  function deptKey(dept) {
    return dept.erp_name || ((dept.wing ? dept.wing + ' — ' : '') + dept.title);
  }

  function sameDept(row, dept) {
    var key = deptKey(dept);
    return row.department === key || (row.department === dept.title && (row.wing || '') === (dept.wing || ''));
  }

  function options(rows, valueKey, labelFn, selected) {
    return rows.map(function (row) {
      var value = valueKey ? row[valueKey] : row.title;
      return '<option value="' + esc(value) + '"' + (String(selected || '') === String(value) ? ' selected' : '') + '>' + esc(labelFn ? labelFn(row) : row.title) + '</option>';
    }).join('');
  }

  function nextKind(kind) {
    var index = CHAIN.indexOf(kind);
    return index >= 0 && index < CHAIN.length - 1 ? CHAIN[index + 1] : '';
  }

  function nodeActions(row, ctx) {
    if (!state.data || !state.data.can_edit) return '';
    ctx = ctx || {};
    var child = nextKind(row.kind);
    var childLabel = child ? (LEVEL[child] || child) : '';
    return '<span class="wdd-actions">' +
      (child ? '<button type="button" data-add="' + esc(row.name) + '" data-ctx-wing="' + esc(ctx.wing || row.wing || '') + '" data-ctx-division="' + esc(ctx.division || row.division || '') + '" data-ctx-department="' + esc(ctx.department || '') + '" data-ctx-designation="' + esc(ctx.designation || '') + '" data-ctx-unit="' + esc(ctx.unit || '') + '">Add ' + esc(childLabel) + '</button>' : '') +
      '<button type="button" data-edit="' + esc(row.name) + '">Edit</button>' +
      '<button type="button" data-toggle="' + esc(row.name) + '" data-kind="' + esc(row.kind) + '" data-title="' + esc(row.title) + '" data-wing="' + esc(row.wing) + '" data-division="' + esc(row.division) + '" data-department="' + esc(row.department) + '" data-designation="' + esc(row.designation) + '" data-unit="' + esc(row.unit) + '" data-active="' + (row.active ? '0' : '1') + '">' +
      (row.active ? 'Deactivate' : 'Activate') + '</button></span>';
  }

  function node(label, row, ctx) {
    return '<div class="wdd-node' + (row.active ? '' : ' off') + '"><span class="wdd-k">' + esc(label) + '</span><b>' + esc(row.title) + '</b>' + nodeActions(row, ctx) + '</div>';
  }

  function positionBlock(unit, ctx) {
    var positions = masters('Position').filter(function (row) {
      return row.unit === unit.title || row.unit === unit.erp_name;
    });
    return positions.map(function (row) {
      return '<li>' + node('Position', row, ctx) + '</li>';
    }).join('');
  }

  function unitBlock(designation, dept, divisionTitle) {
    var units = masters('Unit').filter(function (row) {
      if (!sameDept(row, dept)) return false;
      if (divisionTitle && row.division && row.division !== divisionTitle) return false;
      return !row.designation || row.designation === designation.title || row.designation === designation.erp_name;
    });
    var ctx = { wing: dept.wing, division: divisionTitle || dept.division || '', department: deptKey(dept), designation: designation.title };
    return units.map(function (row) {
      var unitCtx = Object.assign({}, ctx, { unit: row.title });
      return '<li>' + node('Unit/Centre', row, unitCtx) + '<ul>' + positionBlock(row, unitCtx) + '</ul></li>';
    }).join('');
  }

  function deptBlock(dept, divisionTitle) {
    var designations = masters('Designation').filter(function (row) {
      return sameDept(row, dept) && (!row.division || !divisionTitle || row.division === divisionTitle);
    });
    var ctx = { wing: dept.wing, division: divisionTitle || dept.division || '', department: deptKey(dept) };
    return '<li>' + node('Department', dept, ctx) + '<ul>' +
      designations.map(function (row) {
        var designCtx = Object.assign({}, ctx, { designation: row.title });
        return '<li>' + node('Designation', row, designCtx) + '<ul>' + unitBlock(row, dept, divisionTitle) + '</ul></li>';
      }).join('') +
      '</ul></li>';
  }

  function departmentsFor(wing, division) {
    return masters('Department').filter(function (row) {
      return row.wing === wing.title && (!row.division || row.division === division.title);
    });
  }

  function wingBlock(wing) {
    var divisions = byOrder(masters('Division').filter(function (row) { return row.wing === wing.title; }), DIVISION_ORDER);
    return '<li class="wdd-wing">' + node('Wing', wing, { wing: wing.title }) + '<ul>' +
      divisions.map(function (division) {
        return '<li>' + node('Division', division, { wing: wing.title, division: division.title }) + '<ul>' +
          departmentsFor(wing, division).map(function (dept) { return deptBlock(dept, division.title); }).join('') +
          '</ul></li>';
      }).join('') +
      '</ul></li>';
  }

  function tree() {
    var wings = byOrder(businessWings(), WING_ORDER);
    var corporate = masters('Department').filter(function (row) { return !row.wing; });
    var missing = WING_ORDER.filter(function (title) { return !wings.some(function (row) { return row.title === title; }); });
    return '<div class="wdd-tree"><h2>Business Wing</h2>' +
      '<p class="org-lead">LAB, AESTHETIC, and CARE. Each wing uses COCO, FOCO, and BACKOFFICE.</p>' +
      (missing.length ? '<p class="org-error">Missing business wings: ' + esc(missing.join(', ')) + '</p>' : '') +
      (wings.length ? '<ul class="wdd-root">' + wings.map(wingBlock).join('') + '</ul>' : '<p>No business wings yet.</p>') +
      '<h2>Corporate / Back Office</h2><p class="org-lead">Corporate departments do not use a business wing or division.</p>' +
      '<ul class="wdd-root">' + corporate.map(function (dept) { return deptBlock(dept, ''); }).join('') + '</ul></div>';
  }

  function form() {
    if (!state.data || !state.data.can_edit) return '';
    var draft = state.draft || blankDraft();
    var kind = draft.kind || 'Wing';
    var wings = businessWings().filter(function (row) { return row.active; });
    var divisions = masters('Division').filter(function (row) { return row.active && (!draft.wing || row.wing === draft.wing); });
    var departments = masters('Department').filter(function (row) { return row.active && (!draft.wing || row.wing === draft.wing); });
    var designations = masters('Designation').filter(function (row) { return row.active && (!draft.department || sameDept(row, { title: draft.department, wing: draft.wing, erp_name: draft.department })); });
    var units = masters('Unit').filter(function (row) { return row.active && (!draft.wing || !row.wing || row.wing === draft.wing); });
    var showWing = kind !== 'Wing';
    var showDivision = kind === 'Department' || kind === 'Designation' || kind === 'Unit' || kind === 'Position';
    var showDepartment = kind === 'Designation' || kind === 'Unit' || kind === 'Position';
    var showDesignation = kind === 'Unit' || kind === 'Position';
    var showUnit = kind === 'Position';
    return '<form class="org-form" data-org-form="1"><h2>' + (draft.name ? 'Edit' : 'Add') + ' · Wing → Division → Department → Designation → Unit/Centre → Position</h2>' +
      (draft.name ? '<input type="hidden" name="name" value="' + esc(draft.name) + '" />' : '') +
      '<label>Level<select name="kind" data-draft="kind">' +
      CHAIN.map(function (item) { return '<option value="' + item + '"' + (item === kind ? ' selected' : '') + '>' + LEVEL[item] + '</option>'; }).join('') +
      '</select></label>' +
      '<label>Name<input name="title" required value="' + esc(draft.title) + '" placeholder="Name" /></label>' +
      (showWing ? '<label>Wing<select name="wing" data-draft="wing"><option value="">Corporate / Back Office</option>' + options(wings, '', null, draft.wing) + '</select></label>' : '<input type="hidden" name="wing" value="" />') +
      (showDivision ? '<label>Division<select name="division" data-draft="division"><option value="">All divisions of this wing</option>' + options(divisions, '', null, draft.division) + '</select></label>' : '') +
      (showDepartment ? '<label>Department<select name="department" data-draft="department" required><option value="">Choose department</option>' +
        options(departments, 'erp_name', function (row) { return (row.wing ? row.wing + ' — ' : 'Corporate — ') + row.title; }, draft.department) + '</select></label>' : '') +
      (showDesignation ? '<label>Designation<select name="designation" data-draft="designation"><option value="">Choose designation</option>' + options(designations, '', null, draft.designation) + '</select></label>' : '') +
      (showUnit ? '<label>Unit / Centre<select name="unit" data-draft="unit" required><option value="">Choose unit / centre</option>' + options(units, '', null, draft.unit) + '</select></label>' : '') +
      '<div class="wdd-form-actions"><button class="org-save" type="submit">' + (draft.name ? 'Save changes' : 'Add') + '</button>' +
      (draft.name ? '<button type="button" data-cancel-edit="1">Cancel</button>' : '') + '</div></form>';
  }

  function employees() {
    var term = String(state.empFilter || '').trim().toLowerCase();
    var allRows = (state.data && state.data.employees) || [];
    var rows = term ? allRows.filter(function (r) {
      return [r.name, r.id, r.wing, r.division, r.department, r.designation, r.unit, r.position].some(function (v) { return String(v || '').toLowerCase().indexOf(term) !== -1; });
    }) : allRows;
    var search = '<div class="wt-toolbar wt-emp-toolbar"><label class="wt-search"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input type="search" data-emp-filter placeholder="Filter employees by name, ID, wing, department, unit…" value="' + esc(state.empFilter || '') + '" /></label>' +
      '<span class="org-lead">' + rows.length + ' of ' + allRows.length + ' employees</span></div>';
    return search + employeesTable(rows, allRows);
  }

  function employeesTable(rows, allRows) {
    var wings = businessWings();
    var divisions = masters('Division');
    var departments = masters('Department');
    var designations = masters('Designation');
    var units = masters('Unit');
    var positions = masters('Position');
    var body = rows.map(function (row) {
      var deptOptions = departments.filter(function (item) { return !row.wing || !item.wing || item.wing === row.wing; });
      var designOptions = designations.filter(function (item) { return item.active && (!row.department || sameDept(item, { title: row.department, wing: row.wing, erp_name: row.department })); });
      var unitOptions = units.filter(function (item) { return item.active && (!row.wing || !item.wing || item.wing === row.wing); });
      var positionOptions = positions.filter(function (item) { return item.active && (!row.unit || !item.unit || item.unit === row.unit); });
      return '<tr><td><b>' + esc(row.name) + '</b><br><small>' + esc(row.id) + '</small></td><td>' +
        '<form class="org-assign" data-employee="' + esc(row.id) + '">' +
        '<select name="wing"><option value="">Corporate</option>' + options(wings) + '</select>' +
        '<select name="division"><option value="">No division</option>' + options(divisions.filter(function (item) { return !row.wing || item.wing === row.wing; })) + '</select>' +
        '<select name="department"><option value="">Department</option>' + options(deptOptions, 'erp_name', function (item) { return (item.wing ? item.wing + ' — ' : '') + item.title; }) + '</select>' +
        '<select name="designation"><option value="">Designation</option>' + options(designOptions.length ? designOptions : designations.filter(function (item) { return item.active; })) + '</select>' +
        '<select name="unit"><option value="">Unit / Centre</option>' + options(unitOptions) + '</select>' +
        '<select name="position"><option value="">Position</option>' + options(positionOptions) + '</select>' +
        '<select name="reports_to"><option value="">Reporting manager</option>' + allRows.map(function (other) { return other.id === row.id ? '' : '<option value="' + esc(other.id) + '">' + esc(other.name) + '</option>'; }).join('') + '</select>' +
        '<button type="submit">Save</button></form>' +
        '<small>' + esc([row.wing || 'Corporate', row.division, row.department, row.designation, row.unit, row.position].filter(Boolean).join(' → ') || 'Not assigned') + '</small></td></tr>';
    }).join('');
    return '<div class="org-table-wrap"><table class="org-table"><thead><tr><th>Employee</th><th>Wing → Division → Department → Designation → Unit/Centre → Position</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="2">No employees in your scope.</td></tr>') + '</tbody></table></div>';
  }

  var KNOWN_CODES = { LAB: 'LAB', AESTHETIC: 'AEST', CARE: 'CARE', COCO: 'COCO', FOCO: 'FOCO', BACKOFFICE: 'BACK', 'Corporate / Back Office': 'CORP' };
  var TYPE_LABEL = { Wing: 'Wing', Division: 'Division', Department: 'Department', Designation: 'Designation', Unit: 'Unit/Centre', Position: 'Position' };
  var ICONS = {
    Wing: '<path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5"/>',
    Division: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="15" width="6" height="5" rx="1"/><rect x="15" y="15" width="6" height="5" rx="1"/><path d="M12 8v4M6 15v-3h12v3"/>',
    Department: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    Designation: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    Unit: '<path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2"/>',
    Position: '<circle cx="12" cy="7.5" r="3"/><path d="M6.5 20a5.5 5.5 0 0 1 11 0"/><path d="M12 13v3"/>',
  };

  function icon(type, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[type] || ICONS.Department) + '</svg>';
  }

  function abbr(title) {
    if (KNOWN_CODES[title]) return KNOWN_CODES[title];
    var words = String(title || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
    if (!words.length) return 'X';
    if (words.length === 1) return words[0].slice(0, words[0].length <= 4 ? 4 : 3).toUpperCase();
    return words.map(function (w) { return w.charAt(0); }).join('').slice(0, 4).toUpperCase();
  }

  function sameText(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function empMatches(emp, m) {
    if (m.corporate && emp.wing) return false;
    if (m.wing && !sameText(emp.wing, m.wing)) return false;
    if (m.division && !sameText(emp.division, m.division)) return false;
    if (m.dept) {
      var d = m.dept;
      var dep = String(emp.department || '');
      if (!(dep === deptKey(d) || (sameText(dep, d.title) && sameText(emp.wing, d.wing)))) return false;
    }
    if (m.designation && !(sameText(emp.designation, m.designation.title) || sameText(emp.designation, m.designation.erp_name))) return false;
    if (m.unit && !sameText(emp.unit, m.unit)) return false;
    if (m.position && !sameText(emp.position, m.position)) return false;
    return true;
  }

  function inferParent(r, all) {
    function first(list) { return list.length ? list[0].name : ''; }
    var corp = first(all.filter(function (x) { return x.kind === 'Wing' && corporateWing(x); }));
    if (r.kind === 'Division') return first(all.filter(function (x) { return x.kind === 'Wing' && x.title === r.wing; }));
    if (r.kind === 'Department') {
      if (r.wing && r.division) return first(all.filter(function (x) { return x.kind === 'Division' && x.wing === r.wing && x.title === r.division; }));
      if (r.wing) return first(all.filter(function (x) { return x.kind === 'Wing' && x.title === r.wing; }));
      return corp;
    }
    if (r.kind === 'Designation') return first(all.filter(function (x) { return x.kind === 'Department' && x.erp_name && x.erp_name === r.department; }));
    if (r.kind === 'Unit') {
      return first(all.filter(function (x) { return x.kind === 'Designation' && x.title === r.designation && x.department === r.department; })) ||
        first(all.filter(function (x) { return x.kind === 'Department' && x.erp_name === r.department; }));
    }
    if (r.kind === 'Position') return first(all.filter(function (x) { return x.kind === 'Unit' && x.title === r.unit && (!r.department || x.department === r.department); }));
    return '';
  }

  function buildNodes() {
    var nodes = [];
    var emps = (state.data && state.data.employees) || [];
    var all = (state.data && state.data.masters) || [];
    var byParent = {};
    all.forEach(function (r) {
      if (r.kind === 'Wing') return;
      var p = r.parent_master || inferParent(r, all);
      if (!p) return;
      (byParent[p] = byParent[p] || []).push(r);
    });
    function kids(row) {
      var list = (byParent[row.name] || []).slice();
      var order = { Division: 0, Department: 1, Designation: 2, Unit: 3, Position: 4 };
      return list.sort(function (a, b) {
        if (a.kind !== b.kind) return order[a.kind] - order[b.kind];
        if (a.kind === 'Division') {
          var ai = DIVISION_ORDER.indexOf(a.title), bi = DIVISION_ORDER.indexOf(b.title);
          return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.title.localeCompare(b.title);
        }
        return String(a.title).localeCompare(String(b.title));
      });
    }
    function add(row, depth, parent, ctx, match) {
      var type = row.kind;
      var c = Object.assign({}, ctx);
      var m = Object.assign({}, match);
      if (type === 'Wing') {
        if (corporateWing(row)) { c.wing = ''; m.corporate = true; } else { c.wing = row.title; m.wing = row.title; }
      } else if (type === 'Division') { c.division = row.title; m.division = row.title; }
      else if (type === 'Department') { c.department = deptKey(row); m.dept = row; }
      else if (type === 'Designation') { c.designation = row.title; m.designation = row; }
      else if (type === 'Unit') { c.unit = row.title; m.unit = row.title; }
      else if (type === 'Position') { m.position = row.title; }
      var code = type === 'Wing' ? (corporateWing(row) ? 'CORP' : abbr(row.title)) : parent.code + '-' + abbr(row.title);
      var node = {
        key: type + ':' + row.name,
        type: type, row: row, depth: depth, parent: parent, code: code, ctx: c, children: [],
        count: emps.filter(function (e) { return empMatches(e, m); }).length,
      };
      if (type === 'Wing' && corporateWing(row)) node.corporate = true;
      if (parent) parent.children.push(node);
      nodes.push(node);
      kids(row).forEach(function (child) { add(child, depth + 1, node, c, m); });
      return node;
    }
    byOrder(businessWings(), WING_ORDER).forEach(function (wing) { add(wing, 0, null, {}, {}); });
    var corpRow = masters('Wing').filter(corporateWing)[0];
    if (corpRow) add(corpRow, 0, null, {}, {});
    return nodes;
  }

  var CORPORATE_TITLE = 'Corporate / Back Office';

  function isOpen(node) {
    if (!state.open) {
      state.open = {};
      var first = (state.nodes || []).filter(function (n) { return n.depth === 0; })[0];
      if (first) {
        state.open[first.key] = true;
        if (first.children[0]) state.open[first.children[0].key] = true;
      }
    }
    return !!state.open[node.key];
  }

  function visibleNodes() {
    var nodes = state.nodes || [];
    var q = String(state.q || '').trim().toLowerCase();
    var status = state.statusFilter || '';
    var type = state.typeFilter || '';
    function statusOk(n) { return !status || (status === 'active' ? !!n.row.active : !n.row.active); }
    if (type) {
      return nodes.filter(function (n) {
        return n.type === type && statusOk(n) && (!q || String(n.row.title).toLowerCase().indexOf(q) !== -1);
      }).map(function (n) { return { node: n, depth: 0, flat: true }; });
    }
    var keep = {};
    if (q) {
      nodes.forEach(function (n) {
        if (String(n.row.title).toLowerCase().indexOf(q) !== -1 || String(n.code).toLowerCase().indexOf(q) !== -1) {
          for (var p = n; p; p = p.parent) keep[p.key] = true;
        }
      });
    }
    var out = [];
    function walk(n) {
      if (q && !keep[n.key]) return;
      if (!statusOk(n) && !n.children.length) return;
      out.push({ node: n, depth: n.depth });
      if (q || isOpen(n)) n.children.forEach(walk);
    }
    nodes.filter(function (n) { return !n.parent; }).forEach(walk);
    return out;
  }

  function rowHtml(item) {
    var n = item.node;
    var r = n.row;
    var canEdit = state.data && state.data.can_edit;
    var child = n.type === 'Wing' && n.corporate ? 'Department' : nextKind(n.type);
    var guides = '';
    for (var i = 0; i < item.depth; i++) guides += '<span class="wt-guide"></span>';
    var caret = n.children.length && !item.flat
      ? '<button type="button" class="wt-caret' + (isOpen(n) || state.q ? ' open' : '') + '" data-wt-toggle="' + esc(n.key) + '" aria-label="Expand">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg></button>'
      : '<span class="wt-caret-space"></span>';
    var path = item.flat ? '<small class="wt-path">' + esc([n.ctx.wing || CORPORATE_TITLE, n.ctx.division, n.type !== 'Department' && n.ctx.department ? n.ctx.department.replace(/^.*— /, '').replace(/ - [A-Z]+$/, '') : ''].filter(Boolean).join(' › ')) + '</small>' : '';
    var addBtn = canEdit && child && !r.virtual
      ? '<button type="button" class="wt-add" data-add="' + esc(r.name) + '" data-add-kind="' + esc(child) + '" data-ctx-wing="' + esc(n.ctx.wing || '') + '" data-ctx-division="' + esc(n.ctx.division || '') + '" data-ctx-department="' + esc(n.ctx.department || '') + '" data-ctx-designation="' + esc(n.ctx.designation || '') + '" data-ctx-unit="' + esc(n.ctx.unit || '') + '">+ Add</button>'
      : (canEdit && n.corporate ? '<button type="button" class="wt-add" data-add-corporate="1">+ Add</button>' : '<span class="wt-add-space"></span>');
    var menu = canEdit && !r.virtual
      ? '<div class="wt-menu-wrap"><button type="button" class="wt-more" data-wt-menu="' + esc(n.key) + '" aria-label="More">⋮</button>' +
        (state.menu === n.key
          ? '<div class="wt-menu"><button type="button" data-edit="' + esc(r.name) + '">Edit</button>' +
            '<button type="button" data-toggle="' + esc(r.name) + '" data-kind="' + esc(r.kind) + '" data-title="' + esc(r.title) + '" data-wing="' + esc(r.wing) + '" data-division="' + esc(r.division) + '" data-department="' + esc(r.department) + '" data-designation="' + esc(r.designation) + '" data-unit="' + esc(r.unit) + '" data-active="' + (r.active ? '0' : '1') + '">' + (r.active ? 'Deactivate' : 'Activate') + '</button>' +
            '<button type="button" data-wt-people="' + esc(n.key) + '">View employees</button>' +
            '<button type="button" class="wt-danger" data-wt-delete="' + esc(r.name) + '" data-title="' + esc(r.title) + '" data-type="' + esc(TYPE_LABEL[n.type]) + '">Delete</button></div>'
          : '') + '</div>'
      : '<span class="wt-more-space"></span>';
    return '<tr class="wt-row wt-' + n.type.toLowerCase() + (r.active ? '' : ' off') + '">' +
      '<td class="wt-name"><div class="wt-name-in">' + guides + caret +
      '<span class="wt-ico wt-ico-' + n.type.toLowerCase() + '">' + icon(n.type, n.depth === 0 ? 20 : 17) + '</span>' +
      '<span class="wt-title"><b>' + esc(r.title) + '</b>' + path + '</span><span class="wt-pill">' + n.count.toLocaleString('en-IN') + '</span></div></td>' +
      '<td>' + esc(TYPE_LABEL[n.type]) + '</td><td class="wt-code">' + esc(n.code) + '</td>' +
      '<td>' + n.count.toLocaleString('en-IN') + '</td>' +
      '<td><span class="wt-status' + (r.active ? '' : ' off') + '"><i></i>' + (r.active ? 'Active' : 'Inactive') + '</span></td>' +
      '<td class="wt-actions"><div class="wt-actions-in">' + addBtn + menu + '</div></td></tr>';
  }

  function tableBody() {
    var rows = visibleNodes();
    return rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="6" class="wt-empty">Nothing matches your search.</td></tr>';
  }

  function kpis() {
    var active = function (kind) { return masters(kind).filter(function (r) { return r.active; }).length; };
    var cards = [
      ['Wing', active('Wing') - masters('Wing').filter(function (r) { return corporateWing(r) && r.active; }).length, 'Wings', 'Active wings'],
      ['Division', masters('Division').length, 'Divisions', 'Across all wings'],
      ['Department', masters('Department').length, 'Departments', 'Total departments'],
      ['Designation', masters('Designation').length, 'Designations', 'Total designations'],
      ['Position', active('Position'), 'Positions', 'Active positions'],
      ['Unit', masters('Unit').length, 'Units/Centres', 'Total centres'],
    ];
    return '<div class="wt-kpis">' + cards.map(function (c) {
      return '<div class="wt-kpi wt-kpi-' + c[0].toLowerCase() + '"><span class="wt-kpi-ico">' + icon(c[0], 22) + '</span><div><b>' + c[1] + '</b><strong>' + c[2] + '</strong><small>' + c[3] + '</small></div></div>';
    }).join('') + '</div>';
  }

  function structureView() {
    return kpis() +
      '<div class="wt-card"><div class="wt-toolbar">' +
      '<label class="wt-search"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input type="search" data-wt-search placeholder="Search wing, division, department, designation or unit…" value="' + esc(state.q || '') + '" /></label>' +
      '<select class="wt-expand" data-wt-expand><option value="">Expand All</option><option value="all">Expand all</option><option value="wings">Wings & divisions</option><option value="none">Collapse all</option></select>' +
      '<div class="wt-filter-wrap"><button type="button" class="wt-filter' + (state.typeFilter || state.statusFilter ? ' on' : '') + '" data-wt-filter aria-label="Filter">' +
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16l-6 8v6l-4-2v-4z"/></svg></button>' +
      (state.filterOpen ? '<div class="wt-filter-pop"><label>Type<select data-wt-type><option value="">All types</option>' +
        CHAIN.map(function (k) { return '<option value="' + k + '"' + (state.typeFilter === k ? ' selected' : '') + '>' + TYPE_LABEL[k] + '</option>'; }).join('') + '</select></label>' +
        '<label>Status<select data-wt-status><option value="">All</option><option value="active"' + (state.statusFilter === 'active' ? ' selected' : '') + '>Active</option><option value="inactive"' + (state.statusFilter === 'inactive' ? ' selected' : '') + '>Inactive</option></select></label>' +
        '<button type="button" data-wt-clear>Clear filters</button></div>' : '') +
      '</div></div>' +
      '<div class="wt-table-wrap"><table class="wt-table"><thead><tr><th>Name</th><th>Type</th><th>Code</th><th>Employees</th><th>Status</th><th class="wt-actions">Actions</th></tr></thead>' +
      '<tbody data-wt-body>' + tableBody() + '</tbody></table></div></div>';
  }

  function pathOf(name) {
    var node = (state.nodes || []).filter(function (n) { return n.row.name === name; })[0];
    var parts = [];
    for (var p = node; p; p = p.parent) parts.unshift(p.row.title);
    return parts.join(' › ');
  }

  function modalHtml() {
    if (!state.modal) return '';
    var d = state.draft || blankDraft();
    var kindLabel = TYPE_LABEL[d.kind] || d.kind;
    var under = d.parent_master ? pathOf(d.parent_master) : '';
    var heading = d.name ? 'Edit ' + kindLabel : 'Add ' + kindLabel;
    return '<div class="wdd-modal" data-wt-modal><form class="org-form wdd-modal-card wt-form" data-org-form="1">' +
      '<h2>' + esc(heading) + '</h2>' +
      (under ? '<p class="org-lead">Under <b>' + esc(under) + '</b></p>' : (d.kind === 'Wing' ? '<p class="org-lead">Top level of the organization</p>' : '')) +
      '<input type="hidden" name="kind" value="' + esc(d.kind) + '" />' +
      '<input type="hidden" name="parent_master" value="' + esc(d.parent_master || '') + '" />' +
      (d.name ? '<input type="hidden" name="name" value="' + esc(d.name) + '" />' : '') +
      '<label>' + esc(kindLabel) + ' name<input name="title" required value="' + esc(d.title || '') + '" placeholder="Enter ' + esc(kindLabel.toLowerCase()) + ' name" autofocus /></label>' +
      '<label>Status<select name="active"><option value="1"' + (d.active !== '0' ? ' selected' : '') + '>Active</option><option value="0"' + (d.active === '0' ? ' selected' : '') + '>Inactive</option></select></label>' +
      '<p class="org-error" data-wt-form-msg></p>' +
      '<div class="wdd-form-actions"><button type="button" data-wt-close>Cancel</button><button class="org-save" type="submit">' + (d.name ? 'Save changes' : 'Add') + '</button></div></form></div>';
  }

  function draw() {
    var host = document.querySelector('[data-org-page="1"]');
    if (!host) return;
    if (state.data) state.nodes = buildNodes();
    var canEdit = state.data && state.data.can_edit;
    host.innerHTML = '<section class="org-page wt-page">' +
      '<header class="wt-head"><div><h1>WDD</h1><nav class="wt-crumb"><span>⌂ Home</span><span>›</span><span>WDD</span></nav>' +
      '<p>Manage your organizational structure – Wing → Division → Department → Designation → Unit/Centre → Position.</p></div>' +
      '<div class="wt-head-actions"><button type="button" class="wt-btn" data-tab="Employees">' + icon('Department', 16) + ' View Employees</button>' +
      (canEdit ? '<button type="button" class="wt-btn primary" data-wt-add-wing>+ Add Wing</button>' : '') + '</div></header>' +
      (state.error ? '<p class="org-error">' + esc(state.error) + '</p>' : '') +
      (state.data && state.data.note ? '<p class="org-error">' + esc(state.data.note) + '</p>' : '') +
      (state.message ? '<p class="org-note">' + esc(state.message) + '</p>' : '') +
      '<div class="wt-tabs"><button type="button" data-tab="Structure" class="' + (state.tab === 'Structure' ? 'on' : '') + '">' + icon('Division', 17) + ' Structure</button>' +
      '<button type="button" data-tab="Employees" class="' + (state.tab === 'Employees' ? 'on' : '') + '">' + icon('Designation', 17) + ' Employees</button></div>' +
      (state.tab === 'Employees' ? employees() : (state.data ? structureView() : '<p>Loading…</p>')) +
      modalHtml() +
      '</section>';
    bind(host);
    bindTree(host);
  }

  function redrawBody(host) {
    var body = host.querySelector('[data-wt-body]');
    if (!body) return;
    body.innerHTML = tableBody();
    bindRows(host);
  }

  function bindRows(host) {
    host.querySelectorAll('[data-wt-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-wt-toggle');
        state.open[key] = !state.open[key];
        redrawBody(host);
      });
    });
    host.querySelectorAll('[data-wt-menu]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var key = b.getAttribute('data-wt-menu');
        state.menu = state.menu === key ? '' : key;
        redrawBody(host);
      });
    });
    host.querySelectorAll('[data-wt-people]').forEach(function (b) {
      b.addEventListener('click', function () {
        var node = (state.nodes || []).filter(function (n) { return n.key === b.getAttribute('data-wt-people'); })[0];
        state.menu = '';
        state.tab = 'Employees';
        state.empFilter = node ? node.row.title : '';
        draw();
      });
    });
    host.querySelectorAll('[data-wt-delete]').forEach(function (b) {
      b.addEventListener('click', function () {
        var title = b.getAttribute('data-title');
        state.menu = '';
        if (!window.confirm('Delete ' + b.getAttribute('data-type') + ' "' + title + '"? This cannot be undone.')) { redrawBody(host); return; }
        fetch('/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_org_delete.delete_people_org_master', {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
          body: sidBody({ name: b.getAttribute('data-wt-delete') }),
        }).then(function (res) { return res.json(); }).then(function (json) {
          var nested = json && json.message && typeof json.message === 'object' ? json.message : json;
          if (!nested || nested.status === 'error') throw new Error((nested && nested.message) || 'Could not delete');
          state.message = title + ' deleted.';
          state.error = '';
          reload();
        }).catch(function (err) {
          state.error = (err && err.message) || 'Could not delete';
          state.message = '';
          draw();
        });
      });
    });
    host.querySelectorAll('[data-add-corporate]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.draft = Object.assign(blankDraft(), { kind: 'Department', wing: '' });
        state.modal = true;
        state.menu = '';
        draw();
      });
    });
    bindNodeActions(host, true);
  }

  function bindTree(host) {
    var search = host.querySelector('[data-wt-search]');
    if (search) search.addEventListener('input', function () { state.q = search.value; redrawBody(host); });
    var expand = host.querySelector('[data-wt-expand]');
    if (expand) expand.addEventListener('change', function () {
      state.open = {};
      (state.nodes || []).forEach(function (n) {
        if (expand.value === 'all' && n.children.length) state.open[n.key] = true;
        if (expand.value === 'wings' && n.depth === 0) state.open[n.key] = true;
      });
      expand.value = '';
      redrawBody(host);
    });
    var filterBtn = host.querySelector('[data-wt-filter]');
    if (filterBtn) filterBtn.addEventListener('click', function (e) { e.stopPropagation(); state.filterOpen = !state.filterOpen; draw(); });
    var typeSel = host.querySelector('[data-wt-type]');
    if (typeSel) typeSel.addEventListener('change', function () { state.typeFilter = typeSel.value; draw(); });
    var statusSel = host.querySelector('[data-wt-status]');
    if (statusSel) statusSel.addEventListener('change', function () { state.statusFilter = statusSel.value; draw(); });
    var clear = host.querySelector('[data-wt-clear]');
    if (clear) clear.addEventListener('click', function () { state.typeFilter = ''; state.statusFilter = ''; state.filterOpen = false; draw(); });
    var addWing = host.querySelector('[data-wt-add-wing]');
    if (addWing) addWing.addEventListener('click', function () { state.draft = blankDraft(); state.modal = true; draw(); });
    host.querySelectorAll('[data-wt-close]').forEach(function (b) {
      b.addEventListener('click', function () { state.modal = false; state.draft = blankDraft(); draw(); });
    });
    var modal = host.querySelector('[data-wt-modal]');
    if (modal) modal.addEventListener('mousedown', function (e) { if (e.target === modal) { state.modal = false; draw(); } });
    bindRows(host);
  }

  if (!window.__wtOutside) {
    window.__wtOutside = true;
    document.addEventListener('click', function (e) {
      if (!state.menu && !state.filterOpen) return;
      if (e.target && e.target.closest && (e.target.closest('.wt-menu-wrap') || e.target.closest('.wt-filter-wrap'))) return;
      var host = document.querySelector('[data-org-page="1"]');
      state.menu = '';
      if (state.filterOpen) { state.filterOpen = false; if (host) draw(); return; }
      if (host) redrawBody(host);
    });
  }

  function bind(host) {
    host.querySelectorAll('[data-tab]').forEach(function (button) {
      button.addEventListener('click', function () { state.tab = button.getAttribute('data-tab'); draw(); });
    });
    host.querySelectorAll('[data-draft]').forEach(function (field) {
      field.addEventListener('change', function () {
        state.draft = state.draft || blankDraft();
        var titleInput = host.querySelector('[data-org-form] input[name="title"]');
        if (titleInput) state.draft.title = titleInput.value;
        state.draft[field.getAttribute('data-draft')] = field.value;
        if (field.name === 'kind' && field.value === 'Unit') state.draft.kind = 'Unit';
        if (field.getAttribute('data-draft') === 'kind') {
          state.draft.wing = '';
          state.draft.division = '';
          state.draft.department = '';
          state.draft.designation = '';
          state.draft.unit = '';
          state.draft.name = '';
        }
        if (field.getAttribute('data-draft') === 'wing') {
          state.draft.division = '';
          state.draft.department = '';
          state.draft.designation = '';
          state.draft.unit = '';
        }
        draw();
      });
    });
    host.querySelectorAll('[data-cancel-edit]').forEach(function (button) {
      button.addEventListener('click', function () { state.draft = blankDraft(); state.modal = false; draw(); });
    });
    var empSearch = host.querySelector('[data-emp-filter]');
    if (empSearch) empSearch.addEventListener('change', function () { state.empFilter = empSearch.value; draw(); });
    var masterForm = host.querySelector('[data-org-form]');
    if (masterForm) masterForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = Object.fromEntries(new FormData(masterForm).entries());
      var btn = masterForm.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      post('save_people_org_master', data).then(function () {
        state.message = 'Saved. It is now available across HRMS.';
        state.error = '';
        state.draft = blankDraft();
        state.modal = false;
        reload();
      }).catch(function (err) {
        var msg = masterForm.querySelector('[data-wt-form-msg]');
        if (btn) { btn.disabled = false; btn.textContent = data.name ? 'Save changes' : 'Add'; }
        if (msg) msg.textContent = String((err && err.message) || 'Could not save').replace(/<[^>]+>/g, '');
        else fail(err);
      });
    });
    host.querySelectorAll('[data-employee]').forEach(function (assignForm) {
      var row = ((state.data && state.data.employees) || []).filter(function (item) { return item.id === assignForm.getAttribute('data-employee'); })[0];
      if (row) {
        ['wing', 'division', 'department', 'designation', 'unit', 'position', 'reports_to'].forEach(function (key) {
          if (assignForm.elements[key] && row[key]) assignForm.elements[key].value = row[key];
        });
      }
      assignForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var payload = Object.fromEntries(new FormData(assignForm).entries());
        payload.employee = assignForm.getAttribute('data-employee');
        post('assign_people_employee_org', payload).then(function () { state.message = 'Employee organization updated.'; reload(); }).catch(fail);
      });
    });
  }

  function bindNodeActions(host) {
    host.querySelectorAll('[data-edit]').forEach(function (button) {
      button.addEventListener('click', function () {
        var row = ((state.data && state.data.masters) || []).filter(function (item) { return item.name === button.getAttribute('data-edit'); })[0];
        if (!row) return;
        state.draft = { name: row.name, kind: row.kind, title: row.title, parent_master: row.parent_master || '', active: row.active ? '1' : '0' };
        state.menu = '';
        state.modal = true;
        state.message = '';
        draw();
      });
    });
    host.querySelectorAll('[data-add]').forEach(function (button) {
      button.addEventListener('click', function () {
        var row = ((state.data && state.data.masters) || []).filter(function (item) { return item.name === button.getAttribute('data-add'); })[0];
        if (!row) return;
        var child = button.getAttribute('data-add-kind') || nextKind(row.kind);
        state.draft = { name: '', kind: child, title: '', parent_master: row.name, active: '1' };
        state.menu = '';
        state.modal = true;
        state.message = '';
        draw();
      });
    });
    host.querySelectorAll('[data-toggle]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.menu = '';
        post('save_people_org_master', {
          name: button.getAttribute('data-toggle'),
          kind: button.getAttribute('data-kind'),
          title: button.getAttribute('data-title'),
          wing: button.getAttribute('data-wing') || '',
          division: button.getAttribute('data-division') || '',
          department: button.getAttribute('data-department') || '',
          designation: button.getAttribute('data-designation') || '',
          unit: button.getAttribute('data-unit') || '',
          active: button.getAttribute('data-active'),
        }).then(function () { state.message = 'Updated.'; reload(); }).catch(fail);
      });
    });
  }

  function fail(error) {
    state.error = error && error.message ? error.message : 'Could not update WDD';
    draw();
  }

  function reload() {
    return post('get_people_org').then(function (data) {
      state.data = data;
      state.error = '';
      draw();
    }).catch(fail);
  }

  function orgOpen() {
    var path = location.pathname.replace(/\/$/, '');
    if (path === '/people/departments' || path === '/people/designations' || path === '/people/divisions') return true;
    return location.hash === '#wdd' || location.hash === '#organization' || /\/organization\/?$/.test(path);
  }

  function filterPath() {
    return /\/people\/(employees|leave|attendance|payslips|performance|onboarding|reports|analytics)\/?$/.test(location.pathname);
  }

  function filterPage() {
    return filterPath() && !!state.data && !!state.data.can_edit;
  }

  function ensureData() {
    if (state.data || state.loading) return;
    state.loading = true;
    post('get_people_org').then(function (data) {
      state.data = data;
      state.loading = false;
      if (!orgOpen()) renderFilters();
      hireInject();
    }).catch(function () { state.loading = false; });
  }

  var CHAIN_KEYS = ['wing', 'division', 'department', 'designation', 'unit', 'position', 'reports_to'];

  function chainOptions(key, v) {
    var deptRef = { title: v.department, wing: v.wing, erp_name: v.department };
    if (key === 'wing') return byOrder(businessWings().filter(function (r) { return r.active; }), WING_ORDER).map(function (r) { return [r.title, r.title]; });
    if (key === 'division') return v.wing ? byOrder(masters('Division').filter(function (r) { return r.active && r.wing === v.wing; }), DIVISION_ORDER).map(function (r) { return [r.title, r.title]; }) : [];
    if (key === 'department') return masters('Department').filter(function (r) { return r.active && (r.wing || '') === (v.wing || '') && (!r.division || !v.division || r.division === v.division); }).map(function (r) { return [deptKey(r), r.title + (r.division ? ' (' + r.division + ')' : '')]; });
    if (key === 'designation') {
      var rows = masters('Designation').filter(function (r) { return r.active && (!v.department || sameDept(r, deptRef)); });
      var seen = {};
      return rows.filter(function (r) { if (seen[r.title]) return false; seen[r.title] = 1; return true; }).map(function (r) { return [r.erp_name || r.title, r.title]; });
    }
    if (key === 'unit') return masters('Unit').filter(function (r) { return r.active && (!v.wing || !r.wing || r.wing === v.wing) && (!v.department || !r.department || sameDept(r, deptRef)); }).map(function (r) { return [r.title, r.title]; });
    if (key === 'position') return masters('Position').filter(function (r) { return r.active && (!v.unit || !r.unit || r.unit === v.unit); }).map(function (r) { return [r.title, r.title]; });
    if (key === 'reports_to') return ((state.data && state.data.employees) || []).filter(function (r) { return r.id !== v.employee; }).map(function (r) { return [r.id, r.name + ' (' + r.id + ')']; });
    return [];
  }

  var CHAIN_LABEL = { wing: 'Wing', division: 'Division', department: 'Department', designation: 'Designation', unit: 'Unit / Centre', position: 'Position', reports_to: 'Reporting Manager' };

  function chainHtml(v) {
    return CHAIN_KEYS.map(function (key) {
      var first = key === 'wing' ? 'Corporate / Back Office' : (key === 'division' && !v.wing ? 'Not applicable' : 'Select ' + CHAIN_LABEL[key].toLowerCase());
      var opts = chainOptions(key, v).map(function (pair) {
        return '<option value="' + esc(pair[0]) + '"' + (String(v[key] || '') === String(pair[0]) ? ' selected' : '') + '>' + esc(pair[1]) + '</option>';
      }).join('');
      return '<label>' + CHAIN_LABEL[key] + '<select data-wdd-chain="' + key + '"' + (key === 'division' && !v.wing ? ' disabled' : '') + '><option value="">' + esc(first) + '</option>' + opts + '</select></label>';
    }).join('');
  }

  function bindChain(box, v, redraw) {
    box.querySelectorAll('[data-wdd-chain]').forEach(function (select) {
      select.addEventListener('change', function () {
        var key = select.getAttribute('data-wdd-chain');
        v[key] = select.value;
        var idx = CHAIN_KEYS.indexOf(key);
        CHAIN_KEYS.slice(idx + 1, 6).forEach(function (k) { if (k !== 'reports_to') v[k] = ''; });
        redraw();
      });
    });
  }

  function chainPayload(v) {
    var out = {};
    CHAIN_KEYS.forEach(function (k) { out[k] = v[k] || ''; });
    return out;
  }

  var MAIN_API = '/api/method/health_ecosystem_core.health_ecosystem_core.api.';
  var geoBoard = null;

  function postMain(method, extra) {
    return fetch(MAIN_API + method, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
      body: sidBody(extra),
    }).then(function (res) { return res.json(); }).then(function (json) {
      var nested = json && json.message && typeof json.message === 'object' ? json.message : json;
      if (nested && nested.status === 'error') throw new Error(String(nested.message || 'Request failed').replace(/<[^>]+>/g, ''));
      return nested && nested.data !== undefined ? nested.data : nested;
    });
  }

  function loadGeofences(force) {
    if (geoBoard && !force) return Promise.resolve(geoBoard);
    return postMain('get_people_geofences').then(function (d) { geoBoard = d || {}; return geoBoard; });
  }

  function geofenceOptions(current) {
    var locs = ((geoBoard && geoBoard.locations) || []).filter(function (l) { return l.status === 'Active' || l.title === current; });
    return locs.map(function (l) {
      return '<option value="' + esc(l.id) + '"' + (l.title === current ? ' selected' : '') + '>' + esc(l.title) + (l.address ? ' — ' + esc(l.address.slice(0, 60)) : '') + ' (' + (l.radius_m || 100) + ' m)</option>';
    }).join('');
  }

  function currentGeofence(employeeId) {
    var row = ((geoBoard && geoBoard.employees) || []).filter(function (e) { return e.id === employeeId; })[0];
    return row ? (row.geofence_label || '') : '';
  }

  function assignGeofence(geofenceId, employeeId) {
    if (!geofenceId || !employeeId) return Promise.resolve();
    return postMain('assign_people_geofence', { geofence: geofenceId, employees: JSON.stringify([employeeId]) });
  }

  function hireInject() {
    document.querySelectorAll('[data-wdd-hire]').forEach(function (box) {
      var modal = box.closest('.hrms-modal');
      if (!modal || !modal.querySelector('#add-employee-title')) box.remove();
    });
    var title = document.querySelector('#add-employee-title');
    var modal = title ? title.closest('.hrms-modal') : null;
    var form = modal ? modal.querySelector('form.hrms-employee-form') : null;
    if (!form || !state.data || !state.data.can_edit) return;
    form.querySelectorAll('label').forEach(function (label) {
      if (label.closest('[data-wdd-hire]')) return;
      var text = (label.firstChild && label.firstChild.textContent || '').trim();
      if ((text === 'Department' || text === 'Designation') && label.querySelector('input')) label.style.display = 'none';
    });
    var box = form.querySelector('[data-wdd-hire]');
    if (box) return;
    state.hire = state.hire || {};
    box = document.createElement('div');
    box.className = 'hrms-form-grid wdd-hire';
    box.setAttribute('data-wdd-hire', '1');
    var submit = form.querySelector('button[type="submit"]');
    var host = submit ? submit.closest('.hrms-form-actions, footer, div') : null;
    if (host && host !== form && host.parentNode === form) form.insertBefore(box, host);
    else form.appendChild(box);
    var draw = function () {
      box.innerHTML = '<p class="wdd-hire-title span-2">Organization · Wing → Division → Department → Designation → Unit/Centre → Position → Reporting Manager</p>' + chainHtml(state.hire) +
        '<p class="wdd-hire-title span-2">Attendance geofence</p>' +
        '<label class="span-2">Geofence location<select data-wdd-hire-geo><option value="">' + (geoBoard ? 'No geofence (assign later)' : 'Loading geofences…') + '</option>' +
        geofenceOptions('').replace('value="' + esc(state.hireGeo || '') + '"', 'value="' + esc(state.hireGeo || '') + '" selected') + '</select></label>';
      bindChain(box, state.hire, draw);
      var geo = box.querySelector('[data-wdd-hire-geo]');
      if (geo) geo.addEventListener('change', function () { state.hireGeo = geo.value; });
    };
    draw();
    if (!geoBoard) loadGeofences().then(function () { if (document.body.contains(box)) draw(); }).catch(function () {});
  }

  var PERSONAL = [
    ['first_name', 'First name', 'text', true],
    ['middle_name', 'Middle name', 'text'],
    ['last_name', 'Last name', 'text'],
    ['gender', 'Gender', ['', 'Male', 'Female', 'Other']],
    ['date_of_birth', 'Date of birth', 'date'],
    ['blood_group', 'Blood group', ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']],
    ['marital_status', 'Marital status', ['', 'Single', 'Married', 'Divorced', 'Widowed']],
  ];
  var CONTACT = [
    ['cell_number', 'Mobile', 'tel'],
    ['personal_email', 'Personal email', 'email'],
    ['company_email', 'Company email', 'email'],
    ['current_address', 'Current address', 'area'],
    ['permanent_address', 'Permanent address', 'area'],
    ['person_to_be_contacted', 'Emergency contact name', 'text'],
    ['emergency_phone_number', 'Emergency phone', 'tel'],
    ['relation', 'Relation', 'text'],
  ];
  var EMPLOYMENT = [
    ['date_of_joining', 'Date of joining', 'date'],
    ['status', 'Status', ['Active', 'Inactive', 'Suspended', 'Left']],
  ];

  function fieldHtml(def, v) {
    var key = def[0];
    var value = v[key] || '';
    var input;
    if (Array.isArray(def[2])) {
      input = '<select data-wdd-field="' + key + '">' + def[2].map(function (o) {
        return '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o || 'Select') + '</option>';
      }).join('') + '</select>';
    } else if (def[2] === 'area') {
      input = '<textarea rows="2" data-wdd-field="' + key + '">' + esc(value) + '</textarea>';
    } else {
      input = '<input type="' + def[2] + '" data-wdd-field="' + key + '" value="' + esc(String(value).slice(0, def[2] === 'date' ? 10 : 500)) + '"' + (def[3] ? ' required' : '') + ' />';
    }
    return '<label' + (def[2] === 'area' ? ' class="wdd-span"' : '') + '>' + esc(def[1]) + input + '</label>';
  }

  function photoSrc(raw) {
    if (!raw) return '';
    if (/^(https?:|data:)/i.test(raw)) return raw;
    return location.origin + (raw.charAt(0) === '/' ? raw : '/' + raw);
  }

  function editModal(employeeId, opts) {
    ensureData();
    var overlay = document.createElement('div');
    overlay.className = 'wdd-modal';
    overlay.innerHTML = '<div class="wdd-modal-card"><p>Loading employee…</p></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) overlay.remove(); });
    post('get_people_employee_detail', { employee: employeeId }).then(function (emp) {
      var v = Object.assign({ employee: employeeId }, emp);
      var photo = { name: '', data: '' };
      overlay.innerHTML = '<form class="wdd-modal-card wdd-edit">' +
        '<h3>Edit employee</h3><p class="org-lead">' + esc(emp.name) + ' · ' + esc(employeeId) + '</p>' +
        '<div class="wdd-photo-row"><div class="wdd-photo" data-wdd-photo>' + (emp.photo ? '<img src="' + esc(photoSrc(emp.photo)) + '" alt="" />' : esc((emp.name || '?').slice(0, 1))) + '</div>' +
        '<label class="wdd-photo-btn">Change photo<input type="file" accept="image/png,image/jpeg,image/webp" data-wdd-photo-input hidden /></label><small>JPG or PNG, up to 2 MB</small></div>' +
        '<h4>Personal information</h4><div class="wdd-modal-grid">' + PERSONAL.map(function (d) { return fieldHtml(d, v); }).join('') + '</div>' +
        '<h4>Contact</h4><div class="wdd-modal-grid">' + CONTACT.map(function (d) { return fieldHtml(d, v); }).join('') + '</div>' +
        '<h4>Employment</h4><div class="wdd-modal-grid">' + EMPLOYMENT.map(function (d) { return fieldHtml(d, v); }).join('') + '</div>' +
        '<h4>Organization · Wing → Division → Department → Designation → Unit/Centre → Position → Reporting Manager</h4><div class="wdd-modal-grid" data-wdd-chain-box></div>' +
        '<h4>Attendance geofence</h4><div class="wdd-modal-grid"><label class="wdd-span">Geofence location<select data-wdd-geo><option value="">Loading geofences…</option></select>' +
        '<small class="wdd-geo-note" data-wdd-geo-note></small></label></div>' +
        '<p class="org-error" data-wdd-msg></p><div class="wdd-form-actions"><button type="button" data-wdd-cancel>Cancel</button><button class="org-save" type="submit">Save changes</button></div></form>';
      var geoSel = overlay.querySelector('[data-wdd-geo]');
      var geoNote = overlay.querySelector('[data-wdd-geo-note]');
      var geoCurrent = '';
      var accessCtl = null;
      if (window.PeopleAccess) {
        var accessHost = document.createElement('div');
        var msgEl = overlay.querySelector('[data-wdd-msg]');
        msgEl.parentNode.insertBefore(accessHost, msgEl);
        accessCtl = window.PeopleAccess.mountEditor(accessHost, employeeId);
        if (opts && opts.focus === 'access') setTimeout(function () { accessHost.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 400);
      }
      loadGeofences(true).then(function () {
        geoCurrent = currentGeofence(employeeId);
        geoSel.innerHTML = '<option value="">' + (geoCurrent ? 'Keep current geofence' : 'No geofence') + '</option>' + geofenceOptions(geoCurrent);
        var match = ((geoBoard && geoBoard.locations) || []).filter(function (l) { return l.title === geoCurrent; })[0];
        if (match) geoSel.value = match.id;
        geoNote.textContent = geoCurrent ? 'Currently assigned: ' + geoCurrent : 'No geofence assigned yet. Choose a site to enforce check-in within its radius.';
      }).catch(function () {
        geoSel.innerHTML = '<option value="">Geofences unavailable</option>';
      });
      var chainBox = overlay.querySelector('[data-wdd-chain-box]');
      var draw = function () { chainBox.innerHTML = chainHtml(v); bindChain(chainBox, v, draw); };
      draw();
      overlay.querySelector('[data-wdd-cancel]').addEventListener('click', function () { overlay.remove(); });
      overlay.querySelector('[data-wdd-photo-input]').addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { overlay.querySelector('[data-wdd-msg]').textContent = 'Photo must be 2 MB or less'; return; }
        var reader = new FileReader();
        reader.onload = function () {
          photo.name = file.name;
          photo.data = String(reader.result || '');
          overlay.querySelector('[data-wdd-photo]').innerHTML = '<img src="' + photo.data + '" alt="" />';
        };
        reader.readAsDataURL(file);
      });
      overlay.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        var values = {};
        overlay.querySelectorAll('[data-wdd-field]').forEach(function (el) { values[el.getAttribute('data-wdd-field')] = el.value; });
        CHAIN_KEYS.forEach(function (k) { values[k] = v[k] || ''; });
        var body = { employee: employeeId, values: JSON.stringify(values) };
        if (photo.data) { body.photo_name = photo.name; body.photo_data = photo.data; }
        var btn = overlay.querySelector('button[type="submit"]');
        var invalid = accessCtl ? accessCtl.validate() : '';
        if (invalid) {
          var im = overlay.querySelector('[data-wdd-msg]');
          im.textContent = invalid;
          im.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Saving…';
        var geoPick = geoSel && geoSel.value;
        var geoChanged = geoPick && !((geoBoard && geoBoard.locations) || []).some(function (l) { return l.id === geoPick && l.title === geoCurrent; });
        post('update_people_employee_detail', body).then(function () {
          return geoChanged ? assignGeofence(geoPick, employeeId) : null;
        }).then(function () {
          return accessCtl ? accessCtl.save() : null;
        }).then(function (accessResult) {
          if (accessResult && accessResult.agreement && window.PeopleAccess) {
            btn.textContent = 'Preparing asset form…';
            return window.PeopleAccess.download(accessResult.agreement.id).then(function () {
              return new Promise(function (r) { setTimeout(r, 900); });
            });
          }
          return null;
        }).then(function () {
          state.data = null;
          overlay.remove();
          ensureData();
          location.reload();
        }).catch(function (err) {
          overlay.style.display = '';
          btn.disabled = false;
          btn.textContent = 'Save changes';
          var em = overlay.querySelector('[data-wdd-msg]');
          em.textContent = (err && err.message) || 'Could not save';
          em.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
    }).catch(function (err) {
      overlay.innerHTML = '<div class="wdd-modal-card"><p class="org-error">' + esc((err && err.message) || 'Could not load employee') + '</p><button type="button" data-wdd-cancel>Close</button></div>';
      overlay.querySelector('[data-wdd-cancel]').addEventListener('click', function () { overlay.remove(); });
    });
  }

  var DEL_API = '/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_employee_delete.delete_people_employees';
  var TRASH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';

  function rowEmployee(tr) {
    var a = tr && tr.querySelector('a[href*="/app/employee/"]');
    var m = a ? (a.getAttribute('href') || '').match(/\/app\/employee\/([^/?#]+)/i) : null;
    if (!m) return null;
    var nameEl = tr.querySelector('.emp-person b, td b');
    return { id: decodeURIComponent(m[1]), name: nameEl ? nameEl.textContent.trim() : decodeURIComponent(m[1]) };
  }

  function deleteModal(list) {
    if (!list.length) return;
    var overlay = document.createElement('div');
    overlay.className = 'wdd-modal';
    var names = list.slice(0, 6).map(function (e) { return '<li><b>' + esc(e.name) + '</b> · ' + esc(e.id) + '</li>'; }).join('') +
      (list.length > 6 ? '<li>…and ' + (list.length - 6) + ' more</li>' : '');
    overlay.innerHTML = '<form class="wdd-modal-card del-card" autocomplete="off">' +
      '<h3>Delete ' + (list.length === 1 ? 'employee' : list.length + ' employees') + '?</h3>' +
      '<ul class="del-list">' + names + '</ul>' +
      '<div class="del-modes">' +
      '<label class="del-mode"><input type="radio" name="mode" value="delete" checked /> <span><b>Delete permanently</b><small>Removes the employee from the directory and all HRMS lists. Past attendance and payroll records stay saved under their name.</small></span></label>' +
      '<label class="del-mode"><input type="radio" name="mode" value="archive" /> <span><b>Keep employee, mark Left</b><small>Keeps the record in the directory with status Left.</small></span></label>' +
      '</div>' +
      '<p class="del-note">The employee portal login is disabled. Permanent delete cannot be undone.</p>' +
      '<label>Your login password *<input name="password" type="password" required autocomplete="new-password" readonly data-del-pw placeholder="Type your portal login password" /></label>' +
      '<label>Reason (optional)<input name="reason" type="text" maxlength="200" autocomplete="off" data-lpignore="true" placeholder="e.g. Duplicate record, resigned" /></label>' +
      '<p class="org-error" data-del-msg></p>' +
      '<div class="wdd-form-actions"><button type="button" data-del-cancel>Cancel</button><button type="submit" class="del-btn">Delete</button></div></form>';
    document.body.appendChild(overlay);
    var form = overlay.querySelector('form');
    var msg = overlay.querySelector('[data-del-msg]');
    var pw = form.elements.password;
    setTimeout(function () { pw.value = ''; form.elements.reason.value = ''; pw.removeAttribute('readonly'); pw.focus(); }, 60);
    overlay.querySelector('[data-del-cancel]').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) overlay.remove(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.textContent = '';
      var btn = form.querySelector('.del-btn');
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      fetch(DEL_API, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
        body: sidBody({ employees: JSON.stringify(list.map(function (x) { return x.id; })), password: form.elements.password.value, reason: form.elements.reason.value, mode: form.querySelector('input[name="mode"]:checked').value }),
      }).then(function (r) { return r.json(); }).then(function (json) {
        var m = json && json.message && typeof json.message === 'object' ? json.message : json;
        if (!m || m.status === 'error') throw new Error(String((m && m.message) || 'Could not delete').replace(/<[^>]+>/g, ''));
        var d = m.data || {};
        var skipped = (d.results || []).filter(function (r) { return r.result === 'skipped'; });
        var parts = [];
        if (d.deleted) parts.push(d.deleted + ' deleted' + (d.history_kept ? ' (' + d.history_kept + ' had past records kept as history)' : ''));
        if (d.archived) parts.push(d.archived + ' marked Left');
        if (d.skipped) parts.push(d.skipped + ' skipped');
        form.innerHTML = '<h3 class="del-done">Done</h3><p>' + esc(parts.join(' · ') || 'Nothing changed') + '</p>' +
          (skipped.length ? '<ul class="del-list">' + skipped.map(function (r) { return '<li><b>' + esc(r.name || r.employee) + '</b> — ' + esc(r.message || '') + '</li>'; }).join('') + '</ul>' : '') +
          '<div class="wdd-form-actions"><button type="button" class="org-save" data-del-done>OK</button></div>';
        form.querySelector('[data-del-done]').addEventListener('click', function () { location.reload(); });
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Delete';
        msg.textContent = (err && err.message) || 'Could not delete';
        form.elements.password.value = '';
        form.elements.password.focus();
      });
    });
  }

  function employeeDeleteControls() {
    if (!/\/people\/employees\/?$/.test(location.pathname) || !state.data || !state.data.can_edit) return;
    document.querySelectorAll('.emp-table tbody tr').forEach(function (tr) {
      var actions = tr.querySelector('.emp-actions');
      if (!actions || actions.querySelector('[data-emp-del]')) return;
      var emp = rowEmployee(tr);
      if (!emp) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emp-del-icon';
      btn.title = 'Delete employee';
      btn.setAttribute('aria-label', 'Delete ' + emp.name);
      btn.setAttribute('data-emp-del', emp.id);
      btn.innerHTML = TRASH;
      var more = actions.querySelector('.emp-filter-wrap');
      actions.insertBefore(btn, more || null);
    });
    var bulk = document.querySelector('select.emp-bulk');
    if (bulk && !bulk.querySelector('option[value="wdd-delete"]')) {
      var opt = document.createElement('option');
      opt.value = 'wdd-delete';
      opt.textContent = 'Delete selected employees';
      bulk.appendChild(opt);
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-emp-del]') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var emp = rowEmployee(btn.closest('tr'));
    if (emp) deleteModal([emp]);
  }, true);

  document.addEventListener('change', function (e) {
    var sel = e.target;
    if (!sel || !sel.matches || !sel.matches('select.emp-bulk') || sel.value !== 'wdd-delete') return;
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    sel.value = '';
    var list = [];
    document.querySelectorAll('.emp-table tbody tr').forEach(function (tr) {
      var box = tr.querySelector('input[type="checkbox"]');
      if (box && box.checked) {
        var emp = rowEmployee(tr);
        if (emp) list.push(emp);
      }
    });
    if (!list.length) { alert('Select employees on this page first.'); return; }
    deleteModal(list);
  }, true);

  function drawerCard() {
    var drawer = document.querySelector('.emp-drawer');
    if (!drawer) return;
    if (!/\/people\/employees\/?$/.test(location.pathname)) {
      var stray = drawer.querySelector('[data-wdd-idcard]');
      if (stray) stray.remove();
      return;
    }
    if (!state.data || !state.data.can_edit) return;
    var link = drawer.querySelector('a[href*="/app/employee/"]');
    var m = link ? (link.getAttribute('href') || '').match(/\/app\/employee\/([^/?#]+)/i) : null;
    if (!m) return;
    var id = decodeURIComponent(m[1]);
    if (link.lastChild && link.lastChild.nodeType === 3 && /Edit in ERP/.test(link.lastChild.textContent)) link.lastChild.textContent = ' Edit employee';
    var box = drawer.querySelector('[data-wdd-idcard]');
    if (box && box.getAttribute('data-emp') === id) return;
    if (box) box.remove();
    box = document.createElement('section');
    box.className = 'wdd-drawer-card';
    box.setAttribute('data-wdd-idcard', '1');
    box.setAttribute('data-emp', id);
    box.innerHTML = '<h4>Employee ID Card</h4><p class="org-lead">Loading ID card…</p>';
    drawer.appendChild(box);
    post('get_people_employee_detail', { employee: id }).then(function (emp) {
      if (box.getAttribute('data-emp') !== id || !window.SmilecureIdCard) return;
      var card = window.SmilecureIdCard.fromEmployee(emp);
      var ready = window.SmilecureIdCard.ready ? window.SmilecureIdCard.ready(card.empId) : Promise.resolve();
      return ready.then(function () {
        if (box.getAttribute('data-emp') !== id) return;
        box.innerHTML = '<h4>Employee ID Card</h4>' + window.SmilecureIdCard.html(card) +
          '<div class="wdd-form-actions"><button type="button" class="emp-btn primary" data-eidc-own="1">Download ID Card</button></div>';
        box.querySelector('[data-eidc-own]').addEventListener('click', function () { window.SmilecureIdCard.download(card); });
      });
    }).catch(function () {
      box.innerHTML = '<h4>Employee ID Card</h4><p class="org-error">Could not load ID card</p>';
    });
  }

  document.addEventListener('click', function (event) {
    var a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!a || !/\/people\/employees/.test(location.pathname)) return;
    var m = (a.getAttribute('href') || '').match(/\/app\/employee\/([^/?#]+)/i);
    if (!m || !state.data || !state.data.can_edit) return;
    event.preventDefault();
    event.stopPropagation();
    editModal(decodeURIComponent(m[1]));
  }, true);

  var LEAVE_METHOD = '/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_leave_attach.';
  var leaveFile = null;

  function postLeave(method, extra) {
    return fetch(LEAVE_METHOD + method, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
      body: sidBody(extra),
    }).then(function (res) { return res.json(); }).then(function (json) {
      var nested = json && json.message && typeof json.message === 'object' ? json.message : json;
      if (nested && nested.status === 'error') throw new Error(nested.message || 'Request failed');
      return nested && nested.data ? nested.data : nested;
    });
  }

  function leaveFileInput(form, className, labelClass) {
    if (form.querySelector('[data-leave-proof]')) return;
    var label = document.createElement('label');
    label.className = className;
    label.setAttribute('data-leave-proof', '1');
    label.innerHTML = '<span class="' + labelClass + '">Attachment (proof) — optional</span>' +
      '<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" class="leave-proof-input" />' +
      '<small class="leave-proof-hint">PDF, JPG or PNG up to 5 MB. Visible to HR and your manager.</small>';
    var anchor = form.querySelector('.le2-reason-block') || form.querySelector('textarea');
    var host = anchor ? (anchor.classList && anchor.classList.contains('le2-reason-block') ? anchor : anchor.closest('label') || anchor) : null;
    if (host && host.parentNode) host.parentNode.insertBefore(label, host.nextSibling);
    else form.appendChild(label);
    var input = label.querySelector('input');
    var hint = label.querySelector('small');
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      leaveFile = null;
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        hint.textContent = 'File is larger than 5 MB. Choose a smaller file.';
        input.value = '';
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        leaveFile = { name: file.name, data: String(reader.result || '') };
        hint.textContent = 'Ready to upload: ' + file.name;
      };
      reader.readAsDataURL(file);
    });
  }

  function leaveForms() {
    var self = document.querySelector('form[data-le2-screen="apply-for-leave"]');
    if (self) leaveFileInput(self, 'le2-field leave-proof', 'le2-label');
    var hr = document.querySelector('form.lv-form');
    if (hr) leaveFileInput(hr, 'leave-proof', '');
  }

  function uploadLeaveProof(leaveName) {
    if (!leaveFile) return;
    var file = leaveFile;
    leaveFile = null;
    postLeave('upload_people_leave_attachment', { leave: leaveName || '', file_name: file.name, file_data: file.data })
      .then(function () {
        document.querySelectorAll('.leave-proof-input').forEach(function (el) { el.value = ''; });
        document.querySelectorAll('.leave-proof-hint').forEach(function (el) { el.textContent = 'Attachment uploaded: ' + file.name; });
      })
      .catch(function (err) { alert('Leave saved, but the attachment did not upload: ' + ((err && err.message) || 'error')); });
  }

  function openAttachment(id) {
    postLeave('open_people_leave_attachment', { file: id }).then(function (data) {
      var bytes = atob(data.data);
      var arr = new Uint8Array(bytes.length);
      for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: data.mime }));
      var win = window.open(url, '_blank');
      if (!win) {
        var a = document.createElement('a');
        a.href = url;
        a.download = data.file_name || 'attachment';
        a.click();
      }
    }).catch(function (err) { alert((err && err.message) || 'Could not open attachment'); });
  }

  function leaveDrawer() {
    var idNode = document.querySelector('.lv-drawer-id');
    if (!idNode) return;
    var drawer = idNode.closest('aside') || idNode.parentNode.parentNode;
    var leave = (idNode.textContent || '').trim();
    if (!leave || !drawer) return;
    var box = drawer.querySelector('[data-leave-files]');
    if (box && box.getAttribute('data-leave') === leave) return;
    if (box) box.remove();
    box = document.createElement('section');
    box.className = 'grd-emp-list leave-files';
    box.setAttribute('data-leave-files', '1');
    box.setAttribute('data-leave', leave);
    box.innerHTML = '<p>Attachments</p><ul><li><span>Loading…</span></li></ul>';
    var actions = drawer.querySelector('.emp-drawer-actions');
    if (actions) drawer.insertBefore(box, actions);
    else drawer.appendChild(box);
    postLeave('get_people_leave_attachments', { leave: leave }).then(function (data) {
      if (box.getAttribute('data-leave') !== leave) return;
      var rows = (data && data.attachments) || [];
      box.querySelector('ul').innerHTML = rows.length ? rows.map(function (f) {
        return '<li><b>' + esc(f.file_name.replace(leave + '-', '')) + '</b><span>' + esc(String(f.uploaded_on || '').slice(0, 16)) +
          ' · <button type="button" class="leave-file-open" data-file="' + esc(f.id) + '">View / download</button></span></li>';
      }).join('') : '<li><span>No attachment uploaded with this leave.</span></li>';
      box.querySelectorAll('[data-file]').forEach(function (btn) {
        btn.addEventListener('click', function () { openAttachment(btn.getAttribute('data-file')); });
      });
    }).catch(function () {
      box.querySelector('ul').innerHTML = '<li><span>Attachments are not available.</span></li>';
    });
  }

  var PAY_METHOD = '/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_payroll_edit.';

  function postPay(method, extra) {
    return fetch(PAY_METHOD + method, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
      body: sidBody(extra),
    }).then(function (res) { return res.json(); }).then(function (json) {
      var nested = json && json.message && typeof json.message === 'object' ? json.message : json;
      if (nested && nested.status === 'error') throw new Error(String(nested.message || 'Request failed').replace(/<[^>]+>/g, ''));
      return nested && nested.data ? nested.data : nested;
    });
  }

  function money(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function modalShell(title) {
    var overlay = document.createElement('div');
    overlay.className = 'wdd-modal';
    overlay.innerHTML = '<div class="wdd-modal-card"><h3>' + esc(title) + '</h3><p>Loading…</p></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) overlay.remove(); });
    return overlay;
  }

  function slipEditor(slip) {
    var overlay = modalShell('Edit salary slip');
    postPay('get_people_salary_slip', { slip: slip }).then(function (data) {
      var lines = { earnings: data.earnings.slice(), deductions: data.deductions.slice() };
      var readOnly = data.docstatus !== 0;
      function section(key, label, type) {
        var opts = (data.components[type] || []).map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
        return '<h4>' + label + '</h4><table class="org-table pay-lines"><tbody>' +
          lines[key].map(function (r, i) {
            return '<tr><td>' + (r.row ? esc(r.component) : '<select data-pay-comp="' + key + ':' + i + '"><option value="">Choose component</option>' + opts.replace('value="' + esc(r.component) + '"', 'value="' + esc(r.component) + '" selected') + '</select>') + '</td>' +
              '<td><input type="number" min="0" step="0.01" data-pay-amt="' + key + ':' + i + '" value="' + esc(r.amount) + '"' + (readOnly ? ' disabled' : '') + ' /></td>' +
              '<td>' + (readOnly ? '' : '<button type="button" data-pay-del="' + key + ':' + i + '">Remove</button>') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          (readOnly ? '' : '<button type="button" class="pay-add" data-pay-add="' + key + '">+ Add ' + label.toLowerCase().replace(/s$/, '') + '</button>');
      }
      function totals() {
        var g = lines.earnings.reduce(function (s, r) { return s + Number(r.amount || 0); }, 0);
        var d = lines.deductions.reduce(function (s, r) { return s + Number(r.amount || 0); }, 0);
        return '<div class="pay-totals"><span>Gross <b>' + money(g) + '</b></span><span>Deductions <b>' + money(d) + '</b></span><span>Net pay <b>' + money(g - d) + '</b></span></div>';
      }
      function draw() {
        overlay.innerHTML = '<form class="wdd-modal-card wdd-edit"><h3>Edit salary slip</h3><p class="org-lead">' + esc(data.employee_name) + ' · ' + esc(data.employee) + ' · ' + esc(data.start_date) + ' to ' + esc(data.end_date) + ' · ' + esc(slip) + '</p>' +
          (readOnly ? '<p class="org-error">This slip is already submitted (' + esc(data.status) + '). Only draft slips can be edited.</p>' : '') +
          section('earnings', 'Earnings', 'Earning') + section('deductions', 'Deductions', 'Deduction') + '<div data-pay-totals>' + totals() + '</div>' +
          '<p class="org-error" data-wdd-msg></p><div class="wdd-form-actions"><button type="button" data-wdd-cancel>Close</button>' + (readOnly ? '' : '<button class="org-save" type="submit">Save salary slip</button>') + '</div></form>';
        overlay.querySelector('[data-wdd-cancel]').addEventListener('click', function () { overlay.remove(); });
        overlay.querySelectorAll('[data-pay-amt]').forEach(function (el) {
          el.addEventListener('input', function () {
            var p = el.getAttribute('data-pay-amt').split(':');
            lines[p[0]][Number(p[1])].amount = el.value;
            overlay.querySelector('[data-pay-totals]').innerHTML = totals();
          });
        });
        overlay.querySelectorAll('[data-pay-comp]').forEach(function (el) {
          el.addEventListener('change', function () {
            var p = el.getAttribute('data-pay-comp').split(':');
            lines[p[0]][Number(p[1])].component = el.value;
          });
        });
        overlay.querySelectorAll('[data-pay-del]').forEach(function (el) {
          el.addEventListener('click', function () {
            var p = el.getAttribute('data-pay-del').split(':');
            lines[p[0]].splice(Number(p[1]), 1);
            draw();
          });
        });
        overlay.querySelectorAll('[data-pay-add]').forEach(function (el) {
          el.addEventListener('click', function () {
            lines[el.getAttribute('data-pay-add')].push({ row: '', component: '', amount: 0 });
            draw();
          });
        });
        var form = overlay.querySelector('form');
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var btn = form.querySelector('button[type="submit"]');
          btn.disabled = true;
          btn.textContent = 'Saving…';
          postPay('update_people_salary_slip', {
            slip: slip,
            earnings: JSON.stringify(lines.earnings),
            deductions: JSON.stringify(lines.deductions),
          }).then(function () { overlay.remove(); location.reload(); }).catch(function (err) {
            btn.disabled = false;
            btn.textContent = 'Save salary slip';
            form.querySelector('[data-wdd-msg]').textContent = (err && err.message) || 'Could not save';
          });
        });
      }
      draw();
    }).catch(function (err) {
      overlay.querySelector('.wdd-modal-card').innerHTML = '<h3>Edit salary slip</h3><p class="org-error">' + esc((err && err.message) || 'Could not load slip') + '</p>';
    });
  }

  function structureEditor(employee) {
    var overlay = modalShell('Assign salary structure');
    postPay('get_people_salary_structures', { employee: employee }).then(function (data) {
      var cur = data.current || {};
      var today = new Date().toISOString().slice(0, 10);
      overlay.innerHTML = '<form class="wdd-modal-card wdd-edit"><h3>Assign salary structure</h3><p class="org-lead">' + esc(data.employee_name) + ' · ' + esc(employee) + '</p>' +
        (cur.salary_structure ? '<p class="org-lead">Current: <b>' + esc(cur.salary_structure) + '</b> from ' + esc(cur.from_date) + ' · base ' + money(cur.base) + '</p>' : '<p class="org-lead">No salary structure assigned yet.</p>') +
        '<div class="wdd-modal-grid">' +
        '<label>Salary structure<select name="salary_structure" required><option value="">Choose structure</option>' +
        (data.structures || []).map(function (s) { return '<option value="' + esc(s.name) + '"' + (s.name === cur.salary_structure ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>' +
        '<label>Effective from<input type="date" name="from_date" required value="' + today + '" /></label>' +
        '<label>Base (monthly CTC ₹)<input type="number" min="0" step="1" name="base" required value="' + esc(cur.base || '') + '" /></label>' +
        '<label>Variable (₹)<input type="number" min="0" step="1" name="variable" value="' + esc(cur.variable || 0) + '" /></label>' +
        '</div>' + ((data.structures || []).length ? '' : '<p class="org-error">No active salary structures found for this company.</p>') +
        '<p class="org-error" data-wdd-msg></p><div class="wdd-form-actions"><button type="button" data-wdd-cancel>Cancel</button><button class="org-save" type="submit">Assign</button></div></form>';
      overlay.querySelector('[data-wdd-cancel]').addEventListener('click', function () { overlay.remove(); });
      var form = overlay.querySelector('form');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = Object.fromEntries(new FormData(form).entries());
        body.employee = employee;
        var btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Assigning…';
        postPay('assign_people_salary_structure', body).then(function () { overlay.remove(); location.reload(); }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Assign';
          form.querySelector('[data-wdd-msg]').textContent = (err && err.message) || 'Could not assign';
        });
      });
    }).catch(function (err) {
      overlay.querySelector('.wdd-modal-card').innerHTML = '<h3>Assign salary structure</h3><p class="org-error">' + esc((err && err.message) || 'Could not load') + '</p>';
    });
  }

  document.addEventListener('click', function (event) {
    var a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!a || !/\/people\/payslips/.test(location.pathname)) return;
    if (!state.data || !state.data.can_edit) return;
    var href = a.getAttribute('href') || '';
    var slip = href.match(/\/app\/salary-slip\/([^/?#]+)/i);
    var ssa = href.match(/\/app\/salary-structure-assignment(?:\/new)?\?employee=([^&#]+)/i);
    if (!slip && !ssa) return;
    event.preventDefault();
    event.stopPropagation();
    if (slip) slipEditor(decodeURIComponent(slip[1]));
    else structureEditor(decodeURIComponent(ssa[1]));
  }, true);

  if (!window.__wddFetch) {
    window.__wddFetch = true;
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('list_people_employees') !== -1 && /\/people\/employees\/?$/.test(location.pathname) && init && init.body) {
        if (typeof init.body === 'string' && init.body.indexOf('include_inactive=') === -1) {
          init = Object.assign({}, init, { body: init.body + (init.body ? '&' : '') + 'include_inactive=1' });
        } else if (init.body instanceof URLSearchParams) {
          init.body.set('include_inactive', '1');
        }
        return nativeFetch.call(this, input, init);
      }
      var p = nativeFetch.apply(this, arguments);
      if (url.indexOf('submit_leave_application') !== -1 || url.indexOf('create_people_leave_request') !== -1) {
        return p.then(function (res) {
          if (leaveFile && res.ok) {
            res.clone().json().then(function (json) {
              var msg = json && json.message;
              if (msg && msg.status === 'error') return;
              var data = msg && msg.data ? msg.data : msg;
              var name = (data && (data.name || (data.leave_application && data.leave_application.name))) || '';
              uploadLeaveProof(name);
            }).catch(function () { uploadLeaveProof(''); });
          }
          return res;
        });
      }
      if (url.indexOf('create_people_employee') === -1) return p;
      return p.then(function (res) {
        var pending = state.hire;
        var hireGeo = state.hireGeo;
        var hasOrg = pending && CHAIN_KEYS.some(function (k) { return pending[k]; });
        res.clone().json().then(function (json) {
          var msg = json && json.message;
          if (msg && msg.status === 'error') return;
          var data = msg && msg.data ? msg.data : msg;
          var employee = data && data.employee;
          if (!employee) return;
          var jobs = [];
          if (hasOrg) {
            var payload = chainPayload(pending);
            payload.employee = employee;
            jobs.push(post('assign_people_employee_org', payload).then(function () { state.hire = {}; state.data = null; }).catch(function () {}));
          }
          if (hireGeo) {
            jobs.push(assignGeofence(hireGeo, employee).then(function () { state.hireGeo = ''; }).catch(function (err) {
              alert('Employee created, but the geofence was not assigned: ' + ((err && err.message) || 'error'));
            }));
          }
          Promise.all(jobs).then(function () {
            if (!data.already_exists && state.data && state.data.can_edit && window.PeopleAccess) {
              setTimeout(function () { editModal(employee, { focus: 'access' }); }, 600);
            }
          });
        }).catch(function () {});
        return res;
      });
    };
  }

  function filterOptions(kind, parentKey, parentValue) {
    return masters(kind).filter(function (row) {
      if (!row.active) return false;
      if (parentKey && parentValue && row[parentKey] && row[parentKey] !== parentValue) return false;
      return true;
    });
  }

  function renderFilters() {
    var old = document.querySelector('[data-wdd-filters="1"]');
    if (!orgOpen() && filterPath()) ensureData();
    if (orgOpen() || !filterPage()) {
      if (old) old.remove();
      document.querySelectorAll('[data-wdd-row]').forEach(function (row) {
        row.style.display = '';
        row.removeAttribute('data-wdd-row');
      });
      return;
    }
    ensureData();
    var content = document.querySelector('.hrms-content, .people-main');
    if (!content || !state.data) return;
    var anchor = null;
    content.querySelectorAll('.dsg-select, .emp-filter').forEach(function (node) {
      if (!anchor && !node.closest('[data-wdd-filters]') && !node.classList.contains('emp-popover-trigger')) anchor = node;
    });
    var sig = JSON.stringify(state.filters) + ':' + ((state.data.masters || []).length) + ':' + (anchor ? 'row' : 'bar');
    if (old && old.getAttribute('data-sig') === sig && (!anchor || old.parentNode === anchor.parentNode)) {
      applyPeopleFilters();
      return;
    }
    if (old) old.remove();
    old = document.createElement('div');
    old.setAttribute('data-wdd-filters', '1');
    if (anchor) {
      old.className = 'wdd-inline';
      anchor.parentNode.insertBefore(old, anchor);
      content.querySelectorAll('select[aria-label="Department"], select[aria-label="Designation"]').forEach(function (select) {
        var box = select.closest('.dsg-select, .emp-filter');
        if (box && !box.closest('[data-wdd-filters]')) box.style.display = 'none';
      });
    } else {
      old.className = 'wdd-filters';
      content.insertBefore(old, content.firstChild);
    }
    old.setAttribute('data-sig', sig);
    var boxClass = anchor ? String(anchor.className).replace(/\bactive\b/g, '').trim() : '';
    var caret = anchor ? anchor.querySelector('svg') : null;
    var caretHtml = caret ? caret.outerHTML : '';
    var f = state.filters;
    var wings = byOrder(businessWings().filter(function (row) { return row.active; }), WING_ORDER);
    var divisions = byOrder(filterOptions('Division', 'wing', f.wing), DIVISION_ORDER);
    var departments = filterOptions('Department', 'wing', f.wing);
    var designations = masters('Designation').filter(function (row) { return row.active && (!f.department || sameDept(row, { title: f.department, wing: f.wing, erp_name: f.department })); });
    var units = filterOptions('Unit', 'wing', f.wing).filter(function (row) { return !f.department || sameDept(row, { title: f.department, wing: f.wing, erp_name: f.department }); });
    var positions = masters('Position').filter(function (row) { return row.active && (!f.unit || row.unit === f.unit); });
    function field(key, label, rows, corporate) {
      var allLabel = 'All ' + (label === 'Unit/Centre' ? 'Units/Centres' : label + 's');
      var opts = '<option value="">' + allLabel + '</option>' +
        (corporate ? '<option value="__corporate__"' + (f[key] === '__corporate__' ? ' selected' : '') + '>Corporate / Back Office</option>' : '') +
        options(rows, '', null, f[key]);
      if (anchor) {
        var shown = f[key] === '__corporate__' ? 'Corporate / Back Office' : (f[key] || allLabel);
        var cls = boxClass + (f[key] ? ' active' : '');
        var textCls = anchor.classList.contains('emp-filter') ? ' class="emp-filter-text"' : '';
        return '<label class="' + esc(cls) + '"><span' + textCls + '>' + esc(shown) + '</span>' + caretHtml +
          '<select data-wdd-filter="' + key + '" aria-label="' + esc(label) + ' filter">' + opts + '</select></label>';
      }
      return '<label>' + label + '<select data-wdd-filter="' + key + '">' + opts + '</select></label>';
    }
    old.innerHTML =
      field('wing', 'Wing', wings, true) +
      field('division', 'Division', divisions, false) +
      field('department', 'Department', departments, false) +
      field('designation', 'Designation', designations, false) +
      field('unit', 'Unit/Centre', units, false) +
      field('position', 'Position', positions, false) +
      (anchor ? '' : '<button type="button" data-wdd-clear="1">Clear</button>');
    old.querySelectorAll('[data-wdd-filter]').forEach(function (select) {
      select.addEventListener('change', function () {
        state.filters[select.getAttribute('data-wdd-filter')] = select.value;
        if (select.getAttribute('data-wdd-filter') === 'wing') {
          state.filters.division = '';
          state.filters.department = '';
          state.filters.designation = '';
          state.filters.unit = '';
          state.filters.position = '';
        }
        renderFilters();
      });
    });
    var clear = old.querySelector('[data-wdd-clear]');
    if (clear) clear.addEventListener('click', function () { state.filters = blankFilters(); renderFilters(); });
    applyPeopleFilters();
  }

  function applyPeopleFilters() {
    var employees = (state.data && state.data.employees) || [];
    var byId = {};
    employees.forEach(function (row) { if (row.id) byId[String(row.id).toUpperCase()] = row; });
    var active = Object.keys(state.filters).some(function (key) { return state.filters[key]; });
    document.querySelectorAll('.hrms-content table, .people-main table').forEach(function (table) {
      if (table.closest('[data-org-page]')) return;
      var bodyText = table.innerText || '';
      var related = /HR-EMP-\d+/i.test(bodyText) || employees.some(function (row) { return row.name && bodyText.indexOf(row.name) !== -1; });
      if (!related) return;
      table.querySelectorAll('tbody tr').forEach(function (tr) {
        tr.setAttribute('data-wdd-row', '1');
        if (!active) { tr.style.display = ''; return; }
        var text = tr.innerText || '';
        var id = (text.match(/HR-EMP-\d+/i) || [])[0];
        var emp = id ? byId[id.toUpperCase()] : null;
        if (!emp) {
          employees.forEach(function (row) {
            if (row.name && text.indexOf(row.name) !== -1 && (!emp || row.name.length > emp.name.length)) emp = row;
          });
        }
        if (!emp) { tr.style.display = ''; return; }
        var f = state.filters;
        var ok = (f.wing !== '__corporate__' ? (!f.wing || emp.wing === f.wing) : !emp.wing) &&
          (!f.division || emp.division === f.division) &&
          (!f.department || (emp.department || '').indexOf(f.department) !== -1) &&
          (!f.designation || emp.designation === f.designation || (emp.designation || '').indexOf(f.designation) !== -1) &&
          (!f.unit || emp.unit === f.unit) &&
          (!f.position || emp.position === f.position);
        tr.style.display = ok ? '' : 'none';
      });
    });
  }

  function mount() {
    if (document.querySelector('[data-org-react="1"]')) return;
    var wrap = document.querySelector('.hrms-main-wrap');
    if (!orgOpen()) {
      var old = document.querySelector('[data-org-page="1"]');
      if (old) old.remove();
      if (wrap) wrap.querySelectorAll('[data-org-hidden]').forEach(function (node) {
        node.style.display = '';
        node.removeAttribute('data-org-hidden');
      });
      return;
    }
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.children, function (node) {
      if (node.getAttribute('data-org-page') === '1' || node.tagName === 'HEADER') return;
      node.style.display = 'none';
      node.setAttribute('data-org-hidden', '1');
    });
    if (document.querySelector('[data-org-page="1"]')) return;
    var host = document.createElement('div');
    host.setAttribute('data-org-page', '1');
    wrap.appendChild(host);
    host.innerHTML = '<section class="org-page"><p>Loading WDD…</p></section>';
    reload();
  }

  function nav() {
    document.querySelectorAll('a[href="/people/designations"], a[href="/people/divisions"]').forEach(function (link) {
      link.style.display = 'none';
    });
    var link = document.querySelector('a[href="/people/departments"]') || document.querySelector('a[href="/people/departments#wdd"]');
    if (!link) {
      var employees = document.querySelector('a[href="/people/employees"]');
      if (!employees || !employees.parentNode) return;
      link = employees.cloneNode(false);
      employees.parentNode.insertBefore(link, employees.nextSibling);
    }
    if (link.getAttribute('data-org-link') !== '1') link.setAttribute('data-org-link', '1');
    if (link.getAttribute('href') !== '/people/departments#wdd') link.setAttribute('href', '/people/departments#wdd');
    if (link.style.display === 'none') link.style.display = '';
    var label = link.querySelector('span');
    if (!label) {
      label = document.createElement('span');
      link.appendChild(label);
    }
    if (label.textContent !== 'WDD') label.textContent = 'WDD';
  }

  function markNav() {
    var org = document.querySelector('[data-org-link="1"]');
    var dept = document.querySelector('a[href="/people/departments"]');
    if (!org) return;
    org.classList.toggle('active', orgOpen());
    if (dept && orgOpen()) dept.classList.remove('active');
  }

  function profileFields() {
    if (!/\/people\/profile\/?$/.test(location.pathname) || document.querySelector('[data-org-profile="1"]')) return;
    var list = document.querySelector('.me-fields');
    if (!list) return;
    var target = new URLSearchParams(location.search).get('employee');
    post('get_people_org').then(function (data) {
      state.data = state.data || data;
      var me = data && data.me;
      if (target) me = ((data && data.employees) || []).filter(function (r) { return r.id === target; })[0] || me;
      if (!me || document.querySelector('[data-org-profile="1"]')) return;
      [['Wing', me.wing || 'Corporate / Back Office'], ['Division', me.division], ['Unit / Centre', me.unit], ['Position', me.position]].forEach(function (pair) {
        var row = document.createElement('div');
        row.setAttribute('data-org-profile', '1');
        row.innerHTML = '<dt>' + esc(pair[0]) + '</dt><dd>' + esc(pair[1] || '—') + '</dd>';
        list.appendChild(row);
      });
      if (data.can_edit && target) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emp-btn';
        btn.setAttribute('data-org-profile', '1');
        btn.textContent = 'Edit organization';
        btn.addEventListener('click', function () { editModal(target); });
        list.parentNode.appendChild(btn);
      }
    }).catch(function () {});
  }

  function tick() {
    nav();
    markNav();
    mount();
    renderFilters();
    hireInject();
    drawerCard();
    employeeDeleteControls();
    leaveForms();
    leaveDrawer();
    profileFields();
  }

  var busy = false;
  new MutationObserver(function () {
    if (busy) return;
    busy = true;
    try { tick(); } catch (e) {}
    busy = false;
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', tick);
  document.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!button || button.closest('[data-org-page]')) return;
    if (/^\s*(Reset|Clear filters|Clear all)\s*$/i.test(button.textContent || '')) {
      state.filters = blankFilters();
      renderFilters();
    }
  }, true);
  tick();
})();
