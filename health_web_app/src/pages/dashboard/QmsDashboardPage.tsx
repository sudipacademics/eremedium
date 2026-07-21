import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, QmsDashboard } from '../../api';

export function QmsDashboardPage() {
  const [data, setData] = useState<QmsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [capaTitle, setCapaTitle] = useState('');
  const [capaDesc, setCapaDesc] = useState('');
  const [linkComplaint, setLinkComplaint] = useState('');

  async function load() {
    const res = await api.getQmsDashboard();
    setData(res.data);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load QMS'));
  }, []);

  async function onCreateCapa(e: FormEvent) {
    e.preventDefault();
    setBusy('capa');
    setError(null);
    try {
      const res = await api.createCapa({
        title: capaTitle,
        nonconformity_description: capaDesc,
        source: linkComplaint ? 'Complaint' : 'Internal',
        linked_complaint: linkComplaint || undefined,
      });
      setNotice(`CAPA created: ${res.data.capa}`);
      setCapaTitle('');
      setCapaDesc('');
      setLinkComplaint('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CAPA create failed');
    } finally {
      setBusy(null);
    }
  }

  async function closeComplaint(name: string) {
    setBusy(name);
    try {
      await api.updateComplaintStatus({
        complaint: name,
        status: 'Closed',
        reply_summary: 'Closed from QMS hub',
      });
      setNotice(`Complaint ${name} closed`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  if (!data && !error) return <p>Loading QMS dashboard…</p>;

  const qiLatest = (code: string) =>
    (data?.qi_values || []).find((v) => v.indicator === code || String(v.indicator).endsWith(code));

  return (
    <>
      <section className="hero hero-compact">
        <h1>Quality management</h1>
        <p className="muted">
          NABL 112A QMS + 132 complaints — CAPA board, QI, audits, risk, LIS verification.{' '}
          <Link to="/complaint">Public complaint form</Link>
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="notice">{notice}</div> : null}

      <div className="stat-row">
        <div className="card">
          <p className="muted">Open CAPA</p>
          <h3>{data?.counts?.capa_open ?? 0}</h3>
        </div>
        <div className="card">
          <p className="muted">Open complaints</p>
          <h3>{data?.counts?.complaints_open ?? 0}</h3>
        </div>
        <div className="card">
          <p className="muted">Risks</p>
          <h3>{data?.counts?.risks ?? 0}</h3>
        </div>
        <div className="card">
          <p className="muted">Audits</p>
          <h3>{data?.counts?.audits ?? 0}</h3>
        </div>
      </div>

      <section className="card card-wide">
        <h2>Quality indicators</h2>
        <div className="stat-row">
          {['REJ_PCT', 'TAT_MET', 'CMP_CNT'].map((code) => {
            const meta = data?.quality_indicators?.find((q) => q.indicator_code === code);
            const val = qiLatest(code);
            return (
              <div className="card" key={code}>
                <p className="muted">{meta?.indicator_name || code}</p>
                <h3>
                  {val?.value != null ? val.value : '—'}
                  {meta?.unit && meta.unit !== 'count' ? meta.unit : ''}
                </h3>
                <p className="muted">
                  Target {meta?.target_value ?? '—'} · {val?.meets_target ? 'On target' : val ? 'Off target' : 'No value'}
                </p>
              </div>
            );
          })}
        </div>
        {data?.retention ? (
          <p className="muted" style={{ marginTop: 12 }}>
            Retention (years): reports {data.retention.reports}, raw {data.retention.raw_data}, QC {data.retention.qc},
            complaints {data.retention.complaints}
          </p>
        ) : null}
      </section>

      <form className="card card-wide form-stack" onSubmit={onCreateCapa}>
        <h2>New CAPA</h2>
        <label>
          Title
          <input value={capaTitle} onChange={(e) => setCapaTitle(e.target.value)} required />
        </label>
        <label>
          Nonconformity
          <textarea value={capaDesc} onChange={(e) => setCapaDesc(e.target.value)} required rows={3} />
        </label>
        <label>
          Link complaint (optional)
          <select value={linkComplaint} onChange={(e) => setLinkComplaint(e.target.value)}>
            <option value="">—</option>
            {(data?.complaints || []).map((c) => (
              <option key={c.name} value={c.name}>
                {c.ack_id || c.name} — {c.subject}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit" disabled={busy === 'capa'}>
          {busy === 'capa' ? 'Saving…' : 'Create CAPA'}
        </button>
      </form>

      <section className="card card-wide">
        <h2>CAPA board</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Source</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Opened</th>
            </tr>
          </thead>
          <tbody>
            {(data?.capas || []).map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.title}</td>
                <td>{c.source}</td>
                <td>{c.severity}</td>
                <td>{c.status}</td>
                <td>{c.opened_on}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.capas?.length ? <p className="muted">No CAPA records.</p> : null}
      </section>

      <section className="card card-wide">
        <h2>Complaint queue</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Ack</th>
              <th>Subject</th>
              <th>Source</th>
              <th>Status</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data?.complaints || []).map((c) => (
              <tr key={c.name}>
                <td>{c.ack_id}</td>
                <td>{c.subject}</td>
                <td>{c.source}</td>
                <td>{c.status}</td>
                <td>{c.complaint_date}</td>
                <td>
                  {c.status !== 'Closed' && c.status !== 'Rejected' ? (
                    <button className="btn btn-sm" type="button" disabled={busy === c.name} onClick={() => void closeComplaint(c.name)}>
                      Close
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card-wide">
        <h2>Internal audits</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Date</th>
              <th>Status</th>
              <th>Area</th>
              <th>NCs</th>
            </tr>
          </thead>
          <tbody>
            {(data?.audits || []).map((a) => (
              <tr key={a.name}>
                <td>{a.audit_title}</td>
                <td>{a.audit_type}</td>
                <td>{a.audit_date}</td>
                <td>{a.status}</td>
                <td>{a.area}</td>
                <td>{a.nonconformities_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card-wide">
        <h2>Risk register</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Risk</th>
              <th>Area</th>
              <th>L×I</th>
              <th>Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.risks || []).map((r) => (
              <tr key={r.name}>
                <td>{r.risk_title}</td>
                <td>{r.process_area}</td>
                <td>
                  {r.likelihood}×{r.impact}
                </td>
                <td>{r.risk_score}</td>
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card-wide">
        <h2>LIS verification</h2>
        <ul>
          {(data?.lis_checklists || []).map((l) => (
            <li key={l.name}>
              {l.checklist_title} — {l.verification_date} — <strong>{l.status}</strong>
            </li>
          ))}
        </ul>
        {!data?.lis_checklists?.length ? <p className="muted">No LIS checklists.</p> : null}
      </section>
    </>
  );
}
