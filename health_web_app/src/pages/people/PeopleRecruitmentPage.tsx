import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type HireCandidateRow, type HireJob, type HireStage, type HiringOverview } from '../../api';
import { HrmsIcon, type HrmsIconName } from '../../components/HrmsIcons';
import { Avatar, downloadCsv } from './peopleTableKit';
import { HiringJobsTab } from './hiring/HiringJobsTab';
import { HiringCandidatesTab } from './hiring/HiringCandidatesTab';
import { HiringImportTab } from './hiring/HiringImportTab';
import { CandidateDrawer } from './hiring/CandidateDrawer';
import { errMsg, fmtAgo, fmtDate, fmtDateTime } from './hiring/hiringUtils';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-attendance.css';
import './people-leave.css';
import './hiring/people-hiring.css';
import './people-recruitment.css';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'jobs', label: 'Jobs & Portals' },
  { id: 'candidates', label: 'Candidates' },
  { id: 'interviews', label: 'Interviews' },
  { id: 'offers', label: 'Offers' },
  { id: 'reports', label: 'Reports' },
] as const;

export type HiringTab = (typeof TABS)[number]['id'] | 'import';
export type HiringNav = (tab: HiringTab, params?: Record<string, string>) => void;

const PIPE: Array<{ key: string; label: string; tone: string; stage?: HireStage | 'All' }> = [
  { key: 'total', label: 'Total Applicants', tone: 'grey', stage: 'All' },
  { key: 'Screening', label: 'Screening', tone: 'blue', stage: 'Screening' },
  { key: 'Interview', label: 'Interview', tone: 'amber', stage: 'Interview' },
  { key: 'Offer', label: 'Offer', tone: 'violet', stage: 'Offer' },
  { key: 'Hired', label: 'Hired', tone: 'green', stage: 'Hired' },
  { key: 'Rejected', label: 'Rejected', tone: 'rose', stage: 'Rejected' },
];

const SOURCE_COLORS: Record<string, string> = {
  Naukri: '#0d9488',
  WorkIndia: '#22c55e',
  Careers: '#f59e0b',
  Referral: '#a855f7',
  'Walk-in': '#ec4899',
  Other: '#64748b',
};

const JOB_TONE: Record<string, string> = {
  Open: 'green',
  Paused: 'amber',
  Draft: 'grey',
  Closed: 'rose',
};

function jobStatusLabel(status: string) {
  return status === 'Paused' ? 'On Hold' : status;
}

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function activityCopy(a: HiringOverview['recent_activity'][number], jobs: HireJob[]) {
  const name = a.candidate_name || a.candidate;
  if (a.kind === 'Stage' && a.to_stage === 'Interview') return `Interview scheduled for ${name}`;
  if (a.kind === 'Stage' && a.to_stage === 'Offer') return `Offer letter sent to ${name}`;
  if (a.kind === 'Stage' && a.to_stage === 'Hired') {
    const job = jobs.find((j) => j.name === a.body);
    return `${name} joined${job ? ` as ${job.title}` : ''}`;
  }
  if (a.kind === 'Import' || a.kind === 'System') return a.body || `New application received for ${name}`;
  if (a.to_stage) return `${name} moved to ${a.to_stage}`;
  return a.body || `${a.kind}: ${name}`;
}

function activityIcon(a: HiringOverview['recent_activity'][number]): { name: HrmsIconName; tone: string } {
  if (a.to_stage === 'Interview') return { name: 'calendar', tone: 'orange' };
  if (a.to_stage === 'Offer') return { name: 'send', tone: 'green' };
  if (a.to_stage === 'Hired') return { name: 'userCheck', tone: 'teal' };
  if (a.kind === 'Import' || a.kind === 'System') return { name: 'users', tone: 'blue' };
  return { name: 'briefcase', tone: 'teal' };
}

export function PeopleRecruitmentPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id || (params.get('tab') === 'import' ? 'import' : 'overview')) as HiringTab;

  const go = useCallback<HiringNav>(
    (next, extra = {}) => {
      setParams({ tab: next, ...extra });
    },
    [setParams],
  );

  return <RecruitmentDesk tab={tab} params={params} go={go} />;
}

