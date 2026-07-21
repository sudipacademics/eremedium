import { useState } from 'react';
import { api } from '../api';

type Props = {
  referenceDoctype: 'Customer TRF' | 'Pharmacy Order' | 'Doctor Appointment' | 'Health Subscription';
  referenceName: string;
  label?: string;
  className?: string;
  onSuccess?: () => void;
};

export function MarkOfflinePaymentButton({
  referenceDoctype,
  referenceName,
  label = 'Mark cash received',
  className = 'btn secondary btn-sm',
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onMark() {
    setLoading(true);
    setError(null);
    try {
      await api.markOfflinePaymentCollected(referenceDoctype, referenceName);
      onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record payment');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="report-download">
      <button className={className} type="button" disabled={loading} onClick={() => void onMark()}>
        {loading ? 'Saving…' : label}
      </button>
      {error && <p className="error error-inline">{error}</p>}
    </div>
  );
}
