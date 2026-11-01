import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type PeopleOnboardingBoard,
  type PeopleOnboardingRow,
  type PeopleOnboardingStatus,
  type PeopleOnboardingTask,
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
import './people-onboarding.css';

type Tab = 'overview' | 'tasks' | 'documents' | 'orientation' | 'access' | 'reports';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Onboarding Tasks' },
  { id: 'documents', label: 'Documents' },
  { id: 'orientation', label: 'Orientation & Training' },
  { id: 'access', label: 'Access & IT Setup' },
  { id: 'reports', label: 'Reports' },
];

const STATUS_TONE: Record<PeopleOnboardingStatus, string> = {
  Completed: 'green',
  'In Progress': 'blue',
  Pending: 'amber',
  'Not Started': 'orange',
};

const STAGE_FILTER: Record<string, string[]> = {
  documents: ['documentation', 'preboarding'],
  orientation: ['orientation', 'handover'],
  access: ['access'],
};

function isoDate(d: Date) {
  return d.toLocaleDateString('en-CA');
}

function monthBounds(d = new Date()) {
  return { from: isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), to: isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pctDelta(now: number, prev: number) {
  if (!prev && !now) return null;
  if (!prev) return 100;
  return Math.round(((now - prev) / prev) * 100);
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

const CHECKLIST_TEMPLATE = [
  ['Pre-boarding', 'Issue appointment letter + employment agreement'],
  ['Documentation', 'Collect ID / address / PAN / Aadhaar and joining docs'],
  ['System Access', 'Create ERPNext User + assign roles'],
  ['System Access', 'Link Employee to User; set Designation + Grade + Salary Structure'],
  ['System Access', 'Assign leave policy / opening leave allocation'],
  ['Orientation', 'Issue kit / ID badge / marketing collateral'],
  ['Manager Handover', 'Schedule orientation with reporting manager'],
  ['Completed', 'Confirm People HRMS login'],
];

export function PeopleOnboardingPage() {
  const [isManager, setIsManager] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await api.getPeopleHrmsDashboard();
        if (alive) setIsManager(Boolean(res.data.is_manager));
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Unable to load onboarding');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="lv-muted">Loading onboarding…</p>;
  if (!isManager) {
    return (
      <section className="people-panel">
        <header>
          <div>
            <h2>Employee Onboarding</h2>
            <p>Your joining checklist will appear here once HR starts it.</p>
          </div>
        </header>
      </section>
    );
  }
  return <OnboardingManager />;
}

function OnboardingManager() {
  const initial = monthBounds();
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [board, setBoard] = useState<PeopleOnboardingBoard | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [dept, setDept] = useState('');
  const [desig, setDesig] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [viewId, setViewId] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addPick, setAddPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getPeopleOnboarding({ fromDate, toDate });
      setBoard(res.data);
    } catch (e) {
      setError(errMsg(e, 'Unable to load onboarding'));
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = board?.rows || [];
  const departments = useMemo(() => [...new Set(rows.map((r) => r.department).filter(Boolean) as string[])].sort(), [rows]);
  const designations = useMemo(() => [...new Set(rows.map((r) => r.designation).filter(Boolean) as string[])].sort(), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (dept && (r.department || '') !== dept) return false;
      if (desig && (r.designation || '') !== desig) return false;
      if (status && r.status !== status) return false;
      if (q && !`${r.name} ${r.id} ${r.department || ''} ${r.email || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, dept, desig, status, query]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [fromDate, toDate, dept, desig, status, query, perPage]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageRows = filtered.slice((page - 1) * perPage, page * perPage);
  const viewRow = rows.find((r) => r.id === viewId) || null;
  const k = board?.kpis;
  const delta = k ? pctDelta(k.new_hires, k.prev_hires) : null;
  const totalMonth = (k?.new_hires || 0) || 1;

  const kpis = [
    {
      label: 'New Hires (This Month)',
      value: k?.new_hires ?? 0,
      sub: delta == null ? 'vs last month' : `${Math.abs(delta)}% vs last month`,
      up: (delta || 0) > 0,
      down: (delta || 0) < 0,
      icon: 'userPlus' as const,
      tone: 'blue',
    },
    {
      label: 'Onboarding In Progress',
      value: k?.in_progress ?? 0,
      sub: `${Math.round(((k?.in_progress || 0) / totalMonth) * 100)}% of total`,
      icon: 'clipboard' as const,
      tone: 'amber',
    },
    {
      label: 'Completed',
      value: k?.completed ?? 0,
      sub: `${Math.round(((k?.completed || 0) / totalMonth) * 100)}% of total`,
      icon: 'checkCircle' as const,
      tone: 'green',
    },
    {
      label: 'Pending',
      value: k?.pending ?? 0,
      sub: `${Math.round(((k?.pending || 0) / totalMonth) * 100)}% of total`,
      icon: 'clock' as const,
      tone: 'orange',
    },
  ];

  const filtersDirty = dept || desig || status || query || fromDate !== initial.from || toDate !== initial.to;

  const filtersBar = (
    <div className="att-filters ob-filters">
      <label className="att-date">
        Joining Date
        <div>
          <HrmsIcon name="calendar" size={16} />
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
      </label>
      <span className="att-to">→</span>
      <label className="att-date">
        <span className="sr-only">To</span>
        <div>
          <HrmsIcon name="calendar" size={16} />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </label>
      <FilterDropdown value={dept} allLabel="All Departments" options={departments} onChange={setDept} label="Department" />
      <FilterDropdown value={desig} allLabel="All Designations" options={designations} onChange={setDesig} label="Designation" />
      <FilterDropdown
        value={status}
        allLabel="All Statuses"
        options={['Not Started', 'Pending', 'In Progress', 'Completed']}
        onChange={setStatus}
        label="Status"
      />
      <label className="emp-search att-search">
        <HrmsIcon name="search" size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by employee name, ID or email..." />
      </label>
      <button
        type="button"
        className="emp-btn"
        disabled={!filtersDirty}
        onClick={() => {
          const m = monthBounds();
          setFromDate(m.from);
          setToDate(m.to);
          setDept('');
          setDesig('');
          setStatus('');
          setQuery('');
        }}
      >
        <HrmsIcon name="reset" size={16} /> Reset
      </button>
    </div>
  );

  async function startHire(employee: string) {
    setBusy(true);
    setError('');
    try {
      await api.startEmployeeChecklist({ employee, kind: 'onboarding' });
      setNotice('Onboarding checklist started');
      setAddOpen(false);
      setAddPick('');
      await load();
      setViewId(employee);
    } catch (e) {
      setError(errMsg(e, 'Could not start onboarding'));
    } finally {
      setBusy(false);
    }
  }

  async function closeTask(todo: string) {
    setBusy(true);
    setError('');
    try {
      await api.completeChecklistTodo(todo);
      setNotice('Task completed');
      await load();
    } catch (e) {
      setError(errMsg(e, 'Could not close the task'));
    } finally {
      setBusy(false);
    }
  }

  function exportJoiners() {
    downloadCsv(
      `onboarding-${fromDate}-to-${toDate}.csv`,
      ['Employee', 'ID', 'Department', 'Designation', 'Joining Date', 'Progress', 'Status'],
      filtered.map((r) => [r.name, r.id, r.department, r.designation, r.date_of_joining, `${r.progress}%`, r.status]),
    );
  }

  const stageTasks = (keys: string[]) =>
    filtered.flatMap((r) =>
      r.tasks.filter((t) => keys.includes(t.stage)).map((t) => ({ row: r, task: t })),
    );

  return (
    <div className="hrms-list-page emp-page dep-page lv-page ob-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="userPlus" size={28} />
          </span>
          <div>
            <h1>Employee Onboarding</h1>
            <p>Manage new employee onboarding, track task completion and ensure a smooth joining experience</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <button className="emp-btn primary lg" type="button" onClick={() => setAddOpen(true)}>
            <HrmsIcon name="plus" size={17} />
            Add New Hire
          </button>
        </div>
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}
      {notice ? (
        <div className="dsg-selbar">
          <span className="emp-notice">{notice}</span>
        </div>
      ) : null}

      <section className="emp-card att-main ob-main">
        <div className="att-tabs-row">
          <nav className="att-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {tab === 'overview' ? (
          <>
            <div className="att-kpis ob-kpis">
              {kpis.map((kp) => (
                <div key={kp.label} className="emp-card att-kpi">
                  <span className={`dep-kpi-icon ${kp.tone}`}>
                    <HrmsIcon name={kp.icon} size={22} />
                  </span>
                  <div>
                    <b>{kp.label}</b>
                    <strong>{loading && !board ? '…' : kp.value}</strong>
                    <small className={kp.up ? 'up' : kp.down ? 'down' : ''}>
                      {kp.up ? '↑ ' : kp.down ? '↓ ' : ''}
                      {kp.sub}
                    </small>
                  </div>
                </div>
              ))}
            </div>

            <div className="ob-cards">
              <div className="ob-card">
                <header>
                  <b>Onboarding Progress</b>
                </header>
                <ol className="ob-steps">
                  {(board?.stages || []).map((s, i) => (
                    <li key={s.key}>
                      <span className="ob-step-num">{i + 1}</span>
                      {i < (board?.stages.length || 0) - 1 ? <i className="ob-step-line" /> : null}
                      <b>{s.label}</b>
                      <small>{s.hint}</small>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="ob-card ob-quick">
                <header>
                  <b>Quick Actions</b>
                </header>
                <div className="ob-quick-list">
                  <button type="button" className="ob-quick-btn teal" onClick={() => setAddOpen(true)}>
                    <HrmsIcon name="plus" size={16} /> Add New Hire
                  </button>
                  <button
                    type="button"
                    className="ob-quick-btn green"
                    onClick={() => {
                      const withEmail = filtered.find((r) => r.email);
                      if (withEmail?.email) window.location.href = `mailto:${withEmail.email}?subject=Welcome to Remedium`;
                      else setNotice('No joiner email available in this filter.');
                    }}
                  >
                    <HrmsIcon name="send" size={16} /> Send Welcome Email
                  </button>
                  <button
                    type="button"
                    className="ob-quick-btn blue"
                    onClick={() => downloadCsv('onboarding-checklist-template.csv', ['Stage', 'Task'], CHECKLIST_TEMPLATE)}
                  >
                    <HrmsIcon name="download" size={16} /> Download Checklist Template
                  </button>
                  <button type="button" className="ob-quick-btn violet" onClick={() => setTab('reports')}>
                    <HrmsIcon name="barChart" size={16} /> View Onboarding Report
                  </button>
                </div>
              </div>
            </div>

            {filtersBar}

            <div className="rc-section-head ob-table-head">
              <b>New Joiners ({filtered.length})</b>
            </div>
            <JoinerTable
              rows={pageRows}
              allCount={filtered.length}
              selected={selected}
              setSelected={setSelected}
              onView={setViewId}
              loading={loading}
            />
            <Pager
              page={page}
              pages={pages}
              perPage={perPage}
              onPage={setPage}
              onPerPage={setPerPage}
              summary={`Showing ${filtered.length ? (page - 1) * perPage + 1 : 0} to ${Math.min(page * perPage, filtered.length)} of ${filtered.length} employees`}
            />
          </>
        ) : null}

        {tab === 'tasks' ? (
          <TaskBoard
            items={filtered.flatMap((r) => r.tasks.map((t) => ({ row: r, task: t })))}
            loading={loading}
            busy={busy}
            onClose={closeTask}
            onView={setViewId}
            filters={filtersBar}
          />
        ) : null}
        {tab === 'documents' || tab === 'orientation' || tab === 'access' ? (
          <TaskBoard
            items={stageTasks(STAGE_FILTER[tab])}
            loading={loading}
            busy={busy}
            onClose={closeTask}
            onView={setViewId}
            filters={filtersBar}
          />
        ) : null}

        {tab === 'reports' ? (
          <div className="ob-tab-pad">
            {filtersBar}
            <div className="rc-report-actions" style={{ marginTop: 12 }}>
              <button type="button" className="emp-btn" onClick={exportJoiners} disabled={!filtered.length}>
                <HrmsIcon name="download" size={16} /> Export joiners CSV
              </button>
            </div>
            <div className="ob-dept-report">
              {departments.map((d) => {
                const list = filtered.filter((r) => r.department === d);
                const done = list.filter((r) => r.status === 'Completed').length;
                const pct = list.length ? Math.round((done / list.length) * 100) : 0;
                return (
                  <div key={d} className="ob-dept-row">
                    <b>{d}</b>
                    <span className="lv-bar">
                      <span style={{ width: `${pct}%` }} />
                    </span>
                    <small>
                      {done}/{list.length} complete
                    </small>
                  </div>
                );
              })}
              {!departments.length ? <p className="lv-muted">No department data in this range.</p> : null}
            </div>
          </div>
        ) : null}
      </section>

      {viewRow ? (
        <div className="emp-drawer-backdrop" onMouseDown={() => setViewId('')}>
          <aside className="emp-drawer lv-drawer" role="dialog" aria-modal="true" aria-label={`${viewRow.name} onboarding`} onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div className="emp-person lv-person">
                <Avatar id={viewRow.id} name={viewRow.name} photo={viewRow.photo} />
                <div>
                  <b>{viewRow.name}</b>
                  <small>
                    {viewRow.id}
                    {viewRow.designation ? ` · ${viewRow.designation}` : ''}
                  </small>
                </div>
              </div>
              <button type="button" className="emp-btn" onClick={() => setViewId('')} aria-label="Close">
                <HrmsIcon name="x" size={16} />
              </button>
            </header>
            <p className="lv-side-sub">
              Joining {fmtDate(viewRow.date_of_joining)} · {viewRow.progress}% complete
            </p>
            <span className={`emp-pill ${STATUS_TONE[viewRow.status]}`}>{viewRow.status}</span>
            <ul className="ob-task-list">
              {viewRow.tasks.map((t) => (
                <li key={t.name} className={t.status === 'Closed' ? 'done' : ''}>
                  <div>
                    <b>{t.label}</b>
                    <small>
                      {t.stage} {t.due ? `· due ${fmtDate(t.due)}` : ''}
                    </small>
                  </div>
                  {t.status === 'Closed' ? (
                    <span className="emp-pill green">Done</span>
                  ) : (
                    <button type="button" className="emp-btn" disabled={busy} onClick={() => void closeTask(t.name)}>
                      Complete
                    </button>
                  )}
                </li>
              ))}
              {!viewRow.tasks.length ? (
                <li>
                  <span>No checklist yet.</span>
                  <button type="button" className="emp-btn primary" disabled={busy} onClick={() => void startHire(viewRow.id)}>
                    Start checklist
                  </button>
                </li>
              ) : null}
            </ul>
          </aside>
        </div>
      ) : null}

      {addOpen ? (
        <div className="lv-modal-backdrop" onMouseDown={() => !busy && setAddOpen(false)}>
          <div className="lv-modal" role="dialog" aria-modal="true" aria-label="Add new hire" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div>
                <h2>Add New Hire</h2>
                <p className="lv-side-sub">Start the onboarding checklist for an existing employee.</p>
              </div>
              <button type="button" className="emp-btn" onClick={() => setAddOpen(false)} aria-label="Close">
                <HrmsIcon name="x" size={16} />
              </button>
            </header>
            <label className="att-date" style={{ width: '100%' }}>
              Employee
              <div>
                <HrmsIcon name="user" size={16} />
                <select value={addPick} onChange={(e) => setAddPick(e.target.value)}>
                  <option value="">Select…</option>
                  {(board?.eligible || []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.id}) {e.designation ? `· ${e.designation}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <p className="lv-side-sub">
              Need to create the employee record first?{' '}
              <Link to="/people/employees">Open Employees</Link>
            </p>
            <footer>
              <button type="button" className="emp-btn" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button type="button" className="emp-btn primary" disabled={!addPick || busy} onClick={() => void startHire(addPick)}>
                Start onboarding
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function JoinerTable({
  rows,
  allCount,
  selected,
  setSelected,
  onView,
  loading,
}: {
  rows: PeopleOnboardingRow[];
  allCount: number;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onView: (id: string) => void;
  loading: boolean;
}) {
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <div className="emp-table-wrap">
      <table className="emp-table lv-table ob-table">
        <thead>
          <tr>
            <th className="emp-col-check">
              <input
                type="checkbox"
                checked={allOnPage}
                disabled={!rows.length}
                onChange={() => {
                  const next = new Set(selected);
                  if (allOnPage) rows.forEach((r) => next.delete(r.id));
                  else rows.forEach((r) => next.add(r.id));
                  setSelected(next);
                }}
                aria-label="Select all on this page"
              />
            </th>
            <th>#</th>
            <th>Employee</th>
            <th>ID</th>
            <th>Department</th>
            <th>Designation</th>
            <th>Joining Date</th>
            <th>Progress</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td className="emp-col-check">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    setSelected(next);
                  }}
                  aria-label={`Select ${r.name}`}
                />
              </td>
              <td>{i + 1}</td>
              <td>
                <div className="emp-person lv-person">
                  <Avatar id={r.id} name={r.name} photo={r.photo} />
                  <div>
                    <b>{r.name}</b>
                  </div>
                </div>
              </td>
              <td>{r.id}</td>
              <td>{r.department || '—'}</td>
              <td>{r.designation || '—'}</td>
              <td>{fmtDate(r.date_of_joining)}</td>
              <td>
                <span className="ob-progress">
                  <span className="lv-bar">
                    <span style={{ width: `${r.progress}%`, background: r.progress >= 100 ? '#22c55e' : r.progress >= 50 ? '#3b82f6' : '#f59e0b' }} />
                  </span>
                  <b>{r.progress}%</b>
                </span>
              </td>
              <td>
                <span className={`emp-pill ${STATUS_TONE[r.status]}`}>{r.status}</span>
              </td>
              <td>
                <div className="emp-actions">
                  <button type="button" title="View" onClick={() => onView(r.id)}>
                    <HrmsIcon name="eye" size={17} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={10} className="emp-empty">
                {loading ? 'Loading joiners…' : allCount ? 'No rows on this page.' : 'No new joiners in this range.'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function TaskBoard({
  items,
  loading,
  busy,
  onClose,
  onView,
  filters,
}: {
  items: Array<{ row: PeopleOnboardingRow; task: PeopleOnboardingTask }>;
  loading: boolean;
  busy: boolean;
  onClose: (todo: string) => void;
  onView: (id: string) => void;
  filters: ReactNode;
}) {
  return (
    <div className="ob-tab-pad">
      {filters}
      <div className="emp-table-wrap" style={{ marginTop: 12 }}>
        <table className="emp-table lv-table ob-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Task</th>
              <th>Stage</th>
              <th>Due</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ row, task }) => (
              <tr key={task.name}>
                <td>
                  <button type="button" className="att-link" onClick={() => onView(row.id)}>
                    {row.name}
                  </button>
                  <div className="hire-small">{row.id}</div>
                </td>
                <td>{task.label}</td>
                <td>{task.stage}</td>
                <td>{fmtDate(task.due)}</td>
                <td>
                  <span className={`emp-pill ${task.status === 'Closed' ? 'green' : 'amber'}`}>{task.status === 'Closed' ? 'Done' : 'Open'}</span>
                </td>
                <td>
                  {task.status === 'Closed' ? (
                    '—'
                  ) : (
                    <button type="button" className="emp-btn" disabled={busy} onClick={() => onClose(task.name)}>
                      Complete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={6} className="emp-empty">
                  {loading ? 'Loading tasks…' : 'No tasks in this view. Start onboarding for a new hire.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