function RecruitmentDesk({ tab, params, go }: { tab: HiringTab; params: URLSearchParams; go: HiringNav }) {
  const [overview, setOverview] = useState<HiringOverview | null>(null);
  const [jobs, setJobs] = useState<HireJob[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ov, jb] = await Promise.all([api.getHiringOverview(), api.listHireJobs()]);
      setOverview(ov.data);
      setJobs(jb.data.jobs);
    } catch (e) {
      setError(errMsg(e, 'Unable to load recruitment'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stageCount = useCallback(
    (stage: string) => overview?.stages.find((s) => s.stage === stage)?.count || 0,
    [overview],
  );

  const totalApplicants = overview ? overview.stages.reduce((s, x) => s + x.count, 0) : 0;
  const openPositions = jobs.filter((j) => j.status === 'Open').reduce((s, j) => s + (j.openings || 1), 0);
  const screening = stageCount('Screening');
  const interview = stageCount('Interview');
  const offers = stageCount('Offer');
  const hired = overview?.kpis.hired_month || 0;

  const kpis = [
    { label: 'Open Positions', value: openPositions, sub: `${overview?.kpis.open_jobs || 0} open jobs`, icon: 'checkCircle' as const, tone: 'green', tab: 'jobs' as HiringTab },
    { label: 'Total Applicants', value: totalApplicants, sub: `${overview?.kpis.new_7d || 0} in last 7 days`, icon: 'users' as const, tone: 'amber', tab: 'candidates' as HiringTab, extra: { stage: 'All' } },
    { label: 'In Screening', value: screening, sub: 'Active screening', icon: 'users' as const, tone: 'blue', tab: 'candidates' as HiringTab, extra: { stage: 'Screening' } },
    { label: 'In Interview', value: interview, sub: `${overview?.kpis.interviews_7d || 0} in next 7 days`, icon: 'calendar' as const, tone: 'orange', tab: 'interviews' as HiringTab },
    { label: 'Offers', value: offers, sub: 'Awaiting decision', icon: 'send' as const, tone: 'violet', tab: 'offers' as HiringTab },
    { label: 'Hired (This Month)', value: hired, sub: 'Joined this month', icon: 'userCheck' as const, tone: 'green', tab: 'candidates' as HiringTab, extra: { stage: 'Hired' } },
  ];

  const pipeCounts = PIPE.map((p) => ({
    ...p,
    count: p.key === 'total' ? totalApplicants : stageCount(p.key),
  }));

  const sources = overview?.sources_30d || [];
  const sourceTotal = sources.reduce((s, x) => s + x.count, 0) || 1;
  let acc = 0;
  const donut = sources
    .filter((s) => s.count)
    .map((s) => {
      const start = acc;
      acc += (s.count / sourceTotal) * 100;
      return `${SOURCE_COLORS[s.source] || '#64748b'} ${start}% ${acc}%`;
    })
    .join(', ');

  return (
    <div className="hrms-list-page emp-page dep-page lv-page rc-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="briefcase" size={28} />
          </span>
          <div>
            <h1>Recruitment</h1>
            <p>Manage job postings, track candidates and streamline your hiring process</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <button className="emp-btn primary lg" type="button" onClick={() => go('jobs', { create: '1' })}>
            <HrmsIcon name="plus" size={17} />
            Create Job Posting
          </button>
          <button className="emp-btn lg" type="button" onClick={() => go('import')}>
            <HrmsIcon name="download" size={17} />
            Import Applicants
          </button>
        </div>
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}

      <div className="att-kpis rc-kpis">
        {kpis.map((kp) => (
          <button key={kp.label} type="button" className="emp-card att-kpi rc-kpi-btn" onClick={() => go(kp.tab, kp.extra)}>
            <span className={`dep-kpi-icon ${kp.tone}`}>
              <HrmsIcon name={kp.icon} size={22} />
            </span>
            <div>
              <b>{kp.label}</b>
              <strong>{loading && !overview ? '…' : kp.value}</strong>
              <small>{kp.sub}</small>
            </div>
          </button>
        ))}
      </div>

      <section className="emp-card att-main rc-main">
        <div className="att-tabs-row">
          <nav className="att-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {tab === 'overview' ? (
          <OverviewBody
            loading={loading}
            overview={overview}
            jobs={jobs}
            pipeCounts={pipeCounts}
            sources={sources}
            sourceTotal={sourceTotal}
            donut={donut || '#e2e8f0 0% 100%'}
            go={go}
          />
        ) : null}
        {tab === 'jobs' ? <HiringJobsTab go={go} focusJob={params.get('job') || ''} startCreate={params.get('create') === '1'} /> : null}
        {tab === 'candidates' ? (
          <HiringCandidatesTab
            initialJob={params.get('job') || ''}
            initialStage={params.get('stage') || 'Active'}
            focusCandidate={params.get('candidate') || ''}
          />
        ) : null}
        {tab === 'interviews' ? <InterviewsTab go={go} /> : null}
        {tab === 'offers' ? <OffersTab go={go} /> : null}
        {tab === 'reports' ? (
          <ReportsTab overview={overview} jobs={jobs} totalApplicants={totalApplicants} hired={hired} />
        ) : null}
        {tab === 'import' ? <HiringImportTab go={go} initialJob={params.get('job') || ''} /> : null}
      </section>
    </div>
  );
}

