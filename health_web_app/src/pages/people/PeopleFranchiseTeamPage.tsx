import { useEffect, useState } from 'react';
import { api } from '../../api';
import './people-hrms-shell.css';

type TeamAttendance = {
  employee: string;
  employee_name?: string;
  designation?: string;
  checkins_today?: number;
  today_status?: string;
  last_log_type?: string | null;
  last_time?: string | null;
};

type TeamLeave = {
  name: string;
  employee: string;
  employee_name?: string;
  leave_type?: string;
  from_date?: string;
  to_date?: string;
  status?: string;
  days?: number;
};

export function PeopleFranchiseTeamPage() {
  const [attendance, setAttendance] = useState<TeamAttendance[]>([]);
  const [leaves, setLeaves] = useState<TeamLeave[]>([]);
  const [franchisee, setFranchisee] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [att, leave] = await Promise.all([
          api.getFranchiseTeamAttendance(),
          api.getFranchiseTeamLeave(),
        ]);
        if (!active) return;
        setFranchisee(att.data.franchisee || leave.data.franchisee || null);
        setAttendance(att.data.employees || []);
        setLeaves(leave.data.leaves || []);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load centre team');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="hrms-list-page">
      <h1>My centre team</h1>
      <p className="muted">
        Franchise partners can view leave and attendance for attached staff only
        {franchisee ? ` · hub ${franchisee}` : ''}. Full HRMS stays with Company HR.
      </p>
      {loading ? <p className="muted">Loading…</p> : null}
      {error ? <div className="people-alert err">{error}</div> : null}

      {!loading && !error ? (
        <>
          <section className="hrms-panel" style={{ marginBottom: 14 }}>
            <header>
              <div>
                <h2>Attendance today</h2>
                <p>{attendance.length} staff</p>
              </div>
            </header>
            <div className="hrms-table-wrap">
              <table className="hrms-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Designation</th>
                    <th>Status</th>
                    <th>Last punch</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((row) => (
                    <tr key={row.employee}>
                      <td>
                        <b>{row.employee_name || row.employee}</b>
                      </td>
                      <td>{row.designation || '—'}</td>
                      <td>
                        <span className="hrms-tag ok">{row.today_status || '—'}</span>
                      </td>
                      <td>
                        {row.last_log_type ? `${row.last_log_type} ${row.last_time || ''}` : '—'}
                      </td>
                    </tr>
                  ))}
                  {!attendance.length ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No employees linked to your franchise hub yet. Ask HR to set Employee → Franchisee Hub.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="hrms-panel">
            <header>
              <div>
                <h2>Leave applications</h2>
                <p>Recent leave for your centre staff</p>
              </div>
            </header>
            <div className="hrms-table-wrap">
              <table className="hrms-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Type</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Status</th>
                    <th>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((row) => (
                    <tr key={row.name}>
                      <td>{row.employee_name || row.employee}</td>
                      <td>{row.leave_type || '—'}</td>
                      <td>{row.from_date || '—'}</td>
                      <td>{row.to_date || '—'}</td>
                      <td>
                        <span className="hrms-tag">{row.status || '—'}</span>
                      </td>
                      <td>{row.days ?? '—'}</td>
                    </tr>
                  ))}
                  {!leaves.length ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        No leave applications for attached staff.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
