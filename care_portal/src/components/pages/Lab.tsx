import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Icon } from '../../icons';
import { useApi, useCare, withQuery } from '../../store';
import type { LabList, ServiceList, SyncResult } from '../../types';
import { downloadCsv, fmtStamp, inr } from '../../format';
import { Empty, ErrorNote, PageHeader, Pager, Pill, SearchBox, StatCard, Tabs, useDebounced } from '../ui';
import { AppointmentList } from './Appointments';
import { LabStatus, openLabReport } from '../forms/LabForms';

const LAB_TABS = ['Active', 'Booked', 'In Lab', 'Processing', 'Result Ready', 'Report Ready', 'Rejected', 'Cancelled', ''];

export function LabPage({ reports = false }: { reports?: boolean }) {
  const { can, openModal, branch, toast } = useCare();
  const [status, setStatus] = useState(reports ? 'Report Ready' : 'Active');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [legacy, setLegacy] = useState(false);
  const term = useDebounced(q.trim());
  const limit = 30;
  useEffect(() => setPage(1), [term, status, branch]);
  useEffect(() => setStatus(reports ? 'Report Ready' : 'Active'), [reports]);
  const { data, error, loading } = useApi<LabList>(withQuery('/lab/bookings', { status, q: term, branch, page, limit }));
  const c = data?.counts || {};
  const { data: old } = useApi<{ total: number }>(withQuery('/appointments', { type: 'lab', limit: 1 }));

  return (
    <div className="page">
      <PageHeader
        title={reports ? 'Lab Reports' : 'Lab Bookings'}
        subtitle={
          reports
            ? 'Reports authorised by Remedium Labs for Remedium Care patients'
            : 'Remedium Care is a collection centre of Remedium Labs: book here, the lab receives the sample, reports and authorises'
        }
        icon={reports ? 'clipboard' : 'flask'}
        actions={
          can('Test & Lab', 'create') && (
            <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'appointment', type: 'lab' })}>
              <Icon name="plus" size={16} /> Book lab test
            </button>
          )
        }
      />
      {!reports && (
        <div className="stats">
          <StatCard label="In progress" value={c.Active || 0} icon="session" tone="indigo" foot={`${c.Booked || 0} waiting for the lab to receive`} />
          <StatCard label="At the lab" value={(c['In Lab'] || 0) + (c.Processing || 0)} icon="tube" tone="purple" />
          <StatCard label="Reports ready" value={c['Report Ready'] || 0} icon="check" tone="green" />
          <StatCard label="Payment due" value={c.Due || 0} icon="rupee" tone="orange" />
        </div>
      )}
      {data?.centre && (
        <div className="info-box sync-box">
          <Icon name="flask" size={18} />
          <div>
            <p>
              Centre <b>{data.centre.name}</b> · {data.centre.type} · {data.centre.pricing_rule}
              {!data.centre.active && <b className="neg"> · inactive in the ERP, bookings are blocked</b>}
            </p>
            <p className="small">Statuses, payments and reports come live from the Remedium Labs system (the same records the Lab Tech portal works on).</p>
          </div>
        </div>
      )}
      {data?.offline && <ErrorNote text={`Lab system not reachable, showing saved data: ${data.offline}`} />}
      <div className="card">
        <div className="toolbar">
          {!reports && (
            <Tabs
              value={status}
              onChange={setStatus}
              tabs={LAB_TABS.map((s) => ({ value: s, label: s || 'All', count: s === 'Active' ? c.Active : s === '' ? c.All : s === 'Report Ready' ? c['Report Ready'] : c[s] }))}
            />
          )}
          <span className="spacer" />
          <SearchBox value={q} onChange={setQ} placeholder="Patient, phone, booking ID or barcode" />
        </div>
        {error && <ErrorNote text={error} />}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Booking</th>
                <th>Patient</th>
                <th>Tests</th>
                <th>Status</th>
                <th className="num">Bill</th>
                <th>Payment</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((b) => (
                <tr key={b.id} className="clickable" onClick={() => openModal({ kind: 'labBooking', id: b.id })}>
                  <td>
                    <strong className="mono">{b.trf_id}</strong>
                    <small className="block muted">
                      {b.barcode || '—'} · {fmtStamp(b.booked_at)}
                    </small>
                  </td>
                  <td>
                    {b.patient}
                    <small className="block muted">{[b.patient_code, b.mobile].filter(Boolean).join(' · ') || '—'}</small>
                  </td>
                  <td className="wrap">{b.tests.map((t) => t.item_name).join(', ')}</td>
                  <td>
                    <LabStatus b={b} />
                  </td>
                  <td className="num">{inr(b.net)}</td>
                  <td>
                    <Pill status={b.payment_status || 'Unpaid'} />
                    {b.due > 0.009 && <small className="block neg">{inr(b.due)} due</small>}
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
          {data && data.items.length === 0 && (
            <Empty text={loading ? 'Loading…' : reports ? 'No authorised reports yet.' : term || status ? 'No lab bookings here.' : 'No lab bookings yet.'} icon="flask" />
          )}
        </div>
        {data && (page > 1 || data.items.length >= limit) && (
          <div className="pager">
            <span>Page {page}</span>
            <button type="button" className="btn btn-ghost sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
              <Icon name="chevronLeft" size={16} /> Prev
            </button>
            <button type="button" className="btn btn-ghost sm" disabled={data.items.length < limit} onClick={() => setPage(page + 1)}>
              Next <Icon name="chevronRight" size={16} />
            </button>
          </div>
        )}
      </div>
      {!reports && (old?.total || 0) > 0 && (
        <div className="card">
          <button type="button" className="link" onClick={() => setLegacy((v) => !v)}>
            {legacy ? 'Hide' : 'Show'} older clinic lab records ({old?.total}) — read-only, from before lab bookings moved to Remedium Labs
          </button>
          {legacy && <AppointmentList type="lab" />}
        </div>
      )}
    </div>
  );
}

