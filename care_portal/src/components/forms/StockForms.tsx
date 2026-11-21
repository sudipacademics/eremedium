import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useApi, useCare } from '../../store';
import type { Item } from '../../types';
import { fmtStamp, inr } from '../../format';
import { Empty, Field, Loading, Modal } from '../ui';

export function ItemForm({ item, onClose }: { item?: Item; onClose: () => void }) {
  const { meta, branch, mutate } = useCare();
  const [f, setF] = useState({
    name: item?.name || '',
    sku: item?.sku || '',
    category: item?.category || 'Medicine',
    unit: item?.unit || 'strip',
    stock: '0',
    reorder_level: String(item?.reorder_level ?? 10),
    cost: String(item?.cost ?? ''),
    price: String(item?.price ?? ''),
    expiry: item?.expiry || '',
    vendor: item?.vendor || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await mutate(
      () => api<Item>(item ? `/items/${item.id}` : '/items', { method: item ? 'PATCH' : 'POST', body: { ...f, branch_id: branch || undefined } }),
      item ? 'Item updated' : `${f.name} added to inventory`,
    );
    setBusy(false);
    if (r) onClose();
  };

  const archive = async () => {
    if (!item || !window.confirm(`Remove ${item.name} from the inventory list? Its history is kept.`)) return;
    const r = await mutate(() => api(`/items/${item.id}`, { method: 'PATCH', body: { active: false } }), 'Item removed');
    if (r) onClose();
  };

  return (
    <Modal
      title={item ? `Edit ${item.name}` : 'Add Inventory Item'}
      onClose={onClose}
      footer={
        <>
          {item && (
            <button type="button" className="btn btn-danger-ghost" onClick={archive}>
              Remove item
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="item-form" className="btn btn-primary" disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} className="grid-2">
        <Field label="Item name *" span={2}>
          <input value={f.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Category">
          <select value={f.category} onChange={set('category')}>
            {(meta?.enums.itemCategories || []).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Unit">
          <input value={f.unit} onChange={set('unit')} placeholder="strip, bottle, piece…" />
        </Field>
        {!item && (
          <Field label="Opening stock">
            <input type="number" min={0} step="any" value={f.stock} onChange={set('stock')} />
          </Field>
        )}
        <Field label="Reorder level" hint="Alerts appear at or below this quantity">
          <input type="number" min={0} step="any" value={f.reorder_level} onChange={set('reorder_level')} />
        </Field>
        <Field label="Purchase cost (₹ / unit)">
          <input type="number" min={0} step="any" value={f.cost} onChange={set('cost')} />
        </Field>
        <Field label="Selling price / MRP (₹)" hint="Leave 0 for items that are not sold">
          <input type="number" min={0} step="any" value={f.price} onChange={set('price')} />
        </Field>
        <Field label="Expiry date">
          <input type="date" value={f.expiry} onChange={set('expiry')} />
        </Field>
        <Field label="Vendor">
          <input value={f.vendor} onChange={set('vendor')} />
        </Field>
        <Field label="SKU / code" hint={item ? undefined : 'Generated automatically when left blank'}>
          <input value={f.sku} onChange={set('sku')} />
        </Field>
      </form>
    </Modal>
  );
}

export function StockForm({ item, direction: initial, onClose }: { item: Item; direction: 'in' | 'out'; onClose: () => void }) {
  const { mutate } = useCare();
  const [direction, setDirection] = useState(initial);
  const [qty, setQty] = useState(initial === 'in' ? String(Math.max(item.reorder_level * 2 - item.stock, 1)) : '1');
  const [kind, setKind] = useState(initial === 'in' ? 'Purchase' : 'Consumption');
  const [cost, setCost] = useState(String(item.cost || ''));
  const [expiry, setExpiry] = useState('');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const kinds = direction === 'in' ? ['Purchase', 'Return', 'Adjustment', 'Transfer'] : ['Consumption', 'Damaged / Expired', 'Adjustment', 'Transfer'];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await mutate(
      () => api<Item>(`/items/${item.id}/stock`, { method: 'POST', body: { direction, qty: Number(qty), kind, cost: direction === 'in' ? Number(cost) || undefined : undefined, expiry: expiry || undefined, ref, note } }),
      (it) => `${it.name}: ${it.stock} ${it.unit} in stock`,
    );
    setBusy(false);
    if (r) onClose();
  };

  return (
    <Modal
      title={direction === 'in' ? 'Stock In' : 'Stock Out'}
      subtitle={`${item.name} · ${item.stock} ${item.unit} in stock`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="stock-form" className="btn btn-primary" disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <form id="stock-form" onSubmit={submit} className="stack">
        <div className="seg">
          <button type="button" className={direction === 'in' ? 'on' : ''} onClick={() => { setDirection('in'); setKind('Purchase'); }}>
            Stock in
          </button>
          <button type="button" className={direction === 'out' ? 'on' : ''} onClick={() => { setDirection('out'); setKind('Consumption'); }}>
            Stock out
          </button>
        </div>
        <div className="grid-2">
          <Field label={`Quantity (${item.unit})`}>
            <input type="number" min={0.01} step="any" value={qty} onChange={(e) => setQty(e.target.value)} required autoFocus />
          </Field>
          <Field label="Reason">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          {direction === 'in' && (
            <>
              <Field label="Cost per unit (₹)">
                <input type="number" min={0} step="any" value={cost} onChange={(e) => setCost(e.target.value)} />
              </Field>
              <Field label="Batch expiry">
                <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Reference">
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Bill / PO number" />
          </Field>
          <Field label="Note">
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

type Move = { id: number; qty: number; kind: string; ref: string | null; note: string | null; at: string; by: string };

export function MovesView({ item, onClose }: { item: Item; onClose: () => void }) {
  const { data } = useApi<{ item: Item; moves: Move[] }>(`/items/${item.id}/moves`);
  const current = data?.item || item;
  return (
    <Modal title={current.name} subtitle={`${current.sku} · ${current.stock} ${current.unit} in stock · value ${inr(current.stock * current.cost)}`} onClose={onClose} wide>
      {!data && <Loading />}
      {data && data.moves.length === 0 && <Empty text="No stock movements yet." icon="box" />}
      {data && data.moves.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th className="num">Qty</th>
              <th>Reference</th>
              <th>Note</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {data.moves.map((m) => (
              <tr key={m.id}>
                <td>{fmtStamp(m.at)}</td>
                <td>{m.kind}</td>
                <td className={`num ${m.qty < 0 ? 'neg' : 'pos'}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                <td className="mono">{m.ref || '—'}</td>
                <td>{m.note || '—'}</td>
                <td className="muted">{m.by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
