import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

export function SmartSyncPage() {
  const [rawText, setRawText] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [mime, setMime] = useState('image/jpeg');
  const [result, setResult] = useState<{
    ocr_text?: string;
    medicines?: Array<{
      raw_name?: string;
      best?: { name: string; item_name?: string } | null;
    }>;
    diagnostics?: Array<{
      raw_name?: string;
      best?: { name: string; test_name?: string } | null;
    }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(file: File | null) {
    if (!file) return;
    setMime(file.type || 'image/jpeg');
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setPreview(dataUrl);
      const b64 = dataUrl.includes(',') ? dataUrl.split(',', 2)[1] : dataUrl;
      setImageB64(b64);
    };
    reader.readAsDataURL(file);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.smartsyncParsePrescription({
        ...(imageB64 ? { image_base64: imageB64, mime_type: mime } : {}),
        ...(rawText.trim() ? { raw_text: rawText.trim() } : {}),
      });
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SmartSync failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">AI Practice</p>
          <h1>SmartSync</h1>
          <p className="muted">Photograph or paste a paper Rx — match medicines and labs to your catalog.</p>
        </div>
        <Link className="btn btn-ghost" to="/dashboard/provider">
          Provider portal
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <form className="card" onSubmit={submit}>
        <label>
          Prescription photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => onFile(e.target.files?.[0] || null)}
          />
        </label>
        {preview ? (
          <img src={preview} alt="Rx preview" style={{ maxWidth: '100%', maxHeight: 240, objectFit: 'contain' }} />
        ) : null}
        <label>
          Or paste OCR / handwritten text
          <textarea rows={5} value={rawText} onChange={(e) => setRawText(e.target.value)} />
        </label>
        <button className="btn" type="submit" disabled={busy || (!imageB64 && !rawText.trim())}>
          {busy ? 'Parsing…' : 'Parse prescription'}
        </button>
      </form>

      {result ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>OCR text</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{result.ocr_text}</pre>
          <h3>Matched medicines</h3>
          <ul>
            {(result.medicines || []).map((m, i) => (
              <li key={`${m.raw_name}-${i}`}>
                {m.raw_name}
                {m.best ? ` → ${m.best.item_name || m.best.name}` : ' → no catalog match'}
              </li>
            ))}
          </ul>
          <h3>Matched diagnostics</h3>
          <ul>
            {(result.diagnostics || []).map((d, i) => (
              <li key={`${d.raw_name}-${i}`}>
                {d.raw_name}
                {d.best ? ` → ${d.best.test_name || d.best.name}` : ' → no catalog match'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
