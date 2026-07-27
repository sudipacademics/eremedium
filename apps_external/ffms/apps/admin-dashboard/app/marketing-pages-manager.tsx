'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { RFMS_MARKETING_ORIGIN } from '@rfms/utils';
import './marketing-pages-manager.css';

type ModelCard = {
  is_published: boolean;
  title: string;
  subtitle: string;
  description: string;
  image_url: string;
  features: string[];
  button_text: string;
  button_url: string;
  sort_order: number;
};

type HomepageModels = {
  is_published: boolean;
  heading: string;
  intro: string;
  fofo: ModelCard;
  foco: ModelCard;
};

type FaqItem = { id: string; question: string; answer: string };
type FeatureItem = { id: string; title: string; description: string; image_url?: string };
type TimelineStep = { id: string; title: string; description: string };
type InvestmentItem = { id: string; label: string; value: string; description: string };
type HeroSlide = { id: string; image_url: string; alt: string; sort_order: number; is_published: boolean };

type ModelPage = {
  is_published: boolean;
  updated_at?: string;
  seo: { title: string; description: string; keywords: string };
  hero: { title: string; subtitle: string; description: string; banner_image_url: string; slides: HeroSlide[]; cta_text: string; cta_url: string };
  calculator: { is_published: boolean; sort_order: number; title: string; note: string };
  success_story: { is_published: boolean; sort_order: number; title: string; subtitle: string; body: string; youtube_embed_code: string; youtube_embed_url: string; image_url: string };
  territory: { is_published: boolean; sort_order: number; title: string; subtitle: string; description: string; map_labels: string[]; image_url: string };
  support_timeline: { is_published: boolean; sort_order: number; title: string; steps: TimelineStep[] };
  investment: { is_published: boolean; sort_order: number; title: string; items: InvestmentItem[] };
  benefits: { is_published: boolean; sort_order: number; title: string; items: FeatureItem[] };
  faqs: { is_published: boolean; sort_order: number; title: string; items: FaqItem[] };
  features: { is_published: boolean; sort_order: number; title: string; items: FeatureItem[] };
  cta: { is_published: boolean; sort_order: number; title: string; description: string; button_text: string; button_url: string };
};

type MarketingPages = { homepage_models: HomepageModels; fofo_page: ModelPage; foco_page: ModelPage };

const API_BASE = process.env.NEXT_PUBLIC_RFMS_API_URL ?? 'http://localhost:8080/api/v1';

function currentToken() { return typeof window === 'undefined' ? '' : sessionStorage.getItem('rfms_auth_token') ?? ''; }

function asDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read file.'));
    reader.onerror = () => reject(new Error('Unable to read file.'));
    reader.readAsDataURL(file);
  });
}

async function cmsRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = currentToken();
  if (!token) throw new Error('A Super Admin session is required to manage public content.');
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? 'Unable to save marketing page content.');
  return payload.data as T;
}

function previewUrl(embedCode: string) {
  const source = embedCode.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] ?? embedCode.trim();
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && url.pathname.startsWith('/embed/') ? url.toString() : '';
  } catch { return ''; }
}

