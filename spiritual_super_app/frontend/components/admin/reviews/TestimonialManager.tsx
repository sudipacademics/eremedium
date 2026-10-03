'use client';

import Image from 'next/image';
import { useState, type ChangeEvent, type FormEvent } from 'react';

import { api, testimonialPhotoUrl, type AdminTestimonial } from '@/lib/api';
import { resizeSquarePhoto } from '@/lib/photo';

import { Badge, useAdminList } from './useAdminList';

interface TestimonialForm {
  name: string;
  location: string;
  rating: number;
  body: string;
  active: boolean;
  featured: boolean;
  /** undefined = unchanged, null = remove, string = new upload. */
  photoData: string | null | undefined;
}

const EMPTY_FORM: TestimonialForm = { name: '', location: '', rating: 5, body: '', active: true, featured: false, photoData: undefined };

function stars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

export function TestimonialManager() {
  const { items, busy, message, error, load, run, move, clearNotices } = useAdminList<AdminTestimonial>(
    'content/admin/testimonials',
    'testimonials',
  );
  const [editing, setEditing] = useState<AdminTestimonial | 'new' | null>(null);
  const [form, setForm] = useState<TestimonialForm>(EMPTY_FORM);

  function startNew() {
    setEditing('new');
    setForm(EMPTY_FORM);
    clearNotices();
  }

  function startEdit(item: AdminTestimonial) {
    setEditing(item);
    setForm({
      name: item.name,
      location: item.location ?? '',
      rating: item.rating,
      body: item.body,
      active: item.active,
      featured: item.featured,
      photoData: undefined,
    });
    clearNotices();
  }

  async function onPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const photoData = await resizeSquarePhoto(file, 240, 0.85);
      setForm((f) => ({ ...f, photoData }));
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Could not read that image');
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const target = editing;
    const body = {
      name: form.name.trim(),
      location: form.location.trim() || null,
      rating: form.rating,
      body: form.body.trim(),
      active: form.active,
      featured: form.featured,
      ...(form.photoData !== undefined ? { photoData: form.photoData } : {}),
    };
    void run(async () => {
      if (target === 'new') await api.post('content/admin/testimonials', body);
      else if (target) await api.patch(`content/admin/testimonials/${target.id}`, body);
      setEditing(null);
      await load();
    }, target === 'new' ? 'Testimonial added.' : 'Testimonial saved.');
  }

  function patch(item: AdminTestimonial, body: Partial<Pick<AdminTestimonial, 'active' | 'featured'>>, done: string) {
    void run(async () => {
      await api.patch(`content/admin/testimonials/${item.id}`, body);
      await load();
    }, done);
  }

  function remove(item: AdminTestimonial) {
    if (!window.confirm(`Delete the testimonial from “${item.name}”? This cannot be undone.`)) return;
    void run(async () => {
      await api.del(`content/admin/testimonials/${item.id}`);
      if (editing !== 'new' && editing?.id === item.id) setEditing(null);
      await load();
    }, 'Testimonial deleted.');
  }

  const editingItem = editing && editing !== 'new' ? editing : null;
  const photoPreview =
    typeof form.photoData === 'string'
      ? form.photoData
      : form.photoData === undefined && editingItem
        ? testimonialPhotoUrl(editingItem)
        : null;

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Testimonials</h2>
            <p className="mt-1 text-sm text-slate-400">
              The written review cards either side of the video, two per slide. Featured testimonials lead, then this order.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={startNew} disabled={busy}>
            + Add testimonial
          </button>
        </div>

        {!items && !error && <p className="text-sm text-slate-400">Loading…</p>}
        {items && items.length === 0 && <p className="text-sm text-slate-400">No testimonials yet.</p>}
        <ul className="divide-y divide-white/10">
          {items?.map((item, index) => {
            const photo = testimonialPhotoUrl(item);
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-4 py-3">
                <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-white/5 text-sm font-semibold">
                  {photo ? <Image src={photo} alt="" fill unoptimized className="object-cover" /> : item.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.name}</span>
                    {item.location && <span className="text-xs text-slate-400">{item.location}</span>}
                    <span className="text-xs text-amber-300" aria-label={`${item.rating} out of 5 stars`}>
                      {stars(item.rating)}
                    </span>
                    <Badge on={item.active} onLabel="Published" offLabel="Unpublished" />
                    <Badge on={item.featured} onLabel="★ Featured" tone="amber" />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-400">{item.body}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-sm">
                  <button type="button" className="btn-ghost px-2" onClick={() => move(index, -1)} disabled={busy || index === 0} aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" className="btn-ghost px-2" onClick={() => move(index, 1)} disabled={busy || index === items.length - 1} aria-label="Move down">
                    ↓
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => patch(item, { featured: !item.featured }, item.featured ? 'Testimonial unfeatured.' : 'Testimonial featured.')} disabled={busy}>
                    {item.featured ? 'Unfeature' : 'Feature'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => patch(item, { active: !item.active }, item.active ? 'Testimonial unpublished.' : 'Testimonial published.')} disabled={busy}>
                    {item.active ? 'Unpublish' : 'Publish'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => startEdit(item)} disabled={busy}>
                    Edit
                  </button>
                  <button type="button" className="btn-ghost text-rose-300" onClick={() => remove(item)} disabled={busy}>
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
          <h2 className="text-lg font-semibold">{editing === 'new' ? 'New testimonial' : 'Edit testimonial'}</h2>
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex flex-col items-center gap-2">
              <span className="relative grid h-20 w-20 place-items-center overflow-hidden rounded-full border border-white/10 bg-white/5 text-xs text-slate-500">
                {photoPreview ? <Image src={photoPreview} alt="Reviewer photo" fill unoptimized className="object-cover" /> : 'No photo'}
              </span>
              <label className="btn-ghost cursor-pointer px-2 py-1 text-xs">
                {photoPreview ? 'Replace photo' : 'Upload photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void onPhoto(e)} />
              </label>
              {photoPreview && (
                <button type="button" className="btn-ghost px-2 py-1 text-xs text-rose-300" onClick={() => setForm((f) => ({ ...f, photoData: null }))}>
                  Remove photo
                </button>
              )}
            </div>
            <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="label">Name</span>
                <input className="input" required minLength={2} maxLength={80} value={form.name} placeholder="Priya Sharma" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label className="block">
                <span className="label">Location (optional)</span>
                <input className="input" maxLength={120} value={form.location} placeholder="Kolkata, West Bengal" onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
              </label>
              <label className="block">
                <span className="label">Rating</span>
                <select className="input" value={form.rating} onChange={(e) => setForm((f) => ({ ...f, rating: Number(e.target.value) }))}>
                  {[5, 4, 3, 2, 1].map((value) => (
                    <option key={value} value={value}>
                      {stars(value)} ({value})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <label className="block">
            <span className="label">Review text</span>
            <textarea
              className="input min-h-[6rem]"
              required
              minLength={10}
              maxLength={600}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            />
            <span className="mt-1 block text-xs text-slate-400">{form.body.trim().length}/600 — the card shows about five lines.</span>
          </label>
          <div className="flex flex-wrap gap-5">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              Published (shown on the homepage)
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.featured} onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))} />
              Featured (shown first)
            </label>
          </div>

          {error && <p className="text-sm text-rose-300">{error}</p>}
          {message && <p className="text-sm text-emerald-300">{message}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editing === 'new' ? 'Add testimonial' : 'Save testimonial'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
