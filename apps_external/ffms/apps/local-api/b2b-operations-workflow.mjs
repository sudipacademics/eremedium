import { randomUUID } from 'node:crypto';

function text(value, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function numberFrom(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function ensureB2bCollections(database) {
  if (!Array.isArray(database.b2b_collection_centres)) database.b2b_collection_centres = [];
  if (!Array.isArray(database.b2b_sales_entries)) database.b2b_sales_entries = [];
  return database;
}

export function b2bCentreRecord(raw = {}, id = randomUUID()) {
  const logistics = Array.isArray(raw.logistics_assignments) ? raw.logistics_assignments : [];
  return {
    id: String(raw.id ?? id),
    hec_centre_id: text(raw.hec_centre_id || raw.name, 140),
    centre_name: text(raw.centre_name || raw.name, 200),
    status: text(raw.status || 'Active', 40) || 'Active',
    wallet_amount: numberFrom(raw.wallet_amount),
    total_deposit: numberFrom(raw.total_deposit),
    contact_number: text(raw.contact_number, 40),
    manual_address: text(raw.manual_address, 1000),
    google_map_location: text(raw.google_map_location, 500),
    trade_licence: text(raw.trade_licence, 500),
    approved_rate_chart: text(raw.approved_rate_chart, 500),
    created_by_reach_user: text(raw.created_by_reach_user, 140),
    remarks: text(raw.remarks, 1000),
    logistics_assignments: logistics.map((item) => ({
      person_name: text(item?.person_name, 140),
      contact_number: text(item?.contact_number, 40),
      pickup_point: text(item?.pickup_point, 200),
      logistics_cost: numberFrom(item?.logistics_cost),
    })).filter((item) => item.person_name),
    created_at: String(raw.created_at ?? new Date().toISOString()),
    updated_at: String(raw.updated_at ?? new Date().toISOString()),
  };
}

export function b2bSalesRecord(raw = {}, id = randomUUID()) {
  return {
    id: String(raw.id ?? id),
    hec_sales_id: text(raw.hec_sales_id || raw.name, 140),
    hec_centre_id: text(raw.hec_centre_id || raw.b2b_collection_centre, 140),
    centre_name: text(raw.centre_name, 200),
    sales_date: text(raw.sales_date, 40),
    number_of_samples: Math.max(0, Math.floor(numberFrom(raw.number_of_samples))),
    business_value: numberFrom(raw.business_value),
    assigned_logistics_person: text(raw.assigned_logistics_person, 140),
    status: text(raw.status || 'Submitted', 40) || 'Submitted',
    reach_user: text(raw.reach_user, 140),
    remarks: text(raw.remarks, 1000),
    created_at: String(raw.created_at ?? new Date().toISOString()),
    updated_at: String(raw.updated_at ?? new Date().toISOString()),
  };
}

export function ingestB2bCentres(database, centres = []) {
  ensureB2bCollections(database);
  const upserted = [];
  for (const item of Array.isArray(centres) ? centres : []) {
    const hecId = text(item?.hec_centre_id || item?.name, 140);
    let existing = hecId
      ? database.b2b_collection_centres.find((row) => row.hec_centre_id === hecId)
      : null;
    if (!existing && item?.id) {
      existing = database.b2b_collection_centres.find((row) => row.id === item.id);
    }
    if (existing) {
      Object.assign(existing, b2bCentreRecord({ ...existing, ...item, id: existing.id }, existing.id), {
        created_at: existing.created_at,
        updated_at: new Date().toISOString(),
      });
      upserted.push(existing);
    } else {
      const record = b2bCentreRecord(item);
      database.b2b_collection_centres.unshift(record);
      upserted.push(record);
    }
  }
  return upserted;
}

export function ingestB2bSales(database, entries = []) {
  ensureB2bCollections(database);
  const upserted = [];
  for (const item of Array.isArray(entries) ? entries : []) {
    const hecId = text(item?.hec_sales_id || item?.name, 140);
    let existing = hecId
      ? database.b2b_sales_entries.find((row) => row.hec_sales_id === hecId)
      : null;
    if (!existing && item?.id) {
      existing = database.b2b_sales_entries.find((row) => row.id === item.id);
    }
    if (existing) {
      Object.assign(existing, b2bSalesRecord({ ...existing, ...item, id: existing.id }, existing.id), {
        created_at: existing.created_at,
        updated_at: new Date().toISOString(),
      });
      upserted.push(existing);
    } else {
      const record = b2bSalesRecord(item);
      database.b2b_sales_entries.unshift(record);
      upserted.push(record);
    }
  }
  return upserted;
}

export function b2bOperationsSummary(database) {
  ensureB2bCollections(database);
  const centres = database.b2b_collection_centres;
  const sales = database.b2b_sales_entries;
  return {
    centres_count: centres.length,
    sales_count: sales.length,
    samples_total: sales.reduce((sum, row) => sum + numberFrom(row.number_of_samples), 0),
    business_value_total: sales.reduce((sum, row) => sum + numberFrom(row.business_value), 0),
    pending_verification: sales.filter((row) => String(row.status).toLowerCase() === 'submitted').length,
  };
}
