import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api';

export type ReferringDoctorValue = {
  id: string | null;
  name: string;
  commissionPercent?: number;
};

type DoctorHit = {
  name: string;
  doctor_name?: string;
  label?: string;
  mobile?: string;
  whatsapp?: string;
  commission_percent?: number;
};

type Props = {
  value: ReferringDoctorValue;
  onChange: (next: ReferringDoctorValue) => void;
  variant?: 'partners' | 'desk';
  searchModule?: 'hub' | 'mother';
  commissionPercent?: string;
  onCommissionChange?: (pct: string) => void;
  showCommission?: boolean;
  placeholder?: string;
  required?: boolean;
  showAddButton?: boolean;
  allowSelf?: boolean;
};

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function ReferringDoctorPicker({
  value,
  onChange,
  variant = 'desk',
  searchModule = 'hub',
  commissionPercent = '',
  onCommissionChange,
  showCommission = true,
  placeholder = 'Self or search doctor',
  required = false,
  showAddButton = true,
  allowSelf = true,
}: Props) {
  const fallbackName = allowSelf ? 'Self' : '';
  const [query, setQuery] = useState(value.name || fallbackName);
  const [hits, setHits] = useState<DoctorHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addMobile, setAddMobile] = useState('');
  const [addWhatsapp, setAddWhatsapp] = useState('');
  const [addCommission, setAddCommission] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const skipQuerySync = useRef(false);
  const debouncedQ = useDebounced(query.trim(), 280);

  useEffect(() => {
    if (skipQuerySync.current) {
      skipQuerySync.current = false;
      return;
    }
    const next = value.name && value.name !== 'Self' ? value.name : fallbackName;
    setQuery(next);
  }, [value.id, value.name, fallbackName]);

  useEffect(() => {
    if (!open) return;
    const q = debouncedQ;
    if (q.length < 1) {
      setHits(allowSelf ? [{ name: 'Self', doctor_name: 'Self', label: 'Self', commission_percent: 0 }] : []);
      return;
    }
    let cancelled = false;
    const search =
      searchModule === 'mother'
        ? api.searchMotherLabDoctors(q, 20)
        : api.searchReferringDoctors(q, 20);
    void search.then((res) => {
      if (cancelled) return;
      setHits(res.data.doctors || []);
    }).catch(() => {
      if (!cancelled) setHits([]);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, open, searchModule, allowSelf]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function selectDoctor(d: DoctorHit) {
    const label = (d.doctor_name || d.label || d.name || '').trim();
    const id = d.name === 'Self' ? null : (d.name || label || null);
    skipQuerySync.current = true;
    setQuery(d.name === 'Self' ? fallbackName || 'Self' : label);
    setHits([]);
    setOpen(false);
    setShowAdd(false);
    if (!id || d.name === 'Self') {
      onChange({ id: null, name: allowSelf ? 'Self' : '', commissionPercent: 0 });
      onCommissionChange?.('');
      return;
    }
    const pct = d.commission_percent != null && d.commission_percent > 0 ? d.commission_percent : undefined;
    onChange({ id, name: label, commissionPercent: pct });
    onCommissionChange?.(pct != null ? String(pct) : '');
  }

  function doctorFromUpsert(payload: unknown): DoctorHit | null {
    const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const inner =
      root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
    const name = String(inner.name || '').trim();
    const doctorName = String(inner.doctor_name || inner.label || '').trim();
    if (!name && !doctorName) return null;
    return {
      name: name || doctorName,
      doctor_name: doctorName || name,
      label: doctorName || name,
      commission_percent: Number(inner.commission_percent || 0) || undefined,
      mobile: String(inner.mobile || ''),
      whatsapp: String(inner.whatsapp || ''),
    };
  }

  async function onAddDoctor(e?: FormEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    const doctor_name = addName.trim();
    if (!doctor_name) {
      setError('Doctor name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.upsertReferringDoctor({
        doctor_name,
        mobile: addMobile.trim() || undefined,
        whatsapp: addWhatsapp.trim() || undefined,
        commission_percent: addCommission.trim() ? Number(addCommission) : undefined,
      });
      const doc = doctorFromUpsert(res.data) || doctorFromUpsert(res);
      if (!doc) {
        setError('Doctor was saved but could not be selected. Search for the name to continue.');
        return;
      }
      selectDoctor(doc);
      setAddName('');
      setAddMobile('');
      setAddWhatsapp('');
      setAddCommission('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save doctor');
    } finally {
      setBusy(false);
    }
  }

  const isPartners = variant === 'partners';
  const inputClass = isPartners ? '' : 'input';
  const suggestClass = isPartners ? 'partners-doctor-suggest' : 'mlb-suggest';

  const inputEl = (
    <input
      className={inputClass}
      value={query}
      required={required && value.name !== 'Self'}
      placeholder={placeholder}
      onFocus={() => {
        setOpen(true);
        if (!query.trim()) setQuery('');
      }}
      onChange={(e) => {
        setQuery(e.target.value);
        setOpen(true);
        onChange({ id: null, name: e.target.value, commissionPercent: undefined });
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (hits[0]) selectDoctor(hits[0]);
      }}
    />
  );

  return (
    <div className={`ref-doctor-picker${isPartners ? ' ref-doctor-picker-partners' : ''}`} ref={wrapRef}>
      {isPartners ? (
        <span className="partners-input-wrap">
          <input
            value={query}
            required={required && value.name !== 'Self'}
            placeholder={placeholder}
            onFocus={() => {
              setOpen(true);
              if (!query.trim()) setQuery('');
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              onChange({ id: null, name: e.target.value, commissionPercent: undefined });
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (hits[0]) selectDoctor(hits[0]);
            }}
          />
        </span>
      ) : (
        inputEl
      )}

      {open && hits.length > 0 && query.trim() && query.toLowerCase() !== 'self' ? (
        <ul className={suggestClass}>
          {hits.map((d) => (
            <li key={d.name}>
              <button type="button" onClick={() => selectDoctor(d)}>
                <strong>{d.label || d.doctor_name || d.name}</strong>
                {d.mobile ? <span className="muted"> · {d.mobile}</span> : null}
                {d.commission_percent ? (
                  <span className="muted"> · {d.commission_percent}% comm.</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {allowSelf && open && query.trim().toLowerCase() === 'self' ? (
        <ul className={suggestClass}>
          <li>
            <button type="button" onClick={() => selectDoctor({ name: 'Self', doctor_name: 'Self', label: 'Self' })}>
              Self (walk-in)
            </button>
          </li>
        </ul>
      ) : null}

      {showAddButton ? (
      <div className="ref-doctor-picker-actions">
        <button
          type="button"
          className={isPartners ? 'partners-btn partners-btn-outline partners-btn-sm' : 'btn secondary btn-sm'}
          onClick={() => setShowAdd((v) => !v)}
        >
          {showAdd ? 'Cancel add' : '+ Add new doctor'}
        </button>
      </div>
      ) : null}

      {value.id && value.name && value.name !== 'Self' ? (
        <p className={isPartners ? 'partners-page-lead' : 'muted'} style={{ margin: '6px 0 0' }}>
          Selected: {value.name}
        </p>
      ) : null}

      {showAddButton && showAdd ? (
        <div
          className="ref-doctor-add-panel"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            e.stopPropagation();
            void onAddDoctor();
          }}
        >
          <label>
            <span>Doctor name *</span>
            <input
              className={isPartners ? '' : 'input'}
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Full name"
            />
          </label>
          <label>
            <span>Mobile</span>
            <input
              className={isPartners ? '' : 'input'}
              value={addMobile}
              onChange={(e) => setAddMobile(e.target.value)}
            />
          </label>
          <label>
            <span>WhatsApp</span>
            <input
              className={isPartners ? '' : 'input'}
              value={addWhatsapp}
              onChange={(e) => setAddWhatsapp(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label>
            <span>Default commission %</span>
            <input
              className={isPartners ? '' : 'input'}
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={addCommission}
              onChange={(e) => setAddCommission(e.target.value)}
              placeholder="Optional"
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button
            type="button"
            className={isPartners ? 'partners-btn partners-btn-primary partners-btn-sm' : 'btn btn-sm'}
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void onAddDoctor();
            }}
          >
            {busy ? 'Saving…' : 'Save & select'}
          </button>
        </div>
      ) : null}

      {showCommission && value.id && value.id !== 'Self' && onCommissionChange ? (
        <label className={isPartners ? 'partners-field' : 'field'} style={{ marginTop: 8 }}>
          <span>Ref. doctor commission %</span>
          {isPartners ? (
            <span className="partners-input-wrap">
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={commissionPercent}
                onChange={(e) => onCommissionChange(e.target.value)}
                placeholder="Optional override"
              />
            </span>
          ) : (
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={commissionPercent}
              onChange={(e) => onCommissionChange(e.target.value)}
              placeholder="Optional override"
            />
          )}
        </label>
      ) : null}
    </div>
  );
}
