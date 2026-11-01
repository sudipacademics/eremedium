import { useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  ROLES,
  dashboardLabel,
  hasAnyRole,
  isFranchisee,
  isHrStaff,
  isLabManager,
  isLabTechnician,
  isPathologist,
  isPatientPortal,
  isPfLabAuthoriser,
  isPhlebotomist,
  isProvider,
  isRequesterOnly,
  isStaff,
} from '../auth/roles';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MobileBottomNav, MobileMenuButton, MobileNav, type MobileNavItem } from './MobileNav';
import { getPatientBottomNavItems } from './patientBottomNav';
import { LabTechSidebarNav, LabTechTopbar } from './LabTechChrome';
import { CollectorLocationToggles, CollectorSidebarNav, CollectorTopbar } from './CollectorChrome';
import '../pages/dashboard/collector-v2.css';
import { getPhleboBottomNavItems } from './roleBottomNav';
import { usePhleboGps, usePhleboLocationToggles } from '../hooks/usePhleboGps';

export function StaffLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const roles = user?.roles ?? [];
  const { pathname } = useLocation();
  const patientPortal = isPatientPortal(roles);
  const phlebo = isPhlebotomist(roles);
  const pathologist = isPathologist(roles);
  const requesterOnly = isRequesterOnly(roles) && !phlebo;
  const labBench = isLabTechnician(roles) || isLabManager(roles) || pathologist || requesterOnly;
  const pfOnly = isPfLabAuthoriser(roles) && !labBench && !phlebo && !isStaff(roles);
  const labTech = (labBench || pfOnly) && !phlebo;
  const provider = isProvider(roles) && !phlebo && !labTech;
  const onPathologist = pathname.startsWith('/dashboard/pathologist');
  const labHome = pfOnly
    ? '/dashboard/pf-inbox'
    : requesterOnly
      ? '/dashboard/inventory'
      : pathologist && !isLabTechnician(roles)
        ? '/dashboard/pathologist'
        : '/dashboard/lab-reports';
  const topbarRole = onPathologist ? 'Pathologist' : dashboardLabel(roles);
  const showPatientBottomNav = isMobile && patientPortal && !phlebo && !labTech && !provider;
  const { liveShare } = usePhleboLocationToggles();
  usePhleboGps(liveShare, undefined, phlebo);

  // Consumer patients use PublicLayout account/home — not the staff sidebar dashboard.
  if (patientPortal && !phlebo && !labTech && !provider) {
    return <Navigate to="/account/profile" replace />;
  }

  const mobileNavItems = useMemo((): MobileNavItem[] => {
    const items: MobileNavItem[] = [];
    if (phlebo) {
      items.push(
        { type: 'link', to: '/dashboard/phlebotomist', label: 'Dashboard', end: true },
        { type: 'link', to: '/dashboard/phlebotomist?view=collections', label: 'My Collections' },
        { type: 'link', to: '/dashboard/phlebotomist?view=map', label: 'Route Map' },
        { type: 'link', to: '/dashboard/phlebotomist/jobs', label: 'PhleboFirst Jobs' },
        { type: 'link', to: '/dashboard/phlebotomist/reports', label: 'Reports' },
        { type: 'link', to: '/dashboard/profile/training', label: 'Training & SOP' },
        { type: 'link', to: '/dashboard/profile', label: 'My Profile' },
      );
    } else if (provider) {
      items.push(
        { type: 'link', to: '/dashboard/provider', label: 'My practice', end: true },
        { type: 'link', to: '/services', label: 'Public services' },
        { type: 'link', to: '/account', label: 'Profile' },
      );
    } else if (pfOnly) {
      items.push({ type: 'link', to: '/dashboard/pf-inbox', label: 'PhleboFirst inbox', end: true });
    } else if (requesterOnly) {
      items.push(
        { type: 'link', to: '/dashboard/inventory', label: 'Material Requests' },
        { type: 'link', to: '/dashboard/profile', label: 'My Profile' },
      );
    } else if (labTech) {
      items.push(
        { type: 'link', to: '/dashboard/lab-reports', label: 'Result entry', end: true },
        { type: 'link', to: '/dashboard/lab-bill-entry', label: 'Mother bill' },
        { type: 'link', to: '/dashboard/accession', label: 'Accession' },
        { type: 'link', to: '/dashboard/pf-inbox', label: 'PhleboFirst inbox' },
        { type: 'link', to: '/dashboard/report-lifecycle', label: 'Lifecycle' },
        { type: 'link', to: '/dashboard/lab-tech', label: 'Bench' },
        { type: 'link', to: '/dashboard/all-bookings', label: 'All bookings' },
        { type: 'link', to: '/dashboard/reagents', label: 'Reagents' },
        { type: 'link', to: '/dashboard/inventory', label: 'Inventory Management' },
        { type: 'link', to: '/dashboard/pathologist', label: 'Pathologist' },
        { type: 'link', to: '/dashboard/pathologist/signed', label: 'Reports (Signed)' },
      );
      items.push({ type: 'link', to: '/dashboard/profile', label: 'My Profile' });
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
      if (hasAnyRole(roles, [ROLES.ADMIN, ROLES.SYSTEM_MANAGER, 'Administrator'])) {
        items.push({ type: 'link', to: '/dashboard/partner-pricing', label: 'Partner pricing chart' });
        items.push({ type: 'link', to: '/dashboard/pf-ops', label: 'PhleboFirst ops' });
      }
      if (isHrStaff(roles)) {
        items.push({ type: 'link', to: '/dashboard/hr', label: 'HR' });
        items.push({ type: 'link', to: '/dashboard/performance', label: 'Training' });
      }
      if (patientPortal) {
        items.push(
          { type: 'link', to: '/journey', label: 'Care journey' },
          { type: 'link', to: '/reports', label: 'Reports' },
          { type: 'link', to: '/bookings', label: 'My orders' },
          { type: 'link', to: '/pharmacy', label: 'Pharmacy' },
          { type: 'link', to: '/services', label: 'All services' },
          { type: 'link', to: '/appointments/book', label: 'Book doctor' },
          { type: 'link', to: '/diagnostics', label: 'Diagnostics' },
        );
      }
      if (isStaff(roles)) {
        items.push(
          { type: 'link', to: '/dashboard/all-bookings', label: 'All bookings' },
          { type: 'link', to: '/journey', label: 'Care journeys' },
        );
      }
      items.push({ type: 'link', to: '/account', label: 'Profile' });
    }
    items.push({ type: 'link', to: '/', label: 'Consumer home' });
    items.push({ type: 'button', label: 'Logout', onClick: logout });
    return items;
  }, [labTech, logout, patientPortal, pfOnly, phlebo, provider, requesterOnly, roles]);

  const bottomNavItems = useMemo(
    () => getPatientBottomNavItems(Boolean(user)),
    [user],
  );

  const collectorName = user?.fullName || user?.user || 'Collector';
  const hubLabel = user?.franchisee
    ? `${user.franchisee.franchise_name || 'Hub'}${user.franchisee.branch_code ? ` (${user.franchisee.branch_code})` : ''}`
    : undefined;

  const sidebar = (
    <aside className={`sidebar${labTech || phlebo ? ' lt-sidebar-fixed' : ''}`}>
      <Link
        to={phlebo ? '/dashboard/phlebotomist' : labTech ? labHome : provider ? '/dashboard/provider' : '/'}
        className="brand sidebar-brand"
      >
        {phlebo ? (
          <>
            <span className="cp-brand-mark" aria-hidden>
              R
            </span>
            <span className="cp-brand-copy">
              Remedium Lab
              <small>Collector Portal</small>
            </span>
          </>
        ) : (
          'Health Ecosystem'
        )}
      </Link>
      <p className="sidebar-user">{user?.fullName || user?.user}</p>
      <nav className="sidebar-nav">
        {phlebo ? (
          <CollectorSidebarNav
            name={collectorName}
            roleLabel={dashboardLabel(roles)}
            hubLabel={hubLabel}
            onLogout={logout}
          />
        ) : provider ? (
          <>
            <span className="sidebar-section">Practice</span>
            <NavLink to="/dashboard/provider" end>
              Appointments & schedule
            </NavLink>
            <span className="sidebar-section">Portal</span>
            <NavLink to="/services">Public services</NavLink>
            <NavLink to="/account">Profile</NavLink>
          </>
        ) : labTech ? (
          <LabTechSidebarNav hrStaff={isHrStaff(roles)} requesterOnly={requesterOnly} pfOnly={pfOnly} />
        ) : (
          <>
            <span className="sidebar-section">Dashboard</span>
            {patientPortal && <NavLink to="/dashboard/patient">My health</NavLink>}
            {isFranchisee(roles) && <NavLink to="/dashboard/franchisee">Franchisee hub</NavLink>}
            {isStaff(roles) && <NavLink to="/dashboard/staff">Operations</NavLink>}
            {isHrStaff(roles) && <NavLink to="/dashboard/hr">HR self-service</NavLink>}
            {isHrStaff(roles) && <NavLink to="/people">People HRMS</NavLink>}
            {isHrStaff(roles) && <NavLink to="/dashboard/performance">Training & appraisal</NavLink>}

            {patientPortal && (
              <>
                <span className="sidebar-section">My relationship</span>
                <NavLink to="/journey">Care journey</NavLink>
                <NavLink to="/bookings">My orders</NavLink>
                <NavLink to="/prescriptions">Prescriptions</NavLink>
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
                <NavLink to="/dashboard/all-bookings">All bookings</NavLink>
                <NavLink to="/dashboard/lab-bill-entry">Mother lab bill</NavLink>
                <NavLink to="/dashboard/lab-reports">Lab result entry</NavLink>
                <NavLink to="/dashboard/accession">Accession</NavLink>
                <NavLink to="/dashboard/report-lifecycle">Report lifecycle</NavLink>
                <NavLink to="/dashboard/critical-alerts">Critical alerts</NavLink>
                <NavLink to="/dashboard/qc">IQC / NABL QC</NavLink>
                <NavLink to="/dashboard/qms">QMS</NavLink>
                <NavLink to="/journey">Care journeys</NavLink>
              </>
            )}

            {hasAnyRole(roles, [ROLES.ADMIN, ROLES.SYSTEM_MANAGER, 'Administrator']) && (
              <>
                <span className="sidebar-section">Partners</span>
                <NavLink to="/dashboard/partner-pricing">Partner pricing chart</NavLink>
                <NavLink to="/dashboard/pf-ops">PhleboFirst ops</NavLink>
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
    <div className={`layout layout-staff${labTech ? ' layout-labtech' : ''}${phlebo ? ' layout-collector' : ''}${showPatientBottomNav || (isMobile && phlebo) ? ' has-bottom-nav' : ''}`}>
      {!isMobile && sidebar}
      {isMobile ? (
        <header className="staff-mobile-header">
          <MobileMenuButton open={menuOpen} onToggle={() => setMenuOpen((v) => !v)} />
          <div className="staff-mobile-head-text">
            <span className="staff-mobile-brand">{phlebo ? 'Collector Portal' : 'Health Ecosystem'}</span>
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
        {!isMobile && phlebo ? (
          <CollectorTopbar
            name={collectorName}
            roleLabel={dashboardLabel(roles)}
            hubLabel={hubLabel}
            onLogout={logout}
          />
        ) : !isMobile && labTech ? (
          <LabTechTopbar
            name={user?.fullName || user?.user || (onPathologist ? 'Pathologist' : 'Lab Technician')}
            roleLabel={topbarRole}
            onLogout={logout}
            hideAlerts={requesterOnly || pfOnly}
          />
        ) : !isMobile ? (
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
          {isMobile && phlebo ? (
            <div className="cp-mobile-loc">
              <CollectorLocationToggles />
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
      {showPatientBottomNav ? <MobileBottomNav items={bottomNavItems} /> : null}
      {isMobile && phlebo ? <MobileBottomNav items={getPhleboBottomNavItems()} /> : null}
    </div>
  );
}
