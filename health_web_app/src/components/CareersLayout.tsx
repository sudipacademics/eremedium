import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isHrRecruiter } from '../auth/roles';
import { StructuredData } from './StructuredData';

export function CareersLayout() {
  const { isAuthenticated, user, logout } = useAuth();
  const hr = Boolean(user && isHrRecruiter(user.roles));

  return (
    <div className="careers-shell">
      <StructuredData pageUrl="https://career.e-remedium.in/" />
      <header className="careers-topnav">
        <Link to="/careers" className="careers-brand">
          <span className="careers-brand-mark" aria-hidden>
            R
          </span>
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
          <a href="/careers#why-remedium">Why Remedium?</a>
          <a href="/careers#life-at-remedium">Life at Remedium</a>
          <a href="/careers#contact">Contact Us</a>
          {hr ? <NavLink to="/people/recruitment">Hiring desk</NavLink> : null}
        </nav>
        <div className="careers-topnav-actions">
          {isAuthenticated ? (
            <button type="button" className="careers-btn-outline" onClick={logout}>
              Logout
            </button>
          ) : (
            <Link className="careers-btn-outline" to="/hr/login">
              HR login
            </Link>
          )}
          <Link className="careers-btn-solid" to="/jobs">
            Apply Now
          </Link>
        </div>
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
