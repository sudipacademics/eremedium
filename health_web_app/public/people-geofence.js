/* Geofence locations: Add / Edit opens a popup with a working map, address search and GPS pick. */
(function () {
  var API = '/api/method/health_ecosystem_core.health_ecosystem_core.api.';
  var RMIN = 50;
  var RMAX = 500;
  var board = null;
  var loading = null;
  var open = false;

  function onPage() {
    return /\/people\/settings\/geofencing\/?$/.test(location.pathname);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function call(method, extra) {
    var body = new URLSearchParams(extra || {});
    try {
      var s = JSON.parse(localStorage.getItem('hec_web_session') || 'null');
      if (s && s.sid) body.set('sid', s.sid);
    } catch (e) {}
    return fetch(API + method, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Frappe-Site-Name': 'health.localhost' },
      body: body,
    }).then(function (r) { return r.json(); }).then(function (json) {
      var m = json && json.message && typeof json.message === 'object' ? json.message : json;
      if (m && m.status === 'error') throw new Error(String(m.message || 'Request failed').replace(/<[^>]+>/g, ''));
      return m && m.data !== undefined ? m.data : m;
    });
  }

  function loadBoard(force) {
    if (board && !force) return Promise.resolve(board);
    if (loading && !force) return loading;
    loading = call('get_people_geofences').then(function (d) { board = d; loading = null; return d; }).catch(function (e) { loading = null; throw e; });
    return loading;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function loadGoogle(key) {
    if (window.google && window.google.maps && window.google.maps.Map) return Promise.resolve(window.google.maps);
    if (!key) return Promise.reject(new Error('no key'));
    if (!window.__gfGoogle) {
      window.__gfGoogle = loadScript('https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&v=weekly').then(function () {
        if (!(window.google && window.google.maps && window.google.maps.Map)) throw new Error('maps failed');
        return window.google.maps;
      });
    }
    return window.__gfGoogle;
  }

  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (!document.querySelector('link[data-gf-leaflet]')) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      css.setAttribute('data-gf-leaflet', '1');
      document.head.appendChild(css);
    }
    return loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js').then(function () { return window.L; });
  }

  function round6(n) { return Math.round(Number(n) * 1e6) / 1e6; }

  function popup(loc) {
    if (open) return;
    open = true;
    var editing = !!(loc && loc.id);
    var hq = (board && board.hq) || {};
    var v = {
      id: loc && loc.id || '',
      title: loc && loc.title || '',
      subtitle: loc && (loc.subtitle || loc.site_type) || '',
      address: loc && loc.address || '',
      latitude: loc && loc.latitude || 0,
      longitude: loc && loc.longitude || 0,
      radius_m: Math.max(RMIN, Math.min(RMAX, Number(loc && loc.radius_m) || 100)),
      status: loc && loc.status || 'Active',
      department: loc && loc.department || '',
      tone: loc && loc.tone || 'blue',
    };
    var depts = (board && board.departments) || [];
    var overlay = document.createElement('div');
    overlay.className = 'gfp-backdrop';
    overlay.innerHTML =
      '<form class="gfp-card">' +
      '<header><div><h2>' + (editing ? 'Edit Geofence' : 'Add Geofence') + '</h2><p>Click the map or drag the pin to set the exact work location.</p></div>' +
      '<button type="button" class="gfp-x" data-gfp-close aria-label="Close">×</button></header>' +
      '<div class="gfp-body"><div class="gfp-fields">' +
      '<label>Location name *<input name="title" required maxlength="140" value="' + esc(v.title) + '" placeholder="e.g. Central Office" /></label>' +
      '<label>Site type<input name="subtitle" maxlength="140" value="' + esc(v.subtitle) + '" placeholder="e.g. Head office, Lab, Collection centre" /></label>' +
      '<label>Address *<span class="gfp-row"><textarea name="address" rows="2" placeholder="Type the address, then Find">' + esc(v.address) + '</textarea>' +
      '<button type="button" class="gfp-btn" data-gfp-find>Find</button></span></label>' +
      '<div class="gfp-two"><label>Latitude *<input name="latitude" inputmode="decimal" value="' + (v.latitude || '') + '" /></label>' +
      '<label>Longitude *<input name="longitude" inputmode="decimal" value="' + (v.longitude || '') + '" /></label></div>' +
      '<label>Radius: <b data-gfp-rlabel>' + v.radius_m + ' m</b><span class="gfp-row"><input type="range" name="radius_range" min="' + RMIN + '" max="' + RMAX + '" step="10" value="' + v.radius_m + '" />' +
      '<input type="number" name="radius_m" min="' + RMIN + '" max="' + RMAX + '" value="' + v.radius_m + '" class="gfp-num" /></span>' +
      '<small>Recommended 50 – 500 m. Phone GPS can drift 20 – 50 m indoors.</small></label>' +
      '<label>Department<select name="department"><option value="">All departments</option>' +
      depts.map(function (d) { return '<option' + (d === v.department ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select></label>' +
      '<label class="gfp-switch-row"><input type="checkbox" name="status"' + (v.status === 'Active' ? ' checked' : '') + ' /> Active</label>' +
      '</div><div class="gfp-mapcol"><div class="gfp-maptools"><span data-gfp-coords></span><button type="button" class="gfp-link" data-gfp-gps>◎ Use my location</button></div>' +
      '<div class="gfp-map" data-gfp-map><p>Loading map…</p></div></div></div>' +
      '<p class="gfp-err" data-gfp-err></p>' +
      '<footer><button type="button" class="gfp-btn" data-gfp-close>Cancel</button><button type="submit" class="gfp-btn primary">Save Geofence</button></footer></form>';
    document.body.appendChild(overlay);
    document.body.classList.add('gfp-lock');
    var form = overlay.querySelector('form');
    var err = overlay.querySelector('[data-gfp-err]');
    var coords = overlay.querySelector('[data-gfp-coords]');
    var mapApi = null;

    function close() {
      overlay.remove();
      document.body.classList.remove('gfp-lock');
      open = false;
    }
    overlay.querySelectorAll('[data-gfp-close]').forEach(function (b) { b.addEventListener('click', close); });
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });

    function showCoords() {
      coords.textContent = v.latitude && v.longitude ? round6(v.latitude) + ', ' + round6(v.longitude) : 'No point selected yet';
    }

    function setPoint(lat, lng, fromMap) {
      v.latitude = round6(lat);
      v.longitude = round6(lng);
      form.elements.latitude.value = v.latitude;
      form.elements.longitude.value = v.longitude;
      showCoords();
      if (mapApi) mapApi.move(v.latitude, v.longitude, !fromMap);
      if (fromMap && mapApi && mapApi.reverse && !form.elements.address.value.trim()) {
        mapApi.reverse(v.latitude, v.longitude, function (addr) { if (addr && !form.elements.address.value.trim()) form.elements.address.value = addr; });
      }
    }

    function setRadius(r) {
      v.radius_m = Math.max(RMIN, Math.min(RMAX, Math.round(Number(r) || 100)));
      form.elements.radius_range.value = v.radius_m;
      form.elements.radius_m.value = v.radius_m;
      overlay.querySelector('[data-gfp-rlabel]').textContent = v.radius_m + ' m';
      if (mapApi) mapApi.radius(v.radius_m);
    }

    form.elements.radius_range.addEventListener('input', function () { setRadius(form.elements.radius_range.value); });
    form.elements.radius_m.addEventListener('change', function () { setRadius(form.elements.radius_m.value); });
    ['latitude', 'longitude'].forEach(function (k) {
      form.elements[k].addEventListener('change', function () {
        var lat = parseFloat(form.elements.latitude.value);
        var lng = parseFloat(form.elements.longitude.value);
        if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) setPoint(lat, lng, false);
      });
    });

    overlay.querySelector('[data-gfp-find]').addEventListener('click', function () {
      var address = form.elements.address.value.trim();
      err.textContent = '';
      if (!address) { err.textContent = 'Type an address first.'; return; }
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Finding…';
      var done = function () { btn.disabled = false; btn.textContent = 'Find'; };
      call('geocode_people_geofence_address', { address: address }).then(function (d) {
        setPoint(d.latitude, d.longitude, false);
        done();
      }).catch(function (e) {
        if (mapApi && mapApi.geocode) {
          mapApi.geocode(address, function (lat, lng) {
            done();
            if (lat == null) err.textContent = (e && e.message) || 'Address not found. Pick the point on the map.';
            else setPoint(lat, lng, false);
          });
        } else {
          done();
          err.textContent = (e && e.message) || 'Address not found. Pick the point on the map.';
        }
      });
    });

    overlay.querySelector('[data-gfp-gps]').addEventListener('click', function () {
      err.textContent = '';
      if (!navigator.geolocation) { err.textContent = 'This browser cannot read GPS location.'; return; }
      navigator.geolocation.getCurrentPosition(
        function (pos) { setPoint(pos.coords.latitude, pos.coords.longitude, true); },
        function () { err.textContent = 'Location permission denied. Pick the point on the map instead.'; },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = '';
      var title = form.elements.title.value.trim();
      var lat = parseFloat(form.elements.latitude.value);
      var lng = parseFloat(form.elements.longitude.value);
      if (!title) { err.textContent = 'Location name is required.'; return; }
      if (!form.elements.address.value.trim()) { err.textContent = 'Address is required.'; return; }
      if (!isFinite(lat) || !isFinite(lng) || (!lat && !lng)) { err.textContent = 'Set the location on the map, use Find, or enter latitude and longitude.'; return; }
      var payload = {
        title: title,
        subtitle: form.elements.subtitle.value.trim(),
        site_type: form.elements.subtitle.value.trim(),
        address: form.elements.address.value.trim(),
        latitude: round6(lat),
        longitude: round6(lng),
        radius_m: v.radius_m,
        status: form.elements.status.checked ? 'Active' : 'Inactive',
        department: form.elements.department.value,
        tone: v.tone,
      };
      if (v.id) payload.id = v.id;
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      call('save_people_geofence', { geofence: JSON.stringify(payload) }).then(function () {
        close();
        location.reload();
      }).catch(function (e2) {
        btn.disabled = false;
        btn.textContent = 'Save Geofence';
        err.textContent = (e2 && e2.message) || 'Unable to save geofence';
      });
    });

    showCoords();
    var start = v.latitude && v.longitude ? { lat: v.latitude, lng: v.longitude } : { lat: Number(hq.latitude) || 22.5726, lng: Number(hq.longitude) || 88.3639 };
    var mapEl = overlay.querySelector('[data-gfp-map]');

    loadGoogle(board && board.google_maps_api_key).then(function (g) {
      if (!document.body.contains(mapEl)) return;
      mapEl.innerHTML = '';
      var map = new g.Map(mapEl, { center: start, zoom: v.latitude ? 17 : 12, mapTypeControl: true, streetViewControl: false, fullscreenControl: true, clickableIcons: false });
      var marker = new g.Marker({ map: map, position: start, draggable: true });
      var circle = new g.Circle({ map: map, center: start, radius: v.radius_m, strokeColor: '#1d6b78', strokeWeight: 2, fillColor: '#1d6b78', fillOpacity: 0.16, clickable: false });
      var geocoder = g.Geocoder ? new g.Geocoder() : null;
      map.addListener('click', function (ev) { if (ev.latLng) setPoint(ev.latLng.lat(), ev.latLng.lng(), true); });
      marker.addListener('dragend', function () { var p = marker.getPosition(); if (p) setPoint(p.lat(), p.lng(), true); });
      mapApi = {
        move: function (lat, lng, pan) { var p = { lat: lat, lng: lng }; marker.setPosition(p); circle.setCenter(p); if (pan) { map.setCenter(p); map.setZoom(17); } },
        radius: function (r) { circle.setRadius(r); },
        geocode: geocoder ? function (address, cb) {
          geocoder.geocode({ address: address }, function (res, status) {
            if (status === 'OK' && res && res[0]) cb(res[0].geometry.location.lat(), res[0].geometry.location.lng());
            else cb(null, null);
          });
        } : null,
        reverse: geocoder ? function (lat, lng, cb) {
          geocoder.geocode({ location: { lat: lat, lng: lng } }, function (res, status) { cb(status === 'OK' && res && res[0] ? res[0].formatted_address : ''); });
        } : null,
      };
    }).catch(function () {
      return loadLeaflet().then(function (L) {
        if (!document.body.contains(mapEl)) return;
        mapEl.innerHTML = '';
        var map = L.map(mapEl).setView([start.lat, start.lng], v.latitude ? 17 : 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
        var marker = L.marker([start.lat, start.lng], { draggable: true }).addTo(map);
        var circle = L.circle([start.lat, start.lng], { radius: v.radius_m, color: '#1d6b78', weight: 2, fillOpacity: 0.16 }).addTo(map);
        map.on('click', function (ev) { setPoint(ev.latlng.lat, ev.latlng.lng, true); });
        marker.on('dragend', function () { var p = marker.getLatLng(); setPoint(p.lat, p.lng, true); });
        setTimeout(function () { map.invalidateSize(); }, 150);
        mapApi = {
          move: function (lat, lng, pan) { marker.setLatLng([lat, lng]); circle.setLatLng([lat, lng]); if (pan) map.setView([lat, lng], 17); },
          radius: function (r) { circle.setRadius(r); },
        };
      });
    }).catch(function () {
      mapEl.innerHTML = '<p>Map could not load. Use Find or type latitude and longitude.</p>';
    });
  }

  function rowLocation(tr) {
    var b = tr && tr.querySelector('.gf-loc b');
    var title = b ? b.textContent.trim() : '';
    var addrEl = tr && tr.querySelector('.gf-addr');
    var addr = addrEl ? addrEl.textContent.trim() : '';
    var list = (board && board.locations) || [];
    return list.filter(function (l) { return l.title === title && (!addr || l.address === addr); })[0] ||
      list.filter(function (l) { return l.title === title; })[0] || null;
  }

  function openFor(tr) {
    loadBoard(true).then(function () {
      var loc = rowLocation(tr);
      if (loc) popup(loc);
    }).catch(function (e) { alert((e && e.message) || 'Unable to load geofence'); });
  }

  document.addEventListener('click', function (e) {
    if (!onPage() || !e.target || !e.target.closest) return;
    var page = e.target.closest('.gf-page');
    if (!page) return;
    var addBtn = e.target.closest('.dep-head-actions .emp-btn.primary');
    if (addBtn) {
      e.preventDefault();
      e.stopPropagation();
      loadBoard().catch(function () {}).then(function () { popup(null); });
      return;
    }
    var link = e.target.closest('.gf-link');
    var tr = link && link.closest('tr');
    if (link && tr && tr.querySelector('.gf-loc')) {
      e.preventDefault();
      e.stopPropagation();
      openFor(tr);
    }
  }, true);

  var lastSelected = '';
  function watchSelection() {
    if (!onPage() || open) return;
    var tr = document.querySelector('.gf-page .emp-table tbody tr.on');
    var key = tr ? (tr.querySelector('.gf-loc b') || {}).textContent || '' : '';
    if (key && key !== lastSelected) {
      lastSelected = key;
      openFor(tr);
    } else if (!key) {
      lastSelected = '';
    }
  }

  function setReactValue(input, value) {
    var proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function siteSelects() {
    document.querySelectorAll('input[list="gf-emp-sites"]').forEach(function (input) {
      var list = document.getElementById('gf-emp-sites');
      var titles = list ? Array.prototype.map.call(list.querySelectorAll('option'), function (o) { return o.value; }).filter(Boolean) : [];
      var label = input.closest('label') || input.parentNode;
      var select = label.parentNode.querySelector('[data-gf-site-select]');
      var sig = titles.join('|');
      if (select && select.getAttribute('data-sig') === sig) {
        if (select.value !== input.value) select.value = titles.indexOf(input.value) !== -1 ? input.value : '';
        return;
      }
      if (!select) {
        var wrap = document.createElement('label');
        wrap.className = 'gf-site-pick';
        wrap.innerHTML = 'Saved geofence<select data-gf-site-select></select><span class="gf-hint">Choose a saved site to copy its name, address, point and radius.</span>';
        label.parentNode.insertBefore(wrap, label);
        select = wrap.querySelector('select');
        select.addEventListener('change', function () {
          if (select.value) setReactValue(input, select.value);
        });
      }
      select.setAttribute('data-sig', sig);
      select.innerHTML = '<option value="">' + (titles.length ? 'Select a saved geofence…' : 'No saved geofences yet') + '</option>' +
        titles.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('');
      select.value = titles.indexOf(input.value) !== -1 ? input.value : '';
    });
  }

  new MutationObserver(function () {
    if (onPage()) watchSelection();
    siteSelects();
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
})();
