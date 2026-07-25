import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isHiringMarketer, isHrRecruiter } from '../auth/roles';

export function CareersHrLayout() {
  const { user, logout } = useAuth();

  if (!user || !isHiringMarketer(user.roles)) {
    return (
      <div className="page">
        <div className="card card-wide">
          <h1>HR recruitment</h1>
          <p>HR Manager, System Administrator, or sales leadership login required.</p>
          <Link className="btn" to="/login">
            Login
          </Link>
        </div>
      </div>
    );
  }

  const hr = isHrRecruiter(user.roles);

  return (
    <div className="page careers-hr-layout">
      <aside className="careers-hr-sidebar">
        <Link to="/careers" className="careers-brand compact">
          <strong>REMEDIUM</strong>
          <small>Hiring hub</small>
        </Link>
        <nav aria-label="HR">
          <NavLink to="/hr/marketing">Overview</NavLink>
          {hr ? <NavLink to="/hr/applications">Applications</NavLink> : null}
          <NavLink to="/jobs">Job Openings</NavLink>
          <NavLink to="/careers">Career page</NavLink>
        </nav>
        <div className="careers-hr-user">
          <p>{user.fullName || user.user}</p>
          <button type="button" className="btn-link" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>
      <main className="careers-hr-main">
        <Outlet />
      </main>
    </div>
  );
}
