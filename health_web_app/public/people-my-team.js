/* People HRMS: My team — weekly Saturday feedback, monthly roll-up, HR Feedback & Development report. */
(function () {
  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_my_team.';
  var state = { data: null, loading: false, drafts: {}, saving: {}, el: null };
  var report = { open: false, loading: false, data: null, period: '', employee: '' };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function call(method, params) {
    var body = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v == null || v === '') return;
      body.set(k, typeof v === 'string' ? v : String(v));
    });
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
      return r.json().catch(function () { throw new Error('Server error (' + r.status + ')'); });
    }).then(function (json) {
      var m = json && json.message && typeof json.message === 'object' ? json.message : json;
      if (!m || m.status === 'error') throw new Error(String((m && m.message) || (json && json.exception) || 'Request failed').replace(/<[^>]+>/g, ''));
      return m.data !== undefined ? m.data : m;
    });
  }

  function signedIn() {
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      return !!(s && s.sid);
    } catch (e) {
      return false;
    }
  }

  function toast(msg, bad) {
    var t = document.createElement('div');
    t.className = 'pmt-toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }

  function initials(name) {
    return String(name || '?')
      .replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); })
      .join('') || '?';
  }

  function weekOf(row) {
    return row.week || {};
  }

  function draftOf(row) {
    if (state.drafts[row.id]) return state.drafts[row.id];
    var rev = weekOf(row);
    return {
      rating: rev.rating ? Math.round(Number(rev.rating)) : 0,
      remarks: rev.remarks || '',
      recommendation: rev.recommendation || '',
    };
  }

  function dirty(row) {
    var d = draftOf(row);
    var rev = weekOf(row);
    if (!d.rating) return false;
    return d.rating !== Math.round(Number(rev.rating) || 0)
      || d.remarks !== (rev.remarks || '')
      || d.recommendation !== (rev.recommendation || '');
  }

  function refreshSave(id) {
    if (!state.el) return;
    var row = ((state.data && state.data.team) || []).find(function (t) { return t.id === id; });
    var btn = state.el.querySelector('[data-save="' + id + '"]');
    if (!row || !btn) return;
    var d = draftOf(row);
    btn.disabled = !dirty(row) || !d.rating || !!state.saving[id];
  }

  function setDraft(id, patch, redraw) {
    var row = ((state.data && state.data.team) || []).find(function (t) { return t.id === id; });
    if (!row) return;
    state.drafts[id] = Object.assign({}, draftOf(row), patch);
    if (redraw === false) {
      refreshSave(id);
      var stars = state.el && state.el.querySelectorAll('[data-rate="' + id + '"]');
      if (stars && patch.rating != null) {
        stars.forEach(function (btn) {
          var n = Number(btn.getAttribute('data-stars'));
          btn.classList.toggle('on', n <= patch.rating);
          btn.setAttribute('aria-checked', n === patch.rating ? 'true' : 'false');
        });
      }
      return;
    }
    draw();
  }

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

  function onOwnProfile() {
    return /^\/people\/profile\/?$/.test(location.pathname) && !new URLSearchParams(location.search).get('employee');
  }

  function onPerformance() {
    return /^\/people\/performance\/?$/.test(location.pathname);
  }

  function starsHtml(value, id) {
    var html = '<span class="pmt-stars" role="radiogroup" aria-label="Rating">';
    for (var n = 1; n <= 5; n += 1) {
      html += '<button type="button" class="' + (n <= value ? 'on' : '') + '" data-rate="' + id + '" data-stars="' + n + '" aria-label="' + n + ' star' + (n === 1 ? '' : 's') + '" aria-checked="' + (n === value) + '" role="radio">★</button>';
    }
    return html + '</span>';
  }

  function monthSelect(d) {
    return (d.months || []).map(function (m) {
      return '<option value="' + esc(m.value) + '"' + (String(d.period).slice(0, 7) === m.value ? ' selected' : '') + '>' + esc(m.label) + '</option>';
    }).join('');
  }

  function weekSelect(d) {
    return (d.weeks || []).map(function (w) {
      return '<option value="' + esc(w.value) + '"' + (d.week_ending === w.value ? ' selected' : '') + '>' + esc(w.label) + '</option>';
    }).join('');
  }

  function draw() {
    if (!state.el) return;
    var d = state.data;
    if (state.loading && !d) {
      state.el.innerHTML = '<p class="pmt-muted">Loading your team…</p>';
      return;
    }
    if (!d) {
      state.el.innerHTML = '<p class="pmt-muted">Unable to load your team.</p>';
      return;
    }
    if (d.error) {
      state.el.innerHTML = '<div class="pmt-alert">' + esc(d.error) + '</div>';
      return;
    }
    var team = d.team || [];
    var recs = d.recommendations || [];
    state.el.innerHTML =
      '<div class="pmt-head"><div><h3>My team</h3><p>Give weekly feedback every Saturday. Set CRM sales targets for the month — achievement comes from Care / Aesthetic bills synced to Smilecure CRM. Stars roll into People → Performance (' + esc(String((d.weights && d.weights.feedback) || 40)) + '% of the score).</p></div>' +
      '<div class="pmt-tools">' +
      '<label>Month<select data-month>' + monthSelect(d) + '</select></label>' +
      '<label>Saturday week<select data-week>' + weekSelect(d) + '</select></label>' +
      '<span class="pmt-stat"><b>' + (d.rated || 0) + '</b> of ' + team.length + ' rated this week</span>' +
      (d.is_hr ? '<button type="button" class="pmt-btn" data-open-report>Feedback &amp; Development report</button>' : '') +
      '</div></div>' +
      '<div class="pmt-note">Week: <b>' + esc(d.week_label || '') + '</b> · Monthly roll-up for <b>' + esc(d.period_label || '') + '</b></div>' +
      (team.length
        ? '<ul class="pmt-list">' + team.map(function (row) {
            var draft = draftOf(row);
            var isDirty = dirty(row);
            var saving = !!state.saving[row.id];
            var monthly = row.review;
            var recOpts = '<option value="">Choose…</option>' + recs.map(function (r) {
              return '<option value="' + esc(r) + '"' + (draft.recommendation === r ? ' selected' : '') + '>' + esc(r) + '</option>';
            }).join('');
            var photo = row.photo
              ? '<img class="pmt-avatar" src="' + esc(row.photo) + '" alt="" />'
              : '<span class="pmt-avatar" aria-hidden="true">' + esc(initials(row.name)) + '</span>';
            return '<li class="pmt-card" data-id="' + esc(row.id) + '">' +
              '<div class="pmt-person">' + photo + '<div><b>' + esc(row.name) + '</b><small>' + esc(row.id) + (row.designation ? ' · ' + esc(row.designation) : '') + '</small>' +
              (row.department ? '<small>' + esc(row.department) + '</small>' : '') +
              '<small class="pmt-rollup">Month so far: ' + (monthly && monthly.rating != null ? ('★ ' + Number(monthly.rating).toFixed(1) + ' from ' + (row.weeks_rated || 0) + ' week' + ((row.weeks_rated || 0) === 1 ? '' : 's')) : 'no weekly reviews yet') + '</small>' +
              '</div></div>' +
              '<div class="pmt-form">' +
              '<label>Stars for this Saturday ' + starsHtml(draft.rating, row.id) + '</label>' +
              '<label>Recommendation<select data-rec="' + esc(row.id) + '">' + recOpts + '</select></label>' +
              '<label>Weekly feedback<textarea data-remarks="' + esc(row.id) + '" rows="3" placeholder="What went well this week, what to improve…">' + esc(draft.remarks) + '</textarea></label>' +
              '<div class="pmt-crm-target">' +
              '<label>CRM sales target (₹ / month)<input type="number" min="0" step="1000" data-crm-target="' + esc(row.id) + '" value="' + esc(row.crm_target_amount != null ? row.crm_target_amount : '') + '" placeholder="e.g. 200000" /></label>' +
              '<div class="pmt-crm-ach"><span>Achievement (synced bills)</span><b>₹ ' + Number(row.crm_achievement_amount || 0).toLocaleString("en-IN") + '</b></div>' +
              '<button type="button" class="pmt-btn" data-save-crm-target="' + esc(row.id) + '">Save CRM target</button>' +
              '</div>' +
              '<div class="pmt-actions"><span class="pmt-meta">' + (row.week && row.week.modified ? 'Last saved ' + esc(String(row.week.modified).slice(0, 16).replace('T', ' ')) : 'Not rated this week') + '</span>' +
              '<button type="button" class="pmt-btn primary" data-save="' + esc(row.id) + '"' + (saving || !isDirty || !draft.rating ? ' disabled' : '') + '>' + (saving ? 'Saving…' : 'Save weekly review') + '</button></div>' +
              '</div></li>';
          }).join('') + '</ul>'
        : '<p class="pmt-muted">No active employees report to you right now.</p>');
  }

  function load(opts) {
    if (!signedIn()) return;
    opts = opts || {};
    state.loading = true;
    draw();
    var params = {};
    if (opts.period) params.period = opts.period.length === 7 ? opts.period + '-01' : opts.period;
    if (opts.week_ending) params.week_ending = opts.week_ending;
    else if (state.data && state.data.week_ending) params.week_ending = state.data.week_ending;
    return call('get_my_team_board', params).then(function (data) {
      state.data = data;
      state.drafts = {};
    }).catch(function (e) {
      state.data = { error: e.message, team: [] };
    }).then(function () {
      state.loading = false;
      mount();
      draw();
    });
  }

  function saveCrmTarget(id) {
    var row = ((state.data && state.data.team) || []).find(function (t) { return t.id === id; });
    if (!row || !state.data || !state.el) return;
    var input = state.el.querySelector('[data-crm-target="' + id + '"]');
    var amount = input ? Number(input.value) : NaN;
    if (!Number.isFinite(amount) || amount < 0) {
      toast('Enter a valid CRM sales target amount (₹).', true);
      return;
    }
    var btn = state.el.querySelector('[data-save-crm-target="' + id + '"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }
    call('save_crm_sales_target_api', {
      employee: id,
      period: state.data.period,
      target_amount: String(amount),
    }).then(function (saved) {
      row.crm_target_amount = Number(saved && saved.target_amount != null ? saved.target_amount : amount);
      toast('CRM sales target saved for ' + (row.name || id) + ' · ₹ ' + Number(row.crm_target_amount).toLocaleString('en-IN'));
    }).catch(function (e) {
      toast(e.message || 'Could not save CRM target', true);
    }).then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save CRM target';
      }
      draw();
    });
  }

  function save(id) {
    var row = ((state.data && state.data.team) || []).find(function (t) { return t.id === id; });
    if (!row || !state.data) return;
    var draft = draftOf(row);
    if (!draft.rating) {
      toast('Pick a rating from 1 to 5 stars.', true);
      return;
    }
    state.saving[id] = true;
    draw();
    call('save_my_team_review_api', {
      employee: id,
      week_ending: state.data.week_ending,
      period: state.data.period,
      rating: String(draft.rating),
      remarks: draft.remarks,
      recommendation: draft.recommendation || '',
    }).then(function (saved) {
      row.week = {
        name: saved.name,
        week_ending: saved.week_ending,
        rating: saved.rating,
        remarks: saved.remarks,
        recommendation: saved.recommendation || '',
        modified: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      if (saved.monthly) {
        row.review = {
          name: saved.monthly.name,
          period: saved.monthly.period,
          rating: saved.monthly.rating,
          remarks: saved.monthly.remarks,
          recommendation: saved.monthly.recommendation || '',
        };
        row.weeks_rated = saved.monthly.weeks;
      }
      delete state.drafts[id];
      state.data.rated = (state.data.team || []).filter(function (t) { return t.week; }).length;
      toast('Weekly review saved. Monthly feedback is now ★ ' + (saved.monthly ? Number(saved.monthly.rating).toFixed(1) : draft.rating));
    }).catch(function (e) {
      toast(e.message || 'Could not save review', true);
    }).then(function () {
      delete state.saving[id];
      draw();
    });
  }

  function starsLine(n) {
    var v = Math.round(Number(n) || 0);
    var s = '';
    for (var i = 1; i <= 5; i += 1) s += i <= v ? '★' : '☆';
    return s + ' ' + (n != null ? Number(n).toFixed(1) : '—');
  }

  function reportHtml(data) {
    if (!data) return '<p class="pmt-muted">Loading report…</p>';
    if (data.error) return '<div class="pmt-alert">' + esc(data.error) + '</div>';
    var list = data.employees || [];
    if (!list.length) return '<p class="pmt-muted">No weekly or monthly feedback for ' + esc(data.period_label || 'this month') + ' yet.</p>';
    return '<div class="pmt-report-print">' + list.map(function (e) {
      var m = e.monthly || {};
      return '<article class="pmt-report-card">' +
        '<header><div><h4>' + esc(e.name) + '</h4><small>' + esc(e.id) + (e.designation ? ' · ' + esc(e.designation) : '') + (e.department ? ' · ' + esc(e.department) : '') + '</small>' +
        (e.reports_to_name ? '<small>Reporting manager: ' + esc(e.reports_to_name) + '</small>' : '') +
        '</div><div class="pmt-report-score"><b>' + (m.rating != null ? Number(m.rating).toFixed(1) : '—') + '</b><span>Monthly average</span></div></header>' +
        '<p class="pmt-report-rec"><b>Recommendation:</b> ' + esc(m.recommendation || '—') + '</p>' +
        '<h5>Weekly feedback (' + (e.weeks || []).length + ' of ' + (e.weeks_expected || 0) + ' Saturdays)</h5>' +
        ((e.weeks || []).length
          ? '<table class="pmt-report-table"><thead><tr><th>Week ending</th><th>Stars</th><th>Recommendation</th><th>Feedback</th></tr></thead><tbody>' +
            e.weeks.map(function (w) {
              return '<tr><td>' + esc(w.label) + '</td><td>' + esc(starsLine(w.rating)) + '</td><td>' + esc(w.recommendation || '—') + '</td><td>' + esc(w.remarks || '—') + '</td></tr>';
            }).join('') + '</tbody></table>'
          : '<p class="pmt-muted">No weekly reviews in this month.</p>') +
        (m.remarks ? '<h5>Monthly notes</h5><pre class="pmt-report-notes">' + esc(m.remarks) + '</pre>' : '') +
        '</article>';
    }).join('') + '</div>';
  }

  function drawReport() {
    var box = document.getElementById('pmt-report-modal');
    if (!box) return;
    var body = box.querySelector('[data-report-body]');
    var title = box.querySelector('[data-report-title]');
    if (title) title.textContent = 'Feedback & Development · ' + (report.data && report.data.period_label ? report.data.period_label : '');
    if (body) body.innerHTML = report.loading && !report.data ? '<p class="pmt-muted">Preparing report…</p>' : reportHtml(report.data);
  }

  function openReport(opts) {
    opts = opts || {};
    report.open = true;
    report.loading = true;
    report.period = opts.period || (state.data && state.data.period) || '';
    report.employee = opts.employee || '';
    var existing = document.getElementById('pmt-report-modal');
    if (!existing) {
      var wrap = document.createElement('div');
      wrap.id = 'pmt-report-modal';
      wrap.className = 'pmt-backdrop';
      wrap.innerHTML = '<div class="pmt-modal wide" role="dialog" aria-modal="true">' +
        '<header><div><h2 data-report-title>Feedback &amp; Development</h2><p class="pmt-muted">Weekly Saturday reviews and the monthly roll-up stored in People Performance.</p></div>' +
        '<button type="button" class="pmt-x" data-close-report aria-label="Close">✕</button></header>' +
        '<div class="pmt-body" data-report-body></div>' +
        '<footer><button type="button" class="pmt-btn" data-close-report>Close</button>' +
        '<button type="button" class="pmt-btn primary" data-print-report>Print / PDF</button></footer></div>';
      document.body.appendChild(wrap);
      wrap.addEventListener('click', function (e) {
        if (e.target === wrap || e.target.closest('[data-close-report]')) {
          report.open = false;
          wrap.remove();
        }
        if (e.target.closest('[data-print-report]')) window.print();
      });
    }
    drawReport();
    call('get_feedback_development_report_api', {
      period: report.period && report.period.length === 7 ? report.period + '-01' : report.period,
      employee: report.employee || undefined,
    }).then(function (data) {
      report.data = data;
    }).catch(function (e) {
      report.data = { error: e.message, employees: [] };
    }).then(function () {
      report.loading = false;
      drawReport();
    });
  }

  function mount() {
    if (!onOwnProfile() || !signedIn()) {
      ptabs.drop('my-team');
      state.el = null;
      return;
    }
    var team = state.data && state.data.team;
    if (state.data && !state.data.error && (!team || !team.length)) {
      ptabs.drop('my-team');
      state.el = null;
      return;
    }
    if (!state.el) {
      state.el = document.createElement('section');
      state.el.className = 'pmt-panel';
      state.el.hidden = true;
      state.el.addEventListener('click', function (e) {
        if (e.target.closest('[data-open-report]')) {
          openReport({ period: state.data && state.data.period });
          return;
        }
        var star = e.target.closest('[data-stars]');
        if (star) {
          setDraft(star.getAttribute('data-rate'), { rating: Number(star.getAttribute('data-stars')) }, false);
          return;
        }
        var saveCrm = e.target.closest('[data-save-crm-target]');
        if (saveCrm) {
          saveCrmTarget(saveCrm.getAttribute('data-save-crm-target'));
          return;
        }
        var saveBtn = e.target.closest('[data-save]');
        if (saveBtn) save(saveBtn.getAttribute('data-save'));
      });
      state.el.addEventListener('change', function (e) {
        var month = e.target.closest('[data-month]');
        if (month) {
          load({ period: month.value + '-01' });
          return;
        }
        var week = e.target.closest('[data-week]');
        if (week) {
          load({ week_ending: week.value, period: state.data && state.data.period });
          return;
        }
        var rec = e.target.closest('[data-rec]');
        if (rec) setDraft(rec.getAttribute('data-rec'), { recommendation: rec.value }, false);
      });
      state.el.addEventListener('input', function (e) {
        var remarks = e.target.closest('[data-remarks]');
        if (remarks) setDraft(remarks.getAttribute('data-remarks'), { remarks: remarks.value }, false);
      });
    }
    if (state.data && (state.data.error || (team && team.length))) {
      ptabs.ensure('my-team', 'My team', state.el, function () {
        if (!state.data && !state.loading) load();
      });
    }
  }

  function saveBase64Pdf(name, data) {
    var bin = atob(data);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = name || 'performance-report.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function periodFromPage() {
    var from = document.querySelector('input[type="date"]');
    if (from && from.value) return from.value;
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
  }

  function downloadDrawerReport(employeeId, btn) {
    if (!employeeId) return;
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing PDF…';
    call('download_performance_report_api', { employee: employeeId, period: periodFromPage() }).then(function (res) {
      saveBase64Pdf(res.file_name, res.data);
      toast('Performance Report downloaded');
    }).catch(function (e) {
      toast(e.message || 'Could not download the report', true);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = label;
    });
  }

  function mountDrawerDownload() {
    if (!onPerformance() || !signedIn()) return;
    var drawer = document.querySelector('.pf-drawer, aside.emp-drawer.pf-drawer');
    if (!drawer) return;
    if (drawer.querySelector('[data-pmt-download]')) return;
    var detail = drawer.querySelector('.pf-detail') || drawer;
    var actions = detail.querySelector('.pf-detail-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'pf-detail-actions';
      var rate = detail.querySelector('.pf-rate-btn');
      if (rate && rate.parentNode === detail) detail.insertBefore(actions, rate);
      else detail.appendChild(actions);
      if (rate && rate.parentNode === detail) actions.appendChild(rate);
    }
    var m = (drawer.textContent || '').match(/HR-EMP-\d+/);
    if (!m) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'emp-btn outline pf-rate-btn';
    b.setAttribute('data-pmt-download', m[0]);
    b.textContent = 'Download Performance Report';
    b.addEventListener('click', function () { downloadDrawerReport(m[0], b); });
    actions.insertBefore(b, actions.firstChild);
  }

  function mountPerformanceReport() {
    if (!onPerformance() || !signedIn()) {
      var btn = document.getElementById('pmt-perf-report-btn');
      if (btn) btn.remove();
      return;
    }
    var host = document.querySelector('.people-page header .emp-actions, .pf-page .emp-toolbar, .people-page .lv-stagebar, .people-page header');
    if (host && !document.getElementById('pmt-perf-report-btn')) {
      var b = document.createElement('button');
      b.type = 'button';
      b.id = 'pmt-perf-report-btn';
      b.className = 'emp-btn outline pmt-perf-btn';
      b.textContent = 'Feedback & Development report';
      b.addEventListener('click', function () { openReport({}); });
      host.appendChild(b);
    }
    mountDrawerDownload();
  }

  function tick() {
    if (onOwnProfile() && signedIn()) {
      if (!state.data && !state.loading) load();
      else mount();
    } else {
      ptabs.drop('my-team');
      state.el = null;
      if (!onOwnProfile()) state.data = null;
    }
    mountPerformanceReport();
  }

  setInterval(tick, 1200);
  tick();
})();
