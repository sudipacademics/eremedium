import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import type { InvDispatch, InvDispatchFilters, InvPage } from '../../../types/labInventory';
import { BatchActionForm } from './BatchActionForm';
import { DispatchForm, DispatchModal } from './DispatchForm';
import { DispatchPill, INV_ICONS, Modal, Pager, Svg, downloadExport, fmtDate, fmtQty, useInv } from './shared';

const EMPTY: InvDispatchFilters = { q: '', status: '', destination_type: '', date_from: '', date_to: '' };

export function DispatchTab() {
  const { canManage, version, fail } = useInv();
  const [draft, setDraft] = useState<InvDispatchFilters>(EMPTY);
  const [filters, setFilters] = useState<InvDispatchFilters>(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<InvPage<InvDispatch> | null>(null);
  const [open, setOpen] = useState<InvDispatch | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.listMaterialDispatches(filters, page, pageSize);
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
      downloadExport((await api.exportLabInventory('dispatches', fmt, { ...filters })).data);
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div className="inv-stack">
      <div className="inv-section-head">
        <div>
          <h3>Dispatch to units</h3>
          <p className="inv-muted">
            Dispatches deduct stock batch-wise (earliest expiry first, never expired) and record courier and tracking details. Dispatch against a requisition from the
            Material Requisition tab, or send material directly here.
          </p>
        </div>
        {canManage ? (
          <button type="button" className="lt-action" onClick={() => setCreating(true)}>
            + Direct dispatch
          </button>
        ) : null}
      </div>

      <form
        className="inv-filters is-compact"
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
            <input value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} placeholder="Search dispatch no., unit, tracking no., courier or requisition..." />
          </span>
        </label>
        <label className="lt-field">
          Status
          <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
            <option value="">All</option>
            <option value="Dispatched">In transit</option>
            <option value="Received">Received</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </label>
        <label className="lt-field">
          Destination
          <select value={draft.destination_type} onChange={(e) => setDraft((d) => ({ ...d, destination_type: e.target.value }))}>
            <option value="">All units</option>
            <option value="Franchise">Franchise units</option>
            <option value="Company Unit">Company units</option>
          </select>
        </label>
        <label className="lt-field inv-filter-dates">
          Dispatch date
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
          <button type="button" className="lt-action is-ghost" onClick={() => void exportList('xlsx')}>
            Excel
          </button>
        </div>
      </form>

      <div className="lt-table-card">
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th>Dispatch</th>
                <th>Date</th>
                <th>Destination</th>
                <th>Requisition</th>
                <th>Items</th>
                <th>Qty</th>
                <th>Courier / tracking</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.rows.length ? (
                data.rows.map((d) => (
                  <tr key={d.name}>
                    <td className="inv-nowrap">
                      <b>{d.name}</b>
                    </td>
                    <td className="inv-nowrap">{fmtDate(d.dispatch_date)}</td>
                    <td>
                      {d.destination_name}
                      <div className="inv-muted">{d.destination_type}</div>
                    </td>
                    <td>{d.requisition || <span className="inv-muted">Direct</span>}</td>
                    <td>{new Set(d.items.map((i) => i.item)).size}</td>
                    <td>{fmtQty(d.total_qty)}</td>
                    <td>
                      {d.courier || d.logistics_mode || '—'}
                      {d.tracking_no ? <div className="inv-muted">{d.tracking_no}</div> : null}
                    </td>
                    <td>
                      <DispatchPill status={d.status} />
                    </td>
                    <td>
                      <button type="button" className="inv-view-btn" onClick={() => setOpen(d)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="lt-empty">
                    No dispatches in this view.
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
          noun="dispatches"
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      <div className="inv-section-head">
        <div>
          <h3>Internal transfer</h3>
          <p className="inv-muted">Move a batch between storage locations (e.g. Main Store → Reagent Store). Both sides are written to the stock history.</p>
        </div>
      </div>
      {canManage ? (
        <div className="inv-panel">
          <BatchActionForm mode="transfer" />
        </div>
      ) : (
        <p className="lt-empty">Only the Lab Manager can transfer stock.</p>
      )}

      {open ? <DispatchModal dispatch={open} onClose={() => setOpen(null)} /> : null}
      {creating ? (
        <Modal title="Direct dispatch" sub="Send material to a franchise or company unit without a requisition." onClose={() => setCreating(false)} wide>
          <DispatchForm
            onCancel={() => setCreating(false)}
            onDone={(d) => {
              setCreating(false);
              setOpen(d);
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}
