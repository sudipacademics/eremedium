import { Icon } from '../../icons';
import { useApi, useCare } from '../../store';
import type { Branch } from '../../types';
import { inr, num } from '../../format';
import { ErrorNote, Loading, PageHeader, Pill } from '../ui';

export function BranchesPage() {
  const { me, can, openModal, setBranch, branch } = useCare();
  const { data, error } = useApi<Branch[]>('/branches');
  return (
    <div className="page">
      <PageHeader
        title="Branch Management"
        subtitle="Care centres, contact details and today's activity"
        icon="building"
        actions={
          can('Branch Management', 'create') && !me.branches && (
            <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'branch' })}>
              <Icon name="plus" size={16} /> Add branch
            </button>
          )
        }
      />
      {error && <ErrorNote text={error} />}
      {!data && !error && <Loading />}
      <div className="branch-grid">
        {data?.map((b) => (
          <div key={b.id} className={`card branch-card ${b.active ? '' : 'dim'}`}>
            <div className="card-head">
              <div>
                <h2>{b.name}</h2>
                <p className="muted small">
                  {[b.code, b.city].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <Pill tone={b.active ? 'green' : 'grey'}>{b.active ? 'Active' : 'Inactive'}</Pill>
            </div>
            <div className="branch-stats">
              <div>
                <small>Patients</small>
                <strong>{num(b.patients)}</strong>
              </div>
              <div>
                <small>Today</small>
                <strong>{num(b.today)}</strong>
              </div>
              <div>
                <small>Revenue (30 days)</small>
                <strong>{inr(b.revenue30)}</strong>
              </div>
              <div>
                <small>Staff / Assets</small>
                <strong>
                  {b.staff} / {b.assets}
                </strong>
              </div>
            </div>
            <p className="small">{b.address || <span className="muted">No address</span>}</p>
            <p className="small muted">
              {b.manager ? `Manager: ${b.manager}` : 'No manager set'}
              {b.phone ? ` · ${b.phone}` : ''}
              {b.email ? ` · ${b.email}` : ''}
            </p>
            <p className="small">
              {b.gst_registered && b.gstin ? (
                <>
                  <Pill tone="green">GST</Pill> GSTIN <b className="mono">{b.gstin}</b>
                  {b.state ? ` · ${b.state}${b.state_code ? ` (${b.state_code})` : ''}` : ''}
                </>
              ) : (
                <span className="muted">Not GST registered</span>
              )}
            </p>
            <div className="action-row">
              {b.active ? (
                <button type="button" className="btn btn-soft sm" disabled={branch === b.id} onClick={() => setBranch(b.id)}>
                  {branch === b.id ? 'Currently viewing' : 'View this branch'}
                </button>
              ) : null}
              {can('Branch Management', 'edit') && (
                <button type="button" className="btn btn-ghost sm" onClick={() => openModal({ kind: 'branch', branch: b })}>
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
