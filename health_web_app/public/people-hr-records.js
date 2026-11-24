/* HR Self Service: Attendance record + Leave record sections (live SPA until rebuild). */
(function () {
  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.api.';
  var loading = false;
  var lastKey = '';

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

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtWhen(iso) {
    if (!iso) return '—';
    var d = new Date(String(iso).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function pill(status) {
    var s = String(status || 'Open');
    var tone = /reject/i.test(s) ? '#fecaca;#9f1239' : /approv/i.test(s) ? '#bbf7d0;#166534' : '#e2e8f0;#475569';
    var parts = tone.split(';');
    return (
      '<span style="display:inline-flex;align-items:center;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;background:' +
      parts[0] +
      ';color:' +
      parts[1] +
      '">' +
      esc(s) +
      '</span>'
    );
  }

  function card(title, sub, bodyHtml, linkHref, linkLabel) {
    return (
      '<section class="emp-card me-card" data-phr-injected="1" style="margin-top:14px">' +
      '<div class="me-card-head"><div><h2>' +
      esc(title) +
      '</h2><p>' +
      esc(sub) +
      '</p></div>' +
      (linkHref
        ? '<a class="me-link" href="' + esc(linkHref) + '">' + esc(linkLabel || 'Open') + '</a>'
        : '') +
      '</div>' +
      bodyHtml +
      '</section>'
    );
  }

  function table(headers, rowsHtml) {
    if (!rowsHtml) return '<p class="lv-muted" style="margin:0">No records yet.</p>';
    return (
      '<div style="overflow:auto"><table class="me-table" style="width:100%"><thead><tr>' +
      headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rowsHtml +
      '</tbody></table></div>'
    );
  }

  function fetchDash() {
    var body = new URLSearchParams();
    var s = sid();
    if (s) body.set('sid', s);
    return fetch(API + 'get_people_hrms_dashboard', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Frappe-Site-Name': 'health.localhost',
      },
      body: body,
    })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        var m = json && json.message && typeof json.message === 'object' ? json.message : json;
        if (!m || m.status === 'error') throw new Error((m && m.message) || 'Failed');
        return m.data !== undefined ? m.data : m;
      });
  }

  function onHrTab() {
    var tabs = document.querySelectorAll('.me-tabs button, [data-me-tabs] button');
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var on = t.classList.contains('on') || t.getAttribute('aria-current') === 'page' ||
        (t.getAttribute('class') || '').indexOf('active') >= 0;
      if (on && /hr\s*self\s*service/i.test(t.textContent || '')) return true;
    }
    try {
      return new URLSearchParams(location.search).get('tab') === 'hr';
    } catch (e) {
      return false;
    }
  }

  function mount(data) {
    var root = document.querySelector('.me-hr');
    if (!root || !data) return;
    if (root.querySelector('[data-phr-att-record], [data-phr-injected="att"]')) return;

    var att = data.attendance || {};
    var records = att.records || [];
    var leaves = data.leave_applications || [];

    var attRows = records
      .map(function (r) {
        return (
          '<tr><td>' +
          esc(fmtDate(r.date || r.time)) +
          '</td><td>' +
          esc(fmtWhen(r.time)) +
          '</td><td>' +
          pill(r.log_type || 'IN') +
          '</td></tr>'
        );
      })
      .join('');

    var leaveRows = leaves
      .map(function (lv) {
        return (
          '<tr><td>' +
          esc(lv.leave_type) +
          '</td><td>' +
          esc(fmtDate(lv.from_date)) +
          '</td><td>' +
          esc(fmtDate(lv.to_date)) +
          '</td><td>' +
          esc(lv.total_leave_days != null ? lv.total_leave_days : '—') +
          '</td><td>' +
          pill(lv.status || 'Open') +
          '</td></tr>'
        );
      })
      .join('');

    var attHtml = card(
      'Attendance record',
      'Your check-in / check-out history this month',
      table(['Date', 'Time', 'Type'], attRows),
      '/people/attendance',
      'Open attendance',
    ).replace('data-phr-injected="1"', 'data-phr-injected="att" data-phr-att-record="1"');

    var leaveHtml = card(
      'Leave record',
      leaves.length + ' application(s) on file',
      table(['Leave type', 'From', 'To', 'Days', 'Status'], leaveRows),
      '/people/leave',
      'Open leave',
    ).replace('data-phr-injected="1"', 'data-phr-injected="leave" data-phr-leave-record="1"');

    var firstCard = root.querySelector('.emp-card.me-card, .me-card');
    var hub = root.querySelector('.me-hub');
    var attBox = document.createElement('div');
    attBox.innerHTML = attHtml;
    var leaveBox = document.createElement('div');
    leaveBox.innerHTML = leaveHtml;

    if (firstCard && firstCard.parentNode === root) {
      firstCard.insertAdjacentElement('afterend', attBox.firstElementChild);
    } else {
      root.insertAdjacentElement('afterbegin', attBox.firstElementChild);
    }

    if (hub) {
      hub.insertAdjacentElement('beforebegin', leaveBox.firstElementChild);
    } else if (root.querySelector('[data-phr-att-record]')) {
      root.querySelector('[data-phr-att-record]').insertAdjacentElement('afterend', leaveBox.firstElementChild);
    } else {
      root.appendChild(leaveBox.firstElementChild);
    }

    /* Drop the old 3-line leave teaser under Apply leave once full Leave record exists. */
    var applyHead = null;
    root.querySelectorAll('.me-card-head h2, .me-card h2').forEach(function (h) {
      if (/^apply leave$/i.test((h.textContent || '').trim())) applyHead = h;
    });
    if (applyHead) {
      var applyCard = applyHead.closest('.me-card, .emp-card');
      if (applyCard) {
        applyCard.querySelectorAll('.me-train').forEach(function (n) { n.remove(); });
      }
    }
  }

  function tick() {
    if (!/\/people\/profile\/?$/.test(location.pathname)) return;
    if (!onHrTab()) return;
    var root = document.querySelector('.me-hr');
    if (!root) return;
    if (root.querySelector('[data-phr-att-record], [data-phr-injected="att"]')) return;
    if (loading) return;
    var key = sid() + ':' + location.search;
    if (key === lastKey && root.getAttribute('data-phr-tried') === '1') return;
    loading = true;
    root.setAttribute('data-phr-tried', '1');
    lastKey = key;
    fetchDash()
      .then(function (data) {
        mount(data);
      })
      .catch(function () {
        root.removeAttribute('data-phr-tried');
      })
      .finally(function () {
        loading = false;
      });
  }

  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', tick);
  window.addEventListener('popstate', function () {
    lastKey = '';
    document.querySelectorAll('.me-hr[data-phr-tried]').forEach(function (n) {
      n.removeAttribute('data-phr-tried');
    });
    tick();
  });
  tick();
})();
