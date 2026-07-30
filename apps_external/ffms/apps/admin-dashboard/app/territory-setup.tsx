'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { TerritoryCapacityOps } from './territory-capacity-ops';

const API_BASE = process.env.NEXT_PUBLIC_RFMS_API_URL ?? 'http://localhost:8080/api/v1';
const WEST_BENGAL_MAP_URL = '/west-bengal-national-highway-map.jpg';
const BAKED_GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? '';

async function resolveRuntimeGoogleMapsKey(token: string): Promise<string> {
  try {
    const response = await fetch(`${API_BASE}/admin/integrations/maps-key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const result = await response.json() as Envelope<{ google_maps_api_key?: string }>;
      const key = String(result?.data?.google_maps_api_key || '').trim();
      if (key) return key;
    }
  } catch {
    // Fall through to baked key for offline/dev.
  }
  return BAKED_GOOGLE_MAPS_API_KEY;
}

const FALLBACK_DISTRICTS = [
  'Alipurduar', 'Bankura', 'Birbhum', 'Cooch Behar', 'Dakshin Dinajpur', 'Darjeeling', 'Hooghly', 'Howrah',
  'Jalpaiguri', 'Jhargram', 'Kalimpong', 'Kolkata', 'Malda', 'Murshidabad', 'Nadia', 'North 24 Parganas',
  'Paschim Bardhaman', 'Paschim Medinipur', 'Purba Bardhaman', 'Purba Medinipur', 'Purulia', 'South 24 Parganas', 'Uttar Dinajpur',
];

type WbLocality = { block_area?: string; pincode?: string; post_office?: string };
type WbSubdivision = { name: string; localities?: WbLocality[] };
type WbDistrict = { name: string; subdivisions?: WbSubdivision[] };
type WbHierarchy = { districts?: WbDistrict[]; count?: number };
type MapStatusFilter = 'active' | 'all' | 'available' | 'reserved' | 'occupied';

function isActivePin(pin: PinCapacity): boolean {
  return pin.fofo.available > 0 || pin.foco.available > 0 || pin.fofo.reserved > 0 || pin.foco.reserved > 0
    || pin.fofo.occupied > 0 || pin.foco.occupied > 0 || pin.fofo.assigned > 0 || pin.foco.assigned > 0;
}

function isActiveTerritory(territory: Territory): boolean {
  return territory.pin_capacities.some(isActivePin)
    || territory.fofo.available > 0 || territory.foco.available > 0
    || territory.allocations.length > 0
    || territory.fofo.reserved > 0 || territory.foco.reserved > 0
    || territory.fofo.occupied > 0 || territory.foco.occupied > 0;
}

function pinMatchesFilter(pin: PinCapacity, filter: MapStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return isActivePin(pin);
  if (filter === 'available') return pin.fofo.available > 0 || pin.foco.available > 0;
  if (filter === 'reserved') return pin.status === 'reserved' || pin.status === 'partially_occupied' || pin.fofo.reserved > 0 || pin.foco.reserved > 0;
  return pin.status === 'occupied' || (pin.fofo.occupied > 0 || pin.foco.occupied > 0) && pin.fofo.available === 0 && pin.foco.available === 0;
}

function territoryMatchesFilter(territory: Territory, filter: MapStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return isActiveTerritory(territory);
  return territory.pin_capacities.some((pin) => pinMatchesFilter(pin, filter));
}

function districtsFromHierarchy(hierarchy: WbHierarchy | null): string[] {
  const names = (hierarchy?.districts || []).map((d) => d.name).filter(Boolean);
  return names.length ? names.sort((a, b) => a.localeCompare(b)) : FALLBACK_DISTRICTS;
}

function subdivisionsFromHierarchy(hierarchy: WbHierarchy | null, district: string): string[] {
  const row = (hierarchy?.districts || []).find((d) => d.name === district);
  return (row?.subdivisions || []).map((s) => s.name).filter(Boolean);
}

function knownPincodesFromHierarchy(hierarchy: WbHierarchy | null): Set<string> {
  const pins = new Set<string>();
  for (const district of hierarchy?.districts || []) {
    for (const subdivision of district.subdivisions || []) {
      for (const locality of subdivision.localities || []) {
        const pin = String(locality.pincode || '').replace(/\D/g, '');
        if (/^\d{6}$/.test(pin)) pins.add(pin);
      }
    }
  }
  return pins;
}

type ModelCounts = { capacity: number; reserved: number; occupied: number; assigned: number; available: number };
type PinCapacity = { pincode: string; fofo: ModelCounts; foco: ModelCounts; status: TerritoryStatus };
type TerritoryStatus = 'available' | 'reserved' | 'partially_occupied' | 'occupied';
type Allocation = { id: string; application_id: string; application_number: string; applicant_name: string; pincode: string; franchise_model: 'FOFO' | 'FOCO'; status: 'reserved' | 'occupied'; created_at: string };
type Territory = { id: string; state: string; district: string; subdivision: string; area: string; pincode: string; pincodes: string[]; pin_capacities: PinCapacity[]; radius_km: number; fofo_radius_km: number; foco_radius_km: number; map_x: number; map_y: number; label: string; status: TerritoryStatus; fofo: ModelCounts; foco: ModelCounts; allocations: Allocation[]; updated_at?: string };
type Metrics = { territories: number; fofo_available: number; foco_available: number; fofo_occupied: number; foco_occupied: number; reserved: number; occupied_territories: number };
type Applicant = { id: string; application_number: string; full_name: string; franchise_model: 'FOFO' | 'FOCO'; preferred_location: string; district: string; pincode: string };
type DraftPin = { pincode: string; fofo_available: string; foco_available: string };
type Draft = { state: string; district: string; subdivision: string; area: string; pinEntry: string; pins: DraftPin[]; fofo_radius_km: string; foco_radius_km: string };
type Envelope<T> = { success?: boolean; data?: T; error?: { message?: string } };
type MapPosition = { lat: number; lng: number };
type GoogleMapArtifact = { markers: any[]; circles: any[] };

const blankCounts: ModelCounts = { capacity: 0, reserved: 0, occupied: 0, assigned: 0, available: 0 };
const emptyDraft: Draft = { state: 'West Bengal', district: '', subdivision: '', area: '', pinEntry: '', pins: [], fofo_radius_km: '5', foco_radius_km: '10' };
const availability = (value: unknown) => Math.max(0, Number.parseInt(String(value), 10) || 0);

function statusFromCounts(fofo: ModelCounts, foco: ModelCounts): TerritoryStatus {
  const counts = [fofo, foco];
  const hasAvailableCapacity = counts.some((model) => model.available > 0);
  const hasAssignment = counts.some((model) => model.reserved > 0 || model.occupied > 0 || model.assigned > 0);
  if (hasAvailableCapacity) return hasAssignment ? 'partially_occupied' : 'available';
  const hasReservation = counts.some((model) => model.reserved > 0);
  const hasOccupiedAllocation = counts.some((model) => model.occupied > 0);
  return hasReservation && !hasOccupiedAllocation ? 'reserved' : 'occupied';
}

function normaliseTerritory(value: Territory): Territory {
  const legacyRadius = Number(value.radius_km) || 8;
  const pincodes = Array.isArray(value.pincodes) && value.pincodes.length ? value.pincodes : value.pincode ? [value.pincode] : [];
  const pin_capacities = Array.isArray(value.pin_capacities) && value.pin_capacities.length
    ? value.pin_capacities.map((pin) => {
      const fofo = pin.fofo ?? blankCounts;
      const foco = pin.foco ?? blankCounts;
      return { ...pin, fofo, foco, status: statusFromCounts(fofo, foco) };
    })
    : pincodes.map((pincode, index) => {
      const fofo = index === 0 ? value.fofo ?? blankCounts : blankCounts;
      const foco = index === 0 ? value.foco ?? blankCounts : blankCounts;
      return { pincode, fofo, foco, status: statusFromCounts(fofo, foco) };
    });
  const fofo = value.fofo ?? blankCounts;
  const foco = value.foco ?? blankCounts;
  return { ...value, pincodes, pin_capacities, fofo_radius_km: Number(value.fofo_radius_km) || legacyRadius, foco_radius_km: Number(value.foco_radius_km) || legacyRadius, fofo, foco, status: statusFromCounts(fofo, foco), allocations: Array.isArray(value.allocations) ? value.allocations : [] };
}

function draftFromTerritory(territory: Territory): Draft {
  return { state: 'West Bengal', district: territory.district, subdivision: territory.subdivision, area: territory.area, pinEntry: '', pins: territory.pin_capacities.map((pin) => ({ pincode: pin.pincode, fofo_available: String(pin.fofo.available), foco_available: String(pin.foco.available) })), fofo_radius_km: String(territory.fofo_radius_km), foco_radius_km: String(territory.foco_radius_km) };
}
function tone(status: TerritoryStatus) { return status === 'occupied' ? 'occupied' : status === 'reserved' || status === 'partially_occupied' ? 'reserved' : 'available'; }
function statusLabel(status: TerritoryStatus) {
  if (status === 'partially_occupied') return 'Partly available';
  if (status === 'reserved') return 'Fully reserved';
  if (status === 'occupied') return 'Fully occupied';
  return 'Available';
}
function dateLabel(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Just now' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
function isOfficerSessionExpired(response: Response) { if (response.status !== 401 && response.status !== 403) return false; window.dispatchEvent(new Event('rfms-session-expired')); return true; }

function modelAvailability(label: 'FOFO' | 'FOCO', counts: ModelCounts) {
  const allocations = [counts.reserved ? `${counts.reserved} reserved` : '', counts.occupied ? `${counts.occupied} occupied` : ''].filter(Boolean).join(', ');
  return `${label}: ${counts.available} available${allocations ? ` · ${allocations}` : ''}`;
}

function PinRows({ pins, compact = false }: { pins: PinCapacity[]; compact?: boolean }) {
  return <div className={`territory-pin-summary${compact ? ' compact' : ''}`}>{pins.map((pin) => <article key={pin.pincode} className={`territory-pin-summary-row ${tone(pin.status)}`}><header><b>PIN {pin.pincode}</b><span className={`territory-pin-status ${tone(pin.status)}`}>{statusLabel(pin.status)}</span></header><small>{modelAvailability('FOFO', pin.fofo)}</small><small>{modelAvailability('FOCO', pin.foco)}</small></article>)}</div>;
}

let googleMapsLoader: Promise<void> | null = null;
const googleGeocodeCache = new Map<string, MapPosition | null>();
const westBengalCentre: MapPosition = { lat: 22.9868, lng: 87.855 }; 

function loadGoogleMaps(apiKey: string) {
  if (typeof window === 'undefined' || (window as any).google?.maps) return Promise.resolve();
  if (googleMapsLoader) return googleMapsLoader;
  googleMapsLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps could not be loaded. Check the browser-restricted API key and enabled APIs.'));
    document.head.appendChild(script);
  });
  return googleMapsLoader;
}

function territoryPinAddress(territory: Territory, pin: PinCapacity) {
  return [pin.pincode, territory.area, territory.subdivision, territory.district, territory.state, 'India'].filter(Boolean).join(', ');
}

async function resolvePinPosition(geocoder: any, territory: Territory, pin: PinCapacity): Promise<MapPosition | null> {
  const cacheKey = `${territory.id}:${pin.pincode}:${territory.updated_at ?? ''}`;
  if (googleGeocodeCache.has(cacheKey)) return googleGeocodeCache.get(cacheKey) ?? null;
  try {
    const response = await geocoder.geocode({ address: territoryPinAddress(territory, pin), region: 'IN' });
    const location = response?.results?.[0]?.geometry?.location;
    const position = location ? { lat: location.lat(), lng: location.lng() } : null;
    googleGeocodeCache.set(cacheKey, position);
    return position;
  } catch {
    googleGeocodeCache.set(cacheKey, null);
    return null;
  }
}

function releaseGoogleArtifacts(artifacts: GoogleMapArtifact) {
  artifacts.markers.forEach((marker) => marker.setMap(null));
  artifacts.circles.forEach((circle) => circle.setMap(null));
  artifacts.markers = [];
  artifacts.circles = [];
}

function mapStatusColour(status: TerritoryStatus) {
  if (status === 'occupied') return '#d84a42';
  if (status === 'reserved' || status === 'partially_occupied') return '#de941b';
  return '#0aa6a6';
}

function mapInfoContent(territory: Territory, pin: PinCapacity) {
  const node = document.createElement('div');
  node.className = 'google-map-info';
  const title = document.createElement('strong'); title.textContent = territory.area;
  const address = document.createElement('span'); address.textContent = `${territory.subdivision}, ${territory.district}`;
  const code = document.createElement('b'); code.textContent = `PIN ${pin.pincode} — ${statusLabel(pin.status)}`;
  const counts = document.createElement('small'); counts.textContent = `${modelAvailability('FOFO', pin.fofo)} | ${modelAvailability('FOCO', pin.foco)}`;
  node.append(title, address, code, counts);
  return node;
}

function LegacyWestBengalMap({ territories, selectedId, onSelect }: { territories: Territory[]; selectedId: string; onSelect: (id: string) => void }) {
  const [zoom, setZoom] = useState(1);
  const selected = territories.find((territory) => territory.id === selectedId);
  return <section className="territory-map-card" aria-labelledby="west-bengal-map-title">
    <div className="territory-map-head"><div><p className="territory-kicker">Live territory coverage</p><h2 id="west-bengal-map-title">West Bengal territory map</h2><p>Area markers show the combined PIN-code capacity. Green is available, amber is reserved or partly occupied, and red is fully occupied.</p></div><div className="map-controls" aria-label="Map zoom controls"><button type="button" onClick={() => setZoom((value) => Math.min(1.45, Number((value + 0.15).toFixed(2))))} aria-label="Zoom in">+</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.max(0.85, Number((value - 0.15).toFixed(2))))} aria-label="Zoom out">−</button></div></div>
    <div className="territory-map-layout"><div className="territory-map-viewport" aria-label="Interactive map of West Bengal franchise territories"><div className="territory-map-stage actual-west-bengal" style={{ transform: `scale(${zoom})` }}><img src={WEST_BENGAL_MAP_URL} alt="West Bengal state map" loading="lazy" />{territories.map((territory) => <button key={territory.id} className={`territory-marker ${tone(territory.status)} ${selectedId === territory.id ? 'selected' : ''}`} style={{ left: `${territory.map_x}%`, top: `${territory.map_y}%`, '--fofo-radius': `${Math.min(58, 16 + territory.fofo_radius_km * 2.2)}px`, '--foco-radius': `${Math.min(74, 22 + territory.foco_radius_km * 2.2)}px` } as CSSProperties} type="button" onClick={() => onSelect(territory.id)} aria-pressed={selectedId === territory.id} aria-label={`${territory.area}, ${territory.district}: ${statusLabel(territory.status)}`}><span className="territory-radius foco" /><span className="territory-radius fofo" /><span className="territory-dot" /><span className="territory-marker-label">{territory.area}</span></button>)}</div></div><div className="territory-map-detail" aria-live="polite">{selected ? <><span className={`territory-status ${tone(selected.status)}`}>{statusLabel(selected.status)}</span><h3>{selected.area}</h3><p>{selected.subdivision}, {selected.district}</p><PinRows pins={selected.pin_capacities} /><div className="territory-map-counts"><span><b>{selected.fofo.available}</b> FOFO available<small>{selected.fofo_radius_km} km radius</small></span><span><b>{selected.foco.available}</b> FOCO available<small>{selected.foco_radius_km} km radius</small></span></div></> : <><h3>Select a territory marker</h3><p>Choose a marker to view its PIN-code capacity.</p></>}</div></div>
    <div className="territory-map-legend"><span><i className="available" /> Available capacity</span><span><i className="reserved" /> Reserved / partly occupied</span><span><i className="occupied" /> Fully occupied</span><small>Inner ring = FOFO radius. Outer ring = FOCO radius.</small></div>
  </section>;
}

function StaticWestBengalMap({ territories, selectedId, onSelect }: { territories: Territory[]; selectedId: string; onSelect: (id: string) => void }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const selected = territories.find((territory) => territory.id === selectedId);
  const adjustZoom = (change: number) => setZoom((value) => Math.min(2.4, Math.max(0.8, Number((value + change).toFixed(2)))));
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('.territory-marker')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    setPan({ x: origin.panX + event.clientX - origin.startX, y: origin.panY + event.clientY - origin.startY });
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current?.pointerId !== event.pointerId) return;
    dragOrigin.current = null;
    setDragging(false);
  };
  return <section className="territory-map-card" aria-labelledby="west-bengal-map-title">
    <div className="territory-map-head">
      <div><p className="territory-kicker">Live territory coverage</p><h2 id="west-bengal-map-title">West Bengal territory map</h2><p>The supplied National Highway map is the geographic base. Markers are aligned by locality; open a marker to see exactly which PIN is reserved and the FOFO/FOCO capacity still available for that PIN.</p></div>
      <div className="map-controls" aria-label="Map zoom controls"><button type="button" onClick={() => adjustZoom(0.2)} aria-label="Zoom in">+</button><span aria-live="polite">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => adjustZoom(-0.2)} aria-label="Zoom out">−</button><button className="map-reset" type="button" onClick={resetView} aria-label="Fit map to view">Fit</button></div>
    </div>
    <div className="territory-map-layout">
      <div className={`territory-map-viewport ${dragging ? 'dragging' : ''}`} aria-label="Interactive map of West Bengal franchise territories. Drag to pan, use controls to zoom." onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={resetView}>
        <div className="territory-map-stage actual-west-bengal" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <img src={WEST_BENGAL_MAP_URL} alt="National Highway map of West Bengal" loading="lazy" decoding="async" />
          {territories.map((territory) => <button key={territory.id} className={`territory-marker ${tone(territory.status)} ${selectedId === territory.id ? 'selected' : ''}`} style={{ left: `${territory.map_x}%`, top: `${territory.map_y}%`, '--fofo-radius': `${Math.min(58, 16 + territory.fofo_radius_km * 2.2)}px`, '--foco-radius': `${Math.min(74, 22 + territory.foco_radius_km * 2.2)}px` } as CSSProperties} type="button" onClick={() => onSelect(territory.id)} aria-pressed={selectedId === territory.id} aria-label={`${territory.area}, ${territory.district}: ${statusLabel(territory.status)}`}><span className="territory-radius foco" /><span className="territory-radius fofo" /><span className="territory-dot" /><span className="territory-marker-label">{territory.area}</span></button>)}
        </div>
      </div>
      <div className="territory-map-detail" aria-live="polite">{selected ? <><span className={`territory-status ${tone(selected.status)}`}>{statusLabel(selected.status)}</span><h3>{selected.area}</h3><p>{selected.subdivision}, {selected.district}</p><PinRows pins={selected.pin_capacities} /><div className="territory-map-counts"><span><b>{selected.fofo.available}</b> FOFO available<small>{selected.fofo_radius_km} km radius</small></span><span><b>{selected.foco.available}</b> FOCO available<small>{selected.foco_radius_km} km radius</small></span></div></> : <><h3>Select a territory marker</h3><p>Choose a marker to view its PIN-code capacity.</p></>}</div>
    </div>
    <div className="territory-map-legend"><span><i className="available" /> Fully available</span><span><i className="reserved" /> Partly available / fully reserved</span><span><i className="occupied" /> Fully occupied</span><small>Drag to pan · Double-click or Fit to recenter · Inner ring = FOFO radius · Outer ring = FOCO radius.</small></div>
  </section>;
}

function GoogleTerritoryMap({ territories, selectedId, onSelect, apiKey, statusFilter, onStatusFilterChange }: {
  territories: Territory[];
  selectedId: string;
  onSelect: (id: string) => void;
  apiKey: string;
  statusFilter: MapStatusFilter;
  onStatusFilterChange: (filter: MapStatusFilter) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const artifactsRef = useRef<GoogleMapArtifact>({ markers: [], circles: [] });
  const positionsRef = useRef(new Map<string, MapPosition>());
  const fittedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const mapTerritories = useMemo(
    () => territories.filter((territory) => territoryMatchesFilter(territory, statusFilter)),
    [territories, statusFilter],
  );
  const selected = territories.find((territory) => territory.id === selectedId);
  const legendCounts = useMemo(() => {
    let available = 0;
    let reserved = 0;
    let occupied = 0;
    let active = 0;
    for (const territory of territories) {
      for (const pin of territory.pin_capacities) {
        if (isActivePin(pin)) active += 1;
        if (pin.fofo.available > 0 || pin.foco.available > 0) available += 1;
        if (pin.status === 'reserved' || pin.status === 'partially_occupied' || pin.fofo.reserved > 0 || pin.foco.reserved > 0) reserved += 1;
        if (pin.status === 'occupied' || ((pin.fofo.occupied > 0 || pin.foco.occupied > 0) && pin.fofo.available === 0 && pin.foco.available === 0)) occupied += 1;
      }
    }
    return { available, reserved, occupied, active, all: territories.reduce((sum, t) => sum + t.pin_capacities.length, 0) };
  }, [territories]);

  useEffect(() => {
    let cancelled = false;
    void loadGoogleMaps(apiKey).then(() => {
      if (cancelled || !canvasRef.current || mapRef.current) return;
      const google = (window as any).google;
      mapRef.current = new google.maps.Map(canvasRef.current, {
        center: westBengalCentre,
        zoom: 7,
        minZoom: 5,
        maxZoom: 18,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
      });
      setReady(true);
    }).catch((error: unknown) => {
      if (!cancelled) setMapError(error instanceof Error ? error.message : 'Google Maps could not be loaded.');
    });
    return () => { cancelled = true; releaseGoogleArtifacts(artifactsRef.current); };
  }, [apiKey]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    let cancelled = false;
    const map = mapRef.current;
    const google = (window as any).google;
    async function renderTerritories() {
      releaseGoogleArtifacts(artifactsRef.current);
      const geocoder = new google.maps.Geocoder();
      const entries = mapTerritories.flatMap((territory) =>
        territory.pin_capacities
          .filter((pin) => pinMatchesFilter(pin, statusFilter))
          .map((pin) => ({ territory, pin })),
      );
      const resolved = await Promise.all(entries.map(async ({ territory, pin }) => {
        const cacheKey = `${territory.id}:${pin.pincode}:${territory.updated_at ?? ''}`;
        const position = positionsRef.current.get(cacheKey) ?? await resolvePinPosition(geocoder, territory, pin);
        if (position) positionsRef.current.set(cacheKey, position);
        return { territory, pin, position };
      }));
      if (cancelled) return;
      const infoWindow = new google.maps.InfoWindow();
      const bounds = new google.maps.LatLngBounds();
      resolved.forEach(({ territory, pin, position }) => {
        if (!position) return;
        const colour = mapStatusColour(pin.status);
        const marker = new google.maps.Marker({
          map,
          position,
          title: `${territory.area} — PIN ${pin.pincode}: ${statusLabel(pin.status)}`,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: territory.id === selectedId ? 10 : 8, fillColor: colour, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 },
          zIndex: territory.id === selectedId ? 2 : 1,
        });
        marker.addListener('click', () => { onSelect(territory.id); infoWindow.setContent(mapInfoContent(territory, pin)); infoWindow.open({ map, anchor: marker }); });
        artifactsRef.current.markers.push(marker);
        bounds.extend(position);
        if (territory.id === selectedId) {
          [
            { radius: territory.fofo_radius_km * 1000, strokeOpacity: 0.65, fillOpacity: 0.08 },
            { radius: territory.foco_radius_km * 1000, strokeOpacity: 0.32, fillOpacity: 0.03 },
          ].forEach((ring, index) => {
            const circle = new google.maps.Circle({ map, center: position, radius: ring.radius, strokeColor: colour, strokeWeight: index === 0 ? 2 : 1, strokeOpacity: ring.strokeOpacity, fillColor: colour, fillOpacity: ring.fillOpacity, clickable: false });
            artifactsRef.current.circles.push(circle);
          });
        }
      });
      if (!fittedRef.current && !bounds.isEmpty()) { map.fitBounds(bounds, 48); fittedRef.current = true; }
    }
    void renderTerritories();
    return () => { cancelled = true; };
  }, [ready, mapTerritories, statusFilter, selectedId, onSelect]);

  const filters: Array<{ id: MapStatusFilter; label: string; count: number }> = [
    { id: 'active', label: 'Active', count: legendCounts.active },
    { id: 'all', label: 'All', count: legendCounts.all },
    { id: 'available', label: 'Available', count: legendCounts.available },
    { id: 'reserved', label: 'Reserved', count: legendCounts.reserved },
    { id: 'occupied', label: 'Occupied', count: legendCounts.occupied },
  ];

  return <section className="territory-map-card google-territory-map" aria-labelledby="west-bengal-map-title">
    <div className="territory-map-head">
      <div>
        <p className="territory-kicker">Live territory coverage</p>
        <h2 id="west-bengal-map-title">West Bengal territory map</h2>
        <p>Active markers are operational RFMS PINs with available FOFO/FOCO capacity or an allocation — not every postal directory row.</p>
      </div>
      <span className="google-map-live">Live Google Map</span>
    </div>
    <div className="map-status-filters" role="tablist" aria-label="Territory status filter">
      {filters.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={statusFilter === item.id}
          className={statusFilter === item.id ? 'active' : ''}
          onClick={() => onStatusFilterChange(item.id)}
        >
          {item.label} <small>{item.count}</small>
        </button>
      ))}
    </div>
    <div className="territory-map-layout"><div ref={canvasRef} className="google-map-canvas" aria-label="Interactive Google Map showing West Bengal franchise territory PIN-code locations" />
      <div className="territory-map-detail" aria-live="polite">{selected ? <><span className={`territory-status ${tone(selected.status)}`}>{statusLabel(selected.status)}</span><h3>{selected.area}</h3><p>{selected.subdivision}, {selected.district}</p><PinRows pins={selected.pin_capacities} /><div className="territory-map-counts"><span><b>{selected.fofo.available}</b> FOFO available<small>{selected.fofo_radius_km} km radius</small></span><span><b>{selected.foco.available}</b> FOCO available<small>{selected.foco_radius_km} km radius</small></span></div></> : <><h3>Select a territory PIN</h3><p>Select any coloured PIN marker to view its available capacity.</p></>}</div></div>
    {mapError ? <p className="google-map-error" role="alert">{mapError}</p> : null}
    <div className="territory-map-legend"><span><i className="available" /> Available ({legendCounts.available})</span><span><i className="reserved" /> Reserved / partly occupied ({legendCounts.reserved})</span><span><i className="occupied" /> Occupied ({legendCounts.occupied})</span><small>Default filter: Active only. Rings: inner = FOFO, outer = FOCO.</small></div>
  </section>;
}

function TerritoryMap({ token, territories, selectedId, onSelect }: { token: string; territories: Territory[]; selectedId: string; onSelect: (id: string) => void }) {
  const [apiKey, setApiKey] = useState(BAKED_GOOGLE_MAPS_API_KEY);
  const [resolved, setResolved] = useState(Boolean(BAKED_GOOGLE_MAPS_API_KEY));
  const [statusFilter, setStatusFilter] = useState<MapStatusFilter>('active');

  useEffect(() => {
    let cancelled = false;
    void resolveRuntimeGoogleMapsKey(token).then((key) => {
      if (cancelled) return;
      setApiKey(key);
      setResolved(true);
    });
    return () => { cancelled = true; };
  }, [token]);

  const filteredForStatic = useMemo(
    () => territories.filter((territory) => territoryMatchesFilter(territory, statusFilter)),
    [territories, statusFilter],
  );

  if (!resolved) return <section className="territory-map-card"><p>Loading map configuration…</p></section>;
  if (apiKey) {
    return (
      <GoogleTerritoryMap
        territories={territories}
        selectedId={selectedId}
        onSelect={onSelect}
        apiKey={apiKey}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />
    );
  }
  return <StaticWestBengalMap territories={filteredForStatic} selectedId={selectedId} onSelect={onSelect} />;
}

export function TerritorySetup({ token, search, notify }: { token: string; search: string; notify: (message: string) => void }) {
  const [territories, setTerritories] = useState<Territory[]>([]); const [metrics, setMetrics] = useState<Metrics>({ territories: 0, fofo_available: 0, foco_available: 0, fofo_occupied: 0, foco_occupied: 0, reserved: 0, occupied_territories: 0 }); const [unassignedApplicants, setUnassignedApplicants] = useState<Applicant[]>([]); const [selectedId, setSelectedId] = useState(''); const [draft, setDraft] = useState<Draft>(emptyDraft); const [editingId, setEditingId] = useState(''); const [showForm, setShowForm] = useState(false); const [selectedApplicationId, setSelectedApplicationId] = useState(''); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [directorySearch, setDirectorySearch] = useState('');
  const [wbHierarchy, setWbHierarchy] = useState<WbHierarchy | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(''); try { const response = await fetch(`${API_BASE}/territories`, { headers: { Authorization: `Bearer ${token}` } }); if (isOfficerSessionExpired(response)) return; const result = await response.json() as Envelope<{ territories: Territory[]; metrics: Metrics; unassigned_applications: Applicant[] }>; if (!response.ok || !result.success || !result.data) throw new Error(result.error?.message ?? 'Unable to load the territory register.'); const rows = result.data.territories.map(normaliseTerritory); setTerritories(rows); setMetrics(result.data.metrics); setUnassignedApplicants(result.data.unassigned_applications ?? []); setSelectedId((current) => rows.some((item) => item.id === current) ? current : rows[0]?.id ?? ''); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to load the territory register.'); } finally { setLoading(false); } }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_BASE}/geo/wb-hierarchy`)
      .then(async (response) => {
        const result = await response.json() as Envelope<WbHierarchy>;
        if (!cancelled && response.ok && result.success && result.data) setWbHierarchy(result.data);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const selected = territories.find((territory) => territory.id === selectedId) ?? null;
  const visibleTerritories = useMemo(() => {
    const query = (directorySearch.trim() || search.trim()).toLowerCase();
    if (!query) return territories;
    return territories.filter((territory) =>
      `${territory.state} ${territory.district} ${territory.subdivision} ${territory.area} ${territory.label} ${territory.pincodes.join(' ')}`
        .toLowerCase()
        .includes(query));
  }, [directorySearch, search, territories]);
  const matchingApplicants = useMemo(() => !selected ? [] : unassignedApplicants.filter((application) => { const pin = selected.pin_capacities.find((item) => item.pincode === application.pincode); return application.franchise_model === 'FOFO' ? (pin?.fofo.available ?? 0) > 0 : (pin?.foco.available ?? 0) > 0; }), [selected, unassignedApplicants]);
  const districts = useMemo(() => districtsFromHierarchy(wbHierarchy), [wbHierarchy]);
  const subdivisions = draft.district ? subdivisionsFromHierarchy(wbHierarchy, draft.district) : [];
  const knownPins = useMemo(() => knownPincodesFromHierarchy(wbHierarchy), [wbHierarchy]);
  const change = (field: keyof Draft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const chooseDistrict = (district: string) => setDraft((current) => ({ ...current, district, subdivision: '' }));
  const beginCreate = () => { setEditingId(''); setDraft(emptyDraft); setShowForm(true); setError(''); };
  const beginEdit = (territory: Territory) => { setSelectedId(territory.id); setEditingId(territory.id); setDraft(draftFromTerritory(territory)); setShowForm(true); setError(''); };
  const closeForm = () => { setShowForm(false); setEditingId(''); setDraft(emptyDraft); };
  const addPincode = () => {
    const pincode = draft.pinEntry.replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(pincode)) { setError('Enter a six-digit PIN code, then choose Add PIN.'); return; }
    if (draft.pins.some((pin) => pin.pincode === pincode)) { setError('This PIN code is already added.'); return; }
    if (knownPins.size && !knownPins.has(pincode)) {
      const proceed = window.confirm(`PIN ${pincode} is not in the ERP West Bengal postal directory. Add it anyway for an edge-case territory?`);
      if (!proceed) return;
    }
    setDraft((current) => ({ ...current, pins: [...current.pins, { pincode, fofo_available: '0', foco_available: '0' }], pinEntry: '' }));
    setError('');
  };
  const updatePin = (pincode: string, field: 'fofo_available' | 'foco_available', value: string) => setDraft((current) => ({ ...current, pins: current.pins.map((pin) => pin.pincode === pincode ? { ...pin, [field]: value.replace(/\D/g, '').slice(0, 3) } : pin) }));
  const removePin = (pincode: string) => setDraft((current) => ({ ...current, pins: current.pins.filter((pin) => pin.pincode !== pincode) }));
  async function saveTerritory(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!draft.pins.length) { setError('Add at least one PIN code.'); return; } if (!draft.pins.some((pin) => availability(pin.fofo_available) + availability(pin.foco_available) > 0)) { setError('Set FOFO or FOCO availability for at least one PIN code.'); return; } setSaving(true); setError(''); try { const payload = { state: 'West Bengal', district: draft.district, subdivision: draft.subdivision, area: draft.area, fofo_radius_km: draft.fofo_radius_km, foco_radius_km: draft.foco_radius_km, pin_capacities: draft.pins }; const response = await fetch(editingId ? `${API_BASE}/territories/${editingId}` : `${API_BASE}/territories`, { method: editingId ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (isOfficerSessionExpired(response)) return; const result = await response.json() as Envelope<Territory>; if (!response.ok || !result.success || !result.data) throw new Error(result.error?.message ?? 'Unable to save the territory.'); const savedId = result.data.id; closeForm(); await load(); setSelectedId(savedId); notify(editingId ? 'PIN-code availability updated' : 'Territory created'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save the territory.'); } finally { setSaving(false); } }
  async function assignTerritory() { if (!selected || !selectedApplicationId) { setError('Choose a paid application before assigning this territory.'); return; } setSaving(true); setError(''); try { const response = await fetch(`${API_BASE}/territories/${selected.id}/allocations`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: selectedApplicationId }) }); if (isOfficerSessionExpired(response)) return; const result = await response.json() as Envelope<{ territory: Territory }>; if (!response.ok || !result.success) throw new Error(result.error?.message ?? 'Unable to assign this application.'); setSelectedApplicationId(''); await load(); notify('Selected PIN capacity has been reserved'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to assign this application.'); } finally { setSaving(false); } }
  async function releaseAllocation(allocation: Allocation) { if (!selected || !window.confirm(`Release ${allocation.applicant_name}'s ${allocation.franchise_model} allocation?`)) return; setSaving(true); setError(''); try { const response = await fetch(`${API_BASE}/territories/${selected.id}/allocations/${allocation.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); if (isOfficerSessionExpired(response)) return; const result = await response.json() as Envelope<Territory>; if (!response.ok || !result.success) throw new Error(result.error?.message ?? 'Unable to release the allocation.'); await load(); notify('PIN-code allocation released'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to release the allocation.'); } finally { setSaving(false); } }
  return <section className="territory-setup"><div className="title-row"><div><p className="territory-kicker">Territory operations</p><h1>Territory control centre</h1><p>Set FOFO and FOCO availability for every individual PIN code. District and subdivision picklists come from the ERP West Bengal postal directory; open capacity only for PINs you choose.</p></div><button className="date" type="button" onClick={beginCreate}>+ Create territory</button></div><div className="territory-summary-grid"><article><span>FOFO available</span><b>{metrics.fofo_available}</b><small>{metrics.fofo_occupied} occupied franchise centres</small></article><article><span>FOCO available</span><b>{metrics.foco_available}</b><small>{metrics.foco_occupied} occupied franchise centres</small></article><article><span>Territories in register</span><b>{metrics.territories}</b><small>{metrics.reserved} active reservations</small></article><article><span>Fully occupied areas</span><b>{metrics.occupied_territories}</b><small>Based on all PIN capacities</small></article></div>{error ? <p className="territory-alert" role="alert">{error}</p> : null}
    <TerritoryCapacityOps token={token} territories={territories} onUpdated={load} notify={notify} />
    {showForm ? <section className="panel territory-form-panel"><div className="panel-head"><div><h2>{editingId ? 'Edit PIN-code availability' : 'Create a West Bengal territory'}</h2><p>Each PIN has its own FOFO and FOCO availability. A successful application deducts only from that applicant’s selected PIN.</p></div><button type="button" onClick={closeForm}>Cancel</button></div><form className="territory-form" onSubmit={saveTerritory}><label>State<select value="West Bengal" disabled><option>West Bengal</option></select></label><label>District<select required value={draft.district} onChange={(event) => chooseDistrict(event.target.value)}><option value="">Select district</option>{districts.map((district) => <option key={district}>{district}</option>)}</select></label><label>Subdivision<select required value={draft.subdivision} onChange={(event) => change('subdivision', event.target.value)} disabled={!draft.district}><option value="">{draft.district ? 'Select subdivision' : 'Choose district first'}</option>{subdivisions.map((subdivision) => <option key={subdivision}>{subdivision}</option>)}</select></label><label>Area / locality<input required value={draft.area} onChange={(event) => change('area', event.target.value)} placeholder="Officer enters area manually" /></label><label className="pincode-entry">Add PIN code<input inputMode="numeric" value={draft.pinEntry} onChange={(event) => change('pinEntry', event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="e.g. 700156" /><button type="button" onClick={addPincode}>Add PIN</button></label><div className="pin-capacity-editor" aria-live="polite"><div className="pin-capacity-head"><span>PIN code</span><span>FOFO available</span><span>FOCO available</span><span /></div>{draft.pins.map((pin) => <div className="pin-capacity-row" key={pin.pincode}><b>{pin.pincode}</b><input aria-label={`${pin.pincode} FOFO availability`} min="0" max="500" inputMode="numeric" value={pin.fofo_available} onChange={(event) => updatePin(pin.pincode, 'fofo_available', event.target.value)} /><input aria-label={`${pin.pincode} FOCO availability`} min="0" max="500" inputMode="numeric" value={pin.foco_available} onChange={(event) => updatePin(pin.pincode, 'foco_available', event.target.value)} /><button type="button" onClick={() => removePin(pin.pincode)} aria-label={`Remove PIN ${pin.pincode}`}>Remove</button></div>)}{!draft.pins.length ? <p className="pin-capacity-empty">Add one or more six-digit PIN codes, then set availability for each PIN.</p> : null}</div><label>FOFO radius (km)<input required min="1" max="100" type="number" value={draft.fofo_radius_km} onChange={(event) => change('fofo_radius_km', event.target.value)} /></label><label>FOCO radius (km)<input required min="1" max="100" type="number" value={draft.foco_radius_km} onChange={(event) => change('foco_radius_km', event.target.value)} /></label><div className="territory-form-actions"><button className="territory-primary" type="submit" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Save PIN capacities' : 'Create territory'}</button></div></form></section> : null}
    <TerritoryMap token={token} territories={territories} selectedId={selectedId} onSelect={setSelectedId} />
    <div className="territory-workspace"><section className="panel territory-register"><div className="panel-head"><div><h2>Territory directory</h2><p>{loading ? 'Loading live territory data...' : `${visibleTerritories.length} areas matched to the current search.`}</p></div><button type="button" onClick={() => void load()}>Refresh</button></div><label className="territory-directory-search"><span className="sr-only">Search territory</span><input type="search" value={directorySearch} onChange={(event) => setDirectorySearch(event.target.value)} placeholder="Search territory, PIN, district, subdivision…" autoComplete="off" /></label><div className="table-wrap"><table><thead><tr><th>Territory hierarchy</th><th>PIN-wise capacity</th><th>FOFO total</th><th>FOCO total</th><th>Map state</th><th /></tr></thead><tbody>{visibleTerritories.map((territory) => <tr key={territory.id} className={selectedId === territory.id ? 'territory-row-selected' : ''}><td><b>{territory.area}</b><br /><small>{territory.subdivision}, {territory.district}</small></td><td><PinRows pins={territory.pin_capacities} compact /></td><td><b>{territory.fofo.available} available</b><br /><small>{territory.fofo.occupied} occupied · {territory.fofo.reserved} reserved</small></td><td><b>{territory.foco.available} available</b><br /><small>{territory.foco.occupied} occupied · {territory.foco.reserved} reserved</small></td><td><span className={`territory-status ${tone(territory.status)}`}>{statusLabel(territory.status)}</span></td><td><button className="row-action" type="button" onClick={() => setSelectedId(territory.id)}>Open</button></td></tr>)}{!loading && !visibleTerritories.length ? <tr><td className="empty" colSpan={6}>{(directorySearch.trim() || search.trim()) ? 'No territories match that search. Try another name, PIN, district or subdivision.' : 'No territories match the current search.'}</td></tr> : null}</tbody></table></div></section><aside className="panel territory-detail-panel">{selected ? <><div className="panel-head"><div><p className="territory-kicker">Selected territory</p><h2>{selected.area}</h2><p>{selected.subdivision}, {selected.district}, West Bengal</p></div><button type="button" onClick={() => beginEdit(selected)}>Edit</button></div><PinRows pins={selected.pin_capacities} /><div className="territory-detail-meta"><span>PIN coverage <b>{selected.pincodes.length} PINs</b></span><span>FOFO <b>{selected.fofo.available} available</b></span><span>FOCO <b>{selected.foco.available} available</b></span><span>State <b>{statusLabel(selected.status)}</b></span></div><div className="territory-allocation-form"><h3>Reserve the applicant’s PIN</h3><p>Only applicants whose selected PIN belongs to this area and has model capacity are shown.</p><select value={selectedApplicationId} onChange={(event) => setSelectedApplicationId(event.target.value)} aria-label="Paid application to assign"><option value="">Choose an unassigned paid application</option>{matchingApplicants.map((applicant) => <option key={applicant.id} value={applicant.id}>{applicant.application_number} · {applicant.full_name} · {applicant.franchise_model} · PIN {applicant.pincode}</option>)}</select><button className="territory-primary" type="button" disabled={saving || !selectedApplicationId} onClick={() => void assignTerritory()}>Reserve PIN capacity</button>{!matchingApplicants.length ? <small>No unassigned paid applications match this area’s available PIN codes.</small> : null}</div><div className="territory-allocation-list"><h3>Franchisee status</h3>{selected.allocations.length ? selected.allocations.map((allocation) => <article key={allocation.id}><div><b>{allocation.applicant_name}</b><small>{allocation.application_number} · {allocation.franchise_model} · PIN {allocation.pincode} · {dateLabel(allocation.created_at)}</small></div><div className="allocation-actions"><span className={`territory-status ${allocation.status}`}>{allocation.status}</span><button type="button" className="allocation-release" onClick={() => void releaseAllocation(allocation)} disabled={saving}>Release</button></div></article>) : <p className="territory-empty">No franchisees are allocated to this territory yet.</p>}</div></> : <p className="territory-empty">Select a territory from the map or directory to manage its availability.</p>}</aside></div>
  </section>;
}
