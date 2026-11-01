import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { dashboardLabel, isHrStaff, isPatientPortal } from '../auth/roles';
import { FamilyProfilesCard } from '../components/FamilyProfilesCard';

export function AccountPage() {
  const { user, defaultRoute, logout } = useAuth();
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [abhaNumber, setAbhaNumber] = useState('');
  const [abhaAddress, setAbhaAddress] = useState('');
  const [abhaStatus, setAbhaStatus] = useState<string | null>(null);
  const [abhaError, setAbhaError] = useState<string | null>(null);
  const [abhaNotice, setAbhaNotice] = useState<string | null>(null);
  const [abhaBusy, setAbhaBusy] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpHint, setOtpHint] = useState<string | null>(null);
  const [abdmStub, setAbdmStub] = useState(true);

  useEffect(() => {
    if (!user || !isPatientPortal(user.roles)) return;
    let cancelled = false;
    (async () => {
      try {
        const [wallet, profile, abha, abdm] = await Promise.all([
          api.getMyReferral().catch(() => null),
          api.getPatientProfile().catch(() => null),
          api.getMyAbha().catch(() => null),
          api.getAbdmStatus().catch(() => null),
        ]);
        if (cancelled) return;
        if (wallet?.data) {
          setWalletBalance(Number(wallet.data.wallet_balance ?? 0));
          setReferralCode(wallet.data.referral_code || null);
        }
        const p = profile?.data as Record<string, unknown> | undefined;
        if (p?.profile_image) setProfileImage(String(p.profile_image));
        if (abha?.data?.abha) {
          setAbhaNumber(abha.data.abha.abha_number || '');
          setAbhaAddress(abha.data.abha.abha_address || '');
          setAbhaStatus(abha.data.abha.abha_verification_status || null);
        }
        if (abdm?.data) {
          setAbdmStub(Boolean(abdm.data.otp_stub_mode) || !abdm.data.credentials_ready);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function saveAbha(e: FormEvent) {
    e.preventDefault();
    setAbhaBusy(true);
    setAbhaError(null);
    setAbhaNotice(null);
    try {
      const res = await api.linkAbhaId({
        abha_number: abhaNumber,
        abha_address: abhaAddress,
        consent: true,
      });
      setAbhaStatus(res.data.abha.abha_verification_status || null);
      setAbhaNotice('ABHA details saved.');
    } catch (err) {
      setAbhaError(err instanceof Error ? err.message : 'Could not save ABHA');
    } finally {
      setAbhaBusy(false);
    }
  }

  async function requestOtp() {
    setAbhaBusy(true);
    setAbhaError(null);
    setAbhaNotice(null);
    try {
      const res = await api.requestAbhaOtp({ abha_number: abhaNumber || undefined });
      setOtpHint(res.data.hint || (res.data.stub ? 'Stub OTP issued' : null));
      setAbhaNotice(res.data.hint || 'OTP sent.');
      if (res.data.stub) setOtp('123456');
    } catch (err) {
      setAbhaError(err instanceof Error ? err.message : 'OTP request failed');
    } finally {
      setAbhaBusy(false);
    }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    setAbhaBusy(true);
    setAbhaError(null);
    setAbhaNotice(null);
    try {
      const res = await api.verifyAbhaOtp({
        otp,
        abha_number: abhaNumber || undefined,
        abha_address: abhaAddress || undefined,
      });
      const abha = res.data.abha;
      if (abha) {
        setAbhaNumber(abha.abha_number || abhaNumber);
        setAbhaAddress(abha.abha_address || abhaAddress);
        setAbhaStatus(abha.abha_verification_status || 'Verified');
      } else {
        setAbhaStatus('Verified');
      }
      setAbhaNotice('ABHA verified via OTP.');
      setOtpHint(null);
    } catch (err) {
      setAbhaError(err instanceof Error ? err.message : 'OTP verify failed');
    } finally {
      setAbhaBusy(false);
    }
  }

  if (!user) {
    return null;
  }

  const patient = isPatientPortal(user.roles);
  const initials = (user.fullName || user.user || 'U')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <>
      <h1>Account</h1>
      <div className="card card-wide account-hub-card">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {profileImage ? (
            <img className="profile-avatar" style={{ width: 64, height: 64 }} src={profileImage} alt="" />
          ) : (
            <div
              className="profile-avatar profile-avatar-fallback"
              style={{ width: 64, height: 64, fontSize: '1.25rem' }}
            >
              {initials}
            </div>
          )}
          <div>
            <strong>{user.fullName || '—'}</strong>
            <p className="muted" style={{ margin: 0 }}>
              {user.user}
            </p>
          </div>
        </div>

        {patient ? (
          <>
            <Link className="account-wallet-chip" to="/account/refer">
              Wallet ₹{walletBalance != null ? walletBalance.toFixed(0) : '—'}
              {referralCode ? <span className="muted">· {referralCode}</span> : null}
            </Link>
            <div className="toolbar">
              <Link className="btn" to="/account/profile">
                Update Profile
              </Link>
              <Link className="btn secondary" to="/account/refer">
                Top up wallet
              </Link>
              <Link className="btn secondary" to="/account/refer">
                Refer &amp; Earn
              </Link>
              <Link className="btn secondary" to="/care">
                Care programs
              </Link>
            </div>
          </>
        ) : null}

        <dl className="detail-list">
          <div>
            <dt>Roles</dt>
            <dd>
              <div className="tag-row">
                {user.roles.map((role) => (
                  <span key={role} className="badge">
                    {role}
                  </span>
                ))}
              </div>
            </dd>
          </div>
          {user.franchisee && (
            <div>
              <dt>Linked franchise</dt>
              <dd>
                {user.franchisee.franchise_name} ({user.franchisee.branch_code})
              </dd>
            </div>
          )}
        </dl>

        {patient ? <FamilyProfilesCard /> : null}

        {patient ? (
          <form onSubmit={saveAbha} style={{ marginTop: 16 }}>
            <h3>ABHA (Ayushman Bharat Health Account)</h3>
            <p className="muted">
              Store ABHA for care continuity.
              {abdmStub
                ? ' Sandbox OTP stub is on (demo OTP 123456) — not live NHA.'
                : ' OTP uses configured ABDM credentials when enabled.'}
            </p>
            {abhaError ? <p className="error">{abhaError}</p> : null}
            {abhaNotice ? <p className="success">{abhaNotice}</p> : null}
            {abhaStatus ? (
              <p className="muted">
                Status: <strong>{abhaStatus}</strong>
              </p>
            ) : null}
            <label>
              ABHA number (14 digits)
              <input value={abhaNumber} onChange={(e) => setAbhaNumber(e.target.value)} placeholder="14-digit ABHA" />
            </label>
            <label>
              ABHA address (PHR)
              <input
                value={abhaAddress}
                onChange={(e) => setAbhaAddress(e.target.value)}
                placeholder="name@abdm"
              />
            </label>
            <div className="toolbar">
              <button className="btn" type="submit" disabled={abhaBusy}>
                Save ABHA with consent
              </button>
              <button className="btn secondary" type="button" disabled={abhaBusy} onClick={() => void requestOtp()}>
                Request OTP
              </button>
            </div>
          </form>
        ) : null}

        {patient ? (
          <form onSubmit={verifyOtp} style={{ marginTop: 12 }}>
            <label>
              OTP{otpHint ? ` (${otpHint})` : ''}
              <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit OTP" />
            </label>
            <button className="btn" type="submit" disabled={abhaBusy || !otp}>
              Verify OTP
            </button>
          </form>
        ) : null}

        <div className="toolbar" style={{ marginTop: 8 }}>
          {patient ? (
            <Link className="btn secondary" to="/">
              Back to home
            </Link>
          ) : (
            <Link className="btn secondary" to={defaultRoute}>
              Go to {dashboardLabel(user.roles)} dashboard
            </Link>
          )}
          {isHrStaff(user.roles) && (
            <Link className="btn secondary" to="/dashboard/hr">
              HR self-service
            </Link>
          )}
          <button className="btn secondary" type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </div>
    </>
  );
}
