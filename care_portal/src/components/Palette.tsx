import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Icon, type IconName } from '../icons';
import { useCare } from '../store';
import { fmtDate, fmtTime, inr, TYPE_LABEL } from '../format';
import { Pill, useDebounced } from './ui';

type Results = {
  patients: { id: number; code: string; name: string; mobile: string | null }[];
  invoices: { id: number; number: string; total: number; status: string; patient: string }[];
  appointments: { id: number; code: string; type: string; service: string; date: string; time: string; status: string; patient: string }[];
  items: { id: number; name: string; sku: string; stock: number; unit: string }[];
};

type Row = { key: string; icon: IconName; title: string; meta: string; extra?: string; run: () => void };

export function Palette({ onClose }: { onClose: () => void }) {
  const { openModal, can } = useCare();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [cursor, setCursor] = useState(0);
  const term = useDebounced(q.trim(), 200);

  useEffect(() => {
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let alive = true;
    api<Results>(`/search?q=${encodeURIComponent(term)}`).then((r) => alive && setResults(r)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [term]);

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const rows: Row[] = [];
  if (!results) {
    if (can('Patients', 'create')) rows.push({ key: 'np', icon: 'userPlus', title: 'New patient', meta: 'Register a patient', run: () => openModal({ kind: 'patient' }) });
    if (can('Appointments', 'create')) {
      rows.push({ key: 'bc', icon: 'calendar', title: 'Book consultation', meta: 'Doctor appointment', run: () => openModal({ kind: 'appointment', type: 'consultation' }) });
      rows.push({ key: 'bp', icon: 'physio', title: 'Start physiotherapy plan', meta: 'Schedule a course of sessions', run: () => openModal({ kind: 'plan' }) });
    }
    if (can('Test & Lab', 'create')) rows.push({ key: 'bl', icon: 'flask', title: 'Book lab test', meta: 'Sample collection booking', run: () => openModal({ kind: 'appointment', type: 'lab' }) });
    if (can('Diagnostics', 'create')) rows.push({ key: 'bd', icon: 'scan', title: 'Book diagnostic test', meta: 'X-ray, USG, ECG, NCV…', run: () => openModal({ kind: 'appointment', type: 'diagnostic' }) });
    if (can('Billing & Invoice', 'create')) rows.push({ key: 'gi', icon: 'invoice', title: 'Generate invoice', meta: 'Bill a patient', run: () => openModal({ kind: 'invoice' }) });
    if (can('Pharmacy', 'create')) rows.push({ key: 'ps', icon: 'pill', title: 'Pharmacy sale', meta: 'Sell medicines', run: () => openModal({ kind: 'invoice', type: 'pharmacy' }) });
  } else {
    results.patients.forEach((p) => rows.push({ key: `p${p.id}`, icon: 'user', title: p.name, meta: `${p.code}${p.mobile ? ` · ${p.mobile}` : ''}`, run: () => go(`/patients/${p.id}`) }));
    results.appointments.forEach((a) =>
      rows.push({
        key: `a${a.id}`,
        icon: 'calendar',
        title: `${a.patient} · ${TYPE_LABEL[a.type]}`,
        meta: `${a.code} · ${fmtDate(a.date)} ${fmtTime(a.time)} · ${a.service}`,
        extra: a.status,
        run: () => go(`${a.type === 'lab' ? '/lab' : a.type === 'diagnostic' ? '/diagnostics' : '/appointments'}?q=${encodeURIComponent(a.code)}`),
      }),
    );
    results.invoices.forEach((i) => rows.push({ key: `i${i.id}`, icon: 'invoice', title: i.number, meta: `${i.patient} · ${inr(i.total)}`, extra: i.status, run: () => openModal({ kind: 'viewInvoice', id: i.id }) }));
    results.items.forEach((it) => rows.push({ key: `t${it.id}`, icon: 'box', title: it.name, meta: `${it.sku} · ${it.stock} ${it.unit} in stock`, run: () => go(`/inventory?q=${encodeURIComponent(it.name)}`) }));
  }

  const pick = (row: Row | undefined) => {
    if (!row) return;
    row.run();
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Search">
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            value={q}
            placeholder="Search patient, invoice, booking, test, medicine…"
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, rows.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              }
              if (e.key === 'Enter') pick(rows[cursor]);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list">
          {!results && <p className="palette-hint">Quick actions</p>}
          {results && rows.length === 0 && <p className="palette-hint">No matches for “{term}”.</p>}
          {rows.map((row, i) => (
            <button key={row.key} type="button" className={`palette-row ${i === cursor ? 'active' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => pick(row)}>
              <Icon name={row.icon} size={18} />
              <span>
                <strong>{row.title}</strong>
                <small>{row.meta}</small>
              </span>
              {row.extra && <Pill status={row.extra} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
