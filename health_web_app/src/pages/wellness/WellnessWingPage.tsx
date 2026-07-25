import { useParams } from 'react-router-dom';
import { WellnessClinicLandingPage } from './WellnessClinicLandingPage';

/** All wellness wings use the Oliva-style clinic landing. */
export function WellnessWingPage() {
  const { wingId = '' } = useParams();
  return <WellnessClinicLandingPage wingId={wingId} />;
}
