'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_RFMS_API_URL ?? 'http://localhost:8080/api/v1';

type ModelCounts = { capacity: number; reserved: number; occupied: number; assigned: number; available: number };
type PinCapacity = { pincode: string; fofo: ModelCounts; foco: ModelCounts; status: string };
type Territory = {
  id: string;
  district: string;
  subdivision: string;
  area: string;
  pin_capacities: PinCapacity[];
};
type CapacityRow = {
  territory_id: string;
  pincode: string;
  district: string;
  subdivision: string;
  area: string;
  status: string;
  fofo_available: number;
  foco_available: number;
  fofo_capacity: number;
  foco_capacity: number;
  remaining_available?: number;
  alert_level?: string;
};
type DraftEdit = { fofo_available: string; foco_available: string };
type Envelope<T> = { success?: boolean; data?: T; error?: { message?: string } };

function isOfficerSessionExpired(response: Response) {
  if (response.status !== 401 && response.status !== 403) return false;
  window.dispatchEvent(new Event('rfms-session-expired'));
  return true;
}

function rowsFromTerritories(territories: Territory[]): CapacityRow[] {
  return territories.flatMap((territory) =>
    (territory.pin_capacities || []).map((pin) => ({
      territory_id: territory.id,
      pincode: pin.pincode,
      district: territory.district,
      subdivision: territory.subdivision,
      area: territory.area,
      status: pin.status,
      fofo_available: pin.fofo?.available ?? 0,
      foco_available: pin.foco?.available ?? 0,
      fofo_capacity: pin.fofo?.capacity ?? 0,
      foco_capacity: pin.foco?.capacity ?? 0,
    })),
  ).sort((a, b) => a.pincode.localeCompare(b.pincode));
}

