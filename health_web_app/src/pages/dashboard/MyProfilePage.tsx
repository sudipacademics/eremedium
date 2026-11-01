import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  ExpenseClaimRow,
  LeaveApplicationRow,
  PeopleHrmsDashboard,
  StaffPerformanceHub,
  TrainingEventRow,
} from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { isHrStaff, isLabTechnician, isPhlebotomist } from '../../auth/roles';
import { HrSelfServicePage } from './HrSelfServicePage';
import { StaffPerformancePage } from './StaffPerformancePage';
import { PhlebotomistTrainingPage } from './PhlebotomistTrainingPage';
import { PeopleAttendancePage } from '../people/PeopleAttendancePage';
import { PeopleExpensesPage } from '../people/PeopleExpensesPage';
import { PeopleHomePage } from '../people/PeopleHomePage';
import { PeopleLeaveSelfService } from '../people/PeopleLeavePage';
import { PeoplePayslipsSelf } from '../people/PeoplePayslipsPage';
import { PeopleProfilePage } from '../people/PeopleProfilePage';
import {
  downloadEmployeeIdCard,
  EmployeeIdCard,
  EmployeeIdCardFields,
  profilePhotoUrl,
} from '../../components/EmployeeIdCard';
import { usePhleboLocationToggles } from '../../hooks/usePhleboGps';
import './lab-tech-v2.css';
import './my-profile-v2.css';
import './collector-v2.css';

export type ProfileTab = 'profile' | 'hr' | 'hrms' | 'training';
export type HrmsSection = 'home' | 'attendance' | 'leave' | 'expenses' | 'payslips' | 'info';

const TAB_PATH: Record<ProfileTab, string> = {
  profile: '/dashboard/profile',
  hr: '/dashboard/profile/hr',
  hrms: '/dashboard/profile/hrms',
  training: '/dashboard/profile/training',
};

const TAB_LABEL: Record<ProfileTab, string> = {
  profile: 'Personal Profile',
  hr: 'HR Self-Service',
  hrms: 'People HRMS',
  training: 'Training & Appraisal',
};

const HRMS_LABEL: Record<HrmsSection, string> = {
  home: 'Dashboard',
  attendance: 'Attendance',
  leave: 'Leave',
  expenses: 'Expenses',
  payslips: 'Payslips',
  info: 'Employee info',
};

const PEOPLE_SECTION: Record<string, HrmsSection> = {
  '/people/attendance': 'attendance',
  '/people/leave': 'leave',
  '/people/expenses': 'expenses',
  '/people/payslips': 'payslips',
  '/people/profile': 'info',
};

type ActivityItem = {
  key: string;
  title: string;
  detail: string;
  when: string;
  status: string;
  tone: 'amber' | 'green' | 'blue' | 'muted';
};

type PulseDay = { day: number; kind: 'present' | 'absent' | 'upcoming' };

type IdFields = EmployeeIdCardFields;

function isLabTechProfileUser(roles: string[] | undefined) {
  return (isLabTechnician(roles) || isPhlebotomist(roles));
}

function parseProfileTab(value?: string | null): ProfileTab {
  if (value === 'hr' || value === 'hrms' || value === 'training' || value === 'profile') return value;
  return 'profile';
}

function parseHrmsSection(value?: string | null): HrmsSection {
  if (
    value === 'attendance' ||
    value === 'leave' ||
    value === 'expenses' ||
    value === 'payslips' ||
    value === 'info' ||
    value === 'home'
  ) {
    return value;
  }
  return 'home';
}

export function peoplePathToHrmsSection(pathname: string): HrmsSection {
  if (PEOPLE_SECTION[pathname]) return PEOPLE_SECTION[pathname];
  if (pathname === '/people' || pathname === '/people/') return 'home';
  return 'home';
}

