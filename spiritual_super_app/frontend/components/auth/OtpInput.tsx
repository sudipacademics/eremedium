'use client';

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

/**
 * One box per digit. The first box carries autocomplete="one-time-code" so iOS/Android can offer the
 * code straight from the SMS; any multi-digit input (autofill or paste) is spread across the boxes.
 */
export function OtpInput({
  length,
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
}: {
  length: number;
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    refs.current[Math.min(value.length, length - 1)]?.focus();
    // Only on mount: later focus moves follow typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit(next: string, focusIndex: number) {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    refs.current[Math.min(focusIndex, length - 1)]?.focus();
    if (clean.length === length) onComplete?.(clean);
  }

  function handleInput(index: number, raw: string) {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return;
    if (digits.length > 1) {
      commit(digits, digits.length);
      return;
    }
    const chars = value.padEnd(length, ' ').split('');
    chars[index] = digits;
    const next = chars.join('').replace(/\s+$/, '');
    commit(next.replace(/\s/g, ''), index + 1);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index]) commit(value.slice(0, index) + value.slice(index + 1), index);
      else if (index > 0) commit(value.slice(0, index - 1) + value.slice(index), index - 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const digits = event.clipboardData.getData('text').replace(/\D/g, '');
    if (digits) commit(digits, digits.length);
  }

  return (
    <div className="flex justify-between gap-2 sm:gap-3" role="group" aria-label="One-time code">
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${index + 1} of ${length}`}
          maxLength={index === 0 ? length : 1}
          value={value[index] ?? ''}
          disabled={disabled}
          onChange={(e) => handleInput(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={`h-12 w-full min-w-0 rounded-xl border bg-white text-center font-display text-2xl font-semibold text-ved-green-900 shadow-sm outline-none transition focus:border-ved-gold-400 focus:ring-2 focus:ring-ved-gold-300/60 disabled:opacity-60 sm:h-14 ${
            invalid ? 'border-rose-300 bg-rose-50' : 'border-ved-green-900/15'
          }`}
        />
      ))}
    </div>
  );
}
