import { randomUUID } from 'node:crypto';
import { normalizeRole } from './admin-users-workflow.mjs';

export const NOTIFICATION_STATUSES = ['unread', 'read', 'archived'];

const OPERATIONAL_MODULES = new Set([
  'leads',
  'appointments',
  'applications',
  'payments',
  'agreements',
  'support',
  'training',
  'territory',
  'video_kyc',
  'field_visit',
  'onboarding',
  'franchise_webpages',
  'users',
]);

const MODULE_ROLE_ACCESS = {
  leads: [],
  appointments: [],
  agreements: ['advocate'],
  payments: ['accountant'],
  support: [],
  applications: [],
  training: [],
  territory: [],
  video_kyc: [],
  field_visit: [],
  onboarding: [],
  franchise_webpages: [],
  users: [],
};

export function notificationRecord(value, id = randomUUID()) {
  const source = value && typeof value === 'object' ? value : {};
  const status = NOTIFICATION_STATUSES.includes(source.status) ? source.status : 'unread';
  return {
    id: String(source.id ?? id),
    recipient_type: source.recipient_type === 'applicant' ? 'applicant' : 'officer',
    recipient_id: String(source.recipient_id ?? '').trim(),
    status,
    module: String(source.module ?? 'system').trim() || 'system',
    action: String(source.action ?? 'update').trim() || 'update',
    title: String(source.title ?? 'Update').trim() || 'Update',
    message: String(source.message ?? '').trim(),
    actor_name: String(source.actor_name ?? 'System').trim() || 'System',
    actor_role: normalizeRole(source.actor_role ?? 'system'),
    href: String(source.href ?? '').trim(),
    entity_type: String(source.entity_type ?? '').trim(),
    entity_id: String(source.entity_id ?? '').trim(),
    created_at: String(source.created_at ?? new Date().toISOString()),
    read_at: String(source.read_at ?? ''),
    archived_at: String(source.archived_at ?? ''),
  };
}

export function notificationSummary(record) {
  return {
    id: record.id,
    status: record.status,
    module: record.module,
    action: record.action,
    title: record.title,
    message: record.message,
    actor_name: record.actor_name,
    actor_role: record.actor_role,
    href: record.href,
    entity_type: record.entity_type,
    entity_id: record.entity_id,
    created_at: record.created_at,
    read_at: record.read_at,
    archived_at: record.archived_at,
  };
}

function officerByName(officers, name) {
  const value = String(name ?? '').trim();
  if (!value) return null;
  return (Array.isArray(officers) ? officers : []).find((item) => item.status === 'active' && item.name === value) ?? null;
}

function officerRecipients({ officers, module, actorRole, assigneeName, assigneeId }) {
  const recipients = new Map();
  const list = Array.isArray(officers) ? officers.filter((item) => item.status === 'active') : [];
  const actor = normalizeRole(actorRole);
  const assignee = assigneeId
    ? list.find((item) => item.id === assigneeId)
    : officerByName(list, assigneeName);

  for (const officer of list) {
    const role = normalizeRole(officer.role);
    if (role === 'super_admin') {
      recipients.set(officer.id, officer);
      continue;
    }
    if (role === 'manager' && OPERATIONAL_MODULES.has(module)) {
      recipients.set(officer.id, officer);
      continue;
    }
    if (module === 'users' && role === 'super_admin') {
      recipients.set(officer.id, officer);
      continue;
    }
    if (module === 'leads' && role === 'crm') {
      if (assignee && assignee.id === officer.id) recipients.set(officer.id, officer);
      continue;
    }
    if (module === 'appointments' && role === 'business_consultant') {
      if (assignee && assignee.id === officer.id) recipients.set(officer.id, officer);
      continue;
    }
    if (module === 'support') {
      if (assignee && assignee.id === officer.id) recipients.set(officer.id, officer);
      continue;
    }
    if ((MODULE_ROLE_ACCESS[module] ?? []).includes(role)) {
      recipients.set(officer.id, officer);
    }
  }

  if (actor === 'super_admin' && module !== 'users') {
    for (const officer of list) {
      if (normalizeRole(officer.role) === 'manager') recipients.set(officer.id, officer);
    }
  }

  return [...recipients.values()];
}

export function emitWorkflowNotifications({
  notifications = [],
  officers = [],
  applications = [],
  module,
  action,
  title,
  message,
  actor = {},
  href = '',
  portalHref = '',
  entityType = '',
  entityId = '',
  assigneeName = '',
  assigneeId = '',
  applicationId = '',
  applicantOnly = false,
}) {
  const now = new Date().toISOString();
  const actorName = String(actor.name ?? 'System').trim() || 'System';
  const actorRole = normalizeRole(actor.role ?? 'system');
  const created = [];
  const store = Array.isArray(notifications) ? notifications : [];

  if (!applicantOnly) {
    const recipients = officerRecipients({
      officers,
      module,
      actorRole,
      assigneeName,
      assigneeId,
    });
    for (const officer of recipients) {
      const record = notificationRecord({
        recipient_type: 'officer',
        recipient_id: officer.id,
        module,
        action,
        title,
        message,
        actor_name: actorName,
        actor_role: actorRole,
        href,
        entity_type: entityType,
        entity_id: entityId,
        created_at: now,
      });
      store.unshift(record);
      created.push(record);
    }
  }

  if (applicationId) {
    const application = (Array.isArray(applications) ? applications : []).find((item) => item.id === applicationId);
    if (application) {
      const record = notificationRecord({
        recipient_type: 'applicant',
        recipient_id: application.id,
        module,
        action,
        title,
        message,
        actor_name: actorName,
        actor_role: actorRole,
        href: portalHref || href.replace(/^admin:/, 'portal:'),
        entity_type: entityType,
        entity_id: entityId || application.id,
        created_at: now,
      });
      store.unshift(record);
      created.push(record);
    }
  }

  if (store.length > 5000) store.length = 5000;
  return created.map(notificationSummary);
}

export function notificationsForRecipient(notifications, recipientType, recipientId, status = 'all') {
  const id = String(recipientId ?? '').trim();
  return (Array.isArray(notifications) ? notifications : [])
    .filter((item) => item.recipient_type === recipientType && item.recipient_id === id)
    .filter((item) => status === 'all' || item.status === status)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function unreadNotificationCount(notifications, recipientType, recipientId) {
  return notificationsForRecipient(notifications, recipientType, recipientId, 'unread').length;
}

export function updateNotificationStatus(notifications, notificationId, recipientType, recipientId, status) {
  if (!NOTIFICATION_STATUSES.includes(status)) throw new Error('Choose a valid notification status.');
  const record = (Array.isArray(notifications) ? notifications : []).find((item) => item.id === notificationId && item.recipient_type === recipientType && item.recipient_id === recipientId);
  if (!record) return null;
  const now = new Date().toISOString();
  record.status = status;
  if (status === 'read') record.read_at = now;
  if (status === 'archived') record.archived_at = now;
  return notificationSummary(record);
}

export function markAllNotificationsRead(notifications, recipientType, recipientId) {
  const now = new Date().toISOString();
  let count = 0;
  for (const item of Array.isArray(notifications) ? notifications : []) {
    if (item.recipient_type !== recipientType || item.recipient_id !== recipientId || item.status !== 'unread') continue;
    item.status = 'read';
    item.read_at = now;
    count += 1;
  }
  return count;
}
