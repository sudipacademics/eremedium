import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type HireJob,
  type HirePortal,
  type PeopleCareerBoard,
  type PeopleCareerJob,
  type PeopleCareerPlan,
  type PeopleManpowerPriority,
  type PeopleManpowerRequest,
  type PeopleManpowerStatus,
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
import './people-career.css';

type Tab = 'overview' | 'plans' | 'requests' | 'jobs' | 'careers' | 'portals' | 'reports';
type Catalog = 'requests' | 'jobs' | 'plans';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'plans', label: 'Staff Planning' },
  { id: 'requests', label: 'Manpower Requests' },
  { id: 'jobs', label: 'Job Postings' },
  { id: 'careers', label: 'Public Career Page' },
  { id: 'portals', label: 'Job Portals' },
  { id: 'reports', label: 'Reports' },
];

const CATALOG: Array<{ id: Catalog; label: string }> = [
  { id: 'requests', label: 'Recent Manpower Requests' },
  { id: 'jobs', label: 'Job Postings' },
  { id: 'plans', label: 'Active Plans' },
];

const PRI_TONE: Record<string, string> = { High: 'rose', Medium: 'amber', Low: 'green' };
const REQ_TONE: Record<string, string> = { Approved: 'green', 'Pending HR Review': 'orange', Rejected: 'rose' };
const PLAN_TONE: Record<string, string> = { Published: 'green', Approved: 'green', Draft: 'grey', Researched: 'blue', Cancelled: 'rose' };
const HERO = 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=900&q=80';

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}
function pctDelta(now: number, prev: number) {
  if (!prev && !now) return null;
  if (!prev) return 100;
  return Math.round(((now - prev) / prev) * 100);
}
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function jobLabel(j: PeopleCareerJob) {
  if (j.status === 'Draft') return 'Draft';
  if (j.status === 'Paused') return 'On Hold';
  if (j.status === 'Closed') return 'Closed';
  return j.is_public ? 'Published' : 'Internal';
}
function jobTone(label: string) {
  if (label === 'Published') return 'green';
  if (label === 'Draft') return 'amber';
  if (label === 'On Hold') return 'orange';
  return 'grey';
}

export function PeopleCareerPage() {
  const [isManager, setIsManager] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await api.getPeopleHrmsDashboard();
        if (alive) setIsManager(Boolean(res.data.is_manager));
      } catch (err) {
        if (alive) setError(err instanceof Error && err.message ? err.message : 'Unable to load career');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="lv-muted">Loading career &amp; growth…</p>;
  if (!isManager) {
    return (
      <section className="people-panel">
        <header>
          <div>
            <h2>Career &amp; Growth</h2>
            <p>Open roles and applications are on the public careers site.</p>
          </div>
        </header>
        <Link to="/careers">View open jobs</Link>
      </section>
    );
  }
  return <CareerManager />;
}

