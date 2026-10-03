'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { formatDateTime, type StaffList, type StaffRole } from '@/lib/admin-types';
import { api, session } from '@/lib/api';

const PERMISSION_LABELS: Record<string, string> = {
  'dashboard.view': 'Dashboard',
  'content.manage': 'Content',
  'catalog.manage': 'Catalog',
  'operations.manage': 'Bookings & orders',
  'support.manage': 'Support',
  'finance.view': 'Finance',
  'providers.manage': 'Providers',
  'joinRequests.manage': 'Join requests',
  'staff.manage': 'Staff & roles',
  'audit.view': 'Audit log',
};

function Staff() {
  const [data, setData] = useState<StaffList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('MANAGER');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get<StaffList>('admin/staff'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load staff');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api.post('admin/staff', { phone, role, ...(name.trim() ? { name: name.trim() } : {}) });
      setPhone('');
      setName('');
    }, 'Staff member added. They get access the next time they sign in with that mobile number.');
  }

  const roleLabel = (value: StaffRole) => data?.roles.find((r) => r.role === value)?.label ?? value;
  const myUserId = session.profile?.userId;

  return (
    <div className="space-y-5">
      {message && <p className="rounded-xl bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-200">{message}</p>}
      {error && <p className="rounded-xl bg-rose-400/10 px-4 py-2.5 text-sm text-rose-200">{error}</p>}

      <form onSubmit={add} className="card grid gap-3 sm:grid-cols-4 sm:items-end">
        <div className="sm:col-span-4">
          <h2 className="font-semibold text-white">Add a staff member</h2>
          <p className="text-sm text-slate-400">Staff sign in with OTP on their own mobile number. Changes apply immediately.</p>
        </div>
        <div>
          <label className="label" htmlFor="staff-phone">
            Mobile number
          </label>
          <input id="staff-phone" className="input" required placeholder="+91 98xxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="staff-name">
            Name (new accounts)
          </label>
          <input id="staff-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="staff-role">
            Role
          </label>
          <select id="staff-role" className="input" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            {data?.roles.map((r) => (
              <option key={r.role} value={r.role}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-gold" disabled={busy}>
          Add staff
        </button>
      </form>

      <section className="card p-0">
        <h2 className="px-5 pt-5 font-semibold text-white">Team</h2>
        <ul className="mt-3 divide-y divide-white/10">
          {data?.builtIn.map((member) => (
            <li key={member.phone} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-white">{member.name ?? member.phone}</p>
                <p className="text-xs text-slate-400">{member.phone} · built-in (ADMIN_PHONES)</p>
              </div>
              <span className="pill bg-ved-gold-400/15 text-ved-gold-200">{member.roleLabel}</span>
            </li>
          ))}
          {data?.staff.map((member) => {
            const self = member.userId === myUserId;
            return (
              <li key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">
                    {member.name} {!member.active && <span className="ml-1 text-xs text-rose-300">(inactive)</span>}
                  </p>
                  <p className="text-xs text-slate-400">
                    {member.phone} · added {formatDateTime(member.createdAt)}
                  </p>
                </div>
                <select
                  aria-label={`Role for ${member.name}`}
                  className="input w-auto py-2 text-sm"
                  value={member.role}
                  disabled={busy || self}
                  onChange={(e) =>
                    void run(
                      () => api.patch(`admin/staff/${member.id}`, { role: e.target.value }),
                      `${member.name} is now ${roleLabel(e.target.value as StaffRole)}.`,
                    )
                  }
                >
                  {data.roles.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5"
                  disabled={busy || self}
                  onClick={() =>
                    void run(
                      () => api.patch(`admin/staff/${member.id}`, { active: !member.active }),
                      `${member.name} ${member.active ? 'deactivated' : 'activated'}.`,
                    )
                  }
                >
                  {member.active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-rose-300"
                  disabled={busy || self}
                  onClick={() => {
                    if (window.confirm(`Remove ${member.name} from staff?`)) {
                      void run(() => api.del(`admin/staff/${member.id}`), `${member.name} removed from staff.`);
                    }
                  }}
                >
                  Remove
                </button>
              </li>
            );
          })}
          {data && data.builtIn.length + data.staff.length === 0 && <li className="px-5 py-3 text-sm text-slate-400">No staff yet.</li>}
        </ul>
      </section>

      <section className="card">
        <h2 className="font-semibold text-white">What each role can do</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 font-medium">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data?.roles.map((r) => (
                <tr key={r.role}>
                  <td className="py-2.5 pr-4 font-medium text-white">{r.label}</td>
                  <td className="py-2.5">
                    <span className="flex flex-wrap gap-1.5">
                      {r.permissions.map((p) => (
                        <span key={p} className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-300 ring-1 ring-white/10">
                          {PERMISSION_LABELS[p] ?? p}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function StaffPage() {
  return (
    <AdminGate>
      <Staff />
    </AdminGate>
  );
}
