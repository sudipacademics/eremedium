import { useEffect, useState } from 'react';
import { api, SalesCatalogOffering, SalesCatalogPayload } from '../../api';

function formatMoney(value?: number) {
  if (value == null || value <= 0) return null;
  return `₹${Number(value).toLocaleString('en-IN')}`;
}

function OfferingCard({ deck }: { deck: SalesCatalogOffering }) {
  const investment =
    deck.investment_from || deck.investment_to
      ? [formatMoney(deck.investment_from), formatMoney(deck.investment_to)].filter(Boolean).join(' – ')
      : null;
  const pricing =
    deck.mrp_reference || deck.wholesale_reference
      ? `MRP ${formatMoney(deck.mrp_reference) || '—'} · Wholesale ${formatMoney(deck.wholesale_reference) || '—'}`
      : null;

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div className="toolbar" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h2 style={{ margin: 0 }}>{deck.title}</h2>
        {deck.brochure_page ? <span className="muted">Brochure p.{deck.brochure_page}</span> : null}
      </div>
      {deck.description ? <p className="muted">{deck.description}</p> : null}
      {investment ? <p><strong>Investment:</strong> {investment}</p> : null}
      {pricing ? <p><strong>Pricing:</strong> {pricing}</p> : null}
      {deck.points && deck.points.length > 0 ? (
        <ul>
          {deck.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function SalesCatalogPage() {
  const [data, setData] = useState<SalesCatalogPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getSalesCatalog()
      .then((res) => setData(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load catalog'));
  }, []);

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!data) {
    return <p>Loading pitch materials…</p>;
  }

  const company = data.company;

  return (
    <>
      <h1>Remedium Labs — sales catalog</h1>
      <p className="muted">
        {company?.tagline || 'Franchise pitch materials aligned with lab.remediumhealth.co.in'}
      </p>

      {company ? (
        <section className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>{company.name}</h2>
          <p className="muted">
            A Unit of {company.legal_name}
            {company.accreditation ? ` · ${company.accreditation}` : ''}
            {company.experience_years ? ` · ${company.experience_years}+ years` : ''}
          </p>
          <ul className="plain-list">
            {company.phone ? <li>Franchise: {company.phone}</li> : null}
            {company.home_collection_helpline ? (
              <li>
                Home collection: {company.home_collection_helpline}
                {company.home_collection_hours ? ` (${company.home_collection_hours})` : ''}
              </li>
            ) : null}
            {company.email ? <li>{company.email}</li> : null}
          </ul>
        </section>
      ) : null}

      <div className="toolbar" style={{ marginTop: 16, gap: 12 }}>
        {data.franchise_portal_url ? (
          <a className="btn" href={data.franchise_portal_url} target="_blank" rel="noreferrer">
            Franchise web page
          </a>
        ) : null}
        {data.brochure_url ? (
          <a className="btn secondary" href={data.brochure_url} target="_blank" rel="noreferrer">
            Download brochure (PDF)
          </a>
        ) : null}
        {company?.public_site ? (
          <a className="btn secondary" href={company.public_site} target="_blank" rel="noreferrer">
            Public website
          </a>
        ) : null}
      </div>

      <h2 style={{ marginTop: 28 }}>Franchise models</h2>
      {data.pitch_decks.map((deck) => (
        <OfferingCard key={deck.offering_code || deck.title} deck={deck} />
      ))}

      {data.diagnostic_services && data.diagnostic_services.length > 0 ? (
        <>
          <h2 style={{ marginTop: 28 }}>Diagnostic services</h2>
          {data.diagnostic_services.map((deck) => (
            <OfferingCard key={deck.offering_code || deck.title} deck={deck} />
          ))}
        </>
      ) : null}

      {data.health_packages && data.health_packages.length > 0 ? (
        <>
          <h2 style={{ marginTop: 28 }}>Health packages</h2>
          {data.health_packages.map((deck) => (
            <OfferingCard key={deck.offering_code || deck.title} deck={deck} />
          ))}
        </>
      ) : null}

      {data.addons && data.addons.length > 0 ? (
        <>
          <h2 style={{ marginTop: 28 }}>Add-on services</h2>
          {data.addons.map((deck) => (
            <OfferingCard key={deck.offering_code || deck.title} deck={deck} />
          ))}
        </>
      ) : null}

      {data.panels.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <h2>Featured test panels</h2>
          <div className="grid grid-cards">
            {data.panels.map((p) => (
              <article key={p.name} className="card">
                <h3>{p.panel_name || p.name}</h3>
                {p.description ? <p className="muted">{p.description}</p> : null}
                {p.rate != null || p.panel_rate != null ? (
                  <strong>₹{Number(p.rate ?? p.panel_rate).toFixed(0)}</strong>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {data.popular_tests.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <h2>Popular tests (MRP reference)</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Test</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.popular_tests.map((t) => (
                <tr key={t.name}>
                  <td>{t.item_name || t.name}</td>
                  <td>₹{Number(t.standard_rate || 0).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
