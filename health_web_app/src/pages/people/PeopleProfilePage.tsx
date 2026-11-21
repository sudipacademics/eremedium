import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type PeopleDocument,
  type PeopleHrmsDashboard,
  type PeopleTrainingAssignment,
} from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { assetUrl } from '../../config';
import { downloadEmployeeIdCard, EmployeeIdCard, profilePhotoUrl } from '../../components/EmployeeIdCard';
import { HrmsIcon } from '../../components/HrmsIcons';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-attendance.css';
import './people-leave.css';
import './people-profile.css';
import './people-profile-align.css';

type Tab = 'profile' | 'hr' | 'training' | 'settings';
type Emp = PeopleHrmsDashboard['employee'];

export type PeopleProfileActivity = { when: string; activity: string; detail: string };
export type PeopleProfileTraining = { id: string; title: string; when: string; registered: boolean };

export type PeopleProfilePreview = {
  dash: PeopleHrmsDashboard;
  activities: PeopleProfileActivity[];
  trainings: PeopleProfileTraining[];
  experience_years: number;
  login_email: string;
  documents?: PeopleDocument[];
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'profile', label: 'Personal Profile' },
  { id: 'hr', label: 'HR Self Service' },
  { id: 'training', label: 'Training & Appraisal' },
  { id: 'settings', label: 'Settings' },
];

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

function orDash(value?: string | null) {
  const text = String(value || '').trim();
  return text || '—';
}

function initials(name?: string | null) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'ME';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtWhen(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function yearsExp(iso?: string | null) {
  if (!iso) return 0;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 0;
  const years = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.max(0, Math.round(years * 10) / 10);
}

function photoSrc(emp?: Emp) {
  const raw = profilePhotoUrl(emp);
  return raw ? assetUrl(raw) : '';
}

function money(value?: number | null) {
  if (value == null) return '—';
  return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read photo'));
    reader.readAsDataURL(file);
  });
}

