import { useState } from 'react';
import { api, VoiceLeadCall } from '../api';

type Props = {
  leadDoctype: 'Franchise Sales Lead' | 'HEC Hiring Lead' | 'B2B Collection Centre' | 'Health Patient';
  leadName: string;
  label?: string;
};

function when(value?: string | null) {
  if (!value) return '';
  const d = new Date(value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function AiCallButton({ leadDoctype, leadName, label = 'Call with AI' }: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<VoiceLeadCall[] | null>(null);
  const [open, setOpen] = useState(false);

  async function start() {
    if (!window.confirm('Start an AI voice call to this lead now? The AI introduces itself and the call is recorded.')) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await api.startAiCallForLead(leadDoctype, leadName);
      setNote({ ok: true, text: res.data.dry_run ? 'Dry run queued' : 'AI call started' });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Could not start the call' });
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory() {
    const next = !open;
    setOpen(next);
    if (next && history === null) {
      try {
        const res = await api.getLeadCallHistory(leadDoctype, leadName);
        setHistory(res.data.calls || []);
      } catch {
        setHistory([]);
      }
    }
  }

  return (
    <div className="ai-call-cell">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="reach-btn secondary" disabled={busy} onClick={() => void start()}>
          {busy ? 'Starting…' : label}
        </button>
        <button type="button" className="btn-link" onClick={() => void toggleHistory()}>
          {open ? 'Hide calls' : 'AI calls'}
        </button>
      </div>
      {note ? <div className={`sub ${note.ok ? 'ok' : 'err'}`}>{note.text}</div> : null}
      {open ? (
        <ul className="ai-call-history">
          {history === null ? <li className="sub">Loading…</li> : null}
          {history && !history.length ? <li className="sub">No AI calls yet</li> : null}
          {(history || []).map((c) => (
            <li key={c.name}>
              <b>{when(c.creation)}</b> · {c.direction} · {c.status}
              {c.lead_temperature ? ` · ${c.lead_temperature}` : ''}
              {c.meeting_ref ? ' · meeting booked' : ''}
              {c.summary ? <div className="sub">{c.summary.split('\n')[0].replace(/^-\s*/, '')}</div> : null}
              {c.follow_up_at ? <div className="sub">Follow-up {when(c.follow_up_at)}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
