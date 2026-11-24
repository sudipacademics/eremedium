import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { api } from '../api';
import '../pages/dashboard/lab-tech-v2.css';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  results: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  bill: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  accession: (
    <>
      <path d="M9 3h6M10 3v6L5 18.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L14 9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  lifecycle: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 2.8 19.5h18.4z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  qc: (
    <>
      <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  qms: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  barcode: <path d="M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12" />,
  bookings: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  reagents: (
    <>
      <path d="M8 3h8M9 3v5l-4 9a2.5 2.5 0 0 0 2.3 3.5h9.4A2.5 2.5 0 0 0 19 17l-4-9V3" />
    </>
  ),
  inventory: (
    <>
      <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),
  pathologist: (
    <>
      <path d="M9 3h6M10 3v6L6 18.5A2 2 0 0 0 7.8 21h8.4a2 2 0 0 0 1.8-2.5L14 9V3" />
      <circle cx="12" cy="16" r="1.6" />
    </>
  ),
  signed: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M8.5 15.5l2 2 4.5-4.5" />
    </>
  ),
  hr: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21c.6-4 3.4-6 7-6s6.4 2 7 6" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5M15 15c2.8 0 4.8 1.6 5.5 4.5" />
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
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
};

function SideLink({ to, icon, children, end }: { to: string; icon: string; children: ReactNode; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className="lt-side-link">
      <span className="lt-side-icon">
        <Icon>{ICONS[icon]}</Icon>
      </span>
      <span>{children}</span>
    </NavLink>
  );
}

export function LabTechSidebarNav({
  hrStaff,
  requesterOnly,
  pfOnly,
}: {
  hrStaff: boolean;
  requesterOnly?: boolean;
  pfOnly?: boolean;
}) {
  void hrStaff;
  if (pfOnly) {
    return (
      <>
        <span className="sidebar-section">PhleboFirst</span>
        <SideLink to="/dashboard/pf-inbox" icon="accession" end>
          PhleboFirst inbox
        </SideLink>
      </>
    );
  }
  if (requesterOnly) {
    return (
      <>
        <span className="sidebar-section">Inventory</span>
        <SideLink to="/dashboard/inventory" icon="inventory">
          Material Requests
        </SideLink>
        <span className="sidebar-section">Account</span>
        <SideLink to="/dashboard/profile" icon="profile">
          My Profile
        </SideLink>
      </>
    );
  }
  return (
    <>
      <span className="sidebar-section">Lab bench</span>
      <SideLink to="/dashboard/lab-reports" icon="results" end>
        Result entry
      </SideLink>
      <SideLink to="/dashboard/lab-bill-entry" icon="bill">
        Mother lab bill
      </SideLink>
      <SideLink to="/dashboard/accession" icon="accession">
        Accession
      </SideLink>
      <SideLink to="/dashboard/pf-inbox" icon="bookings">
        PhleboFirst inbox
      </SideLink>
      <SideLink to="/dashboard/report-lifecycle" icon="lifecycle">
        Report lifecycle
      </SideLink>
      <SideLink to="/dashboard/critical-alerts" icon="alert">
        Critical alerts
      </SideLink>
      <SideLink to="/dashboard/qc" icon="qc">
        IQC / NABL QC
      </SideLink>
      <SideLink to="/dashboard/qms" icon="qms">
        QMS
      </SideLink>
      <SideLink to="/dashboard/lab-tech" icon="barcode">
        Barcode bench
      </SideLink>
      <SideLink to="/dashboard/all-bookings" icon="bookings">
        All bookings
      </SideLink>
      <SideLink to="/dashboard/reagents" icon="reagents">
        Reagents
      </SideLink>
      <SideLink to="/dashboard/inventory" icon="inventory">
        Inventory Management
      </SideLink>
      <SideLink to="/dashboard/pathologist" icon="pathologist" end>
        Pathologist
      </SideLink>
      <SideLink to="/dashboard/test-master" icon="accession">
        Test Master
      </SideLink>
      <span className="sidebar-section">Account</span>
      <SideLink to="/dashboard/settings" icon="settings">
        Settings
      </SideLink>
      <SideLink to="/dashboard/profile" icon="profile">
        My Profile
      </SideLink>
    </>
  );
}

