export const MAX_FRANCHISE_WEBPAGE_BRANCH_IMAGES = 10;

const DEFAULT_FRANCHISE_HERO_BACKGROUND = 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=1800&q=80';

const DEFAULT_SERVICES = [
  'Pathology & clinical laboratory testing',
  'Preventive health check-up packages',
  'Home sample collection support',
  'Doctor-recommended diagnostic panels',
  'Corporate and camp health screening',
];

export function franchiseWebpageSlug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'remedium-branch';
}

export function canMarkApplicationOnboarded(application) {
  return Boolean(application?.onboarding_certificate?.certificate_number && application?.onboarding_certificate?.pdf?.url)
    && application?.stage !== 'onboarding_completed';
}

export function defaultFranchiseWebpageSettings(application, companyProfile = {}) {
  const onboarding = application?.onboarding_certificate ?? {};
  const training = application?.training ?? {};
  const allotment = application?.territory_allotment ?? {};
  const branding = application?.branding_signage ?? {};
  const businessName = String(onboarding.business_name || training.business_name || branding?.vendor?.shop_name || `${application.full_name} - Remedium Lab`).trim();
  const branchAddress = String(allotment.franchise_address || training.franchise_address || [application.address, application.city, application.district, application.pincode].filter(Boolean).join(', ')).trim();
  const mapLink = String(allotment.google_maps_url || companyProfile.google_map_embed_url || '').trim();
  const mapEmbed = mapLink.includes('output=embed') ? mapLink : mapLink ? `${mapLink}${mapLink.includes('?') ? '&' : '?'}output=embed` : companyProfile.google_map_embed_url || '';
  const branchImages = [];
  const brandingPhotos = branding?.photos ?? branding?.vendor?.photos ?? [];
  if (Array.isArray(brandingPhotos)) {
    brandingPhotos.slice(0, 4).forEach((photo, index) => {
      const url = String(photo?.url ?? photo ?? '').trim();
      if (url) branchImages.push({ url, caption: String(photo?.name ?? `Branch image ${index + 1}`) });
    });
  }
  if (!branchImages.length && companyProfile.logo_url) {
    branchImages.push({ url: companyProfile.logo_url, caption: 'Remedium Lab branch' });
  }
  return {
    business_name: businessName,
    branch_address: branchAddress,
    contact_number: String(application.mobile || companyProfile.company_phone || '').trim(),
    whatsapp_number: String(companyProfile.whatsapp_number || application.mobile || '').trim(),
    google_map_link: mapLink,
    google_map_embed_url: mapEmbed,
    branch_images: branchImages,
    business_hours: 'Monday to Saturday: 7:00 AM - 8:00 PM\nSunday: 8:00 AM - 2:00 PM',
    hero_subtitle: 'Quality, affordable and reliable diagnostic services for your community.',
    hero_background_url: DEFAULT_FRANCHISE_HERO_BACKGROUND,
    branch_intro: `${businessName} is an authorised Remedium Lab FOCO franchise partner delivering trusted pathology services with transparent processes, accurate reporting and patient-first care.`,
    seo_title: `${businessName} | Remedium Lab Diagnostic Centre`,
    seo_description: `Visit ${businessName}, a Remedium Lab FOCO franchise partner offering quality diagnostic services, health check-ups and laboratory testing.`,
    seo_keywords: `${businessName}, Remedium Lab, diagnostic centre, pathology lab, health check-up`,
    app_download_url: companyProfile.brochure_url || 'https://play.google.com/store',
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function formatMultiline(value) {
  return escapeHtml(value).replace(/\n/g, '<br />');
}

function resolveFranchiseWebpageAssetUrl(url, publicBaseUrl) {
  const value = String(url ?? '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${String(publicBaseUrl ?? '').replace(/\/+$/, '')}${value}`;
  return value;
}

function whatsappHref(number, businessName) {
  const digits = String(number ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const text = encodeURIComponent(`Hello ${businessName}, I would like to enquire about diagnostic services.`);
  return `https://wa.me/${digits}?text=${text}`;
}

function phoneTelHref(number) {
  const digits = String(number ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `tel:+91${digits}`;
  if (digits.startsWith('91') && digits.length === 12) return `tel:+${digits}`;
  return `tel:+${digits}`;
}

const ICON_PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.07 21 3 13.93 3 5a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z"/></svg>';
const ICON_WHATSAPP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path fill="currentColor" d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.182a8.18 8.18 0 01-4.178-1.145l-.3-.178-2.868.855.857-2.805-.196-.31A8.176 8.176 0 1112 20.182z"/></svg>';
const ICON_LOCATION = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1112 6a2.5 2.5 0 010 5.5z"/></svg>';
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 20h14a1 1 0 001-1v-2H4v2a1 1 0 001 1zm7-16l-5 5h3v6h4v-6h3l-5-5z"/></svg>';

export function renderFranchiseWebpageHtml(settings, options = {}) {
  const publicBaseUrl = String(options.publicBaseUrl ?? '').replace(/\/+$/, '');
  const businessName = escapeHtml(settings.business_name || 'Remedium Lab Franchise Partner');
  const branchAddress = formatMultiline(settings.branch_address || 'Branch address will be updated soon.');
  const phoneLink = phoneTelHref(settings.contact_number);
  const waLink = whatsappHref(settings.whatsapp_number || settings.contact_number, settings.business_name);
  const contactCallCard = phoneLink
    ? `<a class="contact-action-card contact-action-call" href="${escapeHtml(phoneLink)}" aria-label="Call ${businessName}"><span class="contact-action-icon contact-action-icon-call">${ICON_PHONE}</span><span class="contact-action-copy"><b>Call us</b><small>Tap to open your phone dialer</small></span></a>`
    : `<div class="contact-action-card contact-action-call is-disabled"><span class="contact-action-icon contact-action-icon-call">${ICON_PHONE}</span><span class="contact-action-copy"><b>Call us</b><small>Contact number will be updated soon.</small></span></div>`;
  const contactWhatsAppCard = waLink
    ? `<a class="contact-action-card contact-action-whatsapp" href="${escapeHtml(waLink)}" target="_blank" rel="noreferrer" aria-label="Chat with ${businessName} on WhatsApp"><span class="contact-action-icon contact-action-icon-whatsapp">${ICON_WHATSAPP}</span><span class="contact-action-copy"><b>WhatsApp</b><small>Tap to start a chat instantly</small></span></a>`
    : `<div class="contact-action-card contact-action-whatsapp is-disabled"><span class="contact-action-icon contact-action-icon-whatsapp">${ICON_WHATSAPP}</span><span class="contact-action-copy"><b>WhatsApp</b><small>WhatsApp number will be updated soon.</small></span></div>`;
  const contactAddressCard = `<article class="contact-action-card contact-action-address"><span class="contact-action-icon contact-action-icon-address">${ICON_LOCATION}</span><span class="contact-action-copy"><b>Visit us</b><small>${branchAddress}</small></span></article>`;
  const mapEmbed = escapeHtml(settings.google_map_embed_url || '');
  const mapLink = escapeHtml(settings.google_map_link || settings.google_map_embed_url || '#location');
  const heroSubtitle = escapeHtml(settings.hero_subtitle || 'Quality, affordable and reliable diagnostic services for your community.');
  const heroBackgroundUrl = escapeHtml(resolveFranchiseWebpageAssetUrl(settings.hero_background_url || DEFAULT_FRANCHISE_HERO_BACKGROUND, publicBaseUrl));
  const branchIntro = formatMultiline(settings.branch_intro || `${settings.business_name} is a Remedium Lab franchise partner.`);
  const businessHours = formatMultiline(settings.business_hours || 'Monday to Saturday: 7:00 AM - 8:00 PM');
  const seoTitle = escapeHtml(settings.seo_title || `${settings.business_name} | Remedium Lab`);
  const seoDescription = escapeHtml(settings.seo_description || branchIntro.replace(/<[^>]+>/g, '').slice(0, 160));
  const seoKeywords = escapeHtml(settings.seo_keywords || `${settings.business_name}, Remedium Lab, diagnostics`);
  const appUrl = escapeHtml(settings.app_download_url || '#download-app');
  const images = Array.isArray(settings.branch_images) ? settings.branch_images.filter((item) => item?.url).slice(0, MAX_FRANCHISE_WEBPAGE_BRANCH_IMAGES) : [];
  const imageSlides = images.map((image, index) => {
    const imageUrl = escapeHtml(resolveFranchiseWebpageAssetUrl(image.url, publicBaseUrl));
    const altText = escapeHtml(`${settings.business_name || 'Remedium Lab branch'} photo ${index + 1}`);
    return `<div class="branch-slider-slide" data-slide="${index}"><img src="${imageUrl}" alt="${altText}" loading="${index === 0 ? 'eager' : 'lazy'}" /></div>`;
  }).join('');
  const sliderDots = images.length > 1
    ? `<div class="branch-slider-dots">${images.map((_, index) => `<button type="button" class="branch-slider-dot${index === 0 ? ' is-active' : ''}" data-slide="${index}" aria-label="Show photograph ${index + 1}"></button>`).join('')}</div>`
    : '';
  const branchSlider = images.length
    ? `<div class="branch-slider" data-autoplay="4500"><div class="branch-slider-viewport"><div class="branch-slider-track">${imageSlides}</div></div>${sliderDots}</div>`
    : '<div class="branch-slider branch-slider--empty"><div class="branch-slider-placeholder">Branch images will appear here.</div></div>';
  const serviceItems = DEFAULT_SERVICES.map((service) => `<li>${escapeHtml(service)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${seoTitle}</title>
  <meta name="description" content="${seoDescription}" />
  <meta name="keywords" content="${seoKeywords}" />
  <meta name="robots" content="index,follow" />
  <style>
    :root { --navy:#103e6b; --teal:#087f88; --teal-dark:#065f66; --gold:#c89b2d; --ink:#173e6b; --muted:#5e7890; --surface:#f4f8fc; --white:#fff; --shadow:0 18px 40px rgba(16,62,107,.12); }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Segoe UI, Arial, sans-serif; color:var(--ink); background:var(--white); line-height:1.6; }
    a { color:inherit; text-decoration:none; }
    img { max-width:100%; display:block; }
    .container { width:min(1120px, calc(100% - 32px)); margin:0 auto; }
    .site-header { position:sticky; top:0; z-index:20; background:rgba(255,255,255,.96); backdrop-filter:blur(10px); border-bottom:1px solid #dbe7ef; }
    .site-header .container { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 0; }
    .brand-name { font-size:clamp(18px, 2.4vw, 28px); font-weight:800; color:var(--navy); letter-spacing:-.02em; }
    .site-nav { display:flex; flex-wrap:wrap; gap:10px; }
    .site-nav a { padding:8px 12px; border-radius:999px; font-size:13px; font-weight:700; color:var(--muted); }
    .site-nav a:hover { background:#edf6fb; color:var(--teal-dark); }
    .hero { position:relative; isolation:isolate; color:#fff; padding:72px 0 64px; overflow:hidden; }
    .hero::before { content:''; position:absolute; inset:0; z-index:-2; background:var(--hero-bg) center/cover no-repeat; transform:scale(1.04); opacity:.28; }
    .hero::after { content:''; position:absolute; inset:0; z-index:-1; background:linear-gradient(135deg, rgba(11,86,96,.88) 0%, rgba(16,62,107,.9) 58%, rgba(15,125,134,.88) 100%); }
    .hero .container { position:relative; z-index:1; }
    .hero-grid { display:grid; grid-template-columns:1.2fr .8fr; gap:28px; align-items:center; }
    .hero-badge { display:inline-block; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.18); padding:6px 12px; border-radius:999px; font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
    .hero h1 { margin:16px 0 12px; font-size:clamp(34px, 5vw, 56px); line-height:1.05; letter-spacing:-.03em; }
    .hero p { margin:0 0 24px; max-width:640px; font-size:clamp(16px, 2.2vw, 20px); color:rgba(255,255,255,.88); }
    .hero-actions { display:flex; flex-wrap:wrap; gap:12px; }
    .btn { display:inline-flex; align-items:center; justify-content:center; min-height:46px; padding:0 18px; border-radius:10px; font-weight:800; font-size:14px; border:0; cursor:pointer; }
    .btn-primary { background:#fff; color:var(--teal-dark); }
    .btn-secondary { background:rgba(255,255,255,.12); color:#fff; border:1px solid rgba(255,255,255,.22); }
    .hero-card { background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.16); border-radius:18px; padding:22px; box-shadow:var(--shadow); }
    .hero-card b { display:block; font-size:18px; margin-bottom:8px; }
    .hero-card span { color:rgba(255,255,255,.82); font-size:14px; }
    section { padding:64px 0; }
    section:nth-of-type(even) { background:var(--surface); }
    .section-head { max-width:760px; margin-bottom:28px; }
    .section-head p { margin:0 0 8px; color:var(--teal); font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    .section-head h2 { margin:0; font-size:clamp(28px, 3.5vw, 38px); line-height:1.15; color:var(--navy); }
    .intro-grid, .two-col, .contact-grid { display:grid; gap:24px; }
    .intro-grid { grid-template-columns:1.1fr .9fr; align-items:center; }
    .two-col { grid-template-columns:repeat(2, minmax(0, 1fr)); }
    .card { background:#fff; border:1px solid #dbe7ef; border-radius:16px; padding:22px; box-shadow:0 10px 24px rgba(16,62,107,.06); }
    .highlights { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:16px; }
    .highlights article { background:#fff; border:1px solid #dbe7ef; border-radius:16px; padding:20px; }
    .highlights b { display:block; color:var(--navy); margin-bottom:8px; font-size:18px; }
    .services ul { margin:0; padding-left:18px; display:grid; gap:10px; }
    .branch-slider { position:relative; width:100%; border-radius:16px; overflow:hidden; border:1px solid #dbe7ef; box-shadow:0 10px 24px rgba(16,62,107,.06); background:#eef3f7; }
    .branch-slider-viewport { overflow:hidden; aspect-ratio:4/3; }
    .branch-slider-track { display:flex; height:100%; transition:transform .75s ease; will-change:transform; }
    .branch-slider-slide { flex:0 0 100%; min-width:100%; height:100%; }
    .branch-slider-slide img { width:100%; height:100%; object-fit:cover; display:block; }
    .branch-slider-dots { position:absolute; left:0; right:0; bottom:14px; display:flex; justify-content:center; gap:8px; z-index:2; }
    .branch-slider-dot { width:10px; height:10px; border-radius:999px; border:0; background:rgba(255,255,255,.55); cursor:pointer; padding:0; transition:transform .2s ease, background .2s ease; }
    .branch-slider-dot.is-active { background:#fff; transform:scale(1.15); }
    .branch-slider--empty .branch-slider-placeholder { aspect-ratio:4/3; display:grid; place-items:center; color:var(--muted); padding:24px; text-align:center; }
    .map-frame { overflow:hidden; border-radius:16px; border:1px solid #dbe7ef; min-height:320px; background:#eef3f7; }
    .map-frame iframe { width:100%; min-height:320px; border:0; }
    .contact-section { background:linear-gradient(180deg,#fff 0%,#f4f8fc 100%); }
    .contact-actions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:18px; }
    .contact-action-card { display:flex; align-items:center; gap:16px; min-height:112px; padding:22px 20px; border-radius:18px; border:1px solid #dbe7ef; background:#fff; box-shadow:0 14px 34px rgba(16,62,107,.08); transition:transform .2s ease, box-shadow .2s ease, border-color .2s ease; }
    a.contact-action-card:hover { transform:translateY(-3px); box-shadow:0 18px 40px rgba(16,62,107,.12); border-color:#b8dde0; }
    .contact-action-card.is-disabled { opacity:.72; cursor:not-allowed; }
    .contact-action-icon { flex:none; width:58px; height:58px; border-radius:18px; display:grid; place-items:center; }
    .contact-action-icon svg { width:28px; height:28px; }
    .contact-action-icon-call { background:linear-gradient(135deg,#e8f4ff,#f3f9ff); color:#0b5cab; }
    .contact-action-icon-whatsapp { background:linear-gradient(135deg,#e8f8ef,#f2fcf5); color:#128c7e; }
    .contact-action-icon-address { background:linear-gradient(135deg,#fff4e8,#fffaf2); color:#b45309; }
    .contact-action-copy { display:grid; gap:4px; min-width:0; }
    .contact-action-copy b { color:var(--navy); font-size:18px; line-height:1.2; }
    .contact-action-copy small { color:var(--muted); font-size:13px; line-height:1.5; }
    .contact-action-address .contact-action-copy small { display:block; }
    .app-download { padding:72px 0; background:linear-gradient(135deg,#0b5660 0%,#103e6b 52%,#0f7d86 100%); color:#fff; }
    .app-download-inner { display:grid; grid-template-columns:1.15fr auto; gap:28px; align-items:center; }
    .app-download-copy { display:grid; gap:10px; max-width:640px; }
    .app-download-copy p { margin:0; color:rgba(255,255,255,.78); font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    .app-download-copy h2 { margin:0; font-size:clamp(28px,3.5vw,40px); line-height:1.12; letter-spacing:-.02em; }
    .app-download-copy span { color:rgba(255,255,255,.86); font-size:16px; line-height:1.6; }
    .app-download-button { display:inline-flex; align-items:center; justify-content:center; gap:12px; min-width:min(100%,280px); min-height:64px; padding:0 28px; border-radius:16px; background:#fff; color:var(--teal-dark); font-size:18px; font-weight:800; box-shadow:0 18px 40px rgba(0,0,0,.18); transition:transform .2s ease, box-shadow .2s ease; white-space:nowrap; }
    .app-download-button svg { width:24px; height:24px; flex:none; }
    .app-download-button:hover { transform:translateY(-2px); box-shadow:0 22px 48px rgba(0,0,0,.22); }
    .site-footer { background:#0f2947; color:#d7e4ef; padding:28px 0; font-size:13px; }
    .site-footer .container { display:flex; flex-wrap:wrap; gap:12px; justify-content:space-between; align-items:center; }
    @media (max-width: 900px) {
      .hero-grid, .intro-grid, .two-col, .highlights, .contact-actions, .app-download-inner { grid-template-columns:1fr; }
      .site-header .container { flex-direction:column; align-items:flex-start; }
      .app-download-button { width:100%; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="container">
      <div class="brand-name">${businessName}</div>
      <nav class="site-nav" aria-label="Primary">
        <a href="#why-remedium">Why Remedium</a>
        <a href="#location">Branch Location</a>
        <a href="#contact">Contact Branch</a>
        <a href="#download-app">Download App</a>
      </nav>
    </div>
  </header>

  <section class="hero" style="--hero-bg:url('${heroBackgroundUrl}')">
    <div class="container hero-grid">
      <div>
        <span class="hero-badge">Remedium Lab FOCO Partner</span>
        <h1>${businessName}</h1>
        <p>${heroSubtitle}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#contact">Contact Branch</a>
          <a class="btn btn-secondary" href="${whatsappHref(settings.whatsapp_number || settings.contact_number, settings.business_name)}">WhatsApp Us</a>
        </div>
      </div>
      <aside class="hero-card">
        <b>Trusted diagnostics near you</b>
        <span>${branchAddress}</span>
      </aside>
    </div>
  </section>

  <section id="why-remedium">
    <div class="container">
      <div class="section-head"><p>Why Remedium</p><h2>Built on quality, transparency and community care</h2></div>
      <div class="highlights">
        <article><b>NABL-aligned quality</b><span>Structured laboratory processes designed for reliable diagnostic reporting.</span></article>
        <article><b>Fair-price diagnostics</b><span>Accessible testing packages for families, doctors and local communities.</span></article>
        <article><b>Franchise support</b><span>Operational guidance, branding standards and ongoing Remedium Lab support.</span></article>
      </div>
    </div>
  </section>

  <section>
    <div class="container intro-grid">
      <div>
        <div class="section-head"><p>Branch introduction</p><h2>Welcome to ${businessName}</h2></div>
        <p>${branchIntro}</p>
      </div>
      <div>${branchSlider}</div>
    </div>
  </section>

  <section>
    <div class="container two-col">
      <div class="card">
        <div class="section-head"><p>Available services</p><h2>Diagnostic services at this branch</h2></div>
        <div class="services"><ul>${serviceItems}</ul></div>
      </div>
      <div class="card">
        <div class="section-head"><p>Business hours</p><h2>Visit us during operating hours</h2></div>
        <p>${businessHours}</p>
      </div>
    </div>
  </section>

  <section id="location">
    <div class="container two-col">
      <div>
        <div class="section-head"><p>Branch location</p><h2>Find us on Google Maps</h2></div>
        <p>${branchAddress}</p>
        <p><a class="btn btn-primary" href="${mapLink}" target="_blank" rel="noreferrer">Open in Google Maps</a></p>
      </div>
      <div class="map-frame">${mapEmbed ? `<iframe src="${mapEmbed}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${businessName} location"></iframe>` : '<div style="padding:24px;color:#5e7890;">Map location will be updated soon.</div>'}</div>
    </div>
  </section>

  <section id="contact" class="contact-section">
    <div class="container">
      <div class="section-head"><p>Contact branch</p><h2>Speak with our branch team</h2></div>
      <div class="contact-actions">
        ${contactCallCard}
        ${contactWhatsAppCard}
        ${contactAddressCard}
      </div>
    </div>
  </section>

  <section class="app-download" id="download-app">
    <div class="container app-download-inner">
      <div class="app-download-copy">
        <p>Download app</p>
        <h2>Access Remedium services on mobile</h2>
        <span>Download the Remedium app for reports, bookings and franchise support resources.</span>
      </div>
      <a class="app-download-button" href="${appUrl}" target="_blank" rel="noreferrer">${ICON_DOWNLOAD}<span>Download App</span></a>
    </div>
  </section>

  <footer class="site-footer">
    <div class="container">
      <span>${businessName} · Remedium Lab FOCO Partner${options.franchisee_id ? ` · Franchisee ID ${escapeHtml(options.franchisee_id)}` : ''}</span>
      <span>${publicBaseUrl ? `Published via Remedium Franchise Management System` : 'Remedium Lab franchise portfolio webpage'}</span>
    </div>
  </footer>
  <script>
    (function () {
      document.querySelectorAll('.branch-slider[data-autoplay]').forEach(function (slider) {
        var track = slider.querySelector('.branch-slider-track');
        var slides = slider.querySelectorAll('.branch-slider-slide');
        var dots = slider.querySelectorAll('.branch-slider-dot');
        if (!track || slides.length < 2) return;
        var index = 0;
        var delay = Number(slider.getAttribute('data-autoplay')) || 4500;
        var timer;
        function goTo(nextIndex) {
          index = (nextIndex + slides.length) % slides.length;
          track.style.transform = 'translateX(-' + (index * 100) + '%)';
          dots.forEach(function (dot, dotIndex) { dot.classList.toggle('is-active', dotIndex === index); });
        }
        function start() { window.clearInterval(timer); timer = window.setInterval(function () { goTo(index + 1); }, delay); }
        function stop() { window.clearInterval(timer); }
        dots.forEach(function (dot) {
          dot.addEventListener('click', function () {
            goTo(Number(dot.getAttribute('data-slide')) || 0);
            start();
          });
        });
        slider.addEventListener('mouseenter', stop);
        slider.addEventListener('mouseleave', start);
        slider.addEventListener('focusin', stop);
        slider.addEventListener('focusout', start);
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        start();
      });
    })();
  </script>
</body>
</html>`;
}

export function franchiseWebpageRecord(webpage, resolveUploadUrl = (value) => value) {
  if (!webpage) return null;
  return {
    id: webpage.id,
    application_id: webpage.application_id,
    application_number: webpage.application_number,
    franchisee_id: webpage.franchisee_id ?? '',
    applicant_name: webpage.applicant_name,
    franchise_model: webpage.franchise_model,
    slug: webpage.slug,
    enabled: webpage.enabled !== false,
    settings: {
      ...webpage.settings,
      branch_images: Array.isArray(webpage.settings?.branch_images)
        ? webpage.settings.branch_images.map((image) => ({ ...image, url: resolveUploadUrl(image.url) }))
        : [],
    },
    public_url: webpage.public_url ?? '',
    html_url: resolveUploadUrl(webpage.html_url),
    created_at: webpage.created_at ?? '',
    updated_at: webpage.updated_at ?? '',
    onboarded_at: webpage.onboarded_at ?? '',
    onboarded_by: webpage.onboarded_by ?? '',
  };
}

export function franchiseWebpageMatchesSearch(webpage, query) {
  const haystack = [
    webpage.application_number,
    webpage.franchisee_id,
    webpage.applicant_name,
    webpage.settings?.business_name,
    webpage.slug,
    webpage.franchise_model,
  ].join(' ').toLowerCase();
  return haystack.includes(String(query ?? '').trim().toLowerCase());
}
