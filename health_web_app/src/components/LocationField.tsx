import { useState } from 'react';

type Props = {
  value: string;
  onChange: (address: string) => void;
  onCoordsChange?: (latitude: number, longitude: number) => void;
  label?: string;
  required?: boolean;
  rows?: number;
};

export function LocationField({ value, onChange, onCoordsChange, label = 'Address', required, rows = 3 }: Props) {
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  async function useGps() {
    if (!navigator.geolocation) {
      setHint('GPS not supported in this browser');
      return;
    }
    setLoading(true);
    setHint(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          onCoordsChange?.(latitude, longitude);
          const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`;
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          const data = (await res.json()) as { display_name?: string };
          if (data.display_name) {
            onChange(data.display_name);
            setHint('Address filled from your location');
          } else {
            onChange(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
            setHint('Coordinates captured — refine address if needed');
          }
        } catch {
          setHint('Could not reverse-geocode — enter address manually');
        } finally {
          setLoading(false);
        }
      },
      () => {
        setHint('Location permission denied — enter address manually');
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  return (
    <label>
      {label}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} required={required} rows={rows} />
      <div className="location-row">
        <button className="btn secondary btn-sm" type="button" onClick={() => void useGps()} disabled={loading}>
          {loading ? 'Locating…' : 'Use my GPS location'}
        </button>
        {hint && <span className="muted">{hint}</span>}
      </div>
    </label>
  );
}
