import { useCallback, useEffect, useState } from 'react';
import { api, BankBookingAccounts, BankMatchSuggestion, BankStatementLine, PaymentCoreStatus } from '../../api';
import { deskAppUrl } from '../../config';
import { CashDepositPanel, ReconReportPanel } from './ReconPanels';

type Tab = 'bank' | 'upi' | 'cheque' | 'cash';

const TABS: { id: Tab; label: string }[] = [
  { id: 'bank', label: 'Bank statement' },
  { id: 'upi', label: 'UPI / QR collections' },
  { id: 'cheque', label: 'Cheques' },
  { id: 'cash', label: 'Cash deposits' },
];

const CONFIDENCE_LABEL: Record<BankMatchSuggestion['confidence'], string> = {
  reference: 'Reference match',
  amount_date: 'Same amount, near date',
  approve_first: 'Approve top-up first',
};

function rupees(value: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

type BookRequest = { kind: 'razorpay_settlement' | 'account'; account?: string; fee?: number };

function BookLineForm({
  line,
  accounts,
  disabled,
  onBook,
}: {
  line: BankStatementLine;
  accounts: BankBookingAccounts | null;
  disabled: boolean;
  onBook: (req: BookRequest) => void;
}) {
  const settlementPossible = Boolean(line.deposit) && Boolean(accounts?.razorpay_clearing_account);
  const [kind, setKind] = useState<BookRequest['kind']>(line.settlement_hint && settlementPossible ? 'razorpay_settlement' : 'account');
  const [account, setAccount] = useState('');
  const [fee, setFee] = useState('');

  return (
    <details open={line.settlement_hint && !line.suggestions.length} style={{ marginTop: 6 }}>
      <summary className="muted" style={{ cursor: 'pointer' }}>
        Book without a voucher
      </summary>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value as BookRequest['kind'])}>
          {settlementPossible ? <option value="razorpay_settlement">Razorpay settlement</option> : null}
          <option value="account">{line.deposit ? 'Credit to account' : 'Debit to account'}</option>
        </select>
        {kind === 'razorpay_settlement' ? (
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Fee + GST deducted"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            style={{ width: 150 }}
          />
        ) : (
          <select value={account} onChange={(e) => setAccount(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Choose account…</option>
            {(accounts?.accounts || []).map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} ({a.root_type})
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="btn btn-sm"
          disabled={disabled || (kind === 'account' && !account)}
          onClick={() => onBook(kind === 'account' ? { kind, account } : { kind, fee: Number(fee || 0) })}
        >
          Book &amp; reconcile
        </button>
      </div>
    </details>
  );
}

export function BankReconciliationPage() {
  const [status, setStatus] = useState<PaymentCoreStatus | null>(null);
  const [lines, setLines] = useState<BankStatementLine[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('bank');
  const [accounts, setAccounts] = useState<BankBookingAccounts | null>(null);
  const [clearing, setClearing] = useState<{ account?: string | null; balance?: number | null }>({});

  const load = useCallback(async () => {
    setError('');
    try {
      const [statusRes, listRes] = await Promise.all([api.getPaymentCoreStatus(), api.listBankTransactions(150)]);
      setStatus(statusRes.data);
      setLines(listRes.data.transactions || []);
      setCounts(listRes.data.counts || {});
      setClearing({ account: listRes.data.razorpay_clearing_account, balance: listRes.data.razorpay_clearing_balance });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load bank transactions');
    }
  }, []);

  useEffect(() => {
    void load();
    api
      .listBankBookingAccounts()
      .then((res) => setAccounts(res.data))
      .catch(() => setAccounts(null));
  }, [load]);

  async function onBook(line: BankStatementLine, req: BookRequest) {
    setBusy(line.name);
    setError('');
    setNotice('');
    try {
      const res = await api.bookBankTransaction({ bank_transaction: line.name, ...req });
      setNotice(`${line.name} booked as ${res.data.journal_entry} and reconciled.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setBusy('');
    }
  }

  async function onUpload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy('upload');
    setError('');
    setNotice('');
    try {
      const res = await api.uploadBankStatement(file.name, await readAsBase64(file));
      const d = res.data;
      setNotice(
        `${d.rows} statement lines read: ${d.created} new, ${d.duplicates} already imported, ${d.auto_matched} matched automatically.`,
      );
      setFile(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy('');
    }
  }

  async function onMatch(line: BankStatementLine, suggestion: BankMatchSuggestion) {
    setBusy(line.name);
    setError('');
    setNotice('');
    try {
      await api.matchBankTransaction(line.name, suggestion.voucher_type, suggestion.voucher_name);
      setNotice(`${line.name} matched to ${suggestion.voucher_type} ${suggestion.voucher_name}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Match failed');
    } finally {
      setBusy('');
    }
  }

  const desk = deskAppUrl();

  return (
    <>
      <section className="hero hero-compact">
        <h1>Bank reconciliation</h1>
        <p className="muted">
          Each money channel has its own report: the ICICI account statement, the UPI / QR merchant report, the cheque
          clearing report and cash deposit slips. Reconcile each on its tab.
        </p>
      </section>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'btn btn-sm' : 'btn btn-sm secondary'}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'upi' ? <ReconReportPanel key="upi" statementType="upi" /> : null}
      {tab === 'cheque' ? <ReconReportPanel key="cheque" statementType="cheque" /> : null}
      {tab === 'cash' ? <CashDepositPanel /> : null}
      {tab !== 'bank' ? null : (
      <>
      <p className="muted">
        Upload the ICICI account statement (CSV / XLS / XLSX downloaded from retail or corporate internet banking).
        Credits and debits are matched to vouchers already booked in ERPNext by UTR / cheque number. Razorpay
        settlements, cash deposits, bank charges, interest and direct transfers can be booked and reconciled in one step.
      </p>
      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      {status ? (
        <p className="muted">
          Books company: <strong>{status.company}</strong> · Statement account: <strong>{status.bank_account || 'not set'}</strong> ·
          Razorpay webhook: <strong>{status.webhook_configured ? 'configured' : 'not configured'}</strong> · ICICI:{' '}
          <strong>{status.icici_available ? 'available' : 'awaiting API credentials'}</strong>
        </p>
      ) : null}
      {clearing.account ? (
        <p className="muted">
          Razorpay collected but not yet settled to the bank ({clearing.account}): <strong>{rupees(clearing.balance || 0)}</strong>
        </p>
      ) : null}
      {status?.wallet_books?.opening_booked ? (
        <p className={Math.abs(status.wallet_books.difference || 0) >= 1 ? 'error' : 'muted'}>
          Franchisee wallets ₹{(status.wallet_books.wallets || 0).toLocaleString('en-IN')} · Wallet liability in books ₹
          {(status.wallet_books.ledger || 0).toLocaleString('en-IN')}
          {Math.abs(status.wallet_books.difference || 0) >= 1
            ? ` · Difference ₹${(status.wallet_books.difference || 0).toLocaleString('en-IN')}; check unbooked wallet movements`
            : ' · in agreement'}
        </p>
      ) : null}
      {status?.patient_wallet_books?.ledger != null ? (
        <p className={Math.abs(status.patient_wallet_books.difference || 0) >= 1 ? 'error' : 'muted'}>
          Patient wallets ₹{(status.patient_wallet_books.wallets || 0).toLocaleString('en-IN')} · Patient wallet liability in books ₹
          {(status.patient_wallet_books.ledger || 0).toLocaleString('en-IN')}
          {Math.abs(status.patient_wallet_books.difference || 0) >= 1
            ? ` · Difference ₹${(status.patient_wallet_books.difference || 0).toLocaleString('en-IN')}; check unbooked wallet movements`
            : ' · in agreement'}
        </p>
      ) : null}

      <form className="card" onSubmit={onUpload} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept=".csv,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button type="submit" className="btn" disabled={!file || busy === 'upload'}>
          {busy === 'upload' ? 'Importing…' : 'Import statement'}
        </button>
        <span className="muted">
          {Object.entries(counts)
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ')}
        </span>
      </form>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description / reference</th>
              <th>Credit</th>
              <th>Debit</th>
              <th>Suggested match</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.name}>
                <td>{line.date}</td>
                <td>
                  <div>{line.description || '—'}</div>
                  <div className="muted">{line.reference_number}</div>
                </td>
                <td>{line.deposit ? rupees(line.deposit) : ''}</td>
                <td>{line.withdrawal ? rupees(line.withdrawal) : ''}</td>
                <td>
                  {line.suggestions.length ? (
                    line.suggestions.slice(0, 3).map((s) => (
                      <div key={`${s.voucher_type}-${s.voucher_name}`} style={{ marginBottom: 6 }}>
                        <span className="badge">{CONFIDENCE_LABEL[s.confidence]}</span> {s.voucher_name} · {rupees(s.amount)}
                        <div className="muted">{s.label}</div>
                        {s.confidence === 'approve_first' ? (
                          <a
                            className="btn btn-sm secondary"
                            href={`${desk}/app/franchisee-wallet-topup-request/${encodeURIComponent(s.voucher_name)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open request
                          </a>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busy === line.name}
                            onClick={() => void onMatch(line, s)}
                          >
                            Match
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <span className="muted">
                      {line.settlement_hint ? 'Looks like a Razorpay settlement' : line.deposit ? 'No booked payment found' : 'No booked payout found'}
                    </span>
                  )}
                  <BookLineForm line={line} accounts={accounts} disabled={busy === line.name} onBook={(req) => void onBook(line, req)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lines.length ? <p className="muted">No unreconciled statement lines.</p> : null}
      </div>
      </>
      )}
    </>
  );
}
