import type { WebSocket } from 'ws';

import { logger } from '../lib/logger.js';
import { redisChannels, redisPublisher, redisSubscriber } from '../lib/redis.js';
import { envelope, type BroadcastEnvelope, type OutboundEnvelope, type ServerEvent } from './protocol.js';

/**
 * Connection registry for this process, fronted by Redis pub/sub so that any gateway replica or the
 * standalone billing worker can address a socket held by another process.
 */
class ConnectionHub {
  private readonly socketsByUser = new Map<string, Set<WebSocket>>();
  private subscribed = false;

  async initialise(): Promise<void> {
    if (this.subscribed) {
      return;
    }
    await redisSubscriber.subscribe(redisChannels.clientEvents);
    redisSubscriber.on('message', (channel, raw) => {
      if (channel !== redisChannels.clientEvents) {
        return;
      }
      let parsed: BroadcastEnvelope;
      try {
        parsed = JSON.parse(raw) as BroadcastEnvelope;
      } catch (error) {
        logger.warn({ err: error }, 'Dropped malformed broadcast envelope');
        return;
      }
      for (const userId of parsed.userIds) {
        this.deliverLocally(userId, parsed.message);
      }
    });
    this.subscribed = true;
    logger.info('WebSocket hub subscribed to Redis fan-out');
  }

  register(userId: string, socket: WebSocket): void {
    const existing = this.socketsByUser.get(userId);
    if (existing) {
      existing.add(socket);
    } else {
      this.socketsByUser.set(userId, new Set([socket]));
    }
  }

  unregister(userId: string, socket: WebSocket): void {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) {
      return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.socketsByUser.delete(userId);
    }
  }

  isOnline(userId: string): boolean {
    return (this.socketsByUser.get(userId)?.size ?? 0) > 0;
  }

  localConnectionCount(): number {
    let total = 0;
    for (const sockets of this.socketsByUser.values()) {
      total += sockets.size;
    }
    return total;
  }

  /** Deliver only to sockets held by this process. */
  deliverLocally(userId: string, message: OutboundEnvelope): void {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets || sockets.size === 0) {
      return;
    }
    const serialised = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket.readyState !== socket.OPEN) {
        continue;
      }
      socket.send(serialised, (error) => {
        if (error) {
          logger.warn({ err: error, userId, event: message.event }, 'WebSocket send failed');
        }
      });
    }
  }

  /** Cluster-wide emit: delivered locally and published for every other replica. */
  async emitToUsers<TPayload>(
    userIds: readonly string[],
    event: ServerEvent,
    payload: TPayload,
  ): Promise<void> {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) {
      return;
    }
    const message = envelope(event, payload);
    const broadcast: BroadcastEnvelope = { userIds: uniqueIds, message };
    await redisPublisher.publish(redisChannels.clientEvents, JSON.stringify(broadcast));
  }

  async emitToUser<TPayload>(userId: string, event: ServerEvent, payload: TPayload): Promise<void> {
    await this.emitToUsers([userId], event, payload);
  }

  closeAll(code = 1001, reason = 'Server shutting down'): void {
    for (const sockets of this.socketsByUser.values()) {
      for (const socket of sockets) {
        socket.close(code, reason);
      }
    }
    this.socketsByUser.clear();
  }
}

export const hub = new ConnectionHub();
