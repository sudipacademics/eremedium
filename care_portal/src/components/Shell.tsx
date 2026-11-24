import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../icons';
import { useApi, useCare, withQuery } from '../store';
import type { AlertNote, ModuleName } from '../types';
import { fmtTime, initials, nowTimeIst, todayIst, fmtDay } from '../format';
import { Brand } from './Login';
import { Modals } from './Forms';
import { Palette } from './Palette';
import { UpdateBanner } from './UpdateBanner';

type NavItem = { label: string; icon: IconName; to?: string; module: ModuleName; children?: { label: string; icon: IconName; to: string }[] };

export const NAV: NavItem[] = [
  { label: 'Dashboard', icon: 'home', to: '/', module: 'Dashboard' },
  {
    label: 'Appointments',
    icon: 'calendar',
    module: 'Appointments',
    children: [
      { label: 'Doctor Consultation', icon: 'doctor', to: '/appointments/consultation' },
      { label: 'Physiotherapy Booking', icon: 'physio', to: '/appointments/physiotherapy' },
      { label: 'Session Management', icon: 'session', to: '/appointments/sessions' },
    ],
  },
  { label: 'Doctors', icon: 'stethoscope', to: '/doctors', module: 'Doctors' },
  {
    label: 'Physiotherapy',
    icon: 'physio',
    module: 'Physiotherapy',
    children: [
      { label: 'Therapy Master', icon: 'clipboard', to: '/physio/therapies' },
      { label: 'Packages', icon: 'box', to: '/physio/packages' },
    ],
  },
  { label: 'Patients', icon: 'users', to: '/patients', module: 'Patients' },
  {
    label: 'Test & Lab',
    icon: 'flask',
    module: 'Test & Lab',
    children: [
      { label: 'Lab Bookings', icon: 'tube', to: '/lab' },
      { label: 'Lab Reports', icon: 'download', to: '/lab/reports' },
      { label: 'Test Catalog', icon: 'clipboard', to: '/lab/catalog' },
    ],
  },
  {
    label: 'Diagnostics',
    icon: 'scan',
    module: 'Diagnostics',
    children: [
      { label: 'Diagnostic Bookings', icon: 'calendarCheck', to: '/diagnostics' },
      { label: 'Diagnostic Test Master', icon: 'clipboard', to: '/diagnostics/master' },
    ],
  },
  {
    label: 'Billing & Invoice',
    icon: 'invoice',
    module: 'Billing & Invoice',
    children: [
      { label: 'Invoices', icon: 'invoice', to: '/billing' },
      { label: 'Payment Voucher', icon: 'rupee', to: '/billing/vouchers' },
      { label: 'Voucher List', icon: 'clipboard', to: '/billing/vouchers/list' },
      { label: 'Expense Report', icon: 'chart', to: '/billing/vouchers/reports' },
    ],
  },
  { label: 'Pharmacy', icon: 'pill', to: '/pharmacy', module: 'Pharmacy' },
  { label: 'Inventory Management', icon: 'box', to: '/inventory', module: 'Inventory Management' },
  { label: 'Branch Management', icon: 'building', to: '/branches', module: 'Branch Management' },
  {
    label: 'Reports & Analytics',
    icon: 'chart',
    module: 'Reports & Analytics',
    children: [
      { label: 'Revenue & Billing', icon: 'rupee', to: '/reports' },
      { label: 'Clinical Activity', icon: 'stethoscope', to: '/reports/clinical' },
      { label: 'Stock & Pharmacy', icon: 'box', to: '/reports/stock' },
    ],
  },
  { label: 'Assets Management', icon: 'monitor', to: '/assets', module: 'Assets Management' },
  { label: 'User & Access', icon: 'shield', to: '/access', module: 'User & Access' },
  { label: 'Settings', icon: 'settings', to: '/settings', module: 'Settings' },
];

const MODULE_PATHS: [string, ModuleName][] = [
  ['/appointments', 'Appointments'],
  ['/doctors', 'Doctors'],
  ['/physio', 'Physiotherapy'],
  ['/patients', 'Patients'],
  ['/lab', 'Test & Lab'],
  ['/diagnostics', 'Diagnostics'],
  ['/billing', 'Billing & Invoice'],
  ['/pharmacy', 'Pharmacy'],
  ['/inventory', 'Inventory Management'],
  ['/branches', 'Branch Management'],
  ['/reports', 'Reports & Analytics'],
  ['/assets', 'Assets Management'],
  ['/access', 'User & Access'],
  ['/settings', 'Settings'],
];

