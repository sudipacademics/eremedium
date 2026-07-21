import { useEffect, useState } from 'react';
import { api, B2bStatementLine } from '../../api';

export function B2bStatementsPage() {
  const [lines, setLines] = useState<B2bStatementLine[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getB2bStatements()
      .then((res) => {
        setLines(res.data.lines || []);
        setSummary(res.data.summary || null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load statements'));
  }, []);

  return (
    <>
      <h1>B2B statements</h1>
      <p className="muted">Retail collected from patients vs wholesale owed to platform.</p>

      {summary ? (
        <div className="grid grid-stats">
          <article className="card stat-card">
            <span className="stat-label">Total retail</span>
            <strong>₹{(summary.total_retail || 0).toFixed(0)}</strong>
          </article>
          <article className="card stat-card">
            <span className="stat-label">Total wholesale</span>
            <strong>₹{(summary.total_wholesale || 0).toFixed(0)}</strong>
          </article>
          <article className="card stat-card">
            <span className="stat-label">Your margin</span>
            <strong>₹{(summary.total_margin || 0).toFixed(0)}</strong>
          </article>
          <article className="card stat-card">
            <span className="stat-label">Unbilled platform</span>
            <strong>₹{(summary.unbilled_wholesale || 0).toFixed(0)}</strong>
          </article>
        </div>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      <div className="table-wrap" style={{ marginTop: 20 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>TRF</th>
              <th>Patient</th>
              <th>Test</th>
              <th>Retail</th>
              <th>Wholesale</th>
              <th>Margin</th>
              <th>Platform billed</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.trf_id}>
                <td>{line.trf_id}</td>
                <td>{line.patient_name}</td>
                <td>{line.test}</td>
                <td>₹{line.retail_amount.toFixed(0)}</td>
                <td>₹{line.wholesale_amount.toFixed(0)}</td>
                <td>₹{line.margin.toFixed(0)}</td>
                <td>{line.platform_billed ? 'Yes' : 'Pending'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
