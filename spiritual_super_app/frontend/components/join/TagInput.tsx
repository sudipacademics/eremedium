'use client';

import { useId, useState, type KeyboardEvent } from 'react';

interface TagInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  suggestions?: readonly string[];
  placeholder?: string;
  max: number;
  hint?: string;
}

/** Free-text tags: Enter or comma adds one; suggestions add with a click. */
export function TagInput({ label, values, onChange, suggestions = [], placeholder, max, hint }: TagInputProps) {
  const id = useId();
  const [draft, setDraft] = useState('');

  function add(raw: string) {
    const value = raw.trim().replace(/\s+/g, ' ');
    if (!value || values.length >= max || values.some((existing) => existing.toLowerCase() === value.toLowerCase())) return;
    onChange([...values, value]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(draft);
      setDraft('');
    } else if (event.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  const remaining = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()));

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="flex min-h-[3.25rem] flex-wrap items-center gap-1.5 rounded-xl border border-ved-green-900/15 bg-white px-2.5 py-2 focus-within:border-ved-green-500 focus-within:ring-2 focus-within:ring-ved-green-500/20">
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-1 rounded-full bg-ved-green-50 px-2.5 py-1 text-sm text-ved-green-800 ring-1 ring-ved-green-600/20">
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              className="text-ved-green-700/60 hover:text-ved-green-900"
              onClick={() => onChange(values.filter((v) => v !== value))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-base text-ved-green-900 placeholder:text-ved-green-900/40 focus:outline-none"
          value={draft}
          placeholder={values.length === 0 ? placeholder : 'Add more…'}
          disabled={values.length >= max}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            add(draft);
            setDraft('');
          }}
        />
      </div>
      {remaining.length > 0 && values.length < max && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {remaining.slice(0, 10).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="rounded-full border border-ved-gold-400/50 bg-ved-gold-50 px-2.5 py-1 text-xs text-ved-green-800 hover:bg-ved-gold-100"
              onClick={() => add(suggestion)}
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
      {hint && <p className="mt-1 text-xs text-ved-green-800/60">{hint}</p>}
    </div>
  );
}
