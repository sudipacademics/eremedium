import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type SiteCmsPage } from '../../api';
import { useDocumentSeo } from '../../components/DocumentSeo';

const FALLBACK_PAGES: Record<string, SiteCmsPage> = {
  accreditations: {
    page_key: 'accreditations',
    title: 'Accreditations & Certifications',
    subtitle: 'Quality systems that underpin every Remedium Lab report.',
    body:
      '<p><strong>Remedium Labs</strong> follows NABL-aligned quality systems and ISO 9001:2015 certified processes.</p>',
    meta_title: 'Accreditations & Certifications | Remedium Lab',
    meta_description:
      'Remedium Lab NABL accreditation, ISO 9001:2015 certification, and quality credentials.',
    meta_keywords: 'Remedium Lab, NABL accredited, ISO 9001, fair price diagnostics India',
  },
  about: {
    page_key: 'about',
    title: 'About Remedium',
    subtitle: "India's First Fair Price Diagnostic Lab — a unit of Smilecure Lifestyle Pvt. Ltd.",
    body:
      '<p>Remedium offers accurate diagnostics at transparent prices, with home collection, health packages, and a growing centre network.</p>',
    meta_title: 'About Us | Remedium',
    meta_description: 'Learn about Remedium, a fair-price diagnostic lab offering home collection and NABL-aligned reports.',
  },
  contact: {
    page_key: 'contact',
    title: 'Contact Us',
    subtitle: 'Patient support for bookings, reports, and home collection.',
    body:
      '<p>Call home collection on <strong>+91 8100149230</strong> or write to <a href="mailto:support@e-remedium.in">support@e-remedium.in</a>.</p>',
    meta_title: 'Contact Us | Remedium',
    meta_description: 'Contact Remedium for lab tests, home collection, and patient support.',
  },
};

type Props = {
  pageKey: string;
};

export function SiteCmsPageView({ pageKey }: Props) {
  const [page, setPage] = useState<SiteCmsPage | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api
      .getSiteCmsPage(pageKey)
      .then((res) => {
        if (cancelled) return;
        if (res.status === 'error') {
          setPage(FALLBACK_PAGES[pageKey] || null);
          setError(res.message || 'Unable to load page');
          return;
        }
        setPage(res.data);
        setError('');
      })
      .catch(() => {
        if (!cancelled) {
          setPage(FALLBACK_PAGES[pageKey] || null);
          setError('Unable to load page');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pageKey]);

  useDocumentSeo({
    title: page?.meta_title || page?.title || 'Remedium',
    description: page?.meta_description || page?.subtitle,
    keywords: page?.meta_keywords,
    allowIndex: true,
  });

  if (!page) {
    return (
      <div className="legal-page">
        <article className="legal-doc">
          <p className="muted">{error || 'Loading…'}</p>
        </article>
      </div>
    );
  }

  return (
    <div className="legal-page">
      <aside className="legal-nav" aria-label="Resources">
        <p className="legal-nav-title">Resources</p>
        <ul>
          <li>
            <Link to="/accreditations" className={pageKey === 'accreditations' ? 'active' : undefined}>
              Accreditations
            </Link>
          </li>
          <li>
            <Link to="/policies" className={pageKey === 'policies' ? 'active' : undefined}>
              Policies
            </Link>
          </li>
          <li>
            <Link to="/press" className={pageKey === 'press' ? 'active' : undefined}>
              News &amp; Press
            </Link>
          </li>
          <li>
            <Link to="/knowledge" className={pageKey === 'knowledge' ? 'active' : undefined}>
              Knowledge Centre
            </Link>
          </li>
          <li>
            <Link to="/faq">FAQs</Link>
          </li>
        </ul>
      </aside>

      <article className="legal-doc cms-doc">
        <p className="muted legal-kicker">Remedium</p>
        <h1>{page.title}</h1>
        {page.subtitle ? <p className="legal-summary">{page.subtitle}</p> : null}
        {page.body ? <div className="cms-body" dangerouslySetInnerHTML={{ __html: page.body }} /> : null}
        {error ? <p className="muted">{error}</p> : null}
      </article>
    </div>
  );
}
