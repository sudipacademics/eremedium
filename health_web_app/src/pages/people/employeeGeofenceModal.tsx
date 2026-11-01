import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, type EmployeeGeofenceSettings, type PeopleGeofence, type PeopleGeofenceEmployee } from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import { loadGoogleMaps } from '../../utils/googleMaps';

export const GEOFENCE_RADIUS_MIN = 20;
export const GEOFENCE_RADIUS_MAX = 5000;

type LatLng = { lat: number; lng: number };

type GLatLng = { lat: () => number; lng: () => number };
type GMapsEvent = { latLng?: GLatLng | null };
type GMap = {
  setCenter: (p: LatLng) => void;
  setZoom: (z: number) => void;
  addListener: (ev: string, fn: (e: GMapsEvent) => void) => void;
};
type GMarker = {
  setPosition: (p: LatLng) => void;
  getPosition: () => GLatLng | null;
  addListener: (ev: string, fn: () => void) => void;
};
type GCircle = { setCenter: (p: LatLng) => void; setRadius: (r: number) => void };
type GMaps = {
  Map: new (el: HTMLElement, o: Record<string, unknown>) => GMap;
  Marker: new (o: Record<string, unknown>) => GMarker;
  Circle: new (o: Record<string, unknown>) => GCircle;
};

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

function round6(n: number) {
  return Number(n.toFixed(6));
}

type PickerProps = {
  point: LatLng | null;
  fallbackCenter: LatLng;
  radius: number;
  mapsKey?: string;
  onPick: (lat: number, lng: number) => void;
};

function GooglePicker({ point, fallbackCenter, radius, mapsKey, onPick, onFail }: PickerProps & { onFail: () => void }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GMap | null>(null);
  const markerRef = useRef<GMarker | null>(null);
  const circleRef = useRef<GCircle | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const initial = useRef({ point, fallbackCenter, radius });

  useEffect(() => {
    let alive = true;
    loadGoogleMaps(mapsKey || '')
      .then((raw) => {
        if (!alive || !elRef.current) return;
        const gmaps = raw as unknown as GMaps;
        const start = initial.current.point || initial.current.fallbackCenter;
        const map = new gmaps.Map(elRef.current, {
          center: start,
          zoom: initial.current.point ? 17 : 12,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
        });
        const marker = new gmaps.Marker({ map, position: start, draggable: true });
        const circle = new gmaps.Circle({
          map,
          center: start,
          radius: initial.current.radius,
          strokeColor: '#1d6b78',
          strokeWeight: 2,
          fillColor: '#1d6b78',
          fillOpacity: 0.16,
          clickable: false,
        });
        map.addListener('click', (ev) => {
          if (ev.latLng) pickRef.current(ev.latLng.lat(), ev.latLng.lng());
        });
        marker.addListener('dragend', () => {
          const p = marker.getPosition();
          if (p) pickRef.current(p.lat(), p.lng());
        });
        mapRef.current = map;
        markerRef.current = marker;
        circleRef.current = circle;
      })
      .catch(() => {
        if (alive) onFail();
      });
    return () => {
      alive = false;
    };
  }, [mapsKey, onFail]);

  useEffect(() => {
    if (!point) return;
    markerRef.current?.setPosition(point);
    circleRef.current?.setCenter(point);
    mapRef.current?.setCenter(point);
  }, [point]);

  useEffect(() => {
    circleRef.current?.setRadius(radius);
  }, [radius]);

  return <div ref={elRef} className="gf-emp-map" role="application" aria-label="Google map — click or drag the pin to set the work location" />;
}

function LeafletPicker({ point, fallbackCenter, radius, onPick }: PickerProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const initial = useRef({ point, fallbackCenter, radius });

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const start = initial.current.point || initial.current.fallbackCenter;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    map.setView([start.lat, start.lng], initial.current.point ? 17 : 12);
    const icon = L.divIcon({ className: 'gf-pin', html: '<span style="background:#1d6b78"></span>', iconSize: [18, 18], iconAnchor: [9, 9] });
    const marker = L.marker([start.lat, start.lng], { icon, draggable: true }).addTo(map);
    const circle = L.circle([start.lat, start.lng], { radius: initial.current.radius, color: '#1d6b78', fillColor: '#1d6b78', fillOpacity: 0.16, weight: 2 }).addTo(map);
    map.on('click', (ev: L.LeafletMouseEvent) => pickRef.current(ev.latlng.lat, ev.latlng.lng));
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      pickRef.current(p.lat, p.lng);
    });
    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;
    const t = window.setTimeout(() => map.invalidateSize(), 60);
    return () => {
      window.clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!point) return;
    markerRef.current?.setLatLng([point.lat, point.lng]);
    circleRef.current?.setLatLng([point.lat, point.lng]);
    mapRef.current?.panTo([point.lat, point.lng]);
  }, [point]);

  useEffect(() => {
    circleRef.current?.setRadius(radius);
  }, [radius]);

  return <div ref={elRef} className="gf-emp-map" role="application" aria-label="Map — click or drag the pin to set the work location" />;
}

