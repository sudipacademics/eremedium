export function isSecureGpsContext(): boolean {
  if (typeof window === 'undefined') return true;
  return window.isSecureContext;
}

export function gpsBlockedReason(): string | null {
  if (typeof navigator === 'undefined') return 'GPS is not available in this environment.';
  if (!navigator.geolocation) return 'GPS is not supported in this browser.';
  if (!isSecureGpsContext()) {
    return 'Browser GPS requires HTTPS. This site is on HTTP — use manual coordinates below or enable HTTPS on the server.';
  }
  return null;
}

export function geolocationErrorMessage(error: GeolocationPositionError | Error): string {
  if ('code' in error) {
    if (error.code === error.PERMISSION_DENIED) {
      if (!isSecureGpsContext()) {
        return 'GPS blocked on HTTP — allow location in browser settings will not help until the site uses HTTPS. Use manual coordinates below.';
      }
      return 'Location permission denied — allow location for this site in browser settings, then retry.';
    }
    if (error.code === error.POSITION_UNAVAILABLE) {
      return 'Location unavailable — check GPS is on and try again.';
    }
    if (error.code === error.TIMEOUT) {
      return 'Location timed out — try again or enter coordinates manually.';
    }
  }
  return error.message || 'Could not get location';
}

export function getBrowserPosition(): Promise<GeolocationCoordinates> {
  const blocked = gpsBlockedReason();
  if (blocked) {
    return Promise.reject(new Error(blocked));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(new Error(geolocationErrorMessage(err))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}
