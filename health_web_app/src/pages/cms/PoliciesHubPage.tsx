import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type SiteCmsPage } from '../../api';
import { useDocumentSeo } from '../../components/DocumentSeo';
import { LEGAL_NAV } from '../legal/legalContent';

export function PoliciesHubPage() {
  const [intro, setIntro] = useState<SiteCmsPage | null>(null);

  useEffect(() => {
    void api.getSiteCmsPage('policies').then((res) => {
      if (res.status === 'success') setIntro(res.data);
    });
  }, []);

  useDocumentSeo({
    title: intro?.meta_title || 'Policies | Remedium',
    description:
      intro?.meta_description ||
      'Remedium privacy policy, terms and conditions, refund policy, disclaimer, and data use policy.',
    keywords: intro?.meta_keywords || 'Remedium policies, privacy policy, terms, refund policy',
    allowIndex: true,
  });

  return (
    <div className="legal-page">
      <aside className="legal-nav" aria-label="Policies">
        <p className="legal-nav-title">Policies</p>
        <ul>
          {LEGAL_NAV.map((item) => (
            <li key={item.id}>
              <Link to={item.path}>{item.title}</Link>
            </li>
          ))}
        </ul>
      </aside>

      <article className="legal-doc">
        <p className="muted legal-kicker">Remedium · Legal</p>
        <h1>{intro?.title || 'Policies'}</h1>
        {intro?.subtitle ? <p className="legal-summary">{intro.subtitle}</p> : null}
        {intro?.body ? (
          <div className="cms-body" dangerouslySetInnerHTML={{ __html: intro.body }} />
        ) : (
          <p className="muted">Select a policy from the list to read the full document.</p>
        )}

        <section className="legal-section">
          <h2>All policy documents</h2>
          <ul>
            {LEGAL_NAV.map((item) => (
              <li key={item.id}>
                <Link to={item.path}>{item.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      </article>
    </div>
  );
}
