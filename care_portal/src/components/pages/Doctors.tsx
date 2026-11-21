import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../icons';
import { useApi, useCare, withQuery } from '../../store';
import type { Doctor } from '../../types';
import { fmtDate, inr, initials, todayIst } from '../../format';
import { Empty, ErrorNote, PageHeader, Pill, SearchBox, Tabs } from '../ui';
import { DAY_SHORT, parseAvailability, weeklySummary } from '../forms/DoctorForm';
import { AES, roleLabel } from '../../flavor';

export function DoctorsPage() {
  const { branch, can, openModal } = useCare();
  const [status, setStatus] = useState<'' | 'all'>('');
  const [q, setQ] = useState('');
  const { data, error } = useApi<Doctor[]>(withQuery('/doctors', { branch, active: status }));
  const term = q.trim().toLowerCase();
  const list = (data || []).filter(
    (d) =>
      !term ||
      [d.name, d.specialty, d.qualification, d.role].some((v) => (v || '').toLowerCase().includes(term)),
  );
  const today = todayIst();
  const title = AES ? 'Doctors & Cosmetologists' : 'Doctors';
  const bookingsTo = AES ? '/appointments/physiotherapy' : '/appointments/consultation';

  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={
          AES
            ? 'Clinicians and cosmetologists — fees, specialities and availability used for sessions and billing'
            : 'Consultants, specialities, fees and availability used for booking and consultation billing'
        }
        icon="stethoscope"
        actions={
          can('Doctors', 'create') && (
            <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'doctor' })}>
              <Icon name="plus" size={16} /> {AES ? 'Add clinician' : 'Add doctor'}
            </button>
          )
        }
      />
      <div className="card toolbar">
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { value: '', label: AES ? 'Active' : 'Active doctors' },
            { value: 'all', label: 'Include inactive' },
          ]}
        />
        <span className="spacer" />
        <SearchBox value={q} onChange={setQ} placeholder={AES ? 'Name, role or speciality' : 'Name or speciality'} />
      </div>
      {error && <ErrorNote text={error} />}
      {data && list.length === 0 && (
        <Empty
          text={
            term
              ? AES
                ? 'No doctors or cosmetologists match.'
                : 'No doctors match.'
              : AES
                ? 'No clinicians yet. Add doctors and cosmetologists so they can be booked and billed.'
                : 'No doctors yet. Add doctors so they can be booked and billed.'
          }
          icon="stethoscope"
        />
      )}
      <div className="doctor-grid">
        {list.map((d) => {
          const av = parseAvailability(d.availability);
          const summary = weeklySummary(av);
          const upcomingLeave = av.leave.filter((x) => x >= today);
          return (
            <div key={d.id} className={`card doctor-card ${d.active ? '' : 'dim'}`}>
              <div className="doctor-head">
                <span className="avatar">{initials(d.name)}</span>
                <div>
                  <h2>{d.name}</h2>
                  <p className="muted small">
                    {AES ? (
                      <>
                        <Pill tone="grey">{roleLabel(d.role)}</Pill>{' '}
                      </>
                    ) : null}
                    {[d.specialty, d.qualification].filter(Boolean).join(' · ') || 'Speciality not set'}
                    {d.registration_no ? ` · Reg. ${d.registration_no}` : ''}
                  </p>
                </div>
                <div className="doctor-fee">
                  <small>Fee</small>
                  <strong>{inr(d.fee)}</strong>
                </div>
              </div>
              <p className="small">
                <Icon name="session" size={14} /> {summary || <span className="muted">No weekly schedule — can be booked any time</span>}
              </p>
              {d.scheduled && (
                <div className="avail-strip" aria-label="Next 14 days">
                  {d.next14.map((x) => (
                    <span
                      key={x.date}
                      className={`avail-day ${x.ok ? 'ok' : x.reason === 'on leave' ? 'leave' : 'off'} ${x.date === today ? 'today' : ''}`}
                      title={`${fmtDate(x.date)}: ${x.ok ? `${x.from}–${x.to}` : x.reason}`}
                    >
                      <b>{DAY_SHORT[new Date(`${x.date}T00:00:00Z`).getUTCDay()].slice(0, 2)}</b>
                      {Number(x.date.slice(8))}
                    </span>
                  ))}
                </div>
              )}
              {upcomingLeave.length > 0 && (
                <p className="small">
                  <Pill tone="red">Leave</Pill> {upcomingLeave.slice(0, 4).map((x) => fmtDate(x, false)).join(', ')}
                  {upcomingLeave.length > 4 ? ` +${upcomingLeave.length - 4}` : ''}
                </p>
              )}
              <div className="doctor-stats">
                <span>
                  <b>{d.today}</b> today
                </span>
                <span>
                  <b>{d.upcoming}</b> upcoming
                </span>
                <span>
                  <b>{d.completed30 ?? 0}</b> seen (30 days)
                </span>
              </div>
              <div className="action-row">
                {can('Appointments', 'create') && d.active ? (
                  <Link className="btn btn-soft sm" to={bookingsTo}>
                    <Icon name="calendar" size={14} /> Bookings
                  </Link>
                ) : null}
                {can('Doctors', 'edit') && (
                  <button type="button" className="btn btn-ghost sm" onClick={() => openModal({ kind: 'doctor', doctor: d })}>
                    <Icon name="edit" size={14} /> Edit profile &amp; availability
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
