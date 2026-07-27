'use client';

import { useEffect, useMemo, useState } from 'react';
import { RFMS_API_BASE } from '@rfms/utils';
import './overview-territory-availability.css';

const API_BASE = RFMS_API_BASE;

type ModelCounts = { capacity: number; reserved: number; occupied: number; assigned: number; available: number };
type TerritoryStatus = 'available' | 'reserved' | 'partially_occupied' | 'occupied';
type PinCapacity = { pincode: string; fofo: ModelCounts; foco: ModelCounts; status: TerritoryStatus };
type Allocation = { id: string; application_id: string; application_number: string; applicant_name: string; pincode: string; franchise_model: 'FOFO' | 'FOCO'; status: 'reserved' | 'occupied'; created_at: string };
type Territory = {
  id: string;
  state: string;
  district: string;
  subdivision: string;
  area: string;
  pincodes: string[];
  pin_capacities: PinCapacity[];
  fofo_radius_km: number;
  foco_radius_km: number;
  label: string;
  status: TerritoryStatus;
  fofo: ModelCounts;
  foco: ModelCounts;
  allocations: Allocation[];
};
type Metrics = { fofo_available: number; foco_available: number };
type FranchiseLocation = {
  application_id: string;
  application_number: string;
  applicant_name: string;
  franchise_name: string;
  franchise_model: 'FOFO' | 'FOCO';
  territory_id: string;
  pincode: string;
  subdivision: string;
  district: string;
  radius_km: number;
  coordinates_available: boolean;
};
type Payload = { territories: Territory[]; metrics: Metrics; franchise_locations: FranchiseLocation[] };
type Envelope<T> = { success?: boolean; data?: T; error?: { message?: string } };

const blankCounts: ModelCounts = { capacity: 0, reserved: 0, occupied: 0, assigned: 0, available: 0 };

function statusFromCounts(fofo: ModelCounts, foco: ModelCounts): TerritoryStatus {
  const counts = [fofo, foco];
  const hasAvailableCapacity = counts.some((model) => model.available > 0);
  const hasAssignment = counts.some((model) => model.reserved > 0 || model.occupied > 0 || model.assigned > 0);
  if (hasAvailableCapacity) return hasAssignment ? 'partially_occupied' : 'available';
  const hasReservation = counts.some((model) => model.reserved > 0);
  const hasOccupiedAllocation = counts.some((model) => model.occupied > 0);
  return hasReservation && !hasOccupiedAllocation ? 'reserved' : 'occupied';
}

function normaliseTerritory(value: Territory): Territory {
  const pincodes = Array.isArray(value.pincodes) && value.pincodes.length ? value.pincodes : [];
  const pin_capacities = Array.isArray(value.pin_capacities) && value.pin_capacities.length
    ? value.pin_capacities.map((pin) => {
      const fofo = pin.fofo ?? blankCounts;
      const foco = pin.foco ?? blankCounts;
      return { ...pin, fofo, foco, status: statusFromCounts(fofo, foco) };
    })
    : pincodes.map((pincode) => ({ pincode, fofo: value.fofo ?? blankCounts, foco: value.foco ?? blankCounts, status: statusFromCounts(value.fofo ?? blankCounts, value.foco ?? blankCounts) }));
  const fofo = value.fofo ?? blankCounts;
  const foco = value.foco ?? blankCounts;
  return {
    ...value,
    pincodes,
    pin_capacities,
    fofo_radius_km: Number(value.fofo_radius_km) || 5,
    foco_radius_km: Number(value.foco_radius_km) || 10,
    fofo,
    foco,
    status: statusFromCounts(fofo, foco),
    allocations: Array.isArray(value.allocations) ? value.allocations : [],
  };
}

function tone(status: TerritoryStatus) {
  return status === 'occupied' ? 'occupied' : status === 'reserved' || status === 'partially_occupied' ? 'reserved' : 'available';
}

function statusLabel(status: TerritoryStatus) {
  if (status === 'partially_occupied') return 'Partly available';
  if (status === 'reserved') return 'Fully reserved';
  if (status === 'occupied') return 'Fully occupied';
  return 'Available';
}

function modelAvailability(label: 'FOFO' | 'FOCO', counts: ModelCounts) {
  const allocations = [counts.reserved ? `${counts.reserved} reserved` : '', counts.occupied ? `${counts.occupied} occupied` : ''].filter(Boolean).join(', ');
  return `${label}: ${counts.available} available${allocations ? ` · ${allocations}` : ''}`;
}

