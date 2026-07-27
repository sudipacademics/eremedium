const FORMATTED_FRANCHISEE_ID = /^\d{4}\/(FOFO|FOCO)\/\d{2}\/00\d{2}$/;

export function isFormattedFranchiseeId(value) {
  return FORMATTED_FRANCHISEE_ID.test(String(value ?? '').trim());
}

export function decodeFranchiseeRouteParam(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw;
  }
}

export function ensureFranchiseeSerialState(database) {
  if (!database.franchisee_serial_state || typeof database.franchisee_serial_state !== 'object') {
    database.franchisee_serial_state = { next_serial: 1, issued_ids: [] };
  }
  const nextSerial = Number(database.franchisee_serial_state.next_serial);
  if (!Number.isFinite(nextSerial) || nextSerial < 1) {
    database.franchisee_serial_state.next_serial = 1;
  }
  if (!Array.isArray(database.franchisee_serial_state.issued_ids)) {
    database.franchisee_serial_state.issued_ids = [];
  }
  return database.franchisee_serial_state;
}

export function formatFranchiseeId(serial, franchiseModel, approvedAt) {
  const date = new Date(approvedAt);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const month = String(safeDate.getMonth() + 1).padStart(2, '0');
  const yearSuffix = String(safeDate.getFullYear()).slice(-2);
  const model = String(franchiseModel ?? '').trim().toUpperCase() === 'FOCO' ? 'FOCO' : 'FOFO';
  return `${String(serial).padStart(4, '0')}/${model}/${month}/00${yearSuffix}`;
}

export function nextFranchiseeSerial(database) {
  const state = ensureFranchiseeSerialState(database);
  const serial = state.next_serial;
  state.next_serial += 1;
  return serial;
}

export function assignFranchiseeId(application, database, approvedAt = new Date().toISOString()) {
  const existing = String(application?.franchisee_id ?? '').trim();
  if (isFormattedFranchiseeId(existing)) {
    return existing;
  }
  const serial = nextFranchiseeSerial(database);
  const issuedAt = String(approvedAt ?? new Date().toISOString());
  const franchiseeId = formatFranchiseeId(serial, application.franchise_model, issuedAt);
  application.franchisee_id = franchiseeId;
  application.franchisee_serial = serial;
  application.franchisee_id_issued_at = issuedAt;
  ensureFranchiseeSerialState(database).issued_ids.push({
    franchisee_id: franchiseeId,
    application_id: application.id,
    serial,
    issued_at: issuedAt,
  });
  return franchiseeId;
}

export function franchiseeIdForApplication(application) {
  const value = String(application?.franchisee_id ?? '').trim();
  return isFormattedFranchiseeId(value) ? value : '';
}

export function findApplicationByFranchiseeIdentifier(applications, identifier) {
  const value = decodeFranchiseeRouteParam(identifier);
  if (!value) return null;
  const normalized = value.toLowerCase();
  return applications.find((application) => {
    if (application.id === value) return true;
    if (String(application.franchisee_id ?? '').trim() === value) return true;
    if (String(application.application_number ?? '').trim().toLowerCase() === normalized) return true;
    return false;
  }) ?? null;
}

export function syncFranchiseeSerialCounter(database) {
  const state = ensureFranchiseeSerialState(database);
  const maxSerial = (Array.isArray(database.applications) ? database.applications : []).reduce(
    (max, application) => Math.max(max, Number(application.franchisee_serial) || 0),
    0,
  );
  if (state.next_serial <= maxSerial) {
    state.next_serial = maxSerial + 1;
    return true;
  }
  return false;
}

export function migrateFranchiseeIds(database) {
  ensureFranchiseeSerialState(database);
  let changed = false;
  const applications = Array.isArray(database.applications) ? database.applications : [];
  const onboarded = applications
    .filter((application) => application.visible_to_admin && application.stage === 'onboarding_completed')
    .sort((first, second) => String(first.onboarding_completed_at ?? first.updated_at).localeCompare(String(second.onboarding_completed_at ?? second.updated_at)));

  for (const application of onboarded) {
    if (!isFormattedFranchiseeId(application.franchisee_id)) {
      assignFranchiseeId(
        application,
        database,
        application.onboarding_completed_at ?? application.franchisee_id_issued_at ?? application.updated_at ?? new Date().toISOString(),
      );
      changed = true;
    }
  }

  if (syncFranchiseeSerialCounter(database)) changed = true;
  return changed;
}
