/* LabTech Report Page Editor — WYSIWYG A4 designer (mockup) */
(function () {
  if (window.__labtechReportEditor) return;
  window.__labtechReportEditor = true;
  if ((location.hostname || '').toLowerCase() !== 'labtech.e-remedium.in') return;

  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.api.';
  var A4 = { portrait: { w: 794, h: 1123 }, landscape: { w: 1123, h: 794 } };
  var MM = 794 / 210;
  var HEADER_MM = 36.9;
  var FOOTER_MM = 24.4;

  var DYNAMIC_FIELDS = [
    { id: 'patient_block', label: 'Patient Details', hint: 'Name, age, gender, ID', kind: 'block' },
    { id: 'sample_block', label: 'Sample Details', hint: 'Sample ID, collected, received', kind: 'block' },
    { id: 'result_table', label: 'Test Result Table', hint: 'CBC / panel results', kind: 'table' },
    { id: 'report_details', label: 'Report Details', hint: 'Report date, ref. doctor', kind: 'block' },
    { id: 'lab_info', label: 'Lab Information', hint: 'Lab name, address, phone', kind: 'block' },
    { id: 'doctor_sign', label: 'Doctor / Signature', hint: 'Pathologist sign-off', kind: 'block' },
    { id: 'custom_field', label: 'Custom Field', hint: '{{custom_key}} placeholder', kind: 'text' },
  ];

  var st = {
    open: false,
    fabricReady: false,
    canvas: null,
    brand: 'remedium',
    format: 'with_header',
    orientation: 'portrait',
    branch: '',
    branches: [],
    tool: 'select',
    zoom: 0.78,
    history: [],
    histIdx: -1,
    quiet: false,
    canManage: true,
    layout: {},
    templates: [],
    templateId: '',
    templateName: '',
    status: '',
    statusTone: '',
    selected: null,
    selectedBand: null,
    rightTab: 'props',
    showGrid: false,
    showRulers: true,
    showGuides: true,
    showMargins: true,
    pages: [{ id: 'p1', name: 'Page 1', canvas_json: null }],
    pageIdx: 0,
    panMode: false,
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
  function call(method, extra) {
    var body = new URLSearchParams(extra || {});
    var s = sid();
    if (s) body.set('sid', s);
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
        return r.json().then(function (json) {
          return { ok: r.ok, json: json };
        });
      })
      .then(function (pack) {
        var json = pack.json || {};
        var m = json.message && typeof json.message === 'object' ? json.message : null;
        if (m && m.status === 'error') throw new Error(String(m.message || 'Request failed').replace(/<[^>]+>/g, ''));
        if (m && m.status === 'success') return m.data !== undefined ? m.data : m;
        throw new Error(String((m && m.message) || json.message || 'Request failed').replace(/<[^>]+>/g, ''));
      });
  }

  function pageSize() {
    return A4[st.orientation] || A4.portrait;
  }
  function headerMm() {
    return HEADER_MM;
  }
  function footerMm() {
    return FOOTER_MM;
  }
  function headerPx() {
    return Math.round(headerMm() * MM);
  }
  function footerPx() {
    return Math.round(footerMm() * MM);
  }
  function marginBox() {
    var side = Math.round(8 * MM);
    return {
      top: headerPx(),
      bottom: footerPx(),
      left: side,
      right: side,
    };
  }

  function setStatus(msg, tone) {
    st.status = msg || '';
    st.statusTone = tone || '';
    var el = document.querySelector('[data-rpe-status]');
    if (el) {
      el.className = 'rpe-status' + (tone ? ' ' + tone : '');
      el.textContent = msg || '';
    }
  }

  function loadFabric(cb) {
    if (window.fabric) {
      st.fabricReady = true;
      cb();
      return;
    }
    var urls = ['/fabric.min.js', '/vendor/fabric.min.js'];
    var i = 0;
    function next() {
      if (i >= urls.length) {
        setStatus('Could not load editor engine (Fabric.js)', 'err');
        return;
      }
      var s = document.createElement('script');
      s.src = urls[i++];
      s.onload = function () {
        st.fabricReady = true;
        cb();
      };
      s.onerror = next;
      document.head.appendChild(s);
    }
    next();
  }

  function ensureCss() {
    if (document.querySelector('link[data-rpe-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/labtech-report-editor.css?v=13';
    var font = document.querySelector('link[data-rpe-font]');
    if (!font) {
      font = document.createElement('link');
      font.rel = 'stylesheet';
      font.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap';
      font.setAttribute('data-rpe-font', '1');
      document.head.appendChild(font);
    }
    link.setAttribute('data-rpe-css', '1');
    document.head.appendChild(link);
  }

  function shellHtml() {
    return (
      '<div class="rpe-root" data-rpe-root>' +
      '<header class="rpe-top">' +
      '<div class="rpe-top-brand"><h1>Report Page Editor</h1>' +
      '<p>Design, customize and manage lab report templates with a visual editor.</p></div>' +
      '<div class="rpe-top-controls">' +
      '<label>Template <input data-rpe-tpl-name placeholder="Template name"/></label>' +
      '<label>Lab / Brand <select data-rpe-brand>' +
      '<option value="slpl">SLPL Lab</option><option value="remedium">Remedium Lab</option></select></label>' +
      '<label>Branch <select data-rpe-branch><option value="">Lab default</option></select></label>' +
      '<label>Report Format <select data-rpe-fmt>' +
      '<option value="with_header">With Header &amp; Footer</option>' +
      '<option value="without_header">Without Header &amp; Footer</option></select></label>' +
      '<label>Page Size <select data-rpe-orient>' +
      '<option value="portrait">A4 Portrait</option><option value="landscape">A4 Landscape</option></select></label>' +
      '<button type="button" class="rpe-btn ghost" data-rpe-close>Close</button>' +
      '<button type="button" class="rpe-btn primary" data-rpe-act="save">Save Template</button>' +
      '</div></header>' +
      '<div class="rpe-toolbar" data-rpe-toolbar></div>' +
      '<div class="rpe-main">' +
      '<aside class="rpe-left" data-rpe-left></aside>' +
      '<section class="rpe-center"><div class="rpe-stage-wrap"><div class="rpe-stage" data-rpe-stage>' +
      '<div class="rpe-ruler-x" data-rpe-ruler-x hidden></div>' +
      '<div class="rpe-ruler-y" data-rpe-ruler-y hidden></div>' +
      '<canvas id="rpe-canvas"></canvas>' +
      '<div class="rpe-guide header" data-rpe-guide-header hidden><span>Header</span></div>' +
      '<div class="rpe-guide footer" data-rpe-guide-footer hidden><span>Footer</span></div>' +
      '<div class="rpe-margins-box" data-rpe-margins hidden></div>' +
      '</div></div></section>' +
      '<aside class="rpe-right" data-rpe-right></aside></div>' +
      '<footer class="rpe-bottom">' +
      '<div class="rpe-pages" data-rpe-pages></div>' +
      '<div class="rpe-status" data-rpe-status></div>' +
      '<div class="rpe-actions">' +
      '<label class="rpe-toggles"><input type="checkbox" data-rpe-toggle="grid"/> Show Grid</label>' +
      '<label class="rpe-toggles"><input type="checkbox" data-rpe-toggle="margins" checked/> Show Margins</label>' +
      '<button type="button" class="rpe-btn ghost" data-rpe-act="pdf">Preview (PDF)</button>' +
      '<button type="button" class="rpe-btn primary" data-rpe-act="save">Save Template</button>' +
      '<button type="button" class="rpe-btn accent" data-rpe-act="apply">Save &amp; Apply</button>' +
      '</div></footer>' +
      '<input type="file" accept="image/*" class="rpe-hidden-file" data-rpe-file />' +
      '</div>'
    );
  }

  function toolbarHtml() {
    return (
      '<div class="rpe-tools">' +
      [
        ['undo', '↶'],
        ['redo', '↷'],
        ['select', 'Select'],
        ['hand', 'Hand'],
        ['delete', 'Delete'],
        ['dup', 'Duplicate'],
      ]
        .map(function (t) {
          return (
            '<button type="button" data-rpe-tool="' +
            t[0] +
            '" class="' +
            (st.tool === t[0] || (t[0] === 'hand' && st.panMode) ? 'on' : '') +
            '">' +
            t[1] +
            '</button>'
          );
        })
        .join('') +
      '</div><div class="rpe-zoom">' +
      '<button type="button" data-rpe-zoom="-">−</button>' +
      '<span data-rpe-zoom-label>' +
      Math.round(st.zoom * 100) +
      '%</span>' +
      '<button type="button" data-rpe-zoom="+">+</button>' +
      '<button type="button" data-rpe-zoom="fit">Fit</button>' +
      '<span data-rpe-pagesize>' +
      (st.orientation === 'landscape' ? '297 × 210 mm' : '210 × 297 mm') +
      '</span></div>' +
      '<div class="rpe-toggles">' +
      '<label><input type="checkbox" data-rpe-toggle="rulers" ' +
      (st.showRulers ? 'checked' : '') +
      '/> Ruler</label>' +
      '<label><input type="checkbox" data-rpe-toggle="guides" ' +
      (st.showGuides ? 'checked' : '') +
      '/> Guides</label>' +
      '<span style="margin-left:8px;font-size:12px;color:#64748b">Page ' +
      (st.pageIdx + 1) +
      ' of ' +
      st.pages.length +
      '</span></div>'
    );
  }

  function leftHtml() {
    return (
      '<div class="rpe-block"><h3>Add Content</h3><div class="rpe-tool-grid">' +
      [
        ['text', 'Text'],
        ['image', 'Image'],
        ['logo', 'Logo'],
        ['table', 'Table'],
        ['rect', 'Shape'],
        ['line', 'Line'],
        ['barcode', 'Barcode'],
        ['qr', 'QR Code'],
        ['icon', 'Icon'],
      ]
        .map(function (t) {
          return (
            '<button type="button" data-rpe-add="' +
            t[0] +
            '"><span class="ico"></span>' +
            t[1] +
            '</button>'
          );
        })
        .join('') +
      '</div></div>' +
      '<div class="rpe-block"><h3>Form Fields (Dynamic)</h3><div class="rpe-field-list">' +
      DYNAMIC_FIELDS.map(function (f) {
        return (
          '<button type="button" data-rpe-dyn="' +
          esc(f.id) +
          '">' +
          esc(f.label) +
          '<small>' +
          esc(f.hint) +
          '</small></button>'
        );
      }).join('') +
      '</div></div>' +
      '<div class="rpe-block"><h3>Design Tools</h3><div class="rpe-field-list">' +
      [
        ['bg', 'Background'],
        ['border', 'Page Border'],
        ['watermark', 'Watermark'],
        ['header_band', 'Header Area'],
        ['footer_band', 'Footer Area'],
      ]
        .map(function (t) {
          return '<button type="button" data-rpe-design="' + t[0] + '">' + t[1] + '</button>';
        })
        .join('') +
      '</div></div>' +
      '<div class="rpe-block"><h3>Content area</h3><p class="rpe-status">The results stay in the same box on both formats. Top ' +
      HEADER_MM +
      ' mm and bottom ' +
      FOOTER_MM +
      ' mm are reserved. With Header prints this lab’s artwork there. Without Header leaves that space blank for pre-printed paper.</p></div>'
    );
  }

  function bandPropsHtml(kind) {
    var label = kind === 'footer' ? 'Footer' : 'Header';
    var mm = kind === 'footer' ? FOOTER_MM : HEADER_MM;
    return (
      '<div class="rpe-props"><div class="rpe-label">Selected: ' +
      label +
      ' band</div>' +
      '<p class="rpe-status">' +
      label +
      ' outline stays ' +
      mm +
      ' mm and the file fills it. Replace stores this lab’s original picture. The PDF uses that file, so it stays as sharp as the upload.</p>' +
      '<div class="rpe-style-row">' +
      '<button type="button" data-rpe-band-act="fit" data-kind="' +
      kind +
      '">Fit to outline</button>' +
      '<button type="button" data-rpe-band-act="replace" data-kind="' +
      kind +
      '">Replace artwork</button>' +
      '<button type="button" data-rpe-band-act="delete" data-kind="' +
      kind +
      '">Delete artwork</button></div></div>'
    );
  }

  function propsHtml(obj) {
    if (st.selectedBand && !obj) return bandPropsHtml(st.selectedBand);
    if (!obj) {
      var bandTools =
        '<p class="rpe-status">Header outline is ' +
        HEADER_MM +
        ' mm and footer outline is ' +
        FOOTER_MM +
        ' mm on both page designs. With Header, upload this lab’s PNG. Save stores the original file.</p>' +
        '<div class="rpe-style-row">' +
        '<button type="button" data-rpe-band-act="select" data-kind="header">Select header</button>' +
        '<button type="button" data-rpe-band-act="replace" data-kind="header">Replace header</button>' +
        '<button type="button" data-rpe-band-act="delete" data-kind="header">Delete header</button></div>' +
        '<div class="rpe-style-row">' +
        '<button type="button" data-rpe-band-act="select" data-kind="footer">Select footer</button>' +
        '<button type="button" data-rpe-band-act="replace" data-kind="footer">Replace footer</button>' +
        '<button type="button" data-rpe-band-act="delete" data-kind="footer">Delete footer</button></div>';
      return (
        '<div class="rpe-props"><p class="rpe-status">Select an element, or add content from the left panel.</p>' +
        bandTools +
        '<button type="button" class="rpe-btn" data-rpe-seed>Insert starter letterhead</button></div>'
      );
    }
    var type = obj.type || '';
    var html = '<div class="rpe-props"><div class="rpe-label">Selected: ' + esc(obj.rpeRole || type) + '</div>';
    if (type === 'i-text' || type === 'textbox' || type === 'text') {
      html +=
        '<label class="rpe-field">Text<textarea data-rpe-obj="text" rows="3">' +
        esc(obj.text || '') +
        '</textarea></label>' +
        '<div class="rpe-row"><label class="rpe-field">Font<select data-rpe-obj="fontFamily">' +
        ['Poppins', 'Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana']
          .map(function (f) {
            return (
              '<option' +
              ((obj.fontFamily || 'Arial') === f ? ' selected' : '') +
              '>' +
              f +
              '</option>'
            );
          })
          .join('') +
        '</select></label>' +
        '<label class="rpe-field">Size<input type="number" data-rpe-obj="fontSize" value="' +
        esc(obj.fontSize || 16) +
        '"/></label></div>' +
        '<div class="rpe-style-row">' +
        '<button type="button" data-rpe-style="bold" class="' +
        (obj.fontWeight === 'bold' ? 'on' : '') +
        '">B</button>' +
        '<button type="button" data-rpe-style="italic" class="' +
        (obj.fontStyle === 'italic' ? 'on' : '') +
        '"><i>I</i></button>' +
        '<button type="button" data-rpe-style="underline" class="' +
        (obj.underline ? 'on' : '') +
        '"><u>U</u></button>' +
        '<label class="rpe-field" style="min-width:70px">Color<input type="color" data-rpe-obj="fill" value="' +
        esc(obj.fill || '#111111') +
        '"/></label></div>' +
        '<div class="rpe-style-row">' +
        [
          ['left', 'Left'],
          ['center', 'Center'],
          ['right', 'Right'],
          ['justify', 'Justify'],
        ]
          .map(function (a) {
            return (
              '<button type="button" data-rpe-align="' +
              a[0] +
              '" class="' +
              ((obj.textAlign || 'left') === a[0] ? 'on' : '') +
              '">' +
              a[1] +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        '<div class="rpe-row"><label class="rpe-field">Line height<input type="number" step="0.1" data-rpe-obj="lineHeight" value="' +
        esc(obj.lineHeight || 1.2) +
        '"/></label>' +
        '<label class="rpe-field">Letter spacing<input type="number" data-rpe-obj="charSpacing" value="' +
        esc(obj.charSpacing || 0) +
        '"/></label></div>';
    }
    if (type === 'rect' || type === 'circle' || type === 'triangle') {
      html +=
        '<div class="rpe-row"><label class="rpe-field">Fill<input type="color" data-rpe-obj="fill" value="' +
        esc(obj.fill || '#ffffff') +
        '"/></label>' +
        '<label class="rpe-field">Stroke<input type="color" data-rpe-obj="stroke" value="' +
        esc(obj.stroke || '#6d28d9') +
        '"/></label></div>';
    }
    var w = Math.round((obj.width || 0) * (obj.scaleX || 1));
    var h = Math.round((obj.height || 0) * (obj.scaleY || 1));
    html +=
      '<h3>Position &amp; Size (mm)</h3><div class="rpe-row four">' +
      '<label class="rpe-field">X<input type="number" step="0.1" data-rpe-obj-mm="left" value="' +
      esc((Math.round(((obj.left || 0) / MM) * 10) / 10).toFixed(1)) +
      '"/></label>' +
      '<label class="rpe-field">Y<input type="number" step="0.1" data-rpe-obj-mm="top" value="' +
      esc((Math.round(((obj.top || 0) / MM) * 10) / 10).toFixed(1)) +
      '"/></label>' +
      '<label class="rpe-field">W<input type="number" step="0.1" data-rpe-obj-mm="width" value="' +
      esc((Math.round((w / MM) * 10) / 10).toFixed(1)) +
      '"/></label>' +
      '<label class="rpe-field">H<input type="number" step="0.1" data-rpe-obj-mm="height" value="' +
      esc((Math.round((h / MM) * 10) / 10).toFixed(1)) +
      '"/></label></div>' +
      '<div class="rpe-row"><label class="rpe-field">Opacity<input type="number" min="0" max="1" step="0.05" data-rpe-obj="opacity" value="' +
      esc(obj.opacity == null ? 1 : obj.opacity) +
      '"/></label>' +
      '<label class="rpe-field">Angle<input type="number" data-rpe-obj="angle" value="' +
      esc(Math.round(obj.angle || 0)) +
      '"/></label></div>' +
      '<div class="rpe-style-row">' +
      (type === 'image' &&
      (String(obj.rpeRole || '').indexOf('header') >= 0 || String(obj.rpeRole || '').indexOf('footer') >= 0)
        ? '<button type="button" data-rpe-obj-act="replace">Replace artwork</button>'
        : '') +
      '<button type="button" data-rpe-obj-act="delete">Delete</button>' +
      '<button type="button" data-rpe-obj-act="toHeader">Move to header</button>' +
      '<button type="button" data-rpe-obj-act="toFooter">Move to footer</button>' +
      '<button type="button" data-rpe-obj-act="front">Bring front</button>' +
      '<button type="button" data-rpe-obj-act="back">Send back</button></div></div>';
    return html;
  }

  function layersHtml() {
    if (!st.canvas) return '<div class="rpe-layers"><p class="rpe-status">No layers</p></div>';
    var objs = st.canvas.getObjects().slice().reverse();
    return (
      '<div class="rpe-layers">' +
      objs
        .map(function (o, i) {
          var name = o.rpeRole || o.type || 'object';
          if (o.text) name += ': ' + String(o.text).slice(0, 18);
          return (
            '<div class="rpe-layer' +
            (st.selected === o ? ' on' : '') +
            '" data-rpe-layer="' +
            i +
            '"><span>' +
            esc(name) +
            '</span><span class="rpe-layer-acts">' +
            '<button type="button" data-rpe-layer-act="up" data-i="' +
            i +
            '" title="Up">↑</button>' +
            '<button type="button" data-rpe-layer-act="down" data-i="' +
            i +
            '" title="Down">↓</button>' +
            '<button type="button" data-rpe-layer-act="lock" data-i="' +
            i +
            '" title="Lock">' +
            (o.selectable === false ? '🔒' : '🔓') +
            '</button>' +
            '<button type="button" data-rpe-layer-act="hide" data-i="' +
            i +
            '" title="Hide">' +
            (o.visible === false ? '👁' : '◯') +
            '</button></span></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function rightHtml() {
    return (
      '<div class="rpe-tabs">' +
      '<button type="button" data-rpe-rtab="props" class="' +
      (st.rightTab === 'props' ? 'on' : '') +
      '">Properties</button>' +
      '<button type="button" data-rpe-rtab="layers" class="' +
      (st.rightTab === 'layers' ? 'on' : '') +
      '">Layers</button></div>' +
      (st.rightTab === 'layers' ? layersHtml() : propsHtml(st.selected))
    );
  }

  function pagesHtml() {
    return (
      st.pages
        .map(function (p, i) {
          return (
            '<button type="button" class="rpe-page-thumb' +
            (i === st.pageIdx ? ' on' : '') +
            '" data-rpe-page="' +
            i +
            '">' +
            esc(p.name || 'Page ' + (i + 1)) +
            '</button>'
          );
        })
        .join('') +
      '<button type="button" class="rpe-btn ghost" data-rpe-page-add>+ Page</button>' +
      '<button type="button" class="rpe-btn ghost" data-rpe-page-dup>Duplicate</button>' +
      (st.pages.length > 1
        ? '<button type="button" class="rpe-btn ghost" data-rpe-page-del>Delete</button>'
        : '')
    );
  }

  function renderChrome() {
    var left = document.querySelector('[data-rpe-left]');
    var right = document.querySelector('[data-rpe-right]');
    var toolbar = document.querySelector('[data-rpe-toolbar]');
    var pages = document.querySelector('[data-rpe-pages]');
    if (toolbar) toolbar.innerHTML = toolbarHtml();
    if (left) left.innerHTML = leftHtml();
    if (right) right.innerHTML = rightHtml();
    if (pages) pages.innerHTML = pagesHtml();
    var nameEl = document.querySelector('[data-rpe-tpl-name]');
    if (nameEl && document.activeElement !== nameEl) nameEl.value = st.templateName || '';
    var brandEl = document.querySelector('[data-rpe-brand]');
    if (brandEl) brandEl.value = st.brand;
    syncBranchSelect();
    var fmtEl = document.querySelector('[data-rpe-fmt]');
    if (fmtEl) fmtEl.value = st.format;
    var orEl = document.querySelector('[data-rpe-orient]');
    if (orEl) orEl.value = st.orientation;
    updateGuides();
    applyZoom();
  }

  function viewScale() {
    var size = pageSize();
    var cssW = Math.max(1, Math.round(size.w * (st.zoom || 1)));
    return cssW / size.w;
  }

  function disp(px) {
    return Math.round(px * viewScale());
  }

  function fitZoom() {
    var wrap = document.querySelector('.rpe-stage-wrap');
    var size = pageSize();
    if (!wrap) {
      st.zoom = 0.85;
      return;
    }
    var availW = Math.max(280, wrap.clientWidth - 48);
    var availH = Math.max(280, wrap.clientHeight - 48);
    st.zoom = Math.max(0.35, Math.min(1.25, Math.min(availW / size.w, availH / size.h)));
  }

  function updateGuides() {
    var stage = document.querySelector('[data-rpe-stage]');
    var gh = document.querySelector('[data-rpe-guide-header]');
    var gf = document.querySelector('[data-rpe-guide-footer]');
    var mb = document.querySelector('[data-rpe-margins]');
    var rx = document.querySelector('[data-rpe-ruler-x]');
    var ry = document.querySelector('[data-rpe-ruler-y]');
    var size = pageSize();
    if (stage) {
      stage.classList.toggle('grid-on', !!st.showGrid);
      stage.style.transform = 'none';
      stage.style.width = disp(size.w) + 'px';
      stage.style.height = disp(size.h) + 'px';
    }
    if (gh) gh.hidden = false;
    if (gf) gf.hidden = false;
    if (mb) {
      var box = marginBox();
      mb.hidden = !st.showMargins;
      mb.style.top = disp(box.top) + 'px';
      mb.style.bottom = disp(box.bottom) + 'px';
      mb.style.left = disp(box.left) + 'px';
      mb.style.right = disp(box.right) + 'px';
    }
    if (rx) rx.hidden = !st.showRulers;
    if (ry) ry.hidden = !st.showRulers;
    paintBands();
  }

  function bandArtworkSrc(kind) {
    var layout = st.layout || {};
    if (st.format !== 'with_header') return '';
    if (layout[kind === 'footer' ? 'omit_footer_image' : 'omit_header_image']) return '';
    var custom = layout[kind + '_artwork_src'];
    if (custom && String(custom).indexOf('data:') === 0) return String(custom);
    var stored = layout[kind === 'footer' ? 'footer_image' : 'header_image'];
    if (stored) return String(stored).split('?')[0] + '?v=' + (st.artVersion || 13);
    return sharpAsset(kind) + '?v=9';
  }

  function syncBranchSelect() {
    var el = document.querySelector('[data-rpe-branch]');
    if (!el) return;
    var sig = (st.branches || [])
      .map(function (b) {
        return (b && (b.branch_code || b.name)) || '';
      })
      .join('|');
    if (el.getAttribute('data-sig') !== sig) {
      var html = '<option value="">Lab default</option>';
      (st.branches || []).forEach(function (b) {
        var code = (b && b.branch_code) || '';
        if (!code) return;
        html += '<option value="' + esc(code) + '">' + esc(b.name || code) + '</option>';
      });
      el.innerHTML = html;
      el.setAttribute('data-sig', sig);
    }
    if (document.activeElement !== el) el.value = st.branch || '';
  }

  var BAND_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  function bandPlace(kind) {
    var raw = st.layout && st.layout[kind + '_art_place'];
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        raw = null;
      }
    }
    if (!raw || typeof raw !== 'object') return { x: 0, y: 0, w: 1, h: 1 };
    return {
      x: Number(raw.x) || 0,
      y: Number(raw.y) || 0,
      w: Math.max(0.08, Number(raw.w) || 1),
      h: Math.max(0.08, Number(raw.h) || 1),
    };
  }

  function setBandPlace(kind, p) {
    if (!st.layout) st.layout = {};
    st.layout[kind + '_art_place'] = {
      x: Math.round(p.x * 1000) / 1000,
      y: Math.round(p.y * 1000) / 1000,
      w: Math.round(Math.max(0.08, p.w) * 1000) / 1000,
      h: Math.round(Math.max(0.08, p.h) * 1000) / 1000,
    };
    return st.layout[kind + '_art_place'];
  }

  function resetBandPlace(kind) {
    return setBandPlace(kind, { x: 0, y: 0, w: 1, h: 1 });
  }

  function applyArtBox(img, p) {
    img.style.left = p.x * 100 + '%';
    img.style.top = p.y * 100 + '%';
    img.style.width = p.w * 100 + '%';
    img.style.height = p.h * 100 + '%';
    img.style.objectFit = 'fill';
    img.style.maxWidth = 'none';
  }

  function layoutArtHandles(guide, p, show) {
    var spots = {
      nw: [p.x, p.y],
      n: [p.x + p.w / 2, p.y],
      ne: [p.x + p.w, p.y],
      e: [p.x + p.w, p.y + p.h / 2],
      se: [p.x + p.w, p.y + p.h],
      s: [p.x + p.w / 2, p.y + p.h],
      sw: [p.x, p.y + p.h],
      w: [p.x, p.y + p.h / 2],
    };
    BAND_HANDLES.forEach(function (h) {
      var el = guide.querySelector('[data-rpe-resize="' + h + '"]');
      if (!el) {
        el = document.createElement('i');
        el.className = 'rpe-handle rpe-handle-' + h;
        el.setAttribute('data-rpe-resize', h);
        guide.appendChild(el);
      }
      el.style.left = spots[h][0] * 100 + '%';
      el.style.top = spots[h][1] * 100 + '%';
      el.hidden = !show;
    });
  }

  function resizeArtPlace(start, mode, dx, dy) {
    var x = start.x;
    var y = start.y;
    var w = start.w;
    var h = start.h;
    if (mode.indexOf('e') >= 0) w += dx;
    if (mode.indexOf('s') >= 0) h += dy;
    if (mode.indexOf('w') >= 0) {
      x += dx;
      w -= dx;
    }
    if (mode.indexOf('n') >= 0) {
      y += dy;
      h -= dy;
    }
    if (w < 0.08) {
      if (mode.indexOf('w') >= 0) x -= 0.08 - w;
      w = 0.08;
    }
    if (h < 0.08) {
      if (mode.indexOf('n') >= 0) y -= 0.08 - h;
      h = 0.08;
    }
    return { x: x, y: y, w: w, h: h };
  }

  function paintBands() {
    if (st.layout) {
      st.layout.header_height_mm = HEADER_MM;
      st.layout.footer_height_mm = FOOTER_MM;
    }
    ['header', 'footer'].forEach(function (kind) {
      var guide = document.querySelector(kind === 'footer' ? '[data-rpe-guide-footer]' : '[data-rpe-guide-header]');
      if (!guide) return;
      var px = kind === 'footer' ? footerPx() : headerPx();
      guide.hidden = false;
      guide.style.height = disp(px) + 'px';
      guide.classList.toggle('on', st.selectedBand === kind);
      var img = guide.querySelector('.rpe-band-art');
      if (!img) {
        img = document.createElement('img');
        img.className = 'rpe-band-art';
        img.alt = '';
        guide.insertBefore(img, guide.firstChild);
      }
      var hint = guide.querySelector('.rpe-band-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'rpe-band-hint';
        guide.appendChild(hint);
      }
      var src = bandArtworkSrc(kind);
      guide.classList.toggle('has-art', !!src);
      applyArtBox(img, { x: 0, y: 0, w: 1, h: 1 });
      if (src) {
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        img.hidden = false;
        hint.textContent = '';
      } else {
        img.removeAttribute('src');
        img.hidden = true;
        hint.textContent = (kind === 'footer' ? 'Footer' : 'Header') + ' · click to add artwork';
      }
      layoutArtHandles(guide, { x: 0, y: 0, w: 1, h: 1 }, false);
    });
    removeFixedLetterheads();
  }

  function selectBand(kind) {
    st.selectedBand = kind === 'footer' ? 'footer' : 'header';
    st.selected = null;
    if (st.canvas) {
      st.canvas.discardActiveObject();
      st.canvas.requestRenderAll();
    }
    renderChrome();
  }

  function clearBandArtwork(kind) {
    if (!st.layout) st.layout = {};
    st.layout[kind + '_artwork_src'] = '';
    resetBandPlace(kind);
    if (kind === 'footer') st.layout.omit_footer_image = 1;
    else st.layout.omit_header_image = 1;
    st.selectedBand = kind;
    renderChrome();
    setStatus((kind === 'footer' ? 'Footer' : 'Header') + ' artwork removed. Outline stays ' + (kind === 'footer' ? FOOTER_MM : HEADER_MM) + ' mm.', 'ok');
  }

  var JSON_PROPS = ['rpeRole', 'rpeField', 'rpeCustom', 'rpeStock', 'selectable', 'evented', 'lockMovementX', 'lockMovementY'];

  function removeFixedLetterheads() {
    document.querySelectorAll('[data-rpe-band]').forEach(function (el) {
      el.remove();
    });
  }

  function bandRole(kind) {
    return kind === 'footer' ? 'footer_image' : 'header_image';
  }

  function findBandObject(kind) {
    var role = bandRole(kind);
    var alt = kind === 'footer' ? 'footer-image' : 'header-image';
    var found = null;
    if (!st.canvas) return null;
    st.canvas.getObjects().forEach(function (o) {
      if (!o) return;
      var name = String(o.rpeRole || '');
      if (name === role || name === alt) found = o;
    });
    return found;
  }

  function unlockBand(obj) {
    obj.set({
      visible: true,
      selectable: true,
      evented: true,
      objectCaching: false,
      lockMovementX: false,
      lockMovementY: false,
      hasControls: true,
      hoverCursor: 'move',
    });
    obj.setCoords();
  }

  function markBandRemoved(obj) {
    if (!obj || !st.layout) return;
    var name = String(obj.rpeRole || '');
    if (name.indexOf('header') >= 0) st.layout.omit_header_image = 1;
    if (name.indexOf('footer') >= 0) st.layout.omit_footer_image = 1;
  }

  function markBandKept(kind) {
    if (!st.layout) st.layout = {};
    if (kind === 'footer') st.layout.omit_footer_image = 0;
    else st.layout.omit_header_image = 0;
  }

  function removeObjects(list) {
    if (!st.canvas) return;
    (list || []).forEach(function (o) {
      markBandRemoved(o);
      st.canvas.remove(o);
    });
    st.canvas.discardActiveObject();
    st.selected = null;
    pushHistory();
    renderChrome();
  }

  function stripCanvasLetterhead() {
    if (!st.canvas) return;
    var size = pageSize();
    var drop = [];
    if (st.canvas.backgroundImage) st.canvas.backgroundImage = null;
    if (st.canvas.overlayImage) st.canvas.overlayImage = null;
    st.canvas.getObjects().forEach(function (o) {
      if (!o) return;
      var name = String(o.rpeRole || '');
      if (name.indexOf('header') >= 0 || name.indexOf('footer') >= 0) {
        drop.push(o);
        return;
      }
      if (o.type !== 'image' && o.type !== 'group') return;
      var top = o.top || 0;
      var scaledH = (o.height || 0) * Math.abs(o.scaleY || 1);
      if (top < size.h * 0.42 || top + scaledH > size.h * 0.72) drop.push(o);
    });
    drop.forEach(function (o) {
      st.canvas.remove(o);
    });
    var limit = headerPx() + 8;
    st.canvas.getObjects().forEach(function (o) {
      if (!o) return;
      if ((o.top || 0) < limit) {
        o.set({ top: limit });
        o.setCoords();
      }
    });
  }

  function syncCanvasViewport() {
    if (!st.canvas) return;
    var size = pageSize();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = Math.max(1, Math.round(size.w * (st.zoom || 1)));
    var cssScale = cssW / size.w;
    var cssH = Math.max(1, Math.round(size.h * cssScale));
    // Bitmap stays at real A4 pixels. Zoom only changes the CSS box, so the
    // letterhead is not resampled into a small canvas (that was the blur).
    var bufW = Math.max(1, Math.round(size.w * dpr));
    var bufH = Math.max(1, Math.round(size.h * dpr));
    var key = bufW + 'x' + bufH + '>' + cssW + 'x' + cssH;
    if (st._vpKey === key) {
      st.canvas.calcOffset();
      return;
    }
    st._vpKey = key;
    var lower = st.canvas.lowerCanvasEl;
    var upper = st.canvas.upperCanvasEl;
    var wrap = st.canvas.wrapperEl;
    lower.width = bufW;
    lower.height = bufH;
    if (upper) {
      upper.width = bufW;
      upper.height = bufH;
    }
    st.canvas.width = bufW;
    st.canvas.height = bufH;
    lower.style.width = cssW + 'px';
    lower.style.height = cssH + 'px';
    if (upper) {
      upper.style.width = cssW + 'px';
      upper.style.height = cssH + 'px';
    }
    if (wrap) {
      wrap.style.width = cssW + 'px';
      wrap.style.height = cssH + 'px';
      wrap.style.overflow = 'hidden';
    }
    st.canvas.enableRetinaScaling = false;
    st.canvas.imageSmoothingEnabled = true;
    var ctx = st.canvas.contextContainer;
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    }
    st.canvas.setViewportTransform([dpr, 0, 0, dpr, 0, 0]);
    st.canvas.calcOffset();
  }

  function applyZoom() {
    updateGuides();
    syncCanvasViewport();
    var label = document.querySelector('[data-rpe-zoom-label]');
    if (label) label.textContent = Math.round(st.zoom * 100) + '%';
  }

  function naturalSize(img) {
    var el = (img && (img._originalElement || img._element)) || null;
    var w = (el && (el.naturalWidth || el.width)) || (img && img.width) || 1;
    var h = (el && (el.naturalHeight || el.height)) || (img && img.height) || 1;
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  function sharpAsset(kind) {
    if (kind === 'footer') return '/report-footer.png';
    if (st.brand === 'slpl' || (st.layout && st.layout.header_template === 'non_nabl')) return '/non-nabl-header.png';
    return '/nabl-header.png';
  }

  function fitImageInPage(img, kind) {
    var size = pageSize();
    var nat = naturalSize(img);
    var maxH = kind === 'footer' ? size.h * 0.22 : size.h * 0.26;
    var scale = Math.min(size.w / nat.w, maxH / nat.h);
    var drawW = nat.w * scale;
    var drawH = nat.h * scale;
    img.set({
      originX: 'left',
      originY: 'top',
      width: nat.w,
      height: nat.h,
      cropX: 0,
      cropY: 0,
      left: Math.max(0, (size.w - drawW) / 2),
      top: kind === 'footer' ? Math.max(0, size.h - drawH) : 0,
      scaleX: scale,
      scaleY: scale,
      objectCaching: false,
      dirty: true,
      selectable: true,
      evented: true,
      hasControls: true,
      rpeRole: kind === 'footer' ? 'footer_image' : 'header_image',
    });
    img.setCoords();
    if (kind === 'header') st.layout.header_height_mm = Math.round((drawH / MM) * 10) / 10;
    else st.layout.footer_height_mm = Math.round((drawH / MM) * 10) / 10;
    return img;
  }

  function placeBandImage(url, kind) {
    return new Promise(function (resolve) {
      if (!url || !st.canvas || !window.fabric) return resolve(false);
      fabric.Image.fromURL(url, function (img) {
        if (!img) return resolve(false);
        fitImageInPage(img, kind);
        st.canvas.add(img);
        st.canvas.sendToBack(img);
        resolve(true);
      });
    });
  }

  function replaceSoftBand(kind) {
    return new Promise(function (resolve) {
      if (!st.canvas || st.format !== 'with_header') return resolve();
      var role = kind === 'footer' ? 'footer' : 'header';
      var existing = null;
      var size = pageSize();
      st.canvas.getObjects().forEach(function (o) {
        if (!o || o.type !== 'image') return;
        var name = String(o.rpeRole || '');
        var scaledW = (o.width || 0) * Math.abs(o.scaleX || 1);
        var wide = scaledW > size.w * 0.45 || naturalSize(o).w > size.w * 0.45;
        if (name.indexOf(role) >= 0) existing = o;
        else if (!name && wide && role === 'header' && (o.top || 0) < size.h * 0.45) existing = o;
        else if (!name && wide && role === 'footer' && (o.top || 0) > size.h * 0.45) existing = o;
      });
      var nat = existing ? naturalSize(existing) : { w: 0, h: 0 };
      var layoutUrl = (st.layout && st.layout[role + '_image']) || '';
      var urls = [];
      if (layoutUrl && layoutUrl.indexOf('data:') !== 0) urls.push(layoutUrl);
      urls.push(sharpAsset(kind));
      var best = existing;
      var bestW = nat.w;
      var pending = urls.length;
      function done() {
        if (best && best !== existing) {
          if (existing) st.canvas.remove(existing);
          fitImageInPage(best, kind);
          st.canvas.add(best);
          st.canvas.sendToBack(best);
        } else if (existing) {
          fitImageInPage(existing, kind);
        }
        resolve();
      }
      if (!pending) return done();
      urls.forEach(function (url) {
        fabric.Image.fromURL(url, function (img) {
          var w = img ? naturalSize(img).w : 0;
          if (img && w > bestW + 20) {
            best = img;
            bestW = w;
          }
          pending -= 1;
          if (!pending) done();
        });
      });
    });
  }

  function stripFabricBands() {
    if (!st.canvas) return;
    var drop = [];
    var size = pageSize();
    st.canvas.getObjects().forEach(function (o) {
      if (!o) return;
      var name = String(o.rpeRole || '');
      if (name === 'header_band' || name === 'footer_band') {
        drop.push(o);
        return;
      }
      if (o.type !== 'image') return;
      var top = o.top || 0;
      var scaledW = (o.width || 0) * Math.abs(o.scaleX || 1);
      var inBand = top < headerPx() + 6 || top > size.h - footerPx() - 6;
      var wide = scaledW > size.w * 0.45;
      var soft = naturalSize(o).w < 500;
      if (o.rpeStock || name.indexOf('header') >= 0 || name.indexOf('footer') >= 0 || (inBand && wide && soft)) drop.push(o);
    });
    drop.forEach(function (o) {
      st.canvas.remove(o);
    });
    if (st.format !== 'with_header') return;
    var limit = headerPx() + 8;
    st.canvas.getObjects().forEach(function (o) {
      if (!o) return;
      if ((o.top || 0) < limit) {
        o.set({ top: limit });
        o.setCoords();
      }
    });
  }

  function ensureSelectableBands() {
    removeFixedLetterheads();
    if (st.layout) {
      st.layout.header_height_mm = HEADER_MM;
      st.layout.footer_height_mm = FOOTER_MM;
    }
    stripFabricBands();
    if (st.canvas) st.canvas.requestRenderAll();
    return Promise.resolve();
  }

  function finishLoadedCanvas(statusText) {
    st.quiet = true;
    ensureSelectableBands().then(function () {
      if (!st.canvas) return;
      st.canvas.getObjects().forEach(function (o) {
        if (o) o.objectCaching = false;
      });
      st._vpKey = '';
      st.quiet = false;
      st.history = [];
      st.histIdx = -1;
      pushHistory();
      st.selected = null;
      st.canvas.discardActiveObject();
      renderChrome();
      st.canvas.requestRenderAll();
      if (statusText) setStatus(statusText, 'ok');
    });
  }

  function pushHistory() {
    if (!st.canvas || st.quiet) return;
    var json = st.canvas.toJSON(JSON_PROPS);
    st.history = st.history.slice(0, st.histIdx + 1);
    st.history.push(json);
    if (st.history.length > 50) st.history.shift();
    st.histIdx = st.history.length - 1;
  }

  function restoreHistory(idx) {
    if (!st.canvas || idx < 0 || idx >= st.history.length) return;
    st.quiet = true;
    st.canvas.loadFromJSON(st.history[idx], function () {
      st.canvas.renderAll();
      st.histIdx = idx;
      st.quiet = false;
      st.selected = null;
      renderChrome();
    });
  }

  function initCanvas() {
    if (st.canvas) {
      st.canvas.dispose();
      st.canvas = null;
    }
    st.canvas = new fabric.Canvas('rpe-canvas', {
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: true,
      enableRetinaScaling: false,
    });
    st.canvas.enableRetinaScaling = false;
    st._vpKey = '';
    st.canvas.on('before:render', function () {
      var ctx = st.canvas && st.canvas.contextContainer;
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
      }
      if (!st.canvas) return;
      var page = pageSize();
      st.canvas.getObjects().forEach(function (o) {
        if (!o || o.type !== 'image') return;
        var name = String(o.rpeRole || '');
        var top = o.top || 0;
        var scaledW = (o.width || 0) * Math.abs(o.scaleX || 1);
        var inBand = top < headerPx() + 6 || top > page.h - footerPx() - 6;
        var soft = naturalSize(o).w < 500 && scaledW > page.w * 0.45;
        if (o.rpeStock || name.indexOf('header') >= 0 || name.indexOf('footer') >= 0 || (inBand && soft)) o.visible = false;
      });
    });
    st.canvas.on('mouse:down', function () {
      if (!st.selectedBand) return;
      st.selectedBand = null;
      renderChrome();
    });
    st.canvas.on('object:modified', function () {
      pushHistory();
      renderChrome();
    });
    st.canvas.on('object:added', function () {
      if (!st.quiet) pushHistory();
    });
    st.canvas.on('selection:created', syncSelection);
    st.canvas.on('selection:updated', syncSelection);
    st.canvas.on('selection:cleared', function () {
      st.selected = null;
      renderChrome();
    });
  }

  function syncSelection(e) {
    st.selected = (e.selected && e.selected[0]) || st.canvas.getActiveObject();
    renderChrome();
  }

  function addText(text, opts) {
    opts = opts || {};
    var t = new fabric.IText(text || 'Edit text', {
      left: opts.left || 40,
      top: opts.top || (st.format === 'with_header' ? headerPx() + 20 : 40),
      fontSize: opts.fontSize || 16,
      fill: opts.fill || '#111111',
      fontFamily: opts.fontFamily || 'Poppins, Arial, sans-serif',
      fontWeight: opts.fontWeight || 'normal',
      textAlign: opts.textAlign || 'left',
      objectCaching: false,
      rpeRole: opts.rpeRole || 'text',
      rpeField: opts.rpeField || '',
    });
    st.canvas.add(t);
    st.canvas.setActiveObject(t);
    st.tool = 'select';
    pushHistory();
    renderChrome();
    return t;
  }

  function addRect(opts) {
    opts = opts || {};
    var r = new fabric.Rect({
      left: opts.left || 40,
      top: opts.top || 40,
      width: opts.width || 140,
      height: opts.height || 60,
      fill: opts.fill || '#ffffff',
      stroke: opts.stroke || '#6d28d9',
      strokeWidth: opts.strokeWidth == null ? 2 : opts.strokeWidth,
      rx: opts.rx || 0,
      ry: opts.ry || 0,
      rpeRole: opts.rpeRole || 'shape',
      opacity: opts.opacity == null ? 1 : opts.opacity,
    });
    st.canvas.add(r);
    st.canvas.setActiveObject(r);
    pushHistory();
    renderChrome();
    return r;
  }

  function addLine() {
    var y = st.format === 'with_header' ? headerPx() + 30 : 40;
    var line = new fabric.Line([40, y, 220, y], {
      stroke: '#0f766e',
      strokeWidth: 2,
      rpeRole: 'line',
    });
    st.canvas.add(line);
    st.canvas.setActiveObject(line);
    pushHistory();
    renderChrome();
  }

  function addDynamic(id) {
    var meta = DYNAMIC_FIELDS.filter(function (f) {
      return f.id === id;
    })[0];
    if (!meta) return;
    var top = st.format === 'with_header' ? headerPx() + 24 : 36;
    if (meta.kind === 'table') {
      var box = addRect({
        left: 36,
        top: top + 80,
        width: pageSize().w - 72,
        height: 220,
        fill: '#f8fafc',
        stroke: '#94a3b8',
        strokeWidth: 1,
        rpeRole: 'result_table',
      });
      box.rpeField = 'result_table';
      addText('{{TEST_RESULT_TABLE}}\nCOMPLETE BLOOD COUNT (CBC)\nParameter | Result | Unit | Reference', {
        left: 48,
        top: top + 92,
        fontSize: 13,
        fontFamily: 'Arial',
        rpeRole: 'result_table_label',
        rpeField: 'result_table',
      });
      return;
    }
    var sample =
      id === 'patient_block'
        ? 'Patient: {{patient_name}}\nAge/Sex: {{age_sex}}\nPatient ID: {{patient_id}}'
        : id === 'sample_block'
          ? 'Sample ID: {{sample_id}}\nCollected: {{collected_at}}\nReceived: {{received_at}}'
          : id === 'report_details'
            ? 'Report Date: {{report_date}}\nRef. By: {{ref_doctor}}\nReport ID: {{report_id}}'
            : id === 'lab_info'
              ? '{{lab_name}}\n{{lab_address}}\n{{lab_phone}}'
              : id === 'doctor_sign'
                ? '{{pathologist_name}}\n{{pathologist_qualification}}\nAuthorized Signatory'
                : '{{custom_field}}';
    addText(sample, {
      left: 40,
      top: top,
      fontSize: 13,
      rpeRole: 'dynamic',
      rpeField: id,
    });
  }

  function addDesign(kind) {
    var size = pageSize();
    if (kind === 'bg') {
      st.canvas.backgroundColor = '#ffffff';
      st.canvas.requestRenderAll();
      pushHistory();
      return;
    }
    if (kind === 'border') {
      addRect({
        left: 8,
        top: 8,
        width: size.w - 16,
        height: size.h - 16,
        fill: 'rgba(0,0,0,0)',
        stroke: '#334155',
        strokeWidth: 2,
        rpeRole: 'page_border',
      });
      return;
    }
    if (kind === 'watermark') {
      var w = new fabric.IText('CONFIDENTIAL', {
        left: size.w / 2 - 120,
        top: size.h / 2 - 20,
        fontSize: 42,
        fill: '#94a3b8',
        opacity: 0.18,
        angle: -28,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        rpeRole: 'watermark',
        selectable: true,
      });
      st.canvas.add(w);
      st.canvas.setActiveObject(w);
      pushHistory();
      renderChrome();
      return;
    }
    if (kind === 'header_band' && st.format === 'with_header') {
      addRect({
        left: 0,
        top: 0,
        width: size.w,
        height: headerPx(),
        fill: '#ffffff',
        stroke: '#c4b5fd',
        strokeWidth: 1,
        rpeRole: 'header_band',
      });
      return;
    }
    if (kind === 'footer_band' && st.format === 'with_header') {
      addRect({
        left: 0,
        top: size.h - footerPx(),
        width: size.w,
        height: footerPx(),
        fill: '#ffffff',
        stroke: '#c4b5fd',
        strokeWidth: 1,
        rpeRole: 'footer_band',
      });
    }
  }

  function seedStarter() {
    if (!st.canvas) return;
    st.quiet = true;
    if (st.layout) {
      st.layout.omit_header_image = 0;
      st.layout.omit_footer_image = 0;
    }
    st.canvas.clear();
    st.canvas.backgroundColor = '#ffffff';
    var size = pageSize();
    if (st.format === 'with_header') {
      st.layout.header_height_mm = Math.round(((size.w * (127 / 723)) / MM) * 10) / 10;
      st.layout.footer_height_mm = Math.round(((size.w * (84 / 723)) / MM) * 10) / 10;
    }
    ensureSelectableBands().then(function () {
      if (!st.canvas) return;
      addText('Complete Blood Count (CBC)', {
        left: 36,
        top: st.format === 'with_header' ? headerPx() + 16 : 36,
        fontSize: 16,
        fontWeight: 'bold',
        fill: '#0f3d3a',
        fontFamily: 'Arial',
        rpeRole: 'report_title',
      });
      addDynamic('patient_block');
      st.canvas.discardActiveObject();
      st.quiet = false;
      st.history = [];
      st.histIdx = -1;
      pushHistory();
      st.selected = null;
      st._vpKey = '';
      renderChrome();
      setStatus('Starter layout ready', 'ok');
    });
  }

  function snapshotPage() {
    if (!st.canvas) return;
    st.pages[st.pageIdx].canvas_json = st.canvas.toJSON(JSON_PROPS);
  }

  function loadPage(idx) {
    if (idx < 0 || idx >= st.pages.length) return;
    snapshotPage();
    st.pageIdx = idx;
    var json = st.pages[idx].canvas_json;
    st.quiet = true;
    if (json && Object.keys(json).length) {
      st.canvas.loadFromJSON(json, function () {
        finishLoadedCanvas('');
      });
    } else {
      st.canvas.clear();
      st.canvas.backgroundColor = '#ffffff';
      st.quiet = false;
      seedStarter();
    }
  }

  function collectMeta() {
    var meta = Object.assign({}, st.layout || {});
    document.querySelectorAll('[data-rpe-meta]').forEach(function (el) {
      meta[el.getAttribute('data-rpe-meta')] = el.value;
    });
    var headerOn = st.format === 'with_header' && !(st.layout && st.layout.omit_header_image);
    var footerOn = st.format === 'with_header' && !(st.layout && st.layout.omit_footer_image);
    meta.header_enabled = headerOn ? 1 : 0;
    meta.footer_enabled = footerOn ? 1 : 0;
    meta.header_height_mm = HEADER_MM;
    meta.footer_height_mm = FOOTER_MM;
    meta.margin_top_mm = HEADER_MM;
    meta.margin_bottom_mm = FOOTER_MM;
    meta.margin_left_mm = 8;
    meta.margin_right_mm = 8;
    meta.side_mm = 8;
    meta.orientation = st.orientation;
    meta.page_count = st.pages.length;
    meta.branch = st.branch || '';
    return meta;
  }

  function artworkForSave(kind) {
    if (st.format !== 'with_header') return '';
    var omitKey = kind === 'footer' ? 'omit_footer_image' : 'omit_header_image';
    if (st.layout && st.layout[omitKey]) return '';
    var shown = bandArtworkSrc(kind);
    if (!shown) return '';
    if (String(shown).indexOf('data:') === 0) return String(shown);
    return String(shown).split('?')[0];
  }

  function renderBandPng(kind) {
    return new Promise(function (resolve) {
      if (st.format !== 'with_header') return resolve('');
      var omitted = st.layout && st.layout[kind === 'footer' ? 'omit_footer_image' : 'omit_header_image'];
      if (omitted) return resolve('');
      var src = bandArtworkSrc(kind);
      if (!src) return resolve('');
      var place = bandPlace(kind);
      // 300 dpi on the 210mm page. scale 2 (~190 dpi) looked pixelated in the PDF.
      var scale = 4;
      var logicalW = A4.portrait.w;
      var logicalH = Math.max(1, Math.round((kind === 'footer' ? FOOTER_MM : HEADER_MM) * MM));
      var sheet = document.createElement('canvas');
      sheet.width = logicalW * scale;
      sheet.height = logicalH * scale;
      var ctx = sheet.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
      var img = new Image();
      img.onload = function () {
        ctx.drawImage(
          img,
          place.x * sheet.width,
          place.y * sheet.height,
          Math.max(1, place.w * sheet.width),
          Math.max(1, place.h * sheet.height)
        );
        try {
          resolve(sheet.toDataURL('image/png'));
        } catch (err) {
          resolve('');
        }
      };
      img.onerror = function () {
        resolve('');
      };
      img.src = src;
    });
  }

  function exportBand(kind) {
    return new Promise(function (resolve) {
      if (!st.canvas || st.format !== 'with_header') return resolve('');
      var size = pageSize();
      var h = Math.max(1, Math.round(kind === 'header' ? headerPx() : footerPx()));
      var top = kind === 'header' ? 0 : Math.max(0, size.h - h);
      var url = '';
      try {
        var lower = st.canvas.lowerCanvasEl;
        var upper = st.canvas.upperCanvasEl;
        var wrap = st.canvas.wrapperEl;
        lower.width = size.w;
        lower.height = size.h;
        if (upper) {
          upper.width = size.w;
          upper.height = size.h;
        }
        st.canvas.width = size.w;
        st.canvas.height = size.h;
        lower.style.width = size.w + 'px';
        lower.style.height = size.h + 'px';
        if (upper) {
          upper.style.width = size.w + 'px';
          upper.style.height = size.h + 'px';
        }
        if (wrap) {
          wrap.style.width = size.w + 'px';
          wrap.style.height = size.h + 'px';
        }
        st.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        url = st.canvas.toDataURL({
          format: 'png',
          multiplier: 2,
          left: 0,
          top: top,
          width: size.w,
          height: Math.min(h, size.h),
          enableRetinaScaling: false,
        });
      } catch (e) {
        url = '';
      }
      st._vpKey = '';
      applyZoom();
      resolve(url || '');
    });
  }

  function saveDesign(andApply) {
    if (!st.canManage) {
      setStatus('View only — Lab Manager can save', 'err');
      return Promise.reject(new Error('View only'));
    }
    setStatus('Saving design…');
    snapshotPage();
    var meta = collectMeta();
    var headerFile = artworkForSave('header');
    var footerFile = artworkForSave('footer');
    delete meta.header_artwork_src;
    delete meta.footer_artwork_src;
    delete meta.header_art_place;
    delete meta.footer_art_place;
    delete meta.header_image;
    delete meta.footer_image;
    st.layout = Object.assign({}, st.layout, meta);
    var name =
      (document.querySelector('[data-rpe-tpl-name]') || {}).value ||
      st.templateName ||
      (st.brand === 'slpl' ? 'SLPL' : 'Remedium') + ' design';
    st.templateName = name;
    var canvasJson = {
      pages: st.pages.map(function (p) {
        return { id: p.id, name: p.name, canvas_json: p.canvas_json };
      }),
      active_page: st.pageIdx,
      orientation: st.orientation,
      objects: (st.pages[0] && st.pages[0].canvas_json && st.pages[0].canvas_json.objects) || [],
      version: (st.pages[0] && st.pages[0].canvas_json && st.pages[0].canvas_json.version) || '5.3.0',
    };
    // Keep Fabric single-page shape for first page compatibility
    if (st.pages[0] && st.pages[0].canvas_json) {
      Object.keys(st.pages[0].canvas_json).forEach(function (k) {
        if (k !== 'pages') canvasJson[k] = st.pages[0].canvas_json[k];
      });
      canvasJson.pages = st.pages.map(function (p) {
        return { id: p.id, name: p.name, canvas_json: p.canvas_json };
      });
    }
    return Promise.resolve()
      .then(function () {
      var payload = {
        brand: st.brand,
        format: st.format,
        name: name,
        template_id: st.templateId || '',
        set_active: 1,
        canvas_json: JSON.stringify(canvasJson),
        meta: JSON.stringify(meta),
        branch: st.branch || '',
      };
      if (headerFile) payload.header_image = headerFile;
      if (footerFile) payload.footer_image = footerFile;
      return call('save_report_page_editor_template', payload);
    })
      .then(function (data) {
        var saved = (data && data.layout) || {};
        var shownHeader = (st.layout && st.layout.header_artwork_src) || '';
        var shownFooter = (st.layout && st.layout.footer_artwork_src) || '';
        var previousHeader = String((st.layout && st.layout.header_image) || '').split('?')[0];
        var previousFooter = String((st.layout && st.layout.footer_image) || '').split('?')[0];
        st.layout = Object.assign({}, st.layout, meta, saved);
        st.artVersion = Date.now();
        if (saved.header_image && String(saved.header_image).split('?')[0] !== previousHeader) {
          st.layout.header_image = saved.header_image;
          st.layout.header_artwork_src = '';
        } else if (String(shownHeader).indexOf('data:') === 0) {
          st.layout.header_artwork_src = shownHeader;
        } else if (saved.header_image) {
          st.layout.header_image = saved.header_image;
          st.layout.header_artwork_src = '';
        }
        if (saved.footer_image && String(saved.footer_image).split('?')[0] !== previousFooter) {
          st.layout.footer_image = saved.footer_image;
          st.layout.footer_artwork_src = '';
        } else if (String(shownFooter).indexOf('data:') === 0) {
          st.layout.footer_artwork_src = shownFooter;
        } else if (saved.footer_image) {
          st.layout.footer_image = saved.footer_image;
          st.layout.footer_artwork_src = '';
        }
        st.templates = (data && data.templates) || st.templates;
        setStatus('Design saved for ' + st.brand + ' · ' + st.format.replace('_', ' '), 'ok');
        if (andApply && st.branch) {
          return call('apply_report_page_layout_to_branches', {
            brand: st.brand,
            format: st.format,
            branches: JSON.stringify([st.branch]),
          }).then(function () {
            setStatus('Saved and applied to branch ' + st.branch, 'ok');
          });
        }
        renderChrome();
        return data;
      })
      .catch(function (err) {
        setStatus(err.message || 'Save failed', 'err');
        throw err;
      });
  }

  function openPdfPreview() {
    setStatus('Saving then building PDF…');
    saveDesign(false)
      .then(function () {
        return call('preview_report_page_pdf', {
          brand: st.brand,
          format: st.format,
          branch: st.branch,
        });
      })
      .then(function (data) {
        var bin = atob(data.content_base64 || '');
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        window.open(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), '_blank');
        setStatus('PDF preview opened', 'ok');
      })
      .catch(function (err) {
        setStatus(err.message || 'PDF failed', 'err');
      });
  }

  function reloadBrandFormat() {
    setStatus('Loading…');
    call('get_report_page_editor_template', {
      brand: st.brand,
      format: st.format,
      template_id: st.templateId || '',
      branch: st.branch || '',
    })
      .then(function (data) {
        st.layout = data.layout || {};
        if (data.meta) {
          ['omit_header_image', 'omit_footer_image'].forEach(function (key) {
            if (Object.prototype.hasOwnProperty.call(data.meta, key)) st.layout[key] = data.meta[key];
          });
        }
        st.layout.header_height_mm = HEADER_MM;
        st.layout.footer_height_mm = FOOTER_MM;
        st.templates = data.templates || [];
        st.branches = data.branches || [];
        st.templateId = data.id || '';
        st.templateName = data.name || '';
        st.orientation = (data.meta && data.meta.orientation) || st.layout.orientation || 'portrait';
        var cj = data.canvas_json || {};
        if (cj.pages && cj.pages.length) {
          st.pages = cj.pages.map(function (p, i) {
            return {
              id: p.id || 'p' + (i + 1),
              name: p.name || 'Page ' + (i + 1),
              canvas_json: p.canvas_json || p,
            };
          });
          st.pageIdx = Math.min(cj.active_page || 0, st.pages.length - 1);
        } else if (cj.objects) {
          st.pages = [{ id: 'p1', name: 'Page 1', canvas_json: cj }];
          st.pageIdx = 0;
        } else {
          st.pages = [{ id: 'p1', name: 'Page 1', canvas_json: null }];
          st.pageIdx = 0;
        }
        initCanvas();
        var page = st.pages[st.pageIdx];
        if (page.canvas_json && (page.canvas_json.objects || []).length) {
          st.quiet = true;
          st.canvas.loadFromJSON(page.canvas_json, function () {
            finishLoadedCanvas('Design loaded');
          });
        } else {
          seedStarter();
        }
      })
      .catch(function (err) {
        setStatus(err.message || 'Load failed', 'err');
        initCanvas();
        seedStarter();
      });
  }

  function mount() {
    ensureCss();
    var existing = document.querySelector('[data-rpe-root]');
    if (existing) {
      existing.hidden = false;
      st.open = true;
      if (st.canvas) {
        renderChrome();
        reloadBrandFormat();
        requestAnimationFrame(function () {
          fitZoom();
          st._vpKey = '';
          applyZoom();
        });
      } else {
        loadFabric(function () {
          initCanvas();
          renderChrome();
          reloadBrandFormat();
          requestAnimationFrame(function () {
            fitZoom();
            st._vpKey = '';
            applyZoom();
          });
        });
      }
      return;
    }
    var wrap = document.createElement('div');
    wrap.innerHTML = shellHtml();
    document.body.appendChild(wrap.firstChild);
    st.open = true;
    loadFabric(function () {
      initCanvas();
      renderChrome();
      reloadBrandFormat();
      requestAnimationFrame(function () {
        fitZoom();
        st._vpKey = '';
        applyZoom();
      });
    });
  }

  function close() {
    var root = document.querySelector('[data-rpe-root]');
    if (root) root.hidden = true;
    st.open = false;
  }

  function pickImage(role) {
    st._pendingImageRole = role || 'image';
    var file = document.querySelector('[data-rpe-file]');
    if (file) file.click();
  }

  document.addEventListener('keydown', function (e) {
    if (!st.open || !st.canvas) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    var act = st.canvas.getActiveObjects();
    if (act && act.length) {
      e.preventDefault();
      removeObjects(act);
      return;
    }
    if (st.selectedBand) {
      e.preventDefault();
      clearBandArtwork(st.selectedBand);
    }
  });

  var artDrag = null;

  document.addEventListener('mousedown', function (e) {
    if (!st.open) return;
    var handle = e.target.closest && e.target.closest('[data-rpe-resize]');
    var art = e.target.closest && e.target.closest('.rpe-band-art');
    if ((!handle && !art) || (art && art.hidden)) return;
    var guide = (handle || art).closest('[data-rpe-guide-header], [data-rpe-guide-footer]');
    if (!guide) return;
    var kind = guide.hasAttribute('data-rpe-guide-footer') ? 'footer' : 'header';
    artDrag = {
      kind: kind,
      mode: handle ? handle.getAttribute('data-rpe-resize') : 'move',
      x0: e.clientX,
      y0: e.clientY,
      place: bandPlace(kind),
      rect: guide.getBoundingClientRect(),
      moved: false,
    };
    st.selectedBand = kind;
    st.selected = null;
    if (st.canvas) st.canvas.discardActiveObject();
    e.preventDefault();
  });

  document.addEventListener('mousemove', function (e) {
    if (!artDrag) return;
    var rect = artDrag.rect;
    if (!rect.width || !rect.height) return;
    var dx = (e.clientX - artDrag.x0) / rect.width;
    var dy = (e.clientY - artDrag.y0) / rect.height;
    if (Math.abs(e.clientX - artDrag.x0) + Math.abs(e.clientY - artDrag.y0) > 2) artDrag.moved = true;
    var next =
      artDrag.mode === 'move'
        ? { x: artDrag.place.x + dx, y: artDrag.place.y + dy, w: artDrag.place.w, h: artDrag.place.h }
        : resizeArtPlace(artDrag.place, artDrag.mode, dx, dy);
    var saved = setBandPlace(artDrag.kind, next);
    var guide = document.querySelector(artDrag.kind === 'footer' ? '[data-rpe-guide-footer]' : '[data-rpe-guide-header]');
    if (!guide) return;
    guide.classList.add('on');
    var img = guide.querySelector('.rpe-band-art');
    if (img) applyArtBox(img, saved);
    layoutArtHandles(guide, saved, true);
  });

  document.addEventListener('mouseup', function () {
    if (!artDrag) return;
    var moved = artDrag.moved;
    artDrag = null;
    if (moved) st._skipBandClick = true;
    renderChrome();
  });

  document.addEventListener('click', function (e) {
    if (st._skipBandClick) {
      st._skipBandClick = false;
      e.preventDefault();
      return;
    }
    var openBtn = e.target.closest && e.target.closest('[data-rpe-open]');
    if (openBtn) {
      e.preventDefault();
      st.brand = openBtn.getAttribute('data-rpe-brand') || st.brand;
      st.format = openBtn.getAttribute('data-rpe-fmt') || st.format;
      mount();
      return;
    }
    if (!st.open) return;
    var bandGuide = e.target.closest && e.target.closest('[data-rpe-guide-header], [data-rpe-guide-footer]');
    if (bandGuide) {
      selectBand(bandGuide.hasAttribute('data-rpe-guide-footer') ? 'footer' : 'header');
      return;
    }
    if (e.target.closest('[data-rpe-close]')) {
      close();
      return;
    }
    var tool = e.target.closest('[data-rpe-tool]');
    if (tool) {
      var name = tool.getAttribute('data-rpe-tool');
      if (name === 'undo') return restoreHistory(st.histIdx - 1);
      if (name === 'redo') return restoreHistory(st.histIdx + 1);
      if (name === 'delete') {
        var act = st.canvas && st.canvas.getActiveObjects();
        if (act && act.length) removeObjects(act);
        else if (st.selectedBand) clearBandArtwork(st.selectedBand);
        return;
      }
      if (name === 'dup' && st.selected) {
        st.selected.clone(function (cloned) {
          cloned.set({ left: (st.selected.left || 0) + 16, top: (st.selected.top || 0) + 16 });
          st.canvas.add(cloned);
          st.canvas.setActiveObject(cloned);
          pushHistory();
          renderChrome();
        });
        return;
      }
      if (name === 'hand') {
        st.panMode = !st.panMode;
        st.tool = st.panMode ? 'hand' : 'select';
        if (st.canvas) st.canvas.selection = !st.panMode;
        renderChrome();
        return;
      }
      st.tool = name;
      st.panMode = false;
      if (st.canvas) st.canvas.selection = true;
      renderChrome();
      return;
    }
    var add = e.target.closest('[data-rpe-add]');
    if (add) {
      var a = add.getAttribute('data-rpe-add');
      if (a === 'text') addText('Edit text');
      else if (a === 'image' || a === 'logo' || a === 'icon') {
        if (st.selectedBand === 'footer') pickImage('replace-footer');
        else if (st.selectedBand === 'header') pickImage('replace-header');
        else pickImage(a);
      }
      else if (a === 'rect' || a === 'table') addRect({ rpeRole: a === 'table' ? 'table_frame' : 'shape' });
      else if (a === 'line') addLine();
      else if (a === 'barcode')
        addText('|||| |||| |||  {{barcode}}', { fontFamily: 'Courier New', fontSize: 18, rpeRole: 'barcode', rpeField: 'barcode' });
      else if (a === 'qr')
        addRect({ width: 72, height: 72, fill: '#111', strokeWidth: 0, rpeRole: 'qr', left: 40, top: headerPx() + 20 });
      return;
    }
    var dyn = e.target.closest('[data-rpe-dyn]');
    if (dyn) {
      addDynamic(dyn.getAttribute('data-rpe-dyn'));
      return;
    }
    var design = e.target.closest('[data-rpe-design]');
    if (design) {
      addDesign(design.getAttribute('data-rpe-design'));
      return;
    }
    var zoom = e.target.closest('[data-rpe-zoom]');
    if (zoom) {
      var z = zoom.getAttribute('data-rpe-zoom');
      if (z === 'fit') fitZoom();
      else st.zoom = Math.max(0.35, Math.min(1.5, st.zoom + (z === '+' ? 0.08 : -0.08)));
      applyZoom();
      return;
    }
    var rtab = e.target.closest('[data-rpe-rtab]');
    if (rtab) {
      st.rightTab = rtab.getAttribute('data-rpe-rtab');
      renderChrome();
      return;
    }
    if (e.target.closest('[data-rpe-seed]')) {
      seedStarter();
      return;
    }
    var bandAct = e.target.closest('[data-rpe-band-act]');
    if (bandAct) {
      var kind = bandAct.getAttribute('data-kind') === 'footer' ? 'footer' : 'header';
      var bAct = bandAct.getAttribute('data-rpe-band-act');
      if (bAct === 'select') {
        selectBand(kind);
        return;
      }
      if (bAct === 'delete') {
        clearBandArtwork(kind);
        return;
      }
      if (bAct === 'replace') {
        st.selectedBand = kind;
        pickImage(kind === 'footer' ? 'replace-footer' : 'replace-header');
        return;
      }
      if (bAct === 'fit') {
        resetBandPlace(kind);
        st.selectedBand = kind;
        renderChrome();
        return;
      }
    }
    var act = e.target.closest('[data-rpe-act]');
    if (act) {
      var a2 = act.getAttribute('data-rpe-act');
      if (a2 === 'save') saveDesign(false);
      if (a2 === 'pdf') openPdfPreview();
      if (a2 === 'apply') saveDesign(true);
      return;
    }
    var styleBtn = e.target.closest('[data-rpe-style]');
    if (styleBtn && st.selected) {
      var sname = styleBtn.getAttribute('data-rpe-style');
      if (sname === 'bold') st.selected.set('fontWeight', st.selected.fontWeight === 'bold' ? 'normal' : 'bold');
      if (sname === 'italic') st.selected.set('fontStyle', st.selected.fontStyle === 'italic' ? 'normal' : 'italic');
      if (sname === 'underline') st.selected.set('underline', !st.selected.underline);
      st.canvas.requestRenderAll();
      pushHistory();
      renderChrome();
      return;
    }
    var alignBtn = e.target.closest('[data-rpe-align]');
    if (alignBtn && st.selected) {
      st.selected.set('textAlign', alignBtn.getAttribute('data-rpe-align'));
      st.canvas.requestRenderAll();
      pushHistory();
      renderChrome();
      return;
    }
    var objAct = e.target.closest('[data-rpe-obj-act]');
    if (objAct && st.selected) {
      var oa = objAct.getAttribute('data-rpe-obj-act');
      var size = pageSize();
      if (oa === 'replace') {
        var roleName = String(st.selected.rpeRole || '');
        st._pendingImageRole = roleName.indexOf('footer') >= 0 ? 'replace-footer' : 'replace-header';
        pickImage(st._pendingImageRole);
        return;
      }
      if (oa === 'delete') {
        removeObjects([st.selected]);
        return;
      }
      if (oa === 'toHeader' || oa === 'toFooter') {
        var moveKind = oa === 'toFooter' ? 'footer' : 'header';
        var movePatch = { top: moveKind === 'footer' ? size.h - footerPx() + 8 : 8 };
        if (st.selected.type === 'image') {
          var prevBand = findBandObject(moveKind);
          if (prevBand && prevBand !== st.selected) st.canvas.remove(prevBand);
          movePatch.rpeRole = bandRole(moveKind);
          movePatch.rpeCustom = 1;
          movePatch.rpeStock = 0;
          st.selected.set(movePatch);
          unlockBand(st.selected);
          markBandKept(moveKind);
          st.canvas.bringToFront(st.selected);
        } else st.selected.set(movePatch);
      }
      if (oa === 'front') st.canvas.bringToFront(st.selected);
      if (oa === 'back') st.canvas.sendToBack(st.selected);
      st.canvas.requestRenderAll();
      pushHistory();
      return;
    }
    var pageBtn = e.target.closest('[data-rpe-page]');
    if (pageBtn) {
      loadPage(+pageBtn.getAttribute('data-rpe-page'));
      return;
    }
    if (e.target.closest('[data-rpe-page-add]')) {
      snapshotPage();
      st.pages.push({ id: 'p' + Date.now(), name: 'Page ' + (st.pages.length + 1), canvas_json: null });
      loadPage(st.pages.length - 1);
      return;
    }
    if (e.target.closest('[data-rpe-page-dup]')) {
      snapshotPage();
      var cur = st.pages[st.pageIdx];
      st.pages.splice(st.pageIdx + 1, 0, {
        id: 'p' + Date.now(),
        name: (cur.name || 'Page') + ' copy',
        canvas_json: cur.canvas_json ? JSON.parse(JSON.stringify(cur.canvas_json)) : null,
      });
      loadPage(st.pageIdx + 1);
      return;
    }
    if (e.target.closest('[data-rpe-page-del]') && st.pages.length > 1) {
      st.pages.splice(st.pageIdx, 1);
      loadPage(Math.max(0, st.pageIdx - 1));
      return;
    }
    var layer = e.target.closest('[data-rpe-layer]');
    if (layer && !e.target.closest('[data-rpe-layer-act]')) {
      var objs = st.canvas.getObjects().slice().reverse();
      var o = objs[+layer.getAttribute('data-rpe-layer')];
      if (o) {
        st.canvas.setActiveObject(o);
        st.selected = o;
        st.canvas.requestRenderAll();
        renderChrome();
      }
      return;
    }
    var layerAct = e.target.closest('[data-rpe-layer-act]');
    if (layerAct) {
      var objs2 = st.canvas.getObjects().slice().reverse();
      var o2 = objs2[+layerAct.getAttribute('data-i')];
      var la = layerAct.getAttribute('data-rpe-layer-act');
      if (o2 && la === 'up') st.canvas.bringForward(o2);
      if (o2 && la === 'down') st.canvas.sendBackwards(o2);
      if (o2 && la === 'hide') o2.visible = o2.visible === false ? true : false;
      if (o2 && la === 'lock') {
        var locked = o2.selectable === false;
        o2.set({ selectable: locked, evented: locked, lockMovementX: !locked, lockMovementY: !locked });
      }
      st.canvas.requestRenderAll();
      pushHistory();
      renderChrome();
    }
  });

  document.addEventListener('change', function (e) {
    if (!st.open) return;
    var el = e.target;
    if (el.hasAttribute('data-rpe-brand')) {
      st.brand = el.value;
      st.branch = '';
      st.templateId = '';
      reloadBrandFormat();
      return;
    }
    if (el.hasAttribute('data-rpe-branch')) {
      st.branch = el.value || '';
      reloadBrandFormat();
      return;
    }
    if (el.hasAttribute('data-rpe-fmt')) {
      st.format = el.value;
      st.templateId = '';
      reloadBrandFormat();
      return;
    }
    if (el.hasAttribute('data-rpe-orient')) {
      snapshotPage();
      st.orientation = el.value;
      initCanvas();
      var page = st.pages[st.pageIdx];
      if (page.canvas_json) {
        st.quiet = true;
        st.canvas.loadFromJSON(page.canvas_json, function () {
          finishLoadedCanvas('');
        });
      } else seedStarter();
      return;
    }
    if (el.hasAttribute('data-rpe-toggle')) {
      var t = el.getAttribute('data-rpe-toggle');
      if (t === 'grid') st.showGrid = el.checked;
      if (t === 'rulers') st.showRulers = el.checked;
      if (t === 'guides') st.showGuides = el.checked;
      if (t === 'margins') st.showMargins = el.checked;
      updateGuides();
      return;
    }
    if (el.hasAttribute('data-rpe-meta')) {
      st.layout = collectMeta();
      updateGuides();
      return;
    }
    if (el.hasAttribute('data-rpe-obj-mm') && st.selected) {
      var mmKey = el.getAttribute('data-rpe-obj-mm');
      var px = Number(el.value) * MM;
      if (mmKey === 'width') st.selected.set({ scaleX: px / (st.selected.width || 1) });
      else if (mmKey === 'height') st.selected.set({ scaleY: px / (st.selected.height || 1) });
      else st.selected.set(mmKey, px);
      st.canvas.requestRenderAll();
      pushHistory();
      return;
    }
    if (el.hasAttribute('data-rpe-obj') && st.selected) {
      var key = el.getAttribute('data-rpe-obj');
      var val = el.value;
      if (['fontSize', 'left', 'top', 'opacity', 'angle', 'lineHeight', 'charSpacing'].indexOf(key) >= 0)
        val = Number(val);
      if (key === 'width') st.selected.set({ scaleX: Number(val) / (st.selected.width || 1) });
      else if (key === 'height') st.selected.set({ scaleY: Number(val) / (st.selected.height || 1) });
      else st.selected.set(key, val);
      st.canvas.requestRenderAll();
      pushHistory();
      return;
    }
    if (el.hasAttribute('data-rpe-file') && el.files && el.files[0]) {
      var reader = new FileReader();
      var role = st._pendingImageRole || 'image';
      reader.onload = function () {
        if (role === 'replace-header' || role === 'replace-footer') {
          var bandKind = role === 'replace-footer' ? 'footer' : 'header';
          if (!st.layout) st.layout = {};
          st.layout[bandKind + '_artwork_src'] = String(reader.result || '');
          resetBandPlace(bandKind);
          if (bandKind === 'footer') st.layout.omit_footer_image = 0;
          else st.layout.omit_header_image = 0;
          st.selectedBand = bandKind;
          renderChrome();
          setStatus((bandKind === 'footer' ? 'Footer' : 'Header') + ' artwork replaced', 'ok');
          return;
        }
        fabric.Image.fromURL(String(reader.result || ''), function (img) {
          if (!img) return;
          var maxW = role === 'logo' ? 180 : 280;
          var scale = Math.min(1, maxW / (img.width || maxW));
          img.set({
            left: 40,
            top: st.format === 'with_header' ? headerPx() + 16 : 40,
            scaleX: scale,
            scaleY: scale,
            objectCaching: false,
            selectable: true,
            evented: true,
            rpeRole: role,
            rpeCustom: 1,
          });
          st.canvas.add(img);
          st.canvas.setActiveObject(img);
          pushHistory();
          renderChrome();
        });
      };
      reader.readAsDataURL(el.files[0]);
      el.value = '';
    }
  });

  window.openLabtechReportPageEditor = function (opts) {
    opts = opts || {};
    if (opts.brand) st.brand = opts.brand;
    if (opts.format) st.format = opts.format;
    mount();
  };
})();
