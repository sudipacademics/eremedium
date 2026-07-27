'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { RFMS_API_BASE } from '@rfms/utils';
import './user-management.css';

const API_BASE = RFMS_API_BASE;

const ROLES = [
  { value: 'crm', label: 'CRM' },
  { value: 'business_consultant', label: 'Business Consultant' },
  { value: 'advocate', label: 'Advocate' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'manager', label: 'Manager' },
  { value: 'super_admin', label: 'Admin' },
] as const;

type AdminUser = {
  id: string;
  employee_id: string;
  name: string;
  email: string;
  mobile: string;
  role: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  last_login_at: string;
};

type AuditEntry = {
  id: string;
  action: string;
  actor_name: string;
  actor_role: string;
  target_user_name: string;
  details: string;
  created_at: string;
};

type UserDraft = {
  employee_id: string;
  name: string;
  email: string;
  mobile: string;
  role: string;
  status: 'active' | 'inactive';
  password: string;
};

const emptyDraft = (): UserDraft => ({ employee_id: '', name: '', email: '', mobile: '', role: 'crm', status: 'active', password: '' });
const roleName = (value: string) => ROLES.find((item) => item.value === value)?.label ?? value.replaceAll('_', ' ');
const dateTime = (value?: string) => { const date = new Date(value ?? ''); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const readableAction = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export function UserManagementPanel({ notify }: { notify: (message: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState<UserDraft>(emptyDraft());
  const [resetPassword, setResetPassword] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const token = sessionStorage.getItem('rfms_auth_token') ?? '';
      const headers = { Authorization: `Bearer ${token}` };
      const [usersResponse, auditResponse] = await Promise.all([
        fetch(`${API_BASE}/admin/users`, { headers }),
        fetch(`${API_BASE}/admin/audit-log?limit=100`, { headers }),
      ]);
      const usersPayload = await usersResponse.json().catch(() => null) as { success?: boolean; data?: AdminUser[]; error?: { message?: string } } | null;
      const auditPayload = await auditResponse.json().catch(() => null) as { success?: boolean; data?: AuditEntry[] } | null;
      if (!usersResponse.ok || !usersPayload?.success || !Array.isArray(usersPayload.data)) throw new Error(usersPayload?.error?.message ?? 'Unable to load admin users.');
      setUsers(usersPayload.data);
      if (auditResponse.ok && auditPayload?.success && Array.isArray(auditPayload.data)) setAuditLog(auditPayload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load admin users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setEditingId('');
    setDraft(emptyDraft());
    setResetPassword('');
    setModalOpen(true);
  }

  function openEdit(user: AdminUser) {
    setEditingId(user.id);
    setDraft({ employee_id: user.employee_id, name: user.name, email: user.email, mobile: user.mobile, role: user.role, status: user.status, password: '' });
    setResetPassword('');
    setModalOpen(true);
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const token = sessionStorage.getItem('rfms_auth_token') ?? '';
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      if (editingId) {
        const body: Record<string, string> = {
          employee_id: draft.employee_id,
          name: draft.name,
          email: draft.email,
          mobile: draft.mobile,
          role: draft.role,
          status: draft.status,
        };
        if (resetPassword.trim()) body.password = resetPassword.trim();
        const response = await fetch(`${API_BASE}/admin/users/${editingId}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
        const payload = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
        if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to update admin user.');
        notify(resetPassword.trim() ? 'User updated and password reset.' : 'User updated successfully.');
      } else {
        if (!draft.password.trim()) throw new Error('Enter a login password for the new user.');
        const response = await fetch(`${API_BASE}/admin/users`, { method: 'POST', headers, body: JSON.stringify(draft) });
        const payload = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
        if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to create admin user.');
        notify('Admin user created successfully.');
      }
      setModalOpen(false);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save admin user.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(user: AdminUser) {
    setSaving(true); setError('');
    try {
      const token = sessionStorage.getItem('rfms_auth_token') ?? '';
      const nextStatus = user.status === 'active' ? 'inactive' : 'active';
      const response = await fetch(`${API_BASE}/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to update account status.');
      notify(nextStatus === 'active' ? `${user.name} activated.` : `${user.name} deactivated.`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update account status.');
    } finally {
      setSaving(false);
    }
  }

  return <section className="user-management-panel">
    <div className="title-row"><div><h1>User management</h1><p>Create and manage CRM, business consultant, advocate, accountant, and manager accounts with strict role-based access control.</p></div><button type="button" className="lead-primary" onClick={openCreate}>Add admin user</button></div>
    {error ? <p className="application-review-error">{error}</p> : null}
    <div className="panel user-management-table-wrap">
      {loading ? <p>Loading users…</p> : null}
      {!loading ? <table className="user-management-table"><thead><tr><th>Name</th><th>Employee ID</th><th>Role</th><th>Email</th><th>Mobile</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><b>{user.name}</b></td><td>{user.employee_id}</td><td>{roleName(user.role)}</td><td>{user.email}</td><td>{user.mobile}</td><td><span className={`user-status ${user.status}`}>{readableAction(user.status)}</span></td><td>{dateTime(user.last_login_at)}</td><td className="user-actions"><button type="button" onClick={() => openEdit(user)}>Edit</button><button type="button" onClick={() => void toggleStatus(user)} disabled={saving}>{user.status === 'active' ? 'Deactivate' : 'Activate'}</button></td></tr>)}</tbody></table> : null}
    </div>
    <section className="panel user-audit-log"><div className="title-row compact"><div><h2>Audit log</h2><p>Permanent record of user creation, permission changes, login activity, password resets, and account status updates.</p></div></div>{auditLog.length ? <div className="user-audit-list">{auditLog.map((entry) => <article key={entry.id}><header><b>{readableAction(entry.action)}</b><span>{dateTime(entry.created_at)}</span></header><p>{entry.details}</p><small>{entry.actor_name} · {roleName(entry.actor_role)}{entry.target_user_name ? ` · ${entry.target_user_name}` : ''}</small></article>)}</div> : <p>No audit entries yet.</p>}</section>
    {modalOpen ? <div className="application-review-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}><form className="application-review-modal user-management-modal" onSubmit={saveUser}><header><div><p>Admin user</p><h2>{editingId ? 'Edit user account' : 'Create user account'}</h2></div><button type="button" aria-label="Close" onClick={() => setModalOpen(false)}>×</button></header><label>Full name<input required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label><label>Employee ID<input required value={draft.employee_id} onChange={(event) => setDraft((current) => ({ ...current, employee_id: event.target.value }))} /></label><label>Email address<input required type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></label><label>Mobile number<input required inputMode="numeric" value={draft.mobile} onChange={(event) => setDraft((current) => ({ ...current, mobile: event.target.value.replace(/\D/g, '').slice(0, 15) }))} /></label><label>Role<select value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))}>{ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Account status<select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as UserDraft['status'] }))}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>{editingId ? <label>Reset password<input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="Leave blank to keep current password" /></label> : <label>Login password<input required type="password" value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} placeholder="Minimum 8 characters" /></label>}<footer className="application-review-footer"><button type="button" onClick={() => setModalOpen(false)}>Cancel</button><button type="submit" className="lead-primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create user'}</button></footer></form></div> : null}
  </section>;
}
