import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type PeopleAsset,
  type PeopleAssetActivity,
  type PeopleAssetRequest,
  type PeopleAssetsBoard,
  type PeopleAssetStatus,
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
import './people-assets.css';

type Tab = 'all' | 'assigned' | 'available' | 'repair' | 'retired' | 'requests' | 'audit';
type AssetAction = 'assign' | 'collect' | 'transfer' | 'repair' | 'retire' | 'audit';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'all', label: 'All Assets' },
  { id: 'assigned', label: 'Assigned Assets' },
  { id: 'available', label: 'Available Assets' },
  { id: 'repair', label: 'In Repair' },
  { id: 'retired', label: 'Retired' },
  { id: 'requests', label: 'Asset Requests' },
  { id: 'audit', label: 'Audit Log' },
];

const ST_TONE: Record<string, string> = {
  Assigned: 'green',
  Available: 'cyan',
  'In Repair': 'orange',
  Retired: 'grey',
  Pending: 'orange',
  Approved: 'green',
  Rejected: 'rose',
};

const CAT_TONE: Record<string, string> = {
  Laptop: 'blue',
  Mobile: 'violet',
  Monitor: 'cyan',
  Accessory: 'orange',
  'Office Equipment': 'green',
  Vehicle: 'amber',
  Furniture: 'rose',
  Other: 'grey',
};

const CAT_ICON: Record<string, string> = {
  Laptop: 'laptop',
  Mobile: 'smartphone',
  Monitor: 'monitor',
  Accessory: 'mouse',
  'Office Equipment': 'printer',
  Vehicle: 'car',
  Furniture: 'chair',
  Other: 'box',
};

const DEPT_COLOR: Record<string, string> = {
  Sales: '#22d3ee',
  Marketing: '#fb923c',
  IT: '#34d399',
  HR: '#a78bfa',
  Accounts: '#fbbf24',
  Operations: '#f472b6',
  Others: '#94a3b8',
};

const KIND_TONE: Record<string, string> = {
  Assigned: 'green',
  Collected: 'teal',
  Repair: 'amber',
  Added: 'blue',
  Transfer: 'violet',
  Retired: 'grey',
  Audit: 'rose',
  Updated: 'grey',
};

const LOCATIONS = ['Head Office', 'Marketing', 'Sales', 'IT Store', 'Field - West', 'Operations', 'Accounts'];
const CATEGORIES = ['Laptop', 'Mobile', 'Monitor', 'Accessory', 'Office Equipment', 'Vehicle', 'Furniture', 'Other'];

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
function catIcon(c: string) {
  return CAT_ICON[c] || 'box';
}
function catTone(c: string) {
  return CAT_TONE[c] || 'grey';
}
function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [] as Array<Record<string, string>>;
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = cells[i] || '';
    });
    return row;
  });
}

export function PeopleAssetsPage({ preview }: { preview?: PeopleAssetsBoard }) {
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
        if (alive) setError(err instanceof Error && err.message ? err.message : 'Unable to load assets');
      }
    })();
    return () => {
      alive = false;
    };
  }, [preview]);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="lv-muted">Loading assets…</p>;
  return <AssetsDesk preview={preview} manager={Boolean(isManager)} />;
}

