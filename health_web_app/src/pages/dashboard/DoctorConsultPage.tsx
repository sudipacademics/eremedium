import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  ClinicalEncounter,
  PrescriptionDiagnosticLine,
  PrescriptionMedicineLine,
} from '../../api';

type AppointmentContext = {
  appointment_id: string;
  patient_name?: string;
  appointment_date?: string;
  appointment_time?: string;
  consultation_mode?: string;
  status?: string;
};

function emptyMed(): PrescriptionMedicineLine {
  return { medicine_item: '', dosage: '', frequency: '', duration: '', instructions: '' };
}

export function DoctorConsultPage() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const aptFromState = (location.state as { appointment?: AppointmentContext } | null)?.appointment;

  const [context, setContext] = useState<AppointmentContext | null>(aptFromState || null);
  const [encounter, setEncounter] = useState<ClinicalEncounter | null>(null);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [hpi, setHpi] = useState('');
  const [examination, setExamination] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [templates, setTemplates] = useState<
    Array<{ code: string; title: string; chief_complaint_hint?: string; examination_hint?: string; plan_hint?: string }>
  >([]);
  const [cdss, setCdss] = useState<
    Array<{ name: string; rationale?: string; urgency?: string }>
  >([]);
  const [cautions, setCautions] = useState<string[]>([]);
  const [medicines, setMedicines] = useState<PrescriptionMedicineLine[]>([emptyMed()]);
  const [diagnostics] = useState<PrescriptionDiagnosticLine[]>([]);
  const [careAlerts, setCareAlerts] = useState<string[]>([]);
  const [abhaLabel, setAbhaLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cdssTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!appointmentId) return;
    const res = await api.getOrCreateEncounter(appointmentId);
    const enc = res.data.encounter;
    setEncounter(enc);
    setContext(res.data.appointment);
    setChiefComplaint(enc.chief_complaint || '');
    setHpi(enc.history_of_present_illness || '');
    setExamination(enc.examination || '');
    setAssessment(enc.assessment || '');
    setPlan(enc.plan || '');
    setDiagnosis(enc.diagnosis || '');
    setSpecialty(enc.specialty_template || '');
    if (enc.cdss_suggestions?.differentials) setCdss(enc.cdss_suggestions.differentials);
    if (enc.patient) {
      try {
        const strip = await api.getPatientCareStrip(enc.patient);
        const alerts = (strip.data.alerts || []).map(
          (a) => `${a.vital_type}: ${a.value}${a.recorded_at ? ` @ ${a.recorded_at}` : ''}`,
        );
        setCareAlerts(alerts);
      } catch {
        setCareAlerts([]);
      }
      try {
        const abha = await api.getPatientAbha(enc.patient);
        if (abha.data.abha?.abha_number) {
          setAbhaLabel(`${abha.data.abha.abha_number} (${abha.data.abha.abha_verification_status})`);
        }
      } catch {
        setAbhaLabel(null);
      }
    }
  }, [appointmentId]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to open encounter'));
    void api
      .listSpecialtyTemplates()
      .then((r) => setTemplates(r.data.templates || []))
      .catch(() => undefined);
  }, [load]);

  const header = useMemo(() => {
    if (!context) return appointmentId || 'Consultation';
    const parts = [context.patient_name || 'Patient'];
    if (context.appointment_date) parts.push(context.appointment_date);
    if (context.appointment_time) parts.push(String(context.appointment_time).slice(0, 5));
    return parts.join(' · ');
  }, [appointmentId, context]);

  function applyTemplate(code: string) {
    setSpecialty(code);
    const t = templates.find((x) => x.code === code);
    if (!t) return;
    if (!chiefComplaint && t.chief_complaint_hint) setChiefComplaint(t.chief_complaint_hint);
    if (!examination && t.examination_hint) setExamination(t.examination_hint);
    if (!plan && t.plan_hint) setPlan(t.plan_hint);
  }

  function scheduleCdss() {
    if (cdssTimer.current) window.clearTimeout(cdssTimer.current);
    cdssTimer.current = window.setTimeout(() => {
      const text = [chiefComplaint, hpi, examination, assessment].filter(Boolean).join('\n');
      if (text.trim().length < 12 || !encounter) return;
      void api
        .suggestDifferentials(text, encounter.name)
        .then((r) => {
          setCdss(r.data.suggestions?.differentials || []);
          setCautions(r.data.suggestions?.cautions || []);
        })
        .catch(() => undefined);
    }, 2000);
  }

  useEffect(() => {
    scheduleCdss();
    return () => {
      if (cdssTimer.current) window.clearTimeout(cdssTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiefComplaint, hpi, examination, assessment, encounter?.name]);

  async function saveDraft() {
    if (!encounter) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveEncounter({
        encounter_id: encounter.name,
        chief_complaint: chiefComplaint,
        history_of_present_illness: hpi,
        examination,
        assessment,
        plan,
        diagnosis: diagnosis || assessment,
        specialty_template: specialty || undefined,
      });
      setEncounter(res.data.encounter);
      setNotice('Encounter draft saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void uploadScribe();
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone unavailable');
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    setRecording(false);
  }

  async function uploadScribe() {
    if (!encounter || !chunksRef.current.length) return;
    setBusy(true);
    setNotice('Transcribing consultation…');
    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      bytes.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      const b64 = btoa(binary);
      const res = await api.scribeConsultationAudio({
        audio_base64: b64,
        filename: 'consult.webm',
        encounter_id: encounter.name,
      });
      const s = res.data.structured || {};
      if (s.chief_complaint) setChiefComplaint(s.chief_complaint);
      if (s.history_of_present_illness) setHpi(s.history_of_present_illness);
      if (s.examination) setExamination(s.examination);
      if (s.assessment) setAssessment(s.assessment);
      if (s.plan) setPlan(s.plan);
      if (s.diagnosis) setDiagnosis(s.diagnosis);
      setNotice('VoiceRx draft applied — review before finalizing.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'VoiceRx failed');
    } finally {
      setBusy(false);
    }
  }

  async function finalize(e: FormEvent) {
    e.preventDefault();
    if (!encounter) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveEncounter({
        encounter_id: encounter.name,
        chief_complaint: chiefComplaint,
        history_of_present_illness: hpi,
        examination,
        assessment,
        plan,
        diagnosis: diagnosis || assessment,
        specialty_template: specialty || undefined,
      });
      const cleanMeds = medicines.filter((m) => m.medicine_item?.trim());
      const cleanDiag = diagnostics.filter((d) => d.diagnostic_test?.trim() || d.item?.trim());
      const res = await api.finalizeEncounterAndRx({
        encounter_id: encounter.name,
        medicines: cleanMeds,
        diagnostics: cleanDiag,
        submit: true,
      });
      setEncounter(res.data.encounter);
      setNotice(
        res.data.prescription
          ? `Encounter finalized · Rx ${res.data.prescription.name}`
          : 'Encounter finalized (no Rx lines).',
      );
      if (appointmentId) {
        navigate(`/dashboard/provider/prescription/${appointmentId}`, {
          state: { appointment: context },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finalize failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Clinical Encounter</p>
          <h1>{header}</h1>
          <p className="muted">
            {encounter ? `${encounter.name} · ${encounter.status}` : 'Loading…'}
            {abhaLabel ? ` · ABHA ${abhaLabel}` : ''}
          </p>
        </div>
        <div className="actions">
          <Link className="btn btn-ghost" to="/dashboard/provider">
            Portal
          </Link>
          {appointmentId ? (
            <Link
              className="btn btn-ghost"
              to={`/dashboard/provider/prescription/${appointmentId}`}
              state={{ appointment: context }}
            >
              Rx pad
            </Link>
          ) : null}
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      {careAlerts.length ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Care alerts</h3>
          <ul>
            {careAlerts.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <form className="card" onSubmit={finalize}>
        <div className="form-grid">
          <label>
            Specialty template
            <select
              value={specialty}
              onChange={(e) => applyTemplate(e.target.value)}
              disabled={encounter?.status === 'Final'}
            >
              <option value="">Select…</option>
              {templates.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <div className="actions" style={{ alignItems: 'end' }}>
            {!recording ? (
              <button type="button" className="btn" onClick={() => void startRecording()} disabled={busy}>
                VoiceRx record
              </button>
            ) : (
              <button type="button" className="btn" onClick={stopRecording}>
                Stop &amp; transcribe
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => void saveDraft()} disabled={busy}>
              Save draft
            </button>
          </div>
        </div>

        <label>
          Chief complaint
          <textarea
            rows={2}
            value={chiefComplaint}
            onChange={(e) => setChiefComplaint(e.target.value)}
            disabled={encounter?.status === 'Final'}
          />
        </label>
        <label>
          History of present illness
          <textarea
            rows={4}
            value={hpi}
            onChange={(e) => setHpi(e.target.value)}
            disabled={encounter?.status === 'Final'}
          />
        </label>
        <label>
          Examination
          <textarea
            rows={3}
            value={examination}
            onChange={(e) => setExamination(e.target.value)}
            disabled={encounter?.status === 'Final'}
          />
        </label>
        <label>
          Assessment
          <textarea
            rows={2}
            value={assessment}
            onChange={(e) => setAssessment(e.target.value)}
            disabled={encounter?.status === 'Final'}
          />
        </label>
        <label>
          Diagnosis summary
          <input
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            disabled={encounter?.status === 'Final'}
          />
        </label>
        <label>
          Plan
          <textarea
            rows={3}
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            disabled={encounter?.status === 'Final'}
          />
        </label>

        {cdss.length ? (
          <div>
            <h3>CDSS suggestions (advisory)</h3>
            <div className="chip-row">
              {cdss.map((d) => (
                <button
                  key={d.name}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setAssessment((prev) => (prev ? `${prev}; ${d.name}` : d.name));
                    setDiagnosis(d.name);
                  }}
                >
                  {d.name}
                  {d.urgency ? ` · ${d.urgency}` : ''}
                </button>
              ))}
            </div>
            {cautions.map((c) => (
              <p key={c} className="muted">
                {c}
              </p>
            ))}
          </div>
        ) : null}

        <h3>Optional Rx lines (finalize)</h3>
        {medicines.map((m, idx) => (
          <div className="form-grid" key={`med-${idx}`}>
            <label>
              Medicine item code
              <input
                value={m.medicine_item}
                onChange={(e) => {
                  const next = [...medicines];
                  next[idx] = { ...next[idx], medicine_item: e.target.value };
                  setMedicines(next);
                }}
              />
            </label>
            <label>
              Dosage
              <input
                value={m.dosage || ''}
                onChange={(e) => {
                  const next = [...medicines];
                  next[idx] = { ...next[idx], dosage: e.target.value };
                  setMedicines(next);
                }}
              />
            </label>
          </div>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => setMedicines((p) => [...p, emptyMed()])}>
          Add medicine line
        </button>

        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn" type="submit" disabled={busy || encounter?.status === 'Final'}>
            Finalize encounter
          </button>
          <Link className="btn btn-ghost" to="/dashboard/provider/smartsync">
            SmartSync OCR
          </Link>
        </div>
      </form>
    </>
  );
}
