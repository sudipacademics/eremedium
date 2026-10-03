'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { AdminGate, useAdminAccess } from '@/components/admin/AdminGate';
import { AdminIcon, LotusMark, type AdminIconName } from '@/components/admin/AdminIcon';
import { BarChart, Donut, LineChart, type DonutSlice } from '@/components/admin/DashboardCharts';
import type { AdminPermission } from '@/lib/admin-nav';
import {
  DASHBOARD_PERIODS,
  STATUS_TONE,
  formatInr,
  formatInrCompact,
  timeAgo,
  type AdminDashboard,
  type DashboardPeriod,
  type Kpi,
} from '@/lib/admin-types';
import { api, session } from '@/lib/api';

const SERVICE_COLORS: Record<string, string> = {
  consultations: '#10b981',
  epuja: '#c9a64a',
  ayurveda: '#0ea5e9',
  crystals: '#8b5cf6',
};
const CATEGORY_COLORS = ['#10b981', '#c9a64a', '#0ea5e9', '#8b5cf6', '#f97316', '#ec4899', '#64748b'];
const COUNT = new Intl.NumberFormat('en-IN');

function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-ved-green-900/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(5,40,33,0.04)] ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-ved-green-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ViewAll({ href }: { href: string }) {
  return (
    <Link href={href} className="text-xs font-semibold text-ved-green-600 hover:text-ved-green-800">
      View all
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ved-green-800/55">{children}</p>;
}

function MiniSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={String(value)}
        onChange={(event) => {
          const picked = options.find((option) => String(option.value) === event.target.value);
          if (picked) onChange(picked.value);
        }}
        className="appearance-none rounded-lg border border-ved-green-900/10 bg-[#FAF8F3] py-1.5 pl-3 pr-8 text-xs font-medium text-ved-green-900 focus:outline-none focus:ring-2 focus:ring-ved-green-600/20"
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
      <AdminIcon name="chevronDown" className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ved-green-800/50" />
    </label>
  );
}

