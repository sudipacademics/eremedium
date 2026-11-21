import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../icons';
import { useApi, useCare, withQuery } from '../../store';
import type { Asset } from '../../types';
import { addDays, downloadCsv, fmtDate, inr, todayIst } from '../../format';
import { Empty, ErrorNote, PageHeader, Pill, SearchBox, StatCard, Tabs, useDebounced } from '../ui';

function serviceDue(a: Asset) {
  if (!a.next_service || a.status === 'Retired') return null;
  const today = todayIst();
  if (a.next_service < today) return <Pill tone="red">Overdue</Pill>;
  if (a.next_service <= addDays(today, 7)) return <Pill tone="orange">Due this week</Pill>;
  return null;
}

export function AssetsPage() {
  const { branch, can, openModal } = useCare();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState(params.get('filter') || '');
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim());

  useEffect(() => {
    const pf = params.get('filter');
    if (pf !== null) {
      setFilter(pf);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const isStatus = ['Working', 'Under Maintenance', 'Out of Order', 'Retired'].includes(filter);
  const { data, error } = useApi<{ items: Asset[] }>(withQuery('/assets', { branch, q: term, filter: filter === 'due' ? 'due' : '', status: isStatus ? filter : '' }));
  const all = useApi<{ items: Asset[] }>(withQuery('/assets', { branch })).data?.items || [];
  const count = (s: string) => all.filter((a) => a.status === s).length;
  const due = all.filter((a) => a.status !== 'Retired' && a.next_service && a.next_service <= addDays(todayIst(), 7)).length;
  const editable = can('Assets Management', 'edit');

  const exportCsv = () =>
    data &&
    downloadCsv(
      'remedium-care-assets.csv',
      ['Tag', 'Asset', 'Category', 'Branch', 'Status', 'Purchased', 'Cost', 'Vendor', 'Last service', 'Next service'],
      data.items.map((a) => [a.tag, a.name, a.category, a.branch, a.status, a.purchase_date, a.cost, a.vendor, a.last_service, a.next_service]),
    );

  return (
    <div className="page">
      <PageHeader
        title="Assets Management"
        subtitle="Therapy equipment, lab machines and clinic assets with service schedules"
        icon="monitor"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={exportCsv}>
              <Icon name="download" size={16} /> Export
            </button>
            {can('Assets Management', 'create') && (
              <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'asset' })}>
                <Icon name="plus" size={16} /> Add asset
              </button>
            )}
          </>
        }
      />
      <div className="stats">
        <StatCard label="Working" value={count('Working')} icon="check" tone="green" />
        <StatCard label="Under maintenance" value={count('Under Maintenance')} icon="wrench" tone="orange" />
        <StatCard label="Out of order" value={count('Out of Order')} icon="alert" tone="red" />
        <StatCard label="Service due (7 days)" value={due} icon="calendar" tone="blue" />
      </div>
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: '', label: 'All' },
              { value: 'due', label: 'Service due' },
              { value: 'Under Maintenance', label: 'Maintenance' },
              { value: 'Out of Order', label: 'Out of order' },
              { value: 'Retired', label: 'Retired' },
            ]}
          />
          <span className="spacer" />
          <SearchBox value={q} onChange={setQ} placeholder="Asset, tag or category" />
        </div>
        {error && <ErrorNote text={error} />}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Category</th>
                <th>Status</th>
                <th>Last service</th>
                <th>Next service</th>
                <th className="num">Cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((a) => (
                <tr key={a.id} className={a.status === 'Retired' ? 'dim' : ''}>
                  <td>
                    <button type="button" className="strong-link" onClick={() => openModal({ kind: 'assetLogs', asset: a })}>
                      {a.name}
                    </button>
                    <small className="block muted">
                      {a.tag}
                      {a.branch ? ` · ${a.branch}` : ''}
                    </small>
                  </td>
                  <td>{a.category || '—'}</td>
                  <td>
                    <Pill status={a.status} />
                  </td>
                  <td>{fmtDate(a.last_service)}</td>
                  <td>
                    {fmtDate(a.next_service)} {serviceDue(a)}
                  </td>
                  <td className="num">{a.cost ? inr(a.cost) : '—'}</td>
                  <td className="row-actions">
                    {editable && a.status !== 'Retired' && (
                      <button type="button" className="btn btn-soft sm" onClick={() => openModal({ kind: 'assetService', asset: a })}>
                        <Icon name="wrench" size={14} /> Log service
                      </button>
                    )}
                    {editable && (
                      <button type="button" className="icon-btn sm" onClick={() => openModal({ kind: 'asset', asset: a })} aria-label={`Edit ${a.name}`}>
                        <Icon name="edit" size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.items.length === 0 && <Empty text="No assets here." icon="monitor" />}
        </div>
      </div>
    </div>
  );
}