function linesToFeatures(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function featuresToLines(items: string[]) {
  return items.join('\n');
}

function syncHeroBanner(hero: ModelPage['hero']): ModelPage['hero'] {
  const slides = [...(hero.slides ?? [])].sort((first, second) => first.sort_order - second.sort_order);
  return { ...hero, slides, banner_image_url: slides.find((slide) => slide.is_published !== false && slide.image_url)?.image_url ?? hero.banner_image_url ?? '' };
}

function HeroSlidesEditor({
  slides,
  onChange,
  onUploadImage,
}: {
  slides: HeroSlide[];
  onChange: (slides: HeroSlide[]) => void;
  onUploadImage: (file: File) => Promise<string>;
}) {
  async function addSlide(file: File) {
    const imageUrl = await onUploadImage(file);
    onChange([...slides, { id: crypto.randomUUID(), image_url: imageUrl, alt: '', sort_order: slides.length + 1, is_published: true }]);
  }

  function updateSlide(id: string, patch: Partial<HeroSlide>) {
    onChange(slides.map((slide) => slide.id === id ? { ...slide, ...patch } : slide));
  }

  function removeSlide(id: string) {
    onChange(slides.filter((slide) => slide.id !== id));
  }

  return <div className="hero-slides-editor">
    <p className="hero-slides-help">Upload multiple hero images. They auto-play on the public FOFO/FOCO page every 6 seconds.</p>
    {slides.length ? slides.map((slide) => (
      <article className="hero-slide-item" key={slide.id}>
        {slide.image_url ? <img className="marketing-preview-image" src={slide.image_url} alt="" /> : null}
        <label>Alt text<input value={slide.alt} onChange={(event) => updateSlide(slide.id, { alt: event.target.value })} placeholder="Describe the image for accessibility" /></label>
        <div className="content-form-row">
          <label>Display order<input type="number" min="0" value={slide.sort_order} onChange={(event) => updateSlide(slide.id, { sort_order: Number(event.target.value) || 0 })} /></label>
          <label className="check-label"><input type="checkbox" checked={slide.is_published} onChange={(event) => updateSlide(slide.id, { is_published: event.target.checked })} /> Publish slide</label>
        </div>
        <button type="button" className="danger" onClick={() => removeSlide(slide.id)}>Remove slide</button>
      </article>
    )) : <p className="content-empty">No hero slides yet. Upload images to start the auto-playing hero slider.</p>}
    <label className="upload-label">Add hero slide image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addSlide(file).finally(() => { event.target.value = ''; }); }} /></label>
  </div>;
}

function ModelCardEditor({
  label,
  card,
  onChange,
  onUploadImage,
  previewPath,
}: {
  label: string;
  card: ModelCard;
  onChange: (next: ModelCard) => void;
  onUploadImage: (file: File) => Promise<void>;
  previewPath: string;
}) {
  return <div className="marketing-card-editor">
    <div className="marketing-card-editor-head"><h3>{label}</h3><a href={`${RFMS_MARKETING_ORIGIN}${previewPath}`} target="_blank" rel="noreferrer">Open live preview</a></div>
    <label className="check-label"><input type="checkbox" checked={card.is_published} onChange={(event) => onChange({ ...card, is_published: event.target.checked })} /> Publish on homepage</label>
    <label>Card title<input value={card.title} onChange={(event) => onChange({ ...card, title: event.target.value })} /></label>
    <label>Subtitle<input value={card.subtitle} onChange={(event) => onChange({ ...card, subtitle: event.target.value })} /></label>
    <label>Description<textarea value={card.description} onChange={(event) => onChange({ ...card, description: event.target.value })} /></label>
    <label>Feature bullets (one per line)<textarea value={featuresToLines(card.features)} onChange={(event) => onChange({ ...card, features: linesToFeatures(event.target.value) })} /></label>
    <label>Card image URL<input value={card.image_url} onChange={(event) => onChange({ ...card, image_url: event.target.value })} placeholder="https://... or uploaded image URL" /></label>
    <label className="upload-label">Upload card image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onUploadImage(file).finally(() => { event.target.value = ''; }); }} /></label>
    {card.image_url ? <img className="marketing-preview-image" src={card.image_url} alt="" /> : null}
    <div className="content-form-row">
      <label>Button text<input value={card.button_text} onChange={(event) => onChange({ ...card, button_text: event.target.value })} /></label>
      <label>Button link<input value={card.button_url} onChange={(event) => onChange({ ...card, button_url: event.target.value })} placeholder="/fofo or https://..." /></label>
    </div>
    <label>Display order<input type="number" min="0" value={card.sort_order} onChange={(event) => onChange({ ...card, sort_order: Number(event.target.value) || 0 })} /></label>
  </div>;
}

