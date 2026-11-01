import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, PeopleDesignationRow } from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import { deskAppUrl } from '../../config';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';

const PER_PAGE_OPTIONS = [10, 25, 50];

function inr(value?: number | null) {
  return value ? `₹${Math.round(Number(value)).toLocaleString('en-IN')}` : '—';
}

function pct(count: number, total: number) {
  if (!total || !count) return 0;
  return Math.max(1, Math.round((count / total) * 100));
}

function pageList(page: number, pages: number): Array<number | '…'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: Array<number | '…'> = [1];
  const start = Math.max(2, Math.min(page - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(page + 1, 5));
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

function csvCell(value: unknown) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadDesignationsCsv(rows: PeopleDesignationRow[]) {
  const header = ['Designation', 'Grade', 'Structure', 'Indicative Base (INR)', 'Headcount', 'Status'];
  const lines = rows.map((r) => [
    r.designation,
    r.grade || '',
    r.structure || '',
    r.indicative_base ?? '',
    r.headcount,
    r.status || 'Active',
  ]);
  const text = [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `designations-${new Date().toISOString().slice(0, 10)}.csv`;
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

export function PeopleDesignationsPage() {
  const [rows, setRows] = useState<PeopleDesignationRow[]>([]);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [structureFilter, setStructureFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [viewRow, setViewRow] = useState<PeopleDesignationRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPeopleDesignations();
      setRows(res.data.designations || []);
      setTotalEmployees(res.data.total_employees ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load designations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [query, gradeFilter, structureFilter, statusFilter, perPage]);

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

  const options = useMemo(() => {
    const uniq = (values: Array<string | null | undefined>) =>
      Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b));
    return {
      grades: uniq(rows.map((r) => r.grade)),
      structures: uniq(rows.map((r) => r.structure)),
      statuses: uniq(rows.map((r) => r.status || 'Active')),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!gradeFilter || r.grade === gradeFilter) &&
        (!structureFilter || r.structure === structureFilter) &&
        (!statusFilter || (r.status || 'Active') === statusFilter) &&
        (!q || [r.designation, r.grade, r.structure].some((v) => (v || '').toLowerCase().includes(q))),
    );
  }, [rows, query, gradeFilter, structureFilter, statusFilter]);

  const withEmployees = rows.filter((r) => r.headcount > 0).length;
  const unused = rows.length - withEmployees;
  const activeCount = rows.filter((r) => (r.status || 'Active') === 'Active').length;
  const bases = rows.map((r) => Number(r.indicative_base || 0)).filter((v) => v > 0);
  const avgBase = bases.length ? bases.reduce((s, v) => s + v, 0) / bases.length : 0;

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  const firstShown = filtered.length ? (currentPage - 1) * perPage + 1 : 0;
  const lastShown = Math.min(currentPage * perPage, filtered.length);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.designation));
  const filtersActive = Boolean(query || gradeFilter || structureFilter || statusFilter);

  const editUrl = (name: string) => `${deskAppUrl()}/app/designation/${encodeURIComponent(name)}`;
  const newUrl = `${deskAppUrl()}/app/designation/new`;
  const employeesUrl = (name: string) => `/people/employees?designation=${encodeURIComponent(name)}`;

  const resetFilters = () => {
    setQuery('');
    setGradeFilter('');
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
      if (allOnPageSelected) pageRows.forEach((r) => next.delete(r.designation));
      else pageRows.forEach((r) => next.add(r.designation));
      return next;
    });
  };

  const openRowMenu = (id: string, anchor: HTMLElement) => {
    if (menuFor === id) {
      setMenuFor(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const menuHeight = 180;
    const top = rect.bottom + menuHeight + 8 > window.innerHeight ? rect.top - menuHeight - 4 : rect.bottom + 4;
    setMenuPos({ top: Math.max(8, top), left: Math.max(8, rect.right - 200) });
    setMenuFor(id);
  };

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setNotice('Designation copied');
    setMenuFor(null);
  };

  const kpis = [
    { icon: 'award', tone: 'blue', label: 'Total Designations', value: rows.length, sub: `${activeCount} active designations` },
    {
      icon: 'users',
      tone: 'green',
      label: 'Designations with Employees',
      value: withEmployees,
      sub: `${pct(withEmployees, rows.length)}% of total designations`,
    },
    {
      icon: 'userMinus',
      tone: 'violet',
      label: 'Unused Designations',
      value: unused,
      sub: `${pct(unused, rows.length)}% of total designations`,
    },
    { icon: 'coins', tone: 'amber', label: 'Average Indicative Base', value: inr(avgBase), sub: 'Across all designations' },
  ];

  return (
    <div className="hrms-list-page emp-page dep-page dsg-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon">
            <HrmsIcon name="award" size={28} />
          </span>
          <div>
            <h1>Designations</h1>
            <p>Manage job designations with grade, structure, salary and headcount</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <Link className="emp-btn outline lg" to="/people/grades">
            <HrmsIcon name="orgChart" size={17} />
            Grade Structure
          </Link>
          <a className="emp-btn primary lg" href={newUrl} target="_blank" rel="noreferrer">
            <HrmsIcon name="plus" size={18} />
            Add Designation
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
        <div className="dsg-filters">
          <label className="emp-search dsg-search">
            <HrmsIcon name="search" size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by designation, grade or structure..."
              aria-label="Search designations"
            />
          </label>
          <FilterDropdown label="Grade" value={gradeFilter} allLabel="All Grades" options={options.grades} onChange={setGradeFilter} />
          <FilterDropdown
            label="Structure"
            value={structureFilter}
            allLabel="All Structures"
            options={options.structures}
            onChange={setStructureFilter}
          />
          <FilterDropdown label="Status" value={statusFilter} allLabel="All Status" options={options.statuses} onChange={setStatusFilter} />
          <button className="emp-btn outline dsg-reset" type="button" onClick={resetFilters} disabled={!filtersActive && !selected.size}>
            <HrmsIcon name="reset" size={16} />
            Reset
          </button>
        </div>

        {selected.size || notice ? (
          <div className="dsg-selbar">
            {selected.size ? (
              <>
                <span>{selected.size} selected</span>
                <button
                  className="emp-btn outline"
                  type="button"
                  onClick={() => downloadDesignationsCsv(rows.filter((r) => selected.has(r.designation)))}
                >
                  <HrmsIcon name="download" size={15} /> Export selected
                </button>
                <button className="emp-btn ghost" type="button" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </>
            ) : null}
            {notice ? <span className="emp-notice">{notice}</span> : null}
          </div>
        ) : null}

        <div className="emp-table-wrap">
          <table className="emp-table dsg-table">
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
                <th className="dep-col-num">#</th>
                <th>Designation</th>
                <th>Grade</th>
                <th>Structure</th>
                <th>Indicative Base</th>
                <th>Headcount</th>
                <th>Status</th>
                <th className="emp-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="emp-empty">
                    Loading designations…
                  </td>
                </tr>
              ) : null}
              {!loading &&
                pageRows.map((row, i) => (
                  <tr key={row.designation} className={selected.has(row.designation) ? 'selected' : ''}>
                    <td className="emp-col-check">
                      <input
                        type="checkbox"
                        checked={selected.has(row.designation)}
                        onChange={() => toggleRow(row.designation)}
                        aria-label={`Select ${row.designation}`}
                      />
                    </td>
                    <td className="dep-col-num">{(currentPage - 1) * perPage + i + 1}</td>
                    <td className="dsg-name">{row.designation}</td>
                    <td className="emp-mono" title={row.grade_inferred ? 'Grade inferred from designation name' : undefined}>
                      {row.grade || '—'}
                      {row.grade_inferred ? <sup className="dsg-inferred">*</sup> : null}
                    </td>
                    <td>{row.structure || '—'}</td>
                    <td className="emp-mono">{inr(row.indicative_base)}</td>
                    <td>
                      <b className={row.headcount ? 'dsg-count' : 'dsg-count zero'}>{row.headcount}</b>
                    </td>
                    <td>
                      <span className={`emp-pill ${(row.status || 'Active') === 'Active' ? 'green' : 'amber'}`}>
                        {row.status || 'Active'}
                      </span>
                    </td>
                    <td className="emp-col-actions">
                      <div className="emp-actions">
                        <button type="button" title="View" aria-label={`View ${row.designation}`} onClick={() => setViewRow(row)}>
                          <HrmsIcon name="eye" size={17} />
                        </button>
                        {row.status === 'Missing record' ? (
                          <button type="button" disabled title="No Designation record in ERP" aria-label={`Edit ${row.designation}`}>
                            <HrmsIcon name="pencil" size={16} />
                          </button>
                        ) : (
                          <a
                            href={editUrl(row.designation)}
                            target="_blank"
                            rel="noreferrer"
                            title="Edit in ERP"
                            aria-label={`Edit ${row.designation}`}
                          >
                            <HrmsIcon name="pencil" size={16} />
                          </a>
                        )}
                        <div className="emp-filter-wrap">
                          <button
                            type="button"
                            className="emp-popover-trigger"
                            title="More"
                            aria-label={`More actions for ${row.designation}`}
                            aria-expanded={menuFor === row.designation}
                            onClick={(e) => openRowMenu(row.designation, e.currentTarget)}
                          >
                            <HrmsIcon name="moreV" size={18} strokeWidth={3} />
                          </button>
                          {menuFor === row.designation ? (
                            <div className="emp-popover emp-menu" style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}>
                              <button type="button" onClick={() => { setViewRow(row); setMenuFor(null); }}>
                                <HrmsIcon name="eye" size={15} /> View details
                              </button>
                              <Link to={employeesUrl(row.designation)} onClick={() => setMenuFor(null)}>
                                <HrmsIcon name="users" size={15} /> View employees
                              </Link>
                              <Link to="/people/grades" onClick={() => setMenuFor(null)}>
                                <HrmsIcon name="grades" size={15} /> Grade structure
                              </Link>
                              <button type="button" onClick={() => copyText(row.designation)}>
                                <HrmsIcon name="copy" size={15} /> Copy name
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
                  <td colSpan={9} className="emp-empty">
                    {rows.length ? 'No designations match these filters.' : 'No designations found.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <footer className="emp-pager">
          <span>
            Showing {firstShown} to {lastShown} of {filtered.length} designations
          </span>
          <div className="emp-pager-right">
            <button className="emp-btn outline dsg-export" type="button" onClick={() => downloadDesignationsCsv(filtered)} disabled={!filtered.length}>
              <HrmsIcon name="download" size={15} /> Export
            </button>
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
              {pageList(currentPage, pages).map((p, idx) =>
                p === '…' ? (
                  <span key={`gap-${idx}`} className="emp-gap">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={p === currentPage ? 'on' : ''}
                    aria-current={p === currentPage ? 'page' : undefined}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                ),
              )}
              <button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} aria-label="Next page">
                <HrmsIcon name="chevronRight" size={16} />
              </button>
            </nav>
          </div>
        </footer>
      </section>

      {rows.some((r) => r.grade_inferred) ? (
        <p className="dep-hint">* Grade inferred from the designation name — the same rule payroll uses when no explicit mapping exists.</p>
      ) : null}

      {viewRow ? (
        <div className="emp-drawer-backdrop" role="presentation" onMouseDown={() => setViewRow(null)}>
          <aside
            className="emp-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`${viewRow.designation} details`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div className="dep-name lg">
                <span className="dep-name-icon" style={{ background: '#e3ecfd', color: '#2563eb' }}>
                  <HrmsIcon name="award" size={22} />
                </span>
                <div>
                  <b>{viewRow.designation}</b>
                  <small>{viewRow.grade_description || viewRow.grade || 'Designation'}</small>
                </div>
              </div>
              <button type="button" className="emp-close" onClick={() => setViewRow(null)} aria-label="Close">
                <HrmsIcon name="x" size={18} />
              </button>
            </header>
            <dl>
              <dt>Grade</dt>
              <dd>
                {viewRow.grade || '—'}
                {viewRow.grade_inferred ? ' (inferred)' : ''}
              </dd>
              <dt>Structure</dt>
              <dd>{viewRow.structure || '—'}</dd>
              <dt>Indicative base</dt>
              <dd>{inr(viewRow.indicative_base)} / month</dd>
              <dt>DA track</dt>
              <dd style={{ textTransform: 'capitalize' }}>{viewRow.da_track || '—'}</dd>
              <dt>Headcount</dt>
              <dd>
                {viewRow.headcount} ({pct(viewRow.headcount, totalEmployees)}% of workforce)
              </dd>
              <dt>Status</dt>
              <dd>{viewRow.status || 'Active'}</dd>
              <dt>Created on</dt>
              <dd>{viewRow.created_on || '—'}</dd>
            </dl>
            <div className="emp-drawer-actions">
              <Link className="emp-btn primary" to={employeesUrl(viewRow.designation)}>
                <HrmsIcon name="users" size={15} /> View employees
              </Link>
              {viewRow.status !== 'Missing record' ? (
                <a className="emp-btn outline" href={editUrl(viewRow.designation)} target="_blank" rel="noreferrer">
                  <HrmsIcon name="pencil" size={15} /> Edit in ERP
                </a>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
