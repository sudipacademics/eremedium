import { Link, Navigate, useParams } from 'react-router-dom';
import { LEGAL_DOCS, LEGAL_NAV, type LegalDocId } from './legalContent';

function isLegalId(value: string | undefined): value is LegalDocId {
  return Boolean(value && value in LEGAL_DOCS);
}

export function LegalDocumentPage() {
  const { docId } = useParams();
  if (!isLegalId(docId)) {
    return <Navigate to="/legal/privacy-policy" replace />;
  }
  const doc = LEGAL_DOCS[docId];

  return (
    <div className="legal-page">
      <aside className="legal-nav" aria-label="Policies">
        <p className="legal-nav-title">Policies</p>
        <ul>
          {LEGAL_NAV.map((item) => (
            <li key={item.id}>
              <Link to={item.path} className={item.id === doc.id ? 'active' : undefined}>
                {item.title}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <article className="legal-doc">
        <p className="muted legal-kicker">Remedium · Legal</p>
        <h1>{doc.title}</h1>
        <p className="muted">Last updated: {doc.updated}</p>
        <p className="legal-summary">{doc.summary}</p>

        {doc.sections.map((section) => (
          <section key={section.heading} className="legal-section">
            <h2>{section.heading}</h2>
            {section.paragraphs.map((p) => (
              <p key={p.slice(0, 48)}>{p}</p>
            ))}
            {section.bullets && section.bullets.length > 0 ? (
              <ul>
                {section.bullets.map((b) => (
                  <li key={b.slice(0, 48)}>{b}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        <p className="muted legal-foot">
          Questions? Email{' '}
          <a href="mailto:support@e-remedium.in">support@e-remedium.in</a>
        </p>
      </article>
    </div>
  );
}
