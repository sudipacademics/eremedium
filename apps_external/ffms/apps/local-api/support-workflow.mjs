import { randomUUID } from 'node:crypto';

export const SUPPORT_TICKET_STATUSES = ['open', 'pending', 'replied', 'resolved', 'closed'];
export const SUPPORT_TICKET_CATEGORIES = ['documents', 'payments', 'territory', 'training', 'agreement', 'technical', 'general'];

export const REMEDIUM_DEFAULT_BUSINESS_CALL = '03369029634';
export const REMEDIUM_DEFAULT_BUSINESS_WHATSAPP = '91932398173';
export const REMEDIUM_DEFAULT_TECHNICAL_CALL = '03369029635';
export const REMEDIUM_DEFAULT_TECHNICAL_WHATSAPP = '919876543210';

const defaultSupportSettings = {
  whatsapp_number: '',
  ivr_call_number: '',
  technical_support_number: '',
  technical_whatsapp_number: '',
  support_email: '',
  support_hours: 'Monday to Saturday: 9:00 AM - 6:00 PM IST',
  sla_response_hours: 24,
};

function pickNonEmpty(...values) {
  for (const value of values) {
    const next = String(value ?? '').trim();
    if (next) return next;
  }
  return '';
}

export function defaultSupportSettingsFromCompany(companyProfile = {}) {
  return {
    ...defaultSupportSettings,
    whatsapp_number: pickNonEmpty(companyProfile.whatsapp_number, REMEDIUM_DEFAULT_BUSINESS_WHATSAPP),
    ivr_call_number: pickNonEmpty(companyProfile.company_phone, REMEDIUM_DEFAULT_BUSINESS_CALL),
    technical_support_number: pickNonEmpty(companyProfile.technical_support_number, REMEDIUM_DEFAULT_TECHNICAL_CALL),
    technical_whatsapp_number: pickNonEmpty(companyProfile.technical_whatsapp_number, REMEDIUM_DEFAULT_TECHNICAL_WHATSAPP),
    support_email: pickNonEmpty(companyProfile.company_email, 'support@remediumlab.com'),
  };
}

export function supportSettingsRecord(value, companyProfile = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const fallback = defaultSupportSettingsFromCompany(companyProfile);
  return {
    whatsapp_number: String(source.whatsapp_number ?? fallback.whatsapp_number ?? '').trim(),
    ivr_call_number: String(source.ivr_call_number ?? fallback.ivr_call_number ?? '').trim(),
    technical_support_number: String(source.technical_support_number ?? fallback.technical_support_number ?? '').trim(),
    technical_whatsapp_number: String(source.technical_whatsapp_number ?? fallback.technical_whatsapp_number ?? '').trim(),
    support_email: String(source.support_email ?? fallback.support_email ?? '').trim(),
    support_hours: String(source.support_hours ?? fallback.support_hours ?? defaultSupportSettings.support_hours).trim(),
    sla_response_hours: Number(source.sla_response_hours) > 0 ? Number(source.sla_response_hours) : defaultSupportSettings.sla_response_hours,
  };
}

export function resolvePublicSupportSettings(value, companyProfile = {}) {
  const stored = supportSettingsRecord(value, companyProfile);
  const defaults = defaultSupportSettingsFromCompany(companyProfile);
  return {
    ...stored,
    whatsapp_number: pickNonEmpty(stored.whatsapp_number, defaults.whatsapp_number),
    ivr_call_number: pickNonEmpty(stored.ivr_call_number, defaults.ivr_call_number),
    technical_support_number: pickNonEmpty(stored.technical_support_number, defaults.technical_support_number),
    technical_whatsapp_number: pickNonEmpty(stored.technical_whatsapp_number, defaults.technical_whatsapp_number),
    support_email: pickNonEmpty(stored.support_email, defaults.support_email),
  };
}

export function supportSettingsFromBody(body, current = {}, companyProfile = {}) {
  const base = supportSettingsRecord(current, companyProfile);
  return supportSettingsRecord({
    whatsapp_number: body.whatsapp_number ?? base.whatsapp_number,
    ivr_call_number: body.ivr_call_number ?? base.ivr_call_number,
    technical_support_number: body.technical_support_number ?? base.technical_support_number,
    technical_whatsapp_number: body.technical_whatsapp_number ?? base.technical_whatsapp_number,
    support_email: body.support_email ?? base.support_email,
    support_hours: body.support_hours ?? base.support_hours,
    sla_response_hours: body.sla_response_hours ?? base.sla_response_hours,
  }, companyProfile);
}

