import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  AESTHETIC_BRANCH_UNITS,
  CARE_BRANCH_UNITS,
  FRANCHISE_UNITS,
  WINGS,
  formatINR,
  formatNumber,
  type WingId,
  type WingUnit,
} from '../data';
import { listAestheticBranches, listCareBranches, listCrmSalesCloses, type ClinicBranch } from '../crmApi';
import { Icon } from '../icons';
import { useCrm } from '../store';
import { AddContactModal, ImportContactsModal } from './Forms';
import { Empty, StatusPill, WingPill } from './ui';

function branchToUnit(b: ClinicBranch, prefix: string): WingUnit {
  const city = String(b.city || b.name || '').trim();
  const address =
    String(b.address || '').trim() ||
    (city ? `${city}, North 24 Parganas, West Bengal` : 'Address not set');
  return {
    id: `${prefix}-${b.id || b.code || b.name}`,
    name: String(b.name || 'Branch'),
    city: city || '—',
    address,
    code: b.code ? String(b.code) : undefined,
  };
}

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
      <header className="page-head page-head-compact">
        <div>
          <h1>Contacts</h1>
        </div>
      </header>
      <div className="card lm-main">
        <div className="fu-table-tools lm-table-tools">
          <button type="button" className="btn btn-ghost" onClick={() => setImportOpen(true)}>
            Import Contact
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={16} /> Add Contact
          </button>
          <div className="search fu-table-search">
            <Icon name="search" size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search contacts…"
              aria-label="Search contacts"
            />
          </div>
          <select value={wing} onChange={(e) => setWing(e.target.value as WingId | 'all')} aria-label="Wing filter">
            <option value="all">All wings</option>
            {WINGS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
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

function unitSearchBlob(u: WingUnit) {
  const pin = (u.address.match(/\b\d{6}\b/g) || []).join(' ');
  return `${u.name} ${u.city} ${u.address} ${u.code || ''} ${u.model || ''} ${pin}`.toLowerCase();
}

function filterUnitsByLocation(units: WingUnit[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return units;
  const tokens = needle.split(/\s+/).filter(Boolean);
  return units.filter((u) => {
    const blob = unitSearchBlob(u);
    return tokens.every((t) => blob.includes(t));
  });
}

function WingUnitsCard({
  wing,
  title,
  subtitle,
  units,
  totalCount,
  extraCol,
  query,
}: {
  wing: WingId;
  title: string;
  subtitle: string;
  units: WingUnit[];
  totalCount: number;
  extraCol?: 'model' | 'code';
  query: string;
}) {
  if (query.trim() && units.length === 0) return null;
  return (
    <div className="card lm-main">
      <div className="card-head" style={{ marginBottom: 8 }}>
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <WingPill wing={wing} />
            {title}
          </h3>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: '0.78rem' }}>{subtitle}</p>
        </div>
        <span className="badge-pill">
          {query.trim() ? `${units.length} / ${totalCount}` : `${units.length}`} units
        </span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Unit / Branch</th>
            <th>City</th>
            <th>Address</th>
            {extraCol ? <th>{extraCol === 'model' ? 'Model' : 'Code'}</th> : null}
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.id}>
              <td>
                <strong>{u.name}</strong>
              </td>
              <td>{u.city || '—'}</td>
              <td style={{ maxWidth: 360 }}>{u.address || '—'}</td>
              {extraCol === 'model' ? <td>{u.model || '—'}</td> : null}
              {extraCol === 'code' ? <td>{u.code || '—'}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {units.length === 0 ? <Empty text="No units found for this wing." /> : null}
    </div>
  );
}

