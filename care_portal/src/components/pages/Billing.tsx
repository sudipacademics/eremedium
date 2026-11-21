import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { Icon } from '../../icons';
import { useApi, useCare, withQuery } from '../../store';
import type { Invoice, InvoiceLine } from '../../types';
import { addDays, downloadCsv, fmtStamp, inr, todayIst, TYPE_LABEL } from '../../format';
import { Empty, ErrorNote, PageHeader, Pager, Pill, SearchBox, StatCard, Tabs, TypePill, useDebounced } from '../ui';

type ListData = { total: number; billed: number; collected: number; items: Invoice[] };

const SERVICE_TABS = ['', 'consultation', 'physiotherapy', 'lab', 'diagnostic', 'pharmacy', 'other'];

export function InvoiceTable() {
  const { branch, openModal } = useCare();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [type, setType] = useState(params.get('type') || '');
  const [status, setStatus] = useState(params.get('status') || '');
  const [from, setFrom] = useState(addDays(todayIst(), -29));
  const [to, setTo] = useState(todayIst());
  const [offset, setOffset] = useState(0);
  const term = useDebounced(q.trim());
  const limit = 50;

  useEffect(() => {
    const ps = params.get('status');
    const pt = params.get('type');
    if (ps !== null) {
      setStatus(ps);
      setFrom('');
    }
    if (pt !== null && SERVICE_TABS.includes(pt)) setType(pt);
    if (ps !== null || pt !== null) setParams({}, { replace: true });
  }, [params, setParams]);
  useEffect(() => setOffset(0), [term, type, status, from, to, branch]);

  const filters = { branch, q: term, type, status, from, to };
  const { data, error } = useApi<ListData>(withQuery('/invoices', { ...filters, limit, offset }));

  const exportCsv = async () => {
    const all = await api<ListData>(withQuery('/invoices', { ...filters, limit: 200 }));
    downloadCsv(
      `remedium-care-invoices-${from || 'all'}-to-${to}.csv`,
      ['Invoice', 'Date', 'Patient', 'Type', 'Items', 'Subtotal', 'Discount', 'Total', 'Paid', 'Due', 'Status', 'Mode'],
      all.items.map((i) => {
        const items = (typeof i.items === 'string' ? JSON.parse(i.items) : i.items) as InvoiceLine[];
        return [i.number, i.created_at, i.patient, TYPE_LABEL[i.service_type], items.map((x) => `${x.name} x${x.qty}`).join('; '), i.subtotal, i.discount, i.total, i.paid, i.total - i.paid, i.status, i.payment_mode];
      }),
    );
  };

  return (
    <>
      <div className="stats">
        <StatCard label="Invoices" value={data ? data.total.toLocaleString('en-IN') : '—'} icon="invoice" tone="orange" />
        <StatCard label="Billed" value={data ? inr(data.billed) : '—'} icon="rupee" tone="blue" />
        <StatCard label="Collected" value={data ? inr(data.collected) : '—'} icon="check" tone="green" />
        <StatCard label="Outstanding" value={data ? inr(data.billed - data.collected) : '—'} icon="alert" tone="red" />
      </div>
      <div className="card">
        <div className="toolbar">
          <Tabs value={type} onChange={setType} tabs={SERVICE_TABS.map((t) => ({ value: t, label: t ? TYPE_LABEL[t] : 'All services' }))} />
        </div>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Invoice no., patient, mobile" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="due">Due (unpaid or partial)</option>
            <option>Paid</option>
            <option>Partially Paid</option>
            <option>Unpaid</option>
            <option>Cancelled</option>
          </select>
          <label className="inline-field">
            From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="inline-field">
            To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost sm" onClick={exportCsv}>
            <Icon name="download" size={15} /> CSV
          </button>
        </div>
        {error && <ErrorNote text={error} />}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice No.</th>
                <th>Date</th>
                <th>Patient</th>
                <th>Service Type</th>
                <th className="num">Total</th>
                <th className="num">Paid</th>
                <th>Status</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((i) => (
                <tr key={i.id} className={`clickable ${i.status === 'Cancelled' ? 'dim' : ''}`} onClick={() => openModal({ kind: 'viewInvoice', id: i.id })}>
                  <td className="mono">{i.number}</td>
                  <td className="nowrap">{fmtStamp(i.created_at)}</td>
                  <td>{i.patient}</td>
                  <td>
                    <TypePill type={i.service_type} />
                  </td>
                  <td className="num">{inr(i.total)}</td>
                  <td className="num">{inr(i.paid)}</td>
                  <td>
                    <Pill status={i.status} />
                  </td>
                  <td>{i.payment_mode || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.items.length === 0 && <Empty text="No invoices for these filters." icon="invoice" />}
        </div>
        {data && <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />}
      </div>
    </>
  );
}

export function BillingPage() {
  const { can, openModal } = useCare();
  const [view, setView] = useState<'invoices' | 'sessions'>('invoices');
  return (
    <div className="page">
      <PageHeader
        title="Billing & Invoice"
        subtitle="All billing in one place: consultation, physiotherapy, lab, diagnostics and pharmacy sales"
        icon="invoice"
        actions={
          <>
            {(can('Billing & Invoice', 'create') || can('Pharmacy', 'create')) && (
              <button type="button" className="btn btn-soft" onClick={() => openModal({ kind: 'invoice', type: 'pharmacy' })}>
                <Icon name="pill" size={16} /> Pharmacy sale
              </button>
            )}
            {can('Billing & Invoice', 'create') && (
              <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'invoice' })}>
                <Icon name="plus" size={16} /> Generate invoice
              </button>
            )}
          </>
        }
      />
      <div className="card toolbar">
        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { value: 'invoices', label: 'Invoices' },
            { value: 'sessions', label: 'Physio session invoices' },
          ]}
        />
      </div>
      {view === 'invoices' ? <InvoiceTable /> : <SessionBillTable />}
    </div>
  );
}

