import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

type Protocol = {
  name: string;
  protocol_code?: string;
  title?: string;
  condition?: string;
  description?: string;
};

export function ResearchHubPage() {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [funnel, setFunnel] = useState<Record<string, number> | null>(null);
  const [sites, setSites] = useState<Array<{ name: string; site_code: string; site_name: string; target_n?: number }>>(
    [],
  );
  const [subjectCount, setSubjectCount] = useState(0);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.listStudyOpsProtocols();
    const rows = res.data.protocols || [];
    setProtocols(rows);
    setSelected((prev) => prev || rows[0]?.name || '');
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load research hub'));
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      setBusy('funnel');
      setError(null);
      try {
        const res = await api.getStudyFunnel(selected);
        if (cancelled) return;
        setFunnel(res.data.funnel || null);
        setSites(res.data.sites || []);
        setSubjectCount(res.data.subject_count || 0);
        if (res.data.disclaimer) setNotice(res.data.disclaimer);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Funnel failed');
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function onExport() {
    if (!selected) return;
    setBusy('export');
    setError(null);
    try {
      const res = await api.exportStudyDataset(selected);
      setExportJson(JSON.stringify(res.data.package, null, 2));
      setNotice(res.data.package.disclaimer || 'De-identified export ready.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed (staff only)');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">e-Remedium Research</p>
          <h1>Observational study ops</h1>
          <p className="muted">
            Sites, funnel, and de-identified export for Care Program protocols — not a full CTMS / trial platform.
          </p>
        </div>
        <div className="toolbar">
          <Link className="btn secondary" to="/care">
            Care programs
          </Link>
          <Link className="btn secondary" to="/dashboard/provider/knowledge">
            Knowledge
          </Link>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Protocols</h2>
        {!protocols.length ? <p className="muted">No enabled study protocols.</p> : null}
        <label>
          Protocol
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {protocols.map((p) => (
              <option key={p.name} value={p.name}>
                {p.title || p.protocol_code || p.name}
              </option>
            ))}
          </select>
        </label>
        {protocols.find((p) => p.name === selected)?.description ? (
          <p className="muted">{protocols.find((p) => p.name === selected)?.description}</p>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Funnel</h2>
        {busy === 'funnel' ? <p className="muted">Loading…</p> : null}
        {funnel ? (
          <p>
            Screening {funnel.Screening ?? 0} · Enrolled {funnel.Enrolled ?? 0} · Withdrawn {funnel.Withdrawn ?? 0} ·
            Completed {funnel.Completed ?? 0} · Subjects {subjectCount}
          </p>
        ) : (
          <p className="muted">Select a protocol to view funnel.</p>
        )}
        {sites.length ? (
          <ul>
            {sites.map((s) => (
              <li key={s.name}>
                {s.site_name} ({s.site_code}) · target n {s.target_n ?? '—'}
              </li>
            ))}
          </ul>
        ) : null}
        <button className="btn" type="button" disabled={!selected || busy === 'export'} onClick={() => void onExport()}>
          {busy === 'export' ? 'Exporting…' : 'Export de-identified dataset'}
        </button>
      </div>

      {exportJson ? (
        <div className="card">
          <h2>Export package</h2>
          <pre style={{ overflow: 'auto', maxHeight: 360, fontSize: 12 }}>{exportJson}</pre>
        </div>
      ) : null}
    </>
  );
}
