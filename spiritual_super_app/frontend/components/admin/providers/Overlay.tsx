'use client';

import Image from 'next/image';
import { useEffect, useRef, type ReactNode } from 'react';

import { astrologerPhotoUrl } from '@/lib/api';
import type { ProviderItem } from '@/lib/providers';
import { statusBadge } from '@/lib/providers';

/** Dialogs listen in the capture phase and stop the event, so Escape closes only the topmost layer. */
function useEscape(onClose: () => void, topmost = false) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (topmost) event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, topmost);
    return () => window.removeEventListener('keydown', onKey, topmost);
  }, [onClose, topmost]);
}

/** Centred dialog. Nested dialogs stack above the drawer via z-index. */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  useEscape(onClose, true);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus(), []);
  const width = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl';
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button type="button" aria-label="Close dialog" className="absolute inset-0 bg-[#041a16]/55 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-t-3xl bg-[#FBF9F4] shadow-2xl outline-none ring-1 ring-ved-green-900/10 sm:rounded-3xl`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ved-green-900/10 px-5 py-4 sm:px-6">
          <div>
            <h2 className="font-display text-xl font-semibold text-ved-green-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-ved-green-800/65">{subtitle}</p>}
          </div>
          <CloseButton onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-ved-green-900/10 bg-white/60 px-5 py-3.5 sm:px-6">{footer}</footer>}
      </div>
    </div>
  );
}

export function SideDrawer({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" aria-label="Close provider details" className="absolute inset-0 bg-[#041a16]/40" onClick={onClose} />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col bg-[#FBF9F4] shadow-2xl outline-none ring-1 ring-ved-green-900/10"
      >
        {children}
      </aside>
    </div>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ved-green-800/70 hover:bg-ved-green-900/5 hover:text-ved-green-900"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

export function ProviderAvatar({ provider, size = 44 }: { provider: Pick<ProviderItem, 'id' | 'photoVersion' | 'displayName' | 'presence' | 'accountStatus'>; size?: number }) {
  const photo = astrologerPhotoUrl(provider);
  const badge = statusBadge(provider);
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span className="block h-full w-full overflow-hidden rounded-full bg-gradient-to-br from-ved-green-700 to-ved-green-900 ring-2 ring-[#e3cf9c]">
        {photo ? (
          <Image src={photo} alt="" width={size} height={size} unoptimized className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center font-display font-semibold text-[#dcc06c]" style={{ fontSize: size * 0.4 }}>
            {provider.displayName.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white ${badge.dot}`} aria-hidden />
    </span>
  );
}

export function Pill({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>{children}</span>;
}

export function Stars({ value, className = 'h-3.5 w-3.5' }: { value: number; className?: string }) {
  return (
    <span className="inline-flex text-[#c9a24a]" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} viewBox="0 0 24 24" className={className} fill={n <= Math.round(value) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />
        </svg>
      ))}
    </span>
  );
}

export const inputClass =
  'w-full rounded-xl border border-ved-green-900/15 bg-white px-3 py-2 text-sm text-ved-green-900 outline-none placeholder:text-ved-green-800/40 focus:border-ved-green-600/50 focus:ring-2 focus:ring-ved-green-600/15';

export const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-ved-green-800/70';

export const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-ved-green-800 px-4 py-2 text-sm font-semibold text-ved-cream-50 shadow-sm hover:bg-ved-green-900 disabled:cursor-not-allowed disabled:opacity-50';

export const ghostButton =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-ved-green-900/15 bg-white px-4 py-2 text-sm font-medium text-ved-green-900 hover:bg-ved-cream-100 disabled:cursor-not-allowed disabled:opacity-50';

export const dangerButton =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-ved-cream-50 shadow-sm hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50';

export function inr(value: string | number): string {
  const amount = typeof value === 'number' ? value : Number(value);
  const whole = amount % 1 === 0;
  return `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(amount)}`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function errorText(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}
