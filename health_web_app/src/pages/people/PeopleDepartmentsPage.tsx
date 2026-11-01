import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, PeopleDepartmentRow } from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import { deskAppUrl } from '../../config';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';

const PALETTE = [
  '#3b82f6', '#c084fc', '#fb923c', '#5ccfd6', '#f472b6', '#84cc16', '#c9a08a', '#fdba74',
  '#f9a8d4', '#a78bfa', '#34d399', '#facc15', '#60a5fa', '#f87171', '#2dd4bf', '#94a3b8',
];
const PER_PAGE_OPTIONS = [10, 25, 50];

type ChartScope = 'with' | 'top' | 'all';
type Group = { name: string; parent: string | null };
type TreeNode = { name: string; headcount: number; isGroup: boolean; children: TreeNode[] };

function pct(count: number, total: number) {
  if (!total || !count) return 0;
  return Math.max(1, Math.round((count / total) * 100));
}

function csvCell(value: unknown) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadDepartmentsCsv(rows: PeopleDepartmentRow[], total: number) {
  const header = ['#', 'Department', 'Code', 'Head of Department', 'Employees', 'Share %', 'Status', 'Created On', 'Parent', 'Company'];
  const lines = rows.map((r, i) => [
    i + 1,
    r.department,
    r.code || '',
    r.head_name || '',
    r.headcount,
    pct(r.headcount, total),
    r.status || 'Active',
    r.created_on || '',
    r.parent || '',
    r.company || '',
  ]);
  const text = [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `departments-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildTree(rows: PeopleDepartmentRow[], groups: Group[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  groups.forEach((g) => nodes.set(g.name, { name: g.name, headcount: 0, isGroup: true, children: [] }));
  const roots: TreeNode[] = [];
  const attach = (node: TreeNode, parent: string | null | undefined) => {
    const p = parent ? nodes.get(parent) : undefined;
    if (p && p !== node) p.children.push(node);
    else roots.push(node);
  };
  groups.forEach((g) => attach(nodes.get(g.name)!, g.parent));
  rows.forEach((r) => attach({ name: r.department, headcount: r.headcount, isGroup: false, children: [] }, r.parent));
  const total = (n: TreeNode): number => {
    if (n.isGroup) n.headcount = n.children.reduce((s, c) => s + total(c), 0);
    n.children.sort((a, b) => Number(b.isGroup) - Number(a.isGroup) || b.headcount - a.headcount || a.name.localeCompare(b.name));
    return n.headcount;
  };
  roots.forEach(total);
  return roots;
}

function TreeList({ nodes }: { nodes: TreeNode[] }) {
  return (
    <ul className="dep-tree">
      {nodes.map((n) => (
        <li key={n.name}>
          <div className={`dep-tree-node${n.isGroup ? ' group' : ''}`}>
            <HrmsIcon name={n.isGroup ? 'orgChart' : 'building'} size={15} />
            <span>{n.name}</span>
            <em>{n.headcount}</em>
          </div>
          {n.children.length ? <TreeList nodes={n.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

export function PeopleDepartmentsPage() {
  const [rows, setRows] = useState<PeopleDepartmentRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<'bar' | 'pie'>('bar');
  const [chartScope, setChartScope] = useState<ChartScope>('with');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [viewRow, setViewRow] = useState<PeopleDepartmentRow | null>(null);
  const [showTree, setShowTree] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPeopleDepartments();
      const list = [...(res.data.departments || [])].sort(
        (a, b) => b.headcount - a.headcount || a.department.localeCompare(b.department),
      );
      setRows(list);
      setGroups(res.data.groups || []);
      setTotalEmployees(res.data.total_employees ?? list.reduce((s, r) => s + r.headcount, 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load departments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, perPage]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!menuFor) return;
    const close = (ev: MouseEvent) => {
      if ((ev.target as HTMLElement).closest('.emp-popover, .emp-popover-trigger')) return;
      setMenuFor(null);
    };
    const closeMenu = () => setMenuFor(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [menuFor]);

  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r, i) => map.set(r.department, PALETTE[i % PALETTE.length]));
    return (name: string) => map.get(name) || PALETTE[0];
  }, [rows]);

  const masters = useMemo(() => rows.filter((r) => !r.unlisted), [rows]);
  const withEmployees = masters.filter((r) => r.headcount > 0).length;
  const emptyCount = masters.length - withEmployees;
  const activeCount = masters.filter((r) => (r.status || 'Active') === 'Active').length;

  const chartRows = useMemo(() => {
    if (chartScope === 'all') return rows;
    const nonEmpty = rows.filter((r) => r.headcount > 0);
    return chartScope === 'top' ? nonEmpty.slice(0, 10) : nonEmpty;
  }, [rows, chartScope]);
  const chartMax = Math.max(1, ...chartRows.map((r) => r.headcount));

  const pieGradient = useMemo(() => {
    const sum = chartRows.reduce((s, r) => s + r.headcount, 0);
    if (!sum) return '#eef2f6';
    let acc = 0;
    const stops = chartRows
      .filter((r) => r.headcount > 0)
      .map((r) => {
        const from = (acc / sum) * 360;
        acc += r.headcount;
        return `${colorOf(r.department)} ${from}deg ${(acc / sum) * 360}deg`;
      });
    return `conic-gradient(${stops.join(', ')})`;
  }, [chartRows, colorOf]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!statusFilter || (r.status || 'Active') === statusFilter) &&
        (!q ||
          [r.department, r.code, r.head_name, r.parent, r.company].some((v) => (v || '').toLowerCase().includes(q))),
    );
  }, [rows, query, statusFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  const firstShown = filtered.length ? (currentPage - 1) * perPage + 1 : 0;
  const lastShown = Math.min(currentPage * perPage, filtered.length);
  const tree = useMemo(() => buildTree(masters, groups), [masters, groups]);

  const editUrl = (name: string) => `${deskAppUrl()}/app/department/${encodeURIComponent(name)}`;
  const newUrl = `${deskAppUrl()}/app/department/new`;
  const employeesUrl = (name: string) =>
    name === 'Unassigned' ? '/people/employees' : `/people/employees?department=${encodeURIComponent(name)}`;

  const openRowMenu = (id: string, anchor: HTMLElement) => {
    if (menuFor === id) {
      setMenuFor(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const menuHeight = 140;
    const top = rect.bottom + menuHeight + 8 > window.innerHeight ? rect.top - menuHeight - 4 : rect.bottom + 4;
    setMenuPos({ top: Math.max(8, top), left: Math.max(8, rect.right - 200) });
    setMenuFor(id);
  };

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setNotice('Department name copied');
    setMenuFor(null);
  };

  const kpis = [
    { icon: 'orgChart', tone: 'teal', label: 'Total Departments', value: masters.length, sub: `${activeCount} active departments` },
    { icon: 'users', tone: 'blue', label: 'Total Employees', value: totalEmployees, sub: 'Across all departments' },
    {
      icon: 'userCheck',
      tone: 'green',
      label: 'Departments with Employees',
      value: withEmployees,
      sub: `${pct(withEmployees, masters.length)}% of total departments`,
    },
    {
      icon: 'userMinus',
      tone: 'slate',
      label: 'Empty Departments',
      value: emptyCount,
      sub: `${pct(emptyCount, masters.length)}% of total departments`,
    },
  ];

  return (
    <div className="hrms-list-page emp-page dep-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon">
            <HrmsIcon name="orgChart" size={26} />
          </span>
          <div>
            <h1>Departments</h1>
            <p>Manage and view all department details with employee strength</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <button className="emp-btn outline lg" type="button" onClick={() => setShowTree(true)}>
            <HrmsIcon name="orgChart" size={17} />
            Department Structure
          </button>
          <a className="emp-btn primary lg" href={newUrl} target="_blank" rel="noreferrer">
            <HrmsIcon name="plus" size={18} />
            Add Department
          </a>
        </div>
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}

      <div className="dep-kpis">
        {kpis.map((k) => (
          <div key={k.label} className="emp-card dep-kpi">
            <span className={`dep-kpi-icon ${k.tone}`}>
              <HrmsIcon name={k.icon} size={24} />
            </span>
            <div>
              <b>{k.label}</b>
              <strong>{loading ? '…' : k.value}</strong>
              <small>{k.sub}</small>
            </div>
          </div>
        ))}
      </div>

      <section className="emp-card dep-chart-card">
        <header className="dep-chart-head">
          <div className="dep-chart-title">
            <HrmsIcon name="orgChart" size={22} />
            <div>
              <h2>Department Headcount</h2>
              <p>Total employees by department</p>
            </div>
          </div>
          <div className="dep-chart-controls">
            <div className="dep-toggle" role="group" aria-label="Chart type">
              <button type="button" className={chartType === 'bar' ? 'on' : ''} onClick={() => setChartType('bar')}>
                <HrmsIcon name="barChart" size={15} /> Bar Chart
              </button>
              <button type="button" className={chartType === 'pie' ? 'on' : ''} onClick={() => setChartType('pie')}>
                <HrmsIcon name="pieChart" size={15} /> Pie Chart
              </button>
            </div>
            <select
              className="dep-select"
              value={chartScope}
              onChange={(e) => setChartScope(e.target.value as ChartScope)}
              aria-label="Departments shown in chart"
            >
              <option value="with">Departments with employees</option>
              <option value="top">Top 10 departments</option>
              <option value="all">All Departments</option>
            </select>
          </div>
        </header>

        {loading ? <p className="dep-chart-empty">Loading headcount…</p> : null}
        {!loading && !chartRows.length ? <p className="dep-chart-empty">No department data yet.</p> : null}

        {!loading && chartRows.length && chartType === 'bar' ? (
          <div className="dep-bars">
            {chartRows.map((r) => (
              <div key={r.department} className="dep-bar-row">
                <span className="dep-bar-label" title={r.department}>
                  {r.department}
                </span>
                <span className="dep-bar-track">
                  <span
                    className="dep-bar-fill"
                    style={{ width: `${(r.headcount / chartMax) * 100}%`, background: colorOf(r.department) }}
                  />
                </span>
                <span className="dep-bar-value">
                  <b>{r.headcount}</b> ({pct(r.headcount, totalEmployees)}%)
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {!loading && chartRows.length && chartType === 'pie' ? (
          <div className="dep-pie-wrap">
            <div className="dep-pie" style={{ background: pieGradient }}>
              <span>
                <strong>{chartRows.reduce((s, r) => s + r.headcount, 0)}</strong>
                <small>employees</small>
              </span>
            </div>
            <ul className="dep-legend">
              {chartRows.map((r) => (
                <li key={r.department}>
                  <i style={{ background: colorOf(r.department) }} />
                  <span title={r.department}>{r.department}</span>
                  <b>{r.headcount}</b>
                  <em>{pct(r.headcount, totalEmployees)}%</em>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="emp-card emp-table-card">
        <div className="emp-toolbar dep-toolbar">
          <label className="emp-search dep-search">
            <HrmsIcon name="search" size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search departments..."
              aria-label="Search departments"
            />
          </label>
          {notice ? <span className="emp-notice">{notice}</span> : null}
          <span className="emp-toolbar-spacer" />
          <label className="dep-status">
            Status
            <select className="dep-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>
          <button
            className="emp-btn outline"
            type="button"
            onClick={() => downloadDepartmentsCsv(filtered, totalEmployees)}
            disabled={!filtered.length}
          >
            <HrmsIcon name="download" size={16} />
            Export
          </button>
          <button
            className="emp-btn outline icon dep-refresh"
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh"
            title="Refresh"
          >
            <HrmsIcon name="refresh" size={17} className={loading ? 'spin' : ''} />
          </button>
        </div>

        <div className="emp-table-wrap">
          <table className="emp-table dep-table">
            <thead>
              <tr>
                <th className="dep-col-num">#</th>
                <th>Department Name</th>
                <th>Department Code</th>
                <th>Head of Department</th>
                <th>Employees</th>
                <th>Status</th>
                <th>Created On</th>
                <th className="emp-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="emp-empty">
                    Loading departments…
                  </td>
                </tr>
              ) : null}
              {!loading &&
                pageRows.map((row, i) => {
                  const color = colorOf(row.department);
                  const share = pct(row.headcount, totalEmployees);
                  return (
                    <tr key={row.department}>
                      <td className="dep-col-num">{(currentPage - 1) * perPage + i + 1}</td>
                      <td>
                        <div className="dep-name">
                          <span className="dep-name-icon" style={{ background: `${color}22`, color }}>
                            <HrmsIcon name="orgChart" size={15} />
                          </span>
                          <span title={row.department}>{row.department}</span>
                        </div>
                      </td>
                      <td className="emp-mono">{row.code || '—'}</td>
                      <td>{row.head_name || '—'}</td>
                      <td>
                        <div className="dep-emp">
                          <b>{row.headcount}</b>
                          <span className="dep-emp-track">
                            <span style={{ width: `${Math.max(share, row.headcount ? 3 : 0)}%`, background: color }} />
                          </span>
                          <em>{share}%</em>
                        </div>
                      </td>
                      <td>
                        <span className={`emp-pill ${(row.status || 'Active') === 'Active' ? 'green' : 'muted'}`}>
                          {row.status || 'Active'}
                        </span>
                      </td>
                      <td>{row.created_on || '—'}</td>
                      <td className="emp-col-actions">
                        <div className="emp-actions">
                          <button
                            type="button"
                            title="View"
                            aria-label={`View ${row.department}`}
                            onClick={() => setViewRow(row)}
                          >
                            <HrmsIcon name="eye" size={17} />
                          </button>
                          {row.unlisted ? (
                            <button type="button" disabled title="Not a department record" aria-label={`Edit ${row.department}`}>
                              <HrmsIcon name="pencil" size={16} />
                            </button>
                          ) : (
                            <a
                              href={editUrl(row.department)}
                              target="_blank"
                              rel="noreferrer"
                              title="Edit in ERP"
                              aria-label={`Edit ${row.department}`}
                            >
                              <HrmsIcon name="pencil" size={16} />
                            </a>
                          )}
                          <div className="emp-filter-wrap">
                            <button
                              type="button"
                              className="emp-popover-trigger"
                              title="More"
                              aria-label={`More actions for ${row.department}`}
                              aria-expanded={menuFor === row.department}
                              onClick={(e) => openRowMenu(row.department, e.currentTarget)}
                            >
                              <HrmsIcon name="moreV" size={18} strokeWidth={3} />
                            </button>
                            {menuFor === row.department ? (
                              <div
                                className="emp-popover emp-menu"
                                style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
                              >
                                <button type="button" onClick={() => { setViewRow(row); setMenuFor(null); }}>
                                  <HrmsIcon name="eye" size={15} /> View details
                                </button>
                                <Link to={employeesUrl(row.department)} onClick={() => setMenuFor(null)}>
                                  <HrmsIcon name="users" size={15} /> View employees
                                </Link>
                                <button type="button" onClick={() => copyText(row.department)}>
                                  <HrmsIcon name="copy" size={15} /> Copy name
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              {!loading && !pageRows.length ? (
                <tr>
                  <td colSpan={8} className="emp-empty">
                    {rows.length ? 'No departments match these filters.' : 'No departments found.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <footer className="emp-pager">
          <span>
            Showing {firstShown} to {lastShown} of {filtered.length} departments
          </span>
          <div className="emp-pager-right">
            <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} aria-label="Rows per page">
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} per page
                </option>
              ))}
            </select>
            <nav className="emp-pages" aria-label="Pagination">
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous page">
                <HrmsIcon name="chevronRight" size={16} style={{ transform: 'rotate(180deg)' }} />
              </button>
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={p === currentPage ? 'on' : ''}
                  aria-current={p === currentPage ? 'page' : undefined}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              ))}
              <button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} aria-label="Next page">
                <HrmsIcon name="chevronRight" size={16} />
              </button>
            </nav>
          </div>
        </footer>
      </section>

      {viewRow ? (
        <div className="emp-drawer-backdrop" role="presentation" onMouseDown={() => setViewRow(null)}>
          <aside
            className="emp-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`${viewRow.department} details`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div className="dep-name lg">
                <span
                  className="dep-name-icon"
                  style={{ background: `${colorOf(viewRow.department)}22`, color: colorOf(viewRow.department) }}
                >
                  <HrmsIcon name="orgChart" size={22} />
                </span>
                <div>
                  <b>{viewRow.department}</b>
                  <small>{viewRow.code || 'Not a department record'}</small>
                </div>
              </div>
              <button type="button" className="emp-close" onClick={() => setViewRow(null)} aria-label="Close">
                <HrmsIcon name="x" size={18} />
              </button>
            </header>
            <dl>
              <dt>Employees</dt>
              <dd>
                {viewRow.headcount} ({pct(viewRow.headcount, totalEmployees)}% of workforce)
              </dd>
              <dt>Head</dt>
              <dd>{viewRow.head_name || '—'}</dd>
              <dt>Parent</dt>
              <dd>{viewRow.parent || '—'}</dd>
              <dt>Company</dt>
              <dd>{viewRow.company || '—'}</dd>
              <dt>Status</dt>
              <dd>{viewRow.status || 'Active'}</dd>
              <dt>Created on</dt>
              <dd>{viewRow.created_on || '—'}</dd>
            </dl>
            <div className="emp-drawer-actions">
              <Link className="emp-btn primary" to={employeesUrl(viewRow.department)}>
                <HrmsIcon name="users" size={15} /> View employees
              </Link>
              {!viewRow.unlisted ? (
                <a className="emp-btn outline" href={editUrl(viewRow.department)} target="_blank" rel="noreferrer">
                  <HrmsIcon name="pencil" size={15} /> Edit in ERP
                </a>
              ) : null}
            </div>
            {!viewRow.unlisted && !viewRow.head ? (
              <p className="dep-hint">Set the head of department in ERP using the “Head of Department” field.</p>
            ) : null}
          </aside>
        </div>
      ) : null}

      {showTree ? (
        <div className="emp-drawer-backdrop" role="presentation" onMouseDown={() => setShowTree(false)}>
          <aside
            className="emp-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Department structure"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div className="dep-name lg">
                <span className="dep-name-icon" style={{ background: '#1d6b7822', color: '#1d6b78' }}>
                  <HrmsIcon name="orgChart" size={22} />
                </span>
                <div>
                  <b>Department Structure</b>
                  <small>Groups and departments with active headcount</small>
                </div>
              </div>
              <button type="button" className="emp-close" onClick={() => setShowTree(false)} aria-label="Close">
                <HrmsIcon name="x" size={18} />
              </button>
            </header>
            {tree.length ? <TreeList nodes={tree} /> : <p className="dep-hint">No departments yet.</p>}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