export function labTechProfilePath(tab: ProfileTab = 'profile', section?: HrmsSection) {
  const base = TAB_PATH[tab];
  if (tab === 'hrms' && section && section !== 'home') return `${base}?section=${section}`;
  return base;
}

function initials(name?: string | null) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'LT';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function dash(value?: string | null) {
  const text = String(value || '').trim();
  return text || '—';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusTone(status?: string): ActivityItem['tone'] {
  const s = String(status || '').toLowerCase();
  if (s.includes('approv') || s.includes('complete') || s.includes('present')) return 'green';
  if (s.includes('pend') || s.includes('open') || s.includes('draft')) return 'amber';
  if (s.includes('reject') || s.includes('cancel')) return 'muted';
  return 'blue';
}

function buildActivities(
  leaves: LeaveApplicationRow[],
  expenses: ExpenseClaimRow[],
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const row of leaves) {
    items.push({
      key: `leave-${row.name}`,
      title: 'Leave application submitted',
      detail: [row.leave_type, row.from_date && row.to_date ? `${row.from_date} to ${row.to_date}` : '']
        .filter(Boolean)
        .join(' · '),
      when: formatDateTime(row.modified || row.creation || row.from_date),
      status: row.status || 'Submitted',
      tone: statusTone(row.status),
    });
  }
  for (const row of expenses) {
    const amount =
      row.total_claimed_amount != null ? `₹${Number(row.total_claimed_amount).toFixed(0)}` : 'Expense';
    items.push({
      key: `exp-${row.name}`,
      title: 'Expense claim submitted',
      detail: [amount, row.remark].filter(Boolean).join(' · '),
      when: formatDateTime(row.modified || row.creation || row.posting_date),
      status: row.approval_status || 'Submitted',
      tone: statusTone(row.approval_status),
    });
  }
  return items.sort((a, b) => (a.when < b.when ? 1 : -1));
}

function buildPulse(series: Array<{ day: number; count: number }>, todayDay: number): PulseDay[] {
  return series.map((row) => {
    if (row.day > todayDay) return { day: row.day, kind: 'upcoming' };
    if (Number(row.count) > 0) return { day: row.day, kind: 'present' };
    return { day: row.day, kind: 'absent' };
  });
}

function MpIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function ProfileHero({ name, photoUrl, collector }: { name: string; photoUrl?: string; collector?: boolean }) {
  if (collector) {
    return (
      <section className="cmp-hero">
        <div className="cmp-hero-id">
          <div className="cmp-hero-avatar" aria-hidden>
            {photoUrl ? <img src={photoUrl} alt="" /> : initials(name)}
          </div>
          <div>
            <h1>My Profile</h1>
            <p>Manage your personal information, work details, training and performance.</p>
          </div>
        </div>
        <p className="cmp-hero-tag">Collect · Care · Connect</p>
      </section>
    );
  }
  return (
    <section className="mp2-hero">
      <div className="mp2-hero-avatar" aria-hidden>
        {photoUrl ? <img src={photoUrl} alt="" /> : initials(name)}
      </div>
      <div>
        <h2>My Profile</h2>
        <p>Manage your personal information, HR services, training and performance.</p>
      </div>
    </section>
  );
}

function ProfileTabs({ tab, collector }: { tab: ProfileTab; collector?: boolean }) {
  return (
    <nav className="mp2-tabs" aria-label="My Profile sections">
      {(Object.keys(TAB_LABEL) as ProfileTab[]).map((key) => {
        const to = collector && key === 'training' ? `${TAB_PATH.training}?view=appraisal` : TAB_PATH[key];
        return (
          <Link key={key} to={to} className={`mp2-tab${tab === key ? ' is-active' : ''}`}>
            {TAB_LABEL[key]}
          </Link>
        );
      })}
    </nav>
  );
}

