import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isPatientPortal } from '../auth/roles';

/** Blocks staff / franchisee / phlebotomist from patient booking pages (services, orders, pharmacy, etc.). */
export function PatientPortalGate() {
  const { user, defaultRoute, loading } = useAuth();

  if (loading) {
    return (
      <div className="page-center">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (user && !isPatientPortal(user.roles)) {
    return <Navigate to={defaultRoute} replace />;
  }

  return <Outlet />;
}
