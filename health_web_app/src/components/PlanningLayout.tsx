import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isHrRecruiter } from '../auth/roles';
import '../pages/planning/planning-portal.css';

export function PlanningLayout() {
  const { user, logout } = useAuth();

  if (!user || !isHrRecruiter(user.roles)) {
    return (
      <div className="page planning-shell">
        <div className="planning-gate">
          <h1>Staff planning</h1>
          <p>HR Manager / Admin login required.</p>
          <Link className="btn" to="/login">
            Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page planning-shell">
      <header className="planning-header">
        <div>
          <Link to="/planning" className="planning-brand">
            Planning
          </Link>
          <p className="planning-sub">Workforce · KPI / KRA · market CTC · Careers publish</p>
        </div>
        <nav className="planning-nav" aria-label="Staff planning">
          <NavLink to="/planning" end>
            Dashboard
          </NavLink>
          <NavLink to="/planning/new">New plan</NavLink>
          <a href="https://www.e-remedium.in/jobs" target="_blank" rel="noreferrer">
            Careers jobs
          </a>
          <a href="https://erp.e-remedium.in/app" target="_blank" rel="noreferrer">
            ERP Desk
          </a>
          <button type="button" className="btn-link" onClick={logout}>
            Logout
          </button>
        </nav>
      </header>
      <main className="planning-main">
        <Outlet />
      </main>
    </div>
  );
}
