import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, QcDashboard } from '../../api';

export function QcDashboardPage() {
  const [data, setData] = useState<QcDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [analyte, setAnalyte] = useState('GLU');
  const [level, setLevel] = useState('1');
  const [result, setResult] = useState('100');
  const [mean, setMean] = useState('100');
  const [sd, setSd] = useState('3');
  const [ljSvg, setLjSvg] = useState<string>('');

  async function load() {
    const res = await api.getQcDashboard();
    setData(res.data);
  }

  async function loadLj() {
    try {
      const res = await api.getIqcLjChart({ analyte_code: analyte, qc_level: level });
      const pts = res.data.points || [];
      if (!pts.length) {
        setLjSvg('');
        return;
      }
      const w = 420;
      const h = 120;
      const pad = 12;
      const vals = pts.map((p) => Number(p.result_value));
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const span = max - min || 1;
      const path = pts
        .map((p, i) => {
          const x = pad + (i / Math.max(pts.length - 1, 1)) * (w - pad * 2);
          const y = h - pad - ((Number(p.result_value) - min) / span) * (h - pad * 2);
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
      setLjSvg(
        `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img"><path d="${path}" fill="none" stroke="#0b6e4f" stroke-width="2"/></svg>`,
      );
    } catch {
      setLjSvg('');
    }
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load QC'));
  }, []);

  useEffect(() => {
    void loadLj();
  }, [analyte, level, data?.iqc_today?.length]);

  const bioEquip = useMemo(
    () => data?.equipment?.find((e) => e.asset_tag === 'BIO-001')?.name || data?.equipment?.[0]?.name,
    [data],
  );

  async function onSubmitIqc(e: FormEvent) {
    e.preventDefault();
    setBusy('iqc');
    setError(null);
    try {
      const res = await api.submitIqcRun({
        analyte_code: analyte,
        analyte_name: analyte === 'GLU' ? 'Glucose' : analyte,
        qc_level: level,
        result_value: result,
        lab_mean: mean,
        lab_sd: sd,
        equipment: bioEquip,
      });
      setNotice(`IQC ${res.data.iqc_run} → ${res.data.outcome}${res.data.z_score != null ? ` (z=${res.data.z_score})` : ''}`);
      await load();
      await loadLj();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'IQC submit failed');
    } finally {
      setBusy(null);
    }
  }

  if (!data && !error) return <p>Loading QC dashboard…</p>;

  return (
    <>
      <section className="hero hero-compact">
        <h1>Lab QC &amp; equipment</h1>
        <p className="muted">
          NABL 112A / 126 — equipment calibration labels, daily IQC, EQA. Soft gates by default; enforce in Settings.
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      {data?.overdue?.length ? (
        <div className="error" style={{ marginBottom: 16 }}>
          <strong>Calibration / OOS:</strong>{' '}
          {data.overdue.map((o) => `${o.equipment_name} (${o.reason})`).join(' · ')}
        </div>
      ) : null}

      <div className="grid grid-actions" style={{ marginBottom: 20 }}>
        <div className="card card-action">
          <h3>{data?.counts?.equipment ?? 0}</h3>
          <p className="muted">Equipment</p>
        </div>
        <div className="card card-action">
          <h3>{data?.counts?.iqc ?? 0}</h3>
          <p className="muted">IQC runs</p>
        </div>
        <div className="card card-action">
          <h3>{data?.counts?.eqa ?? 0}</h3>
          <p className="muted">EQA cycles</p>
        </div>
        <div className="card card-action">
          <h3>{data?.counts?.calibrations ?? 0}</h3>
          <p className="muted">Calibrations</p>
        </div>
      </div>

      <form className="card card-wide form-stack" onSubmit={onSubmitIqc}>
        <h2>Record IQC</h2>
        <div className="form-row">
          <label>
            Analyte code
            <input value={analyte} onChange={(e) => setAnalyte(e.target.value)} required />
          </label>
          <label>
            Level
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Result
            <input value={result} onChange={(e) => setResult(e.target.value)} required />
          </label>
          <label>
            Lab mean
            <input value={mean} onChange={(e) => setMean(e.target.value)} />
          </label>
          <label>
            Lab SD
            <input value={sd} onChange={(e) => setSd(e.target.value)} />
          </label>
        </div>
        <button className="btn" type="submit" disabled={busy === 'iqc'}>
          {busy === 'iqc' ? 'Saving…' : 'Submit IQC'}
        </button>
      </form>

      <div className="card card-wide" style={{ marginTop: 16 }}>
        <h2>
          LJ chart — {analyte} L{level}
        </h2>
        {ljSvg ? <div dangerouslySetInnerHTML={{ __html: ljSvg }} /> : <p className="muted">No points yet.</p>}
      </div>

      <div className="table-wrap" style={{ marginTop: 24 }}>
        <h2>Equipment</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Tag</th>
              <th>Type</th>
              <th>Label</th>
              <th>Next cal</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.equipment || []).map((eq) => (
              <tr key={eq.name}>
                <td>{eq.equipment_name}</td>
                <td>{eq.asset_tag}</td>
                <td>{eq.equipment_type}</td>
                <td>{eq.safety_label}</td>
                <td>{eq.next_calibration_due || '—'}</td>
                <td>{eq.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-wrap" style={{ marginTop: 24 }}>
        <h2>Today&apos;s IQC</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Analyte</th>
              <th>Lvl</th>
              <th>Result</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {(data?.iqc_today || []).map((r) => (
              <tr key={r.name}>
                <td>
                  {r.analyte_code} {r.analyte_name ? `(${r.analyte_name})` : ''}
                </td>
                <td>{r.qc_level}</td>
                <td>{r.result_value}</td>
                <td>{r.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.iqc_today?.length ? <p className="muted">No IQC today.</p> : null}
      </div>

      <div className="table-wrap" style={{ marginTop: 24 }}>
        <h2>EQA</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Scheme</th>
              <th>Discipline</th>
              <th>Cycle</th>
              <th>Score</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {(data?.eqa || []).map((r) => (
              <tr key={r.name}>
                <td>{r.scheme_name}</td>
                <td>{r.discipline}</td>
                <td>{r.cycle}</td>
                <td>{r.score}</td>
                <td>{r.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/dashboard/staff">Back to operations</Link>
      </p>
    </>
  );
}
