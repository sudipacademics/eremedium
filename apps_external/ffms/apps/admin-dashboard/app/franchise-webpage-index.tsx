'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { RFMS_API_BASE } from '@rfms/utils';

const API_BASE = RFMS_API_BASE;
const MAX_BRANCH_IMAGES = 10;
const API_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, '');

async function compressImageFile(file: File, maxEdge = 1600, quality = 0.82): Promise<{ name: string; data_url: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to prepare photographs for upload.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const mime = file.type === 'image/png' ? 'image/jpeg' : (file.type || 'image/jpeg');
  const dataUrl = canvas.toDataURL(mime, quality);
  const extension = mime === 'image/png' ? 'png' : 'jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return { name: `${baseName}.${extension}`, data_url: dataUrl };
}

function resolveImageUrl(url?: string) {
  const value = (url ?? '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_ORIGIN}${value.startsWith('/') ? value : `/${value}`}`;
}

export type FranchiseWebpageRecord = {
  id: string;
  application_id: string;
  application_number: string;
  applicant_name: string;
  franchise_model: string;
  slug: string;
  enabled: boolean;
  settings: {
    business_name: string;
    branch_address: string;
    contact_number: string;
    whatsapp_number: string;
    google_map_link: string;
    google_map_embed_url: string;
    branch_images: { url: string; caption: string }[];
    business_hours: string;
    hero_subtitle: string;
    branch_intro: string;
    seo_title: string;
    seo_description: string;
    seo_keywords: string;
    app_download_url: string;
  };
  public_url: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  onboarded_at: string;
  onboarded_by: string;
};

function displayDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function draftFromPage(page: FranchiseWebpageRecord): FranchiseWebpageRecord['settings'] {
  return { ...page.settings, branch_images: page.settings.branch_images?.map((image) => ({ ...image })) ?? [] };
}

export function FranchiseWebpageIndex({ token, search, notify }: { token: string; search: string; notify: (message: string) => void }) {
  const [pages, setPages] = useState<FranchiseWebpageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [editorId, setEditorId] = useState('');
  const [draft, setDraft] = useState<FranchiseWebpageRecord['settings'] | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/franchise-webpages`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: FranchiseWebpageRecord[]; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.error?.message ?? 'Unable to load franchise webpages.');
      setPages(payload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load franchise webpages.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const visiblePages = useMemo(() => pages.filter((page) => {
    const haystack = `${page.application_number} ${page.applicant_name} ${page.settings.business_name} ${page.slug}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [pages, search]);

  const editing = pages.find((page) => page.id === editorId) ?? null;

  useEffect(() => {
    if (!editorId) return;
    const page = pages.find((item) => item.id === editorId);
    if (page) setDraft(draftFromPage(page));
  }, [editorId, pages]);

  function openEditor(page: FranchiseWebpageRecord) {
    setEditorId(page.id);
    setDraft(draftFromPage(page));
    setError('');
  }

  function closeEditor() {
    setEditorId('');
    setDraft(null);
    setError('');
  }

  async function saveSelected() {
    if (!editing || !draft) return;
    setBusyId(editing.id);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/franchise-webpages/${editing.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: draft }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: FranchiseWebpageRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to save webpage settings.');
      setPages((items) => items.map((item) => item.id === payload.data!.id ? payload.data! : item));
      setDraft(draftFromPage(payload.data!));
      notify('Franchise webpage settings updated and regenerated.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save webpage settings.');
    } finally {
      setBusyId('');
    }
  }

  async function toggleEnabled(page: FranchiseWebpageRecord) {
    setBusyId(page.id);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/franchise-webpages/${page.id}/status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !page.enabled }),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: FranchiseWebpageRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to update webpage status.');
      setPages((items) => items.map((item) => item.id === payload.data!.id ? payload.data! : item));
      if (editorId === payload.data!.id) setDraft(draftFromPage(payload.data!));
      notify(payload.data.enabled ? 'Franchise webpage enabled.' : 'Franchise webpage disabled.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update webpage status.');
    } finally {
      setBusyId('');
    }
  }

  async function regenerate(page: FranchiseWebpageRecord) {
    setBusyId(page.id);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/franchise-webpages/${page.id}/regenerate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: FranchiseWebpageRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to regenerate webpage.');
      setPages((items) => items.map((item) => item.id === payload.data!.id ? payload.data! : item));
      if (editorId === payload.data!.id) setDraft(draftFromPage(payload.data!));
      notify('Franchise webpage regenerated with the latest template.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to regenerate webpage.');
    } finally {
      setBusyId('');
    }
  }

  function updateDraft<K extends keyof FranchiseWebpageRecord['settings']>(key: K, value: FranchiseWebpageRecord['settings'][K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  function applyPageUpdate(page: FranchiseWebpageRecord) {
    setPages((items) => items.map((item) => item.id === page.id ? page : item));
    if (editorId === page.id) setDraft(draftFromPage(page));
  }

  async function uploadBranchImages(event: ChangeEvent<HTMLInputElement>) {
    if (!editing || !draft) return;
    const remaining = MAX_BRANCH_IMAGES - draft.branch_images.length;
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/')).slice(0, remaining);
    event.target.value = '';
    if (!remaining) {
      setError(`You can upload up to ${MAX_BRANCH_IMAGES} branch photographs.`);
      return;
    }
    if (!files.length) {
      setError('Choose PNG, JPG or WEBP photographs.');
      return;
    }
    setBusyId(editing.id);
    setError('');
    try {
      for (const file of files) {
        const compressed = await compressImageFile(file);
        const response = await fetch(`${API_BASE}/admin/franchise-webpages/${editing.id}/branch-images/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...compressed, caption: file.name.replace(/\.[^.]+$/, '') || 'Branch photo' }),
        });
        const payload = await response.json().catch(() => null) as { success?: boolean; data?: FranchiseWebpageRecord; error?: { message?: string } } | null;
        if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to upload branch photograph.');
        applyPageUpdate(payload.data);
      }
      notify(`${files.length} branch photo${files.length === 1 ? '' : 's'} uploaded and added to the webpage.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to upload branch photographs.');
    } finally {
      setBusyId('');
    }
  }

  async function deleteBranchImage(index: number) {
    if (!editing || !draft) return;
    setBusyId(editing.id);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/admin/franchise-webpages/${editing.id}/branch-images/${index}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: FranchiseWebpageRecord; error?: { message?: string } } | null;
      if (!response.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? 'Unable to delete branch photograph.');
      applyPageUpdate(payload.data);
      notify('Branch photograph removed.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to delete branch photograph.');
    } finally {
      setBusyId('');
    }
  }

  return <section className="franchise-webpage-index">
    <div className="title-row"><div><h1>Franchisee Webpage Index</h1><p>Manage responsive FOCO franchise portfolio webpages generated after onboarding completion.</p></div><button className="date" type="button" onClick={() => void load()}>Refresh index</button></div>
    <div className="module-summary"><section><span>Published pages</span><b>{pages.filter((page) => page.enabled).length}</b><small>Enabled FOCO branch websites</small></section><section><span>Total onboarded FOCO sites</span><b>{pages.length}</b><small>Generated from completed onboarding</small></section><section><span>Editing</span><b>{editing?.settings.business_name || 'None'}</b><small>{editing?.public_url || 'Open webpage settings from the index table'}</small></section></div>
    {error && !editorId ? <p className="application-review-error">{error}</p> : null}
    <section className="panel data-panel franchise-webpage-list">
      <header><div><h2>Onboarded FOCO franchises</h2><span>{loading ? 'Loading webpages…' : `${visiblePages.length} record${visiblePages.length === 1 ? '' : 's'}`}</span></div></header>
      <div className="table-wrap"><table><thead><tr><th>Business</th><th>Application</th><th>Status</th><th>Updated</th><th /></tr></thead><tbody>
        {!loading && !visiblePages.length ? <tr><td colSpan={5} className="empty">No FOCO franchise webpages yet. Mark a FOCO application onboarded after the onboarding certificate is generated.</td></tr> : null}
        {visiblePages.map((page) => <tr key={page.id} className={editorId === page.id ? 'selected' : ''}><td><b>{page.settings.business_name}</b><br /><small>{page.slug}</small></td><td><b>{page.application_number}</b><br /><small>{page.applicant_name}</small></td><td><span className={`webpage-status ${page.enabled ? 'enabled' : 'disabled'}`}>{page.enabled ? 'Enabled' : 'Disabled'}</span></td><td>{displayDate(page.updated_at)}</td><td><button type="button" className="row-action" onClick={() => openEditor(page)}>Webpage settings</button></td></tr>)}
      </tbody></table></div>
    </section>
    {editing && draft ? <div className="application-review-backdrop" role="presentation" onMouseDown={closeEditor}>
      <section className="application-review-modal franchise-webpage-settings-modal" role="dialog" aria-modal="true" aria-labelledby="franchise-webpage-settings-heading" onMouseDown={(event) => event.stopPropagation()}>
        <header className="application-review-head">
          <div>
            <p>Franchise webpage settings</p>
            <h2 id="franchise-webpage-settings-heading">{editing.settings.business_name}</h2>
            <span className="application-review-head-meta">{editing.application_number} · {editing.applicant_name} · updated {displayDate(editing.updated_at)}</span>
          </div>
          <button type="button" onClick={closeEditor} aria-label="Close webpage settings">Close</button>
        </header>

        <section className="application-review-state">
          <div><span>Publication status</span><b>{editing.enabled ? 'Live on franchise site index' : 'Disabled — public link inactive'}</b></div>
          <span className={editing.enabled ? 'application-review-ready' : 'application-review-pending'}>{editing.enabled ? 'Enabled' : 'Disabled'}</span>
        </section>

        <section className="application-review-section">
          <div className="application-review-section-head">
            <div><h3>Branch profile</h3><p>Update the business details shown on the public FOCO franchise portfolio webpage.</p></div>
            <span>{editing.slug}</span>
          </div>
          <div className="franchise-webpage-form">
            <label>Business name<input value={draft.business_name} onChange={(event) => updateDraft('business_name', event.target.value)} /></label>
            <label className="span-two">Branch address<textarea value={draft.branch_address} onChange={(event) => updateDraft('branch_address', event.target.value)} /></label>
            <label>Contact number<input value={draft.contact_number} onChange={(event) => updateDraft('contact_number', event.target.value)} /></label>
            <label>WhatsApp number<input value={draft.whatsapp_number} onChange={(event) => updateDraft('whatsapp_number', event.target.value)} /></label>
            <label className="span-two">Google Map link<input value={draft.google_map_link} onChange={(event) => updateDraft('google_map_link', event.target.value)} /></label>
            <label className="span-two">Google Map embed URL<input value={draft.google_map_embed_url} onChange={(event) => updateDraft('google_map_embed_url', event.target.value)} /></label>
            <label className="span-two">Business hours<textarea value={draft.business_hours} onChange={(event) => updateDraft('business_hours', event.target.value)} /></label>
            <label className="span-two">Hero subtitle<input value={draft.hero_subtitle} onChange={(event) => updateDraft('hero_subtitle', event.target.value)} /></label>
            <label className="span-two">Branch introduction<textarea value={draft.branch_intro} onChange={(event) => updateDraft('branch_intro', event.target.value)} /></label>
          </div>
        </section>

        <section className="application-review-section">
          <div className="application-review-section-head">
            <div><h3>Branch images</h3><p>Upload branch photographs for the auto slider on the public webpage. Filenames are not shown to visitors.</p></div>
            <span>{draft.branch_images.length} / {MAX_BRANCH_IMAGES}</span>
          </div>
          <div className="franchise-webpage-images">
            {draft.branch_images.length ? (
              <div className="franchise-webpage-image-grid">
                {draft.branch_images.map((image, index) => (
                  <article key={`${image.url}-${index}`} className="franchise-webpage-image-card">
                    <img src={resolveImageUrl(image.url)} alt={image.caption || 'Branch photo'} />
                    <label>
                      Caption
                      <input
                        value={image.caption}
                        onChange={(event) => updateDraft('branch_images', draft.branch_images.map((item, itemIndex) => itemIndex === index ? { ...item, caption: event.target.value } : item))}
                        placeholder="Photo caption"
                      />
                    </label>
                    <button type="button" className="image-delete" disabled={busyId === editing.id} onClick={() => void deleteBranchImage(index)}>Delete photo</button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="franchise-webpage-images-empty">No branch photographs uploaded yet.</p>
            )}
            {draft.branch_images.length < MAX_BRANCH_IMAGES ? (
              <div className="franchise-webpage-upload">
                <input ref={uploadInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/*" multiple hidden onChange={(event) => void uploadBranchImages(event)} />
                <button type="button" disabled={busyId === editing.id} onClick={() => uploadInputRef.current?.click()}>
                  {busyId === editing.id ? 'Uploading…' : 'Upload photos'}
                </button>
                <small>PNG, JPG or WEBP up to 5 MB each. You can upload up to {MAX_BRANCH_IMAGES - draft.branch_images.length} more photo{MAX_BRANCH_IMAGES - draft.branch_images.length === 1 ? '' : 's'}.</small>
              </div>
            ) : (
              <small className="franchise-webpage-images-limit">Maximum of {MAX_BRANCH_IMAGES} branch photographs reached. Delete a photo to upload another.</small>
            )}
          </div>
        </section>

        <section className="application-review-section">
          <div className="application-review-section-head">
            <div><h3>SEO and app links</h3><p>Search metadata and the mobile app download button on the public page.</p></div>
            <span>Public SEO</span>
          </div>
          <div className="franchise-webpage-form">
            <label>SEO title<input value={draft.seo_title} onChange={(event) => updateDraft('seo_title', event.target.value)} /></label>
            <label>SEO keywords<input value={draft.seo_keywords} onChange={(event) => updateDraft('seo_keywords', event.target.value)} /></label>
            <label className="span-two">SEO description<textarea value={draft.seo_description} onChange={(event) => updateDraft('seo_description', event.target.value)} /></label>
            <label className="span-two">App download URL<input value={draft.app_download_url} onChange={(event) => updateDraft('app_download_url', event.target.value)} /></label>
          </div>
        </section>

        {error ? <p className="application-review-error" role="alert">{error}</p> : null}

        <footer className="application-review-footer franchise-webpage-settings-footer">
          <div><b>{editing.public_url ? 'Live webpage' : 'Webpage URL pending'}</b><span>{editing.public_url || 'Save settings to refresh the published franchise page.'}</span></div>
          <div className="franchise-webpage-editor-actions">
            {editing.public_url ? <a href={editing.public_url} target="_blank" rel="noreferrer">View live page</a> : null}
            <button type="button" disabled={busyId === editing.id} onClick={() => void regenerate(editing)}>{busyId === editing.id ? 'Working…' : 'Regenerate'}</button>
            <button type="button" disabled={busyId === editing.id} onClick={() => void toggleEnabled(editing)}>{editing.enabled ? 'Disable' : 'Enable'}</button>
            <button type="button" className="application-review-advance" disabled={busyId === editing.id} onClick={() => void saveSelected()}>{busyId === editing.id ? 'Saving…' : 'Save & update page'}</button>
          </div>
        </footer>
      </section>
    </div> : null}
  </section>;
}
