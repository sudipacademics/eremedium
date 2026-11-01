import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PeopleGeofence } from '../../api';

const TONE: Record<string, string> = {
  blue: '#2563eb',
  green: '#16a34a',
  rose: '#e11d48',
  violet: '#7c3aed',
  purple: '#a855f7',
  amber: '#d97706',
  cyan: '#0891b2',
  orange: '#ea580c',
};

function pinIcon(color: string) {
  return L.divIcon({
    className: 'gf-pin',
    html: `<span style="background:${color}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

type Props = {
  locations: PeopleGeofence[];
  selectedId?: string | null;
  pick?: boolean;
  height?: number;
  onSelect?: (id: string) => void;
  onPick?: (lat: number, lng: number) => void;
};

export function PeopleGeofenceMap({ locations, selectedId, pick, height = 280, onSelect, onPick }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  const selectRef = useRef(onSelect);
  pickRef.current = onPick;
  selectRef.current = onSelect;

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.on('click', (ev: L.LeafletMouseEvent) => {
      pickRef.current?.(ev.latlng.lat, ev.latlng.lng);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: Array<[number, number]> = [];
    for (const loc of locations) {
      if (!loc.latitude || !loc.longitude) continue;
      const color = TONE[loc.tone || 'blue'] || TONE.blue;
      pts.push([loc.latitude, loc.longitude]);
      L.circle([loc.latitude, loc.longitude], {
        radius: loc.radius_m || 100,
        color,
        fillColor: color,
        fillOpacity: loc.status === 'Inactive' ? 0.08 : 0.18,
        weight: 2,
        dashArray: loc.status === 'Inactive' ? '6 4' : undefined,
      }).addTo(layer);
      const marker = L.marker([loc.latitude, loc.longitude], { icon: pinIcon(color) })
        .addTo(layer)
        .bindTooltip(`${loc.title} (${loc.radius_m} m)`, { permanent: true, direction: 'right', offset: [10, 0], className: 'gf-tip' });
      marker.on('click', () => selectRef.current?.(loc.id));
    }
    if (!pts.length) {
      map.setView([19.08, 72.88], 12);
      return;
    }
    if (pts.length === 1) {
      map.setView(pts[0], 14);
      return;
    }
    const bounds = L.latLngBounds(pts);
    const span = map.distance(bounds.getNorthEast(), bounds.getSouthWest());
    if (span > 80000) map.setView(pts[0], 12);
    else map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
  }, [locations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const loc = locations.find((l) => l.id === selectedId);
    if (!loc?.latitude || !loc.longitude) return;
    map.setView([loc.latitude, loc.longitude], Math.max(map.getZoom(), 14), { animate: true });
  }, [selectedId, locations]);

  return <div ref={elRef} className={`gf-map${pick ? ' pick' : ''}`} style={{ height }} role="img" aria-label="Geofence map" />;
}
