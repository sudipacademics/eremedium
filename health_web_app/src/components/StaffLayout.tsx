import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  dashboardLabel,
  isFranchisee,
  isHrStaff,
  isLabTechnician,
  isPatientPortal,
  isPhlebotomist,
  isStaff,
} from '../auth/roles';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MobileBottomNav, MobileMenuButton, MobileNav, type MobileNavItem } from './MobileNav';
import { getPatientBottomNavItems } from './patientBottomNav';

export function StaffLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const roles = user?.roles ?? [];
  const patientPortal = isPatientPortal(roles);
  const phlebo = isPhlebotomist(roles);
  const labTech = isLabTechnician(roles) && !phlebo;
  const showPatientBottomNav = isMobile && patientPortal && !phlebo && !labTech;

  const mobileNavItems = useMemo((): MobileNavItem[] => {
    const items: MobileNavItem[] = [];
    if (phlebo) {
      items.push(
        { type: 'link', to: '/dashboard/phlebotomist', label: 'Collections', end: true },
        { type: 'link', to: '/dashboard/phlebotomist/reports', label: 'Reports' },
      );
      if (isHrStaff(roles)) {
        items.push({ type: 'link', to: '/dashboard/hr', label: 'HR' });
        items.push({ type: 'link', to: '/dashboard/performance', label: 'Training' });
      }
    } else if (labTech) {
      items.push(
        { type: 'link', to: '/dashboard/lab-tech', label: 'Bench', end: true },
        { type: 'link', to: '/bookings', label: 'Bookings' },
        { type: 'link', to: '/dashboard/reagents', label: 'Reagents' },
      );
      if (isHrStaff(roles)) {
        items.push({ type: 'link', to: '/dashboard/hr', label: 'HR' });
        items.push({ type: 'link', to: '/dashboard/performance', label: 'Training' });
      }
      items.push({ type: 'link', to: '/account', label: 'Profile' });
    } else {
      if (patientPortal) {
        items.push({ type: 'link', to: '/dashboard/patient', label: 'My health' });
      }
      if (isFranchisee(roles)) {
        items.push({ type: 'link', to: '/dashboard/franchisee', label: 'Franchisee hub' });
      }
      if (isStaff(roles)) {
        items.push({ type: 'link', to: '/dashboard/staff', label: 'Operations' });
      }
      if (isHrStaff(roles)) {
        items.push({ type: 'link', to: '/dashboard/hr', label: 'HR' });
        items.push({ type: 'link', to: '/dashboard/performance', label: 'Training' });
      }
      if (patientPortal) {
        items.push(
          { type: 'link', to: '/journey', label: 'Care journey' },
          { type: 'link', to: '/bookings', label: 'My orders' },
          { type: 'link', to: '/pharmacy', label: 'Pharmacy' },
          { type: 'link', to: '/services', label: 'All services' },
          { type: 'link', to: '/appointments/book', label: 'Book doctor' },
          { type: 'link', to: '/diagnostics', label: 'Diagnostics' },
        );
      }
      if (isStaff(roles)) {
        items.push(
          { type: 'link', to: '/bookings', label: 'All bookings' },
          { type: 'link', to: '/journey', label: 'Care journeys' },
        );
      }
      items.push({ type: 'link', to: '/account', label: 'Profile' });
    }
    items.push({ type: 'link', to: '/', label: 'Consumer home' });
    items.push({ type: 'button', label: 'Logout', onClick: logout });
    return items;
  }, [labTech, logout, patientPortal, phlebo, roles]);

  const bottomNavItems = useMemo(
    () => getPatientBottomNavItems(Boolean(user)),
    [user],
  );

  const sidebar = (
    <aside className="sidebar">
      <Link
        to={phlebo ? '/dashboard/phlebotomist' : labTech ? '/dashboard/lab-tech' : '/'}
        className="brand sidebar-brand"
      >
        Health Ecosystem
      </Link>
      <p className="sidebar-user">{user?.fullName || user?.user}</p>
      <nav className="sidebar-nav">
        {phlebo ? (
          <>
            <span className="sidebar-section">Work</span>
            <NavLink to="/dashboard/phlebotomist" end>
              Collections
            </NavLink>
            <NavLink to="/dashboard/phlebotomist/reports">Reports</NavLink>
            {isHrStaff(roles) && <NavLink to="/dashboard/hr">HR self-service</NavLink>}
            {isHrStaff(roles) && <NavLink to="/dashboard/performance">Training & appraisal</NavLink>}
          </>
        ) : labTech ? (
          <>
            <span className="sidebar-section">Lab bench</span>
            <NavLink to="/dashboard/lab-tech" end>
              Bench
            </NavLink>
            <NavLink to="/bookings">All bookings</NavLink>
            <NavLink to="/dashboard/reagents">Reagents</NavLink>
            {isHrStaff(roles) && <NavLink to="/dashboard/hr">HR self-service</NavLink>}
            {isHrStaff(roles) && <NavLink to="/dashboard/performance">Training & appraisal</NavLink>}
            <span className="sidebar-section">Account</span>
            <NavLink to="/account">Profile</NavLink>
          </>
        ) : (
          <>
            <span className="sidebar-section">Dashboard</span>
            {patientPortal && <NavLink to="/dashboard/patient">My health</NavLink>}
            {isFranchisee(roles) && <NavLink to="/dashboard/franchisee">Franchisee hub</NavLink>}
            {isStaff(roles) && <NavLink to="/dashboard/staff">Operations</NavLink>}
            {isHrStaff(roles) && <NavLink to="/dashboard/hr">HR self-service</NavLink>}
            {isHrStaff(roles) && <NavLink to="/dashboard/performance">Training & appraisal</NavLink>}

            {patientPortal && (
              <>
                <span className="sidebar-section">My relationship</span>
                <NavLink to="/journey">Care journey</NavLink>
                <NavLink to="/bookings">My orders</NavLink>
                <NavLink to="/pharmacy">Pharmacy</NavLink>

                <span className="sidebar-section">Services</span>
                <NavLink to="/services">All services</NavLink>
                <NavLink to="/appointments/book">Book doctor</NavLink>
                <NavLink to="/diagnostics">Diagnostics</NavLink>
              </>
            )}

            {isStaff(roles) && (
              <>
                <span className="sidebar-section">Operations</span>
                <NavLink to="/bookings">All bookings</NavLink>
                <NavLink to="/journey">Care journeys</NavLink>
              </>
            )}

            <span className="sidebar-section">Account</span>
            <NavLink to="/account">Profile</NavLink>
          </>
        )}
      </nav>
      <div className="sidebar-footer">
        <span className="muted sidebar-role">{dashboardLabel(roles)}</span>
        <button className="btn secondary btn-sm" type="button" onClick={logout}>
          Logout
        </button>
      </div>
    </aside>
  );

  return (
    <div className={`layout layout-staff${showPatientBottomNav ? ' has-bottom-nav' : ''}`}>
      {!isMobile && sidebar}
      {isMobile ? (
        <header className="staff-mobile-header">
          <MobileMenuButton open={menuOpen} onToggle={() => setMenuOpen((v) => !v)} />
          <div className="staff-mobile-head-text">
            <span className="staff-mobile-brand">Health Ecosystem</span>
            <span className="staff-mobile-user">{user?.fullName || user?.user}</span>
          </div>
          <Link to="/" className="btn secondary btn-sm staff-mobile-home">
            Home
          </Link>
        </header>
      ) : null}
      <MobileNav
        open={menuOpen && isMobile}
        onClose={() => setMenuOpen(false)}
        items={mobileNavItems}
      />
      <div className="staff-main">
        {!isMobile ? (
          <header className="staff-topbar">
            <h1 className="staff-topbar-title">{dashboardLabel(roles)} dashboard</h1>
            {!phlebo && !labTech && (
              <Link to="/" className="muted">
                Home
              </Link>
            )}
          </header>
        ) : null}
        <main className="page staff-page">
          <Outlet />
        </main>
      </div>
      {showPatientBottomNav ? <MobileBottomNav items={bottomNavItems} /> : null}
    </div>
  );
}
