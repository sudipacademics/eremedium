'use client';

import { useEffect, useState } from 'react';
import { useCompanyProfile } from './company-profile';
import { RFMS_API_BASE, RFMS_PORTAL_ORIGIN, appPath } from '@rfms/utils';
import { SiteFooter } from './site-footer';
import { SiteNav } from './site-nav';
import './company-profile.css';
import './information-page.css';
import './site.css';
import './responsive.css';

export type InformationPageKind = 'disclaimer' | 'terms' | 'privacy' | 'contact';

type SupportSettings = {
  whatsapp_number: string;
  ivr_call_number: string;
  technical_support_number: string;
  technical_whatsapp_number: string;
  support_email: string;
};

const PRIVACY_SECTIONS = [
  ['Information we collect', 'We collect the contact and business information you submit through franchise enquiry, appointment and application forms. Where an application requires KYC documents, those documents are used only to process, verify and administer the franchise application.'],
  ['How we use information', 'Remedium Lab uses this information to respond to enquiries, assess franchise opportunities, arrange consultations, process applications, verify documents, record payment activity and provide franchise support.'],
  ['Sharing and retention', 'Information is shared only with authorised Remedium Lab personnel and service providers who need it to operate the franchise process. We retain records for as long as reasonably necessary for the application, contractual, legal and operational purposes.'],
  ['Security', 'We use reasonable administrative and technical safeguards to protect information. Please do not send passwords or sensitive documents by ordinary email unless Remedium Lab specifically asks you to do so through an approved process.'],
  ['Your choices', 'You may contact us to update your contact information or ask questions about how your information is used. Requests may be subject to applicable legal, contractual and record-keeping requirements.'],
] as const;

