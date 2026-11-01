import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, JobApplicationSummary, PeopleEmployeeRow } from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import { assetUrl, deskAppUrl } from '../../config';
import './people-hrms-shell.css';
import './people-employees.css';

type HireMode = 'applicant' | 'manual';

type ColumnKey =
  | 'employee'
  | 'id'
  | 'department'
  | 'designation'
  | 'geofence'
  | 'status'
  | 'joined'
  | 'location'
  | 'email';

const COLUMNS: Array<{ key: ColumnKey; label: string; sortable: boolean; defaultHidden?: boolean }> = [
  { key: 'employee', label: 'Employee', sortable: true },
  { key: 'id', label: 'Employee ID', sortable: true },
  { key: 'department', label: 'Department', sortable: true },
  { key: 'designation', label: 'Designation', sortable: true },
  { key: 'geofence', label: 'Geofence', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'joined', label: 'Joined', sortable: true },
  { key: 'location', label: 'Work Location', sortable: true, defaultHidden: true },
  { key: 'email', label: 'Email', sortable: true },
];

const AVATAR_TONES = ['#4f46e5', '#0d9488', '#d97706', '#db2777', '#2563eb', '#16a34a', '#7c3aed', '#0891b2'];
const PER_PAGE_OPTIONS = [10, 25, 50, 100];

function initialsOf(name?: string) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

