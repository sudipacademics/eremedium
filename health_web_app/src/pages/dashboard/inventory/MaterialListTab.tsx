import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import type { InvItem, InvItemFilters, InvItemList } from '../../../types/labInventory';
import { ItemDetailModal } from './ItemDetailModal';
import { ItemFormModal } from './ItemFormModal';
import { INV_ICONS, ItemThumb, Pager, RowMenu, StockPill, Svg, downloadExport, fmtDate, fmtQty, useInv } from './shared';

const EMPTY: InvItemFilters = { q: '', category: '', status: '', location: '', supplier: '', expiry_from: '', expiry_to: '', show: 'active' };

export function MaterialListTab({
  preset,
  onStockIn,
}: {
  preset: { filters: InvItemFilters; key: number } | null;
  onStockIn: (items: string[]) => void;
}) {
  const { meta, canManage, version, refreshAll, notify, fail } = useInv();
  const [draft, setDraft] = useState<InvItemFilters>({ ...EMPTY, ...(preset?.filters || {}) });
  const [filters, setFilters] = useState<InvItemFilters>({ ...EMPTY, ...(preset?.filters || {}) });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<InvItemList | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<InvItem | null>(null);

  useEffect(() => {
    if (!preset) return;
    const next = { ...EMPTY, ...preset.filters };
    setDraft(next);
    setFilters(next);
    setPage(1);
  }, [preset]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listInventoryItems(filters, page, pageSize);
      setData(res.data);
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, fail]);

  useEffect(() => {
    void load();
  }, [load, version]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setFilters({ ...draft });
  }

  function onClear() {
    setDraft(EMPTY);
    setFilters(EMPTY);
    setPage(1);
  }

  async function exportList(fmt: 'xlsx' | 'csv') {
    try {
      const res = await api.exportLabInventory('items', fmt, { ...filters });
      downloadExport(res.data);
    } catch (e) {
      fail(e);
    }
  }

  async function toggleActive(it: InvItem) {
    try {
      await api.saveInventoryItem({ ...it, active: it.active ? 0 : 1 });
      notify(`${it.item_name} ${it.active ? 'deactivated' : 'reactivated'}`);
      refreshAll();
    } catch (e) {
      fail(e);
    }
  }

  const rows = data?.rows || [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.includes(r.name));
  const d = (k: keyof InvItemFilters, v: string) => setDraft((f) => ({ ...f, [k]: v }));

  return (
    <>
      <form className="inv-filters" onSubmit={onSearch}>
        <label className="lt-field inv-filter-search">
          <span className="sr-only">Search</span>
          <span className="lt-search">
            <Svg size={16}>{INV_ICONS.search}</Svg>
            <input value={draft.q} onChange={(e) => d('q', e.target.value)} placeholder="Search by item name, SKU, category, batch or supplier..." />
          </span>
        </label>
        <label className="lt-field">
          Category
          <select value={draft.category} onChange={(e) => d('category', e.target.value)}>
            <option value="">All categories</option>
            {meta?.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="lt-field">
          Stock Status
          <select value={draft.status} onChange={(e) => d('status', e.target.value)}>
            <option value="">All status</option>
            {meta?.item_statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="lt-field">
          Location
          <select value={draft.location} onChange={(e) => d('location', e.target.value)}>
            <option value="">All locations</option>
            {meta?.locations.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="lt-field">
          Supplier
          <select value={draft.supplier} onChange={(e) => d('supplier', e.target.value)}>
            <option value="">All suppliers</option>
            {meta?.suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="lt-field inv-filter-dates">
          Expiry Date
          <span className="lt-dates">
            <input type="date" value={draft.expiry_from} onChange={(e) => d('expiry_from', e.target.value)} aria-label="Expiry from" />
            <span>-</span>
            <input type="date" value={draft.expiry_to} onChange={(e) => d('expiry_to', e.target.value)} aria-label="Expiry to" />
          </span>
        </label>
        <label className="lt-field">
          Show
          <select value={draft.show} onChange={(e) => d('show', e.target.value)}>
            <option value="active">Active items</option>
            <option value="all">All items</option>
            <option value="inactive">Inactive items</option>
          </select>
        </label>
        <div className="inv-filter-actions">
          <button type="button" className="lt-btn-clear" onClick={onClear}>
            Clear
          </button>
          <button type="submit" className="lt-btn-search">
            Search
          </button>
        </div>
      </form>

      <div className="inv-table-tools">
        <span className="inv-muted">
          {loading ? 'Loading…' : data ? `${data.total.toLocaleString('en-IN')} items` : ''}
          {data?.status_counts
            ? Object.entries(data.status_counts)
                .map(([s, c]) => ` · ${s}: ${c}`)
                .join('')
            : ''}
        </span>
        <span className="inv-tools-right">
          {canManage && selected.length ? (
            <button type="button" className="lt-action is-ghost" onClick={() => onStockIn(selected)}>
              Stock in selected ({selected.length})
            </button>
          ) : null}
          <button type="button" className="lt-action is-ghost" onClick={() => void exportList('xlsx')}>
            Excel
          </button>
          <button type="button" className="lt-action is-ghost" onClick={() => void exportList('csv')}>
            CSV
          </button>
        </span>
      </div>

      <div className="lt-table-card inv-table-card">
        <div className="lt-table-wrap">
          <table className="lt-table inv-table">
            <thead>
              <tr>
                <th className="lt-col-check">
                  <input
                    type="checkbox"
                    aria-label="Select all on page"
                    checked={allOnPage}
                    onChange={() =>
                      setSelected((cur) => (allOnPage ? cur.filter((n) => !rows.some((r) => r.name === n)) : [...new Set([...cur, ...rows.map((r) => r.name)])]))
                    }
                  />
                </th>
                <th>#</th>
                <th>Item Name</th>
                <th>Category</th>
                <th>SKU / Item Code</th>
                <th>Batch No.</th>
                <th>Expiry Date</th>
                <th>Available Qty</th>
                <th>Unit</th>
                <th>Min. Stock</th>
                <th>Location</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((r, i) => (
                  <tr key={r.name} className={r.active ? '' : 'inv-row-muted'}>
                    <td className="lt-col-check">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.item_name}`}
                        checked={selected.includes(r.name)}
                        onChange={() => setSelected((cur) => (cur.includes(r.name) ? cur.filter((n) => n !== r.name) : [...cur, r.name]))}
                      />
                    </td>
                    <td>{(page - 1) * pageSize + i + 1}</td>
                    <td>
                      <span className="inv-item-cell">
                        <ItemThumb name={r.item_name} category={r.category} />
                        <span>
                          {r.item_name}
                          {!r.active ? <small className="inv-muted"> (inactive)</small> : null}
                        </span>
                      </span>
                    </td>
                    <td>{r.category || '—'}</td>
                    <td className="inv-nowrap">{r.sku}</td>
                    <td className="inv-nowrap">
                      {r.next_batch_no || '—'}
                      {r.batch_count > 1 ? <small className="inv-muted"> +{r.batch_count - 1}</small> : null}
                    </td>
                    <td className="inv-nowrap">{fmtDate(r.next_expiry)}</td>
                    <td>{fmtQty(r.available_qty)}</td>
                    <td>{r.unit}</td>
                    <td>{fmtQty(r.min_stock)}</td>
                    <td>{r.location || '—'}</td>
                    <td>
                      <StockPill status={r.status} />
                    </td>
                    <td>
                      <span className="inv-actions">
                        <button type="button" className="inv-view-btn" onClick={() => setViewing(r.name)}>
                          View
                        </button>
                        <RowMenu open={menuFor === r.name} onToggle={() => setMenuFor((cur) => (cur === r.name ? null : r.name))}>
                          <button type="button" onClick={() => setViewing(r.name)}>
                            View batches & history
                          </button>
                          {canManage ? (
                            <>
                              <button type="button" onClick={() => onStockIn([r.name])}>
                                Stock in
                              </button>
                              <button type="button" onClick={() => setEditing(r)}>
                                Edit item
                              </button>
                              <button type="button" onClick={() => void toggleActive(r)}>
                                {r.active ? 'Deactivate' : 'Reactivate'}
                              </button>
                            </>
                          ) : null}
                          <button type="button" onClick={() => void navigator.clipboard?.writeText(r.sku)}>
                            Copy SKU
                          </button>
                        </RowMenu>
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={13} className="lt-empty">
                    {loading ? 'Loading…' : 'No inventory items match these filters.'}
                    {!loading && canManage && !data?.total ? ' Use “Add New Item” to create the first one.' : ''}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={page}
          pageSize={pageSize}
          total={data?.total || 0}
          noun="items"
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      {viewing ? (
        <ItemDetailModal
          item={viewing}
          onClose={() => setViewing(null)}
          onStockIn={(it) => {
            setViewing(null);
            onStockIn([it]);
          }}
        />
      ) : null}
      {editing ? (
        <ItemFormModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            notify(`Item ${name} saved`);
            refreshAll();
          }}
        />
      ) : null}
    </>
  );
}