function franchiseModelsAvailable(territory: Territory) {
  const models: string[] = [];
  if (territory.fofo.available > 0) models.push('FOFO');
  if (territory.foco.available > 0) models.push('FOCO');
  if (models.length === 2) return 'FOFO and FOCO';
  if (models.length === 1) return models[0];
  return 'None — fully assigned';
}

function nearbyFranchisesForTerritory(territory: Territory, locations: FranchiseLocation[]) {
  const pinSet = new Set(territory.pincodes);
  return locations
    .filter((location) => location.territory_id === territory.id || (location.pincode && pinSet.has(location.pincode)) || location.district.toLowerCase() === territory.district.toLowerCase())
    .sort((left, right) => {
      if (left.territory_id === territory.id && right.territory_id !== territory.id) return -1;
      if (right.territory_id === territory.id && left.territory_id !== territory.id) return 1;
      if (left.pincode && pinSet.has(left.pincode) && !(right.pincode && pinSet.has(right.pincode))) return -1;
      if (right.pincode && pinSet.has(right.pincode) && !(left.pincode && pinSet.has(left.pincode))) return 1;
      return left.franchise_name.localeCompare(right.franchise_name);
    });
}

function occupiedFranchisesForTerritory(territory: Territory, locations: FranchiseLocation[]) {
  return locations.filter((location) => location.territory_id === territory.id);
}

function isOfficerSessionExpired(response: Response) {
  if (response.status !== 401 && response.status !== 403) return false;
  window.dispatchEvent(new Event('rfms-session-expired'));
  return true;
}

function PinRows({ pins }: { pins: PinCapacity[] }) {
  return (
    <div className="overview-territory-pin-summary">
      {pins.map((pin) => (
        <article key={pin.pincode} className={`overview-territory-pin-row ${tone(pin.status)}`}>
          <header>
            <b>PIN {pin.pincode}</b>
            <span className={`overview-territory-status ${tone(pin.status)}`}>{statusLabel(pin.status)}</span>
          </header>
          <small>{modelAvailability('FOFO', pin.fofo)}</small>
          <small>{modelAvailability('FOCO', pin.foco)}</small>
        </article>
      ))}
    </div>
  );
}