export function TerritoryCapacityOps({
  token,
  territories,
  onUpdated,
  notify,
}: {
  token: string;
  territories: Territory[];
  onUpdated: () => Promise<void> | void;
  notify: (message: string) => void;
}) {
  const [alerts, setAlerts] = useState<CapacityRow[]>([]);
  const [threshold] = useState(1);
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({});
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const baseRows = useMemo(() => rowsFromTerritories(territories), [territories]);
  const visibleRows = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return baseRows;
    return baseRows.filter((row) =>
      `${row.pincode} ${row.district} ${row.subdivision} ${row.area} ${row.status}`.toLowerCase().includes(query));
  }, [baseRows, filter]);

  const loadAlerts = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/territories/capacity-alerts?threshold=${threshold}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (isOfficerSessionExpired(response)) return;
      const result = await response.json() as Envelope<{ alerts: CapacityRow[] }>;
      if (response.ok && result.success) setAlerts(result.data?.alerts ?? []);
    } catch {
      // Banner stays empty if alerts endpoint is unavailable.
    }
  }, [threshold, token]);

  useEffect(() => { void loadAlerts(); }, [loadAlerts, territories]);

  function exportCsv() {
    const headers = ['PIN', 'District', 'Subdivision', 'Area', 'Status', 'FOFO Available', 'FOFO Capacity', 'FOCO Available', 'FOCO Capacity'];
    const lines = visibleRows.map((row) => [
      row.pincode, row.district, row.subdivision, row.area, row.status,
      row.fofo_available, row.fofo_capacity, row.foco_available, row.foco_capacity,
    ].map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','));
    const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'rfms-territory-capacities.csv';
    anchor.click();
    URL.revokeObjectURL(url);
    notify('Territory capacity export prepared.');
  }

  function editKey(row: CapacityRow) {
    return `${row.territory_id}:${row.pincode}`;
  }

  function draftFor(row: CapacityRow): DraftEdit {
    return edits[editKey(row)] ?? {
      fofo_available: String(row.fofo_available),
      foco_available: String(row.foco_available),
    };
  }

  function changeEdit(row: CapacityRow, field: keyof DraftEdit, value: string) {
    const key = editKey(row);
    setEdits((current) => ({
      ...current,
      [key]: {
        ...draftFor(row),
        ...current[key],
        [field]: value.replace(/\D/g, '').slice(0, 3),
      },
    }));
  }

  const dirtyUpdates = useMemo(() => {
    return baseRows.flatMap((row) => {
      const draft = edits[editKey(row)];
      if (!draft) return [];
      const fofo = Number(draft.fofo_available);
      const foco = Number(draft.foco_available);
      const fofoChanged = Number.isInteger(fofo) && fofo !== row.fofo_available;
      const focoChanged = Number.isInteger(foco) && foco !== row.foco_available;
      if (!fofoChanged && !focoChanged) return [];
      return [{
        territory_id: row.territory_id,
        pincode: row.pincode,
        ...(fofoChanged ? { fofo_available: fofo } : {}),
        ...(focoChanged ? { foco_available: foco } : {}),
      }];
    });
  }, [baseRows, edits]);

  async function saveBulk() {
    if (!dirtyUpdates.length) {
      notify('No capacity changes to save.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/territories/capacities/bulk`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: dirtyUpdates }),
      });
      if (isOfficerSessionExpired(response)) return;
      const result = await response.json() as Envelope<{ updated_count: number; error_count: number; errors?: { pincode?: string; error?: string }[] }>;
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error?.message ?? 'Unable to save bulk capacity updates.');
      }
      setEdits({});
      await onUpdated();
      await loadAlerts();
      const failed = result.data.error_count || 0;
      notify(failed
        ? `Updated ${result.data.updated_count} PIN(s); ${failed} failed.`
        : `Updated FOFO/FOCO availability for ${result.data.updated_count} PIN(s).`);
      if (failed && result.data.errors?.[0]?.error) setError(result.data.errors[0].error);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save bulk capacity updates.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel territory-capacity-ops">
      <div className="panel-head">
        <div>
          <h2>Capacity operations</h2>
          <p>Bulk-edit FOFO/FOCO availability across PINs, export the capacity register, and watch near-full alerts.</p>
        </div>
        <div className="territory-capacity-ops-actions">
          <button type="button" onClick={exportCsv}>Export CSV</button>
          <button type="button" className="territory-primary" disabled={saving || !dirtyUpdates.length} onClick={() => void saveBulk()}>
            {saving ? 'Saving…' : `Save ${dirtyUpdates.length || ''} change${dirtyUpdates.length === 1 ? '' : 's'}`.trim()}
          </button>
        </div>
      </div>

      {alerts.length ? (
        <div className="territory-capacity-alert-banner" role="status">
          <b>{alerts.length} near-full PIN{alerts.length === 1 ? '' : 's'}</b>
          <span>
            {alerts.slice(0, 6).map((alert) => `${alert.pincode} (${alert.remaining_available ?? 0} left)`).join(' · ')}
            {alerts.length > 6 ? ` · +${alerts.length - 6} more` : ''}
          </span>
        </div>
      ) : (
        <p className="territory-capacity-alert-empty">No near-full PINs at threshold ≤ {threshold} remaining slot(s).</p>
      )}

      {error ? <p className="territory-alert" role="alert">{error}</p> : null}

      <label className="territory-directory-search">
        <span className="sr-only">Filter capacity rows</span>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by PIN, district, subdivision, area…"
          autoComplete="off"
        />
      </label>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PIN</th>
              <th>Territory</th>
              <th>Status</th>
              <th>FOFO available</th>
              <th>FOCO available</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const draft = draftFor(row);
              const near = alerts.some((alert) => alert.pincode === row.pincode && alert.territory_id === row.territory_id);
              return (
                <tr key={`${row.territory_id}-${row.pincode}`} className={near ? 'territory-capacity-near-full' : ''}>
                  <td><b>{row.pincode}</b></td>
                  <td>{row.area}<br /><small>{row.subdivision}, {row.district}</small></td>
                  <td><span className={`territory-status ${row.status}`}>{row.status.replaceAll('_', ' ')}</span></td>
                  <td>
                    <input
                      aria-label={`${row.pincode} FOFO available`}
                      inputMode="numeric"
                      value={draft.fofo_available}
                      onChange={(event) => changeEdit(row, 'fofo_available', event.target.value)}
                    />
                    <small>of {row.fofo_capacity} capacity</small>
                  </td>
                  <td>
                    <input
                      aria-label={`${row.pincode} FOCO available`}
                      inputMode="numeric"
                      value={draft.foco_available}
                      onChange={(event) => changeEdit(row, 'foco_available', event.target.value)}
                    />
                    <small>of {row.foco_capacity} capacity</small>
                  </td>
                </tr>
              );
            })}
            {!visibleRows.length ? <tr><td className="empty" colSpan={5}>No PIN capacity rows match this filter.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
