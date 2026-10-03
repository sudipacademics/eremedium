'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';

import { ProfileIcon, type ProfileIconName } from '@/components/profile/ProfileIcon';
import { WalletSection, formatDate, formatPhone, inr } from '@/components/WalletPanel';
import {
  ApiError,
  api,
  session,
  type Invoice,
  type OtpRequestResult,
  type UserProfileDetails,
} from '@/lib/api';
import { resizeSquarePhoto } from '@/lib/photo';

const PHOTO_SIZE = 256;
const RECENT_INVOICES = 5;

const ROLE_LABEL: Record<UserProfileDetails['role'], string> = { USER: 'User', ASTROLOGER: 'Astrologer', ADMIN: 'Admin' };

interface NavEntry {
  label: string;
  href: string;
  icon: ProfileIconName;
  /** In-page section this entry scrolls to; drives the active highlight. */
  section?: string;
}

const NAV: readonly NavEntry[] = [
  { label: 'Profile', href: '#details', icon: 'user', section: 'details' },
  { label: 'Wallet', href: '#wallet', icon: 'wallet', section: 'wallet' },
  { label: 'E-Puja Bookings', href: '/pujas', icon: 'temple' },
  { label: 'Consultations', href: '/astrologers', icon: 'consultation' },
  { label: 'Shop Orders', href: '/ayurveda', icon: 'bag' },
  { label: 'Virtual Temple', href: '/temple', icon: 'shrine' },
  { label: 'Downloads', href: '#invoices', icon: 'download', section: 'invoices' },
  { label: 'Notifications', href: '/notifications', icon: 'bell' },
  { label: 'Settings', href: '#security', icon: 'settings', section: 'security' },
];

const SECTIONS = ['details', 'wallet', 'transactions', 'invoices', 'security'];

const QUICK_LINKS: readonly { label: string; blurb: string; href: string; icon: ProfileIconName; tone: string; iconTone: string }[] = [
  { label: 'Wallet', blurb: 'Add money & view transactions', href: '#wallet', icon: 'wallet', tone: 'bg-emerald-50/70 border-emerald-100', iconTone: 'bg-emerald-100 text-emerald-700' },
  { label: 'E-Puja Bookings', blurb: 'Your puja bookings', href: '/pujas', icon: 'temple', tone: 'bg-orange-50/70 border-orange-100', iconTone: 'bg-orange-100 text-orange-600' },
  { label: 'Ayurveda Shop', blurb: 'Your orders & tracking', href: '/ayurveda', icon: 'leaf', tone: 'bg-lime-50/70 border-lime-100', iconTone: 'bg-lime-100 text-lime-700' },
  { label: 'Consultations', blurb: 'Talk to an astrologer', href: '/astrologers', icon: 'consultation', tone: 'bg-sky-50/70 border-sky-100', iconTone: 'bg-sky-100 text-sky-700' },
  { label: 'Virtual Temple', blurb: 'Your darshan & offerings', href: '/temple', icon: 'shrine', tone: 'bg-amber-50/70 border-amber-100', iconTone: 'bg-amber-100 text-amber-700' },
  { label: 'Downloads', blurb: 'Invoices & receipts', href: '#invoices', icon: 'download', tone: 'bg-fuchsia-50/60 border-fuchsia-100', iconTone: 'bg-fuchsia-100 text-fuchsia-700' },
];

function Avatar({ photo, initials, size }: { photo: string | null; initials: string; size: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'h-24 w-24 text-3xl' : 'h-14 w-14 text-xl';
  return photo ? (
    <img src={photo} alt="Profile photo" className={`${box} shrink-0 rounded-full object-cover ring-4 ring-white`} />
  ) : (
    <span className={`${box} grid shrink-0 place-items-center rounded-full bg-ved-green-800 font-semibold text-white ring-4 ring-white`}>{initials}</span>
  );
}

function RolePill({ role }: { role: UserProfileDetails['role'] }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ved-gold-100 px-2.5 py-0.5 text-[11px] font-semibold text-ved-gold-700 ring-1 ring-ved-gold-400/40">
      <span aria-hidden>✦</span> {ROLE_LABEL[role]}
    </span>
  );
}

