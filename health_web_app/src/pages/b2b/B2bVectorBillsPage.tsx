import { useCallback, useEffect, useState } from 'react';
import { api, type PartnerVectorBill, type PartnerVectorBillsPayload } from '../../api';
import { PartnersPageHeader } from '../../components/B2bLayout';
import './partner-earnings.css';

function inr(value?: number | null) {
  return `₹${(Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function day(raw?: string | null) {
  return raw ? String(raw).slice(0, 10) : '—';
}

function statusPill(status: string) {
  const tone = status === 'Settled' ? 'ok' : status === 'Unsettled' ? 'warn' : 'muted';
  return <span className={`pe-pill pe-${tone}`}>{status}</span>;
}

function BillsTable({
  rows,
  counterpart,
  busy,
  onSettle,
}: {
  rows: PartnerVectorBill[];
  counterpart: 'vector' | 'entry';
  busy?: string | null;
  onSettle?: (id: string) => void;
}) {
  return (
    <div className="partners-table-card">
      <table>
        <thead>
          <tr>
            <th>Bill / TRF</th>
            <th>Date</th>
            <th>{counterpart === 'vector' ? 'Vector (billed to)' : 'Entry partner (billed by)'}</th>
            <th>Patient</th>
            <th>Tests</th>
            <th>B2B Amount</th>
            <th>Status</th>
            {onSettle ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((b) => (
              <tr key={b.id}>
                <td>{b.trf}</td>
                <td>{day(b.created)}</td>
                <td>
                  {counterpart === 'vector' ? b.vector_name || b.vector : b.entry_name || b.entry_partner}
                  {counterpart === 'entry' && b.entry_tier ? <div className="pe-muted">{b.entry_tier}</div> : null}
                </td>
                <td>{b.patient_name || '—'}</td>
                <td>{b.tests || '—'}</td>
                <td>{inr(b.amount)}</td>
                <td>
                  {statusPill(b.status)}
                  {b.settled_on ? <div className="pe-muted">{day(b.settled_on)}</div> : null}
                </td>
                {onSettle ? (
                  <td>
                    {b.status === 'Unsettled' ? (
                      <button
                        type="button"
                        className="partners-btn partners-btn-primary"
                        disabled={busy === b.id}
                        onClick={() => onSettle(b.id)}
                      >
                        {busy === b.id ? 'Saving…' : 'Mark settled'}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={onSettle ? 8 : 7}>No Vector B2B bills yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function B2bVectorBillsPage() {
  const [data, setData] = useState<PartnerVectorBillsPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getPartnerVectorBills();
    setData(res.data);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load Vector bills'));
  }, [load]);

  async function onSettle(id: string) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await api.settlePartnerVectorBill(id);
      setNotice('Marked settled.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not settle the bill');
    } finally {
      setBusy(null);
    }
  }

  const isVector = Boolean(data?.vector_entry);

  return (
    <>
      <PartnersPageHeader
        title="Vector B2B Bills"
        lead={
          <>
            Doctors and pharmacies (Vectors) enter the circuit through a FOCO, Master FOCO or lab. The patient gets a
            dummy MRP bill; the entry partner bills the Vector its tier rate, settled directly between them. The
            entry partner&apos;s deposit carries the platform adjustment.
          </>
        }
      />

      {error ? <div className="partners-alert error">{error}</div> : null}
      {notice ? <div className="partners-alert">{notice}</div> : null}

      {isVector && data?.vector_entry ? (
        <div className="partners-table-card pe-circuit">
          <p className="pe-muted pe-circuit-note">
            Your samples enter through <b>{data.vector_entry.entry_name}</b> ({data.vector_entry.entry_tier}). Pay
            them the B2B amounts below directly.
          </p>
        </div>
      ) : null}

      {data ? (
        <div className="partners-stats">
          {isVector ? (
            <>
              <article className="partners-stat">
                <span>Payable (unsettled)</span>
                <strong>{inr(data.payable_totals.unsettled)}</strong>
              </article>
              <article className="partners-stat">
                <span>Unsettled bills</span>
                <strong>{data.payable_totals.count_unsettled}</strong>
              </article>
              <article className="partners-stat">
                <span>Settled this month</span>
                <strong>{inr(data.payable_totals.settled_month)}</strong>
              </article>
            </>
          ) : (
            <>
              <article className="partners-stat">
                <span>Receivable (unsettled)</span>
                <strong>{inr(data.receivable_totals.unsettled)}</strong>
              </article>
              <article className="partners-stat">
                <span>Unsettled bills</span>
                <strong>{data.receivable_totals.count_unsettled}</strong>
              </article>
              <article className="partners-stat">
                <span>Settled this month</span>
                <strong>{inr(data.receivable_totals.settled_month)}</strong>
              </article>
            </>
          )}
        </div>
      ) : null}

      {data && (!isVector || data.receivable.length) ? (
        <>
          <h2 className="pe-section-title">Receivable from Vectors</h2>
          <BillsTable rows={data.receivable} counterpart="vector" busy={busy} onSettle={(id) => void onSettle(id)} />
        </>
      ) : null}

      {data && (isVector || data.payable.length) ? (
        <>
          <h2 className="pe-section-title">Payable to your entry partner</h2>
          <BillsTable rows={data.payable} counterpart="entry" />
        </>
      ) : null}
    </>
  );
}
