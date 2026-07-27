'use client';

import { appPath } from '@rfms/utils';
import { CompanyProfile } from './company-profile';
import './why-remedium.css';

function CheckIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19.5 6.5" /></svg>;
}

export function WhyRemedium({ company }: { company: CompanyProfile }) {
  const benefits = [company.why_remedium_point_one, company.why_remedium_point_two, company.why_remedium_point_three].filter(Boolean);

  return <section id="why-remedium" className="why-remedium" aria-labelledby="why-remedium-title">
    <div className="why-remedium-copy">
      <p className="why-remedium-eyebrow">{company.why_remedium_eyebrow}</p>
      <h2 id="why-remedium-title">{company.why_remedium_title}</h2>
      <p className="why-remedium-intro">{company.why_remedium_intro}</p>
      <p className="why-remedium-body">{company.why_remedium_body}</p>
      <ul>{benefits.map((benefit) => <li key={benefit}><span><CheckIcon /></span>{benefit}</li>)}</ul>
    </div>
    <aside className="nabl-card" aria-label="NABL accreditation quality commitment">
      <div className="nabl-badge-wrap"><img src={company.why_remedium_badge_url} alt="NABL accreditation mark" onError={(event) => { event.currentTarget.src = appPath('/nabl-accreditation-badge.svg'); }} /></div>
      <div><span className="nabl-card-kicker">Quality you can build on</span><h3>NABL-accredited diagnostic standards</h3><p>A quality-first foundation for trusted sample collection, reporting and patient confidence.</p></div>
    </aside>
  </section>;
}
