import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type PeopleTrainingAssignStatus,
  type PeopleTrainingAssignment,
  type PeopleTrainingBoard,
  type PeopleTrainingMaterial,
  type PeopleTrainingMatStatus,
  type PeopleTrainingPlan,
  type PeopleTrainingType,
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
import './people-training.css';

type Tab = 'overview' | 'materials' | 'plans' | 'assignments' | 'approvals' | 'reports';
type Catalog = 'materials' | 'plans' | 'assignments' | 'progress';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'materials', label: 'Training Materials' },
  { id: 'plans', label: 'Learning Plans' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'approvals', label: 'My Approvals' },
  { id: 'reports', label: 'Reports' },
];

const CATALOG: Array<{ id: Catalog; label: string }> = [
  { id: 'materials', label: 'Training Materials' },
  { id: 'plans', label: 'Learning Plans' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'progress', label: 'Employee Progress' },
];

const TYPES: PeopleTrainingType[] = ['Video', 'PDF', 'Youtube', 'Document'];
const TYPE_TONE: Record<string, string> = { Video: 'rose', PDF: 'red', Youtube: 'orange', Document: 'violet' };
const MAT_TONE: Record<string, string> = { Published: 'green', Draft: 'amber', Archived: 'grey' };
const ASN_TONE: Record<string, string> = { Completed: 'green', 'In Progress': 'blue', Pending: 'amber' };
const BAR = ['#2563eb', '#a855f7', '#22c55e', '#06b6d4', '#f43f5e', '#7c3aed', '#f59e0b'];
const EMPTY_MAT: Partial<PeopleTrainingMaterial> & { title: string } = {
  title: '',
  material_type: 'Video',
  category: 'General',
  applicable: 'All Employees',
  status: 'Published',
};

function isoDate(d: Date) {
  return d.toLocaleDateString('en-CA');
}
function monthBounds(d = new Date()) {
  return { from: isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), to: isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
}
function errMsg(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}
function pctDelta(now: number, prev: number) {
  if (!prev && !now) return null;
  if (!prev) return 100;
  return Math.round(((now - prev) / prev) * 100);
}
function inRange(iso: string | null | undefined, from: string, to: string) {
  if (!iso) return true;
  const d = iso.slice(0, 10);
  return d >= from && d <= to;
}
function dur(n?: number | null) {
  return n ? `${n} min` : '—';
}
function youtubeId(url?: string | null) {
  if (!url) return '';
  const m = url.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
  return m?.[1] || '';
}

export function PeopleTrainingPage() {
  const [isManager, setIsManager] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await api.getPeopleHrmsDashboard();
        if (alive) setIsManager(Boolean(res.data.is_manager));
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Unable to load training');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="lv-muted">Loading training…</p>;
  if (!isManager) {
    return (
      <section className="people-panel">
        <header>
          <div>
            <h2>Training &amp; Development</h2>
            <p>Your assigned courses and events are in the staff training module.</p>
          </div>
        </header>
        <Link to="/dashboard/performance">Open my training</Link>
      </section>
    );
  }
  return <TrainingManager />;
}

