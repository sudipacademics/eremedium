import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

export function PublicDashboard() {
  const { user } = useAuth();

  return (
    <>
      <section className="hero hero-compact">
        <h1>Welcome{user?.fullName ? `, ${user.fullName}` : ''}</h1>
        <p>Book doctor visits, diagnostics, and medicines — track everything under My orders.</p>
      </section>
      <div className="grid grid-actions">
        <Link className="card card-action" to="/appointments/book">
          <h3>Book doctor</h3>
          <p className="muted">Choose practitioner, date, and time slot.</p>
        </Link>
        <Link className="card card-action" to="/diagnostics">
          <h3>Book diagnostics</h3>
          <p className="muted">Lab tests and health packages with home collection.</p>
        </Link>
        <Link className="card card-action" to="/pharmacy">
          <h3>Order medicines</h3>
          <p className="muted">Browse pharmacy — prescription upload at checkout.</p>
        </Link>
        <Link className="card card-action" to="/bookings">
          <h3>My orders</h3>
          <p className="muted">Appointments, diagnostics TRFs, and pharmacy orders.</p>
        </Link>
      </div>
    </>
  );
}
