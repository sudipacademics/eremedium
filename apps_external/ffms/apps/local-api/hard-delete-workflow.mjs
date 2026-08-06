import { randomUUID } from 'node:crypto';

const HARD_DELETE_CONFIRM_MESSAGE =
  'This action is permanent and cannot be undone. The selected record and all linked data will be deleted from FFMS, and matching entries will be removed from the REACH Portal and Partner Portal where applicable.';

export function hardDeleteConfirmMessage() {
  return HARD_DELETE_CONFIRM_MESSAGE;
}

function nowIso() {
  return new Date().toISOString();
}

function pushAudit(auditLog, entry) {
  const row = {
    id: randomUUID(),
    created_at: nowIso(),
    action: String(entry.action ?? 'hard_delete'),
    actor_name: String(entry.actor_name ?? 'System'),
    actor_role: String(entry.actor_role ?? ''),
    target: String(entry.target ?? ''),
    details: String(entry.details ?? ''),
    entity_type: String(entry.entity_type ?? ''),
    entity_id: String(entry.entity_id ?? ''),
  };
  const next = Array.isArray(auditLog) ? auditLog.slice() : [];
  next.unshift(row);
  return next.slice(0, 500);
}

export function releaseApplicationTerritory(database, application) {
  const released = [];
  if (!application) return released;
  for (const territory of database.territories ?? []) {
    const before = Array.isArray(territory.allocations) ? territory.allocations.length : 0;
    territory.allocations = (territory.allocations ?? []).filter((item) => item.application_id !== application.id);
    if ((territory.allocations?.length ?? 0) !== before) {
      territory.updated_at = nowIso();
      released.push(territory.id);
    }
  }
  application.territory_id = '';
  application.territory_label = '';
  application.territory_pincode = '';
  if (application.territory_allotment && typeof application.territory_allotment === 'object') {
    application.territory_allotment = {
      ...application.territory_allotment,
      status: 'released',
      released_at: nowIso(),
    };
  }
  return released;
}

export function hardDeleteLead(database, leadId, actor) {
  const index = (database.leads ?? []).findIndex((item) => item.id === leadId);
  if (index < 0) return { error: 'Lead not found.' };
  const lead = database.leads[index];
  const cascade = {
    hec_lead_id: lead.hec_lead_id || '',
    rfms_lead_id: lead.id,
    source: lead.source || '',
    unlinked_visits: 0,
  };
  for (const visit of database.sales_visits ?? []) {
    if (visit.rfms_lead_id === lead.id || (lead.hec_lead_id && visit.hec_lead_id === lead.hec_lead_id)) {
      visit.rfms_lead_id = '';
      cascade.unlinked_visits += 1;
    }
  }
  for (const appointment of database.appointments ?? []) {
    if (appointment.converted_lead_id === lead.id) appointment.converted_lead_id = '';
  }
  database.leads.splice(index, 1);
  database.admin_audit_log = pushAudit(database.admin_audit_log, {
    action: 'hard_delete_lead',
    actor_name: actor?.name,
    actor_role: actor?.role,
    target: leadId,
    entity_type: 'lead',
    entity_id: leadId,
    details: `Permanently deleted lead ${lead.name || leadId} (${lead.email || lead.mobile || 'no contact'}).`,
  });
  return { lead, cascade };
}

export function hardDeleteVisit(database, visitId, actor) {
  const index = (database.sales_visits ?? []).findIndex((item) => item.id === visitId);
  if (index < 0) return { error: 'Sales visit not found.' };
  const visit = database.sales_visits[index];
  database.sales_visits.splice(index, 1);
  database.admin_audit_log = pushAudit(database.admin_audit_log, {
    action: 'hard_delete_sales_visit',
    actor_name: actor?.name,
    actor_role: actor?.role,
    target: visitId,
    entity_type: 'sales_visit',
    entity_id: visitId,
    details: `Permanently deleted sales visit ${visitId}.`,
  });
  return {
    visit,
    cascade: {
      hec_visit_id: visit.hec_visit_id || '',
      hec_lead_id: visit.hec_lead_id || '',
      rfms_lead_id: visit.rfms_lead_id || '',
    },
  };
}

