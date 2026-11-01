import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type PeopleDocument,
  type PeopleDocumentFolder,
  type PeopleDocumentsBoard,
} from '../../api';
import { assetUrl } from '../../config';
import { HrmsIcon } from '../../components/HrmsIcons';
import { Avatar, downloadCsv, FilterDropdown, Pager, PER_PAGE_OPTIONS } from './peopleTableKit';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-attendance.css';
import './people-leave.css';
import './people-documents.css';

type Tab = 'all' | 'employee' | 'company' | 'templates' | 'expiring' | 'deleted';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'all', label: 'All Documents' },
  { id: 'employee', label: 'Employee Documents' },
  { id: 'company', label: 'Company Documents' },
  { id: 'templates', label: 'Templates' },
  { id: 'expiring', label: 'Expiring Soon' },
  { id: 'deleted', label: 'Deleted' },
];

const TYPE_TONE: Record<string, string> = { PDF: 'red', DOC: 'violet', Video: 'orange', Image: 'cyan', Other: 'grey' };
const TYPE_CLASS: Record<string, string> = { PDF: 'pdf', DOC: 'doc', Video: 'video', Image: 'image', Other: 'other' };
const ST_TONE: Record<string, string> = { Active: 'green', 'Expiring Soon': 'orange', Expired: 'rose', Deleted: 'grey' };
const REQ_TONE: Record<string, string> = { Pending: 'orange', Approved: 'green', Rejected: 'rose' };
const OPEN = new Set(['Employee Documents', 'Company Documents']);

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
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return '1 day ago';
  if (days < 14) return `${days} days ago`;
  return fmtDate(iso);
}
function typeIcon(t: string): 'file' | 'play' | 'clipboard' {
  if (t === 'Video') return 'play';
  if (t === 'DOC') return 'clipboard';
  return 'file';
}
function docSub(d: PeopleDocument) {
  if (d.employee) return d.employee;
  const file = d.file_url?.split('/').pop();
  if (file) return file;
  return d.folder || '';
}
function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('Unable to read file'));
    r.readAsDataURL(file);
  });
}
function childTitles(folders: PeopleDocumentFolder[], title: string) {
  const kids = folders.filter((f) => f.parent === title).map((f) => f.title);
  return [title, ...kids];
}

export function PeopleDocumentsPage({ preview }: { preview?: PeopleDocumentsBoard }) {
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
        if (alive) setError(err instanceof Error && err.message ? err.message : 'Unable to load documents');
      }
    })();
    return () => {
      alive = false;
    };
  }, [preview]);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="lv-muted">Loading documents…</p>;
  if (!isManager) {
    return (
      <section className="people-panel">
        <header>
          <div>
            <h2>Documents</h2>
            <p>Ask HR for letters and policy copies from this vault.</p>
          </div>
        </header>
      </section>
    );
  }
  return <DocumentsManager preview={preview} />;
}

