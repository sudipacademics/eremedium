import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, AiPhysicianSuggestions, AiPhysicianTurn } from '../api';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

type Props = {
  placeholder?: string;
};

function SuggestionCards({ suggestions }: { suggestions: AiPhysicianSuggestions }) {
  return (
    <div className="ai-suggest-grid">
      <section className="ai-suggest-block">
        <h3>Diagnostic workup</h3>
        <div className="ai-suggest-cards">
          {(suggestions.diagnostic_workup || []).map((item) => (
            <article key={item.item_code || item.panel_id} className="ai-suggest-card">
              <strong>{item.item_name}</strong>
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
          {!suggestions.diagnostic_workup?.length ? <p className="muted">No matching tests found.</p> : null}
        </div>
      </section>

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
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  }, [messages, suggestions, open]);

  function applyTurn(turn: AiPhysicianTurn, userText?: string) {
    setSessionId(turn.session_id);
    setMessages((prev) => {
      const next = [...prev];
      if (userText) next.push({ role: 'user', content: userText });
      next.push({ role: 'assistant', content: turn.message });
      return next;
    });
    if (turn.phase === 'suggestions' && turn.suggestions) {
      setSuggestions(turn.suggestions);
    }
  }

  async function beginChat(text: string) {
    const symptoms = text.trim();
    if (!symptoms || busy) return;
    setBusy(true);
    setError(null);
    setOpen(true);
    setSuggestions(null);
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
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to start care chat');
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(e?: FormEvent) {
    e?.preventDefault();
    const text = reply.trim();
    if (!text || !sessionId || busy) return;
    setBusy(true);
    setError(null);
    setReply('');
    try {
      const res = await api.aiPhysicianTurn({
        session_id: sessionId,
        message: text,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      applyTurn(res.data, text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to continue');
    } finally {
      setBusy(false);
    }
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
        setReply(said);
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
    setReply('');
    setDraft('');
    setError(null);
  }

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
          <div className="ai-chat-panel card">
            <header className="ai-chat-header">
              <div>
                <strong>AI Physician</strong>
                <p className="muted">Virtual care guide — not a diagnosis</p>
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
              {suggestions ? <SuggestionCards suggestions={suggestions} /> : null}
            </div>

            {error ? <div className="error ai-chat-error">{error}</div> : null}

            {!suggestions ? (
              <form className="ai-chat-compose" onSubmit={sendReply}>
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Type your answer…"
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
            ) : (
              <p className="muted ai-chat-foot">
                Choose a test, physician booking, or nearby centre above to continue.
              </p>
            )}
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