export function phoneTelHref(number) {
  const digits = String(number ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `tel:+91${digits}`;
  if (digits.startsWith('91') && digits.length === 12) return `tel:+${digits}`;
  return `tel:+${digits}`;
}

export function whatsappHref(number, message = 'Hello, I need assistance from Remedium Lab.') {
  const digits = String(number ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function supportMessage(value, createdAt = new Date().toISOString()) {
  const source = value && typeof value === 'object' ? value : {};
  const authorType = ['applicant', 'staff', 'system'].includes(source.author_type) ? source.author_type : 'system';
  return {
    id: String(source.id ?? randomUUID()),
    author_type: authorType,
    author_name: String(source.author_name ?? 'System').trim() || 'System',
    body: String(source.body ?? source.message ?? '').trim(),
    is_internal: Boolean(source.is_internal),
    attachments: Array.isArray(source.attachments)
      ? source.attachments.map((item) => ({
        id: String(item?.id ?? randomUUID()),
        name: String(item?.name ?? 'Attachment').trim() || 'Attachment',
        url: String(item?.url ?? '').trim(),
      })).filter((item) => item.url)
      : [],
    created_at: String(source.created_at ?? createdAt),
    read_by_applicant_at: String(source.read_by_applicant_at ?? ''),
  };
}

export function nextSupportTicketNumber(tickets, year = new Date().getFullYear()) {
  const prefix = `RFMS-SUP-${year}-`;
  const max = tickets
    .map((item) => String(item?.ticket_number ?? ''))
    .filter((value) => value.startsWith(prefix))
    .map((value) => Number(value.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
    .reduce((current, value) => Math.max(current, value), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export function createSupportTicket({
  application,
  category,
  subject,
  message,
  attachments = [],
  actor = 'Applicant',
  tickets = [],
}) {
  const now = new Date().toISOString();
  const safeCategory = SUPPORT_TICKET_CATEGORIES.includes(category) ? category : 'general';
  const initialMessage = supportMessage({
    author_type: 'applicant',
    author_name: application.full_name,
    body: message,
    attachments,
    created_at: now,
  });
  return {
    id: randomUUID(),
    ticket_number: nextSupportTicketNumber(tickets),
    application_id: application.id,
    application_number: application.application_number,
    applicant_name: application.full_name,
    applicant_email: application.email,
    applicant_mobile: application.mobile,
    category: safeCategory,
    subject: String(subject ?? '').trim(),
    priority: 'normal',
    status: 'open',
    assigned_to: '',
    messages: initialMessage.body || initialMessage.attachments.length ? [initialMessage] : [],
    applicant_unread_count: 0,
    created_at: now,
    updated_at: now,
    closed_at: '',
    closed_by: '',
  };
}

export function supportTicketSummary(ticket, resolveUploadUrl = (value) => value, options = {}) {
  const includeInternal = Boolean(options.includeInternal);
  const messages = Array.isArray(ticket.messages)
    ? ticket.messages
      .filter((item) => includeInternal || !item.is_internal)
      .map((item) => ({
        ...item,
        attachments: Array.isArray(item.attachments)
          ? item.attachments.map((attachment) => ({ ...attachment, url: resolveUploadUrl(attachment.url) }))
          : [],
      }))
    : [];
  return {
    id: ticket.id,
    ticket_number: ticket.ticket_number,
    application_id: ticket.application_id,
    application_number: ticket.application_number,
    applicant_name: ticket.applicant_name,
    applicant_email: ticket.applicant_email,
    applicant_mobile: ticket.applicant_mobile,
    category: ticket.category,
    subject: ticket.subject,
    priority: ticket.priority ?? 'normal',
    status: ticket.status,
    assigned_to: ticket.assigned_to ?? '',
    messages,
    applicant_unread_count: Number(ticket.applicant_unread_count) || 0,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    closed_at: ticket.closed_at ?? '',
    closed_by: ticket.closed_by ?? '',
  };
}

export function appendSupportTicketMessage(ticket, messageInput, options = {}) {
  const now = new Date().toISOString();
  const message = supportMessage(messageInput, now);
  ticket.messages = Array.isArray(ticket.messages) ? ticket.messages : [];
  ticket.messages.push(message);
  ticket.updated_at = now;
  if (message.is_internal) return ticket;
  if (message.author_type === 'staff') {
    ticket.applicant_unread_count = (Number(ticket.applicant_unread_count) || 0) + 1;
    if (['open', 'pending'].includes(ticket.status)) ticket.status = 'replied';
  } else if (message.author_type === 'applicant') {
    if (ticket.status === 'replied' || ticket.status === 'resolved') ticket.status = 'open';
    else if (ticket.status === 'closed') ticket.status = 'open';
  }
  if (options.status && SUPPORT_TICKET_STATUSES.includes(options.status)) ticket.status = options.status;
  if (typeof options.assigned_to === 'string') ticket.assigned_to = options.assigned_to.trim();
  if (options.close) {
    ticket.status = 'closed';
    ticket.closed_at = now;
    ticket.closed_by = String(options.closed_by ?? message.author_name ?? 'RFMS Officer');
  }
  return ticket;
}

export function markSupportTicketReadByApplicant(ticket) {
  const now = new Date().toISOString();
  ticket.messages = (ticket.messages ?? []).map((item) => (
    item.author_type === 'staff' && !item.read_by_applicant_at ? { ...item, read_by_applicant_at: now } : item
  ));
  ticket.applicant_unread_count = 0;
  ticket.updated_at = now;
  return ticket;
}

export function applicantSupportUnreadCount(tickets, applicationId) {
  return tickets
    .filter((item) => item.application_id === applicationId && item.status !== 'closed')
    .reduce((total, item) => total + (Number(item.applicant_unread_count) || 0), 0);
}
