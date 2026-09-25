'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  ApiError,
  api,
  type AiPredictResult,
  type AiPredictStatus,
  type AiPredictTurn,
  type BirthProfile,
} from '@/lib/api';
import { takeIntentParam, useAuthGate } from '@/lib/auth-gate';

const SUGGESTIONS = [
  'What does my current dasha emphasise for career?',
  'Summarise my Lagna and Moon for personality and mind.',
  'Any gochar themes I should watch this month?',
  'What strengths stand out in my chart?',
];

interface ChatBubble {
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
}

export default function JyotishAiPage() {
  const [status, setStatus] = useState<AiPredictStatus | null>(null);
  const [profile, setProfile] = useState<BirthProfile | null>(null);
  const [question, setQuestion] = useState('');
  const [includeGochar, setIncludeGochar] = useState(true);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const { signedIn, requireLogin } = useAuthGate();

  useEffect(() => {
    // `?ask=`: a question typed before signing in; put it back in the box.
    const pending = takeIntentParam('ask');
    if (pending) setQuestion(pending.slice(0, 1500));
    void Promise.all([
      api.get<AiPredictStatus>('vedic/ai-predict/status'),
      signedIn ? api.get<BirthProfile>('vedic/birth-profile') : Promise.resolve(null),
    ])
      .then(([aiStatus, birth]) => {
        setStatus(aiStatus);
        setProfile(birth);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Could not load AI status');
      });
  }, [signedIn]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function ask(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || loading) return;
    if (!requireLogin(`/ai?ask=${encodeURIComponent(trimmed.slice(0, 500))}`)) return;

    setError(null);
    setLoading(true);
    setQuestion('');
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);

    const history: AiPredictTurn[] = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const result = await api.post<AiPredictResult>('vedic/ai-predict', {
        question: trimmed,
        history,
        includeGochar,
      });
      setDisclaimer(result.disclaimer);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.answer,
          meta: result.birthTimeAssumed
            ? `${result.model} · birth time assumed`
            : result.model,
        },
      ]);
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'Prediction failed';
      setError(message);
      setMessages((prev) => prev.slice(0, -1));
      setQuestion(trimmed);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  const needsBirth = profile !== null && !profile.complete;
  const aiReady = status?.ready === true;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="card bg-ved-green-50 border-ved-green-900/10">
        <h1 className="text-xl font-semibold">Jyotish AI</h1>
        <p className="mt-1 text-sm text-ved-green-800/60">
          Ask about your chart the way you would ask an astrologer — answers are grounded in your
          Lahiri kundali{includeGochar ? ' and today\'s gochar' : ''}, not generic horoscopes.
        </p>
        {status && (
          <p className="mt-2 text-xs text-ved-green-800/50">
            Model: {status.model}
            {status.provider ? ` · ${status.provider}` : ''}
            {status.ready ? ' · ready' : ' · not configured'}
          </p>
        )}
      </div>

      {!signedIn && (
        <div className="rounded-xl border border-ved-green-900/10 bg-ved-cream-100 px-4 py-3 text-sm text-ved-green-800">
          Readings are personal to your chart, so you&apos;ll be asked to log in or sign up when you ask your
          first question — we&apos;ll bring you right back here with your question.
        </div>
      )}

      {needsBirth && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Save your birth details on{' '}
          <Link href="/kundali" className="font-semibold text-saffron-300 underline">
            Kundali
          </Link>{' '}
          first — AI readings need your chart.
        </div>
      )}

      {!aiReady && status && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          AI predictions are not configured on this host yet. Kundali and live consults still work.
        </div>
      )}

      {aiReady && status?.provider === 'trial' && (
        <div className="rounded-xl border border-saffron-500/30 bg-saffron-500/10 px-4 py-3 text-sm text-saffron-100">
          Running the <strong>local trial engine</strong> (no cloud key). Answers are chart-grounded
          sketches — set Gemini, Groq, or OpenAI for fuller Astro-GPT prose.
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
      )}

      <div className="card flex min-h-[22rem] flex-col gap-3">
        {messages.length === 0 && !loading && (
          <div className="space-y-3">
            <p className="text-sm text-ved-green-800/60">Try a starting question:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((hint) => (
                <button
                  key={hint}
                  type="button"
                  className="rounded-xl border border-ved-green-900/10 bg-ved-cream-200/80 px-3 py-2 text-left text-xs text-ved-green-800 hover:bg-ved-green-100 disabled:opacity-40"
                  disabled={!aiReady || needsBirth || loading}
                  onClick={() => void ask(hint)}
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-1 flex-col gap-3">
          {messages.map((msg, index) => (
            <div
              key={`${msg.role}-${index}`}
              className={
                msg.role === 'user'
                  ? 'ml-8 rounded-2xl bg-saffron-500/20 px-4 py-3 text-sm text-saffron-50'
                  : 'mr-4 rounded-2xl border border-ved-green-900/10 bg-night-900/60 px-4 py-3 text-sm text-ved-green-900 whitespace-pre-wrap'
              }
            >
              {msg.content}
              {msg.meta && (
                <p className="mt-2 text-[11px] uppercase tracking-wide text-ved-green-800/50">{msg.meta}</p>
              )}
            </div>
          ))}
          {loading && (
            <p className="text-sm text-ved-green-800/60 animate-pulse">Reading your chart…</p>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <form onSubmit={onSubmit} className="card space-y-3">
        <label className="flex items-center gap-2 text-xs text-ved-green-800/60">
          <input
            type="checkbox"
            checked={includeGochar}
            onChange={(e) => setIncludeGochar(e.target.checked)}
            className="rounded border-white/20"
          />
          Include today&apos;s gochar (transits)
        </label>
        <textarea
          className="input min-h-[5.5rem] resize-y"
          placeholder="Ask about career, relationships, dasha timing, strengths…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={1500}
          disabled={!aiReady || needsBirth || loading}
        />
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={messages.length === 0 || loading}
            onClick={() => {
              setMessages([]);
              setDisclaimer(null);
              setError(null);
            }}
          >
            Clear chat
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={!aiReady || needsBirth || loading || question.trim().length < 3}
          >
            {loading ? 'Asking…' : signedIn ? 'Ask Jyotish AI' : 'Log in & ask Jyotish AI'}
          </button>
        </div>
        {disclaimer && <p className="text-[11px] leading-relaxed text-ved-green-800/50">{disclaimer}</p>}
      </form>
    </div>
  );
}
