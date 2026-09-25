'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import AiAnswer from '@/components/ai/AiAnswer';
import {
  AI_ASTROLOGERS,
  AI_ASTROLOGER_IDS,
  isAiAstrologerId,
  type AiAstrologerId,
  type AiAstrologerPersona,
} from '@/lib/ai-astrologers';
import {
  ApiError,
  api,
  session,
  type AiPredictResult,
  type AiPredictStatus,
  type AiPredictTurn,
  type BirthProfile,
} from '@/lib/api';
import { takeIntentParam, useAuthGate } from '@/lib/auth-gate';

interface ChatBubble {
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
}

type Threads = Record<AiAstrologerId, ChatBubble[]>;

const EMPTY_THREADS: Threads = { vedic: [], nadi: [], western: [], numerology: [] };

function PersonaCard({
  persona,
  selected,
  onSelect,
}: {
  persona: AiAstrologerPersona;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex h-full flex-col items-center rounded-2xl border bg-white p-4 text-center shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ved-gold-400 ${
        selected
          ? 'border-ved-gold-400 ring-2 ring-ved-gold-300/70'
          : 'border-ved-green-900/10 hover:-translate-y-0.5 hover:border-ved-gold-300 hover:shadow-md'
      }`}
    >
      <span className="relative">
        <Image
          src={persona.avatar}
          alt=""
          width={96}
          height={96}
          className="h-20 w-20 rounded-full object-cover ring-2 ring-ved-gold-200 sm:h-24 sm:w-24"
        />
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-ved-green-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          AI
        </span>
      </span>
      <span className="mt-3 font-display text-lg font-semibold text-ved-green-900">{persona.name}</span>
      <span className="text-xs font-semibold uppercase tracking-wide text-ved-gold-600">{persona.tradition}</span>
      <span className="mt-1 text-xs text-ved-green-800/60">{persona.tagline}</span>
    </button>
  );
}

export default function AiAstrologersPage() {
  const [status, setStatus] = useState<AiPredictStatus | null>(null);
  const [profile, setProfile] = useState<BirthProfile | null>(null);
  const [active, setActive] = useState<AiAstrologerId>('vedic');
  const [threads, setThreads] = useState<Threads>(EMPTY_THREADS);
  const [question, setQuestion] = useState('');
  const [includeGochar, setIncludeGochar] = useState(true);
  const [fullName, setFullName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [pending, setPending] = useState<AiAstrologerId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { signedIn, requireLogin } = useAuthGate();

  const persona = AI_ASTROLOGERS[active];
  const messages = threads[active];
  const loading = pending !== null;

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('astrologer');
    if (isAiAstrologerId(requested)) setActive(requested);
    // `?ask=`: a question typed before signing in; put it back in the box.
    const pendingQuestion = takeIntentParam('ask');
    if (pendingQuestion) setQuestion(pendingQuestion.slice(0, 1500));
  }, []);

  useEffect(() => {
    void Promise.all([
      api.get<AiPredictStatus>('vedic/ai-predict/status'),
      signedIn ? api.get<BirthProfile>('vedic/birth-profile') : Promise.resolve(null),
    ])
      .then(([aiStatus, birth]) => {
        setStatus(aiStatus);
        setProfile(birth);
        if (birth?.birthDate) setBirthDate((current) => current || birth.birthDate || '');
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Could not load AI status');
      });
    const name = session.profile?.name;
    if (signedIn && name) setFullName((current) => current || name);
  }, [signedIn]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, pending]);

  function choose(id: AiAstrologerId) {
    setActive(id);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set('astrologer', id);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }

  const needsBirth = persona.usesChart && profile !== null && !profile.complete;
  const needsNumbers = !persona.usesChart && (fullName.trim().length < 2 || !birthDate);
  const aiReady = status?.ready === true;
  const blocked = !aiReady || needsBirth || loading;

  async function ask(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || loading) return;
    const who = active;
    if (!requireLogin(`/ai?astrologer=${who}&ask=${encodeURIComponent(trimmed.slice(0, 500))}`)) return;
    if (!AI_ASTROLOGERS[who].usesChart && needsNumbers) {
      setError('Add your full name and date of birth so Ank Guru can work out your numbers.');
      return;
    }

    setError(null);
    setPending(who);
    setQuestion('');
    const history: AiPredictTurn[] = threads[who].slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setThreads((prev) => ({ ...prev, [who]: [...prev[who], { role: 'user', content: trimmed }] }));

    try {
      const result = await api.post<AiPredictResult>('vedic/ai-predict', {
        astrologer: who,
        question: trimmed,
        history,
        ...(AI_ASTROLOGERS[who].usesChart
          ? { includeGochar }
          : { fullName: fullName.trim(), birthDate }),
      });
      setDisclaimer(result.disclaimer);
      setThreads((prev) => ({
        ...prev,
        [who]: [
          ...prev[who],
          {
            role: 'assistant',
            content: result.answer,
            meta: result.birthTimeAssumed ? `${result.model} · birth time assumed` : result.model,
          },
        ],
      }));
    } catch (caught) {
      setError(
        caught instanceof ApiError || caught instanceof Error ? caught.message : 'Prediction failed',
      );
      setThreads((prev) => ({ ...prev, [who]: prev[who].slice(0, -1) }));
      setQuestion(trimmed);
    } finally {
      setPending(null);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-ved-green-800 via-ved-green-700 to-ved-green-900 px-6 py-8 text-white shadow-lg sm:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ved-gold-300">AI Astrologers</p>
        <h1 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">Four traditions. One chart. Ask anything.</h1>
        <p className="mt-3 max-w-2xl text-sm text-white/75">
          Choose an AI astrologer trained in Vedic, Nadi, Western or Numerology. Every answer is grounded in your
          own birth chart or numbers — not generic horoscopes.
        </p>
      </section>

      <div role="group" aria-label="Choose an AI astrologer" className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {AI_ASTROLOGER_IDS.map((id) => (
          <PersonaCard key={id} persona={AI_ASTROLOGERS[id]} selected={id === active} onSelect={() => choose(id)} />
        ))}
      </div>

      {!signedIn && (
        <div className="rounded-xl border border-ved-green-900/10 bg-ved-cream-100 px-4 py-3 text-sm text-ved-green-800">
          Readings are personal to your chart, so you&apos;ll be asked to log in or sign up when you ask your first
          question — we&apos;ll bring you right back here with your question.
        </div>
      )}

      {needsBirth && (
        <div className="rounded-xl border border-ved-gold-300 bg-ved-gold-50 px-4 py-3 text-sm text-ved-gold-800">
          Save your birth details on{' '}
          <Link href="/kundali" className="font-semibold text-ved-green-800 underline">
            Kundali
          </Link>{' '}
          first — {persona.name} reads from your chart.
        </div>
      )}

      {!aiReady && status && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          AI astrologers are not configured on this host yet. Kundali and live consults still work.
        </div>
      )}

      {aiReady && status?.provider === 'trial' && (
        <div className="rounded-xl border border-ved-gold-300 bg-ved-gold-50 px-4 py-3 text-sm text-ved-gold-800">
          Running the <strong>local trial engine</strong> (no cloud key). Answers are short chart-grounded sketches.
        </div>
      )}

      <section className="overflow-hidden rounded-3xl border border-ved-green-900/10 bg-white shadow-sm" aria-label={`Chat with ${persona.name}`}>
        <header className="flex items-center gap-4 border-b border-ved-green-900/10 bg-ved-cream-50 px-5 py-4">
          <Image
            src={persona.avatar}
            alt={`${persona.name}, AI ${persona.tradition.toLowerCase()} astrologer`}
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-ved-gold-200"
          />
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-ved-green-900">
              {persona.name}{' '}
              <span className="align-middle text-xs font-sans font-semibold uppercase tracking-wide text-ved-gold-600">
                AI · {persona.tradition}
              </span>
            </h2>
            <p className="text-sm text-ved-green-800/65">{persona.about}</p>
          </div>
        </header>

        <div ref={listRef} className="flex max-h-[32rem] min-h-[18rem] flex-col gap-3 overflow-y-auto px-5 py-5">
          {messages.length === 0 && !loading && (
            <div className="space-y-3">
              <p className="text-sm text-ved-green-800/60">Try a starting question:</p>
              <div className="flex flex-wrap gap-2">
                {persona.suggestions.map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    className="rounded-xl border border-ved-green-900/10 bg-ved-cream-100 px-3 py-2 text-left text-xs text-ved-green-800 transition hover:border-ved-gold-300 hover:bg-ved-gold-50 disabled:opacity-40"
                    disabled={blocked}
                    onClick={() => void ask(hint)}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, index) =>
            msg.role === 'user' ? (
              <div
                key={`user-${index}`}
                className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ved-green-800 px-4 py-3 text-sm text-white"
              >
                {msg.content}
              </div>
            ) : (
              <div key={`assistant-${index}`} className="flex max-w-[92%] items-start gap-2.5">
                <Image
                  src={persona.avatar}
                  alt=""
                  width={32}
                  height={32}
                  className="mt-1 h-8 w-8 shrink-0 rounded-full object-cover"
                />
                <div className="rounded-2xl rounded-tl-sm border border-ved-green-900/10 bg-ved-cream-50 px-4 py-3 text-sm leading-relaxed text-ved-green-900">
                  <AiAnswer text={msg.content} />
                  {msg.meta && (
                    <p className="mt-2 text-[11px] uppercase tracking-wide text-ved-green-800/45">{msg.meta}</p>
                  )}
                </div>
              </div>
            ),
          )}
          {pending === active && <p className="animate-pulse text-sm text-ved-green-800/60">{persona.thinking}</p>}
        </div>

        <form onSubmit={onSubmit} className="space-y-3 border-t border-ved-green-900/10 bg-ved-cream-50/60 px-5 py-4">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

          {persona.usesChart ? (
            <label className="flex items-center gap-2 text-xs text-ved-green-800/70">
              <input
                type="checkbox"
                checked={includeGochar}
                onChange={(e) => setIncludeGochar(e.target.checked)}
                className="rounded border-ved-green-900/20"
              />
              Include today&apos;s transits
            </label>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-ved-green-800/70">
                Full name (as you use it)
                <input
                  className="input mt-1"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={120}
                  autoComplete="name"
                  placeholder="e.g. Priya Sharma"
                />
              </label>
              <label className="block text-xs font-medium text-ved-green-800/70">
                Date of birth
                <input
                  type="date"
                  className="input mt-1"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </label>
            </div>
          )}

          <textarea
            className="input min-h-[5rem] resize-y"
            placeholder={persona.placeholder}
            aria-label={`Your question for ${persona.name}`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={1500}
            disabled={blocked}
          />
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={messages.length === 0 || loading}
              onClick={() => {
                setThreads((prev) => ({ ...prev, [active]: [] }));
                setDisclaimer(null);
                setError(null);
              }}
            >
              Clear chat
            </button>
            <button type="submit" className="btn-primary" disabled={blocked || question.trim().length < 3}>
              {loading ? 'Asking…' : signedIn ? `Ask ${persona.name}` : `Log in & ask ${persona.name}`}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-ved-green-800/50">
            {disclaimer ??
              'AI astrologers are automated and for reflection only — for personal guidance, book a live consult with one of our astrologers.'}
          </p>
        </form>
      </section>
    </div>
  );
}
