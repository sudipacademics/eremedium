import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type SiteFooterLink, type SiteFooterPayload } from '../api';

const FALLBACK_HELPLINE = '+91 8100149230';
const FALLBACK_WHATSAPP = 'https://wa.me/918100149230';

const FALLBACK_FOOTER: SiteFooterPayload = {
  brand: 'Remedium',
  tagline: 'a unit of Smilecure Lifestyle Pvt. Ltd',
  seo_tagline: "India's First Fair Price Diagnostic Lab",
  seo_keywords:
    'Remedium, Remedium Lab, Remedium Aesthetic, Remedium Care, fair price diagnostic lab India',
  home_collection_helpline: FALLBACK_HELPLINE,
  home_collection_hours: '9:00 AM – 8:00 PM',
  home_collection_tel: 'tel:+918100149230',
  home_collection_cta_label: `Call ${FALLBACK_HELPLINE}`,
  social: [
    { code: 'SOC-FACEBOOK', title: 'Facebook', url: 'https://www.facebook.com/remedium.health', icon: 'facebook', open_in_new_tab: true },
    { code: 'SOC-INSTAGRAM', title: 'Instagram', url: 'https://www.instagram.com/remedium.health', icon: 'instagram', open_in_new_tab: true },
    { code: 'SOC-YOUTUBE', title: 'YouTube', url: 'https://www.youtube.com/@remediumhealth', icon: 'youtube', open_in_new_tab: true },
    { code: 'SOC-LINKEDIN', title: 'LinkedIn', url: 'https://www.linkedin.com/company/remedium-health', icon: 'linkedin', open_in_new_tab: true },
    { code: 'SOC-X', title: 'X', url: 'https://x.com/remediumhealth', icon: 'x', open_in_new_tab: true },
  ],
  legal: [
    { title: 'Privacy Policy', url: '/legal/privacy-policy' },
    { title: 'Disclaimer', url: '/legal/disclaimer' },
    { title: 'Terms & Conditions', url: '/legal/terms-and-conditions' },
    { title: 'Refund Policy', url: '/legal/refund-policy' },
    { title: 'Data Use Policy', url: '/legal/data-use-policy' },
  ],
};

const PATIENT_LINKS: SiteFooterLink[] = [
  { title: 'Book Lab Test', url: '/diagnostics' },
  { title: 'Health Packages', url: '/diagnostics?q=package' },
  { title: 'Home Collection', url: '/diagnostics' },
  { title: 'View Reports', url: '/reports' },
  { title: 'Find Nearest Centre', url: '/centres' },
  { title: 'Patient Support', url: '/contact' },
  { title: 'Download App', url: '#footer-apps' },
];

const COMPANY_LINKS: SiteFooterLink[] = [
  { title: 'About Us', url: '/about' },
  { title: 'Our Lab', url: '/accreditations' },
  { title: 'Remedium Aesthetic', url: 'https://remediumaesthetics.in', open_in_new_tab: true },
  { title: 'Centres', url: '/centres' },
  { title: 'Health Circle', url: '/circle' },
  { title: 'Careers', url: 'https://career.e-remedium.in', open_in_new_tab: true },
  { title: 'Contact Us', url: '/contact' },
];

const RESOURCE_LINKS: SiteFooterLink[] = [
  { title: 'NABL Accreditation', url: '/accreditations' },
  { title: 'Certifications', url: '/accreditations' },
  { title: 'Test Price List', url: '/diagnostics' },
  { title: 'Blog', url: '/blog' },
  { title: 'News & Updates', url: '/press' },
  { title: 'Knowledge Centre', url: '/knowledge' },
  { title: 'FAQ', url: '/faq' },
];

const TRUST_ITEMS = [
  { icon: 'shield', label: 'Fair Price' },
  { icon: 'flask', label: 'NABL Accredited' },
  { icon: 'people', label: 'Trusted by Thousands' },
  { icon: 'bolt', label: 'Fast & Accurate' },
] as const;

const PRIMARY_SOCIAL = ['facebook', 'instagram', 'youtube', 'linkedin', 'x'] as const;

function isInternalPath(url: string) {
  return url.startsWith('/') && !url.startsWith('//');
}

function telFromHelpline(helpline: string) {
  const first = helpline.split(/[/,|]/)[0] || helpline;
  const digits = first.replace(/\D/g, '');
  if (digits.length < 10) return '';
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `tel:+${withCountry}`;
}

