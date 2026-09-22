import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';

export function CareHubPage() {
  const [programs, setPrograms] = useState<
    Array<{ program_code: string; title: string; description?: string; condition?: string }>
  >([]);
  const [enrollments, setEnrollments] = useState<
    Array<{ name: string; health_score?: number; program?: { title?: string } | null; status?: string }>
  >([]);
  const [packs, setPacks] = useState<
    Array<{ title: string; monthly_price?: number; included_opd_visits?: number; description?: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, e, o] = await Promise.all([
      api.listCarePrograms(),
      api.getMyCareEnrollments(),
      api.listOpdVisitPacks().catch(() => ({ data: { plans: [] as never[] } })),
    ]);
    setPrograms(p.data.programs || []);
    setEnrollments(e.data.enrollments || []);
    setPacks(o.data.plans || []);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load care hub'));
  }, [load]);

  async function enroll(code: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.enrollCareProgram(code);
      setNotice(
        res.data.already
          ? 'Already enrolled in this program.'
          : `Enrolled in ${res.data.enrollment.program?.title || code}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enroll failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Chronic care programs</p>
          <h1>Track your health programs</h1>
          <p className="muted">
            Vitals, daily tasks, and health score — linked to your labs and doctor. For physiotherapy &amp; rehab,
            visit <Link to="/wellness/care">Remedium Care</Link>.
          </p>
        </div>
        <Link className="btn btn-ghost" to="/account">
          Account / ABHA
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      <div className="card">
        <h2>My enrollments</h2>
        {!enrollments.length ? <p className="muted">No active programs yet.</p> : null}
        <ul>
          {enrollments.map((en) => (
            <li key={en.name}>
              <Link to={`/care/${en.name}`}>
                {en.program?.title || en.name} · score {en.health_score ?? '—'} · {en.status}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Available programs</h2>
        {programs.map((p) => (
          <div key={p.program_code} style={{ marginBottom: 16 }}>
            <h3>{p.title}</h3>
            <p className="muted">{p.condition}</p>
            <p>{p.description}</p>
            <button className="btn" type="button" disabled={busy} onClick={() => void enroll(p.program_code)}>
              Enroll
            </button>
          </div>
        ))}
      </div>

      {packs.length ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>OPD visit packs</h2>
          <ul>
            {packs.map((p) => (
              <li key={p.title}>
                <strong>{p.title}</strong>
                {p.monthly_price != null ? ` · ₹${p.monthly_price}` : ''}
                {p.included_opd_visits ? ` · ${p.included_opd_visits} visits` : ''}
                <div className="muted">{p.description}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export function CareEnrollmentPage() {
  const { enrollmentId } = useParams<{ enrollmentId: string }>();
  const [score, setScore] = useState<number | null>(null);
  const [adherence, setAdherence] = useState<number | null>(null);
  const [title, setTitle] = useState('Care program');
  const [vitals, setVitals] = useState<
    Array<{ vital_type: string; value: number; recorded_at?: string | null; out_of_range?: number | boolean }>
  >([]);
  const [tasks, setTasks] = useState<
    Array<{ name: string; task_title?: string; completed?: number | boolean }>
  >([]);
  const [vitalType, setVitalType] = useState('glucose');
  const [vitalValue, setVitalValue] = useState('');
  const [protocols, setProtocols] = useState<Array<{ name: string; title: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!enrollmentId) return;
    const res = await api.getCareDashboard(enrollmentId);
    setTitle(res.data.enrollment.program?.title || enrollmentId);
    setScore(res.data.enrollment.health_score ?? null);
    setAdherence(res.data.enrollment.adherence_percent ?? null);
    setVitals(res.data.vitals || []);
    setTasks(res.data.tasks || []);
    const pro = await api.listStudyProtocols().catch(() => ({ data: { protocols: [] as never[] } }));
    setProtocols(pro.data.protocols || []);
  }, [enrollmentId]);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, [load]);

  async function logVital(e: FormEvent) {
    e.preventDefault();
    if (!enrollmentId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.logPatientVital({
        enrollment_id: enrollmentId,
        vital_type: vitalType,
        value: Number(vitalValue),
      });
      setScore(res.data.health_score);
      setAdherence(res.data.adherence_percent);
      setVitalValue('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log vital');
    } finally {
      setBusy(false);
    }
  }

  async function completeTask(taskId: string) {
    setBusy(true);
    try {
      const res = await api.completeCareTask(taskId);
      setScore(res.data.health_score);
      setAdherence(res.data.adherence_percent);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Task update failed');
    } finally {
      setBusy(false);
    }
  }

  async function joinStudy(code: string) {
    if (!enrollmentId) return;
    try {
      await api.attachStudyConsent(enrollmentId, code);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Study consent failed');
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Care program</p>
          <h1>{title}</h1>
          <p className="muted">
            Health score {score ?? '—'} · Adherence {adherence ?? '—'}%
          </p>
        </div>
        <Link className="btn btn-ghost" to="/care">
          All programs
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="card">
        <h2>Today&apos;s tasks</h2>
        <ul>
          {tasks.map((t) => (
            <li key={t.name}>
              {t.task_title || t.name}{' '}
              {t.completed ? (
                <span className="badge">Done</span>
              ) : (
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void completeTask(t.name)}>
                  Complete
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <form className="card" style={{ marginTop: 16 }} onSubmit={logVital}>
        <h2>Log vital</h2>
        <div className="form-grid">
          <label>
            Type
            <select value={vitalType} onChange={(e) => setVitalType(e.target.value)}>
              <option value="glucose">Glucose</option>
              <option value="weight">Weight</option>
              <option value="bp_systolic">BP systolic</option>
              <option value="bp_diastolic">BP diastolic</option>
              <option value="spo2">SpO2</option>
              <option value="hba1c">HbA1c</option>
            </select>
          </label>
          <label>
            Value
            <input
              type="number"
              step="any"
              value={vitalValue}
              onChange={(e) => setVitalValue(e.target.value)}
              required
            />
          </label>
        </div>
        <button className="btn" type="submit" disabled={busy}>
          Save vital
        </button>
      </form>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Recent vitals</h2>
        <ul>
          {vitals.map((v, i) => (
            <li key={`${v.vital_type}-${i}`}>
              {v.vital_type}: {v.value}
              {v.out_of_range ? ' · out of range' : ''}
              {v.recorded_at ? ` · ${v.recorded_at}` : ''}
            </li>
          ))}
        </ul>
      </div>

      {protocols.length ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Optional observational studies</h2>
          <ul>
            {protocols.map((p) => (
              <li key={p.name}>
                {p.title}{' '}
                <button type="button" className="btn btn-sm" onClick={() => void joinStudy(p.name)}>
                  Consent &amp; join
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
