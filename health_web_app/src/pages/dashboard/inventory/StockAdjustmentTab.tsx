import { useEffect, useState } from 'react';
import { api } from '../../../api';
import type { InvTransaction } from '../../../types/labInventory';
import { BatchActionForm } from './BatchActionForm';
import { TxnQty, fmtDateTime, useInv } from './shared';

export function StockAdjustmentTab() {
  const { canManage, version, fail } = useInv();
  const [recent, setRecent] = useState<InvTransaction[]>([]);

  useEffect(() => {
    api
      .listInventoryTransactions({ transaction_type: 'Adjustment' }, 1, 10)
      .then((res) => setRecent(res.data.rows))
      .catch(fail);
  }, [version, fail]);

  return (
    <div className="inv-stack">
      <div className="inv-section-head">
        <div>
          <h3>Stock Adjustment</h3>
          <p className="inv-muted">
            Correct a batch after a physical count, damage, loss or write-off. Every adjustment needs a reason and is kept in the stock history; stock can never go
            below zero.
          </p>
        </div>
      </div>
      {canManage ? (
        <div className="inv-panel">
          <BatchActionForm mode="adjust" />
        </div>
      ) : (
        <p className="lt-empty">Only the Lab Manager can post stock adjustments.</p>
      )}

      <h4 className="inv-section-title">Recent adjustments</h4>
      <div className="lt-table-card">
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Item</th>
                <th>Batch / location</th>
                <th>Qty</th>
                <th>Balance after</th>
                <th>Reason</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {recent.length ? (
                recent.map((t) => (
                  <tr key={t.name}>
                    <td className="inv-nowrap">{fmtDateTime(t.posting_datetime)}</td>
                    <td>
                      {t.item_name}
                      <div className="inv-muted">{t.sku}</div>
                    </td>
                    <td>
                      {t.batch_no}
                      <div className="inv-muted">{t.location}</div>
                    </td>
                    <td>
                      <TxnQty value={t.qty_delta} unit={t.unit} />
                    </td>
                    <td>{t.balance_after}</td>
                    <td>
                      {t.reason || '—'}
                      {t.remarks ? <div className="inv-muted">{t.remarks}</div> : null}
                    </td>
                    <td>{t.user_name || t.user}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="lt-empty">
                    No adjustments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
