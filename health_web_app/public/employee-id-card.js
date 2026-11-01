/* Live bridge for the Smilecure employee ID card.
   Skips cards already rendered by the updated React component. */
(function () {
  var COMPANY = 'Smilecure Lifestyle Pvt Ltd';
  var TITLE = 'EMPLOYEE ID CARD';
  var FOOTER = 'Smilecure Lifestyle Pvt Ltd • Employee Portal';
  var CARD_W = 750;
  var CARD_H = 1100;
  var fields = null;

  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function shown(value) {
    var text = String(value || '').trim();
    if (!text || text === '—' || text === '-' || text === '–') return 'DEMO';
    return text;
  }

  function joiningLabel(value) {
    var text = String(value || '').trim();
    var match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return text;
    var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (isNaN(date.getTime())) return text;
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  var verifyLinks = {};
  var verifyPending = {};

  function verifyUrl(empId) {
    return verifyLinks[String(empId || '').trim()] || '';
  }

  function ensureVerifyLink(empId) {
    var id = String(empId || '').trim();
    if (!id || id === 'DEMO') return Promise.resolve('');
    if (verifyLinks[id]) return Promise.resolve(verifyLinks[id]);
    if (verifyPending[id]) return verifyPending[id];
    var session = null;
    try { session = JSON.parse(localStorage.getItem('hec_web_session') || 'null'); } catch (e) { session = null; }
    var body = new URLSearchParams({ employee: id });
    if (session && session.sid) body.set('sid', session.sid);
    verifyPending[id] = fetch('/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_id_verify.get_people_id_token', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
      body: body,
    }).then(function (res) { return res.json(); }).then(function (json) {
      var nested = json && json.message && typeof json.message === 'object' ? json.message : json;
      var url = nested && nested.data && nested.data.url;
      if (url) verifyLinks[id] = url;
      delete verifyPending[id];
      return url || '';
    }).catch(function () { delete verifyPending[id]; return ''; });
    return verifyPending[id];
  }

  function cleanDepartment(value) {
    var text = String(value || '').trim();
    if (text.indexOf(' — ') !== -1) text = text.split(' — ').pop();
    return text.replace(/\s+-\s+[A-Z0-9]{2,8}$/, '').trim();
  }

  function rowsOf(card) {
    return [
      ['Employee ID', card.empId],
      ['Wing', card.wing],
      ['Division', card.division],
      ['Department', cleanDepartment(card.department)],
      ['Position', card.position || card.designation],
      ['Unit / Centre', card.unit],
      ['Manager Name', card.managerName],
      ['Date of Joining', joiningLabel(card.dateOfJoining)],
    ].filter(function (row) { return shown(row[1]) !== 'DEMO'; }).map(function (row) { return [row[0], String(row[1]).trim()]; });
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length || shown(name) === 'DEMO') return 'ID';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function qrSrc(empId) {
    var url = verifyUrl(empId);
    if (typeof qrcode !== 'function' || !url) return '';
    var qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr.createDataURL(8, 2);
  }

  function photoUrl(raw) {
    var src = String(raw || '').trim();
    if (!src) return '';
    if (/^https?:/i.test(src)) return src;
    return window.location.origin + (src.charAt(0) === '/' ? src : '/' + src);
  }

  function readProfile() {
    var map = {};
    document.querySelectorAll('.me-fields > div').forEach(function (row) {
      var label = row.querySelector('dt');
      var value = row.querySelector('dd');
      if (label && value) map[label.textContent.trim()] = value.textContent.trim();
    });
    var img = document.querySelector('.eidc-photo img, .me-photo-circle img');
    return {
      name: map['Full Name'] || '',
      empId: map['Employee ID'] || '',
      wing: '',
      division: '',
      department: map['Department'] || '',
      designation: map['Designation'] || '',
      position: map['Designation'] || '',
      managerName: map['Reporting Manager'] || '',
      dateOfJoining: map['Date of Joining'] || '',
      photoUrl: img ? img.getAttribute('src') || '' : '',
    };
  }

  function fromEmployee(emp) {
    return {
      name: emp.name || '',
      empId: emp.id || '',
      wing: emp.wing || '',
      division: emp.division || '',
      department: emp.department || '',
      designation: emp.designation || '',
      position: emp.position || emp.designation || '',
      unit: emp.unit || emp.people_unit || '',
      managerName: emp.reports_to_name || '',
      dateOfJoining: emp.date_of_joining || '',
      photoUrl: photoUrl(emp.photo || emp.image || ''),
    };
  }

  function paint(card) {
    var name = shown(card.name);
    var letters = initials(card.name);
    var photo = card.photoUrl
      ? '<img src="' + esc(card.photoUrl) + '" alt="" />'
      : esc(letters);
    var rows = rowsOf(card);
    var lines = rows.map(function (row) {
      return '<div class="eidc-row eidc-line"><dt>' + esc(row[0]) + ' -&nbsp;</dt><dd title="' + esc(row[1]) + '">' + esc(row[1]) + '</dd></div>';
    }).join('');
    for (var pad = rows.length; pad < 8; pad++) {
      lines += '<div class="eidc-row eidc-pad" aria-hidden="true"><dt>&nbsp;</dt><dd>&nbsp;</dd></div>';
    }
    return (
      '<header class="eidc-header"><span class="eidc-kicker">' + esc(COMPANY) + '</span>' +
      '<span class="eidc-title">' + TITLE + '</span></header>' +
      '<div class="eidc-body"><div class="eidc-photo" aria-hidden="true">' + photo + '</div>' +
      '<p class="eidc-name" title="' + (name === 'DEMO' ? '' : esc(name)) + '">' + (name === 'DEMO' ? '&nbsp;' : esc(name)) + '</p>' +
      '<dl class="eidc-rows">' + lines + '</dl><div class="eidc-divider"></div>' +
      (qrSrc(card.empId)
        ? '<div class="eidc-qr-wrap"><img class="eidc-qr-img" alt="QR code to verify this employee" src="' + qrSrc(card.empId) + '" />' +
          '<p class="eidc-qr-cap">Scan to verify employee</p></div>'
        : '<div class="eidc-qr-wrap"><div class="eidc-qr-img eidc-qr-wait"></div><p class="eidc-qr-cap">Preparing secure QR…</p></div>') +
      '<p class="eidc-footer">' + esc(FOOTER) + '</p></div>'
    );
  }

  function profilePhoto() {
    var img = document.querySelector('.me-photo-circle img, .me-hero-avatar img');
    var src = img ? img.getAttribute('src') || '' : '';
    return src ? photoUrl(src) : '';
  }

  function apply() {
    if (document.querySelector('.eidc-card[data-built="react"]')) return;
    if (!fields || (!fields.empId && !fields.name)) fields = readProfile();
    if (!fields) return;
    var live = profilePhoto();
    if (live && live !== fields.photoUrl) fields.photoUrl = live;
    var link = verifyUrl(fields.empId);
    if (!link && fields.empId) ensureVerifyLink(fields.empId).then(function (url) { if (url) apply(); });
    var sig = (fields.photoUrl || '') + '|' + link;
    var key = sig + '|' + JSON.stringify(rowsOf(fields)) + '|' + (fields.name || '');
    document.querySelectorAll('.eidc-card').forEach(function (node) {
      if (node.closest('[data-wdd-idcard]') || node.hasAttribute('data-eidc-key')) return;
      if (node.getAttribute('data-smilecure') === '1' && node.getAttribute('data-photo') === key) return;
      node.classList.add('eidc-card-v2');
      node.setAttribute('data-smilecure', '1');
      node.setAttribute('data-photo', key);
      if (!node.querySelector('.eidc-render')) node.innerHTML = paint(fields);
      upgrade(node, Object.assign({}, fields));
    });
    upgradePending();
  }

  var pendingCards = {};
  var pendingSeq = 0;

  function upgradePending() {
    document.querySelectorAll('.eidc-card[data-eidc-key]').forEach(function (node) {
      var id = node.getAttribute('data-eidc-key');
      var card = pendingCards[id];
      if (!card) return;
      delete pendingCards[id];
      upgrade(node, card);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function rounded(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  /* Card is drawn on a 750 x 1100 grid = 7.5 cm x 11 cm (100 units per cm). */
  async function renderCard(fields, scale) {
    await ensureVerifyLink(fields.empId);
    var rows = rowsOf(fields);
    var w = CARD_W;
    var h = CARD_H;
    var headerH = 205;
    var photoR = 66;
    var rowsTop = 372;
    var lineH = 52;
    var qrSize = 200;
    var qrTop = 830;
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(scale, scale);
    ctx.save();
    rounded(ctx, 0, 0, w, h, 34);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    var grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#0f766e');
    grad.addColorStop(0.46, '#0e8a8a');
    grad.addColorStop(1, '#0b6fc2');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, headerH);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '600 26px Segoe UI, sans-serif';
    ctx.fillText(COMPANY, w / 2, 70, w - 70);
    ctx.font = '800 30px Segoe UI, sans-serif';
    ctx.fillText(TITLE, w / 2, 112, w - 70);
    var cx = w / 2;
    var cy = headerH;
    ctx.beginPath();
    ctx.arc(cx, cy, photoR + 9, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, photoR, 0, Math.PI * 2);
    ctx.fillStyle = '#e7f6f3';
    ctx.fill();
    var photo = await loadImage(fields.photoUrl);
    if (photo) {
      var side = Math.min(photo.width, photo.height);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, photoR, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(photo, (photo.width - side) / 2, (photo.height - side) / 2, side, side, cx - photoR, cy - photoR, photoR * 2, photoR * 2);
      ctx.restore();
    } else {
      ctx.fillStyle = '#0f766e';
      ctx.font = '800 38px Segoe UI, sans-serif';
      ctx.fillText(initials(fields.name), cx, cy + 13);
    }
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 34px Segoe UI, sans-serif';
    if (shown(fields.name) !== 'DEMO') ctx.fillText(shown(fields.name), w / 2, 326, w - 70);
    var left = 56;
    var right = w - 56;
    ctx.textAlign = 'left';
    rows.forEach(function (row, index) {
      var base = rowsTop + index * lineH + 34;
      ctx.font = '600 22px Segoe UI, sans-serif';
      ctx.fillStyle = '#64748b';
      var label = row[0] + ' - ';
      ctx.fillText(label, left, base);
      var labelW = ctx.measureText(label).width;
      ctx.font = '700 23px Segoe UI, sans-serif';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(row[1], left + labelW, base, Math.max(80, right - left - labelW));
      if (index < rows.length - 1) {
        ctx.fillStyle = '#eef2f6';
        ctx.fillRect(left, rowsTop + (index + 1) * lineH, right - left, 1.5);
      }
    });
    var qrX = (w - qrSize) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#d5e3e8';
    ctx.lineWidth = 2;
    rounded(ctx, qrX, qrTop, qrSize, qrSize, 16);
    ctx.fill();
    ctx.stroke();
    var qr = await loadImage(qrSrc(fields.empId));
    if (qr) ctx.drawImage(qr, qrX + 14, qrTop + 14, qrSize - 28, qrSize - 28);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#64748b';
    ctx.font = '600 17px Segoe UI, sans-serif';
    ctx.fillText('Scan to verify employee', w / 2, qrTop + qrSize + 28);
    ctx.fillStyle = '#7c8b99';
    ctx.font = '600 15px Segoe UI, sans-serif';
    ctx.fillText(FOOTER, w / 2, h - 20, w - 60);
    ctx.restore();
    return canvas;
  }

  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function withPrintSize(pngBytes, pxPerMeter) {
    var chunk = new Uint8Array(21);
    var view = new DataView(chunk.buffer);
    view.setUint32(0, 9);
    chunk.set([0x70, 0x48, 0x59, 0x73], 4);
    view.setUint32(8, pxPerMeter);
    view.setUint32(12, pxPerMeter);
    chunk[16] = 1;
    view.setUint32(17, crc32(chunk.subarray(4, 17)));
    var out = new Uint8Array(pngBytes.length + chunk.length);
    out.set(pngBytes.subarray(0, 33), 0);
    out.set(chunk, 33);
    out.set(pngBytes.subarray(33), 33 + chunk.length);
    return out;
  }

  async function download(card) {
    var fields = card || window.__eidcFields;
    if (!fields) return;
    var scale = 2;
    var canvas = await renderCard(fields, scale);
    if (!canvas) return;
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var pxPerMeter = Math.round((CARD_W * scale) / 0.075);
    var file = new Blob([withPrintSize(bytes, pxPerMeter)], { type: 'image/png' });
    var url = URL.createObjectURL(file);
    var link = document.createElement('a');
    link.href = url;
    link.download = (fields.empId || 'employee') + '-id-card.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  var renderSeq = 0;
  function upgrade(node, card) {
    var seq = String(++renderSeq);
    node.setAttribute('data-render', seq);
    renderCard(card, 2).then(function (canvas) {
      if (!canvas || node.getAttribute('data-render') !== seq) return;
      node.classList.add('eidc-card-img');
      node.innerHTML = '<img class="eidc-render" alt="Employee ID card for ' + esc(shown(card.name)) + '" src="' + canvas.toDataURL('image/png') + '" />';
    }).catch(function () {});
  }

  document.addEventListener('click', function (event) {
    if (document.querySelector('.eidc-card[data-built="react"]')) return;
    var button = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!button || button.hasAttribute('data-eidc-own') || !/download id card/i.test(button.textContent || '')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    void download(fields);
  }, true);

  window.SmilecureIdCard = {
    fromEmployee: fromEmployee,
    html: function (card) {
      var id = 'c' + (++pendingSeq);
      pendingCards[id] = card;
      setTimeout(upgradePending, 0);
      return '<div class="eidc-card eidc-card-v2" data-smilecure="1" data-eidc-key="' + id + '">' + paint(card) + '</div>';
    },
    download: function (card) { return download(card); },
    ready: function (empId) { return ensureVerifyLink(empId); },
  };

  function watch() {
    apply();
    var root = document.body;
    if (!root || root.getAttribute('data-id-watch') === '1') return;
    root.setAttribute('data-id-watch', '1');
    new MutationObserver(function () { apply(); }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }

  function load() {
    fields = readProfile();
    watch();
    var session = null;
    try { session = JSON.parse(localStorage.getItem('hec_web_session') || 'null'); } catch (e) { session = null; }
    var body = new URLSearchParams();
    if (session && session.sid) body.set('sid', session.sid);
    fetch('/api/method/health_ecosystem_core.health_ecosystem_core.api.get_people_hrms_dashboard', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Frappe-Site-Name': 'health.localhost',
      },
      body: body,
    }).then(function (res) { return res.json(); }).then(function (json) {
      var nested = json && json.message && typeof json.message === 'object' ? json.message : json;
      var data = nested && nested.data && nested.data.employee ? nested.data : nested;
      if (data && data.employee) {
        var next = fromEmployee(data.employee);
        if (!next.photoUrl) next.photoUrl = fields.photoUrl;
        fields = next;
        document.querySelectorAll('.eidc-card').forEach(function (node) { node.removeAttribute('data-smilecure'); });
        apply();
        fetch('/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_org.get_people_org', {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Frappe-Site-Name': 'health.localhost',
          },
          body: body,
        }).then(function (res) { return res.json(); }).then(function (orgJson) {
          var orgNested = orgJson && orgJson.message && typeof orgJson.message === 'object' ? orgJson.message : orgJson;
          var org = orgNested && orgNested.data ? orgNested.data : orgNested;
          var me = org && org.me;
          if (!me) return;
          if (me.wing) fields.wing = me.wing;
          if (me.division) fields.division = me.division;
          if (me.department) fields.department = me.department;
          if (me.designation) {
            fields.designation = me.designation;
            fields.position = me.designation;
          }
          if (me.unit) fields.unit = me.unit;
          if (me.reports_to_name) fields.managerName = me.reports_to_name;
          document.querySelectorAll('.eidc-card').forEach(function (node) { node.removeAttribute('data-smilecure'); });
          apply();
        }).catch(function () {});
      }
    }).catch(function () { /* profile text already on the card */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
