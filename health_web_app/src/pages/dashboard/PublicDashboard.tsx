import { Navigate } from 'react-router-dom';

/** Legacy patient dashboard — redirect to consumer Update Profile. */
export function PublicDashboard() {
  return <Navigate to="/account/profile" replace />;
}
