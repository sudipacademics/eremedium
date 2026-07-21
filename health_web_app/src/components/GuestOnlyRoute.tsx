import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isProvider } from '../auth/roles';

/** Provider application is only for guests — logged-in patients must not see it. */
export function GuestOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="page-center">
        <p className="muted">Checking session…</p>
      </div>
    );
  }

  if (isAuthenticated && user) {
    if (isProvider(user.roles)) {
      return <Navigate to="/dashboard/provider" replace />;
    }
    return <Navigate to="/account" replace />;
  }

  return <>{children}</>;
}
