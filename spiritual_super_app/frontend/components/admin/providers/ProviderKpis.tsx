import Link from 'next/link';
import type { ReactNode } from 'react';

import { AdminIcon } from '@/components/admin/AdminIcon';
import type { ProviderKpis as Kpis } from '@/lib/providers';

import { inr } from './Overlay';

function Change({ pct, suffix = 'from last month' }: { pct: number | null; suffix?: string }) {
  if (pct === null) return <span className="text-ved-green-800/55">No data for last month</span>;
  const up = pct >= 0;
  return (
    <span className={up ? 'text-emerald-700' : 'text-rose-600'}>
      {up ? '↑' : '↓'} {Math.abs(pct)}% <span className="text-ved-green-800/55">{suffix}</span>
    </span>
  );
}

function Card({ icon, tint, label, value, footer, href }: { icon: ReactNode; tint: string; label: string; value: string; footer: ReactNode; href?: string }) {
  const body = (
    <>
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${tint}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ved-green-800/70">{label}</span>
        <span className="mt-0.5 block font-display text-[1.7rem] font-semibold leading-tight text-ved-green-900 tabular-nums">{value}</span>
        <span className="mt-1 block truncate text-xs">{footer}</span>
      </span>
    </>
  );
  const className =
    'flex items-center gap-3.5 rounded-2xl border border-ved-green-900/[0.07] bg-white p-4 shadow-[0_1px_2px_rgba(6,35,30,0.04)] transition';
  return href ? (
    <Link href={href} className={`${className} hover:border-[#c9a24a]/50 hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function ProviderKpis({ kpis }: { kpis: Kpis }) {
  return (
    <section aria-label="Provider summary" className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      <Card
        icon={<AdminIcon name="providers" className="h-6 w-6" />}
        tint="bg-ved-green-50 text-ved-green-800"
        label="Total Providers"
        value={kpis.totalProviders.value.toLocaleString('en-IN')}
        footer={<Change pct={kpis.totalProviders.changePct} />}
      />
      <Card
        icon={
          <span className="relative">
            <AdminIcon name="live" className="h-6 w-6" />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500 ring-2 ring-emerald-50" />
          </span>
        }
        tint="bg-emerald-50 text-emerald-700"
        label="Online Now"
        value={kpis.onlineNow.value.toLocaleString('en-IN')}
        footer={<span className="text-ved-green-800/60">Available for consultations</span>}
      />
      <Card
        icon={<AdminIcon name="roles" className="h-6 w-6" />}
        tint="bg-amber-50 text-amber-700"
        label="Pending KYC"
        value={kpis.pendingKyc.value.toLocaleString('en-IN')}
        footer={<span className="text-ved-green-800/60">Awaiting verification</span>}
      />
      <Card
        href="/admin/join-requests"
        icon={<AdminIcon name="userPlus" className="h-6 w-6" />}
        tint="bg-violet-50 text-violet-700"
        label="Join Requests"
        value={kpis.joinRequests.value.toLocaleString('en-IN')}
        footer={<span className="text-ved-green-800/60">{kpis.joinRequests.newThisMonth} new this month</span>}
      />
      <Card
        icon={<AdminIcon name="rupee" className="h-6 w-6" />}
        tint="bg-[#f6eed8] text-[#a8782c]"
        label="Total Payout (This Month)"
        value={inr(kpis.payoutThisMonth.value)}
        footer={<Change pct={kpis.payoutThisMonth.changePct} />}
      />
    </section>
  );
}
