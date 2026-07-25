import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isHrRecruiter } from '../auth/roles';

export function CareersLayout() {
  const { isAuthenticated, user, logout } = useAuth();
  const hr = Boolean(user && isHrRecruiter(user.roles));

  return (
    <div className="careers-shell">
      <header className="careers-topnav">
        <Link to="/careers" className="careers-brand">
          <span className="careers-brand-mark" aria-hidden />
          <span>
            <strong>REMEDIUM</strong>
            <small>a unit of smilecure lifestyle Pvt. Ltd</small>
          </span>
        </Link>
        <nav className="careers-nav" aria-label="Careers">
          <NavLink to="/careers" end>
            Home
          </NavLink>
          <NavLink to="/jobs">Job Openings</NavLink>
          <a href="#why-remedium">Why Remedium?</a>
          {hr ? <NavLink to="/hr/applications">HR Desk</NavLink> : null}
          {isAuthenticated && !hr ? <NavLink to="/my">My Application</NavLink> : null}
          {isAuthenticated ? (
            <button type="button" className="btn-link" onClick={logout}>
              Logout
            </button>
          ) : (
            <Link className="btn secondary btn-sm" to="/login" state={{ from: '/my' }}>
              Login
            </Link>
          )}
          <Link className="btn btn-sm" to="/jobs">
            Apply Now
          </Link>
        </nav>
      </header>
      <main className="careers-main">
        <Outlet />
      </main>
      <footer className="careers-footer">
        <p>© {new Date().getFullYear()} Remedium. Transparency, Accuracy &amp; Speed — Our promise to you.</p>
        <nav className="careers-footer-links" aria-label="Legal">
          <Link to="/legal/privacy-policy">Privacy</Link>
          <Link to="/legal/disclaimer">Disclaimer</Link>
          <Link to="/legal/terms-and-conditions">Terms</Link>
          <Link to="/legal/refund-policy">Refunds</Link>
          <Link to="/legal/data-use-policy">Data Use</Link>
        </nav>
      </footer>
    </div>
  );
}