function LocationPicker(props: PickerProps) {
  const [google, setGoogle] = useState(Boolean(props.mapsKey));
  const [fallbackNote, setFallbackNote] = useState('');
  const fail = useRef(() => {
    setGoogle(false);
    setFallbackNote('Google Maps could not load — using the standard map instead.');
  }).current;
  return (
    <>
      {google ? <GooglePicker {...props} onFail={fail} /> : <LeafletPicker {...props} />}
      {fallbackNote ? <span className="gf-hint">{fallbackNote}</span> : null}
    </>
  );
}

export function EmployeeGeofenceModal({
  employee,
  locations,
  hq,
  mapsKey,
  preview,
  onClose,
  onSaved,
}: {
  employee: PeopleGeofenceEmployee;
  locations: PeopleGeofence[];
  hq?: { latitude: number; longitude: number };
  mapsKey?: string;
  preview?: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [form, setForm] = useState<EmployeeGeofenceSettings>({
    geofence_enabled: employee.geofence_enabled ? 1 : employee.work_latitude ? 0 : 1,
    geofence_label: employee.geofence_label || '',
    geofence_address: employee.geofence_address || '',
    work_latitude: employee.work_latitude || null,
    work_longitude: employee.work_longitude || null,
    geofence_radius_m: employee.geofence_radius_m || 100,
  });
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState('');

  const point = form.work_latitude && form.work_longitude ? { lat: form.work_latitude, lng: form.work_longitude } : null;
  const fallbackCenter = { lat: hq?.latitude || 22.5726, lng: hq?.longitude || 88.3639 };
  const radius = Math.min(GEOFENCE_RADIUS_MAX, Math.max(GEOFENCE_RADIUS_MIN, form.geofence_radius_m || 100));

  function set<K extends keyof EmployeeGeofenceSettings>(key: K, value: EmployeeGeofenceSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function pick(lat: number, lng: number) {
    setForm((f) => ({ ...f, work_latitude: round6(lat), work_longitude: round6(lng) }));
  }

  function applySite(title: string) {
    const loc = locations.find((l) => l.title === title);
    if (!loc) {
      set('geofence_label', title);
      return;
    }
    setForm((f) => ({
      ...f,
      geofence_label: loc.title,
      geofence_address: loc.address || f.geofence_address,
      work_latitude: loc.latitude ? round6(loc.latitude) : f.work_latitude,
      work_longitude: loc.longitude ? round6(loc.longitude) : f.work_longitude,
      geofence_radius_m: loc.radius_m || f.geofence_radius_m,
    }));
  }

  async function findAddress() {
    const address = (form.geofence_address || '').trim();
    if (!address) return;
    if (preview) return;
    setFinding(true);
    setError('');
    try {
      const res = await api.geocodePeopleGeofenceAddress(address);
      pick(res.data.latitude, res.data.longitude);
    } catch (e) {
      setError(errMsg(e, 'Address not found'));
    } finally {
      setFinding(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError('This browser cannot read GPS location.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => pick(pos.coords.latitude, pos.coords.longitude),
      () => setError('Location permission denied — pick the point on the map instead.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setError('');
    if (form.geofence_enabled && (!form.work_latitude || !form.work_longitude)) {
      setError('Pick the work location on the map.');
      return;
    }
    if (form.geofence_enabled && !form.geofence_label.trim()) {
      setError('Location / site name is required.');
      return;
    }
    if (preview) {
      onSaved(`Geofence saved for ${employee.name}`);
      return;
    }
    setBusy(true);
    try {
      await api.saveEmployeeGeofence(employee.id, { ...form, geofence_radius_m: radius });
      onSaved(`Geofence saved for ${employee.name}`);
    } catch (e) {
      setError(errMsg(e, 'Unable to save geofence'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hrms-modal-backdrop gf-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="hrms-modal hrms-employee-form gf-emp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gf-emp-title"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <div className="hrms-modal-head">
          <div>
            <p className="hrms-modal-kicker">
              {employee.id}
              {employee.department ? ` · ${employee.department}` : ''}
            </p>
            <h2 id="gf-emp-title">Edit geofence — {employee.name}</h2>
            <p className="muted">Check-in and check-out are only accepted when the employee's GPS is inside this circle.</p>
          </div>
          <button type="button" className="hrms-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error ? <div className="people-alert err">{error}</div> : null}
        {employee.override_active ? (
          <div className="gf-override-note">
            <HrmsIcon name="shield" size={15} />
            Geofencing is temporarily disabled for this employee
            {employee.override_until ? ` until ${employee.override_until}` : ''}. These settings apply again once HR re-enables it.
          </div>
        ) : null}

        <div className="gf-emp-grid">
          <div className="gf-emp-fields">
            <div className="gf-status-row gf-emp-toggle">
              <button
                type="button"
                className={`gf-switch${form.geofence_enabled ? ' on' : ''}`}
                aria-pressed={Boolean(form.geofence_enabled)}
                onClick={() => set('geofence_enabled', form.geofence_enabled ? 0 : 1)}
              >
                <i />
              </button>
              {form.geofence_enabled ? 'Geofencing enforced' : 'Geofencing off (punch from anywhere)'}
            </div>

            <label>
              Location / site name *
              <input
                list="gf-emp-sites"
                value={form.geofence_label}
                onChange={(e) => applySite(e.target.value)}
                placeholder="e.g. Rajarhat Corporate Office"
              />
              <datalist id="gf-emp-sites">
                {locations.map((l) => (
                  <option key={l.id} value={l.title} />
                ))}
              </datalist>
              <span className="gf-hint">Pick a saved site to copy its point and radius, or type a new name.</span>
            </label>

            <label>
              Address
              <span className="gf-addr-row">
                <textarea
                  rows={2}
                  value={form.geofence_address || ''}
                  onChange={(e) => set('geofence_address', e.target.value)}
                  placeholder="Building, street, area, city, PIN"
                />
                <button type="button" className="emp-btn" disabled={finding || !(form.geofence_address || '').trim()} onClick={() => void findAddress()}>
                  <HrmsIcon name="search" size={15} /> {finding ? 'Finding…' : 'Find'}
                </button>
              </span>
            </label>

            <div className="gf-emp-latlng">
              <label>
                Latitude *
                <input
                  type="number"
                  step="0.000001"
                  min={-90}
                  max={90}
                  value={form.work_latitude ?? ''}
                  onChange={(e) => set('work_latitude', e.target.value === '' ? null : Number(e.target.value))}
                />
              </label>
              <label>
                Longitude *
                <input
                  type="number"
                  step="0.000001"
                  min={-180}
                  max={180}
                  value={form.work_longitude ?? ''}
                  onChange={(e) => set('work_longitude', e.target.value === '' ? null : Number(e.target.value))}
                />
              </label>
            </div>

            <label>
              Allowed radius: <b>{radius} m</b>
              <span className="gf-radius-row">
                <input
                  type="range"
                  min={GEOFENCE_RADIUS_MIN}
                  max={1000}
                  step={10}
                  value={Math.min(radius, 1000)}
                  onChange={(e) => set('geofence_radius_m', Number(e.target.value))}
                />
                <input
                  type="number"
                  min={GEOFENCE_RADIUS_MIN}
                  max={GEOFENCE_RADIUS_MAX}
                  value={form.geofence_radius_m || ''}
                  onChange={(e) => set('geofence_radius_m', Number(e.target.value) || 0)}
                />
              </span>
              <span className="gf-hint">
                {GEOFENCE_RADIUS_MIN} – {GEOFENCE_RADIUS_MAX} m. 50 – 200 m suits most offices; phone GPS can drift 20 – 50 m indoors.
              </span>
            </label>
          </div>

          <div className="gf-emp-mapcol">
            <div className="gf-emp-maphead">
              <span>Click the map or drag the pin to set the exact work location</span>
              <button type="button" className="gf-link" onClick={useMyLocation}>
                <HrmsIcon name="pin" size={14} /> Use my location
              </button>
            </div>
            <LocationPicker point={point} fallbackCenter={fallbackCenter} radius={radius} mapsKey={mapsKey} onPick={pick} />
            <span className="gf-hint">{point ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` : 'No point selected yet'}</span>
          </div>
        </div>

        <div className="hrms-modal-actions">
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save geofence'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function GeofenceOverrideModal({
  employee,
  preview,
  onClose,
  onSaved,
}: {
  employee: PeopleGeofenceEmployee;
  preview?: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const todayIso = new Date().toISOString().slice(0, 10);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!reason.trim()) {
      setError('Enter the reason / approved location.');
      return;
    }
    if (preview) {
      onSaved(`Geofencing temporarily disabled for ${employee.name}`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.setEmployeeGeofenceOverride(employee.id, true, reason.trim(), until || undefined);
      onSaved(`Geofencing temporarily disabled for ${employee.name}`);
    } catch (e) {
      setError(errMsg(e, 'Unable to update geofencing'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hrms-modal-backdrop gf-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="hrms-modal hrms-employee-form gf-ovr-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gf-ovr-title"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <div className="hrms-modal-head">
          <div>
            <p className="hrms-modal-kicker">{employee.name}</p>
            <h2 id="gf-ovr-title">Temporarily disable geofencing</h2>
            <p className="muted">
              The employee can check in/out from any location (GPS is still recorded) until you re-enable geofencing or the end date passes.
            </p>
          </div>
          <button type="button" className="hrms-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {error ? <div className="people-alert err">{error}</div> : null}
        <div className="hrms-form-grid">
          <label className="span-2">
            Reason / approved location *
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Deputed to Salt Lake client site for audit" />
          </label>
          <label className="span-2">
            Disable until (optional)
            <input type="date" min={todayIso} value={until} onChange={(e) => setUntil(e.target.value)} />
            <span className="gf-hint">Leave empty to keep it disabled until HR re-enables. The end date is inclusive.</span>
          </label>
        </div>
        <div className="hrms-modal-actions">
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Disable geofencing'}
          </button>
        </div>
      </form>
    </div>
  );
}
