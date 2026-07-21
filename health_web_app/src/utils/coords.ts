export type ParsedCoords = { latitude: number; longitude: number; swapped?: boolean };

/** India-focused sanity check; also catches lat/lng swap (common with Google "88, 22"). */
export function parseCoords(latRaw: string, lngRaw: string): ParsedCoords | string {
  let lat = Number(latRaw.trim());
  let lng = Number(lngRaw.trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'Enter valid numbers for latitude and longitude.';
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return 'Latitude must be between -90 and 90, longitude between -180 and 180.';
  }

  let swapped = false;
  // Typical India: lat ~8–37, lng ~68–97. If reversed, auto-correct.
  const looksLikeIndiaLat = lat >= 6 && lat <= 38;
  const looksLikeIndiaLng = lng >= 68 && lng <= 98;
  if (!looksLikeIndiaLat && !looksLikeIndiaLng && lat >= 68 && lat <= 98 && lng >= 6 && lng <= 38) {
    [lat, lng] = [lng, lat];
    swapped = true;
  } else if (lat > 45 && lng < 45 && lat <= 98) {
    [lat, lng] = [lng, lat];
    swapped = true;
  }

  return { latitude: lat, longitude: lng, swapped };
}

export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
