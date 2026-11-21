import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AES_SESSION_KEY, api, ApiError, savedSession } from '../api';
import type { Me, ModuleName, Practitioner } from '../types';
import { CareProvider, useApi, useCare } from '../store';
import { Icon } from '../icons';
import { Modals } from './Forms';
import { AppointmentsPage, SessionsPage } from './pages/Appointments';
import { NewBookingPage } from './pages/NewBooking';
import { PackagesPage, TherapyMasterPage } from './pages/Physio';
import { PatientDetailPage, PatientsPage } from './pages/Patients';
import { DoctorsPage } from './pages/Doctors';
import { Empty, ErrorNote, PageHeader, Pill } from './ui';
import { inr } from '../format';
import { roleLabel } from '../flavor';

/* The session pages of the Remedium Aesthetic console. They run inside the console (aesthetics.e-remedium.in,
   same origin) in a frame, on the console's own sign-in; the console's add-on decides which page opens. */

/* Consoles allowed to frame these pages and hand over their sign-in. */
const CONSOLE_ORIGINS = ['https://aesthetics.e-remedium.in', 'http://127.0.0.1:5173', 'http://localhost:5173'];

function askParent() {
  if (window.parent === window) return;
  for (const origin of CONSOLE_ORIGINS) {
    try {
      window.parent.postMessage({ type: 'aes-embed-ready' }, origin);
    } catch {
      /* not that origin */
    }
  }
}

type Gate = { state: 'checking' } | { state: 'signin' } | { state: 'denied'; text: string } | { state: 'offline' } | { state: 'ready'; me: Me };

const TABS: { to: string; label: string; module: ModuleName }[] = [
  { to: '/plans', label: 'Treatment plans', module: 'Appointments' },
  { to: '/appointments/physiotherapy', label: 'Sessions', module: 'Appointments' },
  { to: '/physio/packages', label: 'Packages', module: 'Physiotherapy' },
  { to: '/physio/therapies', label: 'Treatment Master', module: 'Physiotherapy' },
  { to: '/patients', label: 'Patients', module: 'Patients' },
  { to: '/doctors', label: 'Doctors & Cosmetologists', module: 'Doctors' },
  { to: '/staff', label: 'Other staff', module: 'User & Access' },
];

