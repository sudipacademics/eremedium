import { useState } from 'react';
import { api } from '../api';

type Props = {
  journeyId: string;
  fileName?: string;
  label?: string;
  className?: string;
};

export function ReportDownloadButton({
  journeyId,
  fileName,
  label = 'Download authorized report (PDF)',
  className = 'btn',
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDownload() {
    setLoading(true);
    setError(null);
    try {
      await api.downloadJourneyReport(journeyId, fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="report-download">
      <button className={className} type="button" disabled={loading} onClick={() => void onDownload()}>
        {loading ? 'Downloading…' : label}
      </button>
      {error && <p className="error error-inline">{error}</p>}
    </div>
  );
}
