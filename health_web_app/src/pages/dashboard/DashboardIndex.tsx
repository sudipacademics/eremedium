import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

export function DashboardIndex() {
  const { defaultRoute, loading } = useAuth();

  if (loading) {
    return (
      <div className="page-center">
        <p className="muted">Loading dashboard…</p>
      </div>
    );
  }

  return <Navigate to={defaultRoute} replace />;
}
