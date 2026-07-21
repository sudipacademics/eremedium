import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getDefaultDashboardRoute, isFranchisee, isPhlebotomist, isStaff } from '../auth/roles';

/** Patient booking dashboard — not for staff, franchisee, or phlebotomist roles. */
export function PatientOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, defaultRoute } = useAuth();
  const roles = user?.roles ?? [];

  if (isStaff(roles) || isFranchisee(roles) || isPhlebotomist(roles)) {
    return <Navigate to={defaultRoute || getDefaultDashboardRoute(roles)} replace />;
  }

  return <>{children}</>;
}
