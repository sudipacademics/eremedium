import { Navigate } from 'react-router-dom';
import { loadWalkInDraft } from '../../utils/walkInDraft';

/** Legacy route — unified walk-in flow lives on /b2b/order */
export function HubLabBillPage() {
  const draft = loadWalkInDraft();
  return <Navigate to={draft ? '/b2b/order?step=2' : '/b2b/order'} replace />;
}