type SessionRow = {
  id: number;
  number: string;
  patient: string;
  mobile: string | null;
  session_no: number;
  session_of: number;
  amount: number;
  package_name: string;
  package_total: number;
  paid_to_date: number;
  balance: number;
  created_at: string;
  updated_at: string | null;
};

function SessionBillTable() {
  const { branch, openModal } = useCare();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const term = useDebounced(q.trim());
  const limit = 50;
  useEffect(() => setOffset(0), [term, branch]);
  const { data, error } = useApi<{ total: number; items: SessionRow[] }>(withQuery('/session-bills', { branch, q: term, limit, offset }));
  return (
    <div className="card">
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Session invoice no., patient, mobile" />
        <span className="spacer" />
        <span className="muted small">One per completed package session; the money is on the package invoice.</span>
      </div>
      {error && <ErrorNote text={error} />}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Session invoice</th>
              <th>Issued</th>
              <th>Patient</th>
              <th>Package</th>
              <th>Session</th>
              <th className="num">Value</th>
              <th className="num">Package paid</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => openModal({ kind: 'sessionBill', id: s.id })}>
                <td className="mono">{s.number}</td>
                <td className="nowrap">{fmtStamp(s.updated_at || s.created_at)}</td>
                <td>{s.patient}</td>
                <td className="wrap">{s.package_name}</td>
                <td>
                  {s.session_no} of {s.session_of}
                </td>
                <td className="num">{inr(s.amount)}</td>
                <td className="num">
                  {inr(s.paid_to_date)} <span className="muted small">/ {inr(s.package_total)}</span>
                </td>
                <td className={`num ${s.balance > 0 ? 'neg' : ''}`}>{s.balance > 0 ? inr(s.balance) : 'Paid'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <Empty text="No session invoices yet. They are issued when package sessions are completed." icon="invoice" />}
      </div>
      {data && <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />}
    </div>
  );
}
