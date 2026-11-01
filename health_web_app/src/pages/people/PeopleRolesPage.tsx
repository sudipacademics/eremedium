import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type PeopleAccessEmployee,
  type PeopleAccessRole,
  type PeopleRolesBoard,
} from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import { Avatar, downloadCsv, FilterDropdown, Pager, PER_PAGE_OPTIONS } from './peopleTableKit';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-attendance.css';
import './people-leave.css';
import './people-roles.css';

type Tab = 'roles' | 'users' | 'matrix' | 'portals' | 'audit';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'roles', label: 'Roles' },
  { id: 'users', label: 'User Management' },
  { id: 'matrix', label: 'Permission Matrix' },
  { id: 'portals', label: 'Portal Access' },
  { id: 'audit', label: 'Audit Log' },
];

const EMPTY_ROLE = {
  title: '',
  description: '',
  portals: [] as string[],
  permissions: [] as string[],
  frappe_role: '',
  status: 'Active',
  tone: 'blue',
};

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

function randPass() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return `Access@${out}`;
}

function fmtWhen(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function EmpPicker({
  employees,
  value,
  onPick,
}: {
  employees: PeopleAccessEmployee[];
  value: string;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = employees.find((e) => e.id === value);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return employees
      .filter((e) => !n || `${e.name} ${e.id} ${e.designation} ${e.department}`.toLowerCase().includes(n))
      .slice(0, 40);
  }, [employees, q]);
  return (
    <div className="rl-picker">
      <button type="button" className="rl-picker-btn" onClick={() => setOpen((v) => !v)}>
        {selected ? <Avatar id={selected.id} name={selected.name} /> : <HrmsIcon name="users" size={16} />}
        <span>
          {selected ? selected.name : 'Select employee'}
          <small>{selected ? `${selected.id}${selected.designation ? ` · ${selected.designation}` : ''}` : 'Search directory'}</small>
        </span>
      </button>
      {open ? (
        <div className="rl-picker-menu">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employees…" autoFocus />
          <ul>
            {rows.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className={e.id === value ? 'on' : ''}
                  onClick={() => {
                    onPick(e.id);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  <Avatar id={e.id} name={e.name} />
                  <span>
                    {e.name}
                    <small>
                      {e.id}
                      {e.designation ? ` · ${e.designation}` : ''}
                    </small>
                  </span>
                </button>
              </li>
            ))}
            {!rows.length ? <li className="lv-muted" style={{ padding: 8 }}>No match</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function PeopleRolesPage({ preview }: { preview?: PeopleRolesBoard }) {
  const [isManager, setIsManager] = useState<boolean | null>(preview ? true : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    void (async () => {
      try {
        const res = await api.getPeopleHrmsDashboard();
        if (alive) setIsManager(Boolean(res.data.is_manager));
      } catch (err) {
        if (alive) setError(err instanceof Error && err.message ? err.message : 'Unable to load roles');
      }
    })();
    return () => {
      alive = false;
    };
  }, [preview]);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="lv-muted">Loading roles…</p>;
  return <RolesDesk preview={preview} manager={Boolean(isManager)} />;
}

function RolesDesk({ preview, manager }: { preview?: PeopleRolesBoard; manager: boolean }) {
  const [board, setBoard] = useState<PeopleRolesBoard | null>(preview || null);
  const [tab, setTab] = useState<Tab>('roles');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[0]);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [modal, setModal] = useState<null | { mode: 'create' | 'edit'; role: typeof EMPTY_ROLE & { id?: string } }>(null);
  const [empId, setEmpId] = useState(preview?.employees[0]?.id || '');
  const [roleId, setRoleId] = useState(preview?.roles.find((r) => r.title === 'Employee')?.id || preview?.roles[3]?.id || '');
  const [portals, setPortals] = useState<string[]>(preview?.employees[0] ? ['hrms', 'employee', 'lab'] : []);
  const [perms, setPerms] = useState<string[]>([
    'dashboard',
    'profile',
    'view_profile',
    'edit_profile',
    'attendance',
    'mark_attendance',
    'view_attendance',
    'leave',
    'apply_leave',
    'view_leave',
  ]);
  const [permMode, setPermMode] = useState<'module' | 'custom'>('module');
  const [autoGen, setAutoGen] = useState(true);
  const [loginId, setLoginId] = useState(preview?.users[0]?.login_id || 'EMP01233');
  const [password, setPassword] = useState('••••••••');
  const [plainPw, setPlainPw] = useState('');
  const [enabled, setEnabled] = useState(true);

  const load = useCallback(async () => {
    if (preview) {
      setBoard(preview);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.getPeopleRoles();
      setBoard(res.data);
    } catch (e) {
      setError(errMsg(e, 'Unable to load roles'));
    } finally {
      setLoading(false);
    }
  }, [preview]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!board || empId) return;
    const first = board.employees[0];
    if (first) setEmpId(first.id);
  }, [board, empId]);

  const roles = board?.roles || [];
  const users = board?.users || [];
  const employees = board?.employees || [];
  const portalCat = board?.portals || [];
  const modules = board?.modules || [];
  const selectedEmp = employees.find((e) => e.id === empId) || users.find((u) => u.id === empId);
  const selectedUser = users.find((u) => u.id === empId);
  const selectedRole = roles.find((r) => r.id === roleId);

  useEffect(() => {
    if (!selectedUser) return;
    if (selectedUser.login_id) setLoginId(selectedUser.login_id);
    if (selectedUser.role_title) {
      const match = roles.find((r) => r.title === selectedUser.role_title || r.id === selectedUser.assignment);
      if (match) setRoleId(match.id);
    }
    if (selectedUser.portals?.length) setPortals(selectedUser.portals);
    if (selectedUser.permissions?.length) setPerms(selectedUser.permissions);
    setEnabled(selectedUser.status === 'Active');
  }, [selectedUser, roles]);

  const filteredRoles = useMemo(() => {
    const n = q.trim().toLowerCase();
    return roles.filter((r) => {
      if (status && r.status !== status) return false;
      if (n && !`${r.title} ${r.description} ${r.portal_labels.join(' ')}`.toLowerCase().includes(n)) return false;
      return true;
    });
  }, [roles, q, status]);

  const filteredUsers = useMemo(() => {
    const n = q.trim().toLowerCase();
    return users.filter((u) => {
      if (status && u.status !== status) return false;
      if (n && !`${u.name} ${u.id} ${u.department} ${u.role_title}`.toLowerCase().includes(n)) return false;
      return true;
    });
  }, [users, q, status]);

  const list = tab === 'users' ? filteredUsers : filteredRoles;
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const slice = list.slice((page - 1) * perPage, page * perPage);

  const k = board?.kpis;
  const kpis = [
    { label: 'Total Employees', value: k?.employees ?? 0, icon: 'users', tone: 'blue' },
    { label: 'Total Roles', value: k?.roles ?? 0, icon: 'shield', tone: 'violet' },
    {
      label: 'Active Users',
      value: k?.active_users ?? 0,
      icon: 'userCheck',
      tone: 'green',
      delta: k?.active_delta,
      up: true,
    },
    {
      label: 'Inactive Users',
      value: k?.inactive_users ?? 0,
      icon: 'userX',
      tone: 'rose',
      delta: k?.inactive_delta,
      up: false,
    },
    { label: 'Total Portals', value: k?.portals ?? 0, icon: 'layers', tone: 'cyan' },
  ];

  function toggle(listVal: string[], id: string, on: boolean) {
    return on ? Array.from(new Set([...listVal, id])) : listVal.filter((x) => x !== id);
  }

  function applyRole(role: PeopleAccessRole) {
    setRoleId(role.id);
    setPortals(role.portals || []);
    setPerms(role.permissions || []);
  }

  function openCreate() {
    setModal({ mode: 'create', role: { ...EMPTY_ROLE } });
  }

  function openEdit(role: PeopleAccessRole) {
    setModal({
      mode: 'edit',
      role: {
        id: role.id,
        title: role.title,
        description: role.description || '',
        portals: role.portals || [],
        permissions: role.permissions || [],
        frappe_role: role.frappe_role || '',
        status: role.status,
        tone: role.tone || 'blue',
      },
    });
    applyRole(role);
  }

  async function saveRole() {
    if (!modal || !manager) return;
    if (!modal.role.title.trim()) {
      setError('Role Name is required');
      return;
    }
    if (preview) {
      setNotice(modal.mode === 'edit' ? 'Role updated in preview.' : 'Role created in preview.');
      setModal(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.savePeopleRole({
        id: modal.role.id,
        title: modal.role.title,
        description: modal.role.description,
        portals: modal.role.portals,
        permissions: modal.role.permissions,
        frappe_role: modal.role.frappe_role,
        status: modal.role.status,
        tone: modal.role.tone,
      });
      setNotice('Role saved.');
      setModal(null);
      await load();
    } catch (e) {
      setError(errMsg(e, 'Unable to save role'));
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    if (!manager || !empId) return;
    if (preview) {
      setNotice(`Access assigned to ${selectedEmp?.name || empId} in preview.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.assignPeopleAccess({
        employee: empId,
        role: roleId,
        portals,
        permissions: perms,
        status: enabled ? 'Active' : 'Inactive',
        generate: autoGen ? 1 : 0,
        password: autoGen && plainPw ? plainPw : undefined,
        login_id: loginId,
      });
      if (res.data.password) {
        setPlainPw(res.data.password);
        setPassword(res.data.password);
        setNotice(`Access assigned. Temporary password: ${res.data.password}`);
      } else {
        setNotice('Access assigned.');
      }
      await load();
    } catch (e) {
      setError(errMsg(e, 'Unable to assign access'));
    } finally {
      setBusy(false);
    }
  }

  function exportKind(kind: 'roles' | 'users' | 'audit') {
    setExportOpen(false);
    if (preview) {
      if (kind === 'users') {
        downloadCsv(
          'people-users.csv',
          ['Employee', 'ID', 'Department', 'Role', 'Status'],
          users.map((u) => [u.name, u.id, u.department, u.role_title, u.status]),
        );
      } else if (kind === 'audit') {
        downloadCsv(
          'people-role-audit.csv',
          ['When', 'Actor', 'Action', 'Target', 'Detail'],
          (board?.audit || []).map((a) => [a.when, a.actor, a.action, a.target, a.detail]),
        );
      } else {
        downloadCsv(
          'people-roles.csv',
          ['Role', 'Portals', 'Description', 'Users', 'Status'],
          roles.map((r) => [r.title, r.portal_labels.join('; '), r.description, r.users, r.status]),
        );
      }
      return;
    }
    void (async () => {
      try {
        const res = await api.exportPeopleRoles(kind);
        downloadCsv(`people-${res.data.kind}.csv`, res.data.header, res.data.lines);
      } catch (e) {
        setError(errMsg(e, 'Unable to export'));
      }
    })();
  }

  return (
    <div className="hrms-list-page emp-page dep-page lv-page rl-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="shield" size={28} />
          </span>
          <div>
            <h1>Role & Permissions</h1>
            <p>Manage portal access, user roles and permissions for employees. Assign which portals an employee can access and define their role and module permissions.</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <button type="button" className="emp-btn" onClick={() => { setTab('matrix'); setPage(1); }}>
            <HrmsIcon name="grid" size={16} />
            Permission Matrix
          </button>
          {manager ? (
            <button type="button" className="emp-btn primary lg" onClick={openCreate}>
              <HrmsIcon name="plus" size={17} />
              Create Role
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}
      {notice ? (
        <div className="dsg-selbar">
          <span className="emp-notice">{notice}</span>
        </div>
      ) : null}

      <div className="att-kpis rl-kpis">
        {kpis.map((kp) => (
          <div key={kp.label} className="emp-card att-kpi">
            <span className={`dep-kpi-icon ${kp.tone}`}>
              <HrmsIcon name={kp.icon} size={22} />
            </span>
            <div>
              <b>{kp.label}</b>
              <strong>{kp.value}</strong>
              {kp.delta != null && kp.delta !== 0 ? (
                <small className={kp.up ? 'up' : 'down'}>
                  {kp.up ? '↑' : '↓'} {Math.abs(kp.delta)}% vs last month
                </small>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="rl-split">
        <section className="emp-card att-main rl-board">
          <div className="att-tabs-row">
            <div className="att-tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={tab === t.id ? 'on' : ''}
                  onClick={() => {
                    setTab(t.id);
                    setPage(1);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {tab === 'roles' || tab === 'users' ? (
            <div className="emp-toolbar">
              <label className="emp-search att-search">
                <HrmsIcon name="search" size={16} />
                <input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                  placeholder={tab === 'users' ? 'Search users…' : 'Search roles…'}
                />
              </label>
              <FilterDropdown value={status} allLabel="All Status" options={['Active', 'Inactive']} onChange={(v) => { setStatus(v); setPage(1); }} label="Status" />
              <div className="emp-export att-export-menu" style={{ position: 'relative' }}>
                <button type="button" className="emp-btn" onClick={() => setExportOpen((v) => !v)}>
                  <HrmsIcon name="download" size={16} />
                  Export
                </button>
                {exportOpen ? (
                  <div className="emp-menu att-export-menu" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 6, minWidth: 160 }}>
                    <button type="button" className="emp-btn" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => exportKind('roles')}>Roles CSV</button>
                    <button type="button" className="emp-btn" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => exportKind('users')}>Users CSV</button>
                    <button type="button" className="emp-btn" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => exportKind('audit')}>Audit CSV</button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {loading ? <p className="lv-muted" style={{ padding: 16 }}>Loading…</p> : null}

          {tab === 'roles' ? (
            <>
              <div className="emp-table-wrap">
                <table className="emp-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Role Name</th>
                      <th>Portal(s)</th>
                      <th>Description</th>
                      <th>Users</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(slice as PeopleAccessRole[]).map((r, i) => (
                      <tr key={r.id} className={r.id === roleId ? 'on' : ''}>
                        <td>{(page - 1) * perPage + i + 1}</td>
                        <td>
                          <div className="rl-role">
                            <span className={`rl-dot ${r.tone || 'blue'}`}>
                              <HrmsIcon name="shield" size={14} />
                            </span>
                            <b>{r.title}</b>
                          </div>
                        </td>
                        <td>
                          <div className="rl-portals">
                            {portalCat.length && r.portals.length >= portalCat.length
                              ? 'All Portals'
                              : (r.portal_labels.length ? r.portal_labels : r.portals)
                                  .map((p) => p.replace(/ Portal$/, ''))
                                  .join(' · ') || '—'}
                          </div>
                        </td>
                        <td>{r.description || '—'}</td>
                        <td>{r.users}</td>
                        <td>
                          <span className={`emp-pill ${r.status === 'Active' ? 'green' : 'rose'}`}>{r.status}</span>
                        </td>
                        <td>
                          <div className="rl-acts">
                            <button type="button" title="View" onClick={() => applyRole(r)}>
                              <HrmsIcon name="eye" size={14} />
                            </button>
                            {manager ? (
                              <button type="button" title="Edit" onClick={() => openEdit(r)}>
                                <HrmsIcon name="pencil" size={14} />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!slice.length ? (
                      <tr>
                        <td className="emp-empty" colSpan={7}>No roles in this view.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <Pager
                page={page}
                pages={pages}
                perPage={perPage}
                onPage={setPage}
                onPerPage={(n) => { setPerPage(n); setPage(1); }}
                summary={`Showing ${filteredRoles.length ? (page - 1) * perPage + 1 : 0} to ${Math.min(page * perPage, filteredRoles.length)} of ${filteredRoles.length}`}
              />
            </>
          ) : null}

          {tab === 'users' ? (
            <>
              <div className="emp-table-wrap">
                <table className="emp-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Role</th>
                      <th>Login</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(slice as typeof users).map((u) => (
                      <tr key={u.id} className={u.id === empId ? 'on' : ''} onClick={() => setEmpId(u.id)}>
                        <td>
                          <div className="emp-person lv-person">
                            <Avatar id={u.id} name={u.name} />
                            <span>
                              <b>{u.name}</b>
                              <small>{u.id}</small>
                            </span>
                          </div>
                        </td>
                        <td>{u.department || '—'}</td>
                        <td>{u.role_title || '—'}</td>
                        <td>{u.login_id || '—'}</td>
                        <td>
                          <span className={`emp-pill ${u.status === 'Active' ? 'green' : 'rose'}`}>{u.status}</span>
                        </td>
                      </tr>
                    ))}
                    {!slice.length ? (
                      <tr>
                        <td className="emp-empty" colSpan={5}>No users in this view.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <Pager
                page={page}
                pages={pages}
                perPage={perPage}
                onPage={setPage}
                onPerPage={(n) => { setPerPage(n); setPage(1); }}
                summary={`Showing ${filteredUsers.length ? (page - 1) * perPage + 1 : 0} to ${Math.min(page * perPage, filteredUsers.length)} of ${filteredUsers.length}`}
              />
            </>
          ) : null}

          {tab === 'matrix' ? (
            <div className="rl-matrix emp-table-wrap">
              <table className="emp-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    {modules.map((m) => (
                      <th key={m.id}>{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="rl-role">
                          <span className={`rl-dot ${r.tone || 'blue'}`}>
                            <HrmsIcon name="shield" size={14} />
                          </span>
                          <b>{r.title}</b>
                        </div>
                      </td>
                      {modules.map((m) => (
                        <td key={m.id}>
                          {r.permissions.includes(m.id) ? <span className="rl-ok">✓</span> : <span className="rl-no">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === 'portals' ? (
            <div className="rl-portal-grid">
              {portalCat.map((p) => {
                const owners = roles.filter((r) => r.portals.includes(p.id) && r.status === 'Active');
                return (
                  <article key={p.id} className="rl-portal-card">
                    <h3>{p.label}</h3>
                    <p>{p.hint}</p>
                    <ul>
                      {owners.length ? owners.map((r) => <li key={r.id}>{r.title}</li>) : <li>No active roles</li>}
                    </ul>
                  </article>
                );
              })}
            </div>
          ) : null}

          {tab === 'audit' ? (
            <div className="emp-table-wrap">
              <table className="emp-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {(board?.audit || []).map((a) => (
                    <tr key={a.id}>
                      <td>{fmtWhen(a.when)}</td>
                      <td>{a.actor}</td>
                      <td>{a.action}</td>
                      <td>{a.target}</td>
                      <td>{a.detail}</td>
                    </tr>
                  ))}
                  {!board?.audit?.length ? (
                    <tr>
                      <td className="emp-empty" colSpan={5}>No access changes logged yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}

          {selectedEmp ? (
            <div className="rl-summary">
              <div className="rl-summary-person">
                <Avatar id={selectedEmp.id} name={selectedEmp.name} />
                <span>
                  <b>{selectedEmp.name}</b>
                  <small>
                    {selectedEmp.id}
                    {selectedEmp.designation ? ` · ${selectedEmp.designation}` : ''}
                  </small>
                </span>
              </div>
              <div className="rl-summary-meta">
                <span>
                  <i>Assigned Portals</i>
                  {(selectedUser?.portals?.length ? selectedUser.portals : portals)
                    .map((id) => portalCat.find((p) => p.id === id)?.label || id)
                    .join(' · ') || '—'}
                </span>
                <span>
                  <i>Role</i>
                  {selectedRole?.title || selectedUser?.role_title || '—'}
                </span>
                <span>
                  <i>Status</i>
                  {enabled ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="emp-card rl-side rl-side-card">
          <h2>Assign Employee Access</h2>
          <div className="rl-step">
            <div className="rl-step-label">
              <span className="rl-step-n">1</span>
              Select Employee <span className="rl-req">*</span>
            </div>
            <EmpPicker employees={employees} value={empId} onPick={setEmpId} />
          </div>
          <div className="rl-step">
            <div className="rl-step-label">
              <span className="rl-step-n">2</span>
              Select Portal(s) <span className="rl-req">*</span>
            </div>
            <div className="rl-checks">
              {portalCat.map((p) => (
                <label key={p.id} className="rl-check">
                  <input
                    type="checkbox"
                    checked={portals.includes(p.id)}
                    disabled={!manager}
                    onChange={(e) => setPortals(toggle(portals, p.id, e.target.checked))}
                  />
                  <span>
                    {p.label}
                    <small>{p.hint}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="rl-step">
            <div className="rl-step-label">
              <span className="rl-step-n">3</span>
              Select Role <span className="rl-req">*</span>
            </div>
            <select
              value={roleId}
              disabled={!manager}
              onChange={(e) => {
                const next = roles.find((r) => r.id === e.target.value);
                if (next) applyRole(next);
                else setRoleId(e.target.value);
              }}
            >
              <option value="">Select role</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </div>
          <div className="rl-step">
            <div className="rl-step-label">
              <span className="rl-step-n">4</span>
              Set Permissions <span className="rl-req">*</span>
            </div>
            <div className="rl-perm-tabs">
              <button type="button" className={permMode === 'module' ? 'on' : ''} onClick={() => setPermMode('module')}>
                Module-wise
              </button>
              <button type="button" className={permMode === 'custom' ? 'on' : ''} onClick={() => setPermMode('custom')}>
                Custom
              </button>
            </div>
            <div className="rl-perm-tree">
              {modules.map((m) => (
                <div key={m.id}>
                  <label className="rl-check">
                    <input
                      type="checkbox"
                      checked={perms.includes(m.id)}
                      disabled={!manager}
                      onChange={(e) => {
                        const kids = (m.children || []).map((c) => c.id);
                        const next = toggle(perms, m.id, e.target.checked);
                        setPerms(e.target.checked ? Array.from(new Set([...next, ...kids])) : next.filter((x) => !kids.includes(x)));
                      }}
                    />
                    {m.label}
                  </label>
                  {m.children?.length && (permMode === 'module' || permMode === 'custom') ? (
                    <div className="rl-perm-kids">
                      {m.children.map((c) => (
                        <label key={c.id} className="rl-check">
                          <input
                            type="checkbox"
                            checked={perms.includes(c.id)}
                            disabled={!manager}
                            onChange={(e) => setPerms(toggle(perms, c.id, e.target.checked))}
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div className="rl-step">
            <div className="rl-login">
              <div className="rl-login-head">
                <span>
                  <span className="rl-step-n">5</span> Login Details
                </span>
                <label className="rl-check">
                  <input type="checkbox" checked={autoGen} disabled={!manager} onChange={(e) => setAutoGen(e.target.checked)} />
                  Auto generate credentials
                </label>
              </div>
              <div className="rl-login-grid">
                <label>
                  User ID
                  <input value={loginId} disabled={!manager} onChange={(e) => setLoginId(e.target.value)} />
                </label>
                <label>
                  Password
                  <span className="rl-pw">
                    <input value={password} disabled={!manager} onChange={(e) => { setPassword(e.target.value); setPlainPw(e.target.value); }} />
                    <button
                      type="button"
                      disabled={!manager}
                      onClick={() => {
                        const pw = randPass();
                        setPlainPw(pw);
                        setPassword(pw);
                        setAutoGen(true);
                      }}
                    >
                      Generate
                    </button>
                  </span>
                </label>
              </div>
            </div>
          </div>
          <div className="rl-status-row">
            <span>
              <span className="rl-step-n">6</span> Status
            </span>
            <button
              type="button"
              className={`rl-switch${enabled ? ' on' : ''}`}
              disabled={!manager}
              onClick={() => setEnabled((v) => !v)}
              aria-label="Status"
            >
              <i />
            </button>
            <b>{enabled ? 'Active' : 'Inactive'}</b>
          </div>
          <div className="rl-side-actions">
            <button
              type="button"
              className="emp-btn"
              onClick={() => {
                setPortals([]);
                setPerms([]);
                setRoleId('');
              }}
            >
              Cancel
            </button>
            {manager ? (
              <button type="button" className="emp-btn primary" disabled={!empId || busy} onClick={() => void assign()}>
                Assign Access
              </button>
            ) : null}
          </div>
        </aside>
      </div>

      {modal ? (
        <div className="rl-modal" role="dialog" aria-label="Create Role">
          <div className="rl-modal-card">
            <h2>{modal.mode === 'edit' ? 'Edit Role' : 'Create Role'}</h2>
            <label className="rl-field">
              Role Name
              <input
                value={modal.role.title}
                onChange={(e) => setModal({ ...modal, role: { ...modal.role, title: e.target.value } })}
              />
            </label>
            <label className="rl-field">
              Description
              <textarea
                value={modal.role.description}
                onChange={(e) => setModal({ ...modal, role: { ...modal.role, description: e.target.value } })}
              />
            </label>
            <div className="rl-field">
              Portals
              <div className="rl-checks">
                {portalCat.map((p) => (
                  <label key={p.id} className="rl-check">
                    <input
                      type="checkbox"
                      checked={modal.role.portals.includes(p.id)}
                      onChange={(e) =>
                        setModal({
                          ...modal,
                          role: { ...modal.role, portals: toggle(modal.role.portals, p.id, e.target.checked) },
                        })
                      }
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
            <label className="rl-field">
              Map to existing role
              <select
                value={modal.role.frappe_role}
                onChange={(e) => setModal({ ...modal, role: { ...modal.role, frappe_role: e.target.value } })}
              >
                <option value="">None</option>
                {(board?.frappe_roles || []).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="rl-field">
              Status
              <select
                value={modal.role.status}
                onChange={(e) => setModal({ ...modal, role: { ...modal.role, status: e.target.value } })}
              >
                <option>Active</option>
                <option>Inactive</option>
              </select>
            </label>
            <div className="rl-modal-actions">
              <button type="button" className="emp-btn" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="button" className="emp-btn primary" disabled={busy} onClick={() => void saveRole()}>
                Save Role
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
