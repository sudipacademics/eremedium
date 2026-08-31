import { AccessToken, RoomServiceClient, type CreateOptions } from 'livekit-server-sdk';

import { AppRole } from '../auth/jwt.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Prisma, money, prisma } from '../lib/prisma.js';
import { InsufficientFundsError, WalletService } from './wallet.service.js';

/** LiveKit's HTTP admin API lives on the same host/port as the signalling WebSocket. */
const livekitHttpUrl = env.LIVEKIT_URL.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');

const roomService = new RoomServiceClient(livekitHttpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

export interface MintedRtcToken {
  readonly accessToken: string;
  readonly roomName: string;
  readonly identity: string;
  readonly serverUrl: string;
  readonly expiresInSeconds: number;
  readonly minimumBalanceRequired: string;
  readonly walletBalance: string;
}

export class RoomAdmissionError extends Error {
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = 'RoomAdmissionError';
  }
}

function participantIdentity(role: AppRole, userId: string): string {
  return `${role.toLowerCase()}:${userId}`;
}

export const LiveKitTokenService = {
  /** Balance floor a user must clear before we let them into a paid room. */
  minimumBalanceFor(perMinuteRate: Prisma.Decimal | string): Prisma.Decimal {
    return money(money(perMinuteRate).times(env.MIN_CALL_MINUTES_BUFFER));
  },

  async ensureRoom(roomName: string, maxParticipants = 2): Promise<void> {
    const options: CreateOptions = {
      name: roomName,
      maxParticipants,
      emptyTimeout: 60,
      departureTimeout: 20,
    };
    try {
      await roomService.createRoom(options);
    } catch (error) {
      // A concurrent joiner may have created it first; only unexpected failures should propagate.
      const rooms = await roomService.listRooms([roomName]);
      if (rooms.length === 0) {
        throw error;
      }
    }
  },

  /**
   * Mints a room-scoped JWT for the *user* side of a 1:1 consultation, but only once the wallet can
   * fund `MIN_CALL_MINUTES_BUFFER` minutes at the astrologer's rate.
   */
  async mintUserToken(params: {
    userId: string;
    astrologerId: string;
    roomName: string;
  }): Promise<MintedRtcToken> {
    const astrologer = await prisma.astrologer.findUnique({
      where: { id: params.astrologerId },
      select: { id: true, perMinuteRate: true, status: true, displayName: true },
    });
    if (!astrologer) {
      throw new RoomAdmissionError(`Astrologer ${params.astrologerId} not found`);
    }

    const minimumBalance = this.minimumBalanceFor(astrologer.perMinuteRate);
    const { balance, walletId } = await WalletService.getBalanceByUserId(params.userId);
    if (balance.lessThan(minimumBalance)) {
      throw new InsufficientFundsError(walletId, minimumBalance, balance);
    }

    await this.ensureRoom(params.roomName);

    const identity = participantIdentity(AppRole.USER, params.userId);
    const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity,
      ttl: env.LIVEKIT_TOKEN_TTL_SECONDS,
      metadata: JSON.stringify({ role: AppRole.USER, userId: params.userId }),
    });
    token.addGrant({
      room: params.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
    });

    logger.info(
      { userId: params.userId, astrologerId: astrologer.id, room: params.roomName },
      'Minted user RTC token',
    );

    return {
      accessToken: await token.toJwt(),
      roomName: params.roomName,
      identity,
      serverUrl: env.LIVEKIT_PUBLIC_URL,
      expiresInSeconds: env.LIVEKIT_TOKEN_TTL_SECONDS,
      minimumBalanceRequired: minimumBalance.toFixed(2),
      walletBalance: balance.toFixed(2),
    };
  },

  /** Astrologer side: no solvency check (they are the payee), but still room-scoped and short lived. */
  async mintAstrologerToken(params: {
    astrologerUserId: string;
    roomName: string;
  }): Promise<MintedRtcToken> {
    await this.ensureRoom(params.roomName);

    const identity = participantIdentity(AppRole.ASTROLOGER, params.astrologerUserId);
    const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity,
      ttl: env.LIVEKIT_TOKEN_TTL_SECONDS,
      metadata: JSON.stringify({ role: AppRole.ASTROLOGER, userId: params.astrologerUserId }),
    });
    token.addGrant({
      room: params.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
    });

    return {
      accessToken: await token.toJwt(),
      roomName: params.roomName,
      identity,
      serverUrl: env.LIVEKIT_PUBLIC_URL,
      expiresInSeconds: env.LIVEKIT_TOKEN_TTL_SECONDS,
      minimumBalanceRequired: '0.00',
      walletBalance: '0.00',
    };
  },

  /**
   * Asks LiveKit who is actually in the room.
   *
   * This is the authoritative answer to "is this call still happening?", used by the billing tick as
   * a backstop that does not depend on a webhook arriving or a client behaving. Returns null when
   * LiveKit cannot be reached, which callers MUST treat as "unknown" rather than "empty" -- billing
   * decisions must never be made on a failed admin call.
   */
  async countParticipants(roomName: string): Promise<number | null> {
    try {
      const participants = await roomService.listParticipants(roomName);
      return participants.length;
    } catch (error) {
      // A deleted/expired room throws here too, but we cannot distinguish that from a transport
      // failure, so the caller decides.
      logger.warn({ err: error, roomName }, 'Could not list room participants');
      return null;
    }
  },

  /** Broadcast a structured data message into the room (used for FORCE_DISCONNECT). */
  async publishRoomData(roomName: string, payload: unknown): Promise<void> {
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    try {
      await roomService.sendData(roomName, encoded, 0 /* RELIABLE */, {});
    } catch (error) {
      logger.warn({ err: error, roomName }, 'Failed to publish room data');
    }
  },

  async removeUserFromRoom(roomName: string, role: AppRole, userId: string): Promise<void> {
    try {
      await roomService.removeParticipant(roomName, participantIdentity(role, userId));
    } catch (error) {
      logger.warn({ err: error, roomName, userId }, 'Participant removal failed (may already be gone)');
    }
  },

  async closeRoom(roomName: string): Promise<void> {
    try {
      await roomService.deleteRoom(roomName);
    } catch (error) {
      logger.warn({ err: error, roomName }, 'Room deletion failed (may already be closed)');
    }
  },
} as const;
