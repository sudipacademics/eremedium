import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { isFranchisee, isPfCustomer } from '../../auth/roles';
import '../b2b/b2b-portal.css';
import '../b2b/partner-portal-v2.css';
import './pf.css';

export function PfLayout() {
  const { user, logout, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="page-center">
        <p className="muted">Checking session…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (isFranchisee(user.roles) && !isPfCustomer(user.roles)) {
    return <Navigate to="/b2b/phlebofirst" replace />;
  }

  if (!isPfCustomer(user.roles)) {
    return (
      <div className="partners-shell pp2-shell">
        <div className="partners-body">
          <div className="partners-order-card">
            <h1 className="partners-page-title">PhleboFirst</h1>
            <p className="partners-page-lead">PhleboFirst customer login required.</p>
            <Link className="partners-btn partners-btn-primary" to="/login">
              Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const initial = (user.fullName || user.full_name || user.user || 'P').trim().charAt(0).toUpperCase();

  return (
    <div className="partners-shell pp2-shell pf-shell">
      <header className="partners-topbar">
        <div className="partners-topbar-inner">
          <Link to="/pf" className="partners-brand">
            Remedium <span className="pf-brand-sub">PhleboFirst</span>
          </Link>
          <nav className="partners-top-actions" aria-label="PhleboFirst">
            <NavLink end className="partners-top-link" to="/pf">
              My requests
            </NavLink>
            <NavLink className="partners-top-link" to="/pf/new">
              New request
            </NavLink>
            <span className="partners-avatar" aria-hidden title={user.fullName || user.user}>
              {initial}
            </span>
            <button type="button" className="partners-logout" onClick={logout}>
              Logout
            </button>
          </nav>
        </div>
      </header>
      <div className="partners-body">
        <main className="partners-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
