import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import type { InvItemStatus, InvUnitItemDetail, InvUnitStockFilters, InvUnitStockList, InvUnitTxn } from '../../types/labInventory';
import { PartnerRequisitionsPanel, type RequisitionPrefill } from './B2bMaterialRequestsPage';
import './partner-consumables.css';

type Tab = 'stock' | 'requisitions' | 'history';

const EMPTY: InvUnitStockFilters = { q: '', category: '', location: '', status: '' };
const CHIPS: Array<{ label: string; status: string }> = [
  { label: 'All', status: '' },
  { label: 'In Stock', status: 'In Stock' },
  { label: 'Low Stock', status: 'Low Stock' },
  { label: 'Out of Stock', status: 'Out of Stock' },
  { label: 'Expiring Soon', status: 'Expiring Soon' },
  { label: 'Expired', status: 'Expired' },
];
const TONES: Record<InvItemStatus, string> = {
  'In Stock': 'green',
  'Low Stock': 'amber',
  'Expiring Soon': 'orange',
  'Out of Stock': 'red',
  Expired: 'muted',
};

function err(e: unknown, fallback = 'Something went wrong') {
  return e instanceof Error ? e.message : fallback;
}

function num(n?: number | null) {
  return n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function day(raw?: string | null) {
  if (!raw) return '—';
  const d = new Date(String(raw).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function stamp(raw?: string | null) {
  if (!raw) return '—';
  const d = new Date(String(raw).replace(' ', 'T'));
  return Number.isNaN(d.getTime())
    ? String(raw)
    : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

function Ico({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function Pill({ status }: { status: InvItemStatus }) {
  return <span className={`pc-pill tone-${TONES[status] || 'muted'}`}>{status}</span>;
}

function Thumb({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span className="pc-thumb" aria-hidden>
      {initials}
    </span>
  );
}

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const list: Array<number | '…'> = [];
  for (let i = 1; i <= pages; i += 1) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) list.push(i);
    else if (list[list.length - 1] !== '…') list.push('…');
  }
  const from = total ? (page - 1) * pageSize + 1 : 0;
  return (
    <div className="pc-foot">
      <span>
        Showing {from} to {Math.min(total, page * pageSize)} of {total} items
      </span>
      <div className="pc-pager">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          ‹
        </button>
        {list.map((p, i) =>
          p === '…' ? (
            <span key={`g${i}`}>…</span>
          ) : (
            <button type="button" key={p} className={p === page ? 'is-active' : ''} onClick={() => onPage(p)}>
              {p}
            </button>
          ),
        )}
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          ›
        </button>
      </div>
    </div>
  );
}

export function B2bConsumablesInventoryPage() {
  const [params, setParams] = useSearchParams();
  const tab = (['stock', 'requisitions', 'history'].includes(params.get('tab') || '') ? params.get('tab') : 'stock') as Tab;
  const [prefill, setPrefill] = useState<RequisitionPrefill | null>(null);
  const [stockVersion, setStockVersion] = useState(0);

  function go(next: Tab) {
    const p = new URLSearchParams(params);
    if (next === 'stock') p.delete('tab');
    else p.set('tab', next);
    setParams(p, { replace: true });
  }

  function request(lines: Record<string, string>) {
    setPrefill({ lines, key: Date.now() });
    go('requisitions');
  }

  async function newRequisition() {
    try {
      const res = await api.getPartnerUnitStock({}, 1, 500);
      const lines: Record<string, string> = {};
      res.data.rows.filter((r) => r.suggested_qty > 0).forEach((r) => (lines[r.name] = String(r.suggested_qty)));
      request(lines);
    } catch {
      request({});
    }
  }

  return (
    <div className="pc-page">
      <div className="pc-head">
        <div>
          <h1>Consumables Inventory</h1>
          <p>View current stock of consumable materials at your unit. Track usage, raise requisition for new stock and monitor stock levels.</p>
        </div>
        <button type="button" className="pc-btn pc-btn-primary" onClick={() => void newRequisition()}>
          <Ico>
            <path d="M12 5v14M5 12h14" />
          </Ico>
          New Requisition
        </button>
      </div>

      <nav className="pc-tabs" aria-label="Consumables sections">
        <button type="button" className={tab === 'stock' ? 'is-active' : ''} onClick={() => go('stock')}>
          Stock
        </button>
        <button type="button" className={tab === 'requisitions' ? 'is-active' : ''} onClick={() => go('requisitions')}>
          Requisitions &amp; dispatches
        </button>
        <button type="button" className={tab === 'history' ? 'is-active' : ''} onClick={() => go('history')}>
          History
        </button>
      </nav>

      {tab === 'stock' ? <StockTab version={stockVersion} onRequest={request} /> : null}
      {tab === 'requisitions' ? <PartnerRequisitionsPanel prefill={prefill} onChanged={() => setStockVersion((v) => v + 1)} /> : null}
      {tab === 'history' ? <HistoryTab /> : null}
    </div>
  );
}

function StockTab({ version, onRequest }: { version: number; onRequest: (lines: Record<string, string>) => void }) {
  const [draft, setDraft] = useState<InvUnitStockFilters>(EMPTY);
  const [filters, setFilters] = useState<InvUnitStockFilters>(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<InvUnitStockList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [open, setOpen] = useState<{ item: string; mode: 'view' | 'usage' | 'adjust' | 'min' } | null>(null);
  const [reload, setReload] = useState(0);
  const pageSize = 10;

  const load = useCallback(async () => {
    try {
      setData((await api.getPartnerUnitStock(filters, page, pageSize)).data);
      setError(null);
    } catch (e) {
      setError(err(e, 'Could not load your stock'));
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load, version, reload]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuFor]);

  function apply(next: InvUnitStockFilters) {
    setDraft(next);
    setFilters(next);
    setPage(1);
  }

  const k = data?.kpis;
  const rows = data?.rows || [];

  return (
    <>
      <section className="pc-stats" aria-label="Stock summary">
        <button type="button" className={`pc-stat tone-teal${!filters.status ? ' is-active' : ''}`} onClick={() => apply({ ...filters, status: '' })}>
          <span className="pc-stat-ico">
            <Ico>
              <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9z" />
              <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
            </Ico>
          </span>
          <span>
            <small>Total Items</small>
            <strong>{num(k?.total_items)}</strong>
            <em>All consumable items</em>
          </span>
        </button>
        <div className="pc-stat tone-blue">
          <span className="pc-stat-ico">
            <Ico>
              <ellipse cx="12" cy="6" rx="7" ry="2.8" />
              <path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6" />
            </Ico>
          </span>
          <span>
            <small>Available Stock</small>
            <strong>{num(k?.available_stock)}</strong>
            <em>Units in stock</em>
          </span>
        </div>
        <button type="button" className={`pc-stat tone-amber${filters.status === 'Low Stock' ? ' is-active' : ''}`} onClick={() => apply({ ...filters, status: 'Low Stock' })}>
          <span className="pc-stat-ico">
            <Ico>
              <path d="M12 3.5 2.8 19.5h18.4z" />
              <path d="M12 10v4M12 17h.01" />
            </Ico>
          </span>
          <span>
            <small>Low Stock Items</small>
            <strong>{num(k?.low_stock_items)}</strong>
            <em>At or below minimum level</em>
          </span>
        </button>
        <button type="button" className={`pc-stat tone-rose${filters.status === 'Expiring Soon' ? ' is-active' : ''}`} onClick={() => apply({ ...filters, status: 'Expiring Soon' })}>
          <span className="pc-stat-ico">
            <Ico>
              <rect x="3.5" y="5" width="17" height="15" rx="2" />
              <path d="M3.5 10h17M8 3v4M16 3v4" />
            </Ico>
          </span>
          <span>
            <small>Expiring Soon</small>
            <strong>{num(k?.expiring_soon)}</strong>
            <em>Batches within 3 months</em>
          </span>
        </button>
      </section>

      {error ? <div className="partners-alert error">{error}</div> : null}
      {notice ? <div className="partners-alert">{notice}</div> : null}

      <form
        className="pc-filters"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ ...draft, status: filters.status });
        }}
      >
        <span className="pc-search">
          <Ico>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4-4" />
          </Ico>
          <input value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} placeholder="Search by item name, SKU, category, batch or supplier..." />
        </span>
        <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} aria-label="Category">
          <option value="">All Categories</option>
          {data?.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} aria-label="Location">
          <option value="">All Locations</option>
          {data?.locations.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={filters.status} onChange={(e) => apply({ ...draft, status: e.target.value })} aria-label="Status">
          <option value="">All Status</option>
          {CHIPS.slice(1).map((c) => (
            <option key={c.status}>{c.status}</option>
          ))}
        </select>
        <button type="button" className="pc-btn pc-btn-soft" onClick={() => apply(EMPTY)}>
          Clear
        </button>
        <button type="submit" className="pc-btn pc-btn-primary">
          Search
        </button>
      </form>

      <div className="pc-chips">
        {CHIPS.map((c) => (
          <button key={c.label} type="button" className={filters.status === c.status ? 'is-active' : ''} onClick={() => apply({ ...filters, status: c.status })}>
            {c.label}
            {c.status && data?.status_counts[c.status] ? <span>{data.status_counts[c.status]}</span> : null}
          </button>
        ))}
      </div>

      <div className="pc-table-card">
        <div className="pc-table-wrap">
          <table className="pc-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item Name</th>
                <th>Category</th>
                <th>SKU / Item Code</th>
                <th>Batch No.</th>
                <th>Expiry Date</th>
                <th>Available Qty</th>
                <th>Unit</th>
                <th>Min. Stock</th>
                <th>Status</th>
                <th>Action</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((r, i) => (
                  <tr key={r.name}>
                    <td>{(page - 1) * pageSize + i + 1}</td>
                    <td>
                      <span className="pc-item">
                        <Thumb name={r.item_name} />
                        {r.item_name}
                      </span>
                    </td>
                    <td>{r.category || '—'}</td>
                    <td className="pc-nowrap">{r.sku}</td>
                    <td className="pc-nowrap">
                      {r.next_batch_no || '—'}
                      {r.batch_count > 1 ? <small className="pc-muted"> +{r.batch_count - 1}</small> : null}
                    </td>
                    <td className="pc-nowrap">{day(r.next_expiry)}</td>
                    <td>{num(r.available_qty)}</td>
                    <td>{r.unit}</td>
                    <td title={r.own_min !== null ? 'Set by your unit' : 'Default from the central lab'}>
                      {num(r.min_stock)}
                      {r.own_min !== null ? <small className="pc-muted"> (yours)</small> : null}
                    </td>
                    <td>
                      <Pill status={r.status} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="pc-btn pc-btn-outline pc-btn-sm"
                        disabled={!r.active}
                        title={r.active ? '' : 'Item is no longer issued by the central store'}
                        onClick={() => onRequest({ [r.name]: String(r.suggested_qty || '') })}
                      >
                        Request
                      </button>
                    </td>
                    <td className="pc-menu-cell">
                      <button
                        type="button"
                        className="pc-kebab"
                        aria-label="More actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor((cur) => (cur === r.name ? null : r.name));
                        }}
                      >
                        ⋮
                      </button>
                      {menuFor === r.name ? (
                        <div className="pc-menu" role="menu">
                          <button type="button" onClick={() => setOpen({ item: r.name, mode: 'view' })}>
                            Batches &amp; history
                          </button>
                          <button type="button" onClick={() => setOpen({ item: r.name, mode: 'usage' })}>
                            Record usage
                          </button>
                          <button type="button" onClick={() => setOpen({ item: r.name, mode: 'adjust' })}>
                            Adjust / physical count
                          </button>
                          <button type="button" onClick={() => setOpen({ item: r.name, mode: 'min' })}>
                            Set my minimum
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={12} className="pc-empty">
                    {data
                      ? data.total === 0 && !filters.q && !filters.status && !filters.category && !filters.location
                        ? 'No stock at your unit yet. Items appear here when you confirm receipt of a dispatch from the lab.'
                        : 'No items match these filters.'
                      : 'Loading…'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} pageSize={pageSize} total={data?.total || 0} onPage={setPage} />
      </div>

      {open ? (
        <ItemModal
          item={open.item}
          mode={open.mode}
          usageReasons={data?.usage_reasons || []}
          adjustReasons={data?.adjust_reasons || []}
          onClose={() => setOpen(null)}
          onDone={(msg) => {
            setNotice(msg);
            setOpen(null);
            setReload((v) => v + 1);
          }}
        />
      ) : null}
    </>
  );
}

function ItemModal({
  item,
  mode: initialMode,
  usageReasons,
  adjustReasons,
  onClose,
  onDone,
}: {
  item: string;
  mode: 'view' | 'usage' | 'adjust' | 'min';
  usageReasons: string[];
  adjustReasons: string[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [data, setData] = useState<InvUnitItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState('');
  const [stock, setStock] = useState('');
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [adjMode, setAdjMode] = useState<'count' | 'decrease' | 'increase' | 'new'>('count');
  const [newBatch, setNewBatch] = useState({ batch_no: '', expiry_date: '' });
  const [minValue, setMinValue] = useState('');

  useEffect(() => {
    api
      .getPartnerUnitItem(item)
      .then((res) => {
        setData(res.data);
        setMinValue(String(res.data.item.min_stock ?? ''));
        setStock(res.data.batches[0]?.name || '');
      })
      .catch((e) => setError(err(e)));
  }, [item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const it = data?.item;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!it) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'usage') {
        const res = await api.recordPartnerUnitUsage({ item, qty: Number(qty), stock: stock || undefined, reason, remarks });
        onDone(`Used ${num(res.data.used)} ${it.unit} of ${it.item_name}. On hand now ${num(res.data.balance)}.`);
      } else if (mode === 'adjust') {
        const res =
          adjMode === 'new'
            ? await api.adjustPartnerUnitStock({ item, batch_no: newBatch.batch_no, expiry_date: newBatch.expiry_date || undefined, qty: Number(qty), reason, remarks })
            : await api.adjustPartnerUnitStock({
                stock,
                reason,
                remarks,
                ...(adjMode === 'count' ? { counted_qty: qty } : { direction: adjMode, qty: Number(qty) }),
              });
        onDone(`${it.item_name} adjusted by ${res.data.delta > 0 ? '+' : ''}${num(res.data.delta)}. Batch balance ${num(res.data.balance)}.`);
      } else if (mode === 'min') {
        const res = await api.setPartnerUnitMinStock(item, minValue.trim() === '' ? '' : Number(minValue));
        onDone(res.data.min_stock === null ? `${it.item_name} uses the lab's default minimum again.` : `Minimum for ${it.item_name} set to ${num(res.data.min_stock)}.`);
      }
    } catch (e2) {
      setError(err(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pc-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pc-modal" role="dialog" aria-modal="true" aria-label={it?.item_name || 'Item'}>
        <div className="pc-modal-head">
          <div>
            <h3>{it?.item_name || 'Loading…'}</h3>
            {it ? (
              <p>
                {it.sku} · on hand <b>{num(it.available_qty)}</b> {it.unit} · minimum {num(it.min_stock)} · <Pill status={it.status} />
              </p>
            ) : null}
          </div>
          <button type="button" className="pc-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="pc-modal-tabs">
          {(['view', 'usage', 'adjust', 'min'] as const).map((m) => (
            <button key={m} type="button" className={mode === m ? 'is-active' : ''} onClick={() => setMode(m)}>
              {m === 'view' ? 'Batches & history' : m === 'usage' ? 'Record usage' : m === 'adjust' ? 'Adjust / count' : 'My minimum'}
            </button>
          ))}
        </div>
        <div className="pc-modal-body">
          {error ? <div className="partners-alert error">{error}</div> : null}
          {data && mode === 'view' ? (
            <>
              <table className="pc-table">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Expiry</th>
                    <th>Location</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {data.batches.length ? (
                    data.batches.map((b) => (
                      <tr key={b.name}>
                        <td>{b.batch_no}</td>
                        <td>
                          {day(b.expiry_date)} {b.expired ? <span className="pc-pill tone-muted">Expired</span> : null}
                        </td>
                        <td>{b.location}</td>
                        <td>{num(b.qty)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="pc-empty">
                        No stock on hand.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <TxnTable rows={data.history} />
            </>
          ) : null}
          {data && mode !== 'view' ? (
            <form className="pc-form" onSubmit={(e) => void submit(e)}>
              {mode === 'min' ? (
                <>
                  <label>
                    <span>Minimum stock at your unit</span>
                    <input type="number" min="0" step="any" value={minValue} onChange={(e) => setMinValue(e.target.value)} placeholder={`Lab default ${num(it?.default_min)}`} />
                  </label>
                  <p className="pc-muted">
                    Low Stock shows when you have this much or less. Leave empty to use the lab's default ({num(it?.default_min)}).
                  </p>
                </>
              ) : (
                <>
                  {mode === 'adjust' ? (
                    <label>
                      <span>Adjustment</span>
                      <select value={adjMode} onChange={(e) => setAdjMode(e.target.value as typeof adjMode)}>
                        <option value="count">Set batch to counted qty</option>
                        <option value="decrease">Decrease (−)</option>
                        <option value="increase">Increase (+)</option>
                        <option value="new">Add a batch not received through the lab</option>
                      </select>
                    </label>
                  ) : null}
                  {mode === 'adjust' && adjMode === 'new' ? (
                    <>
                      <label>
                        <span>Batch no.</span>
                        <input value={newBatch.batch_no} onChange={(e) => setNewBatch((b) => ({ ...b, batch_no: e.target.value }))} placeholder="Auto if blank" />
                      </label>
                      <label>
                        <span>Expiry date</span>
                        <input type="date" value={newBatch.expiry_date} onChange={(e) => setNewBatch((b) => ({ ...b, expiry_date: e.target.value }))} />
                      </label>
                    </>
                  ) : (
                    <label>
                      <span>Batch</span>
                      <select value={stock} onChange={(e) => setStock(e.target.value)} required={mode === 'adjust'}>
                        {mode === 'usage' ? <option value="">Earliest expiry first (FEFO)</option> : null}
                        {data.batches.map((b) => (
                          <option key={b.name} value={b.name} disabled={mode === 'usage' && b.expired}>
                            {b.batch_no} · {num(b.qty)} on hand{b.expiry_date ? ` · exp ${day(b.expiry_date)}` : ''}
                            {b.expired ? ' (expired)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    <span>{mode === 'adjust' && adjMode === 'count' ? 'Counted quantity' : 'Quantity'}</span>
                    <input type="number" min="0" step="any" required value={qty} onChange={(e) => setQty(e.target.value)} />
                  </label>
                  <label>
                    <span>Reason</span>
                    <select value={reason} required={mode === 'adjust'} onChange={(e) => setReason(e.target.value)}>
                      <option value="">{mode === 'usage' ? 'Select (optional)…' : 'Select reason…'}</option>
                      {(mode === 'usage' ? usageReasons : adjustReasons).map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  <label className="pc-span-2">
                    <span>Remarks</span>
                    <input value={remarks} onChange={(e) => setRemarks(e.target.value)} required={reason === 'Other'} />
                  </label>
                </>
              )}
              <div className="pc-form-actions">
                <button type="button" className="pc-btn pc-btn-soft" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="pc-btn pc-btn-primary" disabled={busy}>
                  {busy ? 'Saving…' : mode === 'usage' ? 'Record usage' : mode === 'adjust' ? 'Post adjustment' : 'Save minimum'}
                </button>
              </div>
            </form>
          ) : null}
          {!data && !error ? <p className="pc-empty">Loading…</p> : null}
        </div>
      </div>
    </div>
  );
}

function TxnTable({ rows }: { rows: InvUnitTxn[] }) {
  return (
    <table className="pc-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Type</th>
          <th>Item</th>
          <th>Batch</th>
          <th>Qty</th>
          <th>Balance</th>
          <th>Reason / reference</th>
          <th>By</th>
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((t) => (
            <tr key={t.name}>
              <td className="pc-nowrap">{stamp(t.posting_datetime)}</td>
              <td>
                <span className={`pc-txn is-${t.transaction_type.toLowerCase()}`}>{t.transaction_type}</span>
              </td>
              <td>
                {t.item_name}
                <div className="pc-muted">{t.sku}</div>
              </td>
              <td>{t.batch_no}</td>
              <td className={t.qty_delta >= 0 ? 'pc-pos' : 'pc-neg'}>
                {t.qty_delta > 0 ? '+' : ''}
                {num(t.qty_delta)} {t.unit}
              </td>
              <td>{num(t.balance_after)}</td>
              <td>
                {[t.reason, t.reference_name].filter(Boolean).join(' · ') || '—'}
                {t.remarks ? <div className="pc-muted">{t.remarks}</div> : null}
              </td>
              <td>{t.user_name || t.user || '—'}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={8} className="pc-empty">
              No movements yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function HistoryTab() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ q: '', transaction_type: '', date_from: '', date_to: '' });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<InvUnitTxn[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;

  useEffect(() => {
    api
      .listPartnerUnitTransactions(applied, page, pageSize)
      .then((res) => {
        setRows(res.data.rows);
        setTotal(res.data.total);
      })
      .catch((e) => setError(err(e)));
  }, [applied, page]);

  return (
    <>
      {error ? <div className="partners-alert error">{error}</div> : null}
      <form
        className="pc-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied({ q, transaction_type: type, date_from: from, date_to: to });
        }}
      >
        <span className="pc-search">
          <Ico>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4-4" />
          </Ico>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, SKU, batch, dispatch no. or reason..." />
        </span>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All movements</option>
          <option>Receipt</option>
          <option>Usage</option>
          <option>Adjustment</option>
          <option>Reversal</option>
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <button
          type="button"
          className="pc-btn pc-btn-soft"
          onClick={() => {
            setQ('');
            setType('');
            setFrom('');
            setTo('');
            setPage(1);
            setApplied({ q: '', transaction_type: '', date_from: '', date_to: '' });
          }}
        >
          Clear
        </button>
        <button type="submit" className="pc-btn pc-btn-primary">
          Search
        </button>
      </form>
      <div className="pc-table-card">
        <div className="pc-table-wrap">
          <TxnTable rows={rows} />
        </div>
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </div>
    </>
  );
}