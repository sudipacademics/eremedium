import { FormEvent, useState } from 'react';
import { api } from '../../../api';
import type { InvItem } from '../../../types/labInventory';
import { Modal, errMsg, todayIso, useInv } from './shared';

export function ItemFormModal({ item, onClose, onSaved }: { item?: InvItem | null; onClose: () => void; onSaved: (name: string) => void }) {
  const { meta } = useInv();
  const editing = Boolean(item);
  const [form, setForm] = useState({
    item_name: item?.item_name ?? '',
    sku: item?.sku ?? '',
    category: item?.category ?? '',
    unit: item?.unit ?? 'Pcs',
    min_stock: String(item?.min_stock ?? 0),
    unit_min_stock: String(item?.unit_min_stock ?? 0),
    supplier: item?.supplier ?? '',
    default_location: item?.default_location || meta?.locations[0] || 'Main Store',
    description: item?.description ?? '',
    active: item ? Boolean(item.active) : true,
  });
  const [opening, setOpening] = useState({ qty: '', batch_no: '', expiry_date: '', unit_cost: '', reference_no: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveInventoryItem({
        ...(item ? { name: item.name } : {}),
        ...form,
        min_stock: Number(form.min_stock) || 0,
        unit_min_stock: Number(form.unit_min_stock) || 0,
        active: form.active ? 1 : 0,
        ...(!editing && Number(opening.qty) > 0
          ? {
              opening: {
                qty: Number(opening.qty),
                batch_no: opening.batch_no,
                expiry_date: opening.expiry_date || undefined,
                unit_cost: Number(opening.unit_cost) || undefined,
                reference_no: opening.reference_no,
                location: form.default_location,
              },
            }
          : {}),
      });
      onSaved(res.data.item.item_name);
    } catch (err) {
      setError(errMsg(err, 'Could not save the item'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? `Edit ${item?.item_name}` : 'Add New Item'}
      sub={editing ? `SKU ${item?.sku}` : 'Create an inventory item. Optionally receive its opening stock now.'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="lt-btn-clear" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="inv-item-form" className="lt-btn-search" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create item'}
          </button>
        </>
      }
    >
      <form id="inv-item-form" className="inv-form-grid" onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className="inv-alert is-error inv-span-all">{error}</div> : null}
        <label className="lt-field inv-span-2">
          Item name <em>*</em>
          <input className="inv-input" required value={form.item_name} onChange={(e) => set('item_name', e.target.value)} placeholder="e.g. Vacutainer Tube (EDTA)" />
        </label>
        <label className="lt-field">
          SKU / Item code <em>*</em>
          <input className="inv-input" required value={form.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} placeholder="VT-EDTA" />
        </label>
        <label className="lt-field">
          Category
          <input className="inv-input" list="inv-categories" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="Lab Consumables" />
        </label>
        <label className="lt-field">
          Unit
          <input className="inv-input" list="inv-units" value={form.unit} onChange={(e) => set('unit', e.target.value)} />
        </label>
        <label className="lt-field">
          Minimum stock level
          <input className="inv-input" type="number" min="0" step="any" value={form.min_stock} onChange={(e) => set('min_stock', e.target.value)} />
        </label>
        <label className="lt-field" title="Low-stock level for franchise / unit stock unless the unit sets its own">
          Default minimum at units
          <input className="inv-input" type="number" min="0" step="any" value={form.unit_min_stock} onChange={(e) => set('unit_min_stock', e.target.value)} />
        </label>
        <label className="lt-field">
          Supplier
          <input className="inv-input" list="inv-suppliers" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} />
        </label>
        <label className="lt-field">
          Default storage location
          <input className="inv-input" list="inv-locations" value={form.default_location} onChange={(e) => set('default_location', e.target.value)} />
        </label>
        <label className="lt-field inv-span-3">
          Description
          <input className="inv-input" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </label>
        <label className="inv-check">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active (shown in catalogue and requests)
        </label>

        {!editing ? (
          <fieldset className="inv-fieldset inv-span-all">
            <legend>Opening stock (optional)</legend>
            <div className="inv-form-grid">
              <label className="lt-field">
                Quantity
                <input className="inv-input" type="number" min="0" step="any" value={opening.qty} onChange={(e) => setOpening((o) => ({ ...o, qty: e.target.value }))} />
              </label>
              <label className="lt-field">
                Batch no.
                <input className="inv-input" value={opening.batch_no} onChange={(e) => setOpening((o) => ({ ...o, batch_no: e.target.value }))} placeholder="Auto if blank" />
              </label>
              <label className="lt-field">
                Expiry date
                <input className="inv-input" type="date" min={todayIso()} value={opening.expiry_date} onChange={(e) => setOpening((o) => ({ ...o, expiry_date: e.target.value }))} />
              </label>
              <label className="lt-field">
                Unit cost
                <input className="inv-input" type="number" min="0" step="any" value={opening.unit_cost} onChange={(e) => setOpening((o) => ({ ...o, unit_cost: e.target.value }))} />
              </label>
              <label className="lt-field">
                GRN / invoice no.
                <input className="inv-input" value={opening.reference_no} onChange={(e) => setOpening((o) => ({ ...o, reference_no: e.target.value }))} />
              </label>
            </div>
          </fieldset>
        ) : null}
      </form>
      <MetaLists />
    </Modal>
  );
}

export function MetaLists() {
  const { meta } = useInv();
  return (
    <>
      <datalist id="inv-categories">{meta?.categories.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="inv-units">{meta?.units.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="inv-suppliers">{meta?.suppliers.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="inv-locations">{meta?.locations.map((c) => <option key={c} value={c} />)}</datalist>
    </>
  );
}
