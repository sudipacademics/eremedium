'use client';

import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react';

import { PROVIDER_CATEGORIES, type ProviderCategory } from '@/lib/admin-types';
import { api } from '@/lib/api';
import { resizeSquarePhoto } from '@/lib/photo';
import {
  KYC_BADGE,
  SCHEDULE_DAYS,
  emptySchedule,
  statusBadge,
  type ProviderDetail,
  type ProviderKycStatus,
  type ScheduleDay,
  type WeeklySchedule,
} from '@/lib/providers';

import { DocumentList } from './ProviderDrawer';
import { Modal, Pill, ProviderAvatar, errorText, ghostButton, inputClass, labelClass, primaryButton } from './Overlay';
import type { ProviderAction } from './ProviderTable';

export type EditSection = 'profile' | 'expertise' | 'rates' | 'availability' | 'verification' | 'account';

const SECTIONS: readonly { value: EditSection; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'expertise', label: 'Expertise & Services' },
  { value: 'rates', label: 'Rates' },
  { value: 'availability', label: 'Availability' },
  { value: 'verification', label: 'Documents & KYC' },
  { value: 'account', label: 'Account Status' },
];

function TagInput({ label, values, onChange, max, placeholder }: { label: string; values: string[]; onChange: (next: string[]) => void; max: number; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length >= 2);
    const next = [...values];
    for (const part of parts) if (!next.some((value) => value.toLowerCase() === part.toLowerCase()) && next.length < max) next.push(part);
    onChange(next);
    setDraft('');
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <div>
      <span className={labelClass}>
        {label} <span className="font-normal normal-case tracking-normal text-ved-green-800/50">({values.length}/{max})</span>
      </span>
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-ved-green-900/15 bg-white p-2 focus-within:border-ved-green-600/50 focus-within:ring-2 focus-within:ring-ved-green-600/15">
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-1 rounded-full bg-ved-green-50 px-2.5 py-1 text-xs font-medium text-ved-green-800">
            {value}
            <button type="button" aria-label={`Remove ${value}`} className="text-ved-green-800/60 hover:text-rose-600" onClick={() => onChange(values.filter((v) => v !== value))}>
              ×
            </button>
          </span>
        ))}
        <input
          className="min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-ved-green-900 outline-none placeholder:text-ved-green-800/40"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={values.length >= max ? 'Limit reached' : placeholder}
          disabled={values.length >= max}
        />
      </div>
    </div>
  );
}

const timeClass =
  'w-32 rounded-xl border border-ved-green-900/15 bg-white px-3 py-1.5 text-sm text-ved-green-900 outline-none focus:border-ved-green-600/50 focus:ring-2 focus:ring-ved-green-600/15';

