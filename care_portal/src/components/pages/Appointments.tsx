import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { Icon } from '../../icons';
import { useApi, useCare, withQuery } from '../../store';
import type { Appointment, ApptType, Plan } from '../../types';
import { addDays, apptLabel, fmtDate, fmtDay, fmtTime, inr, todayIst, TYPE_LABEL } from '../../format';
import { Empty, ErrorNote, PageHeader, Pager, Pill, SearchBox, Tabs, TypePill, useDebounced } from '../ui';
import { billPlanAsPackage } from '../forms/planBilling';
import { referralLabel } from '../forms/ReferralInput';
import { AES, F, roleLabel } from '../../flavor';
import { extractCrmTag } from '../../crmTag';

const NEXT: Record<ApptType, Record<string, { to: string; label: string }>> = {
  consultation: { Scheduled: { to: 'Checked In', label: 'Check in' }, 'Checked In': { to: 'In Session', label: 'Start' }, 'In Session': { to: 'Completed', label: 'Complete' }, Waiting: { to: 'In Session', label: 'Start' } },
  physiotherapy: { Scheduled: { to: 'Checked In', label: 'Check in' }, 'Checked In': { to: 'In Session', label: 'Start' }, 'In Session': { to: 'Completed', label: 'Complete' }, Waiting: { to: 'In Session', label: 'Start' } },
  lab: { Scheduled: { to: 'Waiting', label: 'Arrived' }, Waiting: { to: 'Sample Collected', label: 'Collected' }, 'Sample Collected': { to: 'Reported', label: 'Reported' } },
  diagnostic: { Scheduled: { to: 'Checked In', label: 'Check in' }, 'Checked In': { to: 'In Session', label: 'Start' }, 'In Session': { to: 'Report Pending', label: 'Done' } },
};

export const moduleForType = (type: ApptType) => (type === 'lab' ? 'Test & Lab' : type === 'diagnostic' ? 'Diagnostics' : 'Appointments');

export function QuickStep({ a }: { a: Appointment }) {
  const { can, mutate } = useCare();
  const step = NEXT[a.type][a.status];
  if (!step || !can(moduleForType(a.type), 'edit')) return null;
  return (
    <button
      type="button"
      className="btn btn-soft sm"
      onClick={(e) => {
        e.stopPropagation();
        mutate(() => api(`/appointments/${a.id}`, { method: 'PATCH', body: { status: step.to } }), `${a.patient}: ${step.to}`);
      }}
    >
      {step.label}
    </button>
  );
}

type ListData = { total: number; items: Appointment[]; counts: Record<string, number> };

const STATUS_LISTS: Record<string, string[]> = {
  lab: ['Scheduled', 'Waiting', 'Sample Collected', 'Reported', 'Cancelled'],
  diagnostic: ['Scheduled', 'Checked In', 'In Session', 'Report Pending', 'Reported', 'No Show', 'Cancelled'],
  default: ['Scheduled', 'Checked In', 'In Session', 'Completed', 'No Show', 'Cancelled'],
};

const STAFF_ROLE: Record<string, string> = { consultation: 'Doctor', physiotherapy: 'Physiotherapist', lab: 'Lab Technician', diagnostic: 'Diagnostic Technician' };

