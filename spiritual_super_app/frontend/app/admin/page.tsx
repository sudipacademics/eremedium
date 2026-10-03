'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AdminGate, useAdminAccess } from '@/components/admin/AdminGate';
import { ADMIN_NAV, canAccess } from '@/lib/admin-nav';
import { STATUS_TONE, formatDateTime, type AdminOverview } from '@/lib/admin-types';
import { api } from '@/lib/api';

const inr = (value: string) =>
  `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function Kpi({ label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold text-white tabular">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ved-gold-300/80">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="card block transition hover:border-ved-gold-400/40">
      {body}
    </Link>
  ) : (
    <div className="card">{body}</div>
  );
}

function Dashboard() {
  const access = useAdminAccess();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AdminOverview>('admin/overview')
      .then(setOverview)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load the overview'));
  }, []);

  const shortcuts = ADMIN_NAV.flatMap((group) => group.items).filter(
    (item) => item.href !== '/admin' && canAccess(item, access.permissions),
  );

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {!overview && !error && <p className="text-sm text-slate-400">Loading overview…</p>}

      {overview && (
        <>
          <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Users" value={overview.users.total.toLocaleString('en-IN')} hint={`+${overview.users.new7d} in the last 7 days`} />
            <Kpi
              label="Providers"
              value={overview.providers.total}
              hint={`${overview.providers.online} online now`}
              {...(access.can('providers.manage') ? { href: '/admin/astrologers' } : {})}
            />
            <Kpi
              label="Join requests open"
              value={overview.joinRequests.open}
              hint={`${overview.joinRequests.pending} awaiting first review`}
              {...(access.can('joinRequests.manage') ? { href: '/admin/join-requests' } : {})}
            />
            <Kpi label="Calls today" value={overview.operations.callsToday} hint={`${overview.operations.callsActive} live right now`} />
            <Kpi
              label="E-Puja bookings open"
              value={overview.operations.pujaBookingsOpen}
              {...(access.can('operations.manage') ? { href: '/admin/puja-bookings' } : {})}
            />
            <Kpi
              label="Shop orders to fulfil"
              value={overview.operations.shopOrdersOpen}
              {...(access.can('operations.manage') ? { href: '/admin/ayurveda-orders' } : {})}
            />
            {overview.finance && (
              <>
                <Kpi
                  label="Wallet recharges (30 days)"
                  value={inr(overview.finance.walletRecharges30d)}
                  hint={`${overview.finance.walletRechargeCount30d} payments`}
                />
                <Kpi
                  label="Consultation revenue (30 days)"
                  value={inr(overview.finance.consultationGross30d)}
                  hint={`Platform share ${inr(overview.finance.platformFee30d)}`}
                />
              </>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            {access.can('joinRequests.manage') && (
              <section className="card lg:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-white">Latest join requests</h2>
                  <Link href="/admin/join-requests" className="text-sm text-ved-gold-300 hover:text-ved-gold-200">
                    View all →
                  </Link>
                </div>
                {overview.recentJoinRequests.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-400">No applications yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-white/10">
                    {overview.recentJoinRequests.map((row) => (
                      <li key={row.id}>
                        <Link href={`/admin/join-requests/${row.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:text-ved-gold-200">
                          <span className="font-medium text-white">{row.name}</span>
                          <span className="text-sm text-slate-400">
                            {row.categoryLabel} · {row.city}
                          </span>
                          <span className={`pill ml-auto ${STATUS_TONE[row.status]}`}>{row.statusLabel}</span>
                          <span className="w-full text-xs text-slate-500 sm:w-auto">{formatDateTime(row.createdAt)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            <section className="card">
              <h2 className="font-semibold text-white">Providers by category</h2>
              {overview.providers.byCategory.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No providers yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {overview.providers.byCategory.map((row) => (
                    <li key={row.category} className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">{row.label}</span>
                      <span className="tabular font-semibold text-white">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      <section aria-label="Shortcuts">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ved-gold-400/80">Manage</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shortcuts.map((item) => (
            <Link key={item.href} href={item.href} className="card flex items-center gap-3 transition hover:border-ved-gold-400/40">
              <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ved-gold-400/10 text-lg text-ved-gold-300">
                {item.icon}
              </span>
              <span className="font-medium text-white">{item.label}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <AdminGate>
      <Dashboard />
    </AdminGate>
  );
}