export function ScheduleEditor({ value, onChange }: { value: WeeklySchedule; onChange: (next: WeeklySchedule) => void }) {
  const setDay = (day: ScheduleDay, slots: WeeklySchedule[ScheduleDay]) => onChange({ ...value, [day]: slots });
  const copyMonday = () => {
    const monday = value.mon;
    onChange({ ...value, tue: monday, wed: monday, thu: monday, fri: monday });
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ved-green-800/60">Times are in IST. Shown to staff and used for planning; providers still go online themselves.</p>
        <button type="button" className="text-xs font-semibold text-ved-green-700 hover:underline" onClick={copyMonday}>
          Copy Monday to weekdays
        </button>
      </div>
      {SCHEDULE_DAYS.map((day) => {
        const slots = value[day.value];
        const on = slots.length > 0;
        return (
          <div key={day.value} className="flex flex-wrap items-start gap-3 rounded-2xl border border-ved-green-900/[0.08] bg-white px-3 py-2.5">
            <label className="flex w-28 shrink-0 items-center gap-2 pt-1.5 text-sm font-medium text-ved-green-900">
              <input
                type="checkbox"
                className="h-4 w-4 accent-ved-green-800"
                checked={on}
                onChange={(e) => setDay(day.value, e.target.checked ? [{ start: '09:00', end: '18:00' }] : [])}
              />
              {day.label}
            </label>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {on ? (
                slots.map((slot, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2 text-sm">
                    <input
                      type="time"
                      aria-label={`${day.label} slot ${index + 1} start`}
                      className={timeClass}
                      value={slot.start}
                      onChange={(e) => setDay(day.value, slots.map((s, i) => (i === index ? { ...s, start: e.target.value } : s)))}
                    />
                    <span className="text-ved-green-800/60">to</span>
                    <input
                      type="time"
                      aria-label={`${day.label} slot ${index + 1} end`}
                      className={timeClass}
                      value={slot.end}
                      onChange={(e) => setDay(day.value, slots.map((s, i) => (i === index ? { ...s, end: e.target.value } : s)))}
                    />
                    <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => setDay(day.value, slots.filter((_, i) => i !== index))}>
                      Remove
                    </button>
                  </div>
                ))
              ) : (
                <span className="pt-1.5 text-sm text-ved-green-800/50">Unavailable</span>
              )}
              {on && slots.length < 4 && (
                <button
                  type="button"
                  className="self-start text-xs font-semibold text-ved-green-700 hover:underline"
                  onClick={() => setDay(day.value, [...slots, { start: slots.at(-1)?.end ?? '09:00', end: '20:00' }])}
                >
                  + Add slot
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function scheduleError(schedule: WeeklySchedule): string | null {
  for (const day of SCHEDULE_DAYS) {
    const sorted = [...schedule[day.value]].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < sorted.length; i += 1) {
      if (!sorted[i]!.start || !sorted[i]!.end || sorted[i]!.start >= sorted[i]!.end) return `${day.label}: each slot must end after it starts`;
      if (i > 0 && sorted[i - 1]!.end > sorted[i]!.start) return `${day.label}: slots overlap`;
    }
  }
  return null;
}

interface Draft {
  displayName: string;
  category: ProviderCategory;
  bio: string;
  languages: string[];
  expertise: string[];
  services: string[];
  experienceYears: string;
  perMinuteRate: string;
  platformPct: string;
  schedule: WeeklySchedule;
  kycStatus: ProviderKycStatus;
  identityVerified: boolean;
  profileApproved: boolean;
}

function draftFrom(detail: ProviderDetail): Draft {
  return {
    displayName: detail.displayName,
    category: detail.category,
    bio: detail.bio ?? '',
    languages: detail.languages,
    expertise: detail.expertise,
    services: detail.services,
    experienceYears: detail.experienceYears === null ? '' : String(detail.experienceYears),
    perMinuteRate: detail.perMinuteRate,
    platformPct: String(Math.round((1 - Number(detail.commissionSplit)) * 10000) / 100),
    schedule: detail.weeklySchedule ?? emptySchedule(),
    kycStatus: detail.kycStatus,
    identityVerified: detail.identityVerified,
    profileApproved: detail.profileApproved,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only fields that changed are sent, so the audit entry names exactly what was edited. */
export function diffDraft(detail: ProviderDetail, draft: Draft): Record<string, unknown> {
  const base = draftFrom(detail);
  const body: Record<string, unknown> = {};
  if (draft.displayName.trim() !== base.displayName) body.displayName = draft.displayName.trim();
  if (draft.category !== base.category) body.category = draft.category;
  if (draft.bio.trim() !== base.bio.trim()) body.bio = draft.bio.trim() || null;
  if (!same(draft.languages, base.languages)) body.languages = draft.languages;
  if (!same(draft.expertise, base.expertise)) body.expertise = draft.expertise;
  if (!same(draft.services, base.services)) body.services = draft.services;
  if (draft.experienceYears.trim() !== base.experienceYears) body.experienceYears = draft.experienceYears.trim() === '' ? null : Number(draft.experienceYears);
  if (Number(draft.perMinuteRate) !== Number(base.perMinuteRate)) body.perMinuteRate = draft.perMinuteRate.trim();
  if (Number(draft.platformPct) !== Number(base.platformPct)) body.commissionSplit = ((100 - Number(draft.platformPct)) / 100).toFixed(4);
  if (!same(draft.schedule, base.schedule)) body.weeklySchedule = SCHEDULE_DAYS.some((d) => draft.schedule[d.value].length > 0) ? draft.schedule : null;
  if (draft.kycStatus !== base.kycStatus) body.kycStatus = draft.kycStatus;
  if (draft.identityVerified !== base.identityVerified) body.identityVerified = draft.identityVerified;
  if (draft.profileApproved !== base.profileApproved) body.profileApproved = draft.profileApproved;
  return body;
}

export function EditProviderDialog({
  providerId,
  initialSection = 'profile',
  canManage,
  onClose,
  onSaved,
  onAction,
}: {
  providerId: string;
  initialSection?: EditSection;
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onAction: (action: ProviderAction) => void;
}) {
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [section, setSection] = useState<EditSection>(initialSection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    api
      .get<ProviderDetail>(`admin/providers/${providerId}`)
      .then((next) => {
        setDetail(next);
        setDraft(draftFrom(next));
      })
      .catch((caught: unknown) => setError(errorText(caught, 'Could not load provider')));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => (current ? { ...current, [key]: value } : current));

  const validation = (() => {
    if (!draft) return null;
    if (draft.displayName.trim().length < 2) return 'Name must be at least 2 characters';
    if (draft.languages.length === 0) return 'Add at least one language';
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(draft.perMinuteRate.trim())) return 'Rate must be an amount like 25 or 25.50';
    const pct = Number(draft.platformPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return 'Platform commission must be between 0 and 100%';
    if (draft.experienceYears.trim() && !/^\d{1,2}$/.test(draft.experienceYears.trim())) return 'Experience must be 0–80 years';
    return scheduleError(draft.schedule);
  })();

  const changes = detail && draft ? diffDraft(detail, draft) : {};
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    if (!detail || !dirty || validation) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`admin/providers/${providerId}`, changes);
      onSaved(`${draft!.displayName.trim()} updated`);
    } catch (caught) {
      setError(errorText(caught, 'Could not save changes'));
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const photoDataUrl = await resizeSquarePhoto(file, 320, 0.82);
      await api.patch(`admin/providers/${providerId}`, { photoDataUrl });
      setNotice('Photo updated');
      await load();
    } catch (caught) {
      setError(errorText(caught, 'Photo upload failed'));
    }
  };

  const setPresence = async (online: boolean) => {
    setError(null);
    try {
      await api.patch(`astrologers/admin/${providerId}`, { online });
      setNotice(online ? 'Provider is now online' : 'Provider is now offline');
      await load();
    } catch (caught) {
      setError(errorText(caught, 'Availability update failed'));
    }
  };

  return (
    <Modal
      title="Edit provider"
      subtitle={detail ? `${detail.displayName} · ID #${detail.code}` : undefined}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {validation && <span className="mr-auto self-center text-xs text-rose-600">{validation}</span>}
          <button type="button" className={ghostButton} onClick={onClose}>
            {dirty ? 'Discard' : 'Close'}
          </button>
          <button type="button" className={primaryButton} onClick={() => void save()} disabled={busy || !dirty || Boolean(validation) || !canManage}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      {!draft || !detail ? (
        <p className="text-sm text-ved-green-800/60">{error ?? 'Loading…'}</p>
      ) : (
        <div className="space-y-5">
          <nav className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1" aria-label="Edit sections">
            {SECTIONS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                aria-current={section === entry.value ? 'true' : undefined}
                onClick={() => setSection(entry.value)}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  section === entry.value ? 'bg-ved-green-800 text-ved-cream-50' : 'text-ved-green-800 hover:bg-ved-green-900/5'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

          {section === 'profile' && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <ProviderAvatar provider={detail} size={72} />
                <div className="flex flex-wrap gap-2">
                  <label className={`${ghostButton} cursor-pointer`}>
                    Change photo
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void onPhoto(e)} />
                  </label>
                  {detail.photoVersion && (
                    <button
                      type="button"
                      className="text-sm text-rose-600 hover:underline"
                      onClick={() =>
                        void api
                          .patch(`admin/providers/${providerId}`, { photoDataUrl: null })
                          .then(() => {
                            setNotice('Photo removed');
                            return load();
                          })
                          .catch((caught: unknown) => setError(errorText(caught, 'Could not remove photo')))
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className={labelClass}>Display name</span>
                  <input className={inputClass} value={draft.displayName} onChange={(e) => set('displayName', e.target.value)} maxLength={160} />
                </label>
                <label className="block">
                  <span className={labelClass}>Category</span>
                  <select className={inputClass} value={draft.category} onChange={(e) => set('category', e.target.value as ProviderCategory)}>
                    {PROVIDER_CATEGORIES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={labelClass}>Experience (years)</span>
                  <input className={inputClass} inputMode="numeric" value={draft.experienceYears} onChange={(e) => set('experienceYears', e.target.value.replace(/\D/g, '').slice(0, 2))} />
                </label>
                <div>
                  <span className={labelClass}>Contact</span>
                  <p className="rounded-xl border border-ved-green-900/10 bg-ved-cream-50/60 px-3 py-2 text-sm text-ved-green-800/80">
                    {detail.phone}
                    {detail.email ? ` · ${detail.email}` : ''}
                  </p>
                </div>
              </div>
              <TagInput label="Languages" values={draft.languages} onChange={(v) => set('languages', v)} max={10} placeholder="Type a language and press Enter" />
              <label className="block">
                <span className={labelClass}>Bio</span>
                <textarea className={`${inputClass} min-h-28`} value={draft.bio} onChange={(e) => set('bio', e.target.value)} maxLength={2000} placeholder="A short introduction shown on the profile" />
              </label>
            </div>
          )}

          {section === 'expertise' && (
            <div className="space-y-4">
              <TagInput label="Expertise" values={draft.expertise} onChange={(v) => set('expertise', v)} max={8} placeholder="e.g. Vedic Astrology" />
              <TagInput label="Services offered" values={draft.services} onChange={(v) => set('services', v)} max={12} placeholder="e.g. Kundali Matching" />
            </div>
          )}

          {section === 'rates' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Consultation rate (₹ per minute)</span>
                <input className={inputClass} inputMode="decimal" value={draft.perMinuteRate} onChange={(e) => set('perMinuteRate', e.target.value.trim())} />
              </label>
              <label className="block">
                <span className={labelClass}>Platform commission (%)</span>
                <input className={inputClass} inputMode="decimal" value={draft.platformPct} onChange={(e) => set('platformPct', e.target.value.trim())} />
                <span className="mt-1 block text-xs text-ved-green-800/60">
                  Provider receives {Number.isFinite(Number(draft.platformPct)) ? Math.round((100 - Number(draft.platformPct)) * 100) / 100 : '—'}% of each billed minute.
                </span>
              </label>
              <p className="text-xs text-ved-green-800/60 sm:col-span-2">Changes apply to future billed minutes only; past earnings keep the rate they were billed at.</p>
            </div>
          )}

          {section === 'availability' && <ScheduleEditor value={draft.schedule} onChange={(v) => set('schedule', v)} />}

          {section === 'verification' && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className={labelClass}>KYC status</span>
                  <select className={inputClass} value={draft.kycStatus} onChange={(e) => set('kycStatus', e.target.value as ProviderKycStatus)}>
                    {(Object.keys(KYC_BADGE) as ProviderKycStatus[]).map((status) => (
                      <option key={status} value={status}>
                        {KYC_BADGE[status].label.replace('KYC ', '')}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 pt-6 text-sm text-ved-green-900">
                  <input type="checkbox" className="h-4 w-4 accent-ved-green-800" checked={draft.identityVerified} onChange={(e) => set('identityVerified', e.target.checked)} />
                  Identity verified
                </label>
                <label className="flex items-center gap-2 pt-6 text-sm text-ved-green-900">
                  <input type="checkbox" className="h-4 w-4 accent-ved-green-800" checked={draft.profileApproved} onChange={(e) => set('profileApproved', e.target.checked)} />
                  Profile approved
                </label>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-ved-green-900">Documents</h3>
                <DocumentList detail={detail} />
              </div>
            </div>
          )}

          {section === 'account' && (
            <div className="space-y-4 text-sm text-ved-green-900">
              <div className="flex flex-wrap items-center gap-2">
                <span>Current status:</span>
                <Pill tone={statusBadge(detail).tone}>{statusBadge(detail).label}</Pill>
              </div>
              {detail.accountStatus === 'SUSPENDED' && <p className="text-ved-green-800/70">Suspended: {detail.suspensionReason}</p>}
              {(detail.accountStatus === 'DEBOARDING' || detail.accountStatus === 'DEBOARDED') && (
                <p className="text-ved-green-800/70">
                  {detail.deboardReason} · effective {detail.deboardEffectiveAt ? new Date(detail.deboardEffectiveAt).toLocaleDateString('en-IN') : '—'}
                </p>
              )}
              {(detail.accountStatus === 'ACTIVE' || detail.accountStatus === 'DEBOARDING') && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={ghostButton} disabled={detail.presence !== 'OFFLINE'} onClick={() => void setPresence(true)}>
                    Set online
                  </button>
                  <button type="button" className={ghostButton} disabled={detail.presence !== 'IDLE'} onClick={() => void setPresence(false)}>
                    Set offline
                  </button>
                </div>
              )}
              <div className="flex flex-wrap gap-2 border-t border-ved-green-900/10 pt-4">
                {detail.accountStatus === 'ACTIVE' ? (
                  <button type="button" className="rounded-xl px-4 py-2 text-sm font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50" onClick={() => onAction('suspend')}>
                    Suspend provider
                  </button>
                ) : (
                  <button type="button" className={primaryButton} onClick={() => onAction('reinstate')}>
                    {detail.accountStatus === 'SUSPENDED' ? 'Lift suspension' : 'Reinstate provider'}
                  </button>
                )}
                {detail.accountStatus !== 'DEBOARDED' && (
                  <button type="button" className="rounded-xl px-4 py-2 text-sm font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50" onClick={() => onAction('deboard')}>
                    Deboard provider
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