function EmbedShell() {
  const { can, meta, branch, setBranch, toasts, dismissToast } = useCare();
  const path = useLocation().pathname;
  const bare = path === '/book' || path === '/doctors';
  const branches = (meta?.branches || []).filter((b) => b.active);
  return (
    <div className="aes-embed">
      {!bare && <nav className="aes-embed-bar">
        <div className="aes-embed-tabs">
          {TABS.filter((t) => can(t.module)).map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => `aes-tab ${isActive ? 'on' : ''}`}>
              {t.label}
            </NavLink>
          ))}
        </div>
        {branches.length > 1 && (
          <label className="branch-select">
            <Icon name="building" size={16} />
            <select value={branch} onChange={(e) => setBranch(Number(e.target.value))} aria-label="Branch">
              <option value={0}>All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </nav>}
      <main className="content aes-embed-content">
        <Outlet />
      </main>
      <Modals />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} onClick={() => dismissToast(t.id)}>
            <Icon name={t.tone === 'ok' ? 'check' : 'alert'} size={16} /> {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function StaffPage() {
  const { can, openModal } = useCare();
  const { data, error } = useApi<Practitioner[]>('/practitioners');
  return (
    <div className="page">
      <PageHeader
        title="Therapists & doctors"
        subtitle="Staff who can be assigned to treatment plans and sessions; doctors also appear as referring doctors"
        icon="users"
        actions={
          can('User & Access', 'create') && (
            <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'practitioner' })}>
              <Icon name="plus" size={16} /> Add staff
            </button>
          )
        }
      />
      {error && <ErrorNote text={error} />}
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Speciality</th>
              <th>Phone</th>
              <th className="num">Fee</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data || []).map((p) => (
              <tr key={p.id} className={p.active ? '' : 'dim'}>
                <td>
                  <strong>{p.name}</strong>
                </td>
                <td>
                  <Pill tone="grey">{roleLabel(p.role)}</Pill>
                </td>
                <td>{p.specialty || '—'}</td>
                <td>{p.phone || '—'}</td>
                <td className="num">{p.fee ? inr(p.fee) : '—'}</td>
                <td>{p.active ? <Pill tone="green">Active</Pill> : <Pill tone="grey">Inactive</Pill>}</td>
                <td className="row-actions">
                  {can('User & Access', 'edit') && (
                    <button type="button" className="icon-btn sm" onClick={() => openModal({ kind: 'practitioner', practitioner: p })} aria-label={`Edit ${p.name}`}>
                      <Icon name="edit" size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.length === 0 && <Empty text="No staff yet. Add the therapists who run treatment sessions." icon="users" />}
      </div>
    </div>
  );
}

export function AestheticApp() {
  const [gate, setGate] = useState<Gate>({ state: 'checking' });

  const check = useCallback(async () => {
    if (!savedSession()) {
      setGate({ state: 'signin' });
      return;
    }
    setGate({ state: 'checking' });
    try {
      setGate({ state: 'ready', me: await api<Me>('/me') });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setGate({ state: 'signin' });
      else if (err instanceof ApiError && err.status === 403) setGate({ state: 'denied', text: 'Your login has no access to Aesthetic session management. Ask HR to give you Services access in Portal Access → Aesthetic Backend.' });
      else setGate({ state: 'offline' });
    }
  }, []);

  useEffect(() => {
    document.title = 'Remedium Aesthetic · Sessions';
    const onMessage = (e: MessageEvent) => {
      if (!CONSOLE_ORIGINS.includes(e.origin) || e.source !== window.parent) return;
      const data = e.data as { type?: string; session?: { sid?: string; user?: string; full_name?: string } } | null;
      if (!data || data.type !== 'aes-embed-session') return;
      const s = data.session;
      if (s && s.sid) sessionStorage.setItem(AES_SESSION_KEY, JSON.stringify({ sid: s.sid, user: s.user || '', full_name: s.full_name || s.user || '' }));
      else sessionStorage.removeItem(AES_SESSION_KEY);
      check();
    };
    window.addEventListener('message', onMessage);
    const again = () => {
      sessionStorage.removeItem(AES_SESSION_KEY);
      setGate({ state: 'signin' });
      askParent();
    };
    window.addEventListener('care:unauthorized', again);
    if (savedSession()) check();
    else setGate({ state: 'checking' });
    askParent();
    const late = window.setTimeout(() => !savedSession() && setGate({ state: 'signin' }), 4000);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('care:unauthorized', again);
      window.clearTimeout(late);
    };
  }, [check]);

  if (gate.state !== 'ready') {
    const text =
      gate.state === 'checking'
        ? 'Loading sessions…'
        : gate.state === 'signin'
          ? 'Your console session has ended. Sign in to the Aesthetic console again.'
          : gate.state === 'denied'
            ? gate.text
            : 'Cannot reach the session service. Check the connection and try again.';
    return (
      <div className="aes-embed-gate">
        <p>{text}</p>
        {gate.state !== 'checking' && (
          <button type="button" className="btn btn-primary" onClick={check}>
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <CareProvider me={gate.me} onSignOut={() => setGate({ state: 'signin' })}>
      <Routes>
        <Route element={<EmbedShell />}>
          <Route index element={<Navigate to="/plans" replace />} />
          <Route path="book" element={<NewBookingPage />} />
          <Route path="plans" element={<SessionsPage />} />
          <Route path="appointments/sessions" element={<Navigate to="/plans" replace />} />
          <Route path="appointments/physiotherapy" element={<AppointmentsPage type="physiotherapy" />} />
          <Route path="physio/packages" element={<PackagesPage />} />
          <Route path="physio/therapies" element={<TherapyMasterPage />} />
          <Route path="patients" element={<PatientsPage />} />
          <Route path="patients/:id" element={<PatientDetailPage />} />
          <Route path="doctors" element={<DoctorsPage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="*" element={<Navigate to="/plans" replace />} />
        </Route>
      </Routes>
    </CareProvider>
  );
}
