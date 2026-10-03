'use client';

import { useEffect, useRef, useState } from 'react';

import { AdminIcon } from '@/components/admin/AdminIcon';
import { KYC_BADGE, categoryTone, platformCommissionPct, statusBadge, type ProviderItem } from '@/lib/providers';

import { Pill, ProviderAvatar, inr } from './Overlay';

export type ProviderAction = 'view' | 'edit' | 'schedule' | 'payouts' | 'pay' | 'suspend' | 'reinstate' | 'deboard' | 'delete';

export interface ActionPermissions {
  manage: boolean;
  finance: boolean;
}

interface MenuEntry {
  action: ProviderAction;
  label: string;
  icon: Parameters<typeof AdminIcon>[0]['name'];
  danger?: boolean;
}

export function menuFor(item: ProviderItem, can: ActionPermissions): MenuEntry[][] {
  const view: MenuEntry[] = [{ action: 'view', label: 'View Profile', icon: 'users' }];
  if (can.manage) {
    view.push({ action: 'edit', label: 'Edit Provider', icon: 'blog' }, { action: 'schedule', label: 'Manage Schedule', icon: 'calendar' });
  }
  const money: MenuEntry[] = [{ action: 'payouts', label: 'Payout History', icon: 'history' }];
  if (can.finance) money.push({ action: 'pay', label: 'Make Payout', icon: 'rupee' });
  const lifecycle: MenuEntry[] = [];
  if (can.manage) {
    if (item.accountStatus === 'ACTIVE') lifecycle.push({ action: 'suspend', label: 'Suspend Provider', icon: 'roles', danger: true });
    else lifecycle.push({ action: 'reinstate', label: item.accountStatus === 'SUSPENDED' ? 'Lift Suspension' : 'Reinstate Provider', icon: 'check' });
    if (item.accountStatus !== 'DEBOARDED') lifecycle.push({ action: 'deboard', label: 'Deboard Provider', icon: 'logout', danger: true });
    lifecycle.push({ action: 'delete', label: 'Delete', icon: 'box', danger: true });
  }
  return [view, money, lifecycle].filter((group) => group.length > 0);
}