export function AppointmentList({ type }: { type?: ApptType }) {
  const lab = type === 'lab' || type === 'diagnostic';
  const { branch, openModal, meta } = useCare();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'day' | 'upcoming' | 'history'>(params.get('q') || params.get('status') ? 'history' : 'day');
  const [date, setDate] = useState(todayIst());
  const [status, setStatus] = useState(params.get('status') || '');
  const [q, setQ] = useState(params.get('q') || '');
  const [practitioner, setPractitioner] = useState('');
  const [offset, setOffset] = useState(0);
  const term = useDebounced(q.trim());
  const limit = 50;

  useEffect(() => setOffset(0), [view, date, status, term, practitioner, branch, type]);
  useEffect(() => {
    const pq = params.get('q');
    const ps = params.get('status');
    if (pq !== null) {
      setQ(pq);
      setView('history');
    }
    if (ps !== null) {
      setStatus(ps);
      setView('history');
    }
    if (pq !== null || ps !== null) setParams({}, { replace: true });
  }, [params, setParams]);

  const today = todayIst();
  const path = withQuery('/appointments', {
    type,
    branch,
    date: view === 'day' ? date : undefined,
    from: view === 'upcoming' ? today : undefined,
    to: view === 'upcoming' ? addDays(today, 60) : view === 'history' && !term && !status ? addDays(today, -1) : undefined,
    order: view === 'history' ? 'desc' : undefined,
    status,
    q: term,
    practitioner,
    limit,
    offset,
  });
  const { data, error, loading } = useApi<ListData>(path);
  const role = type ? STAFF_ROLE[type] : '';
  const staff = (meta?.practitioners || []).filter((p) => p.active && (!role || p.role === role) && p.role !== 'Pharmacist');
  const statusList = STATUS_LISTS[type === 'lab' || type === 'diagnostic' ? type : 'default'];

  return (
    <div className="card">
      <div className="toolbar">
        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { value: 'day', label: 'Day view' },
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'history', label: 'History' },
          ]}
        />
        {view === 'day' && (
          <div className="date-nav">
            <button type="button" className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
              <Icon name="chevronLeft" />
            </button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button type="button" className="icon-btn" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
              <Icon name="chevronRight" />
            </button>
            {date !== today && (
              <button type="button" className="btn btn-ghost sm" onClick={() => setDate(today)}>
                Today
              </button>
            )}
          </div>
        )}
        <span className="spacer" />
        <SearchBox value={q} onChange={setQ} placeholder="Patient, mobile, booking ID" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {statusList.map((s) => (
            <option key={s} value={s}>
              {s} {data?.counts[s] ? `(${data.counts[s]})` : ''}
            </option>
          ))}
        </select>
        {staff.length > 0 && (
          <select value={practitioner} onChange={(e) => setPractitioner(e.target.value)} aria-label="Staff">
            <option value="">All {role ? `${roleLabel(role).toLowerCase()}s` : 'staff'}</option>
            {staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {view === 'day' && <p className="day-label">{fmtDay(date)}{data ? ` · ${data.total} booking${data.total === 1 ? '' : 's'}` : ''}</p>}
      {error && <ErrorNote text={error} />}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {view !== 'day' && <th>Date</th>}
              <th>Time</th>
              <th>Patient</th>
              {!type && <th>Type</th>}
              <th>{lab ? 'Tests' : 'Service'}</th>
              <th>CRM Tag</th>
              <th>{role ? roleLabel(role) : 'Staff'}</th>
              <th>Status</th>
              <th className="num">Fee</th>
              <th>Bill</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((a) => {
              const crmTag = extractCrmTag(a.notes, a.patient_referred_by);
              return (
              <tr key={a.id} className="clickable" onClick={() => openModal({ kind: 'appointmentEdit', appointment: a })}>
                {view !== 'day' && <td>{fmtDate(a.date)}</td>}
                <td className="nowrap">{fmtTime(a.time)}</td>
                <td>
                  <Link to={`/patients/${a.patient_id}`} className="strong-link" onClick={(e) => e.stopPropagation()}>
                    {a.patient}
                  </Link>
                  <small className="block muted">{a.mobile || a.patient_code}</small>
                </td>
                {!type && (
                  <td>
                    <TypePill type={a.type} />
                  </td>
                )}
                <td className="wrap">{lab ? a.service : apptLabel(a)}</td>
                <td className="nowrap">
                  {crmTag ? <code className="crm-tag">{crmTag}</code> : <span className="muted">—</span>}
                </td>
                <td>{a.practitioner || <span className="muted">—</span>}</td>
                <td>
                  <Pill status={a.status} />
                </td>
                <td className="num">{inr(a.fee)}</td>
                <td>{a.invoice_number ? <Pill status={a.invoice_status || 'Paid'}>{a.invoice_status}</Pill> : <span className="muted small">Not billed</span>}</td>
                <td className="row-actions">
                  <QuickStep a={a} />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {data && data.items.length === 0 && !loading && <Empty text={view === 'day' ? `No ${type ? `${TYPE_LABEL[type].toLowerCase()} bookings` : 'appointments'} on this day.` : 'Nothing found.'} icon="calendar" />}
      </div>
      {data && <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />}
    </div>
  );
}

export function AppointmentsPage({ type }: { type?: ApptType }) {
  const { can, openModal } = useCare();
  const title = type === 'consultation' ? 'Doctor Consultation' : type === 'physiotherapy' ? (AES ? 'Session Management' : 'Physiotherapy Booking') : 'Appointments';
  const subtitle =
    type === 'consultation'
      ? 'Doctor appointments, check-in and consultation status'
      : type === 'physiotherapy'
        ? 'Each booked visit: check in, start and complete. Dates come from the treatment plan.'
        : 'All consultations, physiotherapy sessions, lab and diagnostic bookings';
  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={type === 'physiotherapy' ? 'physio' : type === 'consultation' ? 'doctor' : 'calendar'}
        actions={
          can('Appointments', 'create') && (
            <>
              {type !== 'physiotherapy' && (
                <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'appointment', type: 'consultation' })}>
                  <Icon name="plus" size={16} /> Book consultation
                </button>
              )}
              {type !== 'consultation' && (
                <>
                  <button type="button" className={type ? 'btn btn-primary' : 'btn btn-soft'} onClick={() => openModal({ kind: 'plan' })}>
                    <Icon name="plus" size={16} /> New {F.plan}
                  </button>
                  <button type="button" className="btn btn-soft" onClick={() => openModal({ kind: 'appointment', type: 'physiotherapy' })}>
                    Single session
                  </button>
                </>
              )}
            </>
          )
        }
      />
      <AppointmentList type={type} />
    </div>
  );
}

