import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, LabTestDetail, itemDiscountPercent, itemMrp, itemRate } from '../api';
import { PriceTag } from '../components/PriceTag';
import { useLiveRefresh } from '../hooks/useLiveRefresh';

function formatTat(hours?: number) {
  if (!hours) return '24 hours';
  if (hours < 24) return `${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

function renderParagraphs(text?: string) {
  if (!text) return null;
  return text.split(/\n\s*\n/).map((paragraph, index) => (
    <p key={index}>{paragraph.trim()}</p>
  ));
}

export function LabTestDetailPage() {
  const { itemCode = '' } = useParams();
  const [item, setItem] = useState<LabTestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const load = useCallback(async () => {
    if (!itemCode) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getItemDetail(itemCode);
      setItem(res.data.item);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load test details');
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [itemCode]);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh(load);

  const rate = item ? itemRate(item) : 0;
  const mrp = item ? itemMrp(item) : undefined;
  const discount = item ? itemDiscountPercent(item) : 0;
  const aliases = (item?.also_known_as || []).filter((name) => name !== item?.item_name);
  const aboutSections = item?.about_sections || [];
  const faqs = item?.faqs || [];

  return (
    <div className="lab-detail">
      <nav className="lab-detail-breadcrumb muted">
        <Link to="/">Home</Link>
        <span aria-hidden> / </span>
        <Link to="/diagnostics">Diagnostics</Link>
        {item && (
          <>
            <span aria-hidden> / </span>
            <span>{item.item_name}</span>
          </>
        )}
      </nav>

      {loading && <p className="muted">Loading test details…</p>}
      {error && <div className="error">{error}</div>}

      {item && (
        <div className="lab-detail-layout">
          <section className="lab-detail-main card card-wide">
            {item.lab_category && <p className="lab-detail-category">{item.lab_category}</p>}
            <h1>{item.item_name}</h1>

            {aliases.length > 0 && (
              <div className="lab-detail-aliases">
                <span className="muted">Also known as</span>
                <div className="chip-row">
                  {aliases.map((alias) => (
                    <span key={alias} className="chip">
                      {alias}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="lab-detail-facts">
              <div className="lab-fact">
                <span className="lab-fact-label">Sample type</span>
                <strong>{item.sample_type || 'Blood'}</strong>
              </div>
              <div className="lab-fact">
                <span className="lab-fact-label">Reports in</span>
                <strong>{formatTat(item.report_tat_hours)}</strong>
              </div>
              <div className="lab-fact">
                <span className="lab-fact-label">Tests included</span>
                <strong>{item.test_count || 1}</strong>
              </div>
              <div className="lab-fact">
                <span className="lab-fact-label">Preparation</span>
                <strong>{item.preparation?.toLowerCase().includes('no special') ? 'Not required' : 'See below'}</strong>
              </div>
            </div>

            {aboutSections.length > 0 ? (
              aboutSections.map((section) => (
                <div className="lab-detail-section" key={section.title}>
                  <h2>{section.title}</h2>
                  <div className="lab-detail-copy">{renderParagraphs(section.body)}</div>
                </div>
              ))
            ) : (
              item.description && (
                <div className="lab-detail-section">
                  <h2>About this test</h2>
                  <div className="lab-detail-copy">
                    <p>{item.description}</p>
                  </div>
                </div>
              )
            )}

            {faqs.length > 0 && (
              <div className="lab-detail-section">
                <h2>FAQs</h2>
                <div className="lab-faq-list">
                  {faqs.map((faq, index) => {
                    const expanded = openFaq === index;
                    return (
                      <div className={`lab-faq-item${expanded ? ' open' : ''}`} key={faq.question}>
                        <button
                          type="button"
                          className="lab-faq-question"
                          aria-expanded={expanded}
                          onClick={() => setOpenFaq(expanded ? null : index)}
                        >
                          <span>{faq.question}</span>
                          <span className="lab-faq-toggle" aria-hidden>
                            {expanded ? '−' : '+'}
                          </span>
                        </button>
                        {expanded && <div className="lab-faq-answer">{faq.answer}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="lab-detail-section">
              <h2>Why book with Remedium</h2>
              <ul className="lab-detail-benefits">
                <li>Home sample collection by certified phlebotomists</li>
                <li>NABL-aligned processing partners</li>
                <li>Digital reports in your My orders journey</li>
              </ul>
            </div>
          </section>

          <aside className="lab-detail-sidebar card">
            <p className="muted">MRP</p>
            <div className="lab-detail-price">
              <span className="lab-detail-rate">₹{rate.toFixed(0)}</span>
              {mrp && mrp > rate && (
                <span className="lab-detail-mrp">₹{mrp.toFixed(0)}</span>
              )}
            </div>
            {discount > 0 && <p className="lab-detail-save">Save {discount}%</p>}
            <PriceTag item={item} />
            <Link className="btn lab-detail-book" to={`/diagnostics/book/${encodeURIComponent(item.name)}`}>
              Book now
            </Link>
            <p className="muted lab-detail-note">Home collection slots available in your area.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
