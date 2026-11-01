import { useEffect, useMemo, useState } from 'react';
import { api, type PartnerEarningsBill, type PartnerEarningsPayload } from '../../api';
import { PartnersPageHeader } from '../../components/B2bLayout';
import './partner-earnings.css';

function inr(value?: number | null) {
  return `₹${(Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function when(raw?: string) {
  return raw ? String(raw).slice(0, 10) : '—';
}

function statusPill(status?: string | null) {
  if (!status) return <span className="pe-muted">—</span>;
  const tone = status === 'Posted' ? 'ok' : status === 'Pending' ? 'warn' : 'muted';
  return <span className={`pe-pill pe-${tone}`}>{status === 'Posted' ? 'Credited' : status}</span>;
}

const SERVICE_LABELS: Record<string, string> = {
  phlebotomy: 'Phlebotomist service',
  lr_logistics: 'LR + logistics',
  lab_team: 'Technician, lab manager, accessor / transcriber, signatories',
};

export function B2bEarningsPage() {
  const [data, setData] = useState<PartnerEarningsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'all' | 'billed' | 'earned'>('all');

  useEffect(() => {
    void api
      .getPartnerEarnings(200)
      .then((res) => setData(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load business earnings'));
  }, []);

  const circuit = data?.circuit;
  const me = circuit?.franchisee;
  const rows = useMemo(() => {
    const bills = data?.bills || [];
    if (view === 'billed') return bills.filter((b) => b.billed_by_me);
    if (view === 'earned') return bills.filter((b) => !b.billed_by_me);
    return bills;
  }, [data, view]);

  function myShare(bill: PartnerEarningsBill) {
    if (bill.mf_beneficiary === me) return { amount: bill.mf_share, status: bill.mf_status, label: 'MF share' };
    if (bill.lab_beneficiary === me) return { amount: bill.lab_share, status: bill.lab_status, label: 'Lab share' };
    return null;
  }

  const services = circuit?.services
    ? Object.entries(circuit.services)
        .filter(([, on]) => on)
        .map(([key]) => SERVICE_LABELS[key] || key)
    : [];

  return (
    <>
      <PartnersPageHeader
        title="Business Earnings"
        lead={
          <>
            Deposit adjustments across your partner circuit. Bills debit the billing partner&apos;s deposit at once;
            the Master FOCO share credits when the sample reaches the lab, and the lab share credits when the report
            is authorized.
          </>
        }
      />

      {error ? <div className="partners-alert error">{error}</div> : null}

      {circuit ? (
        <div className="partners-table-card pe-circuit">
          {circuit.tier ? (
            <>
              <div className="pe-chain" aria-label="Partner circuit">
                <span className={`pe-node${circuit.tier === 'FOCO' ? ' is-me' : ''}`}>
                  <small>FOCO</small>
                  {circuit.tier === 'FOCO' ? circuit.franchise_name : '—'}
                </span>
                <i aria-hidden>→</i>
                <span className={`pe-node${circuit.tier === 'Master FOCO' ? ' is-me' : ''}`}>
                  <small>Master FOCO</small>
                  {circuit.tier === 'Master FOCO' ? circuit.franchise_name : circuit.master_foco_name || '—'}
                </span>
                <i aria-hidden>→</i>
                <span className={`pe-node${circuit.tier === 'Orange FOCO' || circuit.has_lab ? ' is-me' : ''}`}>
                  <small>Orange FOCO / Lab</small>
                  {circuit.lab_name || '—'}
                </span>
              </div>
              <p className="pe-muted pe-circuit-note">
                You are a <b>{circuit.tier}</b>
                {circuit.has_lab ? ' with your own lab' : ''}.
                {services.length ? ` Services: ${services.join(' · ')}.` : ''}
              </p>
            </>
          ) : (
            <p className="pe-muted pe-circuit-note">
              This hub is not on the FOCO → Master FOCO → Orange FOCO circuit yet. Ask the Remedium team to map it.
            </p>
          )}
        </div>
      ) : null}

      {data ? (
        <div className="partners-stats">
          <article className="partners-stat">
            <span>Deposit Balance</span>
            <strong>{inr(data.wallet_balance)}</strong>
          </article>
          <article className="partners-stat">
            <span>Pending MF Share</span>
            <strong>{inr(data.kpis.pending_mf)}</strong>
          </article>
          <article className="partners-stat">
            <span>Pending Lab Share</span>
            <strong>{inr(data.kpis.pending_lab)}</strong>
          </article>
          <article className="partners-stat">
            <span>Credited This Month</span>
            <strong>{inr(data.kpis.credited_month)}</strong>
          </article>
          <article className="partners-stat">
            <span>Debited This Month</span>
            <strong>{inr(data.kpis.debited_month)}</strong>
          </article>
        </div>
      ) : null}

      <div className="pe-tabs" role="tablist" aria-label="Bills">
        {(
          [
            ['all', 'All bills'],
            ['billed', 'Billed by me'],
            ['earned', 'Shares earned from circuit'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="partners-table-card">
        <table>
          <thead>
            <tr>
              <th>Bill / TRF</th>
              <th>Date</th>
              <th>Test</th>
              <th>Billed Via</th>
              <th>Deposit Debit</th>
              <th>MF Share</th>
              <th>Lab Share</th>
              <th>My Adjustment</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((bill) => {
                const share = myShare(bill);
                return (
                  <tr key={bill.trf}>
                    <td>{bill.trf}</td>
                    <td>{when(bill.created)}</td>
                    <td>{bill.tests || '—'}</td>
                    <td>{bill.channel || '—'}</td>
                    <td>{bill.debit ? `−${inr(bill.debit)}` : '—'}</td>
                    <td>
                      {bill.mf_share ? (
                        <>
                          +{inr(bill.mf_share)} {statusPill(bill.mf_status)}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {bill.lab_share ? (
                        <>
                          +{inr(bill.lab_share)} {statusPill(bill.lab_status)}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {bill.billed_by_me ? (
                        <b className="pe-neg">−{inr(bill.debit)}</b>
                      ) : share ? (
                        <>
                          <b className="pe-pos">+{inr(share.amount)}</b> {statusPill(share.status)}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={8}>{data ? 'No circuit bills yet.' : 'Loading…'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
