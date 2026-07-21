import { Navigate } from 'react-router-dom';
import { isPatientPortalHost } from '../config/portalHosts';

type Props = {
  children: React.ReactNode;
};

/** Sign-up and public self-registration only on www patient portal. */
export function PatientHostOnly({ children }: Props) {
  if (!isPatientPortalHost()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