function ModelPageEditor({
  model,
  page,
  onChange,
  onSave,
  busy,
}: {
  model: 'FOFO' | 'FOCO';
  page: ModelPage;
  onChange: (next: ModelPage) => void;
  onSave: (event: FormEvent) => void;
  busy: boolean;
}) {
  const previewPath = model === 'FOFO' ? '/fofo' : '/foco';

  async function uploadImage(file: File, target: (url: string) => void) {
    const uploaded = await cmsRequest<{ image_url: string }>('/admin/content/marketing-pages/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: await asDataUrl(file) }),
    });
    target(uploaded.image_url);
    return uploaded.image_url;
  }

  const embedPreview = previewUrl(page.success_story.youtube_embed_code);

  return <form className="marketing-page-editor" onSubmit={onSave}>
    <div className="marketing-card-editor-head"><h3>{model} franchise page</h3><a href={`${RFMS_MARKETING_ORIGIN}${previewPath}`} target="_blank" rel="noreferrer">Open live preview</a></div>
    <label className="check-label"><input type="checkbox" checked={page.is_published} onChange={(event) => onChange({ ...page, is_published: event.target.checked })} /> Publish {model} page</label>

    <div className="marketing-section-block"><h4>SEO metadata</h4>
      <label>Page title<input value={page.seo.title} onChange={(event) => onChange({ ...page, seo: { ...page.seo, title: event.target.value } })} /></label>
      <label>Meta description<textarea value={page.seo.description} onChange={(event) => onChange({ ...page, seo: { ...page.seo, description: event.target.value } })} /></label>
      <label>Keywords<input value={page.seo.keywords} onChange={(event) => onChange({ ...page, seo: { ...page.seo, keywords: event.target.value } })} /></label>
    </div>

    <div className="marketing-section-block"><h4>Hero banner &amp; slider</h4>
      <label>Hero title<input value={page.hero.title} onChange={(event) => onChange({ ...page, hero: { ...page.hero, title: event.target.value } })} /></label>
      <label>Hero subtitle<input value={page.hero.subtitle} onChange={(event) => onChange({ ...page, hero: { ...page.hero, subtitle: event.target.value } })} /></label>
      <label>Hero description<textarea value={page.hero.description} onChange={(event) => onChange({ ...page, hero: { ...page.hero, description: event.target.value } })} /></label>
      <HeroSlidesEditor
        slides={page.hero.slides ?? []}
        onChange={(slides) => onChange({ ...page, hero: syncHeroBanner({ ...page.hero, slides }) })}
        onUploadImage={(file) => uploadImage(file, (url) => url)}
      />
      <div className="content-form-row">
        <label>CTA button text<input value={page.hero.cta_text} onChange={(event) => onChange({ ...page, hero: { ...page.hero, cta_text: event.target.value } })} /></label>
        <label>CTA button URL<input value={page.hero.cta_url} onChange={(event) => onChange({ ...page, hero: { ...page.hero, cta_url: event.target.value } })} placeholder="Leave blank to use applicant portal" /></label>
      </div>
    </div>

    <div className="marketing-section-block"><h4>Calculator section</h4>
      <label className="check-label"><input type="checkbox" checked={page.calculator.is_published} onChange={(event) => onChange({ ...page, calculator: { ...page.calculator, is_published: event.target.checked } })} /> Show calculator</label>
      <label>Section order<input type="number" min="0" value={page.calculator.sort_order} onChange={(event) => onChange({ ...page, calculator: { ...page.calculator, sort_order: Number(event.target.value) || 0 } })} /></label>
      <label>Section title<input value={page.calculator.title} onChange={(event) => onChange({ ...page, calculator: { ...page.calculator, title: event.target.value } })} /></label>
      <label>Footnote / rich note<textarea value={page.calculator.note} onChange={(event) => onChange({ ...page, calculator: { ...page.calculator, note: event.target.value } })} /></label>
    </div>

    <div className="marketing-section-block"><h4>Success story</h4>
      <label className="check-label"><input type="checkbox" checked={page.success_story.is_published} onChange={(event) => onChange({ ...page, success_story: { ...page.success_story, is_published: event.target.checked } })} /> Show success story</label>
      <label>Section order<input type="number" min="0" value={page.success_story.sort_order} onChange={(event) => onChange({ ...page, success_story: { ...page.success_story, sort_order: Number(event.target.value) || 0 } })} /></label>
      <label>Section title<input value={page.success_story.title} onChange={(event) => onChange({ ...page, success_story: { ...page.success_story, title: event.target.value } })} /></label>
      <label>Subtitle<input value={page.success_story.subtitle} onChange={(event) => onChange({ ...page, success_story: { ...page.success_story, subtitle: event.target.value } })} /></label>
      <label>Story body<textarea value={page.success_story.body} onChange={(event) => onChange({ ...page, success_story: { ...page.success_story, body: event.target.value } })} /></label>
      <label>YouTube embed code<textarea value={page.success_story.youtube_embed_code} onChange={(event) => onChange({ ...page, success_story: { ...page.success_story, youtube_embed_code: event.target.value } })} placeholder={'<iframe src="https://www.youtube.com/embed/..." ...></iframe>'} /></label>
      <label>Fallback image URL<input value={page.success_story.image_url} onChange={(event) => onChange({ ...page, success_story: { ...page.success_story, image_url: event.target.value } })} /></label>
      <label className="upload-label">Upload fallback image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file, (url) => onChange({ ...page, success_story: { ...page.success_story, image_url: url } })).finally(() => { event.target.value = ''; }); }} /></label>
      {embedPreview ? <div className="video-preview"><iframe src={embedPreview} title={`${model} story preview`} allowFullScreen /></div> : null}
    </div>

    <div className="marketing-section-block"><h4>Territory section</h4>
      <label className="check-label"><input type="checkbox" checked={page.territory.is_published} onChange={(event) => onChange({ ...page, territory: { ...page.territory, is_published: event.target.checked } })} /> Show territory section</label>
      <label>Section order<input type="number" min="0" value={page.territory.sort_order} onChange={(event) => onChange({ ...page, territory: { ...page.territory, sort_order: Number(event.target.value) || 0 } })} /></label>
      <label>Section title<input value={page.territory.title} onChange={(event) => onChange({ ...page, territory: { ...page.territory, title: event.target.value } })} /></label>
      <label>Section subtitle<input value={page.territory.subtitle ?? ''} onChange={(event) => onChange({ ...page, territory: { ...page.territory, subtitle: event.target.value } })} /></label>
      <label>Footer note<textarea value={page.territory.description} onChange={(event) => onChange({ ...page, territory: { ...page.territory, description: event.target.value } })} /></label>
      <p className="hero-slides-help">Available territories are loaded automatically from the Territory Module. FOFO and FOCO pages show only matching available PIN codes in a fixed-height scroll list.</p>
    </div>

    <div className="marketing-section-block"><h4>Investment details</h4>
      <label className="check-label"><input type="checkbox" checked={page.investment.is_published} onChange={(event) => onChange({ ...page, investment: { ...page.investment, is_published: event.target.checked } })} /> Show investment section</label>
      <label>Section order<input type="number" min="0" value={page.investment.sort_order} onChange={(event) => onChange({ ...page, investment: { ...page.investment, sort_order: Number(event.target.value) || 0 } })} /></label>
      <label>Section title<input value={page.investment.title} onChange={(event) => onChange({ ...page, investment: { ...page.investment, title: event.target.value } })} /></label>
      <label>Investment items (label | value | description per line)<textarea className="marketing-steps-input" value={page.investment.items.map((item) => `${item.label} | ${item.value} | ${item.description}`).join('\n')} onChange={(event) => onChange({ ...page, investment: { ...page.investment, items: linesToFeatures(event.target.value).map((line, index) => { const [label, value, ...rest] = line.split('|'); return { id: page.investment.items[index]?.id ?? `investment-${index}`, label: (label ?? '').trim(), value: (value ?? '').trim(), description: rest.join('|').trim() }; }).filter((item) => item.label) } })} /></label>
    </div>

    <div className="marketing-section-block"><h4>Support timeline</h4>
      <label className="check-label"><input type="checkbox" checked={page.support_timeline.is_published} onChange={(event) => onChange({ ...page, support_timeline: { ...page.support_timeline, is_published: event.target.checked } })} /> Show support timeline</label>
      <label>Section order<input type="number" min="0" value={page.support_timeline.sort_order} onChange={(event) => onChange({ ...page, support_timeline: { ...page.support_timeline, sort_order: Number(event.target.value) || 0 } })} /></label>
      <label>Section title<input value={page.support_timeline.title} onChange={(event) => onChange({ ...page, support_timeline: { ...page.support_timeline, title: event.target.value } })} /></label>
      <label>Steps (title | description per line)<textarea className="marketing-steps-input" value={page.support_timeline.steps.map((step) => `${step.title} | ${step.description}`).join('\n')} onChange={(event) => onChange({ ...page, support_timeline: { ...page.support_timeline, steps: linesToFeatures(event.target.value).map((line, index) => { const [title, ...rest] = line.split('|'); return { id: page.support_timeline.steps[index]?.id ?? `step-${index}`, title: (title ?? '').trim(), description: rest.join('|').trim() }; }).filter((step) => step.title) } })} /></label>
    </div>

    <div className="marketing-section-block"><h4>Benefits</h4>
      <label className="check-label"><input type="checkbox" checked={page.benefits.is_published} onChange={(event) => onChange({ ...page, benefits: { ...page.benefits, is_published: event.target.checked } })} /> Show benefits</label>
      <label>Section order<input type="number" min="0" value={page.benefits.sort_order} onChange={(event) => onChange({ ...page, benefits: { ...page.benefits, sort_order: Number(event.target.value) || 0 } })} /></label>
      <label>Section title<input value={page.benefits.title} onChange={(event) => onChange({ ...page, benefits: { ...page.benefits, title: event.target.value } })} /></label>
      <label>Benefit items (title | description per line)<textarea className="marketing-steps-input" value={page.benefits.items.map((item) => `${item.title} | ${item.description}`).join('\n')} onChange={(event) => onChange({ ...page, benefits: { ...page.benefits, items: linesToFeatures(event.target.value).map((line, index) => { const [title, ...rest] = line.split('|'); return { id: page.benefits.items[index]?.id ?? `benefit-${index}`, title: (title ?? '').trim(), description: rest.join('|').trim() }; }).filter((item) => item.title) } })} /></label>
    </div>

    <div className="marketing-section-block"><h4>Key features</h4>
      <label className="check-label"><input type="checkbox" checked={page.features.is_published} onChange={(event) => onChange({ ...page, features: { ...page.features, is_published: event.target.checked } })} /> Show key features</label>
      <label>Section order<input type="number" min="0" value={page.features.sort_order} onChange={(event) => onChange({ ...page, features: { ...page.features, sort_order: Number(event.target.value) || 0 } })} /></label>
      <label>Section title<input value={page.features.title} onChange={(event) => onChange({ ...page, features: { ...page.features, title: event.target.value } })} /></label>
      <label>Feature items (title | description per line)<textarea className="marketing-steps-input" value={page.features.items.map((item) => `${item.title} | ${item.description}`).join('\n')} onChange={(event) => onChange({ ...page, features: { ...page.features, items: linesToFeatures(event.target.value).map((line, index) => { const [title, ...rest] = line.split('|'); return { id: page.features.items[index]?.id ?? `feature-${index}`, title: (title ?? '').trim(), description: rest.join('|').trim() }; }).filter((item) => item.title) } })} /></label>
    </div>

    <div className="marketing-section-block"><h4>FAQs</h4>
      <label className="check-label"><input type="checkbox" checked={page.faqs.is_published} onChange={(event) => onChange({ ...page, faqs: { ...page.faqs, is_published: event.target.checked } })} /> Show FAQs</label>
      <label>Section order<input type="number" min="0" value={page.faqs.sort_order} onChange={(event) => onChange({ ...page, faqs: { ...page.faqs, sort_order: Number(event.target.value) || 0 } })} /></label>
      <label>Section title<input value={page.faqs.title} onChange={(event) => onChange({ ...page, faqs: { ...page.faqs, title: event.target.value } })} /></label>
      <label>FAQ items (question | answer per line)<textarea className="marketing-steps-input" value={page.faqs.items.map((item) => `${item.question} | ${item.answer}`).join('\n')} onChange={(event) => onChange({ ...page, faqs: { ...page.faqs, items: linesToFeatures(event.target.value).map((line, index) => { const [question, ...rest] = line.split('|'); return { id: page.faqs.items[index]?.id ?? `faq-${index}`, question: (question ?? '').trim(), answer: rest.join('|').trim() }; }).filter((item) => item.question && item.answer) } })} /></label>
    </div>

    <div className="marketing-section-block"><h4>Closing call-to-action</h4>
      <label className="check-label"><input type="checkbox" checked={page.cta.is_published} onChange={(event) => onChange({ ...page, cta: { ...page.cta, is_published: event.target.checked } })} /> Show CTA section</label>
      <label>Section order<input type="number" min="0" value={page.cta.sort_order} onChange={(event) => onChange({ ...page, cta: { ...page.cta, sort_order: Number(event.target.value) || 0 } })} /></label>
      <label>CTA title<input value={page.cta.title} onChange={(event) => onChange({ ...page, cta: { ...page.cta, title: event.target.value } })} /></label>
      <label>CTA description<textarea value={page.cta.description} onChange={(event) => onChange({ ...page, cta: { ...page.cta, description: event.target.value } })} /></label>
      <div className="content-form-row">
        <label>Button text<input value={page.cta.button_text} onChange={(event) => onChange({ ...page, cta: { ...page.cta, button_text: event.target.value } })} /></label>
        <label>Button URL<input value={page.cta.button_url} onChange={(event) => onChange({ ...page, cta: { ...page.cta, button_url: event.target.value } })} /></label>
      </div>
    </div>

    <button className="content-submit" disabled={busy}>{busy ? 'Saving…' : `Save ${model} page content`}</button>
  </form>;
}