export function AccountsPage() {
  const [aesUnits, setAesUnits] = useState<WingUnit[]>(AESTHETIC_BRANCH_UNITS);
  const [careUnits, setCareUnits] = useState<WingUnit[]>(CARE_BRANCH_UNITS);
  const [loadNote, setLoadNote] = useState('');
  const [locationQ, setLocationQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([listAestheticBranches(), listCareBranches()]).then(([aes, care]) => {
      if (cancelled) return;
      const notes: string[] = [];
      if (aes.status === 'fulfilled' && aes.value.length) {
        setAesUnits(aes.value.map((b) => branchToUnit(b, 'AES')));
      } else {
        notes.push('Aesthetic branches using cached list');
      }
      if (care.status === 'fulfilled' && care.value.length) {
        setCareUnits(care.value.map((b) => branchToUnit(b, 'CARE')));
      } else {
        notes.push('Care branches using cached list');
      }
      setLoadNote(notes.join(' · '));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredAes = useMemo(() => filterUnitsByLocation(aesUnits, locationQ), [aesUnits, locationQ]);
  const filteredCare = useMemo(() => filterUnitsByLocation(careUnits, locationQ), [careUnits, locationQ]);
  const filteredLab = useMemo(() => filterUnitsByLocation(FRANCHISE_UNITS, locationQ), [locationQ]);
  const matchTotal = filteredAes.length + filteredCare.length + filteredLab.length;

  return (
    <>
      <header className="page-head page-head-compact">
        <div>
          <h1>Accounts / Organizations</h1>
          <p style={{ margin: '2px 0 0', color: 'var(--muted)', fontSize: '0.8rem' }}>
            Wing-wise units — Aesthetic &amp; Care branches, Lab franchise hubs.
            {loadNote ? ` · ${loadNote}` : ''}
          </p>
        </div>
      </header>
      <div className="card lm-main" style={{ marginBottom: 12 }}>
        <div className="fu-table-tools lm-table-tools">
          <div className="search fu-table-search" style={{ marginLeft: 0, flex: '1 1 320px', maxWidth: 480 }}>
            <Icon name="search" size={15} />
            <input
              value={locationQ}
              onChange={(e) => setLocationQ(e.target.value)}
              placeholder="Search by pincode, address, town…"
              aria-label="Search units by location"
            />
          </div>
          {locationQ.trim() ? (
            <>
              <span className="badge-pill">{matchTotal} match{matchTotal === 1 ? '' : 'es'}</span>
              <button type="button" className="btn btn-ghost" onClick={() => setLocationQ('')}>
                Clear
              </button>
            </>
          ) : (
            <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
              Find units near a town, street, or 6-digit PIN
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {locationQ.trim() && matchTotal === 0 ? (
          <div className="card">
            <Empty text={`No units match “${locationQ.trim()}”. Try another town, address, or pincode.`} />
          </div>
        ) : null}
        <WingUnitsCard
          wing="aesthetic"
          title="Aesthetic branches"
          subtitle="Remedium Aesthetic clinic locations"
          units={filteredAes}
          totalCount={aesUnits.length}
          extraCol="code"
          query={locationQ}
        />
        <WingUnitsCard
          wing="care"
          title="Care branches"
          subtitle="Remedium Care clinic locations"
          units={filteredCare}
          totalCount={careUnits.length}
          extraCol="code"
          query={locationQ}
        />
        <WingUnitsCard
          wing="lab"
          title="Lab franchise units"
          subtitle="Existing franchise / partner collection hubs for lab work"
          units={filteredLab}
          totalCount={FRANCHISE_UNITS.length}
          extraCol="model"
          query={locationQ}
        />
      </div>
    </>
  );
}

export function DealsPage() {
  const crm = useCrm();
  const [syncing, setSyncing] = useState(false);
  const total = crm.deals.reduce((sum, d) => sum + (d.value || 0), 0);
  const won = crm.deals.filter((d) => d.stage === 'Won').length;
  const lost = crm.deals.filter((d) => d.stage === 'Lost').length;

  const syncBilling = async (quiet = false) => {
    setSyncing(true);
    try {
      const { closes } = await listCrmSalesCloses(300);
      const n = crm.applySalesCloses(closes);
      if (!quiet) {
        crm.pushToast(n ? `Synced ${n} portal bill(s) · Convert updates from billing` : 'No new portal bill closes yet');
      }
    } catch (err) {
      if (!quiet) {
        crm.pushToast(err instanceof Error ? err.message : 'Could not sync portal billing', 'err');
      }
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    void syncBilling(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHead
        title="Deals & Opportunities"
        subtitle="Stage & Lost sync from Follow-ups · Convert / Won syncs from Care, Aesthetic, Lab & Partner billing."
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => syncBilling(false)} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync portal bills'}
          </button>
        }
      />
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <div className="kpi">
          <span>Open deals</span>
          <strong>{formatNumber(crm.deals.filter((d) => d.stage !== 'Won' && d.stage !== 'Lost').length)}</strong>
        </div>
        <div className="kpi">
          <span>Pipeline value</span>
          <strong>{formatINR(total)}</strong>
        </div>
        <div className="kpi">
          <span>Converted (billing)</span>
          <strong>{formatNumber(won)}</strong>
        </div>
        <div className="kpi">
          <span>Lost (follow-up)</span>
          <strong>{formatNumber(lost)}</strong>
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
              <th>Status</th>
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
                    {d.bookingId ? ` · ${d.bookingId}` : ''}
                  </div>
                </td>
                <td>
                  <WingPill wing={d.wing} />
                </td>
                <td>
                  <StatusPill value={d.stage} />
                  <div style={{ color: 'var(--muted)', fontSize: '0.68rem', marginTop: 4 }}>
                    {d.stage === 'Won'
                      ? 'From portal billing'
                      : d.stage === 'Lost'
                        ? d.lostReason
                          ? `Follow-up · ${d.lostReason}`
                          : 'From follow-up'
                        : 'From follow-up'}
                  </div>
                </td>
                <td>{formatINR(d.value)}</td>
                <td>{d.probability != null ? `${d.probability}%` : '—'}</td>
                <td>{d.closeDate}</td>
                <td>{d.owner}</td>
                <td>
                  <StatusPill value={d.stage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {crm.deals.length === 0 ? (
          <Empty text="No deals yet. Mark a follow-up as Deal & Opportunity — stage then tracks follow-up; Convert waits for portal billing." />
        ) : null}
      </div>
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

export { CampaignsPage } from './Campaigns';

export { ReportsPage } from './Reports';

export { SettingsPage } from './Settings';