function Sidebar({ data, initials, active }: { data: UserProfileDetails; initials: string; active: string }) {
  return (
    <aside className="lg:sticky lg:top-20 lg:self-start">
      <div className="profile-card hidden lg:block">
        <div className="flex items-center gap-3">
          <span className="relative">
            <Avatar photo={data.photoDataUrl} initials={initials} size="sm" />
            <span className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-bold text-ved-green-900">{data.name}</p>
            <p className="text-xs text-ved-green-800/60">View &amp; manage your account</p>
            <div className="mt-1.5">
              <RolePill role={data.role} />
            </div>
          </div>
        </div>
      </div>
      <nav aria-label="Account" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:mt-4 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0">
        {NAV.map((entry) => {
          const current = entry.section !== undefined && entry.section === active;
          const className = `flex shrink-0 items-center gap-3 rounded-xl px-4 py-2.5 text-sm transition ${
            current
              ? 'bg-ved-gold-100/80 font-semibold text-ved-green-900 ring-1 ring-ved-gold-400/30'
              : 'bg-white text-ved-green-800/80 ring-1 ring-ved-green-900/[0.06] hover:bg-ved-cream-100 hover:text-ved-green-900 lg:bg-transparent lg:ring-0'
          } ${entry.label === 'Settings' ? 'lg:mt-3' : ''}`;
          const content = (
            <>
              <ProfileIcon name={entry.icon} className={`h-[18px] w-[18px] ${current ? 'text-ved-gold-700' : ''}`} />
              {entry.label}
            </>
          );
          return entry.href.startsWith('#') ? (
            <a key={entry.label} href={entry.href} aria-current={current ? 'true' : undefined} className={className}>
              {content}
            </a>
          ) : (
            <Link key={entry.label} href={entry.href} className={className}>
              {content}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function DetailTile({ icon, label, value, wide }: { icon: ProfileIconName; label: string; value: string | null; wide?: boolean }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl bg-[#FAF7F1] px-4 py-3 ${wide ? 'sm:col-span-2' : ''}`}>
      <ProfileIcon name={icon} className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ved-green-800/70" />
      <div className="min-w-0">
        <p className="text-[11px] text-ved-green-800/55">{label}</p>
        <p className={`break-words text-sm font-medium ${value ? 'text-ved-green-900' : 'text-ved-green-800/40'}`}>{value || 'Not added yet'}</p>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const [data, setData] = useState<UserProfileDetails | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [address, setAddress] = useState('');
  const [gotra, setGotra] = useState('');
  const [dobLocal, setDobLocal] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [active, setActive] = useState('details');
  const fileInput = useRef<HTMLInputElement>(null);
  const scrolledToHash = useRef(false);

  const fillForm = (profile: UserProfileDetails) => {
    setName(profile.name ?? '');
    setEmail(profile.email ?? '');
    setBirthPlace(profile.birthPlace ?? '');
    setAddress(profile.address ?? '');
    setGotra(profile.gotra ?? '');
    setDobLocal(profile.dob ? profile.dob.slice(0, 10) : '');
    setPhoto(profile.photoDataUrl);
  };

  useEffect(() => {
    void api
      .get<UserProfileDetails>('auth/profile')
      .then((profile) => {
        setData(profile);
        fillForm(profile);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load profile'));
  }, []);

  // The page renders a loading state first, so the browser's own #wallet jump finds nothing.
  useEffect(() => {
    if (!data || scrolledToHash.current) return;
    scrolledToHash.current = true;
    const target = window.location.hash.slice(1);
    if (SECTIONS.includes(target)) {
      setActive(target === 'transactions' ? 'wallet' : target);
      document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [data]);

  useEffect(() => {
    if (!data || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id === 'transactions' ? 'wallet' : visible.target.id);
      },
      { rootMargin: '-90px 0px -55% 0px' },
    );
    for (const id of SECTIONS) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [data]);

  async function onPhotoPicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file');
      return;
    }
    try {
      setPhoto(await resizeSquarePhoto(file, PHOTO_SIZE));
      setEditing(true);
      setSaved(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not use that image');
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const dob = dobLocal.trim().length > 0 ? new Date(`${dobLocal}T00:00:00.000Z`).toISOString() : null;
      const updated = await api.patch<UserProfileDetails>('auth/profile', {
        name: name.trim(),
        email: email.trim() || null,
        birthPlace: birthPlace.trim() || null,
        address: address.trim() || null,
        gotra: gotra.trim() || null,
        dob,
        photoDataUrl: photo,
      });
      setData(updated);
      fillForm(updated);
      session.updateProfile({ name: updated.name });
      setSaved(true);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) {
    return <p className="mx-auto max-w-7xl px-4 py-10 text-sm text-ved-green-800/60">Loading profile…</p>;
  }

  const initials = ((data?.name ?? name).trim()[0] ?? data?.phone.slice(-2) ?? 'U').toUpperCase();
  const photoChanged = data !== null && photo !== data.photoDataUrl;

  return (
    <div className="bg-[#FBF9F5]">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:py-8">
        {data && <Sidebar data={data} initials={initials} active={active} />}

        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="font-display text-3xl font-bold text-ved-green-900">Your Profile</h1>
              <p className="mt-1 text-sm text-ved-green-800/60">Manage your personal information and account details</p>
            </div>
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
              <Link href="/" className="text-ved-gold-700 hover:text-ved-gold-600">
                Home
              </Link>
              <ProfileIcon name="chevronRight" className="h-3.5 w-3.5 text-ved-green-800/40" />
              <span className="text-ved-green-900">Profile</span>
            </nav>
          </div>

          {error && <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</p>}
          {saved && <p className="rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">Profile saved.</p>}

          {data && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
              <section id="details" aria-labelledby="details-heading" className="profile-card scroll-mt-24">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="details-heading" className="profile-card-title">
                    Personal Details
                  </h2>
                  {!editing && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setSaved(false);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-ved-green-900/15 px-3.5 py-1.5 text-xs font-semibold text-ved-green-900 hover:bg-ved-cream-100"
                    >
                      <ProfileIcon name="edit" className="h-3.5 w-3.5" /> Edit Profile
                    </button>
                  )}
                </div>

                <div className="mt-5 flex items-center gap-4">
                  <span className="relative">
                    <Avatar photo={photo} initials={initials} size="lg" />
                    <button
                      type="button"
                      aria-label={photo ? 'Change photo' : 'Upload photo'}
                      onClick={() => fileInput.current?.click()}
                      className="absolute bottom-0.5 right-0.5 grid h-7 w-7 place-items-center rounded-full bg-ved-green-700 text-white ring-2 ring-white hover:bg-ved-green-600"
                    >
                      <ProfileIcon name="camera" className="h-3.5 w-3.5" />
                    </button>
                    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void onPhotoPicked(e)} />
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-display text-xl font-bold text-ved-green-900">
                      {data.name} <RolePill role={data.role} />
                    </p>
                    <p className="mt-0.5 text-xs text-ved-green-800/60">Member since {formatDate(data.createdAt)}</p>
                    {photoChanged && (
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ved-gold-700">
                        Save profile to keep the new photo.
                        {photo && (
                          <button type="button" className="font-semibold text-rose-600 hover:underline" onClick={() => setPhoto(data.photoDataUrl)}>
                            Undo
                          </button>
                        )}
                      </p>
                    )}
                    {editing && photo && !photoChanged && (
                      <button type="button" className="mt-1 text-xs font-semibold text-rose-600 hover:underline" onClick={() => setPhoto(null)}>
                        Remove photo
                      </button>
                    )}
                  </div>
                </div>

                {editing ? (
                  <form onSubmit={(e) => void onSave(e)} className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="label" htmlFor="name">
                        Full Name
                      </label>
                      <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
                    </div>
                    <div>
                      <label className="label" htmlFor="dob">
                        Date of Birth
                      </label>
                      <input id="dob" type="date" className="input" value={dobLocal} onChange={(e) => setDobLocal(e.target.value)} />
                    </div>
                    <div>
                      <label className="label" htmlFor="email">
                        Email ID
                      </label>
                      <input
                        id="email"
                        type="email"
                        className="input"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        maxLength={254}
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor="place">
                        Birth Place
                      </label>
                      <input id="place" className="input" value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} placeholder="City, region" />
                    </div>
                    <div>
                      <label className="label" htmlFor="phone">
                        Phone
                      </label>
                      <input id="phone" className="input bg-ved-cream-100" value={data.phone} readOnly />
                    </div>
                    <div>
                      <label className="label" htmlFor="gotra">
                        Gotra
                      </label>
                      <input id="gotra" className="input" value={gotra} onChange={(e) => setGotra(e.target.value)} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label" htmlFor="address">
                        Address
                      </label>
                      <textarea
                        id="address"
                        className="input min-h-[5rem] resize-y"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="House / road, city, state, PIN code"
                        autoComplete="street-address"
                        minLength={5}
                        maxLength={500}
                        rows={3}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <button type="submit" className="btn-primary" disabled={busy}>
                        {busy ? 'Saving…' : 'Save profile'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={busy}
                        onClick={() => {
                          fillForm(data);
                          setEditing(false);
                          setError(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <DetailTile icon="user" label="Full Name" value={data.name} />
                    <DetailTile icon="calendar" label="Date of Birth" value={data.dob ? formatDate(data.dob) : null} />
                    <DetailTile icon="mail" label="Email ID" value={data.email} />
                    <DetailTile icon="pin" label="Birth Place" value={data.birthPlace} />
                    <DetailTile icon="phone" label="Phone" value={formatPhone(data.phone)} />
                    <DetailTile icon="gotra" label="Gotra" value={data.gotra} />
                    <DetailTile icon="home" label="Address" value={data.address} wide />
                  </div>
                )}
              </section>

              <section aria-labelledby="quick-links-heading" className="profile-card self-start">
                <h2 id="quick-links-heading" className="profile-card-title">
                  Quick Links
                </h2>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {QUICK_LINKS.map((link) => {
                    const body: ReactNode = (
                      <>
                        <span className={`grid h-10 w-10 place-items-center rounded-full ${link.iconTone}`}>
                          <ProfileIcon name={link.icon} className="h-5 w-5" />
                        </span>
                        <span className="mt-2.5 block text-sm font-semibold text-ved-green-900">{link.label}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-ved-green-800/60">{link.blurb}</span>
                      </>
                    );
                    const className = `block rounded-2xl border p-3.5 transition hover:-translate-y-0.5 hover:shadow-md ${link.tone}`;
                    return link.href.startsWith('#') ? (
                      <a key={link.label} href={link.href} className={className}>
                        {body}
                      </a>
                    ) : (
                      <Link key={link.label} href={link.href} className={className}>
                        {body}
                      </Link>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {data && <WalletSection />}
          {data && <InvoicesCard />}
          {data && <LoginSecurityCard phone={data.phone} />}
        </div>
      </div>
    </div>
  );
}

function InvoicesCard() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void api
      .get<{ invoices: Invoice[] }>('billing/invoices')
      .then((res) => setInvoices(res.invoices))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load invoices'));
  }, []);

  async function onDownload(invoice: Invoice) {
    setDownloading(invoice.id);
    setError(null);
    try {
      const { blob, filename } = await api.download(`billing/invoices/${encodeURIComponent(invoice.id)}/pdf`, `${invoice.number}.pdf`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  }

  const rows = invoices ? (showAll ? invoices : invoices.slice(0, RECENT_INVOICES)) : [];

  return (
    <section id="invoices" aria-labelledby="invoices-heading" className="profile-card scroll-mt-24">
      <div className="flex items-center justify-between gap-3">
        <h2 id="invoices-heading" className="profile-card-title">
          Downloaded Invoices
        </h2>
        {invoices && invoices.length > RECENT_INVOICES && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="inline-flex items-center gap-1 text-sm font-semibold text-ved-green-900 hover:text-ved-green-600">
            {showAll ? 'Show less' : 'View All'} <ProfileIcon name="arrowRight" className="h-4 w-4" />
          </button>
        )}
      </div>

      {error && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</p>}
      {invoices === null && !error && <p className="mt-4 text-sm text-ved-green-800/60">Loading invoices…</p>}
      {invoices !== null && invoices.length === 0 && (
        <p className="mt-4 rounded-xl bg-ved-cream-100 px-4 py-3 text-sm text-ved-green-800/65">No invoices yet. They appear here after your first payment or booking.</p>
      )}

      {rows.length > 0 && (
        <div className="mt-4">
          <div className="hidden grid-cols-[8rem_minmax(0,1fr)_7rem_9rem] gap-3 rounded-xl bg-[#FAF7F1] px-3 py-2.5 text-xs font-medium text-ved-green-800/65 md:grid">
            <span>Date</span>
            <span>Item</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Action</span>
          </div>
          <ul className="divide-y divide-ved-green-900/[0.06]">
            {rows.map((invoice) => (
              <li key={invoice.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-1 py-3 md:grid-cols-[8rem_minmax(0,1fr)_7rem_9rem] md:px-3">
                <span className="order-3 text-xs text-ved-green-800/60 md:order-none md:text-sm md:text-ved-green-800/80">{formatDate(invoice.issuedAt)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ved-green-900">{invoice.title}</span>
                  <span className="block truncate text-[11px] text-ved-green-800/50">
                    {invoice.number} · {invoice.paymentMethod}
                  </span>
                </span>
                <span className="text-right text-sm font-semibold tabular text-ved-green-900">{inr(invoice.amount)}</span>
                <span className="order-4 text-right md:order-none">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ved-green-900/15 bg-white px-3 py-1.5 text-xs font-semibold text-ved-green-900 hover:bg-ved-cream-100 disabled:opacity-50"
                    disabled={downloading !== null}
                    onClick={() => void onDownload(invoice)}
                  >
                    <ProfileIcon name="download" className="h-3.5 w-3.5" />
                    {downloading === invoice.id ? 'Preparing…' : 'Download PDF'}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type SecurityStep = 'idle' | 'code' | 'done';

function LoginSecurityCard({ phone }: { phone: string }) {
  const [step, setStep] = useState<SecurityStep>('idle');
  const [code, setCode] = useState('');
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const challenge = await api.post<OtpRequestResult>('auth/otp/request', { phone });
      setDebugCode(challenge.debugCode ?? null);
      setCode('');
      setStep('code');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send a code');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ accessToken: string }>('auth/sessions/revoke-others', { code: code.trim() });
      const profile = session.profile;
      if (profile) session.save(result.accessToken, profile);
      setStep('done');
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 401
          ? 'That code is incorrect or has expired.'
          : caught instanceof Error
            ? caught.message
            : 'Could not sign out other devices',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="security" aria-labelledby="security-heading" className="profile-card scroll-mt-24 space-y-4">
      <div>
        <h2 id="security-heading" className="profile-card-title">
          Login &amp; Security
        </h2>
        <p className="mt-1 text-sm text-ved-green-800/60">
          You sign in with your phone number and a one-time SMS code, so there is no password to reset. If you think someone else has access to your
          account, sign out every other device.
        </p>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {step === 'idle' && (
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void sendCode()}>
          {busy ? 'Sending code…' : 'Sign out of all other devices'}
        </button>
      )}

      {step === 'code' && (
        <form onSubmit={(e) => void confirm(e)} className="max-w-sm space-y-3">
          <div>
            <label className="label" htmlFor="security-code">
              Code sent to {phone}
            </label>
            <input
              id="security-code"
              className="input tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{4,8}"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
            />
            {debugCode && <p className="mt-1 text-xs text-ved-green-800/50">Staging code: {debugCode}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary" disabled={busy || code.length < 4}>
              {busy ? 'Signing out…' : 'Confirm'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => {
                setStep('idle');
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {step === 'done' && (
        <p className="rounded-xl bg-ved-green-50 px-4 py-3 text-sm text-ved-green-700">All other devices have been signed out. You are still signed in here.</p>
      )}
    </section>
  );
}
