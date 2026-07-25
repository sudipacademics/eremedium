import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import { AiPhysicianCenter } from '../api';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

type Props = {
  centers: AiPhysicianCenter[];
  userLat?: number | null;
  userLng?: number | null;
  selectedId?: string | null;
  height?: number;
  onSelect?: (id: string) => void;
};

export function CentresNearMeMap({
  centers,
  userLat,
  userLng,
  selectedId,
  height = 420,
  onSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current.clear();

    const points: Array<[number, number]> = [];

    if (userLat != null && userLng != null) {
      points.push([userLat, userLng]);
      L.circleMarker([userLat, userLng], {
        radius: 8,
        color: '#0d9488',
        fillColor: '#0d9488',
        fillOpacity: 0.9,
        weight: 2,
      })
        .addTo(layer)
        .bindPopup('You are here');
    }

    for (const c of centers) {
      const lat = Number(c.latitude);
      const lng = Number(c.longitude);
      if (!lat || !lng) continue;
      points.push([lat, lng]);
      const marker = L.marker([lat, lng])
        .addTo(layer)
        .bindPopup(
          `<strong>${c.franchise_name}</strong>${
            c.distance_km != null ? `<br/>${c.distance_km} km` : ''
          }${c.address ? `<br/>${c.address}` : ''}`,
        );
      marker.on('click', () => onSelect?.(c.franchisee_id));
      markersRef.current.set(c.franchisee_id, marker);
    }

    if (!points.length) {
      map.setView([22.5, 78.9], 5);
      return;
    }
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
  }, [centers, userLat, userLng, onSelect]);

  useEffect(() => {
    if (!selectedId) return;
    const marker = markersRef.current.get(selectedId);
    const map = mapRef.current;
    if (!marker || !map) return;
    const ll = marker.getLatLng();
    map.setView(ll, Math.max(map.getZoom(), 13), { animate: true });
    marker.openPopup();
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      className="centres-map"
      style={{ height }}
      role="img"
      aria-label="Map of nearby Remedium centres"
    />
  );
}
