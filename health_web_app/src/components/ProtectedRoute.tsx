import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasAnyRole } from '../auth/roles';

type Props = {
  children: React.ReactNode;
  roles?: string[];
  fallback?: string;
};

export function ProtectedRoute({ children, roles, fallback = '/login' }: Props) {
  const { isAuthenticated, loading, user, defaultRoute } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="page-center">
        <p className="muted">Checking session…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={fallback} replace state={{ from: location.pathname }} />;
  }

  if (roles && roles.length > 0 && user && !hasAnyRole(user.roles || [], roles)) {
    return <Navigate to={defaultRoute} replace />;
  }

  return <>{children}</>;
}
