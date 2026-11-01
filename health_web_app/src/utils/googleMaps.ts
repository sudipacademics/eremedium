type MapsWindow = Window & {
  google?: { maps: GoogleMapsApi };
  __hecGoogleMapsReady?: Promise<GoogleMapsApi>;
};

export type GoogleMapsApi = {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GoogleMap;
  Marker: new (opts: Record<string, unknown>) => GoogleMarker;
  Circle: new (opts: Record<string, unknown>) => GoogleOverlay;
  InfoWindow: new (opts: Record<string, unknown>) => GoogleInfoWindow;
  LatLngBounds: new () => GoogleLatLngBounds;
  Size: new (w: number, h: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  SymbolPath: { CIRCLE: unknown };
  TravelMode: { DRIVING: unknown };
  DirectionsService: new () => GoogleDirectionsService;
  DirectionsRenderer: new (opts: Record<string, unknown>) => GoogleDirectionsRenderer;
};

export type GoogleMap = {
  fitBounds: (bounds: GoogleLatLngBounds, padding?: number) => void;
  setCenter: (latLng: GoogleLatLng) => void;
  setZoom: (zoom: number) => void;
};

export type GoogleLatLng = { lat: number; lng: number };

export type GoogleLatLngBounds = {
  extend: (latLng: GoogleLatLng) => void;
  isEmpty?: () => boolean;
};

export type GoogleMarker = {
  setMap: (map: GoogleMap | null) => void;
  setPosition: (latLng: GoogleLatLng) => void;
  addListener: (event: string, handler: () => void) => void;
};

export type GoogleOverlay = {
  setMap: (map: GoogleMap | null) => void;
};

export type GoogleInfoWindow = {
  setContent: (html: string) => void;
  open: (opts: { map: GoogleMap; anchor?: GoogleMarker }) => void;
  close: () => void;
};

export type GoogleDirectionsService = {
  route: (
    request: Record<string, unknown>,
    callback: (result: unknown, status: string) => void,
  ) => void;
};

export type GoogleDirectionsRenderer = {
  setMap: (map: GoogleMap | null) => void;
  setDirections: (result: unknown) => void;
};

export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi> {
  const win = window as MapsWindow;
  if (win.google?.maps?.Map) {
    return Promise.resolve(win.google.maps);
  }
  if (win.__hecGoogleMapsReady) {
    return win.__hecGoogleMapsReady;
  }
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps is not configured'));
  }

  win.__hecGoogleMapsReady = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-hec-gmaps]');
    if (existing) {
      existing.addEventListener('load', () => {
        if (win.google?.maps) resolve(win.google.maps);
        else reject(new Error('Google Maps failed to load'));
      });
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.dataset.hecGmaps = '1';
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.onload = () => {
      if (win.google?.maps) resolve(win.google.maps);
      else reject(new Error('Google Maps failed to load'));
    };
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
  return win.__hecGoogleMapsReady;
}

type LatLngLike = { lat?: number; lng?: number; latitude?: number; longitude?: number };

function toLatLng(value?: LatLngLike | null) {
  if (!value) return null;
  const lat = value.lat ?? value.latitude;
  const lng = value.lng ?? value.longitude;
  if (!lat || !lng) return null;
  return { lat, lng };
}

export function mapsDirectionsUrl(opts: {
  origin?: LatLngLike | null;
  destination: LatLngLike | string;
}): string {
  const dest =
    typeof opts.destination === 'string'
      ? opts.destination
      : (() => {
          const point = toLatLng(opts.destination);
          return point ? `${point.lat},${point.lng}` : '';
        })();
  const origin = toLatLng(opts.origin);
  const params = new URLSearchParams({ api: '1', destination: dest, travelmode: 'driving' });
  if (origin) params.set('origin', `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
