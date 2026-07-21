import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { assetUrl } from '../config';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { CareJourney, JOURNEY_STEPS, JourneyLabResult } from '../types/journey';

function JourneyTimeline({ currentStatus }: { currentStatus: string }) {
  const currentIndex = JOURNEY_STEPS.indexOf(currentStatus as (typeof JOURNEY_STEPS)[number]);

  return (
    <ol className="journey-timeline">
      {JOURNEY_STEPS.map((step, index) => {
        const isDone = currentIndex >= 0 && index < currentIndex;
        const isCurrent = step === currentStatus;
        return (
          <li key={step} className={isCurrent ? 'current' : isDone ? 'done' : ''}>
            <span className="journey-dot" />
            <span>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ResultRow({ result }: { result: JourneyLabResult }) {
  const flag = result.abnormal_flag;
  return (
    <div className="result-row">
      <div>
        <strong>{result.analyte_test_name}</strong>
        <div className="muted">Ref: {result.reference_range || '—'}</div>
      </div>
      <div className={flag === 'H' || flag === 'L' ? 'result-abnormal' : ''}>
        {result.numeric_result_value ?? '—'} {result.unit_of_measure || ''}
        {flag ? ` (${flag})` : ''}
      </div>
    </div>
  );
}

function JourneyDetail({ journey }: { journey: CareJourney }) {
  const sections = journey.structured?.tests || [];
  const reportReady = journey.status === 'Authorized' || journey.status === 'Dispatched';

  return (
    <>
      <section className="card card-wide journey-header">
        <h2>{journey.patient_name}</h2>
        <p className="muted">Journey {journey.journey_id}</p>
        <span className="badge badge-lg">{journey.status}</span>
      </section>

      <section className="card card-wide">
        <h3>Care pipeline</h3>
        <JourneyTimeline currentStatus={journey.status} />
      </section>

      {(journey.trf_id || journey.prescription || journey.pharmacy_order) && (
        <section className="card card-wide">
          <h3>Linked records</h3>
          <dl className="detail-list">
            {journey.trf_id && (
              <div>
                <dt>Lab TRF</dt>
                <dd>
                  <Link to={`/bookings/${encodeURIComponent(journey.trf_id)}`}>{journey.trf_id}</Link>
                </dd>
              </div>
            )}
            {journey.prescription && (
              <div>
                <dt>Prescription</dt>
                <dd>{journey.prescription}</dd>
              </div>
            )}
            {journey.pharmacy_order && (
              <div>
                <dt>Pharmacy order</dt>
                <dd>{journey.pharmacy_order}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {sections.length > 0
        ? sections.map((section) => (
            <section key={section.test_name || section.test} className="card card-wide">
              <h3>{section.test_name || section.test}</h3>
              {(section.parameters || []).length === 0 ? (
                <p className="muted">Awaiting results</p>
              ) : (
                (section.parameters || []).map((r, i) => <ResultRow key={i} result={r} />)
              )}
            </section>
          ))
        : (journey.results || []).length > 0 && (
            <section className="card card-wide">
              <h3>Lab results</h3>
              {(journey.results || []).map((r, i) => (
                <ResultRow key={i} result={r} />
              ))}
            </section>
          )}

      {reportReady && journey.report_pdf && (
        <a className="btn" href={assetUrl(journey.report_pdf)} target="_blank" rel="noreferrer">
          Download authorized report
        </a>
      )}
    </>
  );
}

export function JourneyPage() {
  const [journeys, setJourneys] = useState<CareJourney[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPatientJourneys();
      const list = res.data.journeys || [];
      setJourneys(list);
      setSelectedId((prev) => {
        if (prev && list.some((j) => j.journey_id === prev)) return prev;
        return list[0]?.journey_id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load care journeys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load, 15000);

  const selected = journeys.find((j) => j.journey_id === selectedId) ?? null;

  if (loading && journeys.length === 0) {
    return <p className="muted">Loading care journeys…</p>;
  }

  if (error) {
    return (
      <>
        <div className="error">{error}</div>
        <button className="btn secondary" type="button" onClick={() => void load()}>
          Retry
        </button>
      </>
    );
  }

  if (journeys.length === 0) {
    return (
      <section className="card card-wide">
        <h1>My care journeys</h1>
        <p className="muted">No care journeys linked to your account yet.</p>
        <div className="toolbar" style={{ marginTop: 16 }}>
          <Link className="btn" to="/appointments/book">
            Book doctor
          </Link>
          <Link className="btn secondary" to="/lab">
            Book lab test
          </Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>My care journeys</h1>
          <p className="muted">Live from ERPNext — refreshes every 15s</p>
        </div>
        <button className="btn secondary btn-sm" type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      <section className="card card-wide">
        <h3>Your journeys</h3>
        <div className="journey-picker">
          {journeys.map((j) => (
            <button
              key={j.journey_id}
              type="button"
              className={`journey-pick ${selectedId === j.journey_id ? 'active' : ''}`}
              onClick={() => setSelectedId(j.journey_id)}
            >
              <strong>{j.patient_name}</strong>
              <span className="muted">{j.journey_id}</span>
              <span className="badge">{j.status}</span>
            </button>
          ))}
        </div>
      </section>

      {selected && <JourneyDetail journey={selected} />}
    </>
  );
}
