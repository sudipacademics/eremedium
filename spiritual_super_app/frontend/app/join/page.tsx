'use client';

import Link from 'next/link';
import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';

import { TagInput } from '@/components/join/TagInput';
import { PROVIDER_CATEGORIES, type ProviderCategory } from '@/lib/admin-types';
import { ApiError, api, session } from '@/lib/api';
import {
  DOCUMENT_LABELS,
  EXPERTISE_SUGGESTIONS,
  LANGUAGE_SUGGESTIONS,
  MAX_DOCUMENTS,
  SERVICE_SUGGESTIONS,
  prepareDocument,
  type PreparedDocument,
} from '@/lib/join';
import { resizeSquarePhoto } from '@/lib/photo';

interface SubmitResult {
  applicationNo: string;
  statusLabel: string;
  submittedAt: string;
}

interface FormState {
  name: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  address: string;
  city: string;
  state: string;
  category: ProviderCategory | '';
  categoryOther: string;
  experienceYears: string;
  qualification: string;
  about: string;
}

const INITIAL: FormState = {
  name: '',
  phone: '',
  email: '',
  dateOfBirth: '',
  address: '',
  city: '',
  state: '',
  category: '',
  categoryOther: '',
  experienceYears: '',
  qualification: '',
  about: '',
};

