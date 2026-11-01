import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, PeopleEmployeeRow } from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import { deskAppUrl } from '../../config';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-grades.css';

type DaSlabs = { label?: string; hq_day?: number; ex_hq_day?: number; os_day?: number; track?: string };

type GradeRow = {
  name: string;
  description: string;
  structure: string;
  base: number;
  designation: string;
  da_track?: string;
  da_slabs?: DaSlabs;
  status: 'Active' | 'No band';
  employees: PeopleEmployeeRow[];
  byDesignation: number;
};

type Architecture = {
  basic_pct_of_gross?: number;
  hra_pct_of_basic?: number;
  dearness_pct_of_basic?: number;
  food_allowance?: number;
  appraisal?: string;
};

const CHIP_TONES = ['blue', 'green', 'amber', 'rose', 'indigo', 'teal', 'violet', 'orange', 'pink', 'slate'];
const PER_PAGE_OPTIONS = [10, 25, 50];

function inr(value?: number | null) {
  return value ? `₹${Math.round(Number(value)).toLocaleString('en-IN')}` : '—';
}

function pct(count: number, total: number) {
  if (!total || !count) return 0;
  return Math.max(1, Math.round((count / total) * 100));
}

function titleCase(s?: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
}

function slabLine(s?: DaSlabs) {
  if (!s) return null;
  return `HQ ₹${s.hq_day ?? 0} • Ex-HQ ₹${s.ex_hq_day ?? 0} • OS ₹${s.os_day ?? 0}`;
}

