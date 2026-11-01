import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  api,
  type PeopleAnnouncement,
  type PeopleAnnouncementsBoard,
  type PeopleAnnouncementStatus,
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
import './people-announcements.css';

type Tab = 'all' | 'published' | 'scheduled' | 'drafts' | 'archived' | 'expired';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'all', label: 'All Announcements' },
  { id: 'published', label: 'Published' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'archived', label: 'Archived' },
];

const TYPE_TONE: Record<string, string> = {
  Holiday: 'rose',
  Event: 'green',
  Policy: 'violet',
  Notice: 'orange',
  'HR Process': 'blue',
  General: 'grey',
};
const TYPE_ICON: Record<string, string> = {
  Holiday: 'calendar',
  Event: 'users',
  Policy: 'book',
  Notice: 'alertTriangle',
  'HR Process': 'clipboard',
  General: 'megaphone',
};
const ST_TONE: Record<string, string> = {
  Published: 'green',
  Scheduled: 'cyan',
  Draft: 'grey',
  Archived: 'grey',
  Expired: 'rose',
};
const TYPE_BAR: Record<string, string> = {
  General: '#14b8a6',
  Policy: '#a78bfa',
  Notice: '#fb923c',
  Event: '#fbbf24',
  Holiday: '#f87171',
  'HR Process': '#60a5fa',
};
const REACH_COLOR: Record<string, string> = {
  'All Employees': '#22d3ee',
  Departments: '#3b82f6',
  Designations: '#34d399',
  Managers: '#fb923c',
  Individual: '#f472b6',
};
const TYPES = ['Holiday', 'Event', 'Policy', 'Notice', 'HR Process', 'General'];

const EMPTY_FORM: FormState = {
  title: '',
  subtitle: '',
  body: '',
  ann_type: 'General',
  target_mode: 'All Employees',
  target_value: 'All Employees',
  schedule: 'now',
  publish_date: '',
  publish_time: '10:00',
  end_date: '',
};

