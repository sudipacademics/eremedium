import { useEffect, useState } from 'react';
import { api, OAuthProvider } from '../api';

type GoogleSignInButtonProps = {
  nextPath?: string;
  label?: string;
};

function buildOAuthRedirect(nextPath?: string) {
  const origin = window.location.origin;
  if (nextPath?.startsWith('/')) {
    return `${origin}/oauth/callback?next=${encodeURIComponent(nextPath)}`;
  }
  return `${origin}/oauth/callback`;
}

function pickGoogleProvider(providers: OAuthProvider[]) {
  return (
    providers.find((p) => /google/i.test(p.provider) || /google/i.test(p.label || '')) ||
    providers[0]
  );
}

export function GoogleSignInButton({ nextPath, label = 'Continue with Google' }: GoogleSignInButtonProps) {
  const [provider, setProvider] = useState<OAuthProvider | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.getOAuthProviders(buildOAuthRedirect(nextPath));
        if (!active) return;
        const providers = res.data.providers || [];
        setProvider(providers.length ? pickGoogleProvider(providers) : null);
      } catch {
        if (active) setProvider(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [nextPath]);

  if (loading || !provider?.login_url) {
    return null;
  }

  return (
    <button
      type="button"
      className="btn-google"
      onClick={() => {
        window.location.assign(provider.login_url);
      }}
    >
      <span className="btn-google-icon" aria-hidden>
        G
      </span>
      {label}
    </button>
  );
}
