import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import { PhleboMapData, PhleboMapStop } from '../api';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

type Props = {
  data: PhleboMapData | null;
  onStopSelect?: (stop: PhleboMapStop) => void;
  height?: number;
};

function fitBounds(map: L.Map, points: Array<[number, number]>) {
  if (!points.length) return;
  if (points.length === 1) {
    map.setView(points[0], 14);
    return;
  }
  map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
}

export function PhlebotomistMap({ data, onStopSelect, height = 420 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

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
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!data) return;

    const points: Array<[number, number]> = [];

    if (data.hub?.hub_latitude && data.hub.hub_longitude) {
      const hubLat = data.hub.hub_latitude;
      const hubLng = data.hub.hub_longitude;
      points.push([hubLat, hubLng]);
      L.circle([hubLat, hubLng], {
        radius: data.hub.geofence_radius_m || 100,
        color: '#0d9488',
        fillColor: '#0d9488',
        fillOpacity: 0.12,
        weight: 2,
      }).addTo(layer);
      L.marker([hubLat, hubLng])
        .addTo(layer)
        .bindPopup(`<strong>Hub</strong><br/>${data.hub.franchise_name || data.hub.name}`);
    }

    if (data.phlebotomist?.on_duty && data.phlebotomist.latitude && data.phlebotomist.longitude) {
      const { latitude, longitude } = data.phlebotomist;
      points.push([latitude, longitude]);
      L.circleMarker([latitude, longitude], {
        radius: 9,
        color: '#1d4ed8',
        fillColor: '#3b82f6',
        fillOpacity: 0.95,
        weight: 2,
      })
        .addTo(layer)
        .bindPopup('<strong>You</strong><br/>On duty');
    }

    data.stops.forEach((stop) => {
      points.push([stop.latitude, stop.longitude]);
      const marker = L.marker([stop.latitude, stop.longitude]).addTo(layer);
      marker.bindPopup(
        `<strong>${stop.patient_name}</strong><br/>${stop.test_name || ''}<br/>${stop.collection_address || ''}`,
      );
      if (onStopSelect) {
        marker.on('click', () => onStopSelect(stop));
      }
    });

    if (data.route?.geometry?.length) {
      const latLngs = data.route.geometry.map(([lng, lat]) => [lat, lng] as [number, number]);
      L.polyline(latLngs, { color: '#1d4ed8', weight: 4, opacity: 0.75 }).addTo(layer);
      latLngs.forEach((p) => points.push(p));
    }

    fitBounds(map, points);
  }, [data, onStopSelect]);

  return <div className="phlebo-map" ref={containerRef} style={{ height }} aria-label="Collection map" />;
}
