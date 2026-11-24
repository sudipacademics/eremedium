import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  api,
  SalesTeamMapData,
  SalesTeamPerformanceAttachment,
  SalesTeamPerformanceReport,
} from '../../api';
import { SalesTeamMap } from '../../components/SalesTeamMap';
import { useSalesGps } from '../../hooks/useSalesGps';

type PendingFile = {
  id: string;
  filename: string;
  file_content: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function readAllowedFile(file: File): Promise<{ filename: string; file_content: string }> {
  const okExt = /\.(pdf|jpe?g|png|xlsx?|docx?|csv)$/i.test(file.name);
  if (!okExt) {
    throw new Error('Allowed uploads: PDF, JPG, PNG, Excel, Word, CSV');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error(`${file.name} exceeds 8MB limit`);
  }
  return { filename: file.name, file_content: await fileToBase64(file) };
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBase64(filename: string, b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SalesTeamMapPage() {
  const [data, setData] = useState<SalesTeamMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onDuty, setOnDuty] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);

  const [isManager, setIsManager] = useState(false);
  const [reports, setReports] = useState<SalesTeamPerformanceReport[]>([]);
  const [portalCounts, setPortalCounts] = useState({ leads: 0, visits: 0, onboardings: 0 });
  const [todayCounts, setTodayCounts] = useState({ leads: 0, visits: 0, onboardings: 0 });
  const [portalLeads, setPortalLeads] = useState<Array<Record<string, unknown>>>([]);
  const [portalVisits, setPortalVisits] = useState<Array<Record<string, unknown>>>([]);
  const [portalOnboards, setPortalOnboards] = useState<Array<Record<string, unknown>>>([]);
  const [activityTab, setActivityTab] = useState<'leads' | 'visits' | 'onboardings' | 'notes'>('leads');
  const [perfError, setPerfError] = useState<string | null>(null);
  const [perfMessage, setPerfMessage] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [activityDate, setActivityDate] = useState(todayIso);
  const [title, setTitle] = useState('Daily field activity');
  const [summary, setSummary] = useState('');
  const [doctorsMet, setDoctorsMet] = useState('');
  const [visitsDone, setVisitsDone] = useState('');
  const [samplesCollected, setSamplesCollected] = useState('');
  const [kmTraveled, setKmTraveled] = useState('');
  const [locationNote, setLocationNote] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);

  useSalesGps(onDuty, setGpsStatus);

  async function loadMap() {
    try {
      const res = await api.getSalesTeamMap();
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load map');
    }
  }

  async function loadReports() {
    try {
      const [notes, portal] = await Promise.all([
        api.getSalesTeamPerformanceReports({
          limit: 80,
          ...(filterDate ? { activity_date: filterDate } : {}),
        }),
        api.getSalesTeamPortalActivity({
          limit: 80,
          ...(filterDate ? { activity_date: filterDate } : {}),
        }),
      ]);
      setReports(notes.data.reports || []);
      setIsManager(Boolean(notes.data.is_manager || portal.data.is_manager));
      setPortalCounts(portal.data.counts || { leads: 0, visits: 0, onboardings: 0 });
      setTodayCounts(portal.data.today_counts || { leads: 0, visits: 0, onboardings: 0 });
      setPortalLeads(portal.data.leads || []);
      setPortalVisits(portal.data.visits || []);
      setPortalOnboards(portal.data.onboardings || []);
      const pre = portal.data.prefill || {};
      setVisitsDone(String(pre.visits_done ?? 0));
      setDoctorsMet(String(pre.doctors_met ?? 0));
      setSamplesCollected(String(pre.samples_collected ?? pre.leads_uploaded ?? 0));
      setPerfError(null);
    } catch (e) {
      setPerfError(e instanceof Error ? e.message : 'Failed to load performance reports');
    }
  }

  useEffect(() => {
    void loadMap();
    const t = setInterval(() => void loadMap(), 90_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void loadReports();
  }, [filterDate]);

  const visibleLabel = useMemo(
    () => (isManager ? 'Team reports (managers see the full hierarchy)' : 'Your submitted daily activity'),
    [isManager],
  );

  async function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    try {
      const next: PendingFile[] = [];
      for (const file of picked.slice(0, 5)) {
        const parsed = await readAllowedFile(file);
        next.push({
          id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          filename: parsed.filename,
          file_content: parsed.file_content,
        });
      }
      setFiles((prev) => [...prev, ...next].slice(0, 10));
      setPerfError(null);
    } catch (err) {
      setPerfError(err instanceof Error ? err.message : 'File upload failed');
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setPerfMessage(null);
    setPerfError(null);
    try {
      await api.submitSalesTeamPerformanceReport({
        activity_date: activityDate,
        title: title.trim() || 'Daily field activity',
        activity_summary: summary.trim(),
        doctors_met: Number(doctorsMet) || 0,
        visits_done: Number(visitsDone) || 0,
        samples_collected: Number(samplesCollected) || 0,
        km_traveled: Number(kmTraveled) || 0,
        location_note: locationNote.trim(),
        attachments_json: JSON.stringify(
          files.map((f) => ({ filename: f.filename, file_content: f.file_content })),
        ),
      });
      setSummary('');
      setDoctorsMet('');
      setVisitsDone('');
      setSamplesCollected('');
      setKmTraveled('');
      setLocationNote('');
      setFiles([]);
      setPerfMessage('Daily activity submitted');
      await loadReports();
    } catch (err) {
      setPerfError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDownloadCsv(kind: 'notes' | 'portal' = 'portal') {
    setDownloading(true);
    setPerfError(null);
    try {
      const opts = filterDate ? { activity_date: filterDate } : {};
      const res =
        kind === 'portal'
          ? await api.downloadSalesTeamPortalActivityCsv(opts)
          : await api.downloadSalesTeamPerformanceCsv(opts);
      downloadBlob(
        res.data.filename || (kind === 'portal' ? 'team-portal-activity.csv' : 'team-performance.csv'),
        res.data.csv || '',
        'text/csv;charset=utf-8',
      );
      setPerfMessage(`Downloaded ${res.data.count || 0} row(s)`);
    } catch (err) {
      setPerfError(err instanceof Error ? err.message : 'CSV download failed');
    } finally {
      setDownloading(false);
    }
  }

  async function onDownloadFile(report: SalesTeamPerformanceReport, file: SalesTeamPerformanceAttachment) {
    try {
      const res = await api.downloadSalesTeamPerformanceFile(report.name, file.name);
      downloadBase64(res.data.file_name || file.file_name || 'attachment', res.data.file_content);
    } catch (err) {
      setPerfError(err instanceof Error ? err.message : 'Attachment download failed');
    }
  }

  return (
    <>
      <h1>Team map & GPS</h1>
      <p className="muted">
        Live rep locations, HQ geofence (5 km), and open leads. Managers see their full team hierarchy.
      </p>

      <label className="toggle-row" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={onDuty} onChange={(e) => setOnDuty(e.target.checked)} />
        <span>Share my location with team</span>
      </label>
      {gpsStatus ? <p className="muted">{gpsStatus}</p> : null}

      {error ? <div className="error">{error}</div> : null}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SalesTeamMap data={data} height={480} />
      </div>

      {data ? (
        <ul className="plain-list" style={{ marginTop: 16 }}>
          {data.reps.map((r) => (
            <li key={r.rep_id}>
              <strong>{r.full_name}</strong> ({r.rep_code}) —{' '}
              {r.on_duty ? 'on duty' : 'off duty'}
              {r.updated ? ` · updated ${r.updated.slice(0, 19)}` : ''}
            </li>
          ))}
        </ul>
      ) : null}

      <section id="reach-team-perf-root" className="card" style={{ marginTop: 28 }}>
        <div className="reach-page-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Team performance check</h2>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Live from Reach portal/app: lead uploads, log visits, and franchise onboardings. Add a written
              daily note and files below.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn secondary" onClick={() => void onDownloadCsv('portal')} disabled={downloading}>
              Download portal CSV
            </button>
            <button type="button" className="btn secondary" onClick={() => void onDownloadCsv('notes')} disabled={downloading}>
              Download notes CSV
            </button>
          </div>
        </div>

        {perfError ? <div className="error">{perfError}</div> : null}
        {perfMessage ? <div className="success">{perfMessage}</div> : null}

        <div className="grid grid-stats" style={{ marginBottom: 16 }}>
          <article className="card stat-card">
            <span className="stat-label">Leads uploaded</span>
            <strong>{portalCounts.leads}</strong>
            <span className="muted">Today {todayCounts.leads}</span>
          </article>
          <article className="card stat-card">
            <span className="stat-label">Visits logged</span>
            <strong>{portalCounts.visits}</strong>
            <span className="muted">Today {todayCounts.visits}</span>
          </article>
          <article className="card stat-card">
            <span className="stat-label">Onboardings</span>
            <strong>{portalCounts.onboardings}</strong>
            <span className="muted">Today {todayCounts.onboardings}</span>
          </article>
        </div>

        <div className="reach-page-head" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(
              [
                ['leads', `Lead uploads (${portalCounts.leads})`],
                ['visits', `Log visits (${portalCounts.visits})`],
                ['onboardings', `Onboarding (${portalCounts.onboardings})`],
                ['notes', `Daily notes (${reports.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={activityTab === id ? 'btn' : 'btn secondary'}
                onClick={() => setActivityTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <label style={{ minWidth: 180 }}>
            Filter by date
            <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
          </label>
        </div>

        {activityTab === 'leads' ? (
          portalLeads.length ? (
            <div className="table-wrap" style={{ marginBottom: 18 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    {isManager ? <th>Employee</th> : null}
                    <th>Lead</th>
                    <th>Phone</th>
                    <th>Area</th>
                    <th>Status</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {portalLeads.map((r) => (
                    <tr key={String(r.name)}>
                      <td>{String(r.creation || '').slice(0, 10)}</td>
                      {isManager ? (
                        <td>
                          <strong>{String(r.full_name || r.rep_code || '')}</strong>
                        </td>
                      ) : null}
                      <td>
                        <strong>{String(r.lead_name || '')}</strong>
                        <div className="muted">{String(r.company_name || '')}</div>
                      </td>
                      <td>{String(r.phone || '')}</td>
                      <td>{String(r.city || r.district || '')}</td>
                      <td>{String(r.status || '')}</td>
                      <td>{String(r.lead_source || '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No lead uploads found for this filter.</p>
          )
        ) : null}

        {activityTab === 'visits' ? (
          portalVisits.length ? (
            <div className="table-wrap" style={{ marginBottom: 18 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    {isManager ? <th>Employee</th> : null}
                    <th>Lead</th>
                    <th>Purpose</th>
                    <th>Outcome</th>
                    <th>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {portalVisits.map((r) => (
                    <tr key={String(r.name)}>
                      <td>{String(r.visit_date || '')}</td>
                      {isManager ? (
                        <td>
                          <strong>{String(r.full_name || r.rep_code || '')}</strong>
                        </td>
                      ) : null}
                      <td>{String(r.lead_name || r.lead || '—')}</td>
                      <td>{String(r.purpose || '')}</td>
                      <td>{String(r.outcome || '')}</td>
                      <td>{String(r.visit_status || '')}</td>
                      <td>{String(r.notes || '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No log-visit records found for this filter.</p>
          )
        ) : null}

        {activityTab === 'onboardings' ? (
          portalOnboards.length ? (
            <div className="table-wrap" style={{ marginBottom: 18 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    {isManager ? <th>Employee</th> : null}
                    <th>Franchise</th>
                    <th>Branch</th>
                    <th>Territory</th>
                    <th>Phone</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {portalOnboards.map((r) => (
                    <tr key={String(r.name)}>
                      <td>{String(r.creation || '').slice(0, 10)}</td>
                      {isManager ? (
                        <td>
                          <strong>{String(r.full_name || r.rep_code || '')}</strong>
                        </td>
                      ) : null}
                      <td>
                        <strong>{String(r.franchise_name || '')}</strong>
                        <div className="muted">{String(r.owner_name || '')}</div>
                      </td>
                      <td>{String(r.proposed_branch_code || '')}</td>
                      <td>{String(r.territory_region || '')}</td>
                      <td>{String(r.phone || '')}</td>
                      <td>{String(r.status || '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No onboarding submissions found for this filter.</p>
          )
        ) : null}

        <form className="stack" onSubmit={onSubmit} style={{ gap: 12, marginBottom: 20, marginTop: 18 }}>
          <h3 style={{ margin: 0 }}>Submit daily activity note</h3>
          <p className="muted" style={{ margin: 0 }}>
            Counts are prefilled from today&apos;s portal lead / visit / onboarding activity.
          </p>
          <div className="grid-2">
            <label>
              Activity date
              <input type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} required />
            </label>
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={140} />
            </label>
          </div>
          <div className="grid-2">
            <label>
              Doctors met
              <input type="number" min={0} value={doctorsMet} onChange={(e) => setDoctorsMet(e.target.value)} />
            </label>
            <label>
              Visits done
              <input type="number" min={0} value={visitsDone} onChange={(e) => setVisitsDone(e.target.value)} />
            </label>
            <label>
              Samples / orders
              <input
                type="number"
                min={0}
                value={samplesCollected}
                onChange={(e) => setSamplesCollected(e.target.value)}
              />
            </label>
            <label>
              KM traveled
              <input type="number" min={0} step="0.1" value={kmTraveled} onChange={(e) => setKmTraveled(e.target.value)} />
            </label>
          </div>
          <label>
            Area / location
            <input
              value={locationNote}
              onChange={(e) => setLocationNote(e.target.value)}
              placeholder="District, beat, or city"
              maxLength={140}
            />
          </label>
          <label>
            Daily activity summary
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              required
              placeholder="What did you cover today? Key meetings, outcomes, follow-ups…"
            />
          </label>
          <label>
            Upload activity files
            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx,.doc,.docx,.csv" onChange={onPickFiles} />
          </label>
          {files.length ? (
            <ul className="plain-list">
              {files.map((f) => (
                <li key={f.id}>
                  {f.filename}{' '}
                  <button type="button" className="btn-link" onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="submit" className="btn" disabled={submitting || !summary.trim()}>
            {submitting ? 'Submitting…' : 'Submit daily activity'}
          </button>
        </form>

        {activityTab === 'notes' ? (
          !reports.length ? (
            <p className="muted">{visibleLabel}. No written daily notes yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    {isManager ? <th>Employee</th> : null}
                    <th>Title</th>
                    <th>Doctors</th>
                    <th>Visits</th>
                    <th>KM</th>
                    <th>Summary</th>
                    <th>Files</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.name}>
                      <td>{r.activity_date}</td>
                      {isManager ? (
                        <td>
                          <strong>{r.full_name || r.rep_code}</strong>
                          <div className="muted">{r.rep_code}</div>
                        </td>
                      ) : null}
                      <td>{r.title}</td>
                      <td>{r.doctors_met || 0}</td>
                      <td>{r.visits_done || 0}</td>
                      <td>{r.km_traveled || 0}</td>
                      <td style={{ maxWidth: 280 }}>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{r.activity_summary}</div>
                        {r.location_note ? <div className="muted">{r.location_note}</div> : null}
                      </td>
                      <td>
                        {(r.attachments || []).length ? (
                          <ul className="plain-list">
                            {(r.attachments || []).map((f, idx) => (
                              <li key={f.name || f.file_name || idx}>
                                <button type="button" className="btn-link" onClick={() => void onDownloadFile(r, f)}>
                                  {f.file_name || 'Download'}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </section>
    </>
  );
}
