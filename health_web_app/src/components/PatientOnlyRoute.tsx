import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isPatientPortal } from '../auth/roles';

type Props = {
  children: React.ReactNode;
};

/** Keeps the patient booking dashboard off staff / franchisee / phlebotomist accounts. */
export function PatientOnlyRoute({ children }: Props) {
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

  return <>{children}</>;
}
