import { usePwaInstall } from '../hooks/usePwaInstall';

export function PwaInstallBanner() {
  const { canInstall, install, dismiss, isIos, installed } = usePwaInstall();

  if (installed) return null;

  if (isIos && !sessionStorage.getItem('hec_pwa_ios_hint_dismissed')) {
    return (
      <div className="pwa-install-banner" role="region" aria-label="Install app">
        <div>
          <strong>Install on iPhone</strong>
          <p className="muted">Tap Share → Add to Home Screen for quick access.</p>
        </div>
        <button type="button" className="btn secondary btn-sm" onClick={() => sessionStorage.setItem('hec_pwa_ios_hint_dismissed', '1')}>
          Got it
        </button>
      </div>
    );
  }

  if (!canInstall) return null;

  return (
    <div className="pwa-install-banner" role="region" aria-label="Install app">
      <div>
        <strong>Install Health app</strong>
        <p className="muted">Add to your home screen for faster bookings and reports.</p>
      </div>
      <div className="pwa-install-actions">
        <button type="button" className="btn btn-sm" onClick={() => void install()}>
          Install
        </button>
        <button type="button" className="btn secondary btn-sm" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
