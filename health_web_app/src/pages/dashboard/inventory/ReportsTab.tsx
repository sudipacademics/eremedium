import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import type { InvExportKind, InvReports, InvStockUnit, InvUnitStockList } from '../../../types/labInventory';
import { ReqPill, StockPill, downloadExport, fmtDate, fmtQty, monthStartIso, todayIso, useInv } from './shared';

/** Read-only view of one franchise unit's own consumables stock (Lab Manager). */
function UnitStockPanel() {
  const { fail } = useInv();
  const [units, setUnits] = useState<InvStockUnit[]>([]);
  const [unit, setUnit] = useState('');
  const [data, setData] = useState<InvUnitStockList | null>(null);

  useEffect(() => {
    api
      .listInventoryStockUnits()
      .then((res) => setUnits(res.data.units))
      .catch(fail);
  }, [fail]);

  useEffect(() => {
    if (!unit) {
      setData(null);
      return;
    }
    api
      .getInventoryUnitStock(unit, {}, 1, 200)
      .then((res) => setData(res.data))
      .catch(fail);
  }, [unit, fail]);

  return (
    <section className="inv-panel inv-span-report">
      <h4 className="inv-section-title">Franchise unit stock (read-only)</h4>
      <div className="inv-form-actions" style={{ justifyContent: 'flex-start' }}>
        <select className="inv-input" style={{ maxWidth: 420 }} value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="">{units.length ? 'Select a franchise unit…' : 'No franchise unit holds stock yet'}</option>
          {units.map((u) => (
            <option key={u.franchisee} value={u.franchisee}>
              {u.label} · {u.items} items · {fmtQty(u.qty)} units
            </option>
          ))}
        </select>
        {data ? (
          <span className="inv-muted">
            {data.kpis.total_items} items · {fmtQty(data.kpis.available_stock)} units · {data.kpis.low_stock_items} low · {data.kpis.expiring_soon} batches expiring
          </span>
        ) : null}
      </div>
      {data ? (
        <table className="lt-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Next batch</th>
              <th>Expiry</th>
              <th>Available</th>
              <th>Min</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? (
              data.rows.map((r) => (
                <tr key={r.name}>
                  <td>
                    {r.item_name}
                    <div className="inv-muted">{r.sku}</div>
                  </td>
                  <td>{r.next_batch_no || '—'}</td>
                  <td>{fmtDate(r.next_expiry)}</td>
                  <td>
                    {fmtQty(r.available_qty)} {r.unit}
                  </td>
                  <td>
                    {fmtQty(r.min_stock)}
                    {r.own_min !== null ? <span className="inv-muted"> (unit)</span> : null}
                  </td>
                  <td>
                    <StockPill status={r.status} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="lt-empty">
                  No stock recorded at this unit.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

const EXPORTS: Array<{ kind: InvExportKind; label: string }> = [
  { kind: 'items', label: 'Material list' },
  { kind: 'history', label: 'Stock history' },
  { kind: 'requisitions', label: 'Requisitions' },
  { kind: 'dispatches', label: 'Dispatches (line-wise)' },
];

export function ReportsTab() {
  const { version, fail, canManage } = useInv();
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState<InvReports | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData((await api.getInventoryReports(from, to)).data);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [from, to, fail]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  async function exportKind(kind: InvExportKind, fmt: 'xlsx' | 'csv') {
    const dated = kind === 'items' ? {} : { date_from: from, date_to: to };
    try {
      downloadExport((await api.exportLabInventory(kind, fmt, dated)).data);
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div className="inv-stack">
      <div className="inv-section-head">
        <div>
          <h3>Reports</h3>
          <p className="inv-muted">Movement, dispatch and expiry summaries for the selected period. Exports use the same period (material list is as of now).</p>
        </div>
        <form
          className="inv-report-range"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <span className="lt-dates">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <span>-</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </span>
          <button type="submit" className="lt-btn-search" disabled={busy}>
            {busy ? 'Loading…' : 'Run'}
          </button>
        </form>
      </div>

      <div className="inv-export-row">
        {EXPORTS.map((x) => (
          <span key={x.kind} className="inv-export-chip">
            {x.label}
            <button type="button" onClick={() => void exportKind(x.kind, 'xlsx')}>
              Excel
            </button>
            <button type="button" onClick={() => void exportKind(x.kind, 'csv')}>
              CSV
            </button>
          </span>
        ))}
      </div>

      {data ? (
        <div className="inv-report-grid">
          <section className="inv-panel">
            <h4 className="inv-section-title">Stock movement ({fmtDate(data.date_from)} – {fmtDate(data.date_to)})</h4>
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Entries</th>
                  <th>Qty in</th>
                  <th>Qty out</th>
                </tr>
              </thead>
              <tbody>
                {data.movement.length ? (
                  data.movement.map((m) => (
                    <tr key={m.transaction_type}>
                      <td>{m.transaction_type}</td>
                      <td>{m.entries}</td>
                      <td className="inv-pos">{fmtQty(m.qty_in)}</td>
                      <td className="inv-neg">{fmtQty(m.qty_out)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="lt-empty">
                      No movements in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="inv-panel">
            <h4 className="inv-section-title">Requisitions raised</h4>
            {Object.keys(data.requisitions).length ? (
              <div className="inv-pill-list">
                {Object.entries(data.requisitions).map(([s, c]) => (
                  <span key={s}>
                    <ReqPill status={s} /> <b>{c}</b>
                  </span>
                ))}
              </div>
            ) : (
              <p className="lt-empty">No requisitions in this period.</p>
            )}
            <h4 className="inv-section-title">Dispatched by destination</h4>
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Dispatches</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {data.by_destination.length ? (
                  data.by_destination.map((d) => (
                    <tr key={`${d.destination_type}-${d.destination_name}`}>
                      <td>
                        {d.destination_name}
                        <div className="inv-muted">{d.destination_type}</div>
                      </td>
                      <td>{d.dispatches}</td>
                      <td>{fmtQty(d.qty)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="lt-empty">
                      No dispatches in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="inv-panel">
            <h4 className="inv-section-title">Top dispatched items</h4>
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Dispatches</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {data.top_items.length ? (
                  data.top_items.map((t) => (
                    <tr key={t.item}>
                      <td>{t.item_name}</td>
                      <td>{t.dispatches}</td>
                      <td>
                        {fmtQty(t.qty)} {t.unit}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="lt-empty">
                      Nothing dispatched in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="inv-panel">
            <h4 className="inv-section-title">Low / out of stock (now)</h4>
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Available</th>
                  <th>Min</th>
                  <th>Shortfall</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.low_stock.length ? (
                  data.low_stock.slice(0, 25).map((r) => (
                    <tr key={r.item}>
                      <td>
                        {r.item_name}
                        <div className="inv-muted">{r.sku}</div>
                      </td>
                      <td>{fmtQty(r.available_qty)}</td>
                      <td>{fmtQty(r.min_stock)}</td>
                      <td className="inv-neg">{fmtQty(r.shortfall)}</td>
                      <td>
                        <StockPill status={r.status} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="lt-empty">
                      All items are above their minimum level.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="inv-panel inv-span-report">
            <h4 className="inv-section-title">Expired and expiring within 90 days (now)</h4>
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Batch</th>
                  <th>Location</th>
                  <th>Expiry</th>
                  <th>Days left</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {data.expiry.length ? (
                  data.expiry.map((r) => (
                    <tr key={r.batch} className={r.expired ? 'inv-row-alert' : ''}>
                      <td>{r.item_name}</td>
                      <td>{r.batch_no}</td>
                      <td>{r.location}</td>
                      <td>{fmtDate(r.expiry_date)}</td>
                      <td className={r.expired ? 'inv-neg' : ''}>{r.expired ? `Expired ${Math.abs(r.days_left)}d ago` : r.days_left}</td>
                      <td>
                        {fmtQty(r.qty)} {r.unit}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="lt-empty">
                      No batches expiring within 90 days.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
          {canManage ? <UnitStockPanel /> : null}
        </div>
      ) : null}
    </div>
  );
}
