'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { session } from './api';

export type ServerEventName =
  | 'CONNECTED'
  | 'ERROR'
  | 'QUEUE_POSITION'
  | 'QUEUE_LEFT'
  | 'CALL_READY'
  | 'CALL_STARTED'
  | 'CALL_ENDED'
  | 'BILLING_TICK'
  | 'LOW_BALANCE_WARNING'
  | 'FORCE_DISCONNECT'
  | 'ASTROLOGER_STATUS'
  | 'PUJA_REMEDY_CARD'
  | 'PUJA_REMEDY_RESULT'
  | 'PUJA_BOOKING_UPDATED';

export interface Envelope<T = Record<string, unknown>> {
  event: ServerEventName;
  payload: T;
  emittedAt: string;
}

type Listener = (envelope: Envelope) => void;

interface SocketApi {
  status: 'idle' | 'connecting' | 'open' | 'closed';
  send: (message: Record<string, unknown>) => void;
  subscribe: (listener: Listener) => () => void;
  lastError: string | null;
}

const SocketContext = createContext<SocketApi | null>(null);

/**
 * The single signalling channel to the gateway.
 *
 * The token travels as a query parameter because browsers cannot set custom headers on a WebSocket
 * handshake; the gateway accepts either that or an Authorization header for non-browser clients.
 *
 * Note this connection is load-bearing beyond messaging: the matching worker refuses to hand a
 * waiting user to an astrologer unless the user has a live socket, so being connected is a
 * precondition for ever being matched.
 */
export function SocketProvider({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState<SocketApi['status']>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<Listener>>(new Set());
  const retryRef = useRef(0);
  const closedByUsRef = useRef(false);

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const send = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      setLastError('Not connected to the live channel yet');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = async (): Promise<void> => {
      const token = session.token;
      if (!token || cancelled) {
        return;
      }

      let base = '';
      try {
        const config = (await (await fetch('/api/runtime-config')).json()) as { wsUrl?: string };
        base = config.wsUrl ?? '';
      } catch {
        base = '';
      }
      if (!base) {
        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        base = `${scheme}://${window.location.host}/api/v1/ws`;
      }
      if (cancelled) return;

      setStatus('connecting');
      const socket = new WebSocket(`${base}?token=${encodeURIComponent(token)}`);
      socketRef.current = socket;

      socket.onopen = () => {
        retryRef.current = 0;
        setStatus('open');
        setLastError(null);
      };

      socket.onmessage = (event) => {
        try {
          const envelope = JSON.parse(String(event.data)) as Envelope;
          if (envelope.event === 'ERROR') {
            setLastError(String((envelope.payload as { message?: string }).message ?? 'Server error'));
          }
          listenersRef.current.forEach((listener) => listener(envelope));
        } catch {
          // A malformed frame should never take the UI down.
        }
      };

      socket.onclose = () => {
        setStatus('closed');
        if (cancelled || closedByUsRef.current) return;
        // Capped exponential backoff. Reconnecting matters: a dropped socket makes the user
        // invisible to the matching worker.
        retryRef.current = Math.min(retryRef.current + 1, 6);
        reconnectTimer = setTimeout(() => void connect(), 500 * 2 ** retryRef.current);
      };

      socket.onerror = () => setLastError('Live channel error');
    };

    void connect();

    return () => {
      cancelled = true;
      closedByUsRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, []);

  const value = useMemo<SocketApi>(
    () => ({ status, send, subscribe, lastError }),
    [status, send, subscribe, lastError],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketApi {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used inside SocketProvider');
  }
  return context;
}

/** Subscribe to one event name for the lifetime of a component. */
export function useSocketEvent<T = Record<string, unknown>>(
  event: ServerEventName,
  handler: (payload: T) => void,
): void {
  const { subscribe } = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(
    () =>
      subscribe((envelope) => {
        if (envelope.event === event) {
          handlerRef.current(envelope.payload as T);
        }
      }),
    [event, subscribe],
  );
}
