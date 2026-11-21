/* People → Settings → Company Settings: upload HR signature for Performance Report PDFs. */
(function () {
  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_my_team.';
  var state = { data: null, loading: false, saving: false, el: null };

  function onPage() {
    return /\/people\/settings\/company\/?$/.test(location.pathname);
  }

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

  function toast(msg, bad) {
    var t = document.createElement('div');
    t.className = 'pcs-toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('Choose a signature image'));
      if (!/^image\/(png|jpe?g|webp)$/i.test(file.type || '')) return reject(new Error('Use a PNG, JPG or WEBP image'));
      if (file.size > 2 * 1024 * 1024) return reject(new Error('Signature must be 2 MB or less'));
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('Could not read the file')); };
      reader.readAsDataURL(file);
    });
  }

  function render() {
    if (!state.el) return;
    var d = state.data || {};
    var preview = d.preview
      ? '<img src="' + d.preview + '" alt="HR signature" />'
      : '<span class="pcs-empty">No signature uploaded yet</span>';
    var meta = d.has_signature
      ? 'Current file: <b>' + esc(d.file_name || 'signature') + '</b>' + (d.updated_on ? ' · Updated ' + esc(d.updated_on) : '')
      : 'Upload a clear PNG or JPG of the HR authorised signature. It is printed on Performance Report PDFs.';
    state.el.innerHTML =
      '<h1>Company Settings</h1>' +
      '<p class="pcs-lead">Company letterhead details for People documents. The HR signature below is used on Performance Report PDFs.</p>' +
      '<section class="pcs-card">' +
      '<h2>HR authorised signature</h2>' +
      '<p>This signature appears above the Authorised Signatory line on employee Performance Reports.</p>' +
      '<div class="pcs-preview">' + preview + '</div>' +
      '<div class="pcs-meta">' + meta + '</div>' +
      (state.error ? '<div class="pcs-alert">' + esc(state.error) + '</div>' : '') +
      '<div class="pcs-actions">' +
      '<input type="file" class="pcs-file" accept="image/png,image/jpeg,image/webp" data-pcs-file />' +
      '<button type="button" class="pcs-btn primary" data-pcs-upload' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? 'Uploading…' : 'Upload signature') + '</button>' +
      (d.has_signature ? '<button type="button" class="pcs-btn danger" data-pcs-clear' + (state.saving ? ' disabled' : '') + '>Remove</button>' : '') +
      '</div></section>';
  }

  function load() {
    if (state.loading) return;
    state.loading = true;
    state.error = '';
    render();
    call('get_hr_signature_settings_api').then(function (data) {
      state.data = data || {};
      state.loading = false;
      render();
    }).catch(function (e) {
      state.loading = false;
      state.error = e.message || 'Could not load signature settings';
      render();
    });
  }

  function upload(file) {
    state.saving = true;
    state.error = '';
    render();
    readFile(file).then(function (dataUrl) {
      return call('save_hr_signature_api', { file_name: file.name, file_data: dataUrl });
    }).then(function (data) {
      state.data = data || {};
      state.saving = false;
      toast('HR signature saved');
      render();
    }).catch(function (e) {
      state.saving = false;
      state.error = e.message || 'Upload failed';
      toast(state.error, true);
      render();
    });
  }

  function clearSig() {
    if (!window.confirm('Remove the HR signature from Performance Reports?')) return;
    state.saving = true;
    state.error = '';
    render();
    call('clear_hr_signature_api').then(function (data) {
      state.data = data || {};
      state.saving = false;
      toast('HR signature removed');
      render();
    }).catch(function (e) {
      state.saving = false;
      state.error = e.message || 'Could not remove signature';
      toast(state.error, true);
      render();
    });
  }

  function mount() {
    if (!onPage()) {
      if (state.el) { state.el.remove(); state.el = null; }
      var ph = document.querySelector('.hrms-placeholder');
      if (ph) ph.classList.remove('pcs-hidden');
      return;
    }
    var host = document.querySelector('main') || document.querySelector('.hrms-shell') || document.body;
    var ph = document.querySelector('.hrms-placeholder');
    if (ph) ph.classList.add('pcs-hidden');
    if (!state.el || !state.el.isConnected) {
      state.el = document.createElement('div');
      state.el.className = 'pcs-panel';
      state.el.addEventListener('click', function (ev) {
        var t = ev.target.closest('[data-pcs-upload], [data-pcs-clear]');
        if (!t || !state.el.contains(t)) return;
        if (t.hasAttribute('data-pcs-upload')) {
          var input = state.el.querySelector('[data-pcs-file]');
          if (input) input.click();
        } else if (t.hasAttribute('data-pcs-clear')) {
          clearSig();
        }
      });
      state.el.addEventListener('change', function (ev) {
        var input = ev.target.closest('[data-pcs-file]');
        if (!input || !input.files || !input.files[0]) return;
        upload(input.files[0]);
        input.value = '';
      });
      if (ph && ph.parentNode) ph.parentNode.insertBefore(state.el, ph);
      else host.appendChild(state.el);
    }
    load();
  }

  var last = '';
  function tick() {
    var key = location.pathname + (document.querySelector('.hrms-placeholder') ? '1' : '0');
    if (key !== last) { last = key; mount(); }
    else if (onPage() && state.el && !document.body.contains(state.el)) { state.el = null; mount(); }
  }
  setInterval(tick, 700);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
  else tick();
})();
