import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  PeopleHrmsDashboard,
  PeopleLeaveAction,
  PeopleLeaveApplication,
  PeopleLeaveRegister,
  PeopleLeaveStage,
  PeopleLeaveStatus,
} from '../../api';
import {
  Le2Alerts,
  Le2LeaveBalanceCard,
  Le2LeaveForm,
  Le2RecentLeaves,
  Le2Unavailable,
} from '../../components/LeaveExpenseV2';
import { HrmsIcon } from '../../components/HrmsIcons';
import { deskAppUrl } from '../../config';
import { Avatar, downloadCsv, escapeHtml, FilterDropdown, Pager } from './peopleTableKit';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-grades.css';
import './people-attendance.css';
import './people-leave.css';

export function PeopleLeaveSelfService() {
  const [data, setData] = useState<PeopleHrmsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [leaveType, setLeaveType] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPeopleHrmsDashboard();
      setData(res.data);
      if (!leaveType && res.data.leave_types?.[0]?.name) {
        setLeaveType(res.data.leave_types[0].name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load leave');
    } finally {
      setLoading(false);
    }
  }, [leaveType]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetLeaveForm() {
    setFromDate('');
    setToDate('');
    setReason('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.submitLeaveApplication({
        leave_type: leaveType,
        from_date: fromDate,
        to_date: toDate,
        description: reason,
      });
      setMessage(res.message || 'Leave submitted');
      resetLeaveForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit leave');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !data) return <p className="muted">Loading leave…</p>;
  if (error && !data) return <div className="le2-alert is-err">{error}</div>;
  if (!data) return null;
  if (!data.hr_available) {
    return <Le2Unavailable title="Apply for leave" detail="HR module is not available on this site yet." />;
  }

  return (
    <div className="le2-root">
      <Le2Alerts error={error} message={message} />
      <div className="le2-layout">
        <Le2LeaveForm
          leaveTypes={data.leave_types || []}
          leaveType={leaveType}
          fromDate={fromDate}
          toDate={toDate}
          reason={reason}
          submitting={submitting}
          onLeaveType={setLeaveType}
          onFromDate={setFromDate}
          onToDate={setToDate}
          onReason={setReason}
          onSubmit={onSubmit}
          onCancel={resetLeaveForm}
        />
        <div className="le2-side">
          <Le2LeaveBalanceCard rows={data.leave_balances} />
          <Le2RecentLeaves rows={data.leave_applications || []} />
        </div>
      </div>
    </div>
  );
}

type Tab = 'applications' | 'calendar' | 'balance' | 'reports';
type PendingStage = Extract<PeopleLeaveStage, 'Draft' | 'Manager Review' | 'HR Review'>;
type ActionRequest = { rows: PeopleLeaveApplication[]; action: PeopleLeaveAction };

const TYPE_COLORS = ['#3b82f6', '#16a34a', '#ef4444', '#a855f7', '#f59e0b', '#06b6d4', '#ec4899', '#64748b'];

const STATUS_TONE: Record<PeopleLeaveStatus, string> = {
  Pending: 'amber',
  Approved: 'green',
  Rejected: 'red',
  'Manager Rejected': 'rose',
  Draft: 'grey',
  Cancelled: 'grey',
};

const STAGE_LABEL: Record<PeopleLeaveStage, string> = {
  Draft: 'With Employee',
  'Manager Review': 'Manager Review',
  'HR Review': 'HR Review',
  Completed: 'Completed',
  Rejected: 'Completed',
  Cancelled: 'Cancelled',
};

const ACTION_COPY: Record<PeopleLeaveAction, { title: string; verb: string; done: string; tone: 'primary' | 'danger'; remark: string }> = {
  recommend: { title: 'Approve as manager', verb: 'Approve', done: 'approved by manager (send to HR next)', tone: 'primary', remark: 'Manager note (optional)' },
  decide_reject: { title: 'Reject as manager', verb: 'Reject', done: 'rejected by manager (send to HR next)', tone: 'danger', remark: 'Reason for rejection' },
  forward: { title: 'Send to HR', verb: 'Send to HR', done: 'sent to HR for final review', tone: 'primary', remark: 'Manager note (optional)' },
  manager_reject: { title: 'Reject & send to HR', verb: 'Reject → HR', done: 'rejected by manager and sent to HR', tone: 'danger', remark: 'Reason for rejection' },
  return: { title: 'Return to employee', verb: 'Return', done: 'returned to the employee', tone: 'primary', remark: 'What should the employee change?' },
  resubmit: { title: 'Resubmit for review', verb: 'Resubmit', done: 'resubmitted for manager review', tone: 'primary', remark: 'Note (optional)' },
  approve: { title: 'Approve leave', verb: 'Approve', done: 'approved', tone: 'primary', remark: 'HR remark (optional)' },
  reject: { title: 'Reject leave', verb: 'Reject', done: 'rejected', tone: 'danger', remark: 'Reason for rejection' },
};

function isoDate(d: Date) {
  return d.toLocaleDateString('en-CA');
}

