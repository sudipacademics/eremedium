import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { api, SalesClosingDraft, SalesClosingReport, TerritorialSalesSummary } from '../../api';

const EXPENSE_TYPES = [
  'Fuel',
  'Food',
  'Lodging',
  'Toll',
  'Parking',
  'Local Conveyance',
  'Misc',
] as const;

type ExpenseDraft = {
  id: string;
  expense_type: string;
  amount: string;
  remarks: string;
  filename: string;
  file_content: string;
};

type PendingFile = {
  id: string;
  filename: string;
  file_content: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthBounds(isoDate: string): { start: string; end: string } {
  const d = new Date(`${isoDate}T12:00:00`);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function newExpenseRow(): ExpenseDraft {
  return {
    id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    expense_type: 'Fuel',
    amount: '',
    remarks: '',
    filename: '',
    file_content: '',
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function readAllowedFile(file: File): Promise<{ filename: string; file_content: string }> {
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
  const okExt = /\.(pdf|jpe?g|png)$/i.test(file.name);
  if (!allowed.includes(file.type) && !okExt) {
    throw new Error('Only PDF, JPG, and PNG receipts are allowed');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error(`${file.name} exceeds 5MB limit`);
  }
  return { filename: file.name, file_content: await fileToBase64(file) };
}

function formatInr(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function SalesReportsPage() {
  const [reports, setReports] = useState<SalesClosingReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [territorial, setTerritorial] = useState<TerritorialSalesSummary | null>(null);
  const [territorialPeriod, setTerritorialPeriod] = useState<'month' | 'all'>('month');

  const [reportType, setReportType] = useState<'Daily' | 'Monthly'>('Monthly');
  const [periodStart, setPeriodStart] = useState(() => monthBounds(todayIso()).start);
  const [periodEnd, setPeriodEnd] = useState(() => monthBounds(todayIso()).end);
  const [draft, setDraft] = useState<SalesClosingDraft | null>(null);
  const [kmTraveled, setKmTraveled] = useState('');
  const [notes, setNotes] = useState('');
  const [expenses, setExpenses] = useState<ExpenseDraft[]>([newExpenseRow()]);
  const [extraFiles, setExtraFiles] = useState<PendingFile[]>([]);

  const otherExpensesTotal = useMemo(
    () => expenses.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [expenses],
  );
  const totalExpenses = otherExpensesTotal;
  const locked = Boolean(draft?.already_submitted);

  async function loadReports() {
    try {
      const res = await api.getSalesClosingReports();
      setReports(res.data.reports || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports');
    }
  }

  async function loadTerritorial() {
    try {
      const res = await api.getTerritorialSalesSummary(territorialPeriod);
      setTerritorial(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load territorial summary');
    }
  }

  useEffect(() => {
    void loadReports();
  }, []);

  useEffect(() => {
    void loadTerritorial();
  }, [territorialPeriod]);

  async function loadDraft() {
    setError(null);
    try {
      const res = await api.draftSalesClosingReport(reportType, periodStart);
      setDraft(res.data);
      if (res.data.period_end) setPeriodEnd(String(res.data.period_end));
      if (res.data.period_date) setPeriodStart(String(res.data.period_date));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Draft failed');
    }
  }

  useEffect(() => {
    void loadDraft();
  }, [reportType, periodStart]);

  function onReportTypeChange(next: 'Daily' | 'Monthly') {
    setReportType(next);
    if (next === 'Daily') {
      const day = todayIso();
      setPeriodStart(day);
      setPeriodEnd(day);
    } else {
      const bounds = monthBounds(todayIso());
      setPeriodStart(bounds.start);
      setPeriodEnd(bounds.end);
    }
  }

  function onPeriodStartChange(value: string) {
    if (reportType === 'Monthly') {
      const bounds = monthBounds(value);
      setPeriodStart(bounds.start);
      setPeriodEnd(bounds.end);
    } else {
      setPeriodStart(value);
      setPeriodEnd(value);
    }
  }

  async function onExpenseFile(id: string, file: File | null) {
    if (!file) return;
    try {
      const parsed = await readAllowedFile(file);
      setExpenses((rows) =>
        rows.map((row) =>
          row.id === id
            ? { ...row, filename: parsed.filename, file_content: parsed.file_content }
            : row,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'File upload failed');
    }
  }

  async function onBatchFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setError(null);
    try {
      const next: PendingFile[] = [];
      for (const file of Array.from(fileList)) {
        const parsed = await readAllowedFile(file);
        next.push({
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          filename: parsed.filename,
          file_content: parsed.file_content,
        });
      }
      setExtraFiles((prev) => [...prev, ...next]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Batch upload failed');
    }
  }

  async function onFooterFiles(fileList: FileList | null) {
    await onBatchFiles(fileList);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft || locked) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const expensePayload = expenses
        .filter((row) => Number(row.amount) > 0 || row.filename || row.remarks.trim())
        .map((row) => ({
          expense_type: row.expense_type,
          amount: Number(row.amount) || 0,
          remarks: row.remarks.trim(),
          filename: row.filename,
        }));

      const attachments = [
        ...expenses
          .filter((row) => row.file_content)
          .map((row) => ({ filename: row.filename || 'receipt.pdf', file_content: row.file_content })),
        ...extraFiles.map((f) => ({ filename: f.filename, file_content: f.file_content })),
      ];

      await api.submitSalesClosingReport({
        report_type: reportType,
        period_date: periodStart,
        visits_count: draft.visits_count,
        new_leads: draft.new_leads,
        qualified_leads: draft.qualified_leads,
        onboardings: draft.onboardings,
        franchise_revenue: draft.franchise_revenue,
        km_traveled: kmTraveled || 0,
        notes: notes.slice(0, 500),
        other_expenses: otherExpensesTotal,
        total_expenses: totalExpenses,
        expenses_json: JSON.stringify(expensePayload),
        attachments_json: JSON.stringify(attachments),
      });
      setMessage('Closing report submitted');
      setKmTraveled('');
      setNotes('');
      setExpenses([newExpenseRow()]);
      setExtraFiles([]);
      await loadReports();
      await loadDraft();
      await loadTerritorial();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  const maxLeads = useMemo(
    () => Math.max(1, ...(territorial?.by_district || []).map((r) => r.leads)),
    [territorial],
  );

  return (
    <>
      <header className="reach-page-head reach-closing-head">
        <div className="reach-closing-title">
          <span className="reach-closing-title-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
              <path d="M8 3.5v3M16 3.5v3M3.5 10h17" />
            </svg>
          </span>
          <div>
            <h1>Daily &amp; Monthly Closing</h1>
            <p>End-of-day or end-of-month field activity summary for your manager.</p>
          </div>
        </div>
        <div className="reach-page-actions reach-closing-controls">
          <label className="reach-filter">
            Report Type
            <select
              value={reportType}
              onChange={(e) => onReportTypeChange(e.target.value as 'Daily' | 'Monthly')}
            >
              <option value="Daily">Daily</option>
              <option value="Monthly">Monthly</option>
            </select>
          </label>
          <label className="reach-filter">
            Period
            <span className="reach-period-range">
              <input
                type="date"
                value={periodStart}
                onChange={(e) => onPeriodStartChange(e.target.value)}
              />
              <span aria-hidden>→</span>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => {
                  if (reportType === 'Daily') {
                    onPeriodStartChange(e.target.value);
                  } else {
                    setPeriodEnd(e.target.value);
                  }
                }}
                disabled={reportType === 'Monthly'}
              />
            </span>
          </label>
        </div>
      </header>

      {message ? <div className="reach-alert ok">{message}</div> : null}
      {error ? <div className="reach-alert err">{error}</div> : null}
      {locked ? (
        <div className="reach-alert warn">
          This {reportType.toLowerCase()} closing for {periodStart}
          {periodEnd && periodEnd !== periodStart ? ` → ${periodEnd}` : ''} is already submitted and cannot be
          edited.
        </div>
      ) : null}

      <form className="reach-closing-form" onSubmit={onSubmit}>
        <section className="reach-metric-row" aria-label="Activity metrics">
          <article className="reach-metric-card">
            <span className="reach-metric-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 21s-6-4.4-6-9a6 6 0 1 1 12 0c0 4.6-6 9-6 9z" />
                <circle cx="12" cy="12" r="2.2" />
              </svg>
            </span>
            <strong>{draft ? draft.visits_count : '—'}</strong>
            <span>Total visits</span>
          </article>
          <article className="reach-metric-card">
            <span className="reach-metric-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="9" cy="8" r="3" />
                <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5S14 16 14.5 19" />
                <path d="M17 8v6M14 11h6" />
              </svg>
            </span>
            <strong>{draft ? draft.new_leads : '—'}</strong>
            <span>Total new leads</span>
          </article>
          <article className="reach-metric-card">
            <span className="reach-metric-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.8 7.2 18l.9-5.4L4.2 8.7l5.4-.8L12 3z" />
              </svg>
            </span>
            <strong>{draft ? draft.qualified_leads : '—'}</strong>
            <span>Total qualified leads</span>
          </article>
          <article className="reach-metric-card">
            <span className="reach-metric-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M7 11V8a5 5 0 0 1 10 0v3" />
                <path d="M5 11h14v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8z" />
              </svg>
            </span>
            <strong>{draft ? draft.onboardings : '—'}</strong>
            <span>Total onboardings</span>
          </article>
          <article className="reach-metric-card">
            <span className="reach-metric-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="8" />
                <path d="M12 7v10M9.5 9.5c.6-1 1.5-1.5 2.5-1.5s2 .7 2 2-1 1.8-2.5 2.2-2.5.9-2.5 2.3 1.2 2 2.5 2 1.9-.5 2.5-1.5" />
              </svg>
            </span>
            <strong>{draft ? formatInr(Number(draft.franchise_revenue || 0)) : '—'}</strong>
            <span>Total revenue</span>
          </article>
          <article className="reach-metric-card">
            <span className="reach-metric-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 7h16v10H4z" />
                <path d="M8 7V5h8v2M8 17v2h8v-2" />
              </svg>
            </span>
            <strong>{draft ? draft.b2b_samples ?? 0 : '—'}</strong>
            <span>B2B samples</span>
          </article>
          <article className="reach-metric-card">
            <span className="reach-metric-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 17l6-6 4 4 8-8" />
                <path d="M14 7h7v7" />
              </svg>
            </span>
            <strong>{draft ? formatInr(Number(draft.b2b_business_value || 0)) : '—'}</strong>
            <span>B2B sales value · {draft?.b2b_entries ?? 0} entries{draft?.b2b_new_centres ? ` · ${draft.b2b_new_centres} new centres` : ''}</span>
          </article>
        </section>

        <section className="reach-expense-summary" aria-label="Expense summary">
          <article className="reach-expense-card">
            <span className="reach-metric-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 16l3-3 3 2 4-5 6 6" />
                <path d="M4 19h16" />
              </svg>
            </span>
            <div>
              <span className="label">KM Travelled (Total)</span>
              <strong>{kmTraveled ? `${kmTraveled} KM` : '0 KM'}</strong>
            </div>
          </article>
          <article className="reach-expense-card">
            <span className="reach-metric-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 8h16v11H4z" />
                <path d="M8 8V6.5A2.5 2.5 0 0 1 10.5 4h3A2.5 2.5 0 0 1 16 6.5V8" />
              </svg>
            </span>
            <div>
              <span className="label">Other Expenses (Total)</span>
              <strong>{formatInr(otherExpensesTotal)}</strong>
            </div>
          </article>
          <article className="reach-expense-card highlight">
            <span className="reach-metric-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 8h16v11H4z" />
                <path d="M8 8V6.5A2.5 2.5 0 0 1 10.5 4h3A2.5 2.5 0 0 1 16 6.5V8" />
              </svg>
            </span>
            <div>
              <span className="label">Total Expenses</span>
              <strong>{formatInr(totalExpenses)}</strong>
            </div>
          </article>
        </section>

        <section className="reach-card reach-expenses-panel">
          <div className="reach-expenses-head">
            <div>
              <h2>Other Expenses</h2>
              <p>Capture fuel, food, and other field costs with optional bills.</p>
            </div>
            <button
              type="button"
              className="reach-btn secondary"
              disabled={locked}
              onClick={() => setExpenses((rows) => [...rows, newExpenseRow()])}
            >
              + Add Expense
            </button>
          </div>

          <div className="reach-table-wrap">
            <table className="reach-table reach-expense-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Expense Type</th>
                  <th>Amount (₹)</th>
                  <th>Remarks (Optional)</th>
                  <th>Bill / Receipt</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((row, idx) => (
                  <tr key={row.id}>
                    <td>{idx + 1}</td>
                    <td>
                      <select
                        value={row.expense_type}
                        disabled={locked}
                        onChange={(e) =>
                          setExpenses((rows) =>
                            rows.map((r) =>
                              r.id === row.id ? { ...r, expense_type: e.target.value } : r,
                            ),
                          )
                        }
                      >
                        {EXPENSE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={row.amount}
                        disabled={locked}
                        placeholder="0"
                        onChange={(e) =>
                          setExpenses((rows) =>
                            rows.map((r) => (r.id === row.id ? { ...r, amount: e.target.value } : r)),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={row.remarks}
                        disabled={locked}
                        maxLength={200}
                        placeholder="Local travel for visits"
                        onChange={(e) =>
                          setExpenses((rows) =>
                            rows.map((r) => (r.id === row.id ? { ...r, remarks: e.target.value } : r)),
                          )
                        }
                      />
                    </td>
                    <td>
                      {row.filename ? (
                        <span className="reach-file-chip">
                          {row.filename}
                          {!locked ? (
                            <button
                              type="button"
                              aria-label="Remove receipt"
                              onClick={() =>
                                setExpenses((rows) =>
                                  rows.map((r) =>
                                    r.id === row.id ? { ...r, filename: '', file_content: '' } : r,
                                  ),
                                )
                              }
                            >
                              ×
                            </button>
                          ) : null}
                        </span>
                      ) : (
                        <label className="reach-file-btn">
                          Upload
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                            disabled={locked}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => {
                              void onExpenseFile(row.id, e.target.files?.[0] || null);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="reach-icon-danger"
                        disabled={locked || expenses.length <= 1}
                        aria-label="Remove expense row"
                        onClick={() => setExpenses((rows) => rows.filter((r) => r.id !== row.id))}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className={`reach-dropzone${locked ? ' disabled' : ''}`}>
            <strong>Upload Multiple Bills / Receipts</strong>
            <span>PDF, JPG, PNG · Max 5MB each</span>
            {extraFiles.length ? (
              <ul className="reach-file-list">
                {extraFiles.map((f) => (
                  <li key={f.id}>
                    {f.filename}
                    {!locked ? (
                      <button type="button" onClick={() => setExtraFiles((rows) => rows.filter((x) => x.id !== f.id))}>
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <input
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
              disabled={locked}
              onChange={(e) => {
                void onBatchFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </section>

        <section className="reach-closing-details">
          <label className="reach-field">
            KM Travelled (Optional)
            <div className="reach-input-icon">
              <span aria-hidden>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="8" />
                  <path d="M12 12l4-2" />
                </svg>
              </span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={kmTraveled}
                disabled={locked}
                placeholder="0"
                onChange={(e) => setKmTraveled(e.target.value)}
              />
            </div>
          </label>

          <label className="reach-field">
            Closing Notes (Optional)
            <textarea
              value={notes}
              disabled={locked}
              maxLength={500}
              rows={4}
              placeholder="Share context for your manager…"
              onChange={(e) => setNotes(e.target.value)}
            />
            <span className="reach-char-count">{notes.length}/500</span>
          </label>

          <label className={`reach-dropzone compact${locked ? ' disabled' : ''}`}>
            <strong>Bills / Receipts</strong>
            <span>Drag &amp; drop or browse · PDF, JPG, PNG</span>
            <input
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
              disabled={locked}
              onChange={(e) => {
                void onFooterFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </section>

        <footer className="reach-closing-submit">
          <p>
            <span aria-hidden>⚠</span>
            Please review all details before submitting. Once submitted, you will not be able to edit this closing
            report.
          </p>
          <button type="submit" className="reach-btn reach-submit-btn" disabled={submitting || !draft || locked}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 12l15-7-4 14-4-5-7-2z" />
            </svg>
            {submitting ? 'Submitting…' : 'Submit Closing Report'}
          </button>
        </footer>
      </form>

      <section className="reach-card" style={{ marginTop: 28 }}>
        <div className="reach-card-head">
          <span className="reach-card-icon" aria-hidden>
            ◎
          </span>
          <div>
            <h2>Territorial sales by district</h2>
            <p>Roll-up of your field coverage for manager review.</p>
          </div>
          <label className="reach-filter" style={{ marginLeft: 'auto' }}>
            Period
            <select
              value={territorialPeriod}
              onChange={(e) => setTerritorialPeriod(e.target.value as 'month' | 'all')}
            >
              <option value="month">This month</option>
              <option value="all">All time</option>
            </select>
          </label>
        </div>
        {territorial?.available ? (
          <>
            <div className="reach-metric-row compact" style={{ marginBottom: 16 }}>
              <article className="reach-metric-card">
                <strong>{territorial.totals.leads}</strong>
                <span>Leads</span>
              </article>
              <article className="reach-metric-card">
                <strong>{territorial.totals.leads_won}</strong>
                <span>Won</span>
              </article>
              <article className="reach-metric-card">
                <strong>{territorial.totals.visits}</strong>
                <span>Visits</span>
              </article>
              <article className="reach-metric-card">
                <strong>{territorial.totals.franchisees}</strong>
                <span>Franchisees</span>
              </article>
            </div>
            <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              {(territorial.by_district || []).slice(0, 12).map((row) => (
                <div
                  key={row.district}
                  style={{ display: 'grid', gridTemplateColumns: '140px 1fr 48px', gap: 8, alignItems: 'center' }}
                >
                  <span style={{ fontSize: 13 }}>{row.district}</span>
                  <div style={{ height: 10, borderRadius: 6, background: '#e8eef3', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.round((row.leads / maxLeads) * 100)}%`,
                        height: '100%',
                        background: '#0aa6a6',
                      }}
                    />
                  </div>
                  <strong style={{ fontSize: 13, textAlign: 'right' }}>{row.leads}</strong>
                </div>
              ))}
              {!territorial.by_district?.length ? <p className="muted">No geo-tagged activity in this period.</p> : null}
            </div>
          </>
        ) : (
          <p className="muted">{territorial?.reason || 'Loading territorial summary…'}</p>
        )}
      </section>

      <section className="reach-panel" style={{ marginTop: 16 }}>
        <div className="reach-panel-head">
          <h2>Submitted reports</h2>
          <span>{reports.length} total</span>
        </div>
        <div className="reach-table-wrap">
          <table className="reach-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Period</th>
                <th>Visits</th>
                <th>Leads</th>
                <th>Onboardings</th>
                <th>Expenses</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.name}>
                  <td>{r.report_type}</td>
                  <td>
                    {r.period_date}
                    {r.period_end && r.period_end !== r.period_date ? ` → ${r.period_end}` : ''}
                  </td>
                  <td>{r.visits_count}</td>
                  <td>{r.new_leads}</td>
                  <td>{r.onboardings}</td>
                  <td>{formatInr(Number(r.total_expenses || r.other_expenses || 0))}</td>
                  <td>{formatInr(Number(r.franchise_revenue || 0))}</td>
                </tr>
              ))}
              {!reports.length ? (
                <tr>
                  <td colSpan={7} className="reach-empty">
                    No reports yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
