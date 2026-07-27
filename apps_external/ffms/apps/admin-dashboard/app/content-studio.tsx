'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { HeroSliderManager } from './hero-slider-manager';
import { MarketingPagesManager } from './marketing-pages-manager';

type SuccessStory = { id: string; title: string; youtube_embed_code: string; youtube_embed_url: string; is_published: boolean; sort_order: number };
type TrainingVideo = { id: string; title: string; description: string; youtube_embed_code: string; youtube_embed_url: string; video_url: string; duration_minutes: number; franchise_models: ('FOFO' | 'FOCO')[]; sort_order: number; is_published: boolean };
type FeaturedFranchisee = { id: string; name: string; location: string; franchise_type: 'FOFO' | 'FOCO'; image_url: string; is_featured: boolean; sort_order: number };
type CompanyProfile = {
  company_name: string; legal_name: string; logo_url: string; franchise_hub_name: string; office_address: string; company_email: string; company_phone: string; whatsapp_number: string; google_map_embed_url: string;
  why_remedium_eyebrow: string; why_remedium_title: string; why_remedium_intro: string; why_remedium_body: string;
  why_remedium_point_one: string; why_remedium_point_two: string; why_remedium_point_three: string; why_remedium_badge_url: string;
  brochure_url: string; footer_disclaimer: string; footer_terms: string; fofo_terms: string; foco_terms: string; foco_phase_2_terms: string; foco_phase_3_terms: string; agreement_terms: string;
};

const API_BASE = process.env.NEXT_PUBLIC_RFMS_API_URL ?? 'http://localhost:8080/api/v1';
const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  company_name: 'Remedium Lab', legal_name: 'Remedium Lab', logo_url: '/remedium-lab-logo.png',
  franchise_hub_name: 'Remedium Lab Franchisee Hub', office_address: 'ASO210, Astra Towers, 2C/1, AA II, C, Newtown, Reckjoani, Kolkata, West Bengal 700156', company_email: '', company_phone: '', whatsapp_number: '',
  google_map_embed_url: 'https://www.google.com/maps?q=ASO210%2C%20Astra%20Towers%2C%20Newtown%2C%20Kolkata%20700156&output=embed',
  why_remedium_eyebrow: 'Why Remedium Lab',
  why_remedium_title: 'Build a diagnostic business that serves society.',
  why_remedium_intro: "Partner with Eastern India's fair-price diagnostics brand and bring dependable testing closer to every community.",
  why_remedium_body: 'Remedium Lab combines an NABL-accredited quality approach with structured franchise support, transparent processes and a patient-first purpose. Our franchise model helps local entrepreneurs build a trusted diagnostic business while supporting accessible healthcare in their communities.',
  why_remedium_point_one: 'NABL-accredited quality systems designed for reliable diagnostic reporting.',
  why_remedium_point_two: 'Fair-price diagnostics that help make essential testing more accessible.',
  why_remedium_point_three: 'Training, launch guidance and ongoing operational support for every franchise partner.',
  why_remedium_badge_url: '/nabl-accreditation-badge.svg',
  brochure_url: '',
  footer_disclaimer: 'Information on this website is for franchise opportunity discussion only. Financial estimates, territory availability, timelines and approval outcomes are indicative and subject to Remedium Lab review, applicable law and the final signed agreement.',
  footer_terms: 'By using this website or submitting an enquiry, you agree that the information you provide may be used by Remedium Lab to assess and respond to your franchise enquiry. This website does not constitute an offer, guarantee of franchise approval, financial advice or a promise of business performance.',
  fofo_terms: 'FOFO franchise terms and conditions\n\n1. The applicant will operate the franchise centre in accordance with Remedium Lab quality, branding and operating standards.\n2. Territory allocation, application approval and launch timelines are subject to Remedium Lab review and the final franchise agreement.\n3. The one-time FOFO franchise fee is payable after the application is accepted for processing.\n4. Business outcomes are not guaranteed. The franchisee remains responsible for local operating costs, legal compliance and approved centre operations.',
  foco_terms: 'FOCO franchise terms and conditions\n\n1. The applicant will participate in the FOCO model subject to Remedium Lab operational, quality and territory approval.\n2. The FOCO payment plan includes the application fee, franchise fee and security deposit at the stages shown in the application.\n3. Location allotment, onboarding and final agreement are completed only after the relevant review and payment stage.\n4. Business outcomes are not guaranteed. All rights and obligations are governed by the final signed franchise agreement.',
  foco_phase_2_terms: 'FOCO Phase 2 payment terms and conditions\n\n1. The Phase 2 franchise fee becomes payable only after Remedium Lab issues the Territory Allotment Letter and a manager releases this payment stage.\n2. Payment of the franchise fee confirms that the applicant accepts the allotted territory, approved onboarding plan and applicable operating requirements.\n3. Phase 2 payment does not replace the final franchise agreement, security deposit or any later compliance requirement.\n4. The applicant must review these terms and accept them before making the Phase 2 payment. All payments remain subject to verification by Remedium Lab.',
  foco_phase_3_terms: 'FOCO Phase 3 security deposit terms and conditions\n\n1. The security deposit becomes payable only after Remedium Lab approves Branding Signage and HR Process and a manager releases this payment stage.\n2. Payment of the security deposit confirms acceptance of the final onboarding review and franchise agreement workflow.\n3. The security deposit does not replace any later compliance requirement, audit request or contractual obligation.\n4. The applicant must review these terms and accept them before making the Phase 3 payment. All payments remain subject to verification by Remedium Lab.',
  agreement_terms: 'Franchise Agreement Terms & Conditions\n\n1. The applicant confirms that they have read the complete franchise agreement presented in the Agreement Module.\n2. Acceptance of these terms authorises Remedium Lab to proceed with Aadhaar eSign and company execution steps.\n3. All rights, obligations, territory conditions and payment confirmations remain subject to the final executed franchise agreement.\n4. Business outcomes are not guaranteed. This acceptance does not replace statutory, regulatory or contractual requirements applicable to the franchise relationship.',
};

