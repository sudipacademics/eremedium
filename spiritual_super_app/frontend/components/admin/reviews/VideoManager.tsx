'use client';

import Image from 'next/image';
import { useState, type ChangeEvent, type FormEvent } from 'react';

import { api, reviewThumbnailUrl, youtubeThumbnailUrl, type AdminReviewVideo } from '@/lib/api';
import { resizeBannerImage } from '@/lib/photo';

import { Badge, useAdminList } from './useAdminList';

interface VideoForm {
  url: string;
  title: string;
  description: string;
  active: boolean;
  featured: boolean;
  /** undefined = unchanged, null = remove, string = new upload. */
  thumbnailData: string | null | undefined;
}

const EMPTY_FORM: VideoForm = { url: '', title: '', description: '', active: true, featured: false, thumbnailData: undefined };

/** Best-effort id for the live preview; the server does the authoritative parsing. */
function previewId(url: string): string | null {
  const match = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/.exec(url) ?? /^([A-Za-z0-9_-]{11})$/.exec(url.trim());
  return match?.[1] ?? null;
}

export function VideoManager() {
  const { items: videos, busy, message, error, load, run, move, clearNotices } = useAdminList<AdminReviewVideo>(
    'content/admin/review-videos',
    'videos',
  );
  const [editing, setEditing] = useState<AdminReviewVideo | 'new' | null>(null);
  const [form, setForm] = useState<VideoForm>(EMPTY_FORM);

  function startNew() {
    setEditing('new');
    setForm(EMPTY_FORM);
    clearNotices();
  }

  function startEdit(video: AdminReviewVideo) {
    setEditing(video);
    setForm({
      url: video.url,
      title: video.title,
      description: video.description ?? '',
      active: video.active,
      featured: video.featured,
      thumbnailData: undefined,
    });
    clearNotices();
  }

  async function onThumbnail(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const thumbnailData = await resizeBannerImage(file, 1280, 0.8);
      setForm((f) => ({ ...f, thumbnailData }));
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Could not read that image');
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const target = editing;
    const body = {
      url: form.url.trim(),
      title: form.title.trim(),
      description: form.description.trim() || null,
      active: form.active,
      featured: form.featured,
      ...(form.thumbnailData !== undefined ? { thumbnailData: form.thumbnailData } : {}),
    };
    void run(async () => {
      if (target === 'new') await api.post('content/admin/review-videos', body);
      else if (target) await api.patch(`content/admin/review-videos/${target.id}`, body);
      setEditing(null);
      await load();
    }, target === 'new' ? 'Video added.' : 'Video saved.');
  }

  function patch(video: AdminReviewVideo, body: Partial<Pick<AdminReviewVideo, 'active' | 'featured'>>, done: string) {
    void run(async () => {
      await api.patch(`content/admin/review-videos/${video.id}`, body);
      await load();
    }, done);
  }

  function remove(video: AdminReviewVideo) {
    if (!window.confirm(`Delete the review video “${video.title}”? This cannot be undone.`)) return;
    void run(async () => {
      await api.del(`content/admin/review-videos/${video.id}`);
      if (editing !== 'new' && editing?.id === video.id) setEditing(null);
      await load();
    }, 'Video deleted.');
  }

  const editingVideo = editing && editing !== 'new' ? editing : null;
  const youtubePreview = previewId(form.url);
  const thumbnailPreview =
    typeof form.thumbnailData === 'string'
      ? form.thumbnailData
      : form.thumbnailData === undefined && editingVideo && editingVideo.thumbnailVersion !== null
        ? reviewThumbnailUrl(editingVideo)
        : youtubePreview
          ? youtubeThumbnailUrl(youtubePreview)
          : null;
  const hasCustomThumbnail =
    typeof form.thumbnailData === 'string' || (form.thumbnailData === undefined && editingVideo?.thumbnailVersion != null);

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Review videos</h2>
            <p className="mt-1 text-sm text-slate-400">
              The large centre card of the homepage &ldquo;Reviews&rdquo; carousel. Featured videos lead, then this order.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={startNew} disabled={busy}>
            + Add video
          </button>
        </div>

        {!videos && !error && <p className="text-sm text-slate-400">Loading…</p>}
        {videos && videos.length === 0 && <p className="text-sm text-slate-400">No review videos yet.</p>}
        <ul className="divide-y divide-white/10">
          {videos?.map((video, index) => (
            <li key={video.id} className="flex flex-wrap items-center gap-4 py-3">
              <a
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5"
                title="Open on YouTube"
              >
                <Image src={reviewThumbnailUrl(video)} alt="" fill unoptimized className="object-cover" />
              </a>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{video.title}</span>
                  <Badge on={video.active} onLabel="Published" offLabel="Unpublished" />
                  <Badge on={video.featured} onLabel="★ Featured" tone="amber" />
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-400">{video.description || video.url}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-sm">
                <button type="button" className="btn-ghost px-2" onClick={() => move(index, -1)} disabled={busy || index === 0} aria-label="Move up">
                  ↑
                </button>
                <button type="button" className="btn-ghost px-2" onClick={() => move(index, 1)} disabled={busy || index === videos.length - 1} aria-label="Move down">
                  ↓
                </button>
                <button type="button" className="btn-ghost" onClick={() => patch(video, { featured: !video.featured }, video.featured ? 'Video unfeatured.' : 'Video featured.')} disabled={busy}>
                  {video.featured ? 'Unfeature' : 'Feature'}
                </button>
                <button type="button" className="btn-ghost" onClick={() => patch(video, { active: !video.active }, video.active ? 'Video unpublished.' : 'Video published.')} disabled={busy}>
                  {video.active ? 'Unpublish' : 'Publish'}
                </button>
                <button type="button" className="btn-ghost" onClick={() => startEdit(video)} disabled={busy}>
                  Edit
                </button>
                <button type="button" className="btn-ghost text-rose-300" onClick={() => remove(video)} disabled={busy}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!editing && error && <p className="text-sm text-rose-300">{error}</p>}
        {!editing && message && <p className="text-sm text-emerald-300">{message}</p>}
      </section>

      {editing && (
        <form onSubmit={onSubmit} className="card space-y-4">
          <h2 className="text-lg font-semibold">{editing === 'new' ? 'New review video' : 'Edit review video'}</h2>
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-48 shrink-0 space-y-2">
              <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-white/5">
                {thumbnailPreview ? (
                  <Image src={thumbnailPreview} alt="Thumbnail preview" fill unoptimized className="object-cover" />
                ) : (
                  <span className="grid h-full place-items-center px-2 text-center text-xs text-slate-500">Paste a YouTube link to preview</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <label className="btn-ghost cursor-pointer px-2 py-1">
                  {hasCustomThumbnail ? 'Replace thumbnail' : 'Upload thumbnail'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void onThumbnail(e)} />
                </label>
                {hasCustomThumbnail && (
                  <button type="button" className="btn-ghost px-2 py-1 text-rose-300" onClick={() => setForm((f) => ({ ...f, thumbnailData: null }))}>
                    Use YouTube&apos;s
                  </button>
                )}
              </div>
            </div>
            <label className="block min-w-0 flex-1">
              <span className="label">YouTube video URL</span>
              <input
                className="input"
                required
                maxLength={500}
                value={form.url}
                placeholder="https://www.youtube.com/watch?v=… or https://youtu.be/…"
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
              <span className="mt-1 block text-xs text-slate-400">
                Watch, youtu.be, Shorts and embed links all work. Without an uploaded thumbnail, YouTube&apos;s own is used.
              </span>
            </label>
          </div>
          <label className="block">
            <span className="label">Title</span>
            <input
              className="input"
              required
              minLength={2}
              maxLength={160}
              value={form.title}
              placeholder="Real Stories, Real Transformations"
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="label">Short description (optional)</span>
            <textarea
              className="input min-h-[4.5rem]"
              maxLength={400}
              value={form.description}
              placeholder="Hear from our devotees how Vedsutra has guided them in their spiritual journey."
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
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
              {busy ? 'Saving…' : editing === 'new' ? 'Add video' : 'Save video'}
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