export function moduleFor(path: string): ModuleName {
  const hit = MODULE_PATHS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return hit ? hit[1] : 'Dashboard';
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can, meta } = useCare();
  const location = useLocation();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({ Appointments: true }));

  useEffect(() => {
    const group = NAV.find((n) => n.children?.some((c) => location.pathname === c.to || location.pathname.startsWith(`${c.to}/`)));
    if (group) setExpanded((e) => (e[group.label] ? e : { ...e, [group.label]: true }));
  }, [location.pathname]);

  const email = meta?.settings.support_email || 'care.support@remedium.in';

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-brand">
        <Brand light />
        <button type="button" className="icon-btn sidebar-close" onClick={onClose} aria-label="Close menu">
          <Icon name="x" />
        </button>
      </div>
      <nav>
        {NAV.filter((item) => can(item.module) && item.module !== 'Settings').map((item) => {
          if (!item.children) {
            return (
              <NavLink key={item.label} to={item.to!} end={item.to === '/'} className="nav-link" onClick={onClose}>
                <Icon name={item.icon} /> {item.label}
              </NavLink>
            );
          }
          const isOpen = expanded[item.label];
          const active = item.children.some((c) => location.pathname === c.to || location.pathname.startsWith(`${c.to}/`));
          return (
            <div key={item.label} className="nav-group">
              <button
                type="button"
                className={`nav-link ${active && !isOpen ? 'active' : ''}`}
                aria-expanded={isOpen}
                onClick={() => setExpanded((e) => ({ ...e, [item.label]: !e[item.label] }))}
              >
                <Icon name={item.icon} /> {item.label}
                <Icon name="chevronDown" size={16} className={`chev ${isOpen ? 'up' : ''}`} />
              </button>
              {isOpen && (
                <div className="nav-sub">
                  {item.children.map((c) => (
                    <NavLink key={c.to} to={c.to} end className="nav-sublink" onClick={onClose}>
                      <Icon name={c.icon} size={16} /> {c.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <NavLink to="/my-hr" className="nav-link" onClick={onClose}>
          <Icon name="user" /> My HR Workspace
        </NavLink>
        {can('Settings') && (
          <NavLink to="/settings" className="nav-link" onClick={onClose}>
            <Icon name="settings" /> Settings
          </NavLink>
        )}
      </nav>
      <a className="help-card" href={`mailto:${email}`}>
        <span className="help-icon">
          <Icon name="headset" size={20} />
        </span>
        <span>
          <strong>Help &amp; Support</strong>
          <small>{email}</small>
        </span>
      </a>
    </aside>
  );
}

function Clock() {
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setNow((n) => n + 1), 30000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="clock">
      <Icon name="calendar" size={20} />
      <span>
        <strong>{fmtDay(todayIst())}</strong>
        <small>{fmtTime(nowTimeIst())}</small>
      </span>
    </div>
  );
}

function Bell() {
  const { branch } = useCare();
  const { data } = useApi<AlertNote[]>(withQuery('/alerts', { branch }));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const list = data || [];
  return (
    <div className="bell" ref={ref}>
      <button type="button" className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label={`Alerts (${list.length})`}>
        <Icon name="bell" size={20} />
        {list.length > 0 && <span className="badge">{list.length}</span>}
      </button>
      {open && (
        <div className="dropdown bell-menu">
          <h3>Alerts</h3>
          {list.length === 0 && <p className="muted">Nothing needs attention right now.</p>}
          {list.map((a) => (
            <button
              type="button"
              key={a.id}
              className={`alert-row tone-${a.tone}`}
              onClick={() => {
                setOpen(false);
                navigate(a.href);
              }}
            >
              <Icon name={a.tone === 'info' ? 'info' : 'alert'} size={16} />
              <span>{a.text}</span>
              <Icon name="chevronRight" size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { me, onSignOut } = useCare();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="user" ref={ref}>
      <button type="button" className="user-btn" onClick={() => setOpen((o) => !o)}>
        <span className="avatar">{initials(me.full_name)}</span>
        <span className="user-text">
          <strong>{me.full_name}</strong>
          <small>{me.role_label}</small>
        </span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="dropdown user-menu">
          <p className="muted small">{me.user}</p>
          <NavLink className="menu-row" to="/my-hr" onClick={() => setOpen(false)}>
            <Icon name="user" size={16} /> My HR Workspace
          </NavLink>
          <button type="button" className="menu-row" onClick={onSignOut}>
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { me, meta, branch, setBranch, setPaletteOpen } = useCare();
  const branches = useMemo(() => (meta?.branches || []).filter((b) => b.active), [meta]);
  const restricted = Boolean(me.branches);
  return (
    <header className="topbar">
      <button type="button" className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" />
      </button>
      <label className="branch-select" title={restricted ? 'Branches assigned to you in HRMS' : undefined}>
        <Icon name="building" size={16} />
        {branches.length > 1 ? (
          <select value={branch} onChange={(e) => setBranch(Number(e.target.value))} aria-label="Branch">
            {restricted ? null : <option value={0}>All branches</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : (
          <select value={branch} disabled aria-label="Branch">
            <option value={branch}>{branches[0]?.name || 'Remedium Care'}</option>
          </select>
        )}
        <Icon name="chevronDown" size={14} />
      </label>
      <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)}>
        <Icon name="search" size={16} />
        <span>Search patient, invoice, booking, test, medicine…</span>
        <kbd>Ctrl + K</kbd>
      </button>
      <div className="topbar-right">
        <Bell />
        <Clock />
        <UserMenu />
      </div>
    </header>
  );
}

export function Shell() {
  const { can, paletteOpen, setPaletteOpen, toasts, dismissToast } = useCare();
  const location = useLocation();
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  useEffect(() => {
    document.querySelector('.content')?.scrollTo(0, 0);
  }, [location.pathname]);

  const hrWorkspace = location.pathname === '/my-hr';
  const module = moduleFor(location.pathname);
  const allowed = hrWorkspace || can(module);
  const firstAllowed = NAV.find((n) => can(n.module));

  return (
    <div className="app">
      <Sidebar open={menu} onClose={() => setMenu(false)} />
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <div className="main">
        <Topbar onMenu={() => setMenu(true)} />
        <main className={`content ${hrWorkspace ? 'content-flush' : ''}`}>
          {allowed ? (
            <Outlet />
          ) : (
            <div className="card no-access">
              <Icon name="shield" size={32} />
              <h2>No access to {module}</h2>
              <p className="muted">Ask HR to update your Care Backend permissions in People HRMS.</p>
              {firstAllowed && (
                <Link className="btn btn-primary" to={firstAllowed.to || firstAllowed.children![0].to}>
                  Go to {firstAllowed.label}
                </Link>
              )}
            </div>
          )}
        </main>
      </div>
      <Modals />
      <UpdateBanner />
      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} onClick={() => dismissToast(t.id)}>
            <Icon name={t.tone === 'ok' ? 'check' : 'alert'} size={16} /> {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