function ChangePill({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="rounded-full bg-ved-green-900/[0.05] px-2 py-0.5 text-[11px] font-semibold text-ved-green-800/55">New</span>;
  const up = pct >= 0;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
      {up ? '↑' : '↓'} {Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%
    </span>
  );
}

function KpiTile({
  label,
  icon,
  tone,
  kpi,
  value,
  footer,
  href,
}: {
  label: string;
  icon: AdminIconName;
  tone: string;
  kpi: Kpi;
  value: string;
  footer: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${tone}`}>
          <AdminIcon name={icon} className="h-5 w-5" />
        </span>
        <ChangePill pct={kpi.changePct} />
      </div>
      <p className="mt-3 text-xs font-medium text-ved-green-800/60">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-semibold text-ved-green-900 tabular">{value}</p>
      <p className="mt-1 text-[11px] text-ved-green-800/55">{footer}</p>
    </>
  );
  const className = 'block rounded-2xl border border-ved-green-900/[0.07] bg-white p-4 shadow-[0_1px_2px_rgba(5,40,33,0.04)] transition';
  return href ? (
    <Link href={href} className={`${className} hover:-translate-y-0.5 hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function WelcomeBanner({ name, periodLabel }: { name: string; periodLabel: string }) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b4f45] via-[#083d35] to-[#052821] px-6 py-7 text-white shadow-lg sm:px-8">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full bg-ved-gold-400/10 blur-3xl" />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">
            Welcome Back, <span className="text-[#e3c878]">{name}</span> <span aria-hidden>👋</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-[#d5ebe3]/80">
            Here’s what’s happening across Vedsutra — {periodLabel.toLowerCase()} at a glance.
          </p>
        </div>
        <div className="flex items-center gap-5">
          {/* Literal colours: .admin-light remaps the ved-gold-200/300 utilities to a dark gold. */}
          <LotusMark className="hidden h-20 w-20 text-[#dcc06c] drop-shadow-[0_0_18px_rgba(201,166,74,0.45)] sm:block" />
          <div className="border-l border-[#dcc06c]/30 pl-5 font-display text-lg leading-snug text-[#ead7a0]">
            <p>Ancient Wisdom</p>
            <p>Modern Technology</p>
            <p>A Better Tomorrow</p>
          </div>
        </div>
      </div>
    </section>
  );
}

const QUICK_ACTIONS: readonly { label: string; href: string; icon: AdminIconName; permission: AdminPermission }[] = [
  { label: 'Add Provider', href: '/admin/astrologers', icon: 'userPlus', permission: 'providers.manage' },
  { label: 'Review Join Requests', href: '/admin/join-requests', icon: 'joinRequests', permission: 'joinRequests.manage' },
  { label: 'Add Product', href: '/admin/ayurveda', icon: 'box', permission: 'catalog.manage' },
  { label: 'Manage Orders', href: '/admin/ayurveda-orders', icon: 'orders', permission: 'operations.manage' },
  { label: 'Create E-Puja', href: '/admin/pujas', icon: 'temple', permission: 'catalog.manage' },
  { label: 'Publish Blog', href: '/admin/articles', icon: 'blog', permission: 'content.manage' },
  { label: 'Manage Banners', href: '/admin/hero', icon: 'banner', permission: 'content.manage' },
  { label: 'View Reports', href: '/admin/audit', icon: 'chart', permission: 'audit.view' },
];

const ACTIVITY_ICON: Record<AdminDashboard['recentActivity'][number]['kind'], { icon: AdminIconName; tone: string }> = {
  user: { icon: 'users', tone: 'bg-emerald-50 text-emerald-600' },
  join: { icon: 'joinRequests', tone: 'bg-amber-50 text-amber-600' },
  puja: { icon: 'temple', tone: 'bg-orange-50 text-orange-600' },
  order: { icon: 'cart', tone: 'bg-sky-50 text-sky-600' },
  call: { icon: 'phone', tone: 'bg-violet-50 text-violet-600' },
  audit: { icon: 'audit', tone: 'bg-slate-100 text-slate-600' },
};

const CONSULTATION_TONE: Record<AdminDashboard['recentConsultations'][number]['status'], string> = {
  INITIATED: 'bg-amber-50 text-amber-700',
  ACTIVE: 'bg-sky-50 text-sky-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  DROPPED_INSUFFICIENT_FUNDS: 'bg-rose-50 text-rose-700',
};

const ORDER_TONE: Record<AdminDashboard['latestOrders'][number]['status'], string> = {
  CONFIRMED: 'bg-amber-50 text-amber-700',
  PACKED: 'bg-sky-50 text-sky-700',
  DISPATCHED: 'bg-emerald-50 text-emerald-700',
};

function Dashboard({ period }: { period: DashboardPeriod }) {
  const access = useAdminAccess();
  const [revenueRange, setRevenueRange] = useState<'year' | '12m'>('year');
  const [growthMonths, setGrowthMonths] = useState<6 | 12>(6);
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .get<AdminDashboard>(`admin/dashboard?period=${period}&revenueRange=${revenueRange}&growthMonths=${growthMonths}`)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load the dashboard');
      });
    return () => {
      cancelled = true;
    };
  }, [period, revenueRange, growthMonths]);

  const name = (access.name && access.name !== 'Devotee' ? access.name : session.profile?.name) || 'Admin';
  const firstName = name.split(/\s+/)[0] ?? name;
  const link = (permission: AdminPermission, href: string) => (access.can(permission) ? { href } : {});
  const periodWord = period === 'all' ? 'all time' : `this ${period}`;
  const footer = (kpi: Kpi) => (period === 'all' ? `${COUNT.format(kpi.total)} in total` : `+${COUNT.format(kpi.inPeriod)} ${periodWord}`);

  if (error && !data) {
    return (
      <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-6" aria-busy="true">
        <WelcomeBanner name={firstName} periodLabel="This month" />
        <p className="text-sm text-ved-green-800/60">Loading dashboard…</p>
      </div>
    );
  }

  const { kpis } = data;
  const quickActions = QUICK_ACTIONS.filter((action) => access.can(action.permission));
  const serviceSlices: DonutSlice[] = (data.serviceRevenue?.items ?? []).map((item) => ({
    key: item.key,
    label: item.label,
    value: item.amount,
    color: SERVICE_COLORS[item.key] ?? '#64748b',
  }));
  const categorySlices: DonutSlice[] = data.providersByCategory.map((row, index) => ({
    key: row.category,
    label: row.label,
    value: row.count,
    color: CATEGORY_COLORS[index % CATEGORY_COLORS.length]!,
  }));
  const providerTotal = categorySlices.reduce((sum, slice) => sum + slice.value, 0);
  const pendingRows: { label: string; count: number; href: string | null; icon: AdminIconName; tone: string }[] = [
    {
      label: 'Provider join requests',
      count: data.pending.joinRequests,
      href: access.can('joinRequests.manage') ? '/admin/join-requests' : null,
      icon: 'joinRequests',
      tone: 'bg-amber-50 text-amber-600',
    },
    {
      label: 'E-Puja bookings to fulfil',
      count: data.pending.pujaBookings,
      href: access.can('operations.manage') ? '/admin/puja-bookings' : null,
      icon: 'temple',
      tone: 'bg-orange-50 text-orange-600',
    },
    {
      label: 'Shop orders to ship',
      count: data.pending.shopOrders,
      href: access.can('operations.manage') ? '/admin/ayurveda-orders' : null,
      icon: 'orders',
      tone: 'bg-sky-50 text-sky-600',
    },
    {
      label: 'Live calls right now',
      count: data.pending.liveCalls,
      href: access.can('support.manage') ? '/admin/support' : null,
      icon: 'live',
      tone: 'bg-violet-50 text-violet-600',
    },
  ];
  const showJoinTable = access.can('joinRequests.manage');
  const showConsultations = access.can('support.manage') || access.can('finance.view');
  const showOrders = access.can('operations.manage') || access.can('finance.view');

  return (
    <div className="space-y-6">
      <WelcomeBanner name={firstName} periodLabel={data.periodLabel} />
      {error && <p className="text-sm text-rose-700">{error}</p>}

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        <KpiTile label="Total Users" icon="users" tone="bg-emerald-50 text-emerald-600" kpi={kpis.users} value={COUNT.format(kpis.users.total)} footer={footer(kpis.users)} />
        <KpiTile
          label="Total Providers"
          icon="providers"
          tone="bg-amber-50 text-amber-600"
          kpi={kpis.providers}
          value={COUNT.format(kpis.providers.total)}
          footer={footer(kpis.providers)}
          {...link('providers.manage', '/admin/astrologers')}
        />
        <KpiTile
          label="Join Requests"
          icon="joinRequests"
          tone="bg-orange-50 text-orange-600"
          kpi={kpis.joinRequests}
          value={COUNT.format(kpis.joinRequests.total)}
          footer={`${COUNT.format(kpis.joinRequests.pending)} awaiting review`}
          {...link('joinRequests.manage', '/admin/join-requests')}
        />
        <KpiTile
          label="Consultations"
          icon="consultation"
          tone="bg-sky-50 text-sky-600"
          kpi={kpis.consultations}
          value={COUNT.format(kpis.consultations.total)}
          footer={footer(kpis.consultations)}
          {...link('support.manage', '/admin/history')}
        />
        <KpiTile
          label="E-Puja Bookings"
          icon="temple"
          tone="bg-rose-50 text-rose-600"
          kpi={kpis.pujaBookings}
          value={COUNT.format(kpis.pujaBookings.total)}
          footer={footer(kpis.pujaBookings)}
          {...link('operations.manage', '/admin/puja-bookings')}
        />
        <KpiTile
          label="Shop Orders"
          icon="cart"
          tone="bg-violet-50 text-violet-600"
          kpi={kpis.shopOrders}
          value={COUNT.format(kpis.shopOrders.total)}
          footer={footer(kpis.shopOrders)}
          {...link('operations.manage', '/admin/ayurveda-orders')}
        />
        {kpis.revenue && (
          <KpiTile
            label="Total Revenue"
            icon="rupee"
            tone="bg-ved-gold-50 text-ved-gold-600"
            kpi={kpis.revenue}
            value={formatInrCompact(kpis.revenue.total)}
            footer={period === 'all' ? 'Gross, all services' : `+${formatInrCompact(kpis.revenue.inPeriod)} ${periodWord}`}
          />
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-12">
        {data.revenueTrend && (
          <Panel
            title="Revenue Overview"
            className="xl:col-span-5"
            action={
              <MiniSelect
                label="Revenue range"
                value={revenueRange}
                onChange={setRevenueRange}
                options={[
                  { value: 'year', label: String(new Date(data.generatedAt).getFullYear()) },
                  { value: '12m', label: 'Last 12 months' },
                ]}
              />
            }
          >
            <div className="mb-3 flex flex-wrap gap-4 text-xs text-ved-green-800/70">
              {(['consultations', 'epuja', 'shop'] as const).map((key) => (
                <span key={key} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: key === 'shop' ? SERVICE_COLORS.ayurveda : SERVICE_COLORS[key] }} />
                  {key === 'consultations' ? 'Consultations' : key === 'epuja' ? 'E-Puja' : 'Shop'}
                </span>
              ))}
            </div>
            <LineChart
              labels={data.revenueTrend.months.map((m) => m.label)}
              format={formatInrCompact}
              series={[
                { key: 'consultations', label: 'Consultations', color: SERVICE_COLORS.consultations!, values: data.revenueTrend.months.map((m) => m.consultations) },
                { key: 'epuja', label: 'E-Puja', color: SERVICE_COLORS.epuja!, values: data.revenueTrend.months.map((m) => m.epuja) },
                { key: 'shop', label: 'Shop', color: SERVICE_COLORS.ayurveda!, values: data.revenueTrend.months.map((m) => m.shop) },
              ]}
            />
          </Panel>
        )}

        {data.serviceRevenue && (
          <Panel title="Service Wise Revenue" className="xl:col-span-4">
            <div className="flex flex-col items-center gap-5 sm:flex-row xl:flex-col">
              <Donut slices={serviceSlices} size={160}>
                <div>
                  <p className="text-[11px] text-ved-green-800/55">Total</p>
                  <p className="font-display text-xl font-semibold text-ved-green-900">{formatInrCompact(data.serviceRevenue.total)}</p>
                </div>
              </Donut>
              <ul className="w-full min-w-0 flex-1 space-y-2.5 text-sm">
                {data.serviceRevenue.items.map((item) => (
                  <li key={item.key} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SERVICE_COLORS[item.key] ?? '#64748b' }} />
                    <span className="min-w-0 flex-1 truncate text-ved-green-800">{item.label}</span>
                    <span className="tabular font-semibold text-ved-green-900">{formatInrCompact(item.amount)}</span>
                    <span className="w-10 shrink-0 text-right tabular text-[11px] text-ved-green-800/55">{item.pct.toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        )}

        <Panel
          title="User Growth"
          className={data.revenueTrend ? 'xl:col-span-3' : 'xl:col-span-6'}
          action={
            <MiniSelect
              label="User growth range"
              value={growthMonths}
              onChange={setGrowthMonths}
              options={[
                { value: 6, label: 'Last 6 Months' },
                { value: 12, label: 'Last 12 Months' },
              ]}
            />
          }
        >
          <BarChart labels={data.userGrowth.map((m) => m.label)} values={data.userGrowth.map((m) => m.newUsers)} format={(v) => COUNT.format(Math.round(v))} />
          <p className="mt-2 text-xs text-ved-green-800/55">New sign-ups per month · {COUNT.format(data.userGrowth.at(-1)?.total ?? 0)} users in total</p>
        </Panel>

        {!data.revenueTrend && (
          <Panel title="Providers by Category" className="xl:col-span-6">
            <CategoryDonut slices={categorySlices} total={providerTotal} />
          </Panel>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-12">
        <Panel title="Quick Actions" className="xl:col-span-7">
          {quickActions.length === 0 ? (
            <Empty>No actions available for your role.</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {quickActions.map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className="group flex flex-col items-center gap-2 rounded-2xl border border-ved-green-900/[0.07] bg-[#FAF8F3] px-2 py-4 text-center text-xs font-medium text-ved-green-900 transition hover:border-ved-gold-400/50 hover:bg-ved-gold-50"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-ved-green-600 shadow-sm transition group-hover:text-ved-gold-600">
                    <AdminIcon name={action.icon} className="h-5 w-5" />
                  </span>
                  {action.label}
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Pending Approvals" className="xl:col-span-5">
          <ul className="space-y-2">
            {pendingRows.map((row) => {
              const inner = (
                <>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${row.tone}`}>
                    <AdminIcon name={row.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-ved-green-900">{row.label}</span>
                  <span
                    className={`grid h-7 min-w-7 place-items-center rounded-full px-2 text-xs font-bold tabular ${
                      row.count > 0 ? 'bg-rose-500 text-white' : 'bg-ved-green-900/[0.06] text-ved-green-800/60'
                    }`}
                  >
                    {COUNT.format(row.count)}
                  </span>
                  {row.href && <AdminIcon name="chevronRight" className="h-4 w-4 text-ved-green-800/40" />}
                </>
              );
              return (
                <li key={row.label}>
                  {row.href ? (
                    <Link href={row.href} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-ved-cream-100">
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 px-2 py-2">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      {(showJoinTable || showConsultations || showOrders) && (
        <div className="grid gap-4 xl:grid-cols-12">
          {showJoinTable && (
            <Panel title="Latest Provider Join Requests" className="xl:col-span-5" action={<ViewAll href="/admin/join-requests" />}>
              {data.latestJoinRequests.length === 0 ? (
                <Empty>No applications yet.</Empty>
              ) : (
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-left text-sm">
                    <thead>
                      <tr className="border-b border-ved-green-900/[0.07] text-[11px] uppercase tracking-wider text-ved-green-800/50">
                        <th className="px-5 pb-2 font-semibold">Name</th>
                        <th className="pb-2 font-semibold">Category</th>
                        <th className="pb-2 font-semibold">City</th>
                        <th className="pb-2 font-semibold">Status</th>
                        <th className="px-5 pb-2 text-right font-semibold">Applied</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ved-green-900/[0.05]">
                      {data.latestJoinRequests.map((row) => (
                        <tr key={row.id} className="hover:bg-ved-cream-50">
                          <td className="px-5 py-2.5">
                            <Link href={`/admin/join-requests/${row.id}`} className="font-medium text-ved-green-900 hover:text-ved-green-600">
                              {row.name}
                            </Link>
                          </td>
                          <td className="py-2.5 text-ved-green-800/75">{row.categoryLabel}</td>
                          <td className="py-2.5 text-ved-green-800/75">{row.city}</td>
                          <td className="py-2.5">
                            <span className={`pill whitespace-nowrap ${STATUS_TONE[row.status]}`}>{row.statusLabel}</span>
                          </td>
                          <td className="whitespace-nowrap px-5 py-2.5 text-right text-xs text-ved-green-800/55">{timeAgo(row.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {showConsultations && (
            <Panel title="Recent Consultations" className="xl:col-span-4" action={<ViewAll href="/admin/history" />}>
              {data.recentConsultations.length === 0 ? (
                <Empty>No consultations yet.</Empty>
              ) : (
                <ul className="space-y-3">
                  {data.recentConsultations.map((row) => (
                    <li key={row.id} className="flex items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-600">
                        <AdminIcon name="consultation" className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ved-green-900">
                          {row.userName} <span className="font-normal text-ved-green-800/55">with</span> {row.providerName}
                        </p>
                        <p className="truncate text-xs text-ved-green-800/55">
                          {row.service} · {row.minutes} min · {timeAgo(row.at)}
                        </p>
                      </div>
                      <span className={`pill shrink-0 ${CONSULTATION_TONE[row.status]}`}>{row.statusLabel}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {showOrders && (
            <Panel title="Latest Orders" className="xl:col-span-3" action={access.can('operations.manage') ? <ViewAll href="/admin/ayurveda-orders" /> : undefined}>
              {data.latestOrders.length === 0 ? (
                <Empty>No shop orders yet.</Empty>
              ) : (
                <ul className="space-y-3">
                  {data.latestOrders.map((row) => (
                    <li key={row.id} className="flex items-center gap-3">
                      {row.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-ved-green-900/10" />
                      ) : (
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600">
                          <AdminIcon name="box" className="h-4 w-4" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ved-green-900">{row.productName}</p>
                        <p className="text-xs text-ved-green-800/55 tabular">{formatInr(row.amount)}</p>
                      </div>
                      <span className={`pill shrink-0 ${ORDER_TONE[row.status]}`}>{row.statusLabel}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Top Locations">
          {data.topLocations.items.length === 0 ? (
            <Empty>No birth places recorded yet.</Empty>
          ) : (
            <>
              <ul className="space-y-3">
                {data.topLocations.items.map((row) => (
                  <li key={row.label}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5 text-ved-green-900">
                        <AdminIcon name="pin" className="h-3.5 w-3.5 shrink-0 text-ved-green-600" />
                        <span className="truncate">{row.label}</span>
                      </span>
                      <span className="tabular text-xs text-ved-green-800/60">{row.pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ved-green-900/[0.06]">
                      <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-600" style={{ width: `${Math.max(2, row.pct)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-ved-green-800/50">Based on {COUNT.format(data.topLocations.basis)} users’ birth places</p>
            </>
          )}
        </Panel>

        {data.revenueTrend && (
          <Panel title="Providers by Category">
            <CategoryDonut slices={categorySlices} total={providerTotal} />
          </Panel>
        )}

        <Panel title="Top Services">
          {data.topServices.length === 0 ? (
            <Empty>No bookings yet.</Empty>
          ) : (
            <ol className="space-y-2.5">
              {data.topServices.map((row, index) => (
                <li key={`${row.kind}-${row.label}`} className="flex items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ved-gold-50 text-xs font-bold text-ved-gold-700">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ved-green-900">{row.label}</p>
                    <p className="text-[11px] text-ved-green-800/55">{row.kind}</p>
                  </div>
                  <span className="tabular text-sm font-semibold text-ved-green-900">{COUNT.format(row.count)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="Recent Activities" className={data.revenueTrend ? '' : 'xl:col-span-2'}>
          {data.recentActivity.length === 0 ? (
            <Empty>Nothing yet.</Empty>
          ) : (
            <ul className="space-y-3">
              {data.recentActivity.map((row, index) => {
                const style = ACTIVITY_ICON[row.kind];
                const text = <span className="line-clamp-2 text-sm text-ved-green-900">{row.text}</span>;
                return (
                  <li key={`${row.kind}-${row.at}-${index}`} className="flex gap-3">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${style.tone}`}>
                      <AdminIcon name={style.icon} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      {row.href ? (
                        <Link href={row.href} className="hover:underline">
                          {text}
                        </Link>
                      ) : (
                        text
                      )}
                      <p className="text-[11px] text-ved-green-800/50">{timeAgo(row.at)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function CategoryDonut({ slices, total }: { slices: DonutSlice[]; total: number }) {
  if (total === 0) return <Empty>No providers yet.</Empty>;
  return (
    <div className="flex flex-col items-center gap-4">
      <Donut slices={slices} size={150} thickness={22}>
        <div>
          <p className="font-display text-2xl font-semibold text-ved-green-900">{COUNT.format(total)}</p>
          <p className="text-[11px] text-ved-green-800/55">Providers</p>
        </div>
      </Donut>
      <ul className="w-full space-y-1.5 text-sm">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
            <span className="min-w-0 flex-1 truncate text-ved-green-800">{slice.label}</span>
            <span className="tabular font-semibold text-ved-green-900">{slice.value}</span>
            <span className="w-11 text-right tabular text-xs text-ved-green-800/55">{((slice.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AdminDashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  return (
    <AdminGate
      toolbar={
        <label className="relative hidden sm:block">
          <span className="sr-only">Dashboard period</span>
          <AdminIcon name="calendar" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ved-green-700" />
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}
            className="appearance-none rounded-full border border-ved-green-900/10 bg-white py-2 pl-9 pr-9 text-sm font-medium text-ved-green-900 hover:bg-ved-cream-50 focus:outline-none focus:ring-2 focus:ring-ved-green-600/20"
          >
            {DASHBOARD_PERIODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <AdminIcon name="chevronDown" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ved-green-800/50" />
        </label>
      }
    >
      <Dashboard period={period} />
    </AdminGate>
  );
}
