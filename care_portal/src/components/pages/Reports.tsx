import { useState } from 'react';
import { Icon } from '../../icons';
import { useApi, useCare, withQuery } from '../../store';
import type { Invoice } from '../../types';
import { addDays, downloadCsv, fmtDate, inr, lakh, num, todayIst, TYPE_LABEL } from '../../format';
import { Empty, ErrorNote, Loading, PageHeader, Pill, StatCard } from '../ui';

type Line = { type: string; name: string; qty: number; amount: number };

type ReportData = {
  from: string;
  to: string;
  summary: { invoices: number; billed: number; discount: number; collected: number; outstanding: number; newPatients: number; average: number };
  byType: { type: string; count: number; amount: number }[];
  byMode: { mode: string; count: number; amount: number }[];
  daily: { date: string; amount: number; count: number }[];
  topServices: Line[];
  topMedicines: Line[];
  clinical: { type: string; total: number; completed: number; noShow: number; cancelled: number; open: number }[];
  staff: { name: string; role: string; appointments: number; completed: number; value: number }[];
  plans: { active: number | null; completed: number | null; discontinued: number | null };
  dues: Invoice[];
  stock: { items: number; value: number; low: number | null };
  consumption: { name: string; unit: string; qty: number; kind: string }[];
};

const TYPE_COLOR: Record<string, string> = { consultation: '#16a34a', physiotherapy: '#8b5cf6', lab: '#3b82f6', diagnostic: '#0d9488', pharmacy: '#f59e0b', other: '#94a3b8' };

function Bars({ data }: { data: { date: string; amount: number }[] }) {
  const max = Math.max(...data.map((d) => d.amount), 1);
  if (!data.length) return <Empty text="No billing in this period." icon="chart" />;
  return (
    <div className="bars" role="img" aria-label="Daily billing">
      {data.map((d) => (
        <div key={d.date} className="bar-col" title={`${fmtDate(d.date)}: ${inr(d.amount)}`}>
          <i style={{ height: `${(d.amount / max) * 100}%` }} />
        </div>
      ))}
      <span className="bars-axis">
        <span>{fmtDate(data[0].date, false)}</span>
        <span>max {lakh(max)}</span>
        <span>{fmtDate(data[data.length - 1].date, false)}</span>
      </span>
    </div>
  );
}

function Split({ rows, label }: { rows: { key: string; label: string; amount: number; count: number; color?: string }[]; label: string }) {
  const total = rows.reduce((s, r) => s + r.amount, 0) || 1;
  return (
    <div className="split">
      <h3>{label}</h3>
      {rows.length === 0 && <p className="muted small">No data.</p>}
      {rows.map((r) => (
        <div key={r.key} className="split-row">
          <span>{r.label}</span>
          <div className="bar">
            <i style={{ width: `${(r.amount / total) * 100}%`, background: r.color }} />
          </div>
          <b>{inr(r.amount)}</b>
          <small className="muted">{Math.round((r.amount / total) * 100)}% · {r.count}</small>
        </div>
      ))}
    </div>
  );
}