function HrmsSubnav({ section }: { section: HrmsSection }) {
  return (
    <nav className="mp2-subnav" aria-label="People HRMS sections">
      {(Object.keys(HRMS_LABEL) as HrmsSection[]).map((key) => (
        <Link
          key={key}
          to={labTechProfilePath('hrms', key)}
          className={section === key ? 'is-active' : undefined}
        >
          {HRMS_LABEL[key]}
        </Link>
      ))}
    </nav>
  );
}

function IdCardPreview({ fields }: { fields: IdFields }) {
  return <EmployeeIdCard fields={fields} />;
}

function IdCardModal({
  fields,
  onClose,
  onDownload,
}: {
  fields: IdFields;
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="mp2-modal-back" role="dialog" aria-modal="true" aria-label="Employee ID card">
      <div className="mp2-modal mp2-id-modal">
        <h3>My ID card</h3>
        <p>Preview generated from your employee record. No extra ID number is created.</p>
        <div className="mp2-id-preview">
          <IdCardPreview fields={fields} />
        </div>
        <div className="mp2-modal-actions">
          <button type="button" className="mp2-btn is-ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="mp2-btn" onClick={onDownload}>
            Download ID card
          </button>
        </div>
      </div>
    </div>
  );
}

function EditProfileModal({
  emp,
  onClose,
}: {
  emp: PeopleHrmsDashboard['employee'] | undefined;
  onClose: () => void;
}) {
  return (
    <div className="mp2-modal-back" role="dialog" aria-modal="true" aria-label="Edit profile">
      <div className="mp2-modal">
        <h3>Edit profile</h3>
        <p>Official employee fields are maintained in Desk by HR. This view shows your live record only.</p>
        <dl className="mp2-fields">
          <div className="mp2-field">
            <dt>Full name</dt>
            <dd>{dash(emp?.name)}</dd>
          </div>
          <div className="mp2-field">
            <dt>Employee ID</dt>
            <dd>{dash(emp?.id)}</dd>
          </div>
          <div className="mp2-field">
            <dt>Designation</dt>
            <dd>{dash(emp?.designation)}</dd>
          </div>
          <div className="mp2-field">
            <dt>Department</dt>
            <dd>{dash(emp?.department)}</dd>
          </div>
          <div className="mp2-field">
            <dt>Email</dt>
            <dd>{dash(emp?.email)}</dd>
          </div>
          <div className="mp2-field">
            <dt>Mobile</dt>
            <dd>{dash(emp?.phone)}</dd>
          </div>
        </dl>
        <div className="mp2-modal-actions">
          <Link className="mp2-btn is-ghost" to={labTechProfilePath('hrms', 'info')} onClick={onClose}>
            Open employee info
          </Link>
          <button type="button" className="mp2-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangePasswordModal({
  email,
  onClose,
}: {
  email: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) {
      setError('No email is linked to this account, so a reset link cannot be sent.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.forgotPassword(email);
      setSuccess(
        res.message ||
          'If an account exists for this email, password reset instructions will be sent shortly.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mp2-modal-back" role="dialog" aria-modal="true" aria-label="Change password">
      <form className="mp2-modal" onSubmit={(e) => void onSubmit(e)}>
        <h3>Change password</h3>
        <p>
          Staff passwords are changed through the existing reset-email flow. A link will be sent to{' '}
          <strong>{email || '—'}</strong>.
        </p>
        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}
        <div className="mp2-modal-actions">
          <button type="button" className="mp2-btn is-ghost" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="mp2-btn" disabled={busy || !email}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </div>
      </form>
    </div>
  );
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read photo'));
    reader.readAsDataURL(file);
  });
}

