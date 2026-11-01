import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type PeoplePoliciesBoard,
  type PeoplePolicy,
  type PeoplePolicyStatus,
} from '../../api';
import { assetUrl } from '../../config';
import { HrmsIcon } from '../../components/HrmsIcons';
import { downloadCsv, FilterDropdown, Pager, PER_PAGE_OPTIONS } from './peopleTableKit';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-attendance.css';
import './people-leave.css';
import './people-policies.css';

type DetailTab = 'details' | 'attachments' | 'history';

const CAT_TONE: Record<string, string> = {
  'Code of Conduct': 'red',
  'Leave & Attendance': 'blue',
  'Payroll & Benefits': 'violet',
  'Human Resources': 'orange',
  'IT & Security': 'cyan',
  'Health & Safety': 'green',
  Performance: 'amber',
  General: 'grey',
};
const ST_TONE: Record<string, string> = { Published: 'green', Draft: 'amber', Archived: 'grey' };

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
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
function policySub(p: PeoplePolicy) {
  const m = p.title.match(/\(([^)]+)\)/);
  return m ? m[1] : p.slug || '';
}
function catTone(cat: string) {
  return CAT_TONE[cat] || 'grey';
}
function downloadText(title: string, body: string, fileUrl?: string | null) {
  if (fileUrl) {
    const a = document.createElement('a');
    a.href = assetUrl(fileUrl);
    a.download = title;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
    return;
  }
  const url = URL.createObjectURL(new Blob([body || title], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^\w.-]+/g, '_')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function PeoplePoliciesPage({ preview }: { preview?: PeoplePoliciesBoard }) {
  const [board, setBoard] = useState<PeoplePoliciesBoard | null>(preview || null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [catQuery, setCatQuery] = useState('');
  const [category, setCategory] = useState('All Policies');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hideDetail, setHideDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('details');
  const [formOpen, setFormOpen] = useState<Partial<PeoplePolicy> & { title: string } | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [adminOn, setAdminOn] = useState(false);

  const load = useCallback(async () => {
    if (preview) {
      setBoard(preview);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.getPeoplePolicies();
      setBoard(res.data);
    } catch (e) {
      setError(errMsg(e, 'Unable to load policies'));
    } finally {
      setLoading(false);
    }
  }, [preview]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [query, category, status, perPage]);

  const manager = Boolean(board?.is_manager);
  const k = board?.kpis;
  const kpis: Array<{
    id: string;
    label: string;
    value: number;
    icon: 'file' | 'checkCircle' | 'clock' | 'calendar';
    tone: string;
  }> = [
    { id: '', label: 'Total Policies', value: k?.total ?? 0, icon: 'file', tone: 'blue' },
    { id: 'Published', label: 'Published', value: k?.published ?? 0, icon: 'checkCircle', tone: 'green' },
    { id: 'Draft', label: 'Draft', value: k?.draft ?? 0, icon: 'clock', tone: 'amber' },
    { id: 'Archived', label: 'Archived', value: k?.archived ?? 0, icon: 'calendar', tone: 'rose' },
  ];

  const cats = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    return (board?.categories || []).filter((c) => !q || c.title.toLowerCase().includes(q));
  }, [board, catQuery]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.policies || []).filter((p) => {
      if (category && category !== 'All Policies' && p.category !== category) return false;
      if (status && p.status !== status) return false;
      if (q && !`${p.title} ${p.category} ${p.slug || ''} ${p.description || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, category, status, query]);

  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const slice = rows.slice((page - 1) * perPage, page * perPage);
  const selected = (board?.policies || []).find((p) => p.id === selectedId) || slice[0] || null;

  useEffect(() => {
    if (selectedId) return;
    const wanted = new URLSearchParams(window.location.search).get('policy');
    const match = (board?.policies || []).find((p) => p.slug === wanted || p.id === wanted);
    if (match) setSelectedId(match.id);
  }, [board, selectedId]);

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

  async function selectPolicy(p: PeoplePolicy) {
    setSelectedId(p.id);
    setHideDetail(false);
    setDetailTab('details');
    if (preview) return;
    try {
      await api.updatePeoplePolicy(p.id, { touch: 1 });
    } catch {
      /* ignore */
    }
  }

  async function sharePolicy(p: PeoplePolicy) {
    const url = `${window.location.origin}/people/policies?policy=${encodeURIComponent(p.slug || p.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Policy link copied');
    } catch {
      setError('Unable to copy link');
    }
  }

  return (
    <div className="hrms-list-page emp-page dep-page lv-page pol-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="book" size={28} />
          </span>
          <div>
            <h1>HR Policies</h1>
            <p>Access company policies, guidelines and templates. Stay informed and compliant.</p>
          </div>
        </div>
        {manager ? (
          <div className="dep-head-actions">
            <button className={`emp-btn outline lg${adminOn ? ' on' : ''}`} type="button" onClick={() => setAdminOn((v) => !v)}>
              <HrmsIcon name="settings" size={17} />
              Manage Policies (Admin)
            </button>
            <button
              className="emp-btn primary lg"
              type="button"
              onClick={() => setFormOpen({ title: '', category: 'General', version: 'v1.0', status: 'Draft', body: '', applicable: ['All Employees'] })}
            >
              <HrmsIcon name="plus" size={17} />
              Add New Policy
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

      <div className="att-kpis pol-kpis">
        {kpis.map((kp) => (
          <button
            key={kp.label}
            type="button"
            className={`emp-card att-kpi pol-kpi-btn${status === kp.id ? ' on' : ''}`}
            onClick={() => setStatus(kp.id)}
          >
            <span className={`dep-kpi-icon ${kp.tone}`}>
              <HrmsIcon name={kp.icon} size={22} />
            </span>
            <div>
              <b>{kp.label}</b>
              <strong>{loading && !board ? '…' : kp.value}</strong>
            </div>
          </button>
        ))}
      </div>

      <section className="emp-card att-main">
        <div className="pol-body">
          <aside className="pol-cats">
            <header>
              Categories
              {manager ? (
                <button type="button" className="pol-add" aria-label="Add category" onClick={() => setCatOpen(true)}>
                  <HrmsIcon name="plus" size={14} />
                </button>
              ) : null}
            </header>
            <label className="pol-cat-search">
              <HrmsIcon name="search" size={14} />
              <input value={catQuery} onChange={(e) => setCatQuery(e.target.value)} placeholder="Search categories…" />
            </label>
            <ul className="pol-tree">
              {cats.map((c) => (
                <li key={c.id}>
                  <button type="button" className={category === c.title ? 'on' : ''} onClick={() => setCategory(c.title)}>
                    {c.title}
                    <span className="pol-count">{c.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="pol-table-col">
            <div className="att-filters pol-filters">
              <label className="emp-search att-search">
                <HrmsIcon name="search" size={16} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search policies by title, keyword…" />
              </label>
              <FilterDropdown
                value={category === 'All Policies' ? '' : category}
                allLabel="All Categories"
                options={(board?.categories || []).filter((c) => c.id !== 'all').map((c) => c.title)}
                onChange={(v) => setCategory(v || 'All Policies')}
                label="Category"
              />
              <FilterDropdown value={status} allLabel="All Status" options={['Published', 'Draft', 'Archived']} onChange={setStatus} label="Status" />
              <button
                type="button"
                className="emp-btn"
                disabled={!query && category === 'All Policies' && !status}
                onClick={() => {
                  setQuery('');
                  setCategory('All Policies');
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
                    <th>#</th>
                    <th>Policy Title</th>
                    <th>Category</th>
                    <th>Version</th>
                    <th>Last Updated</th>
                    <th>Status</th>
                    <th className="emp-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !board ? (
                    <tr>
                      <td className="emp-empty" colSpan={7}>
                        Loading policies…
                      </td>
                    </tr>
                  ) : slice.length === 0 ? (
                    <tr>
                      <td className="emp-empty" colSpan={7}>
                        No policies in this view.
                      </td>
                    </tr>
                  ) : (
                    slice.map((p, i) => (
                      <tr key={p.id} className={selected?.id === p.id ? 'selected' : ''} onClick={() => void selectPolicy(p)}>
                        <td>{(page - 1) * perPage + i + 1}</td>
                        <td>
                          <div className="pol-doc">
                            <span className={`pol-type ${catTone(p.category)}`}>
                              <HrmsIcon name="file" size={15} />
                            </span>
                            <div>
                              <b title={p.title}>{p.title}</b>
                              {policySub(p) ? <small>{policySub(p)}</small> : null}
                            </div>
                          </div>
                        </td>
                        <td>{p.category}</td>
                        <td>{p.version}</td>
                        <td>{fmtDate(p.updated_on)}</td>
                        <td>
                          <span className={`emp-pill ${ST_TONE[p.status] || 'grey'}`}>{p.status}</span>
                        </td>
                        <td className="emp-col-actions" onClick={(e) => e.stopPropagation()}>
                          <div className="emp-actions">
                            <button type="button" aria-label="View" onClick={() => void selectPolicy(p)}>
                              <HrmsIcon name="eye" size={15} />
                            </button>
                            <button type="button" aria-label="Download" onClick={() => downloadText(p.title, p.body || '', p.file_url)}>
                              <HrmsIcon name="download" size={15} />
                            </button>
                            {adminOn && manager ? (
                              <button type="button" aria-label="Edit" onClick={() => setFormOpen({ ...p, title: p.title })}>
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
              summary={`Showing ${rows.length ? (page - 1) * perPage + 1 : 0} to ${Math.min(page * perPage, rows.length)} of ${rows.length} policies`}
            />
          </div>

          <aside className="pol-detail">
            {selected && !hideDetail ? (
              <>
                <header className="pol-detail-head">
                  <h2>{selected.title}</h2>
                  <button type="button" className="emp-btn icon" aria-label="Close" onClick={() => setHideDetail(true)}>
                    <HrmsIcon name="x" size={16} />
                  </button>
                </header>
                <nav className="pol-detail-tabs">
                  {(['details', 'attachments', 'history'] as DetailTab[]).map((t) => (
                    <button key={t} type="button" className={detailTab === t ? 'on' : ''} onClick={() => setDetailTab(t)}>
                      {t === 'details' ? 'Details' : t === 'attachments' ? 'Attachments' : 'Version History'}
                    </button>
                  ))}
                </nav>
                {detailTab === 'details' ? (
                  <>
                    <div className="pol-ver">
                      <span className="emp-pill red">{selected.version} (Current)</span>
                      <small>
                        Last updated: {fmtDate(selected.updated_on)} by {selected.updated_by || 'HR Manager'}
                      </small>
                    </div>
                    <div className="pol-block">
                      <b>Description</b>
                      <p>{selected.description || 'No summary yet.'}</p>
                    </div>
                    {selected.key_points.length ? (
                      <div className="pol-block">
                        <b>Key Points</b>
                        <ul>
                          {selected.key_points.map((pt) => (
                            <li key={pt}>{pt}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {selected.applicable.length ? (
                      <div className="pol-block">
                        <b>Applicable To</b>
                        <div className="pol-pills">
                          {selected.applicable.map((a) => (
                            <span key={a}>{a}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="pol-block">
                      <b>Related Documents</b>
                      {selected.related_docs.length ? (
                        <ul className="pol-related">
                          {selected.related_docs.map((d) => (
                            <li key={d.title}>
                              <span className={`pol-type ${d.file_type === 'DOC' ? 'violet' : 'red'}`}>
                                <HrmsIcon name="file" size={14} />
                              </span>
                              {d.title}
                              <button type="button" aria-label="Download" onClick={() => downloadText(d.title, '', d.file_url)}>
                                <HrmsIcon name="download" size={14} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No related files.</p>
                      )}
                    </div>
                    <div className="pol-detail-actions">
                      <button type="button" className="emp-btn primary" onClick={() => downloadText(selected.title, selected.body || '', selected.file_url)}>
                        <HrmsIcon name="download" size={15} /> Download Policy
                      </button>
                      <button type="button" className="emp-btn outline" onClick={() => void sharePolicy(selected)}>
                        <HrmsIcon name="share" size={15} /> Share
                      </button>
                    </div>
                  </>
                ) : null}
                {detailTab === 'attachments' ? (
                  <div className="pol-block">
                    {selected.file_url ? (
                      <ul className="pol-related">
                        <li>
                          <span className="pol-type red">
                            <HrmsIcon name="file" size={14} />
                          </span>
                          {selected.title}.pdf
                          <button type="button" aria-label="Download" onClick={() => downloadText(selected.title, selected.body || '', selected.file_url)}>
                            <HrmsIcon name="download" size={14} />
                          </button>
                        </li>
                      </ul>
                    ) : (
                      <p>No file attached. Download uses the policy text.</p>
                    )}
                  </div>
                ) : null}
                {detailTab === 'history' ? (
                  <ul className="pol-hist">
                    {(selected.versions.length ? selected.versions : [{ version: selected.version, updated_on: selected.updated_on, updated_by: selected.updated_by, current: 1 }]).map((v, i) => (
                      <li key={`${v.version}-${i}`}>
                        <span>
                          <b>{v.version}</b>
                          {v.current ? ' · Current' : ''}
                        </span>
                        <small>
                          {fmtDate(v.updated_on)} · {v.updated_by || 'HR Manager'}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="pol-empty-detail">Select a policy to read the details.</p>
            )}
          </aside>
        </div>
      </section>

      <div className="pol-bottom">
        <section className="emp-card pol-panel">
          <header>
            Recently Updated Policies
            <button
              type="button"
              className="pol-link"
              onClick={() =>
                downloadCsv(
                  'recent-policies.csv',
                  ['Title', 'Updated', 'By'],
                  (board?.recent || []).map((p) => [p.title, p.updated_on, p.updated_by]),
                )
              }
            >
              View All
            </button>
          </header>
          <ul className="pol-list">
            {(board?.recent || []).slice(0, 3).map((p) => (
              <li key={p.id}>
                <span className={`pol-type ${catTone(p.category)}`}>
                  <HrmsIcon name="file" size={15} />
                </span>
                <div className="pol-meta">
                  <b>{p.title}</b>
                  <small>
                    Updated by {p.updated_by || 'HR Manager'} · {relTime(p.updated_on)}
                  </small>
                </div>
                <div className="emp-actions">
                  <button type="button" aria-label="Download" onClick={() => downloadText(p.title, p.body || '', p.file_url)}>
                    <HrmsIcon name="download" size={15} />
                  </button>
                </div>
              </li>
            ))}
            {!board?.recent?.length ? <li className="lv-muted">No recent updates.</li> : null}
          </ul>
        </section>
        <section className="emp-card pol-panel">
          <header>
            Popular Policies
            <button type="button" className="pol-link" onClick={() => setStatus('')}>
              View All
            </button>
          </header>
          <ul className="pol-list">
            {(board?.popular || []).slice(0, 4).map((p) => (
              <li key={p.id}>
                <span className={`pol-type ${catTone(p.category)}`}>
                  <HrmsIcon name="file" size={15} />
                </span>
                <div className="pol-meta">
                  <b>{p.title}</b>
                  <small>{(p.views || 0).toLocaleString()} views</small>
                </div>
                <div className="emp-actions">
                  <button type="button" aria-label="Download" onClick={() => downloadText(p.title, p.body || '', p.file_url)}>
                    <HrmsIcon name="download" size={15} />
                  </button>
                </div>
              </li>
            ))}
            {!board?.popular?.length ? <li className="lv-muted">No published policies yet.</li> : null}
          </ul>
        </section>
      </div>

      {formOpen ? (
        <PolicyModal
          form={formOpen}
          categories={(board?.categories || []).filter((c) => c.id !== 'all').map((c) => c.title)}
          busy={busy}
          onClose={() => setFormOpen(null)}
          onSave={async (data) => {
            await run(() => api.savePeoplePolicy(data), data.id ? 'Policy updated' : 'Policy created');
            setFormOpen(null);
          }}
        />
      ) : null}

      {catOpen ? (
        <CategoryModal
          busy={busy}
          onClose={() => setCatOpen(false)}
          onSave={async (title) => {
            await run(() => api.savePeoplePolicyCategory({ title }), 'Category created');
            setCatOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function PolicyModal({
  form,
  categories,
  busy,
  onClose,
  onSave,
}: {
  form: Partial<PeoplePolicy> & { title: string };
  categories: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (data: Partial<PeoplePolicy> & { title: string }) => void;
}) {
  const [f, setF] = useState({
    ...form,
    category: form.category || 'General',
    version: form.version || 'v1.0',
    status: (form.status as PeoplePolicyStatus) || 'Draft',
    body: form.body || '',
    applicable: (form.applicable || ['All Employees']).join(', '),
  });
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <form
        className="lv-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            ...form,
            title: f.title,
            category: f.category,
            version: f.version,
            status: f.status,
            body: f.body,
            applicable: f.applicable.split(',').map((x) => x.trim()).filter(Boolean),
          });
        }}
      >
        <header>
          <h2>{form.id ? 'Edit policy' : 'Add new policy'}</h2>
          <button type="button" className="emp-btn" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <div className="pol-form-grid">
          <label className="span-2">
            Title *
            <input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </label>
          <label>
            Category
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Version
            <input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} />
          </label>
          <label>
            Status
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as PeoplePolicyStatus })}>
              <option>Published</option>
              <option>Draft</option>
              <option>Archived</option>
            </select>
          </label>
          <label>
            Applicable to
            <input value={f.applicable} onChange={(e) => setF({ ...f, applicable: e.target.value })} placeholder="All Employees, Field Staff" />
          </label>
          <label className="span-2">
            Body
            <textarea rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
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

function CategoryModal({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (title: string) => void }) {
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
          <h2>New category</h2>
          <button type="button" className="emp-btn" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <div className="pol-form-grid">
          <label className="span-2">
            Category name *
            <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Wellness" />
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
