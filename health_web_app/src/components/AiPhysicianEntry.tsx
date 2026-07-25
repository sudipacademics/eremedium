import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AiPhysicianSuggestions, AiPhysicianTurn } from '../api';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

type Props = {
  placeholder?: string;
};

function SuggestionCards({
  suggestions,
  emergency,
}: {
  suggestions: AiPhysicianSuggestions;
  emergency?: boolean;
}) {
  const packages = suggestions.health_packages || [];
  const tests = suggestions.individual_tests || [];
  const workup =
    packages.length || tests.length
      ? [...packages, ...tests]
      : suggestions.diagnostic_workup || [];

  return (
    <div className={`ai-suggest-grid ${emergency ? 'ai-suggest-emergency' : ''}`}>
      {emergency ? (
        <p className="ai-emergency-banner">
          Urgent care may be needed — use the options below or go to the nearest emergency facility.
        </p>
      ) : null}

      {workup.length ? (
        <section className="ai-suggest-block">
          <h3>{packages.length ? 'Packages & tests' : 'Diagnostic workup'}</h3>
          <div className="ai-suggest-cards">
            {workup.map((item) => (
              <article key={item.item_code || item.panel_id || item.item_name} className="ai-suggest-card">
                <strong>{item.item_name}</strong>
                {item.probability_label ? (
                  <span className="ai-match">{item.probability_label}</span>
                ) : null}
                {item.rate != null ? <span className="price-sale">₹{Number(item.rate).toFixed(0)}</span> : null}
                {item.mrp && item.mrp > (item.rate || 0) ? (
                  <span className="price-mrp">MRP ₹{Number(item.mrp).toFixed(0)}</span>
                ) : null}
                <p className="muted">{item.reason}</p>
                <Link className="btn btn-sm" to={item.book_path || '/diagnostics'}>
                  Book
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="ai-suggest-block">
        <h3>Physician / service booking</h3>
        <div className="ai-suggest-cards">
          {(suggestions.physician_services || []).map((svc, i) => (
            <article key={`${svc.service}-${i}`} className="ai-suggest-card">
              <strong>{svc.service}</strong>
              <span className="muted">{svc.department}</span>
              <p className="muted">{svc.reason}</p>
              <Link className="btn btn-sm secondary" to={svc.book_path || '/appointments/book'}>
                Book
              </Link>
            </article>
          ))}
          {!suggestions.physician_services?.length ? (
            <p className="muted">No matching services right now.</p>
          ) : null}
        </div>
      </section>

      <section className="ai-suggest-block">
        <h3>Nearby collection centres</h3>
        <div className="ai-suggest-cards">
          {(suggestions.nearby_centers || []).map((c) => (
            <article key={c.franchisee_id} className="ai-suggest-card">
              <strong>{c.franchise_name}</strong>
              {c.distance_km != null ? <span className="muted">{c.distance_km} km away</span> : null}
              <p className="muted">{c.address || c.territory_region || c.branch_code}</p>
              <div className="ai-suggest-actions">
                <Link className="btn btn-sm" to={c.book_lab_path || '/diagnostics'}>
                  Lab here
                </Link>
                <Link className="btn btn-sm secondary" to={c.book_doctor_path || '/appointments/book'}>
                  Doctor
                </Link>
              </div>
            </article>
          ))}
          {!suggestions.nearby_centers?.length ? (
            <p className="muted">Enable location to see centres near you.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function AiPhysicianEntry({ placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [suggestions, setSuggestions] = useState<AiPhysicianSuggestions | null>(null);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [phase, setPhase] = useState<string>('questions');
  const [journeyMode, setJourneyMode] = useState<string>('rules');
  const [turnCount, setTurnCount] = useState(0);
  const [maxTurns, setMaxTurns] = useState(6);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openaiNote, setOpenaiNote] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ latitude?: number; longitude?: number }>({});
  const listRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, suggestions, quickReplies, open]);

  function applyMeta(turn: AiPhysicianTurn) {
    setPhase(turn.phase);
    setJourneyMode(turn.journey_mode || 'rules');
    setTurnCount(turn.turn_count ?? turn.question_index ?? 0);
    setMaxTurns(turn.max_turns ?? turn.total_questions ?? 6);
    setQuickReplies(turn.quick_replies || []);
    if (turn.suggestions) {
      setSuggestions(turn.suggestions);
    }
    const st = turn.openai_status;
    if (st?.configured && st.using_fallback && st.last_error_code) {
      setOpenaiNote(`Guided mode (OpenAI: ${st.last_error_code})`);
    } else if (turn.journey_mode === 'openai') {
      setOpenaiNote(null);
    }
  }

  function applyTurn(turn: AiPhysicianTurn, userText?: string) {
    setSessionId(turn.session_id);
    setMessages((prev) => {
      const next = [...prev];
      if (userText) next.push({ role: 'user', content: userText });
      next.push({ role: 'assistant', content: turn.message });
      return next;
    });
    applyMeta(turn);
  }

  async function beginChat(text: string) {
    const symptoms = text.trim();
    if (!symptoms || busy) return;
    setBusy(true);
    setError(null);
    setOpenaiNote(null);
    setOpen(true);
    setSuggestions(null);
    setQuickReplies([]);
    setPhase('questions');
    setMessages([{ role: 'user', content: symptoms }]);
    try {
      const res = await api.startAiPhysicianJourney({
        symptoms,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      setSessionId(res.data.session_id);
      setMessages([
        { role: 'user', content: symptoms },
        { role: 'assistant', content: res.data.message },
      ]);
      applyMeta(res.data);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to start care chat');
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !sessionId || busy) return;
    setBusy(true);
    setError(null);
    setReply('');
    setQuickReplies([]);
    try {
      const res = await api.aiPhysicianTurn({
        session_id: sessionId,
        message: trimmed,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      applyTurn(res.data, trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to continue');
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(e?: FormEvent) {
    e?.preventDefault();
    await sendMessage(reply);
  }

  function onHeroSubmit(e: FormEvent) {
    e.preventDefault();
    void beginChat(draft);
  }

  function toggleVoice() {
    const SR =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;
    if (!SR) {
      setError('Voice input is not supported in this browser');
      return;
    }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    recognitionRef.current = rec;
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const said = Array.from(ev.results)
        .map((r) => r[0]?.transcript || '')
        .join(' ')
        .trim();
      if (!said) return;
      if (open && sessionId) {
        void sendMessage(said);
      } else {
        setDraft(said);
        void beginChat(said);
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  }

  function closeChat() {
    setOpen(false);
    setListening(false);
    recognitionRef.current?.stop();
  }

  function resetChat() {
    setSessionId(null);
    setMessages([]);
    setSuggestions(null);
    setQuickReplies([]);
    setPhase('questions');
    setReply('');
    setDraft('');
    setError(null);
    setOpenaiNote(null);
  }

  const progressLabel =
    journeyMode === 'openai' && phase === 'questions'
      ? `Guided chat · turn ${Math.max(1, turnCount)} of ~${maxTurns}`
      : phase === 'emergency'
        ? 'Urgent guidance'
        : phase === 'suggestions' || phase === 'refine'
          ? 'Suggestions ready — ask to refine anytime'
          : openaiNote || 'Virtual care guide — not a diagnosis';

  return (
    <>
      <form className="home-search ai-physician-entry" onSubmit={onHeroSubmit}>
        <input
          type="search"
          placeholder={
            placeholder || 'Describe symptoms (e.g. fever, cough) — text or voice'
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Describe symptoms for AI physician"
        />
        <button
          className={`btn secondary ${listening ? 'ai-voice-on' : ''}`}
          type="button"
          onClick={toggleVoice}
          aria-label="Voice symptoms"
        >
          {listening ? 'Listening…' : 'Voice'}
        </button>
        <button className="btn" type="submit" disabled={busy || !draft.trim()}>
          {busy && !open ? 'Starting…' : 'Ask AI physician'}
        </button>
      </form>

      {open ? (
        <div className="ai-chat-overlay" role="dialog" aria-modal="true" aria-label="AI physician chat">
          <div className={`ai-chat-panel card ${phase === 'emergency' ? 'ai-chat-emergency' : ''}`}>
            <header className="ai-chat-header">
              <div>
                <strong>AI Physician</strong>
                <p className="muted">{progressLabel}</p>
              </div>
              <div className="ai-chat-header-actions">
                <button type="button" className="btn secondary btn-sm" onClick={resetChat}>
                  New
                </button>
                <button type="button" className="btn secondary btn-sm" onClick={closeChat}>
                  Close
                </button>
              </div>
            </header>

            <div className="ai-chat-messages" ref={listRef}>
              {messages.map((m, i) => (
                <div key={`${m.role}-${i}`} className={`ai-bubble ai-bubble-${m.role}`}>
                  {m.content}
                </div>
              ))}
              {quickReplies.length && !busy ? (
                <div className="ai-quick-replies" role="group" aria-label="Quick replies">
                  {quickReplies.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className="ai-chip"
                      disabled={busy || !sessionId}
                      onClick={() => void sendMessage(chip)}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              ) : null}
              {suggestions ? (
                <SuggestionCards suggestions={suggestions} emergency={phase === 'emergency'} />
              ) : null}
            </div>

            {error ? <div className="error ai-chat-error">{error}</div> : null}

            <form className="ai-chat-compose" onSubmit={sendReply}>
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={
                  suggestions
                    ? 'Ask why, request cheaper options, or refine…'
                    : 'Type your answer…'
                }
                disabled={busy || !sessionId}
              />
              <button
                className={`btn secondary ${listening ? 'ai-voice-on' : ''}`}
                type="button"
                onClick={toggleVoice}
              >
                {listening ? '…' : 'Voice'}
              </button>
              <button className="btn" type="submit" disabled={busy || !reply.trim()}>
                Send
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

declare global {
  interface Window {
    SpeechRecognition?: typeof SpeechRecognition;
    webkitSpeechRecognition?: typeof SpeechRecognition;
  }
}
