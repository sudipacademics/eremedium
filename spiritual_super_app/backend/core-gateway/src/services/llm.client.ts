import { request } from 'undici';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export class LlmError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code = 'LLM_ERROR') {
    super(message);
    this.name = 'LlmError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** @deprecated alias kept for existing route imports */
export { LlmError as OpenAiError };

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ChatCompletionResult {
  readonly content: string;
  readonly model: string;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly provider: 'openai' | 'gemini' | 'groq' | 'trial';
}

type Provider = 'openai' | 'gemini' | 'groq' | 'trial';

function resolveProvider(): Provider {
  const forced = env.AI_PROVIDER;
  if (forced === 'openai' || forced === 'gemini' || forced === 'groq' || forced === 'trial') {
    return forced;
  }
  // auto: prefer cloud keys, then local trial engine so /ai always works on staging.
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.GEMINI_API_KEY) return 'gemini';
  if (env.GROQ_API_KEY) return 'groq';
  return 'trial';
}

function modelFor(provider: Provider): string {
  switch (provider) {
    case 'openai':
      return env.OPENAI_MODEL;
    case 'gemini':
      return env.GEMINI_MODEL;
    case 'groq':
      return env.GROQ_MODEL;
    case 'trial':
      return 'ssa-trial-jyotish-v1';
  }
}

/**
 * Multi-provider chat completions for Jyotish AI.
 *
 * `AI_PROVIDER=auto` (default) picks OpenAI → Gemini → Groq → local trial engine.
 * Trial needs no API key and grounds answers in the chart brief only.
 */
export const LlmClient = {
  provider(): Provider {
    return resolveProvider();
  },

  isConfigured(): boolean {
    // Trial is always ready; cloud providers need their key when forced.
    const provider = resolveProvider();
    if (provider === 'trial') return true;
    if (provider === 'openai') return Boolean(env.OPENAI_API_KEY);
    if (provider === 'gemini') return Boolean(env.GEMINI_API_KEY);
    if (provider === 'groq') return Boolean(env.GROQ_API_KEY);
    return false;
  },

  model(): string {
    return modelFor(resolveProvider());
  },

  async chatCompletion(
    messages: readonly ChatMessage[],
    options?: { readonly maxTokens?: number; readonly temperature?: number },
  ): Promise<ChatCompletionResult> {
    const provider = resolveProvider();
    const maxTokens = options?.maxTokens ?? env.AI_PREDICT_MAX_TOKENS;
    const temperature = options?.temperature ?? 0.55;

    if (provider === 'trial') {
      return trialCompletion(messages);
    }
    if (provider === 'gemini') {
      return geminiCompletion(messages, maxTokens, temperature);
    }
    if (provider === 'groq') {
      return openAiCompatibleCompletion({
        provider: 'groq',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        apiKey: env.GROQ_API_KEY,
        model: env.GROQ_MODEL,
        messages,
        maxTokens,
        temperature,
      });
    }
    return openAiCompatibleCompletion({
      provider: 'openai',
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      messages,
      maxTokens,
      temperature,
    });
  },
};

/** Back-compat export used by ai-prediction.service */
export const OpenAiClient = LlmClient;

async function openAiCompatibleCompletion(input: {
  readonly provider: 'openai' | 'groq';
  readonly url: string;
  readonly apiKey: string | undefined;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly maxTokens: number;
  readonly temperature: number;
}): Promise<ChatCompletionResult> {
  if (!input.apiKey) {
    throw new LlmError(
      `AI predictions are not configured (${input.provider} API key missing)`,
      503,
      'AI_NOT_CONFIGURED',
    );
  }

  const response = await request(input.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
    }),
    headersTimeout: 45_000,
    bodyTimeout: 90_000,
  });

  const text = await response.body.text();
  if (response.statusCode >= 400) {
    const parsed = safeJson(text);
    const err = (parsed?.error ?? {}) as { message?: string; code?: string; type?: string };
    const message = err.message ?? `${input.provider} HTTP ${response.statusCode}`;
    const code = err.code ?? err.type ?? 'LLM_HTTP_ERROR';
    logger.warn({ provider: input.provider, status: response.statusCode, code }, 'LLM chat failed');
    throw new LlmError(message, response.statusCode === 429 ? 429 : 502, code);
  }

  const payload = safeJson(text) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;

  const content = payload?.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) {
    throw new LlmError(`${input.provider} returned an empty prediction`, 502, 'EMPTY_COMPLETION');
  }

  return {
    content,
    model: payload?.model ?? input.model,
    promptTokens: payload?.usage?.prompt_tokens ?? null,
    completionTokens: payload?.usage?.completion_tokens ?? null,
    provider: input.provider,
  };
}