type FormState = {
  id?: string;
  title: string;
  subtitle: string;
  body: string;
  ann_type: string;
  target_mode: string;
  target_value: string;
  schedule: 'now' | 'later';
  publish_date: string;
  publish_time: string;
  end_date: string;
};

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
function relTime(iso?: string | null) {
  if (!iso) return '';
  const t = new Date(iso.includes('T') ? iso : `${iso.slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(t)) return fmtDate(iso);
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 0) return fmtDate(iso);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return '1 day ago';
  if (days < 14) return `${days} days ago`;
  return fmtDate(iso);
}
function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('Unable to read file'));
    r.readAsDataURL(file);
  });
}
function fromRow(a: PeopleAnnouncement): FormState {
  return {
    id: a.id,
    title: a.title,
    subtitle: a.subtitle || '',
    body: a.body || '',
    ann_type: a.ann_type || 'General',
    target_mode: a.target_mode || 'All Employees',
    target_value: a.target_value || 'All Employees',
    schedule: a.status === 'Scheduled' ? 'later' : 'now',
    publish_date: a.publish_date || '',
    publish_time: a.publish_time || '10:00',
    end_date: a.end_date || '',
  };
}

export function PeopleAnnouncementsPage({ preview }: { preview?: PeopleAnnouncementsBoard }) {
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
        if (alive) setError(err instanceof Error && err.message ? err.message : 'Unable to load announcements');
      }
    })();
    return () => {
      alive = false;
    };
  }, [preview]);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="lv-muted">Loading announcements…</p>;
  return <AnnouncementsDesk preview={preview} manager={Boolean(isManager)} />;
}

function AnnouncementsDesk({ preview, manager }: { preview?: PeopleAnnouncementsBoard; manager: boolean }) {
  const [board, setBoard] = useState<PeopleAnnouncementsBoard | null>(preview || null);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [desig, setDesig] = useState('');
  const [mgr, setMgr] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[0]);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (preview) {
      setBoard(preview);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.getPeopleAnnouncements();
      setBoard(res.data);
    } catch (e) {
      setError(errMsg(e, 'Unable to load announcements'));
    } finally {
      setLoading(false);
    }
  }, [preview]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [tab, query, dept, desig, mgr, status, perPage]);

  const k = board?.kpis;
  const total = k?.total || 0;
  const delta = k ? pctDelta(k.total || 0, k.prev_total || 0) : null;
  const share = (n: number) => `${total ? Math.round((n / total) * 100) : 0}% of total`;
  const kpis: Array<{ id: Tab; label: string; value: number; sub: string; up?: boolean; icon: string; tone: string }> = [
    {
      id: 'all',
      label: 'Total Announcements',
      value: k?.total ?? 0,
      sub: delta == null ? 'vs last month' : `${Math.abs(delta)}% vs last month`,
      up: (delta || 0) > 0,
      icon: 'send',
      tone: 'blue',
    },
    { id: 'published', label: 'Published', value: k?.published ?? 0, sub: share(k?.published || 0), icon: 'users', tone: 'green' },
    { id: 'scheduled', label: 'Scheduled', value: k?.scheduled ?? 0, sub: share(k?.scheduled || 0), icon: 'clock', tone: 'amber' },
    { id: 'expired', label: 'Expired', value: k?.expired ?? 0, sub: share(k?.expired || 0), icon: 'calendar', tone: 'rose' },
  ];

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.announcements || []).filter((a) => {
      if (tab === 'published' && a.status !== 'Published') return false;
      if (tab === 'scheduled' && a.status !== 'Scheduled') return false;
      if (tab === 'drafts' && a.status !== 'Draft') return false;
      if (tab === 'archived' && a.status !== 'Archived') return false;
      if (tab === 'expired' && a.status !== 'Expired') return false;
      if (status && a.status !== status) return false;
      if (dept && !`${a.target_value} ${a.target_mode}`.toLowerCase().includes(dept.toLowerCase())) return false;
      if (desig && !`${a.target_value}`.toLowerCase().includes(desig.toLowerCase())) return false;
      if (mgr && !`${a.target_value} ${a.published_by}`.toLowerCase().includes(mgr.toLowerCase())) return false;
      if (q && !`${a.title} ${a.subtitle} ${a.body} ${a.target_value}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, tab, query, dept, desig, mgr, status]);

  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const slice = rows.slice((page - 1) * perPage, page * perPage);
  const allOnPage = slice.length > 0 && slice.every((a) => selected.has(a.id));
  const depts = board?.departments?.length ? board.departments : ['IT Department', 'Marketing Department', 'Head Office'];
  const desigs = board?.designations?.length ? board.designations : ['Managers', 'Team Leads'];
  const mgrs = (board?.managers || []).map((m) => m.name);
  const mgrOpts = mgrs.length ? mgrs : ['HR Manager'];

  async function run(fn: () => Promise<unknown>, ok: string) {
    if (preview) {
      setNotice(ok);
      return;
    }
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

  function toggleRow(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function togglePage() {
    setSelected((cur) => {
      const next = new Set(cur);
      if (allOnPage) slice.forEach((a) => next.delete(a.id));
      else slice.forEach((a) => next.add(a.id));
      return next;
    });
  }

  async function publish(asDraft = false) {
    if (!form.title.trim() || !form.body.trim()) {
      setError('Title and description are required');
      return;
    }
    const status: PeopleAnnouncementStatus = asDraft ? 'Draft' : form.schedule === 'later' ? 'Scheduled' : 'Published';
    let upload: { file_name: string; file_data: string } | undefined;
    if (file) upload = { file_name: file.name, file_data: await readFile(file) };
    await run(
      () =>
        api.savePeopleAnnouncement(
          {
            id: form.id,
            title: form.title.trim(),
            subtitle: form.subtitle,
            body: form.body,
            ann_type: form.ann_type,
            target_mode: form.target_mode,
            target_value: form.target_mode === 'All Employees' ? 'All Employees' : form.target_value,
            publish_date: form.schedule === 'later' ? form.publish_date : undefined,
            publish_time: form.publish_time,
            end_date: form.end_date || undefined,
            status,
          },
          upload,
        ),
      asDraft ? 'Saved as draft' : status === 'Scheduled' ? 'Announcement scheduled' : 'Announcement published',
    );
    setForm(EMPTY_FORM);
    setFile(null);
  }

  const reach = board?.reach;
  const reachRows = [
    { name: 'All Employees', count: reach?.all_employees || 0 },
    { name: 'Departments', count: reach?.departments || 0 },
    { name: 'Designations', count: reach?.designations || 0 },
    { name: 'Managers', count: reach?.managers || 0 },
    { name: 'Individual', count: reach?.individual || 0 },
  ];
  const reachTotal = reachRows.reduce((s, r) => s + r.count, 0) || reach?.total || 0;
  const donut = (() => {
    if (!reachTotal) return '#e2e8f0 0% 100%';
    let acc = 0;
    return reachRows
      .map((r) => {
        const pct = (r.count / reachTotal) * 100;
        const part = `${REACH_COLOR[r.name] || '#94a3b8'} ${acc}% ${acc + pct}%`;
        acc += pct;
        return part;
      })
      .join(', ');
  })();
  const typeRows = board?.by_type?.length ? board.by_type : TYPES.map((name) => ({ name, count: 0 }));
  const typeMax = Math.max(1, ...typeRows.map((t) => t.count));

  function wrap(tag: 'b' | 'i' | 'u' | 'a') {
    const open = tag === 'a' ? '[' : tag === 'b' ? '**' : tag === 'i' ? '*' : '__';
    const close = tag === 'a' ? '](url)' : open;
    setForm((f) => ({ ...f, body: `${f.body}${open}text${close}` }));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const next = e.dataTransfer.files?.[0];
    if (next) setFile(next);
  }

  return (
    <div className="hrms-list-page emp-page dep-page lv-page ann-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="megaphone" size={28} />
          </span>
          <div>
            <h1>Announcements</h1>
            <p>Create and share important updates, news and notices with employees, departments or specific groups.</p>
          </div>
        </div>
        {manager ? (
          <div className="dep-head-actions">
            <button
              className="emp-btn primary lg"
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setFile(null);
              }}
            >
              <HrmsIcon name="plus" size={17} />
              New Announcement
            </button>
          </div>
        ) : null}
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}
      {notice ? (
        <div className="dsg-selbar">
          <span className="emp-notice">{notice}</span>
        </div>
      ) : null}

      <div className="att-kpis ann-kpis">
        {kpis.map((kp) => (
          <button
            key={kp.label}
            type="button"
            className={`emp-card att-kpi ann-kpi-btn${tab === kp.id ? ' on' : ''}`}
            onClick={() => {
              setTab(kp.id);
              setStatus('');
            }}
          >
            <span className={`dep-kpi-icon ${kp.tone}`}>
              <HrmsIcon name={kp.icon} size={22} />
            </span>
            <div>
              <b>{kp.label}</b>
              <strong>{loading && !board ? '…' : kp.value.toLocaleString()}</strong>
              <small className={kp.up ? 'up' : ''}>
                {kp.up ? '↑ ' : ''}
                {kp.sub}
              </small>
            </div>
          </button>
        ))}
      </div>

      <section className="emp-card att-main">
        <div className="att-tabs-row">
          <nav className="att-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="ann-body">
          <div className="ann-table-col">
            <div className="att-filters ann-filters">
              <label className="emp-search att-search">
                <HrmsIcon name="search" size={16} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search announcements by title, content…" />
              </label>
              <FilterDropdown value={dept} allLabel="All Departments" options={depts} onChange={setDept} label="Department" />
              <FilterDropdown value={desig} allLabel="All Designations" options={desigs} onChange={setDesig} label="Designation" />
              <FilterDropdown value={mgr} allLabel="All Managers" options={mgrOpts} onChange={setMgr} label="Manager" />
              <FilterDropdown value={status} allLabel="All Status" options={['Published', 'Scheduled', 'Draft', 'Archived', 'Expired']} onChange={setStatus} label="Status" />
              <button
                type="button"
                className="emp-btn"
                disabled={!query && !dept && !desig && !mgr && !status}
                onClick={() => {
                  setQuery('');
                  setDept('');
                  setDesig('');
                  setMgr('');
                  setStatus('');
                }}
              >
                <HrmsIcon name="reset" size={16} /> Reset
              </button>
            </div>
            <div className="emp-table-wrap">
              <table className="emp-table">
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" checked={allOnPage} onChange={togglePage} disabled={!slice.length} aria-label="Select all on this page" />
                    </th>
                    <th>#</th>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Target Audience</th>
                    <th>Published By</th>
                    <th>Publish Date</th>
                    <th>End Date</th>
                    <th>Status</th>
                    <th className="emp-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !board ? (
                    <tr>
                      <td className="emp-empty" colSpan={10}>
                        Loading announcements…
                      </td>
                    </tr>
                  ) : slice.length === 0 ? (
                    <tr>
                      <td className="emp-empty" colSpan={10}>
                        No announcements in this view.
                      </td>
                    </tr>
                  ) : (
                    slice.map((a, i) => (
                      <tr key={a.id} className={selected.has(a.id) ? 'selected' : ''} onClick={() => manager && setForm(fromRow(a))}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleRow(a.id)} aria-label={`Select ${a.title}`} />
                        </td>
                        <td>{(page - 1) * perPage + i + 1}</td>
                        <td>
                          <div className="ann-doc">
                            <span className={`ann-type ${TYPE_TONE[a.ann_type] || 'grey'}`}>
                              <HrmsIcon name={TYPE_ICON[a.ann_type] || 'megaphone'} size={15} />
                            </span>
                            <div>
                              <b title={a.title}>{a.title}</b>
                              <small>{a.subtitle}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`emp-pill ${TYPE_TONE[a.ann_type] || 'grey'}`}>{a.ann_type}</span>
                        </td>
                        <td>{a.target_value || a.target_mode}</td>
                        <td>
                          <div className="emp-person lv-person">
                            <Avatar id={a.published_by || 'hr'} name={a.published_by || 'HR Manager'} />
                            <div>
                              <b>{a.published_by || 'HR Manager'}</b>
                            </div>
                          </div>
                        </td>
                        <td>{fmtDate(a.publish_date)}</td>
                        <td>{fmtDate(a.end_date)}</td>
                        <td>
                          <span className={`emp-pill ${ST_TONE[a.status] || 'grey'}`}>{a.status}</span>
                        </td>
                        <td className="emp-col-actions" onClick={(e) => e.stopPropagation()}>
                          <div className="emp-actions">
                            <button type="button" aria-label="View" onClick={() => setForm(fromRow(a))}>
                              <HrmsIcon name="eye" size={15} />
                            </button>
                            {manager ? (
                              <button type="button" aria-label="Edit" onClick={() => setForm(fromRow(a))}>
                                <HrmsIcon name="pencil" size={15} />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pager
              page={page}
              pages={pages}
              perPage={perPage}
              onPage={setPage}
              onPerPage={setPerPage}
              summary={`Showing ${rows.length ? (page - 1) * perPage + 1 : 0} to ${Math.min(page * perPage, rows.length)} of ${rows.length} announcements`}
            />
          </div>

          {manager ? (
            <aside className="ann-composer">
              <h2>Create Announcement</h2>
              <label>
                Title *
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Enter announcement title" />
              </label>
              <label>
                Type
                <select value={form.ann_type} onChange={(e) => setForm({ ...form, ann_type: e.target.value })}>
                  {TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Description *
                <div className="ann-toolbar">
                  <button type="button" onClick={() => wrap('b')}>
                    B
                  </button>
                  <button type="button" onClick={() => wrap('i')}>
                    I
                  </button>
                  <button type="button" onClick={() => wrap('u')}>
                    U
                  </button>
                  <button type="button" aria-label="Link" onClick={() => wrap('a')}>
                    <HrmsIcon name="share" size={13} />
                  </button>
                </div>
                <textarea rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Write your announcement here…" />
              </label>
              <label>
                Attachment (Optional)
                <div className="ann-drop" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onClick={() => fileRef.current?.click()}>
                  <HrmsIcon name="download" size={22} />
                  <b>{file ? file.name : 'Drag & drop files here, or click to upload'}</b>
                  PDF, DOC, DOCX, JPG, PNG, MP4 (Max 10 MB)
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
              <b style={{ display: 'block', margin: '4px 0 8px', fontSize: '0.82rem', color: '#0f2a3d' }}>Target Audience</b>
              <ul className="ann-audience">
                {(
                  [
                    ['All Employees', 'All Employees'],
                    ['Department', 'By Department'],
                    ['Designation', 'By Designation'],
                    ['Manager', 'By Manager'],
                    ['Individual', 'By Individual Employees'],
                  ] as Array<[string, string]>
                ).map(([mode, label]) => (
                  <li key={mode}>
                    <label className="row">
                      <input type="radio" checked={form.target_mode === mode} onChange={() => setForm({ ...form, target_mode: mode, target_value: mode === 'All Employees' ? 'All Employees' : form.target_value })} />
                      {label}
                    </label>
                    {mode === 'Department' ? (
                      <select disabled={form.target_mode !== mode} value={form.target_mode === mode ? form.target_value : ''} onChange={(e) => setForm({ ...form, target_value: e.target.value })}>
                        <option value="">Select Departments</option>
                        {depts.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    ) : null}
                    {mode === 'Designation' ? (
                      <select disabled={form.target_mode !== mode} value={form.target_mode === mode ? form.target_value : ''} onChange={(e) => setForm({ ...form, target_value: e.target.value })}>
                        <option value="">Select Designations</option>
                        {desigs.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    ) : null}
                    {mode === 'Manager' ? (
                      <select disabled={form.target_mode !== mode} value={form.target_mode === mode ? form.target_value : ''} onChange={(e) => setForm({ ...form, target_value: e.target.value })}>
                        <option value="">Select Managers</option>
                        {mgrOpts.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    ) : null}
                    {mode === 'Individual' ? (
                      <select disabled={form.target_mode !== mode} value={form.target_mode === mode ? form.target_value : ''} onChange={(e) => setForm({ ...form, target_value: e.target.value })}>
                        <option value="">Select Employees</option>
                        {(board?.employees || []).map((d) => (
                          <option key={d.id} value={d.name}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </li>
                ))}
              </ul>
              <b style={{ display: 'block', margin: '4px 0 8px', fontSize: '0.82rem', color: '#0f2a3d' }}>Schedule</b>
              <div className="ann-schedule">
                <label className="row">
                  <input type="radio" checked={form.schedule === 'now'} onChange={() => setForm({ ...form, schedule: 'now' })} />
                  Publish Now
                </label>
                <label className="row">
                  <input type="radio" checked={form.schedule === 'later'} onChange={() => setForm({ ...form, schedule: 'later' })} />
                  Schedule for Later
                </label>
                {form.schedule === 'later' ? (
                  <div className="ann-when">
                    <input type="date" value={form.publish_date} onChange={(e) => setForm({ ...form, publish_date: e.target.value })} />
                    <input type="time" value={form.publish_time} onChange={(e) => setForm({ ...form, publish_time: e.target.value })} />
                  </div>
                ) : null}
              </div>
              <footer>
                <button type="button" className="emp-btn ann-draft" onClick={() => void publish(true)} disabled={busy}>
                  Save Draft
                </button>
                <button type="button" className="emp-btn" onClick={() => { setForm(EMPTY_FORM); setFile(null); }}>
                  Cancel
                </button>
                <button type="button" className="emp-btn primary" disabled={busy || !form.title.trim() || !form.body.trim()} onClick={() => void publish(false)}>
                  Publish Announcement
                </button>
              </footer>
            </aside>
          ) : null}
        </div>
      </section>

      <div className="ann-bottom">
        <section className="emp-card ann-panel">
          <header>
            Recent Announcements
            <button type="button" className="ann-link" onClick={() => setTab('published')}>
              View All
            </button>
          </header>
          <ul className="ann-feed">
            {(board?.recent || []).slice(0, 4).map((a) => (
              <li key={a.id}>
                <span className={`ann-type ${TYPE_TONE[a.ann_type] || 'grey'}`}>
                  <HrmsIcon name={TYPE_ICON[a.ann_type] || 'megaphone'} size={15} />
                </span>
                <div>
                  <b>{a.title}</b>
                  <small>
                    Published {relTime(a.publish_date)} by {a.published_by || 'HR Manager'}
                  </small>
                </div>
                <div className="emp-actions">
                  <button
                    type="button"
                    aria-label="Download"
                    onClick={() =>
                      downloadCsv(`${a.title}.csv`, ['Title', 'Type', 'Audience'], [[a.title, a.ann_type, a.target_value]])
                    }
                  >
                    <HrmsIcon name="download" size={15} />
                  </button>
                </div>
              </li>
            ))}
            {!board?.recent?.length ? <li className="lv-muted">No published announcements yet.</li> : null}
          </ul>
        </section>
        <section className="emp-card ann-panel">
          <header>Announcement Reach</header>
          <div className="ann-source">
            <div className="ann-donut" style={{ background: `conic-gradient(${donut})` }} aria-hidden>
              <span>
                <strong>{(reach?.total || reachTotal).toLocaleString()}</strong>
                <small>Total Employees</small>
              </span>
            </div>
            <ul>
              {reachRows.map((r) => (
                <li key={r.name}>
                  <i className="ann-dot" style={{ background: REACH_COLOR[r.name] }} />
                  {r.name}
                  <span>
                    {r.count} ({reachTotal ? Math.round((r.count / reachTotal) * 100) : 0}%)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="emp-card ann-panel">
          <header>
            Announcements by Type
            <button type="button" className="ann-link" onClick={() => setTab('all')}>
              View All
            </button>
          </header>
          <ul className="ann-bars">
            {typeRows.map((t) => (
              <li key={t.name}>
                <span className={`ann-type ${TYPE_TONE[t.name] || 'grey'}`} style={{ width: 18, height: 18 }}>
                  <HrmsIcon name={TYPE_ICON[t.name] || 'megaphone'} size={11} />
                </span>
                <div>
                  {t.name}
                  <div className="ann-bar">
                    <i style={{ width: `${Math.max(6, Math.round((t.count / typeMax) * 100))}%`, background: TYPE_BAR[t.name] || '#94a3b8' }} />
                  </div>
                </div>
                <b>{t.count}</b>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
