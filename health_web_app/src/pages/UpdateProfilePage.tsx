import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';

type ProfileForm = {
  patient_name: string;
  mobile: string;
  email: string;
  dob: string;
  gender: string;
  profile_image?: string;
};

function FieldIcon({ kind }: { kind: string }) {
  return <span className={`profile-field-icon profile-icon-${kind}`} aria-hidden="true" />;
}

export function UpdateProfilePage() {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<ProfileForm>({
    patient_name: user?.fullName || '',
    mobile: '',
    email: user?.user || '',
    dob: '',
    gender: '',
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getPatientProfile();
        if (cancelled) return;
        const p = res.data as Record<string, unknown>;
        if (p.linked) {
          setForm({
            patient_name: String(p.patient_name || user?.fullName || ''),
            mobile: String(p.mobile || ''),
            email: String(p.email || user?.user || ''),
            dob: String(p.dob || ''),
            gender: String(p.gender || ''),
            profile_image: p.profile_image ? String(p.profile_image) : undefined,
          });
          if (p.profile_image) setPreview(String(p.profile_image));
          setVerified(Boolean(p.mobile));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.fullName, user?.user]);

  function onPickPhoto(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      setPreview(result);
      setImageB64(result);
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api.updatePatientProfile({
        patient_name: form.patient_name,
        mobile: form.mobile,
        email: form.email,
        dob: form.dob || undefined,
        gender: form.gender || undefined,
        ...(imageB64
          ? { profile_image: imageB64, profile_image_filename: imageName || 'profile.jpg' }
          : {}),
        ...(password ? { new_password: password } : {}),
      });
      setSuccess('Profile updated');
      setPassword('');
      setImageB64(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  const initials = (form.patient_name || user?.fullName || 'U')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="profile-page">
      <header className="profile-page-header">
        <Link className="profile-back" to="/account" aria-label="Back to account">
          ←
        </Link>
        <h1>Update Profile</h1>
      </header>

      <div className={`profile-otp-banner${verified ? ' is-verified' : ''}`}>
        <span className="profile-otp-shield" aria-hidden="true" />
        <div>
          <strong>{verified ? 'OTP Verified' : 'Verify your mobile'}</strong>
          <p>
            {verified
              ? 'Your identity has been verified. You can now update your profile.'
              : 'Add a mobile number so we can verify your identity.'}
          </p>
        </div>
        {verified ? <span className="profile-otp-check" aria-hidden="true" /> : null}
      </div>

      {loading ? <p className="muted">Loading profile…</p> : null}
      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success">{success}</div> : null}

      <form className="profile-form" onSubmit={onSubmit}>
        <section className="profile-photo-card">
          <h2>Profile Photo</h2>
          <button
            type="button"
            className="profile-avatar-btn"
            onClick={() => fileRef.current?.click()}
            aria-label="Change profile photo"
          >
            <div className="profile-avatar-wrap">
              {preview ? (
                <img className="profile-avatar" src={preview} alt="" />
              ) : (
                <div className="profile-avatar profile-avatar-fallback">{initials || 'U'}</div>
              )}
              <span className="profile-camera-btn" aria-hidden="true" />
            </div>
          </button>
          <p className="muted profile-photo-hint">Tap on the photo to change</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => onPickPhoto(e.target.files?.[0] || null)}
          />
        </section>

        <section className="profile-info-card">
          <h2 className="profile-info-title">
            <span className="profile-info-title-icon" aria-hidden="true" />
            Personal Information
          </h2>

          <div className="profile-field-row">
            <FieldIcon kind="user" />
            <label>
              Name <span className="req">*</span>
              <input
                value={form.patient_name}
                onChange={(e) => setForm((f) => ({ ...f, patient_name: e.target.value }))}
                required
                autoComplete="name"
              />
            </label>
          </div>

          <div className="profile-field-row">
            <FieldIcon kind="calendar" />
            <label>
              Date of Birth <span className="req">*</span>
              <input
                type="date"
                value={form.dob}
                onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))}
                required
              />
            </label>
          </div>

          <div className="profile-field-row">
            <FieldIcon kind="phone" />
            <label>
              Contact No. <span className="req">*</span>
              <input
                value={form.mobile}
                onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))}
                inputMode="tel"
                required
                autoComplete="tel"
              />
            </label>
          </div>

          <div className="profile-field-row">
            <FieldIcon kind="email" />
            <label>
              Email ID <span className="req">*</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
                autoComplete="email"
              />
            </label>
          </div>

          <div className="profile-field-row">
            <FieldIcon kind="user" />
            <label>
              Username <span className="req">*</span>
              <input value={user?.user || ''} readOnly disabled />
            </label>
          </div>

          <div className="profile-field-row">
            <FieldIcon kind="lock" />
            <label>
              Password
              <div className="profile-password-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="new_password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="profile-eye-btn"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>
          </div>

          <div className="profile-field-row">
            <FieldIcon kind="user" />
            <label>
              Gender
              <select
                value={form.gender}
                onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
              >
                <option value="">Select</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </label>
          </div>

          <div className="profile-secure-banner">
            <span className="profile-secure-icon" aria-hidden="true" />
            <p>Your profile is secured. We never share your information with anyone.</p>
          </div>

          <button className="btn profile-update-btn" type="submit" disabled={saving || loading}>
            <span className="profile-update-check" aria-hidden="true" />
            {saving ? 'Updating…' : 'Update Profile'}
          </button>
        </section>
      </form>
    </div>
  );
}
