/* People HRMS: reliable check-in/out — capture GPS when possible; never block when geofencing is off. */
(function () {
  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.';
  var busy = false;
  var lastPunchAt = 0;

  function signedIn() {
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      return !!(s && s.sid);
    } catch (e) {
      return false;
    }
  }

  function sid() {
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      return (s && s.sid) || '';
    } catch (e) {
      return '';
    }
  }

  function call(method, params) {
    var body = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v == null || v === '') return;
      body.set(k, typeof v === 'string' ? v : String(v));
    });
    if (sid()) body.set('sid', sid());
    return fetch(API + method, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Frappe-Site-Name': 'health.localhost',
      },
      body: body,
    }).then(function (r) {
      return r.json().catch(function () { throw new Error('Server error (' + r.status + ')'); });
    }).then(function (json) {
      var m = json && json.message && typeof json.message === 'object' ? json.message : json;
      if (!m || m.status === 'error') {
        throw new Error(String((m && m.message) || (json && json.exception) || 'Request failed').replace(/<[^>]+>/g, ''));
      }
      return m;
    });
  }

  function toast(msg, bad) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:1400;background:' + (bad ? '#9f1239' : '#0f3d3e') + ';color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 12px 30px rgba(15,23,42,.25);font-size:14px;max-width:420px';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4500);
  }

  function notice(msg, bad) {
    var host = document.querySelector('.me-hr, .people-panel, .me-punch') || document.body;
    var el = host.querySelector('[data-pchk-notice]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-pchk-notice', '1');
      el.style.cssText = 'margin:10px 0;padding:10px 12px;border-radius:10px;font-size:14px';
      var punch = host.querySelector('.me-punch, .people-actions');
      if (punch && punch.parentNode) punch.parentNode.insertBefore(el, punch.nextSibling);
      else host.insertBefore(el, host.firstChild);
    }
    el.style.background = bad ? '#fef2f2' : '#ecfdf5';
    el.style.color = bad ? '#991b1b' : '#065f46';
    el.style.border = '1px solid ' + (bad ? '#fecaca' : '#a7f3d0');
    el.textContent = msg;
  }

  function readGps(required) {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        if (required) resolve({ error: 'Geolocation is not available in this browser' });
        else resolve({});
        return;
      }
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        if (required) resolve({ error: 'Location timed out. Allow location and try again.' });
        else resolve({ warn: 'Location timed out' });
      }, 10000);
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        },
        function (err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          var msg = err && err.message ? String(err.message) : 'Unable to read GPS location';
          if (/permissions policy/i.test(msg)) {
            msg =
              'Location is blocked by this portal. Ask IT to allow geolocation for people.e-remedium.in (Permissions-Policy), then hard-refresh and try again.';
          }
          if (required) resolve({ error: msg });
          else resolve({ warn: msg });
        },
        { enableHighAccuracy: true, timeout: 9000, maximumAge: 15000 },
      );
    });
  }

  function isPunchButton(el) {
    if (!el || el.tagName !== 'BUTTON') return null;
    var label = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (label.indexOf('checking') === 0) return null;
    if (label === 'check in' || label.indexOf('check in') === 0) return 'IN';
    if (label === 'check out' || label.indexOf('check out') === 0) return 'OUT';
    return null;
  }

  function nearAttendanceUi(btn) {
    return !!(btn.closest('.me-punch') || btn.closest('.me-hr') || btn.closest('.people-actions') || btn.closest('.people-panel'));
  }

  function refreshStatus(att) {
    if (!att) return;
    var cards = document.querySelectorAll('.me-card-head p, .people-panel header p');
    cards.forEach(function (p) {
      if (!/Today:/i.test(p.textContent || '')) return;
      var last = att.last_checkin;
      var lastBit = last && last.time
        ? ' · last ' + (last.log_type || '') + ' at ' + String(last.time).slice(0, 16).replace('T', ' ')
        : '';
      p.textContent = 'Today: ' + (att.today_status || '—') + lastBit;
    });
  }

  function punch(logType, btn) {
    if (busy) return;
    var now = Date.now();
    if (now - lastPunchAt < 1500) return;
    busy = true;
    lastPunchAt = now;
    var old = btn.textContent;
    btn.disabled = true;
    btn.textContent = logType === 'IN' ? 'Checking in…' : 'Checking out…';
    notice(logType === 'IN' ? 'Recording check-in…' : 'Recording check-out…', false);

    call('api.get_people_hrms_dashboard', {}).then(function (res) {
      var data = (res && res.data) || res || {};
      var att = data.attendance || {};
      var required = !!Number(att.geofence_required || 0);
      var next = String(att.next_log_type || '').toUpperCase();
      if (next && next !== logType) {
        // Allow either button, but warn when sequence looks swapped.
        notice('Last status: ' + (att.today_status || 'Not checked in') + '. Recording ' + logType + '…', false);
      }
      return readGps(required).then(function (loc) {
        if (loc.error) throw new Error(loc.error);
        var body = { log_type: logType };
        if (loc.latitude != null && loc.longitude != null) {
          body.latitude = loc.latitude;
          body.longitude = loc.longitude;
        }
        return call('api.submit_employee_checkin', body).then(function (out) {
          var msg = (out && out.message) || (logType === 'IN' ? 'Checked in' : 'Checked out');
          if (out && out.data && out.data.checkin && out.data.checkin.deduped) {
            msg = 'Already recorded · ' + msg;
          }
          if (loc.latitude != null) msg += ' · location saved';
          else if (loc.warn) msg += ' · location unavailable (geofencing off)';
          notice(msg, false);
          toast(msg, false);
          return call('api.get_people_hrms_dashboard', {}).then(function (res2) {
            var data2 = (res2 && res2.data) || res2 || {};
            refreshStatus(data2.attendance || {});
          });
        });
      });
    }).catch(function (e) {
      var msg = (e && e.message) || 'Could not record attendance';
      notice(msg, true);
      toast(msg, true);
    }).then(function () {
      busy = false;
      btn.disabled = false;
      btn.textContent = old;
    });
  }

  document.addEventListener('click', function (e) {
    if (!signedIn()) return;
    var btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!btn || !nearAttendanceUi(btn)) return;
    var logType = isPunchButton(btn);
    if (!logType) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    punch(logType, btn);
  }, true);
})();
