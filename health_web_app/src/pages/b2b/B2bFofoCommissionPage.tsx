import { useEffect, useState } from 'react';
import { api, type B2bFofoCommissionLine } from '../../api';
import { PartnersPageHeader } from '../../components/B2bLayout';

function inr(value: number) {
  return `₹${(value || 0).toFixed(0)}`;
}

export function B2bFofoCommissionPage() {
  const [lines, setLines] = useState<B2bFofoCommissionLine[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [pct, setPct] = useState(20);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getB2bFofoCommission()
      .then((res) => {
        setLines(res.data.lines || []);
        setSummary(res.data.summary || null);
        setPct(res.data.override_upsell_commission || 20);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load FOFO commission'));
  }, []);

  return (
    <>
      <PartnersPageHeader
        title="FOFO Commission"
        lead={
          <>
            Bill-wise FOFO → FOCO upsell. Net = MRP − FOFO margin. Earning = Override Upsell
            Commission ({pct}%) of net. Pending items credit the FOCO wallet after 7 days.
          </>
        }
      />

      {summary ? (
        <div className="partners-stats">
          <article className="partners-stat">
            <span>Profit From Centre</span>
            <strong>{inr(summary.profit_from_centre || 0)}</strong>
          </article>
          <article className="partners-stat">
            <span>Pending FOFO Earnings</span>
            <strong>{inr(summary.pending_fofo_earnings || 0)}</strong>
          </article>
          <article className="partners-stat">
            <span>Credited</span>
            <strong>{inr(summary.credited_total || 0)}</strong>
          </article>
          <article className="partners-stat">
            <span>Override Upsell %</span>
            <strong>{pct}%</strong>
          </article>
        </div>
      ) : null}

      {error ? <div className="partners-alert error">{error}</div> : null}

      <div className="partners-table-card">
        <table>
          <thead>
            <tr>
              <th>FOFO Centre</th>
              <th>Bill / TRF ID</th>
              <th>Bill Date</th>
              <th>MRP</th>
              <th>FOFO Margin</th>
              <th>Net Amount</th>
              <th>FOCO %</th>
              <th>FOCO Earning</th>
              <th>Settlement Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {lines.length ? (
              lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.fofo_name}</td>
                  <td>{line.trf_id}</td>
                  <td>{line.bill_date ? String(line.bill_date).slice(0, 10) : '—'}</td>
                  <td>{inr(line.mrp)}</td>
                  <td>{inr(line.fofo_margin)}</td>
                  <td>{inr(line.net_amount)}</td>
                  <td>{line.commission_percent}%</td>
                  <td>{inr(line.foco_earning)}</td>
                  <td>{line.settlement_date || '—'}</td>
                  <td>{line.status}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10}>No FOFO commission rows yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