function currentToken() { return typeof window === 'undefined' ? '' : sessionStorage.getItem('rfms_auth_token') ?? ''; }

function previewUrl(embedCode: string) {
  const source = embedCode.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] ?? embedCode.trim();
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(url.hostname) && url.pathname.startsWith('/embed/') ? url.toString() : '';
  } catch { return ''; }
}

function asCompanyProfile(value: unknown): CompanyProfile {
  if (!value || typeof value !== 'object') return DEFAULT_COMPANY_PROFILE;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(DEFAULT_COMPANY_PROFILE).map(([key, fallback]) => [key, typeof source[key] === 'string' && source[key].trim() ? source[key].trim() : fallback])) as CompanyProfile;
}

function asDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read the logo file.')); reader.onerror = () => reject(new Error('Unable to read the logo file.')); reader.readAsDataURL(file); });
}

function expireLocalSession() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem('rfms_auth_token');
  sessionStorage.removeItem('rfms_user_name');
  sessionStorage.removeItem('rfms_user_role');
  window.dispatchEvent(new Event('rfms-session-expired'));
}

async function cmsRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = currentToken();
  if (!token) throw new Error('A Super Admin session is required to manage public content.');
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    if (response.status === 403) {
      expireLocalSession();
      throw new Error('Your local RFMS session expired after the service restarted. Please sign in again.');
    }
    if (response.status === 404) throw new Error('Your RFMS local service is an older version. Close its terminal, run run-admin.cmd again, then sign in again.');
    throw new Error(payload?.error?.message ?? 'Unable to save the content.');
  }
  return payload.data as T;
}

