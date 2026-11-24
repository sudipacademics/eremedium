import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ASSETS,
  BRANCHES,
  MOVES,
  NETWORK,
  SERVICE_JOBS,
  STOCK,
  UNIT_REVENUE,
  UNITS,
  downloadCsv,
  formatINR,
  formatNumber,
  isUnitId,
  unitById,
  type ApprovalStatus,
  type UnitId,
} from '../data';
import { Icon } from '../icons';
import { useOps } from '../store';
import { Empty, PageHead, Sla, StatusTag, UnitPill } from './ui';

function chipLabel(option: string) {
  return isUnitId(option) ? unitById(option).name : option;
}

function Chips<T extends string>({ value, options, onChange }: { value: T; options: T[]; onChange: (value: T) => void }) {
  return (
    <div className="chips" role="tablist">
      {options.map((option) => (
        <button key={option} type="button" role="tab" aria-selected={option === value} className={option === value ? 'on' : ''} onClick={() => onChange(option)}>
          {chipLabel(option)}
        </button>
      ))}
    </div>
  );
}

export function UnitsPage() {
  const { totals, tasks, bookings } = useOps();
  return (
    <div className="page">
      <PageHead title="Unit Operations" lede="Lab, Care, Aesthetic and Pharmacy desks across the Smilecure network." />
      <div className="unit-board">
        {UNITS.map((unit) => {
          const open = tasks.filter((task) => !task.done && task.detail.toLowerCase().includes(unit.name.toLowerCase())).length;
          const recent = bookings.filter((booking) => booking.unit === unit.id).length;
          return (
            <Link key={unit.id} to={`/units/${unit.id}`} className={`unit-board-card ${unit.id}`}>
              <span className="ic">
                <Icon name={unit.id} size={22} />
              </span>
              <h2>{unit.short}</h2>
              <p>{unit.full}</p>
              <dl>
                <div>
                  <dt>Today</dt>
                  <dd>{formatNumber(totals.today[unit.id])}</dd>
                </div>
                <div>
                  <dt>7-day bookings</dt>
                  <dd>{formatNumber(totals.week[unit.id])}</dd>
                </div>
                <div>
                  <dt>Open tasks</dt>
                  <dd>{open}</dd>
                </div>
                <div>
                  <dt>Recent rows</dt>
                  <dd>{recent}</dd>
                </div>
              </dl>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function UnitPage() {
  const { unitId } = useParams();
  const { totals, bookings, tasks, approvals } = useOps();
  if (!isUnitId(unitId)) return <Navigate to="/units" replace />;
  const unit = unitById(unitId);
  const rows = bookings.filter((booking) => booking.unit === unitId);
  const unitTasks = tasks.filter((task) => task.detail.toLowerCase().includes(unit.name.toLowerCase()));
  const pending = approvals.filter((item) => item.unit === unitId && (item.status === 'Pending' || item.status === 'In Review'));
  const branches = BRANCHES.filter((branch) => branch.unit === unitId);
  return (
    <div className="page">
      <PageHead title={unit.short} lede={unit.full} actions={<Link className="btn ghost" to="/units">All units</Link>} />
      <section className="kpi-row four">
        <article className="kpi">
          <div className="label">Today</div>
          <div className="value">{formatNumber(totals.today[unitId])}</div>
          <div className="sub">{unitId === 'pharmacy' ? 'Orders' : 'Bookings'}</div>
        </article>
        <article className="kpi">
          <div className="label">Last 7 days</div>
          <div className="value">{formatNumber(totals.week[unitId])}</div>
          <div className="sub">Bookings in the trend</div>
        </article>
        <article className="kpi">
          <div className="label">Period revenue</div>
          <div className="value">{formatINR(UNIT_REVENUE[unitId])}</div>
          <div className="sub">Share of network revenue</div>
        </article>
        <article className="kpi">
          <div className="label">Branches on this desk</div>
          <div className="value">{branches.length}</div>
          <div className="sub">{branches.filter((branch) => branch.sla < 95).length} below SLA target</div>
        </article>
      </section>
      <div className="two">
        <article className="card">
          <div className="card-head">
            <h3>Recent bookings</h3>
            <Link to="/bookings" className="linkish">View All →</Link>
          </div>
          {rows.length === 0 ? <Empty text="No bookings on this desk yet." /> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Service</th>
                    <th>When</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((booking) => (
                    <tr key={booking.id}>
                      <td>
                        <strong>{booking.patient}</strong>
                        <span className="muted">{booking.id}</span>
                      </td>
                      <td>{booking.service}</td>
                      <td>{booking.when}</td>
                      <td><StatusTag value={booking.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
        <div className="stack">
          <article className="card">
            <div className="card-head"><h3>Open work</h3></div>
            {unitTasks.length === 0 ? <Empty text="No tasks tagged to this unit." /> : unitTasks.map((task) => (
              <div key={task.id} className="plain-row">
                <strong>{task.title}</strong>
                <span className="muted">{task.detail}</span>
              </div>
            ))}
          </article>
          <article className="card">
            <div className="card-head">
              <h3>Waiting on approval</h3>
              <Link to="/approvals" className="linkish">View All →</Link>
            </div>
            {pending.length === 0 ? <Empty text="Nothing waiting." /> : pending.slice(0, 5).map((item) => (
              <div key={item.id} className="plain-row">
                <strong>{item.title}</strong>
                <span className="muted">{item.status} · {item.age}</span>
              </div>
            ))}
          </article>
        </div>
      </div>
    </div>
  );
}

export function BookingsPage() {
  const { bookings, openModal } = useOps();
  const [unit, setUnit] = useState<'All' | UnitId>('All');
  const [q, setQ] = useState('');
  const rows = bookings.filter((booking) => {
    if (unit !== 'All' && booking.unit !== unit) return false;
    const blob = `${booking.patient} ${booking.id} ${booking.branch} ${booking.service}`.toLowerCase();
    return blob.includes(q.trim().toLowerCase());
  });
  return (
    <div className="page">
      <PageHead
        title="Bookings & Orders"
        lede="Live booking and pharmacy order queue across every unit."
        actions={<button type="button" className="btn primary" onClick={() => openModal('booking')}>Create Booking</button>}
      />
      <div className="toolbar">
        <Chips value={unit} options={['All', ...UNITS.map((item) => item.id)] as ('All' | UnitId)[]} onChange={setUnit} />
        <input className="field" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search patient, id, branch" />
      </div>
      <article className="card">
        {rows.length === 0 ? <Empty text="No bookings match this filter." /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Patient</th>
                  <th>Unit</th>
                  <th>Branch</th>
                  <th>Service</th>
                  <th>When</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((booking) => (
                  <tr key={booking.id}>
                    <td className="num">{booking.id}</td>
                    <td><strong>{booking.patient}</strong></td>
                    <td><UnitPill id={booking.unit} /></td>
                    <td>{booking.branch}</td>
                    <td>{booking.service}</td>
                    <td>{booking.when}</td>
                    <td className="num">{formatINR(booking.amount)}</td>
                    <td><StatusTag value={booking.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

export function ServicesPage() {
  const { tasks, toggleTask, openModal } = useOps();
  const [unit, setUnit] = useState<'All' | UnitId>('All');
  const jobs = SERVICE_JOBS.filter((job) => unit === 'All' || job.unit === unit);
  return (
    <div className="page">
      <PageHead
        title="Service Operations"
        lede="Appointments, home visits and deliveries. Delayed Care and Aesthetic work is called out for follow-up."
        actions={<button type="button" className="btn primary" onClick={() => openModal('task')}>Assign Task</button>}
      />
      <article className="card" id="tasks">
        <div className="card-head"><h3>Operations tasks</h3></div>
        {tasks.map((task) => (
          <div key={task.id} className={`task${task.done ? ' done' : ''}`}>
            <button type="button" className="check" aria-pressed={task.done} aria-label={`Toggle ${task.title}`} onClick={() => toggleTask(task.id)}>
              {task.done ? <Icon name="check" size={12} /> : null}
            </button>
            <div>
              <div className="title">{task.title}</div>
              <div className="muted">{task.detail}</div>
            </div>
            <span className={`pri ${task.done ? 'done' : task.priority.toLowerCase()}`}>{task.done ? 'Done' : task.priority}</span>
          </div>
        ))}
      </article>
      <div className="toolbar">
        <Chips value={unit} options={['All', ...UNITS.map((item) => item.id)] as ('All' | UnitId)[]} onChange={setUnit} />
      </div>
      <article className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Job</th>
                <th>Patient</th>
                <th>Unit</th>
                <th>Branch</th>
                <th>Service</th>
                <th>Slot</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="num">{job.id}</td>
                  <td><strong>{job.patient}</strong></td>
                  <td><UnitPill id={job.unit} /></td>
                  <td>{job.branch}</td>
                  <td>{job.service}</td>
                  <td>{job.slot}</td>
                  <td><StatusTag value={job.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export function LogisticsPage() {
  const [kind, setKind] = useState<'All' | (typeof MOVES)[number]['kind']>('All');
  const rows = MOVES.filter((move) => kind === 'All' || move.kind === kind);
  const kinds = ['All', 'Sample pickup', 'Sample dispatch', 'Pharmacy delivery', 'Equipment'] as const;
  return (
    <div className="page">
      <PageHead title="Logistics & Collection" lede="Sample pickups, lab dispatch, pharmacy delivery and equipment movement." />
      <div className="toolbar">
        <Chips value={kind} options={[...kinds]} onChange={setKind} />
      </div>
      <article className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Move</th>
                <th>Type</th>
                <th>Unit</th>
                <th>From</th>
                <th>To</th>
                <th>Handler</th>
                <th>Slot</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((move) => (
                <tr key={move.id}>
                  <td className="num">{move.id}</td>
                  <td>{move.kind}</td>
                  <td><UnitPill id={move.unit} /></td>
                  <td>{move.from}</td>
                  <td>{move.to}</td>
                  <td>{move.handler}</td>
                  <td>{move.slot}</td>
                  <td><StatusTag value={move.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export function InventoryPage() {
  const { openModal, requisitions } = useOps();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [onlyLow, setOnlyLow] = useState(params.get('view') !== 'all');
  const rows = STOCK.filter((item) => !onlyLow || item.stock < item.reorder);
  return (
    <div className="page">
      <PageHead
        title="Inventory & Purchase"
        lede="Pharmacy low stock is the current purchase pressure. Raising a requisition sends it to Approvals."
        actions={<button type="button" className="btn primary" onClick={() => openModal('requisition', { unit: 'pharmacy', branch: 'Ashoknagar Pharmacy' })}>Raise Requisition</button>}
      />
      <div className="toolbar">
        <Chips
          value={onlyLow ? 'Low stock' : 'All items'}
          options={['Low stock', 'All items', 'Pharmacy', 'Aesthetic']}
          onChange={(value) =>
            value === 'Pharmacy' ? navigate('/inventory/pharmacy') : value === 'Aesthetic' ? navigate('/inventory/aesthetic?cat=consumables') : setOnlyLow(value === 'Low stock')
          }
        />
      </div>
      <article className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th>Unit</th>
                <th>Branch</th>
                <th>Stock</th>
                <th>Reorder</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const low = item.stock < item.reorder;
                return (
                  <tr key={item.id}>
                    <td><strong>{item.name}</strong><span className="muted">{item.id}</span></td>
                    <td><UnitPill id={item.unit} /></td>
                    <td>{item.branch}</td>
                    <td className="num">{item.stock} {item.uom}</td>
                    <td className="num">{item.reorder}</td>
                    <td>
                      {low ? (
                        <button type="button" className="btn tiny" onClick={() => openModal('requisition', { item: item.name, unit: item.unit, branch: item.branch })}>
                          Raise
                        </button>
                      ) : <span className="muted">In range</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
      {requisitions.length > 0 ? (
        <article className="card">
          <div className="card-head"><h3>Raised this session</h3></div>
          {requisitions.map((item) => (
            <div key={item.id} className="plain-row">
              <strong>{item.item} · qty {item.qty}</strong>
              <span className="muted">{item.id} · {item.branch} · {item.age}</span>
            </div>
          ))}
        </article>
      ) : null}
    </div>
  );
}

export function QualityPage() {
  const { issues, openModal } = useOps();
  const below = BRANCHES.filter((branch) => branch.sla < NETWORK.slaTarget);
  return (
    <div className="page">
      <PageHead
        title="Quality & Compliance"
        lede={`Network SLA is 96.8% against a ${NETWORK.slaTarget}% target. ${below.length} branches are under the line.`}
        actions={<button type="button" className="btn primary" onClick={() => openModal('issue')}>Log Issue</button>}
      />
      <div className="two">
        <article className="card">
          <div className="card-head"><h3>Branches below target SLA</h3></div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Unit</th>
                  <th>SLA</th>
                </tr>
              </thead>
              <tbody>
                {below.map((branch) => (
                  <tr key={branch.id}>
                    <td><strong>{branch.name}</strong><span className="muted">{branch.area}</span></td>
                    <td><UnitPill id={branch.unit} /></td>
                    <td><Sla value={branch.sla} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="card">
          <div className="card-head"><h3>Desk checklist</h3></div>
          <ul className="checks">
            <li>Sample rejection log reviewed for Central Health Hub</li>
            <li>Cold-chain excursion at Kalyani Pharmacy is in approvals</li>
            <li>Schedule H register at Ashoknagar is in review</li>
            <li>Analyzer calibration sign-off is waiting on the pathologist</li>
            <li>Care credential renewal is with the people desk</li>
          </ul>
          {issues.length > 0 ? (
            <div className="stack-tight">
              <h3>Logged this session</h3>
              {issues.map((issue) => (
                <div key={issue.id} className="plain-row">
                  <strong>{issue.title}</strong>
                  <span className="muted">{issue.id} · {unitById(issue.unit).name} · {issue.severity}</span>
                </div>
              ))}
            </div>
          ) : null}
        </article>
      </div>
    </div>
  );
}

const TABS: ApprovalStatus[] = ['Pending', 'In Review', 'Approved', 'Rejected'];

export function ApprovalsPage() {
  const { approvals, approvalCounts, setApprovalStatus } = useOps();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as ApprovalStatus | null;
  const tab: ApprovalStatus = requested && TABS.includes(requested) ? requested : 'Pending';
  const rows = approvals.filter((item) => item.status === tab);
  const countFor = (status: ApprovalStatus) =>
    status === 'Pending' ? approvalCounts.pending : status === 'In Review' ? approvalCounts.review : status === 'Approved' ? approvalCounts.approved : approvalCounts.rejected;

  return (
    <div className="page">
      <PageHead title="Approvals" lede="Purchase, HR, quality and pricing decisions waiting on the operations desk." />
      <div className="toolbar">
        <div className="chips" role="tablist">
          {TABS.map((status) => (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={status === tab}
              className={status === tab ? 'on' : ''}
              onClick={() => setParams({ tab: status })}
            >
              {status} ({countFor(status)})
            </button>
          ))}
        </div>
      </div>
      <article className="card">
        {tab === 'Approved' ? <p className="fine">42 earlier approvals this period are closed and not listed. The rows below are the latest.</p> : null}
        {rows.length === 0 ? <Empty text={`No ${tab.toLowerCase()} items.`} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Type</th>
                  <th>Unit</th>
                  <th>Requester</th>
                  <th>Age</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.title}</strong><span className="muted">{item.id}</span></td>
                    <td>{item.type}</td>
                    <td><UnitPill id={item.unit} /></td>
                    <td>{item.requester}</td>
                    <td>{item.age}</td>
                    <td className="actions">
                      {item.status === 'Pending' || item.status === 'In Review' ? (
                        <>
                          {item.status === 'Pending' ? (
                            <button type="button" className="btn tiny ghost" onClick={() => setApprovalStatus(item.id, 'In Review')}>Review</button>
                          ) : null}
                          <button type="button" className="btn tiny" onClick={() => setApprovalStatus(item.id, 'Approved')}>Approve</button>
                          <button type="button" className="btn tiny danger" onClick={() => setApprovalStatus(item.id, 'Rejected')}>Reject</button>
                        </>
                      ) : <StatusTag value={item.status} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

export function AssetsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'All';
  const options = ['All', 'In Service', 'Under Service', 'Inactive'];
  const rows = ASSETS.filter((asset) => status === 'All' || asset.status === status);
  return (
    <div className="page">
      <PageHead
        title="Assets"
        lede={`${formatNumber(NETWORK.assets)} assets on the register · ${formatNumber(NETWORK.inService)} in service · ${NETWORK.underService} under service · ${NETWORK.inactive} inactive.`}
      />
      <div className="stat-strip">
        <button type="button" className={status === 'All' ? 'on' : ''} onClick={() => setParams({})}>{formatNumber(NETWORK.assets)} Total</button>
        <button type="button" className={status === 'In Service' ? 'on' : ''} onClick={() => setParams({ status: 'In Service' })}>{formatNumber(NETWORK.inService)} In Service</button>
        <button type="button" className={status === 'Under Service' ? 'on' : ''} onClick={() => setParams({ status: 'Under Service' })}>{NETWORK.underService} Under Service</button>
        <button type="button" className={status === 'Inactive' ? 'on' : ''} onClick={() => setParams({ status: 'Inactive' })}>{NETWORK.inactive} Inactive</button>
      </div>
      <div className="toolbar">
        <Chips value={options.includes(status) ? status : 'All'} options={options} onChange={(value) => setParams(value === 'All' ? {} : { status: value })} />
      </div>
      <article className="card">
        <p className="fine">Working sample from the register. Company totals stay in the strip above.</p>
        {rows.length === 0 ? <Empty text="No assets in this status in the sample." /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Unit</th>
                  <th>Branch</th>
                  <th>Next service</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((asset) => (
                  <tr key={asset.id}>
                    <td><strong>{asset.name}</strong><span className="muted">{asset.id}</span></td>
                    <td><UnitPill id={asset.unit} /></td>
                    <td>{asset.branch}</td>
                    <td>{asset.next}</td>
                    <td><StatusTag value={asset.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

export function ReportsPage() {
  const { bookings, totals } = useOps();
  const bars = useMemo(() => {
    return UNITS.map((unit) => {
      const extra = bookings.filter((booking) => booking.session && booking.unit === unit.id).reduce((sum, booking) => sum + booking.amount, 0);
      return { ...unit, revenue: UNIT_REVENUE[unit.id] + extra, bookings: totals.week[unit.id] };
    });
  }, [bookings, totals.week]);
  const max = Math.max(...bars.map((bar) => bar.revenue));
  const maxBookings = Math.max(...bars.map((bar) => bar.bookings));
  return (
    <div className="page">
      <PageHead
        title="Reports & Analytics"
        lede="Period picture for bookings, revenue and branch SLA. Export the branch table for the operations review."
        actions={
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              downloadCsv('smilecure-branch-performance.csv', [
                ['Branch', 'Area', 'Unit', 'Bookings', 'Revenue', 'SLA'],
                ...BRANCHES.map((branch) => [branch.name, branch.area, unitById(branch.unit).name, branch.bookings, branch.revenue, branch.sla]),
              ])
            }
          >
            <Icon name="download" size={16} /> Export CSV
          </button>
        }
      />
      <div className="two">
        <article className="card">
          <div className="card-head"><h3>Revenue by unit</h3></div>
          <div className="bars">
            {bars.map((bar) => (
              <div key={bar.id} className="bar-row">
                <span>{bar.name}</span>
                <div className="track">
                  <div className={bar.id} style={{ width: `${Math.max(8, (bar.revenue / max) * 100)}%` }} />
                </div>
                <b>{formatINR(bar.revenue)}</b>
              </div>
            ))}
          </div>
          <p className="fine">Network revenue {formatINR(totals.revenue)} · {formatNumber(totals.bookings)} bookings</p>
        </article>
        <article className="card">
          <div className="card-head"><h3>7-day bookings</h3></div>
          <div className="bars">
            {bars.map((bar) => (
              <div key={bar.id} className="bar-row">
                <span>{bar.name}</span>
                <div className="track">
                  <div className={bar.id} style={{ width: `${Math.max(8, (bar.bookings / maxBookings) * 100)}%` }} />
                </div>
                <b>{formatNumber(bar.bookings)}</b>
              </div>
            ))}
          </div>
        </article>
      </div>
      <article className="card">
        <div className="card-head"><h3>Branch performance</h3></div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Unit / Branch</th>
                <th>Business Unit</th>
                <th>Bookings</th>
                <th>Revenue</th>
                <th>SLA</th>
              </tr>
            </thead>
            <tbody>
              {BRANCHES.map((branch) => (
                <tr key={branch.id}>
                  <td><strong>{branch.name}</strong><span className="muted">{branch.area}</span></td>
                  <td><UnitPill id={branch.unit} /></td>
                  <td className="num">{formatNumber(branch.bookings)}</td>
                  <td className="num">{formatINR(branch.revenue)}</td>
                  <td><Sla value={branch.sla} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export function SettingsPage() {
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [slaDigest, setSlaDigest] = useState(true);
  const [stockAlerts, setStockAlerts] = useState(true);
  const [saved, setSaved] = useState(false);
  return (
    <div className="page">
      <PageHead title="Settings" lede="Profile for the operations desk on ops.e-remedium.in." />
      <div className="two">
        <article className="card">
          <div className="card-head"><h3>Signed in</h3></div>
          <div className="profile">
            <span className="avatar lg">OM</span>
            <div>
              <strong>Operations Manager</strong>
              <span className="muted">Smilecure Operations Department</span>
              <span className="muted">operations.manager@smilecure.in</span>
            </div>
          </div>
          <dl className="meta">
            <div><dt>Portal</dt><dd>ops.e-remedium.in</dd></div>
            <div><dt>Network</dt><dd>Lab, Care, Aesthetic, Pharmacy</dd></div>
            <div><dt>Helpdesk</dt><dd>support@remedium.in</dd></div>
          </dl>
        </article>
        <article className="card">
          <div className="card-head"><h3>Notifications</h3></div>
          <label className="switch">
            <input type="checkbox" checked={emailAlerts} onChange={(event) => { setEmailAlerts(event.target.checked); setSaved(false); }} />
            <span>Email the desk when an approval is waiting</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={slaDigest} onChange={(event) => { setSlaDigest(event.target.checked); setSaved(false); }} />
            <span>Morning SLA digest for branches under 95%</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={stockAlerts} onChange={(event) => { setStockAlerts(event.target.checked); setSaved(false); }} />
            <span>Pharmacy low-stock alert</span>
          </label>
          <button
            type="button"
            className="btn primary"
            onClick={() => setSaved(true)}
          >
            Save preferences
          </button>
          {saved ? <p className="fine">Preferences saved on this desk.</p> : null}
        </article>
      </div>
    </div>
  );
}
