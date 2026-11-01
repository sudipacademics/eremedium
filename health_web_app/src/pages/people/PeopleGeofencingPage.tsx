import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type PeopleGeofence, type PeopleGeofenceEmployee, type PeopleGeofencesBoard } from '../../api';
import { HrmsIcon } from '../../components/HrmsIcons';
import { Avatar, FilterDropdown, Pager, PER_PAGE_OPTIONS } from './peopleTableKit';
import { PeopleGeofenceMap } from './peopleGeofenceMap';
import { EmployeeGeofenceModal, GeofenceOverrideModal } from './employeeGeofenceModal';
import './people-portal.css';
import './people-hrms-shell.css';
import './people-employees.css';
import './people-departments.css';
import './people-designations.css';
import './people-attendance.css';
import './people-leave.css';
import './people-geofencing.css';

const EMPTY: Partial<PeopleGeofence> & { title: string } = {
  title: '',
  subtitle: '',
  address: '',
  latitude: 0,
  longitude: 0,
  radius_m: 100,
  status: 'Active',
  tone: 'blue',
  department: '',
};

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

const GEO_STATES = ['Enforced', 'Temporarily disabled', 'Incomplete', 'Off'];

function geoStateLabel(e: PeopleGeofenceEmployee) {
  const s = e.geofence_state || (e.geofence_enabled ? 'Enforced' : 'Off');
  return s === 'Override' ? 'Temporarily disabled' : s;
}

function geoStateTone(e: PeopleGeofenceEmployee) {
  switch (geoStateLabel(e)) {
    case 'Enforced':
      return 'green';
    case 'Temporarily disabled':
      return 'amber';
    case 'Incomplete':
      return 'rose';
    default:
      return 'slate';
  }
}

export function PeopleGeofencingPage({ preview }: { preview?: PeopleGeofencesBoard }) {
  const [isManager, setIsManager] = useState<boolean | null>(preview ? true : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    void (async () => {
      try {
        const res = await api.getPeopleHrmsDashboard();
        if (alive) setIsManager(Boolean(res.data.is_manager));
      } catch (err) {
        if (alive) setError(err instanceof Error && err.message ? err.message : 'Unable to load geofencing');
      }
    })();
    return () => {
      alive = false;
    };
  }, [preview]);

  if (error) return <div className="people-alert err">{error}</div>;
  if (isManager === null) return <p className="lv-muted">Loading geofencing…</p>;
  return <GeofenceDesk preview={preview} manager={Boolean(isManager)} />;
}