export function ContentStudio({ notify }: { notify: (message: string) => void }) {
  const [company, setCompany] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);
  const [stories, setStories] = useState<SuccessStory[]>([]);
  const [trainingVideos, setTrainingVideos] = useState<TrainingVideo[]>([]);
  const [franchisees, setFranchisees] = useState<FeaturedFranchisee[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingLogo, setPendingLogo] = useState<{ name: string; dataUrl: string } | null>(null);
  const [story, setStory] = useState({ title: '', youtube_embed_code: '', is_published: true, sort_order: 0 });
  const [trainingVideo, setTrainingVideo] = useState({ title: '', description: '', youtube_embed_code: '', duration_minutes: 15, sort_order: 1, fofo: true, foco: true, is_published: true });
  const [franchisee, setFranchisee] = useState({ name: '', location: '', franchise_type: 'FOFO' as 'FOFO' | 'FOCO', image_url: '', is_featured: true, sort_order: 0 });

  const refresh = useCallback(async () => {
    if (!currentToken()) return;
    try {
      const [companyData, storyData, trainingVideoData, franchiseeData] = await Promise.all([
        cmsRequest<CompanyProfile>('/content/settings'),
        cmsRequest<SuccessStory[]>('/admin/content/success-stories'),
        cmsRequest<TrainingVideo[]>('/admin/content/training-videos'),
        cmsRequest<FeaturedFranchisee[]>('/admin/content/featured-franchisees'),
      ]);
      setCompany(asCompanyProfile(companyData)); setStories(storyData); setTrainingVideos(trainingVideoData); setFranchisees(franchiseeData); setError('');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to load CMS content.'); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function saveCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      let profile = company;
      const includesLogo = Boolean(pendingLogo);
      if (pendingLogo) {
        const uploaded = await cmsRequest<CompanyProfile>('/admin/content/company-profile/logo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_url: pendingLogo.dataUrl }) });
        profile = asCompanyProfile(uploaded);
        setPendingLogo(null);
      }
      const saved = await cmsRequest<{ key: string; value: CompanyProfile }>('/admin/content/settings/company-profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: profile }) });
      setCompany(asCompanyProfile(saved.value)); setError(''); notify(includesLogo ? 'Company details and logo uploaded successfully.' : 'Company details saved. Refresh the public website to see them.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save company details.'); } finally { setBusy(false); }
  }

  async function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const logo = event.target.files?.[0]; if (!logo) return;
    const acceptedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
    if (!acceptedTypes.has(logo.type) || logo.size > 5 * 1024 * 1024) {
      setError('Choose a PNG, JPG or WEBP logo smaller than 5 MB.');
      event.target.value = '';
      return;
    }
    setBusy(true);
    try {
      setPendingLogo({ name: logo.name, dataUrl: await asDataUrl(logo) });
      setError('');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to read the logo file.'); } finally { setBusy(false); event.target.value = ''; }
  }

  async function uploadPendingLogo() {
    if (!pendingLogo) return;
    setBusy(true);
    try {
      const saved = await cmsRequest<CompanyProfile>('/admin/content/company-profile/logo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_url: pendingLogo.dataUrl }) });
      setCompany(asCompanyProfile(saved)); setPendingLogo(null); setError(''); notify('Logo uploaded and published on the public website.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to upload the logo.'); } finally { setBusy(false); }
  }

  async function saveWhyRemedium(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const saved = await cmsRequest<{ key: string; value: CompanyProfile }>('/admin/content/settings/company-profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: company }) });
      setCompany(asCompanyProfile(saved.value)); setError(''); notify('Why Remedium content published on the marketing website.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save Why Remedium content.'); } finally { setBusy(false); }
  }

  async function uploadWhyRemediumBadge(event: ChangeEvent<HTMLInputElement>) {
    const badge = event.target.files?.[0]; if (!badge) return;
    const acceptedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
    if (!acceptedTypes.has(badge.type) || badge.size > 5 * 1024 * 1024) {
      setError('Choose a PNG, JPG or WEBP accreditation image smaller than 5 MB.'); event.target.value = ''; return;
    }
    setBusy(true);
    try {
      const uploaded = await cmsRequest<CompanyProfile>('/admin/content/why-remedium/badge-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_url: await asDataUrl(badge) }) });
      setCompany(asCompanyProfile(uploaded)); setError(''); notify('NABL accreditation image uploaded.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to upload the accreditation image.'); } finally { setBusy(false); event.target.value = ''; }
  }

  async function saveFooterContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const saved = await cmsRequest<{ key: string; value: CompanyProfile }>('/admin/content/settings/company-profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: company }) });
      setCompany(asCompanyProfile(saved.value)); setError(''); notify('Footer details, disclaimer and terms published.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save the footer content.'); } finally { setBusy(false); }
  }

  async function saveFranchiseTerms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const saved = await cmsRequest<{ key: string; value: CompanyProfile }>('/admin/content/settings/company-profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: company }) });
      setCompany(asCompanyProfile(saved.value)); setError(''); notify('FOFO, FOCO, FOCO Phase 2 and FOCO Phase 3 payment terms published for applicant acceptance.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save the franchise terms.'); } finally { setBusy(false); }
  }

  async function uploadBrochure(event: ChangeEvent<HTMLInputElement>) {
    const brochure = event.target.files?.[0]; if (!brochure) return;
    const hasPdfExtension = brochure.name.toLowerCase().endsWith('.pdf');
    if ((!hasPdfExtension && brochure.type !== 'application/pdf') || brochure.size > 25 * 1024 * 1024) {
      setError('Choose a valid PDF brochure smaller than 25 MB.'); event.target.value = ''; return;
    }
    setBusy(true);
    try {
      const uploaded = await cmsRequest<CompanyProfile>('/admin/content/footer/brochure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_url: await asDataUrl(brochure) }) });
      setCompany(asCompanyProfile(uploaded)); setError(''); notify('Franchise brochure uploaded and ready to download.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to upload the brochure.'); } finally { setBusy(false); event.target.value = ''; }
  }

  async function saveStory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const created = await cmsRequest<SuccessStory>('/admin/content/success-stories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(story) });
      setStories((items) => [...items, created].sort((a, b) => a.sort_order - b.sort_order)); setStory({ title: '', youtube_embed_code: '', is_published: true, sort_order: stories.length + 1 }); setError(''); notify('Success story saved and ready for the public website.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save the success story.'); } finally { setBusy(false); }
  }

  async function saveTrainingVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const franchise_models = [trainingVideo.fofo ? 'FOFO' : null, trainingVideo.foco ? 'FOCO' : null].filter(Boolean);
      if (!franchise_models.length) throw new Error('Select at least one franchise model.');
      const created = await cmsRequest<TrainingVideo>('/admin/content/training-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trainingVideo.title,
          description: trainingVideo.description,
          youtube_embed_code: trainingVideo.youtube_embed_code,
          duration_minutes: trainingVideo.duration_minutes,
          sort_order: trainingVideo.sort_order,
          franchise_models,
          is_published: trainingVideo.is_published,
        }),
      });
      setTrainingVideos((items) => [...items, created].sort((first, second) => first.sort_order - second.sort_order));
      setTrainingVideo({ title: '', description: '', youtube_embed_code: '', duration_minutes: 15, sort_order: trainingVideos.length + 2, fofo: true, foco: true, is_published: true });
      setError('');
      notify('Franchise training video saved for the applicant learning path.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save the training video.'); } finally { setBusy(false); }
  }

  async function saveFranchisee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const created = await cmsRequest<FeaturedFranchisee>('/admin/content/featured-franchisees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(franchisee) });
      setFranchisees((items) => [...items, created].sort((a, b) => a.sort_order - b.sort_order)); setFranchisee({ name: '', location: '', franchise_type: 'FOFO', image_url: '', is_featured: true, sort_order: franchisees.length + 1 }); setError(''); notify('Featured franchisee added to the public slider.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save the featured franchisee.'); } finally { setBusy(false); }
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0]; if (!image) return;
    setBusy(true); const formData = new FormData(); formData.set('image', image);
    try {
      const result = await cmsRequest<{ image_url: string }>('/admin/content/featured-franchisees/image', { method: 'POST', body: formData });
      setFranchisee((value) => ({ ...value, image_url: result.image_url })); setError(''); notify('Franchisee image uploaded.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to upload this image.'); } finally { setBusy(false); event.target.value = ''; }
  }

  async function removeStory(item: SuccessStory) {
    if (!window.confirm(`Remove “${item.title}” from Success Stories?`)) return;
    try { await cmsRequest(`/admin/content/success-stories/${item.id}`, { method: 'DELETE' }); setStories((items) => items.filter((storyItem) => storyItem.id !== item.id)); notify('Success story removed.'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to remove the success story.'); }
  }

  async function removeTrainingVideo(item: TrainingVideo) {
    if (!window.confirm(`Remove “${item.title}” from franchise training videos?`)) return;
    try { await cmsRequest(`/admin/content/training-videos/${item.id}`, { method: 'DELETE' }); setTrainingVideos((items) => items.filter((video) => video.id !== item.id)); notify('Training video removed.'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to remove the training video.'); }
  }

  async function removeFranchisee(item: FeaturedFranchisee) {
    if (!window.confirm(`Remove “${item.name}” from the featured slider?`)) return;
    try { await cmsRequest(`/admin/content/featured-franchisees/${item.id}`, { method: 'DELETE' }); setFranchisees((items) => items.filter((franchiseeItem) => franchiseeItem.id !== item.id)); notify('Featured franchisee removed.'); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to remove the featured franchisee.'); }
  }

  const embedPreview = previewUrl(story.youtube_embed_code);
  const trainingEmbedPreview = previewUrl(trainingVideo.youtube_embed_code);
  const logoPreview = pendingLogo?.dataUrl ?? company.logo_url;
  return <div className="content-studio">
    <div className="title-row"><div><h1>Public website content</h1><p>Manage company identity, success stories and active franchisee showcases.</p></div><button className="date" onClick={() => void refresh()}>Refresh content</button></div>
    <div className="secure-banner"><b>Super Admin only</b><span>Only Super Admins can change the company logo, address, contact details and public website content.</span></div>
    {error ? <p className="content-error" role="alert">{error}</p> : null}

    <section className="panel content-editor company-settings"><div className="panel-head"><div><h2>Company profile &amp; logo</h2><p>This information appears across the public Home, FOFO and FOCO pages.</p></div></div>
      <form onSubmit={saveCompany}>
        <div className="company-settings-grid">
          <div className="logo-preview-box"><img src={logoPreview} alt={`${company.company_name} logo preview`} onError={(event) => { event.currentTarget.src = '/remedium-lab-logo.png'; }} /><span>{pendingLogo ? 'Selected logo preview' : 'Current public logo'}</span></div>
          <div className="company-settings-fields">
            <div className="content-form-row"><label>Company name<input value={company.company_name} onChange={(event) => setCompany((value) => ({ ...value, company_name: event.target.value }))} required /></label><label>Legal company name<input value={company.legal_name} onChange={(event) => setCompany((value) => ({ ...value, legal_name: event.target.value }))} required /></label></div>
            <div className="content-form-row"><label>Franchisee hub name<input value={company.franchise_hub_name} onChange={(event) => setCompany((value) => ({ ...value, franchise_hub_name: event.target.value }))} required /></label><label>Company phone<input value={company.company_phone} onChange={(event) => setCompany((value) => ({ ...value, company_phone: event.target.value }))} placeholder="+91 ..." /></label></div>
            <div className="content-form-row"><label>Company email<input type="email" value={company.company_email} onChange={(event) => setCompany((value) => ({ ...value, company_email: event.target.value }))} placeholder="hello@company.com" /></label><label>WhatsApp number<input inputMode="numeric" value={company.whatsapp_number} onChange={(event) => setCompany((value) => ({ ...value, whatsapp_number: event.target.value.replace(/\D/g, '').slice(0, 15) }))} placeholder="919876543210" /></label></div>
            <label>Office address<textarea className="company-address" value={company.office_address} onChange={(event) => setCompany((value) => ({ ...value, office_address: event.target.value }))} required /></label>
            <label>Google Maps embed URL or iframe code<textarea className="company-address" value={company.google_map_embed_url} onChange={(event) => setCompany((value) => ({ ...value, google_map_embed_url: event.target.value }))} placeholder="Paste the Google Maps embed URL or the complete iframe code" /></label>
            <label>Logo image URL (optional)<input type="text" value={company.logo_url} onChange={(event) => setCompany((value) => ({ ...value, logo_url: event.target.value }))} placeholder="https://... or /remedium-lab-logo.png" /></label>
            <label className="upload-label">Choose a PNG, JPG or WEBP logo (maximum 5 MB)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseLogo} /></label>
            {pendingLogo ? <div className="logo-selection"><div><b>Selected: {pendingLogo.name}</b><small>Click Upload selected logo now, or use Save company profile to upload it with the other details.</small></div><div className="logo-selection-actions"><button type="button" className="content-submit" disabled={busy} onClick={() => void uploadPendingLogo()}>{busy ? 'Uploading...' : 'Upload selected logo now'}</button><button type="button" className="logo-cancel" disabled={busy} onClick={() => setPendingLogo(null)}>Cancel</button></div></div> : null}
          </div>
        </div>
        <button className="content-submit" disabled={busy}>{busy ? 'Saving...' : 'Save company profile'}</button>
      </form>
    </section>

    <HeroSliderManager notify={notify} />

    <MarketingPagesManager notify={notify} />

    <section className="panel content-editor why-remedium-editor"><div className="panel-head"><div><h2>Why Remedium Lab</h2><p>Search-friendly content shown between the Territory and Support sections on the public website.</p></div></div>
      <form onSubmit={saveWhyRemedium}>
        <div className="why-remedium-editor-grid">
          <div>
            <label>Section label<input value={company.why_remedium_eyebrow} onChange={(event) => setCompany((value) => ({ ...value, why_remedium_eyebrow: event.target.value }))} required /></label>
            <label>Heading<input value={company.why_remedium_title} onChange={(event) => setCompany((value) => ({ ...value, why_remedium_title: event.target.value }))} required /></label>
            <label>Introduction<textarea value={company.why_remedium_intro} onChange={(event) => setCompany((value) => ({ ...value, why_remedium_intro: event.target.value }))} required /></label>
            <label>SEO description<textarea className="why-remedium-body-input" value={company.why_remedium_body} onChange={(event) => setCompany((value) => ({ ...value, why_remedium_body: event.target.value }))} required /></label>
          </div>
          <div>
            <label>Benefit one<input value={company.why_remedium_point_one} onChange={(event) => setCompany((value) => ({ ...value, why_remedium_point_one: event.target.value }))} required /></label>
            <label>Benefit two<input value={company.why_remedium_point_two} onChange={(event) => setCompany((value) => ({ ...value, why_remedium_point_two: event.target.value }))} required /></label>
            <label>Benefit three<input value={company.why_remedium_point_three} onChange={(event) => setCompany((value) => ({ ...value, why_remedium_point_three: event.target.value }))} required /></label>
            <label>Accreditation image URL<input type="text" value={company.why_remedium_badge_url} onChange={(event) => setCompany((value) => ({ ...value, why_remedium_badge_url: event.target.value }))} placeholder="https://... or /nabl-accreditation-badge.svg" /></label>
            <label className="upload-label">Or upload your approved NABL accreditation image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadWhyRemediumBadge} /></label>
            <div className="why-remedium-badge-preview"><img src={company.why_remedium_badge_url} alt="NABL accreditation preview" onError={(event) => { event.currentTarget.src = '/nabl-accreditation-badge.svg'; }} /><span>Public accreditation badge preview</span></div>
          </div>
        </div>
        <button className="content-submit" disabled={busy}>{busy ? 'Saving...' : 'Save Why Remedium content'}</button>
      </form>
    </section>

    <section className="panel content-editor footer-content-editor"><div className="panel-head"><div><h2>Footer, brochure &amp; legal information</h2><p>Control the public footer, downloadable franchise brochure, disclaimer and terms.</p></div></div>
      <form onSubmit={saveFooterContent}>
        <div className="footer-content-editor-grid">
          <div>
            <label>Franchise brochure URL (optional)<input type="text" value={company.brochure_url} onChange={(event) => setCompany((value) => ({ ...value, brochure_url: event.target.value }))} placeholder="https://... or uploaded PDF URL" /></label>
            <label className="upload-label">Upload franchise brochure PDF (maximum 25 MB)<input type="file" accept="application/pdf,.pdf" onChange={uploadBrochure} /></label>
            <div className="brochure-status">{company.brochure_url ? <><b>Brochure ready</b><a href={company.brochure_url} target="_blank" rel="noreferrer">Open current brochure</a></> : <span>No brochure uploaded yet.</span>}</div>
          </div>
          <div className="footer-company-note"><b>Company address and contact details</b><span>These are controlled in the Company profile &amp; logo section above and automatically appear in the public footer.</span></div>
        </div>
        <label>Footer disclaimer<textarea className="footer-legal-input" value={company.footer_disclaimer} onChange={(event) => setCompany((value) => ({ ...value, footer_disclaimer: event.target.value }))} required /></label>
        <label>Terms &amp; conditions<textarea className="footer-legal-input" value={company.footer_terms} onChange={(event) => setCompany((value) => ({ ...value, footer_terms: event.target.value }))} required /></label>
        <button className="content-submit" disabled={busy}>{busy ? 'Saving...' : 'Save footer content'}</button>
      </form>
    </section>

    <section className="panel content-editor footer-content-editor"><div className="panel-head"><div><h2>Franchise application and payment terms</h2><p>Applicants accept their franchise-model terms before applying. FOCO applicants must also accept the separately managed Phase 2 terms before paying the manager-released franchise fee.</p></div></div>
      <form onSubmit={saveFranchiseTerms}>
        <label>FOFO terms &amp; conditions<textarea className="footer-legal-input" value={company.fofo_terms} onChange={(event) => setCompany((value) => ({ ...value, fofo_terms: event.target.value }))} required /></label>
        <label>FOCO terms &amp; conditions<textarea className="footer-legal-input" value={company.foco_terms} onChange={(event) => setCompany((value) => ({ ...value, foco_terms: event.target.value }))} required /></label>
        <label>FOCO Phase 2 payment terms &amp; conditions<textarea className="footer-legal-input" value={company.foco_phase_2_terms} onChange={(event) => setCompany((value) => ({ ...value, foco_phase_2_terms: event.target.value }))} required /></label>
        <label>FOCO Phase 3 security deposit terms &amp; conditions<textarea className="footer-legal-input" value={company.foco_phase_3_terms} onChange={(event) => setCompany((value) => ({ ...value, foco_phase_3_terms: event.target.value }))} required /></label>
        <label>Agreement Module terms &amp; conditions<textarea className="footer-legal-input" value={company.agreement_terms} onChange={(event) => setCompany((value) => ({ ...value, agreement_terms: event.target.value }))} required /></label>
        <button className="content-submit" disabled={busy}>{busy ? 'Saving...' : 'Publish franchise, payment and agreement terms'}</button>
      </form>
    </section>

    <div className="content-editor-grid">
      <section className="panel content-editor"><div className="panel-head"><div><h2>Success story video</h2><p>Paste the YouTube iframe embed code supplied by YouTube.</p></div></div><form onSubmit={saveStory}><label>Story title<input value={story.title} onChange={(event) => setStory((value) => ({ ...value, title: event.target.value }))} placeholder="e.g. Partner story: Kolkata" required /></label><label>YouTube embed code<textarea value={story.youtube_embed_code} onChange={(event) => setStory((value) => ({ ...value, youtube_embed_code: event.target.value }))} placeholder={'<iframe src="https://www.youtube.com/embed/..." ...></iframe>'} required /></label><div className="content-form-row"><label>Display order<input type="number" min="0" value={story.sort_order} onChange={(event) => setStory((value) => ({ ...value, sort_order: Number(event.target.value) }))} /></label><label className="check-label"><input type="checkbox" checked={story.is_published} onChange={(event) => setStory((value) => ({ ...value, is_published: event.target.checked }))} /> Publish on website</label></div>{embedPreview ? <div className="video-preview"><iframe src={embedPreview} title="YouTube embed preview" allowFullScreen /></div> : null}<button className="content-submit" disabled={busy}>{busy ? 'Saving...' : 'Save success story'}</button></form></section>
      <section className="panel content-editor"><div className="panel-head"><div><h2>Franchise training video</h2><p>Add mandatory applicant training modules using the YouTube iframe embed code. Publish 3–4 videos in learning order.</p></div></div><form onSubmit={(event) => void saveTrainingVideo(event)}><label>Module title<input value={trainingVideo.title} onChange={(event) => setTrainingVideo((value) => ({ ...value, title: event.target.value }))} placeholder="Lab operations and quality standards" required /></label><label>Module description<textarea value={trainingVideo.description} onChange={(event) => setTrainingVideo((value) => ({ ...value, description: event.target.value }))} placeholder="Brief summary shown to applicants before they start this module." /></label><label>YouTube embed code<textarea value={trainingVideo.youtube_embed_code} onChange={(event) => setTrainingVideo((value) => ({ ...value, youtube_embed_code: event.target.value }))} placeholder={'<iframe src="https://www.youtube.com/embed/..." ...></iframe>'} required /></label><div className="content-form-row"><label>Duration (minutes)<input type="number" min="1" max="240" value={trainingVideo.duration_minutes} onChange={(event) => setTrainingVideo((value) => ({ ...value, duration_minutes: Number(event.target.value) || 0 }))} /></label><label>Learning order<input type="number" min="1" max="20" value={trainingVideo.sort_order} onChange={(event) => setTrainingVideo((value) => ({ ...value, sort_order: Number(event.target.value) || 1 }))} /></label></div><div className="content-form-row"><label className="check-label"><input type="checkbox" checked={trainingVideo.fofo} onChange={(event) => setTrainingVideo((value) => ({ ...value, fofo: event.target.checked }))} /> FOFO</label><label className="check-label"><input type="checkbox" checked={trainingVideo.foco} onChange={(event) => setTrainingVideo((value) => ({ ...value, foco: event.target.checked }))} /> FOCO</label><label className="check-label"><input type="checkbox" checked={trainingVideo.is_published} onChange={(event) => setTrainingVideo((value) => ({ ...value, is_published: event.target.checked }))} /> Published for applicant training</label></div>{trainingEmbedPreview ? <div className="video-preview"><iframe src={trainingEmbedPreview} title="Training video preview" allowFullScreen /></div> : null}<button className="content-submit" disabled={busy}>{busy ? 'Saving...' : 'Save training video'}</button></form></section>
      <section className="panel content-editor"><div className="panel-head"><div><h2>Featured franchisee</h2><p>Add an active FOFO or FOCO partner to the public slider.</p></div></div><form onSubmit={saveFranchisee}><div className="content-form-row"><label>Franchisee name<input value={franchisee.name} onChange={(event) => setFranchisee((value) => ({ ...value, name: event.target.value }))} placeholder="Partner / centre name" required /></label><label>Location<input value={franchisee.location} onChange={(event) => setFranchisee((value) => ({ ...value, location: event.target.value }))} placeholder="District, West Bengal" required /></label></div><div className="content-form-row"><label>Franchise type<select value={franchisee.franchise_type} onChange={(event) => setFranchisee((value) => ({ ...value, franchise_type: event.target.value as 'FOFO' | 'FOCO' }))}><option>FOFO</option><option>FOCO</option></select></label><label>Display order<input type="number" min="0" value={franchisee.sort_order} onChange={(event) => setFranchisee((value) => ({ ...value, sort_order: Number(event.target.value) }))} /></label></div><label>Image URL<input type="url" value={franchisee.image_url} onChange={(event) => setFranchisee((value) => ({ ...value, image_url: event.target.value }))} placeholder="https://..." required /></label><label className="upload-label">Or upload a JPG, PNG or WEBP image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadImage} /></label>{franchisee.image_url ? <img className="franchisee-preview" src={franchisee.image_url} alt="Featured franchisee preview" /> : null}<label className="check-label"><input type="checkbox" checked={franchisee.is_featured} onChange={(event) => setFranchisee((value) => ({ ...value, is_featured: event.target.checked }))} /> Show in the public ongoing-franchisee slider</label><button className="content-submit" disabled={busy}>{busy ? 'Saving...' : 'Add featured franchisee'}</button></form></section>
    </div>
    <section className="panel published-content"><div className="panel-head"><div><h2>Published content</h2><p>Manage what is currently available for the marketing website and applicant training.</p></div></div><div className="published-columns published-columns-wide"><div><h3>Success stories</h3>{stories.length ? stories.map((item) => <article className="content-list-item" key={item.id}><div><b>{item.title}</b><small>{item.is_published ? 'Published' : 'Draft'} · Order {item.sort_order}</small></div><button onClick={() => void removeStory(item)}>Remove</button></article>) : <p className="content-empty">No success stories have been added yet.</p>}</div><div><h3>Franchise training videos</h3>{trainingVideos.length ? trainingVideos.map((item) => <article className="content-list-item" key={item.id}><div><b>{item.title}</b><small>{item.is_published ? 'Published' : 'Draft'} · Order {item.sort_order} · {item.franchise_models.join(' / ')}</small></div><button onClick={() => void removeTrainingVideo(item)}>Remove</button></article>) : <p className="content-empty">No franchise training videos have been added yet.</p>}</div><div><h3>Featured franchisees</h3>{franchisees.length ? franchisees.map((item) => <article className="content-list-item" key={item.id}><div><b>{item.name}</b><small>{item.franchise_type} · {item.location}</small></div><button onClick={() => void removeFranchisee(item)}>Remove</button></article>) : <p className="content-empty">No franchisees have been featured yet.</p>}</div></div></section>
  </div>;
}
