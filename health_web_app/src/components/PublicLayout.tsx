import { FormEvent, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getDefaultDashboardRoute, isPatientPortal, isPhlebotomist } from '../auth/roles';
import { useCart } from '../cart/CartContext';
import { NavDropdown } from './NavDropdown';
import { MobileBottomNav, MobileMenuButton, MobileNav, type MobileNavItem } from './MobileNav';
import { SiteFooter } from './SiteFooter';
import { StructuredData } from './StructuredData';
import { GlobalSeoTags } from './GlobalSeoTags';
import { PortalAnalytics } from './PortalAnalytics';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { isB2bPortalHost, isCollectPortalHost, isLabtechPortalHost } from '../config/portalHosts';

function isPackagesQuery(search: string) {
  return new URLSearchParams(search).get('q')?.trim().toLowerCase() === 'package';
}

export function PublicLayout() {
  const { isAuthenticated, logout, user } = useAuth();
  const { count: cartCount } = useCart();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const isMobile = useMediaQuery('(max-width: 768px)');
  const packagesView = location.pathname === '/diagnostics' && isPackagesQuery(location.search);
  const labTestsView = location.pathname.startsWith('/diagnostics') && !packagesView;

  function onHeaderSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchQ.trim();
    navigate(q ? `/diagnostics?q=${encodeURIComponent(q)}` : '/diagnostics');
  }
  const roles = user?.roles ?? [];
  const patientPortal = !user || isPatientPortal(roles);
  const phlebo = Boolean(user && isPhlebotomist(roles));
  const isolatedStaffHost = isB2bPortalHost() || isCollectPortalHost() || isLabtechPortalHost();
  const partnerLogin = isolatedStaffHost;
  const showBottomNav = isMobile && patientPortal && !phlebo && location.pathname !== '/login' && !partnerLogin;

  const relationshipItems = isAuthenticated
    ? [
        { to: '/journey', label: 'Care journey' },
        { to: '/reports', label: 'Reports' },
        { to: '/bookings', label: 'My orders' },
        { to: '/prescriptions', label: 'Prescriptions' },
        { to: '/pharmacy', label: 'Rx refill' },
        { to: '/account', label: 'Account' },
      ]
    : [{ to: '/login', label: 'Sign in to view' }];

  const mobileNavItems = useMemo((): MobileNavItem[] => {
    if (phlebo) {
      return [
        { type: 'link', to: '/dashboard/phlebotomist', label: 'Dashboard', end: true },
        { type: 'link', to: '/dashboard/phlebotomist?view=map', label: 'Route Map' },
        { type: 'link', to: '/dashboard/phlebotomist/reports', label: 'Reports' },
        { type: 'link', to: '/dashboard/profile', label: 'My Profile' },
        { type: 'button', label: 'Logout', onClick: logout },
      ];
    }
    const items: MobileNavItem[] = [{ type: 'link', to: '/', label: 'Home', end: true }];
    if (patientPortal) {
      items.push({
        type: 'link',
        to: '/diagnostics',
        label: 'Lab Tests',
        className: labTestsView ? 'active' : '',
        current: labTestsView,
      });
      items.push({
        type: 'link',
        to: '/diagnostics?q=package',
        label: 'Health Packages',
        className: packagesView ? 'active' : '',
        current: packagesView,
      });
      items.push({ type: 'link', to: '/services', label: 'Doctors' });
      items.push({ type: 'link', to: '/centres', label: 'Centres' });
      items.push({ type: 'link', to: '/circle', label: 'Health Circle' });
      items.push({ type: 'link', to: '/insurance', label: 'Insurance' });
      items.push({ type: 'link', to: '/pharmacy', label: 'Rx refill' });
    }
    if (isAuthenticated && patientPortal) {
      for (const rel of relationshipItems) {
        items.push({ type: 'link', to: rel.to, label: rel.label });
      }
    }
    if (isAuthenticated && !patientPortal && user) {
      items.push({ type: 'link', to: getDefaultDashboardRoute(roles), label: 'Dashboard' });
    }
    if (isAuthenticated) {
      items.push({ type: 'link', to: '/account', label: 'Account' });
      items.push({ type: 'button', label: 'Logout', onClick: logout });
    } else {
      items.push({ type: 'link', to: '/login', label: 'Login' });
      items.push({ type: 'link', to: '/signup', label: 'Sign Up' });
    }
    return items;
  }, [isAuthenticated, labTestsView, logout, packagesView, patientPortal, phlebo, relationshipItems, roles, user]);

  const bottomNavItems = useMemo(() => {
    const ordersTo = isAuthenticated ? '/bookings' : '/login';
    const accountTo = isAuthenticated ? '/account' : '/login';
    return [
      { to: '/', label: 'Home', end: true },
      { to: '/diagnostics', label: 'Labs' },
      { to: '/centres', label: 'Centres' },
      { to: ordersTo, label: 'Orders' },
      { to: accountTo, label: 'Account' },
    ];
  }, [isAuthenticated]);

  if (partnerLogin) {
    return (
      <div className="layout layout-partner-login">
        <StructuredData />
        <GlobalSeoTags />
        <Outlet />
      </div>
    );
  }

  return (
    <div className={`layout layout-public${showBottomNav ? ' has-bottom-nav' : ''}`}>
      <StructuredData />
      <GlobalSeoTags />
      <header className="header site-header">
        <div className="header-inner">
          <div className="header-leading">
            {isMobile ? (
              <MobileMenuButton open={menuOpen} onToggle={() => setMenuOpen((v) => !v)} />
            ) : null}
            <Link to={phlebo ? '/dashboard/phlebotomist' : '/'} className="brand">
              <span className="brand-copy">
                <strong>Remedium</strong>
              </span>
            </Link>
            {isMobile && !phlebo && patientPortal ? (
              <div className="header-tools header-tools-mobile">
                <form className="header-search is-open" onSubmit={onHeaderSearch} role="search">
                  <input
                    type="search"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="Search"
                    aria-label="Search tests and packages"
                  />
                </form>
                <Link to="/pharmacy/cart" className="header-icon-btn header-cart" aria-label={cartCount ? `Cart, ${cartCount} items` : 'Cart'}>
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <circle cx="9" cy="20" r="1.3" />
                    <circle cx="18" cy="20" r="1.3" />
                    <path d="M3.5 4h2l1.6 10.2A2 2 0 0 0 9 16h9.2a2 2 0 0 0 2-1.6L22 8H7" />
                  </svg>
                  {cartCount ? <span className="header-cart-count">{cartCount > 9 ? '9+' : cartCount}</span> : null}
                </Link>
              </div>
            ) : null}
          </div>
          <nav className="nav nav-desktop" aria-label="Main">
            {phlebo ? (
              <>
                <NavLink to="/dashboard/phlebotomist" end>
                  Dashboard
                </NavLink>
                <NavLink to="/dashboard/phlebotomist/reports">Reports</NavLink>
                <NavLink to="/dashboard/profile">My Profile</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/" end>
                  Home
                </NavLink>
                {patientPortal && (
                  <Link
                    to="/diagnostics"
                    className={labTestsView ? 'active' : undefined}
                    aria-current={labTestsView ? 'page' : undefined}
                  >
                    Lab Tests
                  </Link>
                )}
                {patientPortal && (
                  <Link
                    className={`header-nav-optional${packagesView ? ' active' : ''}`}
                    to="/diagnostics?q=package"
                    aria-current={packagesView ? 'page' : undefined}
                  >
                    Health Packages
                  </Link>
                )}
                {patientPortal && <NavLink to="/services">Doctors</NavLink>}
                {patientPortal && <NavLink to="/centres">Centres</NavLink>}
                {patientPortal && <NavLink to="/circle">Health Circle</NavLink>}
                {patientPortal && (
                  <NavLink className="header-nav-tight" to="/insurance">
                    Insurance
                  </NavLink>
                )}
                {isAuthenticated && patientPortal && (
                  <NavDropdown label="My care" items={relationshipItems} />
                )}
                {isAuthenticated && !patientPortal && user && (
                  <NavLink to={getDefaultDashboardRoute(roles)}>Dashboard</NavLink>
                )}
              </>
            )}
          </nav>
          <div className="header-end">
            {!phlebo && patientPortal ? (
              <div className="header-tools">
                <form className="header-search" onSubmit={onHeaderSearch} role="search">
                  <button type="submit" className="header-icon-btn" aria-label="Search tests and packages">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="6.5" />
                      <path d="M16 16l5 5" />
                    </svg>
                  </button>
                  <input
                    type="search"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="Search tests & packages"
                    aria-label="Search tests and packages"
                  />
                </form>
                <Link to="/pharmacy/cart" className="header-icon-btn header-cart" aria-label={cartCount ? `Cart, ${cartCount} items` : 'Cart'}>
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <circle cx="9" cy="20" r="1.3" />
                    <circle cx="18" cy="20" r="1.3" />
                    <path d="M3.5 4h2l1.6 10.2A2 2 0 0 0 9 16h9.2a2 2 0 0 0 2-1.6L22 8H7" />
                  </svg>
                  {cartCount ? <span className="header-cart-count">{cartCount > 9 ? '9+' : cartCount}</span> : null}
                </Link>
              </div>
            ) : null}
            {isAuthenticated ? (
              <>
                <Link to="/account" className="header-avatar" aria-label="Account" title={user?.fullName || 'Account'}>
                  {(user?.fullName || user?.user || 'U').slice(0, 1).toUpperCase()}
                </Link>
                <button className="btn secondary btn-sm" type="button" onClick={logout}>
                  Logout
                </button>
              </>
            ) : (
              <div className="header-auth">
                <Link className="header-signup" to="/login">
                  Login / Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>
      <MobileNav open={menuOpen && isMobile} onClose={() => setMenuOpen(false)} items={mobileNavItems} />
      <main className="page">
        <Outlet />
      </main>
      {!phlebo ? <SiteFooter /> : null}
      {patientPortal && !phlebo ? <PortalAnalytics /> : null}
      {showBottomNav ? <MobileBottomNav items={bottomNavItems} /> : null}
    </div>
  );
}
