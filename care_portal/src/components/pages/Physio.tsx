import { useState } from 'react';
import { api } from '../../api';
import { Icon } from '../../icons';
import { useApi, useCare, withQuery } from '../../store';
import type { PhysioPackage, ServiceList } from '../../types';
import { inr } from '../../format';
import { Empty, ErrorNote, PageHeader, Pill, SearchBox, Tabs, useDebounced } from '../ui';
import { AES, F } from '../../flavor';

export function TherapyMasterPage() {
  const { can, openModal, mutate } = useCare();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'all'>('');
  const [busy, setBusy] = useState(false);
  const term = useDebounced(q.trim());
  const { data, error } = useApi<ServiceList>(withQuery('/services', { category: 'physiotherapy', q: term, active: status, limit: 200 }));
  const canEdit = can('Physiotherapy', 'edit');

  const sync = async () => {
    setBusy(true);
    await mutate(() => api<{ received: number; added: number; updated: number }>('/services/import-care', { method: 'POST' }), (r) => `${r.received} treatments from the catalogue · ${r.added} added · ${r.updated} updated`);
    setBusy(false);
  };

  return (
    <div className="page">
      <PageHeader
        title={AES ? 'Treatment Master' : 'Therapy Master'}
        subtitle={`${F.items} and their per-session price, used for single sessions, packages and custom plans`}
        icon="physio"
        actions={
          <>
            {AES && can('Physiotherapy', 'manage') && (
              <button type="button" className="btn btn-soft" onClick={sync} disabled={busy}>
                <Icon name="refresh" size={16} /> {busy ? 'Syncing…' : 'Sync catalogue'}
              </button>
            )}
            {can('Physiotherapy', 'create') && (
              <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'service', category: 'physiotherapy' })}>
                <Icon name="plus" size={16} /> Add {F.item.toLowerCase()}
              </button>
            )}
          </>
        }
      />
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={status}
            onChange={setStatus}
            tabs={[
              { value: '', label: 'Available' },
              { value: 'all', label: 'Include hidden' },
            ]}
          />
          <span className="spacer" />
          <SearchBox value={q} onChange={setQ} placeholder={`${F.item} name or code`} />
        </div>
        {error && <ErrorNote text={error} />}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{F.item}</th>
                <th>Duration</th>
                <th className="num">Price / session</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'dim'}>
                  <td className="wrap">
                    <strong>{s.name}</strong>
                    {s.code && <small className="block muted mono">{s.code}</small>}
                    {s.description && <small className="block muted">{s.description}</small>}
                  </td>
                  <td>{s.duration ? `${s.duration} min` : '—'}</td>
                  <td className="num">
                    <b>{inr(s.price)}</b>
                  </td>
                  <td>
                    <Pill tone={s.source === 'erp' ? 'blue' : 'grey'}>{s.source === 'erp' ? (AES ? 'Catalogue' : 'ERP') : 'Clinic'}</Pill>
                    {s.price_override ? <Pill tone="orange">Custom price</Pill> : null}
                    {!s.active && <Pill tone="grey">Hidden</Pill>}
                  </td>
                  <td className="row-actions">
                    {canEdit && (
                      <button type="button" className="icon-btn sm" onClick={() => openModal({ kind: 'service', service: s })} aria-label={`Edit ${s.name}`}>
                        <Icon name="edit" size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.items.length === 0 && <Empty text={`No ${F.items.toLowerCase()} yet.`} icon="physio" />}
        </div>
        <p className="muted small pad">
          {AES
            ? 'Treatments tagged Catalogue come from the Remedium Aesthetic service catalogue and re-sync daily (a custom price you set is kept); clinic treatments are kept only here.'
            : 'Therapies tagged ERP come from the main ERP (Physiotherapy & Rehabilitation) and re-sync daily; clinic therapies are kept only here.'}
        </p>
      </div>
    </div>
  );
}

export function PackagesPage() {
  const { can, openModal } = useCare();
  const [status, setStatus] = useState<'' | 'all'>('');
  const { data, error } = useApi<PhysioPackage[]>(withQuery('/physio/packages', { active: status }));

  return (
    <div className="page">
      <PageHeader
        title={`${AES ? 'Treatment' : 'Physiotherapy'} Packages`}
        subtitle={`Session packages offered when booking a ${F.plan}; custom packages saved at booking also appear here`}
        icon="box"
        actions={
          can('Physiotherapy', 'create') && (
            <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'physioPackage' })}>
              <Icon name="plus" size={16} /> New package
            </button>
          )
        }
      />
      <div className="card toolbar">
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { value: '', label: 'Offered' },
            { value: 'all', label: 'Include retired' },
          ]}
        />
      </div>
      {error && <ErrorNote text={error} />}
      {data && data.length === 0 && <Empty text={`No packages yet. Create one, or save a custom package while creating a ${F.plan}.`} icon="box" />}
      <div className="doctor-grid">
        {data?.map((p) => (
          <div key={p.id} className={`card package-card ${p.active ? '' : 'dim'}`}>
            <div className="card-head">
              <div>
                <h2>{p.name}</h2>
                <p className="muted small">
                  {p.code} · {p.sessions} sessions{p.validity_days ? ` · valid ${p.validity_days} days` : ''}
                </p>
              </div>
              <div className="doctor-fee">
                <small>Package price</small>
                <strong>{inr(p.price)}</strong>
              </div>
            </div>
            <div className="test-options">
              {p.therapies.map((t) => (
                <span key={t.service_id} className="chip">
                  {t.name} <b>{inr(t.price)}</b>
                </span>
              ))}
            </div>
            <div className="doctor-stats">
              <span>
                <b>{inr(p.per_session)}</b> per session
              </span>
              <span>
                List <b>{inr(p.list_value)}</b>
              </span>
              {p.saving_pct > 0 && <Pill tone="green">Save {p.saving_pct}%</Pill>}
              <span>
                <b>{p.sold}</b> sold
              </span>
            </div>
            {p.description && <p className="small muted">{p.description}</p>}
            <div className="action-row">
              {can('Appointments', 'create') && p.active ? (
                <button type="button" className="btn btn-soft sm" onClick={() => openModal({ kind: 'plan', packageId: p.id })}>
                  <Icon name="calendar" size={14} /> Book this package
                </button>
              ) : null}
              {can('Physiotherapy', 'edit') && (
                <button type="button" className="btn btn-ghost sm" onClick={() => openModal({ kind: 'physioPackage', pkg: p })}>
                  <Icon name="edit" size={14} /> Edit
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
