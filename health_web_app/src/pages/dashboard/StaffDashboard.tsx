import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { BookingsTable } from './BookingsTable';

export function StaffDashboard() {
  const [ops, setOps] = useState({
    provider_applications_pending: 0,
    insurance_quotes_pending: 0,
    teleconsults_upcoming: 0,
  });

  useEffect(() => {
    void api
      .getOpsHubSummary()
      .then((res) => setOps(res.data))
      .catch(() => undefined);
  }, []);

  return (
    <>
      <section className="hero hero-compact">
        <h1>Operations overview</h1>
        <p>TRFs and bookings scoped to your role — ERPNext runs in the background.</p>
      </section>

      <div className="grid grid-actions">
        <Link className="card card-action" to="/bookings">
          <h3>All bookings</h3>
          <p className="muted">Lab TRFs and order status.</p>
        </Link>
        <Link className="card card-action" to="/dashboard/reagents">
          <h3>Reagent batches</h3>
          <p className="muted">Open packs, track quotas, low-stock alerts.</p>
        </Link>
        <Link className="card card-action" to="/dashboard/journeys">
          <h3>Care journey queue</h3>
          <p className="muted">Live patient pipeline — advance and assign phlebotomists.</p>
        </Link>
        <Link className="card card-action" to="/dashboard/lab-reports">
          <h3>Lab result entry</h3>
          <p className="muted">Enter results, finalize, and send for pathologist review.</p>
        </Link>
        <Link className="card card-action" to="/dashboard/report-lifecycle">
          <h3>Report lifecycle</h3>
          <p className="muted">Authorize, notify patient, and dispatch NABL reports.</p>
        </Link>
        <Link className="card card-action" to="/dashboard/pharmacy-quotes">
          <h3>Pharmacy quotes</h3>
          <p className="muted">Price chronic pack requests and send quotes to patients.</p>
        </Link>
        <Link className="card card-action" to="/dashboard/provider-applications">
          <h3>Provider applications</h3>
          <p className="muted">
            Review doctor / wellness sign-ups
            {ops.provider_applications_pending ? ` · ${ops.provider_applications_pending} pending` : ''}.
          </p>
        </Link>
        <Link className="card card-action" to="/dashboard/insurance-quotes">
          <h3>Insurance leads</h3>
          <p className="muted">
            GIC / LIC quote follow-ups
            {ops.insurance_quotes_pending ? ` · ${ops.insurance_quotes_pending} open` : ''}.
          </p>
        </Link>
        <Link className="card card-action" to="/dashboard/teleconsults">
          <h3>Teleconsults</h3>
          <p className="muted">
            Upcoming online sessions
            {ops.teleconsults_upcoming ? ` · ${ops.teleconsults_upcoming} scheduled` : ''}.
          </p>
        </Link>
        <Link className="card card-action" to="/dashboard/session-ops">
          <h3>Wellness sessions</h3>
          <p className="muted">Physio & aesthetic card punches and yoga/video rooms.</p>
        </Link>
      </div>

      <BookingsTable title="Recent TRFs (staff scope)" />
    </>
  );
}