function toneOf(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function sortValue(row: PeopleEmployeeRow, key: ColumnKey): string | number {
  switch (key) {
    case 'employee':
      return (row.name || '').toLowerCase();
    case 'id':
      return row.id || '';
    case 'department':
      return (row.department || '').toLowerCase();
    case 'designation':
      return (row.designation || '').toLowerCase();
    case 'geofence':
      return row.geofence_enabled ? row.geofence_radius_m || 250 : -1;
    case 'status':
      return (row.status || '').toLowerCase();
    case 'joined':
      return row.date_of_joining || '';
    case 'location':
      return (row.branch || '').toLowerCase();
    case 'email':
      return (row.email || '').toLowerCase();
    default:
      return '';
  }
}

function csvCell(value: unknown) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadEmployeesCsv(rows: PeopleEmployeeRow[]) {
  const header = ['Employee ID', 'Name', 'Phone', 'Email', 'Department', 'Designation', 'Work Location', 'Status', 'Joined', 'Geofence (m)'];
  const lines = rows.map((r) => [
    r.id,
    r.name,
    r.phone || '',
    r.email || '',
    r.department || '',
    r.designation || '',
    r.branch || '',
    r.status || '',
    r.date_of_joining || '',
    r.geofence_enabled ? r.geofence_radius_m || 250 : '',
  ]);
  const text = [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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

function Avatar({ row }: { row: PeopleEmployeeRow }) {
  const [broken, setBroken] = useState(false);
  if (row.photo && !broken) {
    return <img className="emp-avatar" src={assetUrl(row.photo)} alt="" onError={() => setBroken(true)} />;
  }
  const tone = toneOf(row.id || row.name);
  return (
    <span className="emp-avatar" style={{ background: `${tone}1f`, color: tone }}>
      {initialsOf(row.name)}
    </span>
  );
}

function FilterSelect({
  icon,
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  icon: string;
  label: string;
  value: string;
  allLabel: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={`emp-filter${value ? ' active' : ''}`}>
      <HrmsIcon name={icon} size={18} />
      <span className="emp-filter-text">
        <b>{label}</b>
        <span>{value || allLabel}</span>
      </span>
      <HrmsIcon name="chevronDown" size={16} className="emp-filter-caret" />
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

type CreateResult = {
  employee: string;
  user: string;
  temporary_password?: string;
  monthly_ctc?: number;
  already_exists?: boolean;
  already_hired?: boolean;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

function emptyManualForm() {
  return {
    full_name: '',
    email: '',
    mobile: '',
    dob: '',
    gender: 'Male',
    department: '',
    designation: '',
    joining_date: todayIso(),
    salary_offered: '35000',
    franchisee: '',
  };
}

export function PeopleEmployeesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const qParam = (searchParams.get('q') || '').trim();
  const [rows, setRows] = useState<PeopleEmployeeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterQ, setFilterQ] = useState(qParam);
  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');
  const [mode, setMode] = useState<HireMode>('applicant');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [applications, setApplications] = useState<JobApplicationSummary[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState('');
  const [manual, setManual] = useState(emptyManualForm);
  const [hireMeta, setHireMeta] = useState({
    designation: '',
    department: '',
    joining_date: todayIso(),
    salary_offered: '35000',
    franchisee: '',
  });
  const [showFilters, setShowFilters] = useState(true);
  const [deptFilter, setDeptFilter] = useState(() => searchParams.get('department') || '');
  const [desigFilter, setDesigFilter] = useState(() => searchParams.get('designation') || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [joinFrom, setJoinFrom] = useState('');
  const [joinTo, setJoinTo] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [sort, setSort] = useState<{ key: ColumnKey; dir: 'asc' | 'desc' }>({ key: 'id', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [hiddenCols, setHiddenCols] = useState<Set<ColumnKey>>(
    () => new Set(COLUMNS.filter((c) => c.defaultHidden).map((c) => c.key)),
  );
  const [colsOpen, setColsOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [viewRow, setViewRow] = useState<PeopleEmployeeRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadEmployees = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPeopleEmployees({ limit: 500, q: q || undefined });
      setRows(res.data.employees || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load employees');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setFilterQ(qParam);
    void loadEmployees(qParam);
  }, [loadEmployees, qParam]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowForm(true);
    }
  }, [searchParams]);

  const openForm = () => {
    setShowForm(true);
    setCreateResult(null);
    setFormError(null);
    setSearchParams({ new: '1' }, { replace: true });
  };

  const closeForm = () => {
    setShowForm(false);
    setFormError(null);
    setCreateResult(null);
    setSelectedApplication('');
    setManual(emptyManualForm());
    setHireMeta({
      designation: '',
      department: '',
      joining_date: todayIso(),
      salary_offered: '35000',
      franchisee: '',
    });
    if (searchParams.get('new') === '1') {
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const hireReadyApplications = useMemo(
    () => applications.filter((row) => !row.hec_employee),
    [applications],
  );

  const selectedApplicant = useMemo(
    () => applications.find((row) => row.name === selectedApplication) || null,
    [applications, selectedApplication],
  );

  useEffect(() => {
    if (!showForm || mode !== 'applicant') return;
    let active = true;
    void (async () => {
      setApplicationsLoading(true);
      try {
        const res = await api.listJobApplications({ limit: 200 });
        if (active) setApplications(res.data.applications || []);
      } catch {
        if (active) setApplications([]);
      } finally {
        if (active) setApplicationsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [showForm, mode]);

  useEffect(() => {
    if (!selectedApplicant) return;
    setHireMeta((prev) => ({
      ...prev,
      designation: prev.designation || '',
      department: prev.department || '',
    }));
  }, [selectedApplicant]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setCreateResult(null);
    try {
      const salary = Number(
        mode === 'applicant' ? hireMeta.salary_offered : manual.salary_offered,
      );
      const payload =
        mode === 'applicant'
          ? {
              application: selectedApplication,
              designation: hireMeta.designation || undefined,
              department: hireMeta.department || undefined,
              joining_date: hireMeta.joining_date || undefined,
              salary_offered: Number.isFinite(salary) ? salary : undefined,
              franchisee: hireMeta.franchisee || undefined,
            }
          : {
              full_name: manual.full_name.trim(),
              email: manual.email.trim(),
              mobile: manual.mobile.trim() || undefined,
              dob: manual.dob || undefined,
              gender: manual.gender || undefined,
              department: manual.department.trim() || undefined,
              designation: manual.designation.trim() || undefined,
              joining_date: manual.joining_date || undefined,
              salary_offered: Number.isFinite(salary) ? salary : undefined,
              franchisee: manual.franchisee.trim() || undefined,
            };

      if (mode === 'applicant' && !payload.application) {
        throw new Error('Select a hired applicant to continue');
      }
      if (mode === 'manual' && (!payload.full_name || !payload.email)) {
        throw new Error('Full name and work email are required');
      }

      const res = await api.createPeopleEmployee(payload);
      setCreateResult(res.data);
      await loadEmployees(filterQ);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create employee');
    } finally {
      setBusy(false);
    }
  }

  const applyFilter = (event: FormEvent) => {
    event.preventDefault();
    const next = filterQ.trim();
    const params = new URLSearchParams(searchParams);
    if (next) params.set('q', next);
    else params.delete('q');
    if (params.get('new') === '1') params.delete('new');
    setSearchParams(params, { replace: true });
  };

  const options = useMemo(() => {
    const uniq = (values: Array<string | null | undefined>) =>
      Array.from(new Set(values.filter((v): v is string => Boolean(v && v.trim())))).sort((a, b) =>
        a.localeCompare(b),
      );
    return {
      departments: uniq(rows.map((r) => r.department)),
      designations: uniq(rows.map((r) => r.designation)),
      statuses: uniq(rows.map((r) => r.status || 'Active')),
      locations: uniq(rows.map((r) => r.branch)),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const out = rows.filter(
      (r) =>
        (!deptFilter || r.department === deptFilter) &&
        (!desigFilter || r.designation === desigFilter) &&
        (!statusFilter || (r.status || 'Active') === statusFilter) &&
        (!locationFilter || r.branch === locationFilter) &&
        (!joinFrom || (r.date_of_joining || '') >= joinFrom) &&
        (!joinTo || ((r.date_of_joining || '') !== '' && (r.date_of_joining || '') <= joinTo)),
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    return out.sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, deptFilter, desigFilter, statusFilter, locationFilter, joinFrom, joinTo, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  const firstShown = filtered.length ? (currentPage - 1) * perPage + 1 : 0;
  const lastShown = Math.min(currentPage * perPage, filtered.length);
  const visibleCols = COLUMNS.filter((c) => !hiddenCols.has(c.key));
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const filtersActive = Boolean(deptFilter || desigFilter || statusFilter || locationFilter || joinFrom || joinTo);

  useEffect(() => {
    setPage(1);
  }, [deptFilter, desigFilter, statusFilter, locationFilter, joinFrom, joinTo, perPage, qParam]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!menuFor && !colsOpen && !dateOpen) return;
    const close = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement;
      if (target.closest('.emp-popover, .emp-popover-trigger')) return;
      setMenuFor(null);
      setColsOpen(false);
      setDateOpen(false);
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
  }, [menuFor, colsOpen, dateOpen]);

  const openRowMenu = (id: string, anchor: HTMLElement) => {
    if (menuFor === id) {
      setMenuFor(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const menuHeight = 220;
    const top = rect.bottom + menuHeight + 8 > window.innerHeight ? rect.top - menuHeight - 4 : rect.bottom + 4;
    setMenuPos({ top: Math.max(8, top), left: Math.max(8, rect.right - 200) });
    setMenuFor(id);
  };

  const resetFilters = () => {
    setDeptFilter('');
    setDesigFilter('');
    setStatusFilter('');
    setLocationFilter('');
    setJoinFrom('');
    setJoinTo('');
    setFilterQ('');
    setSelected(new Set());
    if (qParam || searchParams.get('department') || searchParams.get('designation')) {
      const params = new URLSearchParams(searchParams);
      params.delete('q');
      params.delete('department');
      params.delete('designation');
      setSearchParams(params, { replace: true });
    }
  };

  const toggleSort = (key: ColumnKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const onBulkAction = (action: string) => {
    const chosen = rows.filter((r) => selected.has(r.id));
    if (!chosen.length) return;
    if (action === 'export') downloadEmployeesCsv(chosen);
    if (action === 'copy-emails') {
      const emails = chosen.map((r) => r.email).filter(Boolean).join(', ');
      void navigator.clipboard?.writeText(emails);
      setNotice(`Copied ${chosen.filter((r) => r.email).length} email address(es)`);
    }
    if (action === 'clear') setSelected(new Set());
  };

  const copyText = (text: string, label: string) => {
    void navigator.clipboard?.writeText(text);
    setNotice(`${label} copied`);
    setMenuFor(null);
  };

  const editUrl = (id: string) => `${deskAppUrl()}/app/employee/${encodeURIComponent(id)}`;
  const dateLabel =
    joinFrom || joinTo ? `${joinFrom || 'Any'} → ${joinTo || 'Any'}` : 'Select Date Range';

  const renderCell = (row: PeopleEmployeeRow, key: ColumnKey) => {
    switch (key) {
      case 'employee':
        return (
          <div className="emp-person">
            <Avatar row={row} />
            <div>
              <b>{row.name}</b>
              <small>{row.phone || '—'}</small>
            </div>
          </div>
        );
      case 'id':
        return <span className="emp-mono">{row.id}</span>;
      case 'department':
        return row.department || '—';
      case 'designation':
        return row.designation || '—';
      case 'geofence':
        return row.geofence_enabled ? (
          <span
            className={`emp-pill ${(row.geofence_radius_m || 250) > 150 ? 'blue' : 'green'}`}
            title={row.geofence_label || undefined}
          >
            {row.geofence_radius_m || 250}m
          </span>
        ) : (
          <span className="emp-pill muted">Off</span>
        );
      case 'status':
        return (
          <span className={`emp-pill ${/active/i.test(row.status || 'Active') ? 'green' : 'muted'}`}>
            {row.status || 'Active'}
          </span>
        );
      case 'joined':
        return row.date_of_joining || '—';
      case 'location':
        return row.branch || '—';
      case 'email':
        return row.email ? (
          <span className="emp-email" title={row.email}>
            {row.email}
          </span>
        ) : (
          '—'
        );
      default:
        return null;
    }
  };

  return (
    <div className="hrms-list-page emp-page">
      <div className="emp-head">
        <div>
          <h1>Employees</h1>
          <p>
            Active employee directory · {total} records
            {qParam ? ` · search “${qParam}”` : ''}
          </p>
        </div>
        <button className="emp-btn primary lg" type="button" onClick={openForm}>
          <HrmsIcon name="plus" size={18} />
          Add Employee
        </button>
      </div>

      <section className="emp-card emp-search-card">
        <form className="emp-search-row" onSubmit={applyFilter}>
          <label className="emp-search">
            <HrmsIcon name="search" size={18} />
            <input
              value={filterQ}
              onChange={(e) => setFilterQ(e.target.value)}
              placeholder="Search by name, employee ID, department, designation, email or phone..."
              aria-label="Search employees"
            />
          </label>
          <button className="emp-btn primary" type="submit">
            Search
          </button>
          <button
            className={`emp-btn outline${showFilters ? ' on' : ''}`}
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
          >
            <HrmsIcon name="filter" size={16} />
            Filters
            <HrmsIcon name="chevronDown" size={16} />
          </button>
        </form>

        {showFilters ? (
          <div className="emp-filters">
            <FilterSelect
              icon="building"
              label="Department"
              value={deptFilter}
              allLabel="All Departments"
              options={options.departments}
              onChange={setDeptFilter}
            />
            <FilterSelect
              icon="badge"
              label="Designation"
              value={desigFilter}
              allLabel="All Designations"
              options={options.designations}
              onChange={setDesigFilter}
            />
            <FilterSelect
              icon="shield"
              label="Status"
              value={statusFilter}
              allLabel="All Status"
              options={options.statuses}
              onChange={setStatusFilter}
            />
            <div className="emp-filter-wrap">
              <button
                type="button"
                className={`emp-filter emp-popover-trigger${joinFrom || joinTo ? ' active' : ''}`}
                onClick={() => setDateOpen((v) => !v)}
                aria-expanded={dateOpen}
              >
                <HrmsIcon name="calendar" size={18} />
                <span className="emp-filter-text">
                  <b>Joining Date</b>
                  <span>{dateLabel}</span>
                </span>
                <HrmsIcon name="chevronDown" size={16} className="emp-filter-caret" />
              </button>
              {dateOpen ? (
                <div className="emp-popover emp-date-pop">
                  <label>
                    From
                    <input type="date" value={joinFrom} max={joinTo || undefined} onChange={(e) => setJoinFrom(e.target.value)} />
                  </label>
                  <label>
                    To
                    <input type="date" value={joinTo} min={joinFrom || undefined} onChange={(e) => setJoinTo(e.target.value)} />
                  </label>
                  <div className="emp-pop-actions">
                    <button
                      type="button"
                      className="emp-btn ghost"
                      onClick={() => {
                        setJoinFrom('');
                        setJoinTo('');
                      }}
                    >
                      Clear
                    </button>
                    <button type="button" className="emp-btn primary" onClick={() => setDateOpen(false)}>
                      Apply
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <FilterSelect
              icon="pin"
              label="Work Location"
              value={locationFilter}
              allLabel="All Locations"
              options={options.locations}
              onChange={setLocationFilter}
            />
            <button
              className="emp-btn outline emp-reset"
              type="button"
              onClick={resetFilters}
              disabled={!filtersActive && !qParam && !filterQ}
            >
              <HrmsIcon name="reset" size={16} />
              Reset
            </button>
          </div>
        ) : null}
      </section>

      {error ? <div className="people-alert err">{error}</div> : null}

      <section className="emp-card emp-table-card">
        <div className="emp-toolbar">
          <label className="emp-check-label">
            <input
              type="checkbox"
              checked={allOnPageSelected}
              onChange={togglePage}
              disabled={!pageRows.length}
              aria-label="Select all on this page"
            />
            <span>{selected.size} selected</span>
          </label>
          <select
            className="emp-bulk"
            value=""
            disabled={!selected.size}
            onChange={(e) => onBulkAction(e.target.value)}
            aria-label="Bulk actions"
          >
            <option value="">Bulk Actions</option>
            <option value="export">Export selected (CSV)</option>
            <option value="copy-emails">Copy email addresses</option>
            <option value="clear">Clear selection</option>
          </select>
          {notice ? <span className="emp-notice">{notice}</span> : null}
          <span className="emp-toolbar-spacer" />
          <button
            className="emp-btn outline"
            type="button"
            onClick={() => downloadEmployeesCsv(selected.size ? rows.filter((r) => selected.has(r.id)) : filtered)}
            disabled={!filtered.length}
          >
            <HrmsIcon name="download" size={16} />
            Export
          </button>
          <div className="emp-filter-wrap">
            <button
              className="emp-btn outline icon emp-popover-trigger"
              type="button"
              onClick={() => setColsOpen((v) => !v)}
              aria-label="Choose columns"
              title="Choose columns"
              aria-expanded={colsOpen}
            >
              <HrmsIcon name="columns" size={18} />
            </button>
            {colsOpen ? (
              <div className="emp-popover emp-cols-pop">
                <p>Show columns</p>
                {COLUMNS.map((c) => (
                  <label key={c.key}>
                    <input
                      type="checkbox"
                      checked={!hiddenCols.has(c.key)}
                      disabled={c.key === 'employee'}
                      onChange={() =>
                        setHiddenCols((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.key)) next.delete(c.key);
                          else next.add(c.key);
                          return next;
                        })
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="emp-table-wrap">
          <table className="emp-table">
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
                {visibleCols.map((c) => (
                  <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="emp-sort" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      <HrmsIcon
                        name="sort"
                        size={13}
                        className={sort.key === c.key ? `on ${sort.dir}` : ''}
                      />
                    </button>
                  </th>
                ))}
                <th className="emp-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={visibleCols.length + 2} className="emp-empty">
                    Loading employees…
                  </td>
                </tr>
              ) : null}
              {!loading &&
                pageRows.map((row) => (
                  <tr key={row.id} className={selected.has(row.id) ? 'selected' : ''}>
                    <td className="emp-col-check">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        aria-label={`Select ${row.name}`}
                      />
                    </td>
                    {visibleCols.map((c) => (
                      <td key={c.key}>{renderCell(row, c.key)}</td>
                    ))}
                    <td className="emp-col-actions">
                      <div className="emp-actions">
                        <button type="button" title="View" aria-label={`View ${row.name}`} onClick={() => setViewRow(row)}>
                          <HrmsIcon name="eye" size={17} />
                        </button>
                        <a href={editUrl(row.id)} target="_blank" rel="noreferrer" title="Edit in ERP" aria-label={`Edit ${row.name}`}>
                          <HrmsIcon name="pencil" size={16} />
                        </a>
                        <div className="emp-filter-wrap">
                          <button
                            type="button"
                            className="emp-popover-trigger"
                            title="More"
                            aria-label={`More actions for ${row.name}`}
                            aria-expanded={menuFor === row.id}
                            onClick={(e) => openRowMenu(row.id, e.currentTarget)}
                          >
                            <HrmsIcon name="moreV" size={18} strokeWidth={3} />
                          </button>
                          {menuFor === row.id ? (
                            <div className="emp-popover emp-menu" style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}>
                              <button type="button" onClick={() => { setViewRow(row); setMenuFor(null); }}>
                                <HrmsIcon name="eye" size={15} /> View details
                              </button>
                              {row.email ? (
                                <a href={`mailto:${row.email}`} onClick={() => setMenuFor(null)}>
                                  <HrmsIcon name="mail" size={15} /> Send email
                                </a>
                              ) : null}
                              {row.phone ? (
                                <a href={`tel:${row.phone}`} onClick={() => setMenuFor(null)}>
                                  <HrmsIcon name="phone" size={15} /> Call
                                </a>
                              ) : null}
                              <button type="button" onClick={() => copyText(row.id, 'Employee ID')}>
                                <HrmsIcon name="copy" size={15} /> Copy employee ID
                              </button>
                              <Link to="/people/attendance" onClick={() => setMenuFor(null)}>
                                <HrmsIcon name="clock" size={15} /> Attendance
                              </Link>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              {!loading && !pageRows.length ? (
                <tr>
                  <td colSpan={visibleCols.length + 2} className="emp-empty">
                    {rows.length ? 'No employees match these filters.' : 'No active employees found.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <footer className="emp-pager">
          <span>
            Showing {firstShown} to {lastShown} of {filtered.length} records
          </span>
          <div className="emp-pager-right">
            <select
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value))}
              aria-label="Rows per page"
            >
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
              {pageList(currentPage, pages).map((p, i) =>
                p === '…' ? (
                  <span key={`gap-${i}`} className="emp-gap">
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
              <div className="emp-person lg">
                <Avatar row={viewRow} />
                <div>
                  <b>{viewRow.name}</b>
                  <small>{viewRow.designation || 'Employee'}</small>
                </div>
              </div>
              <button type="button" className="emp-close" onClick={() => setViewRow(null)} aria-label="Close">
                <HrmsIcon name="x" size={18} />
              </button>
            </header>
            <dl>
              <dt>Employee ID</dt>
              <dd className="emp-mono">{viewRow.id}</dd>
              <dt>Department</dt>
              <dd>{viewRow.department || '—'}</dd>
              <dt>Designation</dt>
              <dd>{viewRow.designation || '—'}</dd>
              <dt>Work location</dt>
              <dd>{viewRow.branch || '—'}</dd>
              <dt>Status</dt>
              <dd>{viewRow.status || 'Active'}</dd>
              <dt>Joined</dt>
              <dd>{viewRow.date_of_joining || '—'}</dd>
              <dt>Phone</dt>
              <dd>{viewRow.phone ? <a href={`tel:${viewRow.phone}`}>{viewRow.phone}</a> : '—'}</dd>
              <dt>Email</dt>
              <dd>{viewRow.email ? <a href={`mailto:${viewRow.email}`}>{viewRow.email}</a> : '—'}</dd>
              <dt>Geofence</dt>
              <dd>
                {viewRow.geofence_enabled
                  ? `${viewRow.geofence_radius_m || 250}m${viewRow.geofence_label ? ` · ${viewRow.geofence_label}` : ''}`
                  : 'Off'}
              </dd>
            </dl>
            <div className="emp-drawer-actions">
              <a className="emp-btn primary" href={editUrl(viewRow.id)} target="_blank" rel="noreferrer">
                <HrmsIcon name="pencil" size={15} /> Edit in ERP
              </a>
              <button type="button" className="emp-btn outline" onClick={() => copyText(viewRow.id, 'Employee ID')}>
                <HrmsIcon name="copy" size={15} /> Copy ID
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {showForm ? (
        <div className="hrms-modal-backdrop" role="presentation" onMouseDown={closeForm}>
          <section
            className="hrms-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-employee-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="hrms-modal-head">
              <div>
                <p className="hrms-modal-kicker">People HRMS</p>
                <h2 id="add-employee-title">Add New Employee</h2>
                <p className="muted">
                  Create an employee profile with HR-EMP ID, payroll setup, and onboarding checklist.
                </p>
              </div>
              <button className="hrms-modal-close" type="button" onClick={closeForm} aria-label="Close">
                ×
              </button>
            </header>

            <div className="hrms-mode-tabs">
              <button
                type="button"
                className={mode === 'applicant' ? 'active' : ''}
                onClick={() => setMode('applicant')}
              >
                From hired applicant
              </button>
              <button
                type="button"
                className={mode === 'manual' ? 'active' : ''}
                onClick={() => setMode('manual')}
              >
                Manual entry
              </button>
            </div>

            {formError ? <div className="people-alert err">{formError}</div> : null}
            {createResult ? (
              <div className="people-alert ok">
                <p>
                  <strong>
                    {createResult.already_exists || createResult.already_hired
                      ? 'Employee already on file'
                      : 'Employee created'}
                  </strong>{' '}
                  · User {createResult.user} · ID {createResult.employee}
                </p>
                {createResult.monthly_ctc ? (
                  <p>Monthly CTC ₹{Number(createResult.monthly_ctc).toLocaleString('en-IN')}</p>
                ) : null}
                {createResult.temporary_password ? (
                  <p>
                    Temporary password: <code>{createResult.temporary_password}</code>
                  </p>
                ) : null}
                <p>
                  <Link to="/people/onboarding">View onboarding</Link>
                  {' · '}
                  <button className="hrms-link-btn" type="button" onClick={closeForm}>
                    Close
                  </button>
                </p>
              </div>
            ) : (
              <form className="hrms-employee-form" onSubmit={(event) => void onSubmit(event)}>
                {mode === 'applicant' ? (
                  <>
                    <label>
                      Selected applicant
                      <select
                        required
                        value={selectedApplication}
                        disabled={applicationsLoading || busy}
                        onChange={(event) => setSelectedApplication(event.target.value)}
                      >
                        <option value="">
                          {applicationsLoading ? 'Loading applicants…' : 'Choose applicant…'}
                        </option>
                        {hireReadyApplications.map((row) => (
                          <option key={row.name} value={row.name}>
                            {row.applicant_name || row.name} · {row.email_id || 'no email'} ·{' '}
                            {row.pipeline_stage || 'Received'}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedApplicant ? (
                      <p className="muted hrms-applicant-hint">
                        {selectedApplicant.job_opening || 'Role pending'} ·{' '}
                        {selectedApplicant.phone_number || '—'} · Applied{' '}
                        {selectedApplicant.applied_on || '—'}
                      </p>
                    ) : null}
                    {!applicationsLoading && !hireReadyApplications.length ? (
                      <p className="muted">
                        No pending applicants without an employee ID. Use manual entry or hire from the{' '}
                        <Link to="/people/recruitment?tab=candidates&stage=Offer">Hiring desk</Link>.
                      </p>
                    ) : null}
                    <div className="hrms-form-grid">
                      <label>
                        Designation
                        <input
                          value={hireMeta.designation}
                          disabled={busy}
                          onChange={(event) =>
                            setHireMeta((prev) => ({ ...prev, designation: event.target.value }))
                          }
                          placeholder="e.g. Lab Technician"
                        />
                      </label>
                      <label>
                        Department
                        <input
                          value={hireMeta.department}
                          disabled={busy}
                          onChange={(event) =>
                            setHireMeta((prev) => ({ ...prev, department: event.target.value }))
                          }
                          placeholder="e.g. Laboratory"
                        />
                      </label>
                      <label>
                        Joining date
                        <input
                          type="date"
                          value={hireMeta.joining_date}
                          disabled={busy}
                          onChange={(event) =>
                            setHireMeta((prev) => ({ ...prev, joining_date: event.target.value }))
                          }
                        />
                      </label>
                      <label>
                        Monthly CTC (₹)
                        <input
                          type="number"
                          min={0}
                          value={hireMeta.salary_offered}
                          disabled={busy}
                          onChange={(event) =>
                            setHireMeta((prev) => ({ ...prev, salary_offered: event.target.value }))
                          }
                        />
                      </label>
                      <label className="span-2">
                        Franchise hub (optional)
                        <input
                          value={hireMeta.franchisee}
                          disabled={busy}
                          onChange={(event) =>
                            setHireMeta((prev) => ({ ...prev, franchisee: event.target.value }))
                          }
                          placeholder="Franchisee Profile name"
                        />
                      </label>
                    </div>
                  </>
                ) : (
                  <div className="hrms-form-grid">
                    <label className="span-2">
                      Full name
                      <input
                        required
                        value={manual.full_name}
                        disabled={busy}
                        onChange={(event) =>
                          setManual((prev) => ({ ...prev, full_name: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Work email
                      <input
                        required
                        type="email"
                        value={manual.email}
                        disabled={busy}
                        onChange={(event) => setManual((prev) => ({ ...prev, email: event.target.value }))}
                      />
                    </label>
                    <label>
                      Mobile
                      <input
                        value={manual.mobile}
                        disabled={busy}
                        onChange={(event) => setManual((prev) => ({ ...prev, mobile: event.target.value }))}
                      />
                    </label>
                    <label>
                      Date of birth
                      <input
                        type="date"
                        value={manual.dob}
                        disabled={busy}
                        onChange={(event) => setManual((prev) => ({ ...prev, dob: event.target.value }))}
                      />
                    </label>
                    <label>
                      Gender
                      <select
                        value={manual.gender}
                        disabled={busy}
                        onChange={(event) => setManual((prev) => ({ ...prev, gender: event.target.value }))}
                      >
                        <option>Male</option>
                        <option>Female</option>
                        <option>Other</option>
                      </select>
                    </label>
                    <label>
                      Designation
                      <input
                        value={manual.designation}
                        disabled={busy}
                        onChange={(event) =>
                          setManual((prev) => ({ ...prev, designation: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Department
                      <input
                        value={manual.department}
                        disabled={busy}
                        onChange={(event) =>
                          setManual((prev) => ({ ...prev, department: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Joining date
                      <input
                        type="date"
                        value={manual.joining_date}
                        disabled={busy}
                        onChange={(event) =>
                          setManual((prev) => ({ ...prev, joining_date: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Monthly CTC (₹)
                      <input
                        type="number"
                        min={0}
                        value={manual.salary_offered}
                        disabled={busy}
                        onChange={(event) =>
                          setManual((prev) => ({ ...prev, salary_offered: event.target.value }))
                        }
                      />
                    </label>
                    <label className="span-2">
                      Franchise hub (optional)
                      <input
                        value={manual.franchisee}
                        disabled={busy}
                        onChange={(event) =>
                          setManual((prev) => ({ ...prev, franchisee: event.target.value }))
                        }
                        placeholder="Franchisee Profile name"
                      />
                    </label>
                  </div>
                )}

                <div className="hrms-modal-actions">
                  <button className="hrms-btn secondary" type="button" disabled={busy} onClick={closeForm}>
                    Cancel
                  </button>
                  <button className="hrms-btn" type="submit" disabled={busy}>
                    {busy ? 'Saving…' : 'Create employee'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
