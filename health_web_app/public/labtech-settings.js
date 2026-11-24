/* Labtech Settings: Report Page Management, WhatsApp, pathologist signatures. */
(function () {
  if (window.__labtechSettings) return;
  window.__labtechSettings = true;
  if ((location.hostname || '').toLowerCase() !== 'labtech.e-remedium.in') return;

  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.api.';
  var PATH = '/dashboard/settings';
  if (location.pathname === PATH) document.documentElement.setAttribute('data-lt-hold', 'settings');
  var ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

  var st = {
    open: false,
    tab: 'pad',
    data: null,
    rpm: null,
    layout: null,
    brand: 'remedium',
    format: 'with_header',
    branch: '',
    view: 'setup',
    editBand: null,
    busy: false,
    loading: false,
    quiet: false,
    notice: '',
    error: '',
    inlinePdf: '',
    printBusy: false,
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sid() {
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      return (s && s.sid) || '';
    } catch (e) {
      return '';
    }
  }
  function parseApiPayload(pack) {
    var json = pack.json || {};
    var m = json.message && typeof json.message === 'object' ? json.message : null;
    if (m && m.status === 'error') {
      throw new Error(String(m.message || 'Request failed').replace(/<[^>]+>/g, ''));
    }
    if (m && m.status === 'success') {
      return m.data !== undefined ? m.data : m;
    }
    var server = '';
    try {
      var msgs = JSON.parse(json._server_messages || '[]');
      server = (msgs || [])
        .map(function (x) {
          try {
            return JSON.parse(x).message;
          } catch (e) {
            return x;
          }
        })
        .join(' ')
        .replace(/<[^>]+>/g, ' ')
        .trim();
    } catch (e) {}
    if (!pack.ok || json.exc || server) {
      throw new Error(server || String(json.exception || json.message || 'Request failed').replace(/<[^>]+>/g, ''));
    }
    return m && m.data !== undefined ? m.data : m || json;
  }

  function call(method, extra, fileBlob) {
    var payload = extra || {};
    var s = sid();
    var headers = {
      Accept: 'application/json',
      'X-Frappe-Site-Name': 'health.localhost',
    };
    var body;
    // Binary multipart for letterhead uploads (base64-in-form often arrives empty).
    if (fileBlob) {
      body = new FormData();
      Object.keys(payload).forEach(function (key) {
        if (payload[key] == null || key === 'file_data') return;
        body.append(key, String(payload[key]));
      });
      body.append('file', fileBlob, payload.file_name || fileBlob.name || 'letterhead.png');
      if (s) body.append('sid', s);
    } else {
      body = new URLSearchParams(payload);
      if (s) body.set('sid', s);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    return fetch(API + method, {
      method: 'POST',
      credentials: 'include',
      headers: headers,
      body: body,
    })
      .then(function (r) {
        return r.json().then(function (json) {
          return { ok: r.ok, json: json };
        });
      })
      .then(parseApiPayload);
  }
  function fileData(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error('Could not read file'));
      };
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.readAsDataURL(file);
    });
  }

  function labLayout() {
    return document.querySelector('.layout-labtech');
  }
  function mainArea() {
    return document.querySelector('.layout-labtech .staff-main > main.staff-page');
  }
  function panelEl() {
    return document.querySelector('[data-lts-panel]');
  }
  function nativeSettingsLink() {
    return Array.prototype.slice
      .call(document.querySelectorAll('.layout-labtech a.lt-side-link'))
      .filter(function (a) {
        return (a.getAttribute('href') || '') === PATH && !a.hasAttribute('data-lts-link');
      })[0];
  }
  var navigating = false;
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
  function goToSettings() {
    // The address is owned by the React route. Do not pushState over it.
    document.documentElement.setAttribute('data-lt-hold', 'settings');
  }
  function bindNativeSettingsLink() {
    var link = nativeSettingsLink();
    if (!link || link.getAttribute('data-lts-bound') === '1') return;
    link.setAttribute('data-lts-bound', '1');
    link.addEventListener(
      'click',
      function () {
        document.documentElement.setAttribute('data-lt-hold', 'settings');
      },
      true
    );
  }
  function bootSettings() {
    if (location.pathname !== PATH) return;
    if (panelEl() && st.open) return;
    if (!mainArea()) {
      setTimeout(bootSettings, 50);
      return;
    }
    open(true);
  }
  function withQuiet(fn) {
    st.quiet = true;
    try {
      fn();
    } finally {
      setTimeout(function () {
        st.quiet = false;
      }, 0);
    }
  }

  function addLink() {
    if (!labLayout()) return;
    bindNativeSettingsLink();
    if (document.querySelector('[data-lts-link]') || nativeSettingsLink()) return;
    withQuiet(function () {
      var profile = Array.prototype.slice
        .call(document.querySelectorAll('.layout-labtech a.lt-side-link'))
        .filter(function (a) {
          return (a.getAttribute('href') || '').indexOf('/dashboard/profile') === 0;
        })[0];
      var account = null;
      document.querySelectorAll('.layout-labtech .sidebar-section').forEach(function (sec) {
        if (/^account$/i.test((sec.textContent || '').trim())) account = sec;
      });
      var link = document.createElement('a');
      link.className = 'lt-side-link' + (st.open ? ' active' : '');
      link.href = PATH;
      link.setAttribute('data-lts-link', '1');
      link.innerHTML = '<span class="lt-side-icon">' + ICON + '</span><span>Settings</span>';
      link.addEventListener('click', function () {
        document.documentElement.setAttribute('data-lt-hold', 'settings');
      });
      if (profile && profile.parentNode) profile.parentNode.insertBefore(link, profile);
      else if (account && account.parentNode) account.parentNode.insertBefore(link, account.nextSibling);
      else {
        var nav = document.querySelector('.layout-labtech aside');
        if (nav) nav.appendChild(link);
      }
    });
  }

  function mountPanel() {
    var main = mainArea();
    if (!main || !main.parentNode) return null;
    var panel = panelEl();
    if (panel) return panel;
    panel = document.createElement('section');
    panel.className = 'lts-overlay page staff-page';
    panel.setAttribute('data-lts-panel', '1');
    main.parentNode.insertBefore(panel, main.nextSibling);
    return panel;
  }

  function open(forceLoad) {
    var main = mainArea();
    if (!main) return;
    var already = st.open && panelEl();
    withQuiet(function () {
      st.open = true;
      goToSettings();
      // Hide the React settings shell so refresh keeps this Report Template UI.
      main.classList.add('lts-hidden');
      mountPanel();
      markLink();
      var title = document.querySelector('.layout-labtech .staff-topbar-title');
      if (title) title.textContent = 'Settings';
    });
    if (!already || forceLoad) load();
    else draw();
  }

  function close() {
    if (!st.open && !panelEl()) return;
    withQuiet(function () {
      st.open = false;
      if (document.documentElement.getAttribute('data-lt-hold') === 'settings') {
        document.documentElement.removeAttribute('data-lt-hold');
      }
      var panel = panelEl();
      if (panel) panel.remove();
      var main = mainArea();
      if (main) main.classList.remove('lts-hidden');
      document.querySelectorAll('.layout-labtech a.lt-side-link').forEach(function (a) {
        a.classList.toggle('active', linkPath(a) === location.pathname);
      });
    });
  }

  function applyRpm(rpm, keepSelection) {
    st.rpm = rpm;
    if (!rpm) return;
    // keepSelection: do not jump away from the tab the operator is editing.
    if (!keepSelection) {
      st.brand = (rpm.active && rpm.active.brand) || st.brand || 'remedium';
      st.format = (rpm.active && rpm.active.format) || st.format || 'with_header';
    }
    var knownBranches = ((rpm.branches || []).map(function (b) {
      return b.branch_code;
    }));
    var activeBranch = (rpm.active && rpm.active.branch) || st.branch || '';
    if (!keepSelection) {
      st.branch = knownBranches.indexOf(activeBranch) >= 0 ? activeBranch : '';
    }
    st.layout = Object.assign({}, rpm.layout || {});
  }

  function load() {
    var panel = panelEl();
    if (!panel || st.loading) return;
    st.loading = true;
    st.error = '';
    withQuiet(function () {
      panel.innerHTML = '<div class="lts-wrap"><p class="muted">Loading settings…</p></div>';
    });
    call('get_labtech_settings')
      .then(function (data) {
        st.data = data;
        applyRpm(data.report_page);
        st.loading = false;
        if (!st.rpm) {
          return call('get_report_page_management', {
            brand: st.brand,
            format: st.format,
            branch: st.branch,
          }).then(function (rpm) {
            applyRpm(rpm);
          });
        }
      })
      .then(function () {
        draw();
      })
      .catch(function (err) {
        st.loading = false;
        st.error = err.message || 'Request failed';
        withQuiet(function () {
          var p = panelEl();
          if (p) {
            p.innerHTML =
              '<div class="lts-wrap"><div class="people-alert err">' + esc(st.error) + '</div></div>';
          }
        });
      });
  }

  function reloadRpm() {
    var brand = st.brand;
    var fmt = st.format;
    var branch = st.branch;
    return call('get_report_page_management', {
      brand: brand,
      format: fmt,
      branch: branch,
    }).then(function (rpm) {
      applyRpm(rpm, true);
      st.brand = brand;
      st.format = fmt;
      st.branch = branch;
      // Prefer the layout for the tab we asked for (not a stale active slot).
      if (rpm && rpm.layouts && rpm.layouts[brand] && rpm.layouts[brand][fmt]) {
        st.layout = Object.assign({}, rpm.layouts[brand][fmt]);
      }
      draw();
      return rpm;
    });
  }

  function collectLayoutFromForm(root) {
    var L = Object.assign({}, st.layout || {});
    if (!root) return L;
    root.querySelectorAll('[data-rpm-field]').forEach(function (el) {
      var key = el.getAttribute('data-rpm-field');
      if (!key) return;
      if (el.type === 'checkbox') L[key] = el.checked ? 1 : 0;
      else L[key] = el.value;
    });
    st.layout = L;
    return L;
  }

  function mmOpts(selected, list) {
    return (list || [10, 12, 15, 18, 20, 24, 30, 36, 40, 45, 50])
      .map(function (n) {
        return (
          '<option value="' +
          n +
          '"' +
          (Number(selected) === Number(n) ? ' selected' : '') +
          '>' +
          n +
          ' mm</option>'
        );
      })
      .join('');
  }

  function tabsHtml() {
    return (
      '<nav class="lts-tabs">' +
      [
        ['pad', 'Reporting Page'],
        ['whatsapp', 'WhatsApp'],
        ['signatures', 'Pathologist signatures'],
      ]
        .map(function (t) {
          return (
            '<button type="button" data-lts-tab="' +
            t[0] +
            '" class="' +
            (st.tab === t[0] ? 'on' : '') +
            '">' +
            esc(t[1]) +
            '</button>'
          );
        })
        .join('') +
      '</nav>'
    );
  }

  function contentBox(L) {
    L = L || {};
    var top = Number(L.header_height_mm || L.margin_top_mm || 36.9);
    var bottom = Number(L.footer_height_mm || L.margin_bottom_mm || 24.4);
    var left = Number(L.margin_left_mm || L.side_mm || 8);
    var right = Number(L.margin_right_mm || left);
    return { top: top, bottom: bottom, left: left, right: right };
  }

  function shownArt(L, kind) {
    L = L || {};
    if (kind === 'header' && Number(L.header_enabled) === 0) return '';
    if (kind === 'footer' && Number(L.footer_enabled) === 0) return '';
    return L[kind === 'header' ? 'header_image' : 'footer_image'] || '';
  }

  function artTag(src, align, alt) {
    if (!src) return '<div class="rtm-art-empty">No artwork</div>';
    var pos = align === 'left' ? 'left center' : align === 'right' ? 'right center' : 'center center';
    return (
      '<img src="' +
      esc(src) +
      '" alt="' +
      esc(alt || '') +
      '" style="object-position:' +
      pos +
      '"/>'
    );
  }

  function isLetterheadFormat(fmt) {
    fmt = fmt || st.format;
    return fmt === 'with_header' || fmt === 'non_nabl';
  }

  function artSaveFormat() {
    return st.format === 'non_nabl' ? 'non_nabl' : 'with_header';
  }

  function formatLabel(fmt, brand) {
    if (fmt === 'non_nabl') return 'Digital with Non-NABL letterhead';
    if (fmt === 'without_header') return 'Physical without letterhead';
    if (brand === 'remedium') return 'Digital with NABL letterhead';
    return 'Digital with letterhead';
  }

  function sheetHtml(L, fmt) {
    var box = contentBox(L);
    var digital = isLetterheadFormat(fmt || st.format);
    var contentH = Math.max(40, 297 - box.top - box.bottom);
    return (
      '<div class="rtm-sheet" style="' +
      '--rtm-top:' + ((box.top / 297) * 100).toFixed(3) + '%;' +
      '--rtm-bottom:' + ((box.bottom / 297) * 100).toFixed(3) + '%;' +
      '--rtm-left:' + ((box.left / 210) * 100).toFixed(3) + '%;' +
      '--rtm-right:' + ((box.right / 210) * 100).toFixed(3) + '%">' +
      '<div class="rtm-band top">' +
      (digital ? artTag(shownArt(L, 'header'), L.header_align, 'Header') : '') +
      '</div>' +
      '<div class="rtm-body">' +
      '<div class="rtm-meta"><div><b>Patient</b> Sample Patient</div><div><b>Age / Sex</b> 32 Y / M</div>' +
      '<div><b>Patient ID</b> PREV-001</div><div><b>Sample ID</b> SMP-1001</div>' +
      '<div><b>Ref. By</b> Dr. Preview</div><div><b>Report Date</b> 23 Nov 2026</div></div>' +
      '<h4>COMPLETE BLOOD COUNT (CBC)</h4>' +
      '<table><thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference</th></tr></thead><tbody>' +
      '<tr><td>Haemoglobin</td><td>13.8</td><td>g/dL</td><td>13.0 – 17.0</td></tr>' +
      '<tr><td>WBC Count</td><td>7.2</td><td>10^3/µL</td><td>4.0 – 11.0</td></tr>' +
      '<tr><td>Platelet Count</td><td>245</td><td>10^3/µL</td><td>150 – 450</td></tr>' +
      '</tbody></table>' +
      '<p class="rtm-note">Content stays in this box for digital and physical reports. Available height ' +
      contentH.toFixed(1) +
      ' mm.</p></div>' +
      '<div class="rtm-band bottom">' +
      (digital ? artTag(shownArt(L, 'footer'), L.footer_align, 'Footer') : '') +
      '</div></div>'
    );
  }

  function libraryEntries() {
    var layouts = (st.rpm && st.rpm.layouts) || {};
    return [
      ['slpl', 'with_header', 'SLPL Lab', 'Digital with letterhead'],
      ['slpl', 'non_nabl', 'SLPL Lab', 'Digital with Non-NABL letterhead'],
      ['slpl', 'without_header', 'SLPL Lab', 'Physical without letterhead'],
      ['remedium', 'with_header', 'Remedium Lab', 'Digital with NABL letterhead'],
      ['remedium', 'non_nabl', 'Remedium Lab', 'Digital with Non-NABL letterhead'],
      ['remedium', 'without_header', 'Remedium Lab', 'Physical without letterhead'],
    ].map(function (c) {
      var layout = (layouts[c[0]] && layouts[c[0]][c[1]]) || {};
      var fallbackName =
        c[1] === 'non_nabl' ? c[2] + ' Non-NABL report' : c[2] + ' report';
      return {
        brand: c[0],
        fmt: c[1],
        lab: c[2],
        formatLabel: c[3],
        layout: layout,
        name: layout.template_name || fallbackName,
      };
    });
  }

  function libraryHtml(large) {
    return (
      '<div class="rtm-library' +
      (large ? ' large' : '') +
      '"><h3>Template library</h3><p class="rtm-help">Open a template to view its page preview.</p>' +
      libraryEntries()
        .map(function (item) {
          var on = st.brand === item.brand && st.format === item.fmt;
          return (
            '<button type="button" class="rtm-lib-card' +
            (on ? ' on' : '') +
            '" data-rtm-lib="1" data-rtm-lib-brand="' +
            esc(item.brand) +
            '" data-rtm-lib-fmt="' +
            esc(item.fmt) +
            '"><div class="rtm-lib-preview">' +
            sheetHtml(item.layout, item.fmt) +
            '</div><div class="rtm-lib-copy"><b>' +
            esc(item.name) +
            '</b><small>' +
            esc(item.lab) +
            '</small><small>' +
            esc(item.formatLabel) +
            '</small><span>View preview</span></div></button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function pdfObjectUrl(data) {
    var bin = atob((data && data.content_base64) || '');
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  }

  function clearInlinePdf() {
    if (st.inlinePdf) URL.revokeObjectURL(st.inlinePdf);
    st.inlinePdf = '';
    st.printBusy = false;
  }

  function openPrintPreview() {
    st.printBusy = true;
    st.error = '';
    st.view = 'setup';
    draw();
    call('preview_report_page_pdf', {
      brand: st.brand,
      format: st.format,
      branch: st.branch,
    })
      .then(function (data) {
        if (st.inlinePdf) URL.revokeObjectURL(st.inlinePdf);
        st.inlinePdf = pdfObjectUrl(data);
        st.printBusy = false;
        draw();
      })
      .catch(function (err) {
        st.printBusy = false;
        st.error = err.message;
        draw();
      });
  }

  function numField(key, label, value) {
    return (
      '<label class="rtm-num">' +
      esc(label) +
      '<input type="number" min="0" max="80" step="0.1" data-rpm-field="' +
      key +
      '" value="' +
      esc(value) +
      '"/> mm</label>'
    );
  }

  function rpmHtml() {
    var L = st.layout || {};
    var can = !!(st.rpm && st.rpm.can_manage);
    var box = contentBox(L);
    var branches = (st.rpm && st.rpm.branches) || [];
    var brandName = st.brand === 'slpl' ? 'SLPL Lab' : 'Remedium Lab';
    var defaultName =
      st.format === 'non_nabl' ? brandName + ' Non-NABL report' : brandName + ' report';
    var branchSelect = branches.length
      ? '<select data-rpm-branch><option value="">Lab default</option>' +
        branches
          .map(function (b) {
            return (
              '<option value="' +
              esc(b.branch_code) +
              '"' +
              (st.branch === b.branch_code ? ' selected' : '') +
              '>' +
              esc(b.name || b.branch_code) +
              '</option>'
            );
          })
          .join('') +
        '</select>'
      : '<span class="rtm-branch-fixed">Lab default</span>';
    var applyBlock = !can
      ? ''
      : branches.length
        ? '<div class="rtm-apply"><label>Apply to LabTech branch' +
          branchSelect.replace('data-rpm-branch', 'data-rpm-apply-one') +
          '</label><button type="button" class="emp-btn ghost" data-rpm-apply-one>Apply to this branch</button></div>'
        : '<p class="rtm-help">This template is the lab default. LabTech branches will be assigned here when that module is added. Franchise and other-module branches are not used.</p>';
    var setup =
      '<div class="rtm-grid">' +
      '<section class="rtm-card rtm-left"><h3><span>1</span> Select Lab / Brand</h3>' +
      '<div class="rtm-labs">' +
      '<button type="button" class="rtm-lab' +
      (st.brand === 'slpl' ? ' on' : '') +
      '" data-rpm-config-brand="slpl" data-rpm-config-fmt="' +
      esc(st.format) +
      '"><b>SLPL Lab</b><small>SLPL Laboratory</small></button>' +
      '<button type="button" class="rtm-lab' +
      (st.brand === 'remedium' ? ' on' : '') +
      '" data-rpm-config-brand="remedium" data-rpm-config-fmt="' +
      esc(st.format) +
      '"><b>Remedium Lab</b><small>Transparency, Accuracy &amp; Speed</small></button></div>' +
      '<h3><span>2</span> Letterhead</h3>' +
      '<div class="rtm-art-row"><div><b>Header artwork</b><small>Original PNG or JPG. It is not redrawn.</small>' +
      (shownArt(L, 'header') ? '<div class="rtm-thumb">' + artTag(shownArt(L, 'header'), L.header_align, '') + '</div>' : '<div class="rtm-thumb empty">Not uploaded</div>') +
      (can
        ? '<div class="rtm-art-actions"><label class="emp-btn ghost">Upload<input type="file" accept="image/png,image/jpeg,image/webp" data-rpm-upload="header_image" hidden/></label>' +
          '<button type="button" class="emp-btn ghost" data-rtm-clear="header_image">Remove</button></div>'
        : '') +
      '</div><div><b>Footer artwork</b><small>Original PNG or JPG. It is not redrawn.</small>' +
      (shownArt(L, 'footer') ? '<div class="rtm-thumb">' + artTag(shownArt(L, 'footer'), L.footer_align, '') + '</div>' : '<div class="rtm-thumb empty">Not uploaded</div>') +
      (can
        ? '<div class="rtm-art-actions"><label class="emp-btn ghost">Upload<input type="file" accept="image/png,image/jpeg,image/webp" data-rpm-upload="footer_image" hidden/></label>' +
          '<button type="button" class="emp-btn ghost" data-rtm-clear="footer_image">Remove</button></div>'
        : '') +
      '</div></div>' +
      '<div class="rtm-split">' +
      numField('header_height_mm', 'Header height', box.top) +
      numField('footer_height_mm', 'Footer height', box.bottom) +
      '<label class="rtm-num">Header align<select data-rpm-field="header_align">' +
      ['left', 'center', 'right']
        .map(function (a) {
          return '<option value="' + a + '"' + ((L.header_align || 'center') === a ? ' selected' : '') + '>' + a + '</option>';
        })
        .join('') +
      '</select></label>' +
      '<label class="rtm-num">Footer align<select data-rpm-field="footer_align">' +
      ['left', 'center', 'right']
        .map(function (a) {
          return '<option value="' + a + '"' + ((L.footer_align || 'center') === a ? ' selected' : '') + '>' + a + '</option>';
        })
        .join('') +
      '</select></label></div>' +
      '<h3><span>3</span> Fixed content area</h3>' +
      '<p class="rtm-help">This box is the same for digital and physical reports. Header height is the top margin. Footer height is the bottom margin.</p>' +
      '<div class="rtm-split">' +
      numField('margin_left_mm', 'Left margin', box.left) +
      numField('margin_right_mm', 'Right margin', box.right) +
      '</div>' +
      '<h3><span>4</span> Delivery format</h3>' +
      '<div class="rtm-formats three">' +
      '<button type="button" class="rtm-format' +
      (st.format === 'with_header' ? ' on' : '') +
      '" data-rpm-fmt="with_header"><b>' +
      (st.brand === 'remedium' ? 'Digital · NABL' : 'Digital · Standard') +
      '</b><small>Header and footer on every page</small></button>' +
      '<button type="button" class="rtm-format' +
      (st.format === 'non_nabl' ? ' on' : '') +
      '" data-rpm-fmt="non_nabl"><b>Digital · Non-NABL</b><small>Non-NABL letterhead on every page</small></button>' +
      '<button type="button" class="rtm-format' +
      (st.format === 'without_header' ? ' on' : '') +
      '" data-rpm-fmt="without_header"><b>Physical report</b><small>Same content area, blank letterhead space</small></button>' +
      '</div></section>' +
      '<section class="rtm-card rtm-center"><div class="rtm-center-head"><h3>Live preview</h3>' +
      '<div class="rtm-center-tools"><div class="rtm-toggle">' +
      '<button type="button" data-rpm-fmt="with_header" class="' +
      (st.format === 'with_header' ? 'on' : '') +
      '">' +
      (st.brand === 'remedium' ? 'NABL letterhead' : 'Standard letterhead') +
      '</button>' +
      '<button type="button" data-rpm-fmt="non_nabl" class="' +
      (st.format === 'non_nabl' ? 'on' : '') +
      '">Non-NABL letterhead</button>' +
      '<button type="button" data-rpm-fmt="without_header" class="' +
      (st.format === 'without_header' ? 'on' : '') +
      '">Without letterhead</button></div>' +
      '<button type="button" class="emp-btn ghost" data-rpm-print-inline>Print preview</button></div></div>' +
      (st.printBusy
        ? '<p class="rtm-help">Preparing each page…</p>'
        : st.inlinePdf
          ? '<div class="rtm-print-frame"><iframe title="Print preview" src="' +
            esc(st.inlinePdf) +
            '#toolbar=1&navpanes=0"></iframe><button type="button" class="emp-btn ghost" data-rpm-print-close>Back to live preview</button><p class="rtm-page">Scroll inside the preview to see every page. The content box stays the same on each page.</p></div>'
          : '<div data-rtm-sheet>' +
            sheetHtml(L) +
            '</div><p class="rtm-page">A4 · 210 × 297 mm · content height ' +
            Math.max(40, 297 - box.top - box.bottom).toFixed(1) +
            ' mm</p>') +
      '</section>' +
      '<section class="rtm-card rtm-right"><h3>Template</h3>' +
      '<label class="rtm-num">Template name<input type="text" data-rpm-field="template_name" value="' +
      esc(L.template_name || defaultName) +
      '"/></label>' +
      '<p class="rtm-help">Lab: <b>' +
      esc(brandName) +
      '</b><br/>Format: <b>' +
      esc(formatLabel(st.format, st.brand)) +
      '</b><br/>Branch: <b>' +
      esc(st.branch || 'Lab default') +
      '</b></p>' +
      '<p class="rtm-help">Page: A4 portrait<br/>Top ' +
      box.top +
      ' mm · bottom ' +
      box.bottom +
      ' mm · left ' +
      box.left +
      ' mm · right ' +
      box.right +
      ' mm</p>' +
      '<div class="rtm-actions">' +
      '<button type="button" class="emp-btn ghost" data-rpm-pdf>Preview PDF</button>' +
      '<button type="button" class="emp-btn ghost" data-rpm-pdf>Test print</button>' +
      (can ? '<button type="button" class="emp-btn ghost" data-rpm-reset>Reset</button>' : '') +
      (can ? '<button type="button" class="emp-btn primary" data-rpm-save>Save template</button>' : '') +
      '</div>' +
      applyBlock +
      libraryHtml(false) +
      '</section></div>';
    return (
      '<div class="rtm" data-rpm-root="1">' +
      '<div class="rtm-head"><div><h2>Report Template Management</h2>' +
      '<p>Upload letterhead artwork, set one fixed content area, then choose digital or physical delivery.</p></div>' +
      '<label class="rtm-num">Branch ' +
      branchSelect +
      '</label></div>' +
      (st.notice ? '<div class="people-alert ok">' + esc(st.notice) + '</div>' : '') +
      (st.error ? '<div class="people-alert err">' + esc(st.error) + '</div>' : '') +
      setup +
      '</div>'
    );
  }

  function waHtml(d) {
    var w = (d && d.whatsapp) || {};
    return (
      '<form data-lts-wa class="lts-card">' +
      '<h2>WhatsApp report delivery</h2>' +
      '<div class="lts-status ' +
      (w.ready ? 'ok' : 'warn') +
      '"><b>' +
      (w.ready ? 'Connected' : 'Not ready') +
      '</b><span>' +
      esc(w.hint || '') +
      '</span></div>' +
      '<label class="lts-check"><input type="checkbox" name="report_enabled" ' +
      (Number(w.report_enabled) ? 'checked' : '') +
      ' ' +
      (d.can_manage ? '' : 'disabled') +
      '/> Show WhatsApp share on authorised reports</label>' +
      '<label>Message template<textarea name="report_message" rows="4" ' +
      (d.can_manage ? '' : 'disabled') +
      '>' +
      esc(w.report_message || '') +
      '</textarea></label>' +
      (d.can_manage ? '<button type="submit" class="emp-btn primary">Save WhatsApp settings</button>' : '') +
      '</form>'
    );
  }

  function sigHtml(d) {
    var depts = (d && d.department_defaults) || [];
    var boxes =
      '<div class="lts-depts">' +
      depts
        .map(function (p) {
          return (
            '<article class="lts-dept" data-lts-dept-card="' +
            esc(p.key) +
            '"><header><b>' +
            esc(p.role || p.label) +
            '</b><small>' +
            esc((p.label || '').toUpperCase()) +
            '</small></header>' +
            '<div class="lts-sig-preview report-box">' +
            (p.signature_url
              ? '<img src="' + esc(p.signature_url) + '" alt="Signature"/>'
              : '<span>No signature</span>') +
            '<div class="lts-sig-line"></div></div>' +
            (d.can_manage
              ? '<label class="lts-num">Signatory name<input type="text" data-lts-dept-name="' +
                esc(p.key) +
                '" value="' +
                esc(p.name || '') +
                '"/></label>' +
                '<label class="lts-num">Qualification<textarea rows="2" data-lts-dept-qual="' +
                esc(p.key) +
                '">' +
                esc(p.qualification || '') +
                '</textarea></label>' +
                '<div class="lts-sig-actions">' +
                '<label class="lts-file">Upload<input type="file" accept="image/png,image/jpeg,image/webp" data-lts-dept="' +
                esc(p.key) +
                '"/></label>' +
                (p.signature_url
                  ? '<button type="button" class="emp-btn ghost" data-lts-dept-clear="' +
                    esc(p.key) +
                    '">Remove</button>'
                  : '') +
                '<button type="button" class="emp-btn ghost" data-lts-dept-save="' +
                esc(p.key) +
                '">Save details</button></div>'
              : p.name
                ? '<p class="muted">' + esc(p.name) + (p.qualification ? ' · ' + esc(p.qualification) : '') + '</p>'
                : '') +
            '</article>'
          );
        })
        .join('') +
      '</div>';
    return (
      '<section class="lts-card"><h2>Pathologist signatures</h2>' +
      '<p class="muted">Choose a PNG, JPG or WEBP. It is saved immediately and shown in the box above the blue line.</p>' +
      (st.notice ? '<div class="people-alert ok">' + esc(st.notice) + '</div>' : '') +
      (st.error ? '<div class="people-alert err">' + esc(st.error) + '</div>' : '') +
      (depts.length ? boxes : '<p class="muted">Signature boxes are not available yet.</p>') +
      '</section>'
    );
  }

  function draw() {
    var panel = panelEl();
    if (!panel || !st.data) return;
    var body =
      st.tab === 'whatsapp' ? waHtml(st.data) : st.tab === 'signatures' ? sigHtml(st.data) : rpmHtml();
    withQuiet(function () {
      panel.innerHTML =
        '<div class="lts-wrap">' +
        '<header class="lts-head"><div><h1>Lab settings</h1>' +
        '<p>Reporting page layouts, WhatsApp, and pathologist signatures.</p></div>' +
        (st.data.can_manage || (st.rpm && st.rpm.can_manage)
          ? ''
          : '<span class="lts-badge">View only</span>') +
        '</header>' +
        tabsHtml() +
        body +
        '</div>';
    });
  }

  function switchBrandFormat(brand, fmt) {
    var root = document.querySelector('[data-rpm-root]');
    if (root) collectLayoutFromForm(root);
    st.brand = brand || st.brand;
    st.format = fmt || st.format;
    st.editBand = null;
    clearInlinePdf();
    st.notice = '';
    st.error = '';
    reloadRpm().catch(function (err) {
      st.error = err.message;
      draw();
    });
  }

  document.addEventListener('click', function (e) {
    var tab = e.target.closest && e.target.closest('[data-lts-tab]');
    if (tab) {
      st.tab = tab.getAttribute('data-lts-tab');
      draw();
      return;
    }
    if (!st.open || !e.target.closest) return;

    var deptClear = e.target.closest('[data-lts-dept-clear]');
    if (deptClear) {
      var clearKey = deptClear.getAttribute('data-lts-dept-clear');
      var clearCard = deptClear.closest('[data-lts-dept-card]');
      call('save_department_signature_default', {
        department_key: clearKey,
        name: clearCard && clearCard.querySelector('[data-lts-dept-name]')
          ? clearCard.querySelector('[data-lts-dept-name]').value
          : '',
        qualification: clearCard && clearCard.querySelector('[data-lts-dept-qual]')
          ? clearCard.querySelector('[data-lts-dept-qual]').value
          : '',
        clear_image: 1,
      })
        .then(function (data) {
          st.data = data;
          draw();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var deptSave = e.target.closest('[data-lts-dept-save]');
    if (deptSave) {
      var saveKey = deptSave.getAttribute('data-lts-dept-save');
      var saveCard = deptSave.closest('[data-lts-dept-card]');
      call('save_department_signature_default', {
        department_key: saveKey,
        name: saveCard && saveCard.querySelector('[data-lts-dept-name]')
          ? saveCard.querySelector('[data-lts-dept-name]').value
          : '',
        qualification: saveCard && saveCard.querySelector('[data-lts-dept-qual]')
          ? saveCard.querySelector('[data-lts-dept-qual]').value
          : '',
      })
        .then(function (data) {
          st.data = data;
          draw();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }

    var clearArt = e.target.closest('[data-rtm-clear]');
    if (clearArt) {
      var field = clearArt.getAttribute('data-rtm-clear');
      var keepFmt = st.format;
      var rootClear = document.querySelector('[data-rpm-root]');
      var layoutClear = collectLayoutFromForm(rootClear);
      layoutClear[field] = '';
      if (field === 'header_image') layoutClear.header_enabled = 0;
      if (field === 'footer_image') layoutClear.footer_enabled = 0;
      st.layout = Object.assign({}, st.layout, layoutClear);
      st.notice = 'Removing artwork…';
      draw();
      layoutClear.margin_top_mm = layoutClear.header_height_mm;
      layoutClear.margin_bottom_mm = layoutClear.footer_height_mm;
      call('save_report_page_layout', {
        brand: st.brand,
        format: artSaveFormat(),
        branch: st.branch,
        as_branch_override: st.branch ? 1 : 0,
        layout: JSON.stringify(layoutClear),
      })
        .then(function () {
          st.format = keepFmt;
          st.notice = 'Artwork removed. The content area is unchanged.';
          return reloadRpm();
        })
        .catch(function (err) {
          st.error = err.message;
          draw();
        });
      return;
    }
    var applyOne = e.target.closest('button[data-rpm-apply-one]');
    if (applyOne) {
      var oneSel = document.querySelector('select[data-rpm-apply-one]');
      var oneCode = oneSel ? oneSel.value : '';
      if (!oneCode) {
        st.error = 'Choose a branch first';
        draw();
        return;
      }
      call('apply_report_page_layout_to_branches', {
        brand: st.brand,
        format: st.format,
        branches: JSON.stringify([oneCode]),
      })
        .then(function () {
          st.notice = 'Applied to ' + oneCode;
          draw();
        })
        .catch(function (err) {
          st.error = err.message;
          draw();
        });
      return;
    }
    var libCard = e.target.closest('[data-rtm-lib]');
    if (libCard) {
      st.view = 'setup';
      switchBrandFormat(libCard.getAttribute('data-rtm-lib-brand'), libCard.getAttribute('data-rtm-lib-fmt'));
      return;
    }
    var cfgCard = e.target.closest('[data-rpm-config-brand]');
    if (cfgCard) {
      switchBrandFormat(
        cfgCard.getAttribute('data-rpm-config-brand'),
        cfgCard.getAttribute('data-rpm-config-fmt') || st.format
      );
      return;
    }

    if (e.target.closest('[data-rpm-close-edit]')) {
      st.editBand = null;
      draw();
      return;
    }
    var edit = e.target.closest('[data-rpm-edit]');
    if (edit) {
      return;
    }
    var fmtBtn = e.target.closest('[data-rpm-fmt]');
    if (fmtBtn && fmtBtn.tagName === 'BUTTON') {
      switchBrandFormat(st.brand, fmtBtn.getAttribute('data-rpm-fmt'));
      return;
    }
    if (e.target.closest('[data-rpm-save]')) {
      if (st.busy) return;
      var root = document.querySelector('[data-rpm-root]');
      var keepFmt = st.format;
      var layout = collectLayoutFromForm(root);
      layout.margin_top_mm = layout.header_height_mm || layout.margin_top_mm;
      layout.margin_bottom_mm = layout.footer_height_mm || layout.margin_bottom_mm;
      layout.header_height_mm = layout.margin_top_mm;
      layout.footer_height_mm = layout.margin_bottom_mm;
      layout.side_mm = layout.margin_left_mm;
      if (!layout.margin_right_mm) layout.margin_right_mm = layout.margin_left_mm;
      // Always persist the in-memory artwork URLs (there is no hidden input for them).
      if (st.layout && st.layout.header_image) layout.header_image = st.layout.header_image;
      if (st.layout && st.layout.footer_image) layout.footer_image = st.layout.footer_image;
      if (layout.header_image) layout.header_enabled = 1;
      if (layout.footer_image) layout.footer_enabled = 1;
      st.busy = true;
      st.notice = 'Saving template…';
      st.error = '';
      draw();
      call('save_report_page_layout', {
        brand: st.brand,
        format: st.format,
        branch: st.branch,
        as_branch_override: st.branch ? 1 : 0,
        layout: JSON.stringify(layout),
      })
        .then(function (rpm) {
          applyRpm(rpm, true);
          st.format = keepFmt;
          var saved = (rpm && rpm.layout) || {};
          var hdrOk = !layout.header_image || String(saved.header_image || '').split('?')[0] === String(layout.header_image).split('?')[0];
          var ftrOk = !layout.footer_image || String(saved.footer_image || '').split('?')[0] === String(layout.footer_image).split('?')[0];
          if (!hdrOk || !ftrOk) {
            st.error = 'Save reported success but header/footer did not stick. Try Upload again.';
          } else {
            st.notice = 'Template saved — header and footer kept.';
          }
          return reloadRpm();
        })
        .catch(function (err) {
          st.error = err.message;
          draw();
        })
        .finally(function () {
          st.busy = false;
        });
      return;
    }
    if (e.target.closest('[data-rpm-reset]')) {
      if (!window.confirm('Reset this brand/format layout to defaults?')) return;
      call('reset_report_page_layout', {
        brand: st.brand,
        format: st.format,
        branch: st.branch,
      })
        .then(function (rpm) {
          applyRpm(rpm);
          st.notice = 'Reset to defaults';
          draw();
        })
        .catch(function (err) {
          st.error = err.message;
          draw();
        });
      return;
    }
    if (e.target.closest('[data-rpm-print-close]')) {
      clearInlinePdf();
      draw();
      return;
    }
    if (e.target.closest('[data-rpm-print-inline]') || e.target.closest('[data-rpm-pdf]')) {
      openPrintPreview();
      return;
    }
    if (e.target.closest('[data-rpm-apply]')) {
      var sel = document.querySelector('[data-rpm-apply-branch]');
      var picked = sel
        ? Array.prototype.slice.call(sel.selectedOptions).map(function (o) {
            return o.value;
          })
        : [];
      if (!picked.length) {
        alert('Select one or more branches in the list next to Apply to Branch.');
        return;
      }
      var root2 = document.querySelector('[data-rpm-root]');
      var layout2 = collectLayoutFromForm(root2);
      call('save_report_page_layout', {
        brand: st.brand,
        format: st.format,
        layout: JSON.stringify(layout2),
      })
        .then(function () {
          return call('apply_report_page_layout_to_branches', {
            brand: st.brand,
            format: st.format,
            branches: JSON.stringify(picked),
          });
        })
        .then(function (rpm) {
          applyRpm(rpm);
          st.notice = 'Applied to ' + picked.length + ' branch(es)';
          draw();
        })
        .catch(function (err) {
          st.error = err.message;
          draw();
        });
      return;
    }

    var a = e.target.closest('.layout-labtech aside a[href], .layout-labtech .lt-topbar-tools a[href]');
    if (a && linkPath(a) !== PATH && !a.hasAttribute('data-lts-link')) close();
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || !st.open) return;
    if (el.hasAttribute('data-rpm-brand')) {
      switchBrandFormat(el.getAttribute('data-rpm-brand'), st.format);
      return;
    }
    if (el.hasAttribute('data-rpm-fmt') && el.type === 'radio') {
      switchBrandFormat(st.brand, el.getAttribute('data-rpm-fmt'));
      return;
    }
    if (el.hasAttribute('data-rpm-branch')) {
      st.branch = el.value || '';
      reloadRpm().catch(function (err) {
        st.error = err.message;
        draw();
      });
      return;
    }
    if (el.hasAttribute('data-rpm-field')) {
      var keyName = el.getAttribute('data-rpm-field');
      var root = document.querySelector('[data-rpm-root]');
      if (keyName === 'header_height_mm') {
        var topIn = root && root.querySelector('[data-rpm-field="margin_top_mm"]');
        if (topIn) topIn.value = el.value;
      }
      if (keyName === 'footer_height_mm') {
        var botIn = root && root.querySelector('[data-rpm-field="margin_bottom_mm"]');
        if (botIn) botIn.value = el.value;
      }
      if (keyName === 'margin_top_mm') {
        var headIn = root && root.querySelector('[data-rpm-field="header_height_mm"]');
        if (headIn) headIn.value = el.value;
      }
      if (keyName === 'margin_bottom_mm') {
        var footIn = root && root.querySelector('[data-rpm-field="footer_height_mm"]');
        if (footIn) footIn.value = el.value;
      }
      collectLayoutFromForm(root);
      var sheet = document.querySelector('[data-rtm-sheet]');
      if (sheet) {
        withQuiet(function () {
          sheet.innerHTML = sheetHtml(st.layout || {});
        });
      }
      return;
    }
    if (el.hasAttribute('data-rpm-upload') && el.files && el.files[0]) {
      if (st.busy) {
        alert('Please wait — a save is already in progress.');
        el.value = '';
        return;
      }
      var field = el.getAttribute('data-rpm-upload');
      var keepFmt = st.format;
      var keepBrand = st.brand;
      var root3 = document.querySelector('[data-rpm-root]');
      var layout3 = collectLayoutFromForm(root3);
      layout3.margin_top_mm = layout3.header_height_mm || layout3.margin_top_mm;
      layout3.margin_bottom_mm = layout3.footer_height_mm || layout3.margin_bottom_mm;
      layout3.header_height_mm = layout3.margin_top_mm;
      layout3.footer_height_mm = layout3.margin_bottom_mm;
      if (st.layout && st.layout.header_image) layout3.header_image = st.layout.header_image;
      if (st.layout && st.layout.footer_image) layout3.footer_image = st.layout.footer_image;
      var picked = el.files[0];
      var previousUrl = String((st.layout && st.layout[field]) || '').split('?')[0];
      var saveFmt = artSaveFormat();
      st.busy = true;
      st.notice = 'Uploading ' + (field === 'footer_image' ? 'footer' : 'header') + '…';
      st.error = '';
      draw();
      call(
        'save_report_page_layout',
        {
          brand: st.brand,
          format: saveFmt,
          branch: st.branch,
          as_branch_override: st.branch ? 1 : 0,
          layout: JSON.stringify(layout3),
          image_field: field,
          file_name: picked.name,
        },
        picked
      )
        .then(function (rpm) {
          st.brand = keepBrand;
          st.format = keepFmt;
          applyRpm(rpm, true);
          st.brand = keepBrand;
          st.format = keepFmt;
          var savedUrl = String((rpm && rpm.layout && rpm.layout[field]) || '').split('?')[0];
          if (!savedUrl) {
            throw new Error('Upload did not return a saved image URL');
          }
          if (savedUrl === previousUrl) {
            throw new Error(
              'Upload did not change the stored image. Try a different PNG/JPG (max 8 MB).'
            );
          }
          if (!st.layout) st.layout = {};
          st.layout[field] = savedUrl;
          st.notice = 'Artwork saved for ' + keepBrand + ' · ' + saveFmt.replace(/_/g, ' ') + '.';
          return reloadRpm();
        })
        .catch(function (err) {
          st.error = err.message || 'Upload failed';
          alert(st.error);
          draw();
        })
        .finally(function () {
          st.busy = false;
          try {
            el.value = '';
          } catch (e) {}
        });
      return;
    }
    if (el.hasAttribute('data-lts-dept') && el.files && el.files[0]) {
      var deptKey = el.getAttribute('data-lts-dept');
      var card = el.closest('[data-lts-dept-card]');
      var nameIn = card && card.querySelector('[data-lts-dept-name]');
      var qualIn = card && card.querySelector('[data-lts-dept-qual]');
      var picked = el.files[0];
      st.notice = 'Saving signature…';
      call(
        'save_department_signature_default',
        {
          department_key: deptKey,
          name: nameIn ? nameIn.value : '',
          qualification: qualIn ? qualIn.value : '',
          file_name: picked.name,
        },
        picked
      )
        .then(function (data) {
          st.data = data;
          if (data.report_page) applyRpm(data.report_page);
          var saved = ((data && data.department_defaults) || []).filter(function (p) {
            return p.key === deptKey;
          })[0];
          if (!saved || !saved.signature_url) {
            throw new Error('The signature was not stored. Use a PNG, JPG or WEBP under 2 MB.');
          }
          st.notice = 'Signature saved.';
          st.error = '';
          draw();
        })
        .catch(function (err) {
          st.error = err.message || 'Could not save signature';
          alert(st.error);
          draw();
        });
      return;
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.closest || !form.closest('[data-lts-panel]')) return;
    if (form.matches('[data-lts-wa]')) {
      e.preventDefault();
      var enabled = form.querySelector('[name=report_enabled]');
      call('save_labtech_whatsapp', {
        report_enabled: enabled && enabled.checked ? 1 : 0,
        report_message: (form.querySelector('[name=report_message]') || {}).value || '',
      })
        .then(function (data) {
          st.data = data;
          draw();
        })
        .catch(function (err) {
          alert(err.message);
        });
    }
  });

  function tick() {
    if (st.quiet) return;
    if (!labLayout()) {
      // React remounts briefly on hard refresh — stay on Settings until layout returns.
      if (st.open && location.pathname !== PATH) close();
      return;
    }
    addLink();
    if (location.pathname === PATH) {
      if (!panelEl()) open(true);
      else if (!st.open) open(false);
    } else if (st.open) {
      close();
    }
    var main = mainArea();
    if (st.open && main && !main.classList.contains('lts-hidden')) {
      withQuiet(function () {
        main.classList.add('lts-hidden');
      });
    }
  }

  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/labtech-settings.css?v=23';
  document.head.appendChild(css);

  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', function () {
    if (navigating) return;
    if (location.pathname === PATH) bootSettings();
    else if (st.open) close();
  });
  // Hard refresh on /dashboard/settings must reopen this UI, not leave React settings alone.
  bootSettings();
  tick();
})();