function ActionsMenu({ item, can, onAction }: { item: ProviderItem; can: ActionPermissions; onAction: (action: ProviderAction, item: ProviderItem) => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number; up: boolean } | null>(null);

  useEffect(() => {
    if (!position) return;
    const close = (event: Event) => {
      if (event.type === 'mousedown' && (menu.current?.contains(event.target as Node) || button.current?.contains(event.target as Node))) return;
      setPosition(null);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setPosition(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [position]);

  const toggle = () => {
    if (position) return setPosition(null);
    const rect = button.current!.getBoundingClientRect();
    const up = rect.bottom + 360 > window.innerHeight && rect.top > 360;
    setPosition({ top: up ? rect.top - 6 : rect.bottom + 6, right: window.innerWidth - rect.right, up });
  };

  const groups = menuFor(item, can);
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={position !== null}
        aria-label={`Actions for ${item.displayName}`}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        className="grid h-9 w-9 place-items-center rounded-full text-ved-green-800/70 hover:bg-ved-green-900/5 hover:text-ved-green-900"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {position && (
        <div
          ref={menu}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          style={{ top: position.top, right: position.right, transform: position.up ? 'translateY(-100%)' : undefined }}
          className="fixed z-[55] w-56 rounded-2xl border border-ved-green-900/10 bg-white p-1.5 text-left shadow-xl"
        >
          {groups.map((group, index) => (
            <div key={index} className={index > 0 ? 'mt-1 border-t border-ved-green-900/[0.07] pt-1' : ''}>
              {group.map((entry) => (
                <button
                  key={entry.action}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPosition(null);
                    onAction(entry.action, item);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm focus:outline-none ${
                    entry.danger ? 'text-rose-600 hover:bg-rose-50 focus:bg-rose-50' : 'text-ved-green-900 hover:bg-ved-cream-100 focus:bg-ved-cream-100'
                  }`}
                >
                  <AdminIcon name={entry.icon} className="h-4 w-4 opacity-80" />
                  {entry.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RatingCell({ item }: { item: ProviderItem }) {
  if (item.rating === null) return <span className="text-xs text-ved-green-800/50">No ratings yet</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold text-ved-green-900">
        <span className="text-[#c9a24a]">★</span> {item.rating.toFixed(1)}
      </span>
      <span className="block text-xs text-ved-green-800/55">({item.ratingCount.toLocaleString('en-IN')})</span>
    </span>
  );
}

function StatusLine({ item }: { item: ProviderItem }) {
  const badge = statusBadge(item);
  return (
    <span className="flex items-center gap-1.5 text-xs text-ved-green-800/60">
      <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
      {badge.label}
    </span>
  );
}

export function ProviderTable({
  items,
  selected,
  onToggle,
  onToggleAll,
  can,
  onAction,
}: {
  items: ProviderItem[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  can: ActionPermissions;
  onAction: (action: ProviderAction, item: ProviderItem) => void;
}) {
  const allChecked = items.length > 0 && items.every((item) => selected.has(item.id));
  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead>
            <tr className="border-b border-ved-green-900/10 text-xs font-semibold uppercase tracking-wide text-ved-green-800/60">
              <th className="w-10 py-3 pl-4">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allChecked}
                  onChange={(event) => onToggleAll(event.target.checked)}
                  className="h-4 w-4 rounded border-ved-green-900/30 accent-ved-green-800"
                />
              </th>
              <th className="py-3 pr-3">Provider</th>
              <th className="py-3 pr-3">Category</th>
              <th className="py-3 pr-3">Expertise</th>
              <th className="py-3 pr-3">Rate (₹/min)</th>
              <th className="py-3 pr-3">Commission</th>
              <th className="py-3 pr-3">Status</th>
              <th className="py-3 pr-3">Rating</th>
              <th className="py-3 pr-3">Sessions</th>
              <th className="py-3 pr-3">Total Earnings</th>
              <th className="py-3 pr-3">Next Payout</th>
              <th className="py-3 pr-3">KYC</th>
              <th className="py-3 pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ved-green-900/[0.06]">
            {items.map((item) => {
              const badge = statusBadge(item);
              const kyc = KYC_BADGE[item.kycStatus];
              return (
                <tr
                  key={item.id}
                  onClick={() => onAction('view', item)}
                  className={`cursor-pointer transition hover:bg-[#FBF7EC] ${selected.has(item.id) ? 'bg-[#FBF7EC]' : ''}`}
                >
                  <td className="py-3 pl-4" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.displayName}`}
                      checked={selected.has(item.id)}
                      onChange={() => onToggle(item.id)}
                      className="h-4 w-4 rounded border-ved-green-900/30 accent-ved-green-800"
                    />
                  </td>
                  <td className="py-3 pr-3">
                    <span className="flex items-center gap-3">
                      <ProviderAvatar provider={item} size={42} />
                      <span className="min-w-0">
                        <span className="block max-w-[11rem] truncate font-semibold text-ved-green-900">{item.displayName}</span>
                        <StatusLine item={item} />
                      </span>
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${categoryTone(item.category)}`}>{item.categoryLabel}</span>
                  </td>
                  <td className="max-w-[12rem] py-3 pr-3">
                    <span className="block truncate text-ved-green-900">{item.expertise.slice(0, 3).join(', ') || '—'}</span>
                    <span className="block truncate text-xs text-ved-green-800/55">{item.languages.join(', ')}</span>
                  </td>
                  <td className="py-3 pr-3 font-medium tabular-nums text-ved-green-900">{inr(item.perMinuteRate)}</td>
                  <td className="py-3 pr-3 tabular-nums text-ved-green-900">{platformCommissionPct(item.commissionSplit)}%</td>
                  <td className="py-3 pr-3">
                    <Pill tone={badge.tone}>{badge.label}</Pill>
                  </td>
                  <td className="py-3 pr-3">
                    <RatingCell item={item} />
                  </td>
                  <td className="py-3 pr-3 tabular-nums text-ved-green-900">{item.sessions.toLocaleString('en-IN')}</td>
                  <td className="py-3 pr-3 tabular-nums">
                    <span className="block font-semibold text-ved-green-900">{inr(item.totalEarnings)}</span>
                    <span className="block text-xs text-ved-green-800/55">{inr(item.monthEarnings)} this month</span>
                  </td>
                  <td className="py-3 pr-3 tabular-nums">
                    <span className={`font-semibold ${Number(item.pendingPayout) > 0 ? 'text-[#a8782c]' : 'text-ved-green-800/50'}`}>{inr(item.pendingPayout)}</span>
                  </td>
                  <td className="py-3 pr-3">
                    <Pill tone={kyc.tone}>{kyc.label.replace('KYC ', '')}</Pill>
                  </td>
                  <td className="py-3 pr-4 text-right" onClick={(event) => event.stopPropagation()}>
                    <ActionsMenu item={item} can={can} onAction={onAction} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-ved-green-900/[0.06] lg:hidden">
        {items.map((item) => {
          const badge = statusBadge(item);
          return (
            <li key={item.id} className="flex gap-3 px-4 py-4">
              <button type="button" onClick={() => onAction('view', item)} className="flex min-w-0 flex-1 gap-3 text-left">
                <ProviderAvatar provider={item} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-ved-green-900">{item.displayName}</span>
                    <Pill tone={badge.tone}>{badge.label}</Pill>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ved-green-800/60">
                    {item.categoryLabel} · {item.languages.join(', ')}
                  </span>
                  <span className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <span>
                      <span className="block text-ved-green-800/55">Rate</span>
                      <span className="font-semibold text-ved-green-900">{inr(item.perMinuteRate)}/min</span>
                    </span>
                    <span>
                      <span className="block text-ved-green-800/55">Earned</span>
                      <span className="font-semibold text-ved-green-900">{inr(item.totalEarnings)}</span>
                    </span>
                    <span>
                      <span className="block text-ved-green-800/55">Next payout</span>
                      <span className="font-semibold text-[#a8782c]">{inr(item.pendingPayout)}</span>
                    </span>
                  </span>
                </span>
              </button>
              <ActionsMenu item={item} can={can} onAction={onAction} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
