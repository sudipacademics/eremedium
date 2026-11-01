import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, type FranchiseeProfile, type PartnerCircuit } from '../api';
import { useAuth } from '../auth/AuthContext';
import { isFranchisee, isPfCustomer } from '../auth/roles';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MobileBottomNav, MobileMenuButton, MobileNav, type MobileNavItem } from './MobileNav';
import { getB2bBottomNavItems } from './roleBottomNav';
import bannerPhoto from '../assets/partner-community.jpg';
import '../pages/b2b/b2b-portal.css';
import '../pages/b2b/partner-portal-v2.css';

function HubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 21h18" />
      <path d="M5 21V8l7-4 7 4v13" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function hubDisplayName(franchisee?: FranchiseeProfile | null) {
  return (franchisee?.franchise_name || '').trim() || 'Partner hub';
}

function hubBranchLine(franchisee?: FranchiseeProfile | null) {
  const parts = [
    franchisee?.branch_code ? `Branch: ${franchisee.branch_code}` : '',
    franchisee?.territory_region || '',
  ].filter(Boolean);
  return parts.join(' · ') || 'Branch details pending from Franchise Directory';
}

export function B2bLayout() {
  const { user, logout, refreshSession, loading } = useAuth();
  const location = useLocation();
  const [hub, setHub] = useState<FranchiseeProfile | null>(user?.franchisee ?? null);
  const [circuit, setCircuit] = useState<PartnerCircuit | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const initial = (user?.fullName || user?.full_name || user?.user || 'F').trim().charAt(0).toUpperCase();

  useEffect(() => {
    setHub(user?.franchisee ?? null);
  }, [user?.franchisee]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [portalRes] = await Promise.all([
          api.getB2bPortal(),
          refreshSession().catch(() => null),
        ]);
        if (cancelled) return;
        const fromPortal = portalRes.data.franchisee;
        if (fromPortal?.franchise_name || fromPortal?.branch_code) {
          setHub((prev) => ({ ...(prev || { name: fromPortal.name }), ...fromPortal }));
        }
      } catch {
        /* keep session franchisee */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  useEffect(() => {
    let cancelled = false;
    void api
      .getPartnerCircuit()
      .then((res) => {
        if (!cancelled) setCircuit(res.data);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  const onCircuit = Boolean(circuit?.tier);
  const showWalkIn = !onCircuit || circuit?.tier === 'FOCO' || Boolean(circuit?.services?.phlebotomy);
  const showShipments = circuit?.tier === 'Master FOCO' || circuit?.tier === 'Orange FOCO' || Boolean(circuit?.has_lab);
  // Entry partners (any circuit tier) raise Vector bills; mapped Vectors see what they owe.
  const showVectorBills = onCircuit || Boolean(circuit?.vector_entry);

  const mobileNavItems = useMemo((): MobileNavItem[] => {
    const items: MobileNavItem[] = [
      { type: 'link', to: '/b2b/hub', label: 'Hub dashboard' },
      { type: 'link', to: '/b2b/catalog', label: 'Catalog' },
    ];
    if (showWalkIn) items.push({ type: 'link', to: '/b2b/order', label: 'Walk-in order' });
    if (showShipments) items.push({ type: 'link', to: '/b2b/shipments', label: 'Accession & Shipment' });
    if (showVectorBills) items.push({ type: 'link', to: '/b2b/vector-bills', label: 'Vector B2B Bills' });
    items.push({ type: 'link', to: '/b2b/phlebofirst', label: 'PhleboFirst' });
    items.push({ type: 'link', to: '/b2b/consumables', label: 'Consumables Inventory' });
    items.push(
      { type: 'link', to: '/b2b/bill-status', label: 'Bill Status' },
      { type: 'link', to: '/b2b/download-report', label: 'Download Report' },
      { type: 'link', to: '/b2b/wallet', label: 'Wallet' },
      { type: 'link', to: '/b2b/earnings', label: 'Business Earnings' },
      { type: 'link', to: '/b2b/centres', label: 'Centres' },
      { type: 'link', to: '/b2b/statements', label: 'Statements' },
      { type: 'link', to: '/', label: 'Home' },
    );
    return items;
  }, [showWalkIn, showShipments, showVectorBills]);

  if (loading) {
    return (
      <div className="page-center">
        <p className="muted">Checking session…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!isFranchisee(user.roles)) {
    if (isPfCustomer(user.roles)) return <Navigate to="/pf" replace />;
    return (
      <div className="partners-shell">
        <div className="partners-body">
          <div className="partners-order-card">
            <h1 className="partners-page-title">Partners portal</h1>
            <p className="partners-page-lead">Franchise operator login required.</p>
            <Link className="partners-btn partners-btn-primary" to="/login">
              Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const hubName = hubDisplayName(hub);
  const branchLine = hubBranchLine(hub);
  const contactBits = [hub?.contact_phone, hub?.contact_email].filter(Boolean).join(' · ');

  return (
    <div className={`partners-shell pp2-shell${isMobile ? ' has-bottom-nav' : ''}`}>
      <header className="partners-topbar">
        <div className="partners-topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isMobile ? (
              <MobileMenuButton open={menuOpen} onToggle={() => setMenuOpen((value) => !value)} />
            ) : null}
            <Link to="/b2b/hub" className="partners-brand">
              Remedium
            </Link>
          </div>
          <div className="partners-top-actions">
            <Link className="partners-top-link" to="/">
              Home
            </Link>
            <span className="partners-avatar" aria-hidden>
              {initial}
            </span>
            <button type="button" className="partners-logout" onClick={logout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="partners-body">
        <div className="pp2-hub">
          <div className="pp2-hub-card">
            <div className="pp2-hub-icon">
              <HubIcon />
            </div>
            <div>
              <h2>B2B · {hubName}</h2>
              <p>{branchLine}</p>
              {hub?.address ? <p>{hub.address}</p> : null}
              {contactBits ? <p>{contactBits}</p> : null}
            </div>
          </div>
          <div className="pp2-banner" aria-hidden style={{ backgroundImage: `url(${bannerPhoto})` }}>
            <img src={bannerPhoto} alt="" />
            <div className="pp2-banner-copy">
              <strong>Together for Healthier Communities</strong>
              <small>Fair Price · Accurate Reports · Trusted Network</small>
            </div>
          </div>
        </div>

        <nav className="pp2-nav partners-nav-desktop" aria-label="Partners">
          <NavLink to="/b2b/hub">Hub dashboard</NavLink>
          <NavLink to="/b2b/catalog">Catalog</NavLink>
          {showWalkIn ? <NavLink to="/b2b/order">Walk-in order</NavLink> : null}
          {showShipments ? <NavLink to="/b2b/shipments">Accession &amp; Shipment</NavLink> : null}
          {showVectorBills ? <NavLink to="/b2b/vector-bills">Vector B2B Bills</NavLink> : null}
          <NavLink to="/b2b/phlebofirst">PhleboFirst</NavLink>
          <NavLink to="/b2b/consumables">Consumables Inventory</NavLink>
          <NavLink to="/b2b/bill-status">Bill Status</NavLink>
          <NavLink to="/b2b/download-report">Download Report</NavLink>
          <NavLink to="/b2b/wallet">Wallet</NavLink>
          <NavLink to="/b2b/earnings">Business Earnings</NavLink>
          <NavLink to="/b2b/centres">Centres</NavLink>
          <NavLink to="/b2b/statements">Statements</NavLink>
        </nav>

        <MobileNav open={menuOpen && isMobile} onClose={() => setMenuOpen(false)} items={mobileNavItems} />
        <main className="partners-main">
          <Outlet />
        </main>
      </div>

      {isMobile ? <MobileBottomNav items={getB2bBottomNavItems()} /> : null}
    </div>
  );
}

export function PartnersPageHeader({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <>
      <h1 className="partners-page-title">{title}</h1>
      {lead ? <p className="partners-page-lead">{lead}</p> : null}
    </>
  );
}
