import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { FileUpload, formatBytes, type UploadedFile } from '../../components/FileUpload';
import { LocationField } from '../../components/LocationField';
import type { PfCreateRequestPayload } from '../../types/phlebofirst';
import './pf.css';

type Gender = PfCreateRequestPayload['patient_gender'];
type Field = 'file' | 'name' | 'phone' | 'age' | 'gender' | 'address' | 'window';
type Errors = Partial<Record<Field, string>>;

function normalizePhone(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** datetime-local value ("YYYY-MM-DDTHH:mm") → backend datetime string. */
function toBackendDatetime(local: string) {
  return local ? `${local.slice(0, 16).replace('T', ' ')}:00` : '';
}

export function PfUploadPage({ basePath }: { basePath: string }) {
  const navigate = useNavigate();
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [patientName, setPatientName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [suggestedTests, setSuggestedTests] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function validate(): Errors {
    const out: Errors = {};
    if (!file) out.file = 'Attach a photo or PDF of the prescription / TRF.';
    const name = patientName.trim();
    if (name.length < 2 || name.length > 140) out.name = 'Patient name must be 2–140 characters.';
    if (!/^[6-9]\d{9}$/.test(normalizePhone(phone))) out.phone = 'Enter a 10-digit Indian mobile number starting with 6–9.';
    const ageNum = Number(age);
    if (age.trim() === '' || !Number.isInteger(ageNum) || ageNum < 0 || ageNum > 120) out.age = 'Age must be a whole number from 0 to 120.';
    if (!gender) out.gender = 'Select gender.';
    if (address.trim().length < 8) out.address = 'Enter the full pickup address (at least 8 characters).';
    if (windowStart && windowEnd && new Date(windowEnd).getTime() <= new Date(windowStart).getTime()) {
      out.window = 'Window end must be after the start.';
    }
    return out;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const found = validate();
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length || !file || !gender) return;
    const payload: PfCreateRequestPayload = {
      patient_name: patientName.trim(),
      patient_phone: normalizePhone(phone),
      patient_age: Number(age),
      patient_gender: gender,
      pickup_address: address.trim(),
      pickup_area: area.trim() || undefined,
      pickup_lat: coords?.lat ?? null,
      pickup_lng: coords?.lng ?? null,
      preferred_window_start: toBackendDatetime(windowStart) || undefined,
      preferred_window_end: toBackendDatetime(windowEnd) || undefined,
      suggested_tests: suggestedTests.trim() || undefined,
      notes: notes.trim() || undefined,
      file_base64: file.base64,
      file_name: file.name,
    };
    setBusy(true);
    try {
      const res = await api.pfCreateRequest(payload);
      navigate(`${basePath}/${encodeURIComponent(res.data.name)}`, { replace: true });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not submit the request');
      setBusy(false);
    }
  }

  const errorCount = Object.values(errors).filter(Boolean).length;

  return (
    <div className="pf-page">
      <Link className="pf-back" to={basePath}>
        ‹ My requests
      </Link>
      <h1 className="partners-page-title">New PhleboFirst request</h1>
      <p className="partners-page-lead">
        Upload the prescription or TRF. The lab reviews it, sends a quotation and a phlebotomist collects the sample at the
        pickup address.
      </p>

      <form className="pf-form" onSubmit={(e) => void onSubmit(e)} noValidate>
        {serverError ? <div className="pf-alert is-err">{serverError}</div> : null}
        {errorCount ? <div className="pf-alert is-err">Please fix the highlighted fields.</div> : null}

        <section className="pf-card">
          <h2>Prescription / TRF</h2>
          <FileUpload
            accept="image/*,application/pdf"
            capture="environment"
            label={file ? 'Replace file — tap to take a photo or choose' : 'Tap to take a photo, or drop an image / PDF'}
            hint="A clear photo of the full page works best."
            disabled={busy}
            onFiles={(files) => {
              setFile(files[0] || null);
              setErrors((prev) => ({ ...prev, file: undefined }));
            }}
          />
          {file ? (
            <div className="pf-preview">
              {previewUrl ? <img src={previewUrl} alt="Prescription preview" /> : <span className="pf-preview-doc">PDF</span>}
              <div>
                <b>{file.name}</b>
                <small>{formatBytes(file.size)}</small>
              </div>
              <button type="button" className="pf-link-btn" onClick={() => setFile(null)} disabled={busy}>
                Remove
              </button>
            </div>
          ) : null}
          {errors.file ? <p className="pf-field-error">{errors.file}</p> : null}
        </section>

        <section className="pf-card">
          <h2>Patient</h2>
          <div className="pf-grid2">
            <label className="pf-field pf-span2">
              <span>
                Patient name <i className="pf-req">*</i>
              </span>
              <input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                maxLength={140}
                autoComplete="off"
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name ? <em className="pf-field-error">{errors.name}</em> : null}
            </label>
            <label className="pf-field">
              <span>
                Mobile <i className="pf-req">*</i>
              </span>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="10-digit mobile"
                maxLength={14}
                aria-invalid={Boolean(errors.phone)}
              />
              {errors.phone ? <em className="pf-field-error">{errors.phone}</em> : null}
            </label>
            <div className="pf-grid2 pf-nested">
              <label className="pf-field">
                <span>
                  Age (years) <i className="pf-req">*</i>
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={120}
                  step={1}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  aria-invalid={Boolean(errors.age)}
                />
                {errors.age ? <em className="pf-field-error">{errors.age}</em> : null}
              </label>
              <label className="pf-field">
                <span>
                  Gender <i className="pf-req">*</i>
                </span>
                <select value={gender} onChange={(e) => setGender(e.target.value as Gender | '')} aria-invalid={Boolean(errors.gender)}>
                  <option value="">Select…</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
                {errors.gender ? <em className="pf-field-error">{errors.gender}</em> : null}
              </label>
            </div>
          </div>
        </section>

        <section className="pf-card">
          <h2>Pickup</h2>
          <div className="pf-field pf-location">
            <LocationField
              label="Pickup address *"
              value={address}
              onChange={setAddress}
              onCoordsChange={(lat, lng) => setCoords({ lat, lng })}
              required
            />
            {errors.address ? <em className="pf-field-error">{errors.address}</em> : null}
          </div>
          {coords ? (
            <p className="pf-coords">
              Location captured: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} ·{' '}
              <a href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`} target="_blank" rel="noreferrer">
                Open in Google Maps
              </a>{' '}
              ·{' '}
              <button type="button" className="pf-link-btn" onClick={() => setCoords(null)}>
                Clear
              </button>
            </p>
          ) : (
            <p className="pf-hint">Use GPS at the pickup location so the rider can navigate straight to the door.</p>
          )}
          <label className="pf-field">
            <span>Area / landmark</span>
            <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Salt Lake Sector V, near City Centre" maxLength={140} />
          </label>
          <div className="pf-grid2">
            <label className="pf-field">
              <span>Preferred window — from</span>
              <input type="datetime-local" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
            </label>
            <label className="pf-field">
              <span>Preferred window — to</span>
              <input
                type="datetime-local"
                value={windowEnd}
                min={windowStart || undefined}
                onChange={(e) => setWindowEnd(e.target.value)}
                aria-invalid={Boolean(errors.window)}
              />
            </label>
          </div>
          {errors.window ? <em className="pf-field-error">{errors.window}</em> : null}
        </section>

        <section className="pf-card">
          <h2>Tests &amp; notes</h2>
          <label className="pf-field">
            <span>Suggested tests</span>
            <textarea
              rows={2}
              value={suggestedTests}
              onChange={(e) => setSuggestedTests(e.target.value)}
              placeholder="Optional — e.g. CBC, HbA1c, Lipid profile"
            />
          </label>
          <label className="pf-field">
            <span>Notes for the lab / rider</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — fasting, gate code, floor…" />
          </label>
        </section>

        <div className="pf-actions">
          <Link className="partners-btn partners-btn-outline" to={basePath}>
            Cancel
          </Link>
          <button type="submit" className="partners-btn partners-btn-primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>
    </div>
  );
}