async function geminiCompletion(
  messages: readonly ChatMessage[],
  maxTokens: number,
  temperature: number,
): Promise<ChatCompletionResult> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new LlmError('AI predictions are not configured (GEMINI_API_KEY missing)', 503, 'AI_NOT_CONFIGURED');
  }

  const systemBits = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const turns = messages.filter((m) => m.role !== 'system');
  const contents = turns.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}` +
    `:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: systemBits.length
        ? { parts: [{ text: systemBits.join('\n\n') }] }
        : undefined,
      contents,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    }),
    headersTimeout: 45_000,
    bodyTimeout: 90_000,
  });

  const text = await response.body.text();
  if (response.statusCode >= 400) {
    const parsed = safeJson(text);
    const err = (parsed?.error ?? {}) as { message?: string; status?: string };
    logger.warn({ status: response.statusCode }, 'Gemini chat failed');
    throw new LlmError(
      err.message ?? `Gemini HTTP ${response.statusCode}`,
      response.statusCode === 429 ? 429 : 502,
      err.status ?? 'GEMINI_HTTP_ERROR',
    );
  }

  const payload = safeJson(text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  } | null;

  const content =
    payload?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
  if (!content) {
    throw new LlmError('Gemini returned an empty prediction', 502, 'EMPTY_COMPLETION');
  }

  return {
    content,
    model: env.GEMINI_MODEL,
    promptTokens: payload?.usageMetadata?.promptTokenCount ?? null,
    completionTokens: payload?.usageMetadata?.candidatesTokenCount ?? null,
    provider: 'gemini',
  };
}

/**
 * Local trial engine: no cloud key. Builds a short Jyotish-style reading from the chart brief
 * and the user's question. Labeled clearly so it is never mistaken for a cloud LLM.
 */
function trialCompletion(messages: readonly ChatMessage[]): ChatCompletionResult {
  const brief =
    messages.find((m) => m.role === 'system' && m.content.includes('CHART BRIEF'))?.content ?? '';
  const question = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  const lagna = pick(brief, /LAGNA:\s*([^\n(]+)/i);
  const dasha = pick(brief, /CURRENT DASHA:\s*([^\n]+)/i);
  const moonNak = pick(brief, /MOON NAKSHATRA AT BIRTH:\s*([^\n]+)/i);
  const birthWarn = /Birth time unknown/i.test(brief);
  const gochar = /TODAY GOCHAR/i.test(brief);
  const planets = [...brief.matchAll(/^\s{2}(\w+):\s*([A-Za-z]+)/gm)].slice(0, 6);

  const q = question.toLowerCase();
  const focus =
    /career|job|work|business|office/.test(q)
      ? 'career'
      : /love|marriage|relation|partner|spouse/.test(q)
        ? 'relationship'
        : /health|body|illness/.test(q)
          ? 'vitality'
          : /money|wealth|finance|income/.test(q)
            ? 'wealth'
            : /dasha|timing|period/.test(q)
              ? 'timing'
              : 'general';

  const lines: string[] = [];
  lines.push(
    `**Trial reading** (local Jyotish engine — not a cloud LLM). Grounded in your Lahiri chart brief.`,
  );
  if (birthWarn) {
    lines.push(
      `Birth time was assumed, so Lagna and house themes below are provisional — refine the time on Kundali for a firmer reading.`,
    );
  }
  if (lagna) lines.push(`**Lagna:** ${lagna.trim()} — this colours how you meet the world.`);
  if (moonNak) lines.push(`**Moon:** ${moonNak.trim()} — emotional tone and mind-pattern.`);
  if (dasha) lines.push(`**Current dasha:** ${dasha.trim()} — the active timing frame for your question.`);
  if (planets.length > 0) {
    lines.push(
      `**Key placements:** ${planets.map(([, body, sign]) => `${body} in ${sign}`).join(', ')}.`,
    );
  }

  switch (focus) {
    case 'career':
      lines.push(
        `For career, weigh the 10th-house themes against the current mahadasha/antardasha lords. Prefer steady skill-building over abrupt leaps while the active lords are still settling.`,
      );
      break;
    case 'relationship':
      lines.push(
        `For relationships, the Moon and 7th-house lords matter more than a single transit. Use the dasha window to choose conversations and commitments, not to force outcomes.`,
      );
      break;
    case 'vitality':
      lines.push(
        `For vitality, this trial engine only offers lifestyle-facing notes — rest, routine, and avoiding extremes. It is not medical advice; see a clinician for health concerns.`,
      );
      break;
    case 'wealth':
      lines.push(
        `For wealth themes, look at 2nd/11th house lords relative to the current dasha. Favour cash-flow discipline and avoid speculative bets framed as “sure” astrological wins.`,
      );
      break;
    case 'timing':
      lines.push(
        `Timing hinges on the dasha stack above. Treat the next few months as a refinement window: act on what is already in motion rather than launching unrelated ventures.`,
      );
      break;
    default:
      lines.push(
        `Overall, keep decisions aligned with the dasha lords and Moon tone above. Ask a narrower question (career, timing, strengths) for a sharper trial pass — or connect OpenAI/Gemini/Groq for fuller Astro-GPT prose.`,
      );
  }

  if (gochar) {
    lines.push(`Today's gochar was included in the brief — watch slow planets for mood and opportunity, not for fatal forecasts.`);
  }
  lines.push(`Next step: refine birth time on **Kundali**, or book a live astrologer for a personalised consult.`);

  return {
    content: lines.join('\n\n'),
    model: 'ssa-trial-jyotish-v1',
    promptTokens: null,
    completionTokens: null,
    provider: 'trial',
  };
}

function pick(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m?.[1]?.trim() ?? null;
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
