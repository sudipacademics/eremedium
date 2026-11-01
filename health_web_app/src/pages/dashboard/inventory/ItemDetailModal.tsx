import { useEffect, useState } from 'react';
import { api } from '../../../api';
import type { InvItemDetail } from '../../../types/labInventory';
import { BatchActionForm, type BatchMode } from './BatchActionForm';
import { ItemFormModal } from './ItemFormModal';
import { Modal, StockPill, TxnQty, errMsg, fmtDate, fmtDateTime, fmtQty, useInv } from './shared';

export function ItemDetailModal({ item, onClose, onStockIn }: { item: string; onClose: () => void; onStockIn?: (item: string) => void }) {
  const { canManage, version, refreshAll, notify } = useInv();
  const [data, setData] = useState<InvItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<{ mode: BatchMode; batch: string } | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getInventoryItem(item)
      .then((res) => !cancelled && setData(res.data))
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [item, version]);

  const it = data?.item;
  return (
    <>
      <Modal
        title={it ? it.item_name : 'Item'}
        sub={it ? `${it.sku} · ${it.category || 'Uncategorised'} · ${it.unit}` : null}
        onClose={onClose}
        wide
        footer={
          canManage && it ? (
            <>
              <button type="button" className="lt-btn-clear" onClick={() => setEditing(true)}>
                Edit item
              </button>
              {onStockIn ? (
                <button type="button" className="lt-btn-search" onClick={() => onStockIn(it.name)}>
                  Stock in
                </button>
              ) : null}
            </>
          ) : null
        }
      >
        {error ? <div className="inv-alert is-error">{error}</div> : null}
        {!data && !error ? <p className="lt-empty">Loading…</p> : null}
        {it ? (
          <>
            <div className="inv-detail-stats">
              <div>
                <small>Available</small>
                <strong>
                  {fmtQty(it.available_qty)} <span>{it.unit}</span>
                </strong>
              </div>
              <div>
                <small>Minimum level</small>
                <strong>{fmtQty(it.min_stock)}</strong>
              </div>
              <div>
                <small>Expiring ≤ 90 days</small>
                <strong>{fmtQty(it.expiring_qty)}</strong>
              </div>
              <div>
                <small>Expired (not dispatchable)</small>
                <strong>{fmtQty(it.expired_qty)}</strong>
              </div>
              <div>
                <small>Approved, awaiting dispatch</small>
                <strong>{fmtQty(data?.pending_dispatch_qty)}</strong>
              </div>
              <div>
                <small>Status</small>
                <StockPill status={it.status} />
              </div>
            </div>
            <p className="inv-muted">
              Supplier: {it.supplier || '—'} · Default location: {it.default_location || '—'}
              {it.active ? '' : ' · Inactive'}
              {it.description ? ` · ${it.description}` : ''}
            </p>

            <h4 className="inv-section-title">Batches (FEFO order)</h4>
            <div className="lt-table-wrap">
              <table className="lt-table">
                <thead>
                  <tr>
                    <th>Batch no.</th>
                    <th>Expiry</th>
                    <th>Location</th>
                    <th>Qty</th>
                    <th>Supplier</th>
                    <th>Received</th>
                    {canManage ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {data?.batches.length ? (
                    data.batches.map((b) => (
                      <tr key={b.name} className={b.qty <= 0 ? 'inv-row-muted' : ''}>
                        <td>{b.batch_no}</td>
                        <td>
                          {fmtDate(b.expiry_date)}
                          {b.expired ? <span className="inv-pill tone-muted-red">Expired</span> : b.expiring ? <span className="inv-pill tone-orange">Soon</span> : null}
                        </td>
                        <td>{b.location}</td>
                        <td>{fmtQty(b.qty)}</td>
                        <td>{b.supplier || '—'}</td>
                        <td>{fmtDate(b.received_on)}</td>
                        {canManage ? (
                          <td className="inv-nowrap">
                            {b.qty > 0 ? (
                              <>
                                <button type="button" className="inv-link" onClick={() => setAction({ mode: 'adjust', batch: b.name })}>
                                  Adjust
                                </button>
                                <button type="button" className="inv-link" onClick={() => setAction({ mode: 'transfer', batch: b.name })}>
                                  Transfer
                                </button>
                              </>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={canManage ? 7 : 6} className="lt-empty">
                        No batches yet. Use Stock In to receive this item.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {action ? (
              <div className="inv-inline-panel">
                <div className="inv-inline-head">
                  <b>{action.mode === 'adjust' ? 'Stock adjustment' : 'Transfer to another location'}</b>
                  <button type="button" className="inv-link" onClick={() => setAction(null)}>
                    Close
                  </button>
                </div>
                <BatchActionForm key={`${action.mode}-${action.batch}`} mode={action.mode} item={it.name} batch={action.batch} compact onDone={() => setAction(null)} />
              </div>
            ) : null}

            <h4 className="inv-section-title">Recent movements</h4>
            <div className="lt-table-wrap">
              <table className="lt-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Batch</th>
                    <th>Qty</th>
                    <th>Batch bal.</th>
                    <th>Reference / destination</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.history.length ? (
                    data.history.map((t) => (
                      <tr key={t.name}>
                        <td className="inv-nowrap">{fmtDateTime(t.posting_datetime)}</td>
                        <td>
                          {t.transaction_type}
                          {t.reason ? <div className="inv-muted">{t.reason}</div> : null}
                        </td>
                        <td>
                          {t.batch_no}
                          <div className="inv-muted">{t.location}</div>
                        </td>
                        <td>
                          <TxnQty value={t.qty_delta} />
                        </td>
                        <td>{fmtQty(t.balance_after)}</td>
                        <td>{[t.reference_name, t.reference_no, t.destination].filter(Boolean).join(' · ') || '—'}</td>
                        <td>{t.user_name || t.user || '—'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="lt-empty">
                        No movements yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </Modal>
      {editing && it ? (
        <ItemFormModal
          item={it}
          onClose={() => setEditing(false)}
          onSaved={(name) => {
            setEditing(false);
            notify(`Item ${name} saved`);
            refreshAll();
          }}
        />
      ) : null}
    </>
  );
}
