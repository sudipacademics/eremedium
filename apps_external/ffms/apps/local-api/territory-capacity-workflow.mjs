/**
 * Phase 85b — Territory capacity ops helpers (export, bulk edit, near-full alerts).
 * Capacity SoR remains RFMS territories; ERP WB geo is picklist-only.
 */

export const DEFAULT_NEAR_FULL_THRESHOLD = 1;

export function flattenCapacityRows(publicPinRecordsFn) {
  const rows = typeof publicPinRecordsFn === 'function' ? publicPinRecordsFn() : publicPinRecordsFn;
  return (Array.isArray(rows) ? rows : []).map((pin) => ({
    territory_id: pin.territory_id || '',
    pincode: pin.pincode || '',
    state: pin.state || '',
    district: pin.district || '',
    subdivision: pin.subdivision || '',
    area: pin.area || '',
    label: pin.label || '',
    status: pin.status || 'available',
    fofo_capacity: Number(pin.fofo?.capacity) || 0,
    fofo_available: Number(pin.fofo?.available) || 0,
    fofo_reserved: Number(pin.fofo?.reserved) || 0,
    fofo_occupied: Number(pin.fofo?.occupied) || 0,
    fofo_assigned: Number(pin.fofo?.assigned) || 0,
    foco_capacity: Number(pin.foco?.capacity) || 0,
    foco_available: Number(pin.foco?.available) || 0,
    foco_reserved: Number(pin.foco?.reserved) || 0,
    foco_occupied: Number(pin.foco?.occupied) || 0,
    foco_assigned: Number(pin.foco?.assigned) || 0,
  }));
}

export function capacityCsv(rows) {
  const headers = [
    'PIN', 'District', 'Subdivision', 'Area', 'Territory ID', 'Status',
    'FOFO Capacity', 'FOFO Available', 'FOFO Reserved', 'FOFO Occupied',
    'FOCO Capacity', 'FOCO Available', 'FOCO Reserved', 'FOCO Occupied',
  ];
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = rows.map((row) => [
    row.pincode,
    row.district,
    row.subdivision,
    row.area,
    row.territory_id,
    row.status,
    row.fofo_capacity,
    row.fofo_available,
    row.fofo_reserved,
    row.fofo_occupied,
    row.foco_capacity,
    row.foco_available,
    row.foco_reserved,
    row.foco_occupied,
  ].map(escape).join(','));
  return [headers.join(','), ...lines].join('\n');
}

export function nearFullCapacityAlerts(rows, threshold = DEFAULT_NEAR_FULL_THRESHOLD) {
  const limit = Number.isFinite(Number(threshold)) ? Math.max(0, Number(threshold)) : DEFAULT_NEAR_FULL_THRESHOLD;
  return rows.filter((row) => {
    const fofoCap = Number(row.fofo_capacity) || 0;
    const focoCap = Number(row.foco_capacity) || 0;
    if (fofoCap + focoCap <= 0) return false;
    const fofoAvail = Number(row.fofo_available) || 0;
    const focoAvail = Number(row.foco_available) || 0;
    const remaining = fofoAvail + focoAvail;
    return remaining <= limit;
  }).map((row) => ({
    ...row,
    remaining_available: (Number(row.fofo_available) || 0) + (Number(row.foco_available) || 0),
    alert_level: ((Number(row.fofo_available) || 0) + (Number(row.foco_available) || 0)) === 0 ? 'full' : 'near_full',
  }));
}

/**
 * Apply FOFO/FOCO available updates onto a territory pin list (mutates territory).
 * Uses the same capacity math as single-territory PATCH: capacity = assigned + available.
 */
export function applyBulkPinAvailability(territory, update, allocationCountsForPin) {
  const pincode = String(update?.pincode || '').replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(pincode)) {
    return { ok: false, error: 'Invalid PIN code.' };
  }
  if (update.territory_id && update.territory_id !== territory.id) {
    return { ok: false, error: 'Territory ID does not match PIN owner.' };
  }
  const pinIndex = territory.pin_capacities.findIndex((pin) => pin.pincode === pincode);
  if (pinIndex < 0) {
    return { ok: false, error: `PIN ${pincode} is not registered on this territory.` };
  }

  const existing = territory.pin_capacities[pinIndex];
  const fofoUsed = allocationCountsForPin(territory, pincode, 'FOFO').assigned;
  const focoUsed = allocationCountsForPin(territory, pincode, 'FOCO').assigned;
  const next = { ...existing, pincode };

  if (update.fofo_available !== undefined && update.fofo_available !== null && update.fofo_available !== '') {
    const fofoAvailable = Number(update.fofo_available);
    if (!Number.isInteger(fofoAvailable) || fofoAvailable < 0 || fofoAvailable > 500) {
      return { ok: false, error: `FOFO available for ${pincode} must be an integer 0–500.` };
    }
    next.fofo_capacity = fofoUsed + fofoAvailable;
  }
  if (update.foco_available !== undefined && update.foco_available !== null && update.foco_available !== '') {
    const focoAvailable = Number(update.foco_available);
    if (!Number.isInteger(focoAvailable) || focoAvailable < 0 || focoAvailable > 500) {
      return { ok: false, error: `FOCO available for ${pincode} must be an integer 0–500.` };
    }
    next.foco_capacity = focoUsed + focoAvailable;
  }

  if (next.fofo_capacity < fofoUsed || next.foco_capacity < focoUsed) {
    return { ok: false, error: `Capacity for ${pincode} cannot drop below reserved/occupied count.` };
  }

  territory.pin_capacities[pinIndex] = next;
  territory.updated_at = new Date().toISOString();
  return { ok: true, pincode, territory_id: territory.id };
}