function GeofenceDesk({ preview, manager }: { preview?: PeopleGeofencesBoard; manager: boolean }) {
  const [board, setBoard] = useState<PeopleGeofencesBoard | null>(preview || null);
  const [tab, setTab] = useState<'locations' | 'assign'>('locations');
  const [formTab, setFormTab] = useState<'create' | 'edit'>('create');
  const [form, setForm] = useState(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [mapQ, setMapQ] = useState('');
  const [status, setStatus] = useState('');
  const [dept, setDept] = useState('');
  const [site, setSite] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[0]);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [assignSite, setAssignSite] = useState('');
  const [empQ, setEmpQ] = useState('');
  const [empState, setEmpState] = useState('');
  const [empPage, setEmpPage] = useState(1);
  const [empPerPage, setEmpPerPage] = useState(PER_PAGE_OPTIONS[0]);
  const [editEmp, setEditEmp] = useState<PeopleGeofenceEmployee | null>(null);
  const [ovrEmp, setOvrEmp] = useState<PeopleGeofenceEmployee | null>(null);

  const load = useCallback(async () => {
    if (preview) {
      setBoard(preview);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.getPeopleGeofences();
      setBoard(res.data);
    } catch (e) {
      setError(errMsg(e, 'Unable to load geofences'));
    } finally {
      setLoading(false);
    }
  }, [preview]);

  useEffect(() => {
    void load();
  }, [load]);

  const locs = board?.locations || [];
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return locs.filter((l) => {
      if (status && l.status !== status) return false;
      if (dept && l.department !== dept) return false;
      if (site && l.title !== site) return false;
      if (n && !`${l.title} ${l.subtitle} ${l.address}`.toLowerCase().includes(n)) return false;
      return true;
    });
  }, [locs, q, status, dept, site]);
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const rows = filtered.slice((page - 1) * perPage, page * perPage);
  const mapLocs = useMemo(() => {
    const n = mapQ.trim().toLowerCase();
    if (!n) return locs.filter((l) => l.latitude && l.longitude);
    return locs.filter((l) => `${l.title} ${l.address}`.toLowerCase().includes(n) && l.latitude && l.longitude);
  }, [locs, mapQ]);

  const emps = board?.employees || [];
  const empRows = useMemo(() => {
    const n = empQ.trim().toLowerCase();
    return emps.filter((e) => {
      if (dept && e.department !== dept) return false;
      if (site && e.geofence_label !== site) return false;
      if (empState && geoStateLabel(e) !== empState) return false;
      if (n && !`${e.id} ${e.name} ${e.department} ${e.geofence_label} ${e.geofence_address || ''}`.toLowerCase().includes(n)) return false;
      return true;
    });
  }, [emps, empQ, dept, site, empState]);
  const empPages = Math.max(1, Math.ceil(empRows.length / empPerPage));
  const empSlice = empRows.slice((empPage - 1) * empPerPage, empPage * empPerPage);
  const canEditEmp = manager && Boolean(preview || board?.can_edit_employee_geofence);

  async function reenable(e: PeopleGeofenceEmployee) {
    if (!canEditEmp) return;
    if (preview) {
      setNotice(`Geofencing re-enabled for ${e.name}`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.setEmployeeGeofenceOverride(e.id, false);
      setNotice(`Geofencing re-enabled for ${e.name}`);
      await load();
    } catch (err) {
      setError(errMsg(err, 'Unable to re-enable geofencing'));
    } finally {
      setBusy(false);
    }
  }

  function afterEmpSave(msg: string) {
    setEditEmp(null);
    setOvrEmp(null);
    setNotice(msg);
    void load();
  }

  const k = board?.kpis;
  const kpis = [
    { label: 'Total Geofences', value: k?.total ?? 0, icon: 'pin', tone: 'blue' },
    { label: 'Assigned Employees', value: k?.assigned ?? 0, icon: 'users', tone: 'green' },
    { label: 'Active Geofences', value: k?.active ?? 0, icon: 'wifi', tone: 'green' },
    { label: 'Inactive Geofences', value: k?.inactive ?? 0, icon: 'wifiOff', tone: 'rose' },
  ];
  const depts = board?.departments?.length ? board.departments : ['Operations', 'Sales', 'IT'];
  const sites = board?.sites?.length ? board.sites : locs.map((l) => l.title);

  function openCreate() {
    setForm({ ...EMPTY });
    setSelected(null);
    setFormTab('create');
  }
  function openLoc(loc: PeopleGeofence, mode: 'create' | 'edit') {
    setSelected(loc.id);
    setForm({
      id: loc.id,
      title: loc.title,
      subtitle: loc.subtitle,
      address: loc.address,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius_m: loc.radius_m,
      status: loc.status,
      tone: loc.tone,
      department: loc.department,
      site_type: loc.site_type,
    });
    setFormTab(mode);
    setAssignSite(loc.title);
  }

  async function save() {
    if (!manager) return;
    if (preview) {
      setNotice('Geofence saved');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.savePeopleGeofence({ ...form, title: form.title || 'Geofence' });
      setNotice('Geofence saved');
      setSelected(res.data.id);
      setFormTab('edit');
      await load();
    } catch (e) {
      setError(errMsg(e, 'Unable to save geofence'));
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    const assignTo = locs.find((l) => l.title === assignSite)?.id || assignSite;
    if (!manager || !assignTo || !picked.length) return;
    if (preview) {
      setNotice(`${picked.length} employees assigned`);
      setPicked([]);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.assignPeopleGeofence(assignTo, picked);
      setNotice('Employees assigned');
      setPicked([]);
      await load();
    } catch (e) {
      setError(errMsg(e, 'Unable to assign geofence'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hrms-list-page emp-page dep-page lv-page gf-page">
      <div className="dep-head">
        <div className="dep-title">
          <span className="dep-title-icon lv-title-icon">
            <HrmsIcon name="pin" size={28} />
          </span>
          <div>
            <h1>Employee Geofencing</h1>
            <p>Set work-site locations and assign geofencing to employees for attendance. Employees can mark attendance only within their allowed area.</p>
          </div>
        </div>
        {manager ? (
          <div className="dep-head-actions">
            <button type="button" className="emp-btn primary lg" onClick={openCreate}>
              <HrmsIcon name="plus" size={17} />
              Add Geofence
            </button>
          </div>
        ) : null}
      </div>

      {error ? <div className="people-alert err">{error}</div> : null}
      {notice ? (
        <div className="dsg-selbar">
          <span className="emp-notice">{notice}</span>
        </div>
      ) : null}

      <div className="att-kpis gf-kpis">
        {kpis.map((kp) => (
          <div key={kp.label} className="emp-card att-kpi">
            <span className={`dep-kpi-icon ${kp.tone}`}>
              <HrmsIcon name={kp.icon} size={22} />
            </span>
            <div>
              <b>{kp.label}</b>
              <strong>{loading && !board ? '…' : kp.value.toLocaleString()}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="gf-split">
        <section className="emp-card att-main gf-board">
          <div className="att-tabs-row">
            <nav className="att-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'locations'} className={tab === 'locations' ? 'on' : ''} onClick={() => setTab('locations')}>
                Geofence Locations
              </button>
              <button type="button" role="tab" aria-selected={tab === 'assign'} className={tab === 'assign' ? 'on' : ''} onClick={() => setTab('assign')}>
                Employee Assignment
              </button>
            </nav>
          </div>

          {tab === 'locations' ? (
            <>
              <div className="gf-map-wrap">
                <label className="gf-map-search">
                  <HrmsIcon name="search" size={15} />
                  <input value={mapQ} onChange={(e) => setMapQ(e.target.value)} placeholder="Search location…" aria-label="Search map location" />
                </label>
                <PeopleGeofenceMap
                  locations={mapLocs}
                  selectedId={selected}
                  pick={manager}
                  onSelect={(id) => {
                    const loc = locs.find((l) => l.id === id);
                    if (loc) openLoc(loc, 'edit');
                  }}
                  onPick={(lat, lng) => setForm((f) => ({ ...f, latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) }))}
                />
              </div>
              <div className="gf-filters">
                <label className="gf-search">
                  <HrmsIcon name="search" size={16} />
                  <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search geofences…" />
                </label>
                <FilterDropdown value={status} allLabel="All Status" options={['Active', 'Inactive']} onChange={(v) => { setStatus(v); setPage(1); }} label="Status" />
                <FilterDropdown value={dept} allLabel="All Departments" options={depts} onChange={(v) => { setDept(v); setPage(1); }} label="Department" />
                <FilterDropdown value={site} allLabel="All Sites" options={sites} onChange={(v) => { setSite(v); setPage(1); }} label="Site" />
                <button type="button" className="emp-btn" onClick={() => { setQ(''); setStatus(''); setDept(''); setSite(''); setPage(1); }}>
                  <HrmsIcon name="reset" size={16} /> Reset
                </button>
              </div>
              <div className="emp-table-wrap">
                <table className="emp-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Location Name</th>
                      <th>Address</th>
                      <th>Radius</th>
                      <th>Employees</th>
                      <th>Status</th>
                      <th className="emp-col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td className="emp-empty" colSpan={7}>
                          No geofences in this view.
                        </td>
                      </tr>
                    ) : (
                      rows.map((l, i) => (
                        <tr key={l.id} className={selected === l.id ? 'on' : ''}>
                          <td>{(page - 1) * perPage + i + 1}</td>
                          <td>
                            <div className="gf-loc">
                              <span className={`gf-dot ${l.tone || 'blue'}`}>
                                <HrmsIcon name="pin" size={13} />
                              </span>
                              <div>
                                <b>{l.title}</b>
                                <small>{l.subtitle || l.site_type}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="gf-addr">{l.address}</div>
                          </td>
                          <td>{l.radius_m} m</td>
                          <td>{l.employees}</td>
                          <td>
                            <span className={`emp-pill ${l.status === 'Active' ? 'green' : 'rose'}`}>{l.status}</span>
                          </td>
                          <td className="emp-col-actions">
                            <div className="emp-actions" style={{ position: 'static', display: 'flex', gap: 10 }}>
                              <button type="button" className="gf-link" onClick={() => openLoc(l, 'edit')}>
                                <HrmsIcon name="eye" size={14} /> View
                              </button>
                              <button type="button" className="gf-link" disabled={!manager} onClick={() => openLoc(l, 'edit')}>
                                <HrmsIcon name="pencil" size={14} /> Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <Pager
                page={page}
                pages={pages}
                perPage={perPage}
                onPage={setPage}
                onPerPage={(n) => { setPerPage(n); setPage(1); }}
                summary={`Showing ${(filtered.length ? (page - 1) * perPage + 1 : 0)} to ${Math.min(page * perPage, filtered.length)} of ${filtered.length} geofences`}
              />
            </>
          ) : (
            <>
              <div className="gf-assign-bar">
                <label className="gf-search" style={{ flex: 1, minWidth: 180 }}>
                  <HrmsIcon name="search" size={16} />
                  <input value={empQ} onChange={(e) => { setEmpQ(e.target.value); setEmpPage(1); }} placeholder="Search employees…" />
                </label>
                <FilterDropdown value={empState} allLabel="All statuses" options={GEO_STATES} onChange={(v) => { setEmpState(v); setEmpPage(1); }} label="Geofence status" />
                <FilterDropdown value={assignSite} allLabel="Select site" options={sites} onChange={setAssignSite} label="Assign site" />
                {manager ? (
                  <button type="button" className="emp-btn primary" disabled={!picked.length || !assignSite || busy} onClick={() => void assign()}>
                    Assign selected
                  </button>
                ) : null}
              </div>
              <div className="emp-table-wrap">
                <table className="emp-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Employee</th>
                      <th>Work location</th>
                      <th>Radius</th>
                      <th>Geofence</th>
                      <th>Temporary override</th>
                      {canEditEmp ? <th className="emp-col-actions">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {empSlice.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={picked.includes(e.id)}
                            onChange={() => setPicked((cur) => (cur.includes(e.id) ? cur.filter((x) => x !== e.id) : [...cur, e.id]))}
                            disabled={!manager}
                            aria-label={`Select ${e.name}`}
                          />
                        </td>
                        <td>
                          <div className="emp-person lv-person">
                            <Avatar id={e.id} name={e.name} />
                            <div>
                              <b>{e.name}</b>
                              <small className="gf-sub">{[e.id, e.department].filter(Boolean).join(' · ')}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          {e.geofence_label || e.work_latitude ? (
                            <div className="gf-emp-loc">
                              <b>{e.geofence_label || 'Custom point'}</b>
                              {e.geofence_address ? <small className="gf-addr">{e.geofence_address}</small> : null}
                              {e.work_latitude && e.work_longitude ? (
                                <small className="gf-sub">
                                  {e.work_latitude.toFixed(5)}, {e.work_longitude.toFixed(5)}
                                </small>
                              ) : null}
                            </div>
                          ) : (
                            <span className="gf-sub">Not set</span>
                          )}
                        </td>
                        <td>{e.geofence_radius_m ? `${e.geofence_radius_m} m` : '—'}</td>
                        <td>
                          <span className={`emp-pill ${geoStateTone(e)}`}>{geoStateLabel(e) === 'Temporarily disabled' ? 'Paused' : geoStateLabel(e)}</span>
                        </td>
                        <td>
                          {e.override_active ? (
                            <div className="gf-emp-loc">
                              <span className="emp-pill amber">Disabled {e.override_until ? `until ${e.override_until}` : 'until re-enabled'}</span>
                              {e.override_reason ? <small className="gf-sub" title={e.override_reason}>{e.override_reason}</small> : null}
                              {e.override_by ? <small className="gf-sub">by {e.override_by}</small> : null}
                            </div>
                          ) : (
                            <span className="gf-sub">None</span>
                          )}
                        </td>
                        {canEditEmp ? (
                          <td className="emp-col-actions">
                            <div className="gf-emp-actions">
                              <button type="button" className="gf-link" onClick={() => setEditEmp(e)}>
                                <HrmsIcon name="pencil" size={14} /> Edit
                              </button>
                              {e.override_active ? (
                                <button type="button" className="gf-link" disabled={busy} onClick={() => void reenable(e)}>
                                  <HrmsIcon name="shield" size={14} /> Re-enable
                                </button>
                              ) : (
                                <button type="button" className="gf-link warn" disabled={busy} onClick={() => setOvrEmp(e)}>
                                  <HrmsIcon name="pin" size={14} /> Temporarily disable
                                </button>
                              )}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                    {!empRows.length ? (
                      <tr>
                        <td className="emp-empty" colSpan={canEditEmp ? 7 : 6}>
                          No employees in this view.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <Pager
                page={empPage}
                pages={empPages}
                perPage={empPerPage}
                onPage={setEmpPage}
                onPerPage={(n) => { setEmpPerPage(n); setEmpPage(1); }}
                summary={`Showing ${empRows.length ? (empPage - 1) * empPerPage + 1 : 0} to ${Math.min(empPage * empPerPage, empRows.length)} of ${empRows.length} employees${board?.kpis?.overrides ? ` · ${board.kpis.overrides} with geofencing temporarily disabled` : ''}`}
              />
            </>
          )}
        </section>

        <aside className="emp-card gf-side gf-side-card">
          <h2>Add / Edit Geofence</h2>
          <div className="gf-form-tabs">
            <button type="button" className={formTab === 'create' ? 'on' : ''} onClick={openCreate}>
              Create Geofence
            </button>
            <button type="button" className={formTab === 'edit' ? 'on' : ''} onClick={() => setFormTab('edit')}>
              Edit Geofence
            </button>
          </div>
          <label className="gf-field">
            Location Name *
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Central Office" disabled={!manager} />
          </label>
          <label className="gf-field">
            Address *
            <span className="gf-search">
              <HrmsIcon name="pin" size={15} />
              <input value={form.address || ''} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Search or enter address" disabled={!manager} />
            </span>
          </label>
          <div className="gf-field">
            Select on Map
            <span className="gf-hint">Click on map to set center point and adjust radius</span>
            <div className="gf-map-slot">
              <HrmsIcon name="pin" size={22} />
              {form.latitude && form.longitude ? `${form.latitude}, ${form.longitude}` : 'Click on the map to place the center point'}
            </div>
          </div>
          <label className="gf-field">
            Radius (meters) *
            <input
              type="number"
              min={50}
              max={500}
              value={form.radius_m || 100}
              onChange={(e) => setForm((f) => ({ ...f, radius_m: Number(e.target.value) || 100 }))}
              disabled={!manager}
            />
            <span className="gf-hint">Recommended: 50 – 500 meters</span>
          </label>
          <div className="gf-field">
            Status
            <div className="gf-status-row">
              <button
                type="button"
                className={`gf-switch${form.status === 'Active' ? ' on' : ''}`}
                disabled={!manager}
                onClick={() => setForm((f) => ({ ...f, status: f.status === 'Active' ? 'Inactive' : 'Active' }))}
                aria-pressed={form.status === 'Active'}
              >
                <i />
              </button>
              {form.status === 'Active' ? 'Active' : 'Inactive'}
            </div>
          </div>
          <div className="gf-actions">
            <button type="button" className="emp-btn" onClick={openCreate}>
              Cancel
            </button>
            <button type="button" className="emp-btn primary" disabled={!manager || busy || !form.title} onClick={() => void save()}>
              Save Geofence
            </button>
          </div>
          <div className="gf-guide">
            <strong>
              <HrmsIcon name="pin" size={16} /> Geofence Guidelines
            </strong>
            <ul>
              <li>Employees can mark check-in/out only within their assigned geofence radius.</li>
              <li>Use a radius between 50 to 500 meters for accurate results.</li>
              <li>Multiple geofences can be assigned to an employee (e.g. office + client site).</li>
              <li>GPS must be enabled on the employee’s device.</li>
              <li>You can assign geofences department-wise, individually or in bulk.</li>
            </ul>
          </div>
        </aside>
      </div>

      {editEmp && canEditEmp ? (
        <EmployeeGeofenceModal
          employee={editEmp}
          locations={locs}
          hq={board?.hq}
          mapsKey={board?.google_maps_api_key}
          preview={Boolean(preview)}
          onClose={() => setEditEmp(null)}
          onSaved={afterEmpSave}
        />
      ) : null}
      {ovrEmp && canEditEmp ? (
        <GeofenceOverrideModal employee={ovrEmp} preview={Boolean(preview)} onClose={() => setOvrEmp(null)} onSaved={afterEmpSave} />
      ) : null}
    </div>
  );
}
