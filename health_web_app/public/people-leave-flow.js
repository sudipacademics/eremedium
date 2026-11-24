/* People Leave management: customise dates on review + show unauthorised leave days. */
(function () {
  function onLeavePage() {
    return /^\/people\/leave\/?$/.test(location.pathname);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function injectDateFields(modal) {
    if (!modal || modal.querySelector('[data-lv-dates]')) return;
    var label = modal.querySelector('label');
    if (!label) return;
    var box = document.createElement('div');
    box.setAttribute('data-lv-dates', '1');
    box.style.cssText = 'display:grid;gap:8px;margin:0 0 10px;';
    box.innerHTML = '<p style="margin:0;font-size:13px;color:#475569">Customise leave dates before deciding (optional). Days removed become <b>unauthorised</b> in Leave management.</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<label style="display:grid;gap:4px;font-size:12px;font-weight:650">From<input type="date" data-lv-from /></label>' +
      '<label style="display:grid;gap:4px;font-size:12px;font-weight:650">To<input type="date" data-lv-to /></label>' +
      '</div>';
    label.parentNode.insertBefore(box, label);
    var p = modal.querySelector('p');
    var text = (p && p.textContent) || '';
    // Prefer ISO dates stored when opening a single application action
    if (modal._lvFrom) box.querySelector('[data-lv-from]').value = modal._lvFrom;
    if (modal._lvTo) box.querySelector('[data-lv-to]').value = modal._lvTo;
  }

  function unauthorizedPanel(data) {
    if (!onLeavePage()) return;
    var rows = (data && data.unauthorized) || [];
    var main = document.querySelector('.hrms-list-page, .people-page, main') || document.body;
    var box = document.getElementById('lv-unauthorized-panel');
    if (!box) {
      box = document.createElement('section');
      box.id = 'lv-unauthorized-panel';
      box.style.cssText = 'margin:16px 0;padding:16px;border:1px solid #fecaca;border-radius:14px;background:#fff7f7;';
      var anchor = document.querySelector('.lv-tabs') || document.querySelector('.emp-toolbar') || main.firstChild;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
      else main.insertBefore(box, main.firstChild);
    }
    box.innerHTML = '<h3 style="margin:0 0 8px;font-size:16px;color:#9f1239">Unauthorised leave dates</h3>' +
      '<p style="margin:0 0 12px;color:#64748b;font-size:13px">Days requested by the employee but removed when a manager or HR customised the approved period.</p>' +
      (rows.length
        ? '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:#64748b"><th style="padding:6px">Employee</th><th style="padding:6px">Date</th><th style="padding:6px">Leave type</th><th style="padding:6px">Application</th></tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr style="border-top:1px solid #fee2e2"><td style="padding:6px">' + esc(r.employee_name) + '</td><td style="padding:6px">' + esc(r.date) + '</td><td style="padding:6px">' + esc(r.leave_type) + '</td><td style="padding:6px">' + esc(r.leave) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<p style="margin:0;color:#64748b;font-size:13px">No unauthorised leave dates in this range.</p>');
  }

  if (!window.__lvFlowFetch) {
    window.__lvFlowFetch = true;
    var native = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('act_people_leave') !== -1 && init && init.body) {
        var modal = document.querySelector('.lv-modal');
        var fromEl = modal && modal.querySelector('[data-lv-from]');
        var toEl = modal && modal.querySelector('[data-lv-to]');
        if (fromEl && toEl && (fromEl.value || toEl.value)) {
          var params = init.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init.body || ''));
          if (fromEl.value) params.set('from_date', fromEl.value);
          if (toEl.value) params.set('to_date', toEl.value);
          init = Object.assign({}, init, { body: params.toString() });
        }
      }
      var p = native.call(this, input, init);
      if (url.indexOf('list_people_leave') !== -1) {
        p.then(function (res) {
          if (!res || !res.ok) return;
          res.clone().json().then(function (json) {
            var msg = json && json.message;
            var data = msg && msg.data ? msg.data : msg;
            if (data) unauthorizedPanel(data);
          }).catch(function () {});
        });
      }
      return p;
    };
  }

  // When manager/HR opens the confirm modal from a single row, seed dates from drawer.
  document.addEventListener('click', function (e) {
    if (!onLeavePage()) return;
    var btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;
    var label = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!/forward to hr|reject|approve|resubmit/.test(label)) return;
    setTimeout(function () {
      var modal = document.querySelector('.lv-modal');
      if (!modal) return;
      var drawer = document.querySelector('.lv-drawer');
      if (drawer && drawer.getAttribute('data-from')) {
        modal._lvFrom = drawer.getAttribute('data-from');
        modal._lvTo = drawer.getAttribute('data-to');
      }
      injectDateFields(modal);
    }, 50);
  }, true);

  setInterval(function () {
    if (!onLeavePage()) return;
    var modal = document.querySelector('.lv-modal');
    if (modal) injectDateFields(modal);
    var drawer = document.querySelector('.lv-drawer');
    var idNode = document.querySelector('.lv-drawer-id');
    if (drawer && idNode && !drawer.getAttribute('data-from')) {
      // Try parse period text "dd MMM yyyy – dd MMM yyyy" is display only; leave blank.
    }
  }, 700);
})();
