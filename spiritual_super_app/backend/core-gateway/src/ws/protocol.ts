import { z } from 'zod';

/** Server -> client event names. */
export const ServerEvent = {
  CONNECTED: 'CONNECTED',
  ERROR: 'ERROR',
  QUEUE_POSITION: 'QUEUE_POSITION',
  QUEUE_LEFT: 'QUEUE_LEFT',
  CALL_READY: 'CALL_READY',
  CALL_STARTED: 'CALL_STARTED',
  CALL_ENDED: 'CALL_ENDED',
  BILLING_TICK: 'BILLING_TICK',
  LOW_BALANCE_WARNING: 'LOW_BALANCE_WARNING',
  FORCE_DISCONNECT: 'FORCE_DISCONNECT',
  ASTROLOGER_STATUS: 'ASTROLOGER_STATUS',
  PUJA_REMEDY_CARD: 'PUJA_REMEDY_CARD',
  PUJA_REMEDY_RESULT: 'PUJA_REMEDY_RESULT',
  /** Fulfilment progress on a booked puja: scheduled, performed, prasad posted. */
  PUJA_BOOKING_UPDATED: 'PUJA_BOOKING_UPDATED',
} as const;

export type ServerEvent = (typeof ServerEvent)[keyof typeof ServerEvent];

/** Client -> server messages. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PING') }),
  z.object({
    type: z.literal('ASTROLOGER_SET_STATUS'),
    status: z.enum(['ONLINE', 'BUSY', 'OFFLINE']),
  }),
  z.object({
    type: z.literal('USER_JOIN_QUEUE'),
    astrologerId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('USER_LEAVE_QUEUE'),
    astrologerId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('USER_QUEUE_POSITION'),
    astrologerId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('ASTROLOGER_PUSH_REMEDY'),
    callSessionId: z.string().uuid(),
    /*
     * The offering identifies the puja AND its price. This message used to carry `templeId`,
     * `pujaName` and `packagePrice`, which meant the astrologer on the call decided what the devotee
     * was charged -- the client set the price. Both now come from the catalog.
     */
    pujaOfferingId: z.string().uuid(),
    sankalpWish: z.string().max(1000).optional(),
    expiresInSeconds: z.number().int().min(30).max(1800).default(600),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface OutboundEnvelope<TPayload = unknown> {
  readonly event: ServerEvent;
  readonly payload: TPayload;
  readonly emittedAt: string;
}

/** Cross-instance fan-out envelope published on Redis pub/sub. */
export interface BroadcastEnvelope {
  readonly userIds: readonly string[];
  readonly message: OutboundEnvelope;
}

export function envelope<TPayload>(event: ServerEvent, payload: TPayload): OutboundEnvelope<TPayload> {
  return { event, payload, emittedAt: new Date().toISOString() };
}