function TrainingManager() {
  const initial = monthBounds();
  const [board, setBoard] = useState<PeopleTrainingBoard | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [catalog, setCatalog] = useState<Catalog>('materials');
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [dept, setDept] = useState('');
  const [pos, setPos] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [catTitle, setCatTitle] = useState('');
  const [matForm, setMatForm] = useState<(Partial<PeopleTrainingMaterial> & { title: string }) | null>(null);
  const [planForm, setPlanForm] = useState<Partial<PeopleTrainingPlan> & { title: string } | null>(null);
  const [assignOpen, setAssignOpen] = useState<'all' | 'department' | 'designation' | 'employees' | null>(null);
  const [assignPlanId, setAssignPlanId] = useState('');
  const [viewMat, setViewMat] = useState<PeopleTrainingMaterial | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getPeopleTraining();
      setBoard(res.data);
    } catch (e) {
      setError(errMsg(e, 'Unable to load training'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [fromDate, toDate, dept, pos, type, status, query, catalog, tab, perPage]);

  const k = board?.kpis;
  const learnerDelta = k ? pctDelta(k.learners, k.prev_learners) : null;
  const learnerBase = k?.learners || 1;
  const kpis: Array<{
    label: string;
    value: number;
    sub: string;
    up?: boolean;
    down?: boolean;
    icon: 'book' | 'users' | 'play' | 'checkCircle' | 'clock';
    tone: string;
  }> = [
    { label: 'Total Trainings', value: k?.trainings ?? 0, sub: `+ ${k?.new_this_month ?? 0} this month`, up: (k?.new_this_month || 0) > 0, icon: 'book', tone: 'blue' },
    { label: 'Total Learners', value: k?.learners ?? 0, sub: learnerDelta == null ? 'vs last month' : `${Math.abs(learnerDelta)}% vs last month`, up: (learnerDelta || 0) > 0, down: (learnerDelta || 0) < 0, icon: 'users', tone: 'amber' },
    { label: 'In Progress', value: k?.in_progress ?? 0, sub: `${Math.round(((k?.in_progress || 0) / learnerBase) * 100)}% of learners`, icon: 'play', tone: 'cyan' },
    { label: 'Completed', value: k?.completed ?? 0, sub: `${Math.round(((k?.completed || 0) / learnerBase) * 100)}% of learners`, icon: 'checkCircle', tone: 'green' },
    { label: 'Pending', value: k?.pending ?? 0, sub: `${Math.round(((k?.pending || 0) / learnerBase) * 100)}% of learners`, icon: 'clock', tone: 'orange' },
  ];

  const materials = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.materials || []).filter((m) => {
      if (type && m.material_type !== type) return false;
      if (status && m.status !== status) return false;
      if (dept && (m.department || '') !== dept && m.applicable !== 'All Employees') return false;
      if (pos && (m.designation || '') !== pos && m.applicable !== 'All Employees') return false;
      if (!inRange(m.modified, fromDate, toDate)) return false;
      if (q && !`${m.title} ${m.category} ${m.applicable_label}`.toLowerCase().includes(q)) return false;
      return m.status !== 'Archived' || status === 'Archived';
    });
  }, [board, query, type, status, dept, pos, fromDate, toDate]);

  const plans = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.plans || []).filter((p) => !q || p.title.toLowerCase().includes(q));
  }, [board, query]);

  const assignments = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.assignments || []).filter((a) => {
      if (dept && (a.department || '') !== dept) return false;
      if (pos && (a.designation || '') !== pos) return false;
      if (status && a.status !== status) return false;
      if (!inRange(a.assigned_on, fromDate, toDate)) return false;
      if (q && !`${a.employee_name} ${a.material_title} ${a.employee}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, query, dept, pos, status, fromDate, toDate]);

  const activeCatalog: Catalog = tab === 'overview' ? catalog : tab === 'materials' ? 'materials' : tab === 'plans' ? 'plans' : tab === 'assignments' ? 'assignments' : catalog;
  const catalogRows =
    activeCatalog === 'plans' ? plans : activeCatalog === 'assignments' || activeCatalog === 'progress' ? assignments : materials;
  const pages = Math.max(1, Math.ceil(catalogRows.length / perPage));
  const slice = catalogRows.slice((page - 1) * perPage, page * perPage);
  const dirty = dept || pos || type || status || query || fromDate !== initial.from || toDate !== initial.to;
  const drafts = (board?.materials || []).filter((m) => m.status === 'Draft');

  function goTab(next: Tab) {
    setTab(next);
    if (next === 'materials') setCatalog('materials');
    if (next === 'plans') setCatalog('plans');
    if (next === 'assignments') setCatalog('assignments');
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (e) {
      setError(errMsg(e, 'Action failed'));
    } finally {
      setBusy(false);
    }
  }

  const filtersBar = (
    <div className="att-filters tr-filters">
      <label className="emp-search att-search">
        <HrmsIcon name="search" size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search training title, keyword..." />
      </label>
      <FilterDropdown value={dept} allLabel="All Departments" options={board?.departments || []} onChange={setDept} label="Department" />
      <FilterDropdown value={pos} allLabel="All Positions" options={board?.designations || []} onChange={setPos} label="Position" />
      <FilterDropdown value={type} allLabel="All Types" options={TYPES} onChange={setType} label="Type" />
      <FilterDropdown
        value={status}
        allLabel="All Status"
        options={activeCatalog === 'materials' || activeCatalog === 'plans' ? ['Published', 'Draft', 'Active', 'Archived'] : ['Pending', 'In Progress', 'Completed']}
        onChange={setStatus}
        label="Status"
      />
      <label className="att-date">
        From Date
        <div>
          <HrmsIcon name="calendar" size={16} />
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
      </label>
      <span className="att-to">→</span>
      <label className="att-date">
        To Date
        <div>
          <HrmsIcon name="calendar" size={16} />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </label>
      <button
        type="button"
        className="emp-btn"
        disabled={!dirty}
        onClick={() => {
          const m = monthBounds();
          setFromDate(m.from);
          setToDate(m.to);
          setDept('');
          setPos('');
          setType('');
          setStatus('');
          setQuery('');
        }}
      >
        <HrmsIcon name="reset" size={16} /> Reset
      </button>
    </div>
  );

  return (
    <div className="hrms-list-page emp-page dep-page lv-page tr-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="training" size={28} />
          </span>
          <div>
            <h1>Training &amp; Development</h1>
            <p>Create and manage training materials, assign to employees or positions, and track learning progress</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <button className="emp-btn lg" type="button" onClick={() => setCatOpen(true)}>
            <HrmsIcon name="settings" size={17} />
            Training Categories
          </button>
          <div className="emp-filter-wrap">
            <button className="emp-btn primary lg emp-popover-trigger" type="button" onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen}>
              <HrmsIcon name="plus" size={17} />
              Upload Training Material
              <HrmsIcon name="chevronDown" size={15} />
            </button>
            {exportOpen ? (
              <div className="emp-popover emp-menu att-export-menu">
                <button
                  type="button"
                  onClick={() => {
                    setMatForm({ ...EMPTY_MAT });
                    setExportOpen(false);
                  }}
                >
                  <HrmsIcon name="file" size={15} /> Upload training material
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlanForm({ title: '', status: 'Active', material_ids: [] });
                    setExportOpen(false);
                  }}
                >
                  <HrmsIcon name="clipboard" size={15} /> Create learning plan
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}
      {notice ? (
        <div className="dsg-selbar">
          <span className="emp-notice">{notice}</span>
        </div>
      ) : null}

      <section className="emp-card att-main tr-main">
        <div className="att-tabs-row">
          <nav className="att-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => goTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {tab === 'overview' || tab === 'reports' ? (
          <>
            <div className="att-kpis tr-kpis">
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
            <div className="tr-cards">
              <div className="tr-card">
                <header>
                  <b>Training Completion Overview</b>
                  <span className="tr-legend">
                    <i className="done" /> Completed <i className="prog" /> In Progress <i className="pend" /> Pending
                  </span>
                </header>
                <CompletionChart months={board?.monthly || []} />
              </div>
              <div className="tr-card">
                <header>
                  <b>Training by Department</b>
                </header>
                <ul className="tr-dept-bars">
                  {(board?.dept_bars || []).slice(0, 8).map((d, i) => (
                    <li key={d.name}>
                      <button type="button" onClick={() => setDept(d.name === 'Unassigned' ? '' : d.name)}>
                        {d.name}
                      </button>
                      <span className="lv-bar">
                        <span style={{ width: `${d.pct}%`, background: BAR[i % BAR.length] }} />
                      </span>
                      <b>{d.pct}%</b>
                    </li>
                  ))}
                  {!board?.dept_bars.length ? <li className="lv-muted">No assignments yet.</li> : null}
                </ul>
              </div>
              <div className="tr-card tr-quick">
                <header>
                  <b>
                    <HrmsIcon name="zap" size={16} /> Quick Actions
                  </b>
                </header>
                <div className="ob-quick-list">
                  <button type="button" className="ob-quick-btn blue" onClick={() => setMatForm({ ...EMPTY_MAT })}>
                    <HrmsIcon name="file" size={16} /> Upload Training Material
                  </button>
                  <button type="button" className="ob-quick-btn teal" onClick={() => setPlanForm({ title: '', status: 'Active', material_ids: [] })}>
                    <HrmsIcon name="plus" size={16} /> Create Learning Plan
                  </button>
                  <button
                    type="button"
                    className="ob-quick-btn green"
                    onClick={() => {
                      setAssignPlanId('');
                      setAssignOpen('department');
                    }}
                  >
                    <HrmsIcon name="building" size={16} /> Assign to Department
                  </button>
                  <button
                    type="button"
                    className="ob-quick-btn violet"
                    onClick={() => {
                      setAssignPlanId('');
                      setAssignOpen('designation');
                    }}
                  >
                    <HrmsIcon name="badge" size={16} /> Assign to Position
                  </button>
                  <button
                    type="button"
                    className="ob-quick-btn teal"
                    onClick={() => {
                      setAssignPlanId('');
                      setAssignOpen('employees');
                    }}
                  >
                    <HrmsIcon name="userPlus" size={16} /> Assign to Employee
                  </button>
                  <button type="button" className="ob-quick-btn violet" onClick={() => goTab('reports')}>
                    <HrmsIcon name="barChart" size={16} /> View Reports
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {tab === 'approvals' ? (
          <div className="tr-tab-pad">
            <p className="lv-side-sub">Draft materials waiting to be published.</p>
            <div className="emp-table-wrap">
              <table className="emp-table lv-table tr-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <b>{m.title}</b>
                      </td>
                      <td>
                        <span className={`emp-pill ${TYPE_TONE[m.material_type] || 'grey'}`}>{m.material_type}</span>
                      </td>
                      <td>{m.category}</td>
                      <td>
                        <span className="emp-pill amber">Draft</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="emp-btn primary"
                          disabled={busy}
                          onClick={() => void run(() => api.savePeopleTrainingMaterial({ ...m, status: 'Published' }), 'Material published')}
                        >
                          Publish
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!drafts.length ? (
                    <tr>
                      <td colSpan={5} className="emp-empty">
                        {loading ? 'Loading…' : 'No drafts waiting for approval.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab !== 'approvals' ? (
          <>
            {tab === 'overview' ? (
              <nav className="tr-subtabs" role="tablist">
                {CATALOG.map((c) => (
                  <button key={c.id} type="button" className={catalog === c.id ? 'on' : ''} onClick={() => setCatalog(c.id)}>
                    {c.label}
                  </button>
                ))}
              </nav>
            ) : null}
            {tab === 'reports' ? (
              <div className="tr-tab-pad">
                <button
                  type="button"
                  className="emp-btn"
                  onClick={() =>
                    downloadCsv(
                      'training-materials.csv',
                      ['Title', 'Type', 'Category', 'Applicable', 'Department', 'Duration', 'Status', 'Assigned'],
                      materials.map((m) => [m.title, m.material_type, m.category, m.applicable_label, m.department, m.duration_min, m.status, m.assigned]),
                    )
                  }
                >
                  <HrmsIcon name="download" size={16} /> Export materials CSV
                </button>
              </div>
            ) : (
              filtersBar
            )}
            {activeCatalog === 'materials' ? (
              <MaterialTable
                rows={slice as PeopleTrainingMaterial[]}
                start={(page - 1) * perPage}
                loading={loading}
                onView={setViewMat}
                onEdit={setMatForm}
              />
            ) : null}
            {activeCatalog === 'plans' ? (
              <PlanTable
                rows={slice as PeopleTrainingPlan[]}
                materials={board?.materials || []}
                loading={loading}
                onEdit={(p) => setPlanForm({ ...p, title: p.title })}
                onAssign={(id) => {
                  setAssignPlanId(id);
                  setAssignOpen('all');
                }}
              />
            ) : null}
            {activeCatalog === 'assignments' || activeCatalog === 'progress' ? (
              <AssignmentTable
                rows={slice as PeopleTrainingAssignment[]}
                loading={loading}
                busy={busy}
                progress={activeCatalog === 'progress'}
                onStatus={(id, s) => void run(() => api.updatePeopleTrainingAssignment(id, s), 'Progress updated')}
              />
            ) : null}
            <Pager
              page={page}
              pages={pages}
              perPage={perPage}
              onPage={setPage}
              onPerPage={setPerPage}
              summary={`Showing ${catalogRows.length ? (page - 1) * perPage + 1 : 0} to ${Math.min(page * perPage, catalogRows.length)} of ${catalogRows.length} ${activeCatalog === 'materials' ? 'trainings' : 'rows'}`}
            />
          </>
        ) : null}
      </section>

      {viewMat ? (
        <div className="emp-drawer-backdrop" onMouseDown={() => setViewMat(null)}>
          <aside className="emp-drawer lv-drawer" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div>
                <b>{viewMat.title}</b>
                <small>
                  {viewMat.material_type} · {viewMat.category}
                </small>
              </div>
              <button type="button" className="emp-btn" onClick={() => setViewMat(null)} aria-label="Close">
                <HrmsIcon name="x" size={16} />
              </button>
            </header>
            <p>{viewMat.description || 'No description.'}</p>
            <p className="lv-side-sub">
              {viewMat.applicable_label} · {dur(viewMat.duration_min)} · {viewMat.assigned} assigned
            </p>
            {viewMat.url ? (
              <a className="emp-btn" href={viewMat.url} target="_blank" rel="noreferrer">
                Open link
              </a>
            ) : null}
          </aside>
        </div>
      ) : null}

      {matForm ? (
        <MaterialModal
          form={matForm}
          categories={board?.categories || []}
          departments={board?.departments || []}
          designations={board?.designations || []}
          busy={busy}
          onClose={() => setMatForm(null)}
          onSave={(data) =>
            void run(async () => {
              await api.savePeopleTrainingMaterial(data);
              setMatForm(null);
            }, 'Training material saved')
          }
        />
      ) : null}

      {planForm ? (
        <PlanModal
          form={planForm}
          materials={board?.materials || []}
          busy={busy}
          onClose={() => setPlanForm(null)}
          onSave={(data) =>
            void run(async () => {
              await api.savePeopleTrainingPlan(data);
              setPlanForm(null);
            }, 'Learning plan saved')
          }
        />
      ) : null}

      {assignOpen ? (
        <AssignModal
          scope={assignOpen}
          board={board}
          busy={busy}
          presetPlan={assignPlanId}
          onClose={() => {
            setAssignOpen(null);
            setAssignPlanId('');
          }}
          onSave={(opts) =>
            void run(async () => {
              const res = await api.assignPeopleTraining(opts);
              setAssignOpen(null);
              setAssignPlanId('');
              setNotice(`${res.data.created} assigned, ${res.data.skipped} already assigned`);
            }, 'Training assigned')
          }
        />
      ) : null}

      {catOpen ? (
        <div className="lv-modal-backdrop" onMouseDown={() => setCatOpen(false)}>
          <div className="lv-modal" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <h2>Training Categories</h2>
              <button type="button" className="emp-btn" onClick={() => setCatOpen(false)} aria-label="Close">
                <HrmsIcon name="x" size={16} />
              </button>
            </header>
            <ul className="tr-cat-list">
              {(board?.categories || []).map((c) => (
                <li key={c}>{c}</li>
              ))}
              {!board?.categories.length ? <li className="lv-muted">No categories yet.</li> : null}
            </ul>
            <label className="att-date" style={{ width: '100%' }}>
              New category
              <div>
                <input value={catTitle} onChange={(e) => setCatTitle(e.target.value)} placeholder="e.g. Compliance" />
              </div>
            </label>
            <footer>
              <button type="button" className="emp-btn" onClick={() => setCatOpen(false)}>
                Close
              </button>
              <button
                type="button"
                className="emp-btn primary"
                disabled={!catTitle.trim() || busy}
                onClick={() =>
                  void run(async () => {
                    await api.savePeopleTrainingCategory(catTitle.trim());
                    setCatTitle('');
                  }, 'Category saved')
                }
              >
                Add
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CompletionChart({ months }: { months: PeopleTrainingBoard['monthly'] }) {
  const w = 420;
  const h = 160;
  const pad = { l: 28, r: 8, t: 12, b: 24 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(1, ...months.flatMap((m) => [m.completed, m.in_progress, m.pending]));
  const x = (i: number) => pad.l + (months.length < 2 ? innerW / 2 : (i / (months.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const path = (key: 'completed' | 'in_progress' | 'pending') =>
    months.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(m[key]).toFixed(1)}`).join(' ');
  const area = (key: 'completed' | 'in_progress' | 'pending') => {
    if (!months.length) return '';
    return `${path(key)} L${x(months.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  };
  return (
    <svg className="tr-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Training completion by month">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={w - pad.r} y1={y(max * t)} y2={y(max * t)} stroke="#eef2f6" />
          <text x={pad.l - 6} y={y(max * t) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">
            {Math.round(max * t)}
          </text>
        </g>
      ))}
      <path d={area('completed')} fill="#86efac" opacity="0.35" />
      <path d={path('completed')} fill="none" stroke="#22c55e" strokeWidth="2" />
      <path d={path('in_progress')} fill="none" stroke="#3b82f6" strokeWidth="2" />
      <path d={path('pending')} fill="none" stroke="#f59e0b" strokeWidth="2" />
      {months.map((m, i) => (
        <text key={m.key} x={x(i)} y={h - 6} textAnchor="middle" fontSize="9" fill="#64748b">
          {m.label}
        </text>
      ))}
    </svg>
  );
}

function MaterialTable({
  rows,
  start,
  loading,
  onView,
  onEdit,
}: {
  rows: PeopleTrainingMaterial[];
  start: number;
  loading: boolean;
  onView: (m: PeopleTrainingMaterial) => void;
  onEdit: (m: Partial<PeopleTrainingMaterial> & { title: string }) => void;
}) {
  return (
    <div className="emp-table-wrap">
      <table className="emp-table lv-table tr-table">
        <thead>
          <tr>
            <th className="emp-col-check">
              <input type="checkbox" disabled aria-label="Select all" />
            </th>
            <th>#</th>
            <th>Title</th>
            <th>Type</th>
            <th>Category</th>
            <th>Applicable To</th>
            <th>Department</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Assigned</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => {
            const yt = youtubeId(m.url);
            return (
              <tr key={m.id}>
                <td className="emp-col-check">
                  <input type="checkbox" disabled aria-label={`Select ${m.title}`} />
                </td>
                <td>{start + i + 1}</td>
                <td>
                  <div className="tr-title">
                    {yt ? (
                      <span className="tr-yt">
                        <img src={`https://img.youtube.com/vi/${yt}/mqdefault.jpg`} alt="" />
                      </span>
                    ) : (
                      <span className={`tr-thumb ${TYPE_TONE[m.material_type] || 'grey'}`}>{m.material_type[0]}</span>
                    )}
                    <b>{m.title}</b>
                  </div>
                </td>
                <td>
                  <span className={`emp-pill ${TYPE_TONE[m.material_type] || 'grey'}`}>{m.material_type}</span>
                </td>
                <td>{m.category}</td>
                <td>{m.applicable_label}</td>
                <td>{m.department || (m.applicable === 'All Employees' ? 'All Departments' : '—')}</td>
                <td>{dur(m.duration_min)}</td>
                <td>
                  <span className={`emp-pill ${MAT_TONE[m.status] || 'grey'}`}>{m.status}</span>
                </td>
                <td>{m.assigned}</td>
                <td>
                  <div className="emp-actions">
                    <button type="button" title="View" onClick={() => onView(m)}>
                      <HrmsIcon name="eye" size={17} />
                    </button>
                    <button type="button" title="Edit" onClick={() => onEdit({ ...m, title: m.title })}>
                      <HrmsIcon name="pencil" size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {!rows.length ? (
            <tr>
              <td colSpan={11} className="emp-empty">
                {loading ? 'Loading trainings…' : 'No training materials yet. Upload a material to get started.'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function PlanTable({
  rows,
  materials,
  loading,
  onEdit,
  onAssign,
}: {
  rows: PeopleTrainingPlan[];
  materials: PeopleTrainingMaterial[];
  loading: boolean;
  onEdit: (p: PeopleTrainingPlan) => void;
  onAssign: (id: string) => void;
}) {
  const titles = Object.fromEntries(materials.map((m) => [m.id, m.title]));
  return (
    <div className="emp-table-wrap">
      <table className="emp-table lv-table tr-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Materials</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <b>{p.title}</b>
                {p.description ? <div className="hire-small">{p.description}</div> : null}
              </td>
              <td>{p.material_ids.map((id) => titles[id] || id).join(', ') || '—'}</td>
              <td>
                <span className={`emp-pill ${p.status === 'Active' ? 'green' : 'amber'}`}>{p.status}</span>
              </td>
              <td>
                <div className="emp-actions">
                  <button type="button" title="Edit" onClick={() => onEdit(p)}>
                    <HrmsIcon name="pencil" size={16} />
                  </button>
                  <button type="button" title="Assign" onClick={() => onAssign(p.id)}>
                    <HrmsIcon name="userPlus" size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={4} className="emp-empty">
                {loading ? 'Loading plans…' : 'No learning plans yet.'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function AssignmentTable({
  rows,
  loading,
  busy,
  progress,
  onStatus,
}: {
  rows: PeopleTrainingAssignment[];
  loading: boolean;
  busy: boolean;
  progress: boolean;
  onStatus: (id: string, status: PeopleTrainingAssignStatus) => void;
}) {
  return (
    <div className="emp-table-wrap">
      <table className="emp-table lv-table tr-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Training</th>
            <th>Department</th>
            <th>Assigned</th>
            <th>Status</th>
            {progress ? <th>Update</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>
                <div className="emp-person lv-person">
                  <Avatar id={a.employee} name={a.employee_name} />
                  <div>
                    <b>{a.employee_name}</b>
                    <small>{a.employee}</small>
                  </div>
                </div>
              </td>
              <td>{a.material_title}</td>
              <td>{a.department || '—'}</td>
              <td>{a.assigned_on || '—'}</td>
              <td>
                <span className={`emp-pill ${ASN_TONE[a.status] || 'grey'}`}>{a.status}</span>
              </td>
              {progress ? (
                <td>
                  <select value={a.status} disabled={busy} onChange={(e) => onStatus(a.id, e.target.value as PeopleTrainingAssignStatus)} aria-label={`Status for ${a.employee_name}`}>
                    <option>Pending</option>
                    <option>In Progress</option>
                    <option>Completed</option>
                  </select>
                </td>
              ) : null}
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={progress ? 6 : 5} className="emp-empty">
                {loading ? 'Loading assignments…' : 'No assignments yet.'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function MaterialModal({
  form,
  categories,
  departments,
  designations,
  busy,
  onClose,
  onSave,
}: {
  form: Partial<PeopleTrainingMaterial> & { title: string };
  categories: string[];
  departments: string[];
  designations: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (data: Partial<PeopleTrainingMaterial> & { title: string }) => void;
}) {
  const [f, setF] = useState(form);
  const set = <K extends keyof PeopleTrainingMaterial>(k: K, v: PeopleTrainingMaterial[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <form
        className="lv-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(f);
        }}
      >
        <header>
          <h2>{form.id ? 'Edit training material' : 'Upload training material'}</h2>
          <button type="button" className="emp-btn" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <div className="tr-form-grid">
          <label className="span-2">
            Title *
            <input required value={f.title} onChange={(e) => set('title', e.target.value)} />
          </label>
          <label>
            Type
            <select value={f.material_type} onChange={(e) => set('material_type', e.target.value as PeopleTrainingType)}>
              {TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Category
            <input list="tr-cats" value={f.category || ''} onChange={(e) => set('category', e.target.value)} />
            <datalist id="tr-cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label>
            Applicable to
            <select value={f.applicable} onChange={(e) => set('applicable', e.target.value)}>
              <option>All Employees</option>
              <option>Department</option>
              <option>Designation</option>
              <option>Employee</option>
            </select>
          </label>
          <label>
            Department
            <select value={f.department || ''} onChange={(e) => set('department', e.target.value)}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Position
            <select value={f.designation || ''} onChange={(e) => set('designation', e.target.value)}>
              <option value="">—</option>
              {designations.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Duration (min)
            <input type="number" min={0} value={f.duration_min ?? ''} onChange={(e) => set('duration_min', e.target.value === '' ? null : Number(e.target.value))} />
          </label>
          <label>
            Status
            <select value={f.status} onChange={(e) => set('status', e.target.value as PeopleTrainingMatStatus)}>
              <option>Published</option>
              <option>Draft</option>
              <option>Archived</option>
            </select>
          </label>
          <label className="span-2">
            Link / URL
            <input value={f.url || ''} onChange={(e) => set('url', e.target.value)} placeholder="https://…" />
          </label>
          <label className="span-2">
            Description
            <textarea value={f.description || ''} onChange={(e) => set('description', e.target.value)} rows={3} />
          </label>
        </div>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy || !f.title.trim()}>
            Save
          </button>
        </footer>
      </form>
    </div>
  );
}

function PlanModal({
  form,
  materials,
  busy,
  onClose,
  onSave,
}: {
  form: Partial<PeopleTrainingPlan> & { title: string };
  materials: PeopleTrainingMaterial[];
  busy: boolean;
  onClose: () => void;
  onSave: (data: Partial<PeopleTrainingPlan> & { title: string }) => void;
}) {
  const [f, setF] = useState(form);
  const ids = f.material_ids || [];
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <form
        className="lv-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(f);
        }}
      >
        <header>
          <h2>{form.id ? 'Edit learning plan' : 'Create learning plan'}</h2>
          <button type="button" className="emp-btn" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <label>
          Title *
          <input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </label>
        <label>
          Description
          <textarea value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} />
        </label>
        <p className="lv-side-sub">Include materials</p>
        <ul className="tr-check-list">
          {materials
            .filter((m) => m.status === 'Published')
            .map((m) => (
              <li key={m.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={ids.includes(m.id)}
                    onChange={() => setF({ ...f, material_ids: ids.includes(m.id) ? ids.filter((x) => x !== m.id) : [...ids, m.id] })}
                  />
                  {m.title}
                </label>
              </li>
            ))}
        </ul>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy || !f.title.trim()}>
            Save
          </button>
        </footer>
      </form>
    </div>
  );
}

function AssignModal({
  scope,
  board,
  busy,
  presetPlan,
  onClose,
  onSave,
}: {
  scope: 'all' | 'department' | 'designation' | 'employees';
  board: PeopleTrainingBoard | null;
  busy: boolean;
  presetPlan: string;
  onClose: () => void;
  onSave: (opts: { material?: string; plan?: string; scope: 'all' | 'department' | 'designation' | 'employees'; department?: string; designation?: string; employees?: string[] }) => void;
}) {
  const [material, setMaterial] = useState('');
  const [plan, setPlan] = useState(presetPlan);
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [employee, setEmployee] = useState('');
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <form
        className="lv-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            material: material || undefined,
            plan: plan || undefined,
            scope,
            department,
            designation,
            employees: employee ? [employee] : [],
          });
        }}
      >
        <header>
          <h2>Assign training</h2>
          <button type="button" className="emp-btn" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <label>
          Material
          <select value={material} onChange={(e) => setMaterial(e.target.value)}>
            <option value="">—</option>
            {(board?.materials || [])
              .filter((m) => m.status === 'Published')
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          Or learning plan
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">—</option>
            {(board?.plans || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        {scope === 'department' ? (
          <label>
            Department *
            <select required value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">Select…</option>
              {(board?.departments || []).map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
        ) : null}
        {scope === 'designation' ? (
          <label>
            Position *
            <select required value={designation} onChange={(e) => setDesignation(e.target.value)}>
              <option value="">Select…</option>
              {(board?.designations || []).map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
        ) : null}
        {scope === 'employees' ? (
          <label>
            Employee *
            <select required value={employee} onChange={(e) => setEmployee(e.target.value)}>
              <option value="">Select…</option>
              {(board?.employees || []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.id})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {scope === 'all' ? <p className="lv-side-sub">This will assign the selected training to every active employee.</p> : null}
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy || (!material && !plan)}>
            Assign
          </button>
        </footer>
      </form>
    </div>
  );
}