function AssetsDesk({ preview, manager }: { preview?: PeopleAssetsBoard; manager: boolean }) {
  const [board, setBoard] = useState<PeopleAssetsBoard | null>(preview || null);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[0]);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addMenu, setAddMenu] = useState(false);
  const [formOpen, setFormOpen] = useState<Partial<PeopleAsset> & { title: string } | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [viewAsset, setViewAsset] = useState<PeopleAsset | null>(null);
  const [actOpen, setActOpen] = useState<{ action: AssetAction; assets: PeopleAsset[] } | null>(null);

  const load = useCallback(async () => {
    if (preview) {
      setBoard(preview);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.getPeopleAssets();
      setBoard(res.data);
    } catch (e) {
      setError(errMsg(e, 'Unable to load assets'));
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
  }, [tab, query, category, location, status, perPage]);

  const k = board?.kpis;
  const total = k?.total || 0;
  const delta = k ? pctDelta(k.total || 0, k.prev_total || 0) : null;
  const share = (n: number) => `${total ? Math.round((n / total) * 100) : 0}% of total`;

  const kpis: Array<{ id: Tab; label: string; value: number; sub: string; up?: boolean; icon: string; tone: string }> = [
    {
      id: 'all',
      label: 'Total Assets',
      value: k?.total ?? 0,
      sub: delta == null ? 'vs last month' : `${Math.abs(delta)}% vs last month`,
      up: (delta || 0) > 0,
      icon: 'laptop',
      tone: 'blue',
    },
    { id: 'assigned', label: 'Assigned', value: k?.assigned ?? 0, sub: share(k?.assigned || 0), icon: 'user', tone: 'green' },
    { id: 'available', label: 'Available', value: k?.available ?? 0, sub: share(k?.available || 0), icon: 'box', tone: 'amber' },
    { id: 'repair', label: 'In Repair', value: k?.repair ?? 0, sub: share(k?.repair || 0), icon: 'wrench', tone: 'rose' },
    { id: 'retired', label: 'Retired', value: k?.retired ?? 0, sub: share(k?.retired || 0), icon: 'trash', tone: 'grey' },
  ];

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.assets || []).filter((a) => {
      if (tab === 'assigned' && a.status !== 'Assigned') return false;
      if (tab === 'available' && a.status !== 'Available') return false;
      if (tab === 'repair' && a.status !== 'In Repair') return false;
      if (tab === 'retired' && a.status !== 'Retired') return false;
      if (tab === 'requests' || tab === 'audit') return true;
      if (category && a.category !== category) return false;
      if (location && a.location !== location) return false;
      if (status && a.status !== status) return false;
      if (q && !`${a.title} ${a.serial} ${a.employee_name || ''} ${a.employee_id || ''} ${a.location}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, tab, query, category, location, status]);

  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const slice = rows.slice((page - 1) * perPage, page * perPage);
  const allOnPage = slice.length > 0 && slice.every((a) => selected.has(a.id));
  const selectedAssets = (board?.assets || []).filter((a) => selected.has(a.id));
  const cats = board?.categories?.length ? board.categories : CATEGORIES.map((title) => ({ id: title, title, count: 0 }));
  const locOpts = board?.locations?.length ? board.locations : LOCATIONS;
  const catOpts = cats.map((c) => c.title);

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

  function needAssets(action: AssetAction) {
    const list = selectedAssets.length ? selectedAssets : [];
    if (!list.length) {
      setNotice('Select one or more assets first');
      return;
    }
    setActOpen({ action, assets: list });
  }

  const deptRows = board?.by_department || [];
  const deptTotal = deptRows.reduce((s, d) => s + d.count, 0) || total;
  const donut = (() => {
    if (!deptRows.length) return '#e2e8f0 0% 100%';
    let acc = 0;
    const parts: string[] = [];
    deptRows.forEach((d) => {
      const pct = (d.count / deptTotal) * 100;
      const color = DEPT_COLOR[d.name] || '#94a3b8';
      parts.push(`${color} ${acc}% ${acc + pct}%`);
      acc += pct;
    });
    return parts.join(', ');
  })();

  const life = [
    { label: 'Assigned', value: k?.assigned || 0, tone: 'green' },
    { label: 'Available', value: k?.available || 0, tone: 'amber' },
    { label: 'In Repair', value: k?.repair || 0, tone: 'orange' },
    { label: 'Retired', value: k?.retired || 0, tone: 'grey' },
  ];

  return (
    <div className="hrms-list-page emp-page dep-page lv-page ast-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="laptop" size={28} />
          </span>
          <div>
            <h1>Assets Management</h1>
            <p>Manage company assets, assign to employees, track status and lifecycle.</p>
          </div>
        </div>
        {manager ? (
          <div className="dep-head-actions">
            <button className="emp-btn outline lg" type="button" onClick={() => setCatOpen(true)}>
              <HrmsIcon name="box" size={17} />
              Asset Categories
            </button>
            <div className="ast-split-wrap">
              <div className="ast-split">
                <button className="emp-btn primary lg" type="button" onClick={() => setFormOpen({ title: '', category: 'Laptop', status: 'Available', location: 'IT Store' })}>
                  <HrmsIcon name="plus" size={17} />
                  Add Asset
                </button>
                <button className="emp-btn primary lg ast-split-caret" type="button" aria-label="More add options" onClick={() => setAddMenu((v) => !v)}>
                  <HrmsIcon name="chevronDown" size={16} />
                </button>
              </div>
              {addMenu ? (
                <div className="ast-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setAddMenu(false);
                      setFormOpen({ title: '', category: 'Laptop', status: 'Available', location: 'IT Store' });
                    }}
                  >
                    Add single asset
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddMenu(false);
                      setBulkOpen(true);
                    }}
                  >
                    Import from CSV
                  </button>
                </div>
              ) : null}
            </div>
            <button className="emp-btn primary lg" type="button" onClick={() => setBulkOpen(true)}>
              Bulk Import
            </button>
          </div>
        ) : (
          <div className="dep-head-actions">
            <button className="emp-btn primary lg" type="button" onClick={() => setReqOpen(true)}>
              <HrmsIcon name="plus" size={17} />
              Request Asset
            </button>
          </div>
        )}
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}
      {notice ? (
        <div className="dsg-selbar">
          <span className="emp-notice">{notice}</span>
        </div>
      ) : null}

      <div className="att-kpis ast-kpis">
        {kpis.map((kp) => (
          <button
            key={kp.label}
            type="button"
            className={`emp-card att-kpi ast-kpi-btn${tab === kp.id ? ' on' : ''}`}
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

        <div className="ast-body">
          <div className="ast-table-col">
            {tab !== 'requests' && tab !== 'audit' ? (
              <>
                <div className="att-filters ast-filters">
                  <label className="emp-search att-search">
                    <HrmsIcon name="search" size={16} />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search asset by name, serial number, employee…" />
                  </label>
                  <FilterDropdown value={category} allLabel="All Categories" options={catOpts} onChange={setCategory} label="Category" />
                  <FilterDropdown value={location} allLabel="All Locations" options={locOpts} onChange={setLocation} label="Location" />
                  <FilterDropdown value={status} allLabel="All Status" options={['Assigned', 'Available', 'In Repair', 'Retired']} onChange={setStatus} label="Status" />
                  <button
                    type="button"
                    className="emp-btn"
                    disabled={!query && !category && !location && !status}
                    onClick={() => {
                      setQuery('');
                      setCategory('');
                      setLocation('');
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
                        <th>Asset Name</th>
                        <th>Category</th>
                        <th>Serial Number</th>
                        <th>Assigned To</th>
                        <th>Location</th>
                        <th>Assign Date</th>
                        <th>Status</th>
                        <th className="emp-col-actions">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && !board ? (
                        <tr>
                          <td className="emp-empty" colSpan={10}>
                            Loading assets…
                          </td>
                        </tr>
                      ) : slice.length === 0 ? (
                        <tr>
                          <td className="emp-empty" colSpan={10}>
                            No assets in this view.
                          </td>
                        </tr>
                      ) : (
                        slice.map((a, i) => (
                          <tr key={a.id} className={selected.has(a.id) ? 'selected' : ''}>
                            <td>
                              <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleRow(a.id)} aria-label={`Select ${a.title}`} />
                            </td>
                            <td>{(page - 1) * perPage + i + 1}</td>
                            <td>
                              <div className="ast-doc">
                                <span className={`ast-type ${catTone(a.category)}`}>
                                  <HrmsIcon name={catIcon(a.category)} size={15} />
                                </span>
                                <div>
                                  <b title={a.title}>{a.title}</b>
                                  <small>{a.category}</small>
                                </div>
                              </div>
                            </td>
                            <td>{a.category}</td>
                            <td>{a.serial || '—'}</td>
                            <td>
                              {a.employee_name ? (
                                <div className="emp-person lv-person">
                                  <Avatar id={a.assigned_employee || a.employee_id || a.employee_name} name={a.employee_name} photo={a.photo} />
                                  <div>
                                    <b>{a.employee_name}</b>
                                    <small>{a.employee_id || a.assigned_employee}</small>
                                  </div>
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td>{a.location || '—'}</td>
                            <td>{fmtDate(a.assign_date)}</td>
                            <td>
                              <span className={`emp-pill ${ST_TONE[a.status] || 'grey'}`}>{a.status}</span>
                            </td>
                            <td className="emp-col-actions">
                              <div className="emp-actions">
                                <button type="button" aria-label="View" onClick={() => setViewAsset(a)}>
                                  <HrmsIcon name="eye" size={15} />
                                </button>
                                {manager ? (
                                  <button type="button" aria-label="Edit" onClick={() => setFormOpen({ ...a, title: a.title })}>
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
                  summary={`Showing ${rows.length ? (page - 1) * perPage + 1 : 0} to ${Math.min(page * perPage, rows.length)} of ${rows.length} assets`}
                />
              </>
            ) : null}

            {tab === 'requests' ? <RequestsTable requests={board?.requests || []} manager={manager} busy={busy} onUpdate={(id, st) => void run(() => api.updatePeopleAssetRequest(id, st), `Request ${st.toLowerCase()}`)} /> : null}
            {tab === 'audit' ? <AuditTable activities={board?.activities || []} /> : null}
          </div>

          <aside className="ast-side">
            <div>
              <header>
                Quick Actions
                <button type="button" className="ast-link" onClick={() => setTab('all')}>
                  View All
                </button>
              </header>
              <ul className="ast-quick">
                {manager ? (
                  <>
                    <li>
                      <button type="button" onClick={() => setFormOpen({ title: '', category: 'Laptop', status: 'Available', location: 'IT Store' })}>
                        <span className="ast-qa teal">
                          <HrmsIcon name="plus" size={15} />
                        </span>
                        Add New Asset
                      </button>
                    </li>
                    <li>
                      <button type="button" onClick={() => needAssets('assign')}>
                        <span className="ast-qa green">
                          <HrmsIcon name="userPlus" size={15} />
                        </span>
                        Assign to Employee
                      </button>
                    </li>
                    <li>
                      <button type="button" onClick={() => needAssets('collect')}>
                        <span className="ast-qa blue">
                          <HrmsIcon name="userMinus" size={15} />
                        </span>
                        Collect from Employee
                      </button>
                    </li>
                    <li>
                      <button type="button" onClick={() => needAssets('transfer')}>
                        <span className="ast-qa violet">
                          <HrmsIcon name="refresh" size={15} />
                        </span>
                        Transfer Asset
                      </button>
                    </li>
                    <li>
                      <button type="button" onClick={() => needAssets('repair')}>
                        <span className="ast-qa amber">
                          <HrmsIcon name="wrench" size={15} />
                        </span>
                        Mark as In Repair
                      </button>
                    </li>
                    <li>
                      <button type="button" onClick={() => needAssets('retire')}>
                        <span className="ast-qa rose">
                          <HrmsIcon name="trash" size={15} />
                        </span>
                        Retire Asset
                      </button>
                    </li>
                    <li>
                      <button type="button" onClick={() => setTab('audit')}>
                        <span className="ast-qa grey">
                          <HrmsIcon name="clipboard" size={15} />
                        </span>
                        Asset Audit
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        onClick={() =>
                          downloadCsv(
                            'assets.csv',
                            ['Asset', 'Category', 'Serial', 'Assigned To', 'Location', 'Status'],
                            rows.map((a) => [a.title, a.category, a.serial, a.employee_name, a.location, a.status]),
                          )
                        }
                      >
                        <span className="ast-qa teal">
                          <HrmsIcon name="reports" size={15} />
                        </span>
                        Generate Report
                      </button>
                    </li>
                  </>
                ) : (
                  <li>
                    <button type="button" onClick={() => setReqOpen(true)}>
                      <span className="ast-qa teal">
                        <HrmsIcon name="plus" size={15} />
                      </span>
                      Request Asset
                    </button>
                  </li>
                )}
              </ul>
            </div>
            <div>
              <header>
                Asset Categories
                <button type="button" className="ast-link" onClick={() => (manager ? setCatOpen(true) : setCategory(''))}>
                  View All
                </button>
              </header>
              <ul className="ast-cats">
                {cats.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={category === c.title ? 'on' : ''}
                      onClick={() => {
                        setTab('all');
                        setCategory(c.title === category ? '' : c.title);
                      }}
                    >
                      <span className={`ast-type ${catTone(c.title)}`}>
                        <HrmsIcon name={catIcon(c.title)} size={14} />
                      </span>
                      {c.title}
                      <span className="ast-count">{c.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </section>

      <div className="ast-bottom">
        <section className="emp-card ast-panel">
          <header>
            Recent Activities
            <button type="button" className="ast-link" onClick={() => setTab('audit')}>
              View All
            </button>
          </header>
          <ul className="ast-feed">
            {(board?.activities || []).slice(0, 4).map((a) => (
              <li key={a.id}>
                <span className={`ast-qa ${KIND_TONE[a.kind] || 'grey'}`}>
                  <HrmsIcon name={a.kind === 'Assigned' ? 'userPlus' : a.kind === 'Collected' ? 'userMinus' : a.kind === 'Repair' ? 'wrench' : a.kind === 'Added' ? 'plus' : 'clipboard'} size={15} />
                </span>
                <div>
                  <b>{a.title}</b>
                  <small>{a.detail}</small>
                  <small>
                    {relTime(a.happened_on)}
                    {a.actor ? ` by ${a.actor}` : ''}
                  </small>
                </div>
              </li>
            ))}
            {!board?.activities?.length ? <li className="lv-muted">No recent activity.</li> : null}
          </ul>
        </section>
        <section className="emp-card ast-panel">
          <header>Assets by Department</header>
          <div className="ast-source">
            <div className="ast-donut" style={{ background: `conic-gradient(${donut})` }} aria-hidden>
              <span>
                <strong>{total.toLocaleString()}</strong>
                <small>Total Assets</small>
              </span>
            </div>
            <ul>
              {deptRows.slice(0, 7).map((d) => (
                <li key={d.name}>
                  <i className="ast-dot" style={{ background: DEPT_COLOR[d.name] || '#94a3b8' }} />
                  {d.name}
                  <span>
                    {d.count} ({deptTotal ? Math.round((d.count / deptTotal) * 100) : 0}%)
                  </span>
                </li>
              ))}
              {!deptRows.length ? <li className="lv-muted">No department split yet.</li> : null}
            </ul>
          </div>
        </section>
        <section className="emp-card ast-panel">
          <header>Lifecycle Status</header>
          <ul className="ast-life">
            {life.map((row) => (
              <li key={row.label}>
                {row.label}
                <div className={`ast-bar ${row.tone}`}>
                  <i style={{ width: `${total ? Math.max(4, Math.round((row.value / total) * 100)) : 0}%` }} />
                </div>
                <b>{row.value}</b>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {formOpen ? (
        <AssetModal
          form={formOpen}
          categories={catOpts.length ? catOpts : CATEGORIES}
          locations={locOpts}
          busy={busy}
          onClose={() => setFormOpen(null)}
          onSave={async (data) => {
            await run(() => api.savePeopleAsset(data), data.id ? 'Asset updated' : 'Asset added');
            setFormOpen(null);
          }}
        />
      ) : null}

      {catOpen ? (
        <CategoryModal
          busy={busy}
          onClose={() => setCatOpen(false)}
          onSave={async (title) => {
            await run(() => api.savePeopleAssetCategory({ title }), 'Category created');
            setCatOpen(false);
          }}
        />
      ) : null}

      {bulkOpen ? (
        <BulkModal
          busy={busy}
          onClose={() => setBulkOpen(false)}
          onSave={async (items) => {
            await run(async () => {
              for (const item of items) await api.savePeopleAsset(item);
            }, `${items.length} assets imported`);
            setBulkOpen(false);
          }}
        />
      ) : null}

      {reqOpen ? (
        <RequestModal
          busy={busy}
          onClose={() => setReqOpen(false)}
          onSave={async (data) => {
            await run(() => api.savePeopleAssetRequest(data), 'Request submitted');
            setReqOpen(false);
          }}
        />
      ) : null}

      {viewAsset ? (
        <ViewModal asset={viewAsset} onClose={() => setViewAsset(null)} onEdit={() => { setFormOpen({ ...viewAsset, title: viewAsset.title }); setViewAsset(null); }} manager={manager} />
      ) : null}

      {actOpen ? (
        <ActionModal
          action={actOpen.action}
          assets={actOpen.assets}
          employees={board?.employees || []}
          locations={locOpts}
          busy={busy}
          onClose={() => setActOpen(null)}
          onSave={async (employee) => {
            await run(async () => {
              for (const a of actOpen.assets) {
                await api.updatePeopleAsset(a.id, { action: actOpen.action, employee });
              }
            }, 'Assets updated');
            setActOpen(null);
            setSelected(new Set());
          }}
        />
      ) : null}
    </div>
  );
}

function RequestsTable({
  requests,
  manager,
  busy,
  onUpdate,
}: {
  requests: PeopleAssetRequest[];
  manager: boolean;
  busy: boolean;
  onUpdate: (id: string, status: 'Approved' | 'Rejected') => void;
}) {
  return (
    <div className="emp-table-wrap">
      <table className="emp-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Requested Item</th>
            <th>Employee</th>
            <th>Date</th>
            <th>Status</th>
            <th className="emp-col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.length === 0 ? (
            <tr>
              <td className="emp-empty" colSpan={6}>
                No asset requests.
              </td>
            </tr>
          ) : (
            requests.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td>
                  <b>{r.title}</b>
                  {r.note ? <small className="lv-muted"> {r.note}</small> : null}
                </td>
                <td>
                  <div className="emp-person lv-person">
                    <Avatar id={r.employee || r.employee_id || r.title} name={r.employee_name || r.employee || 'Staff'} />
                    <div>
                      <b>{r.employee_name || r.employee || '—'}</b>
                      <small>{r.employee_id}</small>
                    </div>
                  </div>
                </td>
                <td>{fmtDate(r.request_date)}</td>
                <td>
                  <span className={`emp-pill ${ST_TONE[r.status] || 'grey'}`}>{r.status}</span>
                </td>
                <td className="emp-col-actions">
                  {manager && r.status === 'Pending' ? (
                    <div className="emp-actions">
                      <button type="button" aria-label="Approve" disabled={busy} onClick={() => onUpdate(r.id, 'Approved')}>
                        <HrmsIcon name="check" size={15} />
                      </button>
                      <button type="button" aria-label="Reject" disabled={busy} onClick={() => onUpdate(r.id, 'Rejected')}>
                        <HrmsIcon name="x" size={15} />
                      </button>
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function AuditTable({ activities }: { activities: PeopleAssetActivity[] }) {
  return (
    <div className="emp-table-wrap">
      <table className="emp-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Activity</th>
            <th>Detail</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {activities.length === 0 ? (
            <tr>
              <td className="emp-empty" colSpan={4}>
                No audit entries yet.
              </td>
            </tr>
          ) : (
            activities.map((a) => (
              <tr key={a.id}>
                <td>{relTime(a.happened_on) || fmtDate(a.happened_on)}</td>
                <td>
                  <b>{a.title}</b>
                </td>
                <td>{a.detail || '—'}</td>
                <td>{a.actor || 'HR Manager'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function AssetModal({
  form,
  categories,
  locations,
  busy,
  onClose,
  onSave,
}: {
  form: Partial<PeopleAsset> & { title: string };
  categories: string[];
  locations: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (data: Partial<PeopleAsset> & { title: string }) => void;
}) {
  const [f, setF] = useState({
    ...form,
    category: form.category || 'Laptop',
    status: (form.status as PeopleAssetStatus) || 'Available',
    location: form.location || 'IT Store',
    serial: form.serial || '',
    notes: form.notes || '',
  });
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <div className="lv-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{f.id ? 'Edit asset' : 'Add new asset'}</h2>
          <button type="button" className="emp-btn icon" aria-label="Close" onClick={onClose}>
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <div className="ast-form-grid">
          <label className="span-2">
            Asset name *
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
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
            Serial number
            <input value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} />
          </label>
          <label>
            Location
            <select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>
              {locations.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as PeopleAssetStatus })}>
              {['Available', 'Assigned', 'In Repair', 'Retired'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="span-2">
            Notes
            <textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </label>
        </div>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="emp-btn primary" disabled={busy || !f.title.trim()} onClick={() => onSave(f)}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

function CategoryModal({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (title: string) => void }) {
  const [title, setTitle] = useState('');
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <div className="lv-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Asset category</h2>
          <button type="button" className="emp-btn icon" aria-label="Close" onClick={onClose}>
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <label>
          Category name *
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Laptop" />
        </label>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="emp-btn primary" disabled={busy || !title.trim()} onClick={() => onSave(title.trim())}>
            Create
          </button>
        </footer>
      </div>
    </div>
  );
}

function BulkModal({
  busy,
  onClose,
  onSave,
}: {
  busy: boolean;
  onClose: () => void;
  onSave: (items: Array<Partial<PeopleAsset> & { title: string }>) => void;
}) {
  const [text, setText] = useState('title,category,serial,location,status\nDell Latitude 5550,Laptop,DL5550-10001,IT Store,Available');
  const rows = parseCsv(text)
    .map((r) => ({
      title: r.title || r.asset_name || r.name,
      category: r.category || 'Other',
      serial: r.serial || r.serial_number || '',
      location: r.location || 'IT Store',
      status: (r.status as PeopleAssetStatus) || 'Available',
    }))
    .filter((r) => r.title);
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <div className="lv-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Bulk import</h2>
          <button type="button" className="emp-btn icon" aria-label="Close" onClick={onClose}>
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <label>
          CSV (title, category, serial, location, status)
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="lv-muted">{rows.length} rows ready.</p>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="emp-btn primary" disabled={busy || !rows.length} onClick={() => onSave(rows)}>
            Import
          </button>
        </footer>
      </div>
    </div>
  );
}

function RequestModal({
  busy,
  onClose,
  onSave,
}: {
  busy: boolean;
  onClose: () => void;
  onSave: (data: { title: string; note?: string }) => void;
}) {
  const [title, setTitle] = useState('Laptop');
  const [note, setNote] = useState('');
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <div className="lv-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Request asset</h2>
          <button type="button" className="emp-btn icon" aria-label="Close" onClick={onClose}>
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <label>
          Item *
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Note
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="emp-btn primary" disabled={busy || !title.trim()} onClick={() => onSave({ title: title.trim(), note })}>
            Submit
          </button>
        </footer>
      </div>
    </div>
  );
}

function ViewModal({ asset, manager, onClose, onEdit }: { asset: PeopleAsset; manager: boolean; onClose: () => void; onEdit: () => void }) {
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <div className="lv-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{asset.title}</h2>
          <button type="button" className="emp-btn icon" aria-label="Close" onClick={onClose}>
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <p>
          <span className={`emp-pill ${ST_TONE[asset.status] || 'grey'}`}>{asset.status}</span>
        </p>
        <p>
          {asset.category} · {asset.serial || 'No serial'} · {asset.location || '—'}
        </p>
        <p>{asset.employee_name ? `Assigned to ${asset.employee_name} (${asset.employee_id || ''})` : 'Unassigned'}</p>
        {asset.notes ? <p>{asset.notes}</p> : null}
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Close
          </button>
          {manager ? (
            <button type="button" className="emp-btn primary" onClick={onEdit}>
              Edit
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function ActionModal({
  action,
  assets,
  employees,
  locations,
  busy,
  onClose,
  onSave,
}: {
  action: AssetAction;
  assets: PeopleAsset[];
  employees: Array<{ id: string; name: string; department?: string }>;
  locations: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (employee: Record<string, string>) => void;
}) {
  const needsEmp = action === 'assign' || action === 'transfer';
  const [empId, setEmpId] = useState(employees[0]?.id || '');
  const [location, setLocation] = useState(assets[0]?.location || locations[0] || '');
  const [note, setNote] = useState('');
  const emp = employees.find((e) => e.id === empId);
  const titles: Record<AssetAction, string> = {
    assign: 'Assign to employee',
    collect: 'Collect from employee',
    transfer: 'Transfer asset',
    repair: 'Mark as in repair',
    retire: 'Retire asset',
    audit: 'Log audit note',
  };
  return (
    <div className="lv-modal-backdrop" onMouseDown={onClose}>
      <div className="lv-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{titles[action]}</h2>
          <button type="button" className="emp-btn icon" aria-label="Close" onClick={onClose}>
            <HrmsIcon name="x" size={16} />
          </button>
        </header>
        <p className="lv-muted">{assets.map((a) => a.title).join(', ')}</p>
        {needsEmp ? (
          <>
            <label>
              Employee
              {employees.length ? (
                <select value={empId} onChange={(e) => setEmpId(e.target.value)}>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={empId} onChange={(e) => setEmpId(e.target.value)} placeholder="Employee name" />
              )}
            </label>
            <label>
              Location
              <select value={location} onChange={(e) => setLocation(e.target.value)}>
                {locations.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        {action === 'audit' ? (
          <label>
            Note
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        ) : null}
        <footer>
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="emp-btn primary"
            disabled={busy || (needsEmp && !empId && !emp)}
            onClick={() =>
              onSave({
                id: emp?.id || empId,
                name: emp?.name || empId,
                employee_id: emp?.id || empId,
                department: emp?.department || '',
                location,
                note,
              })
            }
          >
            Confirm
          </button>
        </footer>
      </div>
    </div>
  );
}
