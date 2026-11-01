import { useEffect, useRef, useState } from 'react';

import { api } from '../api';
import { geolocationErrorMessage, getBrowserPosition, gpsBlockedReason } from '../utils/geo';

const PING_MS = 60_000;
export const DUTY_KEY = 'hec_phlebo_on_duty';
export const LIVE_SHARE_KEY = 'hec_phlebo_live_share';
export const NAV_SHARE_KEY = 'hec_phlebo_nav_share';
const COORDS_EVENT = 'hec-phlebo-coords';
const TOGGLE_EVENT = 'hec-phlebo-toggles';
let revalidatedStoredToggles = false;

export type PhleboCoords = { latitude: number; longitude: number };

let lastKnownCoords: PhleboCoords | null = null;

function emitCoords(coords: PhleboCoords) {
  lastKnownCoords = coords;
  window.dispatchEvent(new CustomEvent(COORDS_EVENT, { detail: coords }));
}

function emitToggles() {
  window.dispatchEvent(new Event(TOGGLE_EVENT));
}

function readFlag(key: string, fallback = false): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function loadOnDuty(): boolean {
  return readFlag(LIVE_SHARE_KEY, readFlag(DUTY_KEY));
}

export function loadNavShare(): boolean {
  return readFlag(NAV_SHARE_KEY);
}

export async function ensureNavLocation(): Promise<
  { ok: true; coords: PhleboCoords } | { ok: false; message: string }
> {
  if (!loadNavShare()) {
    return {
      ok: false,
      message:
        'Turn on Report Delivery / Navigation first. Location access is required for this feature.',
    };
  }
  const result = await requestLocationAccess();
  if (result.ok) return result;
  if (result.denied) {
    writeFlag(NAV_SHARE_KEY, false);
    emitToggles();
    return {
      ok: false,
      message: `Report Delivery / Navigation was turned off. ${result.message}`,
    };
  }
  return { ok: false, message: result.message };
}

async function queryGeoPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  const perms = navigator.permissions;
  if (!perms?.query) return 'unknown';
  try {
    const status = await perms.query({ name: 'geolocation' as PermissionName });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
  } catch {
    /* Permissions API can reject the geolocation name in some browsers */
  }
  return 'unknown';
}

export async function requestLocationAccess(): Promise<
  { ok: true; coords: PhleboCoords } | { ok: false; message: string; denied: boolean }
> {
  const blocked = gpsBlockedReason();
  if (blocked) return { ok: false, message: blocked, denied: false };

  const permission = await queryGeoPermission();
  if (permission === 'denied') {
    return {
      ok: false,
      denied: true,
      message:
        'Location access is required. Allow location for this site in your browser or device settings, then turn the toggle on again.',
    };
  }

  try {
    const coords = await getBrowserPosition();
    const point = { latitude: coords.latitude, longitude: coords.longitude };
    emitCoords(point);
    return { ok: true, coords: point };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Location access is required. Allow location for this site, then try again.';
    const denied = /denied|permission/i.test(message);
    return { ok: false, message, denied };
  }
}

