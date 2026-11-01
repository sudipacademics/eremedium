import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isStaff } from '../auth/roles';
import { AeMark } from '../pages/aesthetics/AestheticsIcons';
import { AdminIcon, type AdminIconName } from '../pages/aesthetic-admin/AestheticAdminIcons';
import {
  AESTHETIC_ADMIN_BRANCHES,
  AESTHETIC_ADMIN_NAV,
} from '../pages/aesthetic-admin/aestheticAdminNav';
import '../pages/aesthetic-admin/aesthetic-admin.css';

function groupOpenByPath(pathname: string) {
  const open = new Set<string>(['dashboard']);
  for (const g of AESTHETIC_ADMIN_NAV) {
    if (g.to && (pathname === g.to || (g.to !== '/aesthetic-admin' && pathname.startsWith(g.to)))) {
      open.add(g.id);
    }
    if (g.items?.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))) {
      open.add(g.id);
    }
  }
  return open;
}

export function AestheticAdminLayout({ preview = false }: { preview?: boolean }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [branch, setBranch] = useState<string>(AESTHETIC_ADMIN_BRANCHES[0].id);
  const [search, setSearch] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => groupOpenByPath(location.pathname));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const designPreview =
    preview ||
    new URLSearchParams(location.search).get('preview') === '1' ||
    (import.meta.env.DEV && !user);

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      for (const id of groupOpenByPath(location.pathname)) next.add(id);
      return next;
    });
    setSidebarOpen(false);
  }, [location.pathname]);

  const roles = user?.roles || [];
  const staff =
    designPreview || isStaff(roles) || roles.includes('Administrator') || roles.includes('HR Manager');

  const displayName = user?.fullName || user?.user || 'Admin User';
  const roleLabel = useMemo(() => {
    if (designPreview && !user) return 'Super Admin';
    if (roles.includes('Administrator') || roles.includes('System Manager') || roles.includes('Health System Admin')) {
      return 'Super Admin';
    }
    if (roles.includes('HR Manager')) return 'HR Manager';
    return 'Clinic Admin';
  }, [roles, designPreview, user]);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    navigate(`/aesthetic-admin/bookings?q=${encodeURIComponent(q)}`);
  }

  function signOut() {
    logout();
    window.location.assign('/login');
  }

  const aestheticsHost =
    typeof window !== 'undefined' && window.location.hostname === 'aesthetics.e-remedium.in';
  if (aestheticsHost && !user && !designPreview) {
    return <Navigate to="/login" replace />;
  }

  if (!staff && user) {
    return (
      <div className="aea-denied">
        <h1>Aesthetic Admin</h1>
        <p>This console is for clinic staff and administrators.</p>
        <a href="https://remediumaesthetics.in">View public site</a>
        <button type="button" className="aea-side-link" onClick={signOut}>
          Logout
        </button>
      </div>
    );
  }

  return (
    <div className={`aea-shell${sidebarOpen ? ' nav-open' : ''}`}>
      <aside className="aea-sidebar" aria-label="Aesthetic admin">
        <Link to="/aesthetic-admin" className="aea-brand">
          <AeMark size={36} />
          <span>
            <strong>Remedium Aesthetic</strong>
            <small>Clinic Console</small>
          </span>
        </Link>

        <nav className="aea-nav">
          {AESTHETIC_ADMIN_NAV.map((group) => {
            const icon = group.icon as AdminIconName;
            const open = openGroups.has(group.id);
            if (group.to && !group.items?.length) {
              return (
                <NavLink
                  key={group.id}
                  to={group.to}
                  end={group.to === '/aesthetic-admin'}
                  className={({ isActive }) => `aea-nav-link${isActive ? ' is-active' : ''}`}
                >
                  <AdminIcon name={icon} size={18} />
                  <span>{group.label}</span>
                </NavLink>
              );
            }
            return (
              <div key={group.id} className={`aea-nav-group${open ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="aea-nav-group-btn"
                  aria-expanded={open}
                  onClick={() => toggleGroup(group.id)}
                >
                  <AdminIcon name={icon} size={18} />
                  <span>{group.label}</span>
                  <AdminIcon name="chevron" size={16} className="aea-caret" />
                </button>
                {open && group.items ? (
                  <div className="aea-nav-sub">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) => (isActive ? 'is-active' : undefined)}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="aea-sidebar-foot">
          <a href="https://remediumaesthetics.in" className="aea-side-link">
            Public website
          </a>
          <button type="button" className="aea-side-link" onClick={signOut}>
            <AdminIcon name="logout" size={15} /> Logout
          </button>
        </div>
      </aside>

      {sidebarOpen ? (
        <button type="button" className="aea-backdrop" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />
      ) : null}

      <div className="aea-main">
        <header className="aea-top">
          <button
            type="button"
            className="aea-icon-btn aea-menu-btn"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
          >
            <AdminIcon name="menu" size={18} />
          </button>

          <form className="aea-search" onSubmit={onSearch} role="search">
            <AdminIcon name="search" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by booking ID, customer, phone, service..."
              aria-label="Search bookings"
            />
          </form>

          <div className="aea-top-actions">
            <label className="aea-branch">
              <AdminIcon name="pin" size={14} />
              <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
                {AESTHETIC_ADMIN_BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
              <AdminIcon name="chevron" size={14} />
            </label>

            <button type="button" className="aea-icon-btn aea-bell" aria-label="Notifications">
              <AdminIcon name="bell" size={17} />
              <span className="aea-badge">3</span>
            </button>

            <div className="aea-user" title={displayName}>
              <span className="aea-avatar" aria-hidden>
                {displayName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase() || '')
                  .join('') || 'A'}
              </span>
              <span className="aea-user-meta">
                <b>{displayName.split(' ')[0]}</b>
                <small>{roleLabel}</small>
              </span>
            </div>
          </div>
        </header>

        <div className="aea-content">
          <Outlet context={{ branchId: branch }} />
        </div>
      </div>
    </div>
  );
}
