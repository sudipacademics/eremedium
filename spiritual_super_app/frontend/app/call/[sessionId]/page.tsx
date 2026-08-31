'use client';

import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type CallSessionView, type RtcToken } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';

interface BillingTick {
  callSessionId: string;
  minute: number;
  deducted: string;
  balanceAfter: string;
  remainingMinutes: number;
}

interface CallEnded {
  callSessionId: string;
  status: string;
  reason: string;
  totalMinutes: number;
  totalDeducted: string;
}

type Phase = 'joining' | 'waiting' | 'live' | 'ended' | 'error';

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function CallPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();

  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);

  const [phase, setPhase] = useState<Phase>('joining');
  const [session, setSession] = useState<CallSessionView | null>(null);
  const [peerPresent, setPeerPresent] = useState(false);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [tick, setTick] = useState<BillingTick | null>(null);
  const [summary, setSummary] = useState<CallEnded | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // --- Live signalling ---------------------------------------------------------------------------

  useSocketEvent<BillingTick>('BILLING_TICK', (payload) => {
    if (payload.callSessionId === sessionId) setTick(payload);
  });

  useSocketEvent<{ callSessionId: string }>('CALL_STARTED', (payload) => {
    if (payload.callSessionId === sessionId) setPhase('live');
  });

  useSocketEvent<{ remainingMinutes: number; balance: string }>('LOW_BALANCE_WARNING', (payload) => {
    setWarning(
      `Only about ${payload.remainingMinutes} minute(s) left at this rate (₹${payload.balance}). Top up to keep talking.`,
    );
  });

  useSocketEvent<CallEnded>('CALL_ENDED', (payload) => {
    if (payload.callSessionId !== sessionId) return;
    setSummary(payload);
    setPhase('ended');
    void roomRef.current?.disconnect();
  });

  useSocketEvent<{ reason: string }>('FORCE_DISCONNECT', (payload) => {
    setWarning(`Disconnected: ${payload.reason.replaceAll('_', ' ').toLowerCase()}`);
    void roomRef.current?.disconnect();
  });

  // --- Room connection ---------------------------------------------------------------------------

  const connect = useCallback(async () => {
    try {
      const [view, credentials] = await Promise.all([
        api.get<CallSessionView>(`calls/sessions/${sessionId}`),
        api.post<RtcToken>('rtc/token', { callSessionId: sessionId }),
      ]);
      setSession(view);

      if (view.status !== 'INITIATED' && view.status !== 'ACTIVE') {
        setPhase('ended');
        return;
      }

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio && audioContainerRef.current) {
          audioContainerRef.current.appendChild(track.attach());
        }
      });
      room.on(RoomEvent.ParticipantConnected, () => setPeerPresent(true));
      room.on(RoomEvent.ParticipantDisconnected, () => {
        setPeerPresent(false);
        setMessage('The other person left the call.');
      });
      room.on(RoomEvent.Disconnected, () => {
        setPhase((current) => (current === 'ended' ? current : 'ended'));
      });

      await room.connect(credentials.serverUrl, credentials.accessToken);
      await room.localParticipant.setMicrophoneEnabled(true);

      setPeerPresent(room.remoteParticipants.size > 0);

      /*
       * Tell the gateway we are in the room. The LiveKit webhook also activates the session when the
       * second participant joins, and activate() is state-guarded, so both firing is harmless -- but
       * calling it here means the billing clock does not wait on webhook delivery.
       */
      await api.post(`calls/sessions/${sessionId}/activate`).catch(() => undefined);

      setPhase(room.remoteParticipants.size > 0 ? 'live' : 'waiting');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Could not join the call');
      setPhase('error');
    }
  }, [sessionId]);

  useEffect(() => {
    void connect();
    return () => {
      void roomRef.current?.disconnect();
    };
  }, [connect]);

  // Wall-clock timer, purely cosmetic; the billed minute count comes from the server.
  useEffect(() => {
    if (phase !== 'live') return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const hangUp = async () => {
    setMessage('Ending the call…');
    await api.post(`calls/sessions/${sessionId}/end`, { reason: 'USER_HANGUP' }).catch(() => undefined);
    await roomRef.current?.disconnect();
    setPhase('ended');
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  };

  // --- Render ------------------------------------------------------------------------------------

  if (phase === 'ended') {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="card text-center">
          <p className="text-lg font-semibold">Call ended</p>
          {summary ? (
            <>
              <p className="tabular mt-3 text-3xl font-semibold">₹{summary.totalDeducted}</p>
              <p className="mt-1 text-sm text-slate-400">
                {summary.totalMinutes} billed minute{summary.totalMinutes === 1 ? '' : 's'} ·{' '}
                {summary.reason.replaceAll('_', ' ').toLowerCase()}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-400">
              {message ?? 'This consultation is no longer active.'}
            </p>
          )}
        </div>
        <button type="button" className="btn-primary w-full" onClick={() => router.replace('/')}>
          Back to astrologers
        </button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="card border-rose-400/30 bg-rose-500/10">
          <p className="font-semibold text-rose-100">Could not join</p>
          <p className="mt-1 text-sm text-rose-200/80">{message}</p>
        </div>
        <button type="button" className="btn-ghost w-full" onClick={() => router.replace('/')}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div ref={audioContainerRef} className="hidden" />

      <div className="card text-center">
        <div className="relative mx-auto mb-4 grid h-24 w-24 place-items-center">
          {phase === 'live' && (
            <span className="absolute h-24 w-24 rounded-full bg-saffron-500/30 animate-pulse-ring" />
          )}
          <div className="relative grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-saffron-400 to-saffron-600 text-3xl font-semibold text-night-950">
            {session?.astrologer.displayName.charAt(0).toUpperCase() ?? '॥'}
          </div>
        </div>

        <p className="text-lg font-semibold">{session?.astrologer.displayName ?? 'Connecting…'}</p>
        <p className="mt-0.5 text-sm text-slate-400">
          {phase === 'joining'
            ? 'Joining the room…'
            : phase === 'waiting'
              ? 'Waiting for them to join…'
              : peerPresent
                ? 'Connected'
                : 'Reconnecting…'}
        </p>

        {phase === 'live' && (
          <p className="tabular mt-4 text-4xl font-semibold">{formatElapsed(elapsed)}</p>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Rate</span>
          <span className="tabular font-medium">₹{session?.ratePerMinute ?? '—'} / min</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-slate-400">Billed so far</span>
          <span className="tabular font-medium">
            {tick ? `₹${(Number(tick.deducted) * tick.minute).toFixed(2)} · ${tick.minute} min` : '₹0.00 · 0 min'}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-slate-400">Balance</span>
          <span className="tabular font-medium">₹{tick?.balanceAfter ?? '—'}</span>
        </div>
        {tick && (
          <p className="mt-3 text-xs text-slate-500">
            About {tick.remainingMinutes} more minute{tick.remainingMinutes === 1 ? '' : 's'} at this rate.
          </p>
        )}
      </div>

      {warning && (
        <p className="card border-amber-400/30 bg-amber-500/10 text-sm text-amber-100">{warning}</p>
      )}
      {message && phase !== 'joining' && (
        <p className="text-center text-xs text-slate-500">{message}</p>
      )}

      <div className="flex gap-3">
        <button type="button" className="btn-ghost flex-1" onClick={() => void toggleMute()}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" className="btn-danger flex-1" onClick={() => void hangUp()}>
          End call
        </button>
      </div>
    </div>
  );
}
