import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, PeopleHrmsDashboard, PeoplePayrollLine, PeoplePayrollRegister, PeoplePayrollRow, PeoplePayrollStatus } from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import { deskAppUrl } from '../../config';
import { Avatar, downloadCsv, escapeHtml, FilterDropdown, Pager } from './peopleTableKit';
import { SMILECURE_COMPANY, smilecureLogoUrl } from './smilecureCompany';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-attendance.css';
import './people-leave.css';
import './people-payroll.css';

function money(value?: number | null) {
  if (value == null) return '—';
  return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
}

function money2(value?: number | null) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PeoplePayslipsSelf() {
  const [data, setData] = useState<PeopleHrmsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await api.getPeopleHrmsDashboard();
        if (alive) setData(res.data);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Unable to load payslips');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <div className="people-alert err">{error}</div>;
  if (!data) return <p className="muted">Loading payslips…</p>;
  const slips = data.payslips || [];
  const emp = data.employee;
  const periodLabel = data.period.label;

  function printSelf(row: (typeof slips)[number]) {
    const start = row.start_date ? new Date(`${row.start_date.slice(0, 10)}T00:00:00`) : null;
    const period =
      start && !Number.isNaN(start.getTime())
        ? start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
        : periodLabel;
    const gross = row.gross_pay;
    const net = row.net_pay;
    void printPayslips(
      [
        {
          id: emp.id || '',
          name: emp.name,
          department: emp.department,
          designation: emp.designation,
          date_of_joining: emp.date_of_joining,
          structure: null,
          base: 0,
          status: /submi|approv|paid|process/i.test(row.status || '') ? 'Processed' : 'Pending',
          stage: row.status || '',
          slip: row.name,
          slip_status: row.status,
          gross,
          deductions: gross != null && net != null ? Number(gross) - Number(net) : null,
          net,
          earnings: [],
          deduction_lines: [],
          statutory: {},
        },
      ],
      SMILECURE_COMPANY.legalName,
      period,
    );
  }

  return (
    <section className="people-panel">
      <header>
        <div>
          <h2>Payslips</h2>
          <p>
            From ERPNext Salary Slip · monthly CTC {money(data.compensation.monthly_ctc)}
            {data.compensation.ctc_from_erp ? '' : ' (assignment missing)'}
          </p>
        </div>
        <b>{slips.length}</b>
      </header>
      {!slips.length ? (
        <p className="muted">No salary slips yet.</p>
      ) : (
        <table className="people-table">
          <thead>
            <tr>
              <th>Slip</th>
              <th>Period</th>
              <th>Gross</th>
              <th>Net</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {slips.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>
                  {row.start_date || '—'} → {row.end_date || '—'}
                </td>
                <td>{money(row.gross_pay)}</td>
                <td>{money(row.net_pay)}</td>
                <td>{row.status}</td>
                <td>
                  <button type="button" className="emp-btn outline" onClick={() => printSelf(row)}>
                    Print
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

type Tab = 'processing' | 'payslips' | 'reports' | 'statutory';
type JobKind = 'process' | 'approve';
type Job = {
  kind: JobKind;
  rows: PeoplePayrollRow[];
  running: boolean;
  finished: boolean;
  done: number;
  ok: number;
  failures: string[];
};

const STATUSES: PeoplePayrollStatus[] = ['Processed', 'Pending', 'On Hold'];
const STATUS_TONE: Record<PeoplePayrollStatus, string> = { Processed: 'green', Pending: 'amber', 'On Hold': 'rose' };
const STATUS_COLOR: Record<PeoplePayrollStatus, string> = { Processed: '#16a34a', Pending: '#f59e0b', 'On Hold': '#ef4444' };
const STATUTORY_KEYS = ['PF', 'ESI', 'Professional Tax', 'TDS'];

const STEP_COPY: Record<PeoplePayrollRegister['steps'][number]['key'], { title: string; desc: string }> = {
  assign: { title: 'Assign Salary Structure', desc: 'Map employees to active salary structure' },
  process: { title: 'Process Payroll', desc: 'Calculate earnings, deductions and net pay' },
  approve: { title: 'Review & Approve', desc: 'Verify and approve payroll' },
  payslips: { title: 'Generate Payslips', desc: 'Create and distribute salary slips' },
};

const JOB_COPY: Record<JobKind, { title: string; verb: string; running: string; done: string; intro: string; note: string; empty: string }> = {
  process: {
    title: 'Process payroll',
    verb: 'Process',
    running: 'Calculating salary slips',
    done: 'salary slip(s) calculated',
    intro: 'Calculate draft salary slips from each employee’s salary structure, attendance and leave.',
    note: 'Draft slips can still be reviewed and edited before approval.',
    empty: 'Every employee with a salary structure already has a salary slip for this month.',
  },
  approve: {
    title: 'Approve payroll',
    verb: 'Approve',
    running: 'Approving salary slips',
    done: 'salary slip(s) approved',
    intro: 'Approve the draft salary slips so payslips can be issued.',
    note: 'Approving submits the salary slips in ERPNext. An approved slip can only be changed by cancelling it.',
    empty: 'There are no draft salary slips waiting for approval this month.',
  },
};

const canProcess = (r: PeoplePayrollRow) => !r.slip && Boolean(r.structure);
const canApprove = (r: PeoplePayrollRow) => Boolean(r.slip) && r.status === 'Pending';

function pctChange(cur: number, prev: number) {
  return prev ? Math.round(((cur - prev) / prev) * 100) : null;
}

function fmtWhen(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function smilecureLogoSrc() {
  try {
    const res = await fetch(smilecureLogoUrl());
    if (!res.ok) return smilecureLogoUrl();
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return smilecureLogoUrl();
  }
}

async function printPayslips(rows: PeoplePayrollRow[], _company: string, period: string) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return;
  const co = SMILECURE_COMPANY;
  const logo = await smilecureLogoSrc();
  const amt = (value?: number | null) =>
    Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines = (items: PeoplePayrollLine[], pad: number) => {
    const body = items.map((l) => `<tr><td>${escapeHtml(l.component)}</td><td class="r">${amt(l.amount)}</td></tr>`);
    if (!items.length) body.push('<tr><td class="m">None</td><td></td></tr>');
    while (body.length < pad) body.push('<tr class="blank"><td>&nbsp;</td><td></td></tr>');
    return body.join('');
  };
  const mailIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="m3 6 9 7 9-7" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const phoneIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>';
  const generated = new Date().toLocaleDateString('en-GB');
  const slips = rows
    .map((r) => {
      const pad = Math.max(r.earnings.length, r.deduction_lines.length, 1);
      const approved = r.status === 'Processed';
      return `<section class="slip">
      <header class="lh">
        <div class="lh-logo"><img src="${escapeHtml(logo)}" alt="${escapeHtml(co.legalName)}" /></div>
        <div class="lh-co">
          <h1>${escapeHtml(co.legalName)}</h1>
          <div class="lh-offices">
            <div><h2>Registered Office</h2><p>${escapeHtml(co.registeredOffice)}</p></div>
            <div><h2>Corporate Office</h2><p>${escapeHtml(co.corporateOffice)}</p></div>
          </div>
        </div>
        <div class="lh-contact">
          <p>${mailIcon}<span>${escapeHtml(co.hrEmail)}</span></p>
          <p>${phoneIcon}<span>${escapeHtml(co.hrPhone)}</span></p>
        </div>
      </header>
      <div class="title">
        <h3>Payslip for <b>${escapeHtml(period)}</b></h3>
        <span class="st ${approved ? 'ok' : 'draft'}">${approved ? 'Approved' : 'Draft'}</span>
      </div>
      <div class="meta">
        <table>
          <tr><th>Employee</th><td>${escapeHtml(r.name)} (${escapeHtml(r.id)})</td></tr>
          <tr><th>Department</th><td>${escapeHtml(r.department || '—')}</td></tr>
          <tr><th>Payment days</th><td>${escapeHtml(r.payment_days ?? '—')} of ${escapeHtml(r.working_days ?? '—')}</td></tr>
        </table>
        <table>
          <tr><th>Salary slip</th><td>${escapeHtml(r.slip || '—')}</td></tr>
          <tr><th>Designation</th><td>${escapeHtml(r.designation || '—')}</td></tr>
          <tr><th>Salary structure</th><td>${escapeHtml(r.structure || '—')}</td></tr>
        </table>
      </div>
      <div class="cols">
        <table><thead><tr><th>Earnings</th><th class="r">Amount (₹)</th></tr></thead><tbody>${lines(r.earnings, pad)}</tbody>
          <tfoot><tr><th>Gross pay</th><th class="r">${amt(r.gross)}</th></tr></tfoot></table>
        <table><thead><tr><th>Deductions</th><th class="r">Amount (₹)</th></tr></thead><tbody>${lines(r.deduction_lines, pad)}</tbody>
          <tfoot><tr><th>Total deductions</th><th class="r">${amt(r.deductions)}</th></tr></tfoot></table>
      </div>
      <div class="net"><span>Net pay</span><b>${money2(r.net)}</b></div>
      <footer class="foot">System generated payslip · ${escapeHtml(generated)}</footer>
    </section>`;
    })
    .join('');
  w.document.write(`<!doctype html><html><head><title>Payslip — ${escapeHtml(co.legalName)} — ${escapeHtml(period)}</title><style>
    *{box-sizing:border-box}
    body{font-family:Inter,'Segoe UI',system-ui,sans-serif;color:#1e293b;margin:0;padding:28px;background:#fff}
    .slip{page-break-after:always;max-width:860px;margin:0 auto 40px}.slip:last-child{page-break-after:auto}
    .lh{display:flex;align-items:stretch;gap:20px;padding-bottom:16px;border-bottom:1.5px solid #1d6b78}
    .lh-logo{display:flex;align-items:center;padding-right:20px;border-right:1px solid #cbd5e1;flex-shrink:0}
    .lh-logo img{height:72px;width:auto;max-width:230px;object-fit:contain}
    .lh-co{flex:1;min-width:0}
    .lh-co h1{margin:0 0 10px;font-size:17px;font-weight:800;color:#0f2a3d}
    .lh-offices{display:grid;grid-template-columns:1fr 1.15fr;gap:16px}
    .lh-offices>div+div{padding-left:16px;border-left:1px solid #cbd5e1}
    .lh-offices h2{margin:0 0 3px;font-size:11px;font-weight:700;color:#155763}
    .lh-offices p{margin:0;font-size:10.5px;line-height:1.5;color:#334155}
    .lh-contact{display:flex;flex-direction:column;gap:10px;padding-left:16px;border-left:1px solid #cbd5e1;flex-shrink:0}
    .lh-contact p{display:flex;align-items:center;gap:8px;margin:0;font-size:11px;color:#334155}
    .lh-contact svg{width:15px;height:15px;color:#0f3d4d;flex-shrink:0}
    .title{display:flex;justify-content:space-between;align-items:center;margin:20px 0 10px}
    .title h3{margin:0;font-size:22px;font-weight:500;color:#0f2a3d}.title h3 b{font-weight:800;color:#155763}
    .st{padding:6px 16px;border-radius:10px;font-weight:700;font-size:13px}
    .st.ok{background:#dcfce7;color:#15803d}.st.draft{background:#fdecc8;color:#b45309}
    table{border-collapse:collapse;width:100%;font-size:13px}
    th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e2e8f0}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:28px}
    .meta th{color:#64748b;font-weight:600;width:38%}
    .cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:18px}
    .cols thead th{background:#eef7f8;color:#155763;font-weight:700;border-bottom:0}
    .cols tfoot th{font-weight:800;color:#0f2a3d;border-top:1.5px solid #cbd5e1}
    .r{text-align:right}.m{color:#94a3b8}.blank td{color:transparent}
    .net{display:flex;justify-content:space-between;align-items:center;margin-top:18px;padding:14px 16px;border-radius:8px;background:#eef7f8}
    .net span{font-size:20px;font-weight:800;color:#155763}.net b{font-size:24px;font-weight:800;color:#155763}
    .foot{margin-top:20px;padding-top:12px;border-top:1.5px solid #1d6b78;font-size:11px;color:#64748b;text-align:center}
    @media print{body{padding:10px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>${slips}<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

function PayrollManager() {
  const [month, setMonth] = useState('');
  const [reg, setReg] = useState<PeoplePayrollRegister | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('processing');
  const [deptFilter, setDeptFilter] = useState('');
  const [desigFilter, setDesigFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [viewId, setViewId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPeoplePayrollRegister(m);
      setReg(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load payroll');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  useEffect(() => {
    setPage(1);
  }, [deptFilter, desigFilter, statusFilter, query, perPage, month, tab]);

  useEffect(() => {
    setSelected(new Set());
  }, [month]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3500);
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

  const rows = useMemo(() => reg?.rows || [], [reg]);
  const k = reg?.kpis;
  const viewRow = viewId ? rows.find((r) => r.id === viewId) || null : null;
  const period = reg?.label || '';
  const company = reg?.company || '';

  const options = useMemo(() => {
    const uniq = (values: Array<string | null | undefined>) =>
      Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b));
    return { departments: uniq(rows.map((r) => r.department)), designations: uniq(rows.map((r) => r.designation)) };
  }, [rows]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!deptFilter || r.department === deptFilter) &&
          (!desigFilter || r.designation === desigFilter) &&
          (!statusFilter || r.status === statusFilter) &&
          (!q || [r.name, r.id, r.department, r.designation, r.slip].some((v) => (v || '').toLowerCase().includes(q))),
      ),
    [rows, deptFilter, desigFilter, statusFilter, q],
  );
  const withSlip = useMemo(() => filtered.filter((r) => r.slip), [filtered]);
  const tableRows = tab === 'processing' ? filtered : withSlip;

  const pages = Math.max(1, Math.ceil(tableRows.length / perPage));
  const currentPage = Math.min(page, pages);
  const pageRows = tableRows.slice((currentPage - 1) * perPage, currentPage * perPage);
  const firstShown = tableRows.length ? (currentPage - 1) * perPage + 1 : 0;
  const lastShown = Math.min(currentPage * perPage, tableRows.length);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const filtersActive = Boolean(deptFilter || desigFilter || statusFilter || query);
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const stamp = reg?.month || 'payroll';

  const resetFilters = () => {
    setDeptFilter('');
    setDesigFilter('');
    setStatusFilter('');
    setQuery('');
    setSelected(new Set());
  };

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });

  const openRowMenu = (id: string, anchor: HTMLElement) => {
    if (menuFor === id) {
      setMenuFor(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const menuHeight = 210;
    const top = rect.bottom + menuHeight + 8 > window.innerHeight ? rect.top - menuHeight - 4 : rect.bottom + 4;
    setMenuPos({ top: Math.max(8, top), left: Math.max(8, rect.right - 240) });
    setMenuFor(id);
  };

  const startJob = (kind: JobKind, source: PeoplePayrollRow[]) => {
    setMenuFor(null);
    setJob({ kind, rows: source.filter(kind === 'process' ? canProcess : canApprove), running: false, finished: false, done: 0, ok: 0, failures: [] });
  };

  const runJob = async () => {
    if (!job || !reg || job.running) return;
    const { kind, rows: targets } = job;
    const size = Math.max(1, kind === 'process' ? reg.batch_size : reg.batch_size * 2);
    const byEmployee = new Map(targets.map((r) => [r.id, r.name]));
    const bySlip = new Map(targets.map((r) => [r.slip || '', r.name]));
    const failures: string[] = [];
    let done = 0;
    let ok = 0;
    setJob({ ...job, running: true });
    for (let i = 0; i < targets.length; i += size) {
      const chunk = targets.slice(i, i + size);
      try {
        if (kind === 'process') {
          const res = await api.processPeoplePayroll(reg.month, chunk.map((r) => r.id));
          ok += (res.data.created?.length || 0) + (res.data.existing?.length || 0);
          (res.data.skipped || []).forEach((s) => failures.push(`${byEmployee.get(s.employee) || s.employee}: ${s.reason}`));
          res.data.errors.forEach((e) => failures.push(`${byEmployee.get(e.employee || '') || e.employee}: ${e.error}`));
        } else {
          const res = await api.approvePeoplePayroll(reg.month, chunk.map((r) => r.slip || ''));
          ok += (res.data.approved?.length || 0) + (res.data.already?.length || 0);
          res.data.errors.forEach((e) => failures.push(`${bySlip.get(e.slip || '') || e.slip}: ${e.error}`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Request failed';
        chunk.forEach((r) => failures.push(`${r.name}: ${msg}`));
      }
      done += chunk.length;
      setJob((cur) => (cur ? { ...cur, running: true, done, ok, failures: [...failures] } : cur));
    }
    setJob((cur) => (cur ? { ...cur, running: false, finished: true, done, ok, failures: [...failures] } : cur));
    setSelected(new Set());
    await load(reg.month);
  };

  const statutoryOf = (r: PeoplePayrollRow, key: string) => r.statutory?.[key] || 0;

  const exportRegister = (list: PeoplePayrollRow[]) =>
    downloadCsv(
      `payroll-register-${stamp}.csv`,
      ['Employee ID', 'Employee', 'Department', 'Designation', 'Salary Structure', 'Monthly Base', 'Status', 'Stage', 'Salary Slip', 'Payment Days', 'Working Days', 'Gross', 'Deductions', 'Net Pay', ...STATUTORY_KEYS],
      list.map((r) => [
        r.id,
        r.name,
        r.department,
        r.designation,
        r.structure,
        r.base,
        r.status,
        r.stage,
        r.slip,
        r.payment_days,
        r.working_days,
        r.gross,
        r.deductions,
        r.net,
        ...STATUTORY_KEYS.map((key) => (r.slip ? statutoryOf(r, key) : '')),
      ]),
    );

  const exportBankSheet = () =>
    downloadCsv(
      `payroll-bank-transfer-${stamp}.csv`,
      ['Employee ID', 'Employee', 'Department', 'Salary Slip', 'Net Pay'],
      rows.filter((r) => r.status === 'Processed').map((r) => [r.id, r.name, r.department, r.slip, r.net]),
    );

  const exportDepartments = () =>
    downloadCsv(
      `payroll-by-department-${stamp}.csv`,
      ['Department', 'Employees', 'Processed', 'Gross', 'Deductions', 'Net Pay'],
      (reg?.departments || []).map((d) => [d.department, d.employees, d.processed, d.gross, d.deductions, d.net]),
    );

  const exportStatutory = () =>
    downloadCsv(
      `payroll-statutory-${stamp}.csv`,
      ['Employee ID', 'Employee', 'Department', 'Gross', ...STATUTORY_KEYS, 'Total Deductions'],
      rows.filter((r) => r.slip).map((r) => [r.id, r.name, r.department, r.gross, ...STATUTORY_KEYS.map((key) => statutoryOf(r, key)), r.deductions]),
    );

  const grossTrend = k?.slips ? pctChange(k.gross, k.prev_gross) : null;
  const dedTrend = k?.slips ? pctChange(k.deductions, k.prev_deductions) : null;
  const netTrend = k?.slips ? pctChange(k.net, k.prev_net) : null;
  const monthShort = reg ? new Date(`${reg.from_date}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
  const trendSub = (trend: number | null) => {
    if (!k?.slips) return 'Not processed yet';
    if (trend != null) return `${Math.abs(trend)}% vs last month`;
    return k?.prev_label ? `No payroll in ${k.prev_label}` : 'This month';
  };

  const kpis: Array<{ icon: string; tone: string; label: string; value: string; sub: string; up?: boolean; down?: boolean }> = [
    {
      icon: 'users',
      tone: 'blue',
      label: 'Total Employees',
      value: String(k?.employees ?? 0),
      sub: k?.joined ? `+${k.joined} joined this month` : 'No new joiners this month',
      up: Boolean(k?.joined),
    },
    {
      icon: 'wallet',
      tone: 'green',
      label: `Total Gross (${monthShort})`,
      value: money(k?.gross ?? 0),
      sub: trendSub(grossTrend),
      up: grossTrend != null && grossTrend >= 0,
      down: grossTrend != null && grossTrend < 0,
    },
    {
      icon: 'receipt',
      tone: 'orange',
      label: 'Total Deductions',
      value: money(k?.deductions ?? 0),
      sub: trendSub(dedTrend),
      up: dedTrend != null && dedTrend >= 0,
      down: dedTrend != null && dedTrend < 0,
    },
    {
      icon: 'rupee',
      tone: 'teal',
      label: 'Net Payroll',
      value: money(k?.net ?? 0),
      sub: trendSub(netTrend),
      up: netTrend != null && netTrend >= 0,
      down: netTrend != null && netTrend < 0,
    },
    {
      icon: 'file',
      tone: 'violet',
      label: 'Payslips Generated',
      value: String(k?.processed ?? 0),
      sub: k?.employees ? `${Math.round(((k.processed || 0) / k.employees) * 100)}% of employees` : 'No employees',
    },
  ];

  const statusCounts: Record<PeoplePayrollStatus, number> = {
    Processed: k?.processed ?? 0,
    Pending: k?.pending ?? 0,
    'On Hold': k?.on_hold ?? 0,
  };
  const donut = (() => {
    const total = k?.employees || 0;
    if (!total) return '#eef2f6';
    let acc = 0;
    return `conic-gradient(${STATUSES.map((s) => {
      const from = (acc / total) * 360;
      acc += statusCounts[s];
      return `${STATUS_COLOR[s]} ${from}deg ${(acc / total) * 360}deg`;
    }).join(', ')})`;
  })();
  const pctOf = (n: number) => (k?.employees ? Math.round((n / k.employees) * 100) : 0);

  const stepAction = (key: PeoplePayrollRegister['steps'][number]['key']) => {
    if (key === 'process') startJob('process', rows);
    else if (key === 'approve') startJob('approve', rows);
    else if (key === 'payslips') setTab('payslips');
    else window.open(`${deskAppUrl()}/app/salary-structure-assignment`, '_blank', 'noreferrer');
  };

  const rowActions = (row: PeoplePayrollRow) => (
    <div className="emp-actions">
      <button type="button" title="View salary details" aria-label={`View ${row.name}`} onClick={() => setViewId(row.id)}>
        <HrmsIcon name="eye" size={17} />
      </button>
      {row.status === 'Processed' ? (
        <button type="button" title="Download payslip" aria-label={`Download payslip for ${row.name}`} onClick={() => void printPayslips([row], company, period)}>
          <HrmsIcon name="download" size={16} />
        </button>
      ) : row.slip ? (
        <a
          href={`${deskAppUrl()}/app/salary-slip/${encodeURIComponent(row.slip)}`}
          target="_blank"
          rel="noreferrer"
          title="Edit draft salary slip"
          aria-label={`Edit salary slip for ${row.name}`}
        >
          <HrmsIcon name="pencil" size={16} />
        </a>
      ) : canProcess(row) ? (
        <button type="button" className="lv-act send" title="Process payroll" aria-label={`Process payroll for ${row.name}`} onClick={() => startJob('process', [row])}>
          <HrmsIcon name="zap" size={16} />
        </button>
      ) : (
        <a
          href={`${deskAppUrl()}/app/salary-structure-assignment/new?employee=${encodeURIComponent(row.id)}`}
          target="_blank"
          rel="noreferrer"
          title="Assign salary structure"
          aria-label={`Assign salary structure to ${row.name}`}
        >
          <HrmsIcon name="pencil" size={16} />
        </a>
      )}
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
          <div className="emp-popover emp-menu" style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 240 }}>
            {canProcess(row) ? (
              <button type="button" onClick={() => startJob('process', [row])}>
                <HrmsIcon name="zap" size={15} /> Process payroll
              </button>
            ) : null}
            {canApprove(row) ? (
              <button type="button" onClick={() => startJob('approve', [row])}>
                <HrmsIcon name="checkCircle" size={15} /> Approve salary slip
              </button>
            ) : null}
            {row.slip ? (
              <button
                type="button"
                onClick={() => {
                  setMenuFor(null);
                  void printPayslips([row], company, period);
                }}
              >
                <HrmsIcon name="printer" size={15} /> Print payslip
              </button>
            ) : null}
            {row.slip ? (
              <a href={`${deskAppUrl()}/app/salary-slip/${encodeURIComponent(row.slip)}`} target="_blank" rel="noreferrer" onClick={() => setMenuFor(null)}>
                <HrmsIcon name="file" size={15} /> Open salary slip in ERP
              </a>
            ) : null}
            <a
              href={`${deskAppUrl()}/app/salary-structure-assignment?employee=${encodeURIComponent(row.id)}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => setMenuFor(null)}
            >
              <HrmsIcon name="wallet" size={15} /> Salary structure assignment
            </a>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(row.id);
                setNotice('Employee ID copied');
                setMenuFor(null);
              }}
            >
              <HrmsIcon name="copy" size={15} /> Copy employee ID
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  const selectionBar = selected.size ? (
    <div className="dsg-selbar lv-selbar">
      <span className="dsg-count">{selected.size} selected</span>
      {selectedRows.some(canProcess) ? (
        <button type="button" className="emp-btn outline" onClick={() => startJob('process', selectedRows)}>
          <HrmsIcon name="zap" size={15} /> Process ({selectedRows.filter(canProcess).length})
        </button>
      ) : null}
      {selectedRows.some(canApprove) ? (
        <button type="button" className="emp-btn primary" onClick={() => startJob('approve', selectedRows)}>
          <HrmsIcon name="check" size={15} /> Approve ({selectedRows.filter(canApprove).length})
        </button>
      ) : null}
      {selectedRows.some((r) => r.slip) ? (
        <button type="button" className="emp-btn outline" onClick={() => void printPayslips(selectedRows.filter((r) => r.slip), company, period)}>
          <HrmsIcon name="printer" size={15} /> Print payslips ({selectedRows.filter((r) => r.slip).length})
        </button>
      ) : null}
      <button type="button" className="emp-btn outline" onClick={() => exportRegister(selectedRows)}>
        <HrmsIcon name="download" size={15} /> Export
      </button>
      <button type="button" className="att-link" onClick={() => setSelected(new Set())}>
        Clear selection
      </button>
    </div>
  ) : null;

  const checkboxHead = (
    <th className="emp-col-check">
      <input type="checkbox" checked={allOnPageSelected} onChange={togglePage} disabled={!pageRows.length} aria-label="Select all on this page" />
    </th>
  );
  const checkboxCell = (row: PeoplePayrollRow) => (
    <td className="emp-col-check">
      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} aria-label={`Select ${row.name}`} />
    </td>
  );
  const personCell = (row: PeoplePayrollRow) => (
    <td>
      <div className="emp-person lv-person">
        <Avatar id={row.id} name={row.name} photo={row.photo} />
        <div>
          <b>{row.name}</b>
          <small>{row.designation || '—'}</small>
        </div>
      </div>
    </td>
  );
  const emptyRow = (cols: number, text: string) => (
    <tr>
      <td colSpan={cols} className="emp-empty">
        {loading && !reg ? 'Loading payroll…' : text}
      </td>
    </tr>
  );
  const pager = (noun: string) => (
    <Pager
      page={currentPage}
      pages={pages}
      perPage={perPage}
      onPage={setPage}
      onPerPage={setPerPage}
      summary={`Showing ${firstShown} to ${lastShown} of ${tableRows.length} ${noun}${loading && reg ? ' · refreshing…' : ''}`}
    />
  );

  const jobCopy = job ? JOB_COPY[job.kind] : null;
  const jobTotal = job?.rows.length || 0;

  return (
    <div className="hrms-list-page emp-page dep-page lv-page pay-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="rupee" size={28} />
          </span>
          <div>
            <h1>Payroll</h1>
            <p>Manage salary processing, payslips and payroll reports</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <a className="emp-btn outline lg" href={`${deskAppUrl()}/app/payroll-settings`} target="_blank" rel="noreferrer">
            <HrmsIcon name="settings" size={17} />
            Payroll Settings
          </a>
          <a className="emp-btn outline lg" href={`${deskAppUrl()}/app/salary-structure`} target="_blank" rel="noreferrer">
            <HrmsIcon name="wallet" size={17} />
            Salary Structure
          </a>
          <button className="emp-btn primary lg" type="button" onClick={() => startJob('process', rows)} disabled={!reg?.available}>
            <HrmsIcon name="plus" size={17} />
            Process Payroll
          </button>
        </div>
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}
      {reg && !reg.available ? (
        <div className="people-alert err">Payroll is not installed on ERPNext (missing: {reg.missing.join(', ')}).</div>
      ) : null}

      <div className="att-kpis pay-kpis">
        {kpis.map((kp) => (
          <div key={kp.label} className="emp-card att-kpi">
            <span className={`dep-kpi-icon ${kp.tone}`}>
              <HrmsIcon name={kp.icon} size={22} />
            </span>
            <div>
              <b>{kp.label}</b>
              <strong>{loading && !reg ? '…' : kp.value}</strong>
              <small className={kp.up ? 'up' : kp.down ? 'down' : ''}>
                {kp.up ? '↑ ' : kp.down ? '↓ ' : ''}
                {kp.sub}
              </small>
            </div>
          </div>
        ))}
      </div>

      <div className="lv-layout pay-layout">
        <section className="emp-card att-main lv-main">
          <div className="att-tabs-row">
            <nav className="att-tabs" role="tablist">
              {(
                [
                  ['processing', 'Payroll Processing'],
                  ['payslips', 'Payslip Management'],
                  ['reports', 'Payroll Reports'],
                  ['statutory', 'Statutory Compliance'],
                ] as Array<[Tab, string]>
              ).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <div className="att-filters pay-filters">
            <label className="att-date pay-month">
              <span>
                Payroll Month <em>*</em>
              </span>
              <div>
                <HrmsIcon name="calendar" size={16} />
                <select value={reg?.month || month} onChange={(e) => setMonth(e.target.value)} aria-label="Payroll month">
                  {(reg?.months || []).map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <FilterDropdown label="Department" value={deptFilter} allLabel="All Departments" options={options.departments} onChange={setDeptFilter} />
            <FilterDropdown label="Designation" value={desigFilter} allLabel="All Designations" options={options.designations} onChange={setDesigFilter} />
            <FilterDropdown label="Status" value={statusFilter} allLabel="All Status" options={STATUSES} onChange={setStatusFilter} />
            <label className="emp-search att-search">
              <HrmsIcon name="search" size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, ID or department..." aria-label="Search payroll" />
            </label>
            <button className="emp-btn outline dsg-reset" type="button" onClick={resetFilters} disabled={!filtersActive && !selected.size}>
              <HrmsIcon name="reset" size={16} />
              Reset
            </button>
          </div>

          {notice ? (
            <div className="dsg-selbar">
              <span className="emp-notice">{notice}</span>
            </div>
          ) : null}

          {tab === 'processing' ? (
            <>
              <ol className="pay-steps">
                {(reg?.steps || []).map((s, i) => (
                  <li key={s.key} className={s.done ? 'done' : s.current ? 'now' : ''}>
                    <button type="button" onClick={() => stepAction(s.key)} title={s.detail}>
                      <span className="pay-step-dot">{s.done ? <HrmsIcon name="check" size={15} strokeWidth={3} /> : i + 1}</span>
                      <span className="pay-step-text">
                        <b>{STEP_COPY[s.key].title}</b>
                        <small>{STEP_COPY[s.key].desc}</small>
                        <em>{s.detail}</em>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {selectionBar}
              <div className="emp-table-wrap">
                <table className="emp-table lv-table pay-table">
                  <thead>
                    <tr>
                      {checkboxHead}
                      <th className="dep-col-num">#</th>
                      <th>Employee</th>
                      <th>ID</th>
                      <th>Department</th>
                      <th className="pay-money">Gross</th>
                      <th className="pay-money">Deductions</th>
                      <th className="pay-money">Net Pay</th>
                      <th>Status</th>
                      <th className="emp-col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row, i) => (
                      <tr key={row.id} className={selected.has(row.id) ? 'selected' : ''}>
                        {checkboxCell(row)}
                        <td className="dep-col-num">{(currentPage - 1) * perPage + i + 1}</td>
                        {personCell(row)}
                        <td className="pay-id">{row.id}</td>
                        <td className="lv-dept">{row.department || '—'}</td>
                        <td className="pay-money">{money(row.gross)}</td>
                        <td className="pay-money">{money(row.deductions)}</td>
                        <td className="pay-money">
                          <b>{money(row.net)}</b>
                        </td>
                        <td>
                          <span className={`emp-pill ${STATUS_TONE[row.status]}`} title={row.stage}>
                            {row.status}
                          </span>
                          {row.status !== 'Processed' ? <small className="pay-stage">{row.stage}</small> : null}
                        </td>
                        <td className="emp-col-actions">{rowActions(row)}</td>
                      </tr>
                    ))}
                    {!pageRows.length ? emptyRow(10, filtersActive ? 'No employees match these filters.' : 'No active employees for this month.') : null}
                  </tbody>
                </table>
              </div>
              {pager('employees')}
            </>
          ) : null}

          {tab === 'payslips' ? (
            <>
              <div className="lv-stagebar">
                <span>
                  <b>{k?.slips ?? 0}</b> salary slips for {period} · <b>{k?.processed ?? 0}</b> approved, <b>{k?.drafts ?? 0}</b> in draft
                  {k?.not_processed ? ` · ${k.not_processed} employees not processed yet` : ''}
                </span>
                <button
                  type="button"
                  className="att-link"
                  onClick={() => void printPayslips(withSlip.filter((r) => r.status === 'Processed'), company, period)}
                  disabled={!withSlip.some((r) => r.status === 'Processed')}
                >
                  Print approved payslips
                </button>
              </div>
              {selectionBar}
              <div className="emp-table-wrap">
                <table className="emp-table lv-table pay-table">
                  <thead>
                    <tr>
                      {checkboxHead}
                      <th>Employee</th>
                      <th>Salary Slip</th>
                      <th className="lv-num">Pay Days</th>
                      <th className="pay-money">Gross</th>
                      <th className="pay-money">Net Pay</th>
                      <th>Slip Status</th>
                      <th className="emp-col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => (
                      <tr key={row.id} className={selected.has(row.id) ? 'selected' : ''}>
                        {checkboxCell(row)}
                        {personCell(row)}
                        <td className="pay-id">{row.slip}</td>
                        <td className="lv-num">
                          {row.payment_days ?? '—'}
                          <span className="pay-of"> / {row.working_days ?? '—'}</span>
                        </td>
                        <td className="pay-money">{money(row.gross)}</td>
                        <td className="pay-money">
                          <b>{money(row.net)}</b>
                        </td>
                        <td>
                          <span className={`emp-pill ${row.status === 'Processed' ? 'green' : 'amber'}`}>{row.status === 'Processed' ? 'Approved' : 'Draft'}</span>
                        </td>
                        <td className="emp-col-actions">
                          <div className="emp-actions">
                            <button type="button" title="View salary details" aria-label={`View ${row.name}`} onClick={() => setViewId(row.id)}>
                              <HrmsIcon name="eye" size={17} />
                            </button>
                            {canApprove(row) ? (
                              <button type="button" className="lv-act ok" title="Approve" aria-label={`Approve slip for ${row.name}`} onClick={() => startJob('approve', [row])}>
                                <HrmsIcon name="check" size={17} strokeWidth={2.6} />
                              </button>
                            ) : null}
                            <button type="button" title="Print payslip" aria-label={`Print payslip for ${row.name}`} onClick={() => void printPayslips([row], company, period)}>
                              <HrmsIcon name="printer" size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!pageRows.length
                      ? emptyRow(8, filtersActive ? 'No salary slips match these filters.' : `No salary slips for ${period} yet. Use Process Payroll to calculate them.`)
                      : null}
                  </tbody>
                </table>
              </div>
              {pager('salary slips')}
            </>
          ) : null}

          {tab === 'reports' ? (
            <div className="lv-reports">
              <div className="lv-report-actions">
                <button type="button" className="lv-report-btn" onClick={() => exportRegister(filtered)} disabled={!filtered.length}>
                  <HrmsIcon name="clipboard" size={20} />
                  <span>
                    <b>Payroll register</b>
                    <small>
                      {filtered.length} employees · {period}
                    </small>
                  </span>
                  <HrmsIcon name="download" size={16} />
                </button>
                <button type="button" className="lv-report-btn" onClick={exportDepartments} disabled={!reg?.departments.length}>
                  <HrmsIcon name="building" size={20} />
                  <span>
                    <b>Department summary</b>
                    <small>{reg?.departments.length || 0} departments</small>
                  </span>
                  <HrmsIcon name="download" size={16} />
                </button>
                <button type="button" className="lv-report-btn" onClick={exportBankSheet} disabled={!k?.processed}>
                  <HrmsIcon name="coins" size={20} />
                  <span>
                    <b>Bank transfer sheet</b>
                    <small>Net pay of {k?.processed || 0} approved slips</small>
                  </span>
                  <HrmsIcon name="download" size={16} />
                </button>
              </div>
              <div className="emp-table-wrap">
                <table className="emp-table lv-table pay-table">
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th className="lv-num">Employees</th>
                      <th className="lv-num">Processed</th>
                      <th className="pay-money">Gross</th>
                      <th className="pay-money">Deductions</th>
                      <th className="pay-money">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reg?.departments || []).map((d) => (
                      <tr key={d.department}>
                        <td>
                          <b>{d.department}</b>
                        </td>
                        <td className="lv-num">{d.employees}</td>
                        <td className="lv-num att-num green">{d.processed}</td>
                        <td className="pay-money">{money(d.gross)}</td>
                        <td className="pay-money">{money(d.deductions)}</td>
                        <td className="pay-money">
                          <b>{money(d.net)}</b>
                        </td>
                      </tr>
                    ))}
                    {!reg?.departments.length ? emptyRow(6, `No payroll data for ${period}.`) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tab === 'statutory' ? (
            <>
              <div className="pay-stat-cards">
                {(reg?.statutory || []).map((s) => (
                  <div key={s.label} className="pay-stat-card">
                    <span>{s.label}</span>
                    <b>{money(s.amount)}</b>
                    <small>{s.label === 'Other deductions' ? 'Non-statutory deductions' : `${s.employees} employee${s.employees === 1 ? '' : 's'}`}</small>
                  </div>
                ))}
              </div>
              <div className="lv-stagebar">
                <span>Employee contributions deducted in {period} salary slips. Employer PF / ESI shares are not part of the salary slip.</span>
                <button type="button" className="att-link" onClick={exportStatutory} disabled={!k?.slips}>
                  Export CSV
                </button>
              </div>
              <div className="emp-table-wrap">
                <table className="emp-table lv-table pay-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th className="pay-money">Gross</th>
                      <th className="pay-money">PF</th>
                      <th className="pay-money">ESI</th>
                      <th className="pay-money">Prof. Tax</th>
                      <th className="pay-money">TDS</th>
                      <th className="pay-money">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => (
                      <tr key={row.id}>
                        {personCell(row)}
                        <td className="pay-money">{money(row.gross)}</td>
                        {STATUTORY_KEYS.map((key) => (
                          <td key={key} className="pay-money">
                            {statutoryOf(row, key) ? money(statutoryOf(row, key)) : <span className="lv-muted">—</span>}
                          </td>
                        ))}
                        <td className="pay-money">
                          <b>{money(row.deductions)}</b>
                        </td>
                      </tr>
                    ))}
                    {!pageRows.length ? emptyRow(7, `No salary slips for ${period} yet.`) : null}
                  </tbody>
                </table>
              </div>
              {pager('salary slips')}
            </>
          ) : null}
        </section>

        <aside className="lv-side">
          <div className="emp-card lv-side-card">
            <div className="lv-side-head static">
              <span className="dep-kpi-icon blue lv-side-icon">
                <HrmsIcon name="zap" size={17} />
              </span>
              <b>Payroll Actions</b>
            </div>
            <div className="pay-action-list">
              <button type="button" className="hot" onClick={() => startJob('process', rows)} disabled={!reg?.available}>
                <HrmsIcon name="zap" size={17} />
                <span>Process Payroll</span>
                {k?.not_processed ? <em>{k.not_processed}</em> : null}
                <HrmsIcon name="chevronRight" size={16} />
              </button>
              <button type="button" onClick={() => startJob('approve', rows)} disabled={!reg?.available}>
                <HrmsIcon name="checkCircle" size={17} />
                <span>Approve Pending Payroll</span>
                {k?.drafts ? <em>{k.drafts}</em> : null}
                <HrmsIcon name="chevronRight" size={16} />
              </button>
              <button type="button" onClick={() => setTab('payslips')}>
                <HrmsIcon name="file" size={17} />
                <span>Generate Payslips</span>
                <HrmsIcon name="chevronRight" size={16} />
              </button>
              <button type="button" onClick={() => exportRegister(rows)} disabled={!rows.length}>
                <HrmsIcon name="download" size={17} />
                <span>Download Payroll Report</span>
                <HrmsIcon name="chevronRight" size={16} />
              </button>
              <button type="button" onClick={() => setTab('statutory')}>
                <HrmsIcon name="clipboard" size={17} />
                <span>Statutory Reports (PF, ESI, TDS)</span>
                <HrmsIcon name="chevronRight" size={16} />
              </button>
            </div>
          </div>

          <div className="emp-card lv-side-card">
            <div className="lv-side-head static">
              <span className="dep-kpi-icon green lv-side-icon">
                <HrmsIcon name="wallet" size={17} />
              </span>
              <b>Payroll Summary</b>
            </div>
            <p className="lv-side-sub">{period}</p>
            <dl className="pay-summary">
              <dt>Total Employees</dt>
              <dd>{k?.employees ?? 0}</dd>
              <dt>Total Gross</dt>
              <dd>{money(k?.gross ?? 0)}</dd>
              <dt>Total Deductions</dt>
              <dd>{money(k?.deductions ?? 0)}</dd>
              <dt className="net">Net Payroll</dt>
              <dd className="net">{money(k?.net ?? 0)}</dd>
            </dl>
            {k && !k.slips && k.projected_gross ? <p className="pay-side-note">Projected gross from salary structures: {money(k.projected_gross)}</p> : null}
          </div>

          <div className="emp-card lv-side-card">
            <div className="lv-side-head static">
              <span className="dep-kpi-icon teal lv-side-icon">
                <HrmsIcon name="pieChart" size={17} />
              </span>
              <b>Payroll Status</b>
            </div>
            <div className="lv-pie-wrap pay-donut-wrap">
              <div className="pay-donut" style={{ background: donut }} aria-hidden>
                <span>
                  <strong>{k?.employees ?? 0}</strong>
                  <small>Employees</small>
                </span>
              </div>
              <ul>
                {STATUSES.map((s) => (
                  <li key={s}>
                    <i style={{ background: STATUS_COLOR[s] }} />
                    <button type="button" className="pay-legend-btn" onClick={() => setStatusFilter((cur) => (cur === s ? '' : s))}>
                      {s}
                    </button>
                    <b>
                      {statusCounts[s]} <em>({pctOf(statusCounts[s])}%)</em>
                    </b>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="emp-card lv-side-card">
            <div className="lv-side-head static">
              <span className="dep-kpi-icon violet lv-side-icon">
                <HrmsIcon name="clock" size={17} />
              </span>
              <b>Recent Activities</b>
            </div>
            <ul className="pay-activity">
              {(reg?.activities || []).map((a, i) => (
                <li key={`${a.at}-${i}`} className={a.kind}>
                  <b>{a.title}</b>
                  <span>{a.detail}</span>
                  <small>{fmtWhen(a.at)}</small>
                </li>
              ))}
              {!reg?.activities.length ? <li className="lv-muted">No payroll activity yet.</li> : null}
            </ul>
          </div>
        </aside>
      </div>

      {viewRow ? (
        <div className="emp-drawer-backdrop" role="presentation" onMouseDown={() => setViewId(null)}>
          <aside className="emp-drawer lv-drawer pay-drawer" role="dialog" aria-modal="true" aria-label={`${viewRow.name} salary`} onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div className="emp-person lg">
                <Avatar id={viewRow.id} name={viewRow.name} photo={viewRow.photo} />
                <div>
                  <b>{viewRow.name}</b>
                  <small>
                    {viewRow.id} · {viewRow.designation || viewRow.department || 'Employee'}
                  </small>
                </div>
              </div>
              <button type="button" className="emp-close" onClick={() => setViewId(null)} aria-label="Close">
                <HrmsIcon name="x" size={18} />
              </button>
            </header>
            <div className="lv-drawer-pills">
              <span className={`emp-pill ${STATUS_TONE[viewRow.status]}`}>{viewRow.status}</span>
              <span className="pay-stage">{viewRow.stage}</span>
              <span className="lv-drawer-id">{period}</span>
            </div>
            <dl>
              <dt>Department</dt>
              <dd>{viewRow.department || '—'}</dd>
              <dt>Salary structure</dt>
              <dd>{viewRow.structure || 'Not assigned'}</dd>
              <dt>Monthly base</dt>
              <dd>{viewRow.structure ? money(viewRow.base) : '—'}</dd>
              <dt>Payment days</dt>
              <dd>{viewRow.slip ? `${viewRow.payment_days ?? '—'} of ${viewRow.working_days ?? '—'}` : '—'}</dd>
              <dt>Salary slip</dt>
              <dd>{viewRow.slip || 'Not generated'}</dd>
            </dl>
            {viewRow.slip ? (
              <div className="pay-breakdown">
                <div>
                  <p>Earnings</p>
                  <ul>
                    {viewRow.earnings.map((l, i) => (
                      <li key={`${l.component}-${i}`}>
                        <span>{l.component}</span>
                        <b>{money2(l.amount)}</b>
                      </li>
                    ))}
                    <li className="total">
                      <span>Gross pay</span>
                      <b>{money2(viewRow.gross)}</b>
                    </li>
                  </ul>
                </div>
                <div>
                  <p>Deductions</p>
                  <ul>
                    {viewRow.deduction_lines.map((l, i) => (
                      <li key={`${l.component}-${i}`}>
                        <span>{l.component}</span>
                        <b>{money2(l.amount)}</b>
                      </li>
                    ))}
                    {!viewRow.deduction_lines.length ? <li className="lv-muted">No deductions</li> : null}
                    <li className="total">
                      <span>Total deductions</span>
                      <b>{money2(viewRow.deductions)}</b>
                    </li>
                  </ul>
                </div>
                <div className="pay-net">
                  <span>Net pay</span>
                  <b>{money2(viewRow.net)}</b>
                </div>
              </div>
            ) : (
              <p className="pay-side-note">
                {viewRow.structure
                  ? `No salary slip for ${period} yet. Process payroll to calculate earnings and deductions.`
                  : 'Assign a salary structure before payroll can be processed for this employee.'}
              </p>
            )}
            <div className="emp-drawer-actions">
              {canProcess(viewRow) ? (
                <button type="button" className="emp-btn primary" onClick={() => startJob('process', [viewRow])}>
                  <HrmsIcon name="zap" size={15} /> Process payroll
                </button>
              ) : null}
              {canApprove(viewRow) ? (
                <button type="button" className="emp-btn primary" onClick={() => startJob('approve', [viewRow])}>
                  <HrmsIcon name="check" size={15} /> Approve
                </button>
              ) : null}
              {viewRow.slip ? (
                <button type="button" className="emp-btn outline" onClick={() => void printPayslips([viewRow], company, period)}>
                  <HrmsIcon name="printer" size={15} /> Print payslip
                </button>
              ) : null}
              <a
                className="emp-btn outline"
                href={
                  viewRow.slip
                    ? `${deskAppUrl()}/app/salary-slip/${encodeURIComponent(viewRow.slip)}`
                    : `${deskAppUrl()}/app/salary-structure-assignment?employee=${encodeURIComponent(viewRow.id)}`
                }
                target="_blank"
                rel="noreferrer"
              >
                <HrmsIcon name="pencil" size={15} /> {viewRow.slip ? 'Open in ERP' : 'Salary structure'}
              </a>
            </div>
          </aside>
        </div>
      ) : null}

      {job && jobCopy ? (
        <div className="emp-drawer-backdrop lv-modal-backdrop" role="presentation" onMouseDown={() => !job.running && setJob(null)}>
          <div className="emp-card lv-modal" role="dialog" aria-modal="true" aria-label={jobCopy.title} onMouseDown={(e) => e.stopPropagation()}>
            <h3>
              {jobCopy.title} — {period}
            </h3>
            {!jobTotal ? (
              <p>{jobCopy.empty}</p>
            ) : job.finished ? (
              <p>
                <b>{job.ok}</b> {jobCopy.done}
                {job.failures.length ? `, ${job.failures.length} could not be completed.` : '.'}
              </p>
            ) : (
              <>
                <p>{jobCopy.intro}</p>
                <p>
                  {jobTotal === 1 ? (
                    <>
                      Employee: <b>{job.rows[0].name}</b> ({job.rows[0].id})
                    </>
                  ) : (
                    <>
                      <b>{jobTotal}</b> employees will be included.
                    </>
                  )}
                </p>
                <p className="lv-modal-note">{jobCopy.note}</p>
              </>
            )}
            {job.running || job.finished ? (
              <div className="pay-progress">
                <div role="progressbar" aria-valuemin={0} aria-valuemax={jobTotal} aria-valuenow={job.done}>
                  <span style={{ width: `${jobTotal ? (job.done / jobTotal) * 100 : 0}%` }} />
                </div>
                <small>
                  {job.running ? `${jobCopy.running}… ` : ''}
                  {job.done} of {jobTotal}
                </small>
              </div>
            ) : null}
            {job.failures.length ? <div className="people-alert err lv-pre pay-failures">{job.failures.join('\n')}</div> : null}
            <div className="lv-modal-actions">
              {job.finished || !jobTotal ? (
                <button type="button" className="emp-btn primary" onClick={() => setJob(null)}>
                  Close
                </button>
              ) : (
                <>
                  <button type="button" className="emp-btn outline" onClick={() => setJob(null)} disabled={job.running}>
                    Cancel
                  </button>
                  <button type="button" className="emp-btn primary" onClick={() => void runJob()} disabled={job.running}>
                    {job.running ? 'Working…' : `${jobCopy.verb}${jobTotal > 1 ? ` ${jobTotal}` : ''}`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PeoplePayslipsPage() {
  const [isManager, setIsManager] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await api.getPeopleHrmsDashboard();
        if (alive) setIsManager(Boolean(res.data.is_manager));
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Unable to load payroll');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="muted">Loading payroll…</p>;
  return isManager ? <PayrollManager /> : <PeoplePayslipsSelf />;
}