function syncSummary(r: SyncResult) {
  const parts = [`${r.received} tests received`];
  if (r.added) parts.push(`${r.added} added`);
  if (r.updated) parts.push(`${r.updated} updated`);
  if (r.linked) parts.push(`${r.linked} linked to clinic tests`);
  if (r.hidden) parts.push(`${r.hidden} hidden (no longer in ERP)`);
  if (!r.added && !r.updated && !r.linked && !r.hidden) parts.push('no changes');
  return parts.join(' · ');
}

function tat(hours: number | null | undefined) {
  if (!hours) return '—';
  return hours % 24 === 0 ? `${hours / 24} day${hours > 24 ? 's' : ''}` : `${hours} h`;
}

export function LabCatalogPage() {
  const { can, openModal, mutate } = useCare();
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [group, setGroup] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const term = useDebounced(q.trim());
  const limit = 50;
  useEffect(() => setOffset(0), [term, source, group, status]);
  const query = { category: 'lab', q: term, source, group, active: status === 'all' ? 'all' : '' };
  const { data, error } = useApi<ServiceList>(withQuery('/services', { ...query, limit, offset }));
  const canImport = can('Settings', 'manage') || can('Test & Lab', 'manage');
  const canEdit = can('Settings', 'edit') || can('Test & Lab', 'edit');

  const runImport = async () => {
    setBusy(true);
    await mutate(() => api<SyncResult>('/services/import-lab', { method: 'POST' }), (r) => `Test master imported: ${syncSummary(r)}`);
    setBusy(false);
  };

  const exportCsv = async () => {
    const all = await api<ServiceList>(withQuery('/services', { ...query, limit: 500 }));
    downloadCsv(
      'remedium-care-test-catalog.csv',
      ['ERP code', 'Test', 'Group', 'Sample', 'Report in (h)', 'MRP', 'Price', 'Source', 'Custom price', 'Active'],
      all.items.map((s) => [s.code, s.name, s.lab_group, s.sample_type, s.tat_hours, s.mrp, s.price, s.source === 'erp' ? 'ERP' : 'Clinic', s.price_override ? 'Yes' : '', s.active ? 'Yes' : 'No']),
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Test Catalog"
        subtitle="Lab test master imported from the Remedium Labs ERP, plus any clinic-only tests"
        icon="clipboard"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={exportCsv}>
              <Icon name="download" size={16} /> Export
            </button>
            {canEdit && (
              <button type="button" className="btn btn-soft" onClick={() => openModal({ kind: 'service', category: 'lab' })}>
                <Icon name="plus" size={16} /> Clinic-only test
              </button>
            )}
            {canImport && (
              <button type="button" className="btn btn-primary" onClick={runImport} disabled={busy}>
                <Icon name="refresh" size={16} /> {busy ? 'Importing…' : 'Import from ERP'}
              </button>
            )}
          </>
        }
      />
      <div className="info-box sync-box">
        <Icon name="refresh" size={18} />
        <div>
          {data?.sync.at ? (
            <p>
              Last imported <b>{fmtStamp(data.sync.at)}</b>
              {data.sync.by === 'auto-sync' ? ' (automatic daily sync)' : data.sync.by ? ` by ${data.sync.by}` : ''}
              {data.sync.result && <> — {syncSummary(data.sync.result)}</>}
            </p>
          ) : (
            <p>The test master has not been imported yet.</p>
          )}
          <p className="small">
            Names, MRP, sample type and report time always follow the ERP. The price follows the ERP rate unless you set a custom price on a test. Tests removed from the ERP are hidden, not
            deleted. The catalogue also syncs automatically once a day.
          </p>
        </div>
      </div>
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={source}
            onChange={setSource}
            tabs={[
              { value: '', label: 'All tests' },
              { value: 'erp', label: 'From ERP' },
              { value: 'local', label: 'Clinic only' },
            ]}
          />
          <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group">
            <option value="">All groups</option>
            {(data?.groups || []).map((g) => (
              <option key={g.name} value={g.name}>
                {g.name} ({g.n})
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Available only</option>
            <option value="all">Include hidden</option>
          </select>
          <span className="spacer" />
          <SearchBox value={q} onChange={setQ} placeholder="Test name, ERP code or group" />
        </div>
        {error && <ErrorNote text={error} />}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Test</th>
                <th>Group</th>
                <th>Sample</th>
                <th>Report in</th>
                <th className="num">MRP</th>
                <th className="num">Price</th>
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
                  </td>
                  <td>{s.lab_group || '—'}</td>
                  <td>{s.sample_type || '—'}</td>
                  <td>{tat(s.tat_hours)}</td>
                  <td className="num muted">{s.mrp ? inr(s.mrp) : '—'}</td>
                  <td className="num">
                    <b>{inr(s.price)}</b>
                  </td>
                  <td>
                    <Pill tone={s.source === 'erp' ? 'blue' : 'grey'}>{s.source === 'erp' ? 'ERP' : 'Clinic'}</Pill>
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
          {data && data.items.length === 0 && (
            <Empty text={data.sync.at || term ? 'No tests match.' : 'No tests yet. Use “Import from ERP” to load the Remedium Labs test master.'} icon="flask" />
          )}
        </div>
        {data && <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />}
      </div>
    </div>
  );
}
