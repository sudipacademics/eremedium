import { useEffect, useState } from 'react';
import { api } from '../api';

type Props = {
  referenceDoctype: 'Customer TRF' | 'Pharmacy Order';
  referenceName: string;
  label?: string;
  className?: string;
  disabled?: boolean;
};

/** Exotel click-to-call — both parties see the virtual number only. */
export function MaskedCallButton({
  referenceDoctype,
  referenceName,
  label = 'Call (masked)',
  className = 'btn secondary btn-sm',
  disabled,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [blockReason, setBlockReason] = useState<string | null>(null);

  useEffect(() => {
    if (!referenceName) {
      setReady(false);
      setBlockReason('No document selected');
      return;
    }
    let cancelled = false;
    void api
      .getMaskedCallContext(referenceDoctype, referenceName)
      .then((res) => {
        if (cancelled) return;
        const data = res.data;
        const ok = Boolean(data?.ready && data?.available !== false);
        setReady(ok);
        setBlockReason(ok ? null : data?.reason || 'Masked calling unavailable');
      })
      .catch((e) => {
        if (cancelled) return;
        setReady(false);
        setBlockReason(e instanceof Error ? e.message : 'Masked calling unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [referenceDoctype, referenceName]);

  async function onCall() {
    if (!referenceName || busy || ready === false) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.startMaskedCall(referenceDoctype, referenceName);
      const peer = res.data.peer_label || 'party';
      setMsg(`Calling ${peer} via masked number… Answer your phone.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Call failed');
    } finally {
      setBusy(false);
    }
  }

  const blocked = disabled || busy || !referenceName || ready === false;

  return (
    <span className="masked-call-wrap" style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        className={className}
        disabled={blocked}
        title={blockReason || undefined}
        onClick={() => void onCall()}
      >
        {busy ? 'Connecting…' : ready === false ? 'Call unavailable' : label}
      </button>
      {ready === false && blockReason ? (
        <span className="muted" style={{ fontSize: 12 }}>
          {blockReason}
        </span>
      ) : null}
      {msg ? (
        <span className="muted" style={{ fontSize: 12 }}>
          {msg}
        </span>
      ) : null}
      {err ? (
        <span className="error" style={{ fontSize: 12 }}>
          {err}
        </span>
      ) : null}
    </span>
  );
}
