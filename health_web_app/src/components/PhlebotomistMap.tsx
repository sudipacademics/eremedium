import { useEffect, useRef, useState } from 'react';

import { PhleboMapData, PhleboMapStop } from '../api';
import { usePhleboLiveCoords } from '../hooks/usePhleboGps';
import {
  GoogleMap,
  GoogleMarker,
  GoogleOverlay,
  loadGoogleMaps,
  mapsDirectionsUrl,
} from '../utils/googleMaps';

type Props = {
  data: PhleboMapData | null;
  onStopSelect?: (stop: PhleboMapStop) => void;
  height?: number;
  className?: string;
};

function numberedIcon(n: number, fill: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path fill="${fill}" d="M16 0C7.7 0 1 6.7 1 15c0 10.4 15 25 15 25s15-14.6 15-25C31 6.7 24.3 0 16 0z"/><text x="16" y="19" text-anchor="middle" font-size="12" font-family="Arial" font-weight="700" fill="#fff">${n}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function pinIcon(fill: string, letter: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path fill="${fill}" d="M16 0C7.7 0 1 6.7 1 15c0 10.4 15 25 15 25s15-14.6 15-25C31 6.7 24.3 0 16 0z"/><text x="16" y="19" text-anchor="middle" font-size="11" font-family="Arial" font-weight="700" fill="#fff">${letter}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function PhlebotomistMap({ data, onStopSelect, height = 420, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const overlaysRef = useRef<Array<GoogleMarker | GoogleOverlay>>([]);
  const [mapReady, setMapReady] = useState(false);
  const liveCoords = usePhleboLiveCoords();

  useEffect(() => {
    const el = containerRef.current;
    const key = data?.google_maps_api_key;
    if (!el || !key) return;
    let cancelled = false;

    void loadGoogleMaps(key)
      .then((gmaps) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new gmaps.Map(containerRef.current, {
          center: { lat: 22.5726, lng: 88.3639 },
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        setMapReady(true);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [data?.google_maps_api_key]);

  useEffect(() => {
    const key = data?.google_maps_api_key;
    const map = mapRef.current;
    if (!key || !map || !data || !mapReady) return;
    let cancelled = false;

    void loadGoogleMaps(key).then((gmaps) => {
      if (cancelled || !mapRef.current) return;
      overlaysRef.current.forEach((layer) => layer.setMap(null));
      overlaysRef.current = [];

      const bounds = new gmaps.LatLngBounds();
      const info = new gmaps.InfoWindow({});
      const live = liveCoords?.latitude && liveCoords.longitude
        ? { lat: liveCoords.latitude, lng: liveCoords.longitude }
        : data.phlebotomist?.latitude && data.phlebotomist.longitude
          ? { lat: data.phlebotomist.latitude, lng: data.phlebotomist.longitude }
          : null;

      if (data.hub?.hub_latitude && data.hub.hub_longitude) {
        const hubPos = { lat: data.hub.hub_latitude, lng: data.hub.hub_longitude };
        bounds.extend(hubPos);
        const hub = new gmaps.Marker({
          position: hubPos,
          map,
          title: data.hub.franchise_name || 'Hub',
          icon: {
            url: pinIcon('#0d9488', 'H'),
            scaledSize: new gmaps.Size(32, 40),
            anchor: new gmaps.Point(16, 40),
          },
        });
        overlaysRef.current.push(hub);
        overlaysRef.current.push(
          new gmaps.Circle({
            map,
            center: hubPos,
            radius: data.hub.geofence_radius_m || 100,
            strokeColor: '#0d9488',
            strokeWeight: 2,
            fillColor: '#0d9488',
            fillOpacity: 0.1,
          }),
        );
      }

      if (live) {
        bounds.extend(live);
        const you = new gmaps.Marker({
          position: live,
          map,
          title: 'You — live location',
          icon: {
            path: gmaps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#2563eb',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
          },
        });
        overlaysRef.current.push(you);
      }

      const pending = data.stops.filter((stop) => stop.order_status === 'Booked');
      data.stops.forEach((stop, index) => {
        const pos = { lat: stop.latitude, lng: stop.longitude };
        bounds.extend(pos);
        const marker = new gmaps.Marker({
          position: pos,
          map,
          title: stop.patient_name,
          icon: {
            url: numberedIcon(index + 1, stop.order_status === 'Sample Collected' ? '#16a34a' : '#0f766e'),
            scaledSize: new gmaps.Size(32, 40),
            anchor: new gmaps.Point(16, 40),
          },
        });
        const nav = mapsDirectionsUrl({
          origin: live,
          destination: { lat: stop.latitude, lng: stop.longitude },
        });
        marker.addListener('click', () => {
          info.setContent(
            `<div style="max-width:220px"><strong>${escapeHtml(stop.patient_name)}</strong><br/>${escapeHtml(stop.test_name || '')}<br/>${escapeHtml(stop.collection_address || '')}<br/><a href="${nav}" target="_blank" rel="noreferrer">Navigate in Google Maps</a></div>`,
          );
          info.open({ map, anchor: marker });
          onStopSelect?.(stop);
        });
        overlaysRef.current.push(marker);
      });

      const waypoints = pending.slice(0, 8).map((stop) => ({
        location: { lat: stop.latitude, lng: stop.longitude },
        stopover: true,
      }));
      if (live && pending.length) {
        const service = new gmaps.DirectionsService();
        const renderer = new gmaps.DirectionsRenderer({
          map,
          suppressMarkers: true,
          polylineOptions: { strokeColor: '#2563eb', strokeWeight: 4, strokeOpacity: 0.8 },
        });
        overlaysRef.current.push(renderer);
        service.route(
          {
            origin: live,
            destination: { lat: pending[pending.length - 1].latitude, lng: pending[pending.length - 1].longitude },
            waypoints: waypoints.slice(0, -1),
            travelMode: gmaps.TravelMode.DRIVING,
          },
          (result, status) => {
            if (status === 'OK' && result) renderer.setDirections(result);
          },
        );
      } else if (data.route?.geometry?.length) {
        const path = data.route.geometry.map(([lng, lat]) => ({ lat, lng }));
        path.forEach((point) => bounds.extend(point));
      }

      map.fitBounds(bounds, 48);
    });

    return () => {
      cancelled = true;
    };
  }, [data, liveCoords, onStopSelect, mapReady]);

  if (!data) {
    return (
      <div className={className || 'phlebo-map'} style={{ height, display: 'grid', placeItems: 'center', padding: 16 }}>
        <p className="muted">Loading map…</p>
      </div>
    );
  }
  if (!data.google_maps_configured || !data.google_maps_api_key) {
    return (
      <div className={className || 'phlebo-map'} style={{ height, display: 'grid', placeItems: 'center', padding: 16 }}>
        <p className="muted">Google Maps is not configured on this site yet. Collection addresses still appear in the queue.</p>
      </div>
    );
  }

  return <div className={className || 'phlebo-map'} ref={containerRef} style={{ height }} aria-label="Collection map" />;
}
