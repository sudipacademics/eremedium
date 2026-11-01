import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, CashInHand, ReconLine, ReconReport, ReconStatementType, ReconSuggestion } from '../../api';
import { deskAppUrl } from '../../config';

const CONFIDENCE_LABEL: Record<ReconSuggestion['confidence'], string> = {
  reference: 'Reference match',
  amount_date: 'Same amount, near date',
  approve_first: 'Approve top-up first',
};

const TYPE_COPY: Record<ReconStatementType, { title: string; help: string; reference: string }> = {
  upi: {
    title: 'UPI / QR collections',
    help:
      'Upload the ICICI UPI / QR merchant transaction report. Each successful payment is matched to the UPI collection recorded for its order (by UTR / RRN when staff entered it, otherwise by amount and date). Failed and pending payments in the report are skipped.',
    reference: 'UTR / RRN',
  },
  cheque: {
    title: 'Cheque collections',
    help:
      'Upload the ICICI cheque deposit / clearing report. Each cheque is matched by number to the payment or wallet top-up it paid for. Upload the report again later to update clearing status; bounced cheques are flagged so the payment can be reversed.',
    reference: 'Cheque no',
  },
};

function rupees(value: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

function deskLink(doctype?: string, name?: string) {
  if (!doctype || !name) return null;
  const slug = doctype.toLowerCase().replace(/ /g, '-');
  return `${deskAppUrl()}/app/${slug}/${encodeURIComponent(name)}`;
}

function VoucherLink({ doctype, name }: { doctype?: string; name?: string }) {
  const href = deskLink(doctype, name);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {name}
    </a>
  );
}

