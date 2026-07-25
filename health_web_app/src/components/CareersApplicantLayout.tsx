import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isHrRecruiter } from '../auth/roles';

export function CareersApplicantLayout() {
  const { user, logout, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) {
    return (
      <div className="page">
        <div className="card card-wide">
          <h1>My Application</h1>
          <p>Sign in with mobile OTP to view your applications, profile, and documents.</p>
          <Link className="btn" to="/login" state={{ from: '/my' }}>
            Sign in
          </Link>
          <Link className="btn secondary" to="/careers" style={{ marginLeft: 8 }}>
            Careers home
          </Link>
        </div>
      </div>
    );
  }

  if (isHrRecruiter(user.roles)) {
    return (
      <div className="page">
        <div className="card card-wide">
          <h1>HR account</h1>
          <p>You are signed in as HR. Use the recruitment desk instead.</p>
          <Link className="btn" to="/hr/applications">
            Open applications
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page careers-applicant-layout">
      <aside className="careers-applicant-sidebar">
        <Link to="/careers" className="careers-brand compact">
          <strong>REMEDIUM</strong>
          <small>Applicant portal</small>
        </Link>
        <div className="careers-applicant-user">
          <strong>{user.fullName || user.user}</strong>
          <span className="muted">{user.user}</span>
        </div>
        <nav aria-label="My career">
          <NavLink to="/my" end>
            Dashboard
          </NavLink>
          <NavLink to="/my/applications">Applied Jobs</NavLink>
          <NavLink to="/my/profile">Profile</NavLink>
          <NavLink to="/my/documents">Documents</NavLink>
          <NavLink to="/jobs">Job Openings</NavLink>
        </nav>
        <button type="button" className="btn-link" onClick={logout}>
          Logout
        </button>
      </aside>
      <main className="careers-applicant-main">
        <Outlet />
      </main>
    </div>
  );
}
