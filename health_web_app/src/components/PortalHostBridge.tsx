import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import {
  collectorHandoffUrl,
  labtechHandoffUrl,
  navigateWithHandoff,
  partnersHandoffUrl,
  patientHandoffUrl,
  phleboFirstHandoffUrl,
} from '../auth/portalHandoff';
import {
  getDefaultDashboardRoute,
  isFranchisee,
  isLabTechnician,
  isPfCustomer,
  isPfLabAuthoriser,
  isPhlebotomist,
  isRequesterOnly,
  isTeleporterOnlyUser,
  isUberDocOnlyUser,
} from '../auth/roles';
import {
  COLLECT_CUTOVER,
  LABTECH_CUTOVER,
  PARTNERS_CUTOVER,
  PATIENT_CUTOVER,
  currentHostname,
  isB2bPortalHost,
  isCollectPortalHost,
  isCollectorAppPath,
  isDevPortalHost,
  isLabtechAppPath,
  isLabtechPortalHost,
  isPartnerAppPath,
  isPatientPortalHost,
  isPhleboFirstHost,
  isTeleporterHost,
  legacyPortalRedirect,
  phleboFirstAppPathFor,
  teleporterAppPathFor,
  teleporterCanonicalUrl,
  UBERDOC_HOST,
  isUberDocHost,
  isVaultHost,
  uberDocCanonicalUrl,
} from '../config/portalHosts';

function isAuthPath(pathname: string) {
  return (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/oauth')
  );
}

function defaultPathForRoles(roles: string[]) {
  if (isFranchisee(roles)) return '/b2b/hub';
  if (isPhlebotomist(roles)) return '/dashboard/phlebotomist';
  if (isLabTechnician(roles)) return '/dashboard/lab-reports';
  return getDefaultDashboardRoute(roles);
}

function homeForRoles(roles: string[]) {
  const dest = defaultPathForRoles(roles);
  if (isFranchisee(roles)) return partnersHandoffUrl(dest.startsWith('/b2b') ? dest : '/b2b/hub');
  if (isPhlebotomist(roles)) return collectorHandoffUrl(dest);
  if ((isLabTechnician(roles) || isRequesterOnly(roles)) && LABTECH_CUTOVER) return labtechHandoffUrl(dest);
  if (dest === '/dashboard/pf-inbox' && LABTECH_CUTOVER) return labtechHandoffUrl(dest);
  if (dest === '/pf') return phleboFirstHandoffUrl('/app/requests');
  return patientHandoffUrl(dest);
}

function go(url: string) {
  void navigateWithHandoff(url, 'replace');
}

