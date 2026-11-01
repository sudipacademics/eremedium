import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import './home-v2.css';
import './doctors-v2.css';

type Department = { name: string; department_name?: string };
type Practitioner = { name: string; practitioner_name?: string; department?: string };
type ConsultType = { name: string; consultation_type?: string; consultation_fee?: number };

const FALLBACK_SPECIALTIES = [
  { name: 'General Medicine', department_name: 'General Medicine' },
  { name: 'Cardiology', department_name: 'Cardiology' },
  { name: 'Pathology', department_name: 'Pathology' },
];

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const ICONS = {
  doctor: (
    <>
      <circle cx="12" cy="7" r="3.5" />
      <path d="M5 21c.6-4 3.4-6 7-6s6.4 2 7 6" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6M10 3v6L5 18.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L14 9V3" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
};

const TONES = ['teal', 'violet', 'blue', 'pink', 'amber', 'indigo', 'green'] as const;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || 'D') + (parts[1]?.[0] || '')).toUpperCase();
}

function specialtyTone(label: string) {
  const l = label.toLowerCase();
  if (l.includes('cardio') || l.includes('heart')) return 'red';
  if (l.includes('pathol') || l.includes('lab')) return 'teal';
  if (l.includes('radio') || l.includes('scan')) return 'blue';
  if (l.includes('gynae') || l.includes('women')) return 'pink';
  if (l.includes('pedia') || l.includes('child')) return 'amber';
  if (l.includes('ortho')) return 'indigo';
  if (l.includes('derma') || l.includes('skin')) return 'violet';
  return 'teal';
}

