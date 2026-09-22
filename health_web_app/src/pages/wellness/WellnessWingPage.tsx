import { Navigate, useParams } from 'react-router-dom';
import { WellnessClinicLandingPage } from './WellnessClinicLandingPage';

/** All wellness wings use the clinic landing; physio permanently redirects to Remedium Care. */
export function WellnessWingPage() {
  const { wingId = '' } = useParams();
  if (wingId.toLowerCase() === 'physiotherapy') {
    return <Navigate to="/wellness/care" replace />;
  }
  return <WellnessClinicLandingPage wingId={wingId} />;
}