export function MarketingPagesManager({ notify }: { notify: (message: string) => void }) {
  const [tab, setTab] = useState<'homepage' | 'fofo' | 'foco'>('homepage');
  const [pages, setPages] = useState<MarketingPages | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentToken()) return;
    try {
      const data = await cmsRequest<MarketingPages>('/admin/content/marketing-pages');
      setPages(data);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load marketing page content.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function uploadCardImage(model: 'fofo' | 'foco', file: File) {
    const uploaded = await cmsRequest<{ image_url: string }>('/admin/content/marketing-pages/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_url: await asDataUrl(file) }),
    });
    setPages((current) => current ? { ...current, homepage_models: { ...current.homepage_models, [model]: { ...current.homepage_models[model], image_url: uploaded.image_url } } } : current);
  }

  async function saveHomepage(event: FormEvent) {
    event.preventDefault();
    if (!pages) return;
    setBusy(true);
    try {
      const saved = await cmsRequest<MarketingPages>('/admin/content/marketing-pages/homepage-models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homepage_models: pages.homepage_models }),
      });
      setPages(saved);
      notify('Homepage FOFO/FOCO model cards published.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save homepage model cards.');
    } finally {
      setBusy(false);
    }
  }

  async function saveModelPage(model: 'fofo' | 'foco', event: FormEvent) {
    event.preventDefault();
    if (!pages) return;
    setBusy(true);
    try {
      const path = model === 'fofo' ? '/admin/content/marketing-pages/fofo' : '/admin/content/marketing-pages/foco';
      const bodyKey = model === 'fofo' ? 'fofo_page' : 'foco_page';
      const saved = await cmsRequest<MarketingPages>(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [bodyKey]: pages[bodyKey] }),
      });
      setPages(saved);
      notify(`${model} page content published on the marketing website.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Unable to save the ${model} page.`);
    } finally {
      setBusy(false);
    }
  }

  if (!pages) {
    return <section className="panel content-editor"><p className="content-empty">{error || 'Loading marketing page content…'}</p></section>;
  }

  return <div className="marketing-pages-manager">
    <div className="marketing-tabs">
      <button type="button" className={tab === 'homepage' ? 'active' : ''} onClick={() => setTab('homepage')}>Homepage model cards</button>
      <button type="button" className={tab === 'fofo' ? 'active' : ''} onClick={() => setTab('fofo')}>FOFO page</button>
      <button type="button" className={tab === 'foco' ? 'active' : ''} onClick={() => setTab('foco')}>FOCO page</button>
    </div>
    {error ? <p className="content-error" role="alert">{error}</p> : null}

    {tab === 'homepage' ? <section className="panel content-editor">
      <div className="panel-head"><div><h2>Homepage FOFO &amp; FOCO cards</h2><p>Edit the highlighted franchise model cards on the public homepage. FOFO and FOCO content is managed independently.</p></div></div>
      <form onSubmit={(event) => void saveHomepage(event)}>
        <label className="check-label"><input type="checkbox" checked={pages.homepage_models.is_published} onChange={(event) => setPages({ ...pages, homepage_models: { ...pages.homepage_models, is_published: event.target.checked } })} /> Publish homepage model section</label>
        <label>Section heading<input value={pages.homepage_models.heading} onChange={(event) => setPages({ ...pages, homepage_models: { ...pages.homepage_models, heading: event.target.value } })} required /></label>
        <label>Section intro<textarea value={pages.homepage_models.intro} onChange={(event) => setPages({ ...pages, homepage_models: { ...pages.homepage_models, intro: event.target.value } })} required /></label>
        <div className="marketing-card-grid">
          <ModelCardEditor label="FOFO card" card={pages.homepage_models.fofo} previewPath="/fofo" onChange={(fofo) => setPages({ ...pages, homepage_models: { ...pages.homepage_models, fofo } })} onUploadImage={(file) => uploadCardImage('fofo', file)} />
          <ModelCardEditor label="FOCO card" card={pages.homepage_models.foco} previewPath="/foco" onChange={(foco) => setPages({ ...pages, homepage_models: { ...pages.homepage_models, foco } })} onUploadImage={(file) => uploadCardImage('foco', file)} />
        </div>
        <button className="content-submit" disabled={busy}>{busy ? 'Saving…' : 'Save homepage model cards'}</button>
      </form>
    </section> : null}

    {tab === 'fofo' ? <section className="panel content-editor"><ModelPageEditor model="FOFO" page={pages.fofo_page} onChange={(fofo_page) => setPages({ ...pages, fofo_page })} onSave={(event) => void saveModelPage('fofo', event)} busy={busy} /></section> : null}
    {tab === 'foco' ? <section className="panel content-editor"><ModelPageEditor model="FOCO" page={pages.foco_page} onChange={(foco_page) => setPages({ ...pages, foco_page })} onSave={(event) => void saveModelPage('foco', event)} busy={busy} /></section> : null}
  </div>;
}
