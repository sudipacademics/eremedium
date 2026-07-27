'use client';

import { useEffect, useState } from 'react';
import { RFMS_PORTAL_ORIGIN, appPath } from '@rfms/utils';
import { CompanyLogo, useCompanyProfile } from './company-profile';

type SiteNavVariant = 'home' | 'information' | 'detail';

type SiteNavProps = {
  variant?: SiteNavVariant;
  onLoginClick?: () => void;
  applyHref?: string;
  showLogin?: boolean;
};

const NAV_LINKS = [
  { href: '/#models', label: 'Franchise models' },
  { href: '/#territory', label: 'Territory' },
  { href: '/#why-remedium', label: 'Why Remedium' },
] as const;

export function SiteNav({ variant = 'home', onLoginClick, applyHref = RFMS_PORTAL_ORIGIN, showLogin = variant === 'home' }: SiteNavProps) {
  const company = useCompanyProfile();
  const [open, setOpen] = useState(false);
  const homeHref = appPath('/');
  const applyLink = applyHref || RFMS_PORTAL_ORIGIN;

  useEffect(() => {
    const onResize = () => { if (window.innerWidth > 960) setOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('site-nav-open', open);
    return () => { document.body.classList.remove('site-nav-open'); };
  }, [open]);

  const headerClass = variant === 'information' ? 'information-nav site-nav-shell' : variant === 'detail' ? 'detail-header site-nav-shell' : 'site-nav site-nav-shell';
  const brandClass = variant === 'information' ? 'information-brand site-brand' : variant === 'detail' ? 'detail-brand site-brand' : 'site-brand';
  const applyClass = variant === 'information' ? 'information-apply primary nav-apply' : variant === 'detail' ? 'apply primary nav-apply' : 'primary nav-apply';

  function closeMenu() {
    setOpen(false);
  }

  return (
    <>
      <header className={headerClass}>
        <a className={brandClass} href={homeHref} aria-label={`${company.company_name} home`} onClick={closeMenu}>
          <CompanyLogo profile={company} />
        </a>
        <button type="button" className="site-nav-toggle" aria-expanded={open} aria-controls="site-primary-nav" onClick={() => setOpen((current) => !current)}>
          <span className="site-nav-toggle-bar" />
          <span className="site-nav-toggle-bar" />
          <span className="site-nav-toggle-bar" />
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
        </button>
        <nav id="site-primary-nav" className={open ? 'open' : ''} aria-label="Primary navigation">
          {NAV_LINKS.map((link) => <a key={link.href} href={appPath(link.href)} onClick={closeMenu}>{link.label}</a>)}
          {variant === 'detail' ? <a href={homeHref} onClick={closeMenu}>Home</a> : null}
          <a className={`${applyClass} nav-apply-mobile`} href={applyLink} onClick={closeMenu}>Apply for franchisee</a>
        </nav>
        <div className="nav-actions">
          {showLogin && onLoginClick ? (
            <button className="login-icon" type="button" onClick={() => { closeMenu(); onLoginClick(); }} aria-label="Login" title="Login">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.25" /><path d="M5.5 19c.8-3.2 3.1-5 6.5-5s5.7 1.8 6.5 5" /></svg>
            </button>
          ) : null}
          <a className={applyClass} href={applyLink}>Apply for franchisee</a>
        </div>
      </header>
      {open ? <button type="button" className="site-nav-backdrop" aria-label="Close menu" onClick={closeMenu} /> : null}
    </>
  );
}
