import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import type { InvHistoryFilters, InvTransactionList } from '../../../types/labInventory';
import { INV_ICONS, ItemSelect, Pager, Svg, TxnQty, downloadExport, fmtDate, fmtDateTime, fmtQty, useInv } from './shared';

const EMPTY: InvHistoryFilters = { q: '', transaction_type: '', item: '', location: '', date_from: '', date_to: '' };

export function HistoryTab() {
  const { meta, version, fail } = useInv();
  const [draft, setDraft] = useState<InvHistoryFilters>(EMPTY);
  const [filters, setFilters] = useState<InvHistoryFilters>(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<InvTransactionList | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listInventoryTransactions(filters, page, pageSize);
      setData(res.data);
    } catch (e) {
      fail(e);
    }
  }, [filters, page, pageSize, fail]);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function exportList(fmt: 'xlsx' | 'csv') {
    try {
      downloadExport((await api.exportLabInventory('history', fmt, { ...filters })).data);
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div className="inv-stack">
      <div className="inv-section-head">
        <div>
          <h3>Stock History</h3>
          <p className="inv-muted">Complete, append-only ledger of every stock movement. Cancelled dispatches appear as Reversal entries; nothing is ever edited or deleted.</p>
        </div>
        <div className="inv-tools-right">
          <button type="button" className="lt-action is-ghost" onClick={() => void exportList('xlsx')}>
            <Svg size={15}>{INV_ICONS.download}</Svg> Excel
          </button>
          <button type="button" className="lt-action is-ghost" onClick={() => void exportList('csv')}>
            <Svg size={15}>{INV_ICONS.download}</Svg> CSV
          </button>
        </div>
      </div>

      <form
        className="inv-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilters({ ...draft });
        }}
      >
        <label className="lt-field inv-filter-search">
          <span className="sr-only">Search</span>
          <span className="lt-search">
            <Svg size={16}>{INV_ICONS.search}</Svg>
            <input value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} placeholder="Search item, SKU, batch, reference, destination or reason..." />
          </span>
        </label>
        <label className="lt-field">
          Type
          <select value={draft.transaction_type} onChange={(e) => setDraft((d) => ({ ...d, transaction_type: e.target.value }))}>
            <option value="">All types</option>
            {meta?.transaction_types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="lt-field">
          Item
          <ItemSelect value={draft.item || ''} onChange={(item) => setDraft((d) => ({ ...d, item }))} placeholder="All items" />
        </label>
        <label className="lt-field">
          Location
          <select value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}>
            <option value="">All locations</option>
            {meta?.locations.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="lt-field inv-filter-dates">
          Date range
          <span className="lt-dates">
            <input type="date" value={draft.date_from} onChange={(e) => setDraft((d) => ({ ...d, date_from: e.target.value }))} aria-label="From" />
            <span>-</span>
            <input type="date" value={draft.date_to} onChange={(e) => setDraft((d) => ({ ...d, date_to: e.target.value }))} aria-label="To" />
          </span>
        </label>
        <div className="inv-filter-actions">
          <button
            type="button"
            className="lt-btn-clear"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
              setPage(1);
            }}
          >
            Clear
          </button>
          <button type="submit" className="lt-btn-search">
            Search
          </button>
        </div>
      </form>

      <div className="inv-table-tools">
        <span className="inv-muted">
          {data ? `${data.total.toLocaleString('en-IN')} entries · in ${fmtQty(data.qty_in)} · out ${fmtQty(data.qty_out)}` : ''}
        </span>
      </div>

      <div className="lt-table-card">
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th>Posted</th>
                <th>Type</th>
                <th>Item</th>
                <th>Batch</th>
                <th>Location</th>
                <th>Qty</th>
                <th>Batch bal.</th>
                <th>Item on-hand</th>
                <th>Reference</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.length ? (
                data.rows.map((t) => (
                  <tr key={t.name}>
                    <td className="inv-nowrap">{fmtDateTime(t.posting_datetime)}</td>
                    <td>
                      <span className={`inv-txn-type is-${t.transaction_type.toLowerCase().replace(/\s+/g, '-')}`}>{t.transaction_type}</span>
                      {t.reason ? <div className="inv-muted">{t.reason}</div> : null}
                    </td>
                    <td>
                      {t.item_name}
                      <div className="inv-muted">{t.sku}</div>
                    </td>
                    <td>
                      {t.batch_no}
                      {t.expiry_date ? <div className="inv-muted">exp {fmtDate(t.expiry_date)}</div> : null}
                    </td>
                    <td>
                      {t.location}
                      {t.counter_location ? <div className="inv-muted">{t.qty_delta < 0 ? '→' : '←'} {t.counter_location}</div> : null}
                    </td>
                    <td>
                      <TxnQty value={t.qty_delta} unit={t.unit} />
                    </td>
                    <td>{fmtQty(t.balance_after)}</td>
                    <td>{fmtQty(t.item_balance_after)}</td>
                    <td>
                      {t.reference_name || t.reference_no || '—'}
                      {t.destination ? <div className="inv-muted">to {t.destination}</div> : null}
                      {t.reference_name && t.reference_no ? <div className="inv-muted">{t.reference_no}</div> : null}
                      {t.remarks ? <div className="inv-muted">{t.remarks}</div> : null}
                    </td>
                    <td>{t.user_name || t.user || '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="lt-empty">
                    No stock movements match these filters.
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
          noun="entries"
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
}
