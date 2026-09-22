import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';

export function CareIntakePage() {
  const { appointmentId = '' } = useParams();
  const navigate = useNavigate();
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [painAreas, setPainAreas] = useState('');
  const [duration, setDuration] = useState('');
  const [priorTreatment, setPriorTreatment] = useState('');
  const [medications, setMedications] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<string | null>(null);

  useEffect(() => {
    if (!appointmentId) return;
    void api
      .getCareIntake(appointmentId)
      .then((res) => {
        if (res.data.intake) {
          setExisting(res.data.intake.name);
          setChiefComplaint(res.data.intake.chief_complaint || '');
        }
      })
      .catch(() => undefined);
  }, [appointmentId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!consent) {
      setError('Please confirm consent to proceed.');
      return;
    }
    if (!chiefComplaint.trim()) {
      setError('Chief complaint is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.submitCareIntake({
        appointment_id: appointmentId || undefined,
        chief_complaint: chiefComplaint.trim(),
        consent: '1',
        history_json: JSON.stringify({
          pain_areas: painAreas,
          duration,
          prior_treatment: priorTreatment,
          medications,
        }),
      });
      navigate('/wellness/care/plan', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save intake');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="care-intake-page">
      <p className="eyebrow">Remedium Care · Digital intake</p>
      <h1>Complete intake before your visit</h1>
      <p className="muted">
        History, chief complaint, and consent — so triage and your Recovery Blueprint start faster.
      </p>
      {existing ? (
        <p className="success">Intake already submitted ({existing}). You can update details below.</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}

      <form className="care-intake-form" onSubmit={onSubmit}>
        <label>
          Chief complaint
          <textarea
            required
            value={chiefComplaint}
            onChange={(e) => setChiefComplaint(e.target.value)}
            rows={3}
            placeholder="What brings you in today?"
          />
        </label>
        <label>
          Pain / concern areas
          <input value={painAreas} onChange={(e) => setPainAreas(e.target.value)} placeholder="e.g. lower back, right knee" />
        </label>
        <label>
          How long have you had this?
          <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 3 weeks" />
        </label>
        <label>
          Prior treatment
          <input
            value={priorTreatment}
            onChange={(e) => setPriorTreatment(e.target.value)}
            placeholder="Physio, meds, surgery…"
          />
        </label>
        <label>
          Current medications / allergies
          <input value={medications} onChange={(e) => setMedications(e.target.value)} />
        </label>
        <label className="care-consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          I consent to Remedium Care using this intake for triage and Recovery Blueprint planning.
        </label>
        <div className="care-intake-actions">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Submit intake'}
          </button>
          <Link className="btn secondary" to="/bookings">
            Skip to bookings
          </Link>
        </div>
      </form>
    </div>
  );
}
