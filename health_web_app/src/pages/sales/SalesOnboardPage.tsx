import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';

const ONBOARD_BASE = 'https://www.e-remedium.in/onboard/';

/** Stable Employee Referral Number for a Reach sales user (rep_code preferred). */
export function employeeReferralNumber(repCode?: string | null, fallbackUser?: string | null) {
  const raw = (repCode || fallbackUser || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const code = raw.slice(0, 16) || 'REACH';
  return `ERN-${code}`;
}

export function SalesOnboardPage() {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [referral, setReferral] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const portal = await api.getSalesPortal();
        const repCode = portal.data.rep?.rep_code || user?.user?.split('@')[0] || '';
        const ern = employeeReferralNumber(repCode, user?.user);
        const url = `${ONBOARD_BASE}?employee_referral=${encodeURIComponent(ern)}`;
        if (!active) return;
        setReferral(ern);
        setTargetUrl(url);
        window.location.assign(url);
      } catch (err) {
        if (!active) return;
        const fallback = employeeReferralNumber(user?.user?.split('@')[0], user?.user);
        const url = `${ONBOARD_BASE}?employee_referral=${encodeURIComponent(fallback)}`;
        setReferral(fallback);
        setTargetUrl(url);
        setError(err instanceof Error ? err.message : 'Unable to load sales profile — using your login referral.');
        window.setTimeout(() => window.location.assign(url), 600);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.user]);

  return (
    <div className="reach-onboard-redirect">
      <div className="reach-page-head">
        <div>
          <h1>Onboard franchisee</h1>
          <p>
            Opening the franchise application portal with your Employee Referral Number. Applicants complete FOFO/FOCO
            registration on www.e-remedium.in — your referral is stored automatically and cannot be edited by them.
          </p>
        </div>
      </div>

      {error ? <div className="reach-alert err">{error}</div> : null}

      <div className="reach-card">
        <div className="reach-card-head">
          <div className="reach-card-icon" aria-hidden>
            →
          </div>
          <div>
            <h2>Redirecting to applicant onboarding</h2>
            <p>
              {referral ? (
                <>
                  Employee Referral Number <strong>{referral}</strong> will be attached to the application as an internal
                  Reach reference.
                </>
              ) : (
                'Preparing your Employee Referral Number…'
              )}
            </p>
          </div>
        </div>
        {targetUrl ? (
          <div className="reach-form-footer">
            <span className="reach-gps">If you are not redirected automatically, continue below.</span>
            <a className="reach-btn" href={targetUrl}>
              Open onboarding portal
            </a>
          </div>
        ) : (
          <p className="muted">Please wait…</p>
        )}
      </div>
    </div>
  );
}
