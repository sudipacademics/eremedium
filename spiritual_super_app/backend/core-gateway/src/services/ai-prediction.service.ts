import { prisma } from '../lib/prisma.js';
import {
  nadiBrief,
  numerologyBrief,
  SYSTEM_PROMPTS,
  westernBrief,
  type AiAstrologerId,
} from './ai-astrologers.js';
import { AstroServiceClient, type GocharOutput } from './astro.client.js';
import { compactChartBrief, gocharSummary } from './chart-brief.js';
import { ContentError } from './content-security.js';
import { KundaliError, KundaliService, type KundaliView } from './kundali.service.js';
import { buildReading } from './numerology.js';
import { OpenAiClient, type ChatMessage } from './openai.client.js';

export type { KundaliView };
export { compactChartBrief } from './chart-brief.js';

export class AiPredictionError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'AiPredictionError';
    this.statusCode = statusCode;
  }
}

export interface AiPredictTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AiPredictInput {
  readonly question: string;
  /** Which AI astrologer answers; defaults to Vedic. */
  readonly astrologer?: AiAstrologerId;
  /** Prior turns in this browser session (stateless server). Cap enforced by the route. */
  readonly history?: readonly AiPredictTurn[];
  /** When true, fold today's transits into the brief (chart-based astrologers only). */
  readonly includeGochar?: boolean;
  /** Numerology only: the name to read (defaults to the account name). */
  readonly fullName?: string;
  /** Numerology only: YYYY-MM-DD (defaults to the saved birth date). */
  readonly birthDate?: string;
}

export interface AiPredictResult {
  readonly astrologer: AiAstrologerId;
  readonly answer: string;
  readonly model: string;
  readonly birthTimeAssumed: boolean;
  readonly chartBrief: string;
  readonly disclaimer: string;
  readonly usage: {
    readonly promptTokens: number | null;
    readonly completionTokens: number | null;
  };
}

export interface AiPredictStatus {
  readonly configured: boolean;
  readonly model: string;
  readonly ready: boolean;
  readonly provider: string;
}

const DISCLAIMER =
  'Interpretive guidance for reflection only — not medical, legal, or financial advice. ' +
  'A live astrologer consultation remains available for personalised guidance.';

interface Brief {
  readonly text: string;
  readonly birthTimeAssumed: boolean;
}

async function kundaliOrThrow(userId: string): Promise<KundaliView> {
  try {
    return await KundaliService.kundaliFor(userId, 2);
  } catch (error) {
    if (error instanceof KundaliError) throw new AiPredictionError(error.message, error.statusCode);
    throw error;
  }
}

/** Today's sky at the birth place; enrichment only, so failures are swallowed. */
async function transitsFor(kundali: KundaliView): Promise<GocharOutput | null> {
  const { latitude, longitude } = kundali.profile;
  if (latitude === null || longitude === null) return null;
  try {
    const moon = kundali.chart.planets.find((p) => p.body === 'Moon');
    return await AstroServiceClient.gochar({
      transit_utc: new Date().toISOString(),
      latitude,
      longitude,
      natal_ascendant_longitude: kundali.chart.ascendant.sidereal_longitude,
      ...(moon ? { natal_moon_longitude: moon.sidereal_longitude } : {}),
    });
  } catch {
    return null;
  }
}

async function chartBrief(userId: string, astrologer: Exclude<AiAstrologerId, 'numerology'>, withTransits: boolean): Promise<Brief> {
  const kundali = await kundaliOrThrow(userId);
  const sky = withTransits ? await transitsFor(kundali) : null;
  const text =
    astrologer === 'western'
      ? westernBrief(kundali.chart, kundali.birthTimeAssumed, sky?.planets, sky?.ayanamsha)
      : astrologer === 'nadi'
        ? nadiBrief(kundali.chart, sky?.planets)
        : compactChartBrief(kundali, sky ? gocharSummary(sky) : undefined);
  return { text, birthTimeAssumed: kundali.birthTimeAssumed };
}

async function numerologyInputs(userId: string, input: AiPredictInput): Promise<Brief> {
  let birthDate = input.birthDate;
  if (!birthDate) {
    const profile = await KundaliService.getBirthProfile(userId);
    birthDate = profile.birthDate ?? undefined;
  }
  if (!birthDate) {
    throw new AiPredictionError('Add your date of birth so the numerologist can read your numbers', 428);
  }
  let fullName = input.fullName?.trim();
  if (!fullName) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    fullName = user?.name?.trim();
  }
  if (!fullName) throw new AiPredictionError('Add your full name so the numerologist can read your numbers', 428);

  try {
    const reading = buildReading(fullName, birthDate);
    return { text: numerologyBrief(reading, new Date().getFullYear()), birthTimeAssumed: false };
  } catch (error) {
    if (error instanceof ContentError) throw new AiPredictionError(error.message, error.statusCode);
    throw error;
  }
}

export const AiPredictionService = {
  status(): AiPredictStatus {
    const configured = OpenAiClient.isConfigured();
    return {
      configured,
      model: OpenAiClient.model(),
      ready: configured,
      provider: OpenAiClient.provider(),
    };
  },

  async predict(userId: string, input: AiPredictInput): Promise<AiPredictResult> {
    const question = input.question.trim();
    if (question.length < 3) {
      throw new AiPredictionError('Ask a slightly more specific question (at least a few words).');
    }
    const astrologer = input.astrologer ?? 'vedic';

    const brief =
      astrologer === 'numerology'
        ? await numerologyInputs(userId, input)
        : await chartBrief(userId, astrologer, input.includeGochar !== false);

    const history = (input.history ?? []).slice(-6).map(
      (turn): ChatMessage => ({
        role: turn.role,
        content: turn.content.slice(0, 2_000),
      }),
    );

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPTS[astrologer] },
      {
        role: 'system',
        content: `CHART BRIEF (authoritative; do not contradict):\n${brief.text}`,
      },
      ...history,
      { role: 'user', content: question.slice(0, 1_500) },
    ];

    const completion = await OpenAiClient.chatCompletion(messages);

    return {
      astrologer,
      answer: completion.content,
      model: completion.model,
      birthTimeAssumed: brief.birthTimeAssumed,
      chartBrief: brief.text,
      disclaimer: DISCLAIMER,
      usage: {
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
      },
    };
  },
};