function readGps(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not available in this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => {
        const msg = err && err.message ? String(err.message) : '';
        if (/permissions policy/i.test(msg)) {
          reject(
            new Error(
              'Location is blocked in this view. Open Attendance on people.e-remedium.in (not inside another portal iframe), allow location when prompted, then try again.',
            ),
          );
          return;
        }
        reject(new Error(msg || 'Unable to read GPS location'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  });
}

function FieldGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="me-fields">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PeopleProfilePage({ preview }: { preview?: PeopleProfilePreview }) {
  const { user } = useAuth();
  const [dash, setDash] = useState<PeopleHrmsDashboard | null>(preview?.dash || null);
  const [trainings, setTrainings] = useState<PeopleProfileTraining[]>(preview?.trainings || []);
  const [docs, setDocs] = useState<PeopleDocument[]>(preview?.documents || []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [tab, setTab] = useState<Tab>('profile');
  const [editOpen, setEditOpen] = useState(false);
  const [idOpen, setIdOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (preview) {
      setDash(preview.dash);
      setTrainings(preview.trainings);
      setDocs(preview.documents || []);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [d, t] = await Promise.all([
        api.getPeopleHrmsDashboard(),
        api.getPeopleTraining().catch(() => null),
      ]);
      setDash(d.data);
      const empId = d.data.employee?.id;
      const mine = ((t?.data?.assignments || []) as PeopleTrainingAssignment[]).filter((a) => a.employee === empId);
      setTrainings(
        mine.slice(0, 6).map((a) => ({
          id: a.id,
          title: a.material_title || a.material,
          when: a.assigned_on || a.completed_on || '',
          registered: a.status !== 'Pending',
        })),
      );
      if (d.data.is_manager && empId) {
        const board = await api.getPeopleDocuments().catch(() => null);
        const rows = (board?.data?.documents || []).filter(
          (doc) => doc.employee === empId && String(doc.status || '') !== 'Deleted',
        );
        setDocs(rows.slice(0, 8));
      } else {
        setDocs([]);
      }
    } catch (e) {
      setError(errMsg(e, 'Unable to load profile'));
    } finally {
      setLoading(false);
    }
  }, [preview]);

  useEffect(() => {
    void load();
  }, [load]);

  const emp = dash?.employee;
  const isManager = Boolean(dash?.is_manager);
  const loginEmail = preview?.login_email || emp?.email || user?.user || '';
  const photo = photoSrc(emp);
  const exp = preview?.experience_years ?? yearsExp(emp?.date_of_joining);
  const activities = useMemo(() => {
    if (preview?.activities) return preview.activities;
    const rows: PeopleProfileActivity[] = [];
    const last = dash?.attendance?.last_checkin;
    if (last?.time) rows.push({ when: last.time, activity: 'Login', detail: `${last.log_type || 'IN'} · ${last.name}` });
    for (const lv of dash?.leave_applications || []) {
      rows.push({
        when: lv.modified || lv.creation || lv.from_date,
        activity: 'Leave request',
        detail: `${lv.leave_type} · ${lv.status || 'Open'}`,
      });
    }
    for (const ex of dash?.expense_claims || []) {
      rows.push({
        when: ex.modified || ex.creation || ex.posting_date || '',
        activity: 'Expense claim',
        detail: ex.remark || ex.approval_status || ex.name,
      });
    }
    return rows.sort((a, b) => String(b.when).localeCompare(String(a.when))).slice(0, 8);
  }, [preview, dash]);

  const fields = {
    name: emp?.name || '',
    empId: emp?.id || '',
    designation: emp?.designation || '',
    department: emp?.department || '',
    wing: emp?.wing || '',
    division: emp?.division || '',
    position: emp?.designation || '',
    dateOfJoining: emp?.date_of_joining || '',
    managerName: emp?.reports_to_name || '',
    photoUrl: photo,
    bloodGroup: emp?.blood_group || (preview ? 'O+' : ''),
  };

  if (loading) return <p className="lv-muted">Loading profile…</p>;
  if (error) return <div className="people-alert err">{error}</div>;
  if (!dash || !emp) return <div className="people-alert err">No employee record is linked to this login.</div>;

  return (
    <div className="hrms-list-page emp-page dep-page lv-page me-page">
      <section className="me-hero">
        <div className="me-hero-id">
          <div className="me-hero-avatar">{photo ? <img src={photo} alt="" /> : initials(emp.name)}</div>
          <div>
            <p className="me-hero-kicker">My Profile</p>
            <h1>{emp.name}</h1>
            <div className="me-hero-meta">
              <span>{emp.id || 'Unlinked'}</span>
              <span className="emp-pill green">{emp.status || 'Active'}</span>
            </div>
          </div>
        </div>
        <div className="me-hero-metrics">
          <div className="me-hero-metric">
            <HrmsIcon name="briefcase" size={18} />
            <div>
              <small>Total Experience</small>
              <b>{exp ? `${exp} Years` : '—'}</b>
            </div>
          </div>
          <div className="me-hero-metric">
            <HrmsIcon name="calendar" size={18} />
            <div>
              <small>Date of Joining</small>
              <b>{fmtDate(emp.date_of_joining)}</b>
            </div>
          </div>
          <div className="me-hero-metric">
            <HrmsIcon name="building" size={18} />
            <div>
              <small>Company</small>
              <b>{orDash(emp.company)}</b>
            </div>
          </div>
        </div>
        <div className="me-hero-actions">
          <button type="button" className="emp-btn" onClick={() => setEditOpen(true)}>
            <HrmsIcon name="pencil" size={15} />
            Edit profile
          </button>
        </div>
      </section>

      {notice ? (
        <div className="dsg-selbar">
          <span className="emp-notice">{notice}</span>
        </div>
      ) : null}

      <div className="me-tabs" role="tablist" aria-label="Profile sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' ? (
        <>
          <div className="me-grid">
            <div className="me-col">
              <ProfileInfo
                emp={emp}
                loginEmail={loginEmail}
                photo={photo}
                preview={Boolean(preview)}
                onReload={() => void load()}
                onNotice={setNotice}
              />
              <SecurityCard email={loginEmail} onChangePassword={() => setPwdOpen(true)} />
              <section className="emp-card me-card">
                <div className="me-card-head">
                  <div>
                    <h2>Recent Activity</h2>
                  </div>
                  <button type="button" className="me-link" onClick={() => setTab('settings')}>
                    View all
                  </button>
                </div>
                <table className="me-table">
                  <thead>
                    <tr>
                      <th>Date & Time</th>
                      <th>Activity</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map((a, i) => (
                      <tr key={`${a.when}-${i}`}>
                        <td>{fmtWhen(a.when)}</td>
                        <td>{a.activity}</td>
                        <td>{a.detail}</td>
                      </tr>
                    ))}
                    {!activities.length ? (
                      <tr>
                        <td className="emp-empty" colSpan={3}>
                          No recent activity on this account.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </section>
            </div>

            <div className="me-col me-col-id">
              <section className="emp-card me-id-card">
                <EmployeeIdCard fields={fields} />
                <div className="me-id-actions">
                  <button type="button" className="emp-btn" onClick={() => setIdOpen(true)}>
                    View ID Card
                  </button>
                  <button type="button" className="emp-btn primary" onClick={() => downloadEmployeeIdCard(fields)}>
                    Download ID Card
                  </button>
                </div>
              </section>
            </div>

            <div className="me-col">
              <section className="emp-card me-card">
                <div className="me-card-head">
                  <h2>Quick Actions</h2>
                </div>
                <div className="me-actions">
                  {isManager ? (
                    <button type="button" className="me-action" onClick={() => setTab('hr')}>
                      <span className="me-action-icon violet">
                        <HrmsIcon name="clock" size={16} />
                      </span>
                      <b>View Attendance</b>
                      <small>Check-in / check-out history</small>
                    </button>
                  ) : (
                    <Link className="me-action" to="/people/attendance">
                      <span className="me-action-icon violet">
                        <HrmsIcon name="clock" size={16} />
                      </span>
                      <b>View Attendance</b>
                      <small>Check-in / check-out history</small>
                    </Link>
                  )}
                  {isManager ? (
                    <button type="button" className="me-action" onClick={() => setTab('hr')}>
                      <span className="me-action-icon green">
                        <HrmsIcon name="calendar" size={16} />
                      </span>
                      <b>Apply Leave</b>
                      <small>Submit leave request</small>
                    </button>
                  ) : (
                    <Link className="me-action" to="/people/leave">
                      <span className="me-action-icon green">
                        <HrmsIcon name="calendar" size={16} />
                      </span>
                      <b>Apply Leave</b>
                      <small>Submit leave request</small>
                    </Link>
                  )}
                  {isManager ? (
                    <button type="button" className="me-action" onClick={() => setTab('hr')}>
                      <span className="me-action-icon blue">
                        <HrmsIcon name="wallet" size={16} />
                      </span>
                      <b>View Payslip</b>
                      <small>Download payslip</small>
                    </button>
                  ) : (
                    <Link className="me-action" to="/people/payslips">
                      <span className="me-action-icon blue">
                        <HrmsIcon name="wallet" size={16} />
                      </span>
                      <b>View Payslip</b>
                      <small>Download payslip</small>
                    </Link>
                  )}
                  <button type="button" className="me-action" onClick={() => setEditOpen(true)}>
                    <span className="me-action-icon rose">
                      <HrmsIcon name="user" size={16} />
                    </span>
                    <b>Update Profile</b>
                    <small>Edit personal information</small>
                  </button>
                </div>
              </section>
              <LeaveCard rows={dash.leave_balances} onOpen={isManager ? () => setTab('hr') : undefined} />
              <TrainingCard rows={trainings} />
            </div>
          </div>

          <div className="me-record-grid">
            <section className="emp-card me-card">
              <div className="me-card-head">
                <div>
                  <h2>Personal Information</h2>
                  <p>Identity details from your employee record.</p>
                </div>
              </div>
              <FieldGrid
                rows={[
                  ['Full Name', orDash(emp.name)],
                  ['Gender', orDash(emp.gender)],
                  ['Date of Birth', fmtDate(emp.date_of_birth)],
                  ['Blood Group', orDash(emp.blood_group)],
                  ['Marital Status', orDash(emp.marital_status)],
                  ['Employee ID', orDash(emp.id)],
                ]}
              />
            </section>
            <section className="emp-card me-card">
              <div className="me-card-head">
                <div>
                  <h2>Employment Details</h2>
                  <p>Official HR fields maintained in Desk.</p>
                </div>
              </div>
              <FieldGrid
                rows={[
                  ['Designation', orDash(emp.designation)],
                  ['Department', orDash(emp.department)],
                  ['Grade', orDash(emp.grade)],
                  ['Employment Type', orDash(emp.employment_type)],
                  ['Date of Joining', fmtDate(emp.date_of_joining)],
                  ['Reporting Manager', orDash(emp.reports_to_name)],
                  ['Work Location', orDash(emp.branch)],
                  ['Company', orDash(emp.company)],
                ]}
              />
            </section>
            <section className="emp-card me-card">
              <div className="me-card-head">
                <div>
                  <h2>Contact Information</h2>
                  <p>You can update phone and address from Edit profile.</p>
                </div>
                <button type="button" className="me-link" onClick={() => setEditOpen(true)}>
                  Edit
                </button>
              </div>
              <FieldGrid
                rows={[
                  ['Mobile Number', orDash(emp.phone)],
                  ['Work Email', orDash(emp.company_email || emp.email || loginEmail)],
                  ['Personal Email', orDash(emp.personal_email)],
                  ['Emergency Phone', orDash(emp.emergency_phone)],
                  ['Current Address', orDash(emp.current_address)],
                  ['Permanent Address', orDash(emp.permanent_address)],
                ]}
              />
            </section>
            <section className="emp-card me-card">
              <div className="me-card-head">
                <div>
                  <h2>Documents</h2>
                  <p>Letters and files linked to your employee ID.</p>
                </div>
                {isManager ? (
                  <Link className="me-link" to="/people/documents">
                    View all
                  </Link>
                ) : null}
              </div>
              {docs.length ? (
                <ul className="me-docs">
                  {docs.map((doc) => (
                    <li key={doc.id}>
                      <span className="me-train-icon">
                        <HrmsIcon name="file" size={16} />
                      </span>
                      <div>
                        <b>{doc.title}</b>
                        <small>
                          {doc.file_type || 'File'}
                          {doc.expiry_date ? ` · expires ${fmtDate(doc.expiry_date)}` : ''}
                        </small>
                      </div>
                      {doc.file_url ? (
                        <a className="me-link" href={assetUrl(doc.file_url)} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : (
                        <span className="emp-pill muted">{doc.status || 'On file'}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lv-muted">
                  {isManager
                    ? 'No personal documents are linked to this employee yet.'
                    : 'Ask HR for letters and policy copies from the documents vault.'}
                </p>
              )}
            </section>
            <section className="emp-card me-card me-span-2">
              <div className="me-card-head">
                <div>
                  <h2>Professional Information</h2>
                  <p>Role, tenure and identity numbers from ERPNext.</p>
                </div>
              </div>
              <FieldGrid
                rows={[
                  ['Total Experience', exp ? `${exp} Years` : '—'],
                  ['Holiday List', orDash(emp.holiday_list)],
                  ['Date of Retirement', fmtDate(emp.date_of_retirement)],
                  ['PAN', orDash(emp.pan_number)],
                  ['Passport', orDash(emp.passport_number)],
                  ['Status', orDash(emp.status)],
                ]}
              />
            </section>
          </div>
        </>
      ) : null}

      {tab === 'hr' ? (
        <HrSelfService
          dash={dash}
          isManager={isManager}
          preview={Boolean(preview)}
          onReload={() => void load()}
          onNotice={setNotice}
        />
      ) : null}

      {tab === 'training' ? (
        <section className="emp-card me-card">
          <div className="me-card-head">
            <h2>Upcoming Training</h2>
            <Link className="me-link" to="/people/training">
              View all
            </Link>
          </div>
          {trainings.length ? (
            trainings.map((t) => (
              <div className="me-train" key={t.id}>
                <span className="me-train-icon">
                  <HrmsIcon name="training" size={16} />
                </span>
                <div style={{ flex: 1 }}>
                  <b>{t.title}</b>
                  <small>{t.when ? fmtWhen(t.when) : 'Scheduled'}</small>
                </div>
                <span className={`emp-pill ${t.registered ? 'green' : 'rose'}`}>
                  {t.registered ? 'Registered' : 'Not Registered'}
                </span>
              </div>
            ))
          ) : (
            <p className="lv-muted">No upcoming training assigned.</p>
          )}
        </section>
      ) : null}

      {tab === 'settings' ? (
        <div className="me-hub">
          <SecurityCard email={loginEmail} onChangePassword={() => setPwdOpen(true)} />
          <section className="emp-card me-card">
            <h2>Official record</h2>
            <p className="lv-muted">
              Name, designation, department and company are maintained by HR in Desk. Contact details can be updated from
              this profile.
            </p>
            <button type="button" className="emp-btn" style={{ marginTop: 12 }} onClick={() => setEditOpen(true)}>
              Edit contact details
            </button>
          </section>
        </div>
      ) : null}

      {editOpen ? (
        <EditModal
          emp={emp}
          preview={Boolean(preview)}
          onClose={() => setEditOpen(false)}
          onSaved={(msg) => {
            setNotice(msg);
            void load();
          }}
        />
      ) : null}
      {idOpen ? (
        <div className="me-modal" role="dialog" aria-label="Employee ID card">
          <div className="me-modal-card">
            <h3>Employee ID Card</h3>
            <p>Generated from the live HRMS employee record.</p>
            <div className="me-id-preview">
              <EmployeeIdCard fields={fields} />
            </div>
            <div className="me-modal-actions">
              <button type="button" className="emp-btn" onClick={() => setIdOpen(false)}>
                Close
              </button>
              <button type="button" className="emp-btn primary" onClick={() => downloadEmployeeIdCard(fields)}>
                Download ID Card
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pwdOpen ? <PasswordModal email={loginEmail} preview={Boolean(preview)} onClose={() => setPwdOpen(false)} /> : null}
    </div>
  );
}

function ProfileInfo({
  emp,
  loginEmail,
  photo,
  preview,
  onReload,
  onNotice,
}: {
  emp: Emp;
  loginEmail: string;
  photo: string;
  preview: boolean;
  onReload: () => void;
  onNotice: (msg: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      onNotice('Photo must be 2 MB or less.');
      return;
    }
    if (preview) {
      onNotice('Photo upload is preview-only.');
      return;
    }
    setBusy(true);
    try {
      await api.updateMyEmployeePhoto({ file_name: file.name, file_data: await fileToBase64(file) });
      onNotice('Photo updated.');
      onReload();
    } catch (err) {
      onNotice(errMsg(err, 'Could not upload photo'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="emp-card me-card">
      <div className="me-card-head">
        <div>
          <h2>Profile Information</h2>
        </div>
      </div>
      <div className="me-profile-top">
        <div className="me-photo">
          <div className="me-photo-circle">{photo ? <img src={photo} alt="" /> : initials(emp.name)}</div>
          <button
            type="button"
            className="me-photo-btn"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            aria-label="Upload photo"
          >
            <HrmsIcon name="pencil" size={12} />
          </button>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void onPick(e)} />
          <p className="me-photo-hint">{busy ? 'Uploading…' : 'Upload Photo JPG, PNG up to 2 MB'}</p>
        </div>
        <dl className="me-fields">
          <div>
            <dt>Employee ID</dt>
            <dd>{orDash(emp.id)}</dd>
          </div>
          <div>
            <dt>Email ID</dt>
            <dd>{orDash(emp.email || loginEmail)}</dd>
          </div>
          <div>
            <dt>Full Name</dt>
            <dd>{orDash(emp.name)}</dd>
          </div>
          <div>
            <dt>Mobile Number</dt>
            <dd>{orDash(emp.phone)}</dd>
          </div>
          <div>
            <dt>Designation</dt>
            <dd>{orDash(emp.designation)}</dd>
          </div>
          <div>
            <dt>Work Location</dt>
            <dd>{orDash(emp.branch)}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{orDash(emp.department)}</dd>
          </div>
          <div>
            <dt>Company</dt>
            <dd>{orDash(emp.company)}</dd>
          </div>
          <div>
            <dt>Date of Joining</dt>
            <dd>{fmtDate(emp.date_of_joining)}</dd>
          </div>
          <div>
            <dt>Reporting Manager</dt>
            <dd>{orDash(emp.reports_to_name)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function SecurityCard({ email, onChangePassword }: { email: string; onChangePassword: () => void }) {
  return (
    <section className="emp-card me-card">
      <div className="me-card-head">
        <div>
          <h2>Security</h2>
          <p>Manage your login credentials and account security.</p>
        </div>
      </div>
      <div className="me-secure">
        <div className="me-secure-row">
          <div>
            <dt>Email ID</dt>
            <dd>{orDash(email)}</dd>
          </div>
          <span className="me-pill-ok">Verified</span>
        </div>
        <div className="me-secure-row">
          <div>
            <dt>Password</dt>
            <dd>••••••••••••</dd>
          </div>
          <button type="button" className="me-link" onClick={onChangePassword}>
            Change password
          </button>
        </div>
        <div className="me-secure-row">
          <div>
            <dt>Two-factor authentication</dt>
            <dd>
              <span className="me-pill-ok">Enabled</span>
            </dd>
          </div>
          <span className="me-link" title="Two-factor authentication is managed in Desk">
            Manage
          </span>
        </div>
      </div>
    </section>
  );
}

function LeaveCard({
  rows,
  onOpen,
}: {
  rows: PeopleHrmsDashboard['leave_balances'];
  onOpen?: () => void;
}) {
  const list = rows || [];
  return (
    <section className="emp-card me-card">
      <div className="me-card-head">
        <h2>Leave Balance</h2>
        {onOpen ? (
          <button type="button" className="me-link" onClick={onOpen}>
            View all
          </button>
        ) : (
          <Link className="me-link" to="/people/leave">
            View all
          </Link>
        )}
      </div>
      {list.length ? (
        <>
          <div className="me-leave-row me-leave-head">
            <span>Leave type</span>
            <span>Taken</span>
            <span>Balance</span>
          </div>
          {list.slice(0, 4).map((r) => (
            <div className="me-leave-row" key={r.leave_type}>
              <span>{r.leave_type}</span>
              <span>{r.taken}</span>
              <span>{r.balance}</span>
            </div>
          ))}
        </>
      ) : (
        <p className="lv-muted">No leave allocations yet.</p>
      )}
    </section>
  );
}

function TrainingCard({ rows }: { rows: PeopleProfileTraining[] }) {
  return (
    <section className="emp-card me-card">
      <div className="me-card-head">
        <h2>Upcoming Training</h2>
        <Link className="me-link" to="/people/training">
          View all
        </Link>
      </div>
      {rows.length ? (
        rows.slice(0, 3).map((t) => (
          <div className="me-train" key={t.id}>
            <span className="me-train-icon">
              <HrmsIcon name="training" size={16} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{t.title}</b>
              <small>{t.when ? fmtWhen(t.when) : 'Scheduled'}</small>
            </div>
            <span className={`emp-pill ${t.registered ? 'green' : 'rose'}`}>
              {t.registered ? 'Registered' : 'Not Registered'}
            </span>
          </div>
        ))
      ) : (
        <p className="lv-muted">No upcoming sessions.</p>
      )}
    </section>
  );
}

function HrSelfService({
  dash,
  isManager,
  preview,
  onReload,
  onNotice,
}: {
  dash: PeopleHrmsDashboard;
  isManager: boolean;
  preview: boolean;
  onReload: () => void;
  onNotice: (msg: string) => void;
}) {
  const att = dash.attendance;
  const [busy, setBusy] = useState(false);
  const [leaveType, setLeaveType] = useState(dash.leave_types?.[0]?.name || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reason, setReason] = useState('');
  const [leaveBusy, setLeaveBusy] = useState(false);

  async function punch(logType: 'IN' | 'OUT') {
    if (preview) {
      onNotice('Check-in is preview-only.');
      return;
    }
    setBusy(true);
    try {
      const loc = await readGps();
      const res = await api.submitEmployeeCheckin(logType, loc);
      onNotice(res.message || `${logType} recorded`);
      onReload();
    } catch (err) {
      onNotice(errMsg(err, 'Could not record attendance'));
    } finally {
      setBusy(false);
    }
  }

  async function applyLeave(e: FormEvent) {
    e.preventDefault();
    if (preview) {
      onNotice('Leave apply is preview-only.');
      return;
    }
    setLeaveBusy(true);
    try {
      const res = await api.submitLeaveApplication({
        leave_type: leaveType,
        from_date: fromDate,
        to_date: toDate,
        description: reason,
      });
      onNotice(res.message || 'Leave submitted');
      setFromDate('');
      setToDate('');
      setReason('');
      onReload();
    } catch (err) {
      onNotice(errMsg(err, 'Could not submit leave'));
    } finally {
      setLeaveBusy(false);
    }
  }

  return (
    <div className="me-hr">
      {isManager ? (
        <p className="me-hr-note">
          These are <b>your</b> staff records. Team attendance, leave, and payroll stay in Workforce.
        </p>
      ) : null}

      <section className="emp-card me-card">
        <div className="me-card-head">
          <div>
            <h2>My daily attendance</h2>
            <p>
              Today: {att.today_status || '—'}
              {att.last_checkin ? ` · last ${att.last_checkin.log_type} at ${fmtWhen(att.last_checkin.time)}` : ''}
            </p>
          </div>
        </div>
        {!att.checkin_available ? (
          <div className="people-alert err">Employee Checkin is not available on this site yet.</div>
        ) : (
          <div className="me-punch">
            <button type="button" className="emp-btn primary" disabled={busy} onClick={() => void punch('IN')}>
              Check in
            </button>
            <button type="button" className="emp-btn outline" disabled={busy} onClick={() => void punch('OUT')}>
              Check out
            </button>
          </div>
        )}
        <div className="me-kpi-row">
          <article>
            <small>Present days MTD</small>
            <b>{att.present_days}</b>
          </article>
          <article>
            <small>Check-ins MTD</small>
            <b>{att.checkins_mtd}</b>
          </article>
          <article>
            <small>Present %</small>
            <b>{dash.kpis.present_pct}%</b>
          </article>
        </div>
      </section>

      <div className="me-hub">
        <section className="emp-card me-card">
          <div className="me-card-head">
            <div>
              <h2>Apply leave</h2>
              <p>{dash.kpis.leave_balance} days available</p>
            </div>
          </div>
          <form className="me-mini-form" onSubmit={(e) => void applyLeave(e)}>
            <label>
              Leave type
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
                {(dash.leave_types || []).map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.leave_type_name || t.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="me-mini-row">
              <label>
                From
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} required />
              </label>
              <label>
                To
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} required />
              </label>
            </div>
            <label>
              Reason
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
            </label>
            <button type="submit" className="emp-btn primary" disabled={leaveBusy || !leaveType}>
              {leaveBusy ? 'Submitting…' : 'Submit request'}
            </button>
          </form>
          {(dash.leave_applications || []).slice(0, 3).map((lv) => (
            <div className="me-train" key={lv.name}>
              <span className="me-train-icon">
                <HrmsIcon name="calendar" size={16} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{lv.leave_type}</b>
                <small>
                  {fmtDate(lv.from_date)} – {fmtDate(lv.to_date)}
                </small>
              </div>
              <span className="emp-pill muted">{lv.status || 'Open'}</span>
            </div>
          ))}
        </section>

        <section className="emp-card me-card">
          <div className="me-card-head">
            <div>
              <h2>My payslips</h2>
              <p>{dash.kpis.payslips_count} slips on file</p>
            </div>
          </div>
          {(dash.payslips || []).length ? (
            <table className="me-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Net</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(dash.payslips || []).slice(0, 6).map((row) => (
                  <tr key={row.name}>
                    <td>
                      {fmtDate(row.start_date)} – {fmtDate(row.end_date)}
                    </td>
                    <td>{money(row.net_pay)}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="lv-muted">No salary slips yet.</p>
          )}
        </section>
      </div>

      <section className="emp-card me-card">
        <div className="me-card-head">
          <div>
            <h2>Expenses</h2>
            <p>
              {dash.expenses.pending} pending · claimed {money(dash.expenses.claimed)} this month
            </p>
          </div>
          <Link className="me-link" to="/people/expenses">
            Open expenses
          </Link>
        </div>
        {(dash.expense_claims || []).length ? (
          <table className="me-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Details</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(dash.expense_claims || []).slice(0, 5).map((ex) => (
                <tr key={ex.name}>
                  <td>{fmtDate(ex.posting_date)}</td>
                  <td>{ex.remark || ex.name}</td>
                  <td>{ex.approval_status || 'Open'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="lv-muted">No expense claims on this account.</p>
        )}
      </section>
    </div>
  );
}

function EditModal({
  emp,
  preview,
  onClose,
  onSaved,
}: {
  emp: Emp;
  preview: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [phone, setPhone] = useState(emp.phone || '');
  const [personalEmail, setPersonalEmail] = useState(emp.personal_email || '');
  const [emergency, setEmergency] = useState(emp.emergency_phone || '');
  const [blood, setBlood] = useState(emp.blood_group || '');
  const [currentAddress, setCurrentAddress] = useState(emp.current_address || '');
  const [permanentAddress, setPermanentAddress] = useState(emp.permanent_address || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (preview) {
      onSaved('Contact details would be saved in live mode.');
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.updateMyEmployeeProfile({
        phone,
        personal_email: personalEmail,
        emergency_phone: emergency,
        blood_group: blood,
        current_address: currentAddress,
        permanent_address: permanentAddress,
      });
      onSaved('Contact details updated.');
      onClose();
    } catch (err) {
      setError(errMsg(err, 'Could not update profile'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="me-modal" role="dialog" aria-label="Edit profile">
      <form className="me-modal-card me-modal-wide" onSubmit={(e) => void onSubmit(e)}>
        <h3>Edit profile</h3>
        <p>Update your contact details. Name, designation and department stay with HR in Desk.</p>
        {error ? <div className="people-alert err">{error}</div> : null}
        <div className="me-mini-form">
          <div className="me-mini-row">
            <label>
              Mobile number
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label>
              Emergency phone
              <input value={emergency} onChange={(e) => setEmergency(e.target.value)} />
            </label>
          </div>
          <div className="me-mini-row">
            <label>
              Personal email
              <input type="email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} />
            </label>
            <label>
              Blood group
              <input value={blood} onChange={(e) => setBlood(e.target.value)} placeholder="O+" />
            </label>
          </div>
          <label>
            Current address
            <textarea rows={2} value={currentAddress} onChange={(e) => setCurrentAddress(e.target.value)} />
          </label>
          <label>
            Permanent address
            <textarea rows={2} value={permanentAddress} onChange={(e) => setPermanentAddress(e.target.value)} />
          </label>
        </div>
        <dl className="me-fields" style={{ marginTop: 12 }}>
          <div>
            <dt>Full name</dt>
            <dd>{orDash(emp.name)}</dd>
          </div>
          <div>
            <dt>Employee ID</dt>
            <dd>{orDash(emp.id)}</dd>
          </div>
          <div>
            <dt>Designation</dt>
            <dd>{orDash(emp.designation)}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{orDash(emp.department)}</dd>
          </div>
        </dl>
        <div className="me-modal-actions">
          <button type="button" className="emp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </form>
    </div>
  );
}

function PasswordModal({ email, preview, onClose }: { email: string; preview: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (preview) {
      setSuccess('Reset link would be sent in live mode.');
      return;
    }
    if (!email) {
      setError('No email is linked to this account.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.forgotPassword(email);
      setSuccess(res.message || 'If an account exists for this email, password reset instructions will be sent shortly.');
    } catch (err) {
      setError(errMsg(err, 'Could not send reset email'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="me-modal" role="dialog" aria-label="Change password">
      <form className="me-modal-card" onSubmit={(e) => void onSubmit(e)}>
        <h3>Change password</h3>
        <p>
          A reset link will be sent to <b>{email || '—'}</b>.
        </p>
        {error ? <div className="people-alert err">{error}</div> : null}
        {success ? <p className="emp-notice">{success}</p> : null}
        <div className="me-modal-actions">
          <button type="button" className="emp-btn" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="emp-btn primary" disabled={busy || !email}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </div>
      </form>
    </div>
  );
}