function CareerManager() {
  const [board, setBoard] = useState<PeopleCareerBoard | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [catalog, setCatalog] = useState<Catalog>('requests');
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reqForm, setReqForm] = useState<Partial<PeopleManpowerRequest> & { designation: string } | null>(null);
  const [planForm, setPlanForm] = useState<{ title: string; designation: string; department: string; headcount: number } | null>(null);
  const [jobForm, setJobForm] = useState<Partial<HireJob> | null>(null);
  const [portalJob, setPortalJob] = useState('');
  const [viewReq, setViewReq] = useState<PeopleManpowerRequest | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getPeopleCareer();
      setBoard(res.data);
    } catch (e) {
      setError(errMsg(e, 'Unable to load career & growth'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [query, dept, status, catalog, tab, perPage]);

  const k = board?.kpis;
  const posDelta = k ? pctDelta(k.total_positions, k.prev_positions) : null;
  const hiredDelta = k ? pctDelta(k.hired_careers, k.prev_hired_careers) : null;
  const total = k?.total_positions || 1;
  const kpis: Array<{
    label: string;
    value: number;
    sub: string;
    up?: boolean;
    down?: boolean;
    icon: 'users' | 'checkCircle' | 'clock' | 'briefcase';
    tone: string;
  }> = [
    { label: 'Total Positions', value: k?.total_positions ?? 0, sub: posDelta == null ? 'vs last quarter' : `${Math.abs(posDelta)}% vs last quarter`, up: (posDelta || 0) > 0, down: (posDelta || 0) < 0, icon: 'users', tone: 'blue' },
    { label: 'Approved Positions', value: k?.approved_positions ?? 0, sub: `${Math.round(((k?.approved_positions || 0) / total) * 100)}% of total`, icon: 'checkCircle', tone: 'green' },
    { label: 'Pending Requests', value: k?.pending_requests ?? 0, sub: `${Math.round(((k?.pending_requests || 0) / total) * 100)}% of total`, icon: 'clock', tone: 'orange' },
    { label: 'Open Job Postings', value: k?.open_postings ?? 0, sub: `${Math.round(((k?.open_postings || 0) / total) * 100)}% of total`, icon: 'briefcase', tone: 'violet' },
    { label: 'Hired from Career Page', value: k?.hired_careers ?? 0, sub: hiredDelta == null ? 'vs last quarter' : `${Math.abs(hiredDelta)}% vs last quarter`, up: (hiredDelta || 0) > 0, down: (hiredDelta || 0) < 0, icon: 'users', tone: 'cyan' },
  ];

  const requests = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.requests || []).filter((r) => {
      if (dept && (r.department || '') !== dept) return false;
      if (status && r.status !== status) return false;
      if (q && !`${r.requested_by} ${r.designation} ${r.department}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, query, dept, status]);

  const jobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.jobs || []).filter((j) => {
      if (dept && (j.department || '') !== dept) return false;
      if (status && jobLabel(j) !== status && j.status !== status) return false;
      if (q && !`${j.title} ${j.department}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, query, dept, status]);

  const plans = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.plans || []).filter((p) => {
      if (dept && (p.department || '') !== dept) return false;
      if (status && p.status !== status) return false;
      if (q && !`${p.title} ${p.designation} ${p.department}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, query, dept, status]);

  const activeCatalog: Catalog = tab === 'overview' ? catalog : tab === 'jobs' || tab === 'careers' ? 'jobs' : tab === 'plans' ? 'plans' : 'requests';
  const catalogRows = activeCatalog === 'jobs' ? jobs : activeCatalog === 'plans' ? plans : requests;
  const pages = Math.max(1, Math.ceil(catalogRows.length / perPage));
  const slice = catalogRows.slice((page - 1) * perPage, page * perPage);

  function goTab(next: Tab) {
    setTab(next);
    if (next === 'requests') setCatalog('requests');
    if (next === 'jobs' || next === 'careers') setCatalog('jobs');
    if (next === 'plans') setCatalog('plans');
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
    <div className="att-filters cg-filters">
      <label className="emp-search att-search">
        <HrmsIcon name="search" size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, designation, job…" />
      </label>
      <FilterDropdown value={dept} allLabel="All Departments" options={board?.departments || []} onChange={setDept} label="Department" />
      <FilterDropdown
        value={status}
        allLabel="All Status"
        options={
          activeCatalog === 'requests'
            ? ['Pending HR Review', 'Approved', 'Rejected']
            : activeCatalog === 'plans'
              ? ['Draft', 'Researched', 'Approved', 'Published', 'Cancelled']
              : ['Published', 'Draft', 'Open', 'Paused', 'Closed']
        }
        onChange={setStatus}
        label="Status"
      />
      <button
        type="button"
        className="emp-btn"
        disabled={!dept && !status && !query}
        onClick={() => {
          setDept('');
          setStatus('');
          setQuery('');
        }}
      >
        <HrmsIcon name="reset" size={16} /> Reset
      </button>
    </div>
  );

  return (
    <div className="hrms-list-page emp-page dep-page lv-page cg-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="barChart" size={28} />
          </span>
          <div>
            <h1>Career &amp; Growth</h1>
            <p>Manage workforce planning, manpower requests, job postings and public career opportunities.</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <div className="emp-filter-wrap">
            <button className="emp-btn primary lg emp-popover-trigger" type="button" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
              <HrmsIcon name="plus" size={17} />
              Create Plan / Job Posting
              <HrmsIcon name="chevronDown" size={15} />
            </button>
            {menuOpen ? (
              <div className="emp-popover emp-menu att-export-menu">
                <button
                  type="button"
                  onClick={() => {
                    setPlanForm({ title: '', designation: '', department: '', headcount: 1 });
                    setMenuOpen(false);
                  }}
                >
                  <HrmsIcon name="clipboard" size={15} /> Create staff plan
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReqForm({ designation: '', positions: 1, priority: 'Medium', status: 'Pending HR Review' });
                    setMenuOpen(false);
                  }}
                >
                  <HrmsIcon name="users" size={15} /> New manpower request
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setJobForm({ title: '', status: 'Open', employment_type: 'Full Time', openings: 1, is_public: 1, location: 'Kolkata' });
                    setMenuOpen(false);
                  }}
                >
                  <HrmsIcon name="briefcase" size={15} /> Post job opening
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

      <section className="emp-card att-main">
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
            <div className="att-kpis cg-kpis">
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
            <div className="cg-cards">
              <div className="cg-card">
                <header>
                  <b>Manpower Planning vs Actual</b>
                  <span className="cg-legend">
                    <i className="plan" /> Planned <i className="act" /> Actual
                  </span>
                </header>
                <PlanActualChart rows={board?.dept_bars || []} />
              </div>
              <div className="cg-card">
                <header>
                  <b>Recruitment Funnel</b>
                </header>
                <div className="cg-funnel-wrap">
                  <ol className="cg-funnel">
                    {(board?.funnel || []).map((f, i) => (
                      <li key={f.key} style={{ background: f.color, width: `${Math.max(38, 100 - i * 10)}%` }}>
                        {f.label}
                      </li>
                    ))}
                  </ol>
                  <ul className="cg-funnel-key">
                    {(board?.funnel || []).map((f) => (
                      <li key={`k-${f.key}`}>
                        <i style={{ background: f.color }} /> {f.label} <b>{f.value}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="cg-card">
                <header>
                  <b>
                    <HrmsIcon name="zap" size={16} /> Quick Actions
                  </b>
                </header>
                <div className="ob-quick-list">
                  <button type="button" className="ob-quick-btn teal" onClick={() => setPlanForm({ title: '', designation: '', department: '', headcount: 1 })}>
                    <HrmsIcon name="clipboard" size={16} /> Create Staff Plan
                  </button>
                  <button
                    type="button"
                    className="ob-quick-btn blue"
                    onClick={() => setJobForm({ title: '', status: 'Open', employment_type: 'Full Time', openings: 1, is_public: 1, location: 'Kolkata' })}
                  >
                    <HrmsIcon name="briefcase" size={16} /> Post Job Opening
                  </button>
                  <button type="button" className="ob-quick-btn green" onClick={() => goTab('careers')}>
                    <HrmsIcon name="globe" size={16} /> Publish to Career Page
                  </button>
                  <button type="button" className="ob-quick-btn violet" onClick={() => goTab('portals')}>
                    <HrmsIcon name="send" size={16} /> Send to Job Portals
                  </button>
                  <button type="button" className="ob-quick-btn teal" onClick={() => goTab('requests')}>
                    <HrmsIcon name="users" size={16} /> View Manpower Requests
                  </button>
                  <button type="button" className="ob-quick-btn violet" onClick={() => goTab('reports')}>
                    <HrmsIcon name="barChart" size={16} /> View Reports
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {tab === 'portals' ? (
          <div className="cg-tab-pad">
            <p className="lv-side-sub">Assisted posting: copy the ad in Recruitment, then record the portal job here.</p>
            <ul className="cg-portals">
              {(board?.portals || []).map((p) => (
                <li key={p.portal}>
                  <b>{p.portal}</b>
                  {p.employer_url.startsWith('http') ? (
                    <a href={p.employer_url} target="_blank" rel="noreferrer" className="emp-btn">
                      Open portal
                    </a>
                  ) : (
                    <Link className="emp-btn" to={p.employer_url}>
                      Open careers
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <label>
              Record a portal posting
              <select value={portalJob} onChange={(e) => setPortalJob(e.target.value)}>
                <option value="">Select job…</option>
                {(board?.jobs || [])
                  .filter((j) => j.status === 'Open')
                  .map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}
                    </option>
                  ))}
              </select>
            </label>
            <div className="cg-portal-actions">
              {(['Naukri', 'WorkIndia'] as HirePortal[]).map((portal) => (
                <button
                  key={portal}
                  type="button"
                  className="emp-btn"
                  disabled={!portalJob || busy}
                  onClick={() =>
                    void run(() => api.recordHirePosting({ job: portalJob, portal }), `Recorded on ${portal}`)
                  }
                >
                  Send to {portal}
                </button>
              ))}
            </div>
            <div className="emp-table-wrap">
              <table className="emp-table lv-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Portal</th>
                    <th>Status</th>
                    <th>Posted</th>
                  </tr>
                </thead>
                <tbody>
                  {(board?.postings || []).map((p) => (
                    <tr key={p.id}>
                      <td>{p.job_title}</td>
                      <td>{p.portal}</td>
                      <td>
                        <span className={`emp-pill ${p.status === 'Active' ? 'green' : 'grey'}`}>{p.status}</span>
                      </td>
                      <td>{fmtDate(p.posted_on)}</td>
                    </tr>
                  ))}
                  {!board?.postings.length ? (
                    <tr>
                      <td colSpan={4} className="emp-empty">
                        {loading ? 'Loading…' : 'No portal postings yet.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === 'careers' ? (
          <div className="cg-career-pad">
            <CareerPreview url={board?.careers_url || '/careers'} />
            <p className="lv-side-sub">Jobs marked public appear on the careers site.</p>
          </div>
        ) : null}

        {tab !== 'portals' ? (
          <>
            {tab === 'overview' ? (
              <div className="cg-subhead">
                <nav className="tr-subtabs cg-subtabs" role="tablist">
                  {CATALOG.map((c) => (
                    <button key={c.id} type="button" className={catalog === c.id ? 'on' : ''} onClick={() => setCatalog(c.id)}>
                      {c.label}
                    </button>
                  ))}
                </nav>
                <button type="button" className="emp-btn" onClick={() => goTab(catalog === 'jobs' ? 'jobs' : catalog === 'plans' ? 'plans' : 'requests')}>
                  View All
                </button>
              </div>
            ) : null}
            {tab === 'reports' ? (
              <div className="cg-tab-pad">
                <button
                  type="button"
                  className="emp-btn"
                  onClick={() =>
                    downloadCsv(
                      'manpower-requests.csv',
                      ['Requested By', 'Department', 'Designation', 'Positions', 'Priority', 'Status', 'Date'],
                      requests.map((r) => [r.requested_by, r.department, r.designation, r.positions, r.priority, r.status, r.request_date]),
                    )
                  }
                >
                  <HrmsIcon name="download" size={16} /> Export requests CSV
                </button>
              </div>
            ) : (
              filtersBar
            )}
            {activeCatalog === 'requests' ? (
              <RequestTable
                rows={slice as PeopleManpowerRequest[]}
                start={(page - 1) * perPage}
                loading={loading}
                busy={busy}
                menuFor={menuFor}
                onMenu={setMenuFor}
                onView={setViewReq}
                onEdit={(r) => setReqForm({ ...r, designation: r.designation })}
                onStatus={(id, s) => void run(() => api.updatePeopleManpowerRequest(id, s), 'Request updated')}
              />
            ) : null}
            {activeCatalog === 'jobs' ? (
              <JobTable
                rows={slice as PeopleCareerJob[]}
                start={(page - 1) * perPage}
                loading={loading}
                onEdit={(j) =>
                  setJobForm({
                    name: j.id,
                    title: j.title,
                    status: j.status as HireJob['status'],
                    department: j.department || '',
                    employment_type: j.employment_type,
                    openings: j.openings,
                    is_public: j.is_public,
                    location: j.location || '',
                  })
                }
                onPublish={(j) => void run(() => api.saveHireJob({ name: j.id, title: j.title, is_public: 1, status: 'Open' }), 'Published to careers')}
              />
            ) : null}
            {activeCatalog === 'plans' ? (
              <PlanTable
                rows={slice as PeopleCareerPlan[]}
                loading={loading}
                busy={busy}
                onPublish={(id) => void run(() => api.publishStaffPlanToCareers(id), 'Plan published to careers')}
              />
            ) : null}
            {tab !== 'overview' ? (
              <Pager
                page={page}
                pages={pages}
                perPage={perPage}
                onPage={setPage}
                onPerPage={setPerPage}
                summary={`Showing ${catalogRows.length ? (page - 1) * perPage + 1 : 0} to ${Math.min(page * perPage, catalogRows.length)} of ${catalogRows.length} rows`}
              />
            ) : null}
          </>
        ) : null}

        {tab === 'overview' ? (
          <div className="cg-bottom">
            <div className="cg-card">
              <header>
                <b>Active Job Postings</b>
                <button type="button" className="emp-btn" onClick={() => goTab('jobs')}>
                  View All
                </button>
              </header>
              <JobTable
                rows={(board?.jobs || []).filter((j) => j.status !== 'Closed').slice(0, 5)}
                start={0}
                loading={loading}
                onEdit={(j) =>
                  setJobForm({
                    name: j.id,
                    title: j.title,
                    status: j.status as HireJob['status'],
                    department: j.department || '',
                    employment_type: j.employment_type,
                    openings: j.openings,
                    is_public: j.is_public,
                    location: j.location || '',
                  })
                }
                onPublish={(j) => void run(() => api.saveHireJob({ name: j.id, title: j.title, is_public: 1, status: 'Open' }), 'Published to careers')}
              />
            </div>
            <CareerPreview url={board?.careers_url || '/careers'} />
          </div>
        ) : null}
      </section>

      {viewReq ? (
        <div className="emp-drawer-backdrop" onMouseDown={() => setViewReq(null)}>
          <aside className="emp-drawer lv-drawer" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div>
                <b>{viewReq.designation}</b>
                <small>
                  {viewReq.requested_by} · {viewReq.department || '—'}
                </small>
              </div>
              <button type="button" className="emp-btn" onClick={() => setViewReq(null)} aria-label="Close">
                <HrmsIcon name="x" size={16} />
              </button>
            </header>
            <p>
              {viewReq.positions} position{viewReq.positions === 1 ? '' : 's'} · {viewReq.priority} priority
            </p>
            <p className="lv-side-sub">{viewReq.notes || 'No notes.'}</p>
          </aside>
        </div>
      ) : null}

      {reqForm ? (
        <RequestModal
          form={reqForm}
          departments={board?.departments || []}
          designations={board?.designations || []}
          employees={board?.employees || []}
          busy={busy}
          onClose={() => setReqForm(null)}
          onSave={(data) =>
            void run(async () => {
              await api.savePeopleManpowerRequest(data);
              setReqForm(null);
            }, 'Manpower request saved')
          }
        />
      ) : null}

      {planForm ? (
        <PlanModal
          form={planForm}
          departments={board?.departments || []}
          designations={board?.designations || []}
          busy={busy}
          onClose={() => setPlanForm(null)}
          onSave={(data) =>
            void run(async () => {
              await api.createStaffPlan(data);
              setPlanForm(null);
            }, 'Staff plan created')
          }
        />
      ) : null}

      {jobForm ? (
        <JobModal
          form={jobForm}
          departments={board?.departments || []}
          busy={busy}
          onClose={() => setJobForm(null)}
          onSave={(data) =>
            void run(async () => {
              await api.saveHireJob(data);
              setJobForm(null);
            }, 'Job posting saved')
          }
        />
      ) : null}
    </div>
  );
}

function PlanActualChart({ rows }: { rows: PeopleCareerBoard['dept_bars'] }) {
  const w = 420;
  const h = 170;
  const pad = { l: 28, r: 8, t: 8, b: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(1, ...rows.flatMap((r) => [r.planned, r.actual]));
  const group = rows.length ? innerW / rows.length : innerW;
  return (
    <svg className="cg-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Planned versus actual headcount">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={w - pad.r} y1={pad.t + innerH * (1 - t)} y2={pad.t + innerH * (1 - t)} stroke="#eef2f6" />
          <text x={pad.l - 6} y={pad.t + innerH * (1 - t) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">
            {Math.round(max * t)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const x = pad.l + i * group + group * 0.18;
        const bw = group * 0.28;
        const ph = (r.planned / max) * innerH;
        const ah = (r.actual / max) * innerH;
        return (
          <g key={r.name}>
            <rect x={x} y={pad.t + innerH - ph} width={bw} height={ph} rx="3" fill="#93c5fd" />
            <rect x={x + bw + 4} y={pad.t + innerH - ah} width={bw} height={ah} rx="3" fill="#34d399" />
            <text x={x + bw} y={h - 8} textAnchor="middle" fontSize="8" fill="#64748b">
              {r.name.length > 10 ? `${r.name.slice(0, 9)}…` : r.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CareerPreview({ url }: { url: string }) {
  return (
    <div className="cg-card cg-preview">
      <header>
        <b>Career Page Preview</b>
        <Link to={url} className="emp-btn">
          View
        </Link>
      </header>
      <div className="cg-hero">
        <div>
          <h3>Build Your Future With Us</h3>
          <p>Explore exciting career opportunities and grow with our team.</p>
          <Link to={url} className="emp-btn primary">
            View Career Page <HrmsIcon name="globe" size={14} />
          </Link>
        </div>
        <img src={HERO} alt="" />
      </div>
    </div>
  );
}

function RequestTable({
  rows,
  start,
  loading,
  busy,
  menuFor,
  onMenu,
  onView,
  onEdit,
  onStatus,
}: {
  rows: PeopleManpowerRequest[];
  start: number;
  loading: boolean;
  busy: boolean;
  menuFor: string | null;
  onMenu: (id: string | null) => void;
  onView: (r: PeopleManpowerRequest) => void;
  onEdit: (r: PeopleManpowerRequest) => void;
  onStatus: (id: string, status: PeopleManpowerStatus) => void;
}) {
  return (
    <div className="emp-table-wrap">
      <table className="emp-table lv-table">
        <thead>
          <tr>
            <th className="emp-col-check">
              <input type="checkbox" disabled aria-label="Select all" />
            </th>
            <th>#</th>
            <th>Requested By</th>
            <th>Department</th>
            <th>Designation</th>
            <th>Positions</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Request Date</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td className="emp-col-check">
                <input type="checkbox" disabled aria-label={`Select ${r.designation}`} />
              </td>
              <td>{start + i + 1}</td>
              <td>
                <div className="emp-person lv-person">
                  <Avatar id={r.requested_by_id || r.requested_by} name={r.requested_by} />
                  <div>
                    <b>{r.requested_by}</b>
                    <small>{r.requested_role}</small>
                  </div>
                </div>
              </td>
              <td>{r.department || '—'}</td>
              <td>{r.designation}</td>
              <td>{r.positions}</td>
              <td>
                <span className={`emp-pill ${PRI_TONE[r.priority] || 'grey'}`}>{r.priority}</span>
              </td>
              <td>
                <span className={`emp-pill ${REQ_TONE[r.status] || 'grey'}`}>{r.status}</span>
              </td>
              <td>{fmtDate(r.request_date)}</td>
              <td>
                <div className="emp-actions">
                  <button type="button" title="View" onClick={() => onView(r)}>
                    <HrmsIcon name="eye" size={17} />
                  </button>
                  <div className="emp-filter-wrap">
                    <button type="button" title="More" onClick={() => onMenu(menuFor === r.id ? null : r.id)}>
                      <HrmsIcon name="moreV" size={16} />
                    </button>
                    {menuFor === r.id ? (
                      <div className="emp-popover emp-menu">
                        <button type="button" onClick={() => onEdit(r)}>
                          Edit
                        </button>
                        <button type="button" disabled={busy} onClick={() => onStatus(r.id, 'Approved')}>
                          Approve
                        </button>
                        <button type="button" disabled={busy} onClick={() => onStatus(r.id, 'Rejected')}>
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={10} className="emp-empty">
                {loading ? 'Loading requests…' : 'No manpower requests yet.'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function JobTable({
  rows,
  start,
  loading,
  compact,
  onEdit,
  onPublish,
}: {
  rows: PeopleCareerJob[];
  start: number;
  loading: boolean;
  compact?: boolean;
  onEdit?: (j: PeopleCareerJob) => void;
  onPublish?: (j: PeopleCareerJob) => void;
}) {
  return (
    <div className="emp-table-wrap">
      <table className="emp-table lv-table">
        <thead>
          <tr>
            <th className="emp-col-check">
              <input type="checkbox" disabled aria-label="Select all" />
            </th>
            <th>#</th>
            <th>Job Title</th>
            <th>Department</th>
            <th>Type</th>
            <th>Applications</th>
            <th>Status</th>
            {compact ? null : <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((j, i) => {
            const label = jobLabel(j);
            return (
              <tr key={j.id}>
                <td className="emp-col-check">
                  <input type="checkbox" disabled aria-label={`Select ${j.title}`} />
                </td>
                <td>{start + i + 1}</td>
                <td>
                  <b>{j.title}</b>
                </td>
                <td>{j.department || '—'}</td>
                <td>{j.employment_type}</td>
                <td>{j.applications}</td>
                <td>
                  <span className={`emp-pill ${jobTone(label)}`}>{label}</span>
                </td>
                {compact ? null : (
                  <td>
                    <div className="emp-actions">
                      <button type="button" title="Edit" onClick={() => onEdit?.(j)}>
                        <HrmsIcon name="pencil" size={16} />
                      </button>
                      <button type="button" title="Publish" onClick={() => onPublish?.(j)}>
                        <HrmsIcon name="globe" size={16} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {!rows.length ? (
            <tr>
              <td colSpan={compact ? 7 : 8} className="emp-empty">
                {loading ? 'Loading jobs…' : 'No job postings yet.'}
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
  loading,
  busy,
  onPublish,
}: {
  rows: PeopleCareerPlan[];
  loading: boolean;
  busy: boolean;
  onPublish: (id: string) => void;
}) {
  return (
    <div className="emp-table-wrap">
      <table className="emp-table lv-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Department</th>
            <th>Designation</th>
            <th>Headcount</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <b>{p.title}</b>
              </td>
              <td>{p.department || '—'}</td>
              <td>{p.designation || '—'}</td>
              <td>{p.headcount}</td>
              <td>
                <span className={`emp-pill ${PLAN_TONE[p.status] || 'grey'}`}>{p.status}</span>
              </td>
              <td>
                <div className="emp-actions">
                  <Link className="emp-btn" to={`/planning/${p.id}`}>
                    Open
                  </Link>
                  {p.status !== 'Published' ? (
                    <button type="button" className="emp-btn" disabled={busy} onClick={() => onPublish(p.id)}>
                      Publish
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={6} className="emp-empty">
                {loading ? 'Loading plans…' : 'No staff plans yet.'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function RequestModal({
  form,
  departments,
  designations,
  employees,
  busy,
  onClose,
  onSave,
}: {
  form: Partial<PeopleManpowerRequest> & { designation: string };
  departments: string[];
  designations: string[];
  employees: PeopleCareerBoard['employees'];
  busy: boolean;
  onClose: () => void;
  onSave: (data: Partial<PeopleManpowerRequest> & { designation: string }) => void;
}) {
  const [f, setF] = useState(form);
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
          <h2>{form.id ? 'Edit manpower request' : 'New manpower request'}</h2>
          <button type="button" className="emp-btn" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <div className="cg-form-grid">
          <label>
            Requested by
            <input list="cg-emps" value={f.requested_by || ''} onChange={(e) => setF({ ...f, requested_by: e.target.value })} />
            <datalist id="cg-emps">
              {employees.map((e) => (
                <option key={e.id} value={e.name} />
              ))}
            </datalist>
          </label>
          <label>
            Department
            <select value={f.department || ''} onChange={(e) => setF({ ...f, department: e.target.value })}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Designation *
            <input list="cg-desig" required value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />
            <datalist id="cg-desig">
              {designations.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label>
            Positions
            <input type="number" min={1} value={f.positions ?? 1} onChange={(e) => setF({ ...f, positions: Number(e.target.value) || 1 })} />
          </label>
          <label>
            Priority
            <select value={f.priority || 'Medium'} onChange={(e) => setF({ ...f, priority: e.target.value as PeopleManpowerPriority })}>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </label>
          <label>
            Status
            <select value={f.status || 'Pending HR Review'} onChange={(e) => setF({ ...f, status: e.target.value as PeopleManpowerStatus })}>
              <option>Pending HR Review</option>
              <option>Approved</option>
              <option>Rejected</option>
            </select>
          </label>
          <label className="span-2">
            Notes
            <textarea value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} />
          </label>
        </div>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy || !f.designation.trim()}>
            Save
          </button>
        </footer>
      </form>
    </div>
  );
}

function PlanModal({
  form,
  departments,
  designations,
  busy,
  onClose,
  onSave,
}: {
  form: { title: string; designation: string; department: string; headcount: number };
  departments: string[];
  designations: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (data: { title: string; designation: string; department: string; headcount: number }) => void;
}) {
  const [f, setF] = useState(form);
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
          <h2>Create staff plan</h2>
          <button type="button" className="emp-btn" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <div className="cg-form-grid">
          <label className="span-2">
            Title
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Hire Sales Executive" />
          </label>
          <label>
            Designation *
            <input list="cg-plan-desig" required value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />
            <datalist id="cg-plan-desig">
              {designations.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label>
            Department
            <select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Headcount
            <input type="number" min={1} value={f.headcount} onChange={(e) => setF({ ...f, headcount: Number(e.target.value) || 1 })} />
          </label>
        </div>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy || !f.designation.trim()}>
            Create
          </button>
        </footer>
      </form>
    </div>
  );
}

function JobModal({
  form,
  departments,
  busy,
  onClose,
  onSave,
}: {
  form: Partial<HireJob>;
  departments: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (data: Partial<HireJob>) => void;
}) {
  const [f, setF] = useState(form);
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
          <h2>{form.name ? 'Edit job posting' : 'Post job opening'}</h2>
          <button type="button" className="emp-btn" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <div className="cg-form-grid">
          <label className="span-2">
            Job title *
            <input required value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </label>
          <label>
            Department
            <select value={f.department || ''} onChange={(e) => setF({ ...f, department: e.target.value })}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={f.employment_type || 'Full Time'} onChange={(e) => setF({ ...f, employment_type: e.target.value })}>
              <option>Full Time</option>
              <option>Part Time</option>
              <option>Contract</option>
              <option>Internship</option>
            </select>
          </label>
          <label>
            Openings
            <input type="number" min={1} value={f.openings ?? 1} onChange={(e) => setF({ ...f, openings: Number(e.target.value) || 1 })} />
          </label>
          <label>
            Status
            <select value={f.status || 'Open'} onChange={(e) => setF({ ...f, status: e.target.value as HireJob['status'] })}>
              <option>Open</option>
              <option>Draft</option>
              <option>Paused</option>
              <option>Closed</option>
            </select>
          </label>
          <label className="span-2">
            <span className="cg-check">
              <input type="checkbox" checked={Boolean(f.is_public)} onChange={(e) => setF({ ...f, is_public: e.target.checked ? 1 : 0 })} />
              Show on public career page
            </span>
          </label>
        </div>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy || !String(f.title || '').trim()}>
            Save
          </button>
        </footer>
      </form>
    </div>
  );
}
