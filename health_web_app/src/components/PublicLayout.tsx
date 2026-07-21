import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { getDefaultDashboardRoute, isPatientPortal, isPhlebotomist } from '../auth/roles';
import { NavDropdown } from './NavDropdown';
import { MobileBottomNav, MobileMenuButton, MobileNav, type MobileNavItem } from './MobileNav';
import { useMediaQuery } from '../hooks/useMediaQuery';

export function PublicLayout() {
  const { isAuthenticated, logout, user } = useAuth();
  const { count: cartCount } = useCart();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const roles = user?.roles ?? [];
  const patientPortal = !user || isPatientPortal(roles);
  const phlebo = Boolean(user && isPhlebotomist(roles));
  const showBottomNav = isMobile && patientPortal && !phlebo && location.pathname !== '/login';

  const relationshipItems = isAuthenticated
    ? [
        { to: '/journey', label: 'Care journey' },
        { to: '/bookings', label: 'My orders' },
        { to: '/pharmacy', label: 'Pharmacy' },
      ]
    : [{ to: '/login', label: 'Sign in to view' }];

  const mobileNavItems = useMemo((): MobileNavItem[] => {
    if (phlebo) {
      return [
        { type: 'link', to: '/dashboard/phlebotomist', label: 'Collections', end: true },
        { type: 'link', to: '/dashboard/phlebotomist/reports', label: 'Reports' },
        { type: 'button', label: 'Logout', onClick: logout },
      ];
    }
    const items: MobileNavItem[] = [
      { type: 'link', to: '/', label: 'Home', end: true },
    ];
    if (patientPortal) {
      items.push({ type: 'link', to: '/services', label: 'Services' });
      items.push({ type: 'link', to: '/wellness', label: 'Wellness' });
      items.push({ type: 'link', to: '/circle', label: 'Health Circle' });
      items.push({ type: 'link', to: '/insurance', label: 'Insurance' });
      items.push({ type: 'link', to: '/pharmacy', label: 'Medicines' });
    }
    if (isAuthenticated && patientPortal) {
      for (const rel of relationshipItems) {
        items.push({ type: 'link', to: rel.to, label: rel.label });
      }
    }
    if (isAuthenticated && !patientPortal && user) {
      items.push({ type: 'link', to: getDefaultDashboardRoute(roles), label: 'Dashboard' });
    }
    if (patientPortal) {
      items.push({
        type: 'link',
        to: '/pharmacy/cart',
        label: cartCount > 0 ? `Cart (${cartCount})` : 'Cart',
      });
    }
    if (isAuthenticated) {
      items.push({ type: 'link', to: '/account', label: 'Account' });
      items.push({ type: 'button', label: 'Logout', onClick: logout });
    } else {
      items.push({ type: 'link', to: '/login', label: 'Login' });
    }
    return items;
  }, [cartCount, isAuthenticated, logout, patientPortal, phlebo, relationshipItems, roles, user]);

  const bottomNavItems = useMemo(() => {
    const ordersTo = isAuthenticated ? '/bookings' : '/login';
    const accountTo = isAuthenticated ? '/account' : '/login';
    return [
      { to: '/', label: 'Home', end: true },
      { to: '/services', label: 'Services' },
      { to: '/pharmacy/cart', label: 'Cart', badge: cartCount },
      { to: ordersTo, label: 'Orders' },
      { to: accountTo, label: 'Account' },
    ];
  }, [cartCount, isAuthenticated]);

  return (
    <div className={`layout layout-public${showBottomNav ? ' has-bottom-nav' : ''}`}>
      <header className="header">
        <div className="header-inner">
          <div className="header-leading">
            {isMobile ? (
              <MobileMenuButton open={menuOpen} onToggle={() => setMenuOpen((v) => !v)} />
            ) : null}
            <Link to={phlebo ? '/dashboard/phlebotomist' : '/'} className="brand">
              Remedium
            </Link>
          </div>
          <nav className="nav nav-desktop" aria-label="Main">
            {phlebo ? (
              <>
                <NavLink to="/dashboard/phlebotomist" end>
                  Collections
                </NavLink>
                <NavLink to="/dashboard/phlebotomist/reports">Reports</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/" end>
                  Home
                </NavLink>
                {patientPortal && <NavLink to="/services">Services</NavLink>}
                {patientPortal && <NavLink to="/wellness">Wellness</NavLink>}
                {patientPortal && <NavLink to="/circle">Health Circle</NavLink>}
                {patientPortal && <NavLink to="/insurance">Insurance</NavLink>}
                {isAuthenticated && patientPortal && (
                  <NavDropdown label="My relationship" items={relationshipItems} />
                )}
                {isAuthenticated && !patientPortal && user && (
                  <NavLink to={getDefaultDashboardRoute(roles)}>Dashboard</NavLink>
                )}
                {patientPortal && <NavLink to="/pharmacy">Medicines</NavLink>}
              </>
            )}
            {isAuthenticated ? (
              <button className="btn secondary btn-sm" type="button" onClick={logout}>
                Logout
              </button>
            ) : (
              <NavLink to="/login">Login</NavLink>
            )}
          </nav>
        </div>
      </header>
      <MobileNav open={menuOpen && isMobile} onClose={() => setMenuOpen(false)} items={mobileNavItems} />
      <main className="page">
        <Outlet />
      </main>
      {showBottomNav ? <MobileBottomNav items={bottomNavItems} /> : null}
    </div>
  );
}
