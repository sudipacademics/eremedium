import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  DEAL_STAGES,
  FRANCHISE_UNITS,
  LOST_REASONS,
  WINGS,
  formatINR,
  formatNumber,
  type DealStage,
  type LostReason,
  type WingId,
} from '../data';
import { listCrmSalesCloses } from '../crmApi';
import { Icon } from '../icons';
import { useCrm } from '../store';
import { AddContactModal, ImportContactsModal, TransferOwnershipModal } from './Forms';
import { Empty, StatusPill, WingPill } from './ui';

export { LeadsPage } from './Leads';

type OutletCtx = { openModal: (m: 'lead' | 'aesthetic' | 'care' | 'partner' | 'franchise') => void };

function PageHead({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions}
    </header>
  );
}

export function ContactsPage() {
  const crm = useCrm();
  const [q, setQ] = useState('');
  const [wing, setWing] = useState<WingId | 'all'>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return crm.contacts.filter((c) => {
      if (wing !== 'all' && c.wing !== wing) return false;
      if (!needle) return true;
      return `${c.name} ${c.mobile} ${c.email} ${c.role || ''} ${c.account || ''} ${c.owner}`
        .toLowerCase()
        .includes(needle);
    });
  }, [crm.contacts, q, wing]);

  return (
    <>
      <PageHead
        title="Contacts"
        subtitle="People linked to leads, accounts and franchise applicants."
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setImportOpen(true)}>
              Import Contact
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={16} /> Add Contact
            </button>
          </div>
        }
      />
      <div className="toolbar">
        <div className="search" style={{ maxWidth: 280, flex: 1 }}>
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts…" />
        </div>
        <select value={wing} onChange={(e) => setWing(e.target.value as WingId | 'all')}>
          <option value="all">All wings</option>
          {WINGS.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Wing</th>
              <th>Role</th>
              <th>Mobile</th>
              <th>Email</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  {c.account ? (
                    <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{c.account}</div>
                  ) : null}
                </td>
                <td>
                  <WingPill wing={c.wing} />
                </td>
                <td>{c.role || '—'}</td>
                <td>{c.mobile}</td>
                <td>{c.email || '—'}</td>
                <td>{c.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <Empty text="No contacts match your filters." /> : null}
      </div>
      {addOpen ? <AddContactModal onClose={() => setAddOpen(false)} /> : null}
      {importOpen ? <ImportContactsModal onClose={() => setImportOpen(false)} /> : null}
    </>
  );
}

