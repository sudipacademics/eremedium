import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ReportChromeTemplate, ReportWhatsAppResult } from '../types/reportLifecycle';
import './ReportDispatchActions.css';

const DOWNLOAD_OPTIONS: Array<{ id: ReportChromeTemplate; label: string; hint: string }> = [
  { id: 'nabl', label: 'With NABL Header', hint: 'NABL letterhead and approved footer' },
  { id: 'non_nabl', label: 'With Non-NABL Header', hint: 'Non-NABL letterhead and approved footer' },
  { id: 'none', label: 'Without Header/Footer', hint: 'Results only — no letterhead, branding, or disclaimer' },
];

type Props = {
  journeyId: string;
  trfId?: string | null;
  compact?: boolean;
  className?: string;
};

type JobState = 'idle' | 'loading' | 'success' | 'error';

export function ReportDispatchActions({ journeyId, trfId, compact, className }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [waState, setWaState] = useState<JobState>('idle');
  const [waMessage, setWaMessage] = useState<string | null>(null);
  const [pdfState, setPdfState] = useState<Record<ReportChromeTemplate, JobState>>({
    nabl: 'idle',
    non_nabl: 'idle',
    none: 'idle',
  });
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [lastWa, setLastWa] = useState<ReportWhatsAppResult | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  async function sendWhatsApp() {
    setWaState('loading');
    setWaMessage(null);
    try {
      const res = await api.sendAuthorizedReportWhatsApp(journeyId);
      const data = res.data;
      setLastWa(data);
      setWaState('success');
      const created = data.portal_account_created
        ? ' A new Patient Portal account was created for this mobile.'
        : ' The existing Patient Portal account will be used.';
      setWaMessage(`Sent to ${data.recipient || 'registered mobile'}.${created}`);
    } catch (e) {
      setWaState('error');
      const raw = e instanceof Error ? e.message : 'WhatsApp delivery failed. You can retry.';
      const lower = raw.toLowerCase();
      const friendly =
        lower.includes('unknown column') || lower.includes('(1054')
          ? 'Could not look up the patient’s mobile number. Please retry.'
          : raw;
      setWaMessage(friendly);
    }
  }

  async function download(template: ReportChromeTemplate) {
    setPdfError(null);
    setPdfState((cur) => ({ ...cur, [template]: 'loading' }));
    const fileName = `Lab_Report_${trfId || journeyId}_${template}.pdf`;
    try {
      await api.downloadAuthorizedReport(journeyId, template, fileName);
      setPdfState((cur) => ({ ...cur, [template]: 'success' }));
      setMenuOpen(false);
    } catch (e) {
      setPdfState((cur) => ({ ...cur, [template]: 'error' }));
      setPdfError(e instanceof Error ? e.message : 'PDF generation failed');
    }
  }

  const pdfBusy = Object.values(pdfState).some((s) => s === 'loading');

  return (
    <div ref={rootRef} className={`rd-actions${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}>
      <div className="rd-row">
        <button
          type="button"
          className="lt-action rd-wa"
          disabled={waState === 'loading'}
          onClick={() => void sendWhatsApp()}
        >
          {waState === 'loading' ? 'Sending…' : waState === 'error' ? 'Retry WhatsApp' : 'Send to WhatsApp'}
        </button>
        <div className="rd-download">
          <button
            type="button"
            className="lt-action is-ghost"
            disabled={pdfBusy}
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            {pdfBusy ? 'Generating…' : 'Download Report ▾'}
          </button>
          {menuOpen ? (
            <div className="rd-menu" role="menu">
              {DOWNLOAD_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="menuitem"
                  disabled={pdfBusy}
                  onClick={() => void download(opt.id)}
                >
                  <strong>
                    {pdfState[opt.id] === 'loading'
                      ? 'Generating…'
                      : pdfState[opt.id] === 'error'
                        ? `Retry — ${opt.label}`
                        : opt.label}
                  </strong>
                  <span>{opt.hint}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {waState === 'success' && waMessage ? <p className="rd-note is-ok">{waMessage}</p> : null}
      {waState === 'error' && waMessage ? (
        <p className="rd-note is-err">
          {waMessage}{' '}
          <button type="button" className="rd-retry" onClick={() => void sendWhatsApp()}>
            Retry
          </button>
        </p>
      ) : null}
      {pdfError ? (
        <p className="rd-note is-err">
          {pdfError}{' '}
          <button type="button" className="rd-retry" onClick={() => setMenuOpen(true)}>
            Retry
          </button>
        </p>
      ) : null}
      {lastWa?.portal_url && waState === 'success' ? (
        <p className="rd-note">Patient opens Reports after OTP login — no public file is sent.</p>
      ) : null}
    </div>
  );
}
