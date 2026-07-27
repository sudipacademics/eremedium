'use client';

import { appPath } from '@rfms/utils';
import { CompanyLogo, CompanyProfile } from './company-profile';
import './company-profile.css';
import './site-footer.css';

export function SiteFooter({ company }: { company: CompanyProfile }) {
  return <footer className="site-footer">
    <div className="footer-main">
      <section className="footer-company">
        <a className="footer-logo" href={appPath('/')} aria-label={`${company.company_name} home`}><CompanyLogo profile={company} /></a>
        <p>Building trusted, fair-price diagnostic businesses that bring accessible healthcare closer to local communities.</p>
      </section>
      <section className="footer-address">
        <h2>Visit our franchisee hub</h2>
        <address><b>{company.franchise_hub_name}</b><span>{company.office_address}</span></address>
        <div className="footer-contact-details">
          {company.company_phone ? <a href={`tel:${company.company_phone.replace(/\s+/g, '')}`}>{company.company_phone}</a> : null}
          {company.company_email ? <a href={`mailto:${company.company_email}`}>{company.company_email}</a> : null}
          {!company.company_phone && !company.company_email ? <span>Consultations are available by confirmed appointment.</span> : null}
        </div>
      </section>
      <nav className="footer-links" aria-label="Footer navigation">
        <h2>Franchise resources</h2>
        {company.brochure_url ? <a href={company.brochure_url} target="_blank" rel="noreferrer">Download brochure <span aria-hidden="true">↓</span></a> : <span className="footer-disabled">Brochure coming soon</span>}
        <a href={appPath('/disclaimer')}>Disclaimer</a>
        <a href={appPath('/terms-and-conditions')}>Terms &amp; conditions</a>
        <a href={appPath('/privacy-policy')}>Privacy policy</a>
        <a href={appPath('/contact-us')}>Contact us</a>
      </nav>
    </div>
    <div className="footer-bottom"><span>© 2026 {company.legal_name}. All rights reserved.</span><span>Remedium Lab Franchise Management System</span></div>
  </footer>;
}