function DocumentsManager({ preview }: { preview?: PeopleDocumentsBoard }) {
  const [board, setBoard] = useState<PeopleDocumentsBoard | null>(preview || null);
  const [tab, setTab] = useState<Tab>('all');
  const [folder, setFolder] = useState('All Documents');
  const [openFolders, setOpenFolders] = useState<Set<string>>(OPEN);
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[0]);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState<'single' | 'bulk' | null>(null);
  const [letterOpen, setLetterOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const load = useCallback(async () => {
    if (preview) {
      setBoard(preview);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.getPeopleDocuments();
      setBoard(res.data);
    } catch (e) {
      setError(errMsg(e, 'Unable to load documents'));
    } finally {
      setLoading(false);
    }
  }, [preview]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [tab, folder, query, dept, type, status, perPage]);

  const k = board?.kpis;
  const total = k?.total || 0;
  const delta = k ? pctDelta(k.this_month || 0, k.last_month || 0) : null;
  const kpis: Array<{
    id: Tab | 'expired';
    label: string;
    value: number;
    sub: string;
    up?: boolean;
    down?: boolean;
    icon: 'file' | 'users' | 'book' | 'clock' | 'alertTriangle';
    tone: string;
  }> = [
    {
      id: 'all',
      label: 'Total Documents',
      value: k?.total ?? 0,
      sub: delta == null ? 'vs last month' : `${Math.abs(delta)}% vs last month`,
      up: (delta || 0) > 0,
      down: (delta || 0) < 0,
      icon: 'file',
      tone: 'blue',
    },
    {
      id: 'employee',
      label: 'Employee Documents',
      value: k?.employee ?? 0,
      sub: `${total ? Math.round(((k?.employee || 0) / total) * 100) : 0}% of total`,
      icon: 'users',
      tone: 'green',
    },
    {
      id: 'company',
      label: 'Company Documents',
      value: k?.company ?? 0,
      sub: `${total ? Math.round(((k?.company || 0) / total) * 100) : 0}% of total`,
      icon: 'book',
      tone: 'violet',
    },
    {
      id: 'expiring',
      label: 'Expiring Soon',
      value: k?.expiring_soon ?? 0,
      sub: 'Next 30 days',
      icon: 'clock',
      tone: 'amber',
    },
    {
      id: 'expired',
      label: 'Expired Documents',
      value: k?.expired ?? 0,
      sub: 'Needs attention',
      icon: 'alertTriangle',
      tone: 'rose',
    },
  ];

  const folders = board?.folders || [];
  const roots = folders.filter((f) => !f.parent && f.id !== 'all');
  const allNode = folders.find((f) => f.id === 'all');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const folderSet = folder && folder !== 'All Documents' ? new Set(childTitles(folders, folder)) : null;
    return (board?.documents || []).filter((d) => {
      const isTpl = Boolean(d.is_template);
      if (tab === 'templates') {
        if (!isTpl || d.status === 'Deleted') return false;
      } else if (tab === 'deleted') {
        if (d.status !== 'Deleted') return false;
      } else if (tab === 'expiring') {
        if (isTpl || d.status !== 'Expiring Soon') return false;
      } else if (tab === 'employee') {
        if (isTpl || d.status === 'Deleted' || d.scope !== 'Employee') return false;
      } else if (tab === 'company') {
        if (isTpl || d.status === 'Deleted' || d.scope !== 'Company') return false;
      } else if (isTpl || d.status === 'Deleted') {
        return false;
      }
      if (status && d.status !== status) return false;
      if (type && d.file_type !== type) return false;
      if (dept && (d.department || '') !== dept && d.applicable !== 'All Employees') return false;
      if (folderSet && d.folder && !folderSet.has(d.folder) && folder !== 'All Documents') return false;
      if (q && !`${d.title} ${d.employee_name || ''} ${d.employee || ''} ${d.folder || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, tab, folder, folders, query, dept, type, status]);

  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const slice = rows.slice((page - 1) * perPage, page * perPage);
  const templates = (board?.templates || []).slice(0, 9);

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

  async function onView(d: PeopleDocument) {
    if (!preview) {
      try {
        await api.updatePeopleDocument(d.id, { touch: 1 });
      } catch {
        /* ignore */
      }
    }
    if (d.file_url) window.open(assetUrl(d.file_url), '_blank', 'noopener');
  }

  function onDownload(d: PeopleDocument) {
    if (!d.file_url) return;
    const a = document.createElement('a');
    a.href = assetUrl(d.file_url);
    a.download = d.title;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }

  function toggleFolder(title: string) {
    setOpenFolders((cur) => {
      const next = new Set(cur);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  function goKpi(id: Tab | 'expired') {
    if (id === 'expired') {
      setTab('all');
      setStatus('Expired');
      return;
    }
    setStatus('');
    setTab(id);
  }

  return (
    <div className="hrms-list-page emp-page dep-page lv-page dc-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="file" size={28} />
          </span>
          <div>
            <h1>Documents</h1>
            <p>Central repository for employee documents, company policies and templates. Access, store and generate documents.</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <button className="emp-btn primary lg" type="button" onClick={() => setUploadOpen('single')}>
            <HrmsIcon name="download" size={17} />
            Upload Document
          </button>
          <button className="emp-btn outline lg dc-letter" type="button" onClick={() => setLetterOpen(true)}>
            <HrmsIcon name="file" size={17} />
            Generate Letter
          </button>
        </div>
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}
      {notice ? (
        <div className="dsg-selbar">
          <span className="emp-notice">{notice}</span>
        </div>
      ) : null}

      <div className="att-kpis dc-kpis">
        {kpis.map((kp) => (
          <button
            key={kp.label}
            type="button"
            className={`emp-card att-kpi dc-kpi-btn${tab === kp.id || (kp.id === 'expired' && status === 'Expired') ? ' on' : ''}`}
            onClick={() => goKpi(kp.id)}
          >
            <span className={`dep-kpi-icon ${kp.tone}`}>
              <HrmsIcon name={kp.icon} size={22} />
            </span>
            <div>
              <b>{kp.label}</b>
              <strong>{loading && !board ? '…' : kp.value.toLocaleString()}</strong>
              <small className={kp.up ? 'up' : kp.down ? 'down' : ''}>
                {kp.up ? '↑ ' : kp.down ? '↓ ' : ''}
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

        <div className="dc-body">
          <aside className="dc-folders">
            <header>
              Folders
              <button type="button" className="dc-add-folder" aria-label="Add folder" onClick={() => setFolderOpen(true)}>
                <HrmsIcon name="plus" size={14} />
              </button>
            </header>
            <ul className="dc-tree">
              {allNode ? (
                <li>
                  <button type="button" className={folder === 'All Documents' ? 'on' : ''} onClick={() => setFolder('All Documents')}>
                    <HrmsIcon name="folder" size={15} />
                    All Documents
                    <span className="dc-count">{allNode.count.toLocaleString()}</span>
                  </button>
                </li>
              ) : null}
              {roots.map((root) => {
                const kids = folders.filter((f) => f.parent === root.title);
                const expanded = openFolders.has(root.title);
                return (
                  <li key={root.id}>
                    <button type="button" className={folder === root.title ? 'on' : ''} onClick={() => setFolder(root.title)}>
                      <HrmsIcon
                        name="chevronDown"
                        size={14}
                        className={`dc-chev${kids.length ? '' : ' empty'}`}
                        style={{ transform: expanded ? undefined : 'rotate(-90deg)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (kids.length) toggleFolder(root.title);
                        }}
                      />
                      {root.title}
                      <span className="dc-count">{root.count.toLocaleString()}</span>
                    </button>
                    {expanded
                      ? kids.map((kid) => (
                          <div key={kid.id} className="child">
                            <button type="button" className={folder === kid.title ? 'on' : ''} onClick={() => setFolder(kid.title)}>
                              {kid.title}
                              <span className="dc-count">{kid.count.toLocaleString()}</span>
                            </button>
                          </div>
                        ))
                      : null}
                  </li>
                );
              })}
            </ul>
          </aside>

          <div className="dc-table-col">
            <div className="att-filters dc-filters">
              <label className="emp-search att-search">
                <HrmsIcon name="search" size={16} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents by name, keyword, employee…" />
              </label>
              <FilterDropdown value={dept} allLabel="All Departments" options={board?.departments || []} onChange={setDept} label="Department" />
              <FilterDropdown value={type} allLabel="All Document Types" options={['PDF', 'DOC', 'Video', 'Image', 'Other']} onChange={setType} label="Type" />
              <FilterDropdown
                value={status}
                allLabel="All Status"
                options={['Active', 'Expiring Soon', 'Expired', 'Deleted']}
                onChange={setStatus}
                label="Status"
              />
              <button
                type="button"
                className="emp-btn"
                disabled={!dept && !type && !status && !query && folder === 'All Documents'}
                onClick={() => {
                  setDept('');
                  setType('');
                  setStatus('');
                  setQuery('');
                  setFolder('All Documents');
                }}
              >
                <HrmsIcon name="reset" size={16} /> Reset
              </button>
            </div>
            <div className="emp-table-wrap">
              <table className="emp-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Document Name</th>
                    <th>Type</th>
                    <th>Applicable To</th>
                    <th>Department</th>
                    <th>Upload Date</th>
                    <th>Expiry Date</th>
                    <th>Status</th>
                    <th className="emp-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !board ? (
                    <tr>
                      <td className="emp-empty" colSpan={9}>
                        Loading documents…
                      </td>
                    </tr>
                  ) : slice.length === 0 ? (
                    <tr>
                      <td className="emp-empty" colSpan={9}>
                        No documents in this view.
                      </td>
                    </tr>
                  ) : (
                    slice.map((d, i) => (
                      <tr key={d.id}>
                        <td>{(page - 1) * perPage + i + 1}</td>
                        <td>
                          <div className="dc-doc">
                            <span className={`dc-type ${TYPE_CLASS[d.file_type] || 'other'}`}>
                              <HrmsIcon name={typeIcon(d.file_type)} size={15} />
                            </span>
                            <div>
                              <b title={d.title}>{d.title}</b>
                              <small>{docSub(d)}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`emp-pill ${TYPE_TONE[d.file_type] || 'grey'}`}>{d.file_type}</span>
                        </td>
                        <td>{d.applicable_label || d.applicable || '—'}</td>
                        <td>{d.department || '—'}</td>
                        <td>{fmtDate(d.uploaded_on)}</td>
                        <td>{fmtDate(d.expiry_date)}</td>
                        <td>
                          <span className={`emp-pill ${ST_TONE[d.status] || 'grey'}`}>{d.status}</span>
                        </td>
                        <td className="emp-col-actions">
                          <div className="emp-actions">
                            <button type="button" aria-label="View" onClick={() => void onView(d)}>
                              <HrmsIcon name="eye" size={15} />
                            </button>
                            <button type="button" aria-label="Download" disabled={!d.file_url} onClick={() => onDownload(d)}>
                              <HrmsIcon name="download" size={15} />
                            </button>
                            {d.status === 'Deleted' ? (
                              <button
                                type="button"
                                aria-label="Restore"
                                onClick={() => void run(() => api.updatePeopleDocument(d.id, { status: 'Active' }), 'Document restored')}
                              >
                                <HrmsIcon name="undo" size={15} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                aria-label="Delete"
                                onClick={() => void run(() => api.updatePeopleDocument(d.id, { status: 'Deleted' }), 'Moved to deleted')}
                              >
                                <HrmsIcon name="x" size={15} />
                              </button>
                            )}
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
              summary={`Showing ${rows.length ? (page - 1) * perPage + 1 : 0} to ${Math.min(page * perPage, rows.length)} of ${rows.length} documents`}
            />
          </div>

          <aside className="dc-side">
            <div>
              <header>
                Document Templates
                <button type="button" className="dc-link" onClick={() => setTab('templates')}>
                  View All
                </button>
              </header>
              <ul className="dc-templates">
                {templates.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setLetterOpen(true)}>
                      {t.title}
                      <HrmsIcon name="chevronRight" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="emp-btn outline dc-new-tpl" onClick={() => setTplOpen(true)}>
                + Create New Template
              </button>
            </div>
            <div>
              <header>Quick Actions</header>
              <ul className="dc-quick">
                <li>
                  <button type="button" onClick={() => setUploadOpen('single')}>
                    <span className="dc-qa teal">
                      <HrmsIcon name="download" size={15} />
                    </span>
                    Upload Document
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setLetterOpen(true)}>
                    <span className="dc-qa green">
                      <HrmsIcon name="file" size={15} />
                    </span>
                    Generate Letter
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setUploadOpen('bulk')}>
                    <span className="dc-qa amber">
                      <HrmsIcon name="box" size={15} />
                    </span>
                    Bulk Upload
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setFolderOpen(true)}>
                    <span className="dc-qa blue">
                      <HrmsIcon name="folder" size={15} />
                    </span>
                    Manage Folders
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setLogOpen(true)}>
                    <span className="dc-qa rose">
                      <HrmsIcon name="clipboard" size={15} />
                    </span>
                    Document Access Log
                  </button>
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </section>

      <div className="dc-bottom">
        <section className="emp-card dc-panel">
          <header>
            Recently Accessed Documents
            <button type="button" className="dc-link" onClick={() => setLogOpen(true)}>
              View All
            </button>
          </header>
          <ul className="dc-recent">
            {(board?.recent || []).slice(0, 4).map((d) => (
              <li key={d.id}>
                <span className={`dc-type ${TYPE_CLASS[d.file_type] || 'other'}`}>
                  <HrmsIcon name={typeIcon(d.file_type)} size={15} />
                </span>
                <div className="dc-meta">
                  <b>{d.title}</b>
                  <small>
                    by {d.uploaded_by || 'HR Manager'} · {relTime(d.last_accessed || d.modified || d.uploaded_on)}
                  </small>
                </div>
                <div className="emp-actions">
                  <button type="button" aria-label="Download" disabled={!d.file_url} onClick={() => onDownload(d)}>
                    <HrmsIcon name="download" size={15} />
                  </button>
                </div>
              </li>
            ))}
            {!board?.recent?.length ? <li className="lv-muted">No recent files yet.</li> : null}
          </ul>
        </section>

        <section className="emp-card dc-panel">
          <header>
            Document Requests
            <button
              type="button"
              className="dc-link"
              onClick={() =>
                downloadCsv(
                  'document-requests.csv',
                  ['Employee', 'Document', 'Date', 'Status'],
                  (board?.requests || []).map((r) => [r.employee_name, r.title, r.request_date, r.status]),
                )
              }
            >
              View All
            </button>
          </header>
          <ul className="dc-reqs">
            {(board?.requests || []).slice(0, 4).map((r) => (
              <li key={r.id}>
                <Avatar id={r.employee} name={r.employee_name || r.employee} photo={r.photo} />
                <div className="dc-meta">
                  <b>{r.employee_name || r.employee}</b>
                  <small>{r.employee_id || r.employee}</small>
                </div>
                <span className="dc-req-type">{r.title}</span>
                <span className="dc-req-date">{fmtDate(r.request_date)}</span>
                <span className={`emp-pill ${REQ_TONE[r.status] || 'grey'}`}>{r.status}</span>
                <div className="emp-actions">
                  <button type="button" aria-label="View request">
                    <HrmsIcon name="eye" size={15} />
                  </button>
                  {r.status === 'Pending' ? (
                    <>
                      <button
                        type="button"
                        aria-label="Approve"
                        onClick={() => void run(() => api.updatePeopleDocumentRequest(r.id, 'Approved'), 'Request approved')}
                      >
                        <HrmsIcon name="check" size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label="Reject"
                        onClick={() => void run(() => api.updatePeopleDocumentRequest(r.id, 'Rejected'), 'Request rejected')}
                      >
                        <HrmsIcon name="x" size={15} />
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
            {!board?.requests?.length ? <li className="lv-muted">No document requests.</li> : null}
          </ul>
        </section>
      </div>

      {uploadOpen ? (
        <UploadModal
          mode={uploadOpen}
          folders={folders}
          departments={board?.departments || []}
          employees={board?.employees || []}
          busy={busy}
          onClose={() => setUploadOpen(null)}
          onSave={async (meta, files) => {
            await run(async () => {
              for (const file of files) {
                const data = await readFile(file);
                await api.savePeopleDocument({ ...meta, title: meta.title || file.name }, { file_name: file.name, file_data: data });
              }
            }, files.length > 1 ? 'Files uploaded' : 'Document uploaded');
            setUploadOpen(null);
          }}
        />
      ) : null}

      {letterOpen ? (
        <LetterModal
          templates={board?.templates || []}
          employees={board?.employees || []}
          busy={busy}
          onClose={() => setLetterOpen(false)}
          onSave={async (template, employee) => {
            await run(() => api.generatePeopleLetter(template, employee), 'Letter generated');
            setLetterOpen(false);
          }}
        />
      ) : null}

      {folderOpen ? (
        <FolderModal
          folders={folders}
          busy={busy}
          onClose={() => setFolderOpen(false)}
          onSave={async (data) => {
            await run(() => api.savePeopleDocumentFolder(data), 'Folder created');
            setFolderOpen(false);
          }}
        />
      ) : null}

      {tplOpen ? (
        <TemplateModal
          busy={busy}
          onClose={() => setTplOpen(false)}
          onSave={async (title) => {
            await run(() => api.savePeopleDocument({ title, is_template: 1, scope: 'Template', folder: 'Forms & Templates', file_type: 'DOC' }), 'Template created');
            setTplOpen(false);
          }}
        />
      ) : null}

      {logOpen ? (
        <div className="lv-modal-backdrop" onMouseDown={() => setLogOpen(false)}>
          <div className="lv-modal" onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <h2>Document access log</h2>
              <button type="button" className="emp-btn" onClick={() => setLogOpen(false)} aria-label="Close">
                <HrmsIcon name="x" size={16} />
              </button>
            </header>
            <ul className="dc-log">
              {(board?.access_log || []).map((row) => (
                <li key={`${row.id}-${row.accessed_on}`}>
                  <span>
                    <b>{row.title}</b>
                    <small>
                      {' '}
                      · {row.actor} · {relTime(row.accessed_on)}
                    </small>
                  </span>
                </li>
              ))}
              {!board?.access_log?.length ? <li>No access events yet.</li> : null}
            </ul>
            <footer>
              <button type="button" className="emp-btn primary" onClick={() => setLogOpen(false)}>
                Close
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UploadModal({
  mode,
  folders,
  departments,
  employees,
  busy,
  onClose,
  onSave,
}: {
  mode: 'single' | 'bulk';
  folders: PeopleDocumentFolder[];
  departments: string[];
  employees: PeopleDocumentsBoard['employees'];
  busy: boolean;
  onClose: () => void;
  onSave: (meta: Partial<PeopleDocument> & { title?: string }, files: File[]) => void;
}) {
  const kids = folders.filter((f) => f.id !== 'all');
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('Personal');
  const [employee, setEmployee] = useState('');
  const [department, setDepartment] = useState('');
  const [expiry, setExpiry] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <form
        className="lv-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!files.length) return;
          onSave({ title, folder, employee: employee || undefined, department: department || undefined, expiry_date: expiry || null, scope: 'Employee' }, files);
        }}
      >
        <header>
          <h2>{mode === 'bulk' ? 'Bulk upload' : 'Upload document'}</h2>
          <button type="button" className="emp-btn" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <div className="dc-form-grid">
          <label className="span-2">
            Files *
            <input
              type="file"
              multiple={mode === 'bulk'}
              required
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
          {mode === 'single' ? (
            <label className="span-2">
              Document name
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Leave blank to use the file name" />
            </label>
          ) : null}
          <label>
            Folder
            <select value={folder} onChange={(e) => setFolder(e.target.value)}>
              {kids.map((f) => (
                <option key={f.id}>{f.title}</option>
              ))}
            </select>
          </label>
          <label>
            Employee
            <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.id})
                </option>
              ))}
            </select>
          </label>
          <label>
            Department
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Expiry date
            <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </label>
        </div>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy || !files.length}>
            Upload
          </button>
        </footer>
      </form>
    </div>
  );
}

function LetterModal({
  templates,
  employees,
  busy,
  onClose,
  onSave,
}: {
  templates: PeopleDocument[];
  employees: PeopleDocumentsBoard['employees'];
  busy: boolean;
  onClose: () => void;
  onSave: (template: string, employee: string) => void;
}) {
  const [template, setTemplate] = useState(templates[0]?.id || templates[0]?.title || '');
  const [employee, setEmployee] = useState(employees[0]?.id || '');
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <form
        className="lv-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(template, employee);
        }}
      >
        <header>
          <h2>Generate letter</h2>
          <button type="button" className="emp-btn" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <div className="dc-form-grid">
          <label className="span-2">
            Template *
            <select required value={template} onChange={(e) => setTemplate(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            Employee *
            <select required value={employee} onChange={(e) => setEmployee(e.target.value)}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.id})
                </option>
              ))}
            </select>
          </label>
        </div>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy || !template || !employee}>
            Generate
          </button>
        </footer>
      </form>
    </div>
  );
}

function FolderModal({
  folders,
  busy,
  onClose,
  onSave,
}: {
  folders: PeopleDocumentFolder[];
  busy: boolean;
  onClose: () => void;
  onSave: (data: { title: string; parent?: string; scope?: string }) => void;
}) {
  const parents = folders.filter((f) => !f.parent && f.id !== 'all');
  const [title, setTitle] = useState('');
  const [parent, setParent] = useState('Employee Documents');
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <form
        className="lv-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ title, parent, scope: parent === 'Company Documents' ? 'company' : 'employee' });
        }}
      >
        <header>
          <h2>New folder</h2>
          <button type="button" className="emp-btn" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <div className="dc-form-grid">
          <label className="span-2">
            Folder name *
            <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Medical records" />
          </label>
          <label className="span-2">
            Parent
            <select value={parent} onChange={(e) => setParent(e.target.value)}>
              {parents.map((f) => (
                <option key={f.id}>{f.title}</option>
              ))}
            </select>
          </label>
        </div>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy || !title.trim()}>
            Create
          </button>
        </footer>
      </form>
    </div>
  );
}

function TemplateModal({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (title: string) => void }) {
  const [title, setTitle] = useState('');
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <form
        className="lv-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(title.trim());
        }}
      >
        <header>
          <h2>Create template</h2>
          <button type="button" className="emp-btn" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <div className="dc-form-grid">
          <label className="span-2">
            Template name *
            <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Custom Templates" />
          </label>
        </div>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy || !title.trim()}>
            Create
          </button>
        </footer>
      </form>
    </div>
  );
}
