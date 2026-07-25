import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  erpDeskBaseUrl,
  getPortalKind,
  isPathAllowedOnPortal,
  isPatientPortalHost,
  portalHomePath,
} from '../config/portalHosts';

/** Enforce subdomain isolation — staff portals cannot open patient booking/cart routes. */
export function HostPortalGate() {
  const location = useLocation();
  const kind = getPortalKind();
  const path = location.pathname;

  useEffect(() => {
    if (kind === 'erp') {
      window.location.replace(`${erpDeskBaseUrl()}/app`);
    }
  }, [kind]);

  if (kind === 'erp') {
    return (
      <div className="page-center">
        <p className="muted">Redirecting to ERPNext…</p>
      </div>
    );
  }

  if (!isPatientPortalHost() && path === '/') {
    return <Navigate to={portalHomePath(kind)} replace />;
  }

  if (!isPathAllowedOnPortal(path, kind)) {
    return <Navigate to={portalHomePath(kind)} replace />;
  }

  return <Outlet />;
}

