import { useState } from 'react';
import { api, CollectionMode } from '../api';

export type OfflinePaymentResult = Awaited<ReturnType<typeof api.markOfflinePaymentCollected>>['data'];

type Props = {
  referenceDoctype: 'Customer TRF' | 'Pharmacy Order' | 'Doctor Appointment' | 'Health Subscription';
  referenceName: string;
  label?: string;
  className?: string;
  onSuccess?: (result: OfflinePaymentResult) => void;
};

const REFERENCE_PLACEHOLDER: Record<CollectionMode, string> = {
  cash: '',
  upi: 'UPI UTR / RRN (optional)',
  card: 'Card approval code (optional)',
  cheque: 'Cheque number',
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
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<CollectionMode>('cash');
  const [reference, setReference] = useState('');

  async function onMark() {
    if (mode === 'cheque' && !reference.trim()) {
      setError('Enter the cheque number');
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.markOfflinePaymentCollected(referenceDoctype, referenceName, mode, mode === 'cash' ? '' : reference.trim());
      if (result.data?.hub_billing?.status === 'pending') {
        setNotice('Payment recorded. The platform fee could not be taken from the hub wallet yet; it will be charged automatically after the wallet is recharged.');
      }
      onSuccess?.(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record payment');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="report-download">
      <select value={mode} disabled={loading} onChange={(e) => setMode(e.target.value as CollectionMode)} aria-label="Collected via">
        <option value="cash">Cash</option>
        <option value="upi">UPI</option>
        <option value="card">Card</option>
        <option value="cheque">Cheque</option>
      </select>
      {mode !== 'cash' ? (
        <input
          type="text"
          value={reference}
          disabled={loading}
          placeholder={REFERENCE_PLACEHOLDER[mode]}
          onChange={(e) => setReference(e.target.value)}
          style={{ maxWidth: 190 }}
        />
      ) : null}
      <button className={className} type="button" disabled={loading} onClick={() => void onMark()}>
        {loading ? 'Saving…' : label}
      </button>
      {error && <p className="error error-inline">{error}</p>}
      {notice && <p className="muted">{notice}</p>}
    </div>
  );
}
