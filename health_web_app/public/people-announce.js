/* People HRMS: announcement composer/viewer modals, notification bell, and the Announcements tab on My Profile. */
(function () {
  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_announce.';
  var CORPORATE = '__corporate__';
  var MAX_FILES = 5;
  var MAX_BYTES = 10 * 1024 * 1024;

  var desk = null;
  var deskLoading = null;
  var notif = { unread: 0, items: [], loaded: false };
  var feed = { data: null, loading: false, filter: 'all', el: null };
  var modal = null;
  var modalPath = '';
  var pop = null;

  /* ------------------------------------------------------------ helpers */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function call(method, params) {
    var body = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      body.set(k, typeof v === 'string' ? v : JSON.stringify(v));
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

  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function relTime(v) {
    if (!v) return '';
    var t = new Date(String(v).replace(' ', 'T')).getTime();
    if (isNaN(t)) return fmtDate(v);
    var mins = Math.round((Date.now() - t) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + ' h ago';
    var days = Math.round(hrs / 24);
    if (days < 14) return days + ' d ago';
    return fmtDate(v);
  }

  function today() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function cleanBody(html) {
    var text = esc(html || '');
    ['b', 'i', 'u', 'p', 'strong', 'em'].forEach(function (tag) {
      text = text.replace(new RegExp('&lt;(/?)' + tag + '&gt;', 'gi'), '<$1' + tag + '>');
    });
    return text.replace(/&lt;br\s*\/?&gt;/gi, '<br>').replace(/\n/g, '<br>');
  }

  function saveBase64(name, data, type) {
    var bin = atob(data);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  var TONE = { Holiday: 'rose', Event: 'green', Policy: 'violet', Notice: 'amber', 'HR Process': 'blue', General: 'grey',
    Published: 'green', Scheduled: 'blue', Draft: 'grey', Archived: 'grey', Expired: 'rose' };
  function pill(text) { return '<span class="pan-pill ' + (TONE[text] || 'grey') + '">' + esc(text) + '</span>'; }

  function toast(msg, bad) {
    var t = document.createElement('div');
    t.className = 'pan-toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4500);
  }

  /* ------------------------------------------------------------ modal */

  function openModal(title, body, footer, wide) {
    closeModal();
    modalPath = location.pathname;
    modal = document.createElement('div');
    modal.className = 'pan-backdrop';
    modal.innerHTML = '<div class="pan-modal' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<header><h2>' + esc(title) + '</h2><button type="button" class="pan-x" data-m="close" aria-label="Close">✕</button></header>' +
      '<div class="pan-body">' + body + '<div class="pan-alert" data-m="error" hidden></div></div><footer>' + footer + '</footer></div>';
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) closeModal(); });
    modal.addEventListener('click', function (e) { if (e.target.closest('[data-m="close"]')) closeModal(); });
    document.body.appendChild(modal);
    return modal;
  }

  function closeModal() {
    if (modal) modal.remove();
    modal = null;
  }

  function modalError(msg) {
    if (!modal) return toast(msg, true);
    var box = modal.querySelector('[data-m="error"]');
    box.textContent = msg;
    box.hidden = false;
    modal.querySelectorAll('[data-m="save"]').forEach(function (b) { b.disabled = false; });
  }

  function busy(on) {
    if (modal) modal.querySelectorAll('[data-m="save"]').forEach(function (b) { b.disabled = on; });
  }

  /* ------------------------------------------------------------ data */

  function loadDesk(force) {
    if (desk && !force) return Promise.resolve(desk);
    if (deskLoading) return deskLoading;
    deskLoading = call('get_announcement_desk').then(function (d) {
      desk = d;
      return d;
    }).finally(function () { deskLoading = null; });
    return deskLoading;
  }

  function loadNotifications() {
    if (!signedIn()) return Promise.resolve();
    return call('get_my_notifications').then(function (d) {
      notif.unread = d.unread || 0;
      notif.items = d.items || [];
      notif.loaded = true;
      drawBell();
      if (pop) drawPop();
    }).catch(function () {});
  }

  function afterRead() {
    loadNotifications();
    if (feed.data) loadFeed();
  }

  /* ------------------------------------------------------------ audience (mirrors clinical_people_announce._matches) */

  function matches(a, e) {
    if (a.aud_wing === CORPORATE && e.wing) return false;
    if (a.aud_wing && a.aud_wing !== CORPORATE && e.wing !== a.aud_wing) return false;
    if (a.aud_department && e.department !== a.aud_department) return false;
    if (a.audience === 'Managers') return !!e.manager;
    if (a.audience === 'Designation') return e.designation === a.aud_designation;
    if (a.audience === 'Individual') return (a.aud_employees || []).indexOf(e.id) >= 0;
    return true;
  }

  /* ------------------------------------------------------------ view */

  function openView(id) {
    if (!id) return;
    var m = openModal('Announcement', '<p class="pan-muted">Loading…</p>', '<button type="button" class="pan-btn" data-m="close">Close</button>', true);
    call('get_announcement_detail', { announcement: id }).then(function (a) {
      if (modal !== m) return;
      var canEdit = !!(desk && desk.is_manager);
      var stats = a.recipients != null && (a.recipients || a.audience) ? '<div><dt>Delivered</dt><dd>' + a.recipients + ' employee' + (a.recipients === 1 ? '' : 's') + ' · ' + (a.read || 0) + ' read</dd></div>' : '';
      var body = '<div class="pan-view-head">' + pill(a.ann_type) + ' ' + pill(a.status) + '</div>' +
        '<h3 class="pan-view-title">' + esc(a.title) + '</h3>' + (a.subtitle ? '<p class="pan-view-sub">' + esc(a.subtitle) + '</p>' : '') +
        '<dl class="pan-dl">' +
        '<div><dt>Audience</dt><dd>' + esc(a.audience_label || a.target_value || 'All Employees') + '</dd></div>' +
        '<div><dt>Published by</dt><dd>' + esc(a.published_by || '—') + '</dd></div>' +
        '<div><dt>Publish date</dt><dd>' + esc(fmtDate(a.publish_date) || '—') + '</dd></div>' +
        '<div><dt>Valid until</dt><dd>' + esc(fmtDate(a.end_date) || '—') + '</dd></div>' + stats + '</dl>' +
        '<div class="pan-content">' + cleanBody(a.body) + '</div>' +
        ((a.attachments || []).length ? '<h4 class="pan-h4">Attachments</h4><ul class="pan-files">' + a.attachments.map(function (f) {
          return '<li><span class="pan-file-icon">📎</span><span>' + esc(f.file_name) + '</span><button type="button" class="pan-btn sm" data-file="' + f.index + '">Download</button></li>';
        }).join('') + '</ul>' : '');
      m.querySelector('.pan-body').innerHTML = body + '<div class="pan-alert" data-m="error" hidden></div>';
      m.querySelector('footer').innerHTML = (canEdit ? '<button type="button" class="pan-btn" data-v="edit">Edit</button>' : '') +
        '<button type="button" class="pan-btn" data-m="close">Close</button><button type="button" class="pan-btn primary" data-v="pdf">Download PDF</button>';
      m.addEventListener('click', function (e) {
        var f = e.target.closest('[data-file]');
        if (f) {
          f.disabled = true;
          call('get_announcement_attachment', { announcement: a.id, index: f.getAttribute('data-file') }).then(function (d) {
            saveBase64(d.file_name, d.data);
          }).catch(function (err) { modalError(err.message); }).finally(function () { f.disabled = false; });
        }
        var v = e.target.closest('[data-v]');
        if (!v) return;
        if (v.getAttribute('data-v') === 'pdf') {
          v.disabled = true;
          v.textContent = 'Preparing PDF…';
          call('get_announcement_pdf', { announcement: a.id }).then(function (d) {
            saveBase64(d.file_name, d.data, 'application/pdf');
          }).catch(function (err) { modalError(err.message); }).finally(function () { v.disabled = false; v.textContent = 'Download PDF'; });
        } else if (v.getAttribute('data-v') === 'edit') {
          openEditor(a);
        }
      });
      afterRead();
    }).catch(function (e) {
      if (modal === m) m.querySelector('.pan-body').innerHTML = '<div class="pan-alert">' + esc(e.message) + '</div>';
    });
  }

  /* ------------------------------------------------------------ editor (HR) */

  function openEditor(existing) {
    loadDesk().then(function (d) {
      if (!d.is_manager) return toast('Only HR can create announcements', true);
      editor(d, existing || null);
    }).catch(function (e) { toast(e.message, true); });
  }

  function editor(d, a) {
    var o = d.options || {};
    a = a || {};
    var editing = !!a.id;
    var emps = d.employees || [];
    var types = o.types || ['General', 'Notice', 'Policy', 'Event', 'Holiday', 'HR Process'];
    var keep = (a.attachments || []).slice();
    var added = [];
    var picked = {};
    (a.aud_employees || []).forEach(function (id) { picked[id] = true; });
    function opt(list, value) {
      return list.map(function (x) {
        var v = typeof x === 'string' ? x : x.value;
        var l = typeof x === 'string' ? x : x.label;
        return '<option value="' + esc(v) + '"' + (v === value ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('');
    }
    var body = '<div class="pan-grid">' +
      '<label class="span-2">Title *<input name="title" maxlength="180" value="' + esc(a.title || '') + '" placeholder="e.g. Diwali holiday notice" /></label>' +
      '<label>Type<select name="ann_type">' + opt(types, a.ann_type || 'General') + '</select></label>' +
      '<label>Short summary<input name="subtitle" maxlength="180" value="' + esc(a.subtitle || '') + '" placeholder="One line shown in lists and notifications" /></label>' +
      '<div class="span-2 pan-field"><span>Description *</span><div class="pan-toolbar"><button type="button" data-wrap="b"><b>B</b></button><button type="button" data-wrap="i"><i>I</i></button><button type="button" data-wrap="u"><u>U</u></button></div>' +
      '<textarea name="body" rows="6" placeholder="Write the announcement…">' + esc(a.body || '') + '</textarea></div>' +
      '<label>Target audience<select name="audience">' + opt([
        { value: 'All Employees', label: 'All employees' },
        { value: 'Managers', label: 'Managers & team leads' },
        { value: 'Designation', label: 'A designation' },
        { value: 'Individual', label: 'Specific employees' },
      ], a.audience || 'All Employees') + '</select></label>' +
      '<label>Portal / business wing<select name="aud_wing"><option value="">All wings</option><option value="' + CORPORATE + '"' + (a.aud_wing === CORPORATE ? ' selected' : '') + '>Corporate / Back Office</option>' + opt(o.wings || [], a.aud_wing) + '</select></label>' +
      '<label>Department<select name="aud_department"></select></label>' +
      '<label data-show="Designation">Designation<select name="aud_designation"><option value="">Choose designation</option>' + opt(o.designations || [], a.aud_designation) + '</select></label>' +
      '<div class="span-2 pan-field" data-show="Individual"><span>Employees</span><input name="emp_q" placeholder="Search employees" autocomplete="off" /><div class="pan-pick" data-pick></div></div>' +
      '<div class="span-2 pan-reach" data-reach></div>' +
      '<div class="span-2 pan-field"><span>Attachments (up to ' + MAX_FILES + ', 10 MB each)</span><div class="pan-drop" data-drop>Drop files here or <button type="button" class="pan-link" data-browse>browse</button><input type="file" name="files" multiple hidden /></div><ul class="pan-files" data-files></ul></div>' +
      '<label>Publish date<input name="publish_date" type="date" value="' + esc((a.publish_date || today()).slice(0, 10)) + '" /><small>A future date schedules it; notifications go out on that day.</small></label>' +
      '<label>Valid until (optional)<input name="end_date" type="date" value="' + esc((a.end_date || '').slice(0, 10)) + '" /></label>' +
      '</div>';
    var foot = '<button type="button" class="pan-btn" data-m="close">Cancel</button>' +
      '<button type="button" class="pan-btn" data-m="save" data-action="draft">Save as Draft</button>' +
      '<button type="button" class="pan-btn primary" data-m="save" data-action="publish">Publish</button>';
    var m = openModal(editing ? 'Edit announcement' : 'New announcement', body, foot, true);
    var f = function (n) { return m.querySelector('[name="' + n + '"]'); };

    function deptOptions() {
      var w = f('aud_wing').value;
      var current = f('aud_department').value || a.aud_department || '';
      var list = (o.departments || []).filter(function (x) {
        if (w === CORPORATE) return !x.wing;
        return !w || x.wing === w;
      });
      f('aud_department').innerHTML = '<option value="">All departments</option>' + list.map(function (x) {
        var where = [!w ? x.wing : '', x.division].filter(Boolean).join(' · ');
        var label = x.label + (where ? ' (' + where + ')' : '');
        return '<option value="' + esc(x.value) + '"' + (x.value === current ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
      if (!list.some(function (x) { return x.value === current; })) f('aud_department').value = '';
    }

    function drawPick() {
      var q = (f('emp_q').value || '').trim().toLowerCase();
      var list = emps.filter(function (e) { return !q || (e.name + ' ' + e.id + ' ' + e.department + ' ' + e.designation).toLowerCase().indexOf(q) >= 0; });
      m.querySelector('[data-pick]').innerHTML = list.slice(0, 200).map(function (e) {
        return '<label class="pan-check"><input type="checkbox" data-emp="' + esc(e.id) + '"' + (picked[e.id] ? ' checked' : '') + ' /><span><b>' + esc(e.name) + '</b><small>' + esc([e.id, e.designation, e.department].filter(Boolean).join(' · ')) + '</small></span></label>';
      }).join('') || '<p class="pan-muted">No employees match.</p>';
    }

    function reach() {
      var aud = { audience: f('audience').value, aud_wing: f('aud_wing').value, aud_department: f('aud_department').value, aud_designation: f('aud_designation').value, aud_employees: Object.keys(picked).filter(function (k) { return picked[k]; }) };
      m.querySelectorAll('[data-show]').forEach(function (el) { el.hidden = el.getAttribute('data-show') !== aud.audience; });
      var n = emps.filter(function (e) { return matches(aud, e); }).length;
      m.querySelector('[data-reach]').innerHTML = '🔔 <b>' + n + '</b> employee' + (n === 1 ? '' : 's') + ' will be notified when this is published.';
      return n;
    }

    function drawFiles() {
      m.querySelector('[data-files]').innerHTML = keep.map(function (x, i) {
        return '<li><span class="pan-file-icon">📎</span><span>' + esc(x.file_name) + '</span><button type="button" class="pan-link" data-unkeep="' + i + '">Remove</button></li>';
      }).join('') + added.map(function (x, i) {
        return '<li><span class="pan-file-icon">📎</span><span>' + esc(x.name) + ' <small>(new)</small></span><button type="button" class="pan-link" data-unadd="' + i + '">Remove</button></li>';
      }).join('');
    }

    function addFiles(list) {
      Array.prototype.forEach.call(list || [], function (file) {
        if (keep.length + added.length >= MAX_FILES) return modalError('Attach at most ' + MAX_FILES + ' files');
        if (file.size > MAX_BYTES) return modalError(file.name + ' is larger than 10 MB');
        var r = new FileReader();
        r.onload = function () { added.push({ name: file.name, data: String(r.result || '') }); drawFiles(); };
        r.readAsDataURL(file);
      });
    }

    deptOptions();
    drawPick();
    drawFiles();
    reach();
    f('aud_wing').addEventListener('change', function () { deptOptions(); reach(); });
    ['audience', 'aud_department', 'aud_designation'].forEach(function (n) { f(n).addEventListener('change', reach); });
    f('emp_q').addEventListener('input', drawPick);
    m.querySelector('[data-pick]').addEventListener('change', function (e) {
      var id = e.target.getAttribute('data-emp');
      if (id) { picked[id] = e.target.checked; reach(); }
    });
    m.querySelector('[data-browse]').addEventListener('click', function () { f('files').click(); });
    f('files').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
    var drop = m.querySelector('[data-drop]');
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('on'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('on'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('on'); addFiles(e.dataTransfer.files); });
    m.querySelector('[data-files]').addEventListener('click', function (e) {
      var k = e.target.getAttribute('data-unkeep');
      var n = e.target.getAttribute('data-unadd');
      if (k != null) { keep.splice(+k, 1); drawFiles(); }
      if (n != null) { added.splice(+n, 1); drawFiles(); }
    });
    m.querySelector('.pan-toolbar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-wrap]');
      if (!b) return;
      var ta = f('body');
      var tag = b.getAttribute('data-wrap');
      var s = ta.selectionStart;
      var en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '<' + tag + '>' + ta.value.slice(s, en) + '</' + tag + '>' + ta.value.slice(en);
      ta.focus();
      ta.setSelectionRange(s + tag.length + 2, en + tag.length + 2);
    });
    function syncPublishLabel() {
      var btn = m.querySelector('[data-action="publish"]');
      var future = f('publish_date').value && f('publish_date').value > today();
      btn.textContent = future ? 'Schedule' : 'Publish';
    }
    f('publish_date').addEventListener('change', syncPublishLabel);
    syncPublishLabel();

    m.querySelectorAll('[data-m="save"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.getAttribute('data-action');
        var payload = {
          id: a.id || '',
          action: action,
          title: f('title').value.trim(),
          ann_type: f('ann_type').value,
          subtitle: f('subtitle').value.trim(),
          body: f('body').value.trim(),
          audience: f('audience').value,
          aud_wing: f('aud_wing').value,
          aud_department: f('aud_department').value,
          aud_designation: f('aud_designation').value,
          aud_employees: Object.keys(picked).filter(function (k) { return picked[k]; }),
          publish_date: f('publish_date').value,
          end_date: f('end_date').value,
          keep_attachments: keep.map(function (x) { return x.file_url; }),
        };
        if (!payload.title) return modalError('Title is required');
        if (!payload.body) return modalError('Description is required');
        if (payload.audience === 'Designation' && !payload.aud_designation) return modalError('Choose the designation');
        if (payload.audience === 'Individual' && !payload.aud_employees.length) return modalError('Choose at least one employee');
        if (action === 'publish' && !reach()) return modalError('No employee matches this audience. Adjust the audience before publishing.');
        busy(true);
        call('save_announcement', { announcement: payload, files: added }).then(function (res) {
          var msg = res.status === 'Draft' ? 'Draft saved'
            : res.status === 'Scheduled' ? 'Scheduled for ' + fmtDate(payload.publish_date) + '. Employees are notified on that day.'
              : 'Published. ' + res.notified + ' employee' + (res.notified === 1 ? '' : 's') + ' notified.';
          closeModal();
          desk = null;
          if (/\/people\/announcements\/?$/.test(location.pathname)) {
            sessionStorage.setItem('pan-toast', msg);
            location.reload();
          } else {
            toast(msg);
          }
          loadNotifications();
        }).catch(function (e) { modalError(e.message); });
      });
    });
  }

  /* ------------------------------------------------------------ announcements page */

  function onAnnPage() { return /\/people\/announcements\/?$/.test(location.pathname); }

  function rowAnnouncement(el) {
    var tr = el.closest('tr, li');
    if (!tr || !desk) return null;
    var titleEl = tr.querySelector('b[title]') || tr.querySelector('b');
    var title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim() : '';
    var list = (desk.announcements || []).filter(function (x) { return x.title === title; });
    if (list.length > 1) {
      var text = tr.innerText || '';
      var exact = list.filter(function (x) { return x.publish_date && text.indexOf(fmtDate(x.publish_date)) >= 0; });
      if (exact.length) list = exact;
    }
    return list[0] || null;
  }

  document.addEventListener('click', function (e) {
    if (!onAnnPage()) return;
    var t = e.target;
    var newBtn = t.closest && t.closest('button');
    if (newBtn && /new announcement/i.test(newBtn.textContent || '') && newBtn.closest('.dep-head-actions')) {
      e.preventDefault();
      e.stopPropagation();
      openEditor(null);
      return;
    }
    var inTable = t.closest && t.closest('.emp-table tbody tr, .ann-feed li');
    if (!inTable || t.closest('input[type="checkbox"]')) return;
    var btn = t.closest('button');
    var label = btn ? (btn.getAttribute('aria-label') || '') : '';
    if (btn && !/^(view|edit|download)$/i.test(label)) return;
    e.preventDefault();
    e.stopPropagation();
    loadDesk().then(function () {
      var a = rowAnnouncement(inTable);
      if (!a) return toast('Could not find this announcement. Reload the page.', true);
      if (/^download$/i.test(label)) {
        return call('get_announcement_pdf', { announcement: a.id }).then(function (d) { saveBase64(d.file_name, d.data, 'application/pdf'); });
      }
      if (/^edit$/i.test(label) && desk.is_manager) openEditor(a);
      else openView(a.id);
    }).catch(function (err) { toast(err.message, true); });
  }, true);

  function syncAnnPage() {
    var on = onAnnPage();
    document.body.classList.toggle('pan-ann-page', on);
    if (on && !desk && !deskLoading && signedIn()) loadDesk().catch(function () {});
    var msg = sessionStorage.getItem('pan-toast');
    if (on && msg && document.querySelector('.ann-body')) {
      sessionStorage.removeItem('pan-toast');
      toast(msg);
    }
  }

  /* ------------------------------------------------------------ bell */

  function bellEl() {
    return document.querySelector('.hrms-top-actions [aria-label="Notifications"]');
  }

  function drawBell() {
    var bell = bellEl();
    if (!bell) return;
    if (!bell.hasAttribute('data-pan-bell')) {
      bell.setAttribute('data-pan-bell', '1');
      bell.setAttribute('role', 'button');
      bell.setAttribute('tabindex', '0');
      bell.addEventListener('click', function (e) {
        if (e.target.closest('.pan-pop')) return;
        togglePop();
      });
      bell.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePop(); } });
    }
    var badge = bell.querySelector('.badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge';
      bell.appendChild(badge);
    }
    var text = notif.unread > 99 ? '99+' : String(notif.unread);
    if (badge.textContent !== text) badge.textContent = text;
    var hide = !notif.loaded || !notif.unread;
    if (badge.style.display !== (hide ? 'none' : '')) badge.style.display = hide ? 'none' : '';
    bell.title = notif.unread ? notif.unread + ' unread notification' + (notif.unread === 1 ? '' : 's') : 'Notifications';
  }

  function togglePop() {
    if (pop) { pop.remove(); pop = null; return; }
    var bell = bellEl();
    if (!bell) return;
    pop = document.createElement('div');
    pop.className = 'pan-pop';
    bell.appendChild(pop);
    drawPop();
    loadNotifications();
  }

  function drawPop() {
    if (!pop) return;
    var items = notif.items || [];
    pop.innerHTML = '<header><b>Notifications</b>' + (notif.unread ? '<button type="button" class="pan-link" data-pop="all">Mark all as read</button>' : '') + '</header>' +
      (items.length ? '<ul>' + items.map(function (n) {
        return '<li class="' + (n.read ? '' : 'unread') + '" data-pop-item="' + esc(n.id) + '" data-ref="' + esc(n.ref) + '"><i></i><div><b>' + esc(n.title) + '</b>' +
          (n.message ? '<small>' + esc(n.message) + '</small>' : '') + '<em>' + esc(n.kind) + ' · ' + esc(relTime(n.when)) + '</em></div></li>';
      }).join('') + '</ul>' : '<p class="pan-muted">You are all caught up.</p>') +
      '<footer><button type="button" class="pan-link" data-pop="feed">View all announcements</button></footer>';
    pop.onclick = function (e) {
      e.stopPropagation();
      var all = e.target.closest('[data-pop="all"]');
      if (all) {
        call('mark_notifications_read', { all: '1' }).then(afterRead);
        notif.items.forEach(function (n) { n.read = true; });
        notif.unread = 0;
        drawBell();
        drawPop();
        return;
      }
      if (e.target.closest('[data-pop="feed"]')) {
        pop.remove();
        pop = null;
        goFeed();
        return;
      }
      var item = e.target.closest('[data-pop-item]');
      if (item) {
        pop.remove();
        pop = null;
        call('mark_notifications_read', { ids: [item.getAttribute('data-pop-item')] }).then(afterRead);
        openView(item.getAttribute('data-ref'));
      }
    };
  }

  document.addEventListener('mousedown', function (e) {
    if (pop && !e.target.closest('.pan-pop') && !e.target.closest('[data-pan-bell]')) { pop.remove(); pop = null; }
  });

  function goFeed() {
    if (/^\/people\/profile\/?$/.test(location.pathname) && !new URLSearchParams(location.search).get('employee')) {
      ptabs.show('announcements');
      return;
    }
    history.pushState({}, '', '/people/profile#announcements');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }

  /* ------------------------------------------------------------ My Profile: Announcements tab */

  // Shared by the People add-ons that add tabs to My Profile (keep identical in people-assets.js).
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

  function loadFeed() {
    feed.loading = true;
    return call('get_my_announcements').then(function (d) {
      feed.data = d;
    }).catch(function (e) {
      feed.data = { error: e.message, announcements: [], unread: 0 };
    }).then(function () {
      feed.loading = false;
      drawFeed();
    });
  }

  function drawFeed() {
    if (!feed.el) return;
    var d = feed.data;
    if (!d) { feed.el.innerHTML = '<p class="pan-muted">Loading announcements…</p>'; return; }
    var list = (d.announcements || []).filter(function (a) { return feed.filter !== 'unread' || a.unread; });
    feed.el.innerHTML = '<div class="pan-feed-head"><div><h3>📣 Announcements</h3><p>Company news, policies and notices for you.</p></div>' +
      '<div class="pan-feed-tools"><button type="button" class="pan-chip' + (feed.filter === 'all' ? ' on' : '') + '" data-ff="all">All <i>' + (d.announcements || []).length + '</i></button>' +
      '<button type="button" class="pan-chip' + (feed.filter === 'unread' ? ' on' : '') + '" data-ff="unread">Unread <i>' + (d.unread || 0) + '</i></button>' +
      (d.unread ? '<button type="button" class="pan-link" data-ff-read>Mark all as read</button>' : '') + '</div></div>' +
      (d.error ? '<div class="pan-alert">' + esc(d.error) + '</div>' : '') +
      (!d.employee && !d.error ? '<p class="pan-muted">Your login is not linked to an employee record, so announcements cannot be shown.</p>' : '') +
      (list.length ? '<ul class="pan-feed">' + list.map(function (a) {
        return '<li class="' + (a.unread ? 'unread' : '') + '" data-open="' + esc(a.id) + '"><span class="pan-feed-dot"></span><div><div class="pan-feed-meta">' + pill(a.ann_type) +
          (a.unread ? '<span class="pan-new">New</span>' : '') + '<small>' + esc(fmtDate(a.publish_date)) + (a.published_by ? ' · ' + esc(a.published_by) : '') + '</small></div>' +
          '<b>' + esc(a.title) + '</b>' + (a.subtitle ? '<p>' + esc(a.subtitle) + '</p>' : '') +
          ((a.attachments || []).length ? '<small>📎 ' + a.attachments.length + ' attachment' + (a.attachments.length === 1 ? '' : 's') + '</small>' : '') +
          '</div><button type="button" class="pan-btn sm">View</button></li>';
      }).join('') + '</ul>' : (d.employee ? '<p class="pan-muted">' + (feed.filter === 'unread' ? 'No unread announcements.' : 'No announcements for you yet.') + '</p>' : ''));
  }

  function mountFeed() {
    if (!onOwnProfile()) {
      ptabs.drop('announcements');
      feed.el = null;
      feed.data = null;
      return;
    }
    if (!feed.el) {
      feed.el = document.createElement('section');
      feed.el.className = 'pan-feed-panel';
      feed.el.hidden = true;
      feed.el.addEventListener('click', function (e) {
        var ff = e.target.closest('[data-ff]');
        if (ff) { feed.filter = ff.getAttribute('data-ff'); drawFeed(); return; }
        if (e.target.closest('[data-ff-read]')) {
          call('mark_notifications_read', { all: '1' }).then(afterRead);
          return;
        }
        var open = e.target.closest('[data-open]');
        if (open) openView(open.getAttribute('data-open'));
      });
      drawFeed();
    }
    var unread = feed.data ? feed.data.unread : notif.unread;
    var label = 'Announcements' + (unread ? ' <span class="pan-tab-badge">' + unread + '</span>' : '');
    ptabs.ensure('announcements', label, feed.el, function () { if (!feed.loading) loadFeed(); });
  }

  /* ------------------------------------------------------------ employee list on the Announcements page */

  // The page's own board lists every non-draft announcement to employees; keep only those addressed to them.
  if (!window.__panFetch) {
    window.__panFetch = true;
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var p = nativeFetch.apply(this, arguments);
      if (url.indexOf('.get_people_announcements') === -1) return p;
      return p.then(function (res) {
        if (!res.ok) return res;
        return res.clone().json().then(function (json) {
          var msg = json && json.message && typeof json.message === 'object' ? json.message : null;
          var data = msg && msg.data;
          if (!data || data.is_manager || !Array.isArray(data.announcements)) return res;
          return loadDesk().then(function (d) {
            var allowed = {};
            (d.announcements || []).forEach(function (a) { allowed[a.id] = true; });
            data.announcements = data.announcements.filter(function (a) { return allowed[a.id]; });
            if (Array.isArray(data.recent)) data.recent = data.recent.filter(function (a) { return allowed[a.id]; });
            return new Response(JSON.stringify(json), { status: res.status, statusText: res.statusText, headers: res.headers });
          });
        }).catch(function () { return res; });
      });
    };
  }

  /* ------------------------------------------------------------ boot */

  function tick() {
    if (modal && modalPath !== location.pathname) closeModal();
    if (!/^\/people(\/|$)/.test(location.pathname) || !signedIn()) return;
    if (!notif.loaded && !notif.loading) {
      notif.loading = true;
      loadNotifications().finally(function () { notif.loading = false; });
    }
    drawBell();
    syncAnnPage();
    mountFeed();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (modal) closeModal();
    else if (pop) { pop.remove(); pop = null; }
  });
  new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', tick);
  window.addEventListener('focus', function () { if (signedIn()) loadNotifications(); });
  setInterval(function () { if (signedIn() && /^\/people(\/|$)/.test(location.pathname) && !document.hidden) loadNotifications(); }, 60000);
  tick();
})();
