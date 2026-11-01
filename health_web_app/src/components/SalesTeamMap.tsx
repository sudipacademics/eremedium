import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import { SalesTeamMapData } from '../api';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const HQ_RADIUS_M = 5000;

const DISTRICT_COLOURS = ['#0aa6a6', '#2563eb', '#ea580c', '#7c3aed', '#059669', '#db2777', '#0891b2', '#ca8a04'];

function districtColour(district: string): string {
  const key = String(district || 'Unspecified');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return DISTRICT_COLOURS[hash % DISTRICT_COLOURS.length];
}

type Props = {
  data: SalesTeamMapData | null;
  height?: number;
};

function fitBounds(map: L.Map, points: Array<[number, number]>) {
  if (!points.length) return;
  if (points.length === 1) {
    map.setView(points[0], 13);
    return;
  }
  map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
}

export function SalesTeamMap({ data, height = 420 }: Props) {
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
    const hqSeen = new Set<string>();

    for (const rep of data.reps) {
      if (rep.hq_latitude && rep.hq_longitude) {
        const key = `${rep.hq_latitude},${rep.hq_longitude}`;
        if (!hqSeen.has(key)) {
          hqSeen.add(key);
          points.push([rep.hq_latitude, rep.hq_longitude]);
          L.circle([rep.hq_latitude, rep.hq_longitude], {
            radius: HQ_RADIUS_M,
            color: '#7c3aed',
            fillColor: '#7c3aed',
            fillOpacity: 0.08,
            weight: 2,
            dashArray: '6 4',
          }).addTo(layer);
          L.marker([rep.hq_latitude, rep.hq_longitude])
            .addTo(layer)
            .bindPopup(`<strong>HQ</strong><br/>${rep.full_name} territory`);
        }
      }

      if (rep.latitude && rep.longitude) {
        points.push([rep.latitude, rep.longitude]);
        const color = rep.on_duty ? '#2563eb' : '#94a3b8';
        L.circleMarker([rep.latitude, rep.longitude], {
          radius: 9,
          color,
          fillColor: color,
          fillOpacity: 0.85,
          weight: 2,
        })
          .addTo(layer)
          .bindPopup(
            `<strong>${rep.full_name}</strong> (${rep.rep_code})<br/>${rep.designation || ''}<br/>${
              rep.on_duty ? 'On duty' : 'Off duty'
            }`,
          );
      }
    }

    for (const lead of data.leads) {
      if (!lead.latitude || !lead.longitude) continue;
      points.push([lead.latitude, lead.longitude]);
      const district = lead.district || lead.city || '';
      const colour = districtColour(district);
      L.circleMarker([lead.latitude, lead.longitude], {
        radius: 7,
        color: colour,
        fillColor: colour,
        fillOpacity: 0.9,
        weight: 2,
      })
        .addTo(layer)
        .bindPopup(
          `<strong>${lead.lead_name}</strong><br/>${district || 'Unspecified'}${
            lead.pincode ? ` · PIN ${lead.pincode}` : ''
          } · ${lead.status || ''}`,
        );
      if (district) {
        L.marker([lead.latitude, lead.longitude], {
          icon: L.divIcon({
            className: 'sales-district-label',
            html: `<span style="background:#fff;border:1px solid ${colour};border-radius:4px;padding:1px 4px;font:11px sans-serif;color:#163d61;white-space:nowrap">${district}</span>`,
            iconSize: [80, 18],
            iconAnchor: [40, -8],
          }),
        }).addTo(layer);
      }
    }

    fitBounds(map, points);
  }, [data]);

  return <div ref={containerRef} style={{ height, width: '100%', borderRadius: 8 }} />;
}
