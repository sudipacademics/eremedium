'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AdminGate, useAdminAccess } from '@/components/admin/AdminGate';
import { AdminIcon } from '@/components/admin/AdminIcon';
import { EditProviderDialog, type EditSection } from '@/components/admin/providers/EditProviderDialog';
import { DeboardDialog, DeleteDialog, ReinstateDialog, SuspendDialog } from '@/components/admin/providers/LifecycleDialogs';
import { errorText, ghostButton, inputClass, primaryButton } from '@/components/admin/providers/Overlay';
import { MakePayoutDialog } from '@/components/admin/providers/Payouts';
import { ProviderDrawer, type DrawerTab } from '@/components/admin/providers/ProviderDrawer';
import { ProviderKpis } from '@/components/admin/providers/ProviderKpis';
import { ProviderTable, type ProviderAction } from '@/components/admin/providers/ProviderTable';
import { PROVIDER_CATEGORIES, saveBlob } from '@/lib/admin-types';
import { api } from '@/lib/api';
import {
  EMPTY_FILTERS,
  PROVIDER_TABS,
  STATUS_FILTERS,
  filterProviders,
  inTab,
  languageOptions,
  providersCsv,
  tabCounts,
  type ProviderFilters,
  type ProviderItem,
  type ProviderList,
  type ProviderTab,
} from '@/lib/providers';

const PAGE_SIZE = 8;

type Dialog = { kind: 'pay' | 'suspend' | 'reinstate' | 'deboard' | 'delete'; item: ProviderItem } | null;

function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1].filter((n) => n >= 1 && n <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1]! > 1) out.push('…');
    out.push(n);
  });
  return out;
}

function SelectFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: readonly { value: string; label: string }[] }) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select className={`${inputClass} py-2.5`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{label}: All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProviderManagement() {
  const access = useAdminAccess();
  const can = useMemo(() => ({ manage: access.can('providers.manage'), finance: access.can('finance.view') }), [access]);

  const [data, setData] = useState<ProviderList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProviderFilters>(EMPTY_FILTERS);
  const [tab, setTab] = useState<ProviderTab>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<{ id: string; tab: DrawerTab } | null>(null);
  const [edit, setEdit] = useState<{ id: string; section: EditSection } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(() => {
    api
      .get<ProviderList>('admin/providers')
      .then((next) => {
        setData(next);
        setLoadError(null);
      })
      .catch((caught: unknown) => setLoadError(errorText(caught, 'Could not load providers')));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const items = data?.items ?? [];
  const filtered = useMemo(() => filterProviders(items, filters), [items, filters]);
  const counts = useMemo(() => tabCounts(filtered), [filtered]);
  const visible = useMemo(() => filtered.filter((item) => inTab(item, tab)), [filtered, tab]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageItems = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const languages = useMemo(() => languageOptions(items).map((lang) => ({ value: lang, label: lang })), [items]);
  const drawerItem = drawer ? items.find((item) => item.id === drawer.id) ?? null : null;

  useEffect(() => setPage(1), [filters, tab]);

  const refresh = (message: string) => {
    setToast(message);
    setDialog(null);
    load();
    setVersion((v) => v + 1);
  };

  const onAction = (action: ProviderAction, item: ProviderItem) => {
    switch (action) {
      case 'view':
        return setDrawer({ id: item.id, tab: 'overview' });
      case 'payouts':
        return setDrawer({ id: item.id, tab: 'payouts' });
      case 'edit':
        return setEdit({ id: item.id, section: 'profile' });
      case 'schedule':
        return setEdit({ id: item.id, section: 'availability' });
      default:
        return setDialog({ kind: action, item });
    }
  };

  const exportCsv = () => {
    const rows = selected.size > 0 ? items.filter((item) => selected.has(item.id)) : visible;
    saveBlob(new Blob([`\uFEFF${providersCsv(rows)}`], { type: 'text/csv;charset=utf-8' }), `providers-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const filtersActive = filters.search || filters.category || filters.status || filters.language;

  return (
    <div className="space-y-5">
      <div className="-mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ved-green-800/70">Manage all providers, their profiles, earnings, payouts and performance.</p>
        <div className="flex gap-2">
          <Link href="/admin/join-requests" className={primaryButton}>
            <AdminIcon name="userPlus" className="h-4 w-4" /> Add Provider
          </Link>
          <button type="button" className={ghostButton} onClick={exportCsv} disabled={items.length === 0}>
            <AdminIcon name="external" className="h-4 w-4 rotate-90" /> Export{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
      </div>

      {loadError && (
        <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}{' '}
          <button type="button" className="font-semibold underline" onClick={load}>
            Retry
          </button>
        </p>
      )}

      {data ? <ProviderKpis kpis={data.kpis} /> : !loadError && <div className="h-24 animate-pulse rounded-2xl bg-white/70" />}

      <section className="overflow-hidden rounded-3xl border border-ved-green-900/[0.07] bg-white shadow-[0_1px_2px_rgba(6,35,30,0.04)]">
        <div className="grid gap-2.5 border-b border-ved-green-900/[0.07] p-4 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
          <label className="relative md:col-span-2 xl:col-span-1">
            <span className="sr-only">Search providers</span>
            <AdminIcon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ved-green-800/45" />
            <input
              className={`${inputClass} py-2.5 pl-9`}
              placeholder="Search by name, ID, expertise or phone…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </label>
          <SelectFilter label="Category" value={filters.category} onChange={(category) => setFilters((f) => ({ ...f, category }))} options={PROVIDER_CATEGORIES} />
          <SelectFilter label="Status" value={filters.status} onChange={(status) => setFilters((f) => ({ ...f, status }))} options={STATUS_FILTERS} />
          <SelectFilter label="Language" value={filters.language} onChange={(language) => setFilters((f) => ({ ...f, language }))} options={languages} />
          <button type="button" className={`${ghostButton} py-2.5`} onClick={() => setFilters(EMPTY_FILTERS)} disabled={!filtersActive}>
            Reset
          </button>
        </div>

        <div className="scrollbar-none flex gap-1.5 overflow-x-auto px-4 pt-4" role="tablist" aria-label="Provider status">
          {PROVIDER_TABS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="tab"
              aria-selected={tab === entry.value}
              onClick={() => setTab(entry.value)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition ${
                tab === entry.value ? 'bg-ved-green-800 text-ved-cream-50 shadow-sm' : 'bg-ved-cream-50 text-ved-green-800 ring-1 ring-inset ring-ved-green-900/10 hover:bg-ved-cream-100'
              }`}
            >
              {entry.label} <span className={tab === entry.value ? 'text-[#e3cf9c]' : 'text-ved-green-800/55'}>({counts[entry.value]})</span>
            </button>
          ))}
        </div>

        <div className="mt-3">
          {!data && !loadError ? (
            <p className="px-4 py-10 text-center text-sm text-ved-green-800/60">Loading providers…</p>
          ) : pageItems.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="font-medium text-ved-green-900">No providers match</p>
              <p className="mt-1 text-sm text-ved-green-800/60">
                {items.length === 0 ? 'Approve a join request to add your first provider.' : 'Try a different tab or clear the filters.'}
              </p>
            </div>
          ) : (
            <ProviderTable
              items={pageItems}
              selected={selected}
              can={can}
              onAction={onAction}
              onToggle={(id) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onToggleAll={(checked) =>
                setSelected((current) => {
                  const next = new Set(current);
                  for (const item of pageItems) {
                    if (checked) next.add(item.id);
                    else next.delete(item.id);
                  }
                  return next;
                })
              }
            />
          )}
        </div>

        {visible.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ved-green-900/[0.07] px-4 py-3 text-sm">
            <p className="text-ved-green-800/65">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visible.length)} of {visible.length} provider{visible.length === 1 ? '' : 's'}
            </p>
            <nav className="flex items-center gap-1" aria-label="Pagination">
              <button
                type="button"
                aria-label="Previous page"
                className="grid h-8 w-8 place-items-center rounded-lg text-ved-green-800 hover:bg-ved-cream-100 disabled:opacity-40"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <AdminIcon name="chevronRight" className="h-4 w-4 rotate-180" />
              </button>
              {pageNumbers(currentPage, pages).map((n, i) =>
                n === '…' ? (
                  <span key={`gap-${i}`} className="px-1 text-ved-green-800/50">
                    …
                  </span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    aria-current={n === currentPage ? 'page' : undefined}
                    onClick={() => setPage(n)}
                    className={`h-8 min-w-8 rounded-lg px-2 font-medium ${n === currentPage ? 'bg-ved-green-800 text-ved-cream-50' : 'text-ved-green-800 hover:bg-ved-cream-100'}`}
                  >
                    {n}
                  </button>
                ),
              )}
              <button
                type="button"
                aria-label="Next page"
                className="grid h-8 w-8 place-items-center rounded-lg text-ved-green-800 hover:bg-ved-cream-100 disabled:opacity-40"
                disabled={currentPage === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                <AdminIcon name="chevronRight" className="h-4 w-4" />
              </button>
            </nav>
          </div>
        )}
      </section>

      {drawer && drawerItem && (
        <ProviderDrawer
          item={drawerItem}
          initialTab={drawer.tab}
          version={version}
          can={can}
          onClose={() => setDrawer(null)}
          onAction={onAction}
          onEdit={(section) => setEdit({ id: drawerItem.id, section })}
        />
      )}

      {edit && (
        <EditProviderDialog
          key={`${edit.id}-${edit.section}`}
          providerId={edit.id}
          initialSection={edit.section}
          canManage={can.manage}
          onClose={() => {
            setEdit(null);
            load();
            setVersion((v) => v + 1);
          }}
          onSaved={(message) => {
            setEdit(null);
            refresh(message);
          }}
          onAction={(action) => {
            const item = items.find((entry) => entry.id === edit.id);
            setEdit(null);
            if (item) onAction(action, item);
          }}
        />
      )}

      {dialog?.kind === 'pay' && (
        <MakePayoutDialog
          provider={dialog.item}
          onClose={() => setDialog(null)}
          onDone={(payout) => refresh(payout.status === 'FAILED' ? `Payout failed: ${payout.failureReason ?? 'see payout history'}` : `Payout of ₹${payout.amount} ${payout.method === 'MANUAL' ? 'recorded' : 'initiated'}`)}
        />
      )}
      {dialog?.kind === 'suspend' && <SuspendDialog provider={dialog.item} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'reinstate' && <ReinstateDialog provider={dialog.item} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'deboard' && <DeboardDialog provider={dialog.item} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          provider={dialog.item}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDrawer(null);
            refresh(message);
          }}
        />
      )}

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-ved-green-900 px-5 py-2.5 text-sm font-medium text-ved-cream-50 shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

export default function AdminProvidersPage() {
  return (
    <AdminGate>
      <ProviderManagement />
    </AdminGate>
  );
}
