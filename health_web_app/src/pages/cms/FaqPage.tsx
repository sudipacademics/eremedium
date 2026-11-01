import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { REMEDIUM_FAQ_SECTIONS, type FaqSection } from '../../content/remediumFaqs';
import { useDocumentSeo } from '../../components/DocumentSeo';

function FaqBlock({ section }: { section: FaqSection }) {
  return (
    <section className="faq-section" id={section.id}>
      <h2>{section.title}</h2>
      <div className="lab-faq-list">
        {section.items.map((item) => (
          <details key={item.question} className="lab-faq-item">
            <summary className="lab-faq-question">{item.question}</summary>
            <div
              className="lab-faq-answer"
              dangerouslySetInnerHTML={{ __html: item.answer }}
            />
          </details>
        ))}
      </div>
    </section>
  );
}

export function FaqPage() {
  const [sections, setSections] = useState<FaqSection[]>(REMEDIUM_FAQ_SECTIONS);

  useEffect(() => {
    let cancelled = false;
    void api
      .getSiteFaqs()
      .then((res) => {
        if (cancelled || res.status !== 'success' || !res.data?.sections?.length) return;
        setSections(res.data.sections as FaqSection[]);
      })
      .catch(() => {
        /* keep bundled fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const flatCount = useMemo(
    () => sections.reduce((n, s) => n + s.items.length, 0),
    [sections],
  );

  useDocumentSeo({
    title: 'FAQs | Remedium Healthcare Ecosystem',
    description:
      'Answers about Remedium Labs, Remedium Aesthetic, Remedium Care, franchise models, booking and support — Smilecure Lifestyle Pvt. Ltd.',
    keywords:
      'Remedium FAQ, Remedium Lab, Remedium Aesthetic, Remedium Care, fair price diagnostic lab, franchise FOCO FOFO',
    canonical: 'https://www.e-remedium.in/faq',
    allowIndex: true,
  });

  useEffect(() => {
    const json = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: sections.flatMap((section) =>
        section.items.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      ),
    });
    let el = document.getElementById('remedium-faq-page-ld') as HTMLScriptElement | null;
    if (!el) {
      el = document.createElement('script');
      el.id = 'remedium-faq-page-ld';
      el.type = 'application/ld+json';
      document.head.appendChild(el);
    }
    el.textContent = json;
    return () => {
      el?.remove();
    };
  }, [sections]);

  return (
    <div className="faq-page">
      <header className="page-intro">
        <p className="muted">Remedium · Help</p>
        <h1>Frequently Asked Questions</h1>
        <p>
          {flatCount} answers about <strong>Remedium Labs</strong>, <strong>Remedium Aesthetic</strong>,{' '}
          <strong>Remedium Care</strong>, franchise opportunities, and booking support.
        </p>
        <p className="muted">
          Edit in ERPNext → <strong>HEC Site FAQ</strong>.{' '}
          <Link to="/centres">Find a centre</Link> · <Link to="/diagnostics">Book a lab test</Link>
        </p>
      </header>

      <nav className="faq-jump-nav" aria-label="FAQ sections">
        {sections.map((section) => (
          <a key={section.id} href={`#${section.id}`}>
            {section.title}
          </a>
        ))}
      </nav>

      {sections.map((section) => (
        <FaqBlock key={section.id} section={section} />
      ))}
    </div>
  );
}