export function AccountsPage() {
  const crm = useCrm();
  return (
    <>
      <PageHead title="Accounts / Organizations" subtitle="Clinics, franchise hubs, corporate accounts and patient groups." />
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Type</th>
              <th>Wing</th>
              <th>City</th>
              <th>Contacts</th>
              <th>Deals</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {crm.accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.name}</strong>
                </td>
                <td>{a.type}</td>
                <td>
                  <WingPill wing={a.wing} />
                </td>
                <td>{a.city}</td>
                <td>{a.contacts}</td>
                <td>{a.deals}</td>
                <td>{a.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function DealsPage() {
  const crm = useCrm();
  const [convertId, setConvertId] = useState<string | null>(null);
  const [lostId, setLostId] = useState<string | null>(null);
  const [conversionId, setConversionId] = useState('');
  const [conversionType, setConversionType] = useState<'aesthetic' | 'care' | 'lab' | 'franchise' | 'partner'>('aesthetic');
  const [lostReason, setLostReason] = useState<LostReason | ''>('');
  const total = crm.deals.reduce((sum, d) => sum + (d.value || 0), 0);
  const converting = convertId ? crm.deals.find((d) => d.id === convertId) : null;

  return (
    <>
      <PageHead
        title="Deals & Opportunities"
        subtitle="Lead → Follow-up → Deal → Conversion → Closure. Synced from Follow-up Management."
      />
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className="kpi">
          <span>Open deals</span>
          <strong>{formatNumber(crm.deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost').length)}</strong>
        </div>
        <div className="kpi">
          <span>Pipeline value</span>
          <strong>{formatINR(total)}</strong>
        </div>
        <div className="kpi">
          <span>From follow-ups</span>
          <strong>{formatNumber(crm.deals.filter((d) => d.activityId).length)}</strong>
        </div>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Deal</th>
              <th>Wing</th>
              <th>Stage</th>
              <th>Value</th>
              <th>Prob.</th>
              <th>Close</th>
              <th>Owner</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {crm.deals.map((d) => (
              <tr key={d.id}>
                <td>
                  <strong>{d.title}</strong>
                  <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                    {d.id}
                    {d.leadId ? ` · ${d.leadId}` : ''}
                    {d.product ? ` · ${d.product}` : ''}
                    {d.conversionId ? ` · ${d.conversionId}` : ''}
                  </div>
                </td>
                <td>
                  <WingPill wing={d.wing} />
                </td>
                <td>
                  <select
                    className="inline-select"
                    value={d.stage}
                    disabled={d.stage === 'Won' || d.stage === 'Lost'}
                    onChange={(e) => {
                      const stage = e.target.value as DealStage;
                      if (stage === 'Lost') {
                        setLostId(d.id);
                        setLostReason('');
                        return;
                      }
                      if (stage === 'Won') {
                        setConvertId(d.id);
                        setConversionType(
                          d.wing === 'care' || d.wing === 'aesthetic' || d.wing === 'lab' || d.wing === 'franchise'
                            ? d.wing
                            : 'lab',
                        );
                        setConversionId('');
                        return;
                      }
                      crm.updateDeal(d.id, { stage });
                      crm.pushToast(`${d.id} → ${stage}`);
                    }}
                  >
                    {DEAL_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{formatINR(d.value)}</td>
                <td>{d.probability != null ? `${d.probability}%` : '—'}</td>
                <td>{d.closeDate}</td>
                <td>{d.owner}</td>
                <td>
                  {d.stage !== 'Won' && d.stage !== 'Lost' ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px' }}
                        onClick={() => {
                          setConvertId(d.id);
                          setConversionType(
                            d.wing === 'care' || d.wing === 'aesthetic' || d.wing === 'lab' || d.wing === 'franchise'
                              ? d.wing
                              : 'lab',
                          );
                          setConversionId('');
                        }}
                      >
                        Convert
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px' }}
                        onClick={() => {
                          setLostId(d.id);
                          setLostReason('');
                        }}
                      >
                        Lost
                      </button>
                    </div>
                  ) : (
                    <StatusPill value={d.stage} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {crm.deals.length === 0 ? <Empty text="No deals yet. Mark a follow-up as Deal & Opportunity to sync here." /> : null}
      </div>

      {converting ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="card-head">
              <h2>Conversion / Won · {converting.id}</h2>
              <button type="button" className="icon-btn" onClick={() => setConvertId(null)} aria-label="Close">
                ×
              </button>
            </div>
            <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
              Capture Booking ID / Application ID after confirming the customer transaction.
            </p>
            <div className="form-grid">
              <label className="field">
                <span>Conversion type *</span>
                <select
                  value={conversionType}
                  onChange={(e) => setConversionType(e.target.value as typeof conversionType)}
                >
                  <option value="aesthetic">Aesthetic → Patient Booking</option>
                  <option value="care">Care → Patient Booking</option>
                  <option value="lab">Lab → Centre Booking</option>
                  <option value="partner">Franchise Unit → Partner Booking</option>
                  <option value="franchise">Franchise → FFMS/RFMS Application</option>
                </select>
              </label>
              <label className="field">
                <span>Booking / Application ID *</span>
                <input
                  value={conversionId}
                  onChange={(e) => setConversionId(e.target.value)}
                  placeholder="BK-… / RFMS-… / APP-…"
                  autoFocus
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConvertId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!conversionId.trim()) {
                    crm.pushToast('Enter Booking / Application ID', 'err');
                    return;
                  }
                  const done = crm.convertDealWon(converting.id, {
                    conversionType,
                    conversionId: conversionId.trim(),
                    service: converting.product,
                  });
                  if (!done) {
                    crm.pushToast('Conversion failed', 'err');
                    return;
                  }
                  crm.pushToast(`Deal ${converting.id} Won · ${conversionId.trim()}`);
                  setConvertId(null);
                }}
              >
                Mark Won / Converted
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lostId ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="card-head">
              <h2>Lost / Closed · {lostId}</h2>
              <button type="button" className="icon-btn" onClick={() => setLostId(null)} aria-label="Close">
                ×
              </button>
            </div>
            <label className="field">
              <span>Lost reason *</span>
              <select value={lostReason} onChange={(e) => setLostReason(e.target.value as LostReason | '')}>
                <option value="">Select reason</option>
                {LOST_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setLostId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!lostReason) {
                    crm.pushToast('Lost reason is mandatory', 'err');
                    return;
                  }
                  crm.updateDeal(lostId, { stage: 'Lost', lostReason });
                  const deal = crm.deals.find((d) => d.id === lostId);
                  if (deal?.leadId) crm.closeLeadLost(deal.leadId, lostReason);
                  crm.pushToast(`Deal ${lostId} Lost · ${lostReason}`);
                  setLostId(null);
                }}
              >
                Confirm Lost
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export { FollowUpsPage as ActivitiesPage } from './FollowUps';

export function BookingsPage() {
  const crm = useCrm();
  const { openModal } = useOutletContext<OutletCtx>();
  const [syncing, setSyncing] = useState(false);
  const rows = crm.bookings.filter((b) => b.wing === 'aesthetic' || b.wing === 'care');

  const syncCloses = async (quiet = false) => {
    setSyncing(true);
    try {
      const { closes } = await listCrmSalesCloses(300);
      const n = crm.applySalesCloses(closes);
      if (!quiet) {
        crm.pushToast(n ? `Synced ${n} billed sale(s) from portals` : 'No new portal bill closes yet');
      }
    } catch (err) {
      if (!quiet) {
        crm.pushToast(err instanceof Error ? err.message : 'Could not sync portal sales', 'err');
      }
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    void syncCloses(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHead
        title="Bookings"
        subtitle="Only bookings created with + Care / + Aesthetic appear in the portals. Sales close when the portal bills — use Sync portal bills to refresh."
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" onClick={() => syncCloses(false)} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync portal bills'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => openModal('care')}>
              + Care
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openModal('aesthetic')}>
              + Aesthetic
            </button>
          </div>
        }
      />
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>ID / Tag</th>
              <th>Patient</th>
              <th>Wing</th>
              <th>Service</th>
              <th>Portal ref</th>
              <th>Executive</th>
              <th>When</th>
              <th>Sale (from portal bill)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>
                  <strong>{b.id}</strong>
                  <div style={{ color: 'var(--muted)', fontSize: '0.75rem', fontFamily: 'ui-monospace, monospace' }}>
                    {b.trackingTag}
                  </div>
                </td>
                <td>
                  <strong>{b.patient}</strong>
                  <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{b.mobile}</div>
                </td>
                <td>
                  <WingPill wing={b.wing} />
                </td>
                <td>
                  {b.service}
                  <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{b.branch}</div>
                </td>
                <td>
                  {b.externalId ? (
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}>{b.externalId}</span>
                  ) : (
                    <span style={{ color: 'var(--danger, #b91c1c)', fontSize: '0.75rem' }}>Not on portal</span>
                  )}
                </td>
                <td>{b.executive || b.owner}</td>
                <td>
                  {b.date} · {b.time}
                </td>
                <td>
                  <StatusPill value={b.salesStatus || 'Open'} />
                  {b.billedAmount ? (
                    <div style={{ fontSize: '0.75rem', marginTop: 4 }}>{formatINR(b.billedAmount)}</div>
                  ) : (
                    <div style={{ color: 'var(--muted)', fontSize: '0.72rem', marginTop: 4 }}>Awaiting portal bill</div>
                  )}
                  {b.billRef ? (
                    <div style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>{b.billRef}</div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <Empty text="No Aesthetic / Care bookings yet. Use + Care or + Aesthetic." /> : null}
      </div>
    </>
  );
}

export function FranchisePage() {
  const crm = useCrm();
  const { openModal } = useOutletContext<OutletCtx>();
  const leads = crm.leads.filter((l) => l.wing === 'franchise');
  return (
    <>
      <PageHead
        title="Franchise (FFMS / RFMS)"
        subtitle="Add franchise leads and start FOFO / FOCO creation through the RFMS portal."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={() => openModal('lead')}>
              + Franchise lead
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openModal('franchise')}>
              Create Franchise
            </button>
          </div>
        }
      />
      <div className="quick-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <a className="quick" href="https://www.e-remedium.in/franchise/" target="_blank" rel="noreferrer">
          <span className="quick-ico" style={{ background: 'var(--franchise)' }}>
            FF
          </span>
          <span>
            <strong>Franchise marketing</strong>
            <span>www.e-remedium.in/franchise</span>
          </span>
        </a>
        <a className="quick" href="https://www.e-remedium.in/ffms" target="_blank" rel="noreferrer">
          <span className="quick-ico" style={{ background: 'var(--accent)' }}>
            RF
          </span>
          <span>
            <strong>RFMS officer desk</strong>
            <span>Admin / officer login</span>
          </span>
        </a>
        <a className="quick" href="https://www.e-remedium.in/onboard/" target="_blank" rel="noreferrer">
          <span className="quick-ico" style={{ background: 'var(--lab)' }}>
            OB
          </span>
          <span>
            <strong>Applicant onboard</strong>
            <span>KYC · payment · agreement</span>
          </span>
        </a>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Franchise leads</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Model</th>
              <th>Territory</th>
              <th>Status</th>
              <th>RFMS</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>
                  <strong>{l.name}</strong>
                  <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{l.mobile}</div>
                </td>
                <td>{l.franchiseModel || '—'}</td>
                <td>{l.territory || '—'}</td>
                <td>
                  <StatusPill value={l.status} />
                </td>
                <td>{l.rfmsLeadId || 'Pending sync'}</td>
                <td>{l.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 ? <Empty text="No franchise leads yet." /> : null}
      </div>
    </>
  );
}

export function PartnerBookingsPage() {
  const crm = useCrm();
  const { openModal } = useOutletContext<OutletCtx>();
  const rows = crm.bookings.filter((b) => b.channel === 'Partner Portal' || b.wing === 'franchise' || b.franchiseUnit);
  return (
    <>
      <PageHead
        title="Partner Unit Bookings"
        subtitle="Book lab tests against franchise / partner units (same flow partners use on the partner portal)."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => openModal('partner')}>
            + Book for unit
          </button>
        }
      />
      <div className="grid-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        {FRANCHISE_UNITS.map((u) => (
          <div key={u.id} className="card">
            <h3 style={{ margin: 0 }}>{u.name}</h3>
            <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
              {u.city} · {u.model}
            </p>
          </div>
        ))}
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>ID / Tag</th>
              <th>Patient</th>
              <th>Unit</th>
              <th>Executive</th>
              <th>When</th>
              <th>Sale</th>
              <th>External</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>
                  <strong>{b.id}</strong>
                  <div style={{ color: 'var(--muted)', fontSize: '0.75rem', fontFamily: 'ui-monospace, monospace' }}>
                    {b.trackingTag}
                  </div>
                </td>
                <td>
                  <strong>{b.patient}</strong>
                </td>
                <td>{b.franchiseUnit || b.branch}</td>
                <td>{b.executive || b.owner}</td>
                <td>
                  {b.date} · {b.time}
                </td>
                <td>
                  <StatusPill value={b.salesStatus || 'Open'} />
                  {b.billedAmount ? <div style={{ fontSize: '0.75rem' }}>{formatINR(b.billedAmount)}</div> : null}
                </td>
                <td>{b.externalId || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <Empty text="No partner-unit bookings yet." /> : null}
      </div>
    </>
  );
}

export function CampaignsPage() {
  const crm = useCrm();
  return (
    <>
      <PageHead title="Campaigns" subtitle="Paid and organic campaigns feeding the CRM inbox." />
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Channel</th>
              <th>Wing</th>
              <th>Spend</th>
              <th>Leads</th>
              <th>CPL</th>
              <th>ROI</th>
            </tr>
          </thead>
          <tbody>
            {crm.campaigns.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                </td>
                <td>{c.channel}</td>
                <td>
                  <WingPill wing={c.wing} />
                </td>
                <td>{formatINR(c.spend)}</td>
                <td>{formatNumber(c.leads)}</td>
                <td>{formatINR(c.cpl)}</td>
                <td>{c.roi}x</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ReportsPage() {
  const crm = useCrm();
  const [erpTotal, setErpTotal] = useState(0);
  const won = crm.deals.filter((d) => d.stage === 'Won').length;
  const open = crm.deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost').length;
  const closedSales = crm.bookings.filter((b) => (b.salesStatus || 'Open') === 'Closed');
  const closedAmount = closedSales.reduce((s, b) => s + (b.billedAmount || 0), 0);
  const byExecutive = useMemo(() => {
    const map = new Map<string, { executive: string; bookings: number; closed: number; amount: number }>();
    for (const b of crm.bookings) {
      const key = b.executive || b.owner || 'Unassigned';
      const row = map.get(key) || { executive: key, bookings: 0, closed: 0, amount: 0 };
      row.bookings += 1;
      if ((b.salesStatus || 'Open') === 'Closed') {
        row.closed += 1;
        row.amount += b.billedAmount || 0;
      }
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount || b.bookings - a.bookings);
  }, [crm.bookings]);

  useEffect(() => {
    let cancelled = false;
    listCrmSalesCloses(300)
      .then((data) => {
        if (cancelled) return;
        setErpTotal(data.totalAmount);
        if (data.closes.length) crm.applySalesCloses(data.closes);
      })
      .catch(() => {
        /* offline soft */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHead
        title="Reports & Analytics"
        subtitle="Executive sales closes from CRM tracking tags on Care / Aesthetic / lab bills."
      />
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <div className="kpi">
          <span>CRM leads</span>
          <strong>{formatNumber(crm.leads.length)}</strong>
        </div>
        <div className="kpi">
          <span>Open deals</span>
          <strong>{formatNumber(open)}</strong>
        </div>
        <div className="kpi">
          <span>Won deals</span>
          <strong>{formatNumber(won)}</strong>
        </div>
        <div className="kpi">
          <span>Closed booking sales</span>
          <strong>{formatNumber(closedSales.length)}</strong>
        </div>
        <div className="kpi">
          <span>Executive billed</span>
          <strong>{formatINR(closedAmount || erpTotal)}</strong>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Sales by CRM executive</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Executive</th>
              <th>Bookings</th>
              <th>Closed</th>
              <th>Billed amount</th>
            </tr>
          </thead>
          <tbody>
            {byExecutive.map((r) => (
              <tr key={r.executive}>
                <td>
                  <strong>{r.executive}</strong>
                </td>
                <td>{formatNumber(r.bookings)}</td>
                <td>{formatNumber(r.closed)}</td>
                <td>{formatINR(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {byExecutive.length === 0 ? <Empty text="No bookings with tracking tags yet." /> : null}
      </div>
      <div className="card">
        <h3>Wing mix (current CRM session)</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Wing</th>
              <th>Leads</th>
              <th>Deals</th>
              <th>Bookings</th>
            </tr>
          </thead>
          <tbody>
            {WINGS.map((w) => (
              <tr key={w.id}>
                <td>
                  <WingPill wing={w.id} />
                </td>
                <td>{crm.leads.filter((l) => l.wing === w.id).length}</td>
                <td>{crm.deals.filter((d) => d.wing === w.id).length}</td>
                <td>{crm.bookings.filter((b) => b.wing === w.id || (w.id === 'lab' && b.channel === 'Partner Portal')).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function SettingsPage() {
  const crm = useCrm();
  const [transferOpen, setTransferOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'manager' | 'staff'>('staff');

  return (
    <>
      <PageHead
        title="Settings"
        subtitle="CRM team roster, ownership transfer, and connected systems."
        actions={
          crm.isManager ? (
            <button type="button" className="btn btn-primary" onClick={() => setTransferOpen(true)}>
              Transfer ownership
            </button>
          ) : null
        }
      />
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>CRM team</h3>
        <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
          Managers can transfer leads and follow-ups between CRM owners. Your role:{' '}
          <strong>{crm.userRoleLabel}</strong>.
        </p>
        {!crm.isManager ? (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginBottom: 12 }}
            onClick={() => {
              const me = crm.team.find((t) => t.name.toLowerCase() === crm.userName.toLowerCase());
              if (me) crm.updateTeamMember(me.id, { role: 'manager', active: true });
              else crm.addTeamMember({ name: crm.userName, role: 'manager' });
              crm.pushToast('CRM Manager tools enabled for your login');
            }}
          >
            Enable manager tools for my login
          </button>
        ) : null}
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              {crm.isManager ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {crm.team.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.name}</strong>
                </td>
                <td>{m.email || '—'}</td>
                <td>{m.role === 'manager' ? 'CRM Manager' : 'CRM Staff'}</td>
                <td>{m.active ? 'Active' : 'Inactive'}</td>
                {crm.isManager ? (
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '4px 8px' }}
                      onClick={() =>
                        crm.updateTeamMember(m.id, {
                          role: m.role === 'manager' ? 'staff' : 'manager',
                        })
                      }
                    >
                      Make {m.role === 'manager' ? 'staff' : 'manager'}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {crm.isManager ? (
          <form
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 8, marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) {
                crm.pushToast('Enter team member name', 'err');
                return;
              }
              crm.addTeamMember({ name: name.trim(), email: email.trim() || undefined, role });
              crm.pushToast(`${name.trim()} added to CRM team`);
              setName('');
              setEmail('');
              setRole('staff');
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" />
            <select value={role} onChange={(e) => setRole(e.target.value as 'manager' | 'staff')}>
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
            </select>
            <button type="submit" className="btn btn-primary">
              Add
            </button>
          </form>
        ) : null}
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Connected systems</h3>
        <table className="table">
          <tbody>
            <tr>
              <td>
                <strong>Care portal</strong>
              </td>
              <td>care.e-remedium.in · /care-api</td>
            </tr>
            <tr>
              <td>
                <strong>Aesthetic sessions</strong>
              </td>
              <td>care.e-remedium.in · /aes-api</td>
            </tr>
            <tr>
              <td>
                <strong>FFMS / RFMS</strong>
              </td>
              <td>www.e-remedium.in · /rfms-api/v1</td>
            </tr>
            <tr>
              <td>
                <strong>Partner portal</strong>
              </td>
              <td>partners.remediumlabs.in · ERP book_lab_test</td>
            </tr>
            <tr>
              <td>
                <strong>REACH (sales &amp; marketing)</strong>
              </td>
              <td>
                reach.e-remedium.in · assign leads + follow-ups via ERP (list_crm_reach_reps /
                assign_crm_lead_to_reach)
              </td>
            </tr>
            <tr>
              <td>
                <strong>This portal</strong>
              </td>
              <td>crm.e-remedium.in · same Hetzner host</td>
            </tr>
          </tbody>
        </table>
      </div>
      {transferOpen ? <TransferOwnershipModal onClose={() => setTransferOpen(false)} /> : null}
    </>
  );
}
