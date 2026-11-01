import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BRANCHES,
  HELPDESK,
  STOCK,
  UNITS,
  VENDORS,
  isUnitId,
  unitById,
} from '../data';
import { Icon, LogoMark, type IconName } from '../icons';
import { useOps } from '../store';
import { ActionModal } from './Forms';
import { AlertBubble } from './ui';

type NavChild = { to: string; label: string; icon: IconName };
type NavItem = { to: string; label: string; icon: IconName; end?: boolean; badge?: boolean; children?: NavChild[] };

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  {
    to: '/units',
    label: 'Unit Operations',
    icon: 'units',
    children: UNITS.map((unit) => ({ to: `/units/${unit.id}`, label: unit.short, icon: unit.id })),
  },
  { to: '/bookings', label: 'Bookings & Orders', icon: 'bookings' },
  { to: '/services', label: 'Service Operations', icon: 'services' },
  { to: '/logistics', label: 'Logistics & Collection', icon: 'logistics' },
  { to: '/inventory', label: 'Inventory & Purchase', icon: 'inventory' },
  { to: '/vendors', label: 'Vendor Management', icon: 'vendors' },
  { to: '/quality', label: 'Quality & Compliance', icon: 'quality' },
  { to: '/approvals', label: 'Approvals', icon: 'approvals', badge: true },
  { to: '/assets', label: 'Assets', icon: 'assets' },
  { to: '/reports', label: 'Reports & Analytics', icon: 'reports' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function pageTitle(pathname: string) {
  if (pathname === '/') return 'Operations Dashboard';
  if (pathname === '/units') return 'Unit Operations';
  if (pathname.startsWith('/units/')) {
    const id = pathname.split('/')[2];
    return isUnitId(id) ? unitById(id).short : 'Unit Operations';
  }
  const hit = NAV.find((item) => item.to === pathname);
  return hit?.label ?? 'Smilecure Operations';
}

export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const ops = useOps();
  const [unitsOpen, setUnitsOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.title = `${pageTitle(location.pathname)} · Smilecure Operations`;
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith('/units')) setUnitsOpen(true);
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuery('');
        ops.setPaletteOpen(true);
        ops.setBellOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ops]);

  const dateLine = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const timeLine = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const unread = ops.alerts.some((alert) => alert.unread);

  const hits = useMemo(() => {
    const pages = NAV.flatMap((item) => [
      { label: item.label, hint: 'Page', to: item.to },
      ...(item.children ?? []).map((child) => ({ label: child.label, hint: 'Unit', to: child.to })),
    ]);
    const bookings = ops.bookings.map((booking) => ({
      label: booking.patient,
      hint: `${booking.id} · ${booking.service}`,
      to: '/bookings',
    }));
    const tasks = ops.tasks.map((task) => ({ label: task.title, hint: 'Task', to: '/services' }));
    const branches = BRANCHES.map((branch) => ({
      label: branch.name,
      hint: `${branch.area} · ${unitById(branch.unit).name}`,
      to: '/reports',
    }));
    const items = STOCK.map((item) => ({ label: item.name, hint: `Stock · ${item.branch}`, to: '/inventory' }));
    const vendors = VENDORS.map((vendor) => ({ label: vendor.name, hint: vendor.category, to: '/vendors' }));
    const all = [...pages, ...bookings, ...tasks, ...branches, ...items, ...vendors];
    const needle = query.trim().toLowerCase();
    if (!needle) return pages.slice(0, 8);
    return all.filter((hit) => `${hit.label} ${hit.hint}`.toLowerCase().includes(needle)).slice(0, 10);
  }, [ops.bookings, ops.tasks, query]);

  return (
    <div className="app">
      {menuOpen ? <button type="button" className="backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} /> : null}
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <NavLink to="/" className="brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark">
            <LogoMark />
          </span>
          <span>
            <strong>Smilecure</strong>
            <span>Operations Portal</span>
          </span>
        </NavLink>
        <nav className="nav-scroll" aria-label="Operations">
          {NAV.map((item) =>
            item.children ? (
              <div key={item.to} className="nav-block">
                <div className={`nav-link parent${location.pathname === item.to ? ' active' : ''}`}>
                  <NavLink to={item.to}>
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </NavLink>
                  <button
                    type="button"
                    className={`chev-btn${unitsOpen ? ' open' : ''}`}
                    aria-expanded={unitsOpen}
                    aria-label="Toggle unit operations"
                    onClick={() => setUnitsOpen((open) => !open)}
                  >
                    <Icon name="chevron" size={16} />
                  </button>
                </div>
                {unitsOpen ? (
                  <div className="nav-sub">
                    {item.children.map((child) => (
                      <NavLink key={child.to} to={child.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                        <Icon name={child.icon} size={16} />
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                <Icon name={item.icon} size={18} />
                {item.label}
                {item.badge && ops.approvalCounts.pending > 0 ? <span className="badge">{ops.approvalCounts.pending}</span> : null}
              </NavLink>
            ),
          )}
        </nav>
        <a className="help" href={`mailto:${HELPDESK.email}`}>
          <span className="ic">
            <Icon name="headset" size={18} />
          </span>
          <span>
            <strong>{HELPDESK.label}</strong>
            <span>{HELPDESK.email}</span>
          </span>
        </a>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
            <Icon name="menu" size={18} />
          </button>
          <button
            type="button"
            className="search"
            onClick={() => {
              setQuery('');
              ops.setPaletteOpen(true);
            }}
          >
            <Icon name="search" size={18} />
            <span>Search bookings, patients, units, orders, inventory...</span>
            <kbd>Ctrl + K</kbd>
          </button>
          <div className="top-meta">
            <div className="bell-wrap">
              <button
                type="button"
                className="icon-btn"
                aria-label="Alerts"
                aria-expanded={ops.bellOpen}
                onClick={() => ops.setBellOpen(!ops.bellOpen)}
              >
                <Icon name="bell" size={18} />
                {unread ? <span className="dot" /> : null}
              </button>
              {ops.bellOpen ? (
                <div className="bell-panel">
                  <div className="panel-head">
                    <strong>Alerts & exceptions</strong>
                    <button type="button" className="text-btn" onClick={ops.markAlertsRead}>
                      Mark read
                    </button>
                  </div>
                  {ops.alerts.map((alert) => (
                    <button
                      key={alert.id}
                      type="button"
                      className={`alert-row${alert.unread ? ' unread' : ''}`}
                      onClick={() => {
                        ops.setBellOpen(false);
                        navigate(alert.href);
                      }}
                    >
                      <AlertBubble tone={alert.tone} />
                      <span>{alert.text}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="when">
              <strong>{dateLine}</strong>
              <span>{timeLine}</span>
            </div>
            <NavLink to="/settings" className="user">
              <span className="avatar">OM</span>
              <span>
                <strong>Operations Manager</strong>
                <span>Smilecure Operations</span>
              </span>
            </NavLink>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>
      {ops.paletteOpen ? (
        <div className="palette-root">
          <button type="button" className="palette-backdrop" aria-label="Close search" onClick={() => ops.setPaletteOpen(false)} />
          <div className="palette" role="dialog" aria-modal="true" aria-label="Search the portal">
            <input
              autoFocus
              value={query}
              placeholder="Search bookings, patients, units, orders, inventory..."
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') ops.setPaletteOpen(false);
                if (event.key === 'Enter' && hits[0]) {
                  ops.setPaletteOpen(false);
                  navigate(hits[0].to);
                }
              }}
            />
            <div className="hit-list">
              {hits.length === 0 ? <p className="empty">Nothing matches that search.</p> : null}
              {hits.map((hit) => (
                <button
                  key={`${hit.to}-${hit.label}`}
                  type="button"
                  className="hit"
                  onClick={() => {
                    ops.setPaletteOpen(false);
                    navigate(hit.to);
                  }}
                >
                  <span>
                    <b>{hit.label}</b>
                    <span>{hit.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <ActionModal />
      <div className="toasts" aria-live="polite">
        {ops.toasts.map((item) => (
          <button key={item.id} type="button" className="toast" onClick={() => ops.dismissToast(item.id)}>
            {item.text}
          </button>
        ))}
      </div>
    </div>
  );
}