function OverviewBody({
  loading,
  overview,
  jobs,
  pipeCounts,
  sources,
  sourceTotal,
  donut,
  go,
}: {
  loading: boolean;
  overview: HiringOverview | null;
  jobs: HireJob[];
  pipeCounts: Array<{ key: string; label: string; tone: string; count: number; stage?: HireStage | 'All' }>;
  sources: Array<{ source: string; count: number }>;
  sourceTotal: number;
  donut: string;
  go: HiringNav;
}) {
  const recentJobs = jobs.slice(0, 5);
  const interviews = overview?.upcoming_interviews || [];
  const activity = overview?.recent_activity || [];

  return (
    <>
      <div className="rc-cards">
        <div className="rc-card rc-pipe-card">
          <header>
            <b>Hiring Pipeline (All Jobs)</b>
          </header>
          {loading && !overview ? (
            <p className="lv-muted">Loading…</p>
          ) : (
            <ol className="rc-pipe">
              {pipeCounts.map((p, i) => (
                <li key={p.key}>
                  {i ? <span className="rc-pipe-arrow" aria-hidden /> : null}
                  <button type="button" className={`rc-pipe-step ${p.tone}`} onClick={() => go('candidates', { stage: p.stage === 'All' ? '' : String(p.stage) })}>
                    <strong>{p.count}</strong>
                    <span>{p.label}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="rc-card">
          <header>
            <b>Applicants by Source</b>
            <span>Last 30 days</span>
          </header>
          <div className="rc-source">
            <div className="rc-donut" style={{ background: `conic-gradient(${donut})` }} aria-hidden>
              <span>
                <strong>{sources.reduce((s, x) => s + x.count, 0)}</strong>
                <small>Applicants</small>
              </span>
            </div>
            <ul>
              {sources.map((s) => (
                <li key={s.source}>
                  <i style={{ background: SOURCE_COLORS[s.source] || '#64748b' }} />
                  <span>{s.source}</span>
                  <b>
                    {Math.round((s.count / sourceTotal) * 100)}% ({s.count})
                  </b>
                </li>
              ))}
              {!sources.length ? <li className="lv-muted">No applicants in the last 30 days.</li> : null}
            </ul>
          </div>
        </div>
      </div>

      <div className="rc-section-head">
        <b>Recent Job Openings</b>
        <button type="button" className="att-link" onClick={() => go('jobs')}>
          View All Jobs
        </button>
      </div>
      <div className="emp-table-wrap">
        <table className="emp-table lv-table rc-table">
          <thead>
            <tr>
              <th className="emp-col-check">
                <input type="checkbox" disabled aria-label="Select all" />
              </th>
              <th>#</th>
              <th>Job Title</th>
              <th>Department</th>
              <th>Location</th>
              <th>Type</th>
              <th>Openings</th>
              <th>Applicants</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {recentJobs.map((j, i) => (
              <tr key={j.name}>
                <td className="emp-col-check">
                  <input type="checkbox" disabled aria-label={`Select ${j.title}`} />
                </td>
                <td>{i + 1}</td>
                <td>
                  <b>{j.title}</b>
                </td>
                <td>{j.department || '—'}</td>
                <td>{j.location || '—'}</td>
                <td>{j.employment_type || '—'}</td>
                <td>{j.openings}</td>
                <td>
                  <button type="button" className="att-link" onClick={() => go('candidates', { job: j.name, stage: 'All' })}>
                    {j.candidates ?? 0}
                  </button>
                </td>
                <td>
                  <span className={`emp-pill ${JOB_TONE[j.status] || 'slate'}`}>{jobStatusLabel(j.status)}</span>
                </td>
                <td>
                  <div className="emp-actions">
                    <button type="button" title="View candidates" onClick={() => go('candidates', { job: j.name, stage: 'Active' })}>
                      <HrmsIcon name="eye" size={17} />
                    </button>
                    <button type="button" title="Edit job" onClick={() => go('jobs', { job: j.name })}>
                      <HrmsIcon name="pencil" size={16} />
                    </button>
                    <button type="button" title="Candidates" onClick={() => go('candidates', { job: j.name, stage: 'Active' })}>
                      <HrmsIcon name="users" size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!recentJobs.length ? (
              <tr>
                <td colSpan={10} className="emp-empty">
                  {loading ? 'Loading jobs…' : 'No job openings yet. Create a posting to get started.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="rc-split">
        <div className="rc-card">
          <header>
            <b>Upcoming Interviews</b>
            <button type="button" className="att-link" onClick={() => go('interviews')}>
              View All
            </button>
          </header>
          <div className="emp-table-wrap">
          <table className="emp-table lv-table rc-mini">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Candidate</th>
                <th>Position</th>
                <th>Mode</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {interviews.slice(0, 4).map((c) => (
                <tr key={c.name} className="rc-click" onClick={() => go('candidates', { stage: 'Interview', candidate: c.name })}>
                  <td className="rc-when">
                    <b>{fmtDate(c.interview_at)}</b>
                    <small>{fmtDateTime(c.interview_at).split(',').slice(-1)[0]?.trim()}</small>
                  </td>
                  <td>
                    <div className="emp-person lv-person">
                      <Avatar id={c.name} name={c.full_name} />
                      <div>
                        <b>{c.full_name}</b>
                      </div>
                    </div>
                  </td>
                  <td>{c.job_title || '—'}</td>
                  <td>—</td>
                  <td>
                    <span className="emp-pill blue">Scheduled</span>
                  </td>
                </tr>
              ))}
              {!interviews.length ? (
                <tr>
                  <td colSpan={5} className="emp-empty">
                    No interviews in the next 7 days.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </div>
        <div className="rc-card">
          <header>
            <b>Recent Activity</b>
          </header>
          <ul className="rc-activity">
            {activity.map((a, i) => {
              const ic = activityIcon(a);
              return (
                <li key={`${a.candidate}-${i}`}>
                  <span className={`dep-kpi-icon ${ic.tone}`}>
                    <HrmsIcon name={ic.name} size={16} />
                  </span>
                  <div>
                    <p>{activityCopy(a, jobs)}</p>
                    {a.body && a.kind === 'Stage' ? <small>{a.body}</small> : null}
                  </div>
                  <time>{fmtAgo(a.at)}</time>
                </li>
              );
            })}
            {!activity.length ? <li className="lv-muted">Nothing yet. Create a job to get started.</li> : null}
          </ul>
        </div>
      </div>
    </>
  );
}

function InterviewsTab({ go }: { go: HiringNav }) {
  const [rows, setRows] = useState<HireCandidateRow[]>([]);
  const [jobs, setJobs] = useState<HireJob[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [c, j] = await Promise.all([api.listHireCandidates({ stage: 'Interview', limit: 300 }), api.listHireJobs()]);
        if (!alive) return;
        setRows([...c.data.candidates].sort((a, b) => String(a.interview_at || '').localeCompare(String(b.interview_at || ''))));
        setJobs(j.data.jobs);
      } catch (e) {
        if (alive) setError(errMsg(e, 'Could not load interviews'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="rc-tab-pad">
      {error ? <p className="hire-error">{error}</p> : null}
      <div className="emp-table-wrap">
        <table className="emp-table lv-table rc-table">
          <thead>
            <tr>
              <th>Date & Time</th>
              <th>Candidate</th>
              <th>Position</th>
              <th>Source</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.name} className="rc-click" onClick={() => setOpen(c.name)}>
                <td className="rc-when">
                  <b>{c.interview_at ? fmtDate(c.interview_at) : 'Not scheduled'}</b>
                  {c.interview_at ? <small>{fmtDateTime(c.interview_at).split(',').slice(-1)[0]?.trim()}</small> : null}
                </td>
                <td>
                  <div className="emp-person lv-person">
                    <Avatar id={c.name} name={c.full_name} />
                    <div>
                      <b>{c.full_name}</b>
                      <small>{c.mobile || c.email || c.name}</small>
                    </div>
                  </div>
                </td>
                <td>{c.job_title || '—'}</td>
                <td>{c.source}</td>
                <td>
                  <span className={`emp-pill ${c.interview_at ? 'blue' : 'amber'}`}>{c.interview_at ? 'Scheduled' : 'Awaiting slot'}</span>
                </td>
                <td>
                  <div className="emp-actions">
                    <button
                      type="button"
                      title="Open candidate"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(c.name);
                      }}
                    >
                      <HrmsIcon name="eye" size={17} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6} className="emp-empty">
                  {loading ? 'Loading interviews…' : 'No candidates in interview.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {open ? (
        <CandidateDrawer
          name={open}
          jobs={jobs}
          onClose={() => setOpen('')}
          onChanged={() => {
            go('interviews');
          }}
        />
      ) : null}
    </div>
  );
}

function OffersTab({ go }: { go: HiringNav }) {
  const [rows, setRows] = useState<HireCandidateRow[]>([]);
  const [jobs, setJobs] = useState<HireJob[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [c, j] = await Promise.all([api.listHireCandidates({ stage: 'Offer', limit: 300 }), api.listHireJobs()]);
        if (!alive) return;
        setRows(c.data.candidates);
        setJobs(j.data.jobs);
      } catch (e) {
        if (alive) setError(errMsg(e, 'Could not load offers'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="rc-tab-pad">
      {error ? <p className="hire-error">{error}</p> : null}
      <div className="emp-table-wrap">
        <table className="emp-table lv-table rc-table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Position</th>
              <th>Expected CTC</th>
              <th>Source</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.name} className="rc-click" onClick={() => setOpen(c.name)}>
                <td>
                  <div className="emp-person lv-person">
                    <Avatar id={c.name} name={c.full_name} />
                    <div>
                      <b>{c.full_name}</b>
                      <small>{c.email || c.mobile || c.name}</small>
                    </div>
                  </div>
                </td>
                <td>{c.job_title || '—'}</td>
                <td>{c.expected_ctc ? `₹${Math.round(c.expected_ctc).toLocaleString('en-IN')}` : '—'}</td>
                <td>{c.source}</td>
                <td>
                  <span className="emp-pill violet">Offer</span>
                </td>
                <td>
                  <div className="emp-actions">
                    <button
                      type="button"
                      title="Open candidate"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(c.name);
                      }}
                    >
                      <HrmsIcon name="eye" size={17} />
                    </button>
                    <button
                      type="button"
                      title="All candidates"
                      onClick={(e) => {
                        e.stopPropagation();
                        go('candidates', { stage: 'Offer', candidate: c.name });
                      }}
                    >
                      <HrmsIcon name="users" size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6} className="emp-empty">
                  {loading ? 'Loading offers…' : 'No open offers.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {open ? <CandidateDrawer name={open} jobs={jobs} onClose={() => setOpen('')} onChanged={() => undefined} /> : null}
    </div>
  );
}

function ReportsTab({
  overview,
  jobs,
  totalApplicants,
  hired,
}: {
  overview: HiringOverview | null;
  jobs: HireJob[];
  totalApplicants: number;
  hired: number;
}) {
  const rejected = overview?.stages.find((s) => s.stage === 'Rejected')?.count || 0;
  const lines = (overview?.stages || []).map((s) => [s.stage, s.count]);
  return (
    <div className="rc-tab-pad rc-report">
      <div className="rc-report-kpis">
        <div className="emp-card att-kpi">
          <span className="dep-kpi-icon teal">
            <HrmsIcon name="users" size={22} />
          </span>
          <div>
            <b>Applicants</b>
            <strong>{totalApplicants}</strong>
          </div>
        </div>
        <div className="emp-card att-kpi">
          <span className="dep-kpi-icon green">
            <HrmsIcon name="userCheck" size={22} />
          </span>
          <div>
            <b>Hired this month</b>
            <strong>{hired}</strong>
          </div>
        </div>
        <div className="emp-card att-kpi">
          <span className="dep-kpi-icon rose">
            <HrmsIcon name="xCircle" size={22} />
          </span>
          <div>
            <b>Rejected</b>
            <strong>{rejected}</strong>
          </div>
        </div>
        <div className="emp-card att-kpi">
          <span className="dep-kpi-icon blue">
            <HrmsIcon name="briefcase" size={22} />
          </span>
          <div>
            <b>Open jobs</b>
            <strong>{overview?.kpis.open_jobs || 0}</strong>
          </div>
        </div>
      </div>
      <div className="rc-report-actions">
        <button
          type="button"
          className="emp-btn"
          onClick={() => downloadCsv(`recruitment-pipeline-${thisMonth()}.csv`, ['Stage', 'Count'], lines)}
          disabled={!overview}
        >
          <HrmsIcon name="download" size={16} /> Export pipeline CSV
        </button>
        <button
          type="button"
          className="emp-btn"
          onClick={() =>
            downloadCsv(
              `recruitment-jobs-${thisMonth()}.csv`,
              ['Job', 'Status', 'Department', 'Location', 'Openings', 'Applicants', 'Hired'],
              jobs.map((j) => [j.title, j.status, j.department, j.location, j.openings, j.candidates ?? 0, j.hired ?? 0]),
            )
          }
        >
          <HrmsIcon name="download" size={16} /> Export jobs CSV
        </button>
      </div>
    </div>
  );
}
