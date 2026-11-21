/* People HRMS: asset inventory desk on /people/assets (serial-tracked stock, assignment, repair, disposal, signed reports). */
(function () {
  var BASE = '/api/method/health_ecosystem_core.health_ecosystem_core.';
  var INV = BASE + 'clinical_people_assets.';
  var ACC = BASE + 'clinical_people_access.';
  var MAIN = BASE + 'api.';
  var PER_PAGE = 25;

  var state = {
    board: null, loading: false, error: '', notice: '',
    tab: 'items', q: '', cat: '', loc: '', status: '', kind: '', page: 1, sel: {},
  };
  var root = null;
  var modal = null;
  var modalPath = '';

  /* ------------------------------------------------------------ helpers */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function call(url, params) {
    var body = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      body.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    });
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      if (s && s.sid) body.set('sid', s.sid);
    } catch (e) {}
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
      body: body,
    }).then(function (r) {
      return r.json().catch(function () { throw new Error('Server error (' + r.status + ')'); });
    }).then(function (json) {
      var m = json && json.message && typeof json.message === 'object' ? json.message : json;
      if (json && json.exc_type && !m.status) throw new Error(String(json.exception || json.exc_type).replace(/<[^>]+>/g, ''));
      if (!m || m.status === 'error') throw new Error(String((m && m.message) || 'Request failed').replace(/<[^>]+>/g, ''));
      return m.data !== undefined ? m.data : m;
    });
  }

  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtWhen(v) {
    if (!v) return '';
    var d = new Date(String(v).replace(' ', 'T'));
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function money(v) {
    return '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  function today() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function daysUntil(v) {
    if (!v) return null;
    var t = new Date(String(v).slice(0, 10) + 'T00:00:00').getTime();
    if (isNaN(t)) return null;
    return Math.round((t - new Date(today() + 'T00:00:00').getTime()) / 86400000);
  }

  function photoUrl(p) {
    return p ? String(p) : '';
  }

  var TONE = {
    Available: 'teal', Assigned: 'green', 'In Repair': 'amber', 'Under Maintenance': 'amber',
    Damaged: 'rose', Lost: 'rose', Retired: 'grey', Pending: 'amber', Approved: 'green', Rejected: 'rose',
    Signed: 'green', 'Pending Signatures': 'amber', 'Pending Employee': 'amber', 'Pending HR': 'amber', Issued: 'grey',
  };
  function pill(text, tone) {
    return '<span class="pas-pill ' + (tone || TONE[text] || 'grey') + '">' + esc(text === 'Retired' ? 'Disposed' : text) + '</span>';
  }

  function manager() { return !!(state.board && state.board.is_manager); }
  function assets() { return (state.board && state.board.assets) || []; }
  function assetById(id) {
    var list = assets();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function groupKey(a) { return [a.title, a.brand, a.model, a.category].join('|'); }
  function lowKeys() {
    var out = {};
    ((state.board && state.board.stock) || []).forEach(function (g) { if (g.low) out[g.key] = true; });
    return out;
  }

  /* ------------------------------------------------------------ data */

  function load() {
    state.loading = true;
    render();
    return call(INV + 'get_asset_inventory').then(function (d) {
      state.board = d;
      state.error = '';
    }).catch(function (e) {
      state.error = e.message || 'Could not load assets';
    }).then(function () {
      state.loading = false;
      var known = {};
      assets().forEach(function (a) { known[a.id] = true; });
      Object.keys(state.sel).forEach(function (id) { if (!known[id]) delete state.sel[id]; });
      render();
    });
  }

  function act(promise, ok) {
    state.error = '';
    return promise.then(function (res) {
      state.notice = typeof ok === 'function' ? ok(res) : ok;
      closeModal();
      return load().then(function () { return res; });
    }).catch(function (e) {
      showModalError(e.message || 'Action failed');
      throw e;
    });
  }

  function downloadPdf(id) {
    state.notice = 'Preparing PDF…';
    render();
    return call(ACC + 'get_asset_agreement_pdf', { agreement: id }).then(function (d) {
      var bin = atob(d.data);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      var a = document.createElement('a');
      a.href = url;
      a.download = d.file_name || 'asset-assignment.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      state.notice = 'Downloaded ' + (d.file_name || 'asset-assignment.pdf');
      render();
    }).catch(function (e) {
      state.error = e.message || 'Could not download the report';
      state.notice = '';
      if (!root) window.alert(state.error);
      render();
    });
  }

  function pdfBlobUrl(id) {
    return call(ACC + 'get_asset_agreement_pdf', { agreement: id }).then(function (d) {
      var bin = atob(d.data);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    });
  }

  function printReport(id) {
    state.notice = 'Opening the print dialog for report ' + id + '…';
    render();
    return pdfBlobUrl(id).then(function (url) {
      var old = document.getElementById('pas-print-frame');
      if (old) old.remove();
      var frame = document.createElement('iframe');
      frame.id = 'pas-print-frame';
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;';
      frame.onload = function () {
        setTimeout(function () {
          try {
            frame.contentWindow.focus();
            frame.contentWindow.print();
          } catch (e) {
            window.open(url, '_blank');
          }
        }, 400);
      };
      frame.src = url;
      document.body.appendChild(frame);
      state.notice = 'Report ' + id + ' sent to print.';
      render();
    }).catch(function (e) {
      state.error = e.message || 'Could not open the report for printing';
      state.notice = '';
      if (!root) window.alert(state.error);
      render();
    });
  }

  function reportReady(id, autoPrint) {
    var g = ((state.board && state.board.agreements) || []).filter(function (x) { return x.id === id; })[0] || { id: id, assets: [] };
    var body = '<p>Asset Assignment Report <b class="mono">' + esc(id) + '</b> has been generated' + (g.employee_name ? ' for <b>' + esc(g.employee_name) + '</b>' : '') + '.</p>' +
      (g.assets && g.assets.length ? '<ul class="pas-list">' + g.assets.map(function (x) { return '<li>' + esc(x.title) + ' <span class="mono">' + esc(x.serial || '') + '</span></li>'; }).join('') + '</ul>' : '') +
      '<p class="pas-hint">The print dialog opens automatically. Both parties can also sign on screen; the PDF is regenerated with their signatures.</p>' +
      '<div class="pas-ready-actions">' +
      '<button type="button" class="pas-btn primary" data-rr="print">' + icon('printer') + ' Print</button>' +
      '<button type="button" class="pas-btn" data-rr="download">' + icon('download') + ' Download PDF</button>' +
      (g.hr_signed ? '' : '<button type="button" class="pas-btn" data-rr="hr">' + icon('pen') + ' Sign as HR</button>') +
      (g.employee_signed ? '' : '<button type="button" class="pas-btn" data-rr="employee">' + icon('pen') + ' Employee signs now</button>') + '</div>';
    var m = openModal('Assignment report ready', body, '<button type="button" class="pas-btn" data-m="close">Done</button>');
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rr]');
      if (!b) return;
      var what = b.getAttribute('data-rr');
      if (what === 'print') printReport(id);
      else if (what === 'download') downloadPdf(id);
      else signModal(id, what);
    });
    if (autoPrint) printReport(id);
  }

  /* ------------------------------------------------------------ filtering */

  var TABS = [
    { id: 'items', label: 'All Items' },
    { id: 'stock', label: 'Stock Summary', mgr: true },
    { id: 'available', label: 'Available' },
    { id: 'assigned', label: 'Assigned' },
    { id: 'low', label: 'Low Stock', mgr: true },
    { id: 'maintenance', label: 'Maintenance' },
    { id: 'damaged', label: 'Damaged / Lost' },
    { id: 'warranty', label: 'Warranty' },
    { id: 'disposed', label: 'Disposed' },
    { id: 'reports', label: 'Assignment Reports' },
    { id: 'requests', label: 'Requests' },
    { id: 'history', label: 'History' },
  ];

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var low = state.tab === 'low' ? lowKeys() : null;
    return assets().filter(function (a) {
      var t = state.tab;
      if (t === 'items' && a.status === 'Retired' && state.status !== 'Retired') return false;
      if (t === 'available' && a.status !== 'Available') return false;
      if (t === 'assigned' && a.status !== 'Assigned') return false;
      if (t === 'maintenance' && a.status !== 'In Repair' && a.status !== 'Under Maintenance') return false;
      if (t === 'damaged' && a.status !== 'Damaged' && a.status !== 'Lost') return false;
      if (t === 'disposed' && a.status !== 'Retired') return false;
      if (t === 'low' && (!low[groupKey(a)] || a.status === 'Retired')) return false;
      if (t === 'warranty') {
        var d = daysUntil(a.warranty_until);
        if (d === null || d > 30 || a.status === 'Retired' || a.status === 'Lost') return false;
      }
      if (state.cat && a.category !== state.cat) return false;
      if (state.loc && a.location !== state.loc) return false;
      if (state.status && a.status !== state.status) return false;
      if (q && [a.title, a.brand, a.model, a.serial, a.vendor, a.employee_name, a.employee_id, a.location, a.category].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  /* ------------------------------------------------------------ render */

  function render() {
    if (!root) return;
    var b = state.board;
    if (!b) {
      root.innerHTML = '<div class="pas-head"><div><h1>Assets Inventory</h1><p>Loading inventory…</p></div></div>' +
        (state.error ? '<div class="pas-alert err">' + esc(state.error) + ' <button type="button" class="pas-link" data-a="reload">Retry</button></div>' : '');
      return;
    }
    var mgr = manager();
    var html = header(mgr);
    if (state.error) html += '<div class="pas-alert err">' + esc(state.error) + '</div>';
    if (state.notice) html += '<div class="pas-alert ok">' + esc(state.notice) + '</div>';
    html += kpis(mgr);
    html += '<section class="pas-card"><nav class="pas-tabs" role="tablist">' + TABS.filter(function (t) { return mgr || !t.mgr; }).map(function (t) {
      var count = tabCount(t.id);
      return '<button type="button" role="tab" data-tab="' + t.id + '" class="' + (state.tab === t.id ? 'on' : '') + '">' + esc(t.label) + (count ? ' <i>' + count + '</i>' : '') + '</button>';
    }).join('') + '</nav>';
    if (state.tab === 'stock') html += stockTable();
    else if (state.tab === 'reports') html += reportsTable(mgr);
    else if (state.tab === 'requests') html += requestsTable(mgr);
    else if (state.tab === 'history') html += historyTable();
    else html += itemsView(mgr);
    html += '</section>';
    root.innerHTML = html;
  }

  function tabCount(id) {
    var b = state.board;
    if (!b) return 0;
    if (id === 'low') return (b.kpis && b.kpis.low_stock) || 0;
    if (id === 'reports') return (b.agreements || []).filter(function (g) { return g.status !== 'Signed'; }).length;
    if (id === 'requests') return (b.requests || []).filter(function (r) { return r.status === 'Pending'; }).length;
    return 0;
  }

  function header(mgr) {
    var b = state.board;
    return '<div class="pas-head"><div class="pas-title"><span class="pas-title-icon">' + icon('laptop') + '</span><div><h1>Assets Inventory</h1>' +
      '<p>' + (mgr ? 'Central stock of company assets. Every unit has its own serial number; stock updates with each assignment, return, transfer and disposal.' : 'Company assets issued to you, your assignment reports and requests.') + '</p></div></div>' +
      '<div class="pas-head-actions">' +
      (mgr
        ? '<button type="button" class="pas-btn outline" data-a="categories">' + icon('box') + ' Categories</button>' +
          '<button type="button" class="pas-btn outline" data-a="export">' + icon('download') + ' Export</button>' +
          '<button type="button" class="pas-btn outline" data-a="bulk">Bulk Import</button>' +
          '<button type="button" class="pas-btn primary" data-a="assign-pick">' + icon('user') + ' Assign Asset</button>' +
          '<button type="button" class="pas-btn primary" data-a="add">' + icon('plus') + ' Add Stock</button>'
        : '<button type="button" class="pas-btn primary" data-a="request">' + icon('plus') + ' Request Asset</button>') +
      '</div></div>' +
      (b.available === false ? '<div class="pas-alert err">The assets desk is not available on this server.</div>' : '');
  }

  function kpis(mgr) {
    var k = state.board.kpis || {};
    var cards = mgr
      ? [
          ['items', 'In Inventory', k.total, money(k.value) + ' value', 'blue', 'laptop'],
          ['available', 'Available', k.available, 'ready to assign', 'teal', 'box'],
          ['assigned', 'Assigned', k.assigned, 'with employees', 'green', 'user'],
          ['low', 'Low Stock', k.low_stock, 'items at reorder level', 'rose', 'alert'],
          ['maintenance', 'Maintenance', k.maintenance, 'repair / service', 'amber', 'wrench'],
          ['damaged', 'Damaged / Lost', (k.damaged || 0) + (k.lost || 0), (k.damaged || 0) + ' damaged · ' + (k.lost || 0) + ' lost', 'rose', 'alert'],
          ['warranty', 'Warranty Due', k.warranty, 'expiring in 30 days', 'amber', 'shield'],
          ['disposed', 'Disposed', k.retired, 'written off', 'grey', 'trash'],
        ]
      : [
          ['assigned', 'My Assets', k.assigned, 'currently with you', 'green', 'user'],
          ['reports', 'Reports to sign', (state.board.agreements || []).filter(function (g) { return !g.employee_signed; }).length, 'assignment forms', 'amber', 'pen'],
          ['requests', 'My Requests', (state.board.requests || []).length, 'asset requests', 'blue', 'box'],
        ];
    return '<div class="pas-kpis">' + cards.map(function (c) {
      return '<button type="button" class="pas-kpi' + (state.tab === c[0] ? ' on' : '') + '" data-tab="' + c[0] + '"><span class="pas-kpi-icon ' + c[4] + '">' + icon(c[5]) + '</span>' +
        '<span><b>' + esc(c[1]) + '</b><strong>' + Number(c[2] || 0).toLocaleString('en-IN') + '</strong><small>' + esc(c[3]) + '</small></span></button>';
    }).join('') + '</div>';
  }

  function filtersBar() {
    var b = state.board;
    var cats = (b.categories || []).map(function (c) { return c.title; });
    assets().forEach(function (a) { if (a.category && cats.indexOf(a.category) < 0) cats.push(a.category); });
    var locs = (b.locations || []).slice();
    var sts = b.statuses || ['Available', 'Assigned', 'In Repair', 'Under Maintenance', 'Damaged', 'Lost', 'Retired'];
    function sel(name, all, opts, value) {
      return '<select data-f="' + name + '"><option value="">' + all + '</option>' + opts.map(function (o) {
        return '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o === 'Retired' ? 'Disposed' : o) + '</option>';
      }).join('') + '</select>';
    }
    return '<div class="pas-filters"><label class="pas-search">' + icon('search') + '<input data-f="q" value="' + esc(state.q) + '" placeholder="Search name, brand, model, serial, vendor, employee…" /></label>' +
      sel('cat', 'All categories', cats, state.cat) + sel('loc', 'All branches', locs, state.loc) + sel('status', 'All status', sts, state.status) +
      '<button type="button" class="pas-btn" data-a="reset"' + (state.q || state.cat || state.loc || state.status ? '' : ' disabled') + '>Reset</button></div>';
  }

  function itemsView(mgr) {
    var rows = filtered();
    var pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    if (state.page > pages) state.page = pages;
    var slice = rows.slice((state.page - 1) * PER_PAGE, state.page * PER_PAGE);
    var selIds = Object.keys(state.sel);
    var allOn = slice.length && slice.every(function (a) { return state.sel[a.id]; });
    var html = filtersBar();
    if (mgr && selIds.length) {
      html += '<div class="pas-selbar"><b>' + selIds.length + ' selected</b>' +
        [['assign', 'Assign'], ['transfer', 'Transfer'], ['return', 'Return'], ['repair', 'Repair'], ['maintenance', 'Maintenance'], ['ready', 'Repair done'], ['damage', 'Damage'], ['loss', 'Loss'], ['dispose', 'Dispose'], ['audit', 'Audit']].map(function (x) {
          return '<button type="button" class="pas-btn sm" data-bulk="' + x[0] + '">' + x[1] + '</button>';
        }).join('') + '<button type="button" class="pas-btn sm danger" data-a="delete-sel">' + icon('trash') + ' Delete</button>' +
        '<button type="button" class="pas-link" data-a="clear-sel">Clear</button></div>';
    }
    html += '<div class="pas-table-wrap"><table class="pas-table"><thead><tr>' +
      (mgr ? '<th><input type="checkbox" data-a="sel-page"' + (allOn ? ' checked' : '') + ' aria-label="Select page" /></th>' : '') +
      '<th>Asset</th><th>Serial / Asset No.</th><th>Holder</th><th>Branch</th><th>Assigned</th><th>Warranty</th><th>Status</th><th></th></tr></thead><tbody>';
    if (state.loading && !rows.length) html += '<tr><td colspan="9" class="pas-empty">Loading…</td></tr>';
    else if (!slice.length) html += '<tr><td colspan="9" class="pas-empty">' + (mgr ? 'No items in this view.' : 'No assets are assigned to you.') + '</td></tr>';
    slice.forEach(function (a) {
      var w = daysUntil(a.warranty_until);
      var due = daysUntil(a.expected_return);
      html += '<tr class="' + (state.sel[a.id] ? 'sel' : '') + '">' +
        (mgr ? '<td><input type="checkbox" data-sel="' + esc(a.id) + '"' + (state.sel[a.id] ? ' checked' : '') + ' aria-label="Select ' + esc(a.title) + '" /></td>' : '') +
        '<td><div class="pas-asset">' + thumb(a) + '<div><b>' + esc(a.title) + '</b><small>' + esc([[a.brand, a.model].filter(Boolean).join(' '), a.category].filter(Boolean).join(' · ')) + '</small></div></div></td>' +
        '<td class="mono">' + esc(a.serial || '—') + '</td>' +
        '<td>' + (a.employee_name ? '<b>' + esc(a.employee_name) + '</b><small class="pas-sub">' + esc(a.employee_id) + '</small>' : '<span class="pas-muted">In stock</span>') + '</td>' +
        '<td>' + esc(a.location || '—') + '</td>' +
        '<td>' + (a.assign_date ? esc(fmtDate(a.assign_date)) : '—') + (a.expected_return && a.status === 'Assigned' ? '<small class="pas-sub' + (due !== null && due < 0 ? ' pas-warn' : '') + '">Return by ' + esc(fmtDate(a.expected_return)) + '</small>' : '') + '</td>' +
        '<td' + (w !== null && w <= 30 ? ' class="pas-warn"' : '') + '>' + (a.warranty_until ? esc(fmtDate(a.warranty_until)) + (w !== null && w < 0 ? ' <small>expired</small>' : '') : '—') + '</td>' +
        '<td>' + pill(a.status) + '</td><td class="pas-row-actions">' +
        '<button type="button" class="pas-icon-btn" data-view="' + esc(a.id) + '" title="View">' + icon('eye') + '</button>' +
        (mgr ? '<button type="button" class="pas-icon-btn" data-edit="' + esc(a.id) + '" title="Edit">' + icon('pen') + '</button>' +
          '<button type="button" class="pas-icon-btn danger" data-del="' + esc(a.id) + '" title="Delete">' + icon('trash') + '</button>' +
          (a.status === 'Available' ? '<button type="button" class="pas-btn sm primary" data-one="assign" data-id="' + esc(a.id) + '">Assign</button>' : '') +
          (a.status === 'Assigned' ? '<button type="button" class="pas-btn sm" data-one="return" data-id="' + esc(a.id) + '">Return</button>' : '') : '') +
        '</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<div class="pas-pager"><span>' + (rows.length ? ((state.page - 1) * PER_PAGE + 1) + '–' + Math.min(state.page * PER_PAGE, rows.length) + ' of ' + rows.length : '0') + ' items</span>' +
      '<button type="button" class="pas-btn sm" data-page="-1"' + (state.page <= 1 ? ' disabled' : '') + '>Previous</button>' +
      '<button type="button" class="pas-btn sm" data-page="1"' + (state.page >= pages ? ' disabled' : '') + '>Next</button></div>';
    return html;
  }

  function thumb(a) {
    if (a.photo) return '<img class="pas-thumb" src="' + esc(photoUrl(a.photo)) + '" alt="" loading="lazy" />';
    return '<span class="pas-thumb ph">' + esc((a.title || '?').slice(0, 1).toUpperCase()) + '</span>';
  }

  function stockTable() {
    var groups = (state.board.stock || []).filter(function (g) {
      var q = state.q.trim().toLowerCase();
      return !q || [g.title, g.brand, g.model, g.category].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var html = '<div class="pas-filters"><label class="pas-search">' + icon('search') + '<input data-f="q" value="' + esc(state.q) + '" placeholder="Search stock items…" /></label></div>';
    html += '<div class="pas-table-wrap"><table class="pas-table"><thead><tr><th>Item</th><th>Category</th><th class="num">In inventory</th><th class="num">Available</th><th class="num">Assigned</th><th class="num">Maintenance</th><th class="num">Damaged</th><th class="num">Lost</th><th class="num">Disposed</th><th class="num">Reorder at</th><th class="num">Value</th><th>Stock</th><th></th></tr></thead><tbody>';
    if (!groups.length) html += '<tr><td colspan="13" class="pas-empty">No stock yet. Use Add Stock to add items.</td></tr>';
    groups.forEach(function (g) {
      html += '<tr><td><b>' + esc(g.title) + '</b><small class="pas-sub">' + esc([g.brand, g.model].filter(Boolean).join(' ') || '—') + '</small></td><td>' + esc(g.category) + '</td>' +
        '<td class="num">' + g.total + '</td><td class="num"><b>' + g.available + '</b></td><td class="num">' + g.assigned + '</td><td class="num">' + g.maintenance + '</td>' +
        '<td class="num">' + g.damaged + '</td><td class="num">' + g.lost + '</td><td class="num">' + g.retired + '</td><td class="num">' + g.reorder + '</td><td class="num">' + money(g.value) + '</td>' +
        '<td>' + (g.low ? pill('Low stock', 'rose') : pill('In stock', 'teal')) + '</td>' +
        '<td class="pas-row-actions"><button type="button" class="pas-btn sm" data-group="' + esc(g.key) + '">Units</button>' +
        '<button type="button" class="pas-btn sm primary" data-restock="' + esc(g.key) + '">Add units</button></td></tr>';
    });
    return html + '</tbody></table></div>';
  }

  function reportsTable(mgr) {
    var list = state.board.agreements || [];
    var me = state.board.me;
    var html = '<p class="pas-hint">Each assignment creates an Asset Assignment Report. HR and the employee sign it here; the PDF includes both signatures, the serial numbers and the terms.</p>';
    html += '<div class="pas-table-wrap"><table class="pas-table"><thead><tr><th>Report</th><th>Employee</th><th>Items</th><th>Issued</th><th>HR</th><th>Employee</th><th>Status</th><th></th></tr></thead><tbody>';
    if (!list.length) html += '<tr><td colspan="8" class="pas-empty">No assignment reports yet. Assign an asset to create one.</td></tr>';
    list.forEach(function (g) {
      var mine = me && g.employee === me.id;
      html += '<tr><td class="mono">' + esc(g.id) + '</td><td><b>' + esc(g.employee_name) + '</b><small class="pas-sub">' + esc(g.employee) + '</small></td>' +
        '<td>' + (g.assets || []).map(function (x) { return esc(x.title) + ' <span class="mono">' + esc(x.serial || '') + '</span>'; }).join('<br>') + '</td>' +
        '<td>' + esc(fmtDate(g.issued_on)) + '</td>' +
        '<td>' + (g.hr_signed ? pill('Signed', 'green') + '<small class="pas-sub">' + esc(g.hr_signer || '') + '</small>' : pill('Pending', 'amber')) + '</td>' +
        '<td>' + (g.employee_signed ? pill('Signed', 'green') : pill('Pending', 'amber')) + '</td>' +
        '<td>' + pill(g.status || 'Issued') + '</td><td class="pas-row-actions">' +
        (mgr && !g.hr_signed ? '<button type="button" class="pas-btn sm primary" data-sign="hr" data-id="' + esc(g.id) + '">Sign as HR</button>' : '') +
        ((mine || mgr) && !g.employee_signed ? '<button type="button" class="pas-btn sm' + (mine ? ' primary' : '') + '" data-sign="employee" data-id="' + esc(g.id) + '">' + (mine ? 'Sign' : 'Employee signs') + '</button>' : '') +
        '<button type="button" class="pas-btn sm" data-print="' + esc(g.id) + '">' + icon('printer') + ' Print</button>' +
        '<button type="button" class="pas-btn sm" data-pdf="' + esc(g.id) + '">' + icon('download') + ' PDF</button></td></tr>';
    });
    return html + '</tbody></table></div>';
  }

  var REQ_FILTERS = ['Open', 'Pending', 'Approved', 'Fulfilled', 'Rejected', 'Cancelled', 'All'];

  function requestsTable(mgr) {
    var all = state.board.requests || [];
    var f = state.reqFilter || (mgr ? 'Open' : 'All');
    var list = all.filter(function (r) {
      if (f === 'All') return true;
      if (f === 'Open') return r.status === 'Pending' || r.status === 'Approved';
      return r.status === f;
    });
    var html = '<div class="pas-filters">' + REQ_FILTERS.map(function (x) {
      var n = all.filter(function (r) { return x === 'All' || (x === 'Open' ? r.status === 'Pending' || r.status === 'Approved' : r.status === x); }).length;
      return '<button type="button" class="pas-chip' + (f === x ? ' on' : '') + '" data-req-filter="' + x + '">' + x + ' <i>' + n + '</i></button>';
    }).join('') + (mgr ? '' : '<button type="button" class="pas-btn primary" data-a="request" style="margin-left:auto">' + icon('plus') + ' Request Asset</button>') + '</div>';
    html += '<div class="pas-table-wrap"><table class="pas-table"><thead><tr><th>Requested</th><th>Employee</th><th>Asset needed</th><th>Priority</th><th>Needed by</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>';
    if (!list.length) html += '<tr><td colspan="8" class="pas-empty">No requests in this view.</td></tr>';
    list.forEach(function (r) {
      var open = r.status === 'Pending' || r.status === 'Approved';
      var due = daysUntil(r.needed_by);
      html += '<tr><td>' + esc(fmtDate(r.request_date)) + '</td>' +
        '<td><b>' + esc(r.employee_name || '—') + '</b><small class="pas-sub">' + esc([r.employee_id, r.designation].filter(Boolean).join(' · ')) + '</small><small class="pas-sub">' + esc(r.department || '') + '</small></td>' +
        '<td><b>' + esc(r.title) + '</b><small class="pas-sub">' + esc([r.category, r.quantity > 1 ? 'Qty ' + r.quantity : ''].filter(Boolean).join(' · ')) + '</small></td>' +
        '<td>' + pill(r.priority || 'Normal', { Normal: 'grey', High: 'amber', Urgent: 'rose' }[r.priority] || 'grey') + '</td>' +
        '<td' + (open && due !== null && due < 0 ? ' class="pas-warn"' : '') + '>' + esc(fmtDate(r.needed_by) || '—') + '</td>' +
        '<td class="pas-clip" title="' + esc(r.note) + '">' + esc(r.note || '—') + '</td>' +
        '<td>' + pill(r.status) + (r.status === 'Fulfilled' && r.assigned_assets ? '<small class="pas-sub mono">' + esc(r.assigned_assets) + '</small>' : '') + '</td>' +
        '<td class="pas-row-actions"><button type="button" class="pas-icon-btn" data-req-view="' + esc(r.id) + '" title="Details">' + icon('eye') + '</button>' +
        (mgr && open ? '<button type="button" class="pas-btn sm primary" data-req-assign="' + esc(r.id) + '">Assign</button>' : '') +
        (mgr && r.status === 'Pending' ? '<button type="button" class="pas-btn sm" data-req-decide="Approved" data-id="' + esc(r.id) + '">Approve</button>' : '') +
        (mgr && open ? '<button type="button" class="pas-btn sm" data-req-decide="Rejected" data-id="' + esc(r.id) + '">Reject</button>' : '') +
        (!mgr && open ? '<button type="button" class="pas-btn sm" data-req-decide="Cancelled" data-id="' + esc(r.id) + '">Cancel</button>' : '') +
        (r.agreement ? '<button type="button" class="pas-btn sm" data-print="' + esc(r.agreement) + '">' + icon('printer') + ' Print</button>' : '') +
        '</td></tr>';
    });
    return html + '</tbody></table></div>';
  }

  function requestById(id) {
    return ((state.board && state.board.requests) || []).filter(function (r) { return r.id === id; })[0] || null;
  }

  function requestDetail(r, mgr) {
    function row(k, v) { return '<div><dt>' + esc(k) + '</dt><dd>' + (v || '—') + '</dd></div>'; }
    return '<dl class="pas-dl">' +
      row('Employee', esc(r.employee_name) + (r.employee_id ? ' <small>(' + esc(r.employee_id) + ')</small>' : '')) +
      row('Designation', esc(r.designation)) + row('Department', esc(r.department)) + row('Branch', esc(r.branch)) +
      (mgr ? row('Phone', esc(r.phone)) + row('Email', esc(r.email)) : '') +
      row('Asset needed', '<b>' + esc(r.title) + '</b>') + row('Category', esc(r.category)) +
      row('Quantity', esc(r.quantity || 1)) + row('Priority', pill(r.priority || 'Normal', { Normal: 'grey', High: 'amber', Urgent: 'rose' }[r.priority] || 'grey')) +
      row('Requested on', esc(fmtDate(r.request_date))) + row('Needed by', esc(fmtDate(r.needed_by))) +
      row('Status', pill(r.status)) + row('Decided by', esc(r.decided_by ? r.decided_by + (r.decided_on ? ' · ' + fmtWhen(r.decided_on) : '') : '')) +
      (r.assigned_assets ? row('Assigned item(s)', '<span class="mono">' + esc(r.assigned_assets) + '</span>') : '') +
      (r.agreement ? row('Assignment report', '<span class="mono">' + esc(r.agreement) + '</span>') : '') +
      '</dl><p><b>Reason</b><br>' + esc(r.note || '—') + '</p>' + (r.hr_note ? '<p><b>HR note</b><br>' + esc(r.hr_note) + '</p>' : '');
  }

  function requestViewModal(id) {
    var r = requestById(id);
    if (!r) return;
    var mgr = manager();
    var open = r.status === 'Pending' || r.status === 'Approved';
    var foot = '<button type="button" class="pas-btn" data-m="close">Close</button>';
    if (r.agreement) foot += '<button type="button" class="pas-btn" data-rv="print">' + icon('printer') + ' Print report</button>';
    if (mgr && open) foot += '<button type="button" class="pas-btn" data-rv="reject">Reject</button>' + (r.status === 'Pending' ? '<button type="button" class="pas-btn" data-rv="approve">Approve</button>' : '') + '<button type="button" class="pas-btn primary" data-rv="assign">Assign item</button>';
    var m = openModal('Asset request', requestDetail(r, mgr), foot, true);
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rv]');
      if (!b) return;
      var what = b.getAttribute('data-rv');
      if (what === 'print') printReport(r.agreement);
      else if (what === 'assign') assignFromRequest(r.id);
      else decideModal(r.id, what === 'approve' ? 'Approved' : 'Rejected');
    });
  }

  function decideModal(id, status, r, after) {
    r = r || requestById(id);
    if (!r) return;
    if (status === 'Cancelled') {
      if (!window.confirm('Cancel your request for ' + r.title + '?')) return;
      return call(INV + 'decide_asset_request', { request: id, status: 'Cancelled', note: '' }).then(function () {
        if (after) return after();
        state.notice = 'Request cancelled';
        return load();
      }).catch(function (e) { state.error = e.message; render(); if (after) window.alert(e.message); });
    }
    var reject = status === 'Rejected';
    var body = '<p><b>' + esc(r.employee_name) + '</b> requested <b>' + esc(r.title) + '</b>' + (r.note ? ': ' + esc(r.note) : '') + '</p>' +
      '<label>' + (reject ? 'Reason for rejection *' : 'Note to employee (optional)') + '<textarea name="decide_note" rows="3" placeholder="' + (reject ? 'e.g. Not in stock this quarter' : 'e.g. Will be issued from Head Office on Monday') + '"></textarea></label>';
    var m = openModal(reject ? 'Reject request' : 'Approve request', body,
      '<button type="button" class="pas-btn" data-m="close">Cancel</button><button type="button" class="pas-btn ' + (reject ? 'danger solid' : 'primary') + '" data-m="save">' + (reject ? 'Reject request' : 'Approve') + '</button>');
    m.querySelector('[data-m="save"]').addEventListener('click', function () {
      var note = val('decide_note');
      if (reject && !note) return showModalError('Tell the employee why the request is rejected');
      setBusy(true);
      act(call(INV + 'decide_asset_request', { request: id, status: status, note: note }), 'Request ' + status.toLowerCase()).catch(function () {});
    });
  }

  function assignFromRequest(id) {
    var r = requestById(id);
    if (!r) return;
    actionModal('assign', [], { employee: r.employee || r.employee_id, title: r.title, category: r.category, request: r });
  }

  var KINDS = ['Stock In', 'Assign', 'Transfer', 'Return', 'Repair', 'Maintenance', 'Repaired', 'Damage', 'Loss', 'Dispose', 'Audit'];

  function historyTable() {
    var moves = (state.board.movements || []).filter(function (m) { return !state.kind || m.kind === state.kind; });
    var q = state.q.trim().toLowerCase();
    var html = '<div class="pas-filters"><label class="pas-search">' + icon('search') + '<input data-f="q" value="' + esc(state.q) + '" placeholder="Search asset, serial, employee…" /></label>' +
      '<select data-f="kind"><option value="">All movements</option>' + KINDS.map(function (k) { return '<option' + (k === state.kind ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></div>';
    html += '<div class="pas-table-wrap"><table class="pas-table"><thead><tr><th>When</th><th>Asset</th><th>Movement</th><th>Employee</th><th>From → To</th><th>Condition</th><th>Note</th><th>By</th></tr></thead><tbody>';
    var shown = 0;
    moves.forEach(function (m) {
      var a = assetById(m.asset) || { title: m.asset, serial: '' };
      if (q && [a.title, a.serial, m.employee_name, m.from_employee, m.note].join(' ').toLowerCase().indexOf(q) < 0) return;
      shown++;
      var route = [m.from_employee, m.from_location].filter(Boolean).join(' · ');
      html += '<tr><td>' + esc(fmtWhen(m.happened_on)) + '</td><td><button type="button" class="pas-link" data-view="' + esc(m.asset) + '">' + esc(a.title) + '</button><small class="pas-sub mono">' + esc(a.serial) + '</small></td>' +
        '<td>' + pill(m.kind, kindTone(m.kind)) + '</td><td>' + esc(m.employee_name || '—') + '</td>' +
        '<td>' + esc(route || '—') + (m.to_location ? ' → ' + esc(m.to_location) : '') + '</td><td>' + esc(m.condition || '—') + '</td>' +
        '<td>' + esc(m.note || '') + (m.expected_return ? '<small class="pas-sub">Return by ' + esc(fmtDate(m.expected_return)) + '</small>' : '') +
        (m.agreement ? '<button type="button" class="pas-link" data-pdf="' + esc(m.agreement) + '">Report PDF</button>' : '') + '</td><td>' + esc(m.actor || '') + '</td></tr>';
    });
    if (!shown) html += '<tr><td colspan="8" class="pas-empty">No movements recorded yet.</td></tr>';
    html += '</tbody></table></div>';
    var acts = state.board.activities || [];
    if (acts.length && manager()) {
      html += '<h3 class="pas-h3">Audit log</h3><ul class="pas-feed">' + acts.slice(0, 30).map(function (x) {
        return '<li><b>' + esc(x.title) + '</b> ' + esc(x.detail || '') + '<small>' + esc(fmtWhen(x.happened_on)) + ' · ' + esc(x.actor || '') + '</small></li>';
      }).join('') + '</ul>';
    }
    return html;
  }

  function kindTone(k) {
    return { Assign: 'green', Transfer: 'blue', Return: 'teal', 'Stock In': 'blue', Repair: 'amber', Maintenance: 'amber', Repaired: 'teal', Damage: 'rose', Loss: 'rose', Dispose: 'grey', Audit: 'grey' }[k] || 'grey';
  }

  /* ------------------------------------------------------------ modals */

  function openModal(title, body, footer, wide) {
    closeModal();
    modalPath = location.pathname;
    modal = document.createElement('div');
    modal.className = 'pas-backdrop';
    modal.innerHTML = '<div class="pas-modal' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><header><h2>' + esc(title) + '</h2>' +
      '<button type="button" class="pas-icon-btn" data-m="close" aria-label="Close">✕</button></header><div class="pas-modal-body">' + body +
      '<div class="pas-alert err" data-m="error" hidden></div></div><footer>' + footer + '</footer></div>';
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) closeModal(); });
    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-m="close"]')) closeModal();
    });
    document.body.appendChild(modal);
    return modal;
  }

  function closeModal() {
    if (modal) modal.remove();
    modal = null;
  }

  function showModalError(msg) {
    if (!modal) {
      state.error = msg;
      render();
      return;
    }
    var box = modal.querySelector('[data-m="error"]');
    box.textContent = msg;
    box.hidden = false;
    setBusy(false);
  }

  function setBusy(on) {
    if (!modal) return;
    modal.querySelectorAll('[data-m="save"]').forEach(function (b) { b.disabled = on; });
  }

  function val(name) {
    var el = modal && modal.querySelector('[name="' + name + '"]');
    return el ? String(el.value || '').trim() : '';
  }

  function options(list, value, labelFn) {
    return list.map(function (o) {
      var v = typeof o === 'string' ? o : o.value;
      var l = typeof o === 'string' ? o : o.label;
      return '<option value="' + esc(v) + '"' + (v === value ? ' selected' : '') + '>' + esc(labelFn ? labelFn(l) : l) + '</option>';
    }).join('');
  }

  function categoriesList() {
    var cats = ((state.board && state.board.categories) || []).map(function (c) { return c.title; });
    return cats.length ? cats : ['Laptop', 'Mobile', 'Monitor', 'Accessory', 'Office Equipment', 'Vehicle', 'Furniture', 'Other'];
  }

  function locationsList(current) {
    var list = ((state.board && state.board.locations) || []).slice();
    if (current && list.indexOf(current) < 0) list.unshift(current);
    return list.length ? list : ['Head Office', 'IT Store'];
  }

  /* asset form */
  function assetForm(a, preset) {
    a = a || {};
    preset = preset || {};
    var editing = !!a.id;
    var v = function (k) { return a[k] != null && a[k] !== '' ? a[k] : (preset[k] != null ? preset[k] : ''); };
    var conditions = (state.board && state.board.conditions) || ['New', 'Good', 'Fair', 'Poor', 'Damaged'];
    var body = '<div class="pas-grid">' +
      '<label class="span-2">Asset name *<input name="title" value="' + esc(v('title')) + '" placeholder="e.g. Dell Latitude 5420" /></label>' +
      '<label>Category<select name="category">' + options(categoriesList(), v('category') || 'Laptop') + '</select></label>' +
      '<label>Branch / location<select name="location">' + options(locationsList(v('location')), v('location') || 'IT Store') + '</select></label>' +
      '<label>Brand<input name="brand" value="' + esc(v('brand')) + '" placeholder="Dell" /></label>' +
      '<label>Model<input name="model" value="' + esc(v('model')) + '" placeholder="Latitude 5420" /></label>' +
      (editing
        ? '<label class="span-2">Serial / asset number<input name="serial" value="' + esc(a.serial) + '" /><small>Status (' + esc(a.status === 'Retired' ? 'Disposed' : a.status) + ') changes through Assign, Return, Repair and the other actions so history stays complete.</small></label>'
        : '<label>Quantity<input name="quantity" type="number" min="1" max="50" value="1" /></label>' +
          '<label>Serial number or prefix<input name="serial" placeholder="Blank = auto (AST-…)" /></label>' +
          '<label class="span-2">Serial numbers, one per line (optional)<textarea name="serials" rows="3" placeholder="Enter exactly one per unit to use the manufacturer serials. Leave blank to number units from the prefix above."></textarea></label>' +
          '<label>Initial status<select name="status">' + options(['Available', 'In Repair', 'Under Maintenance', 'Damaged'], 'Available') + '</select></label>') +
      '<label>Condition<select name="condition">' + options(conditions, v('condition') || 'New') + '</select></label>' +
      '<label>Vendor<input name="vendor" value="' + esc(v('vendor')) + '" /></label>' +
      '<label>Purchase date<input name="purchase_date" type="date" value="' + esc(String(v('purchase_date')).slice(0, 10)) + '" /></label>' +
      '<label>Purchase cost (₹ per unit)<input name="purchase_cost" type="number" min="0" step="0.01" value="' + esc(v('purchase_cost') || '') + '" /></label>' +
      '<label>Warranty until<input name="warranty_until" type="date" value="' + esc(String(v('warranty_until')).slice(0, 10)) + '" /></label>' +
      '<label>Low-stock alert at<input name="reorder_level" type="number" min="0" value="' + esc(v('reorder_level') || 0) + '" /><small>Flag when available units fall to this number. 0 = no alert.</small></label>' +
      '<label class="span-2">Asset image<input name="image" type="file" accept="image/*" /><span class="pas-img-preview">' + (a.photo ? '<img src="' + esc(photoUrl(a.photo)) + '" alt="" />' : '') + '</span></label>' +
      '<label class="span-2">Notes<textarea name="notes" rows="2">' + esc(v('notes')) + '</textarea></label></div>';
    var m = openModal(editing ? 'Edit ' + (a.title || 'asset') : 'Add stock', body,
      '<button type="button" class="pas-btn" data-m="close">Cancel</button><button type="button" class="pas-btn primary" data-m="save">' + (editing ? 'Save changes' : 'Add to inventory') + '</button>', true);
    var image = null;
    m.querySelector('[name="image"]').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { showModalError('Image must be 2 MB or less'); e.target.value = ''; return; }
      var r = new FileReader();
      r.onload = function () {
        image = { name: f.name, data: String(r.result || '') };
        m.querySelector('.pas-img-preview').innerHTML = '<img src="' + esc(image.data) + '" alt="" />';
      };
      r.readAsDataURL(f);
    });
    m.querySelector('[data-m="save"]').addEventListener('click', function () {
      var payload = {
        id: a.id || '', title: val('title'), category: val('category'), location: val('location'), brand: val('brand'), model: val('model'),
        serial: val('serial'), condition: val('condition'), vendor: val('vendor'), purchase_date: val('purchase_date'),
        purchase_cost: val('purchase_cost'), warranty_until: val('warranty_until'), reorder_level: val('reorder_level'), notes: val('notes'),
      };
      if (!payload.title) return showModalError('Asset name is required');
      if (!editing) {
        payload.quantity = Math.max(1, parseInt(val('quantity'), 10) || 1);
        payload.status = val('status');
        payload.serials = val('serials').split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
        if (payload.serials.length && payload.serials.length !== payload.quantity) return showModalError('Enter ' + payload.quantity + ' serial numbers (one per unit), or leave the list blank.');
      }
      if (image) { payload.image_name = image.name; payload.image_data = image.data; }
      setBusy(true);
      act(call(INV + 'save_inventory_asset', { asset: payload }), function (res) {
        if (editing) return 'Saved ' + payload.title;
        var list = (res && res.assets) || [];
        return 'Added ' + list.length + ' × ' + payload.title + (list.length ? ' (' + list[0].serial + (list.length > 1 ? ' … ' + list[list.length - 1].serial : '') + ')' : '');
      }).catch(function () {});
    });
  }

  /* actions */
  var ACTION_INFO = {
    assign: { title: 'Assign asset to employee', ok: 'Assigned' },
    transfer: { title: 'Transfer asset', ok: 'Transferred' },
    return: { title: 'Return to stock', ok: 'Returned to stock' },
    repair: { title: 'Send for repair', ok: 'Sent for repair' },
    maintenance: { title: 'Send for maintenance', ok: 'Marked under maintenance' },
    ready: { title: 'Repair / maintenance complete', ok: 'Back in service' },
    damage: { title: 'Report damage', ok: 'Damage reported' },
    loss: { title: 'Report loss', ok: 'Loss reported' },
    dispose: { title: 'Dispose asset', ok: 'Disposed' },
    audit: { title: 'Audit check', ok: 'Audit logged' },
  };

  function employeePicker(selected) {
    var emps = (state.board && state.board.employees) || [];
    return '<label class="span-2">Employee *<input name="emp_q" placeholder="Search employee by name, ID or department" autocomplete="off" />' +
      '<select name="employee" size="6">' + emps.map(function (e) {
        return '<option value="' + esc(e.id) + '"' + (e.id === selected ? ' selected' : '') + '>' + esc(e.name + ' · ' + e.id + (e.department ? ' · ' + e.department : '') + (e.designation ? ' · ' + e.designation : '')) + '</option>';
      }).join('') + '</select></label>';
  }

  function wirePicker(m) {
    var q = m.querySelector('[name="emp_q"]');
    var s = m.querySelector('[name="employee"]');
    if (!q || !s) return;
    q.addEventListener('input', function () {
      var t = q.value.trim().toLowerCase();
      Array.prototype.forEach.call(s.options, function (o) { o.hidden = !!t && o.textContent.toLowerCase().indexOf(t) < 0 && o.value !== ''; });
    });
  }

  function actionModal(action, ids, preset) {
    preset = preset || {};
    var info = ACTION_INFO[action];
    var items = (ids || []).map(assetById).filter(Boolean);
    var available = assets().filter(function (a) { return a.status === 'Available'; });
    var conditions = (state.board && state.board.conditions) || ['New', 'Good', 'Fair', 'Poor', 'Damaged'];
    var needsItemPick = action === 'assign' && !items.length;
    var req = preset.request || null;
    var body = '<div class="pas-grid">';
    if (req) {
      body += '<div class="span-2 pas-req-box"><b>Request from ' + esc(req.employee_name) + '</b> · ' + esc(req.title) + (req.category ? ' (' + esc(req.category) + ')' : '') +
        (req.quantity > 1 ? ' · Qty ' + esc(req.quantity) : '') + ' · ' + esc(req.priority || 'Normal') + (req.needed_by ? ' · needed by ' + esc(fmtDate(req.needed_by)) : '') +
        (req.note ? '<small>' + esc(req.note) + '</small>' : '') + '</div>';
    }
    if (needsItemPick) {
      var pref = (preset.title || '').toLowerCase();
      var prefCat = preset.category || '';
      var score = function (a) {
        if (pref && (a.title.toLowerCase().indexOf(pref) >= 0 || pref.indexOf(a.title.toLowerCase()) >= 0)) return 0;
        if ((prefCat && a.category === prefCat) || (pref && a.category.toLowerCase() === pref)) return 1;
        return 2;
      };
      var sorted = available.slice().sort(function (x, y) {
        return score(x) - score(y) || x.title.localeCompare(y.title) || String(x.serial).localeCompare(String(y.serial));
      });
      body += '<label class="span-2">Item (serial number) *<input name="item_q" placeholder="Search available items by name or serial" autocomplete="off" />' +
        '<select name="item" size="6">' + sorted.map(function (a, i) {
          return '<option value="' + esc(a.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(a.title + (a.brand || a.model ? ' · ' + [a.brand, a.model].filter(Boolean).join(' ') : '') + ' — ' + (a.serial || 'no serial') + ' · ' + (a.location || '')) + '</option>';
        }).join('') + '</select>' + (sorted.length ? '' : '<small>No available stock. Add stock or return an item first.</small>') + '</label>';
    } else {
      body += '<div class="span-2 pas-items">' + items.map(function (a) {
        return '<span>' + thumb(a) + '<b>' + esc(a.title) + '</b> <span class="mono">' + esc(a.serial || '—') + '</span> ' + pill(a.status) + (a.employee_name ? ' <small>' + esc(a.employee_name) + '</small>' : '') + '</span>';
      }).join('') + '</div>';
    }
    if (action === 'assign') {
      body += (req
        ? '<input type="hidden" name="employee" value="' + esc(preset.employee) + '" />'
        : employeePicker(preset.employee)) +
        '<label>Branch / location<select name="location"><option value="">Keep current</option>' + options(locationsList(), '') + '</select></label>' +
        '<label>Assignment date<input name="assign_date" type="date" value="' + today() + '" /></label>' +
        '<label>Expected return date<input name="expected_return" type="date" /></label>' +
        '<label>Condition at handover<select name="condition">' + options(conditions, (items[0] && items[0].condition) || 'Good') + '</select></label>';
    } else if (action === 'transfer') {
      body += '<p class="span-2 pas-hint">Pick a new employee, a new branch, or both. Changing the employee closes the current assignment and creates a new assignment report.</p>' +
        '<label class="span-2"><span>Transfer to employee</span><input name="emp_q" placeholder="Search employee (leave unselected for a branch-only transfer)" autocomplete="off" />' +
        '<select name="employee" size="6"><option value="" selected>— Branch transfer only —</option>' + ((state.board.employees || []).map(function (e) {
          return '<option value="' + esc(e.id) + '">' + esc(e.name + ' · ' + e.id + (e.department ? ' · ' + e.department : '')) + '</option>';
        }).join('')) + '</select></label>' +
        '<label>To branch / location<select name="location"><option value="">Keep current</option>' + options(locationsList(), '') + '</select></label>' +
        '<label>Expected return date<input name="expected_return" type="date" /></label>' +
        '<label>Condition<select name="condition">' + options(conditions, (items[0] && items[0].condition) || 'Good') + '</select></label>';
    } else if (action === 'return') {
      body += '<label>Condition on return<select name="condition">' + options(conditions, 'Good') + '</select><small>Choosing Damaged moves the item to Damaged instead of stock.</small></label>' +
        '<label>Return to branch / store<select name="location"><option value="">Keep current</option>' + options(locationsList(), '') + '</select></label>';
    } else if (action !== 'dispose') {
      body += '<label>Condition<select name="condition"><option value="">Unchanged</option>' + options(conditions, action === 'damage' ? 'Damaged' : '') + '</select></label>';
    }
    var noteLabel = { repair: 'Issue / repair vendor', maintenance: 'Maintenance details', damage: 'What happened? *', loss: 'Circumstances of loss *', dispose: 'Disposal method, buyer or reason *', audit: 'Audit note', ready: 'Work done' }[action] || 'Note';
    body += '<label class="span-2">' + esc(noteLabel) + '<textarea name="note" rows="2"></textarea></label>';
    if (action === 'assign' || action === 'transfer') {
      body += '<div class="span-2"><b class="pas-label">HR Manager signature (optional now, can sign later from Assignment Reports)</b>' + padHtml() + '</div>';
    }
    body += '</div>';
    var m = openModal(info.title, body, '<button type="button" class="pas-btn" data-m="close">Cancel</button><button type="button" class="pas-btn primary" data-m="save">Confirm</button>', action === 'assign' || action === 'transfer');
    wirePicker(m);
    var iq = m.querySelector('[name="item_q"]');
    if (iq) {
      var is = m.querySelector('[name="item"]');
      iq.addEventListener('input', function () {
        var t = iq.value.trim().toLowerCase();
        Array.prototype.forEach.call(is.options, function (o) { o.hidden = !!t && o.textContent.toLowerCase().indexOf(t) < 0; });
      });
    }
    var pad = wirePad(m);
    m.querySelector('[data-m="save"]').addEventListener('click', function () {
      var target = needsItemPick ? [val('item')].filter(Boolean) : items.map(function (a) { return a.id; });
      if (!target.length) return showModalError('Select a serial-numbered item');
      var data = { note: val('note'), condition: val('condition'), location: val('location') };
      if (action === 'assign' || action === 'transfer') {
        data.employee = val('employee');
        data.assign_date = val('assign_date');
        data.expected_return = val('expected_return');
        if (action === 'assign' && !data.employee) return showModalError('Select an employee');
        if (action === 'transfer' && !data.employee && !data.location) return showModalError('Choose a new employee or branch');
        if (pad && pad.signed()) data.hr_signature = pad.data();
      }
      if (req) data.request = req.id;
      if (['damage', 'loss', 'dispose'].indexOf(action) >= 0 && !data.note) return showModalError('Please add the details');
      setBusy(true);
      act(call(INV + 'update_inventory_assets', { assets: target, action: action, data: data }), function (res) {
        var msg = info.ok + ' ' + res.updated + ' item' + (res.updated === 1 ? '' : 's') + '.';
        if (res.request) msg += ' Request fulfilled.';
        if (res.agreement) msg += ' Assignment report ' + res.agreement + ' created' + (data.hr_signature ? ' and signed by HR' : '') + '; the employee can now sign it.';
        state.sel = {};
        return msg;
      }).then(function (res) {
        if (res && res.agreement) reportReady(res.agreement, true);
      }).catch(function () {});
    });
  }

  /* signatures */
  function padHtml() {
    return '<div class="pas-pad"><canvas width="640" height="170"></canvas><div><small>Sign with mouse, finger or stylus</small><button type="button" class="pas-link" data-pad="clear">Clear</button></div></div>';
  }

  function wirePad(container) {
    var canvas = container.querySelector('.pas-pad canvas');
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    var drawing = false;
    var inked = false;
    function pt(e) {
      var r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
    }
    canvas.addEventListener('pointerdown', function (e) {
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      var p = pt(e);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = pt(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      inked = true;
    });
    function end() { drawing = false; }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    container.querySelector('[data-pad="clear"]').addEventListener('click', function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      inked = false;
    });
    return {
      signed: function () { return inked; },
      data: function () {
        var out = document.createElement('canvas');
        out.width = canvas.width;
        out.height = canvas.height;
        var o = out.getContext('2d');
        o.fillStyle = '#fff';
        o.fillRect(0, 0, out.width, out.height);
        o.drawImage(canvas, 0, 0);
        return out.toDataURL('image/jpeg', 0.85);
      },
    };
  }

  function signModal(id, party, found, after) {
    var g = found || ((state.board && state.board.agreements) || []).filter(function (x) { return x.id === id; })[0];
    if (!g) return;
    var who = party === 'hr' ? 'HR Manager' : g.employee_name;
    var body = '<p><b>' + esc(g.employee_name) + '</b> · ' + esc(g.id) + ' · issued ' + esc(fmtDate(g.issued_on)) + '</p>' +
      '<ul class="pas-list">' + (g.assets || []).map(function (x) { return '<li>' + esc(x.title) + ' <span class="mono">' + esc(x.serial || '') + '</span>' + (x.category ? ' · ' + esc(x.category) : '') + '</li>'; }).join('') + '</ul>' +
      '<p class="pas-hint">' + (party === 'hr'
        ? 'By signing you confirm these items were issued under the company asset terms.'
        : 'By signing, the employee confirms receiving the items above in the stated condition and accepts the terms and conditions in the report (custody, care, reporting loss or damage within 24 hours, recovery for negligence, and return on exit or request).') + '</p>' +
      '<button type="button" class="pas-link" data-pdf-preview="' + esc(g.id) + '">Read the full report (PDF)</button>' +
      '<b class="pas-label">' + esc(who) + ' signature</b>' + padHtml();
    var m = openModal(party === 'hr' ? 'Sign as HR Manager' : 'Employee signature', body,
      '<button type="button" class="pas-btn" data-m="close">Cancel</button><button type="button" class="pas-btn primary" data-m="save">Sign and save</button>');
    var pad = wirePad(m);
    m.querySelector('[data-pdf-preview]').addEventListener('click', function () { downloadPdf(g.id); });
    m.querySelector('[data-m="save"]').addEventListener('click', function () {
      if (!pad.signed()) return showModalError('Please sign in the box first');
      setBusy(true);
      var signing = call(ACC + 'sign_asset_agreement', { agreement: g.id, party: party, signature: pad.data() });
      if (after) {
        signing.then(function (res) { closeModal(); after(res); }).catch(function (e) { showModalError(e.message || 'Could not save the signature'); });
        return;
      }
      act(signing, function (res) {
        return 'Signed. Report ' + g.id + ' is now ' + ((res && res.status) || 'updated') + '.';
      }).catch(function () {});
    });
  }

  /* ------------------------------------------------------------ employee profile: My Assets */

  var mine = { el: null, data: null, loading: false, error: '', notice: '' };

  function onOwnProfile() {
    return /^\/people\/profile\/?$/.test(location.pathname) && !new URLSearchParams(location.search).get('employee');
  }

  function loadMine() {
    mine.loading = true;
    renderMine();
    return call(INV + 'get_my_assets').then(function (d) {
      mine.data = d;
      mine.error = '';
    }).catch(function (e) {
      mine.error = e.message || 'Could not load your assets';
    }).then(function () {
      mine.loading = false;
      renderMine();
    });
  }

  function renderMine() {
    if (!mine.el) return;
    var d = mine.data;
    var html = '<div class="pas-mine-head"><div><h3>' + icon('laptop') + ' My Assets</h3><p>Company assets issued to you, your assignment reports and asset requests.</p></div>' +
      (d && d.employee ? '<button type="button" class="pas-btn primary" data-my="request">' + icon('plus') + ' Request an asset</button>' : '') + '</div>';
    if (mine.error) html += '<div class="pas-alert err">' + esc(mine.error) + '</div>';
    if (mine.notice) html += '<div class="pas-alert ok">' + esc(mine.notice) + '</div>';
    if (!d) {
      mine.el.innerHTML = html + '<p class="pas-muted">' + (mine.loading ? 'Loading…' : '') + '</p>';
      return;
    }
    if (!d.employee) {
      mine.el.innerHTML = html + '<p class="pas-muted">Your login is not linked to an employee record yet, so assets cannot be shown. Ask HR to link it.</p>';
      return;
    }
    var pending = (d.agreements || []).filter(function (g) { return !g.employee_signed; });
    html += '<div class="pas-mine-grid">';
    html += '<div class="pas-mine-col"><h4>With me <i>' + (d.assets || []).length + '</i></h4>' + ((d.assets || []).length ? '<ul class="pas-mine-list">' + d.assets.map(function (a) {
      var due = daysUntil(a.expected_return);
      return '<li>' + thumb(a) + '<div><b>' + esc(a.title) + '</b><small>' + esc([[a.brand, a.model].filter(Boolean).join(' '), a.category].filter(Boolean).join(' · ')) + '</small>' +
        '<small><span class="mono">' + esc(a.serial || '—') + '</span>' + (a.assign_date ? ' · since ' + esc(fmtDate(a.assign_date)) : '') +
        (a.expected_return ? ' · <span' + (due !== null && due < 0 ? ' class="pas-warn"' : '') + '>return by ' + esc(fmtDate(a.expected_return)) + '</span>' : '') + '</small></div>' + pill(a.status) + '</li>';
    }).join('') + '</ul>' : '<p class="pas-muted">No assets are assigned to you.</p>') + '</div>';
    html += '<div class="pas-mine-col"><h4>Assignment reports' + (pending.length ? ' <i class="warn">' + pending.length + ' to sign</i>' : '') + '</h4>' + ((d.agreements || []).length ? '<ul class="pas-mine-list">' + d.agreements.map(function (g) {
      return '<li><div><b>' + esc((g.assets || []).map(function (x) { return x.title; }).join(', ') || g.id) + '</b><small><span class="mono">' + esc((g.assets || []).map(function (x) { return x.serial; }).filter(Boolean).join(', ')) + '</span> · ' + esc(fmtDate(g.issued_on)) + '</small>' +
        '<small>' + pill(g.status || 'Issued') + '</small></div><span class="pas-mine-actions">' +
        (!g.employee_signed ? '<button type="button" class="pas-btn sm primary" data-my-sign="' + esc(g.id) + '">' + icon('pen') + ' Sign</button>' : '') +
        '<button type="button" class="pas-btn sm" data-my-print="' + esc(g.id) + '">' + icon('printer') + '</button>' +
        '<button type="button" class="pas-btn sm" data-my-pdf="' + esc(g.id) + '">' + icon('download') + '</button></span></li>';
    }).join('') + '</ul>' : '<p class="pas-muted">No assignment reports yet.</p>') + '</div>';
    html += '<div class="pas-mine-col span"><h4>My requests <i>' + (d.requests || []).length + '</i></h4>' + ((d.requests || []).length ? '<ul class="pas-mine-list">' + d.requests.map(function (r) {
      var open = r.status === 'Pending' || r.status === 'Approved';
      return '<li><div><b>' + esc(r.title) + '</b>' + (r.category && r.category !== r.title ? ' <small class="pas-inline">' + esc(r.category) + '</small>' : '') +
        '<small>Requested ' + esc(fmtDate(r.request_date)) + (r.needed_by ? ' · needed by ' + esc(fmtDate(r.needed_by)) : '') + ' · ' + esc(r.priority || 'Normal') + (r.quantity > 1 ? ' · qty ' + r.quantity : '') + '</small>' +
        (r.note ? '<small>' + esc(r.note) + '</small>' : '') +
        (r.hr_note ? '<small><b>HR:</b> ' + esc(r.hr_note) + '</small>' : '') +
        (r.assigned_assets ? '<small>Issued: <span class="mono">' + esc(r.assigned_assets) + '</span></small>' : '') + '</div>' +
        '<span class="pas-mine-actions">' + pill(r.status) + (open ? '<button type="button" class="pas-btn sm" data-my-cancel="' + esc(r.id) + '">Cancel</button>' : '') + '</span></li>';
    }).join('') + '</ul>' : '<p class="pas-muted">You have not requested any assets.</p>') + '</div>';
    html += '</div>';
    mine.el.innerHTML = html;
  }

  function onMineClick(e) {
    var el;
    var d = mine.data || {};
    var done = function (msg) { return function () { mine.notice = msg; return loadMine(); }; };
    if ((el = e.target.closest('[data-my="request"]'))) return requestModal(d.categories, done('Request sent to HR. You can follow its status here.'));
    if ((el = e.target.closest('[data-my-sign]'))) {
      var id = el.getAttribute('data-my-sign');
      var g = (d.agreements || []).filter(function (x) { return x.id === id; })[0];
      return signModal(id, 'employee', g, done('Thank you. Your signature has been added to report ' + id + '.'));
    }
    if ((el = e.target.closest('[data-my-print]'))) return printReport(el.getAttribute('data-my-print'));
    if ((el = e.target.closest('[data-my-pdf]'))) return downloadPdf(el.getAttribute('data-my-pdf'));
    if ((el = e.target.closest('[data-my-cancel]'))) {
      var rid = el.getAttribute('data-my-cancel');
      var r = (d.requests || []).filter(function (x) { return x.id === rid; })[0];
      return decideModal(rid, 'Cancelled', r, done('Request cancelled.'));
    }
  }

  // Shared by the People add-ons that add tabs to My Profile (keep identical in people-announce.js).
  var ptabs = window.__ptabs || (window.__ptabs = (function () {
    var reg = {};
    var active = null;
    var stripped = null;
    function bar() { return document.querySelector('.me-tabs'); }
    function hideNative(tabs) {
      for (var n = tabs.nextElementSibling; n; n = n.nextElementSibling) {
        if (n.hasAttribute('data-ptab-panel')) continue;
        if (n.style.display !== 'none') { n.style.display = 'none'; n.setAttribute('data-ptab-hid', '1'); }
      }
    }
    function restoreNative() {
      document.querySelectorAll('[data-ptab-hid]').forEach(function (n) { n.style.display = ''; n.removeAttribute('data-ptab-hid'); });
    }
    function show(id) {
      var tabs = bar();
      if (!tabs || !reg[id]) return;
      active = id;
      var on = tabs.querySelector('button.on:not([data-ptab])');
      if (on) { on.classList.remove('on'); on.setAttribute('aria-selected', 'false'); stripped = on; }
      Object.keys(reg).forEach(function (k) {
        var r = reg[k];
        if (r.btn) { r.btn.classList.toggle('on', k === id); r.btn.setAttribute('aria-selected', k === id ? 'true' : 'false'); }
        if (r.panel) r.panel.hidden = k !== id;
      });
      hideNative(tabs);
      if (location.hash !== '#' + id) history.replaceState(history.state, '', location.pathname + location.search + '#' + id);
      if (reg[id].onShow) reg[id].onShow();
    }
    function hide(clicked) {
      active = null;
      Object.keys(reg).forEach(function (k) {
        var r = reg[k];
        if (r.btn) { r.btn.classList.remove('on'); r.btn.setAttribute('aria-selected', 'false'); }
        if (r.panel) r.panel.hidden = true;
      });
      restoreNative();
      if (stripped && (!clicked || clicked === stripped)) { stripped.classList.add('on'); stripped.setAttribute('aria-selected', 'true'); }
      stripped = null;
      if (reg[location.hash.slice(1)]) history.replaceState(history.state, '', location.pathname + location.search);
    }
    function ensure(id, label, panel, onShow) {
      var tabs = bar();
      if (!tabs) return false;
      var r = reg[id] || (reg[id] = {});
      r.panel = panel;
      r.onShow = onShow;
      panel.setAttribute('data-ptab-panel', id);
      if (!r.btn || !r.btn.isConnected) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', 'false');
        b.setAttribute('data-ptab', id);
        var settings = Array.prototype.filter.call(tabs.querySelectorAll('button:not([data-ptab])'), function (x) { return /^\s*settings\s*$/i.test(x.textContent); })[0];
        tabs.insertBefore(b, settings || null);
        r.btn = b;
        r.label = null;
        if (!tabs.__ptabWired) {
          tabs.__ptabWired = true;
          tabs.addEventListener('click', function (e) {
            var t = e.target.closest('button');
            if (!t) return;
            var pid = t.getAttribute('data-ptab');
            if (pid) show(pid);
            else if (active) hide(t);
          });
        }
        if (location.hash === '#' + id) setTimeout(function () { show(id); }, 0);
      }
      if (r.label !== label) { r.btn.innerHTML = label; r.label = label; }
      if (panel.parentNode !== tabs.parentNode) {
        var after = tabs;
        while (after.nextElementSibling && after.nextElementSibling.hasAttribute('data-ptab-panel')) after = after.nextElementSibling;
        tabs.parentNode.insertBefore(panel, after.nextSibling);
      }
      if (active === id) {
        hideNative(tabs);
        var stray = tabs.querySelector('button.on:not([data-ptab])');
        if (stray) { stray.classList.remove('on'); stripped = stray; }
      } else if (!panel.hidden) {
        panel.hidden = true;
      }
      return true;
    }
    function drop(id) {
      var r = reg[id];
      if (!r) return;
      if (active === id) hide();
      if (r.btn) r.btn.remove();
      if (r.panel) r.panel.remove();
      delete reg[id];
    }
    return { ensure: ensure, show: show, hide: hide, drop: drop, active: function () { return active; } };
  })());

  function mountMine() {
    if (!onOwnProfile()) {
      ptabs.drop('my-assets');
      if (mine.el) { mine.el = null; mine.data = null; }
      return;
    }
    if (!mine.el) {
      mine.el = document.createElement('section');
      mine.el.id = 'pas-mine';
      mine.el.className = 'pas pas-mine';
      mine.el.hidden = true;
      mine.el.addEventListener('click', onMineClick);
    }
    ptabs.ensure('my-assets', 'My Assets', mine.el, function () { if (!mine.data && !mine.loading) loadMine(); });
  }

  /* view */
  function viewModal(id) {
    var a = assetById(id);
    if (!a) return;
    var moves = ((state.board && state.board.movements) || []).filter(function (m) { return m.asset === id; });
    var reports = ((state.board && state.board.agreements) || []).filter(function (g) { return (g.assets || []).some(function (x) { return x.id === id; }); });
    var w = daysUntil(a.warranty_until);
    function row(k, v) { return '<div><dt>' + esc(k) + '</dt><dd>' + (v ? v : '—') + '</dd></div>'; }
    var body = '<div class="pas-view">' + (a.photo ? '<img class="pas-view-img" src="' + esc(photoUrl(a.photo)) + '" alt="" />' : '') +
      '<dl class="pas-dl">' +
      row('Status', pill(a.status)) + row('Serial / asset no.', '<span class="mono">' + esc(a.serial) + '</span>') +
      row('Category', esc(a.category)) + row('Brand / model', esc([a.brand, a.model].filter(Boolean).join(' '))) +
      row('Branch / location', esc(a.location)) + row('Condition', esc(a.condition)) +
      row('Holder', a.employee_name ? esc(a.employee_name + ' (' + a.employee_id + ')') : 'In stock') +
      row('Assigned on', esc(fmtDate(a.assign_date))) + row('Expected return', esc(fmtDate(a.expected_return))) +
      row('Vendor', esc(a.vendor)) + row('Purchase date', esc(fmtDate(a.purchase_date))) +
      row('Purchase cost', a.purchase_cost ? esc(money(a.purchase_cost)) : '') +
      row('Warranty', a.warranty_until ? esc(fmtDate(a.warranty_until)) + (w !== null ? ' <small>(' + (w < 0 ? 'expired' : w + ' days left') + ')</small>' : '') : '') +
      '</dl></div>' + (a.notes ? '<p>' + esc(a.notes) + '</p>' : '') +
      (reports.length ? '<h3 class="pas-h3">Assignment reports</h3><ul class="pas-list">' + reports.map(function (g) {
        return '<li><b>' + esc(g.id) + '</b> · ' + esc(g.employee_name) + ' · ' + pill(g.status || 'Issued') + ' <button type="button" class="pas-link" data-pdf="' + esc(g.id) + '">PDF</button></li>';
      }).join('') + '</ul>' : '') +
      '<h3 class="pas-h3">History</h3>' + (moves.length ? '<ul class="pas-timeline">' + moves.map(function (m) {
        return '<li>' + pill(m.kind, kindTone(m.kind)) + ' <b>' + esc(m.employee_name || '') + '</b> ' + esc(m.to_location ? '· ' + m.to_location : '') +
          (m.condition ? ' · ' + esc(m.condition) : '') + (m.note ? '<br>' + esc(m.note) : '') + '<small>' + esc(fmtWhen(m.happened_on)) + (m.actor ? ' · ' + esc(m.actor) : '') + '</small></li>';
      }).join('') + '</ul>' : '<p class="pas-muted">No movements recorded for this item yet.</p>');
    var mgr = manager();
    var foot = '<button type="button" class="pas-btn" data-m="close">Close</button>';
    if (mgr) {
      foot = '<button type="button" class="pas-btn danger" data-v="delete">' + icon('trash') + ' Delete</button>' + foot;
      foot += '<button type="button" class="pas-btn" data-v="edit">Edit</button>';
      if (a.status === 'Available') foot += '<button type="button" class="pas-btn primary" data-v="assign">Assign</button>';
      if (a.status === 'Assigned') foot += '<button type="button" class="pas-btn" data-v="transfer">Transfer</button><button type="button" class="pas-btn primary" data-v="return">Return</button>';
      if (a.status === 'In Repair' || a.status === 'Under Maintenance' || a.status === 'Damaged') foot += '<button type="button" class="pas-btn primary" data-v="ready">Repair done</button>';
    }
    var m = openModal(a.title, body, foot, true);
    m.addEventListener('click', function (e) {
      var pdf = e.target.closest('[data-pdf]');
      if (pdf) downloadPdf(pdf.getAttribute('data-pdf'));
      var v = e.target.closest('[data-v]');
      if (!v) return;
      var what = v.getAttribute('data-v');
      if (what === 'edit') assetForm(a);
      else if (what === 'delete') deleteModal([a.id]);
      else actionModal(what, [a.id]);
    });
  }

  function deleteModal(ids) {
    var items = (ids || []).map(assetById).filter(Boolean);
    if (!items.length) return;
    var held = items.filter(function (a) { return a.status === 'Assigned'; });
    var body = '<p>Permanently delete ' + (items.length === 1 ? 'this item' : 'these ' + items.length + ' items') + ' and their movement history from the inventory. This cannot be undone.</p>' +
      '<div class="pas-items">' + items.map(function (a) {
        return '<span>' + thumb(a) + '<b>' + esc(a.title) + '</b> <span class="mono">' + esc(a.serial || '—') + '</span> ' + pill(a.status) + (a.employee_name ? ' <small>' + esc(a.employee_name) + '</small>' : '') + '</span>';
      }).join('') + '</div>' +
      (held.length ? '<div class="pas-alert err">' + held.length + ' item(s) are with employees. Return them to stock first; assigned items cannot be deleted.</div>' : '') +
      '<p class="pas-hint">Use Delete for items added by mistake or duplicates. To write off a real asset, use Dispose so the record stays in the history. Signed assignment reports are kept.</p>' +
      '<label>Reason *<textarea name="del_reason" rows="2" placeholder="e.g. Duplicate entry, wrong serial number"></textarea></label>';
    var m = openModal(items.length === 1 ? 'Delete asset' : 'Delete ' + items.length + ' assets', body,
      '<button type="button" class="pas-btn" data-m="close">Cancel</button><button type="button" class="pas-btn danger solid" data-m="save"' + (held.length ? ' disabled' : '') + '>Delete permanently</button>');
    m.querySelector('[data-m="save"]').addEventListener('click', function () {
      var reason = val('del_reason');
      if (!reason) return showModalError('Add a reason for deleting');
      setBusy(true);
      act(call(INV + 'delete_inventory_assets', { assets: items.map(function (a) { return a.id; }), reason: reason }), function (res) {
        items.forEach(function (a) { delete state.sel[a.id]; });
        return 'Deleted ' + res.deleted + ' item' + (res.deleted === 1 ? '' : 's') + ' from the inventory.';
      }).catch(function () {});
    });
  }

  function categoriesModal() {
    var cats = (state.board && state.board.categories) || [];
    var body = '<ul class="pas-list">' + cats.map(function (c) { return '<li>' + esc(c.title) + ' <small>' + c.count + ' items</small></li>'; }).join('') + '</ul>' +
      '<label>New category<input name="cat_title" placeholder="e.g. Medical Device" /></label>';
    var m = openModal('Asset categories', body, '<button type="button" class="pas-btn" data-m="close">Close</button><button type="button" class="pas-btn primary" data-m="save">Add category</button>');
    m.querySelector('[data-m="save"]').addEventListener('click', function () {
      var t = val('cat_title');
      if (!t) return showModalError('Enter a category name');
      setBusy(true);
      act(call(MAIN + 'save_people_asset_category', { category: { title: t } }), 'Category ' + t + ' added').catch(function () {});
    });
  }

  function requestModal(cats, after) {
    cats = cats && cats.length ? cats : categoriesList();
    var body = '<div class="pas-grid">' +
      '<label>Category *<select name="req_cat">' + options(cats, cats[0]) + '</select></label>' +
      '<label>Asset needed *<input name="req_title" placeholder="e.g. Laptop with 16 GB RAM" /></label>' +
      '<label>Quantity<input name="req_qty" type="number" min="1" max="20" value="1" /></label>' +
      '<label>Priority<select name="req_priority">' + options(['Normal', 'High', 'Urgent'], 'Normal') + '</select></label>' +
      '<label>Needed by<input name="req_needed" type="date" min="' + today() + '" /></label>' +
      '<label class="span-2">Reason / how you will use it *<textarea name="req_note" rows="3" placeholder="e.g. Field visits from next week; current phone is damaged"></textarea></label></div>' +
      '<p class="pas-hint">HR reviews the request, then assigns a specific item with its serial number. You will receive an Asset Assignment Report to sign.</p>';
    var m = openModal('Request an asset', body,
      '<button type="button" class="pas-btn" data-m="close">Cancel</button><button type="button" class="pas-btn primary" data-m="save">Submit request</button>');
    m.querySelector('[data-m="save"]').addEventListener('click', function () {
      var payload = {
        category: val('req_cat'), title: val('req_title') || val('req_cat'), quantity: val('req_qty'),
        priority: val('req_priority'), needed_by: val('req_needed'), note: val('req_note'),
      };
      if (!payload.title) return showModalError('Tell HR which asset you need');
      if (!payload.note) return showModalError('Add the reason for the request');
      setBusy(true);
      call(INV + 'submit_asset_request', { request: payload }).then(function () {
        closeModal();
        if (after) return after();
        state.notice = 'Request submitted to HR';
        state.tab = 'requests';
        return load();
      }).catch(function (e) { showModalError(e.message || 'Could not submit the request'); });
    });
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(function (x) { return x.trim(); })) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some(function (x) { return x.trim(); })) rows.push(row);
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); });
    return rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, idx) { o[h] = (r[idx] || '').trim(); });
      return o;
    });
  }

  var CSV_COLS = ['title', 'category', 'brand', 'model', 'serial', 'quantity', 'location', 'vendor', 'purchase_date', 'purchase_cost', 'warranty_until', 'condition', 'reorder_level', 'notes'];

  function bulkModal() {
    var body = '<p class="pas-hint">CSV columns: <span class="mono">' + CSV_COLS.join(', ') + '</span>. One row per unit with its serial, or one row with a quantity and a serial prefix. Dates as YYYY-MM-DD.</p>' +
      '<button type="button" class="pas-link" data-bulk-template>Download template</button>' +
      '<label>CSV file<input type="file" name="csv" accept=".csv,text/csv" /></label><label>…or paste CSV<textarea name="csv_text" rows="6"></textarea></label><div data-bulk-result></div>';
    var m = openModal('Bulk import stock', body, '<button type="button" class="pas-btn" data-m="close">Close</button><button type="button" class="pas-btn primary" data-m="save">Import</button>', true);
    m.querySelector('[data-bulk-template]').addEventListener('click', function () {
      downloadCsv('asset-import-template.csv', [CSV_COLS, ['Dell Latitude 5420', 'Laptop', 'Dell', 'Latitude 5420', 'DL5420-0001', '1', 'IT Store', 'Ingram', '2026-04-01', '68000', '2029-03-31', 'New', '2', '']]);
    });
    m.querySelector('[name="csv"]').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      f.text().then(function (t) { m.querySelector('[name="csv_text"]').value = t; });
    });
    m.querySelector('[data-m="save"]').addEventListener('click', function () {
      var rows = parseCsv(m.querySelector('[name="csv_text"]').value || '');
      rows = rows.filter(function (r) { return r.title || r.asset || r.asset_name || r.name; });
      if (!rows.length) return showModalError('No rows with an asset name found');
      setBusy(true);
      var out = m.querySelector('[data-bulk-result]');
      var ok = 0;
      var errors = [];
      var chain = Promise.resolve();
      rows.forEach(function (r, i) {
        chain = chain.then(function () {
          out.textContent = 'Importing ' + (i + 1) + ' of ' + rows.length + '…';
          var payload = {};
          CSV_COLS.forEach(function (k) { if (r[k]) payload[k] = r[k]; });
          payload.title = r.title || r.asset || r.asset_name || r.name;
          payload.location = payload.location || r.branch || '';
          payload.serial = payload.serial || r.serial_number || '';
          return call(INV + 'save_inventory_asset', { asset: payload }).then(function (res) { ok += (res && res.created) || 1; }).catch(function (e) {
            errors.push('Row ' + (i + 2) + ' (' + payload.title + '): ' + e.message);
          });
        });
      });
      chain.then(function () {
        out.innerHTML = '<p><b>' + ok + ' unit(s) added.</b></p>' + (errors.length ? '<ul class="pas-list err">' + errors.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '');
        setBusy(false);
        state.notice = 'Bulk import: ' + ok + ' unit(s) added' + (errors.length ? ', ' + errors.length + ' row(s) failed' : '');
        load();
      });
    });
  }

  function downloadCsv(name, rows) {
    var text = rows.map(function (r) {
      return r.map(function (c) { var s = String(c == null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
    }).join('\n');
    var url = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function exportCsv() {
    var rows = filtered();
    downloadCsv('asset-inventory-' + today() + '.csv', [['Asset', 'Category', 'Brand', 'Model', 'Serial', 'Status', 'Condition', 'Branch', 'Holder', 'Employee ID', 'Assigned', 'Expected return', 'Vendor', 'Purchase date', 'Cost', 'Warranty until', 'Notes']].concat(rows.map(function (a) {
      return [a.title, a.category, a.brand, a.model, a.serial, a.status === 'Retired' ? 'Disposed' : a.status, a.condition, a.location, a.employee_name, a.employee_id, a.assign_date, a.expected_return, a.vendor, a.purchase_date, a.purchase_cost, a.warranty_until, a.notes];
    })));
  }

  /* ------------------------------------------------------------ events */

  function onClick(e) {
    var t = e.target;
    var el;
    if ((el = t.closest('[data-tab]'))) {
      state.tab = el.getAttribute('data-tab');
      state.page = 1;
      state.notice = '';
      if (['available', 'assigned', 'maintenance', 'damaged', 'disposed', 'low', 'warranty'].indexOf(state.tab) >= 0) state.status = '';
      return render();
    }
    if ((el = t.closest('[data-sel]'))) {
      var id = el.getAttribute('data-sel');
      if (state.sel[id]) delete state.sel[id]; else state.sel[id] = true;
      return render();
    }
    if ((el = t.closest('[data-a]'))) {
      var a = el.getAttribute('data-a');
      if (a === 'sel-page') {
        var rows = filtered().slice((state.page - 1) * PER_PAGE, state.page * PER_PAGE);
        var allOn = rows.every(function (x) { return state.sel[x.id]; });
        rows.forEach(function (x) { if (allOn) delete state.sel[x.id]; else state.sel[x.id] = true; });
        return render();
      }
      if (a === 'clear-sel') { state.sel = {}; return render(); }
      if (a === 'delete-sel') return deleteModal(Object.keys(state.sel));
      if (a === 'reset') { state.q = state.cat = state.loc = state.status = ''; state.page = 1; return render(); }
      if (a === 'reload') return load();
      if (a === 'add') return assetForm(null);
      if (a === 'assign-pick') return actionModal('assign', []);
      if (a === 'categories') return categoriesModal();
      if (a === 'request') return requestModal();
      if (a === 'bulk') return bulkModal();
      if (a === 'export') return exportCsv();
    }
    if ((el = t.closest('[data-bulk]'))) {
      var ids = Object.keys(state.sel);
      var action = el.getAttribute('data-bulk');
      if (action === 'assign') {
        var bad = ids.map(assetById).filter(function (x) { return x && x.status !== 'Available'; });
        if (bad.length) { state.error = 'Only available items can be assigned: ' + bad.map(function (x) { return x.title + ' ' + x.serial; }).join(', ') + ' are not in stock.'; return render(); }
      }
      return actionModal(action, ids);
    }
    if ((el = t.closest('[data-one]'))) return actionModal(el.getAttribute('data-one'), [el.getAttribute('data-id')]);
    if ((el = t.closest('[data-view]'))) return viewModal(el.getAttribute('data-view'));
    if ((el = t.closest('[data-edit]'))) return assetForm(assetById(el.getAttribute('data-edit')));
    if ((el = t.closest('[data-del]'))) return deleteModal([el.getAttribute('data-del')]);
    if ((el = t.closest('[data-pdf]'))) return downloadPdf(el.getAttribute('data-pdf'));
    if ((el = t.closest('[data-sign]'))) return signModal(el.getAttribute('data-id'), el.getAttribute('data-sign'));
    if ((el = t.closest('[data-page]'))) { state.page += parseInt(el.getAttribute('data-page'), 10); return render(); }
    if ((el = t.closest('[data-req-filter]'))) { state.reqFilter = el.getAttribute('data-req-filter'); return render(); }
    if ((el = t.closest('[data-req-view]'))) return requestViewModal(el.getAttribute('data-req-view'));
    if ((el = t.closest('[data-req-decide]'))) return decideModal(el.getAttribute('data-id'), el.getAttribute('data-req-decide'));
    if ((el = t.closest('[data-req-assign]'))) return assignFromRequest(el.getAttribute('data-req-assign'));
    if ((el = t.closest('[data-print]'))) return printReport(el.getAttribute('data-print'));
    if ((el = t.closest('[data-group]')) || (el = t.closest('[data-restock]'))) {
      var key = el.getAttribute('data-group') || el.getAttribute('data-restock');
      var g = (state.board.stock || []).filter(function (x) { return x.key === key; })[0];
      if (!g) return;
      if (el.hasAttribute('data-group')) {
        state.tab = 'items';
        state.q = g.title;
        state.cat = g.category;
        state.page = 1;
        return render();
      }
      var sample = assets().filter(function (x) { return groupKey(x) === key; })[0] || {};
      return assetForm(null, { title: g.title, brand: g.brand, model: g.model, category: g.category, vendor: sample.vendor, location: sample.location, purchase_cost: sample.purchase_cost, reorder_level: sample.reorder_level });
    }
  }

  var typing = null;
  function onInput(e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-f');
    if (!f) return;
    if (f === 'q') {
      state.q = e.target.value;
      state.page = 1;
      clearTimeout(typing);
      typing = setTimeout(function () {
        render();
        var input = root.querySelector('[data-f="q"]');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      }, 220);
      return;
    }
    state[f] = e.target.value;
    state.page = 1;
    render();
  }

  /* ------------------------------------------------------------ mount */

  function onAssetsPage() {
    return /^\/people\/assets\/?$/.test(location.pathname);
  }

  function tick() {
    mountMine();
    if (modal && modalPath !== location.pathname) closeModal();
    if (!onAssetsPage()) {
      if (root) { root.remove(); root = null; }
      return;
    }
    var page = document.querySelector('.ast-page');
    if (!page) return;
    if (page.style.display !== 'none') page.style.display = 'none';
    if (root && root.isConnected && root.parentNode === page.parentNode) return;
    if (!root) {
      root = document.createElement('div');
      root.id = 'pas-root';
      root.className = 'pas';
      root.addEventListener('click', onClick);
      root.addEventListener('input', onInput);
    }
    page.parentNode.insertBefore(root, page);
    if (!state.board && !state.loading) load(); else render();
  }

  var ICONS = {
    laptop: '<path d="M4 5h16v10H4z"/><path d="M2 19h20"/>',
    box: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    wrench: '<path d="M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 0-2-2z"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17h.01"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal) closeModal(); });
  new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', tick);
  tick();
})();
