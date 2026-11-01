import { useEffect } from 'react';
import { api } from '../api';

const DEFAULT_KEYWORDS =
  'Remedium, Remedium Lab, Remedium Aesthetic, Remedium Care, India\'s First fair price Diagnostic Lab';

const DEFAULT_DESCRIPTION =
  'Remedium Lab — affordable blood tests, pathology, home sample collection and digital reports across India.';

function upsertMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Apply ERP-managed global SEO / GEO / GSC / analytics hints (guest-safe). */
export function GlobalSeoTags() {
  useEffect(() => {
    let cancelled = false;
    void api
      .getPublicSeoSettings()
      .then((res) => {
        if (cancelled || res.status !== 'success' || !res.data) return;
        const d = res.data;
        if (d.seo_keywords) upsertMeta('keywords', d.seo_keywords);
        if (d.public_meta_description) upsertMeta('description', d.public_meta_description);
        if (d.public_og_title) upsertMeta('og:title', d.public_og_title, 'property');
        if (d.public_og_description) upsertMeta('og:description', d.public_og_description, 'property');
        if (d.public_canonical_url) upsertMeta('og:url', d.public_canonical_url, 'property');
        if (d.public_gsc_verification) upsertMeta('google-site-verification', d.public_gsc_verification);
        const robots = [
          d.public_robots_index === 0 ? 'noindex' : 'index',
          d.public_robots_follow === 0 ? 'nofollow' : 'follow',
        ].join(', ');
        upsertMeta('robots', robots);
      })
      .catch(() => {
        if (cancelled) return;
        upsertMeta('keywords', DEFAULT_KEYWORDS);
        upsertMeta('description', DEFAULT_DESCRIPTION);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
