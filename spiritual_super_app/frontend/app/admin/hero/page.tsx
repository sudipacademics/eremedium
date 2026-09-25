'use client';

import Image from 'next/image';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api, heroSlideImageUrl, type AdminHeroSlide, type HeroSlideStatus } from '@/lib/api';
import { resizeBannerImage } from '@/lib/photo';

const STATUS_STYLE: Record<HeroSlideStatus, { label: string; className: string }> = {
  LIVE: { label: 'Live', className: 'bg-emerald-500/15 text-emerald-300' },
  SCHEDULED: { label: 'Scheduled', className: 'bg-sky-500/15 text-sky-300' },
  EXPIRED: { label: 'Expired', className: 'bg-slate-500/20 text-slate-400' },
  DISABLED: { label: 'Disabled', className: 'bg-rose-500/15 text-rose-300' },
};

interface SlideForm {
  eyebrow: string;
  title: string;
  description: string;
  imageMode: 'upload' | 'url';
  imageUrl: string;
  /** A freshly chosen upload; `null` keeps the slide's current image. */
  imageData: string | null;
  ctaText: string;
  ctaHref: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
}

const EMPTY_FORM: SlideForm = {
  eyebrow: '',
  title: '',
  description: '',
  imageMode: 'upload',
  imageUrl: '',
  imageData: null,
  ctaText: '',
  ctaHref: '',
  active: true,
  startsAt: '',
  endsAt: '',
};

