import { FormEvent, useEffect, useState } from 'react';
import './people-hrms-shell.css';
import './people-org.css';

type OrgRow = {
  name: string;
  kind: string;
  title: string;
  wing?: string;
  division?: string;
  department?: string;
  area?: string;
  erp_name?: string;
  active?: number;
};

type OrgEmployee = {
  id: string;
  name: string;
  wing?: string;
  division?: string;
  department?: string;
  designation?: string;
  unit?: string;
  reports_to?: string;
  reports_to_name?: string;
};

type OrgData = {
  can_edit?: boolean;
  masters?: OrgRow[];
  employees?: OrgEmployee[];
};

const METHOD = '/api/method/health_ecosystem_core.health_ecosystem_core.clinical_people_org.';

function sidBody(extra: Record<string, string>) {
  const body = new URLSearchParams(extra);
  try {
    const session = JSON.parse(localStorage.getItem('hec_web_session') || 'null') as { sid?: string } | null;
    if (session?.sid) body.set('sid', session.sid);
  } catch {
    /* session is added when the browser has one */
  }
  return body;
}

async function post<T>(method: string, extra: Record<string, string> = {}) {
  const response = await fetch(`${METHOD}${method}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Frappe-Site-Name': 'health.localhost',
    },
    body: sidBody(extra),
  });
  const json = (await response.json()) as { message?: { status?: string; message?: string; data?: T } };
  const nested = json.message;
  if (nested?.status === 'error') throw new Error(nested.message || 'Request failed');
  return (nested?.data || nested) as T;
}

export function PeopleOrgPage() {
  const [data, setData] = useState<OrgData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'Structure' | 'Employees'>('Structure');

  const load = async () => {
    const next = await post<OrgData>('get_people_org');
    setData(next);
  };

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message));
  }, []);

  const masters = (kind: string) => (data?.masters || []).filter((row) => row.kind === kind);

  const onSaveMaster = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, string> = {};
    form.forEach((value, key) => {
      payload[key] = String(value);
    });
    await post('save_people_org_master', payload);
    setNotice('Master saved. It is now available across HRMS.');
    await load();
  };

  return (
    <section className="org-page" data-org-react="1">
      <h1>WDD</h1>
      <p className="org-lead">Wing → Division → Department → Designation → Unit/Centre</p>
      {error ? <p className="org-error">{error}</p> : null}
      {notice ? <p className="org-note">{notice}</p> : null}
      <div className="org-tabs">
        <button type="button" className={tab === 'Structure' ? 'on' : ''} onClick={() => setTab('Structure')}>Structure</button>
        <button type="button" className={tab === 'Employees' ? 'on' : ''} onClick={() => setTab('Employees')}>Employees</button>
      </div>
      {tab === 'Structure' ? (
        <>
          <div className="org-grid">
            {['Wing', 'Division', 'Department', 'Designation', 'Unit'].map((kind) => (
              <article className="org-card" key={kind}>
                <h2>{kind === 'Unit' ? 'Units / Centres' : `${kind}s`}</h2>
                <ul>
                  {masters(kind).map((row) => (
                    <li key={row.name} className={row.active ? '' : 'off'}>
                      <span>
                        <b>{row.title}</b>
                        {row.wing || row.department ? <><br /><small>{[row.wing, row.department].filter(Boolean).join(' · ')}</small></> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          {data?.can_edit ? (
            <form className="org-form" onSubmit={(event) => void onSaveMaster(event).catch((err: Error) => setError(err.message))}>
              <h2>Add a master</h2>
              <label>Type
                <select name="kind"><option>Wing</option><option>Division</option><option>Department</option><option>Designation</option><option>Unit</option></select>
              </label>
              <label>Name<input name="title" required /></label>
              <label>Wing
                <select name="wing">
                  <option value="">Corporate / no wing</option>
                  {masters('Wing').filter((row) => row.title !== 'Corporate / Back Office').map((row) => <option key={row.name}>{row.title}</option>)}
                </select>
              </label>
              <label>Department
                <select name="department">
                  <option value="">Not linked</option>
                  {masters('Department').map((row) => <option key={row.name} value={row.erp_name || row.title}>{row.wing ? `${row.wing} — ` : ''}{row.title}</option>)}
                </select>
              </label>
              <button className="org-save" type="submit">Save master</button>
            </form>
          ) : null}
        </>
      ) : (
        <div className="org-table-wrap">
          <table className="org-table">
            <thead><tr><th>Employee</th><th>Organization</th></tr></thead>
            <tbody>
              {(data?.employees || []).map((row) => (
                <tr key={row.id}>
                  <td><b>{row.name}</b><br /><small>{row.id}</small></td>
                  <td>{[row.wing || 'Corporate', row.division, row.department, row.designation, row.unit, row.reports_to_name].filter(Boolean).join(' · ') || 'Not assigned'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