function csvCell(value: unknown) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadGradesCsv(rows: GradeRow[]) {
  const header = ['Grade', 'Description', 'Default Designation', 'Structure', 'Fixed Gross (INR)', 'DA Track', 'HQ/day', 'Ex-HQ/day', 'OS/day', 'Employees', 'Status'];
  const lines = rows.map((r) => [
    r.name,
    r.description,
    r.designation,
    r.structure,
    r.base,
    r.da_track || '',
    r.da_slabs?.hq_day ?? '',
    r.da_slabs?.ex_hq_day ?? '',
    r.da_slabs?.os_day ?? '',
    r.employees.length,
    r.status,
  ]);
  const text = [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `grades-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function FilterDropdown({
  value,
  allLabel,
  options,
  onChange,
  label,
}: {
  value: string;
  allLabel: string;
  options: string[];
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className={`dsg-select${value ? ' active' : ''}`}>
      <span>{value || allLabel}</span>
      <HrmsIcon name="chevronDown" size={16} />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PeopleGradesPage() {
  const [rows, setRows] = useState<GradeRow[]>([]);
  const [architecture, setArchitecture] = useState<Architecture>({});
  const [ungraded, setUngraded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [structureFilter, setStructureFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [viewRow, setViewRow] = useState<GradeRow | null>(null);
  const [showStructure, setShowStructure] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [master, emp, desig] = await Promise.all([
        api.listHrGradesMaster(),
        api.listPeopleEmployees({ limit: 500 }).catch(() => null),
        api.listPeopleDesignations().catch(() => null),
      ]);
      const employees = emp?.data.employees || [];
      const gradeOfDesignation = new Map((desig?.data.designations || []).map((d) => [d.designation, d.grade || '']));
      const byGrade = new Map<string, PeopleEmployeeRow[]>();
      const inferred = new Map<string, number>();
      let noGrade = 0;
      employees.forEach((e) => {
        if (e.grade) {
          byGrade.set(e.grade, [...(byGrade.get(e.grade) || []), e]);
          return;
        }
        noGrade += 1;
        const g = gradeOfDesignation.get(e.designation || '');
        if (g) inferred.set(g, (inferred.get(g) || 0) + 1);
      });

      const policy: GradeRow[] = (master.data.grades || []).map((g) => ({
        ...g,
        status: 'Active',
        employees: byGrade.get(g.name) || [],
        byDesignation: inferred.get(g.name) || 0,
      }));
      const known = new Set(policy.map((g) => g.name));
      const extra: GradeRow[] = Array.from(byGrade.keys())
        .filter((g) => !known.has(g))
        .sort()
        .map((g) => ({
          name: g,
          description: 'Employee Grade without a payroll band',
          structure: '',
          base: 0,
          designation: '',
          status: 'No band',
          employees: byGrade.get(g) || [],
          byDesignation: 0,
        }));
      setRows([...policy, ...extra]);
      setArchitecture((master.data.architecture || {}) as Architecture);
      setUngraded(noGrade);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load grades');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [query, structureFilter, statusFilter, perPage]);

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

  const toneOf = useMemo(() => {
    const map = new Map(rows.map((r, i) => [r.name, CHIP_TONES[i % CHIP_TONES.length]]));
    return (name: string) => map.get(name) || 'slate';
  }, [rows]);

  const options = useMemo(
    () => ({
      structures: Array.from(new Set(rows.map((r) => r.structure).filter(Boolean))).sort(),
      statuses: Array.from(new Set(rows.map((r) => r.status))).sort(),
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!structureFilter || r.structure === structureFilter) &&
        (!statusFilter || r.status === statusFilter) &&
        (!q || [r.name, r.description, r.designation, r.structure].some((v) => (v || '').toLowerCase().includes(q))),
    );
  }, [rows, query, structureFilter, statusFilter]);

  const withEmployees = rows.filter((r) => r.employees.length > 0).length;
  const unassigned = rows.length - withEmployees;
  const activeCount = rows.filter((r) => r.status === 'Active').length;
  const bases = rows.map((r) => Number(r.base || 0)).filter((v) => v > 0);
  const avgBase = bases.length ? bases.reduce((s, v) => s + v, 0) / bases.length : 0;

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  const firstShown = filtered.length ? (currentPage - 1) * perPage + 1 : 0;
  const lastShown = Math.min(currentPage * perPage, filtered.length);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.name));
  const filtersActive = Boolean(query || structureFilter || statusFilter);

  const editUrl = (name: string) => `${deskAppUrl()}/app/employee-grade/${encodeURIComponent(name)}`;
  const newUrl = `${deskAppUrl()}/app/employee-grade/new`;

  const resetFilters = () => {
    setQuery('');
    setStructureFilter('');
    setStatusFilter('');
    setSelected(new Set());
  };

  const toggleRow = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((r) => next.delete(r.name));
      else pageRows.forEach((r) => next.add(r.name));
      return next;
    });
  };

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
    setNotice('Grade code copied');
    setMenuFor(null);
  };

  const exportRows = selected.size ? rows.filter((r) => selected.has(r.name)) : filtered;

  const kpis = [
    { icon: 'grades', tone: 'violet', label: 'Total Grades', value: rows.length, sub: `${activeCount} active grades` },
    {
      icon: 'users',
      tone: 'cyan',
      label: 'Grades with Employees',
      value: withEmployees,
      sub: `${pct(withEmployees, rows.length)}% of total grades`,
    },
    {
      icon: 'user',
      tone: 'rose',
      label: 'Unassigned Grades',
      value: unassigned,
      sub: `${pct(unassigned, rows.length)}% of total grades`,
    },
    { icon: 'rupee', tone: 'amber', label: 'Average Fixed Gross', value: inr(avgBase), sub: 'Across all grades' },
  ];

  const percentOf = (v?: number) => (v != null ? `${Math.round(v * 100)}%` : '—');

  return (
    <div className="hrms-list-page emp-page dep-page grd-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon grd-title-icon">
            <HrmsIcon name="grades" size={28} />
          </span>
          <div>
            <h1>Employee Grades</h1>
            <p>Manage salary grades, indicative base, allowances and grade structure</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <button className="emp-btn outline lg" type="button" onClick={() => setShowStructure(true)}>
            <HrmsIcon name="orgChart" size={17} />
            Grade Structure
          </button>
          <a className="emp-btn primary lg" href={newUrl} target="_blank" rel="noreferrer">
            <HrmsIcon name="plus" size={18} />
            Add Grade
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

      <section className="emp-card emp-table-card">
        <div className="dsg-filters grd-filters">
          <label className="emp-search dsg-search">
            <HrmsIcon name="search" size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by grade code, description or designation..."
              aria-label="Search grades"
            />
          </label>
          <FilterDropdown
            label="Structure"
            value={structureFilter}
            allLabel="All Structures"
            options={options.structures}
            onChange={setStructureFilter}
          />
          <FilterDropdown label="Status" value={statusFilter} allLabel="All Status" options={options.statuses} onChange={setStatusFilter} />
          <span className="grd-spacer" />
          <button className="emp-btn outline dsg-reset" type="button" onClick={resetFilters} disabled={!filtersActive && !selected.size}>
            <HrmsIcon name="reset" size={16} />
            Reset
          </button>
          <button className="emp-btn outline dsg-reset" type="button" onClick={() => downloadGradesCsv(exportRows)} disabled={!exportRows.length}>
            <HrmsIcon name="download" size={16} />
            {selected.size ? `Export (${selected.size})` : 'Export'}
          </button>
        </div>

        {notice ? (
          <div className="dsg-selbar">
            <span className="emp-notice">{notice}</span>
          </div>
        ) : null}

        <div className="emp-table-wrap">
          <table className="emp-table grd-table">
            <thead>
              <tr>
                <th className="emp-col-check">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={togglePage}
                    disabled={!pageRows.length}
                    aria-label="Select all on this page"
                  />
                </th>
                <th>Grade</th>
                <th>Description</th>
                <th>Default Designation</th>
                <th>Structure</th>
                <th>Fixed Gross</th>
                <th>DA Track (Mid-Slab)</th>
                <th>Employees</th>
                <th>Status</th>
                <th className="emp-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="emp-empty">
                    Loading grades…
                  </td>
                </tr>
              ) : null}
              {!loading &&
                pageRows.map((row) => (
                  <tr key={row.name} className={selected.has(row.name) ? 'selected' : ''}>
                    <td className="emp-col-check">
                      <input
                        type="checkbox"
                        checked={selected.has(row.name)}
                        onChange={() => toggleRow(row.name)}
                        aria-label={`Select ${row.name}`}
                      />
                    </td>
                    <td>
                      <span className={`grd-chip ${toneOf(row.name)}`}>{row.name}</span>
                    </td>
                    <td className="grd-wrap">{row.description || '—'}</td>
                    <td>{row.designation || '—'}</td>
                    <td>{row.structure || '—'}</td>
                    <td className="emp-mono">{inr(row.base)}</td>
                    <td>
                      <div className="grd-da">
                        <b>{titleCase(row.da_track)}</b>
                        {row.da_slabs ? <small>{slabLine(row.da_slabs)}</small> : null}
                      </div>
                    </td>
                    <td>
                      <b className={row.employees.length ? 'dsg-count' : 'dsg-count zero'}>{row.employees.length}</b>
                    </td>
                    <td>
                      <span className={`emp-pill ${row.status === 'Active' ? 'green' : 'amber'}`}>{row.status}</span>
                    </td>
                    <td className="emp-col-actions">
                      <div className="emp-actions">
                        <button type="button" title="View" aria-label={`View ${row.name}`} onClick={() => setViewRow(row)}>
                          <HrmsIcon name="eye" size={17} />
                        </button>
                        <a href={editUrl(row.name)} target="_blank" rel="noreferrer" title="Edit in ERP" aria-label={`Edit ${row.name}`}>
                          <HrmsIcon name="pencil" size={16} />
                        </a>
                        <div className="emp-filter-wrap">
                          <button
                            type="button"
                            className="emp-popover-trigger"
                            title="More"
                            aria-label={`More actions for ${row.name}`}
                            aria-expanded={menuFor === row.name}
                            onClick={(e) => openRowMenu(row.name, e.currentTarget)}
                          >
                            <HrmsIcon name="moreV" size={18} strokeWidth={3} />
                          </button>
                          {menuFor === row.name ? (
                            <div className="emp-popover emp-menu" style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}>
                              <button type="button" onClick={() => { setViewRow(row); setMenuFor(null); }}>
                                <HrmsIcon name="eye" size={15} /> View details
                              </button>
                              <button type="button" onClick={() => { setShowStructure(true); setMenuFor(null); }}>
                                <HrmsIcon name="orgChart" size={15} /> Grade structure
                              </button>
                              <button type="button" onClick={() => copyText(row.name)}>
                                <HrmsIcon name="copy" size={15} /> Copy grade code
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              {!loading && !pageRows.length ? (
                <tr>
                  <td colSpan={10} className="emp-empty">
                    {rows.length ? 'No grades match these filters.' : 'No grades found.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <footer className="emp-pager">
          <span>
            Showing {firstShown} to {lastShown} of {filtered.length} grades
            {!loading && ungraded ? ` · ${ungraded} active employees have no grade set` : ''}
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
            aria-label={`${viewRow.name} details`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div className="dep-name lg">
                <span className={`grd-chip lg ${toneOf(viewRow.name)}`}>{viewRow.name}</span>
                <div>
                  <b>{viewRow.designation || viewRow.name}</b>
                  <small>{viewRow.description}</small>
                </div>
              </div>
              <button type="button" className="emp-close" onClick={() => setViewRow(null)} aria-label="Close">
                <HrmsIcon name="x" size={18} />
              </button>
            </header>
            <dl>
              <dt>Structure</dt>
              <dd>{viewRow.structure || '—'}</dd>
              <dt>Fixed gross</dt>
              <dd>{inr(viewRow.base)} / month</dd>
              <dt>DA track</dt>
              <dd>{viewRow.da_slabs?.label || titleCase(viewRow.da_track)}</dd>
              <dt>DA per day</dt>
              <dd>{slabLine(viewRow.da_slabs) || '—'}</dd>
              <dt>Employees</dt>
              <dd>
                {viewRow.employees.length} with this grade
                {viewRow.byDesignation ? ` · ${viewRow.byDesignation} more by designation (grade not set)` : ''}
              </dd>
              <dt>Status</dt>
              <dd>{viewRow.status}</dd>
            </dl>
            {viewRow.employees.length ? (
              <div className="grd-emp-list">
                <p>Employees in {viewRow.name}</p>
                <ul>
                  {viewRow.employees.slice(0, 50).map((e) => (
                    <li key={e.id}>
                      <b>{e.name}</b>
                      <span>{e.designation || '—'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="emp-drawer-actions">
              <a className="emp-btn primary" href={editUrl(viewRow.name)} target="_blank" rel="noreferrer">
                <HrmsIcon name="pencil" size={15} /> Edit in ERP
              </a>
              <button type="button" className="emp-btn outline" onClick={() => copyText(viewRow.name)}>
                <HrmsIcon name="copy" size={15} /> Copy code
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {showStructure ? (
        <div className="emp-drawer-backdrop" role="presentation" onMouseDown={() => setShowStructure(false)}>
          <aside
            className="emp-drawer grd-structure"
            role="dialog"
            aria-modal="true"
            aria-label="Grade structure"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div className="dep-name lg">
                <span className="dep-name-icon" style={{ background: '#f1e8fd', color: '#9333ea' }}>
                  <HrmsIcon name="grades" size={22} />
                </span>
                <div>
                  <b>Grade Structure</b>
                  <small>How fixed gross is split, and flexible daily allowance</small>
                </div>
              </div>
              <button type="button" className="emp-close" onClick={() => setShowStructure(false)} aria-label="Close">
                <HrmsIcon name="x" size={18} />
              </button>
            </header>
            <div className="grd-arch">
              <div>
                <span>Basic</span>
                <b>{percentOf(architecture.basic_pct_of_gross)} of gross</b>
              </div>
              <div>
                <span>HRA</span>
                <b>{percentOf(architecture.hra_pct_of_basic)} of basic</b>
              </div>
              <div>
                <span>Dearness</span>
                <b>{percentOf(architecture.dearness_pct_of_basic)} of basic</b>
              </div>
              <div>
                <span>Food allowance</span>
                <b>{inr(architecture.food_allowance)} fixed</b>
              </div>
              <div>
                <span>Appraisal</span>
                <b>{architecture.appraisal || 'Balance of fixed gross'}</b>
              </div>
            </div>
            <p className="grd-sub">Bands by structure</p>
            {options.structures.map((s) => (
              <div key={s} className="grd-band-group">
                <h4>{s}</h4>
                {rows
                  .filter((r) => r.structure === s)
                  .sort((a, b) => a.base - b.base)
                  .map((r) => (
                    <div key={r.name} className="grd-band">
                      <span className={`grd-chip ${toneOf(r.name)}`}>{r.name}</span>
                      <span>{r.designation}</span>
                      <b>{inr(r.base)}</b>
                    </div>
                  ))}
              </div>
            ))}
            <p className="dep-hint">
              Daily allowance (HQ / Ex-HQ / overnight) is variable and paid on top of fixed gross, per the grade’s DA track.
            </p>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
