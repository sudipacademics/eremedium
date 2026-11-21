import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Icon } from '../../icons';
import { useApi, useCare, withQuery } from '../../store';
import type { Appointment, ServiceList, SyncResult } from '../../types';
import { downloadCsv, fmtStamp, inr, todayIst } from '../../format';
import { Empty, ErrorNote, PageHeader, Pager, Pill, SearchBox, StatCard, Tabs, useDebounced } from '../ui';
import { AppointmentList } from './Appointments';

export function DiagnosticsPage() {
  const { can, openModal, branch } = useCare();
  const { data } = useApi<{ counts: Record<string, number>; items: Appointment[] }>(withQuery('/appointments', { type: 'diagnostic', date: todayIst(), branch, limit: 1 }));
  const c = data?.counts || {};
  return (
    <div className="page">
      <PageHeader
        title="Diagnostic Bookings"
        subtitle="X-ray, ultrasound, ECG, echo, NCV / EMG and other diagnostic tests with reporting"
        icon="scan"
        actions={
          can('Diagnostics', 'create') && (
            <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'appointment', type: 'diagnostic' })}>
              <Icon name="plus" size={16} /> Book diagnostic test
            </button>
          )
        }
      />
      <div className="stats">
        <StatCard label="Scheduled today" value={c.Scheduled || 0} icon="calendar" tone="indigo" />
        <StatCard label="Checked in / in progress" value={(c['Checked In'] || 0) + (c['In Session'] || 0)} icon="session" tone="blue" />
        <StatCard label="Awaiting report" value={c['Report Pending'] || 0} icon="clipboard" tone="purple" />
        <StatCard label="Reported today" value={c.Reported || 0} icon="check" tone="green" />
      </div>
      <AppointmentList type="diagnostic" />
    </div>
  );
}

function syncSummary(r: SyncResult) {
  const parts = [`${r.received} services received`];
  if (r.added) parts.push(`${r.added} added`);
  if (r.updated) parts.push(`${r.updated} updated`);
  if (r.linked) parts.push(`${r.linked} linked`);
  if (r.hidden) parts.push(`${r.hidden} hidden`);
  if (!r.added && !r.updated && !r.linked && !r.hidden) parts.push('no changes');
  return parts.join(' · ');
}

export function DiagnosticMasterPage() {
  const { can, openModal, mutate } = useCare();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [modality, setModality] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const term = useDebounced(q.trim());
  const limit = 50;
  useEffect(() => setOffset(0), [term, group, modality, status]);
  const query = { category: 'diagnostic', q: term, group, modality, active: status === 'all' ? 'all' : '' };
  const { data, error } = useApi<ServiceList>(withQuery('/services', { ...query, limit, offset }));
  const canAdd = can('Diagnostics', 'create');
  const canEdit = can('Diagnostics', 'edit');
  const canSync = can('Diagnostics', 'manage') || can('Settings', 'manage');

  const sync = async () => {
    setBusy(true);
    await mutate(() => api<SyncResult>('/services/import-care', { method: 'POST' }), (r) => `ERP catalogue synced: ${syncSummary(r)}`);
    setBusy(false);
  };

  const exportCsv = async () => {
    const all = await api<ServiceList>(withQuery('/services', { ...query, limit: 500 }));
    downloadCsv(
      'remedium-care-diagnostic-tests.csv',
      ['ERP code', 'Test', 'Department', 'Modality', 'Body part', 'Rate', 'MRP', 'Report in (h)', 'Preparation', 'Active'],
      all.items.map((s) => [s.code, s.name, s.lab_group, s.modality, s.body_part, s.price, s.mrp, s.tat_hours, s.preparation, s.active ? 'Yes' : 'No']),
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Diagnostic Test Master"
        subtitle="Kept in the main ERP (Item group Diagnostics) and billable everywhere; changes here are saved to the ERP"
        icon="clipboard"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={exportCsv}>
              <Icon name="download" size={16} /> Export
            </button>
            {canSync && (
              <button type="button" className="btn btn-ghost" onClick={sync} disabled={busy}>
                <Icon name="refresh" size={16} /> {busy ? 'Syncing…' : 'Sync from ERP'}
              </button>
            )}
            {canAdd && (
              <>
                <button type="button" className="btn btn-soft" onClick={() => openModal({ kind: 'diagnosticStarter' })}>
                  <Icon name="clipboard" size={16} /> Add common tests
                </button>
                <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'diagnosticTest' })}>
                  <Icon name="plus" size={16} /> Add test
                </button>
              </>
            )}
          </>
        }
      />
      {data?.sync.at && (
        <div className="info-box sync-box">
          <Icon name="refresh" size={18} />
          <p>
            Last synced with the ERP <b>{fmtStamp(data.sync.at)}</b>
            {data.sync.by === 'auto-sync' ? ' (automatic daily sync)' : data.sync.by ? ` by ${data.sync.by}` : ''}
            {data.sync.result && <> — {syncSummary(data.sync.result)}</>}. The same sync also brings in the ERP physiotherapy and consultation prices.
          </p>
        </div>
      )}
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={group}
            onChange={setGroup}
            tabs={[{ value: '', label: 'All departments' }, ...(data?.groups || []).map((g) => ({ value: g.name, label: g.name, count: g.n }))]}
          />
          <select value={modality} onChange={(e) => setModality(e.target.value)} aria-label="Modality">
            <option value="">All modalities</option>
            {(data?.modalities || []).map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} ({m.n})
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Active only</option>
            <option value="all">Include disabled</option>
          </select>
          <span className="spacer" />
          <SearchBox value={q} onChange={setQ} placeholder="Test, modality, body part or code" />
        </div>
        {error && <ErrorNote text={error} />}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Test</th>
                <th>Modality</th>
                <th>Department</th>
                <th>Body part</th>
                <th>Report in</th>
                <th className="num">MRP</th>
                <th className="num">Rate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'dim'}>
                  <td className="wrap">
                    <strong>{s.name}</strong>
                    <small className="block muted mono">{s.code}</small>
                    {s.preparation && <small className="block muted">Prep: {s.preparation}</small>}
                  </td>
                  <td>{s.modality || '—'}</td>
                  <td>{s.lab_group || '—'}</td>
                  <td>{s.body_part || '—'}</td>
                  <td>{s.tat_hours ? `${s.tat_hours} h` : '—'}</td>
                  <td className="num muted">{s.mrp ? inr(s.mrp) : '—'}</td>
                  <td className="num">
                    <b>{inr(s.price)}</b>
                  </td>
                  <td className="row-actions">
                    {!s.active && <Pill tone="grey">Disabled</Pill>}
                    {canEdit && (
                      <button type="button" className="icon-btn sm" onClick={() => openModal({ kind: 'diagnosticTest', test: s })} aria-label={`Edit ${s.name}`}>
                        <Icon name="edit" size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.items.length === 0 && (
            <Empty
              text={term || group || modality ? 'No diagnostic tests match.' : 'No diagnostic tests yet. Use “Add common tests” or “Add test” to create the master in the ERP.'}
              icon="scan"
            />
          )}
        </div>
        {data && <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />}
      </div>
    </div>
  );
}
