import { FormEvent, useCallback, useEffect, useState } from 'react';

import {
  api,
  StaffAppraisalRow,
  StaffPerformanceHub,
  TrainingEventRow,
} from '../../api';

type Tab = 'training' | 'kra' | 'appraisal';

export function StaffPerformancePage() {
  const [data, setData] = useState<StaffPerformanceHub | null>(null);
  const [tab, setTab] = useState<Tab>('training');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [selectedAppraisal, setSelectedAppraisal] = useState<string>('');
  const [reflections, setReflections] = useState('');
  const [ratings, setRatings] = useState<Record<string, number>>({});

  const [feedbackEvent, setFeedbackEvent] = useState('');
  const [feedbackRating, setFeedbackRating] = useState('4');
  const [feedbackText, setFeedbackText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStaffPerformanceHub();
      setData(res.data);
      const firstAppraisal = res.data.appraisals?.[0]?.name;
      if (firstAppraisal) setSelectedAppraisal(firstAppraisal);
      const firstEvent = res.data.training_events?.[0]?.name;
      if (firstEvent) setFeedbackEvent(firstEvent);
      const app = res.data.appraisals?.[0];
      if (app?.reflections) setReflections(app.reflections);
      const initial: Record<string, number> = {};
      for (const row of app?.self_ratings || []) {
        if (row.criteria) initial[row.criteria] = Number(row.rating || 0);
      }
      setRatings(initial);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function onSelectAppraisal(name: string) {
    setSelectedAppraisal(name);
    const app = data?.appraisals.find((a) => a.name === name);
    setReflections(app?.reflections || '');
    const initial: Record<string, number> = {};
    for (const row of app?.self_ratings || []) {
      if (row.criteria) initial[row.criteria] = Number(row.rating || 0);
    }
    setRatings(initial);
  }

  async function onAppraisalSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedAppraisal) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const criteria = data?.feedback_criteria || [];
      const ratingRows = criteria.map((c) => ({
        criteria: c.criteria || c.name,
        rating: ratings[c.criteria || c.name] || 0,
        per_weightage: 0,
      }));
      const res = await api.submitAppraisalSelfReview({
        appraisal: selectedAppraisal,
        reflections,
        ratings: ratingRows.filter((r) => r.rating > 0),
      });
      setMessage(res.message || 'Self review saved');
      if (res.data?.appraisal) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                appraisals: prev.appraisals.map((a) =>
                  a.name === res.data.appraisal.name ? res.data.appraisal : a,
                ),
              }
            : prev,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save self review');
    } finally {
      setSubmitting(false);
    }
  }

  async function onTrainingFeedbackSubmit(e: FormEvent) {
    e.preventDefault();
    if (!feedbackEvent) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.submitTrainingFeedback({
        training_event: feedbackEvent,
        rating: Number(feedbackRating),
        feedback: feedbackText,
      });
      setMessage(res.message || 'Feedback submitted');
      setFeedbackText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit feedback');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="muted">Loading training & performance…</p>;
  }

  if (!data?.performance_available) {
    return (
      <div className="card card-wide">
        <h1>Training & performance</h1>
        <p className="muted">
          HRMS training and appraisal modules are not fully installed yet. Ask admin to run Phase 74
          setup.
        </p>
        {data?.missing_modules?.length ? (
          <p className="muted">Missing: {data.missing_modules.join(', ')}</p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <h1>Training & performance</h1>
      <p className="muted">
        Employee {data.employee || '—'} · Programs, KRAs, and self-appraisal. Manager final ratings stay
        in Desk.
      </p>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <div className="toolbar" style={{ marginBottom: 16 }}>
        {(['training', 'kra', 'appraisal'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`btn ${tab === t ? '' : 'secondary'}`}
            onClick={() => setTab(t)}
          >
            {t === 'training' ? 'Training' : t === 'kra' ? 'My KRAs' : 'Appraisal'}
          </button>
        ))}
      </div>

      {tab === 'training' && (
        <div className="card card-wide">
          <h2>Training programs</h2>
          <ul className="plain-list">
            {(data.training_programs || []).map((p) => (
              <li key={p.name}>
                <strong>{p.training_program || p.name}</strong>
                {p.description ? <span className="muted"> — {p.description}</span> : null}
              </li>
            ))}
          </ul>

          <h2 style={{ marginTop: 24 }}>Scheduled events</h2>
          <TrainingEventsList events={data.training_events || []} />

          <h2 style={{ marginTop: 24 }}>Submit training feedback</h2>
          <form onSubmit={onTrainingFeedbackSubmit} className="stack-form">
            <label>
              Event
              <select
                value={feedbackEvent}
                onChange={(e) => setFeedbackEvent(e.target.value)}
                required
              >
                {(data.training_events || []).map((ev) => (
                  <option key={ev.name} value={ev.name}>
                    {ev.event_name || ev.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rating (1–5)
              <input
                type="number"
                min={1}
                max={5}
                step={0.5}
                value={feedbackRating}
                onChange={(e) => setFeedbackRating(e.target.value)}
              />
            </label>
            <label>
              Comments
              <textarea
                rows={3}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="What was useful? What should improve?"
              />
            </label>
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? 'Saving…' : 'Submit feedback'}
            </button>
          </form>
        </div>
      )}

      {tab === 'kra' && (
        <div className="card card-wide">
          <h2>My key result areas</h2>
          {(data.kras || []).length === 0 ? (
            <p className="muted">No KRAs assigned yet. An appraisal cycle may still be setting up.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>KRA</th>
                  <th>Weight %</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {data.kras.map((k) => (
                  <tr key={k.name}>
                    <td>
                      <strong>{k.title || k.name}</strong>
                      {k.description ? <div className="muted">{k.description}</div> : null}
                    </td>
                    <td>{k.weightage ?? '—'}</td>
                    <td>{k.score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'appraisal' && (
        <div className="card card-wide">
          <h2>Self appraisal</h2>
          {(data.appraisals || []).length === 0 ? (
            <p className="muted">No active appraisal for your profile yet.</p>
          ) : (
            <form onSubmit={onAppraisalSubmit} className="stack-form">
              <label>
                Appraisal cycle
                <select
                  value={selectedAppraisal}
                  onChange={(e) => onSelectAppraisal(e.target.value)}
                >
                  {data.appraisals.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.appraisal_cycle || a.name} ({a.appraisal_template || 'template'})
                    </option>
                  ))}
                </select>
              </label>

              <AppraisalSummary appraisal={data.appraisals.find((a) => a.name === selectedAppraisal)} />

              <label>
                Self reflection
                <textarea
                  rows={5}
                  value={reflections}
                  onChange={(e) => setReflections(e.target.value)}
                  placeholder="Achievements, challenges, support needed…"
                />
              </label>

              {(data.feedback_criteria || []).length > 0 && (
                <fieldset>
                  <legend>Rate yourself (1–5)</legend>
                  {data.feedback_criteria.map((c) => {
                    const key = c.criteria || c.name;
                    return (
                      <label key={c.name}>
                        {key}
                        <input
                          type="number"
                          min={0}
                          max={5}
                          step={0.5}
                          value={ratings[key] ?? ''}
                          onChange={(e) =>
                            setRatings((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                          }
                        />
                      </label>
                    );
                  })}
                </fieldset>
              )}

              <button type="submit" className="btn" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save self review'}
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );
}

function TrainingEventsList({ events }: { events: TrainingEventRow[] }) {
  if (!events.length) return <p className="muted">No training events scheduled.</p>;
  return (
    <ul className="plain-list">
      {events.map((ev) => (
        <li key={ev.name}>
          <strong>{ev.event_name || ev.name}</strong>
          <span className="muted">
            {' '}
            · {ev.event_status} · {ev.start_time ? new Date(ev.start_time).toLocaleString() : 'TBD'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AppraisalSummary({ appraisal }: { appraisal?: StaffAppraisalRow }) {
  if (!appraisal) return null;
  return (
    <div className="detail-list" style={{ marginBottom: 12 }}>
      <div>
        <dt>Template</dt>
        <dd>{appraisal.appraisal_template || '—'}</dd>
      </div>
      {appraisal.self_score != null && (
        <div>
          <dt>Self score</dt>
          <dd>{appraisal.self_score}</dd>
        </div>
      )}
    </div>
  );
}
