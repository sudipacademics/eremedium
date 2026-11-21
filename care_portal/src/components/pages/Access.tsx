import { useState } from 'react';
import { Icon } from '../../icons';
import { useApi, useCare } from '../../store';
import type { ModuleName, Practitioner } from '../../types';
import { inr, num } from '../../format';
import { Empty, ErrorNote, PageHeader, Pill, Tabs } from '../ui';

const LEVEL_TONE: Record<string, string> = { none: 'grey', view: 'blue', create: 'indigo', edit: 'purple', approve: 'orange', manage: 'green' };

export function AccessPage() {
  const { me, can, openModal } = useCare();
  const [tab, setTab] = useState<'staff' | 'access'>('staff');
  const { data, error } = useApi<Practitioner[]>('/practitioners');

  return (
    <div className="page">
      <PageHeader
        title="User & Access"
        subtitle="Clinical staff used in bookings, and who can sign in to this portal"
        icon="shield"
        actions={
          tab === 'staff' &&
          can('User & Access', 'create') && (
            <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'practitioner' })}>
              <Icon name="plus" size={16} /> Add staff
            </button>
          )
        }
      />
      <div className="card">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'staff', label: 'Doctors, therapists & staff' },
            { value: 'access', label: 'Portal sign-in & permissions' },
          ]}
        />
        {tab === 'staff' && (
          <>
            {error && <ErrorNote text={error} />}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Speciality</th>
                    <th>Contact</th>
                    <th className="num">Fee</th>
                    <th className="num">Completed (30 days)</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data?.map((p) => (
                    <tr key={p.id} className={p.active ? '' : 'dim'}>
                      <td>
                        <strong>{p.name}</strong>
                        {p.branch && <small className="block muted">{p.branch}</small>}
                      </td>
                      <td>
                        <Pill tone="grey">{p.role}</Pill>
                      </td>
                      <td>{p.specialty || '—'}</td>
                      <td>{[p.phone, p.email].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="num">{p.fee ? inr(p.fee) : '—'}</td>
                      <td className="num">{num(p.completed30)}</td>
                      <td>
                        <Pill tone={p.active ? 'green' : 'grey'}>{p.active ? 'Active' : 'Inactive'}</Pill>
                      </td>
                      <td className="row-actions">
                        {can('User & Access', 'edit') && (
                          <button
                            type="button"
                            className="icon-btn sm"
                            onClick={() => openModal(p.role === 'Doctor' && can('Doctors', 'edit') ? { kind: 'doctor', doctor: p } : { kind: 'practitioner', practitioner: p })}
                            aria-label={`Edit ${p.name}`}
                          >
                            <Icon name="edit" size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data && data.length === 0 && <Empty text="No clinical staff added yet. Add doctors and therapists so they can be assigned to bookings." icon="users" />}
            </div>
          </>
        )}
        {tab === 'access' && (
          <div className="access">
            <div className="info-box">
              <Icon name="info" size={18} />
              <div>
                <p>
                  Sign-in uses the Smilecure staff (HRMS) login. HR grants access per employee in <b>People HRMS → Employee → Portal Access → Care Backend</b>, and sets each module to No access, View, Create, Edit, Approve or Manage. System Managers can always sign in.
                </p>
                <a className="btn btn-soft sm" href="https://people.e-remedium.in/people/employees" target="_blank" rel="noreferrer">
                  Open People HRMS <Icon name="arrowRight" size={14} />
                </a>
              </div>
            </div>
            <h3 className="section-title">Your access ({me.full_name})</h3>
            <table className="table compact">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Level</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(me.modules) as ModuleName[]).map((m) => (
                  <tr key={m}>
                    <td>{m}</td>
                    <td>
                      <Pill tone={LEVEL_TONE[me.modules[m]]}>{me.modules[m] === 'none' ? 'No access' : me.modules[m]}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small pad">
              Levels: View reads data · Create adds bookings, patients and invoices · Edit changes status, stock and payments · Approve cancels invoices · Manage edits settings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
