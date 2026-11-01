import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExpenseClaimRow, LeaveApplicationRow } from '../api';
import './leave-expense-v2.css';

export type LeaveTypeOption = { name: string; leave_type_name?: string };
export type ExpenseTypeOption = { name: string; expense_type?: string };
export type LeaveBalanceRow = {
  leave_type: string;
  allocated?: number;
  taken: number;
  balance: number;
};

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const PAYMENT_MODES = ['Cash', 'Card', 'UPI', 'Bank Transfer', 'Other'];
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPTS = 5;
const RECEIPT_ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';

function parseYmd(value?: string | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function inclusiveDays(from: string, to: string): number {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (!a || !b || b < a) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function formatLongDate(value?: string | null): string {
  const d = parseYmd(value);
  if (!d) return value || '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatMoney(value?: number | null): string {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function daysLabel(n?: number | null): string {
  const days = Number(n || 0);
  if (!days) return '';
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function statusKind(status?: string | null): 'pending' | 'approved' | 'rejected' {
  const s = String(status || '').toLowerCase();
  if (s.includes('approv')) return 'approved';
  if (s.includes('reject') || s.includes('cancel')) return 'rejected';
  return 'pending';
}

function claimType(row: ExpenseClaimRow): string {
  return row.expenses?.[0]?.expense_type || row.remark || 'Expense';
}

function claimDate(row: ExpenseClaimRow): string {
  return row.posting_date || row.creation?.slice(0, 10) || '';
}

function inCurrentMonth(iso?: string | null): boolean {
  const d = parseYmd(iso);
  if (!d) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export function monthExpenseSummary(rows: ExpenseClaimRow[]) {
  let total = 0;
  let approved = 0;
  let pending = 0;
  let rejected = 0;
  for (const row of rows) {
    if (!inCurrentMonth(claimDate(row))) continue;
    const amt = Number(row.total_claimed_amount || 0);
    total += amt;
    const kind = statusKind(row.approval_status);
    if (kind === 'approved') approved += amt;
    else if (kind === 'rejected') rejected += amt;
    else pending += amt;
  }
  return { total, approved, pending, rejected };
}

export function composeExpenseRemark(
  description: string,
  paymentMode: string,
  purpose: string,
  location: string,
): string {
  const bits = [paymentMode, purpose, location].map((s) => s.trim()).filter(Boolean);
  const desc = description.trim();
  if (!bits.length) return desc;
  return bits.join(' · ') + (desc ? `\n${desc}` : '');
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function acceptReceipt(file: File): string | null {
  const okType =
    file.type === 'application/pdf' ||
    file.type === 'image/jpeg' ||
    file.type === 'image/png' ||
    /\.(pdf|jpe?g|png)$/i.test(file.name);
  if (!okType) return 'Only PDF, JPG, and PNG files are allowed.';
  if (file.size > MAX_RECEIPT_BYTES) return 'Each file must be 5 MB or smaller.';
  return null;
}

function Le2Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function Le2StatusBadge({ status }: { status?: string | null }) {
  const kind = statusKind(status);
  return <span className={`le2-badge is-${kind}`}>{status || 'Pending'}</span>;
}

function Le2Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="le2-field">
      <span className="le2-label">
        {label}
        {required ? <span className="le2-req">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function monthCells(view: Date): Array<{ date: Date; inMonth: boolean }> {
  const first = startOfMonth(view);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return { date, inMonth: date.getMonth() === view.getMonth() };
  });
}

function Le2Month({
  view,
  fromDate,
  toDate,
  onPick,
  onPrev,
  onNext,
}: {
  view: Date;
  fromDate: string;
  toDate: string;
  onPick: (ymd: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const from = parseYmd(fromDate);
  const to = parseYmd(toDate);
  const title = view.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return (
    <div>
      <div className="le2-month-head">
        <button type="button" className="le2-nav" onClick={onPrev} aria-label="Previous month" disabled={!onPrev}>
          <Le2Icon>
            <path d="M15 6l-6 6 6 6" />
          </Le2Icon>
        </button>
        <strong>{title}</strong>
        <button type="button" className="le2-nav" onClick={onNext} aria-label="Next month" disabled={!onNext}>
          <Le2Icon>
            <path d="M9 6l6 6-6 6" />
          </Le2Icon>
        </button>
      </div>
      <div className="le2-dows">
        {WEEKDAYS.map((d, i) => (
          <span key={`${d}-${i}`}>{d}</span>
        ))}
      </div>
      <div className="le2-days">
        {monthCells(view).map(({ date, inMonth }) => {
          const ymd = toYmd(date);
          const selected = ymd === fromDate || ymd === toDate;
          const inrange = Boolean(from && to && date >= from && date <= to && !selected);
          const cls = [
            'le2-day',
            inMonth ? '' : 'is-out',
            isWeekend(date) ? 'is-weekend' : '',
            selected ? 'is-selected' : '',
            inrange ? 'is-inrange' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={ymd + String(inMonth)}
              type="button"
              className={cls}
              disabled={!inMonth}
              onClick={() => onPick(ymd)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Le2DualMonthCalendar({
  fromDate,
  toDate,
  onChange,
}: {
  fromDate: string;
  toDate: string;
  onChange: (from: string, to: string) => void;
}) {
  const [view, setView] = useState(() => startOfMonth(parseYmd(fromDate) || new Date()));

  useEffect(() => {
    const d = parseYmd(fromDate);
    if (d) setView(startOfMonth(d));
  }, [fromDate]);

  function pick(ymd: string) {
    if (!fromDate || (fromDate && toDate)) {
      onChange(ymd, '');
      return;
    }
    if (ymd < fromDate) {
      onChange(ymd, fromDate);
      return;
    }
    onChange(fromDate, ymd);
  }

  return (
    <div className="le2-cal-block">
      <div className="le2-cal-top">
        <span className="le2-cal-title">Select leave dates</span>
        <div className="le2-legend">
          <span>
            <i className="is-sel" />
            Selected
          </span>
          <span>
            <i className="is-wk" />
            Weekend
          </span>
          <span>
            <i className="is-hol" />
            Holiday
          </span>
        </div>
      </div>
      <div className="le2-months">
        <Le2Month
          view={view}
          fromDate={fromDate}
          toDate={toDate}
          onPick={pick}
          onPrev={() => setView((v) => addMonths(v, -1))}
        />
        <Le2Month
          view={addMonths(view, 1)}
          fromDate={fromDate}
          toDate={toDate}
          onPick={pick}
          onNext={() => setView((v) => addMonths(v, 1))}
        />
      </div>
    </div>
  );
}

function Le2DateInput({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
}) {
  return (
    <div className={`le2-control${value ? ' has-clear' : ''}`}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <rect x="4" y="5" width="16" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M4 11h16" />
      </svg>
      <input
        className="le2-input"
        type="date"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button type="button" className="le2-clear" aria-label="Clear date" onClick={() => onChange('')}>
          ×
        </button>
      ) : null}
    </div>
  );
}

function Le2FileThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith('image/')) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (url) return <img src={url} alt="" />;
  return (
    <Le2Icon>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
    </Le2Icon>
  );
}

function Le2Dropzone({
  files,
  onChange,
  error,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  error?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const next = [...files];
    let err: string | null = null;
    for (const file of incoming) {
      const problem = acceptReceipt(file);
      if (problem) {
        err = problem;
        continue;
      }
      if (next.length >= MAX_RECEIPTS) {
        err = `You can attach up to ${MAX_RECEIPTS} files.`;
        break;
      }
      if (next.some((f) => f.name === file.name && f.size === file.size)) continue;
      next.push(file);
    }
    setLocalError(err);
    onChange(next);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={RECEIPT_ACCEPT}
        multiple
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div
        className={`le2-drop${over ? ' is-over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
        }}
      >
        <div>
          <Le2Icon>
            <path d="M12 16V7" />
            <path d="M8 10l4-4 4 4" />
            <path d="M5 19h14" />
          </Le2Icon>
          <strong>Click to upload or drag and drop</strong>
          <small>PDF, JPG, PNG (Max 5 MB each, up to {MAX_RECEIPTS} files)</small>
        </div>
      </div>
      {files.length ? (
        <div className="le2-files">
          {files.map((file) => (
            <div key={`${file.name}-${file.size}`} className="le2-file">
              <button
                type="button"
                className="le2-file-x"
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange(files.filter((f) => f !== file))}
              >
                ×
              </button>
              <div className="le2-thumb">
                <Le2FileThumb file={file} />
              </div>
              <div className="le2-file-name">{file.name}</div>
              <div className="le2-file-size">{formatFileSize(file.size)}</div>
            </div>
          ))}
          {files.length < MAX_RECEIPTS ? (
            <button type="button" className="le2-file is-add" onClick={() => inputRef.current?.click()}>
              + Add more files
              <small>(Max {MAX_RECEIPTS})</small>
            </button>
          ) : null}
        </div>
      ) : null}
      {localError || error ? <p className="le2-alert is-err" style={{ marginTop: 10 }}>{localError || error}</p> : null}
    </div>
  );
}

function Le2FormActions({
  submitting,
  submitLabel,
  onCancel,
}: {
  submitting: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="le2-actions">
      <button type="button" className="le2-btn is-ghost" onClick={onCancel} disabled={submitting}>
        <Le2Icon>
          <path d="M6 6l12 12M18 6L6 18" />
        </Le2Icon>
        Cancel
      </button>
      <button type="submit" className="le2-btn is-solid" disabled={submitting}>
        <Le2Icon>
          <path d="M4 12l16-7-7 16-2-7-7-2z" />
        </Le2Icon>
        {submitting ? 'Submitting…' : submitLabel}
      </button>
    </div>
  );
}

export function Le2Tabs({
  tab,
  onLeave,
  onExpense,
}: {
  tab: 'leave' | 'expense';
  onLeave: () => void;
  onExpense: () => void;
}) {
  return (
    <div className="le2-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'leave'} className={`le2-tab${tab === 'leave' ? ' is-active' : ''}`} onClick={onLeave}>
        Leave
      </button>
      <button type="button" role="tab" aria-selected={tab === 'expense'} className={`le2-tab${tab === 'expense' ? ' is-active' : ''}`} onClick={onExpense}>
        Expenses
      </button>
    </div>
  );
}

export function Le2LeaveForm({
  leaveTypes,
  leaveType,
  fromDate,
  toDate,
  reason,
  submitting,
  onLeaveType,
  onFromDate,
  onToDate,
  onReason,
  onSubmit,
  onCancel,
}: {
  leaveTypes: LeaveTypeOption[];
  leaveType: string;
  fromDate: string;
  toDate: string;
  reason: string;
  submitting: boolean;
  onLeaveType: (value: string) => void;
  onFromDate: (value: string) => void;
  onToDate: (value: string) => void;
  onReason: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}) {
  const total = inclusiveDays(fromDate, toDate);
  return (
    <form className="le2-card le2-card-pad" data-le2-screen="apply-for-leave" onSubmit={onSubmit}>
      <div className="le2-head">
        <div className="le2-head-main">
          <span className="le2-ico">
            <Le2Icon>
              <rect x="4" y="5" width="16" height="16" rx="2" />
              <path d="M8 3v4M16 3v4M4 11h16" />
            </Le2Icon>
          </span>
          <div>
            <h2>Apply for leave</h2>
            <p>Submit your leave request for approval</p>
          </div>
        </div>
      </div>
      <div className="le2-leave-grid">
        <div className="le2-fields">
          <Le2Field label="Leave type" required>
            <div className="le2-control">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M12 20c4-6 4-10 0-16-4 6-4 10 0 16z" />
                <path d="M8 12h8" />
              </svg>
              <select className="le2-select" value={leaveType} onChange={(e) => onLeaveType(e.target.value)} required>
                {!leaveTypes.length ? <option value="">No leave types</option> : null}
                {leaveTypes.map((lt) => (
                  <option key={lt.name} value={lt.name}>
                    {lt.leave_type_name || lt.name}
                  </option>
                ))}
              </select>
            </div>
          </Le2Field>
          <Le2Field label="From date" required>
            <Le2DateInput
              value={fromDate}
              required
              onChange={(next) => {
                onFromDate(next);
                if (toDate && next && toDate < next) onToDate('');
              }}
            />
          </Le2Field>
          <Le2Field label="To date" required>
            <Le2DateInput value={toDate} required onChange={onToDate} />
          </Le2Field>
          <Le2Field label="Total days">
            <div className="le2-readonly">{total ? daysLabel(total) : '—'}</div>
          </Le2Field>
        </div>
        <div>
          <Le2DualMonthCalendar
            fromDate={fromDate}
            toDate={toDate}
            onChange={(from, to) => {
              onFromDate(from);
              onToDate(to);
            }}
          />
          <div className="le2-reason-block">
            <Le2Field label="Reason" required>
              <textarea
                className="le2-textarea"
                rows={4}
                maxLength={500}
                required
                value={reason}
                onChange={(e) => onReason(e.target.value)}
                placeholder="Enter reason for leave (e.g. personal work, health issue, family function)"
              />
            </Le2Field>
            <div className="le2-count">{reason.length}/500</div>
          </div>
        </div>
      </div>
      <Le2FormActions submitting={submitting} submitLabel="Submit leave" onCancel={onCancel} />
    </form>
  );
}

export function Le2ExpenseForm({
  expenseTypes,
  expenseType,
  expenseDate,
  amount,
  paymentMode,
  purpose,
  location,
  description,
  files,
  submitting,
  onExpenseType,
  onExpenseDate,
  onAmount,
  onPaymentMode,
  onPurpose,
  onLocation,
  onDescription,
  onFiles,
  onSubmit,
  onCancel,
}: {
  expenseTypes: ExpenseTypeOption[];
  expenseType: string;
  expenseDate: string;
  amount: string;
  paymentMode: string;
  purpose: string;
  location: string;
  description: string;
  files: File[];
  submitting: boolean;
  onExpenseType: (value: string) => void;
  onExpenseDate: (value: string) => void;
  onAmount: (value: string) => void;
  onPaymentMode: (value: string) => void;
  onPurpose: (value: string) => void;
  onLocation: (value: string) => void;
  onDescription: (value: string) => void;
  onFiles: (files: File[]) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form className="le2-card le2-card-pad" data-le2-screen="submit-expense" onSubmit={onSubmit}>
      <div className="le2-head">
        <div className="le2-head-main">
          <span className="le2-ico">
            <Le2Icon>
              <path d="M8 4h8l1 4H7z" />
              <path d="M6 8h12v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z" />
            </Le2Icon>
          </span>
          <div>
            <h2>Submit expense</h2>
            <p>Submit your official expenses for reimbursement</p>
          </div>
        </div>
      </div>
      <div className="le2-exp-grid">
        <Le2Field label="Expense type" required>
          <div className="le2-control">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <rect x="3" y="6" width="18" height="12" rx="2" />
              <path d="M3 10h18" />
            </svg>
            <select className="le2-select" value={expenseType} onChange={(e) => onExpenseType(e.target.value)} required>
              {!expenseTypes.length ? <option value="">No expense types</option> : null}
              {expenseTypes.map((et) => (
                <option key={et.name} value={et.name}>
                  {et.expense_type || et.name}
                </option>
              ))}
            </select>
          </div>
        </Le2Field>
        <Le2Field label="Expense date" required>
          <Le2DateInput value={expenseDate} required onChange={onExpenseDate} />
        </Le2Field>
        <Le2Field label="Amount (₹)" required>
          <div className="le2-control">
            <span className="le2-affix">₹</span>
            <input
              className="le2-input"
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => onAmount(e.target.value)}
              required
              placeholder="0.00"
            />
          </div>
        </Le2Field>
        <Le2Field label="Payment mode" required>
          <div className="le2-control">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <rect x="3" y="6" width="18" height="12" rx="2" />
              <path d="M3 10h18" />
            </svg>
            <select className="le2-select" value={paymentMode} onChange={(e) => onPaymentMode(e.target.value)} required>
              {PAYMENT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>
        </Le2Field>
        <Le2Field label="Project / Purpose">
          <input
            className="le2-input"
            value={purpose}
            onChange={(e) => onPurpose(e.target.value)}
            placeholder="Select purpose"
          />
        </Le2Field>
        <Le2Field label="Location">
          <div className="le2-control">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
              <circle cx="12" cy="10" r="2.2" />
            </svg>
            <input
              className="le2-input"
              value={location}
              onChange={(e) => onLocation(e.target.value)}
              placeholder="Enter location (optional)"
            />
          </div>
        </Le2Field>
        <div className="le2-span-3">
          <Le2Field label="Description / Remark" required>
            <textarea
              className="le2-textarea"
              rows={3}
              maxLength={500}
              required
              value={description}
              onChange={(e) => onDescription(e.target.value)}
              placeholder="Enter expense details (e.g. client visit, sample collection, travel to branch)"
            />
          </Le2Field>
          <div className="le2-count">{description.length}/500</div>
        </div>
        <div className="le2-span-3">
          <span className="le2-label">Attach bills / receipts</span>
          <div style={{ marginTop: 6 }}>
            <Le2Dropzone files={files} onChange={onFiles} />
          </div>
        </div>
      </div>
      <Le2FormActions submitting={submitting} submitLabel="Submit expense" onCancel={onCancel} />
    </form>
  );
}

export function Le2LeaveBalanceCard({
  rows,
  viewAllHref,
}: {
  rows: LeaveBalanceRow[] | undefined;
  viewAllHref?: string;
}) {
  const list = rows || [];
  return (
    <section className="le2-card le2-card-pad">
      <div className="le2-head">
        <div className="le2-head-main">
          <span className="le2-ico">
            <Le2Icon>
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4l2.5 1.5" />
            </Le2Icon>
          </span>
          <div>
            <h2>Leave balance</h2>
          </div>
        </div>
        {viewAllHref ? (
          <Link className="le2-link" to={viewAllHref}>
            View all
          </Link>
        ) : null}
      </div>
      {list.length ? (
        <table className="le2-table">
          <thead>
            <tr>
              <th>Leave type</th>
              <th>Taken</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {list.map((row) => (
              <tr key={row.leave_type}>
                <td>{row.leave_type}</td>
                <td>{row.taken}</td>
                <td>{row.balance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="le2-empty">No leave balances yet.</p>
      )}
    </section>
  );
}

export function Le2RecentLeaves({
  rows,
  viewAllHref,
}: {
  rows: LeaveApplicationRow[];
  viewAllHref?: string;
}) {
  const list = rows.slice(0, 8);
  return (
    <section className="le2-card le2-card-pad">
      <div className="le2-head">
        <div className="le2-head-main">
          <span className="le2-ico">
            <Le2Icon>
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4l3 2" />
            </Le2Icon>
          </span>
          <div>
            <h2>Recent leave applications</h2>
          </div>
        </div>
        {viewAllHref ? (
          <Link className="le2-link" to={viewAllHref}>
            View all
          </Link>
        ) : null}
      </div>
      {list.length ? (
        <ul className="le2-list">
          {list.map((row) => {
            const kind = statusKind(row.status);
            const days = row.total_leave_days || inclusiveDays(row.from_date, row.to_date);
            return (
              <li key={row.name} className="le2-item">
                <span className={`le2-dot is-${kind === 'approved' ? 'green' : kind === 'rejected' ? 'red' : 'amber'}`}>
                  <Le2Icon>
                    <rect x="4" y="5" width="16" height="16" rx="2" />
                    <path d="M8 3v4M16 3v4M4 11h16" />
                  </Le2Icon>
                </span>
                <div>
                  <div className="le2-item-title">{row.leave_type}</div>
                  <div className="le2-item-meta">
                    {formatLongDate(row.from_date)} – {formatLongDate(row.to_date)}
                    {days ? ` · ${daysLabel(days)}` : ''}
                  </div>
                </div>
                <Le2StatusBadge status={row.status} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="le2-empty">No leave applications yet.</p>
      )}
    </section>
  );
}

export function Le2ExpenseSummary({ rows }: { rows: ExpenseClaimRow[] }) {
  const summary = useMemo(() => monthExpenseSummary(rows), [rows]);
  return (
    <section className="le2-card le2-card-pad">
      <div className="le2-head">
        <div className="le2-head-main">
          <span className="le2-ico">
            <Le2Icon>
              <rect x="4" y="5" width="16" height="14" rx="2" />
              <path d="M8 3v4M16 3v4" />
            </Le2Icon>
          </span>
          <div>
            <h2>Expense summary (This month)</h2>
          </div>
        </div>
      </div>
      <div className="le2-stats">
        <div className="le2-stat is-total">
          <small>Total submitted</small>
          <b>{formatMoney(summary.total)}</b>
        </div>
        <div className="le2-stat is-ok">
          <small>Approved</small>
          <b>{formatMoney(summary.approved)}</b>
        </div>
        <div className="le2-stat is-warn">
          <small>Pending</small>
          <b>{formatMoney(summary.pending)}</b>
        </div>
        <div className="le2-stat is-bad">
          <small>Rejected</small>
          <b>{formatMoney(summary.rejected)}</b>
        </div>
      </div>
    </section>
  );
}

export function Le2RecentExpenses({
  rows,
  viewAllHref,
}: {
  rows: ExpenseClaimRow[];
  viewAllHref?: string;
}) {
  const list = rows.slice(0, 8);
  return (
    <section className="le2-card le2-card-pad">
      <div className="le2-head">
        <div className="le2-head-main">
          <span className="le2-ico">
            <Le2Icon>
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4l3 2" />
            </Le2Icon>
          </span>
          <div>
            <h2>Recent expense requests</h2>
          </div>
        </div>
        {viewAllHref ? (
          <Link className="le2-link" to={viewAllHref}>
            View all
          </Link>
        ) : null}
      </div>
      {list.length ? (
        <ul className="le2-list">
          {list.map((row) => {
            const kind = statusKind(row.approval_status);
            return (
              <li key={row.name} className="le2-item">
                <span className={`le2-dot is-${kind === 'approved' ? 'green' : kind === 'rejected' ? 'red' : 'amber'}`}>
                  <Le2Icon>
                    <rect x="3" y="6" width="18" height="12" rx="2" />
                    <path d="M3 10h18" />
                  </Le2Icon>
                </span>
                <div>
                  <div className="le2-item-title">{claimType(row)}</div>
                  <div className="le2-item-meta">
                    {formatLongDate(claimDate(row))}
                    {row.total_claimed_amount != null ? ` · ${formatMoney(row.total_claimed_amount)}` : ''}
                  </div>
                </div>
                <Le2StatusBadge status={row.approval_status} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="le2-empty">No expense claims yet.</p>
      )}
    </section>
  );
}

export function Le2Alerts({ error, message }: { error?: string | null; message?: string | null }) {
  if (!error && !message) return null;
  return (
    <>
      {error ? <div className="le2-alert is-err">{error}</div> : null}
      {message ? <div className="le2-alert is-ok">{message}</div> : null}
    </>
  );
}

export function Le2Unavailable({
  title,
  detail,
  missing,
}: {
  title: string;
  detail?: string;
  missing?: string[];
}) {
  return (
    <div className="le2-root">
      <section className="le2-card le2-unavailable">
        <h2>{title}</h2>
        <p className="le2-empty">{detail || 'HR module is not available on this server yet.'}</p>
        {missing?.length ? <p className="le2-empty">Missing: {missing.join(', ')}</p> : null}
      </section>
    </div>
  );
}
