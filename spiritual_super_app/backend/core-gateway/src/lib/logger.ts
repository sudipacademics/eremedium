import { pino, type Logger } from 'pino';

import { env } from '../config/env.js';

export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'core-gateway' },
  redact: {
    paths: ['req.headers.authorization', 'token', '*.token', 'accessToken'],
    censor: '[redacted]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
