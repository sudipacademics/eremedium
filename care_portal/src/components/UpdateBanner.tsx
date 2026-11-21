import { useEffect, useState } from 'react';
import { Icon } from '../icons';

const CHECK_MS = 5 * 60 * 1000;

function currentBundle() {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return script ? new URL(script.src, location.href).pathname : '';
}

/* Tabs keep running the code they loaded; compare with the published index.html and offer a reload. */
export function UpdateBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const mine = currentBundle();
    if (!mine) return undefined;
    let busy = false;
    const check = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const html = await fetch('/index.html', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : ''));
        const live = html.match(/\/assets\/index-[^"']+\.js/);
        if (live && live[0] !== mine) setStale(true);
      } catch {
        /* offline: try again later */
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(check, CHECK_MS);
    window.addEventListener('focus', check);
    check();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, []);

  if (!stale) return null;
  return (
    <div className="update-banner" role="status">
      <Icon name="refresh" size={16} />
      <span>A new version of the portal is available.</span>
      <button type="button" className="btn btn-primary sm" onClick={() => location.reload()}>
        Reload now
      </button>
    </div>
  );
}
