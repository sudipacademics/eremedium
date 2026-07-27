'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { RFMS_API_BASE } from '@rfms/utils';

type TrainingVideo = {
  id: string;
  title: string;
  description: string;
  video_url: string;
  youtube_embed_code?: string;
  youtube_embed_url?: string;
  mime: string;
  duration_minutes: number;
  franchise_models: ('FOFO' | 'FOCO')[];
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

const API_BASE = RFMS_API_BASE;

function asDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read this file.')));
    reader.onerror = () => reject(new Error('Unable to read this file.'));
    reader.readAsDataURL(file);
  });
}

function previewVideoUrl(videoUrl: string) {
  const value = videoUrl.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${new URL(API_BASE).origin}${value.startsWith('/') ? value : `/${value}`}`;
}

function previewEmbedUrl(embedCode: string) {
  const source = embedCode.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] ?? embedCode.trim();
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(url.hostname) && url.pathname.startsWith('/embed/') ? url.toString() : '';
  } catch { return ''; }
}

export function TrainingStudio({ token, notify }: { token: string; notify: (message: string) => void }) {
  const [videos, setVideos] = useState<TrainingVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [pendingFile, setPendingFile] = useState<{ name: string; data_url: string } | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    youtube_embed_code: '',
    duration_minutes: 15,
    sort_order: 1,
    fofo: true,
    foco: true,
    is_published: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/training/videos`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: TrainingVideo[]; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.error?.message ?? 'Unable to load training videos.');
      setVideos(payload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load training videos.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  function resetForm() {
    setEditingId('');
    setPendingFile(null);
    setForm({ title: '', description: '', youtube_embed_code: '', duration_minutes: 15, sort_order: videos.length + 1, fofo: true, foco: true, is_published: true });
  }

  function startEdit(video: TrainingVideo) {
    setEditingId(video.id);
    setPendingFile(null);
    setForm({
      title: video.title,
      description: video.description,
      youtube_embed_code: video.youtube_embed_code || (video.mime === 'video/youtube' ? `<iframe src="${video.video_url}" title="${video.title}" allowfullscreen></iframe>` : ''),
      duration_minutes: video.duration_minutes || 15,
      sort_order: video.sort_order,
      fofo: video.franchise_models.includes('FOFO'),
      foco: video.franchise_models.includes('FOCO'),
      is_published: video.is_published,
    });
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data_url = await asDataUrl(file);
      setPendingFile({ name: file.name, data_url });
      setForm((current) => ({ ...current, youtube_embed_code: '' }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to read the selected video file.');
    }
  }

  async function saveVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const franchise_models = [form.fofo ? 'FOFO' : null, form.foco ? 'FOCO' : null].filter(Boolean) as ('FOFO' | 'FOCO')[];
      if (!franchise_models.length) throw new Error('Select at least one franchise model.');
      const body = {
        title: form.title,
        description: form.description,
        youtube_embed_code: form.youtube_embed_code,
        duration_minutes: form.duration_minutes,
        sort_order: form.sort_order,
        franchise_models,
        is_published: form.is_published,
        ...(pendingFile ? { file: { name: pendingFile.name, data_url: pendingFile.data_url } } : {}),
      };
      const response = await fetch(`${API_BASE}/admin/training/videos${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: TrainingVideo; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to save the training video.');
      notify(editingId ? 'Training video updated.' : 'Training video published to the applicant catalog.');
      resetForm();
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save the training video.');
    } finally {
      setBusy(false);
    }
  }

  async function removeVideo(video: TrainingVideo) {
    if (!window.confirm(`Delete "${video.title}" from the training catalog?`)) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/training/videos/${video.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to delete the training video.');
      notify('Training video deleted.');
      if (editingId === video.id) resetForm();
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to delete the training video.');
    } finally {
      setBusy(false);
    }
  }

  const publishedCount = videos.filter((video) => video.is_published).length;

  return <section className="training-studio">
    <div className="title-row"><div><h1>Training video studio</h1><p>Publish 3–4 mandatory franchise training videos. Applicants unlock them sequentially after the manager releases training post-agreement.</p></div><button className="date" type="button" onClick={() => void load()}>Refresh catalog</button></div>
    <div className="module-summary"><section><span>Published videos</span><b>{publishedCount}</b><small>Visible to applicants once training is unlocked</small></section><section><span>Catalog total</span><b>{videos.length}</b><small>Ordered learning sequence</small></section><section><span>Recommended set</span><b>3–4</b><small>Complete the mandatory training path</small></section></div>
    <div className="training-studio-grid">
      <section className="panel data-panel training-studio-form-panel">
        <div className="panel-head"><div><h2>{editingId ? 'Edit training video' : 'Add training video'}</h2><p>Paste the YouTube iframe embed code from YouTube, or upload an MP4 file hosted by RFMS.</p></div>{editingId ? <button type="button" onClick={resetForm}>Cancel edit</button> : null}</div>
        <form className="training-studio-form" onSubmit={(event) => void saveVideo(event)}>
          <label>Title<input required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Lab operations and quality standards" /></label>
          <label className="training-studio-wide">Description<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Brief summary shown to applicants before they start the module." /></label>
          <label className="training-studio-wide">YouTube embed code<textarea value={form.youtube_embed_code} onChange={(event) => setForm((current) => ({ ...current, youtube_embed_code: event.target.value }))} placeholder={'<iframe src="https://www.youtube.com/embed/..." ...></iframe>'} disabled={Boolean(pendingFile)} /></label>
          <label>Upload MP4<input type="file" accept="video/mp4,video/webm,video/*" onChange={(event) => void onFileChange(event)} /></label>
          {pendingFile ? <p className="training-studio-file-note">Selected file: <b>{pendingFile.name}</b></p> : null}
          {previewEmbedUrl(form.youtube_embed_code) ? <iframe title="Training preview" src={previewEmbedUrl(form.youtube_embed_code)} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /> : null}
          <label>Duration (minutes)<input type="number" min={1} max={240} value={form.duration_minutes} onChange={(event) => setForm((current) => ({ ...current, duration_minutes: Number(event.target.value) || 0 }))} /></label>
          <label>Sort order<input type="number" min={1} max={20} value={form.sort_order} onChange={(event) => setForm((current) => ({ ...current, sort_order: Number(event.target.value) || 1 }))} /></label>
          <div className="training-studio-models"><span>Franchise models</span><label><input type="checkbox" checked={form.fofo} onChange={(event) => setForm((current) => ({ ...current, fofo: event.target.checked }))} /> FOFO</label><label><input type="checkbox" checked={form.foco} onChange={(event) => setForm((current) => ({ ...current, foco: event.target.checked }))} /> FOCO</label></div>
          <label className="training-studio-publish"><input type="checkbox" checked={form.is_published} onChange={(event) => setForm((current) => ({ ...current, is_published: event.target.checked }))} /> Published for applicant training</label>
          <button type="submit" disabled={busy || (!form.youtube_embed_code && !pendingFile)}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Publish video'}</button>
        </form>
        {error ? <p className="application-review-error" role="alert">{error}</p> : null}
      </section>
      <section className="panel data-panel training-studio-list-panel">
        <div className="panel-head"><div><h2>Training catalog</h2><p>{loading ? 'Loading videos…' : `${videos.length} module${videos.length === 1 ? '' : 's'} in learning order`}</p></div></div>
        <div className="training-studio-list">{videos.length ? videos.map((video, index) => {
          const preview = previewVideoUrl(video.youtube_embed_url || video.video_url);
          const isYoutube = video.mime === 'video/youtube' || /youtube\.com|youtu\.be/i.test(video.video_url) || Boolean(video.youtube_embed_url);
          return <article key={video.id} className={video.is_published ? 'published' : 'draft'}>
            <header><div><span>Module {index + 1}</span><b>{video.title}</b><small>{video.franchise_models.join(' · ')} · {video.duration_minutes || '—'} min · Order {video.sort_order}</small></div><span>{video.is_published ? 'Published' : 'Draft'}</span></header>
            {video.description ? <p>{video.description}</p> : null}
            {preview && isYoutube ? <iframe title={video.title} src={preview} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /> : preview ? <video controls preload="metadata" src={preview} /> : null}
            <div className="training-studio-list-actions"><button type="button" onClick={() => startEdit(video)}>Edit</button><button type="button" className="danger" onClick={() => void removeVideo(video)} disabled={busy}>Delete</button></div>
          </article>;
        }) : <p className="training-studio-empty">{loading ? 'Loading training catalog…' : 'No training videos published yet. Add the first mandatory module to unlock applicant training.'}</p>}</div>
      </section>
    </div>
  </section>;
}
