'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { RFMS_API_BASE, RFMS_PORTAL_ORIGIN, HERO_SLIDE_DESCRIPTION_MAX, HERO_SLIDE_IMAGE_HINT, HERO_SLIDE_TITLE_MAX, clampHeroSlideText } from '@rfms/utils';

type HeroSlide = {
  id: string;
  title: string;
  description: string;
  primary_button_text: string;
  primary_button_url: string;
  secondary_button_text: string;
  secondary_button_url: string;
  image_url: string;
  is_published: boolean;
  sort_order: number;
};

type HeroDraft = Omit<HeroSlide, 'id'>;
const API_BASE = RFMS_API_BASE;

function emptySlide(order = 0): HeroDraft {
  return { title: '', description: '', primary_button_text: 'Apply for franchisee', primary_button_url: RFMS_PORTAL_ORIGIN, secondary_button_text: 'Check territory availability →', secondary_button_url: '/#territory', image_url: '', is_published: true, sort_order: order };
}

function currentToken() { return typeof window === 'undefined' ? '' : sessionStorage.getItem('rfms_auth_token') ?? ''; }
function asDataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read the image.')); reader.onerror = () => reject(new Error('Unable to read the image.')); reader.readAsDataURL(file); }); }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = currentToken();
  if (!token) throw new Error('A Super Admin session is required to manage hero slides.');
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to save the hero slide.');
  return payload.data as T;
}

export function HeroSliderManager({ notify }: { notify: (message: string) => void }) {
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [draft, setDraft] = useState<HeroDraft>(emptySlide());
  const [editingId, setEditingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try { const items = await request<HeroSlide[]>('/admin/content/hero-slides'); setSlides(items); setError(''); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to load hero slides.'); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  function startEdit(item: HeroSlide) {
    const { id, ...values } = item; setDraft(values); setEditingId(id); setError('');
  }

  function resetEditor() { setDraft(emptySlide(slides.length)); setEditingId(''); setError(''); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const saved = await request<HeroSlide>(editingId ? `/admin/content/hero-slides/${editingId}` : '/admin/content/hero-slides', { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      setSlides((items) => (editingId ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]).sort((a, b) => a.sort_order - b.sort_order));
      notify(editingId ? 'Homepage slide updated.' : 'Homepage slide created.'); resetEditor();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save the hero slide.'); } finally { setBusy(false); }
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0]; if (!image) return;
    setBusy(true);
    try { const result = await request<{ image_url: string }>('/admin/content/hero-slides/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_url: await asDataUrl(image) }) }); setDraft((value) => ({ ...value, image_url: result.image_url })); notify('Hero image uploaded. Save the slide to publish it.'); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to upload the hero image.'); } finally { setBusy(false); event.target.value = ''; }
  }

  async function removeSlide(item: HeroSlide) {
    if (!window.confirm(`Remove “${item.title}” from the homepage slider?`)) return;
    try { await request(`/admin/content/hero-slides/${item.id}`, { method: 'DELETE' }); setSlides((items) => items.filter((slide) => slide.id !== item.id)); if (editingId === item.id) resetEditor(); notify('Homepage slide removed.'); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to remove the hero slide.'); }
  }

  return <section className="panel hero-slider-manager">
    <div className="panel-head"><div><h2>Homepage hero slider</h2><p>Control every headline, image and call-to-action button shown above the fold.</p></div><button type="button" onClick={() => void refresh()}>Refresh slides</button></div>
    {error ? <p className="content-error" role="alert">{error}</p> : null}
    <div className="hero-editor-layout">
      <form className="hero-slide-form" onSubmit={save}>
        <h3>{editingId ? 'Edit homepage slide' : 'Add homepage slide'}</h3>
        <label>Slide heading<input maxLength={HERO_SLIDE_TITLE_MAX} value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} placeholder="Main heading (max 90 characters, 2 lines)" required /><small>{draft.title.length}/{HERO_SLIDE_TITLE_MAX} characters</small></label>
        <label>Slide description<textarea maxLength={HERO_SLIDE_DESCRIPTION_MAX} value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} placeholder="Short supporting text (max 280 characters, 4 lines)" /><small>{draft.description.length}/{HERO_SLIDE_DESCRIPTION_MAX} characters</small></label>
        <div className="content-form-row"><label>Primary button text<input value={draft.primary_button_text} onChange={(event) => setDraft((value) => ({ ...value, primary_button_text: event.target.value }))} required /></label><label>Primary button link<input value={draft.primary_button_url} onChange={(event) => setDraft((value) => ({ ...value, primary_button_url: event.target.value }))} placeholder={`${RFMS_PORTAL_ORIGIN} or https://...`} required /></label></div>
        <div className="content-form-row"><label>Secondary button text<input value={draft.secondary_button_text} onChange={(event) => setDraft((value) => ({ ...value, secondary_button_text: event.target.value }))} /></label><label>Secondary button link<input value={draft.secondary_button_url} onChange={(event) => setDraft((value) => ({ ...value, secondary_button_url: event.target.value }))} placeholder="/#territory or https://..." /></label></div>
        <label>Slider image URL<input type="url" value={draft.image_url} onChange={(event) => setDraft((value) => ({ ...value, image_url: event.target.value }))} placeholder="https://... (optional)" /><small>{HERO_SLIDE_IMAGE_HINT}</small></label>
        <label className="upload-label">Or upload a PNG, JPG or WEBP image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadImage} /><small>{HERO_SLIDE_IMAGE_HINT}</small></label>
        <div className="content-form-row"><label>Display order<input type="number" min="0" value={draft.sort_order} onChange={(event) => setDraft((value) => ({ ...value, sort_order: Number(event.target.value) }))} /></label><label className="check-label"><input type="checkbox" checked={draft.is_published} onChange={(event) => setDraft((value) => ({ ...value, is_published: event.target.checked }))} /> Publish this slide</label></div>
        <div className="hero-form-actions"><button className="content-submit" disabled={busy}>{busy ? 'Saving...' : editingId ? 'Update slide' : 'Add slide'}</button>{editingId ? <button type="button" className="date" onClick={resetEditor}>Cancel edit</button> : null}</div>
      </form>
      <div className="hero-slide-preview"><b>Live preview</b>{draft.image_url ? <img src={draft.image_url} alt="Hero slide preview" /> : <div className="hero-preview-fallback">REMEDIUM <em>LAB</em><small>Default visual used when no image is set</small></div>}<h3 title={draft.title}>{clampHeroSlideText(draft.title, HERO_SLIDE_TITLE_MAX) || 'Your hero heading'}</h3><p title={draft.description}>{clampHeroSlideText(draft.description, HERO_SLIDE_DESCRIPTION_MAX) || 'Your supporting description will appear here.'}</p><span>{draft.primary_button_text || 'Primary button'}</span></div>
    </div>
    <div className="hero-slide-list"><h3>Saved slides</h3>{slides.length ? slides.map((item) => <article key={item.id}><div>{item.image_url ? <img src={item.image_url} alt="" /> : <span className="hero-list-fallback">RL</span>}<div><b>{item.title}</b><small>{item.is_published ? 'Published' : 'Draft'} · Order {item.sort_order}</small></div></div><div><button type="button" onClick={() => startEdit(item)}>Edit</button><button type="button" className="danger" onClick={() => void removeSlide(item)}>Remove</button></div></article>) : <p className="content-empty">No custom slides yet. The default Remedium Lab hero is displayed until you add one.</p>}</div>
  </section>;
}