function Section({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  return (
    <section className="card space-y-4 sm:p-7">
      <h2 className="flex items-center gap-3 font-display text-2xl font-semibold text-ved-green-900">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-ved-gold-400 font-sans text-sm font-bold text-ved-green-950">{step}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function errorMessage(caught: unknown): string {
  if (caught instanceof ApiError) {
    const body = caught.body as { issues?: { path: string; message: string }[] } | undefined;
    if (body?.issues?.length) return body.issues.map((issue) => issue.message).join(' · ');
    return caught.message;
  }
  return caught instanceof Error ? caught.message : 'Something went wrong. Please try again.';
}

export default function JoinPage() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [expertise, setExpertise] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [photo, setPhoto] = useState<{ name: string; dataUrl: string } | null>(null);
  const [documents, setDocuments] = useState<PreparedDocument[]>([]);
  const [docLabel, setDocLabel] = useState<string>(DOCUMENT_LABELS[0]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const profile = session.profile;
    if (profile) {
      setForm((current) => ({
        ...current,
        name: current.name || (profile.name && profile.name !== 'Devotee' ? profile.name : ''),
        phone: current.phone || profile.phone,
      }));
    }
  }, []);

  const set = (key: keyof FormState) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function onPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Profile photo must be an image (JPG, PNG or WebP).');
      return;
    }
    try {
      setPhoto({ name: file.name, dataUrl: await resizeSquarePhoto(file, 480, 0.86) });
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function onDocuments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    const room = MAX_DOCUMENTS - documents.length;
    if (files.length > room) {
      setError(`You can attach up to ${MAX_DOCUMENTS} documents.`);
    }
    try {
      const prepared = await Promise.all(files.slice(0, room).map((file) => prepareDocument(file, docLabel)));
      setDocuments((current) => [...current, ...prepared]);
      if (files.length <= room) setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!form.category) return setError('Choose your professional category.');
    if (expertise.length === 0) return setError('Add at least one area of expertise.');
    if (languages.length === 0) return setError('Add at least one language.');
    if (services.length === 0) return setError('Add at least one service you offer.');
    if (!photo) return setError('Add a profile photo.');
    if (documents.length === 0) return setError('Attach at least one supporting document (for example an ID proof or certificate).');

    setSubmitting(true);
    try {
      const created = await api.post<SubmitResult>('join-requests', {
        name: form.name,
        phone: form.phone,
        email: form.email,
        dateOfBirth: form.dateOfBirth,
        address: form.address,
        city: form.city,
        state: form.state,
        category: form.category,
        ...(form.category === 'OTHER' ? { categoryOther: form.categoryOther } : {}),
        expertise,
        experienceYears: Number(form.experienceYears),
        languages,
        qualification: form.qualification,
        about: form.about,
        services,
        photo,
        documents: documents.map(({ name, label, dataUrl }) => ({ name, label, dataUrl })),
      });
      setResult(created);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="card space-y-5 text-center sm:p-10" role="status">
          <span aria-hidden className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ved-green-50 text-3xl text-ved-green-700 ring-1 ring-ved-green-600/20">
            ✓
          </span>
          <h1 className="font-display text-4xl font-semibold text-ved-green-900">Application submitted</h1>
          <p className="text-ved-green-800/80">
            Thank you for applying to join Vedsutra. Our team will review your details and documents, and we will notify you by email and in the
            app at every step.
          </p>
          <div className="rounded-2xl bg-ved-cream-100 px-5 py-4 ring-1 ring-ved-gold-400/40">
            <p className="text-xs uppercase tracking-[0.2em] text-ved-gold-600">Your application ID</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-ved-green-900">{result.applicationNo}</p>
            <button
              type="button"
              className="mt-2 text-sm font-medium text-ved-green-700 underline"
              onClick={() => {
                void navigator.clipboard?.writeText(result.applicationNo).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy ID'}
            </button>
          </div>
          <p className="text-sm text-ved-green-800/70">Keep this ID with your mobile number to check your application status anytime.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href={`/join/status?application=${encodeURIComponent(result.applicationNo)}`} className="btn-primary">
              Track application
            </Link>
            <Link href="/" className="btn-ghost">
              Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const category = form.category || 'OTHER';

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16">
      <header className="relative my-8 overflow-hidden rounded-[2rem] bg-gradient-to-br from-ved-green-900 via-ved-green-800 to-ved-green-700 px-6 py-10 text-white shadow-lg sm:px-10">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-ved-gold-400/20 blur-3xl" />
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-ved-gold-300">Join a purpose beyond profession</p>
        <h1 className="mt-2 font-display text-5xl font-semibold">
          Join <span className="text-ved-gold-400">Us</span> as an Expert
        </h1>
        <p className="mt-3 max-w-2xl text-white/80">
          Astrologers, Numerologists, Vastu Experts, Ayurveda Experts, Pandits and Spiritual Guides — share Vedic wisdom with thousands of
          seekers on a trusted platform.
        </p>
        <p className="mt-4 text-sm text-white/70">
          Already applied?{' '}
          <Link href="/join/status" className="font-semibold text-ved-gold-300 underline">
            Check your application status
          </Link>
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-6" noValidate={false}>
        <Section step={1} title="Personal details">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="join-name">
                Full name
              </label>
              <input id="join-name" className="input" required minLength={2} maxLength={160} value={form.name} onChange={set('name')} autoComplete="name" />
            </div>
            <div>
              <label className="label" htmlFor="join-phone">
                Mobile number
              </label>
              <input
                id="join-phone"
                className="input"
                required
                inputMode="tel"
                placeholder="+91 98xxxxxxxx"
                value={form.phone}
                onChange={set('phone')}
                autoComplete="tel"
              />
            </div>
            <div>
              <label className="label" htmlFor="join-email">
                Email
              </label>
              <input id="join-email" type="email" className="input" required value={form.email} onChange={set('email')} autoComplete="email" />
            </div>
            <div>
              <label className="label" htmlFor="join-dob">
                Date of birth
              </label>
              <input id="join-dob" type="date" className="input" required value={form.dateOfBirth} onChange={set('dateOfBirth')} />
            </div>
            <div>
              <span className="label">Profile photo</span>
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-ved-cream-200 ring-2 ring-ved-gold-400/50">
                  {photo && (
                    // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
                    <img src={photo.dataUrl} alt="Profile photo preview" className="h-full w-full object-cover" />
                  )}
                </div>
                <label className="btn-ghost cursor-pointer">
                  {photo ? 'Change photo' : 'Upload photo'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void onPhoto(e)} />
                </label>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="join-address">
                Address
              </label>
              <textarea
                id="join-address"
                className="input min-h-[80px]"
                required
                minLength={5}
                maxLength={500}
                value={form.address}
                onChange={set('address')}
                autoComplete="street-address"
              />
            </div>
            <div>
              <label className="label" htmlFor="join-city">
                City
              </label>
              <input id="join-city" className="input" required value={form.city} onChange={set('city')} autoComplete="address-level2" />
            </div>
            <div>
              <label className="label" htmlFor="join-state">
                State
              </label>
              <input id="join-state" className="input" required value={form.state} onChange={set('state')} autoComplete="address-level1" />
            </div>
          </div>
        </Section>

        <Section step={2} title="Professional profile">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="join-category">
                Professional category
              </label>
              <select id="join-category" className="input" required value={form.category} onChange={set('category')}>
                <option value="">Choose…</option>
                {PROVIDER_CATEGORIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="join-experience">
                Experience (years)
              </label>
              <input
                id="join-experience"
                type="number"
                min={0}
                max={80}
                className="input"
                required
                value={form.experienceYears}
                onChange={set('experienceYears')}
              />
            </div>
            {form.category === 'OTHER' && (
              <div className="sm:col-span-2">
                <label className="label" htmlFor="join-category-other">
                  Describe your category
                </label>
                <input id="join-category-other" className="input" required maxLength={80} value={form.categoryOther} onChange={set('categoryOther')} />
              </div>
            )}
            <div className="sm:col-span-2">
              <TagInput
                label="Expertise"
                values={expertise}
                onChange={setExpertise}
                suggestions={EXPERTISE_SUGGESTIONS[category]}
                placeholder="Type and press Enter"
                max={12}
              />
            </div>
            <div className="sm:col-span-2">
              <TagInput label="Languages" values={languages} onChange={setLanguages} suggestions={LANGUAGE_SUGGESTIONS} placeholder="e.g. Hindi" max={10} />
            </div>
            <div className="sm:col-span-2">
              <TagInput
                label="Services offered"
                values={services}
                onChange={setServices}
                suggestions={SERVICE_SUGGESTIONS[category]}
                placeholder="e.g. Call consultation"
                max={15}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="join-qualification">
                Qualification / certification
              </label>
              <input
                id="join-qualification"
                className="input"
                required
                maxLength={500}
                placeholder="e.g. Jyotish Acharya, BAMS, Vastu certification"
                value={form.qualification}
                onChange={set('qualification')}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="join-about">
                About / introduction
              </label>
              <textarea
                id="join-about"
                className="input min-h-[140px]"
                required
                minLength={30}
                maxLength={3000}
                placeholder="Your journey, approach and what seekers can expect from you"
                value={form.about}
                onChange={set('about')}
              />
              <p className="mt-1 text-right text-xs text-ved-green-800/50">{form.about.length}/3000</p>
            </div>
          </div>
        </Section>

        <Section step={3} title="Supporting documents">
          <p className="text-sm text-ved-green-800/70">
            Attach an ID proof and your certificates — PDF, JPG, PNG or WebP, up to 2.5 MB each, {MAX_DOCUMENTS} files at most. Documents are
            stored privately and seen only by our verification team.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="join-doc-label">
                Document type
              </label>
              <select id="join-doc-label" className="input" value={docLabel} onChange={(e) => setDocLabel(e.target.value)}>
                {DOCUMENT_LABELS.map((label) => (
                  <option key={label}>{label}</option>
                ))}
              </select>
            </div>
            <label className={`btn-ghost cursor-pointer ${documents.length >= MAX_DOCUMENTS ? 'pointer-events-none opacity-50' : ''}`}>
              + Add documents
              <input
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={documents.length >= MAX_DOCUMENTS}
                onChange={(e) => void onDocuments(e)}
              />
            </label>
          </div>
          {documents.length > 0 && (
            <ul className="divide-y divide-ved-green-900/10 rounded-xl border border-ved-green-900/10">
              {documents.map((document, index) => (
                <li key={`${document.name}-${index}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span aria-hidden className="rounded-md bg-ved-gold-50 px-2 py-1 text-[11px] font-semibold text-ved-gold-700">
                    {document.dataUrl.startsWith('data:application/pdf') ? 'PDF' : 'IMG'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ved-green-900">{document.name}</span>
                    <span className="text-xs text-ved-green-800/60">
                      {document.label} · {(document.size / 1024).toFixed(0)} KB
                    </span>
                  </span>
                  <button
                    type="button"
                    className="text-sm text-rose-600 hover:underline"
                    onClick={() => setDocuments((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="card space-y-4 sm:p-7">
          <label className="flex items-start gap-3 text-sm text-ved-green-800">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-ved-green-600" required checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I confirm the information and documents are genuine, and I agree to Vedsutra verifying them and contacting me about this application.
          </label>
          {error && (
            <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary w-full py-3.5 text-base sm:w-auto sm:px-10" disabled={submitting || !consent}>
            {submitting ? 'Submitting…' : 'Submit application →'}
          </button>
        </div>
      </form>
    </div>
  );
}
