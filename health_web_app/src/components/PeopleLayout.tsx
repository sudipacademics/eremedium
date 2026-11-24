import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { PeoplePageBoundary } from './PeoplePageBoundary';
import { useAuth } from '../auth/AuthContext';
import { isPeopleHrmsStaff, isPeopleManager, isHrRecruiter, isFranchisee } from '../auth/roles';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MobileBottomNav } from './MobileNav';
import { PeopleCommandPalette } from './PeopleCommandPalette';
import { getPeopleBottomNavItems } from './roleBottomNav';
import { HrmsIcon } from './HrmsIcons';
import '../pages/people/people-portal.css';
import '../pages/people/people-hrms-shell.css';

type NavItem = { to: string; label: string; icon: string; end?: boolean };
type NavGroup = { label: string; items: NavItem[]; hideLabel?: boolean };

const MAIN_GROUP: NavGroup = {
  label: 'Main',
  hideLabel: true,
  items: [{ to: '/people', label: 'Dashboard', icon: 'dashboard', end: true }],
};

const MANAGER_GROUPS: NavGroup[] = [
  {
    label: 'Workforce',
    hideLabel: true,
    items: [
      { to: '/people', label: 'Dashboard', icon: 'dashboard', end: true },
      { to: '/people/employees', label: 'Employees', icon: 'users' },
      { to: '/people/organization', label: 'WDD', icon: 'orgChart' },
      { to: '/people/grades', label: 'Grades', icon: 'grades' },
      { to: '/people/attendance', label: 'Attendance', icon: 'clock' },
      { to: '/people/leave', label: 'Leave Management', icon: 'calendar' },
      { to: '/people/payslips', label: 'Payroll', icon: 'wallet' },
      { to: '/people/performance', label: 'Performance', icon: 'performance' },
      { to: '/people/recruitment', label: 'Recruitment', icon: 'briefcase' },
      { to: '/people/onboarding', label: 'Onboarding', icon: 'userPlus' },
      { to: '/people/training', label: 'Training & Development', icon: 'training' },
      { to: '/people/career', label: 'Career & Growth', icon: 'career' },
    ],
  },
  {
    label: 'Workplace',
    hideLabel: true,
    items: [
      { to: '/people/documents', label: 'Documents', icon: 'file' },
      { to: '/people/policies', label: 'Policies', icon: 'book' },
      { to: '/people/assets', label: 'Assets', icon: 'box' },
      { to: '/people/announcements', label: 'Announcements', icon: 'megaphone' },
      { to: '/people/calendar', label: 'Calendar', icon: 'calendar' },
      { to: '/people/reports', label: 'Reports', icon: 'reports' },
      { to: '/people/analytics', label: 'Analytics', icon: 'analytics' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { to: '/people/settings/company', label: 'Company Settings', icon: 'settings' },
      { to: '/people/settings/geofencing', label: 'Geofencing', icon: 'pin' },
      { to: '/people/settings/roles', label: 'Role & Permissions', icon: 'shield' },
      { to: '/people/settings/integrations', label: 'Integrations', icon: 'plug' },
    ],
  },
];

/* Employee self-service directory — full attendance / leave pages. Portal embeds use Profile tabs instead (people-access). */
const MY_WORKSPACE: NavGroup = {
  label: 'My workspace',
  items: [
    { to: '/people/profile', label: 'My HR Workspace', icon: 'user' },
    { to: '/people/attendance', label: 'My attendance', icon: 'clock' },
    { to: '/people/leave', label: 'My leave', icon: 'calendar' },
    { to: '/people/expenses', label: 'Expenses', icon: 'receipt' },
    { to: '/people/payslips', label: 'Payslips', icon: 'wallet' },
  ],
};

const MANAGER_WORKSPACE: NavGroup = {
  label: 'My workspace',
  items: [
    { to: '/people/profile', label: 'My HR Workspace', icon: 'user' },
    { to: '/people/attendance', label: 'My attendance', icon: 'clock' },
    { to: '/people/leave', label: 'My leave', icon: 'calendar' },
  ],
};

const FRANCHISE_GROUPS: NavGroup[] = [
  MAIN_GROUP,
  {
    label: 'Centre team',
    items: [{ to: '/people/franchise-team', label: 'Leave & attendance', icon: 'users' }],
  },
  MY_WORKSPACE,
];

const EMPLOYEE_GROUPS: NavGroup[] = [MAIN_GROUP, MY_WORKSPACE];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function initials(name?: string) {
  const parts = String(name || 'U')
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || 'U';
}

export function PeopleLayout({ preview = false }: { preview?: boolean }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const now = useClock();
  const isMobile = useMediaQuery('(max-width: 860px)');
  const handle = user?.user?.split('@')[0];
  const showManagerNav =
    preview || isPeopleManager(user?.roles) || isHrRecruiter(user?.roles);
  const franchiseOnly = !preview && isFranchisee(user?.roles) && !showManagerNav;

  const groups = useMemo(() => {
    if (showManagerNav) return [...MANAGER_GROUPS, MANAGER_WORKSPACE];
    if (franchiseOnly) return FRANCHISE_GROUPS;
    return EMPLOYEE_GROUPS;
  }, [showManagerNav, franchiseOnly]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        setPaletteOpen(true);
      }
      if (ev.key === 'Escape') setUserMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onPointer = (ev: MouseEvent) => {
      if (!userMenuRef.current?.contains(ev.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [userMenuOpen]);

  useEffect(() => {
    document.title = 'People Management - SLPL';
  }, []);

  if (!preview && user && !isPeopleHrmsStaff(user.roles)) {
    return (
      <div className="page people-shell">
        <div className="people-gate-card">
          <h1>People Management - SLPL</h1>
          <p>
            This portal needs a staff role (Employee, System Manager, Health System Admin, or HR).
            Your account currently has no matching roles — ask an administrator to grant access, then
            sign out and sign in again.
          </p>
          <p className="muted">Field sales operations remain on REACH.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link className="btn" to="/login">
              Login
            </Link>
            <Link className="btn secondary" to="/account">
              Account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const displayName = preview
    ? 'HR Manager'
    : user?.full_name || user?.fullName || handle || 'User';
  const roleLabel = showManagerNav ? 'HR Manager' : franchiseOnly ? 'Franchise partner' : 'Employee';

  return (
    <div className={`hrms-app${isMobile ? ' has-bottom-nav' : ''}`}>
      {menuOpen && isMobile ? (
        <button
          type="button"
          aria-label="Close menu"
          className="hrms-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,61,77,0.35)',
            zIndex: 35,
            border: 0,
          }}
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside className={`hrms-sidebar${menuOpen && isMobile ? ' open' : ''}`} aria-label="HRMS">
        <Link to="/people" className="hrms-brand pls-hrms-brand" onClick={() => setMenuOpen(false)}>
          <div className="pls-hrms-logo-plate">
            <img className="pls-hrms-logo" src="/brand/smilecure-lifestyle.png?v=12" alt="Smilecure Lifestyle Private Limited" />
          </div>
          <span className="pls-hrms-label">People Management - SLPL</span>
        </Link>

        <nav>
          {groups.map((group) => (
            <div key={group.label} className="hrms-nav-group">
              {group.hideLabel ? null : <div className="hrms-nav-label">{group.label}</div>}
              {group.items.map((item) => (
                <NavLink
                  key={`${group.label}-${item.to}-${item.label}`}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMenuOpen(false)}
                >
                  <HrmsIcon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="hrms-sidebar-foot">
          <button type="button" onClick={logout}>
            <HrmsIcon name="logout" size={16} />
            Logout
          </button>
        </div>
      </aside>

      <div className="hrms-main-wrap">
        <header className="hrms-topbar">
          <div className="hrms-mobile-bar">
            <button
              type="button"
              className="hrms-icon-btn"
              aria-label="Open menu"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <HrmsIcon name="menu" />
            </button>
          </div>
          <button
            type="button"
            className="hrms-search"
            role="search"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open search (Ctrl+K)"
          >
            <HrmsIcon name="search" size={16} />
            <span>Search for employees, jobs, leaves, reports…</span>
            <kbd>Ctrl + K</kbd>
          </button>
          <div className="hrms-top-actions">
            <div className="hrms-icon-btn plain" title="Notifications" aria-label="Notifications">
              <HrmsIcon name="bell" size={20} />
              <span className="badge">3</span>
            </div>
            <div className="hrms-clock">
              <HrmsIcon name="calendar" size={20} />
              <div>
                <b>
                  {now.toLocaleDateString('en-GB', {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </b>
                <small>
                  {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </small>
              </div>
            </div>
            <div className="hrms-user" ref={userMenuRef}>
              <button
                type="button"
                className="hrms-user-chip"
                data-user-menu="react"
                title={displayName}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((open) => !open)}
              >
                <div className="avatar">{initials(displayName)}</div>
                <div className="meta">
                  <b>{roleLabel}</b>
                  <small>{displayName}</small>
                </div>
                <HrmsIcon name="chevronDown" size={16} className="caret" />
              </button>
              {userMenuOpen ? (
                <div className="hrms-user-menu" role="menu">
                  <p className="hrms-user-menu-name">{displayName}</p>
                  <Link to="/people/profile" role="menuitem" onClick={() => setUserMenuOpen(false)}>
                    My Profile
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      logout();
                    }}
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className={`hrms-content people-main${isMobile ? ' has-bottom-nav' : ''}`}>
          <PeoplePageBoundary key={location.pathname}>
            <Outlet />
          </PeoplePageBoundary>
        </main>
        {isMobile ? <MobileBottomNav items={getPeopleBottomNavItems()} /> : null}
      </div>
      <PeopleCommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
