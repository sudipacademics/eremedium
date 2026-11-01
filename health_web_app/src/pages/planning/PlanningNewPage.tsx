import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import './planning-portal.css';

export function PlanningNewPage() {
  const navigate = useNavigate();
  const [staffRoles, setStaffRoles] = useState<string[]>([]);
  const [kraOptions, setKraOptions] = useState<Array<{ name: string; title: string }>>([]);
  const [title, setTitle] = useState('');
  const [designation, setDesignation] = useState('Lab Technician');
  const [department, setDepartment] = useState('Laboratory');
  const [staffRole, setStaffRole] = useState('Lab');
  const [location, setLocation] = useState('Kolkata, West Bengal');
  const [headcount, setHeadcount] = useState('1');
  const [jd, setJd] = useState('');
  const [selectedKras, setSelectedKras] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.getStaffPlanningCatalog();
        setStaffRoles(res.data.staff_roles || []);
        setKraOptions((res.data.kra_library || []).map((k) => ({ name: k.title || k.name, title: k.title || k.name })));
        const bm = (res.data.role_benchmarks || []).find((b) => b.designation === 'Lab Technician');
        if (bm?.kras?.length) setSelectedKras(bm.kras);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load catalog');
      }
    })();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createStaffPlan({
        title: title || `Hire ${designation}`,
        designation,
        department,
        staff_role: staffRole,
        location,
        headcount: Number(headcount) || 1,
        kra_json: selectedKras,
        jd_text: jd || undefined,
      });
      const plan = res.data.plan?.name;
      if (plan) navigate(`/planning/${encodeURIComponent(plan)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create plan');
    } finally {
      setBusy(false);
    }
  }

  function toggleKra(name: string) {
    setSelectedKras((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  }

  return (
    <div className="planning-card">
      <h2>New staff plan</h2>
      <p className="muted">Define the role, KPIs/KRAs, and JD. Next step estimates market CTC.</p>
      {error ? <div className="planning-alert err">{error}</div> : null}
      <form className="planning-form" onSubmit={onSubmit}>
        <label>
          Plan title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q3 Lab Technician hire" />
        </label>
        <label>
          Designation
          <input value={designation} onChange={(e) => setDesignation(e.target.value)} required />
        </label>
        <label>
          Department
          <input value={department} onChange={(e) => setDepartment(e.target.value)} />
        </label>
        <label>
          Staff role band
          <select value={staffRole} onChange={(e) => setStaffRole(e.target.value)}>
            {(staffRoles.length ? staffRoles : ['Lab']).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label>
          Headcount
          <input type="number" min={1} value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
        </label>
        <label>
          KRAs
          <div className="planning-chips" style={{ marginTop: 6 }}>
            {kraOptions.map((k) => (
              <button
                key={k.name}
                type="button"
                onClick={() => toggleKra(k.name)}
                style={{
                  border: selectedKras.includes(k.name) ? '1px solid #c46b3a' : '1px solid #d9e2ec',
                  background: selectedKras.includes(k.name) ? '#fff4ec' : '#f0ebe4',
                  borderRadius: 999,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  fontWeight: 650,
                }}
              >
                {k.title}
              </button>
            ))}
          </div>
        </label>
        <label>
          Job description
          <textarea rows={6} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Optional — auto-built from KPIs/KRAs if empty" />
        </label>
        <div className="planning-actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Create plan'}
          </button>
        </div>
      </form>
    </div>
  );
}
