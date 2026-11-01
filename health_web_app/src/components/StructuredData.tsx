import { useEffect, useMemo } from 'react';
import { buildStructuredDataGraph } from '../seo/brandSchema';

const SCRIPT_ID = 'remedium-structured-data';

type Props = {
  /** Override canonical page URL (defaults to window.location.href). */
  pageUrl?: string;
};

/**
 * Injects Schema.org JSON-LD (Organization + MedicalBusiness + FAQPage) into document head.
 */
export function StructuredData({ pageUrl }: Props) {
  const json = useMemo(() => {
    const url =
      pageUrl ||
      (typeof window !== 'undefined' ? window.location.href.split('#')[0] : undefined);
    return JSON.stringify(buildStructuredDataGraph({ pageUrl: url }));
  }, [pageUrl]);

  useEffect(() => {
    let el = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!el) {
      el = document.createElement('script');
      el.id = SCRIPT_ID;
      el.type = 'application/ld+json';
      document.head.appendChild(el);
    }
    el.textContent = json;
    return () => {
      el?.remove();
    };
  }, [json]);

  return null;
}