function waFromHelpline(helpline: string) {
  const digits = (helpline.split(/[/,|]/)[0] || helpline).replace(/\D/g, '');
  if (digits.length < 10) return FALLBACK_WHATSAPP;
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCountry}`;
}

function FooterAnchor({ link, className = 'site-footer-link' }: { link: SiteFooterLink; className?: string }) {
  if (link.url.startsWith('#')) {
    return (
      <a className={className} href={link.url}>
        {link.title}
      </a>
    );
  }
  if (isInternalPath(link.url)) {
    return (
      <Link className={className} to={link.url}>
        {link.title}
      </Link>
    );
  }
  return (
    <a
      className={className}
      href={link.url}
      target={link.open_in_new_tab ? '_blank' : undefined}
      rel={link.open_in_new_tab ? 'noopener noreferrer' : undefined}
    >
      {link.title}
    </a>
  );
}

function Icon({ name }: { name: string }) {
  const common = { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true as const };
  if (name === 'person') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
      </svg>
    );
  }
  if (name === 'building') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 20V7l8-4 8 4v13" />
        <path d="M9 20v-6h6v6M9 10h.01M15 10h.01M12 10h.01" />
      </svg>
    );
  }
  if (name === 'book') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 8H20" />
      </svg>
    );
  }
  if (name === 'shield') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3 5 6v6c0 4.2 2.8 7.4 7 8.5 4.2-1.1 7-4.3 7-8.5V6z" />
      </svg>
    );
  }
  if (name === 'flask') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M9 3h6M10 3v5.2L5.8 17a3.2 3.2 0 0 0 2.8 4.6h6.8a3.2 3.2 0 0 0 2.8-4.6L14 8.2V3" />
      </svg>
    );
  }
  if (name === 'people') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="9" cy="8" r="2.4" />
        <circle cx="16" cy="9" r="2" />
        <path d="M4.5 18a4.5 4.5 0 0 1 9 0M14 18a3.8 3.8 0 0 1 5.5 0" />
      </svg>
    );
  }
  if (name === 'bolt') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M13 3 6 13h6l-1 8 7-10h-6z" />
      </svg>
    );
  }
  if (name === 'headset') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 13V11a8 8 0 0 1 16 0v2" />
        <path d="M4 13a2.5 2.5 0 0 0 2.5 2.5H8V13H4zM20 13a2.5 2.5 0 0 1-2.5 2.5H16V13h4z" />
        <path d="M16 18.5A4 4 0 0 1 12 21" />
      </svg>
    );
  }
  if (name === 'phone') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M22 16.9v2a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h2a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L7.1 9.9a16 16 0 0 0 6 6l1.5-1.1a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" />
      </svg>
    );
  }
  if (name === 'whatsapp') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M12 3.2A8.3 8.3 0 0 0 5.1 16.4L4 20.2l3.9-1A8.3 8.3 0 1 0 12 3.2zm4.7 11.8c-.2.5-1.1.9-1.5 1-.4 0-.8.2-2.6-.6-2.2-1-3.6-3.3-3.7-3.5s-1-1.3-1-2.5.6-1.8.8-2 .4-.3.6-.3h.4c.2 0 .3 0 .5.4l.7 1.6c.1.2 0 .4 0 .5l-.3.4c-.1.1-.3.3-.1.6s.7 1.1 1.5 1.8c1 .8 1.8 1 2.1 1.1s.4 0 .6-.2.7-.8.9-1.1.3-.2.5-.1l1.6.8c.2.1.3.1.4.2s0 .4-.1.8z" />
      </svg>
    );
  }
  if (name === 'mail') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
        <path d="m4.5 7.5 7.5 6 7.5-6" />
      </svg>
    );
  }
  return null;
}

function SocialSvg({ icon }: { icon?: string }) {
  const common = { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true as const };
  if (icon === 'facebook') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M14 8h3V5h-3c-2.2 0-4 1.8-4 4v2H7v3h3v7h3v-7h3l1-3h-4V9c0-.6.4-1 1-1z" />
      </svg>
    );
  }
  if (icon === 'instagram') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (icon === 'youtube') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18.1 5 12 5 12 5s-6.1 0-7.7.3A2.7 2.7 0 0 0 2.4 7.2 28 28 0 0 0 2 12a28 28 0 0 0 .4 4.8 2.7 2.7 0 0 0 1.9 1.9C5.9 19 12 19 12 19s6.1 0 7.7-.3a2.7 2.7 0 0 0 1.9-1.9A28 28 0 0 0 22 12a28 28 0 0 0-.4-4.8zM10 15.2V8.8L15.5 12 10 15.2z" />
      </svg>
    );
  }
  if (icon === 'linkedin') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M6.4 9.2H3.6V20h2.8V9.2zM5 4a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 0 0 5 4zm15 7.3c0-2.4-1.5-3.9-3.8-3.9-1.1 0-2 .4-2.6 1.2h-.1V9.2H10.8c0 .7 0 8.1 0 10.8h2.8v-6c0-.3 0-.7.1-1 .3-.7.9-1.4 2-1.4 1.4 0 2 1.1 2 2.7V20H21v-6.2c0-3-.9-5.5-3.9-5.5z" />
      </svg>
    );
  }
  if (icon === 'x') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M14.7 10.3 21.2 3h-1.5l-5.6 6.3L9.6 3H3.8l6.9 9.8L3.8 21h1.5l6-6.8L14.7 21h5.8l-7.8-10.7zM12 13.3l-.7-1L6 4.2h2.4l4.2 5.9.7 1 5.5 7.7h-2.4L12 13.3z" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="currentColor">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

function SocialIcon({ link }: { link: SiteFooterLink }) {
  const className = `site-footer-social-icon-btn icon-${link.icon || 'link'}`;
  const body = (
    <>
      <SocialSvg icon={link.icon} />
      <span className="sr-only">{link.title}</span>
    </>
  );
  if (isInternalPath(link.url)) {
    return (
      <Link className={className} to={link.url} title={link.title} aria-label={link.title}>
        {body}
      </Link>
    );
  }
  return (
    <a
      className={className}
      href={link.url}
      title={link.title}
      aria-label={link.title}
      target={link.open_in_new_tab === false ? undefined : '_blank'}
      rel="noopener noreferrer"
    >
      {body}
    </a>
  );
}

type Props = {
  compact?: boolean;
};

export function SiteFooter({ compact = false }: Props) {
  const [footer, setFooter] = useState<SiteFooterPayload>(FALLBACK_FOOTER);
  const [whatsappUrl, setWhatsappUrl] = useState(FALLBACK_WHATSAPP);
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.getSiteFooter().catch(() => null),
      api.getHomeContent().catch(() => null),
    ]).then(([res, home]) => {
      if (cancelled) return;
      if (res?.data) {
        const helpline = (res.data.home_collection_helpline || FALLBACK_HELPLINE).trim();
        setFooter({
          ...FALLBACK_FOOTER,
          ...res.data,
          social: res.data.social?.length ? res.data.social : FALLBACK_FOOTER.social,
          legal: res.data.legal?.length ? res.data.legal : FALLBACK_FOOTER.legal,
          home_collection_helpline: helpline,
          home_collection_tel: res.data.home_collection_tel || telFromHelpline(helpline),
          home_collection_cta_label: res.data.home_collection_cta_label || `Call ${helpline}`,
        });
        if (!home?.data?.whatsapp_cta?.url) {
          setWhatsappUrl(waFromHelpline(helpline));
        }
      }
      const wa = home?.data?.whatsapp_cta;
      if (wa?.enabled !== false && wa?.url) setWhatsappUrl(wa.url);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const legal = footer.legal?.length ? footer.legal : FALLBACK_FOOTER.legal || [];
  const socialRow = useMemo(() => {
    const source = footer.social?.length ? footer.social : FALLBACK_FOOTER.social || [];
    const byIcon = new Map(source.map((item) => [(item.icon || '').toLowerCase(), item]));
    if (!byIcon.has('x')) {
      const twitter = source.find((item) => (item.icon || '').toLowerCase() === 'twitter' || /x\.com|twitter/i.test(item.url));
      if (twitter) byIcon.set('x', { ...twitter, icon: 'x' });
    }
    return PRIMARY_SOCIAL.map((icon) => byIcon.get(icon)).filter(Boolean) as SiteFooterLink[];
  }, [footer.social]);

  const helpline = footer.home_collection_helpline || FALLBACK_HELPLINE;
  const tel = footer.home_collection_tel || telFromHelpline(helpline);
  const callLabel = `Call ${helpline}`;

  function onSubscribe(e: FormEvent) {
    e.preventDefault();
    const next = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return;
    setSubscribed(next);
    setEmail('');
  }

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <footer className={`site-footer${compact ? ' site-footer-compact' : ''}`}>
      <div className="site-footer-inner">
        <div className="site-footer-main">
          <div className="site-footer-brand-col">
            <Link to="/" className="site-footer-logo">
              <span className="site-footer-mark" aria-hidden>
                <svg viewBox="0 0 32 32" width="28" height="28">
                  <path
                    fill="currentColor"
                    d="M13.2 3.4h5.6c1.2 0 1.9.8 1.9 1.9v6.1h6.1c1.1 0 1.9.8 1.9 1.9v5.6c0 1.1-.8 1.9-1.9 1.9h-6.1v6.1c0 1.1-.7 1.9-1.9 1.9h-5.6c-1.1 0-1.9-.8-1.9-1.9v-6.1H5.2c-1.1 0-1.9-.8-1.9-1.9v-5.6c0-1.1.8-1.9 1.9-1.9h6.1V5.3c0-1.1.8-1.9 1.9-1.9z"
                  />
                </svg>
              </span>
              <span>
                <strong>{footer.brand || 'Remedium'}</strong>
                <small>{footer.seo_tagline || FALLBACK_FOOTER.seo_tagline}</small>
              </span>
            </Link>
            <p className="site-footer-blurb">
              Accurate diagnostics, affordable for all. Book tests online, home collection, health packages
              and more — with transparency, accuracy and speed.
            </p>
            <ul className="site-footer-trust">
              {TRUST_ITEMS.map((item) => (
                <li key={item.label}>
                  <span className="site-footer-trust-icon">
                    <Icon name={item.icon} />
                  </span>
                  {item.label}
                </li>
              ))}
            </ul>
            {socialRow.length ? (
              <div className="site-footer-social-row" role="list">
                {socialRow.map((link) => (
                  <div key={link.code || link.url} role="listitem">
                    <SocialIcon link={link} />
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="site-footer-link-grid">
            <nav className="site-footer-col" aria-label="Patient Portal">
              <p className="site-footer-col-title">
                <Icon name="person" /> Patient Portal
              </p>
              {PATIENT_LINKS.map((link) => (
                <FooterAnchor key={link.url + link.title} link={link} />
              ))}
            </nav>
            <nav className="site-footer-col" aria-label="Company">
              <p className="site-footer-col-title">
                <Icon name="building" /> Company
              </p>
              {COMPANY_LINKS.map((link) => (
                <FooterAnchor key={link.url + link.title} link={link} />
              ))}
            </nav>
            <nav className="site-footer-col" aria-label="Resources">
              <p className="site-footer-col-title">
                <Icon name="book" /> Resources
              </p>
              {RESOURCE_LINKS.map((link) => (
                <FooterAnchor key={link.url + link.title} link={link} />
              ))}
            </nav>
            <nav className="site-footer-col" aria-label="Legal">
              <p className="site-footer-col-title">
                <Icon name="shield" /> Legal
              </p>
              {legal.map((link) => (
                <FooterAnchor key={link.url} link={link} />
              ))}
            </nav>
          </div>

          <div className="site-footer-aside">
            <section className="site-footer-card site-footer-help">
              <span className="site-footer-card-icon" aria-hidden>
                <Icon name="headset" />
              </span>
              <p className="site-footer-kicker">Need Help?</p>
              <h2>Home Collection</h2>
              <p>Book tests at your doorstep</p>
              {tel ? (
                <a className="site-footer-call" href={tel}>
                  <Icon name="phone" />
                  {callLabel}
                </a>
              ) : (
                <span className="site-footer-call is-disabled">{callLabel}</span>
              )}
              <a className="site-footer-wa" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <Icon name="whatsapp" />
                Chat on WhatsApp
                <span aria-hidden>→</span>
              </a>
            </section>

            <section className="site-footer-card site-footer-news">
              <span className="site-footer-card-icon" aria-hidden>
                <Icon name="mail" />
              </span>
              <h2>Get Health Tips &amp; Offers</h2>
              <p>Subscribe to our newsletter</p>
              {subscribed ? (
                <p className="site-footer-thanks">Thanks — we will send health tips to {subscribed}.</p>
              ) : (
                <form className="site-footer-subscribe" onSubmit={onSubscribe}>
                  <label className="sr-only" htmlFor="footer-newsletter-email">
                    Email address
                  </label>
                  <input
                    id="footer-newsletter-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email address"
                    required
                  />
                  <button type="submit">Subscribe</button>
                </form>
              )}
            </section>
          </div>
        </div>
      </div>

      <div className="site-footer-wave" aria-hidden>
        <svg viewBox="0 0 1440 48" preserveAspectRatio="none">
          <path d="M0 48V18c120 18 260 30 420 18C620 20 780 0 960 6c180 6 320 28 480 18v24z" />
        </svg>
      </div>

      <div className="site-footer-bar">
        <div className="site-footer-bar-inner">
          <p>
            © {new Date().getFullYear()} {footer.brand || 'Remedium'}. All rights reserved.
            <br />
            {footer.tagline || FALLBACK_FOOTER.tagline}
          </p>
          <p>{footer.seo_tagline || FALLBACK_FOOTER.seo_tagline}</p>
          <p>Transparency · Accuracy · Speed – Our promise to you.</p>
          <div className="site-footer-apps" id="footer-apps">
            <span>Download App</span>
            <a className="site-footer-store" href="/" title="Open Remedium on your phone">
              <strong>GET IT ON</strong>
              Google Play
            </a>
            <a className="site-footer-store" href="/" title="Open Remedium on your phone">
              <strong>Download on the</strong>
              App Store
            </a>
            <button type="button" className="site-footer-top" onClick={scrollTop} aria-label="Back to top">
              ↑
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
