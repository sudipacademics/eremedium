import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { WINGS, initials } from '../data';
import { Icon, LogoMark, type IconName } from '../icons';
import { useCrm } from '../store';
import { AddLeadModal, BookingModal, StartFranchiseModal } from './Forms';

type NavItem = { to: string; label: string; icon: IconName; end?: boolean };

const NAV: NavItem[] = [
  { to: '/', label: 'CRM Dashboard', icon: 'dashboard', end: true },
  { to: '/leads', label: 'Lead Management', icon: 'leads' },
  { to: '/contacts', label: 'Contacts', icon: 'contacts' },
  { to: '/accounts', label: 'Accounts / Organizations', icon: 'accounts' },
  { to: '/deals', label: 'Deals & Opportunities', icon: 'deals' },
  { to: '/activities', label: 'Follow-up Management', icon: 'activities' },
  { to: '/bookings', label: 'Bookings', icon: 'bookings' },
  { to: '/franchise', label: 'Franchise (FFMS/RFMS)', icon: 'franchise' },
  { to: '/partner-bookings', label: 'Partner Unit Bookings', icon: 'partner' },
  { to: '/campaigns', label: 'Campaigns', icon: 'campaigns' },
  { to: '/reports', label: 'Reports & Analytics', icon: 'reports' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function pageTitle(pathname: string) {
  const hit = NAV.find((item) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)));
  return hit?.label ?? 'Smilecure CRM';
}

export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const crm = useCrm();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<'lead' | 'aesthetic' | 'care' | 'partner' | 'franchise' | null>(null);

  useEffect(() => {
    document.title = `${pageTitle(location.pathname)} · Smilecure CRM`;
    setMenuOpen(false);
  }, [location.pathname]);

  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return [
      ...crm.leads.map((l) => ({ label: l.name, hint: `${l.id} · ${l.wing}`, to: '/leads' })),
      ...crm.bookings.map((b) => ({ label: b.patient, hint: `${b.id} · ${b.service}`, to: '/bookings' })),
      ...crm.deals.map((d) => ({ label: d.title, hint: d.id, to: '/deals' })),
    ]
      .filter((h) => `${h.label} ${h.hint}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [crm.leads, crm.bookings, crm.deals, query]);

  return (
    <div className="app">
      {menuOpen ? <button type="button" className="backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} /> : null}
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <a className="brand" href="/">
          <span className="brand-mark">
            <LogoMark />
          </span>
          <span>
            <strong>Smilecure Lifestyle</strong>
            <span>Private Limited</span>
          </span>
        </a>
        <nav className="nav-scroll">
          {NAV.slice(0, 6).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon name={item.icon} size={17} />
              {item.label}
            </NavLink>
          ))}
          <div className="nav-label">Telecaller actions</div>
          {NAV.slice(6, 9).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon name={item.icon} size={17} />
              {item.label}
            </NavLink>
          ))}
          <div className="nav-label">Business Wings CRM</div>
          {WINGS.filter((w) => w.id !== 'franchise').map((wing) => (
            <button
              key={wing.id}
              type="button"
              className={`nav-wing${crm.wingFilter === wing.id ? ' active' : ''}`}
              onClick={() => {
                crm.setWingFilter(wing.id);
                navigate('/leads');
              }}
            >
              <span className="dot" style={{ background: wing.color }} />
              {wing.name}
            </button>
          ))}
          <div className="nav-label">More</div>
          {NAV.slice(9).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon name={item.icon} size={17} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label="Menu" onClick={() => setMenuOpen(true)}>
            <Icon name="menu" />
          </button>
          <div className="top-title">
            <h1>
              Smilecure CRM <span className="badge-pill">CRM Portal</span>
            </h1>
            <p>Lead · Opportunity · Sales · Customer Relationship for All Business Wings.</p>
          </div>
          <div className="search">
            <Icon name="search" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search leads, contacts, deals…"
              aria-label="Global search"
            />
          </div>
          <div className="top-actions">
            <button type="button" className="btn btn-primary" onClick={() => setModal('lead')}>
              <Icon name="plus" size={16} /> Add Lead
            </button>
            <button type="button" className="icon-btn" aria-label="Notifications">
              <Icon name="bell" />
              <span className="ping" />
            </button>
            <button type="button" className="icon-btn" aria-label="Calendar" onClick={() => navigate('/activities')}>
              <Icon name="calendar" />
            </button>
            <button type="button" className="icon-btn" aria-label="Help">
              <Icon name="help" />
            </button>
            <div className="user">
              <span className="avatar">{initials(crm.userName)}</span>
              <span>
                <strong>{crm.userName}</strong>
                <small>{crm.userRoleLabel}</small>
              </span>
            </div>
          </div>
        </header>

        {hits.length > 0 ? (
          <div className="content" style={{ paddingBottom: 0 }}>
            <div className="card" style={{ marginBottom: 0 }}>
              {hits.map((hit) => (
                <button
                  key={hit.label + hit.hint}
                  type="button"
                  className="btn btn-ghost"
                  style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 4 }}
                  onClick={() => {
                    setQuery('');
                    navigate(hit.to);
                  }}
                >
                  <strong>{hit.label}</strong>
                  <span style={{ color: 'var(--muted)', marginLeft: 8 }}>{hit.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="content">
          <Outlet context={{ openModal: setModal }} />
        </div>
      </div>

      <div className="toast-stack">
        {crm.toasts.map((t) => (
          <div key={t.id} className={`toast${t.tone === 'err' ? ' err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>

      {modal === 'lead' ? <AddLeadModal onClose={() => setModal(null)} /> : null}
      {modal === 'aesthetic' || modal === 'care' || modal === 'partner' ? (
        <BookingModal mode={modal} onClose={() => setModal(null)} />
      ) : null}
      {modal === 'franchise' ? <StartFranchiseModal onClose={() => setModal(null)} /> : null}
    </div>
  );
}
