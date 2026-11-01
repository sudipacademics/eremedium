import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type B2bStatementLine, type B2bWalletPayload } from '../../api';
import './partner-wallet-v2.css';

const QUICK_AMOUNTS = [500, 1000, 2000, 5000, 10000];
const PAGE_SIZE = 10;

async function payB2bWalletRecharge(input: { amount: number }) {
  const { payB2bWalletRecharge: pay } = await import('../../payments/razorpayCheckout');
  return pay(input);
}

function money(n?: number) {
  return `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
}

function formatWhen(raw?: string) {
  if (!raw) return '—';
  const d = new Date(String(raw).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function dayKey(raw?: string) {
  return (raw || '').slice(0, 10);
}

function classifyType(type?: string) {
  const t = (type || '').toLowerCase();
  if (t.includes('fee') || t.includes('debit')) return { key: 'deduction', label: 'Deduction' };
  if (t.includes('recharge') || t.includes('top')) return { key: 'topup', label: 'Top Up' };
  if (t.includes('refund')) return { key: 'refund', label: 'Refund' };
  if (t.includes('adjust')) return { key: 'adjustment', label: 'Adjustment' };
  if (t === 'mf share') return { key: 'mf_share', label: 'Master FOCO Share' };
  if (t === 'lab share') return { key: 'lab_share', label: 'Lab Share' };
  if (t.includes('commission')) return { key: 'commission', label: 'Commission' };
  return { key: 'other', label: type || '—' };
}

/** Platform Fee and Refund rows are debits (same as the wallet books); Adjustment rows carry their own sign. */
function signedAmount(type: string | undefined, amount: number) {
  if (type === 'Platform Fee' || type === 'Refund') return -Math.abs(amount);
  return amount;
}

export function B2bWalletPage() {
  const [wallet, setWallet] = useState<B2bWalletPayload | null>(null);
  const [statements, setStatements] = useState<B2bStatementLine[]>([]);
  const [amount, setAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentMode, setPaymentMode] = useState('Bank Transfer');
  const [busy, setBusy] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [testFilter, setTestFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);

  async function loadWallet() {
    const [w, s] = await Promise.all([api.getB2bWallet(80), api.getB2bStatements().catch(() => null)]);
    setWallet(w.data);
    setStatements(s?.data.lines || []);
  }

  useEffect(() => {
    void loadWallet().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load wallet'));
  }, []);

  const minRecharge = wallet?.min_recharge ?? 500;
  const balance = wallet?.wallet_balance ?? 0;
  const byTrf = useMemo(() => {
    const map = new Map<string, B2bStatementLine>();
    for (const line of statements) {
      if (line.trf_id) map.set(line.trf_id, line);
    }
    return map;
  }, [statements]);

  const rows = useMemo(() => {
    return (wallet?.transactions || []).map((txn) => {
      const ref = String(txn.reference || txn.payment_reference || '').trim();
      const stmt = byTrf.get(ref);
      const kind = classifyType(txn.type);
      const signed = signedAmount(txn.type, txn.amount);
      return {
        ...txn,
        ref,
        patient: stmt?.patient_name || '',
        test: stmt?.test || txn.remarks || '',
        kind,
        signed,
        description:
          txn.type === 'Platform Fee'
            ? txn.type
            : txn.type === 'MF Share' || txn.type === 'Lab Share'
              ? txn.remarks || `${txn.type} credited`
              : txn.remarks || txn.type,
      };
    });
  }, [wallet, byTrf]);

  const types = useMemo(() => Array.from(new Set(rows.map((r) => r.kind.label))).sort(), [rows]);
  const tests = useMemo(() => Array.from(new Set(rows.map((r) => r.test).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const day = dayKey(row.created);
      if (fromDate && day && day < fromDate) return false;
      if (toDate && day && day > toDate) return false;
      if (typeFilter && row.kind.label !== typeFilter) return false;
      if (testFilter && row.test !== testFilter) return false;
      if (!q) return true;
      return [row.ref, row.patient, row.test, row.description, row.type, row.remarks, row.payment_reference]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, typeFilter, testFilter, fromDate, toDate]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, typeFilter, testFilter, fromDate, toDate]);

  async function onPayOnline(e: FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!(amt >= minRecharge)) {
      setError(`Minimum recharge is ${money(minRecharge)}.`);
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await payB2bWalletRecharge({ amount: amt });
      setSuccess(`Wallet credited ₹${result.amount.toFixed(0)}. New balance ₹${result.wallet_balance.toFixed(0)}`);
      await loadWallet();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Razorpay recharge failed');
    } finally {
      setBusy(false);
    }
  }

  async function onOfflineRecharge(e: FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!(amt >= minRecharge)) {
      setError(`Minimum recharge is ${money(minRecharge)}.`);
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.rechargeB2bWallet({
        amount,
        payment_reference: paymentReference.trim(),
        payment_mode: paymentMode,
      });
      setSuccess(
        `Top-up request ${res.data.request_id} for ₹${res.data.amount.toFixed(0)} submitted. Your wallet is credited once finance confirms the transfer.`,
      );
      setPaymentReference('');
      await loadWallet();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recharge failed');
    } finally {
      setBusy(false);
    }
  }

  function clearFilters() {
    setQuery('');
    setTypeFilter('');
    setTestFilter('');
    setFromDate('');
    setToDate('');
  }

  function downloadReport() {
    const header = ['Date', 'Reference', 'Patient', 'Description', 'Type', 'Amount', 'Balance after'];
    const lines = filtered.map((row) =>
      [
        formatWhen(row.created),
        row.ref || '',
        row.patient || '',
        row.description || '',
        row.kind.label,
        String(row.signed),
        String(row.balance_after),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wallet-transactions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyRef(value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setSuccess(`Copied ${value}`);
    } catch {
      setError('Could not copy reference.');
    }
  }

  return (
    <div className="pw2">
      <div className="pw2-head">
        <h1>Platform Wallet</h1>
        <p>
          {wallet?.franchisee_type === 'Vector'
            ? 'Vector: platform fee is wholesale. Billing stops when wallet plus credit limit cannot cover the fee.'
            : 'Pulse: each walk-in debits FOCO minus commission from this prepaid wallet.'}
        </p>
      </div>

      <div className="pw2-stats">
        <article className="pw2-stat">
          <span>Wallet balance</span>
          <strong>{money(balance)}</strong>
        </article>
        <article className="pw2-stat">
          <span>Available to bill</span>
          <strong>{money(wallet?.available_to_bill ?? balance)}</strong>
        </article>
        <article className="pw2-stat">
          <span>Minimum recharge</span>
          <strong>{money(minRecharge)}</strong>
        </article>
        <article className="pw2-stat">
          <span>Pending FOFO Earnings</span>
          <strong>{money(wallet?.pending_fofo_earnings || 0)}</strong>
        </article>
        {wallet?.franchisee_type === 'Vector' ? (
          <article className="pw2-stat">
            <span>Credit limit</span>
            <strong>{money(wallet.credit_limit || 0)}</strong>
          </article>
        ) : null}
        {wallet?.profit_from_centre ? (
          <article className="pw2-stat">
            <span>Profit From Centre</span>
            <strong>{money(wallet.profit_from_centre)}</strong>
          </article>
        ) : null}
      </div>

      {error ? <div className="pw2-alert is-err">{error}</div> : null}
      {success ? <div className="pw2-alert is-ok">{success}</div> : null}

      <div className="pw2-grid">
        <form className="pw2-card" onSubmit={(e) => void onPayOnline(e)}>
          <h2>Pay with Razorpay</h2>
          <p className="pw2-lead">Card / UPI / netbanking. Credits your wallet immediately after payment.</p>
          <label className="pw2-field">
            <span>Amount (₹)</span>
            <input
              type="number"
              min={minRecharge}
              step="100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              placeholder={`Enter amount (Min. ${money(minRecharge)})`}
            />
          </label>
          <div className="pw2-chips">
            {QUICK_AMOUNTS.map((n) => (
              <button
                key={n}
                type="button"
                className={Number(amount) === n ? 'is-on' : ''}
                disabled={n < minRecharge}
                onClick={() => setAmount(String(n))}
              >
                {money(n)}
              </button>
            ))}
          </div>
          <button className="pw2-submit" type="submit" disabled={busy}>
            {busy ? 'Processing…' : 'Pay & Recharge'}
          </button>
        </form>

        <section className="pw2-card">
          <h2>Other options</h2>
          <p className="pw2-lead">Statements, help, and offline top-up.</p>
          <div className="pw2-links">
            <Link to="/b2b/statements">
              Wallet usage statement
              <span aria-hidden>→</span>
            </Link>
            <button type="button" onClick={() => setShowHelp((v) => !v)}>
              Wallet policy & help
              <span aria-hidden>→</span>
            </button>
            <button type="button" onClick={() => setShowOffline((v) => !v)}>
              {showOffline ? 'Hide offline transfer' : 'Record offline bank / UPI transfer'}
              <span aria-hidden>→</span>
            </button>
          </div>
          {showHelp ? (
            <p className="pw2-help">
              {wallet?.franchisee_type === 'Vector'
                ? 'Platform fee is wholesale. Billing stops when wallet plus credit limit cannot cover the fee. Razorpay credits immediately; offline transfers wait for finance confirmation.'
                : 'Each walk-in debits FOCO minus commission from this prepaid wallet. Razorpay credits immediately; offline transfers wait for finance confirmation.'}
            </p>
          ) : null}
        </section>
      </div>

      {showOffline ? (
        <form className="pw2-card" style={{ marginBottom: 16 }} onSubmit={(e) => void onOfflineRecharge(e)}>
          <h2>Offline recharge</h2>
          <p className="pw2-lead">
            Use this only after you have already paid via bank/UPI to the platform. Finance verifies the transfer against
            the bank statement before your wallet is credited.
          </p>
          <div className="pw2-grid" style={{ marginBottom: 0 }}>
            <label className="pw2-field">
              <span>Amount (₹)</span>
              <input
                type="number"
                min={minRecharge}
                step="100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <label className="pw2-field">
              <span>Paid via</span>
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                <option value="Bank Transfer">Bank transfer (NEFT / RTGS / IMPS)</option>
                <option value="UPI">UPI</option>
                <option value="Cheque">Cheque</option>
              </select>
            </label>
            <label className="pw2-field" style={{ gridColumn: '1 / -1' }}>
              <span>Payment reference</span>
              <input
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="UPI ref / bank txn id"
                required
              />
            </label>
          </div>
          <button className="pw2-btn" type="submit" disabled={busy}>
            {busy ? 'Processing…' : 'Submit for verification'}
          </button>
        </form>
      ) : null}

      {wallet?.topup_requests?.length ? (
        <section className="pw2-card" style={{ marginBottom: 16 }}>
          <h2>Offline top-up requests</h2>
          <div className="pw2-table-wrap">
            <table className="pw2-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Request</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {wallet.topup_requests.map((req) => (
                  <tr key={req.name}>
                    <td>{req.creation ? formatWhen(req.creation) : '—'}</td>
                    <td>{req.name}</td>
                    <td>{money(req.amount)}</td>
                    <td>{req.payment_reference}</td>
                    <td>
                      <span
                        className={`pw2-pill${req.status === 'Rejected' ? ' is-bad' : req.status === 'Pending' ? ' is-pend' : ''}`}
                      >
                        {req.status}
                        {req.status === 'Rejected' && req.review_remarks ? ` — ${req.review_remarks}` : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="pw2-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2>Wallet Transactions</h2>
            <p className="pw2-lead">Track wallet activity including top-ups, billing deductions, refunds and adjustments.</p>
          </div>
          <button type="button" className="pw2-btn" onClick={downloadReport} disabled={!filtered.length}>
            Download report
          </button>
        </div>

        <div className="pw2-toolbar">
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by bill no., patient, test, reference..."
            aria-label="Search transactions"
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Transaction type">
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={testFilter} onChange={(e) => setTestFilter(e.target.value)} aria-label="Test">
            <option value="">All tests</option>
            {tests.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button type="button" className="pw2-btn" onClick={clearFilters}>
            Clear filters
          </button>
        </div>

        <div className="pw2-table-wrap">
          {pageRows.length ? (
            <table className="pw2-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Bill / Reference No.</th>
                  <th>Patient Name</th>
                  <th>Test / Description</th>
                  <th>Type</th>
                  <th>Amount (₹)</th>
                  <th>Balance After (₹)</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatWhen(row.created)}</td>
                    <td>{row.ref || '—'}</td>
                    <td>{row.patient || '—'}</td>
                    <td>{row.description || '—'}</td>
                    <td>
                      <span className="pw2-type">{row.kind.label}</span>
                    </td>
                    <td className={row.signed < 0 ? 'pw2-neg' : 'pw2-pos'}>
                      {`${row.signed < 0 ? '−' : '+'}${money(Math.abs(row.signed))}`}
                    </td>
                    <td>{money(row.balance_after)}</td>
                    <td>
                      <span className="pw2-pill">Posted</span>
                    </td>
                    <td>
                      {row.ref ? (
                        <button type="button" className="pw2-btn" onClick={() => void copyRef(row.ref)}>
                          Copy
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="pw2-empty">{wallet ? 'No transactions match these filters.' : 'Loading wallet…'}</p>
          )}
        </div>

        {filtered.length ? (
          <div className="pw2-pager">
            <span>
              Showing {(safePage - 1) * PAGE_SIZE + 1} to {Math.min(safePage * PAGE_SIZE, filtered.length)} of{' '}
              {filtered.length} transactions
            </span>
            <span>
              <button type="button" className="pw2-btn" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </button>{' '}
              {safePage} / {pageCount}{' '}
              <button
                type="button"
                className="pw2-btn"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