function PlanSessions({ plan }: { plan: Plan }) {
  const { openModal } = useCare();
  const { data } = useApi<{ sessions: Appointment[] }>(`/plans/${plan.id}`);
  if (!data) return <p className="muted small pad">Loading sessions…</p>;
  return (
    <div className="sessions">
      {data.sessions.map((s) => (
        <button key={s.id} type="button" className={`session-chip st-${s.status.replace(/\s/g, '-').toLowerCase()}`} onClick={() => openModal({ kind: 'appointmentEdit', appointment: s })}>
          <b>#{s.session_no}</b>
          <span>
            {fmtDate(s.date, false)} · {fmtTime(s.time)}
          </span>
          <small>
            {s.status} · {inr(s.fee)}
          </small>
        </button>
      ))}
    </div>
  );
}

export function SessionsPage() {
  const { branch, can, openModal, mutate } = useCare();
  const [status, setStatus] = useState('Active');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const term = useDebounced(q.trim());
  const { data, error } = useApi<{ items: Plan[] }>(withQuery('/plans', { branch, status, q: term, limit: 200 }));
  const editable = can('Appointments', 'edit');

  const setPlanStatus = (p: Plan, next: string) => {
    if (next === 'Discontinued' && !window.confirm(`Discontinue ${p.code}? Remaining scheduled sessions will be cancelled.`)) return;
    mutate(() => api(`/plans/${p.id}`, { method: 'PATCH', body: { status: next } }), `${p.code} ${next.toLowerCase()}`);
  };

  return (
    <div className="page">
      <PageHeader
        title="Treatment Plan Management"
        subtitle="Every planned patient treatment is stored here. Edits update Session Management and the invoice. Active, on hold and completed plans stay in their own sections."
        icon="session"
        actions={
          can('Appointments', 'create') && (
            <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'plan' })}>
              <Icon name="plus" size={16} /> New {F.plan}
            </button>
          )
        }
      />
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={status}
            onChange={setStatus}
            tabs={[
              { value: 'Active', label: 'Active' },
              { value: 'On Hold', label: 'On hold' },
              { value: 'Completed', label: 'Completed' },
              { value: 'Discontinued', label: 'Discontinued' },
              { value: '', label: 'All' },
            ]}
          />
          <span className="spacer" />
          <SearchBox value={q} onChange={setQ} placeholder="Patient, plan ID, condition" />
        </div>
        {error && <ErrorNote text={error} />}
        <div className="plan-list">
          {data?.items.length === 0 && <Empty text={`No ${F.plan}s here.`} icon="session" />}
          {data?.items.map((p) => {
            const pct = Math.round((p.completed / p.total_sessions) * 100);
            return (
              <div key={p.id} className="plan">
                <div className="plan-main" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <div className="plan-who">
                    <Link to={`/patients/${p.patient_id}`} className="strong-link" onClick={(e) => e.stopPropagation()}>
                      {p.patient}
                    </Link>
                    <small className="muted">
                      {p.code} · {p.condition || F.service} · {p.practitioner || 'No therapist'} · Ref: {referralLabel(p)}
                    </small>
                    {p.billing === 'package' && (
                      <small>
                        <Pill tone="purple">{p.package_name || 'Package'}</Pill> {p.package_price ? inr(p.package_price) : ''}
                        {p.invoice_status && <Pill status={p.invoice_status} />}
                        {p.valid_until ? <span className="muted"> · valid till {fmtDate(p.valid_until, false)}</span> : null}
                      </small>
                    )}
                    {p.billing === 'package' && p.invoice_total != null && (() => {
                      const used = Math.round(((p.invoice_total || 0) / p.total_sessions) * p.completed * 100) / 100;
                      const paid = p.invoice_paid || 0;
                      return (
                        <small className="muted">
                          {inr(used)} used · {inr(paid)} paid
                          {used > paid ? <b className="neg"> · {inr(used - paid)} due for sessions taken</b> : paid > used ? <span className="pos"> · {inr(paid - used)} in advance</span> : null}
                        </small>
                      );
                    })()}
                  </div>
                  <div className="plan-progress">
                    <div className="bar">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <small>
                      {p.completed}/{p.total_sessions} done · {p.booked} booked
                    </small>
                  </div>
                  <div className="plan-next">
                    <small className="muted">Next session</small>
                    <span>{p.next_session ? `${fmtDate(p.next_session, false)} · ${fmtTime(p.next_session.slice(11))}` : '—'}</span>
                  </div>
                  <span className="num">
                    {inr(p.fee)}/session
                    {p.billing === 'package' && <small className="block muted">in package</small>}
                  </span>
                  <Pill status={p.status} />
                  <Icon name="chevronDown" size={16} className={`chev ${open === p.id ? 'up' : ''}`} />
                </div>
                {open === p.id && (
                  <div className="plan-body">
                    <PlanSessions plan={p} />
                    {editable && (
                      <div className="action-row">
                        {p.billing !== 'package' && p.status !== 'Discontinued' && can('Billing & Invoice', 'create') && (
                          <button
                            type="button"
                            className="btn btn-primary sm"
                            onClick={async () => {
                              const r = await billPlanAsPackage(p, mutate);
                              if (r) openModal({ kind: 'viewInvoice', id: r.invoice_id });
                            }}
                          >
                            <Icon name="invoice" size={14} /> Bill full plan as package ({inr(p.fee * p.total_sessions)})
                          </button>
                        )}
                        {p.billing === 'package' && p.invoice_id && (
                          <button type="button" className="btn btn-soft sm" onClick={() => openModal({ kind: 'viewInvoice', id: p.invoice_id! })}>
                            <Icon name="invoice" size={14} /> Package invoice {p.invoice_number}
                          </button>
                        )}
                        <button type="button" className="btn btn-soft sm" onClick={() => openModal({ kind: 'planEdit', planId: p.id })}>
                          <Icon name="edit" size={14} /> Edit plan
                        </button>
                        {p.status === 'Active' && (
                          <button type="button" className="btn btn-ghost sm" onClick={() => setPlanStatus(p, 'On Hold')}>
                            Put on hold
                          </button>
                        )}
                        {p.status === 'On Hold' && (
                          <button type="button" className="btn btn-soft sm" onClick={() => setPlanStatus(p, 'Active')}>
                            Resume
                          </button>
                        )}
                        {['Active', 'On Hold'].includes(p.status) && (
                          <>
                            <button type="button" className="btn btn-ghost sm" onClick={() => setPlanStatus(p, 'Completed')}>
                              Close as completed
                            </button>
                            <button type="button" className="btn btn-danger-ghost sm" onClick={() => setPlanStatus(p, 'Discontinued')}>
                              Discontinue
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
