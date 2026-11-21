import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  erpDeskBaseUrl,
  getPortalKind,
  isPathAllowedOnPortal,
  isPatientPortalHost,
  isPeoplePath,
  isSalesPath,
  peoplePortalOrigin,
  portalHomePath,
  reachPortalOrigin,
  teleporterAppPathFor,
} from '../config/portalHosts';
import { PhleboFirstSiteLazy } from '../pages/phlebofirst/PhleboFirstSiteLazy';
import { TeleporterSiteLazy } from '../pages/teleporter/TeleporterSiteLazy';
import { UberDocSiteLazy } from '../pages/uberdoc/UberDocSiteLazy';
import { VaultSiteLazy } from '../pages/vault/VaultSiteLazy';

/** Enforce subdomain isolation — staff portals cannot open patient booking/cart routes. */
export function HostPortalGate() {
  const location = useLocation();
  const kind = getPortalKind();
  const path = location.pathname;
  const erpPlanning = kind === 'erp' && (path === '/planning' || path.startsWith('/planning/'));

  useEffect(() => {
    if (kind === 'erp' && !erpPlanning && !path.startsWith('/login') && !path.startsWith('/oauth')) {
      window.location.replace(`${erpDeskBaseUrl()}/app`);
    }
  }, [kind, erpPlanning, path]);

  if (kind === 'erp' && !erpPlanning && !path.startsWith('/login') && !path.startsWith('/oauth')) {
    return (
      <div className="page-center">
        <p className="muted">Redirecting to ERPNext…</p>
      </div>
    );
  }

  // Field sales / Reach is host-only — bounce /sales off www and other non-Reach hosts.
  if (kind !== 'sales' && isSalesPath(path)) {
    const dest = `${reachPortalOrigin()}${path}${location.search || ''}${location.hash || ''}`;
    if (typeof window !== 'undefined') {
      window.location.replace(dest);
    }
    return (
      <div className="page-center">
        <p className="muted">Sales moved to Reach — redirecting…</p>
      </div>
    );
  }

  // People HRMS is host-only — bounce /people off www and other non-People hosts.
  if (kind !== 'people' && kind !== 'careers' && isPeoplePath(path)) {
    const dest = `${peoplePortalOrigin()}${path}${location.search || ''}${location.hash || ''}`;
    if (typeof window !== 'undefined') {
      window.location.replace(dest);
    }
    return (
      <div className="page-center">
        <p className="muted">People HRMS moved to people.e-remedium.in — redirecting…</p>
      </div>
    );
  }

  if (kind === 'phlebofirst') {
    return isPathAllowedOnPortal(path, kind) ? <PhleboFirstSiteLazy /> : <Navigate to="/" replace />;
  }

  if (kind === 'teleporter') {
    return isPathAllowedOnPortal(path, kind) ? <TeleporterSiteLazy /> : <Navigate to="/" replace />;
  }

  if (kind === 'uberdoc') {
    return isPathAllowedOnPortal(path, kind) ? <UberDocSiteLazy /> : <Navigate to="/" replace />;
  }

  if (kind === 'vault') {
    return isPathAllowedOnPortal(path, kind) ? <VaultSiteLazy /> : <Navigate to="/" replace />;
  }

  // PortalHostBridge sends old Teleporter screens to teleports.in; hold the page so no portal redirect races it.
  if (teleporterAppPathFor(path)) {
    return (
      <div className="page-center">
        <p className="muted">Teleporter has moved to teleports.in — redirecting…</p>
      </div>
    );
  }

  if (kind === 'b2b' && path.startsWith('/dashboard/franchisee')) {
    return <Navigate to="/b2b/hub" replace />;
  }

  if (!isPatientPortalHost() && path === '/' && portalHomePath(kind) !== '/') {
    return <Navigate to={portalHomePath(kind)} replace />;
  }

  if (!isPathAllowedOnPortal(path, kind)) {
    return <Navigate to={portalHomePath(kind)} replace />;
  }

  return <Outlet />;
}