export function OverviewTerritoryAvailability({ token, onOpenTerritory }: { token: string; onOpenTerritory: () => void }) {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [metrics, setMetrics] = useState<Metrics>({ fofo_available: 0, foco_available: 0 });
  const [franchiseLocations, setFranchiseLocations] = useState<FranchiseLocation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    void (async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`${API_BASE}/territories`, { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json().catch(() => null) as Envelope<Payload> | null;
        if (isOfficerSessionExpired(response)) return;
        if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to load territory availability.');
        const records = (payload.data.territories ?? []).map(normaliseTerritory).sort((left, right) => left.label.localeCompare(right.label));
        if (!current) return;
        setTerritories(records);
        setMetrics({ fofo_available: payload.data.metrics?.fofo_available ?? 0, foco_available: payload.data.metrics?.foco_available ?? 0 });
        setFranchiseLocations(Array.isArray(payload.data.franchise_locations) ? payload.data.franchise_locations : []);
        setSelectedId((currentId) => currentId && records.some((item) => item.id === currentId) ? currentId : records[0]?.id ?? '');
      } catch (loadError) {
        if (current) setError(loadError instanceof Error ? loadError.message : 'Unable to load territory availability.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [token]);

  const selected = useMemo(() => territories.find((territory) => territory.id === selectedId) ?? null, [territories, selectedId]);
  const nearbyFranchises = useMemo(() => (selected ? nearbyFranchisesForTerritory(selected, franchiseLocations) : []), [selected, franchiseLocations]);
  const occupiedFranchises = useMemo(() => (selected ? occupiedFranchisesForTerritory(selected, franchiseLocations) : []), [selected, franchiseLocations]);

  return (
    <section className="panel overview-territory-panel">
      <div className="panel-head">
        <div>
          <h2>Territory availability</h2>
          <p>Complete West Bengal territory register with live FOFO and FOCO capacity.</p>
        </div>
        <button type="button" className="panel-action" onClick={onOpenTerritory}>Open territory setup</button>
      </div>

      <div className="overview-territory-summary">
        <article>
          <span>Total available FOFO</span>
          <b>{loading ? '—' : metrics.fofo_available}</b>
          <small>Across all registered territories</small>
        </article>
        <article>
          <span>Total available FOCO</span>
          <b>{loading ? '—' : metrics.foco_available}</b>
          <small>Across all registered territories</small>
        </article>
      </div>

      {error ? <p className="overview-territory-alert">{error}</p> : null}

      <div className="overview-territory-layout">
        <div className="overview-territory-list-wrap">
          <div className="overview-territory-list-head">
            <b>{loading ? 'Loading territories…' : `${territories.length} registered territories`}</b>
            <small>Select a territory to inspect availability</small>
          </div>
          <div className="overview-territory-list" role="listbox" aria-label="Registered territories">
            {territories.map((territory) => (
              <button
                key={territory.id}
                type="button"
                role="option"
                aria-selected={selectedId === territory.id}
                className={`overview-territory-list-item ${selectedId === territory.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(territory.id)}
              >
                <div className="overview-territory-list-item-head">
                  <strong>{territory.area}</strong>
                  <span className={`overview-territory-status ${tone(territory.status)}`}>{statusLabel(territory.status)}</span>
                </div>
                <small>PIN {territory.pincodes.join(', ') || '—'}</small>
                <small>{territory.district} · {territory.subdivision}</small>
              </button>
            ))}
            {!loading && !error && territories.length === 0 ? <p className="overview-territory-empty">No territories have been registered yet.</p> : null}
          </div>
        </div>

        <div className="overview-territory-detail" aria-live="polite">
          {selected ? (
            <>
              <span className={`overview-territory-status ${tone(selected.status)}`}>{statusLabel(selected.status)}</span>
              <h3>{selected.area}</h3>
              <p>{selected.subdivision}, {selected.district} · {selected.state}</p>

              <div className="overview-territory-detail-meta">
                <span>Franchise models available<small>{franchiseModelsAvailable(selected)}</small></span>
                <span>Registered PIN codes<small>{selected.pincodes.join(', ') || '—'}</small></span>
              </div>

              <div className="overview-territory-radius-grid">
                <article>
                  <span>FOFO available radius</span>
                  <b>{selected.fofo_radius_km} km</b>
                  <small>{modelAvailability('FOFO', selected.fofo)}</small>
                </article>
                <article>
                  <span>FOCO available radius</span>
                  <b>{selected.foco_radius_km} km</b>
                  <small>{modelAvailability('FOCO', selected.foco)}</small>
                </article>
              </div>

              <div className="overview-territory-section">
                <h4>Occupied radius</h4>
                {occupiedFranchises.length ? (
                  <ul className="overview-territory-franchise-list">
                    {occupiedFranchises.map((location) => (
                      <li key={location.application_id}>
                        <b>{location.franchise_name}</b>
                        <small>{location.franchise_model} · {location.radius_km} km radius · PIN {location.pincode || '—'}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="overview-territory-empty">No active franchise allotments recorded in this territory yet.</p>
                )}
              </div>

              <div className="overview-territory-section">
                <h4>Nearby franchise locations</h4>
                {nearbyFranchises.length ? (
                  <ul className="overview-territory-franchise-list">
                    {nearbyFranchises.map((location) => (
                      <li key={`${location.application_id}-${location.franchise_name}`}>
                        <b>{location.franchise_name}</b>
                        <small>{location.franchise_model} · {location.district}{location.pincode ? ` · PIN ${location.pincode}` : ''}{location.radius_km ? ` · ${location.radius_km} km radius` : ''}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="overview-territory-empty">No nearby active franchise locations found for this territory.</p>
                )}
              </div>

              <div className="overview-territory-section">
                <h4>PIN capacity</h4>
                <PinRows pins={selected.pin_capacities} />
              </div>

              {selected.allocations.length ? (
                <div className="overview-territory-section">
                  <h4>Reservations and allotments</h4>
                  <ul className="overview-territory-franchise-list">
                    {selected.allocations.map((allocation) => (
                      <li key={allocation.id}>
                        <b>{allocation.applicant_name}</b>
                        <small>{allocation.application_number} · {allocation.franchise_model} · PIN {allocation.pincode} · {allocation.status}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <h3>Select a territory</h3>
              <p>Choose any registered territory from the list to view FOFO/FOCO availability, radius coverage, and nearby franchise locations.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
