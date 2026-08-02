/**
 * Phase 86 — Franchise ad lead ingest helpers for RFMS CRM.
 * Shared by CSV import, ERP HMAC bridge, and thin public webhook aliases.
 */

export const AD_LEAD_SOURCES = new Set(['meta_ads', 'google_ads', 'whatsapp_ads', 'reach_sales', 'manual']);

export function normaliseAdSource(value) {
  const source = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (source === 'facebook' || source === 'fb' || source === 'instagram' || source === 'ig' || source === 'meta') return 'meta_ads';
  if (source === 'google' || source === 'google_ads' || source === 'gads' || source === 'googleads') return 'google_ads';
  if (source === 'whatsapp' || source === 'whatsapp_ads' || source === 'ctwa') return 'whatsapp_ads';
  if (source === 'reach' || source === 'reach_sales' || source === 'reach_portal') return 'reach_sales';
  if (source === 'manual') return 'manual';
  if (AD_LEAD_SOURCES.has(source)) return source;
  return 'meta_ads';
}

export function adLeadContactKey(lead) {
  return [String(lead?.email || '').toLowerCase(), String(lead?.mobile || '').replace(/\D/g, '')].filter(Boolean);
}

export function findExistingAdLead(leads, candidate) {
  const hecId = String(candidate?.hec_lead_id || '').trim();
  if (hecId) {
    const byHec = (leads || []).find((item) => String(item.hec_lead_id || '').trim() === hecId);
    if (byHec) return byHec;
  }
  const externalId = String(candidate?.external_lead_id || '').trim();
  if (externalId) {
    const byExternal = (leads || []).find((item) => String(item.external_lead_id || '').trim() === externalId);
    if (byExternal) return byExternal;
  }
  const email = String(candidate?.email || '').toLowerCase();
  const mobile = String(candidate?.mobile || '').replace(/\D/g, '');
  return (leads || []).find((item) => {
    if (email && !email.endsWith('@reach.franchise.local') && !email.endsWith('@ads.franchise.local') && String(item.email || '').toLowerCase() === email) return true;
    if (mobile && String(item.mobile || '').replace(/\D/g, '') === mobile) return true;
    return false;
  }) || null;
}

export function adLeadPayloadFromRow(row = {}, defaults = {}) {
  const mobile = String(row.mobile || row.phone || row.phone_number || '').replace(/\D/g, '').slice(-15);
  let email = String(row.email || row.email_address || '').trim().toLowerCase();
  if (!email && mobile) email = `${mobile}@ads.franchise.local`;
  return {
    name: String(row.name || row.full_name || row.lead_name || '').trim(),
    email,
    mobile,
    franchise_model: String(row.franchise_model || row.model || '').trim().toUpperCase(),
    territory_query: String(row.territory_query || row.territory || row.location || row.city || '').trim(),
    notes: String(row.notes || row.message || '').trim(),
    source: normaliseAdSource(row.source || defaults.source || 'meta_ads'),
    campaign_name: String(row.campaign_name || row.campaign || defaults.campaign_name || '').trim(),
    campaign_id: String(row.campaign_id || defaults.campaign_id || '').trim(),
    ad_id: String(row.ad_id || defaults.ad_id || '').trim(),
    adset_id: String(row.adset_id || defaults.adset_id || '').trim(),
    form_id: String(row.form_id || defaults.form_id || '').trim(),
    platform: String(row.platform || defaults.platform || '').trim(),
    external_lead_id: String(row.external_lead_id || row.lead_id || row.id || defaults.external_lead_id || '').trim(),
    utm_source: String(row.utm_source || defaults.utm_source || '').trim(),
    utm_medium: String(row.utm_medium || defaults.utm_medium || '').trim(),
    utm_campaign: String(row.utm_campaign || defaults.utm_campaign || '').trim(),
    gclid: String(row.gclid || defaults.gclid || '').trim(),
    hec_lead_id: String(row.hec_lead_id || defaults.hec_lead_id || '').trim(),
    raw_source_payload: typeof row.raw_source_payload === 'string'
      ? row.raw_source_payload.slice(0, 4000)
      : (row.raw_source_payload ? JSON.stringify(row.raw_source_payload).slice(0, 4000) : ''),
    assigned_to: String(row.assigned_to || defaults.assigned_to || 'Unassigned').trim() || 'Unassigned',
    sales_rep_id: String(row.sales_rep_id || '').trim(),
    reach_user_name: String(row.reach_user_name || '').trim(),
    reach_user_email: String(row.reach_user_email || '').trim(),
    reach_lead_source: String(row.reach_lead_source || '').trim(),
    assignee_role: String(row.assignee_role || '').trim(),
    created_at: String(row.created_at || '').trim(),
    stage: String(row.stage || 'new').trim() || 'new',
    priority: String(row.priority || 'normal').trim() || 'normal',
  };
}

/** Ads leads may omit FOFO/FOCO and territory until CRM qualifies them. */
export function adLeadIsAcceptable(lead) {
  const name = String(lead?.name || '').trim();
  const mobile = String(lead?.mobile || '').replace(/\D/g, '');
  const email = String(lead?.email || '').trim();
  return Boolean(name && mobile.length >= 10 && email);
}

export function franchiseAdsStatus(database = {}) {
  const meta = database.franchise_ads_meta && typeof database.franchise_ads_meta === 'object'
    ? database.franchise_ads_meta
    : {};
  return {
    webhook_secret_configured: Boolean(String(process.env.FRANCHISE_ADS_WEBHOOK_SECRET || process.env.ONBOARD_HMAC_SECRET || '').trim()),
    last_ingest_at: meta.last_ingest_at || '',
    last_ingest_source: meta.last_ingest_source || '',
    last_ingest_count: Number(meta.last_ingest_count) || 0,
    last_external_lead_id: meta.last_external_lead_id || '',
  };
}

export function recordFranchiseAdsIngest(database, { source = '', count = 0, externalLeadId = '' } = {}) {
  database.franchise_ads_meta = {
    ...(database.franchise_ads_meta && typeof database.franchise_ads_meta === 'object' ? database.franchise_ads_meta : {}),
    last_ingest_at: new Date().toISOString(),
    last_ingest_source: String(source || ''),
    last_ingest_count: Number(count) || 0,
    last_external_lead_id: String(externalLeadId || ''),
  };
}