function monthRange(base: Date) {
  return {
    from: isoDate(new Date(base.getFullYear(), base.getMonth(), 1)),
    to: isoDate(new Date(base.getFullYear(), base.getMonth() + 1, 0)),
  };
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function DateCell({ iso }: { iso: string }) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return (
    <>
      {d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
      <span className="lv-yr"> {d.getFullYear()}</span>
    </>
  );
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T'));
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDays(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function typeTone(type: string) {
  const t = type.toLowerCase();
  if (t.includes('casual')) return 'blue';
  if (t.includes('sick') || t.includes('medical')) return 'red';
  if (t.includes('earned') || t.includes('privilege')) return 'green';
  if (t.includes('maternity')) return 'violet';
  if (t.includes('paternity')) return 'cyan';
  if (t.includes('unpaid') || t.includes('without pay') || t.includes('lwp')) return 'orange';
  return 'grey';
}

function printLeaveSlip(row: PeopleLeaveApplication) {
  const w = window.open('', '_blank', 'width=720,height=860');
  if (!w) return;
  const line = (k: string, v: unknown) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`;
  w.document.write(`<!doctype html><html><head><title>${escapeHtml(row.id)}</title><style>
    body{font-family:Inter,system-ui,sans-serif;color:#0f2a3d;padding:40px}
    h1{font-size:20px;margin:0 0 4px}p{color:#64748b;margin:0 0 24px}
    table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #e3e9ef;font-size:14px}
    th{width:38%;color:#475569;font-weight:600}.st{display:inline-block;padding:3px 10px;border-radius:999px;background:#dcfce7;color:#15803d;font-weight:700}
    .sig{margin-top:56px;display:flex;justify-content:space-between;font-size:13px;color:#475569}
  </style></head><body>
    <h1>Leave ${row.status === 'Approved' ? 'Approval' : 'Decision'} — ${escapeHtml(row.id)}</h1>
    <p>Generated ${escapeHtml(new Date().toLocaleString('en-GB'))}</p>
    <table>
      ${line('Employee', `${row.employee_name} (${row.employee})`)}
      ${line('Department', row.department || '—')}
      ${line('Designation', row.designation || '—')}
      ${line('Leave type', row.leave_type)}
      ${line('Period', `${fmtDate(row.from_date)} – ${fmtDate(row.to_date)}`)}
      ${line('Days', fmtDays(row.days) + (row.half_day ? ` (half day on ${fmtDate(row.half_day_date)})` : ''))}
      ${line('Reason', row.reason || '—')}
      ${line('Applied on', fmtDate(row.posting_date))}
      ${line('Manager review', row.manager_decision ? `${row.manager_decision} by ${row.manager_by || '—'} on ${fmtDateTime(row.manager_on)}` : '—')}
      ${line('HR remark', row.hr_remark || '—')}
      <tr><th>Status</th><td><span class="st">${escapeHtml(row.status)}</span></td></tr>
    </table>
    <div class="sig"><span>Employee signature</span><span>Authorised signatory</span></div>
    <script>window.onload=()=>window.print()</script>
  </body></html>`);
  w.document.close();
}

function NewLeaveDrawer({
  reg,
  defaultEmployee,
  onClose,
  onCreated,
}: {
  reg: PeopleLeaveRegister;
  defaultEmployee: string;
  onClose: () => void;
  onCreated: (msg: string) => Promise<void>;
}) {
  const employees = useMemo(
    () => reg.employees.filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name)),
    [reg.employees],
  );
  const [employee, setEmployee] = useState(defaultEmployee);
  const [leaveType, setLeaveType] = useState(reg.leave_types.find((t) => !t.is_lwp)?.name || reg.leave_types[0]?.name || '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [halfDay, setHalfDay] = useState(false);
  const [halfDayDate, setHalfDayDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const span = from && to && to >= from ? Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000) + 1 : 0;
  const days = span ? span - (halfDay ? 0.5 : 0) : 0;
  const slot = employee && leaveType ? reg.balances[employee]?.[leaveType] : undefined;
  const lwp = Boolean(reg.leave_types.find((t) => t.name === leaveType)?.is_lwp);
  const remaining = slot ? slot.allocated - slot.used - slot.pending : null;
  const me = employees.find((e) => e.id === reg.me);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!employee || !leaveType || !from || !to) {
      setError('Employee, leave type and dates are required');
      return;
    }
    if (to < from) {
      setError('To date cannot be before from date');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.createPeopleLeaveRequest({
        employee,
        leave_type: leaveType,
        from_date: from,
        to_date: to,
        half_day: halfDay ? 1 : 0,
        half_day_date: halfDay ? halfDayDate || from : undefined,
        reason,
      });
      await onCreated(`${res.data.name} created and sent for manager review`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create leave request');
      setBusy(false);
    }
  }

  return (
    <div className="emp-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="emp-drawer lv-drawer" role="dialog" aria-modal="true" aria-label="New leave request" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <b className="lv-drawer-title">New Leave Request</b>
            <small className="lv-drawer-sub">Raised on behalf of an employee; goes to manager review</small>
          </div>
          <button type="button" className="emp-close" onClick={onClose} aria-label="Close">
            <HrmsIcon name="x" size={18} />
          </button>
        </header>
        <form className="lv-form" onSubmit={(e) => void submit(e)}>
          <label>
            <span>Employee</span>
            <select value={employee} onChange={(e) => setEmployee(e.target.value)} required>
              <option value="">Select employee…</option>
              {me ? <option value={me.id}>Myself — {me.name}</option> : null}
              {employees
                .filter((e) => e.id !== reg.me)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {e.id}
                    {e.department ? ` · ${e.department}` : ''}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Leave type</span>
            <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} required>
              {reg.leave_types.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                  {t.max_leaves_allowed ? ` (max ${t.max_leaves_allowed}/yr)` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="lv-form-row">
            <label>
              <span>From date</span>
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} required />
            </label>
            <label>
              <span>To date</span>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} required />
            </label>
          </div>
          <label className="emp-check-label">
            <input type="checkbox" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} />
            Includes a half day
          </label>
          {halfDay ? (
            <label>
              <span>Half day date</span>
              <input type="date" value={halfDayDate || from} min={from || undefined} max={to || undefined} onChange={(e) => setHalfDayDate(e.target.value)} />
            </label>
          ) : null}
          <label>
            <span>Reason</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for leave" />
          </label>
          <div className="lv-form-hint">
            <span>
              Requested: <b>{days ? `${fmtDays(days)} calendar day${days === 1 ? '' : 's'}` : '—'}</b>
            </span>
            <span>
              {lwp
                ? 'Unpaid leave — no balance needed'
                : remaining == null
                  ? `No ${reg.year} allocation yet — one is created on approval`
                  : `Available: ${fmtDays(Math.max(0, remaining))} of ${fmtDays(slot!.allocated)}`}
            </span>
          </div>
          {error ? <div className="people-alert err">{error}</div> : null}
          <div className="emp-drawer-actions">
            <button type="submit" className="emp-btn primary" disabled={busy}>
              <HrmsIcon name="send" size={15} /> {busy ? 'Submitting…' : 'Submit request'}
            </button>
            <button type="button" className="emp-btn outline" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function LeaveManager() {
  const initial = monthRange(new Date());
  const [tab, setTab] = useState<Tab>('applications');
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [reg, setReg] = useState<PeopleLeaveRegister | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stageFilter, setStageFilter] = useState<PendingStage | ''>('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [balPage, setBalPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewAttachments, setViewAttachments] = useState<Array<{ id: string; file_name: string; uploaded_on: string }>>([]);
  const [viewAttachBusy, setViewAttachBusy] = useState(false);
  const [newOpen, setNewOpen] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionRequest | null>(null);
  const [remark, setRemark] = useState('');
  const [editFrom, setEditFrom] = useState('');
  const [editTo, setEditTo] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPeopleLeave({ fromDate: from, toDate: to });
      setReg(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load leave applications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fromDate && toDate) void load(fromDate, toDate);
  }, [load, fromDate, toDate]);

  useEffect(() => {
    setPage(1);
    setBalPage(1);
  }, [deptFilter, typeFilter, statusFilter, stageFilter, query, perPage, fromDate, toDate]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!viewId) {
      setViewAttachments([]);
      return;
    }
    let cancelled = false;
    setViewAttachBusy(true);
    void api
      .getPeopleLeaveAttachments(viewId)
      .then((res) => {
        if (!cancelled) setViewAttachments(res.data?.attachments || []);
      })
      .catch(() => {
        if (!cancelled) setViewAttachments([]);
      })
      .finally(() => {
        if (!cancelled) setViewAttachBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewId]);

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

  const apps = useMemo(() => reg?.applications || [], [reg]);
  const k = reg?.kpis;
  const viewRow = viewId ? apps.find((a) => a.id === viewId) || null : null;

  const options = useMemo(() => {
    const uniq = (values: Array<string | null | undefined>) =>
      Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b));
    return {
      departments: uniq([...apps.map((a) => a.department), ...(reg?.employees || []).map((e) => e.department)]),
      types: uniq([...(reg?.leave_types || []).map((t) => t.name), ...apps.map((a) => a.leave_type)]),
      statuses: uniq(apps.map((a) => a.status)),
    };
  }, [apps, reg]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      apps.filter(
        (a) =>
          (stageFilter ? a.stage === stageFilter : Boolean(a.in_range)) &&
          (!deptFilter || a.department === deptFilter) &&
          (!typeFilter || a.leave_type === typeFilter) &&
          (!statusFilter || a.status === statusFilter) &&
          (!q || [a.employee_name, a.employee, a.id, a.department].some((v) => (v || '').toLowerCase().includes(q))),
      ),
    [apps, stageFilter, deptFilter, typeFilter, statusFilter, q],
  );
  const outsideRange = stageFilter ? filtered.filter((a) => !a.in_range).length : 0;

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  const firstShown = filtered.length ? (currentPage - 1) * perPage + 1 : 0;
  const lastShown = Math.min(currentPage * perPage, filtered.length);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const filtersActive = Boolean(deptFilter || typeFilter || statusFilter || stageFilter || query);
  const selectedRows = apps.filter((a) => selected.has(a.id));
  const rangeLabel = reg ? `${fmtDate(reg.from_date)} – ${fmtDate(reg.to_date)}` : '';
  const stamp = reg ? `${reg.from_date}_to_${reg.to_date}` : 'leave';
  const trend = k && k.prev_total ? Math.round(((k.total - k.prev_total) / k.prev_total) * 100) : null;

  const resetFilters = () => {
    setDeptFilter('');
    setTypeFilter('');
    setStatusFilter('');
    setStageFilter('');
    setQuery('');
    setSelected(new Set());
  };

  const showStage = (stage: PendingStage) => {
    setTab('applications');
    setStatusFilter('');
    setStageFilter((cur) => (cur === stage ? '' : stage));
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
    const menuHeight = 230;
    const top = rect.bottom + menuHeight + 8 > window.innerHeight ? rect.top - menuHeight - 4 : rect.bottom + 4;
    setMenuPos({ top: Math.max(8, top), left: Math.max(8, rect.right - 230) });
    setMenuFor(id);
  };

  const ask = (rows: PeopleLeaveApplication[], action: PeopleLeaveAction) => {
    setMenuFor(null);
    setRemark('');
    setActionError(null);
    const first = rows[0];
    setEditFrom(rows.length === 1 && first ? first.from_date : '');
    setEditTo(rows.length === 1 && first ? first.to_date : '');
    setPendingAction({ rows, action });
  };

  const runAction = async () => {
    if (!pendingAction) return;
    const { rows, action } = pendingAction;
    const needsRemark = action === 'reject' || action === 'manager_reject' || action === 'decide_reject' || action === 'return';
    if (needsRemark && !remark.trim()) {
      setActionError('Please add a reason so the employee knows why.');
      return;
    }
    setActing(true);
    setActionError(null);
    const failed: string[] = [];
    for (const row of rows) {
      try {
        const dates =
          rows.length === 1 && (editFrom || editTo)
            ? { from_date: editFrom || row.from_date, to_date: editTo || row.to_date }
            : undefined;
        await api.actPeopleLeave(row.id, action, remark.trim(), dates);
      } catch (err) {
        failed.push(`${row.employee_name} (${row.id}): ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
    setActing(false);
    const ok = rows.length - failed.length;
    if (failed.length) {
      setActionError(failed.join('\n'));
      setPendingAction({ rows: rows.filter((r) => failed.some((f) => f.includes(r.id))), action });
    } else {
      setPendingAction(null);
    }
    if (ok) {
      setNotice(`${ok} application${ok === 1 ? '' : 's'} ${ACTION_COPY[action].done}`);
      setSelected(new Set());
      await load(fromDate, toDate);
    }
  };

  const exportApplications = (list: PeopleLeaveApplication[]) =>
    downloadCsv(
      `leave-applications-${stamp}.csv`,
      ['Application', 'Employee ID', 'Employee', 'Department', 'Leave Type', 'From', 'To', 'Days', 'Status', 'Stage', 'Manager Decision', 'Reason', 'Applied On'],
      list.map((a) => [a.id, a.employee, a.employee_name, a.department, a.leave_type, a.from_date, a.to_date, a.days, a.status, STAGE_LABEL[a.stage], a.manager_decision, a.reason, a.posting_date]),
    );

  const balanceTypes = useMemo(() => (reg?.leave_types || []).filter((t) => !t.is_lwp).map((t) => t.name), [reg]);
  const balanceRows = useMemo(
    () =>
      (reg?.employees || [])
        .filter((e) => e.active)
        .filter(
          (e) =>
            (!deptFilter || e.department === deptFilter) &&
            (!q || [e.name, e.id, e.department].some((v) => (v || '').toLowerCase().includes(q))),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [reg, deptFilter, q],
  );
  const balPages = Math.max(1, Math.ceil(balanceRows.length / perPage));
  const balCurrent = Math.min(balPage, balPages);
  const balPageRows = balanceRows.slice((balCurrent - 1) * perPage, balCurrent * perPage);

  const exportBalances = () =>
    downloadCsv(
      `leave-balance-${reg?.year}.csv`,
      ['Employee ID', 'Employee', 'Department', ...balanceTypes.flatMap((t) => [`${t} allocated`, `${t} used`, `${t} pending`, `${t} balance`])],
      balanceRows.map((e) => [
        e.id,
        e.name,
        e.department,
        ...balanceTypes.flatMap((t): Array<number | string> => {
          const s = reg?.balances[e.id]?.[t];
          return s ? [s.allocated, s.used, s.pending, Math.max(0, s.allocated - s.used)] : ['', '', '', ''];
        }),
      ]),
    );

  const ranged = useMemo(() => apps.filter((a) => a.in_range), [apps]);
  const deptReport = useMemo(() => {
    const map = new Map<string, { apps: number; days: number; approved: number; pending: number; rejected: number }>();
    ranged.forEach((a) => {
      const key = a.department || 'Unassigned';
      const cur = map.get(key) || { apps: 0, days: 0, approved: 0, pending: 0, rejected: 0 };
      cur.apps += 1;
      if (a.stage === 'Completed') {
        cur.approved += 1;
        cur.days += a.days;
      } else if (a.stage === 'Rejected') cur.rejected += 1;
      else if (a.stage !== 'Cancelled') cur.pending += 1;
      map.set(key, cur);
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.apps - a.apps);
  }, [ranged]);

  const exportDeptReport = () =>
    downloadCsv(
      `leave-by-department-${stamp}.csv`,
      ['Department', 'Applications', 'Approved', 'Pending', 'Rejected', 'Approved days'],
      deptReport.map((d) => [d.name, d.apps, d.approved, d.pending, d.rejected, d.days]),
    );

  const distTotal = (reg?.type_distribution || []).reduce((s, d) => s + d.days, 0);
  const typeColor = (type: string) => {
    const idx = (reg?.leave_types || []).findIndex((t) => t.name === type);
    return TYPE_COLORS[(idx >= 0 ? idx : (reg?.leave_types.length || 0) + (reg?.type_distribution || []).findIndex((d) => d.leave_type === type)) % TYPE_COLORS.length];
  };
  const pie = (() => {
    if (!distTotal || !reg) return '#eef2f6';
    let acc = 0;
    return `conic-gradient(${reg.type_distribution
      .map((d) => {
        const from = (acc / distTotal) * 360;
        acc += d.days;
        return `${typeColor(d.leave_type)} ${from}deg ${(acc / distTotal) * 360}deg`;
      })
      .join(', ')})`;
  })();

  const calendarMonth = new Date(`${fromDate}T00:00:00`);
  const shiftMonth = (delta: number) => {
    const r = monthRange(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + delta, 1));
    setFromDate(r.from);
    setToDate(r.to);
  };
  const calendarDays = useMemo(() => {
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const count = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
    const pad = (first.getDay() + 6) % 7;
    const live = apps.filter(
      (a) =>
        a.stage !== 'Rejected' &&
        a.stage !== 'Cancelled' &&
        (!deptFilter || a.department === deptFilter) &&
        (!typeFilter || a.leave_type === typeFilter) &&
        (!q || [a.employee_name, a.employee, a.department].some((v) => (v || '').toLowerCase().includes(q))),
    );
    const cells: Array<{ date: string; day: number; items: PeopleLeaveApplication[] } | null> = Array.from({ length: pad }, () => null);
    for (let d = 1; d <= count; d += 1) {
      const date = isoDate(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), d));
      cells.push({ date, day: d, items: live.filter((a) => a.from_date <= date && a.to_date >= date) });
    }
    return cells;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, fromDate, deptFilter, typeFilter, q]);
  const todayIso = isoDate(new Date());

  const kpis: Array<{ icon: string; tone: string; label: string; value: number; sub: string; up?: boolean; down?: boolean; stage?: PendingStage }> = [
    {
      icon: 'clipboard',
      tone: 'blue',
      label: 'Total Applications',
      value: k?.total ?? 0,
      sub: trend == null ? 'This period' : `${trend >= 0 ? '+' : ''}${trend}% vs last period`,
      up: trend != null && trend >= 0,
      down: trend != null && trend < 0,
    },
    { icon: 'file', tone: 'orange', label: 'Pending with Employee', value: k?.draft ?? 0, sub: 'Draft applications', stage: 'Draft' },
    { icon: 'clock', tone: 'amber', label: 'Pending with Manager', value: k?.manager_review ?? 0, sub: 'Awaiting manager review', stage: 'Manager Review' },
    { icon: 'user', tone: 'violet', label: 'Pending with HR', value: k?.hr_review ?? 0, sub: 'Awaiting HR approval', stage: 'HR Review' },
    { icon: 'checkCircle', tone: 'green', label: 'Approved', value: k?.approved ?? 0, sub: k?.approved_days ? `${fmtDays(k.approved_days)} days this period` : 'This period' },
    { icon: 'xCircle', tone: 'rose', label: 'Rejected', value: k?.rejected ?? 0, sub: 'This period' },
    {
      icon: 'alertTriangle',
      tone: 'rose',
      label: 'Unauthorised days',
      value: k?.unauthorized_days ?? (reg?.unauthorized || []).length,
      sub: 'Cut when dates were customised',
    },
  ];

  const rowActions = (row: PeopleLeaveApplication) => (
    <div className="emp-actions">
      <button type="button" title="View application" aria-label={`View ${row.id}`} onClick={() => setViewId(row.id)}>
        <HrmsIcon name="eye" size={17} />
      </button>
      {row.stage === 'Manager Review' ? (
        <>
          <button type="button" className="lv-act ok" title="Approve as manager" aria-label={`Approve ${row.id} as manager`} onClick={() => ask([row], 'recommend')}>
            <HrmsIcon name="check" size={17} strokeWidth={2.6} />
          </button>
          <button
            type="button"
            className="lv-act send"
            title={row.manager_decision ? 'Send to HR' : 'Approve or reject first, then send to HR'}
            aria-label={`Send ${row.id} to HR`}
            disabled={!row.manager_decision}
            onClick={() => ask([row], 'forward')}
          >
            <HrmsIcon name="send" size={16} />
          </button>
        </>
      ) : null}
      {row.stage === 'HR Review' ? (
        <>
          <button type="button" className="lv-act ok" title="Approve" aria-label={`Approve ${row.id}`} onClick={() => ask([row], 'approve')}>
            <HrmsIcon name="check" size={17} strokeWidth={2.6} />
          </button>
          <button type="button" className="lv-act no" title="Reject" aria-label={`Reject ${row.id}`} onClick={() => ask([row], 'reject')}>
            <HrmsIcon name="x" size={17} strokeWidth={2.6} />
          </button>
        </>
      ) : null}
      {row.stage === 'Completed' ? (
        <button type="button" title="Download approval slip" aria-label={`Download slip for ${row.id}`} onClick={() => printLeaveSlip(row)}>
          <HrmsIcon name="download" size={16} />
        </button>
      ) : null}
      <div className="emp-filter-wrap">
        <button
          type="button"
          className="emp-popover-trigger"
          title="More"
          aria-label={`More actions for ${row.id}`}
          aria-expanded={menuFor === row.id}
          onClick={(e) => openRowMenu(row.id, e.currentTarget)}
        >
          <HrmsIcon name="moreV" size={18} strokeWidth={3} />
        </button>
        {menuFor === row.id ? (
          <div className="emp-popover emp-menu" style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 230 }}>
            {row.stage === 'Manager Review' ? (
              <>
                <button type="button" onClick={() => ask([row], 'decide_reject')}>
                  <HrmsIcon name="xCircle" size={15} /> Reject as manager
                </button>
                <button type="button" disabled={!row.manager_decision} onClick={() => ask([row], 'forward')}>
                  <HrmsIcon name="send" size={15} /> Send to HR
                </button>
                <button type="button" onClick={() => ask([row], 'approve')}>
                  <HrmsIcon name="checkCircle" size={15} /> Approve now (skip HR)
                </button>
              </>
            ) : null}
            {row.stage === 'Manager Review' || row.stage === 'HR Review' ? (
              <button type="button" onClick={() => ask([row], 'return')}>
                <HrmsIcon name="undo" size={15} /> Return to employee
              </button>
            ) : null}
            {row.stage === 'Draft' ? (
              <button type="button" onClick={() => ask([row], 'resubmit')}>
                <HrmsIcon name="send" size={15} /> Resubmit for review
              </button>
            ) : null}
            <Link to={`/people/attendance`} onClick={() => setMenuFor(null)}>
              <HrmsIcon name="calendar" size={15} /> Attendance register
            </Link>
            <a href={`${deskAppUrl()}/app/leave-application/${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer" onClick={() => setMenuFor(null)}>
              <HrmsIcon name="file" size={15} /> Open in ERP
            </a>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(row.id);
                setNotice('Application ID copied');
                setMenuFor(null);
              }}
            >
              <HrmsIcon name="copy" size={15} /> Copy application ID
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  const viewBalance = viewRow ? reg?.balances[viewRow.employee]?.[viewRow.leave_type] : undefined;
  const overlapping = viewRow
    ? apps.filter(
        (a) =>
          a.id !== viewRow.id &&
          a.department &&
          a.department === viewRow.department &&
          a.stage !== 'Rejected' &&
          a.stage !== 'Cancelled' &&
          a.from_date <= viewRow.to_date &&
          a.to_date >= viewRow.from_date,
      )
    : [];

  return (
    <div className="hrms-list-page emp-page dep-page lv-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="calendar" size={28} />
          </span>
          <div>
            <h1>Leave Management</h1>
            <p>View, review and approve employee leave applications</p>
          </div>
        </div>
        <div className="dep-head-actions">
          <Link className="emp-btn outline lg" to="/people/policies?policy=leave-attendance">
            <HrmsIcon name="file" size={17} />
            Leave Policy
          </Link>
          <button className="emp-btn primary lg" type="button" onClick={() => setNewOpen('')} disabled={!reg}>
            <HrmsIcon name="plus" size={17} />
            New Leave Request
          </button>
        </div>
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}
      {reg && !reg.available ? <div className="people-alert err">Leave Application is not installed on ERPNext (HRMS app missing).</div> : null}

      {reg ? (
        <section className="lv-unauthorized" aria-label="Unauthorised leave dates">
          <h3>Unauthorised leave dates</h3>
          <p>Days requested by the employee but removed when a manager or HR customised the approved period.</p>
          {(reg.unauthorized || []).length ? (
            <div style={{ overflow: 'auto' }}>
              <table className="lv-unauthorized-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Date</th>
                    <th>Leave type</th>
                    <th>Application</th>
                  </tr>
                </thead>
                <tbody>
                  {(reg.unauthorized || []).map((u) => (
                    <tr key={u.id}>
                      <td>{u.employee_name}</td>
                      <td>{fmtDate(u.date)}</td>
                      <td>{u.leave_type}</td>
                      <td>
                        <button type="button" className="lv-attach-open" onClick={() => setViewId(u.leave)}>
                          {u.leave}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="lv-unauthorized-empty">No unauthorised leave dates in this range.</p>
          )}
        </section>
      ) : null}

      <div className="att-kpis lv-kpis">
        {kpis.map((kp) => {
          const body = (
            <>
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
            </>
          );
          return kp.stage ? (
            <button
              key={kp.label}
              type="button"
              className={`emp-card att-kpi lv-kpi-btn${stageFilter === kp.stage ? ' on' : ''}`}
              onClick={() => showStage(kp.stage!)}
              title={`Show all applications ${kp.sub.toLowerCase()}`}
            >
              {body}
            </button>
          ) : (
            <div key={kp.label} className="emp-card att-kpi">
              {body}
            </div>
          );
        })}
      </div>

      <div className="lv-layout">
        <section className="emp-card att-main lv-main">
          <div className="att-tabs-row">
            <nav className="att-tabs" role="tablist">
              {(
                [
                  ['applications', 'Leave Applications'],
                  ['calendar', 'Leave Calendar'],
                  ['balance', 'Leave Balance'],
                  ['reports', 'Leave Reports'],
                ] as Array<[Tab, string]>
              ).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <div className="att-filters lv-filters">
            <label className="att-date">
              <span>From Date</span>
              <div>
                <HrmsIcon name="calendar" size={16} />
                <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => e.target.value && setFromDate(e.target.value)} />
              </div>
            </label>
            <span className="att-arrow">→</span>
            <label className="att-date">
              <span>To Date</span>
              <div>
                <HrmsIcon name="calendar" size={16} />
                <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => e.target.value && setToDate(e.target.value)} />
              </div>
            </label>
            <FilterDropdown label="Department" value={deptFilter} allLabel="All Departments" options={options.departments} onChange={setDeptFilter} />
            {tab !== 'balance' ? (
              <FilterDropdown label="Leave type" value={typeFilter} allLabel="All Leave Types" options={options.types} onChange={setTypeFilter} />
            ) : null}
            {tab === 'applications' ? (
              <FilterDropdown
                label="Status"
                value={statusFilter}
                allLabel="All Statuses"
                options={options.statuses}
                onChange={(v) => {
                  setStatusFilter(v);
                  setStageFilter('');
                }}
              />
            ) : null}
            <label className="emp-search att-search">
              <HrmsIcon name="search" size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by employee name, ID or department..." aria-label="Search leave" />
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

          {tab === 'applications' ? (
            <>
              {stageFilter ? (
                <div className="lv-stagebar">
                  <span>
                    Showing every application <b>{stageFilter === 'Draft' ? 'pending with the employee' : `awaiting ${stageFilter.toLowerCase()}`}</b>
                    {outsideRange ? ` — ${outsideRange} ${outsideRange === 1 ? 'falls' : 'fall'} outside ${rangeLabel}` : ''}
                  </span>
                  <button type="button" className="att-link" onClick={() => setStageFilter('')}>
                    Clear
                  </button>
                </div>
              ) : null}
              {selected.size ? (
                <div className="dsg-selbar lv-selbar">
                  <span className="dsg-count">{selected.size} selected</span>
                  <button
                    type="button"
                    className="emp-btn outline"
                    disabled={!selectedRows.some((r) => r.stage === 'Manager Review')}
                    onClick={() => ask(selectedRows.filter((r) => r.stage === 'Manager Review'), 'forward')}
                  >
                    <HrmsIcon name="send" size={15} /> Forward to HR ({selectedRows.filter((r) => r.stage === 'Manager Review').length})
                  </button>
                  <button
                    type="button"
                    className="emp-btn primary"
                    disabled={!selectedRows.some((r) => r.stage === 'HR Review')}
                    onClick={() => ask(selectedRows.filter((r) => r.stage === 'HR Review'), 'approve')}
                  >
                    <HrmsIcon name="check" size={15} /> Approve ({selectedRows.filter((r) => r.stage === 'HR Review').length})
                  </button>
                  <button type="button" className="emp-btn outline" onClick={() => exportApplications(selectedRows)}>
                    <HrmsIcon name="download" size={15} /> Export
                  </button>
                  <button type="button" className="att-link" onClick={() => setSelected(new Set())}>
                    Clear selection
                  </button>
                </div>
              ) : null}
              <div className="emp-table-wrap">
                <table className="emp-table lv-table">
                  <thead>
                    <tr>
                      <th className="emp-col-check">
                        <input type="checkbox" checked={allOnPageSelected} onChange={togglePage} disabled={!pageRows.length} aria-label="Select all on this page" />
                      </th>
                      <th className="dep-col-num">#</th>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Leave Type</th>
                      <th>From Date</th>
                      <th>To Date</th>
                      <th className="lv-num">Days</th>
                      <th>Status</th>
                      <th className="lv-stage">Current Stage</th>
                      <th className="emp-col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && !reg ? (
                      <tr>
                        <td colSpan={11} className="emp-empty">
                          Loading leave applications…
                        </td>
                      </tr>
                    ) : null}
                    {pageRows.map((row, i) => (
                      <tr key={row.id} className={selected.has(row.id) ? 'selected' : ''}>
                        <td className="emp-col-check">
                          <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} aria-label={`Select ${row.id}`} />
                        </td>
                        <td className="dep-col-num">{(currentPage - 1) * perPage + i + 1}</td>
                        <td>
                          <div className="emp-person lv-person">
                            <Avatar id={row.employee} name={row.employee_name} photo={row.photo} />
                            <div>
                              <b>{row.employee_name}</b>
                              <small>{row.employee}</small>
                            </div>
                          </div>
                        </td>
                        <td className="lv-dept">{row.department || '—'}</td>
                        <td>
                          <span className={`emp-pill lv-type ${typeTone(row.leave_type)}`}>{row.leave_type}</span>
                        </td>
                        <td className="lv-date">
                          <DateCell iso={row.from_date} />
                        </td>
                        <td className="lv-date">
                          <DateCell iso={row.to_date} />
                        </td>
                        <td className="lv-num">{fmtDays(row.days)}</td>
                        <td>
                          <span className={`emp-pill ${STATUS_TONE[row.status]}`}>{row.status}</span>
                        </td>
                        <td className="lv-stage">{STAGE_LABEL[row.stage]}</td>
                        <td className="emp-col-actions">{rowActions(row)}</td>
                      </tr>
                    ))}
                    {!loading && !pageRows.length ? (
                      <tr>
                        <td colSpan={11} className="emp-empty">
                          {filtersActive ? 'No applications match these filters.' : `No leave applications in ${rangeLabel}.`}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <Pager
                page={currentPage}
                pages={pages}
                perPage={perPage}
                onPage={setPage}
                onPerPage={setPerPage}
                summary={`Showing ${firstShown} to ${lastShown} of ${filtered.length} applications${loading && reg ? ' · refreshing…' : ''}`}
              />
            </>
          ) : null}

          {tab === 'calendar' ? (
            <div className="lv-calendar">
              <div className="lv-cal-head">
                <button type="button" className="emp-btn outline" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                  <HrmsIcon name="chevronRight" size={16} style={{ transform: 'rotate(180deg)' }} />
                </button>
                <b>{calendarMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
                <button type="button" className="emp-btn outline" onClick={() => shiftMonth(1)} aria-label="Next month">
                  <HrmsIcon name="chevronRight" size={16} />
                </button>
                <span className="lv-cal-legend">
                  <i className="ok" /> Approved <i className="wait" /> Pending
                </span>
              </div>
              <div className="lv-cal-grid">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <b key={d}>{d}</b>
                ))}
                {calendarDays.map((cell, i) =>
                  cell ? (
                    <div key={cell.date} className={`lv-cal-cell${cell.date === todayIso ? ' today' : ''}${cell.items.length ? ' busy' : ''}`}>
                      <span className="lv-cal-day">{cell.day}</span>
                      {cell.items.slice(0, 3).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className={`lv-cal-chip ${a.stage === 'Completed' ? 'ok' : 'wait'}`}
                          title={`${a.employee_name} · ${a.leave_type} · ${a.status}`}
                          onClick={() => setViewId(a.id)}
                        >
                          {a.employee_name}
                        </button>
                      ))}
                      {cell.items.length > 3 ? <small>+{cell.items.length - 3} more</small> : null}
                    </div>
                  ) : (
                    <div key={`pad-${i}`} className="lv-cal-cell pad" />
                  ),
                )}
              </div>
            </div>
          ) : null}

          {tab === 'balance' ? (
            <>
              <div className="lv-stagebar">
                <span>
                  Leave balance for <b>{reg?.year}</b>: used / allocated per leave type (pending days in amber)
                </span>
                <button type="button" className="att-link" onClick={exportBalances} disabled={!balanceRows.length}>
                  Export CSV
                </button>
              </div>
              <div className="emp-table-wrap">
                <table className="emp-table lv-table">
                  <thead>
                    <tr>
                      <th className="dep-col-num">#</th>
                      <th>Employee</th>
                      <th>Department</th>
                      {balanceTypes.map((t) => (
                        <th key={t} className="lv-num">
                          {t}
                        </th>
                      ))}
                      <th className="lv-num">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balPageRows.map((e, i) => {
                      const per = reg?.balances[e.id] || {};
                      const total = balanceTypes.reduce((s, t) => s + (per[t] ? Math.max(0, per[t].allocated - per[t].used) : 0), 0);
                      const anyAlloc = balanceTypes.some((t) => per[t]?.allocated);
                      return (
                        <tr key={e.id}>
                          <td className="dep-col-num">{(balCurrent - 1) * perPage + i + 1}</td>
                          <td>
                            <div className="emp-person lv-person">
                              <Avatar id={e.id} name={e.name} photo={e.photo} />
                              <div>
                                <b>{e.name}</b>
                                <small>{e.id}</small>
                              </div>
                            </div>
                          </td>
                          <td className="lv-dept">{e.department || '—'}</td>
                          {balanceTypes.map((t) => {
                            const s = per[t];
                            return (
                              <td key={t} className="lv-num lv-bal">
                                {s && (s.allocated || s.used || s.pending) ? (
                                  <>
                                    <b>{fmtDays(s.used)}</b> / {fmtDays(s.allocated)}
                                    {s.pending ? <em> +{fmtDays(s.pending)}</em> : null}
                                  </>
                                ) : (
                                  '—'
                                )}
                              </td>
                            );
                          })}
                          <td className="lv-num">{anyAlloc ? <b>{fmtDays(total)}</b> : <span className="lv-muted">Not allocated</span>}</td>
                        </tr>
                      );
                    })}
                    {!balPageRows.length ? (
                      <tr>
                        <td colSpan={4 + balanceTypes.length} className="emp-empty">
                          No employees match these filters.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <Pager
                page={balCurrent}
                pages={balPages}
                perPage={perPage}
                onPage={setBalPage}
                onPerPage={setPerPage}
                summary={`Showing ${balanceRows.length ? (balCurrent - 1) * perPage + 1 : 0} to ${Math.min(balCurrent * perPage, balanceRows.length)} of ${balanceRows.length} employees`}
              />
            </>
          ) : null}

          {tab === 'reports' ? (
            <div className="lv-reports">
              <div className="lv-report-actions">
                <button type="button" className="lv-report-btn" onClick={() => exportApplications(ranged)} disabled={!ranged.length}>
                  <HrmsIcon name="clipboard" size={20} />
                  <span>
                    <b>Leave register</b>
                    <small>{ranged.length} applications · {rangeLabel}</small>
                  </span>
                  <HrmsIcon name="download" size={16} />
                </button>
                <button type="button" className="lv-report-btn" onClick={exportDeptReport} disabled={!deptReport.length}>
                  <HrmsIcon name="building" size={20} />
                  <span>
                    <b>Department summary</b>
                    <small>{deptReport.length} departments</small>
                  </span>
                  <HrmsIcon name="download" size={16} />
                </button>
                <button type="button" className="lv-report-btn" onClick={exportBalances}>
                  <HrmsIcon name="pieChart" size={20} />
                  <span>
                    <b>Leave balances {reg?.year}</b>
                    <small>Allocated, used, pending per employee</small>
                  </span>
                  <HrmsIcon name="download" size={16} />
                </button>
              </div>
              <div className="emp-table-wrap">
                <table className="emp-table lv-table">
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th className="lv-num">Applications</th>
                      <th className="lv-num">Approved</th>
                      <th className="lv-num">Pending</th>
                      <th className="lv-num">Rejected</th>
                      <th className="lv-num">Approved Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deptReport.map((d) => (
                      <tr key={d.name}>
                        <td>
                          <b>{d.name}</b>
                        </td>
                        <td className="lv-num">{d.apps}</td>
                        <td className="lv-num att-num green">{d.approved}</td>
                        <td className="lv-num att-num amber">{d.pending}</td>
                        <td className="lv-num att-num red">{d.rejected}</td>
                        <td className="lv-num">{fmtDays(d.days)}</td>
                      </tr>
                    ))}
                    {!deptReport.length ? (
                      <tr>
                        <td colSpan={6} className="emp-empty">
                          No leave applications in {rangeLabel}.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="lv-side">
          <div className="emp-card lv-side-card">
            <button type="button" className="lv-side-head" onClick={() => setTab('balance')}>
              <span className="dep-kpi-icon green lv-side-icon">
                <HrmsIcon name="pieChart" size={17} />
              </span>
              <b>Leave Balance Summary</b>
              <HrmsIcon name="chevronRight" size={16} />
            </button>
            <p className="lv-side-sub">Days used / allocated across employees, {reg?.year}</p>
            <ul className="lv-bal-list">
              {(reg?.balance_summary || []).map((s) => {
                const pctUsed = s.allocated ? Math.min(100, Math.round((s.used / s.allocated) * 100)) : 0;
                return (
                  <li key={s.leave_type}>
                    <div>
                      <span>{s.leave_type}</span>
                      <b>{s.allocated ? `${fmtDays(s.used)} / ${fmtDays(s.allocated)}` : s.used ? fmtDays(s.used) : '—'}</b>
                    </div>
                    <span className="lv-bar">
                      <span style={{ width: `${pctUsed}%`, background: typeColor(s.leave_type) }} />
                    </span>
                    <small>
                      {s.allocated ? `${s.employees} employee${s.employees === 1 ? '' : 's'} allocated` : s.is_lwp ? 'Unpaid — no allocation' : 'No allocations yet'}
                      {s.pending ? ` · ${fmtDays(s.pending)} pending` : ''}
                    </small>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="emp-card lv-side-card">
            <div className="lv-side-head static">
              <span className="dep-kpi-icon teal lv-side-icon">
                <HrmsIcon name="analytics" size={17} />
              </span>
              <b>Leave Type Distribution</b>
            </div>
            <p className="lv-side-sub">Days applied, {rangeLabel}</p>
            <div className="lv-pie-wrap">
              <div className="lv-pie" style={{ background: pie }} aria-hidden />
              <ul>
                {(reg?.type_distribution || []).map((d) => (
                  <li key={d.leave_type}>
                    <i style={{ background: typeColor(d.leave_type) }} />
                    <span>{d.leave_type}</span>
                    <b>{Math.round((d.days / distTotal) * 100)}%</b>
                  </li>
                ))}
                {!distTotal ? <li className="lv-muted">No leave in this period</li> : null}
              </ul>
            </div>
          </div>

          <div className="emp-card lv-side-card">
            <div className="lv-side-head static">
              <span className="dep-kpi-icon blue lv-side-icon">
                <HrmsIcon name="zap" size={17} />
              </span>
              <b>Quick Actions</b>
            </div>
            <div className="lv-quick">
              <button type="button" className="blue" onClick={() => setNewOpen(reg?.me || '')} disabled={!reg}>
                <HrmsIcon name="send" size={16} /> Apply for Leave
              </button>
              <button type="button" className="green" onClick={() => showStage('HR Review')}>
                <HrmsIcon name="check" size={16} /> Approve Pending Leaves
                {k?.hr_review ? <em>{k.hr_review}</em> : null}
              </button>
              <button type="button" className="violet" onClick={() => setTab('reports')}>
                <HrmsIcon name="barChart" size={16} /> Generate Leave Report
              </button>
            </div>
          </div>
        </aside>
      </div>

      {viewRow ? (
        <div className="emp-drawer-backdrop" role="presentation" onMouseDown={() => setViewId(null)}>
          <aside
            className="emp-drawer lv-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`${viewRow.id} details`}
            data-from={viewRow.from_date}
            data-to={viewRow.to_date}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div className="emp-person lg">
                <Avatar id={viewRow.employee} name={viewRow.employee_name} photo={viewRow.photo} />
                <div>
                  <b>{viewRow.employee_name}</b>
                  <small>
                    {viewRow.employee} · {viewRow.designation || viewRow.department || 'Employee'}
                  </small>
                </div>
              </div>
              <button type="button" className="emp-close" onClick={() => setViewId(null)} aria-label="Close">
                <HrmsIcon name="x" size={18} />
              </button>
            </header>
            <div className="lv-drawer-pills">
              <span className={`emp-pill lv-type ${typeTone(viewRow.leave_type)}`}>{viewRow.leave_type}</span>
              <span className={`emp-pill ${STATUS_TONE[viewRow.status]}`}>{viewRow.status}</span>
              <span className="lv-drawer-id">{viewRow.id}</span>
            </div>
            <dl>
              <dt>Period</dt>
              <dd>
                {fmtDate(viewRow.from_date)} – {fmtDate(viewRow.to_date)}
              </dd>
              <dt>Days</dt>
              <dd>
                {fmtDays(viewRow.days)}
                {viewRow.half_day ? ` (half day on ${fmtDate(viewRow.half_day_date)})` : ''}
              </dd>
              <dt>Department</dt>
              <dd>{viewRow.department || '—'}</dd>
              <dt>Reason</dt>
              <dd>{viewRow.reason || '—'}</dd>
              {viewRow.original_from && (viewRow.original_from !== viewRow.from_date || viewRow.original_to !== viewRow.to_date) ? (
                <>
                  <dt>Originally requested</dt>
                  <dd>
                    {fmtDate(viewRow.original_from)} – {fmtDate(viewRow.original_to)}
                  </dd>
                </>
              ) : null}
              {(viewRow.unauthorized_dates || []).length ? (
                <>
                  <dt>Unauthorised days</dt>
                  <dd>{(viewRow.unauthorized_dates || []).map(fmtDate).join(', ')}</dd>
                </>
              ) : null}
              <dt>Attachments</dt>
              <dd>
                {viewAttachBusy ? (
                  'Loading…'
                ) : viewAttachments.length ? (
                  <ul className="lv-attach-list">
                    {viewAttachments.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          className="lv-attach-open"
                          onClick={() => {
                            void api.openPeopleLeaveAttachment(f.id).then((res) => {
                              const bin = atob(res.data.data);
                              const bytes = new Uint8Array(bin.length);
                              for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
                              const url = URL.createObjectURL(new Blob([bytes], { type: res.data.mime }));
                              window.open(url, '_blank');
                            });
                          }}
                        >
                          {f.file_name.replace(`${viewRow.id}-`, '')}
                        </button>
                        <small>{String(f.uploaded_on || '').slice(0, 16)}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  'No attachment'
                )}
              </dd>
              <dt>Leave approver</dt>
              <dd>{viewRow.leave_approver_name || viewRow.leave_approver || 'Not set'}</dd>
              <dt>{viewRow.leave_type} balance</dt>
              <dd>
                {viewBalance
                  ? `${fmtDays(Math.max(0, viewBalance.allocated - viewBalance.used))} left of ${fmtDays(viewBalance.allocated)}${viewBalance.pending ? ` · ${fmtDays(viewBalance.pending)} pending` : ''}`
                  : 'No allocation this year'}
              </dd>
            </dl>
            <ol className="lv-timeline">
              <li className="done">
                <b>Applied</b>
                <span>
                  {fmtDate(viewRow.posting_date)} · by {viewRow.created_by}
                </span>
              </li>
              <li
                className={
                  viewRow.stage === 'Draft'
                    ? 'warn'
                    : viewRow.manager_decision === 'Rejected'
                      ? 'bad'
                      : viewRow.manager_decision || ['Completed', 'Rejected'].includes(viewRow.stage)
                        ? 'done'
                        : 'now'
                }
              >
                <b>Manager review</b>
                <span>
                  {viewRow.stage === 'Draft'
                    ? 'Returned to employee for changes'
                    : viewRow.manager_decision
                      ? `${viewRow.manager_decision} by ${viewRow.manager_by || '—'} · ${fmtDateTime(viewRow.manager_on)}`
                      : viewRow.stage === 'Manager Review'
                        ? 'Awaiting manager'
                        : 'Skipped'}
                </span>
                {viewRow.manager_remark ? <q>{viewRow.manager_remark}</q> : null}
              </li>
              <li className={viewRow.stage === 'Completed' ? 'done' : viewRow.stage === 'Rejected' ? 'bad' : viewRow.stage === 'HR Review' ? 'now' : ''}>
                <b>HR decision</b>
                <span>
                  {viewRow.stage === 'Completed' || viewRow.stage === 'Rejected'
                    ? `${viewRow.status} by ${viewRow.modified_by} · ${fmtDateTime(viewRow.modified_on)}`
                    : viewRow.stage === 'HR Review'
                      ? 'Awaiting HR approval'
                      : 'Not yet'}
                </span>
                {viewRow.hr_remark ? <q>{viewRow.hr_remark}</q> : null}
              </li>
            </ol>
            <div className="grd-emp-list">
              <p>Same department on leave in this period</p>
              <ul>
                {overlapping.length ? (
                  overlapping.map((a) => (
                    <li key={a.id}>
                      <b>{a.employee_name}</b>
                      <span>
                        {fmtDate(a.from_date)} – {fmtDate(a.to_date)} · {a.status}
                      </span>
                    </li>
                  ))
                ) : (
                  <li>
                    <span>Nobody else from {viewRow.department || 'this team'} is on leave then.</span>
                  </li>
                )}
              </ul>
            </div>
            <div className="emp-drawer-actions">
              {viewRow.stage === 'Manager Review' ? (
                <>
                  <button type="button" className="emp-btn primary" onClick={() => ask([viewRow], 'recommend')}>
                    <HrmsIcon name="check" size={15} /> Approve
                  </button>
                  <button type="button" className="emp-btn outline" onClick={() => ask([viewRow], 'decide_reject')}>
                    <HrmsIcon name="x" size={15} /> Reject
                  </button>
                  <button
                    type="button"
                    className="emp-btn primary"
                    disabled={!viewRow.manager_decision}
                    title={viewRow.manager_decision ? 'Send to HR' : 'Approve or reject first'}
                    onClick={() => ask([viewRow], 'forward')}
                  >
                    <HrmsIcon name="send" size={15} /> Send to HR
                  </button>
                </>
              ) : null}
              {viewRow.stage === 'HR Review' ? (
                <>
                  <button type="button" className="emp-btn primary" onClick={() => ask([viewRow], 'approve')}>
                    <HrmsIcon name="check" size={15} /> Approve
                  </button>
                  <button type="button" className="emp-btn outline" onClick={() => ask([viewRow], 'reject')}>
                    <HrmsIcon name="x" size={15} /> Reject
                  </button>
                </>
              ) : null}
              {viewRow.stage === 'Draft' ? (
                <button type="button" className="emp-btn primary" onClick={() => ask([viewRow], 'resubmit')}>
                  <HrmsIcon name="send" size={15} /> Resubmit
                </button>
              ) : null}
              {viewRow.stage === 'Completed' ? (
                <button type="button" className="emp-btn primary" onClick={() => printLeaveSlip(viewRow)}>
                  <HrmsIcon name="printer" size={15} /> Print slip
                </button>
              ) : null}
              <a className="emp-btn outline" href={`${deskAppUrl()}/app/leave-application/${encodeURIComponent(viewRow.id)}`} target="_blank" rel="noreferrer">
                <HrmsIcon name="pencil" size={15} /> Open in ERP
              </a>
            </div>
          </aside>
        </div>
      ) : null}

      {newOpen !== null && reg ? (
        <NewLeaveDrawer
          reg={reg}
          defaultEmployee={newOpen}
          onClose={() => setNewOpen(null)}
          onCreated={async (msg) => {
            setNewOpen(null);
            setNotice(msg);
            setTab('applications');
            await load(fromDate, toDate);
          }}
        />
      ) : null}

      {pendingAction ? (
        <div className="emp-drawer-backdrop lv-modal-backdrop" role="presentation" onMouseDown={() => !acting && setPendingAction(null)}>
          <div className="emp-card lv-modal" role="dialog" aria-modal="true" aria-label={ACTION_COPY[pendingAction.action].title} onMouseDown={(e) => e.stopPropagation()}>
            <h3>{ACTION_COPY[pendingAction.action].title}</h3>
            <p>
              {pendingAction.rows.length === 1
                ? `${pendingAction.rows[0].employee_name} · ${pendingAction.rows[0].leave_type} · ${fmtDate(pendingAction.rows[0].from_date)} – ${fmtDate(pendingAction.rows[0].to_date)} (${fmtDays(pendingAction.rows[0].days)} days)`
                : `${pendingAction.rows.length} applications · ${fmtDays(pendingAction.rows.reduce((s, r) => s + r.days, 0))} days in total`}
            </p>
            {pendingAction.action === 'approve' ? (
              <p className="lv-modal-note">Approving submits the application in ERPNext and marks attendance as On Leave for these dates.</p>
            ) : null}
            {pendingAction.rows.length === 1 && ['recommend', 'decide_reject', 'forward', 'manager_reject', 'approve', 'reject'].includes(pendingAction.action) ? (
              <div className="lv-date-edit">
                <p className="lv-modal-note">Customise dates if needed. Days removed from the request are recorded as unauthorised leave.</p>
                <label>
                  <span>From</span>
                  <input type="date" value={editFrom} max={editTo || undefined} onChange={(e) => setEditFrom(e.target.value)} />
                </label>
                <label>
                  <span>To</span>
                  <input type="date" value={editTo} min={editFrom || undefined} onChange={(e) => setEditTo(e.target.value)} />
                </label>
              </div>
            ) : null}
            <label>
              <span>{ACTION_COPY[pendingAction.action].remark}</span>
              <textarea rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} autoFocus />
            </label>
            {actionError ? <div className="people-alert err lv-pre">{actionError}</div> : null}
            <div className="lv-modal-actions">
              <button type="button" className="emp-btn outline" onClick={() => setPendingAction(null)} disabled={acting}>
                Cancel
              </button>
              <button type="button" className={`emp-btn primary${ACTION_COPY[pendingAction.action].tone === 'danger' ? ' lv-danger' : ''}`} onClick={() => void runAction()} disabled={acting}>
                {acting ? 'Working…' : `${ACTION_COPY[pendingAction.action].verb}${pendingAction.rows.length > 1 ? ` ${pendingAction.rows.length}` : ''}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PeopleLeavePage() {
  const [isManager, setIsManager] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await api.getPeopleHrmsDashboard();
        if (alive) setIsManager(Boolean(res.data.is_manager));
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Unable to load leave');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="muted">Loading leave…</p>;
  return isManager ? <LeaveManager /> : <PeopleLeaveSelfService />;
}
