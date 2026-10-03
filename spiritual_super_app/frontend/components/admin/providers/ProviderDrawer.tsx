'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { AdminIcon } from '@/components/admin/AdminIcon';
import { formatBytes, formatDateTime } from '@/lib/admin-types';
import { api } from '@/lib/api';
import {
  KYC_BADGE,
  SCHEDULE_DAYS,
  isLive,
  platformCommissionPct,
  providerSharePct,
  statusBadge,
  type ProviderDetail,
  type ProviderItem,
} from '@/lib/providers';

import { PayoutPanel } from './Payouts';
import { CloseButton, Pill, ProviderAvatar, SideDrawer, Stars, errorText, ghostButton, inr, primaryButton, shortDate } from './Overlay';
import type { ActionPermissions, ProviderAction } from './ProviderTable';

export type DrawerTab = 'overview' | 'services' | 'schedule' | 'payouts' | 'reviews' | 'history';

const TABS: readonly { value: DrawerTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'services', label: 'Services' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'payouts', label: 'Payouts' },
  { value: 'reviews', label: 'Reviews' },
  { value: 'history', label: 'History' },
];

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-ved-green-900/[0.07] bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ved-green-900">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs font-semibold text-ved-green-700 hover:text-ved-green-900 hover:underline">
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-28 shrink-0 text-ved-green-800/60">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ved-green-900">{children}</dd>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-ved-green-900">{label}</span>
      <span className={`inline-flex items-center gap-1 text-xs font-semibold ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>
        {ok ? <AdminIcon name="check" className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
        {ok ? 'Yes' : 'Pending'}
      </span>
    </li>
  );
}

export function DocumentList({ detail }: { detail: Pick<ProviderDetail, 'documents' | 'joinRequest'> }) {
  const [error, setError] = useState<string | null>(null);
  if (!detail.joinRequest) {
    return <p className="text-sm text-ved-green-800/60">This provider wasn’t created through a join request, so there are no uploaded documents.</p>;
  }
  if (detail.documents.length === 0) return <p className="text-sm text-ved-green-800/60">No documents were uploaded with the application.</p>;
  const open = async (fileId: string) => {
    setError(null);
    const tab = window.open('', '_blank');
    try {
      const { blob } = await api.download(`admin/join-requests/${detail.joinRequest!.id}/files/${fileId}`, 'document');
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      tab?.close();
      setError(errorText(caught, 'Could not open the document'));
    }
  };
  return (
    <div>
      <ul className="divide-y divide-ved-green-900/[0.07] rounded-2xl border border-ved-green-900/[0.07] bg-white">
        {detail.documents.map((file) => (
          <li key={file.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium text-ved-green-900">{file.label ?? file.originalName}</span>
              <span className="text-xs text-ved-green-800/55">
                {file.kind === 'PHOTO' ? 'Photo' : 'Document'} · {formatBytes(file.sizeBytes)}
              </span>
            </span>
            <button type="button" className="shrink-0 text-xs font-semibold text-ved-green-700 hover:underline" onClick={() => void open(file.id)}>
              View
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ved-green-800/55">
        From application{' '}
        <Link href={`/admin/join-requests/${detail.joinRequest.id}`} className="font-semibold text-ved-green-700 hover:underline">
          {detail.joinRequest.applicationNo}
        </Link>
      </p>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

function ScheduleView({ detail }: { detail: ProviderDetail }) {
  if (!detail.weeklySchedule) return <p className="text-sm text-ved-green-800/60">No weekly schedule set.</p>;
  return (
    <ul className="divide-y divide-ved-green-900/[0.07]">
      {SCHEDULE_DAYS.map((day) => {
        const slots = detail.weeklySchedule![day.value];
        return (
          <li key={day.value} className="flex justify-between gap-3 py-2 text-sm">
            <span className="font-medium text-ved-green-900">{day.label}</span>
            <span className={slots.length ? 'text-ved-green-900' : 'text-ved-green-800/45'}>
              {slots.length ? slots.map((slot) => `${slot.start}–${slot.end}`).join(', ') : 'Unavailable'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Reviews({ detail, canManage, onChanged }: { detail: ProviderDetail; canManage: boolean; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (detail.reviews.length === 0) {
    return <p className="text-sm text-ved-green-800/60">No reviews yet. Users are asked to rate each consultation when the call ends.</p>;
  }
  const toggle = async (id: string, hidden: boolean) => {
    setError(null);
    try {
      await api.patch(`admin/providers/${detail.id}/reviews/${id}`, { hidden });
      onChanged();
    } catch (caught) {
      setError(errorText(caught, 'Could not update the review'));
    }
  };
  return (
    <div className="space-y-3">
      {detail.rating !== null && (
        <div className="flex items-center gap-3 rounded-2xl bg-[#f6eed8] px-4 py-3">
          <span className="font-display text-3xl font-semibold text-ved-green-900">{detail.rating.toFixed(1)}</span>
          <span>
            <Stars value={detail.rating} className="h-4 w-4" />
            <span className="block text-xs text-[#7a5a22]">{detail.ratingCount} rating{detail.ratingCount === 1 ? '' : 's'}</span>
          </span>
        </div>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <ul className="space-y-2">
        {detail.reviews.map((review) => (
          <li key={review.id} className={`rounded-2xl border border-ved-green-900/[0.07] bg-white p-3.5 ${review.hidden ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <Stars value={review.rating} />
                <p className="mt-0.5 text-xs text-ved-green-800/60">
                  {review.userName} · {shortDate(review.createdAt)}
                  {review.hidden ? ' · hidden' : ''}
                </p>
              </div>
              {canManage && (
                <button type="button" className="text-xs font-semibold text-ved-green-700 hover:underline" onClick={() => void toggle(review.id, !review.hidden)}>
                  {review.hidden ? 'Show' : 'Hide'}
                </button>
              )}
            </div>
            {review.comment && <p className="mt-2 text-sm text-ved-green-900">{review.comment}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProviderDrawer({
  item,
  initialTab = 'overview',
  version,
  can,
  onClose,
  onAction,
  onEdit,
}: {
  item: ProviderItem;
  initialTab?: DrawerTab;
  version: number;
  can: ActionPermissions;
  onClose: () => void;
  onAction: (action: ProviderAction, item: ProviderItem) => void;
  onEdit: (section: 'profile' | 'expertise' | 'availability' | 'verification') => void;
}) {
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<ProviderDetail>(`admin/providers/${item.id}`)
      .then(setDetail)
      .catch((caught: unknown) => setError(errorText(caught, 'Could not load provider details')));
  }, [item.id]);

  useEffect(load, [load, version]);
  useEffect(() => setTab(initialTab), [initialTab, item.id]);

  const current = detail ?? item;
  const badge = statusBadge(current);
  const kyc = KYC_BADGE[current.kycStatus];

  return (
    <SideDrawer label={`${item.displayName} details`} onClose={onClose}>
      <header className="relative bg-gradient-to-br from-[#08302a] via-[#0b3d34] to-[#06231e] px-5 pb-0 pt-5 sm:px-6">
        <div className="absolute right-3 top-3 [&_button]:text-ved-cream-100 [&_button:hover]:bg-white/10">
          <CloseButton onClick={onClose} />
        </div>
        <div className="flex items-center gap-4 pr-10">
          <ProviderAvatar provider={current} size={76} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-display text-2xl font-semibold text-ved-cream-50">{current.displayName}</h2>
              <Pill tone={badge.tone}>{badge.label}</Pill>
            </div>
            <p className="mt-0.5 text-sm text-[#e3cf9c]">
              {current.categoryLabel} • ID: #{current.code}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ved-cream-100/75">
              {current.rating !== null ? (
                <>
                  <Stars value={current.rating} />
                  <span>
                    {current.rating.toFixed(1)} ({current.ratingCount})
                  </span>
                </>
              ) : (
                <span>No ratings yet</span>
              )}
              <span aria-hidden>•</span>
              <span>Member since {shortDate(current.createdAt)}</span>
            </p>
          </div>
        </div>
        <nav className="scrollbar-none -mx-5 mt-5 flex overflow-x-auto px-3 sm:-mx-6 sm:px-4" aria-label="Provider sections">
          {TABS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-current={tab === entry.value ? 'true' : undefined}
              onClick={() => setTab(entry.value)}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                tab === entry.value ? 'border-[#dcc06c] text-[#f3e3b3]' : 'border-transparent text-ved-cream-100/65 hover:text-ved-cream-50'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        {tab === 'overview' && (
          <>
            <Section title="Basic Information" action={can.manage && <LinkButton onClick={() => onEdit('profile')}>Edit</LinkButton>}>
              <dl>
                <Row label="Full name">{current.displayName}</Row>
                <Row label="Phone">{current.phone}</Row>
                <Row label="Email">{current.email ?? '—'}</Row>
                <Row label="Location">{current.location ?? '—'}</Row>
                <Row label="Languages">{current.languages.join(', ') || '—'}</Row>
                <Row label="Experience">{current.experienceYears === null ? '—' : `${current.experienceYears} years`}</Row>
                <Row label="Member since">{shortDate(current.createdAt)}</Row>
              </dl>
              {detail?.bio && <p className="mt-2 border-t border-ved-green-900/[0.07] pt-2 text-sm text-ved-green-800/80">{detail.bio}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {can.manage && (
                  <button type="button" className={`${ghostButton} px-3 py-1.5 text-xs`} onClick={() => onEdit('profile')}>
                    Change Photo
                  </button>
                )}
                {isLive(current) && (
                  <Link href="/astrologers" target="_blank" className={`${ghostButton} px-3 py-1.5 text-xs`}>
                    View Public Profile
                  </Link>
                )}
              </div>
            </Section>

            <Section title="Expertise & Categories" action={can.manage && <LinkButton onClick={() => onEdit('expertise')}>Edit</LinkButton>}>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full bg-ved-green-800 px-2.5 py-1 text-xs font-medium text-ved-cream-50">{current.categoryLabel}</span>
                {current.expertise.map((tag) => (
                  <span key={tag} className="rounded-full bg-[#f6eed8] px-2.5 py-1 text-xs font-medium text-[#7a5a22]">
                    {tag}
                  </span>
                ))}
                {current.expertise.length === 0 && <span className="text-sm text-ved-green-800/55">No expertise tags yet.</span>}
              </div>
            </Section>

            <Section title="Verification & Status" action={<LinkButton onClick={() => onEdit('verification')}>View Documents</LinkButton>}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-ved-green-900">KYC</span>
                <Pill tone={kyc.tone}>{kyc.label}</Pill>
              </div>
              <ul>
                <Check ok={current.profileApproved} label="Profile approved" />
                <Check ok={current.identityVerified} label="Identity verified" />
              </ul>
              {current.accountStatus === 'SUSPENDED' && <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">Suspended: {current.suspensionReason}</p>}
              {(current.accountStatus === 'DEBOARDING' || current.accountStatus === 'DEBOARDED') && (
                <p className="mt-2 rounded-xl bg-orange-50 px-3 py-2 text-xs text-orange-800">
                  {current.accountStatus === 'DEBOARDING' ? 'Deboarding' : 'Deboarded'} · {current.deboardReason}
                  {current.deboardEffectiveAt ? ` · effective ${shortDate(current.deboardEffectiveAt)}` : ''}
                </p>
              )}
            </Section>

            <Section title="Earnings & Performance" action={<LinkButton onClick={() => setTab('payouts')}>View Payout History</LinkButton>}>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-ved-cream-50 px-2 py-2.5">
                  <p className="text-[11px] text-ved-green-800/60">Total</p>
                  <p className="font-display text-lg font-semibold text-ved-green-900">{inr(current.totalEarnings)}</p>
                </div>
                <div className="rounded-xl bg-ved-cream-50 px-2 py-2.5">
                  <p className="text-[11px] text-ved-green-800/60">This Month</p>
                  <p className="font-display text-lg font-semibold text-ved-green-900">{inr(current.monthEarnings)}</p>
                </div>
                <div className="rounded-xl bg-rose-50 px-2 py-2.5">
                  <p className="text-[11px] text-rose-700/80">Pending</p>
                  <p className="font-display text-lg font-semibold text-rose-600">{inr(current.pendingPayout)}</p>
                </div>
              </div>
              <dl className="mt-3">
                <Row label="Sessions">{current.sessions.toLocaleString('en-IN')}</Row>
                <Row label="Gross revenue">{inr(current.grossRevenue)}</Row>
                <Row label="Rating">{current.rating === null ? 'No ratings yet' : `${current.rating.toFixed(1)} / 5 (${current.ratingCount})`}</Row>
              </dl>
              {can.finance && (
                <button type="button" className={`${primaryButton} mt-3 w-full py-3`} onClick={() => onAction('pay', current)} disabled={Number(current.pendingPayout) <= 0}>
                  <AdminIcon name="rupee" className="h-4 w-4" /> Make Payout
                </button>
              )}
            </Section>

            <Section title="Consultation Details">
              <dl>
                <Row label="Rate">{inr(current.perMinuteRate)} / min</Row>
                <Row label="Commission">
                  Platform {platformCommissionPct(current.commissionSplit)}% · Provider {providerSharePct(current.commissionSplit)}%
                </Row>
              </dl>
              {detail && detail.recentSessions.length > 0 && (
                <ul className="mt-2 divide-y divide-ved-green-900/[0.07] border-t border-ved-green-900/[0.07]">
                  {detail.recentSessions.map((session) => (
                    <li key={session.id} className="flex justify-between gap-2 py-2 text-xs">
                      <span className="text-ved-green-900">
                        {session.userName} · {session.minutes} min
                      </span>
                      <span className="text-ved-green-800/60">
                        {inr(session.amount)} · {shortDate(session.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Availability" action={can.manage && <LinkButton onClick={() => onEdit('availability')}>Manage Schedule</LinkButton>}>
              <div className="flex flex-wrap gap-1.5">
                {SCHEDULE_DAYS.map((day) => {
                  const on = current.availableDays.includes(day.value);
                  return (
                    <span
                      key={day.value}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? 'bg-ved-green-800 text-ved-cream-50' : 'bg-ved-green-900/5 text-ved-green-800/45 line-through'}`}
                    >
                      {day.short}
                    </span>
                  );
                })}
              </div>
              {current.availableDays.length === 0 && <p className="mt-2 text-xs text-ved-green-800/55">No weekly schedule set yet.</p>}
            </Section>

            {can.manage && (
              <Section title="Actions">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <button type="button" className={ghostButton} onClick={() => onAction('edit', current)}>
                    Edit Provider
                  </button>
                  {current.accountStatus === 'ACTIVE' ? (
                    <button type="button" className="rounded-xl px-4 py-2 text-sm font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50" onClick={() => onAction('suspend', current)}>
                      Suspend
                    </button>
                  ) : (
                    <button type="button" className={ghostButton} onClick={() => onAction('reinstate', current)}>
                      Reinstate
                    </button>
                  )}
                  {current.accountStatus !== 'DEBOARDED' && (
                    <button type="button" className="rounded-xl px-4 py-2 text-sm font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50" onClick={() => onAction('deboard', current)}>
                      Deboard
                    </button>
                  )}
                </div>
              </Section>
            )}
          </>
        )}

        {tab === 'services' && (
          <>
            <Section title="Services Offered" action={can.manage && <LinkButton onClick={() => onEdit('expertise')}>Edit</LinkButton>}>
              {current.services.length === 0 ? (
                <p className="text-sm text-ved-green-800/60">No services listed yet.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {current.services.map((service) => (
                    <li key={service} className="flex items-center gap-2 rounded-xl bg-ved-cream-50 px-3 py-2 text-sm text-ved-green-900">
                      <AdminIcon name="check" className="h-4 w-4 text-[#a8782c]" /> {service}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Consultation">
              <dl>
                <Row label="Mode">Voice call (billed per minute)</Row>
                <Row label="Rate">{inr(current.perMinuteRate)} / min</Row>
                <Row label="Languages">{current.languages.join(', ')}</Row>
              </dl>
            </Section>
          </>
        )}

        {tab === 'schedule' && (
          <Section title="Weekly Schedule (IST)" action={can.manage && <LinkButton onClick={() => onEdit('availability')}>Manage Schedule</LinkButton>}>
            {detail ? <ScheduleView detail={detail} /> : <p className="text-sm text-ved-green-800/60">Loading…</p>}
          </Section>
        )}

        {tab === 'payouts' && <PayoutPanel provider={current} canFinance={can.finance} onPay={() => onAction('pay', current)} refreshKey={version} />}

        {tab === 'reviews' && (detail ? <Reviews detail={detail} canManage={can.manage} onChanged={load} /> : <p className="text-sm text-ved-green-800/60">Loading…</p>)}

        {tab === 'history' &&
          (detail ? (
            detail.history.length === 0 ? (
              <p className="text-sm text-ved-green-800/60">No admin actions recorded for this provider yet.</p>
            ) : (
              <ol className="relative space-y-3 border-l border-ved-green-900/10 pl-5">
                {detail.history.map((entry) => (
                  <li key={entry.id} className="relative">
                    <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-[#c9a24a] ring-4 ring-[#FBF9F4]" />
                    <p className="text-sm text-ved-green-900">{entry.summary}</p>
                    <p className="text-xs text-ved-green-800/55">
                      {formatDateTime(entry.createdAt)} · {entry.actorPhone ?? 'system'}
                      {entry.actorRole ? ` (${entry.actorRole.replace(/_/g, ' ').toLowerCase()})` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )
          ) : (
            <p className="text-sm text-ved-green-800/60">Loading…</p>
          ))}
      </div>
    </SideDrawer>
  );
}
