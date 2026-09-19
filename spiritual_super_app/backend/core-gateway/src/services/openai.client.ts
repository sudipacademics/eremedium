import { request } from 'undici';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export class OpenAiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code = 'OPENAI_ERROR') {
    super(message);
    this.name = 'OpenAiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ChatCompletionResult {
  readonly content: string;
  readonly model: string;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
}

/**
 * Thin OpenAI Chat Completions client.
 *
 * Optional at boot (like Razorpay): missing key → 503 from callers via isConfigured().
 */
export const OpenAiClient = {
  isConfigured(): boolean {
    return Boolean(env.OPENAI_API_KEY);
  },

  model(): string {
    return env.OPENAI_MODEL;
  },

  async chatCompletion(messages: readonly ChatMessage[], options?: {
    readonly maxTokens?: number;
    readonly temperature?: number;
  }): Promise<ChatCompletionResult> {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new OpenAiError(
        'AI predictions are not configured (OPENAI_API_KEY missing)',
        503,
        'AI_NOT_CONFIGURED',
      );
    }

    const response = await request('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        messages,
        max_tokens: options?.maxTokens ?? env.AI_PREDICT_MAX_TOKENS,
        temperature: options?.temperature ?? 0.55,
      }),
      headersTimeout: 45_000,
      bodyTimeout: 90_000,
    });

    const text = await response.body.text();
    if (response.statusCode >= 400) {
      const parsed = safeJson(text);
      const err = (parsed?.error ?? {}) as { message?: string; code?: string; type?: string };
      const message = err.message ?? `OpenAI HTTP ${response.statusCode}`;
      const code = err.code ?? err.type ?? 'OPENAI_HTTP_ERROR';
      logger.warn({ status: response.statusCode, code }, 'OpenAI chat completion failed');
      const statusCode =
        response.statusCode === 429 ? 429 : response.statusCode === 401 || response.statusCode === 403 ? 502 : 502;
      throw new OpenAiError(message, statusCode, code);
    }

    const payload = safeJson(text) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;

    const content = payload?.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) {
      throw new OpenAiError('OpenAI returned an empty prediction', 502, 'EMPTY_COMPLETION');
    }

    return {
      content,
      model: payload?.model ?? env.OPENAI_MODEL,
      promptTokens: payload?.usage?.prompt_tokens ?? null,
      completionTokens: payload?.usage?.completion_tokens ?? null,
    };
  },
};

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