function ProfileInformationCard({
  emp,
  loginEmail,
  onEdit,
  onReload,
}: {
  emp: PeopleHrmsDashboard['employee'] | undefined;
  loginEmail: string;
  onEdit: () => void;
  onReload: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const photo = profilePhotoUrl(emp);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setPhotoMsg('Photo must be 2 MB or less.');
      return;
    }
    setPhotoBusy(true);
    setPhotoMsg(null);
    try {
      const data = await fileToBase64(file);
      const res = await api.updateMyEmployeePhoto({ file_name: file.name, file_data: data });
      setPhotoMsg(res.message || 'Photo updated');
      onReload();
    } catch (err) {
      setPhotoMsg(err instanceof Error ? err.message : 'Could not upload photo');
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <section className="mp2-card">
      <div className="mp2-card-head">
        <div className="mp2-card-title">
          <span>
            <MpIcon>
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 21c.6-4 3.4-6 7-6s6.4 2 7 6" />
            </MpIcon>
          </span>
          Profile information
        </div>
        <button type="button" className="mp2-link" onClick={onEdit}>
          Edit profile
        </button>
      </div>
      <div className="mp2-card-body">
        <div className="mp2-profile-top">
          <div className="mp2-photo">
            <div className="mp2-photo-circle">
              {photo ? <img src={photo} alt="" /> : initials(emp?.name)}
            </div>
            <button
              type="button"
              className="mp2-photo-btn"
              disabled={photoBusy}
              onClick={() => inputRef.current?.click()}
              aria-label="Upload photo"
            >
              <MpIcon>
                <path d="M4 8h3l2-2h6l2 2h3v11H4z" />
                <circle cx="12" cy="13" r="3.5" />
              </MpIcon>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => void onPick(e)}
            />
            <p className="mp2-photo-hint">{photoBusy ? 'Uploading…' : 'JPG, PNG up to 2 MB'}</p>
            {photoMsg ? <p className="mp2-photo-hint">{photoMsg}</p> : null}
          </div>
          <dl className="mp2-fields">
            <div className="mp2-field">
              <dt>Employee ID</dt>
              <dd>{dash(emp?.id)}</dd>
            </div>
            <div className="mp2-field">
              <dt>Full name</dt>
              <dd>{dash(emp?.name)}</dd>
            </div>
            <div className="mp2-field">
              <dt>Designation</dt>
              <dd>{dash(emp?.designation)}</dd>
            </div>
            <div className="mp2-field">
              <dt>Department</dt>
              <dd>{dash(emp?.department)}</dd>
            </div>
            <div className="mp2-field">
              <dt>Email ID</dt>
              <dd>{dash(emp?.email || loginEmail)}</dd>
            </div>
            <div className="mp2-field">
              <dt>Mobile number</dt>
              <dd>{dash(emp?.phone)}</dd>
            </div>
            <div className="mp2-field">
              <dt>Date of joining</dt>
              <dd>{formatDate(emp?.date_of_joining)}</dd>
            </div>
            <div className="mp2-field">
              <dt>Reporting manager</dt>
              <dd>{dash(emp?.reports_to_name)}</dd>
            </div>
            <div className="mp2-field">
              <dt>Home location</dt>
              <dd>{dash(emp?.current_address || emp?.permanent_address)}</dd>
            </div>
            <div className="mp2-field">
              <dt>Work location</dt>
              <dd>{dash(emp?.branch || emp?.company)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function SecurityCard({
  email,
  onChangePassword,
}: {
  email: string;
  onChangePassword: () => void;
}) {
  return (
    <section className="mp2-card">
      <div className="mp2-card-head">
        <div className="mp2-card-title">
          <span>
            <MpIcon>
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </MpIcon>
          </span>
          Security
        </div>
      </div>
      <div className="mp2-card-body">
        <p className="mp2-empty" style={{ marginBottom: 8 }}>
          Manage your login credentials and account security.
        </p>
        <div className="mp2-secure-row">
          <div>
            <dt>Email ID</dt>
            <dd>{dash(email)}</dd>
          </div>
          <button type="button" className="mp2-link" disabled title="Email is updated from Desk">
            Update
          </button>
        </div>
        <div className="mp2-secure-row">
          <div>
            <dt>Password</dt>
            <dd>••••••••••••</dd>
          </div>
          <button type="button" className="mp2-link" onClick={onChangePassword}>
            Change password
          </button>
        </div>
        <div className="mp2-secure-row">
          <div>
            <dt>Two-factor authentication</dt>
            <dd>Managed in Desk</dd>
          </div>
          <button
            type="button"
            className="mp2-link"
            disabled
            title="Two-factor authentication is enabled from Desk"
          >
            Enable
          </button>
        </div>
      </div>
    </section>
  );
}

function IdCardBlock({
  fields,
  onView,
  onDownload,
}: {
  fields: IdFields;
  onView: () => void;
  onDownload: () => void;
}) {
  return (
    <section className="mp2-card">
      <div className="mp2-card-head">
        <div className="mp2-card-title">
          <span>
            <MpIcon>
              <rect x="6" y="3" width="12" height="18" rx="2" />
              <circle cx="12" cy="9" r="2.2" />
              <path d="M9 14h6M9 17h4" />
            </MpIcon>
          </span>
          My ID card
        </div>
      </div>
      <div className="mp2-card-body">
        <div className="mp2-id-wrap">
          <p className="mp2-empty">View and download your employee ID card.</p>
          <IdCardPreview fields={fields} />
          <div className="mp2-id-actions">
            <button type="button" className="mp2-btn" onClick={onView}>
              View ID card
            </button>
            <button type="button" className="mp2-btn is-ghost" onClick={onDownload}>
              Download ID card
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function QuickActions({ collector }: { collector?: boolean }) {
  const duty = usePhleboLocationToggles();
  return (
    <section className="mp2-card">
      <div className="mp2-card-head">
        <div className="mp2-card-title">
          <span>
            <MpIcon>
              <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
            </MpIcon>
          </span>
          Quick actions
        </div>
      </div>
      <div className="mp2-card-body">
        <div className="mp2-actions">
          <Link className="mp2-action" to={labTechProfilePath('hrms', 'attendance')}>
            <span className="mp2-action-icon tone-violet">
              <MpIcon>
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v4l3 2" />
              </MpIcon>
            </span>
            <span>
              <b>Mark attendance</b>
              <small>Check-in / check-out</small>
            </span>
          </Link>
          {collector ? (
            <button
              type="button"
              className="mp2-action"
              disabled={duty.busy === 'live'}
              onClick={() => void duty.setLiveShare(!duty.liveShare)}
            >
              <span className="mp2-action-icon tone-blue">
                <MpIcon>
                  <path d="M12 21s-7-4.4-7-10a7 7 0 0 1 14 0c0 5.6-7 10-7 10z" />
                </MpIcon>
              </span>
              <span>
                <b>Update availability</b>
                <small>{duty.liveShare ? 'Live location sharing on' : 'On duty / off duty'}</small>
              </span>
            </button>
          ) : null}
          <Link className="mp2-action" to={labTechProfilePath('hrms', 'leave')}>
            <span className="mp2-action-icon tone-teal">
              <MpIcon>
                <rect x="4" y="5" width="16" height="16" rx="2" />
                <path d="M8 3v4M16 3v4M4 11h16" />
              </MpIcon>
            </span>
            <span>
              <b>Apply leave</b>
              <small>Submit leave request</small>
            </span>
          </Link>
          <Link className="mp2-action" to={labTechProfilePath('hrms', 'expenses')}>
            <span className="mp2-action-icon tone-amber">
              <MpIcon>
                <rect x="3" y="6" width="18" height="13" rx="2" />
                <path d="M3 10h18" />
              </MpIcon>
            </span>
            <span>
              <b>Submit expense</b>
              <small>Raise expense claim</small>
            </span>
          </Link>
          <Link className="mp2-action" to={labTechProfilePath('hrms', 'payslips')}>
            <span className="mp2-action-icon tone-blue">
              <MpIcon>
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5" />
              </MpIcon>
            </span>
            <span>
              <b>View payslip</b>
              <small>Download payslip</small>
            </span>
          </Link>
        </div>
        {collector && duty.message ? <p className="mp2-empty">{duty.message}</p> : null}
      </div>
    </section>
  );
}

function LeaveBalanceCard({
  rows,
}: {
  rows: PeopleHrmsDashboard['leave_balances'] | undefined;
}) {
  const list = rows || [];
  return (
    <section className="mp2-card">
      <div className="mp2-card-head">
        <div className="mp2-card-title">
          <span>
            <MpIcon>
              <rect x="4" y="5" width="16" height="16" rx="2" />
              <path d="M8 3v4M16 3v4M4 11h16" />
            </MpIcon>
          </span>
          Leave balance
        </div>
        <Link className="mp2-link" to={labTechProfilePath('hrms', 'leave')}>
          View all
        </Link>
      </div>
      <div className="mp2-card-body">
        {list.length ? (
          <table className="mp2-table">
            <thead>
              <tr>
                <th>Leave type</th>
                <th>Taken</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.leave_type}>
                  <td>{row.leave_type}</td>
                  <td>{row.taken}</td>
                  <td>{row.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mp2-empty">No leave allocations yet.</p>
        )}
      </div>
    </section>
  );
}

function UpcomingTrainingCard({ events }: { events: TrainingEventRow[] }) {
  const upcoming = events.filter((ev) => {
    const status = String(ev.event_status || '').toLowerCase();
    if (status.includes('cancel') || status.includes('complete')) return false;
    if (!ev.start_time) return true;
    return new Date(ev.start_time).getTime() >= Date.now() - 86400000;
  });
  return (
    <section className="mp2-card">
      <div className="mp2-card-head">
        <div className="mp2-card-title">
          <span>
            <MpIcon>
              <path d="M3 8l9-4 9 4-9 4z" />
              <path d="M7 10v5c0 1.5 2.2 3 5 3s5-1.5 5-3v-5" />
            </MpIcon>
          </span>
          Upcoming training
        </div>
        <Link className="mp2-link" to={TAB_PATH.training}>
          View all
        </Link>
      </div>
      <div className="mp2-card-body">
        {upcoming.length ? (
          <table className="mp2-table">
            <thead>
              <tr>
                <th>Program</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.slice(0, 5).map((ev) => (
                <tr key={ev.name}>
                  <td>{ev.event_name || ev.name}</td>
                  <td>{ev.start_time ? formatDate(ev.start_time) : 'TBD'}</td>
                  <td>{ev.event_status || 'Scheduled'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mp2-empty">No upcoming training scheduled.</p>
        )}
      </div>
    </section>
  );
}

function RecentActivitiesCard({ items }: { items: ActivityItem[] }) {
  return (
    <section className="mp2-card">
      <div className="mp2-card-head">
        <div className="mp2-card-title">
          <span>
            <MpIcon>
              <path d="M12 8v5l3 2" />
              <circle cx="12" cy="12" r="9" />
            </MpIcon>
          </span>
          Recent activity
        </div>
        <Link className="mp2-link" to={labTechProfilePath('hr')}>
          View all
        </Link>
      </div>
      <div className="mp2-card-body">
        {items.length ? (
          <ul className="mp2-activity">
            {items.slice(0, 6).map((item) => (
              <li key={item.key}>
                <span className="mp2-dot">
                  <MpIcon>
                    <circle cx="12" cy="12" r="4" />
                  </MpIcon>
                </span>
                <div>
                  <b>{item.title}</b>
                  <small>
                    {item.detail}
                    {item.detail ? ' · ' : ''}
                    {item.when}
                  </small>
                </div>
                <span className={`mp2-badge tone-${item.tone}`}>{item.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mp2-empty">No recent activity yet.</p>
        )}
      </div>
    </section>
  );
}

function AttendancePulseCard({
  pulse,
  present,
  absent,
  upcoming,
}: {
  pulse: PulseDay[];
  present: number;
  absent: number;
  upcoming: number;
}) {
  return (
    <section className="mp2-card">
      <div className="mp2-card-head">
        <div className="mp2-card-title">
          <span>
            <MpIcon>
              <path d="M4 14c2-4 4-6 8-6s6 2 8 6" />
              <circle cx="12" cy="16" r="2" />
            </MpIcon>
          </span>
          Attendance pulse
        </div>
        <Link className="mp2-link" to={labTechProfilePath('hrms', 'attendance')}>
          View attendance
        </Link>
      </div>
      <div className="mp2-card-body">
        {pulse.length ? (
          <>
            <div className="mp2-pulse-row" role="img" aria-label="Attendance this month">
              {pulse.map((day) => (
                <div key={day.day} className="mp2-pulse-day">
                  <span className={`mp2-pulse-dot is-${day.kind}`} />
                  {day.day}
                </div>
              ))}
            </div>
            <div className="mp2-legend">
              <span>
                <i className="is-present" /> Present ({present})
              </span>
              <span>
                <i className="is-absent" /> Absent ({absent})
              </span>
              <span>
                <i className="is-upcoming" /> Upcoming ({upcoming})
              </span>
            </div>
          </>
        ) : (
          <p className="mp2-empty">No attendance check-ins this month.</p>
        )}
      </div>
    </section>
  );
}

function PersonalProfileTab({
  people,
  performance,
  loginEmail,
  collector,
  onReload,
}: {
  people: PeopleHrmsDashboard | null;
  performance: StaffPerformanceHub | null;
  loginEmail: string;
  collector?: boolean;
  onReload: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [idOpen, setIdOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const emp = people?.employee;
  const email = emp?.email || loginEmail;
  const fields: IdFields = {
    name: emp?.name || '',
    empId: emp?.id || '',
    designation: emp?.designation || '',
    department: emp?.department || '',
    wing: emp?.wing || '',
    division: emp?.division || '',
    position: emp?.designation || '',
    dateOfJoining: emp?.date_of_joining || '',
    managerName: emp?.reports_to_name || '',
    photoUrl: profilePhotoUrl(emp),
  };
  const activities = useMemo(
    () => buildActivities(people?.leave_applications || [], people?.expense_claims || []),
    [people],
  );
  const todayDay = new Date().getDate();
  const pulse = useMemo(
    () => buildPulse(people?.attendance?.series || [], todayDay),
    [people, todayDay],
  );
  const present = pulse.filter((d) => d.kind === 'present').length;
  const absent = pulse.filter((d) => d.kind === 'absent').length;
  const upcoming = pulse.filter((d) => d.kind === 'upcoming').length;

  return (
    <>
      <div className="mp2-grid">
        <div className="mp2-col">
          <ProfileInformationCard
            emp={emp}
            loginEmail={loginEmail}
            onEdit={() => setEditOpen(true)}
            onReload={onReload}
          />
          <SecurityCard email={email} onChangePassword={() => setPwdOpen(true)} />
          <IdCardBlock
            fields={fields}
            onView={() => setIdOpen(true)}
            onDownload={() => downloadEmployeeIdCard(fields)}
          />
          <RecentActivitiesCard items={activities} />
        </div>
        <div className="mp2-col">
          <QuickActions collector={collector} />
          <LeaveBalanceCard rows={people?.leave_balances} />
          <UpcomingTrainingCard events={performance?.training_events || []} />
          <AttendancePulseCard pulse={pulse} present={present} absent={absent} upcoming={upcoming} />
        </div>
      </div>
      {editOpen ? <EditProfileModal emp={emp} onClose={() => setEditOpen(false)} /> : null}
      {idOpen ? (
        <IdCardModal
          fields={fields}
          onClose={() => setIdOpen(false)}
          onDownload={() => downloadEmployeeIdCard(fields)}
        />
      ) : null}
      {pwdOpen ? <ChangePasswordModal email={email} onClose={() => setPwdOpen(false)} /> : null}
    </>
  );
}

function HrmsTabPanel({ section }: { section: HrmsSection }) {
  if (section === 'attendance') return <PeopleAttendancePage />;
  if (section === 'leave') return <PeopleLeaveSelfService />;
  if (section === 'expenses') return <PeopleExpensesPage />;
  if (section === 'payslips') return <PeoplePayslipsSelf />;
  if (section === 'info') return <PeopleProfilePage />;
  return <PeopleHomePage />;
}

export function MyProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const [search] = useSearchParams();
  const tab = parseProfileTab(tabParam || search.get('tab'));
  const section = parseHrmsSection(search.get('section'));
  const [people, setPeople] = useState<PeopleHrmsDashboard | null>(null);
  const [performance, setPerformance] = useState<StaffPerformanceHub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [dash, hub] = await Promise.all([
          api.getPeopleHrmsDashboard().catch(() => null),
          isHrStaff(user?.roles)
            ? api.getStaffPerformanceHub().catch(() => null)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setPeople(dash?.data || null);
        setPerformance(hub?.data || null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.roles]);

  useEffect(() => {
    if (tabParam && !['profile', 'hr', 'hrms', 'training'].includes(tabParam)) {
      navigate('/dashboard/profile', { replace: true });
    }
  }, [navigate, tabParam]);

  const collector = isPhlebotomist(user?.roles);
  const displayName = people?.employee?.name || user?.fullName || user?.user || (collector ? 'Collector' : 'Lab Technician');
  const photoUrl = profilePhotoUrl(people?.employee);
  const appraisalView = search.get('view') === 'appraisal';

  const reload = () => {
    void (async () => {
      try {
        const [dash, hub] = await Promise.all([
          api.getPeopleHrmsDashboard().catch(() => null),
          isHrStaff(user?.roles) ? api.getStaffPerformanceHub().catch(() => null) : Promise.resolve(null),
        ]);
        setPeople(dash?.data || null);
        setPerformance(hub?.data || null);
      } catch {
        /* keep current */
      }
    })();
  };

  if (tab === 'training' && collector && !appraisalView) {
    return <PhlebotomistTrainingPage />;
  }

  return (
    <div className={`${collector ? 'cp-page cmp-page' : 'lt-page'} mp2-page`}>
      <ProfileHero name={displayName} photoUrl={photoUrl} collector={collector} />
      <ProfileTabs tab={tab} collector={collector} />
      {error ? <p className="error">{error}</p> : null}
      {tab === 'profile' ? (
        loading && !people ? (
          <p className="muted">Loading profile…</p>
        ) : (
          <PersonalProfileTab
            people={people}
            performance={performance}
            loginEmail={user?.user || ''}
            collector={collector}
            onReload={reload}
          />
        )
      ) : null}
      {tab === 'hr' ? (
        <div className="mp2-embed">
          <HrSelfServicePage />
        </div>
      ) : null}
      {tab === 'hrms' ? (
        <div className="mp2-embed">
          <HrmsSubnav section={section} />
          <HrmsTabPanel section={section} />
        </div>
      ) : null}
      {tab === 'training' ? (
        <div className="mp2-embed">
          <StaffPerformancePage />
        </div>
      ) : null}
    </div>
  );
}

export function LabTechToMyProfile({
  tab = 'profile',
  children,
}: {
  tab?: ProfileTab;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!isLabTechProfileUser(user?.roles)) return <>{children}</>;
  if (pathname === '/people/training' || pathname === '/people/performance') {
    return <Navigate to={labTechProfilePath('training')} replace />;
  }
  const section = tab === 'hrms' ? peoplePathToHrmsSection(pathname) : undefined;
  return <Navigate to={labTechProfilePath(tab, section)} replace />;
}