function SplitContent({ value }: { value: string }) {
  return <>{value.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</>;
}

function phoneHref(number: string) {
  const digits = number.replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 10 ? `tel:+91${digits}` : `tel:+${digits}`;
}

function whatsappHref(number: string, message: string) {
  const digits = number.replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function InformationPage({ kind }: { kind: InformationPageKind }) {
  const company = useCompanyProfile();
  const [supportSettings, setSupportSettings] = useState<SupportSettings | null>(null);
  const isContact = kind === 'contact';
  const title = kind === 'disclaimer' ? 'Disclaimer' : kind === 'terms' ? 'Terms & conditions' : kind === 'privacy' ? 'Privacy policy' : 'Contact us';
  const eyebrow = isContact ? 'Remedium Lab Franchisee Hub' : 'Remedium Lab information';

  useEffect(() => {
    if (!isContact) return;
    void fetch(`${RFMS_API_BASE}/content/support-settings`)
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (response.ok && body?.success && body.data) setSupportSettings(body.data as SupportSettings);
      })
      .catch(() => undefined);
  }, [isContact]);

  const businessCallHref = phoneHref(supportSettings?.ivr_call_number ?? '');
  const businessWhatsappHref = whatsappHref(supportSettings?.whatsapp_number ?? '', 'Hello Remedium Lab, I would like franchise support.');
  const technicalCallHref = phoneHref(supportSettings?.technical_support_number ?? '');
  const technicalWhatsappHref = whatsappHref(supportSettings?.technical_whatsapp_number ?? '', 'Hello Remedium Lab technical support, I need help with the portal or application.');
  const supportEmail = supportSettings?.support_email?.trim() ?? company.company_email;

  return <main className="information-site">
    <SiteNav variant="information" showLogin={false} />

    <section className="information-hero">
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <span>{isContact ? `Speak with the ${company.company_name} franchise team about your next business opportunity.` : 'Important information for visitors, applicants and prospective franchise partners.'}</span>
    </section>

    {isContact ? <section className="contact-page-content">
      <div className="contact-intro-panel"><div><p className="information-label">Let&apos;s connect</p><h2>Build your diagnostic business with clarity.</h2><p>Speak with the franchise team, plan a business consultation, or begin your FOFO or FOCO franchise application.</p></div><div className="contact-intro-stats"><span><b>FOFO</b><small>Operate your centre</small></span><span><b>FOCO</b><small>Invest with guided operations</small></span></div></div>
      <div className="contact-page-grid">
        <article className="contact-card contact-card-primary">
          <p className="information-label">Franchisee hub</p>
          <h2>{company.franchise_hub_name}</h2>
          <address>{company.office_address}</address>
          <a className="contact-direction-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(company.office_address)}`} target="_blank" rel="noreferrer">Get directions <span aria-hidden="true">↗</span></a>
          <div className="contact-methods">
            {businessCallHref ? <a href={businessCallHref}><small>Business call</small><b>{supportSettings?.ivr_call_number}</b><span>Speak with the franchise desk</span></a> : null}
            {supportEmail ? <a href={`mailto:${supportEmail}`}><small>Email us</small><b>{supportEmail}</b><span>Send a franchise enquiry</span></a> : null}
            {businessWhatsappHref ? <a className="whatsapp-contact" href={businessWhatsappHref} target="_blank" rel="noreferrer"><small>Business WhatsApp</small><b>{supportSettings?.whatsapp_number}</b><span>Message the franchise team</span></a> : null}
            {!businessCallHref && !supportEmail && !businessWhatsappHref ? <p>Contact details can be added by the administrator. Consultations are available by confirmed appointment.</p> : null}
          </div>
        </article>
        <article className="contact-card contact-card-action">
          <p className="information-label">Business consultation</p>
          <h2>Plan your next business move.</h2>
          <p>Tell us where you would like to build. Our team will guide you through model selection, territory review and the next application step.</p>
          <div className="contact-cta-actions"><a href={appPath('/#apply')}>Book an appointment</a><a className="contact-secondary" href={RFMS_PORTAL_ORIGIN}>Start application</a></div>
          <div className="contact-assurance"><span>✓</span><p><b>Appointment-led guidance</b><br />Choose a convenient consultation time before you apply.</p></div>
        </article>
      </div>
      <article className="contact-card contact-card-technical">
        <p className="information-label">Technical support</p>
        <h2>Need help with the portal or application?</h2>
        <p>Contact our technical helpdesk for applicant portal access, document uploads, payment issues or other technical queries.</p>
        <div className="contact-cta-actions">
          {technicalCallHref ? <a className="contact-technical-support" href={technicalCallHref}>Call technical support</a> : null}
          {technicalWhatsappHref ? <a className="contact-secondary contact-technical-whatsapp" href={technicalWhatsappHref} target="_blank" rel="noreferrer">WhatsApp technical support</a> : null}
        </div>
      </article>
      <section className="contact-map-card"><div className="contact-map-copy"><p className="information-label">Find the hub</p><h2>Visit our franchisee hub.</h2><p>Use the interactive map to plan your visit. Location and map details are managed by the Super Admin.</p><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(company.office_address)}`} target="_blank" rel="noreferrer">Open in Google Maps</a></div><div className="contact-map-frame"><iframe title={`${company.franchise_hub_name} location map`} src={company.google_map_embed_url} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div></section>
    </section> : <section className="information-content">
      {kind === 'disclaimer' ? <><h2>Website disclaimer</h2><SplitContent value={company.footer_disclaimer} /><h2>Financial and territory information</h2><p>Any investment illustrations, profitability estimates, territory availability, service descriptions and timelines are indicative. They must not be treated as a guarantee of business performance, approval, exclusivity or revenue.</p></> : null}
      {kind === 'terms' ? <><h2>Website terms &amp; conditions</h2><SplitContent value={company.footer_terms} /><h2>Franchise applications</h2><p>FOFO and FOCO franchise applications require separate model-specific terms acceptance before submission and payment. The final rights and obligations of an approved franchise partner are set out in the applicable signed agreement.</p></> : null}
      {kind === 'privacy' ? <>{PRIVACY_SECTIONS.map(([heading, copy]) => <section key={heading}><h2>{heading}</h2><p>{copy}</p></section>)}<section><h2>Contact us about privacy</h2><p>For privacy questions, use the contact details on our Contact Us page. We will respond through the appropriate Remedium Lab team.</p></section></> : null}
    </section>}
    <SiteFooter company={company} />
  </main>;
}
