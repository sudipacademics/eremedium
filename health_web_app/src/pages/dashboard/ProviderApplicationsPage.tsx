import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ServiceProviderApplication } from '../../api';

type ApplicationDetail = ServiceProviderApplication & {
  gender?: string;
  qualification?: string;
  registration_number?: string;
  clinic_address?: string;
  bio?: string;
  review_notes?: string;
  creation?: string;
  schedule_proposal?: {
    day_of_week: string;
    from_time: string;
    to_time: string;
    slot_duration: number;
    consultation_mode: string;
  }[];
};

export function ProviderApplicationsPage() {
  const [pending, setPending] = useState<ServiceProviderApplication[]>([]);
  const [reviewed, setReviewed] = useState<ServiceProviderApplication[]>([]);
  const [active, setActive] = useState<ApplicationDetail | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [submitted, approved, rejected] = await Promise.all([
      api.listProviderApplications('Submitted'),
      api.listProviderApplications('Approved'),
      api.listProviderApplications('Rejected'),
    ]);
    setPending(submitted.data.applications || []);
    setReviewed([
      ...(approved.data.applications || []),
      ...(rejected.data.applications || []),
    ].sort((a, b) => (b.modified || '').localeCompare(a.modified || '')));
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load applications'));
  }, [load]);

  async function openApplication(name: string) {
    setError(null);
    try {
      const res = await api.getProviderApplicationDetail(name);
      setActive(res.data.application);
      setReviewNotes(res.data.application.review_notes || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load application');
    }
  }

  async function review(action: 'approve' | 'reject') {
    if (!active) return;
    setBusy(active.name);
    setError(null);
    try {
      await api.reviewProviderApplication({
        application_id: active.name,
        action,
        ...(reviewNotes.trim() ? { review_notes: reviewNotes.trim() } : {}),
      });
      setNotice(
        action === 'approve'
          ? `${active.full_name} approved — Doctor profile and schedule slots created.`
          : `Application ${active.name} rejected.`,
      );
      setActive(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="hero hero-compact">
        <h1>Provider applications</h1>
        <p className="muted">
          Review doctor and wellness practitioner sign-ups. Approving creates a Doctor record and weekly schedule slots.
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <span className="badge">
          Awaiting review: <strong>{pending.length}</strong>
        </span>
      </div>

      <h2>Submitted</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Type</th>
              <th>Speciality</th>
              <th>City</th>
              <th>Slots</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.full_name}</td>
                <td>{row.provider_type}</td>
                <td>{row.speciality || row.wellness_wing || '—'}</td>
                <td>{row.city || '—'}</td>
                <td>{row.schedule_count ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className="btn btn-sm" onClick={() => void openApplication(row.name)}>
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pending.length ? <p className="muted">No applications waiting.</p> : null}
      </div>

      <h2 style={{ marginTop: 28 }}>Recently reviewed</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Doctor</th>
            </tr>
          </thead>
          <tbody>
            {reviewed.slice(0, 20).map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.full_name}</td>
                <td>
                  <span className="badge">{row.application_status}</span>
                </td>
                <td>{row.linked_doctor || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!reviewed.length ? <p className="muted">No reviewed applications yet.</p> : null}
      </div>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.5)',
            zIndex: 1000,
            overflowY: 'auto',
          }}
        >
          <div className="card" style={{ maxWidth: 760, width: '94%', margin: '6vh auto' }}>
            <h2>{active.full_name}</h2>
            <p className="muted">
              {active.provider_type} · {active.email} · {active.phone}
            </p>

            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div>
                <strong>Qualification</strong>
                <p>{active.qualification || '—'}</p>
              </div>
              <div>
                <strong>Registration</strong>
                <p>{active.registration_number || '—'}</p>
              </div>
              <div>
                <strong>Fee</strong>
                <p>{active.consultation_fee ? `₹${active.consultation_fee}` : '—'}</p>
              </div>
              <div>
                <strong>Modes</strong>
                <p>
                  {active.supports_online ? 'Online' : ''}
                  {active.supports_online && active.supports_in_person ? ' · ' : ''}
                  {active.supports_in_person ? 'In-person' : ''}
                </p>
              </div>
            </div>

            {active.bio ? (
              <p style={{ marginTop: 12 }}>
                <strong>Bio</strong>
                <br />
                {active.bio}
              </p>
            ) : null}

            <h3 style={{ marginTop: 16 }}>Proposed schedule</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Duration</th>
                    <th>Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {(active.schedule_proposal || []).map((slot, i) => (
                    <tr key={i}>
                      <td>{slot.day_of_week}</td>
                      <td>{slot.from_time}</td>
                      <td>{slot.to_time}</td>
                      <td>{slot.slot_duration} min</td>
                      <td>{slot.consultation_mode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label style={{ display: 'block', marginTop: 16 }}>
              Review notes
              <textarea rows={3} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
            </label>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="btn"
                disabled={busy === active.name}
                onClick={() => void review('approve')}
              >
                {busy === active.name ? 'Saving…' : 'Approve & create schedule'}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy === active.name}
                onClick={() => void review('reject')}
              >
                Reject
              </button>
              <button type="button" className="btn secondary" disabled={busy === active.name} onClick={() => setActive(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: 16 }}>
        <Link to="/dashboard/staff">Back to operations</Link>
      </p>
    </>
  );
}
