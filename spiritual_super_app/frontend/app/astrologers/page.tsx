'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, type Astrologer, type WalletBalance } from '@/lib/api';
import { useSocket, useSocketEvent } from '@/lib/socket';

interface QueuePosition {
  astrologerId: string;
  position: number;
  waitingAhead: number;
  estimatedWaitMinutes: number;
  queueLength: number;
}

const STATUS_STYLES: Record<Astrologer['status'], string> = {
  IDLE: 'bg-emerald-500/15 text-emerald-300',
  BUSY: 'bg-amber-500/15 text-amber-300',
  IN_CALL: 'bg-amber-500/15 text-amber-300',
  OFFLINE: 'bg-slate-500/15 text-slate-400',
};

const STATUS_LABELS: Record<Astrologer['status'], string> = {
  IDLE: 'Available now',
  BUSY: 'Busy',
  IN_CALL: 'On a call',
  OFFLINE: 'Offline',
};

export default function AstrologersPage() {
  const router = useRouter();
  const { send, status: socketStatus } = useSocket();
  const [astrologers, setAstrologers] = useState<Astrologer[]>([]);
  const [balance, setBalance] = useState<string>('0.00');
  const [queued, setQueued] = useState<QueuePosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    void Promise.all([
      api.get<{ astrologers: Astrologer[] }>('astrologers?onlineOnly=false&limit=50'),
      api.get<WalletBalance>('wallet/balance'),
    ])
      .then(([list, wallet]) => {
        setAstrologers(list.astrologers);
        setBalance(wallet.balance);
      })
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  useSocketEvent<QueuePosition>('QUEUE_POSITION', (payload) => setQueued(payload));
  useSocketEvent<{ reason?: string }>('QUEUE_LEFT', (payload) => {
    setQueued(null);
    if (payload.reason) {
      setNotice(`Left the queue: ${payload.reason.replaceAll('_', ' ').toLowerCase()}`);
    }
    load();
  });

  // The astrologer accepted: the gateway has already created the session and reserved them.
  useSocketEvent<{ callSessionId: string }>('CALL_READY', (payload) => {
    setQueued(null);
    router.push(`/call/${payload.callSessionId}`);
  });

  const join = (astrologer: Astrologer) => {
    setNotice(null);
    if (Number(balance) < Number(astrologer.minimumBalanceRequired)) {
      setNotice(
        `You need at least ₹${astrologer.minimumBalanceRequired} to start a call at ₹${astrologer.perMinuteRate}/min. Top up your wallet first.`,
      );
      return;
    }
    // Sent over the socket rather than REST: the matching worker only hands a call to a user with a
    // live socket, so using the same channel guarantees we are visible to it.
    send({ type: 'USER_JOIN_QUEUE', astrologerId: astrologer.id });
  };

  const leave = (astrologerId: string) => {
    send({ type: 'USER_LEAVE_QUEUE', astrologerId });
    setQueued(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Talk to an astrologer</h1>
          <p className="text-sm text-slate-400">
            You are charged per minute, only while connected.
          </p>
        </div>
        {socketStatus !== 'open' && (
          <p className="pill bg-amber-500/10 text-amber-200">
            Connecting to the live channel — joining a queue needs it
          </p>
        )}
      </div>

      {notice && (
        <p className="card border-amber-400/20 bg-amber-500/10 text-sm text-amber-100">{notice}</p>
      )}

      {queued && (
        <div className="card border-saffron-400/30 bg-saffron-500/10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-saffron-100">
                You are #{queued.position} in the queue
              </p>
              <p className="text-sm text-saffron-200/70">
                {queued.waitingAhead === 0
                  ? 'You are next — keep this tab open.'
                  : `About ${queued.estimatedWaitMinutes} min wait. Keep this tab open.`}
              </p>
            </div>
            <button type="button" className="btn-ghost" onClick={() => leave(queued.astrologerId)}>
              Leave
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="card h-32 animate-pulse bg-white/[0.03]" />
          ))}
        </div>
      ) : astrologers.length === 0 ? (
        <div className="card text-center">
          <p className="font-medium">No astrologers have joined yet</p>
          <p className="mt-1 text-sm text-slate-400">
            Sign in with another number and apply from the console to list yourself.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {astrologers.map((astrologer) => {
            const affordable = Number(balance) >= Number(astrologer.minimumBalanceRequired);
            const available = astrologer.status === 'IDLE';
            return (
              <div key={astrologer.id} className="card flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-saffron-400 to-saffron-600 text-lg font-semibold text-night-950">
                      {astrologer.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium leading-tight">{astrologer.displayName}</p>
                      <p className="text-xs text-slate-400">{astrologer.languages.join(' · ')}</p>
                    </div>
                  </div>
                  <span className={`pill ${STATUS_STYLES[astrologer.status]}`}>
                    {STATUS_LABELS[astrologer.status]}
                  </span>
                </div>

                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="tabular text-lg font-semibold">₹{astrologer.perMinuteRate}</p>
                    <p className="text-xs text-slate-400">
                      per minute · min ₹{astrologer.minimumBalanceRequired} to start
                    </p>
                  </div>
                  <button
                    type="button"
                    className={affordable ? 'btn-primary' : 'btn-ghost'}
                    disabled={!available || queued !== null || socketStatus !== 'open'}
                    onClick={() => join(astrologer)}
                  >
                    {!available ? 'Unavailable' : affordable ? 'Talk now' : 'Top up to talk'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
