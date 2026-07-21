import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isFranchisee } from '../auth/roles';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MobileBottomNav, MobileMenuButton, MobileNav, type MobileNavItem } from './MobileNav';
import { getB2bBottomNavItems } from './roleBottomNav';

export function B2bLayout() {
  const { user, logout } = useAuth();
  const franchisee = user?.franchisee;
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const mobileNavItems = useMemo((): MobileNavItem[] => {
    return [
      { type: 'link', to: '/b2b', label: 'Overview', end: true },
      { type: 'link', to: '/b2b/catalog', label: 'Catalog' },
      { type: 'link', to: '/b2b/order', label: 'Walk-in order' },
      { type: 'link', to: '/b2b/wallet', label: 'Wallet' },
      { type: 'link', to: '/b2b/statements', label: 'Statements' },
      { type: 'link', to: '/dashboard/franchisee', label: 'Hub dashboard' },
      { type: 'link', to: '/', label: 'Consumer home' },
      { type: 'button', label: 'Logout', onClick: logout },
    ];
  }, [logout]);

  if (!user || !isFranchisee(user.roles)) {
    return (
      <div className="page">
        <div className="card card-wide">
          <h1>B2B portal</h1>
          <p>Franchise operator login required.</p>
          <Link className="btn" to="/login">
            Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`page b2b-layout${isMobile ? ' has-bottom-nav' : ''}`}>
      <header className="b2b-header">
        <div className="b2b-header-leading">
          {isMobile ? (
            <MobileMenuButton open={menuOpen} onToggle={() => setMenuOpen((v) => !v)} />
          ) : null}
          <div>
            <Link to="/b2b" className="brand">
              B2B · {franchisee?.franchise_name || 'Franchise'}
            </Link>
            <p className="muted">
              Branch {franchisee?.branch_code || '—'}
              {franchisee?.territory_region ? ` · ${franchisee.territory_region}` : ''}
            </p>
          </div>
        </div>
        <nav className="b2b-nav b2b-nav-desktop" aria-label="B2B">
          <NavLink to="/b2b" end>
            Overview
          </NavLink>
          <NavLink to="/b2b/catalog">Catalog</NavLink>
          <NavLink to="/b2b/order">Walk-in order</NavLink>
          <NavLink to="/b2b/wallet">Wallet</NavLink>
          <NavLink to="/b2b/statements">Statements</NavLink>
          <NavLink to="/dashboard/franchisee">Hub dashboard</NavLink>
          <button type="button" className="btn-link" onClick={logout}>
            Logout
          </button>
        </nav>
      </header>
      <MobileNav open={menuOpen && isMobile} onClose={() => setMenuOpen(false)} items={mobileNavItems} />
      <main className="b2b-main">
        <Outlet />
      </main>
      {isMobile ? <MobileBottomNav items={getB2bBottomNavItems()} /> : null}
    </div>
  );
}
