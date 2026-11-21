import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../../icons';
import { useApi, useCare, withQuery } from '../../store';
import type { Item, StockAlert } from '../../types';
import { downloadCsv, fmtDate, inr, todayIst, addDays } from '../../format';
import { Empty, ErrorNote, PageHeader, Pill, SearchBox, StatCard, Tabs, useDebounced } from '../ui';

const PHARMACY_CATEGORIES = 'Medicine,Orthotic';

function stockState(it: Item) {
  const soon = addDays(todayIst(), 60);
  if (it.stock <= 0) return <Pill tone="red">Out of stock</Pill>;
  if (it.reorder_level > 0 && it.stock <= it.reorder_level) return <Pill tone="red">Low stock</Pill>;
  if (it.expiry && it.expiry < todayIst()) return <Pill tone="red">Expired</Pill>;
  if (it.expiry && it.expiry <= soon) return <Pill tone="orange">Expiring soon</Pill>;
  if (it.reorder_level > 0 && it.stock <= it.reorder_level * 1.5) return <Pill tone="blue">Reorder soon</Pill>;
  return <Pill tone="green">In stock</Pill>;
}

export function InventoryPage({ pharmacy }: { pharmacy?: boolean }) {
  const { branch, can, openModal, meta } = useCare();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [filter, setFilter] = useState(params.get('filter') || '');
  const [category, setCategory] = useState(pharmacy ? PHARMACY_CATEGORIES : '');
  const term = useDebounced(q.trim());

  useEffect(() => {
    const pq = params.get('q');
    const pf = params.get('filter');
    if (pq !== null) setQ(pq);
    if (pf !== null) setFilter(pf);
    if (pq !== null || pf !== null) setParams({}, { replace: true });
  }, [params, setParams]);
  useEffect(() => setCategory(pharmacy ? PHARMACY_CATEGORIES : ''), [pharmacy]);

  const { data, error } = useApi<{ items: Item[]; value: number; alerts: StockAlert[] }>(withQuery('/items', { branch, q: term, filter, category }));
  const editable = can('Inventory Management', 'edit') || (pharmacy && can('Pharmacy', 'edit'));
  const low = data?.alerts.filter((a) => a.level === 'low' || a.level === 'out').length ?? 0;
  const expiring = data?.alerts.filter((a) => a.level === 'expiry' || a.level === 'expired').length ?? 0;

  const exportCsv = () =>
    data &&
    downloadCsv(
      'remedium-care-stock.csv',
      ['SKU', 'Item', 'Category', 'Unit', 'Stock', 'Reorder level', 'Cost', 'Price', 'Stock value', 'Expiry', 'Vendor'],
      data.items.map((i) => [i.sku, i.name, i.category, i.unit, i.stock, i.reorder_level, i.cost, i.price, i.stock * i.cost, i.expiry, i.vendor]),
    );

  return (
    <div className="page">
      <PageHeader
        title={pharmacy ? 'Pharmacy' : 'Inventory Management'}
        subtitle={
          pharmacy ? 'Medicine and orthotic stock. Sales are billed in Billing & Invoice and deducted from this stock.' : 'Consumables, physio supplies, medicines and lab stock'
        }
        icon={pharmacy ? 'pill' : 'box'}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={exportCsv}>
              <Icon name="download" size={16} /> Export
            </button>
            {pharmacy && can('Billing & Invoice') && (
              <Link className="btn btn-soft" to="/billing?type=pharmacy">
                <Icon name="invoice" size={16} /> Pharmacy bills
              </Link>
            )}
            {can('Inventory Management', 'create') && (
              <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'item' })}>
                <Icon name="plus" size={16} /> Add item
              </button>
            )}
          </>
        }
      />
      {!pharmacy && (
        <div className="info-box">
          <Icon name="pill" size={18} />
          <p className="small">
            Medicines are stocked per branch by batch in <Link to="/pharmacy" className="link">Pharmacy</Link> (supplied by the Central Pharmacy Store). Pharmacy bills take medicines from
            there; items here with category “Medicine” are no longer used for billing.
          </p>
        </div>
      )}
      <div className="stats">
        <StatCard label="Items" value={data?.items.length ?? '—'} icon="box" tone="blue" />
        <StatCard label="Stock value (at cost)" value={data ? inr(data.value) : '—'} icon="rupee" tone="green" />
        <StatCard label="Low / out of stock" value={low} icon="alert" tone="red" />
        <StatCard label="Expiring in 60 days" value={expiring} icon="calendar" tone="orange" />
      </div>
      <div className="card">
        <div className="toolbar">
          <Tabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: '', label: 'All items' },
              { value: 'low', label: 'Low stock' },
              { value: 'expiry', label: 'Expiring' },
            ]}
          />
          {!pharmacy && (
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {(meta?.enums.itemCategories || []).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
          <span className="spacer" />
          <SearchBox value={q} onChange={setQ} placeholder="Item, SKU or vendor" />
        </div>
        {error && <ErrorNote text={error} />}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th className="num">In stock</th>
                <th className="num">Reorder at</th>
                <th className="num">Cost</th>
                <th className="num">Price</th>
                <th>Expiry</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <button type="button" className="strong-link" onClick={() => openModal({ kind: 'moves', item: it })}>
                      {it.name}
                    </button>
                    <small className="block muted">
                      {it.sku}
                      {it.vendor ? ` · ${it.vendor}` : ''}
                    </small>
                  </td>
                  <td>{it.category}</td>
                  <td className="num">
                    <b>{it.stock}</b> <span className="muted small">{it.unit}</span>
                  </td>
                  <td className="num">{it.reorder_level}</td>
                  <td className="num">{inr(it.cost, true)}</td>
                  <td className="num">{it.price ? inr(it.price, true) : '—'}</td>
                  <td>{it.expiry ? fmtDate(it.expiry) : '—'}</td>
                  <td>{stockState(it)}</td>
                  <td className="row-actions">
                    {editable && (
                      <>
                        {it.category === 'Medicine' ? (
                          <Link to="/pharmacy" className="btn btn-soft sm" title="Medicines come in through Pharmacy: a requisition, or an approved outside purchase">
                            + In via Pharmacy
                          </Link>
                        ) : (
                          <button type="button" className="btn btn-soft sm" onClick={() => openModal({ kind: 'stock', item: it, direction: 'in' })}>
                            + In
                          </button>
                        )}
                        <button type="button" className="btn btn-ghost sm" onClick={() => openModal({ kind: 'stock', item: it, direction: 'out' })}>
                          − Out
                        </button>
                      </>
                    )}
                    {can('Inventory Management', 'edit') && (
                      <button type="button" className="icon-btn sm" onClick={() => openModal({ kind: 'item', item: it })} aria-label={`Edit ${it.name}`}>
                        <Icon name="edit" size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.items.length === 0 && <Empty text="No items here." icon="box" />}
        </div>
      </div>
    </div>
  );
}