/** ISO → value for `<input type="datetime-local">` in the admin's own time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function formFor(slide: AdminHeroSlide): SlideForm {
  return {
    eyebrow: slide.eyebrow ?? '',
    title: slide.title,
    description: slide.description ?? '',
    imageMode: slide.imageVersion !== null ? 'upload' : 'url',
    imageUrl: slide.imageUrl ?? '',
    imageData: null,
    ctaText: slide.ctaText ?? '',
    ctaHref: slide.ctaHref ?? '',
    active: slide.active,
    startsAt: toLocalInput(slide.startsAt),
    endsAt: toLocalInput(slide.endsAt),
  };
}

function formatWhen(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : null;
}

export default function AdminHeroPage() {
  const [slides, setSlides] = useState<AdminHeroSlide[] | null>(null);
  const [editing, setEditing] = useState<AdminHeroSlide | 'new' | null>(null);
  const [form, setForm] = useState<SlideForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.get<{ slides: AdminHeroSlide[] }>('content/admin/hero-slides');
      setSlides(res.slides);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load slides');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(done);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function startNew() {
    setEditing('new');
    setForm(EMPTY_FORM);
    setMessage(null);
    setError(null);
  }

  function startEdit(slide: AdminHeroSlide) {
    setEditing(slide);
    setForm(formFor(slide));
    setMessage(null);
    setError(null);
  }

  async function onPickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imageData = await resizeBannerImage(file, 1400);
      setForm((f) => ({ ...f, imageData }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read that image');
    }
  }

  function payload(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      eyebrow: form.eyebrow.trim() || null,
      title: form.title.trim(),
      description: form.description.trim() || null,
      ctaText: form.ctaText.trim() || null,
      ctaHref: form.ctaHref.trim() || null,
      active: form.active,
      startsAt: fromLocalInput(form.startsAt),
      endsAt: fromLocalInput(form.endsAt),
    };
    if (form.imageMode === 'url') {
      body.imageUrl = form.imageUrl.trim() || null;
      body.imageData = null;
    } else if (form.imageData) {
      body.imageData = form.imageData;
      body.imageUrl = null;
    }
    return body;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const target = editing;
    void run(async () => {
      if (target === 'new') {
        await api.post('content/admin/hero-slides', payload());
      } else if (target) {
        await api.patch(`content/admin/hero-slides/${target.id}`, payload());
      }
      setEditing(null);
      await load();
    }, target === 'new' ? 'Slide added.' : 'Slide saved.');
  }

  function toggle(slide: AdminHeroSlide) {
    void run(async () => {
      await api.patch(`content/admin/hero-slides/${slide.id}`, { active: !slide.active });
      await load();
    }, slide.active ? 'Slide disabled.' : 'Slide enabled.');
  }

  function remove(slide: AdminHeroSlide) {
    if (!window.confirm(`Delete the slide “${slide.title.replaceAll('*', '')}”? This cannot be undone.`)) return;
    void run(async () => {
      await api.del(`content/admin/hero-slides/${slide.id}`);
      if (editing !== 'new' && editing?.id === slide.id) setEditing(null);
      await load();
    }, 'Slide deleted.');
  }

  function move(index: number, delta: -1 | 1) {
    if (!slides) return;
    const ids = slides.map((s) => s.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    void run(async () => {
      const res = await api.put<{ slides: AdminHeroSlide[] }>('content/admin/hero-slides/order', { ids });
      setSlides(res.slides);
    }, 'Order saved.');
  }

  const editingSlide = editing && editing !== 'new' ? editing : null;
  const preview =
    form.imageMode === 'url'
      ? form.imageUrl.trim()
      : (form.imageData ?? (editingSlide && editingSlide.imageVersion !== null ? heroSlideImageUrl(editingSlide) : ''));
  const liveCount = slides?.filter((s) => s.status === 'LIVE').length ?? 0;

  return (
    <AdminGate>
      <div className="space-y-6">
        <section className="card space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Homepage hero slides</h2>
              <p className="mt-1 text-sm text-slate-400">
                Live slides rotate on the homepage in this order. {liveCount === 0 && slides && 'No slide is live — the default Vedsutra slide is shown.'}
              </p>
            </div>
            <button type="button" className="btn-primary" onClick={startNew} disabled={busy}>
              + Add slide
            </button>
          </div>

          {!slides && !error && <p className="text-sm text-slate-400">Loading…</p>}
          {slides && slides.length === 0 && <p className="text-sm text-slate-400">No slides yet.</p>}
          <ul className="divide-y divide-white/10">
            {slides?.map((slide, index) => {
              const status = STATUS_STYLE[slide.status];
              const from = formatWhen(slide.startsAt);
              const until = formatWhen(slide.endsAt);
              return (
                <li key={slide.id} className="flex flex-wrap items-center gap-4 py-3">
                  <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5">
                    <Image src={heroSlideImageUrl(slide)} alt="" fill unoptimized className="object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{slide.title.replaceAll('*', '')}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {[slide.ctaText && `Button: ${slide.ctaText} → ${slide.ctaHref}`, from && `from ${from}`, until && `until ${until}`]
                        .filter(Boolean)
                        .join(' · ') || 'No button · always on'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-sm">
                    <button type="button" className="btn-ghost px-2" onClick={() => move(index, -1)} disabled={busy || index === 0} aria-label="Move up">
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-2"
                      onClick={() => move(index, 1)}
                      disabled={busy || index === slides.length - 1}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => toggle(slide)} disabled={busy}>
                      {slide.active ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => startEdit(slide)} disabled={busy}>
                      Edit
                    </button>
                    <button type="button" className="btn-ghost text-rose-300" onClick={() => remove(slide)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {!editing && error && <p className="text-sm text-rose-300">{error}</p>}
          {!editing && message && <p className="text-sm text-emerald-300">{message}</p>}
        </section>

        {editing && (
          <form onSubmit={onSubmit} className="card space-y-4">
            <h2 className="text-lg font-semibold">{editing === 'new' ? 'New slide' : 'Edit slide'}</h2>
            <label className="block">
              <span className="label">Small heading (optional)</span>
              <input className="input" value={form.eyebrow} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, eyebrow: e.target.value }))} />
            </label>
            <label className="block">
              <span className="label">Title — wrap words in *asterisks* to show them in gold</span>
              <input
                className="input"
                required
                minLength={2}
                maxLength={160}
                value={form.title}
                placeholder="Your Life, Guided by *Vedic Wisdom*"
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="label">Description (optional)</span>
              <textarea
                className="input min-h-[4.5rem]"
                maxLength={400}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </label>

            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wider text-ved-gold-400">Banner image</legend>
              <div className="flex gap-4 text-sm">
                {(['upload', 'url'] as const).map((mode) => (
                  <label key={mode} className="inline-flex items-center gap-2">
                    <input type="radio" name="imageMode" checked={form.imageMode === mode} onChange={() => setForm((f) => ({ ...f, imageMode: mode }))} />
                    {mode === 'upload' ? 'Upload image' : 'Image URL'}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-start gap-4">
                <div className="relative h-32 w-[6.4rem] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                  {preview ? (
                    <Image src={preview} alt="Banner preview" fill unoptimized className="object-cover" />
                  ) : (
                    <span className="grid h-full place-items-center text-xs text-slate-500">No image</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2 text-sm text-slate-400">
                  {form.imageMode === 'upload' ? (
                    <>
                      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPickImage} className="block text-sm" />
                      <p>Portrait images (4:5) fit best. Large images are scaled down to 1400px before upload.</p>
                    </>
                  ) : (
                    <>
                      <input
                        className="input"
                        value={form.imageUrl}
                        maxLength={500}
                        placeholder="/brand/vedsutra-hero-mandala.png or https://images.unsplash.com/…"
                        onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                      />
                      <p>A site path (/brand/…) or an https image on images.unsplash.com or images.pexels.com.</p>
                    </>
                  )}
                </div>
              </div>
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ved-gold-400">Button (optional)</legend>
              <label className="block">
                <span className="label">Button text</span>
                <input className="input" maxLength={40} value={form.ctaText} placeholder="Book a Puja" onChange={(e) => setForm((f) => ({ ...f, ctaText: e.target.value }))} />
              </label>
              <label className="block">
                <span className="label">Button link</span>
                <input className="input" maxLength={500} value={form.ctaHref} placeholder="/pujas" onChange={(e) => setForm((f) => ({ ...f, ctaHref: e.target.value }))} />
              </label>
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ved-gold-400">Schedule (optional)</legend>
              <label className="block">
                <span className="label">Show from</span>
                <input type="datetime-local" className="input" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
              </label>
              <label className="block">
                <span className="label">Show until</span>
                <input type="datetime-local" className="input" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
              </label>
            </fieldset>

            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              Active (shown on the homepage when inside its schedule)
            </label>

            {error && <p className="text-sm text-rose-300">{error}</p>}
            {message && <p className="text-sm text-emerald-300">{message}</p>}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing === 'new' ? 'Add slide' : 'Save slide'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminGate>
  );
}
