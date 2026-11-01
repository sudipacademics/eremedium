import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  LabConsumableBatch,
  LabMappableTest,
  LabReagentBatch,
  LabReagentDashboard,
  LabReorderAlert,
} from '../../api';
import './lab-tech-v2.css';
import './reagents-v2.css';

type SectionKey = 'record' | 'inventory' | 'today' | 'expiring';
type LotFilter = '' | 'Open' | 'Sealed' | 'low' | 'expiring' | 'expired';
type RegisterKind = 'reagent' | 'consumable';
type DetailRow = [string, ReactNode];
type Detail = { title: string; rows: DetailRow[]; lot?: LotRow } | null;

type LotRow = {
  kind: RegisterKind;
  batch_id: string;
  name: string;
  item: string;
  lot_number: string;
  status: string;
  remaining: number;
  pack: number;
  usage_percent: number;
  safety_stock?: number;
  low_stock: boolean;
  expiry_date?: string | null;
  opened_on?: string | null;
  verification_status?: string;
};

const EXPIRY_WINDOW_DAYS = 30;

function RgIcon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const ICON_FLASK = (
  <>
    <path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21.5h11.6a2 2 0 0 0 1.7-3L14 9V3" />
    <path d="M7 15h10" />
  </>
);
const ICON_SHIELD = (
  <>
    <path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </>
);
const ICON_ALERT = (
  <>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 4.9 2.4 18.2A2 2 0 0 0 4.1 21h15.8a2 2 0 0 0 1.7-2.8L13.7 4.9a2 2 0 0 0-3.4 0z" />
  </>
);
const ICON_CLOCK = (
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </>
);
const ICON_DOC = (
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </>
);
const ICON_CLIPBOARD = (
  <>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6" />
  </>
);
const ICON_BOX = (
  <>
    <path d="M3 8.5 12 4l9 4.5-9 4.5z" />
    <path d="M3 8.5v7L12 20l9-4.5v-7" />
    <path d="M12 13v7" />
  </>
);
const ICON_SEARCH = (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
);
const ICON_PLUS = <path d="M12 5v14M5 12h14" />;

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatWhen(raw?: string | null): string {
  if (!raw) return '—';
  const d = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysUntil(raw?: string | null): number | null {
  if (!raw) return null;
  const d = new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function isExpired(raw?: string | null): boolean {
  const days = daysUntil(raw);
  return days != null && days < 0;
}

function isExpiringSoon(raw?: string | null): boolean {
  const days = daysUntil(raw);
  return days != null && days >= 0 && days <= EXPIRY_WINDOW_DAYS;
}

function statusTone(status?: string): string {
  switch (status) {
    case 'Open':
      return 'tone-green';
    case 'Sealed':
      return 'tone-blue';
    case 'Expired':
      return 'tone-red';
    case 'Depleted':
      return 'tone-muted';
    default:
      return 'tone-muted';
  }
}

function verifyTone(status?: string): string {
  switch (status) {
    case 'Verified':
    case 'Pass':
      return 'tone-green';
    case 'Failed':
    case 'Fail':
      return 'tone-red';
    case 'Conditional':
      return 'tone-amber';
    default:
      return 'tone-muted';
  }
}

function matches(q: string, ...fields: (string | number | null | undefined)[]): boolean {
  if (!q) return true;
  return fields.some((f) => String(f ?? '').toLowerCase().includes(q));
}

function asReagentLot(b: LabReagentBatch): LotRow {
  return {
    kind: 'reagent',
    batch_id: b.batch_id,
    name: b.reagent_name,
    item: b.reagent_item,
    lot_number: b.lot_number,
    status: b.status,
    remaining: b.tests_remaining,
    pack: b.tests_per_pack,
    usage_percent: b.usage_percent,
    safety_stock: b.safety_stock,
    low_stock: b.low_stock,
    expiry_date: b.expiry_date,
    opened_on: b.opened_on,
    verification_status: b.verification_status,
  };
}

function asConsumableLot(b: LabConsumableBatch): LotRow {
  return {
    kind: 'consumable',
    batch_id: b.batch_id,
    name: b.consumable_name,
    item: b.consumable_item,
    lot_number: b.lot_number,
    status: b.status,
    remaining: b.units_remaining,
    pack: b.units_per_pack,
    usage_percent: b.usage_percent,
    safety_stock: b.safety_stock,
    low_stock: b.low_stock,
    expiry_date: b.expiry_date,
    opened_on: b.opened_on,
  };
}

function lotMatchesFilter(lot: LotRow, filter: LotFilter): boolean {
  if (!filter) return true;
  if (filter === 'Open' || filter === 'Sealed') return lot.status === filter;
  if (filter === 'low') return lot.low_stock;
  if (filter === 'expiring') return isExpiringSoon(lot.expiry_date);
  if (filter === 'expired') return isExpired(lot.expiry_date);
  return true;
}

function StatCard({
  tone,
  icon,
  value,
  label,
  sub,
  onClick,
}: {
  tone: string;
  icon: ReactNode;
  value: number;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`lt-stat ${tone}`} onClick={onClick}>
      <span className="lt-stat-icon">
        <RgIcon size={26}>{icon}</RgIcon>
      </span>
      <span className="lt-stat-copy">
        <strong>{value}</strong>
        <b>{label}</b>
        <small>{sub}</small>
      </span>
      <span className="lt-stat-go" aria-hidden>
        ›
      </span>
    </button>
  );
}

function CardHead({ icon, title, sub, children }: { icon: ReactNode; title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="rg2-card-head">
      <div className="rg2-card-title">
        <span className="rg2-card-icon">
          <RgIcon size={22}>{icon}</RgIcon>
        </span>
        <div>
          <h3>{title}</h3>
          <p>{sub}</p>
        </div>
      </div>
      {children ? <div className="rg2-card-tools">{children}</div> : null}
    </div>
  );
}

function RowMenu({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="lt-row-menu">
      <button
        type="button"
        className="lt-kebab"
        aria-label="More actions"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        ⋮
      </button>
      {open ? <div className="lt-row-menu-pop">{children}</div> : null}
    </div>
  );
}

function StockSummary({
  items,
  expired,
  soon,
  ok,
}: {
  items: Array<{ name: string; remaining: number; pack: number; lots: number }>;
  expired: number;
  soon: number;
  ok: number;
}) {
  return (
    <section className="rg2-card">
      <div className="rg2-summary-head">
        <h3>Stock remaining</h3>
      </div>
      <div className="rg2-chips">
        <span className="lt-badge tone-green">{ok} in date</span>
        <span className="lt-badge tone-amber">{soon} expiring</span>
        <span className="lt-badge tone-red">{expired} expired</span>
      </div>
      {items.length ? (
        <ul className="rg2-stock-list">
          {items.map((row) => {
            const pct = row.pack ? Math.min(100, Math.round((row.remaining / row.pack) * 100)) : 0;
            return (
              <li key={row.name}>
                <div className="rg2-stock-meta">
                  <b>{row.name}</b>
                  <span>
                    {row.remaining} / {row.pack} · {row.lots} open
                  </span>
                </div>
                <div className="rg2-stock-bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="lt-empty">No open packs to summarize.</p>
      )}
    </section>
  );
}

function DetailModal({
  detail,
  busy,
  onClose,
  onOpen,
  onLotVerify,
}: {
  detail: NonNullable<Detail>;
  busy: string | null;
  onClose: () => void;
  onOpen: (lot: LotRow) => void;
  onLotVerify: (batchId: string) => void;
}) {
  const lot = detail.lot;
  return (
    <div className="rg2-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="rg2-modal" role="dialog" aria-modal="true" aria-label={detail.title} onClick={(e) => e.stopPropagation()}>
        <div className="rg2-modal-head">
          <h3>{detail.title}</h3>
          <button type="button" className="lt-kebab" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <dl className="rg2-detail">
          {detail.rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v ?? '—'}</dd>
            </div>
          ))}
        </dl>
        <div className="rg2-modal-foot">
          {lot?.status === 'Sealed' ? (
            <button type="button" className="lt-action" disabled={busy === lot.batch_id} onClick={() => onOpen(lot)}>
              {busy === lot.batch_id ? 'Opening…' : 'Open pack'}
            </button>
          ) : null}
          {lot?.kind === 'reagent' ? (
            <button
              type="button"
              className="lt-action is-ghost"
              disabled={busy === `lot-${lot.batch_id}`}
              onClick={() => onLotVerify(lot.batch_id)}
            >
              {busy === `lot-${lot.batch_id}` ? 'Saving…' : 'Lot verify…'}
            </button>
          ) : null}
          <button type="button" className="lt-action is-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AddMappedModal({
  tests,
  selectedTest,
  busy,
  name,
  testItem,
  paramCode,
  qty,
  safety,
  onName,
  onTest,
  onParam,
  onQty,
  onSafety,
  onSubmit,
  onClose,
}: {
  tests: LabMappableTest[];
  selectedTest: LabMappableTest | null;
  busy: boolean;
  name: string;
  testItem: string;
  paramCode: string;
  qty: string;
  safety: string;
  onName: (v: string) => void;
  onTest: (code: string) => void;
  onParam: (v: string) => void;
  onQty: (v: string) => void;
  onSafety: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <div className="rg2-modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="rg2-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="rg2-modal-head">
          <div>
            <h3>Add reagent</h3>
            <p className="rg2-modal-sub">Map a catalog item to a Real parameter. Stock depletes when that parameter is finalized.</p>
          </div>
          <button type="button" className="lt-kebab" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="rg2-add-grid">
          <label className="lt-field rg2-span-2">
            <span>
              Reagent name <em>*</em>
            </span>
            <input className="rg2-input" value={name} onChange={(e) => onName(e.target.value)} required />
          </label>
          <label className="lt-field">
            <span>
              Lab test <em>*</em>
            </span>
            <select value={testItem} onChange={(e) => onTest(e.target.value)} required>
              <option value="">Select test…</option>
              {tests.map((t) => (
                <option key={t.item_code} value={t.item_code}>
                  {t.item_name} ({t.item_code})
                </option>
              ))}
            </select>
          </label>
          <label className="lt-field">
            <span>
              Parameter <em>*</em>
            </span>
            {!selectedTest?.parameters?.length && testItem ? (
              <input className="rg2-input" value={paramCode} onChange={(e) => onParam(e.target.value)} required />
            ) : (
              <select value={paramCode} onChange={(e) => onParam(e.target.value)} required>
                <option value="">Select parameter…</option>
                {(selectedTest?.parameters || []).map((p) => (
                  <option key={p.parameter_code} value={p.parameter_code}>
                    {p.parameter_name} ({p.parameter_code})
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="lt-field">
            <span>
              Qty per run <em>*</em>
            </span>
            <input className="rg2-input" type="number" min={1} value={qty} onChange={(e) => onQty(e.target.value)} required />
          </label>
          <label className="lt-field">
            <span>
              Safety stock <em>*</em>
            </span>
            <input className="rg2-input" type="number" min={0} value={safety} onChange={(e) => onSafety(e.target.value)} required />
          </label>
        </div>
        <div className="rg2-modal-foot">
          <button type="button" className="lt-action is-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="lt-action rg2-submit" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Add mapped reagent'}
          </button>
        </div>
      </form>
    </div>
  );
}

function LotTable({
  lots,
  empty,
  menuFor,
  onView,
  onMenu,
  onOpen,
  onLotVerify,
}: {
  lots: LotRow[];
  empty: string;
  menuFor: string | null;
  onView: (lot: LotRow) => void;
  onMenu: (id: string) => void;
  onOpen: (lot: LotRow) => void;
  onLotVerify: (batchId: string) => void;
}) {
  return (
    <div className="lt-table-wrap">
      <table className="lt-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Item</th>
            <th>Lot</th>
            <th>Tag</th>
            <th>Remaining</th>
            <th>Expiry</th>
            <th>Status</th>
            <th>Action</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lots.length ? (
            lots.map((lot) => {
              const expDays = daysUntil(lot.expiry_date);
              return (
                <tr key={`${lot.kind}-${lot.batch_id}`}>
                  <td className="lt-trf">{lot.name}</td>
                  <td className="muted">{lot.item}</td>
                  <td>{lot.lot_number}</td>
                  <td>{lot.batch_id}</td>
                  <td className="rg2-nowrap">
                    {lot.remaining} / {lot.pack}
                    {lot.status === 'Open' ? ` (${lot.usage_percent}%)` : ''}
                  </td>
                  <td className={expDays != null && expDays < 0 ? 'rg2-overdue' : ''}>{lot.expiry_date || '—'}</td>
                  <td>
                    <span className={`lt-badge ${statusTone(lot.status)}`}>{lot.status}</span>
                  </td>
                  <td>
                    <button type="button" className="lt-action is-ghost rg2-view" onClick={() => onView(lot)}>
                      View
                    </button>
                  </td>
                  <td>
                    <RowMenu open={menuFor === lot.batch_id} onToggle={() => onMenu(lot.batch_id)}>
                      <button type="button" onClick={() => onView(lot)}>
                        View details
                      </button>
                      {lot.status === 'Sealed' ? (
                        <button type="button" onClick={() => onOpen(lot)}>
                          Open pack
                        </button>
                      ) : null}
                      {lot.kind === 'reagent' ? (
                        <button type="button" onClick={() => onLotVerify(lot.batch_id)}>
                          Lot verify…
                        </button>
                      ) : null}
                      <button type="button" onClick={() => void navigator.clipboard?.writeText(lot.batch_id)}>
                        Copy batch ID
                      </button>
                      <button type="button" onClick={() => void navigator.clipboard?.writeText(lot.lot_number)}>
                        Copy lot
                      </button>
                    </RowMenu>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={9} className="lt-empty">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ReagentDashboardPage() {
  const [data, setData] = useState<LabReagentDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [registerKind, setRegisterKind] = useState<RegisterKind>('reagent');
  const [reagentItem, setReagentItem] = useState('REAGENT-CBC');
  const [lotNumber, setLotNumber] = useState('');
  const [testsPerPack, setTestsPerPack] = useState('100');
  const [expiryDate, setExpiryDate] = useState('');

  const [newReagentName, setNewReagentName] = useState('');
  const [mapTestItem, setMapTestItem] = useState('');
  const [mapParamCode, setMapParamCode] = useState('');
  const [mapQty, setMapQty] = useState('1');
  const [mapSafety, setMapSafety] = useState('10');

  const [consumableItem, setConsumableItem] = useState('CONSUMABLE-VIAL');
  const [cLot, setCLot] = useState('');
  const [unitsPerPack, setUnitsPerPack] = useState('100');
  const [cExpiry, setCExpiry] = useState('');

  const [lotFilter, setLotFilter] = useState<LotFilter>('');
  const [search, setSearch] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [detail, setDetail] = useState<Detail>(null);
  const sectionRefs = useRef<Record<SectionKey, HTMLElement | null>>({
    record: null,
    inventory: null,
    today: null,
    expiring: null,
  });

  async function load() {
    const res = await api.getLabReagentDashboard();
    setData(res.data);
    if (res.data.reagent_items?.[0] && !res.data.reagent_items.find((i) => i.item_code === reagentItem)) {
      setReagentItem(res.data.reagent_items[0].item_code);
    }
    if (res.data.consumable_items?.[0] && !res.data.consumable_items.find((i) => i.item_code === consumableItem)) {
      setConsumableItem(res.data.consumable_items[0].item_code);
    }
    if (!mapTestItem && res.data.lab_tests?.[0]) {
      setMapTestItem(res.data.lab_tests[0].item_code);
      const firstParam = res.data.lab_tests[0].parameters?.[0]?.parameter_code || '';
      setMapParamCode(firstParam);
    }
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load reagents'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuFor]);

  const selectedTest = useMemo(
    () => (data?.lab_tests || []).find((t) => t.item_code === mapTestItem) || null,
    [data?.lab_tests, mapTestItem],
  );

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setBusy('register');
    setFormSuccess(null);
    setError(null);
    try {
      const res = await api.registerLabReagentBatch({
        reagent_item: reagentItem,
        lot_number: lotNumber,
        tests_per_pack: testsPerPack,
        expiry_date: expiryDate || undefined,
      });
      setFormSuccess(`Batch ${res.data.batch_id} registered (sealed)`);
      setLotNumber('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(null);
    }
  }

  async function onCreateMapped(e: FormEvent) {
    e.preventDefault();
    setBusy('map');
    setFormSuccess(null);
    setError(null);
    try {
      const res = await api.createMappedReagent({
        reagent_name: newReagentName,
        lab_test_item: mapTestItem,
        parameter_code: mapParamCode,
        tests_per_consumption: mapQty,
        safety_stock: mapSafety,
      });
      setFormSuccess(
        `Mapped ${res.data.reagent_name} → ${res.data.lab_test_item} / ${res.data.parameter_code} (safety ${res.data.safety_stock})`,
      );
      setNewReagentName('');
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create mapped reagent');
    } finally {
      setBusy(null);
    }
  }

  async function onOpen(batchId: string) {
    setBusy(batchId);
    setError(null);
    try {
      const res = await api.openLabReagentBatch(batchId);
      setFormSuccess(`Opened ${res.data.batch_id} — ${res.data.tests_remaining} tests available`);
      setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Open pack failed');
    } finally {
      setBusy(null);
    }
  }

  async function onLotVerify(batchId: string) {
    const outcome = window.prompt('Lot verification outcome (Pass / Fail / Conditional):', 'Pass');
    if (outcome === null) return;
    const notes = window.prompt('Notes (optional):', '') || undefined;
    setBusy(`lot-${batchId}`);
    setError(null);
    try {
      const res = await api.submitLotVerification({
        new_batch: batchId,
        outcome: outcome.trim() || 'Pass',
        notes,
      });
      setFormSuccess(`Lot verification ${res.data.verification_status} for ${res.data.batch}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lot verification failed');
    } finally {
      setBusy(null);
    }
  }

  async function onRegisterConsumable(e: FormEvent) {
    e.preventDefault();
    setBusy('cregister');
    setFormSuccess(null);
    setError(null);
    try {
      const res = await api.registerLabConsumableBatch({
        consumable_item: consumableItem,
        lot_number: cLot,
        units_per_pack: unitsPerPack,
        expiry_date: cExpiry || undefined,
      });
      setFormSuccess(`Consumable batch ${res.data.batch_id} registered (sealed)`);
      setCLot('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Consumable registration failed');
    } finally {
      setBusy(null);
    }
  }

  async function onOpenConsumable(batchId: string) {
    setBusy(batchId);
    setError(null);
    try {
      const res = await api.openLabConsumableBatch(batchId);
      setFormSuccess(`Opened ${res.data.batch_id} — ${res.data.units_remaining} units available`);
      setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Open consumable pack failed');
    } finally {
      setBusy(null);
    }
  }

  function onRegisterPack(e: FormEvent) {
    if (registerKind === 'consumable') return void onRegisterConsumable(e);
    return void onRegister(e);
  }

  function openLot(lot: LotRow) {
    if (lot.kind === 'consumable') return void onOpenConsumable(lot.batch_id);
    return void onOpen(lot.batch_id);
  }

  if (!data && !error) {
    return <p className="lt-empty">Loading reagent dashboard…</p>;
  }

  if (data && !data.available) {
    return (
      <div className="lt-page rg2-page">
        <div className="error">Lab operations access required.</div>
      </div>
    );
  }

  const lots: LotRow[] = [
    ...(data?.batches || []).map(asReagentLot),
    ...(data?.consumable_batches || []).map(asConsumableLot),
  ];
  const reorder: LabReorderAlert[] = [...(data?.reorder_alerts || []), ...(data?.consumable_reorder_alerts || [])];
  const q = search.trim().toLowerCase();
  const filtered = lots.filter(
    (lot) => lotMatchesFilter(lot, lotFilter) && matches(q, lot.name, lot.item, lot.lot_number, lot.batch_id, lot.status),
  );

  const inStock = lots.filter((l) => l.status === 'Open').length;
  const lowCount = lots.filter((l) => l.low_stock).length;
  const expiringCount = lots.filter((l) => isExpiringSoon(l.expiry_date)).length;
  const expiredCount = lots.filter((l) => isExpired(l.expiry_date)).length;
  const okCount = lots.filter((l) => {
    const d = daysUntil(l.expiry_date);
    return d == null || d > EXPIRY_WINDOW_DAYS;
  }).length;

  const today = todayIso();
  const openedToday = lots.filter((l) => (l.opened_on || '').slice(0, 10) === today);
  const expiringLots = lots.filter((l) => isExpiringSoon(l.expiry_date));

  const stockItems = Object.values(
    lots
      .filter((l) => l.status === 'Open')
      .reduce<Record<string, { name: string; remaining: number; pack: number; lots: number }>>((acc, lot) => {
        const cur = acc[lot.item] || { name: lot.name, remaining: 0, pack: 0, lots: 0 };
        cur.remaining += lot.remaining;
        cur.pack += lot.pack;
        cur.lots += 1;
        acc[lot.item] = cur;
        return acc;
      }, {}),
  );

  function scrollTo(key: SectionKey) {
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function applyFilter(next: LotFilter, section: SectionKey = 'inventory') {
    setLotFilter(next);
    scrollTo(section);
  }

  function viewLot(lot: LotRow) {
    setDetail({
      title: lot.name,
      lot,
      rows: [
        ['Kind', lot.kind === 'reagent' ? 'Reagent' : 'Consumable'],
        ['Item', lot.item],
        ['Lot', lot.lot_number],
        ['Batch', lot.batch_id],
        ['Status', <span className={`lt-badge ${statusTone(lot.status)}`}>{lot.status}</span>],
        [
          'Verification',
          lot.kind === 'reagent' ? (
            <span className={`lt-badge ${verifyTone(lot.verification_status)}`}>{lot.verification_status || 'Pending'}</span>
          ) : (
            '—'
          ),
        ],
        ['Remaining', `${lot.remaining} / ${lot.pack}${lot.status === 'Open' ? ` (${lot.usage_percent}% used)` : ''}`],
        ['Safety stock', lot.safety_stock ?? 10],
        ['Low stock', lot.low_stock ? 'Yes' : 'No'],
        ['Expiry', lot.expiry_date || '—'],
        ['Opened', formatWhen(lot.opened_on)],
      ],
    });
  }

  function chooseTest(code: string) {
    setMapTestItem(code);
    const test = (data?.lab_tests || []).find((t) => t.item_code === code);
    setMapParamCode(test?.parameters?.[0]?.parameter_code || '');
  }

  return (
    <div className="lt-page rg2-page" data-rg2="reagents-mockup">
      <section className="lt-hero">
        <span className="lt-hero-icon">
          <RgIcon size={32}>{ICON_FLASK}</RgIcon>
        </span>
        <div>
          <h2>Reagents</h2>
          <p>
            Monitor reagent stock, lots, expiry and consumption. Register packs, verify lots and track safety stock.
            {data?.rules_count ? ` ${data.rules_count} test→reagent rules active.` : ''}
          </p>
        </div>
      </section>

      <div className="lt-stats rg2-stats">
        <StatCard
          tone="tone-green"
          icon={ICON_FLASK}
          value={lots.length}
          label="Total lots"
          sub="Open and sealed packs"
          onClick={() => applyFilter('')}
        />
        <StatCard
          tone="tone-blue"
          icon={ICON_SHIELD}
          value={inStock}
          label="In stock"
          sub="Open packs in use"
          onClick={() => applyFilter('Open')}
        />
        <StatCard
          tone="tone-orange"
          icon={ICON_ALERT}
          value={lowCount}
          label="Low stock"
          sub={reorder.length ? `${reorder.length} reorder alerts` : 'At or below safety'}
          onClick={() => applyFilter('low')}
        />
        <StatCard
          tone="tone-purple"
          icon={ICON_CLOCK}
          value={expiringCount}
          label="Expiring soon"
          sub={`Within ${EXPIRY_WINDOW_DAYS} days`}
          onClick={() => applyFilter('expiring', 'expiring')}
        />
        <StatCard
          tone="tone-red"
          icon={ICON_DOC}
          value={expiredCount}
          label="Expired"
          sub="Past expiry date"
          onClick={() => applyFilter('expired')}
        />
      </div>

      {error ? <div className="error">{error}</div> : null}
      {formSuccess ? <div className="success">{formSuccess}</div> : null}

      {reorder.length ? (
        <div className="rg2-alert" role="status">
          <strong>Reorder:</strong>{' '}
          {reorder.map((a) => `${a.item_name} (${a.remaining} ≤ safety ${a.safety_stock})`).join(' · ')}
        </div>
      ) : null}

      <div
        className="rg2-record-row"
        ref={(el) => {
          sectionRefs.current.record = el;
        }}
      >
        <form className="rg2-card" onSubmit={onRegisterPack}>
          <CardHead
            icon={ICON_CLIPBOARD}
            title="Register pack"
            sub="Receive a sealed reagent or consumable lot into inventory."
          />
          <div className="rg2-form-grid">
            <label className="lt-field">
              <span>
                Kind <em>*</em>
              </span>
              <select value={registerKind} onChange={(e) => setRegisterKind(e.target.value as RegisterKind)}>
                <option value="reagent">Reagent</option>
                <option value="consumable">Consumable</option>
              </select>
            </label>
            {registerKind === 'reagent' ? (
              <>
                <label className="lt-field">
                  <span>
                    Reagent <em>*</em>
                  </span>
                  <select value={reagentItem} onChange={(e) => setReagentItem(e.target.value)} required>
                    {(data?.reagent_items || []).map((item) => (
                      <option key={item.item_code} value={item.item_code}>
                        {item.item_name}
                        {item.safety_stock != null ? ` (safety ${item.safety_stock})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lt-field">
                  <span>
                    Lot number <em>*</em>
                  </span>
                  <input className="rg2-input" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} required />
                </label>
                <label className="lt-field">
                  <span>
                    Tests per pack <em>*</em>
                  </span>
                  <input
                    className="rg2-input"
                    type="number"
                    min={1}
                    value={testsPerPack}
                    onChange={(e) => setTestsPerPack(e.target.value)}
                    required
                  />
                </label>
                <label className="lt-field">
                  <span>Expiry date</span>
                  <input className="rg2-input" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                </label>
              </>
            ) : (
              <>
                <label className="lt-field">
                  <span>
                    Consumable <em>*</em>
                  </span>
                  <select value={consumableItem} onChange={(e) => setConsumableItem(e.target.value)} required>
                    {(data?.consumable_items || []).map((item) => (
                      <option key={item.item_code} value={item.item_code}>
                        {item.item_name}
                        {item.safety_stock != null ? ` (safety ${item.safety_stock})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lt-field">
                  <span>
                    Lot number <em>*</em>
                  </span>
                  <input className="rg2-input" value={cLot} onChange={(e) => setCLot(e.target.value)} required />
                </label>
                <label className="lt-field">
                  <span>
                    Units per pack <em>*</em>
                  </span>
                  <input
                    className="rg2-input"
                    type="number"
                    min={1}
                    value={unitsPerPack}
                    onChange={(e) => setUnitsPerPack(e.target.value)}
                    required
                  />
                </label>
                <label className="lt-field">
                  <span>Expiry date</span>
                  <input className="rg2-input" type="date" value={cExpiry} onChange={(e) => setCExpiry(e.target.value)} />
                </label>
              </>
            )}
          </div>
          <div className="rg2-form-foot">
            <button
              className="lt-action rg2-submit"
              type="submit"
              disabled={busy === 'register' || busy === 'cregister'}
            >
              {busy === 'register' || busy === 'cregister' ? 'Saving…' : 'Register sealed pack'}
            </button>
            <span className="rg2-hint">
              Reagents debit when a report is finalized. Consumables debit once per completed TRF.
            </span>
          </div>
        </form>

        <StockSummary items={stockItems} expired={expiredCount} soon={expiringCount} ok={okCount} />
      </div>

      <section
        className="lt-table-card rg2-card rg2-table-card"
        ref={(el) => {
          sectionRefs.current.inventory = el;
        }}
      >
        <CardHead icon={ICON_BOX} title="Inventory" sub="View reagent and consumable lots, remaining stock and expiry.">
          <label className="lt-search rg2-search">
            <RgIcon size={16}>{ICON_SEARCH}</RgIcon>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, item or lot…" />
          </label>
          <label className="lt-field rg2-status">
            <select value={lotFilter} onChange={(e) => setLotFilter(e.target.value as LotFilter)} aria-label="Status filter">
              <option value="">All Status</option>
              <option value="Open">Open</option>
              <option value="Sealed">Sealed</option>
              <option value="low">Low stock</option>
              <option value="expiring">Expiring soon</option>
              <option value="expired">Expired</option>
            </select>
          </label>
          <button type="button" className="lt-action rg2-add" onClick={() => setShowAdd(true)}>
            <RgIcon size={16}>{ICON_PLUS}</RgIcon> Add Reagent
          </button>
        </CardHead>
        <LotTable
          lots={filtered}
          empty={q || lotFilter ? 'No lots match your filters.' : 'No batches yet — register a pack above.'}
          menuFor={menuFor}
          onView={viewLot}
          onMenu={(id) => setMenuFor(menuFor === id ? null : id)}
          onOpen={openLot}
          onLotVerify={onLotVerify}
        />
      </section>

      <div className="rg2-bottom-row">
        <section
          className="lt-table-card rg2-card rg2-table-card"
          ref={(el) => {
            sectionRefs.current.today = el;
          }}
        >
          <CardHead icon={ICON_CLIPBOARD} title="Today's activity" sub="Lots opened today." />
          <div className="lt-table-wrap">
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Lot</th>
                  <th>Remaining</th>
                  <th>Status</th>
                  <th>Opened</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {openedToday.length ? (
                  openedToday.map((lot) => (
                    <tr key={`today-${lot.batch_id}`}>
                      <td>{lot.name}</td>
                      <td>{lot.lot_number}</td>
                      <td>
                        {lot.remaining} / {lot.pack}
                      </td>
                      <td>
                        <span className={`lt-badge ${statusTone(lot.status)}`}>{lot.status}</span>
                      </td>
                      <td className="rg2-nowrap">{formatWhen(lot.opened_on)}</td>
                      <td>
                        <button type="button" className="lt-action is-ghost rg2-view" onClick={() => viewLot(lot)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="lt-empty">
                      No packs opened today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section
          className="lt-table-card rg2-card rg2-table-card"
          ref={(el) => {
            sectionRefs.current.expiring = el;
          }}
        >
          <CardHead icon={ICON_CLOCK} title="Expiring soon" sub={`Lots due within ${EXPIRY_WINDOW_DAYS} days.`} />
          <div className="lt-table-wrap">
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Lot</th>
                  <th>Expiry</th>
                  <th>Remaining</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {expiringLots.length ? (
                  expiringLots.map((lot) => (
                    <tr key={`exp-${lot.batch_id}`}>
                      <td>{lot.name}</td>
                      <td>{lot.lot_number}</td>
                      <td>{lot.expiry_date || '—'}</td>
                      <td>
                        {lot.remaining} / {lot.pack}
                      </td>
                      <td>
                        <span className={`lt-badge ${statusTone(lot.status)}`}>{lot.status}</span>
                      </td>
                      <td>
                        <button type="button" className="lt-action is-ghost rg2-view" onClick={() => viewLot(lot)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="lt-empty">
                      No lots expiring in the next {EXPIRY_WINDOW_DAYS} days.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showAdd ? (
        <AddMappedModal
          tests={data?.lab_tests || []}
          selectedTest={selectedTest}
          busy={busy === 'map'}
          name={newReagentName}
          testItem={mapTestItem}
          paramCode={mapParamCode}
          qty={mapQty}
          safety={mapSafety}
          onName={setNewReagentName}
          onTest={chooseTest}
          onParam={setMapParamCode}
          onQty={setMapQty}
          onSafety={setMapSafety}
          onSubmit={onCreateMapped}
          onClose={() => setShowAdd(false)}
        />
      ) : null}

      {detail ? (
        <DetailModal
          detail={detail}
          busy={busy}
          onClose={() => setDetail(null)}
          onOpen={openLot}
          onLotVerify={onLotVerify}
        />
      ) : null}
    </div>
  );
}
