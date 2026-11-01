import { useEffect, useState } from 'react';
import { api } from '../api';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function injectScript(src: string, id: string, async = true) {
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.id = id;
  s.async = async;
  s.src = src;
  document.head.appendChild(s);
}

function injectInline(id: string, code: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.id = id;
  s.text = code;
  document.head.appendChild(s);
}

/** Loads GA4 / GTM from Health Ecosystem Settings once on the patient portal. */
export function PortalAnalytics() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getPortalSeoSettings()
      .then((res) => {
        if (cancelled || !res?.data) return;
        const gaId = (res.data.google_analytics_id || '').trim();
        const gtmId = (res.data.google_tag_manager_id || '').trim();

        if (gtmId && /^GTM-[A-Z0-9]+$/i.test(gtmId)) {
          injectInline(
            'hec-gtm-boot',
            `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`,
          );
        }

        if (gaId && /^G-[A-Z0-9]+$/i.test(gaId)) {
          injectScript(`https://www.googletagmanager.com/gtag/js?id=${gaId}`, 'hec-ga4-js');
          injectInline(
            'hec-ga4-boot',
            `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');`,
          );
        }
        setReady(true);
      })
      .catch(() => {
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready ? null : null;
}
