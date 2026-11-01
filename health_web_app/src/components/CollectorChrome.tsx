import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { usePhleboLocationToggles } from '../hooks/usePhleboGps';
import '../pages/dashboard/collector-v2.css';

function LocationSwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className={`cp-switch${checked ? ' is-on' : ''}${disabled ? ' is-busy' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="cp-switch-track" aria-hidden>
        <span className="cp-switch-thumb" />
      </span>
      <span className="cp-switch-copy">
        <strong>{label}</strong>
        <small>{disabled ? 'Checking location…' : checked ? 'On' : 'Off'}</small>
      </span>
    </label>
  );
}

export function CollectorLocationToggles() {
  const { liveShare, navShare, message, busy, setLiveShare, setNavShare } = usePhleboLocationToggles();
  return (
    <div className="cp-loc">
      <div className="cp-loc-toggles">
        <LocationSwitch
          label="Live Location Sharing"
          checked={liveShare}
          disabled={busy === 'live'}
          onChange={(on) => void setLiveShare(on)}
        />
        <LocationSwitch
          label="Report Delivery / Navigation"
          checked={navShare}
          disabled={busy === 'nav'}
          onChange={(on) => void setNavShare(on)}
        />
      </div>
      {message ? <p className="cp-loc-msg">{message}</p> : null}
    </div>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  collections: (
    <>
      <path d="M9 3h6M10 3v6L5 18.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L14 9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  map: (
    <>
      <path d="M9 4.5 3.5 7v13L9 17.5 15 20.5 20.5 18V5L15 7.5z" />
      <path d="M9 4.5v13M15 7.5v13" />
    </>
  ),
  reports: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  training: (
    <>
      <path d="M3 8l9-4 9 4-9 4z" />
      <path d="M7 10v5c0 1.5 2.2 3 5 3s5-1.5 5-3v-5" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5" />
    </>
  ),
};

function SideLink({
  to,
  icon,
  children,
  end,
  active,
}: {
  to: string;
  icon: string;
  children: ReactNode;
  end?: boolean;
  active?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `lt-side-link${(active ?? isActive) ? ' active' : ''}`}
    >
      <span className="lt-side-icon">
        <Icon>{ICONS[icon]}</Icon>
      </span>
      <span>{children}</span>
    </NavLink>
  );
}

export function CollectorSidebarNav({
  name,
  roleLabel,
  hubLabel,
  onLogout,
}: {
  name: string;
  roleLabel: string;
  hubLabel?: string;
  onLogout: () => void;
}) {
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const view = search.get('view') || '';
  const onDash = pathname === '/dashboard/phlebotomist' || pathname === '/dashboard/phlebotomist/';
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'CP';

  return (
    <>
      <SideLink to="/dashboard/phlebotomist" icon="dashboard" end active={onDash && !view}>
        Dashboard
      </SideLink>
      <SideLink to="/dashboard/phlebotomist?view=collections" icon="collections" active={onDash && view === 'collections'}>
        My Collections
      </SideLink>
      <SideLink to="/dashboard/phlebotomist?view=map" icon="map" active={onDash && view === 'map'}>
        Route Map
      </SideLink>
      <SideLink to="/dashboard/phlebotomist/jobs" icon="collections">
        PhleboFirst Jobs
      </SideLink>
      <SideLink to="/dashboard/phlebotomist/reports" icon="reports">
        Reports
      </SideLink>
      <SideLink to="/dashboard/profile/training" icon="training">
        Training & SOP
      </SideLink>
      <SideLink to="/dashboard/profile" icon="profile" end>
        My Profile
      </SideLink>
      <div className="cp-side-user">
        <span className="cp-side-avatar" aria-hidden>
          {initials}
        </span>
        <span>
          <strong>{name}</strong>
          <small>
            {roleLabel}
            {hubLabel ? ` · ${hubLabel}` : ''}
          </small>
        </span>
        <button className="cp-side-logout" type="button" onClick={onLogout}>
          Logout
        </button>
      </div>
    </>
  );
}

function formatNow(d: Date) {
  const date = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(' ', '');
  return { date, time };
}

export function CollectorTopbar({
  name,
  roleLabel,
  hubLabel,
  pendingCount = 0,
  onLogout,
}: {
  name: string;
  roleLabel: string;
  hubLabel?: string;
  pendingCount?: number;
  onLogout: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [livePending, setLivePending] = useState(pendingCount);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPhlebotomistQueue(50)
      .then((res) => {
        if (cancelled) return;
        const count = (res.data.orders || []).filter((row) => row.order_status === 'Booked').length;
        setLivePending(count);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const { date, time } = formatNow(now);
  const firstName = name.trim().split(/\s+/)[0] || name;

  return (
    <header className="staff-topbar lt-topbar cp-topbar">
      <div className="lt-topbar-copy">
        <h1 className="staff-topbar-title">Welcome, {firstName}</h1>
        <p>
          {roleLabel}
          {hubLabel ? ` · ${hubLabel}` : ''}
        </p>
      </div>
      <div className="lt-topbar-tools cp-topbar-tools">
        <CollectorLocationToggles />
        <Link to="/dashboard/phlebotomist?view=collections" className="lt-bell" aria-label={livePending ? `${livePending} pending collections` : 'Collections'}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
            <path d="M10 20a2 2 0 0 0 4 0" />
          </svg>
          {livePending ? <span className="lt-bell-count">{livePending > 9 ? '9+' : livePending}</span> : null}
        </Link>
        <div className="lt-topbar-clock">
          <span>{date}</span>
          <span>{time}</span>
        </div>
        <div className="lt-user" ref={menuRef}>
          <button type="button" className="lt-user-btn" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            <span className="lt-avatar">{firstName.slice(0, 1).toUpperCase()}</span>
            <span className="lt-user-name">{roleLabel}</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {menuOpen ? (
            <div className="lt-user-menu" role="menu">
              <p className="lt-user-menu-name">{name}</p>
              <Link to="/dashboard/profile" role="menuitem" onClick={() => setMenuOpen(false)}>
                My Profile
              </Link>
              <button type="button" role="menuitem" onClick={onLogout}>
                Logout
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
