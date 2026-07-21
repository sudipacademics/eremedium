import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api, ExpenseClaimRow, HrSelfService, LeaveApplicationRow } from '../../api';

type Tab = 'leave' | 'expense';

export function HrSelfServicePage() {
  const [data, setData] = useState<HrSelfService | null>(null);
  const [tab, setTab] = useState<Tab>('leave');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [leaveType, setLeaveType] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [leaveReason, setLeaveReason] = useState('');

  const [expenseType, setExpenseType] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getHrSelfService();
      setData(res.data);
      const lt = res.data.leave_types?.[0];
      const et = res.data.expense_types?.[0];
      if (lt) setLeaveType(lt.name);
      if (et) setExpenseType(et.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load HR data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onLeaveSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.submitLeaveApplication({
        leave_type: leaveType,
        from_date: fromDate,
        to_date: toDate,
        description: leaveReason,
      });
      setMessage(res.message || 'Leave submitted');
      setLeaveReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit leave');
    } finally {
      setSubmitting(false);
    }
  }

  async function onExpenseSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.submitExpenseClaim({
        expense_type: expenseType,
        amount: Number(amount),
        description: expenseDesc,
        expense_date: expenseDate || undefined,
      });
      const claim = res.data.expense_claim;
      if (receiptFile && claim?.name) {
        const b64 = await fileToBase64(receiptFile);
        await api.attachExpenseReceipt(claim.name, receiptFile.name, b64);
      }
      setMessage(res.message || 'Expense claim submitted');
      setAmount('');
      setExpenseDesc('');
      setReceiptFile(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit expense');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="muted">Loading HR self-service…</p>;
  }

  if (!data?.hr_available) {
    return (
      <>
        <h1>HR self-service</h1>
        <div className="card card-wide">
          <p>HR module is not installed on this server yet.</p>
          <p className="muted">
            Admin: install HRMS with{' '}
            <code>bench get-app hrms &amp;&amp; bench --site health.localhost install-app hrms</code>, then run{' '}
            <code>patch-phase21-hr.sh</code>.
          </p>
          {data?.missing_modules?.length ? (
            <p className="muted">Missing: {data.missing_modules.join(', ')}</p>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>HR self-service</h1>
        <p>Apply for leave and submit expense claims. Approvals are handled in ERPNext Desk.</p>
        {data.employee ? <p className="muted">Employee ID: {data.employee}</p> : null}
      </section>

      <div className="view-toggle hr-tabs" role="tablist">
        <button
          type="button"
          className={`view-toggle-btn ${tab === 'leave' ? 'active' : ''}`}
          onClick={() => setTab('leave')}
        >
          Leave
        </button>
        <button
          type="button"
          className={`view-toggle-btn ${tab === 'expense' ? 'active' : ''}`}
          onClick={() => setTab('expense')}
        >
          Expenses
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {message && <div className="card" style={{ borderLeft: '3px solid var(--primary)', marginBottom: 16 }}>{message}</div>}

      {tab === 'leave' && (
        <div className="hr-grid">
          <form className="card hr-form" onSubmit={(e) => void onLeaveSubmit(e)}>
            <h2>Apply for leave</h2>
            <label>
              Leave type
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} required>
                {data.leave_types.map((lt) => (
                  <option key={lt.name} value={lt.name}>
                    {lt.leave_type_name || lt.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} required />
            </label>
            <label>
              To
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} required />
            </label>
            <label>
              Reason
              <textarea value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} rows={3} />
            </label>
            <button className="btn" type="submit" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit leave'}
            </button>
          </form>
          <LeaveList rows={data.leave_applications} />
        </div>
      )}

      {tab === 'expense' && (
        <div className="hr-grid">
          <form className="card hr-form" onSubmit={(e) => void onExpenseSubmit(e)}>
            <h2>Expense claim</h2>
            <label>
              Type
              <select value={expenseType} onChange={(e) => setExpenseType(e.target.value)} required>
                {data.expense_types.map((et) => (
                  <option key={et.name} value={et.name}>
                    {et.expense_type || et.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount (₹)
              <input
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <label>
              Date
              <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </label>
            <label>
              Description
              <textarea value={expenseDesc} onChange={(e) => setExpenseDesc(e.target.value)} rows={2} />
            </label>
            <label>
              Receipt (optional)
              <input type="file" accept="image/*,.pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} />
            </label>
            <button className="btn" type="submit" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit claim'}
            </button>
          </form>
          <ExpenseList rows={data.expense_claims} />
        </div>
      )}
    </>
  );
}

function LeaveList({ rows }: { rows: LeaveApplicationRow[] }) {
  return (
    <section className="card">
      <h2>My leave applications</h2>
      {!rows.length && <p className="muted">No leave applications yet.</p>}
      <ul className="hr-list">
        {rows.map((row) => (
          <li key={row.name}>
            <strong>{row.leave_type}</strong>
            <span className="badge">{row.status}</span>
            <p className="muted">
              {row.from_date} → {row.to_date}
              {row.total_leave_days ? ` · ${row.total_leave_days} day(s)` : ''}
            </p>
            {row.description && <p>{row.description}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExpenseList({ rows }: { rows: ExpenseClaimRow[] }) {
  return (
    <section className="card">
      <h2>My expense claims</h2>
      {!rows.length && <p className="muted">No expense claims yet.</p>}
      <ul className="hr-list">
        {rows.map((row) => (
          <li key={row.name}>
            <strong>₹{row.total_claimed_amount?.toFixed(2)}</strong>
            <span className="badge">{row.approval_status}</span>
            <p className="muted">{row.name} · {row.posting_date || row.creation?.slice(0, 10)}</p>
            {row.remark && <p>{row.remark}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const b64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(b64);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
