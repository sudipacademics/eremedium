import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

type BlueprintRow = {
  name: string;
  patient?: string;
  package?: string;
  status?: string;
  progress_percent?: number;
  completed_sessions?: number;
  planned_sessions?: number;
  chief_complaint?: string;
  ai_gait_status?: string;
  red_zone_tags?: string;
};

type Checkin = {
  name: string;
  patient_name?: string;
  appointment_date?: string;
  appointment_time?: string;
  care_arrived?: number;
  care_intake_complete?: number;
  care_blueprint?: string;
  care_zone?: string;
};

type ZoneBoard = Record<string, { label: string; ashoknagar_label?: string; today: number }>;

export function CareOpsPage() {
  const [blueprints, setBlueprints] = useState<BlueprintRow[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [zoneBoard, setZoneBoard] = useState<ZoneBoard>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [bpPatient, setBpPatient] = useState('');
  const [bpPackage, setBpPackage] = useState('Standard');
  const [bpComplaint, setBpComplaint] = useState('');
  const [logBlueprint, setLogBlueprint] = useState('');
  const [logZone, setLogZone] = useState('A');
  const [logModality, setLogModality] = useState('IFT');
  const [gaitUrl, setGaitUrl] = useState('');
  const [redTags, setRedTags] = useState('');

  async function reload() {
    const res = await api.listCareOpsQueue();
    setBlueprints((res.data.blueprints || []) as BlueprintRow[]);
    setCheckins((res.data.checkins || []) as Checkin[]);
    setZoneBoard(res.data.zone_board || {});
    if (!logBlueprint && res.data.blueprints?.[0]?.name) {
      setLogBlueprint(String(res.data.blueprints[0].name));
    }
  }

  useEffect(() => {
    void api.ensureRemediumCareSetup().catch(() => undefined);
    void reload().catch((e) => setError(e instanceof Error ? e.message : 'Unable to load Care ops'));
  }, []);

  async function markArrived(id: string) {
    setBusy(id);
    setError('');
    try {
      await api.markCareCheckin(id, true);
      setNotice(`Checked in ${id}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check-in failed');
    } finally {
      setBusy(null);
    }
  }

  async function createBlueprint(e: FormEvent) {
    e.preventDefault();
    setBusy('blueprint');
    setError('');
    try {
      const res = await api.createCareBlueprint({
        patient: bpPatient,
        package: bpPackage,
        chief_complaint: bpComplaint,
        attach_pack: '1',
      });
      setNotice(`Blueprint ${String(res.data.blueprint.name)} created`);
      setBpPatient('');
      setBpComplaint('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create blueprint');
    } finally {
      setBusy(null);
    }
  }

  async function logSession(e: FormEvent) {
    e.preventDefault();
    setBusy('log');
    setError('');
    try {
      await api.logCareZoneSession({
        blueprint_id: logBlueprint,
        zone: logZone,
        modality: logModality,
        punch_card: '1',
      });
      setNotice('Zone session logged');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Log failed');
    } finally {
      setBusy(null);
    }
  }

  async function saveGait(e: FormEvent) {
    e.preventDefault();
    setBusy('gait');
    setError('');
    try {
      await api.uploadCareGaitSnapshot({
        blueprint_id: logBlueprint,
        snapshot_url: gaitUrl,
        red_zone_tags: redTags,
        metadata_json: JSON.stringify({ vendor: 'stub', captured_at: new Date().toISOString() }),
      });
      setNotice('AI gait snapshot metadata saved');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gait save failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="care-ops-page">
      <header className="page-intro">
        <p className="muted">Staff · Remedium Care</p>
        <h1>Care ops queue</h1>
        <p>Today’s blueprints, check-ins, and Ashoknagar zone board.</p>
        <Link className="btn secondary" to="/dashboard/session-ops">
          Session card ops
        </Link>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      <section className="care-ops-section">
        <h2>Zone board (today)</h2>
        <div className="care-zone-board">
          {Object.entries(zoneBoard).map(([id, z]) => (
            <article key={id}>
              <strong>Zone {id}</strong>
              <p>{z.ashoknagar_label || z.label}</p>
              <p className="session-remaining">{z.today} sessions</p>
            </article>
          ))}
        </div>
      </section>

      <section className="care-ops-section">
        <h2>Check-ins</h2>
        {!checkins.length ? <p className="muted">No physio appointments queued for today.</p> : null}
        <ul className="care-ops-list">
          {checkins.map((c) => (
            <li key={c.name}>
              <div>
                <strong>{c.patient_name || c.name}</strong>
                <span className="muted">
                  {' '}
                  {c.appointment_date} {c.appointment_time}
                </span>
                <p className="muted">
                  Arrived: {c.care_arrived ? 'Yes' : 'No'} · Intake: {c.care_intake_complete ? 'Done' : 'Pending'} ·
                  Zone: {c.care_zone || '—'}
                </p>
              </div>
              {!c.care_arrived ? (
                <button className="btn btn-sm" type="button" disabled={busy === c.name} onClick={() => markArrived(c.name)}>
                  Mark arrived
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="care-ops-section">
        <h2>Active blueprints</h2>
        <ul className="care-ops-list">
          {blueprints.map((b) => (
            <li key={b.name}>
              <div>
                <strong>{b.name}</strong> · {b.package} · {b.progress_percent ?? 0}%
                <p className="muted">
                  {b.patient} — {b.chief_complaint || '—'} · {b.completed_sessions}/{b.planned_sessions} · Gait:{' '}
                  {b.ai_gait_status || '—'}
                </p>
                {b.red_zone_tags ? <p className="error">Red zone: {b.red_zone_tags}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="care-ops-section">
        <h2>Create Recovery Blueprint</h2>
        <form className="care-ops-form" onSubmit={createBlueprint}>
          <label>
            Patient (Health Patient id)
            <input required value={bpPatient} onChange={(e) => setBpPatient(e.target.value)} />
          </label>
          <label>
            Package
            <select value={bpPackage} onChange={(e) => setBpPackage(e.target.value)}>
              <option value="Standard">Standard</option>
              <option value="Advanced">Advanced Tech-Led</option>
            </select>
          </label>
          <label>
            Chief complaint
            <input value={bpComplaint} onChange={(e) => setBpComplaint(e.target.value)} />
          </label>
          <button className="btn" type="submit" disabled={busy === 'blueprint'}>
            Create + attach pack
          </button>
        </form>
      </section>

      <section className="care-ops-section">
        <h2>Log zone session</h2>
        <form className="care-ops-form" onSubmit={logSession}>
          <label>
            Blueprint
            <select value={logBlueprint} onChange={(e) => setLogBlueprint(e.target.value)} required>
              <option value="">Select…</option>
              {blueprints.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} ({b.package})
                </option>
              ))}
            </select>
          </label>
          <label>
            Zone
            <select value={logZone} onChange={(e) => setLogZone(e.target.value)}>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </select>
          </label>
          <label>
            Modality
            <input required value={logModality} onChange={(e) => setLogModality(e.target.value)} />
          </label>
          <button className="btn" type="submit" disabled={busy === 'log'}>
            Log & punch
          </button>
        </form>
      </section>

      <section className="care-ops-section">
        <h2>AI gait snapshot (metadata)</h2>
        <form className="care-ops-form" onSubmit={saveGait}>
          <label>
            Blueprint
            <select value={logBlueprint} onChange={(e) => setLogBlueprint(e.target.value)} required>
              <option value="">Select…</option>
              {blueprints.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Snapshot URL / file ref
            <input value={gaitUrl} onChange={(e) => setGaitUrl(e.target.value)} placeholder="https://… or file id" />
          </label>
          <label>
            Red-zone tags
            <input value={redTags} onChange={(e) => setRedTags(e.target.value)} placeholder="e.g. left knee valgus" />
          </label>
          <button className="btn" type="submit" disabled={busy === 'gait'}>
            Save gait metadata
          </button>
        </form>
      </section>
    </div>
  );
}