export function ServicesPage() {
  const { isAuthenticated } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const specialty = (searchParams.get('dept') || '').trim();
  const [draft, setDraft] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [doctors, setDoctors] = useState<Practitioner[]>([]);
  const [types, setTypes] = useState<ConsultType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [deptRes, docRes, typeRes] = await Promise.all([
        api.getDepartments(),
        api.getPractitioners(),
        api.getAppointmentTypes(),
      ]);
      setDepartments(deptRes.data.departments || []);
      setDoctors(docRes.data.practitioners || []);
      setTypes((typeRes.data.types || []) as ConsultType[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load doctors');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const specialties = departments.length ? departments : FALLBACK_SPECIALTIES;

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return doctors.filter((doc) => {
      const name = (doc.practitioner_name || doc.name || '').toLowerCase();
      const dept = (doc.department || '').toLowerCase();
      const deptLabel = specialties.find((d) => d.name === doc.department)?.department_name?.toLowerCase() || '';
      if (specialty && doc.department !== specialty && dept !== specialty.toLowerCase() && deptLabel !== specialty.toLowerCase()) {
        const selected = specialties.find((d) => d.name === specialty || d.department_name === specialty);
        if (selected && doc.department !== selected.name && doc.department !== selected.department_name) return false;
      }
      if (!q) return true;
      return name.includes(q) || dept.includes(q) || deptLabel.includes(q);
    });
  }, [doctors, draft, specialty, specialties]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
  }

  function pickSpecialty(name: string) {
    const next = new URLSearchParams(searchParams);
    if (!name || name === specialty) next.delete('dept');
    else next.set('dept', name);
    setSearchParams(next, { replace: true });
  }

  function bookHref(doc?: Practitioner) {
    const params = new URLSearchParams();
    if (doc?.department) params.set('department', doc.department);
    if (doc?.name) params.set('practitioner', doc.name);
    const qs = params.toString();
    return qs ? `/appointments/book?${qs}` : '/appointments/book';
  }

  return (
    <div className="home-v2 docs-v2">
      <section className="hv-card docs-hero">
        <div className="docs-hero-copy">
          <span className="hv-badge">Physician consults</span>
          <h1>Find a doctor</h1>
          <p className="hv-muted">
            Book a specialty consult, pair it with lab tests, or visit a Remedium centre near you.
          </p>
          <form className="docs-search" onSubmit={onSearch}>
            <input
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search doctor or specialty"
              aria-label="Search doctors"
            />
            <Link className="hv-btn hv-btn-sm" to="/appointments/book">
              Book
            </Link>
          </form>
        </div>
        <div className="docs-hero-visual" aria-hidden>
          <img src="/home/hero-care.jpg" alt="" />
        </div>
      </section>

      <div className="docs-actions">
        <Link className="hv-card docs-action" to="/appointments/book">
          <span className="docs-action-icon tone-violet">
            <Icon>{ICONS.doctor}</Icon>
          </span>
          <div>
            <strong>Book a doctor</strong>
            <span>Specialty, practitioner, slot</span>
          </div>
        </Link>
        <Link className="hv-card docs-action" to="/diagnostics">
          <span className="docs-action-icon tone-teal">
            <Icon>{ICONS.flask}</Icon>
          </span>
          <div>
            <strong>Lab tests</strong>
            <span>Packages &amp; home collection</span>
          </div>
        </Link>
        <Link className="hv-card docs-action" to="/centres">
          <span className="docs-action-icon tone-blue">
            <Icon>{ICONS.pin}</Icon>
          </span>
          <div>
            <strong>Centres</strong>
            <span>Find a hub near you</span>
          </div>
        </Link>
        <Link className="hv-card docs-action" to="/circle">
          <span className="docs-action-icon tone-pink">
            <Icon>{ICONS.heart}</Icon>
          </span>
          <div>
            <strong>Health Circle</strong>
            <span>Member prices &amp; benefits</span>
          </div>
        </Link>
      </div>

      <section className="hv-card hv-concerns">
        <div className="hv-head">
          <h2>Specialties</h2>
          {specialty ? (
            <button type="button" className="hv-link" onClick={() => pickSpecialty('')}>
              Clear
            </button>
          ) : null}
        </div>
        <div className="hv-concern-grid">
          {specialties.map((dept) => {
            const label = dept.department_name || dept.name;
            const active = specialty === dept.name || specialty === label;
            return (
              <button
                key={dept.name}
                type="button"
                className={`hv-concern${active ? ' is-active' : ''}`}
                onClick={() => pickSpecialty(dept.name)}
              >
                <span className={`hv-concern-icon tone-${specialtyTone(label)}`}>
                  <Icon size={16}>{ICONS.doctor}</Icon>
                </span>
                {label}
              </button>
            );
          })}
        </div>
      </section>

      {error ? <div className="error">{error}</div> : null}

      <section className="hv-section">
        <div className="hv-head">
          <div>
            <h2>{specialty ? 'Doctors in this specialty' : 'Our doctors'}</h2>
            <p>{loading ? 'Loading…' : `${filtered.length} doctors`}</p>
          </div>
          {!isAuthenticated ? (
            <Link className="hv-link" to="/login">
              Sign in to book
            </Link>
          ) : null}
        </div>
        {!loading && filtered.length === 0 ? (
          <div className="hv-card docs-empty">
            <p className="hv-muted">No doctors match this search.</p>
            <Link className="hv-btn hv-btn-sm" to="/appointments/book">
              Book an appointment
            </Link>
          </div>
        ) : (
          <div className="docs-grid">
            {filtered.map((doc, idx) => {
              const name = doc.practitioner_name || doc.name;
              const deptLabel =
                specialties.find((d) => d.name === doc.department)?.department_name ||
                doc.department ||
                'Physician';
              return (
                <article key={doc.name} className="hv-card docs-card">
                  <div className="docs-card-top">
                    <span className={`docs-avatar tone-${TONES[idx % TONES.length]}`}>{initials(name)}</span>
                    <div>
                      <h3>{name}</h3>
                      <p className="hv-muted">{deptLabel}</p>
                    </div>
                  </div>
                  <div className="docs-card-actions">
                    <Link className="hv-btn hv-btn-soft hv-btn-sm" to={bookHref(doc)}>
                      View slots
                    </Link>
                    <Link className="hv-btn hv-btn-sm" to={bookHref(doc)}>
                      Book
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {types.length ? (
        <section className="hv-section">
          <div className="hv-head">
            <h2>Consultation types</h2>
          </div>
          <div className="docs-actions">
            {types.slice(0, 4).map((t) => (
              <article key={t.name} className="hv-card docs-action">
                <span className="docs-action-icon tone-teal">
                  <Icon>{ICONS.doctor}</Icon>
                </span>
                <div>
                  <strong>{t.consultation_type || t.name}</strong>
                  <span>{t.consultation_fee ? `From ₹${t.consultation_fee}` : 'Book a slot'}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
