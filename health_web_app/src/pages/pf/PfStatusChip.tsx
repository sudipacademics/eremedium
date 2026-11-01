import './pf.css';

type Tone = 'grey' | 'blue' | 'amber' | 'teal' | 'green' | 'red';

const TONES: Record<string, Tone> = {
  Uploaded: 'grey',
  'Under Review': 'grey',
  Quoted: 'blue',
  Broadcast: 'blue',
  Accepted: 'amber',
  'En Route': 'amber',
  Collected: 'teal',
  'Dropped At Hub': 'teal',
  'Received At Lab': 'green',
  Rejected: 'red',
  Cancelled: 'red',
  Expired: 'red',
};

export function PfStatusChip({ status }: { status: string }) {
  const tone = TONES[status] || 'grey';
  return <span className={`pf-chip pf-chip--${tone}`}>{status || '—'}</span>;
}
