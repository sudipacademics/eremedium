import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * jsdom has no WebSocket and no server to fetch from. The shell mounts the signalling channel for
 * authenticated users, so both need to exist as inert stubs or every render would reject.
 */
class InertWebSocket {
  static readonly OPEN = 1;
  readonly readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(): void {}
  close(): void {}
}

vi.stubGlobal('WebSocket', InertWebSocket);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.stubGlobal('WebSocket', InertWebSocket);
  vi.restoreAllMocks();
});
