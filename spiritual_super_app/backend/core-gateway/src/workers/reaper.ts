import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { CallService } from '../services/call.service.js';

const reaperLogger = logger.child({ component: 'StaleSessionReaper' });

export interface StoppableReaper {
  stop: () => void;
}

/**
 * Periodically sweeps sessions that no other mechanism closed.
 *
 * A plain interval rather than a BullMQ repeatable job: the sweep is idempotent and already
 * serialised across replicas by a Redlock inside `reapStaleSessions`, so a queue would add moving
 * parts without adding safety.
 */
export function startStaleSessionReaper(): StoppableReaper {
  const intervalMs = env.STALE_SESSION_SWEEP_SECONDS * 1_000;

  const timer = setInterval(() => {
    void CallService.reapStaleSessions().catch((error: unknown) => {
      // Never let a sweep failure take the process down; the next tick retries.
      reaperLogger.error({ err: error }, 'Stale session sweep failed');
    });
  }, intervalMs);

  // Do not hold the event loop open during shutdown.
  timer.unref();

  reaperLogger.info({ sweepSeconds: env.STALE_SESSION_SWEEP_SECONDS }, 'Stale session reaper started');

  return {
    stop: () => clearInterval(timer),
  };
}