export function ReportsPage({ section }: { section: 'revenue' | 'clinical' | 'stock' }) {
  const { branch, openModal } = useCare();
  const [to, setTo] = useState(todayIst());
  const [from, setFrom] = useState(addDays(todayIst(), -29));
  const { data, error } = useApi<ReportData>(withQuery('/reports', { from, to, branch }));
  const preset = (days: number) => {
    setTo(todayIst());
    setFrom(addDays(todayIst(), -(days - 1)));
  };
  const titles = { revenue: 'Revenue & Billing', clinical: 'Clinical Activity', stock: 'Stock & Pharmacy' };

  const exportCsv = () => {
    if (!data) return;
    if (section === 'revenue') {
      downloadCsv(`revenue-${from}-to-${to}.csv`, ['Service', 'Type', 'Qty', 'Amount'], [...data.topServices, ...data.topMedicines].map((l) => [l.name, TYPE_LABEL[l.type], l.qty, l.amount]));
    } else if (section === 'clinical') {
      downloadCsv(`clinical-${from}-to-${to}.csv`, ['Staff', 'Role', 'Appointments', 'Completed', 'Value'], data.staff.map((s) => [s.name, s.role, s.appointments, s.completed, s.value]));
    } else {
      downloadCsv(`stock-usage-${from}-to-${to}.csv`, ['Item', 'Movement', 'Qty', 'Unit'], data.consumption.map((c) => [c.name, c.kind, c.qty, c.unit]));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={titles[section]}
        subtitle={`Reports & Analytics · ${fmtDate(from)} – ${fmtDate(to)}`}
        icon="chart"
        actions={
          <button type="button" className="btn btn-ghost" onClick={exportCsv}>
            <Icon name="download" size={16} /> Export CSV
          </button>
        }
      />
      <div className="card toolbar">
        <button type="button" className="btn btn-ghost sm" onClick={() => preset(7)}>
          7 days
        </button>
        <button type="button" className="btn btn-ghost sm" onClick={() => preset(30)}>
          30 days
        </button>
        <button type="button" className="btn btn-ghost sm" onClick={() => preset(90)}>
          90 days
        </button>
        <label className="inline-field">
          From <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="inline-field">
          To <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
      </div>
      {error && <ErrorNote text={error} />}
      {!data && !error && <Loading />}

      {data && section === 'revenue' && (
        <>
          <div className="stats six">
            <StatCard label="Billed" value={inr(data.summary.billed)} icon="invoice" tone="blue" />
            <StatCard label="Collected" value={inr(data.summary.collected)} icon="check" tone="green" />
            <StatCard label="Outstanding (all time)" value={inr(data.summary.outstanding)} icon="alert" tone="red" />
            <StatCard label="Invoices" value={num(data.summary.invoices)} icon="clipboard" tone="orange" />
            <StatCard label="Average bill" value={inr(data.summary.average)} icon="rupee" tone="purple" />
            <StatCard label="New patients" value={num(data.summary.newPatients)} icon="userPlus" tone="teal" />
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Daily billing</h2>
            </div>
            <Bars data={data.daily} />
          </div>
          <div className="dash-row">
            <div className="card">
              <Split label="By service" rows={data.byType.map((r) => ({ key: r.type, label: TYPE_LABEL[r.type], amount: r.amount, count: r.count, color: TYPE_COLOR[r.type] }))} />
            </div>
            <div className="card">
              <Split label="By payment mode" rows={data.byMode.map((r) => ({ key: r.mode, label: r.mode, amount: r.amount, count: r.count }))} />
            </div>
          </div>
          <div className="dash-row">
            <div className="card">
              <div className="card-head">
                <h2>Top services</h2>
              </div>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th className="num">Qty</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topServices.map((l) => (
                    <tr key={`${l.type}${l.name}`}>
                      <td>{l.name}</td>
                      <td className="num">{num(l.qty)}</td>
                      <td className="num">{inr(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Largest dues</h2>
              </div>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Patient</th>
                    <th className="num">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dues.map((i) => (
                    <tr key={i.id} className="clickable" onClick={() => openModal({ kind: 'viewInvoice', id: i.id })}>
                      <td className="mono">{i.number}</td>
                      <td>{i.patient}</td>
                      <td className="num neg">{inr(i.total - i.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.dues.length === 0 && <Empty text="No pending dues." icon="check" />}
            </div>
          </div>
        </>
      )}

      {data && section === 'clinical' && (
        <>
          <div className="stats">
            {data.clinical.map((c) => (
              <StatCard
                key={c.type}
                label={`${TYPE_LABEL[c.type]} bookings`}
                value={num(c.total)}
                icon={c.type === 'lab' ? 'flask' : c.type === 'physiotherapy' ? 'physio' : c.type === 'diagnostic' ? 'scan' : 'doctor'}
                tone={c.type === 'lab' ? 'blue' : c.type === 'physiotherapy' ? 'purple' : c.type === 'diagnostic' ? 'teal' : 'green'}
                foot={`${c.total ? Math.round((c.completed / c.total) * 100) : 0}% completed`}
              />
            ))}
            <StatCard label="Active therapy plans" value={num(data.plans.active)} icon="session" tone="orange" foot={`${num(data.plans.completed)} completed · ${num(data.plans.discontinued)} discontinued`} />
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Bookings by outcome</h2>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th className="num">Total</th>
                  <th className="num">Completed</th>
                  <th className="num">Open</th>
                  <th className="num">No show</th>
                  <th className="num">Cancelled</th>
                  <th className="num">No-show rate</th>
                </tr>
              </thead>
              <tbody>
                {data.clinical.map((c) => (
                  <tr key={c.type}>
                    <td>{TYPE_LABEL[c.type]}</td>
                    <td className="num">{num(c.total)}</td>
                    <td className="num">{num(c.completed)}</td>
                    <td className="num">{num(c.open)}</td>
                    <td className="num">{num(c.noShow)}</td>
                    <td className="num">{num(c.cancelled)}</td>
                    <td className="num">{c.total ? `${((c.noShow / c.total) * 100).toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Staff productivity</h2>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th className="num">Booked</th>
                  <th className="num">Completed</th>
                  <th className="num">Value of completed</th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((s) => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td>
                      <Pill tone="grey">{s.role}</Pill>
                    </td>
                    <td className="num">{num(s.appointments)}</td>
                    <td className="num">{num(s.completed)}</td>
                    <td className="num">{inr(s.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.staff.length === 0 && <Empty text="No staff activity in this period." icon="users" />}
          </div>
        </>
      )}

      {data && section === 'stock' && (
        <>
          <div className="stats">
            <StatCard label="Stock items" value={num(data.stock.items)} icon="box" tone="blue" />
            <StatCard label="Stock value (at cost)" value={inr(data.stock.value)} icon="rupee" tone="green" />
            <StatCard label="Items at reorder level" value={num(data.stock.low)} icon="alert" tone="red" />
            <StatCard label="Pharmacy sales" value={inr(data.byType.find((t) => t.type === 'pharmacy')?.amount ?? 0)} icon="pill" tone="orange" />
          </div>
          <div className="dash-row">
            <div className="card">
              <div className="card-head">
                <h2>Top selling medicines</h2>
              </div>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th className="num">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topMedicines.map((l) => (
                    <tr key={l.name}>
                      <td>{l.name}</td>
                      <td className="num">{num(l.qty)}</td>
                      <td className="num">{inr(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.topMedicines.length === 0 && <Empty text="No pharmacy sales in this period." icon="pill" />}
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Stock going out</h2>
              </div>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Movement</th>
                    <th className="num">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {data.consumption.map((c) => (
                    <tr key={`${c.name}${c.kind}`}>
                      <td>{c.name}</td>
                      <td>{c.kind}</td>
                      <td className="num">
                        {num(c.qty)} <span className="muted small">{c.unit}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.consumption.length === 0 && <Empty text="No stock movements in this period." icon="box" />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