export function ReconReportPanel({ statementType }: { statementType: ReconStatementType }) {
  const copy = TYPE_COPY[statementType];
  const [report, setReport] = useState<ReconReport | null>(null);
  const [fromDate, setFromDate] = useState(isoDaysAgo(60));
  const [toDate, setToDate] = useState(isoDaysAgo(0));
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.listReconReport(statementType, fromDate, toDate, show);
      setReport(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the report');
    }
  }, [statementType, fromDate, toDate, show]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<string>) {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      setNotice(await action());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy('');
    }
  }

  function onUpload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    void run('upload', async () => {
      const d = (await api.uploadReconReport(statementType, file.name, await readAsBase64(file))).data;
      setFile(null);
      return `${d.rows} report lines read: ${d.created} new, ${d.updated} status updates, ${d.duplicates} already imported, ${d.skipped} failed/pending skipped, ${d.auto_matched} matched automatically.`;
    });
  }

  const counts = report?.counts || {};

  return (
    <>
      <p className="muted">{copy.help}</p>
      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <form className="card" onSubmit={onUpload} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept=".csv,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button type="submit" className="btn" disabled={!file || busy === 'upload'}>
          {busy === 'upload' ? 'Importing…' : 'Import report'}
        </button>
        <label>
          From <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>
          To <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <select value={show} onChange={(e) => setShow(e.target.value as 'open' | 'all')}>
          <option value="open">Open lines only</option>
          <option value="all">All lines</option>
        </select>
      </form>

      <p className="muted">
        {Object.entries(counts)
          .map(([status, c]) => `${status}: ${c.count} (${rupees(c.amount)})`)
          .join(' · ') || 'No report lines in this period.'}
      </p>

      <h3>In the report</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>{copy.reference}</th>
              <th>Payer</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {(report?.lines || []).map((line) => (
              <ReconLineRow key={line.name} line={line} busy={busy === line.name} run={run} />
            ))}
          </tbody>
        </table>
        {report && !report.lines.length ? <p className="muted">Nothing open in this period.</p> : null}
      </div>

      <h3 style={{ marginTop: 20 }}>Recorded in our books but not in any report</h3>
      <p className="muted">
        Collections recorded as {statementType === 'upi' ? 'UPI' : 'cheque'} in this period that no report line points to yet.
        These need checking if the report for their date has already been uploaded.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Voucher</th>
              <th>Details</th>
              <th>Collected by</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {(report?.books_not_in_report || []).map((row) => (
              <tr key={`${row.voucher_type}-${row.voucher_name}`}>
                <td>{row.date}</td>
                <td>
                  <VoucherLink doctype={row.voucher_type} name={row.voucher_name} />
                </td>
                <td>{row.label}</td>
                <td>{row.collected_by || '—'}</td>
                <td>{rupees(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {report && !report.books_not_in_report.length ? <p className="muted">Everything in the books is accounted for.</p> : null}
      </div>
    </>
  );
}

function ReconLineRow({
  line,
  busy,
  run,
}: {
  line: ReconLine;
  busy: boolean;
  run: (key: string, action: () => Promise<string>) => Promise<void>;
}) {
  const returned = line.recon_status === 'Returned';
  return (
    <tr>
      <td>{line.txn_date}</td>
      <td>{line.reference}</td>
      <td>{line.counterparty || '—'}</td>
      <td>{rupees(line.amount)}</td>
      <td>
        <span className={returned ? 'badge badge-danger' : 'badge'}>{line.recon_status}</span>
        {line.report_status ? <div className="muted">{line.report_status}</div> : null}
        {line.settlement_date ? <div className="muted">Credited {line.settlement_date}</div> : null}
      </td>
      <td>
        {line.matched_name ? (
          <div>
            {returned ? <strong className="error-inline">Bounced — reverse </strong> : 'Matched to '}
            <VoucherLink doctype={line.matched_doctype} name={line.matched_name} />
            {line.matched_via ? <span className="muted"> ({line.matched_via})</span> : null}
          </div>
        ) : returned ? (
          <div className="error-inline">Bounced cheque with no recorded payment found</div>
        ) : null}
        {line.suggestions.slice(0, 3).map((s) => (
          <div key={`${s.voucher_type}-${s.voucher_name}`} style={{ marginBottom: 6 }}>
            <span className="badge">{CONFIDENCE_LABEL[s.confidence]}</span>{' '}
            <VoucherLink doctype={s.voucher_type} name={s.voucher_name} /> · {rupees(s.amount)}
            {s.amount_differs ? <strong className="error-inline"> amount differs</strong> : null}
            <div className="muted">
              {s.label}
              {s.posting_date ? ` · ${s.posting_date.slice(0, 10)}` : ''}
            </div>
            {s.confidence !== 'approve_first' ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(line.name, async () => {
                    await api.matchReconLine(line.name, s.voucher_type, s.voucher_name);
                    return `${line.reference} matched to ${s.voucher_name}.`;
                  })
                }
              >
                Match
              </button>
            ) : null}
          </div>
        ))}
        {line.recon_status === 'Unmatched' && !line.suggestions.length ? (
          <div className="muted">No recorded collection found</div>
        ) : null}
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {line.recon_status === 'Unmatched' ? (
            <button
              type="button"
              className="btn btn-sm secondary"
              disabled={busy}
              onClick={() =>
                void run(line.name, async () => {
                  await api.setReconLineStatus(line.name, 'ignore');
                  return `${line.reference} ignored.`;
                })
              }
            >
              Ignore
            </button>
          ) : null}
          {line.recon_status !== 'Unmatched' ? (
            <button
              type="button"
              className="btn btn-sm secondary"
              disabled={busy}
              onClick={() =>
                void run(line.name, async () => {
                  await api.setReconLineStatus(line.name, 'reopen');
                  return `${line.reference} reopened.`;
                })
              }
            >
              Unmatch
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export function CashDepositPanel() {
  const [data, setData] = useState<CashInHand | null>(null);
  const [since, setSince] = useState(isoDaysAgo(90));
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [slipNo, setSlipNo] = useState('');
  const [depositDate, setDepositDate] = useState(isoDaysAgo(0));
  const [collector, setCollector] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData((await api.getCashInHand(since)).data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load cash in hand');
    }
  }, [since]);

  useEffect(() => {
    void load();
  }, [load]);

  const collectors = useMemo(
    () => Array.from(new Set((data?.items || []).map((i) => i.collected_by || '—'))).sort(),
    [data],
  );
  const visible = (data?.items || []).filter((i) => !collector || (i.collected_by || '—') === collector);
  const key = (i: { voucher_type: string; voucher_name: string }) => `${i.voucher_type}|${i.voucher_name}`;
  const selected = (data?.items || []).filter((i) => picked[key(i)]);
  const selectedTotal = selected.reduce((sum, i) => sum + i.amount, 0);

  async function onDeposit(event: React.FormEvent) {
    event.preventDefault();
    setBusy('deposit');
    setError('');
    setNotice('');
    try {
      const res = await api.recordCashDeposit(
        selected.map((i) => ({ voucher_type: i.voucher_type, voucher_name: i.voucher_name })),
        slipNo.trim(),
        depositDate,
      );
      setNotice(
        `Deposit ${res.data.journal_entry} recorded: ${res.data.count} collections, ${rupees(res.data.amount)}. It will match the cash-deposit line when the bank statement is uploaded.`,
      );
      setPicked({});
      setSlipNo('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the deposit');
    } finally {
      setBusy('');
    }
  }

  async function onUndo(journalEntry: string) {
    if (!window.confirm(`Cancel cash deposit ${journalEntry}? Its collections go back to cash in hand.`)) return;
    setBusy(journalEntry);
    setError('');
    setNotice('');
    try {
      await api.undoCashDeposit(journalEntry);
      setNotice(`Deposit ${journalEntry} cancelled.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the deposit');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <p className="muted">
        Cash collected (COD, pay at hub, cash wallet top-ups and fees) stays in <strong>{data?.cash_account || 'the cash account'}</strong>{' '}
        until it is banked. Tick the collections in a deposit slip and record the deposit; the cash-deposit line in the ICICI
        statement then matches it on the Bank statement tab.
      </p>
      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <p>
        Cash in hand: <strong>{rupees(data?.total || 0)}</strong> across {data?.items.length || 0} collections since{' '}
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        {collectors.length > 1 ? (
          <>
            {' '}
            · Collected by{' '}
            <select value={collector} onChange={(e) => setCollector(e.target.value)}>
              <option value="">Everyone</option>
              {collectors.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </p>

      <form className="card" onSubmit={onDeposit} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>
          {selected.length} ticked · {rupees(selectedTotal)}
        </strong>
        <input type="text" placeholder="Deposit slip no" value={slipNo} onChange={(e) => setSlipNo(e.target.value)} />
        <label>
          Deposited on <input type="date" value={depositDate} max={isoDaysAgo(0)} onChange={(e) => setDepositDate(e.target.value)} />
        </label>
        <button type="submit" className="btn" disabled={!selected.length || !slipNo.trim() || busy === 'deposit'}>
          {busy === 'deposit' ? 'Recording…' : 'Record bank deposit'}
        </button>
      </form>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Tick all shown"
                  checked={visible.length > 0 && visible.every((i) => picked[key(i)])}
                  onChange={(e) =>
                    setPicked((prev) => {
                      const next = { ...prev };
                      visible.forEach((i) => {
                        next[key(i)] = e.target.checked;
                      });
                      return next;
                    })
                  }
                />
              </th>
              <th>Date</th>
              <th>Voucher</th>
              <th>Details</th>
              <th>Collected by</th>
              <th>Days held</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={key(item)}>
                <td>
                  <input
                    type="checkbox"
                    checked={Boolean(picked[key(item)])}
                    onChange={(e) => setPicked((prev) => ({ ...prev, [key(item)]: e.target.checked }))}
                  />
                </td>
                <td>{item.date}</td>
                <td>
                  <VoucherLink doctype={item.voucher_type} name={item.voucher_name} />
                </td>
                <td>{item.label}</td>
                <td>{item.collected_by || '—'}</td>
                <td className={(item.age_days || 0) > 3 ? 'error-inline' : undefined}>{item.age_days}</td>
                <td>{rupees(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !visible.length ? <p className="muted">No cash waiting to be banked.</p> : null}
      </div>

      <h3 style={{ marginTop: 20 }}>Recent deposits</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Slip</th>
              <th>Entry</th>
              <th>Amount</th>
              <th>In bank statement</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.deposits || []).map((d) => (
              <tr key={d.journal_entry}>
                <td>{d.date}</td>
                <td>{d.slip_no}</td>
                <td>
                  <VoucherLink doctype="Journal Entry" name={d.journal_entry} />
                </td>
                <td>{rupees(d.amount)}</td>
                <td>{d.in_bank_statement ? 'Yes, reconciled' : 'Not yet'}</td>
                <td>
                  {!d.in_bank_statement ? (
                    <button
                      type="button"
                      className="btn btn-sm secondary"
                      disabled={busy === d.journal_entry}
                      onClick={() => void onUndo(d.journal_entry)}
                    >
                      Undo
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.deposits.length ? <p className="muted">No deposits recorded yet.</p> : null}
      </div>
    </>
  );
}
