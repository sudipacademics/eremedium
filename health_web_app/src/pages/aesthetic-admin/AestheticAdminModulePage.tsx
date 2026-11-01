import { Link, useLocation, useParams } from 'react-router-dom';
import { AdminIcon } from './AestheticAdminIcons';
import { AESTHETIC_ADMIN_NAV } from './aestheticAdminNav';
import { RECENT_BOOKINGS } from './aestheticAdminData';
import { paymentTone, statusTone } from './aestheticAdminData';
import './aesthetic-admin.css';

function titleForPath(pathname: string) {
  for (const g of AESTHETIC_ADMIN_NAV) {
    if (g.to === pathname) return g.label;
    const hit = g.items?.find((i) => i.to === pathname);
    if (hit) return hit.label;
  }
  if (pathname.includes('/bookings/')) return 'Booking detail';
  return 'Module';
}

export function AestheticAdminModulePage() {
  const location = useLocation();
  const { bookingId } = useParams();
  const title = bookingId ? `Booking ${bookingId}` : titleForPath(location.pathname);
  const isBookingsList = location.pathname === '/aesthetic-admin/bookings';
  const q = new URLSearchParams(location.search).get('q')?.trim().toLowerCase() || '';

  const rows = isBookingsList
    ? RECENT_BOOKINGS.filter((r) => {
        if (!q) return true;
        return `${r.id} ${r.customer} ${r.phone} ${r.service} ${r.branch}`.toLowerCase().includes(q);
      })
    : [];

  return (
    <div className="aea-module">
      <div className="aea-page-head">
        <div>
          <h1>{title}</h1>
          <p>
            {isBookingsList
              ? 'Manage clinic appointments across branches.'
              : 'This module UI is ready for backend wiring — navigation and layout match the Aesthetic console.'}
          </p>
        </div>
        {location.pathname.includes('/new') || location.pathname.includes('/walk-in') ? (
          <Link to="/aesthetic-admin/bookings" className="aea-btn">
            Back to bookings
          </Link>
        ) : null}
      </div>

      {isBookingsList ? (
        <article className="aea-card">
          <header>
            <h2>All Bookings{q ? ` · “${q}”` : ''}</h2>
            <Link to="/aesthetic-admin/bookings/new" className="aea-btn">
              <AdminIcon name="calendar" size={15} /> New Booking
            </Link>
          </header>
          <div className="aea-table-wrap">
            <table className="aea-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date &amp; Time</th>
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Branch</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <code>{row.id}</code>
                    </td>
                    <td>{row.datetime}</td>
                    <td>
                      <div className="aea-person">
                        <b>{row.customer}</b>
                        <small>{row.phone}</small>
                      </div>
                    </td>
                    <td>{row.service}</td>
                    <td>{row.branch}</td>
                    <td>
                      <span className={`aea-pill ${statusTone(row.status)}`}>{row.status}</span>
                    </td>
                    <td>
                      <span className={`aea-pill ${paymentTone(row.payment)}`}>{row.payment}</span>
                    </td>
                    <td>
                      <Link to={`/aesthetic-admin/bookings/${encodeURIComponent(row.id)}`} className="aea-mini-btn">
                        <AdminIcon name="eye" size={14} /> View
                      </Link>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={8} className="aea-empty">
                      No bookings match this search.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      ) : (
        <article className="aea-card aea-placeholder-card">
          <div className="aea-placeholder-icon">
            <AdminIcon name="sparkle" size={28} />
          </div>
          <h2>{title}</h2>
          <p>
            Screens for this area will connect to live aesthetic bookings, inventory, machines, and invoices. Use the
            sidebar to move around the console — the Dashboard already shows the full management overview.
          </p>
          <div className="aea-placeholder-actions">
            <Link to="/aesthetic-admin" className="aea-btn">
              Back to Dashboard
            </Link>
            <a href="https://remediumaesthetics.in" className="aea-btn ghost">
              Public Aesthetic site
            </a>
          </div>
        </article>
      )}
    </div>
  );
}
