'use client';

import Image from 'next/image';
import { useEffect, useState, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api, youtubeThumbnailUrl, type AdminReviewVideo } from '@/lib/api';

interface VideoForm {
  url: string;
  title: string;
  description: string;
  active: boolean;
}

const EMPTY_FORM: VideoForm = { url: '', title: '', description: '', active: true };

/** Best-effort id for the live preview; the server does the authoritative parsing. */
function previewId(url: string): string | null {
  const match = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/.exec(url) ?? /^([A-Za-z0-9_-]{11})$/.exec(url.trim());
  return match?.[1] ?? null;
}

export default function AdminReviewsPage() {
  const [videos, setVideos] = useState<AdminReviewVideo[] | null>(null);
  const [editing, setEditing] = useState<AdminReviewVideo | 'new' | null>(null);
  const [form, setForm] = useState<VideoForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.get<{ videos: AdminReviewVideo[] }>('content/admin/review-videos');
      setVideos(res.videos);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load review videos');
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

  function startEdit(video: AdminReviewVideo) {
    setEditing(video);
    setForm({ url: video.url, title: video.title, description: video.description ?? '', active: video.active });
    setMessage(null);
    setError(null);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const target = editing;
    const body = {
      url: form.url.trim(),
      title: form.title.trim(),
      description: form.description.trim() || null,
      active: form.active,
    };
    void run(async () => {
      if (target === 'new') await api.post('content/admin/review-videos', body);
      else if (target) await api.patch(`content/admin/review-videos/${target.id}`, body);
      setEditing(null);
      await load();
    }, target === 'new' ? 'Video added.' : 'Video saved.');
  }

  function toggle(video: AdminReviewVideo) {
    void run(async () => {
      await api.patch(`content/admin/review-videos/${video.id}`, { active: !video.active });
      await load();
    }, video.active ? 'Video hidden from the homepage.' : 'Video shown on the homepage.');
  }

  function remove(video: AdminReviewVideo) {
    if (!window.confirm(`Delete the review “${video.title}”? This cannot be undone.`)) return;
    void run(async () => {
      await api.del(`content/admin/review-videos/${video.id}`);
      if (editing !== 'new' && editing?.id === video.id) setEditing(null);
      await load();
    }, 'Video deleted.');
  }

  function move(index: number, delta: -1 | 1) {
    if (!videos) return;
    const ids = videos.map((v) => v.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    void run(async () => {
      const res = await api.put<{ videos: AdminReviewVideo[] }>('content/admin/review-videos/order', { ids });
      setVideos(res.videos);
    }, 'Order saved.');
  }

  const formPreview = previewId(form.url);
  const activeCount = videos?.filter((v) => v.active).length ?? 0;

  return (
    <AdminGate>
      <div className="space-y-6">
        <section className="card space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Homepage reviews</h2>
              <p className="mt-1 text-sm text-slate-400">
                Active YouTube videos appear in the &ldquo;Reviews&rdquo; carousel below Stay Connected, in this order.
                {videos && activeCount === 0 && ' No video is active, so the section is hidden.'}
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
                  <Image src={youtubeThumbnailUrl(video.youtubeId)} alt="" fill unoptimized className="object-cover" />
                </a>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{video.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        video.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                      }`}
                    >
                      {video.active ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-400">{video.description || video.url}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-sm">
                  <button type="button" className="btn-ghost px-2" onClick={() => move(index, -1)} disabled={busy || index === 0} aria-label="Move up">
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-ghost px-2"
                    onClick={() => move(index, 1)}
                    disabled={busy || index === videos.length - 1}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => toggle(video)} disabled={busy}>
                    {video.active ? 'Disable' : 'Enable'}
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
              <div className="relative aspect-video w-48 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                {formPreview ? (
                  <Image src={youtubeThumbnailUrl(formPreview)} alt="Video preview" fill unoptimized className="object-cover" />
                ) : (
                  <span className="grid h-full place-items-center px-2 text-center text-xs text-slate-500">
                    Paste a YouTube link to preview
                  </span>
                )}
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
                <span className="mt-1 block text-xs text-slate-400">Watch, youtu.be, Shorts and embed links all work.</span>
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
                placeholder="“The Rudrabhishek brought us peace” — Priya, Pune"
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
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              Active (shown on the homepage)
            </label>

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
    </AdminGate>
  );
}
