import { useMemo, useState } from 'react';
import { NavLink, Outlet, Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isAgencyPortalUser, isAgencyStaff, isHrRecruiter } from '../auth/roles';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MobileBottomNav, MobileMenuButton, MobileNav, type MobileNavItem } from './MobileNav';
import '../pages/agents/agents-portal.css';

export function AgentsLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isPublicLanding = location.pathname === '/agents' || location.pathname === '/agents/';

  const mobileNavItems = useMemo((): MobileNavItem[] => {
    return [
      { type: 'link', to: '/agents/app', label: 'Dashboard', end: true },
      { type: 'link', to: '/agents/me', label: 'My profile' },
      { type: 'link', to: '/agents/franchisees', label: 'Franchisees' },
      { type: 'link', to: '/agents/team', label: 'Team' },
      { type: 'link', to: '/agents/commissions', label: 'Commissions' },
      { type: 'link', to: '/agents/levels', label: 'Levels' },
      { type: 'link', to: '/agents', label: 'Onboard form' },
      { type: 'link', to: '/', label: 'Home' },
      { type: 'button', label: 'Logout', onClick: logout },
    ];
  }, [logout]);

  // HR-only identities must not use the Agents shell — send them to dedicated HR login/portal.
  if (user && isHrRecruiter(user.roles) && !isAgencyPortalUser(user.roles)) {
    return <Navigate to="/hr/applications" replace />;
  }

  // Public onboarding landing (no agency chrome)
  if (isPublicLanding) {
    return (
      <div className="page">
        <Outlet />
      </div>
    );
  }

  if (!user || !isAgencyStaff(user.roles)) {
    return (
      <div className="page">
        <div className="card card-wide">
          <h1>Agency Agents</h1>
          <p>Agency Agent or Manager login required. HR staff must use the separate HR login.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Link className="btn" to="/login?next=/agents/app">
              Agency login
            </Link>
            <Link className="btn secondary" to="/agents">
              Apply to become an agent
            </Link>
            <Link className="btn secondary" to="/hr/login">
              HR login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`page b2b-layout agents-layout${isMobile ? ' has-bottom-nav' : ''}`}>
      <header className="b2b-header agents-header">
        <div className="b2b-header-leading">
          {isMobile ? (
            <MobileMenuButton open={menuOpen} onToggle={() => setMenuOpen((v) => !v)} />
          ) : null}
          <div>
            <Link to="/agents/app" className="brand">
              e-Remedium · Agents
            </Link>
            <p className="muted">{user.full_name || user.user}</p>
          </div>
        </div>
        <nav className="b2b-nav b2b-nav-desktop" aria-label="Agents">
          <NavLink to="/agents/app" end>
            Dashboard
          </NavLink>
          <NavLink to="/agents/me">My profile</NavLink>
          <NavLink to="/agents/franchisees">Franchisees</NavLink>
          <NavLink to="/agents/team">Team</NavLink>
          <NavLink to="/agents/commissions">Commissions</NavLink>
          <NavLink to="/agents/levels">Levels</NavLink>
          <NavLink to="/agents">Onboard form</NavLink>
          <button type="button" className="btn-link" onClick={logout}>
            Logout
          </button>
        </nav>
      </header>
      <MobileNav open={menuOpen && isMobile} onClose={() => setMenuOpen(false)} items={mobileNavItems} />
      <main className="b2b-main agents-main">
        <Outlet />
      </main>
      {isMobile ? (
        <MobileBottomNav
          items={[
            { to: '/agents/app', label: 'Home', end: true },
            { to: '/agents/me', label: 'Me' },
            { to: '/agents/franchisees', label: 'Franchise' },
            { to: '/agents/commissions', label: 'Pay' },
          ]}
        />
      ) : null}
    </div>
  );
}