const PAGE_LABELS: Array<[string, string]> = [
  ['/dashboard/lab-bill-entry', 'Mother lab work order slip'],
  ['/dashboard/accession', 'Sample accession'],
  ['/dashboard/report-lifecycle', 'Report lifecycle'],
  ['/dashboard/critical-alerts', 'Critical alerts'],
  ['/dashboard/qc', 'Lab QC & equipment'],
  ['/dashboard/qms', 'Quality management'],
  ['/dashboard/lab-tech', 'Barcode bench'],
  ['/dashboard/reagents', 'Reagents'],
  ['/dashboard/inventory', 'Inventory Management'],
  ['/dashboard/pathologist/signed', 'All Signed'],
  ['/dashboard/test-master', 'Test Master'],
  ['/dashboard/pathologist', 'Pathologist'],
  ['/dashboard/lab-reports', 'Result entry'],
  ['/dashboard/all-bookings', 'All bookings'],
  ['/dashboard/settings', 'Settings'],
  ['/dashboard/profile/hrms', 'My Profile · People HRMS'],
  ['/dashboard/profile/training', 'My Profile · Training & Appraisal'],
  ['/dashboard/profile/hr', 'My Profile · HR Self-Service'],
  ['/dashboard/profile', 'My Profile'],
  ['/account', 'My Profile'],
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'LT';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function formatNow(d: Date) {
  const date = d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
  return { date, time };
}

export function LabTechTopbar({
  name,
  image,
  roleLabel,
  onLogout,
  hideAlerts,
}: {
  name: string;
  image?: string;
  roleLabel: string;
  onLogout: () => void;
  hideAlerts?: boolean;
}) {
  const [now, setNow] = useState(() => new Date());
  const [alerts, setAlerts] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (hideAlerts) return;
    let cancelled = false;
    api
      .getCriticalAlertsQueue({ status: 'Open', limit: 50 })
      .then((res) => {
        if (!cancelled) setAlerts(res.data?.count ?? res.data?.alerts?.length ?? 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hideAlerts]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const { date, time } = formatNow(now);
  const { pathname } = useLocation();
  const pathologistMode = pathname.startsWith('/dashboard/pathologist');
  const signedMode = pathname.startsWith('/dashboard/pathologist/signed');
  const pageLabel = PAGE_LABELS.find(([prefix]) => pathname.startsWith(prefix))?.[1];
  const crumbNow = signedMode ? 'All Signed' : pathologistMode ? 'Pending Reports' : pageLabel;

  return (
    <header className="staff-topbar lt-topbar">
      <div className="lt-topbar-copy">
        <h1 className="staff-topbar-title">
          {pathologistMode
            ? 'Pathologist'
            : pathname.startsWith('/dashboard/inventory')
              ? 'Inventory Management'
              : 'Lab Technician Dashboard'}
        </h1>
        {pathologistMode ? (
          <>
            <p>Review reports, add observations and sign digitally</p>
            <nav className="lt-crumbs" aria-label="Breadcrumb">
              <Link to="/dashboard/lab-reports" aria-label="Lab dashboard home">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z" />
                </svg>
              </Link>
              <span aria-hidden>›</span>
              <Link to="/dashboard/pathologist">Pathologist</Link>
              <span aria-hidden>›</span>
              <span aria-current="page">{crumbNow}</span>
            </nav>
          </>
        ) : pageLabel ? (
          <nav className="lt-crumbs" aria-label="Breadcrumb">
            <Link to="/dashboard/lab-reports" aria-label="Lab dashboard home">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z" />
              </svg>
            </Link>
            <span aria-hidden>›</span>
            <span aria-current="page">{pageLabel}</span>
          </nav>
        ) : (
          <p>Manage lab samples, enter test results and track progress</p>
        )}
      </div>
      <div className="lt-topbar-tools">
        <div className="lt-topbar-clock">
          <span>{date}</span>
          <span>{time}</span>
        </div>
        {hideAlerts ? null : (
          <Link to="/dashboard/critical-alerts" className="lt-bell" aria-label={alerts ? `${alerts} open critical alerts` : 'Critical alerts'}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
              <path d="M10 20a2 2 0 0 0 4 0" />
            </svg>
            {alerts ? <span className="lt-bell-count">{alerts > 9 ? '9+' : alerts}</span> : null}
          </Link>
        )}
        <div className="lt-user" ref={menuRef}>
          <button type="button" className="lt-user-btn" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            <span className="lt-avatar">
              {image ? <img className="lt-avatar-img" src={image} alt="" /> : initials(name || roleLabel)}
            </span>
            <span className="lt-user-name">{name || roleLabel}</span>
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
