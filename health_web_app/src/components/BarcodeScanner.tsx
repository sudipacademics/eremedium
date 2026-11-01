import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import './barcode-scanner.css';

export type ScanFormat = 'code_128' | 'code_39' | 'qr_code' | 'ean_13' | 'ean_8' | 'upc_a' | 'itf' | 'data_matrix';

export const DEFAULT_SCAN_FORMATS: ScanFormat[] = ['code_128', 'qr_code', 'ean_13', 'ean_8'];

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  formats?: ScanFormat[];
  title?: string;
  hint?: string;
  /** Return an error message to reject a code (e.g. wrong prefix / check digit) and keep scanning. */
  validate?: (code: string) => string | null;
  /** Keep the camera running after a detection (batch scanning). */
  continuous?: boolean;
};

type DetectedBarcode = { rawValue: string; format: string };
type NativeDetector = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type NativeDetectorCtor = {
  new (options?: { formats?: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type Stopper = { stop: () => void };

const ZXING_FORMAT: Record<ScanFormat, string> = {
  code_128: 'CODE_128',
  code_39: 'CODE_39',
  qr_code: 'QR_CODE',
  ean_13: 'EAN_13',
  ean_8: 'EAN_8',
  upc_a: 'UPC_A',
  itf: 'ITF',
  data_matrix: 'DATA_MATRIX',
};

const WEDGE_MAX_GAP_MS = 60;
const REPEAT_GUARD_MS = 1500;

function nativeDetectorCtor(): NativeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

async function nativeDetectorFor(formats: ScanFormat[]): Promise<NativeDetector | null> {
  const Ctor = nativeDetectorCtor();
  if (!Ctor) return null;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? [];
    const usable = formats.filter((f) => supported.includes(f));
    if (!usable.length) return null;
    return new Ctor({ formats: usable });
  } catch {
    return null;
  }
}

/** Camera barcode / QR scanner with manual entry; also accepts keyboard-wedge (USB / Bluetooth) scanners. */
export function BarcodeScanner({
  open,
  onClose,
  onDetected,
  formats = DEFAULT_SCAN_FORMATS,
  title = 'Scan barcode',
  hint = 'Point the camera at the barcode. A USB / Bluetooth scanner also works here.',
  validate,
  continuous = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<Stopper | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const wedgeRef = useRef<{ buf: string; at: number }>({ buf: '', at: 0 });
  const [status, setStatus] = useState<'idle' | 'starting' | 'scanning' | 'no-camera'>('idle');
  const [engine, setEngine] = useState<'native' | 'zxing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [manual, setManual] = useState('');

  const formatsKey = formats.join(',');

  const stopCamera = useCallback(() => {
    stopRef.current?.stop();
    stopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTorchAvailable(false);
    setTorchOn(false);
  }, []);

  const accept = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code) return false;
      const now = Date.now();
      if (lastRef.current.code === code && now - lastRef.current.at < REPEAT_GUARD_MS) return false;
      lastRef.current = { code, at: now };
      const problem = validate?.(code) ?? null;
      if (problem) {
        setError(problem);
        return false;
      }
      setError(null);
      try {
        navigator.vibrate?.(60);
      } catch {
        /* not supported */
      }
      if (!continuous) stopCamera();
      onDetected(code);
      return true;
    },
    [continuous, onDetected, stopCamera, validate],
  );
  // Parents usually pass inline callbacks; the camera effect reads the latest one without restarting.
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setManual('');
    setError(null);
    lastRef.current = { code: '', at: 0 };

    async function start() {
      const video = videoRef.current;
      if (!video || !navigator.mediaDevices?.getUserMedia) {
        setStatus('no-camera');
        return;
      }
      setStatus('starting');
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        if (!cancelled) setStatus('no-camera');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as TorchCapabilities;
      setTorchAvailable(Boolean(caps.torch));

      const native = await nativeDetectorFor(formats);
      if (cancelled) return;
      if (native) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        setEngine('native');
        setStatus('scanning');
        let busy = false;
        const timer = window.setInterval(async () => {
          if (busy || video.readyState < 2) return;
          busy = true;
          try {
            const found = await native.detect(video);
            for (const hit of found) {
              if (acceptRef.current(hit.rawValue)) break;
            }
          } catch {
            /* frame not ready */
          } finally {
            busy = false;
          }
        }, 220);
        stopRef.current = { stop: () => window.clearInterval(timer) };
        return;
      }

      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (cancelled) return;
        const hints = new Map();
        const wanted = formats
          .map((f) => (BarcodeFormat as unknown as Record<string, number>)[ZXING_FORMAT[f]])
          .filter((v) => typeof v === 'number');
        if (wanted.length) hints.set(DecodeHintType.POSSIBLE_FORMATS, wanted);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (result) acceptRef.current(result.getText());
        });
        if (cancelled) {
          controls.stop();
          return;
        }
        stopRef.current = controls;
        setEngine('zxing');
        setStatus('scanning');
      } catch {
        if (!cancelled) {
          setError('Camera scanning is not available on this device. Type the code instead.');
          setStatus('no-camera');
        }
      }
    }

    void start();
    window.setTimeout(() => manualRef.current?.focus(), 50);
    return () => {
      cancelled = true;
      stopCamera();
      setStatus('idle');
      setEngine(null);
    };
    // formatsKey stands in for the formats array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, formatsKey, stopCamera]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const now = Date.now();
      const w = wedgeRef.current;
      if (now - w.at > WEDGE_MAX_GAP_MS * 4) w.buf = '';
      w.at = now;
      if (e.key === 'Enter') {
        if (w.buf.length >= 3) acceptRef.current(w.buf);
        w.buf = '';
      } else if (e.key.length === 1) {
        w.buf += e.key;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  function submitManual(e: FormEvent) {
    e.preventDefault();
    if (accept(manual)) setManual('');
  }

  if (!open) return null;

  return (
    <div className="bcs-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bcs-card">
        <header className="bcs-head">
          <h2>{title}</h2>
          <button type="button" className="bcs-close" onClick={onClose} aria-label="Close scanner">
            ×
          </button>
        </header>
        <div className={`bcs-view${status === 'no-camera' ? ' bcs-view-off' : ''}`}>
          <video ref={videoRef} className="bcs-video" muted playsInline autoPlay />
          {status === 'scanning' ? <div className="bcs-frame" aria-hidden /> : null}
          {status === 'starting' ? <p className="bcs-overlay">Starting camera…</p> : null}
          {status === 'no-camera' ? <p className="bcs-overlay">Camera unavailable. Type or wedge-scan the code below.</p> : null}
          {torchAvailable ? (
            <button type="button" className={`bcs-torch${torchOn ? ' on' : ''}`} onClick={() => void toggleTorch()}>
              {torchOn ? 'Torch off' : 'Torch on'}
            </button>
          ) : null}
        </div>
        <p className="bcs-hint">
          {hint}
          {engine === 'zxing' ? ' (compatibility mode)' : ''}
        </p>
        {error ? <p className="bcs-error">{error}</p> : null}
        <form className="bcs-manual" onSubmit={submitManual}>
          <input
            ref={manualRef}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Or type the code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Barcode value"
          />
          <button type="submit" className="btn" disabled={!manual.trim()}>
            Use code
          </button>
        </form>
      </div>
    </div>
  );
}
