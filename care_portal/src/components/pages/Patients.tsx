import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../icons';
import { useApi, useCare, withQuery } from '../../store';
import type { Appointment, Invoice, LabBooking, Patient, Plan } from '../../types';
import { LabStatus, openLabReport } from '../forms/LabForms';
import { apptLabel, downloadCsv, fmtDate, fmtStamp, fmtTime, inr, initials } from '../../format';
import { Empty, ErrorNote, Loading, PageHeader, Pager, Pill, SearchBox, Tabs, TypePill, useDebounced } from '../ui';
import { QuickStep } from './Appointments';

export function PatientsPage() {
  const { branch, can, openModal } = useCare();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const term = useDebounced(q.trim());
  const limit = 50;
  useEffect(() => setOffset(0), [term, branch]);
  const { data, error } = useApi<{ total: number; items: Patient[] }>(withQuery('/patients', { branch, q: term, limit, offset }));

  const exportCsv = () =>
    data &&
    downloadCsv(
      'remedium-care-patients.csv',
      ['Patient ID', 'Name', 'Mobile', 'Gender', 'Age', 'Address', 'Registered', 'Last visit', 'Visits', 'Due'],
      data.items.map((p) => [p.code, p.name, p.mobile, p.gender, p.age, p.address, p.created_at.slice(0, 10), p.last_visit, p.visits, p.due]),
    );

  return (
    <div className="page">
      <PageHeader
        title="Patients"
        subtitle={data ? `${data.total.toLocaleString('en-IN')} registered patients` : 'Patient register'}
        icon="users"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={exportCsv}>
              <Icon name="download" size={16} /> Export
            </button>
            {can('Patients', 'create') && (
              <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'patient', then: (p) => navigate(`/patients/${p.id}`) })}>
                <Icon name="userPlus" size={16} /> New patient
              </button>
            )}
          </>
        }
      />
      <div className="card">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Search by name, mobile or patient ID" />
        </div>
        {error && <ErrorNote text={error} />}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Patient ID</th>
                <th>Mobile</th>
                <th>Age / Gender</th>
                <th>Address</th>
                <th>Last visit</th>
                <th className="num">Visits</th>
                <th className="num">Due</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/patients/${p.id}`)}>
                  <td>
                    <span className="who">
                      <span className="avatar sm">{initials(p.name)}</span>
                      <strong>{p.name}</strong>
                    </span>
                  </td>
                  <td className="mono">{p.code}</td>
                  <td>{p.mobile || '—'}</td>
                  <td>
                    {p.age ?? '—'}
                    {p.gender ? ` · ${p.gender}` : ''}
                  </td>
                  <td className="wrap">{p.address || '—'}</td>
                  <td>{fmtDate(p.last_visit)}</td>
                  <td className="num">{p.visits}</td>
                  <td className={`num ${p.due ? 'neg' : ''}`}>{p.due ? inr(p.due) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.items.length === 0 && <Empty text="No patients match your search." icon="users" />}
        </div>
        {data && <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />}
      </div>
    </div>
  );
}

type PatientDetail = { patient: Patient; appointments: Appointment[]; plans: Plan[]; invoices: Invoice[]; lab_bookings: LabBooking[] };

export function PatientDetailPage() {
  const { id } = useParams();
  const { can, openModal, toast } = useCare();
  const [tab, setTab] = useState<'visits' | 'lab' | 'plans' | 'invoices'>('visits');
  const { data, error } = useApi<PatientDetail>(`/patients/${id}`);
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading />;
  const p = data.patient;
  const due = data.invoices.filter((i) => ['Unpaid', 'Partially Paid'].includes(i.status)).reduce((s, i) => s + i.total - i.paid, 0);
  const billed = data.invoices.filter((i) => i.status !== 'Cancelled').reduce((s, i) => s + i.total, 0);
  const upcoming = data.appointments.filter((a) => a.status === 'Scheduled').length;

  return (
    <div className="page">
      <Link to="/patients" className="back">
        <Icon name="chevronLeft" size={16} /> Patients
      </Link>
      <div className="card patient-head">
        <span className="avatar lg">{initials(p.name)}</span>
        <div className="patient-info">
          <h1>{p.name}</h1>
          <p className="muted">
            {p.code}
            {p.age ? ` · ${p.age} yrs` : ''}
            {p.gender ? ` · ${p.gender}` : ''}
            {p.mobile ? ` · ` : ''}
            {p.mobile && <a href={`tel:${p.mobile}`}>{p.mobile}</a>}
          </p>
          <p className="muted small">
            {p.condition && <>Condition: <b>{p.condition}</b> · </>}
            Registered {fmtDate(p.created_at)}
            {p.branch ? ` at ${p.branch}` : ''}
            {p.address ? ` · ${p.address}` : ''}
          </p>
        </div>
        <div className="patient-stats">
          <div>
            <small>Billed</small>
            <strong>{inr(billed)}</strong>
          </div>
          <div>
            <small>Due</small>
            <strong className={due ? 'neg' : ''}>{inr(due)}</strong>
          </div>
          <div>
            <small>Upcoming</small>
            <strong>{upcoming}</strong>
          </div>
        </div>
        <div className="patient-actions">
          {can('Appointments', 'create') && (
            <>
              <button type="button" className="btn btn-soft sm" onClick={() => openModal({ kind: 'appointment', type: 'consultation', patientId: p.id })}>
                <Icon name="calendar" size={15} /> Consultation
              </button>
              <button type="button" className="btn btn-soft sm" onClick={() => openModal({ kind: 'plan', patientId: p.id })}>
                <Icon name="physio" size={15} /> Physio plan
              </button>
            </>
          )}
          {can('Test & Lab', 'create') && (
            <button type="button" className="btn btn-soft sm" onClick={() => openModal({ kind: 'appointment', type: 'lab', patientId: p.id })}>
              <Icon name="flask" size={15} /> Lab test
            </button>
          )}
          {can('Diagnostics', 'create') && (
            <button type="button" className="btn btn-soft sm" onClick={() => openModal({ kind: 'appointment', type: 'diagnostic', patientId: p.id })}>
              <Icon name="scan" size={15} /> Diagnostic test
            </button>
          )}
          {can('Billing & Invoice', 'create') && (
            <button type="button" className="btn btn-soft sm" onClick={() => openModal({ kind: 'invoice', patientId: p.id })}>
              <Icon name="invoice" size={15} /> Invoice
            </button>
          )}
          {can('Patients', 'edit') && (
            <button type="button" className="btn btn-ghost sm" onClick={() => openModal({ kind: 'patient', patient: p })}>
              <Icon name="edit" size={15} /> Edit
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'visits', label: 'Visits & bookings', count: data.appointments.length },
            { value: 'lab', label: 'Lab tests & reports', count: data.lab_bookings.length },
            { value: 'plans', label: 'Therapy plans', count: data.plans.length },
            { value: 'invoices', label: 'Invoices', count: data.invoices.length },
          ]}
        />
        {tab === 'visits' && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Service</th>
                  <th>Staff</th>
                  <th>Status</th>
                  <th>Notes / result</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.appointments.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => openModal({ kind: 'appointmentEdit', appointment: { ...a, patient: p.name } })}>
                    <td className="nowrap">
                      {fmtDate(a.date)} · {fmtTime(a.time)}
                    </td>
                    <td>
                      <TypePill type={a.type} />
                    </td>
                    <td className="wrap">{apptLabel(a)}</td>
                    <td>{a.practitioner || '—'}</td>
                    <td>
                      <Pill status={a.status} />
                    </td>
                    <td className="wrap muted">{a.result || a.notes || ''}</td>
                    <td className="row-actions">
                      <QuickStep a={{ ...a, patient: p.name }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.appointments.length === 0 && <Empty text="No visits yet." icon="calendar" />}
          </div>
        )}
        {tab === 'lab' && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Tests</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.lab_bookings.map((b) => (
                  <tr key={b.id} className="clickable" onClick={() => openModal({ kind: 'labBooking', id: b.id })}>
                    <td>
                      <span className="mono">{b.trf_id}</span>
                      <small className="block muted">{fmtStamp(b.booked_at)}</small>
                    </td>
                    <td className="wrap">{b.tests.map((t) => t.item_name).join(', ')}</td>
                    <td>
                      <LabStatus b={b} />
                    </td>
                    <td>
                      <Pill status={b.payment_status || 'Unpaid'} />
                    </td>
                    <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                      {b.report_ready && (
                        <button type="button" className="btn btn-soft sm" onClick={() => openLabReport(b.id, (m) => toast(m, 'error'))}>
                          <Icon name="download" size={15} /> Report
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.lab_bookings.length === 0 && <Empty text="No lab bookings with Remedium Labs yet." icon="flask" />}
          </div>
        )}
        {tab === 'plans' && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Condition</th>
                  <th>Therapist</th>
                  <th>Progress</th>
                  <th>Started</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.plans.map((pl) => (
                  <tr key={pl.id}>
                    <td className="mono">{pl.code}</td>
                    <td>{pl.condition || '—'}</td>
                    <td>{pl.practitioner || '—'}</td>
                    <td>
                      {pl.completed}/{pl.total_sessions} sessions
                    </td>
                    <td>{fmtDate(pl.start_date)}</td>
                    <td>
                      <Pill status={pl.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.plans.length === 0 && <Empty text="No therapy plans." icon="session" />}
          </div>
        )}
        {tab === 'invoices' && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th className="num">Total</th>
                  <th className="num">Paid</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id} className="clickable" onClick={() => openModal({ kind: 'viewInvoice', id: i.id })}>
                    <td className="mono">{i.number}</td>
                    <td>{fmtStamp(i.created_at)}</td>
                    <td>
                      <TypePill type={i.service_type} />
                    </td>
                    <td className="num">{inr(i.total)}</td>
                    <td className="num">{inr(i.paid)}</td>
                    <td>
                      <Pill status={i.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.invoices.length === 0 && <Empty text="No invoices." icon="invoice" />}
          </div>
        )}
      </div>
    </div>
  );
}
