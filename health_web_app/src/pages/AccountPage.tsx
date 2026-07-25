import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { dashboardLabel, isHrStaff, isPatientPortal } from '../auth/roles';

export function AccountPage() {
  const { user, defaultRoute, logout } = useAuth();
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [profileImage, setProfileImage] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !isPatientPortal(user.roles)) return;
    let cancelled = false;
    (async () => {
      try {
        const [wallet, profile] = await Promise.all([
          api.getMyReferral().catch(() => null),
          api.getPatientProfile().catch(() => null),
        ]);
        if (cancelled) return;
        if (wallet?.data) {
          setWalletBalance(Number(wallet.data.wallet_balance ?? 0));
          setReferralCode(wallet.data.referral_code || null);
        }
        const p = profile?.data as Record<string, unknown> | undefined;
        if (p?.profile_image) setProfileImage(String(p.profile_image));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

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
                Refer &amp; Earn
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
