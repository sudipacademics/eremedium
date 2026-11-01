import { useEffect } from 'react';

export type DocumentSeoInput = {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  canonical?: string;
  allowIndex?: boolean;
  type?: 'website' | 'article';
};

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setLink(rel: string, href: string) {
  if (!href) return;
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

/** Apply document title + SEO / Open Graph / robots meta for public pages. */
export function useDocumentSeo(seo: DocumentSeoInput) {
  useEffect(() => {
    const title = (seo.title || 'Remedium Health').trim();
    const description = (seo.description || '').trim();
    const keywords = (seo.keywords || '').trim();
    const image = (seo.image || '').trim();
    const canonical =
      (seo.canonical || '').trim() ||
      (typeof window !== 'undefined' ? window.location.href.split('?')[0] : '');
    const allowIndex = seo.allowIndex !== false;
    const type = seo.type || 'website';

    const prevTitle = document.title;
    document.title = title.includes('Remedium') ? title : `${title} | Remedium`;

    setMeta('name', 'description', description);
    setMeta('name', 'keywords', keywords);
    setMeta('name', 'robots', allowIndex ? 'index,follow' : 'noindex,nofollow');
    setMeta('name', 'googlebot', allowIndex ? 'index,follow' : 'noindex,nofollow');

    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:type', type);
    setMeta('property', 'og:url', canonical);
    if (image) setMeta('property', 'og:image', image);

    setMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);
    if (image) setMeta('name', 'twitter:image', image);

    setLink('canonical', canonical);

    return () => {
      document.title = prevTitle || 'Remedium Health';
    };
  }, [
    seo.title,
    seo.description,
    seo.keywords,
    seo.image,
    seo.canonical,
    seo.allowIndex,
    seo.type,
  ]);
}