export function usePhleboLocationToggles() {
  const [liveShare, setLiveShareState] = useState(loadOnDuty);
  const [navShare, setNavShareState] = useState(loadNavShare);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<'live' | 'nav' | null>(null);

  useEffect(() => {
    const sync = () => {
      setLiveShareState(loadOnDuty());
      setNavShareState(loadNavShare());
    };
    window.addEventListener(TOGGLE_EVENT, sync);
    window.addEventListener('storage', sync);
    let perm: PermissionStatus | null = null;
    const onPerm = () => {
      if (perm?.state === 'denied') {
        if (loadOnDuty()) {
          writeFlag(LIVE_SHARE_KEY, false);
          writeFlag(DUTY_KEY, false);
        }
        if (loadNavShare()) writeFlag(NAV_SHARE_KEY, false);
        setLiveShareState(false);
        setNavShareState(false);
        setMessage(
          'Location access was withdrawn. Live Location Sharing and Report Delivery / Navigation were turned off.',
        );
        emitToggles();
      }
    };
    void (async () => {
      try {
        perm = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
        perm?.addEventListener('change', onPerm);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      window.removeEventListener(TOGGLE_EVENT, sync);
      window.removeEventListener('storage', sync);
      perm?.removeEventListener('change', onPerm);
    };
  }, []);

  useEffect(() => {
    if (revalidatedStoredToggles) return;
    revalidatedStoredToggles = true;
    let cancelled = false;
    void (async () => {
      if (!loadOnDuty() && !loadNavShare()) return;
      const result = await requestLocationAccess();
      if (cancelled) return;
      if (result.ok) {
        setMessage(null);
        return;
      }
      if (!result.denied) {
        setMessage(result.message);
        return;
      }
      if (loadOnDuty()) {
        writeFlag(LIVE_SHARE_KEY, false);
        writeFlag(DUTY_KEY, false);
        setLiveShareState(false);
      }
      if (loadNavShare()) {
        writeFlag(NAV_SHARE_KEY, false);
        setNavShareState(false);
      }
      setMessage(result.message);
      emitToggles();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn(kind: 'live' | 'nav') {
    setBusy(kind);
    const result = await requestLocationAccess();
    if (!result.ok) {
      if (kind === 'live') {
        writeFlag(LIVE_SHARE_KEY, false);
        writeFlag(DUTY_KEY, false);
        setLiveShareState(false);
      } else {
        writeFlag(NAV_SHARE_KEY, false);
        setNavShareState(false);
      }
      setMessage(
        kind === 'live'
          ? `Live Location Sharing stayed off. ${result.message}`
          : `Report Delivery / Navigation stayed off. ${result.message}`,
      );
      emitToggles();
      setBusy(null);
      return false;
    }
    if (kind === 'live') {
      writeFlag(LIVE_SHARE_KEY, true);
      writeFlag(DUTY_KEY, true);
      setLiveShareState(true);
    } else {
      writeFlag(NAV_SHARE_KEY, true);
      setNavShareState(true);
    }
    setMessage(null);
    emitToggles();
    setBusy(null);
    return true;
  }

  function turnOff(kind: 'live' | 'nav') {
    if (kind === 'live') {
      writeFlag(LIVE_SHARE_KEY, false);
      writeFlag(DUTY_KEY, false);
      setLiveShareState(false);
    } else {
      writeFlag(NAV_SHARE_KEY, false);
      setNavShareState(false);
    }
    setMessage(null);
    emitToggles();
  }

  async function setLiveShare(on: boolean) {
    if (on) await turnOn('live');
    else turnOff('live');
  }

  async function setNavShare(on: boolean) {
    if (on) await turnOn('nav');
    else turnOff('nav');
  }

  return { liveShare, navShare, message, busy, setLiveShare, setNavShare, setMessage };
}

export function usePhleboDuty() {
  const toggles = usePhleboLocationToggles();
  return [toggles.liveShare, toggles.setLiveShare] as const;
}

export function usePhleboLiveCoords() {
  const [coords, setCoords] = useState<PhleboCoords | null>(lastKnownCoords);
  useEffect(() => {
    const onCoords = (event: Event) => {
      const detail = (event as CustomEvent<PhleboCoords>).detail;
      if (detail?.latitude && detail?.longitude) setCoords(detail);
    };
    window.addEventListener(COORDS_EVENT, onCoords);
    return () => window.removeEventListener(COORDS_EVENT, onCoords);
  }, []);
  return coords;
}

export function usePhleboGps(onDuty: boolean, onStatus?: (message: string | null) => void, enabled = true) {
  const watchId = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function ping(coords?: GeolocationCoordinates) {
    if (!onDuty) return;
    try {
      const position = coords
        ? { latitude: coords.latitude, longitude: coords.longitude }
        : await getBrowserPosition();
      await api.updatePhlebotomistLocation(position.latitude, position.longitude, true);
      emitCoords({ latitude: position.latitude, longitude: position.longitude });
      onStatus?.(null);
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : 'Could not update location');
    }
  }

  useEffect(() => {
    if (!enabled) {
      return;
    }
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
      return;
    }

    void ping();
    timer.current = setInterval(() => {
      void ping();
    }, PING_MS);

    if (navigator.geolocation) {
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          emitCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          void api
            .updatePhlebotomistLocation(pos.coords.latitude, pos.coords.longitude, true)
            .catch(() => undefined);
        },
        (err) => onStatus?.(geolocationErrorMessage(err)),
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
  }, [onDuty, enabled]);
}

export async function hubCheckinWithGps(): Promise<string> {
  const result = await requestLocationAccess();
  if (!result.ok) throw new Error(result.message);
  const res = await api.phlebotomistHubCheckin(result.coords.latitude, result.coords.longitude);
  return res.message || 'Checked in at hub';
}

export async function updateLocationManual(latitude: number, longitude: number): Promise<void> {
  await api.updatePhlebotomistLocation(latitude, longitude, true);
  emitCoords({ latitude, longitude });
}

export async function hubCheckinManual(latitude: number, longitude: number): Promise<string> {
  const res = await api.phlebotomistHubCheckin(latitude, longitude);
  emitCoords({ latitude, longitude });
  return res.message || 'Checked in at hub';
}