/** Keep each portal on its canonical host and carry the login across (handoff codes are redeemed in AuthProvider). */
export function PortalHostBridge() {
  const location = useLocation();
  const { user, isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (isPhleboFirstHost() || isTeleporterHost() || isUberDocHost() || isVaultHost()) return;

    // Teleporter moved to teleports.in: plain redirect, users sign in again there.
    const tpAppPath = teleporterAppPathFor(location.pathname);
    if (tpAppPath) {
      window.location.replace(teleporterCanonicalUrl(tpAppPath));
      return;
    }
    if (
      !loading &&
      user &&
      isTeleporterOnlyUser(user.roles) &&
      !isAuthPath(location.pathname) &&
      !(isDevPortalHost() && (location.pathname === '/teleporter' || location.pathname.startsWith('/teleporter/')))
    ) {
      window.location.replace(teleporterCanonicalUrl('/app'));
      return;
    }
    if (
      UBERDOC_HOST &&
      !loading &&
      user &&
      isUberDocOnlyUser(user.roles) &&
      !isAuthPath(location.pathname) &&
      !(isDevPortalHost() && (location.pathname === '/uberdoc' || location.pathname.startsWith('/uberdoc/')))
    ) {
      window.location.replace(uberDocCanonicalUrl('/app'));
      return;
    }

    if (loading || isDevPortalHost()) return;

    const path = `${location.pathname}${location.search}`;
    const alias = legacyPortalRedirect();
    if (alias && (COLLECT_CUTOVER || PARTNERS_CUTOVER)) {
      const session = path;
      if (isCollectPortalHost() && COLLECT_CUTOVER) {
        go(collectorHandoffUrl(session));
        return;
      }
      if (isB2bPortalHost() && PARTNERS_CUTOVER) {
        go(partnersHandoffUrl(session));
        return;
      }
    }

    if (isAuthPath(location.pathname)) return;

    const pfAppPath = phleboFirstAppPathFor(location.pathname);
    if (pfAppPath) {
      go(phleboFirstHandoffUrl(`${pfAppPath}${location.search}`));
      return;
    }

    if (isCollectPortalHost() && isAuthenticated && user && !isPhlebotomist(user.roles)) {
      go(homeForRoles(user.roles));
      return;
    }

    if (isB2bPortalHost() && isAuthenticated && user && !isFranchisee(user.roles) && !isPfCustomer(user.roles)) {
      go(homeForRoles(user.roles));
      return;
    }

    if (
      isLabtechPortalHost() &&
      isAuthenticated &&
      user &&
      !isLabTechnician(user.roles) &&
      !isRequesterOnly(user.roles) &&
      !isPfLabAuthoriser(user.roles)
    ) {
      go(homeForRoles(user.roles));
      return;
    }

    if (!isPatientPortalHost() && !isCollectPortalHost() && !isB2bPortalHost() && !isLabtechPortalHost()) {
      return;
    }

    if (location.pathname.startsWith('/dashboard/phlebotomist') && !isCollectPortalHost() && COLLECT_CUTOVER) {
      go(collectorHandoffUrl(path));
      return;
    }

    if (isPartnerAppPath(location.pathname) && !isB2bPortalHost() && PARTNERS_CUTOVER) {
      go(partnersHandoffUrl(path));
      return;
    }

    if (
      LABTECH_CUTOVER &&
      !isLabtechPortalHost() &&
      LABTECH_PATH_GUARD(location.pathname)
    ) {
      go(labtechHandoffUrl(path));
      return;
    }

    if (isAuthenticated && user) {
      if (isPhlebotomist(user.roles) && !isCollectPortalHost() && isCollectorAppPath(location.pathname) && COLLECT_CUTOVER) {
        go(collectorHandoffUrl(path));
        return;
      }
      if (isFranchisee(user.roles) && !isB2bPortalHost() && isPartnerAppPath(location.pathname) && PARTNERS_CUTOVER) {
        go(partnersHandoffUrl(path));
        return;
      }
      if (isLabTechnician(user.roles) && !isLabtechPortalHost() && isLabtechAppPath(location.pathname) && LABTECH_CUTOVER) {
        go(labtechHandoffUrl(path));
        return;
      }
    }

    if (
      PATIENT_CUTOVER &&
      isPatientPortalHost() &&
      currentHostname() !== 'www.remediumlabs.in' &&
      currentHostname() !== 'remediumlabs.in' &&
      !location.pathname.startsWith('/careers') &&
      !location.pathname.startsWith('/jobs') &&
      !location.pathname.startsWith('/people') &&
      !location.pathname.startsWith('/agents') &&
      !location.pathname.startsWith('/planning') &&
      !location.pathname.startsWith('/onboard') &&
      !location.pathname.startsWith('/franchise') &&
      !location.pathname.startsWith('/ffms') &&
      !location.pathname.startsWith('/dashboard/provider')
    ) {
      go(patientHandoffUrl(path));
    }
  }, [isAuthenticated, loading, location.pathname, location.search, user]);

  return null;
}

function LABTECH_PATH_GUARD(pathname: string) {
  return (
    pathname.startsWith('/dashboard/lab-reports') ||
    pathname.startsWith('/dashboard/lab-bill-entry') ||
    pathname.startsWith('/dashboard/lab-tech') ||
    pathname.startsWith('/dashboard/accession') ||
    pathname.startsWith('/dashboard/report-lifecycle') ||
    pathname.startsWith('/dashboard/critical-alerts') ||
    pathname.startsWith('/dashboard/qc') ||
    pathname.startsWith('/dashboard/qms') ||
    pathname.startsWith('/dashboard/all-bookings') ||
    pathname.startsWith('/dashboard/reagents') ||
    pathname.startsWith('/dashboard/inventory') ||
    pathname.startsWith('/dashboard/pf-inbox')
  );
}

/** @deprecated Use PortalHostBridge — kept so older imports keep compiling. */
export { PortalHostBridge as CollectorHostBridge };
export { collectorHandoffUrl } from '../auth/portalHandoff';
