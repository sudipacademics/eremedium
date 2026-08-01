import { useMemo, useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isSalesStaff } from '../auth/roles';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MobileBottomNav, MobileMenuButton, MobileNav, type MobileNavItem } from './MobileNav';
import { getSalesBottomNavItems } from './roleBottomNav';
import '../pages/sales/reach-portal.css';

export function SalesLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const rep = user?.user?.split('@')[0];

  const mobileNavItems = useMemo((): MobileNavItem[] => {
    return [
      { type: 'link', to: '/sales', label: 'Portal', end: true },
      { type: 'link', to: '/sales/leads', label: 'Leads' },
      { type: 'link', to: '/sales/visit', label: 'Log visit' },
      { type: 'link', to: '/sales/onboard', label: 'Onboard' },
      { type: 'link', to: '/sales/franchisees', label: 'Franchisees' },
      { type: 'link', to: '/sales/catalog', label: 'Catalog' },
      { type: 'link', to: '/sales/commissions', label: 'Commissions' },
      { type: 'link', to: '/sales/reports', label: 'Closing reports' },
      { type: 'link', to: '/sales/map', label: 'Team map' },
      { type: 'link', to: '/dashboard/hr', label: 'HR' },
      { type: 'link', to: '/', label: 'Consumer home' },
      { type: 'button', label: 'Logout', onClick: logout },
    ];
  }, [logout]);

  if (!user || !isSalesStaff(user.roles)) {
    return (
      <div className="page">
        <div className="card card-wide">
          <h1>Field sales</h1>
          <p>Sales representative or manager login required.</p>
          <Link className="btn" to="/login">
            Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`page b2b-layout sales-layout reach-shell${isMobile ? ' has-bottom-nav' : ''}`}>
      <header className="b2b-header">
        <div className="b2b-header-leading">
          {isMobile ? (
            <MobileMenuButton open={menuOpen} onToggle={() => setMenuOpen((v) => !v)} />
          ) : null}
          <div>
            <Link to="/sales" className="brand">
              Field sales · MR tracker
            </Link>
            <p className="muted">{user.full_name || rep}</p>
          </div>
        </div>
        <nav className="b2b-nav b2b-nav-desktop" aria-label="Sales">
          <NavLink to="/sales" end>
            Portal
          </NavLink>
          <NavLink to="/sales/leads">Leads</NavLink>
          <NavLink to="/sales/visit">Log visit</NavLink>
          <NavLink to="/sales/onboard">Onboard</NavLink>
          <NavLink to="/sales/franchisees">Franchisees</NavLink>
          <NavLink to="/sales/catalog">Catalog</NavLink>
          <NavLink to="/sales/commissions">Commissions</NavLink>
          <NavLink to="/sales/reports">Closing</NavLink>
          <NavLink to="/sales/map">Team map</NavLink>
          <NavLink to="/dashboard/hr">HR</NavLink>
          <button type="button" className="btn-link" onClick={logout}>
            Logout
          </button>
        </nav>
      </header>
      <MobileNav open={menuOpen && isMobile} onClose={() => setMenuOpen(false)} items={mobileNavItems} />
      <main className="b2b-main">
        <Outlet />
      </main>
      {isMobile ? <MobileBottomNav items={getSalesBottomNavItems()} /> : null}
    </div>
  );
}