export function hardDeleteAppointment(database, appointmentId, actor) {
  const index = (database.appointments ?? []).findIndex((item) => item.id === appointmentId);
  if (index < 0) return { error: 'Appointment not found.' };
  const appointment = database.appointments[index];
  database.appointments.splice(index, 1);
  database.admin_audit_log = pushAudit(database.admin_audit_log, {
    action: 'hard_delete_appointment',
    actor_name: actor?.name,
    actor_role: actor?.role,
    target: appointmentId,
    entity_type: 'appointment',
    entity_id: appointmentId,
    details: `Permanently deleted appointment ${appointmentId}.`,
  });
  return { appointment, cascade: { converted_lead_id: appointment.converted_lead_id || '' } };
}

export function hardDeleteApplication(database, applicationId, actor) {
  const index = (database.applications ?? []).findIndex((item) => item.id === applicationId);
  if (index < 0) return { error: 'Application not found.' };
  const application = database.applications[index];
  const webpageIds = [];
  if (Array.isArray(database.franchise_webpages)) {
    database.franchise_webpages = database.franchise_webpages.filter((page) => {
      const linked = page.application_id === application.id
        || page.franchisee_id === application.franchisee_id
        || page.applicant_email === application.email;
      if (linked) webpageIds.push(page.id);
      return !linked;
    });
  }
  if (Array.isArray(database.payment_vouchers)) {
    database.payment_vouchers = database.payment_vouchers.filter((voucher) => voucher.application_id !== application.id);
  }
  if (Array.isArray(database.franchisees)) {
    database.franchisees = database.franchisees.map((item) => {
      if (item.application_id === application.id || item.franchisee_id === application.franchisee_id) {
        return { ...item, is_featured: false, enabled: false, deboarded: true };
      }
      return item;
    });
  }
  const territoriesReleased = releaseApplicationTerritory(database, application);
  database.applications.splice(index, 1);
  database.admin_audit_log = pushAudit(database.admin_audit_log, {
    action: 'hard_delete_application',
    actor_name: actor?.name,
    actor_role: actor?.role,
    target: applicationId,
    entity_type: 'application',
    entity_id: applicationId,
    details: `Permanently deleted applicant ${application.application_number || applicationId} and linked workflow data.`,
  });
  return {
    application,
    cascade: {
      hec_lead_id: application.hec_lead_id || '',
      hec_franchisee_profile: application.hec_franchisee_profile || '',
      franchisee_id: application.franchisee_id || '',
      partner_portal_user_id: application.partner_portal?.user_id || application.partner_portal?.email || '',
      webpage_ids: webpageIds,
      territories_released: territoriesReleased,
    },
  };
}

export function hardDeletePaymentSubmission(database, applicationId, paymentKey, actor) {
  const application = (database.applications ?? []).find((item) => item.id === applicationId);
  if (!application) return { error: 'Application not found.' };
  if (!Array.isArray(application.payments)) application.payments = [];
  const paymentIndex = application.payments.findIndex((item) => item.key === paymentKey);
  if (paymentIndex < 0) return { error: 'Payment submission not found.' };
  const payment = application.payments[paymentIndex];
  application.payments.splice(paymentIndex, 1);
  if (Array.isArray(database.payment_vouchers)) {
    database.payment_vouchers = database.payment_vouchers.filter(
      (voucher) => !(voucher.application_id === application.id && voucher.payment_key === paymentKey),
    );
  }
  application.updated_at = nowIso();
  database.admin_audit_log = pushAudit(database.admin_audit_log, {
    action: 'hard_delete_payment',
    actor_name: actor?.name,
    actor_role: actor?.role,
    target: `${applicationId}:${paymentKey}`,
    entity_type: 'payment',
    entity_id: paymentKey,
    details: `Permanently deleted payment ${payment.label || paymentKey} on application ${application.application_number || applicationId}.`,
  });
  return {
    application,
    payment,
    cascade: {
      partner_portal_user_id: application.partner_portal?.user_id || '',
      application_id: application.id,
      payment_key: paymentKey,
    },
  };
}
