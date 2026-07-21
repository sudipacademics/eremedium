import { useEffect, useRef } from 'react';

import { api } from '../api';
import { getBrowserPosition, gpsBlockedReason } from '../utils/geo';

const PING_MS = 60_000;

async function resolvePosition(): Promise<{ latitude: number; longitude: number; source: 'gps' | 'ip' }> {
  try {
    const coords = await getBrowserPosition();
    return { latitude: coords.latitude, longitude: coords.longitude, source: 'gps' };
  } catch {
    const res = await api.getApproximateLocation();
    const loc = res.data.location;
    return { latitude: loc.latitude, longitude: loc.longitude, source: 'ip' };
  }
}

export function usePhleboGps(onDuty: boolean, onStatus?: (message: string | null) => void) {
  const watchId = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function ping(coords?: GeolocationCoordinates) {
    if (!onDuty) return;
    try {
      const position = coords
        ? { latitude: coords.latitude, longitude: coords.longitude, source: 'gps' as const }
        : await resolvePosition();
      await api.updatePhlebotomistLocation(position.latitude, position.longitude, true);
      if (position.source === 'ip') {
        onStatus?.('Using approximate location (IP) — enable HTTPS for precise GPS.');
      } else {
        onStatus?.(null);
      }
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : 'Could not update location');
    }
  }

  useEffect(() => {
    if (!onDuty) {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
      void api.updatePhlebotomistLocation(0, 0, false).catch(() => undefined);
      onStatus?.(null);
      return;
    }

    const blocked = gpsBlockedReason();
    if (blocked) {
      onStatus?.(blocked);
    }

    void ping();
    timer.current = setInterval(() => {
      void ping();
    }, PING_MS);

    if (navigator.geolocation && !blocked) {
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          void api
            .updatePhlebotomistLocation(pos.coords.latitude, pos.coords.longitude, true)
            .catch(() => undefined);
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 60000 },
      );
    }

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [onDuty]);
}

export async function hubCheckinWithGps(): Promise<string> {
  const position = await resolvePosition();
  const res = await api.phlebotomistHubCheckin(position.latitude, position.longitude);
  const note = position.source === 'ip' ? ' (approximate IP location)' : '';
  return (res.message || 'Checked in at hub') + note;
}

export async function updateLocationManual(latitude: number, longitude: number): Promise<void> {
  await api.updatePhlebotomistLocation(latitude, longitude, true);
}

export async function hubCheckinManual(latitude: number, longitude: number): Promise<string> {
  const res = await api.phlebotomistHubCheckin(latitude, longitude);
  return res.message || 'Checked in at hub';
}
