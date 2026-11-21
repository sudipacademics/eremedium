import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, ApiError, savedSession, signOut } from './api';
import type { Me } from './types';
import { CareProvider } from './store';
import { GateMessage, LoginScreen } from './components/Login';
import { Shell } from './components/Shell';
import { Dashboard } from './components/Dashboard';
import { AppointmentsPage, SessionsPage } from './components/pages/Appointments';
import { PatientDetailPage, PatientsPage } from './components/pages/Patients';
import { LabCatalogPage, LabPage } from './components/pages/Lab';
import { BillingPage } from './components/pages/Billing';
import { InventoryPage } from './components/pages/Inventory';
import { PharmacyPage } from './components/pages/Pharmacy';
import { BranchesPage } from './components/pages/Branches';
import { ReportsPage } from './components/pages/Reports';
import { AssetsPage } from './components/pages/Assets';
import { AccessPage } from './components/pages/Access';
import { SettingsPage } from './components/pages/Settings';
import { MyHrPage } from './components/pages/MyHr';
import { DoctorsPage } from './components/pages/Doctors';
import { PackagesPage, TherapyMasterPage } from './components/pages/Physio';
import { DiagnosticMasterPage, DiagnosticsPage } from './components/pages/Diagnostics';
import { AestheticApp } from './components/AestheticEmbed';
import { AES } from './flavor';

type Gate = { state: 'checking' } | { state: 'login'; message?: string } | { state: 'denied'; name: string } | { state: 'offline' } | { state: 'ready'; me: Me };

export default function App() {
  return AES ? <AestheticApp /> : <CareApp />;
}

function CareApp() {
  const [gate, setGate] = useState<Gate>({ state: 'checking' });

  const check = useCallback(async () => {
    const session = savedSession();
    if (!session) {
      setGate({ state: 'login' });
      return;
    }
    setGate({ state: 'checking' });
    try {
      const me = await api<Me>('/me');
      setGate({ state: 'ready', me });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setGate({ state: 'login', message: err.message });
      else if (err instanceof ApiError && err.status === 403) setGate({ state: 'denied', name: session.full_name || session.user });
      else setGate({ state: 'offline' });
    }
  }, []);

  useEffect(() => {
    check();
    const onUnauthorized = (e: Event) => setGate({ state: 'login', message: (e as CustomEvent<string>).detail });
    window.addEventListener('care:unauthorized', onUnauthorized);
    return () => window.removeEventListener('care:unauthorized', onUnauthorized);
  }, [check]);

  const logout = useCallback(async () => {
    await signOut();
    setGate({ state: 'login' });
  }, []);

  if (gate.state === 'checking') return <div className="gate"><div className="loading">Loading Remedium Care…</div></div>;
  if (gate.state === 'login') return <LoginScreen message={gate.message} onSignedIn={check} />;
  if (gate.state === 'offline') {
    return <GateMessage title="Cannot reach the server" text="Check your internet connection and try again." action="Retry" onAction={check} />;
  }
  if (gate.state === 'denied') {
    return (
      <GateMessage
        title="No access"
        text={`${gate.name} has not been given access to the Remedium Care portal. Ask HR to add "Care Backend" in your Portal Access.`}
        action="Sign in as someone else"
        onAction={logout}
      />
    );
  }
  if (gate.me.branches && !gate.me.branches.length) {
    return (
      <GateMessage
        title="No branch assigned"
        text={`${gate.me.full_name} has Care portal access but no branch. Ask HR to set your Unit / Centre to a Remedium Care branch, or to pick your branch in Portal Access → Care Backend.`}
        action="Sign in as someone else"
        onAction={logout}
      />
    );
  }

  return (
    <CareProvider me={gate.me} onSignOut={logout}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="appointments" element={<AppointmentsPage />} />
          <Route path="appointments/consultation" element={<AppointmentsPage type="consultation" />} />
          <Route path="appointments/physiotherapy" element={<AppointmentsPage type="physiotherapy" />} />
          <Route path="appointments/sessions" element={<SessionsPage />} />
          <Route path="doctors" element={<DoctorsPage />} />
          <Route path="physio" element={<Navigate to="/physio/therapies" replace />} />
          <Route path="physio/therapies" element={<TherapyMasterPage />} />
          <Route path="physio/packages" element={<PackagesPage />} />
          <Route path="patients" element={<PatientsPage />} />
          <Route path="patients/:id" element={<PatientDetailPage />} />
          <Route path="lab" element={<LabPage />} />
          <Route path="lab/reports" element={<LabPage reports />} />
          <Route path="lab/catalog" element={<LabCatalogPage />} />
          <Route path="diagnostics" element={<DiagnosticsPage />} />
          <Route path="diagnostics/master" element={<DiagnosticMasterPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="pharmacy" element={<PharmacyPage />} />
          <Route path="pharmacy/stock" element={<Navigate to="/pharmacy" replace />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="branches" element={<BranchesPage />} />
          <Route path="reports" element={<ReportsPage section="revenue" />} />
          <Route path="reports/clinical" element={<ReportsPage section="clinical" />} />
          <Route path="reports/stock" element={<ReportsPage section="stock" />} />
          <Route path="assets" element={<AssetsPage />} />
          <Route path="access" element={<AccessPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="my-hr" element={<MyHrPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </CareProvider>
  );
}
