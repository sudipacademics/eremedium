import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api,
  CatalogItem,
  HomeHeaders,
  HomeRadiologyService,
  LabPanel,
  WhatsappCta,
  itemDiscountPercent,
} from '../api';
import { AiPhysicianEntry } from '../components/AiPhysicianEntry';
import { PriceTag } from '../components/PriceTag';
import { useAuth } from '../auth/AuthContext';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { stripHtml } from '../utils/text';
import './home-v2.css';

type HealthCategory = { label: string; query: string; icon?: string };
type CollectionStep = { step: number; title: string; description: string };

const FALLBACK_CATEGORIES: HealthCategory[] = [
  { label: 'Full body', query: 'full body' },
  { label: 'Diabetes', query: 'diabetes' },
  { label: 'Thyroid', query: 'thyroid' },
  { label: 'Vitamins', query: 'vitamin' },
  { label: "Women's health", query: 'women' },
  { label: 'Fever & infection', query: 'fever' },
  { label: 'Heart', query: 'lipid' },
  { label: "Men's health", query: 'men' },
  { label: 'Senior care', query: 'senior' },
  { label: 'Anemia & iron', query: 'iron' },
];

const FALLBACK_PACKAGES: Array<{
  panel_id: string;
  panel_name: string;
  tests: number;
  rate: number;
  mrp: number;
  q: string;
}> = [
  { panel_id: 'basic', panel_name: 'Basic Health Screening', tests: 8, rate: 799, mrp: 1499, q: 'basic' },
  { panel_id: 'full', panel_name: 'Essential Full Body Checkup', tests: 32, rate: 1799, mrp: 3499, q: 'full body' },
  { panel_id: 'silver', panel_name: 'Comprehensive Silver Checkup', tests: 48, rate: 2499, mrp: 4999, q: 'silver' },
  { panel_id: 'gold', panel_name: 'Comprehensive Gold Checkup', tests: 64, rate: 3999, mrp: 7999, q: 'gold' },
];

const FALLBACK_POPULAR: Array<{ name: string; item_name: string; rate: number; mrp: number; q: string; desc: string }> = [
  { name: 'cbc', item_name: 'Complete Blood Count', rate: 299, mrp: 449, q: 'cbc', desc: 'Haemoglobin, WBC, platelets' },
  { name: 'tsh', item_name: 'Thyroid Stimulating Hormone', rate: 249, mrp: 399, q: 'tsh', desc: 'TSH lab test profile' },
  { name: 'lipid', item_name: 'Lipid Profile', rate: 399, mrp: 699, q: 'lipid', desc: 'Cholesterol & triglycerides' },
  { name: 'hba1c', item_name: 'HbA1c', rate: 449, mrp: 699, q: 'hba1c', desc: '3-month diabetes control' },
];

const FALLBACK_RADIOLOGY: HomeRadiologyService[] = [
  { title: 'X-Ray', description: 'Chest, spine, joints', query: 'x-ray' },
  { title: 'Ultrasound', description: 'Abdomen, pelvis, pregnancy', query: 'ultrasound' },
  { title: 'MRI', description: 'Brain, spine, joints', query: 'mri' },
  { title: 'CT Scan', description: 'Head, chest, abdomen', query: 'ct scan' },
];

const POPULAR_SEARCHES = [
  { label: 'Full body checkup', q: 'full body' },
  { label: 'Diabetes', q: 'diabetes' },
  { label: 'Thyroid', q: 'thyroid' },
  { label: 'Vitamin D', q: 'vitamin d' },
  { label: "Women's health", q: 'women' },
  { label: 'Heart health', q: 'lipid' },
];

const FALLBACK_COLLECTION_STEPS: CollectionStep[] = [
  { step: 1, title: 'Book online', description: 'Pick tests, slot, and payment method' },
  { step: 2, title: 'Phlebo assigned', description: 'Your hub assigns a home visit' },
  { step: 3, title: 'Sample collected', description: 'Barcode scanned at your doorstep' },
  { step: 4, title: 'Lab processing', description: 'Results entered and reviewed' },
  { step: 5, title: 'Report ready', description: 'Download NABL PDF from My orders' },
];

const HERO_SLIDES = [
  {
    id: 'lab',
    image: '/home/hero-scientist.jpg',
    title: 'Trusted Diagnostics',
    accent: 'for a Healthier Tomorrow',
    subtitle: 'Book lab tests online — phlebotomist at your doorstep.',
  },
  {
    id: 'home',
    image: '/home/hero-care.jpg',
    title: 'Home Sample Collection',
    accent: 'at Fair Prices',
    subtitle: 'Trained phlebotomists, barcoded samples and digital reports.',
  },
  {
    id: 'nabl',
    image: '/home/nabl-facility.jpg',
    title: 'NABL Accredited Labs',
    accent: 'Accurate Reports, Every Time',
    subtitle: 'Advanced analysers and expert pathologists review every result.',
  },
];

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const ICONS = {
  flask: (
    <>
      <path d="M9 3h6M10 3v6L5 18.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L14 9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  doctor: (
    <>
      <circle cx="12" cy="7" r="3.5" />
      <path d="M5 21c.6-4 3.4-6 7-6s6.4 2 7 6" />
      <path d="M15.5 16.5v2.5a1.5 1.5 0 0 0 3 0" />
    </>
  ),
  van: (
    <>
      <path d="M2.5 16V7.5h11V16M13.5 10h4l3 3.5V16h-2" />
      <circle cx="7" cy="17" r="1.8" />
      <circle cx="17" cy="17" r="1.8" />
      <path d="M7 9.5v3M5.5 11h3" />
    </>
  ),
  report: (
    <>
      <path d="M7 3.5h7l3 3v14H7z" />
      <path d="M14 3.5V7h3M9.5 13l2 2 3.5-4" />
    </>
  ),
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  pin: (
    <>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  pill: (
    <>
      <rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" />
      <path d="M9.6 8.6l4.8 6.8" />
    </>
  ),
  rupee: (
    <>
      <path d="M7 5h10M7 9h10M7 5c4 0 6 1.5 6 4s-2 4-6 4l7 6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  home: (
    <>
      <path d="M3.5 11L12 4l8.5 7" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="10" r="2.3" />
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4 15v4.5h16V15" />
    </>
  ),
  stetho: (
    <>
      <path d="M6 3v6a4 4 0 0 0 8 0V3" />
      <path d="M10 13v2a5 5 0 0 0 10 0v-2" />
      <circle cx="20" cy="11" r="2" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  gift: (
    <>
      <rect x="3.5" y="9" width="17" height="11" rx="1.5" />
      <path d="M2.5 9h19M12 9v11M12 9c-1.5-4-6-4-6-1.5S10 9 12 9zM12 9c1.5-4 6-4 6-1.5S14 9 12 9z" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.5-3.4 2.7-5 5.5-5s5 1.6 5.5 5" />
      <circle cx="17" cy="9" r="2.3" />
      <path d="M15.5 14.3c2.4.1 4.4 1.6 5 4.7" />
    </>
  ),
  drop: <path d="M12 3.5s-6 6.5-6 10.5a6 6 0 0 0 12 0c0-4-6-10.5-6-10.5z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  butterfly: (
    <>
      <path d="M12 7v12" />
      <path d="M12 9C9 4 4 4.5 4 8s3 5 8 4M12 9c3-5 8-4.5 8-1s-3 5-8 4" />
      <path d="M12 13c-3 0-6 1.5-5.5 4S11 18 12 15M12 13c3 0 6 1.5 5.5 4S13 18 12 15" />
    </>
  ),
  thermo: (
    <>
      <path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" />
      <path d="M12 9v7" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.6-4 3.4-6 7-6s6.4 2 7 6" />
    </>
  ),
  cane: (
    <>
      <circle cx="10" cy="5" r="2" />
      <path d="M10 8v6l-2 6M10 14l3 6M10 10l-3 2M15 10a2 2 0 0 1 4 0v10" />
    </>
  ),
  body: (
    <>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M6 9l6-1 6 1M12 8v6M12 14l-3 7M12 14l3 7" />
    </>
  ),
} satisfies Record<string, ReactNode>;

type IconName = keyof typeof ICONS;

const QUICK_ACTIONS: Array<{ to: string; title: string; icon: IconName; tone: string; auth?: boolean }> = [
  { to: '/diagnostics', title: 'Book Lab Test', icon: 'flask', tone: 'teal' },
  { to: '/appointments/book', title: 'Doctor Appointment', icon: 'doctor', tone: 'violet' },
  { to: '/diagnostics', title: 'Home Sample Collection', icon: 'van', tone: 'blue' },
  { to: '/reports', title: 'View Reports', icon: 'report', tone: 'sky', auth: true },
  { to: '/diagnostics?q=package', title: 'Health Packages', icon: 'heart', tone: 'pink' },
  { to: '/centres', title: 'Find Nearest Centre', icon: 'pin', tone: 'indigo' },
  { to: '/pharmacy', title: 'Buy Medicine', icon: 'pill', tone: 'green' },
];

const HERO_TRUST: Array<{ icon: IconName; title: string; sub: string }> = [
  { icon: 'rupee', title: 'Fair Price', sub: 'Transparent pricing' },
  { icon: 'shield', title: 'Accurate Reports', sub: 'NABL certified' },
  { icon: 'home', title: 'Home Collection', sub: 'At your convenience' },
  { icon: 'network', title: 'Wide Network', sub: 'Centres near you' },
];

const NABL_POINTS: Array<{ icon: IconName; label: string }> = [
  { icon: 'shield', label: 'Certified labs' },
  { icon: 'people', label: 'Trained phlebotomists' },
  { icon: 'home', label: 'Home collection available' },
  { icon: 'report', label: 'Digital reports (PDF)' },
  { icon: 'rupee', label: 'Affordable & transparent pricing' },
];

const PKG_ICONS: Array<{ icon: IconName; tone: string }> = [
  { icon: 'flask', tone: 'green' },
  { icon: 'heart', tone: 'pink' },
  { icon: 'butterfly', tone: 'violet' },
  { icon: 'sun', tone: 'amber' },
  { icon: 'stetho', tone: 'teal' },
  { icon: 'drop', tone: 'blue' },
];

function concernIcon(label: string): { icon: IconName; tone: string } {
  const l = label.toLowerCase();
  if (l.includes('full')) return { icon: 'body', tone: 'teal' };
  if (l.includes('diabet') || l.includes('sugar')) return { icon: 'drop', tone: 'blue' };
  if (l.includes('thyroid')) return { icon: 'butterfly', tone: 'violet' };
  if (l.includes('vitamin')) return { icon: 'sun', tone: 'amber' };
  if (l.includes('women')) return { icon: 'user', tone: 'pink' };
  if (l.includes('fever') || l.includes('infect')) return { icon: 'thermo', tone: 'red' };
  if (l.includes('heart') || l.includes('lipid')) return { icon: 'heart', tone: 'red' };
  if (l.includes('men')) return { icon: 'user', tone: 'blue' };
  if (l.includes('senior')) return { icon: 'cane', tone: 'indigo' };
  if (l.includes('anemia') || l.includes('iron')) return { icon: 'drop', tone: 'red' };
  return { icon: 'flask', tone: 'teal' };
}

const WORKFLOW_ICONS: IconName[] = ['report', 'people', 'flask', 'shield', 'check'];

function DeliveryBikeIcon() {
  return (
    <svg viewBox="0 0 32 20" width="28" height="18" fill="none" aria-hidden>
      <circle cx="7" cy="14" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="24" cy="14" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.2 14h4.2l2.2-5.2h4.4l2.4 5.2H21" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M16.6 8.8V5.8h3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12.2 8.8h2.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="19.8" y="3.4" width="3.4" height="2.4" rx="0.5" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

function RobotMascot() {
  return (
    <svg viewBox="0 0 120 120" width="104" height="104" aria-hidden className="hv-robot">
      <defs>
        <linearGradient id="hvRobotBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e6f4f1" />
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="112" rx="30" ry="5" fill="#0f766e" opacity="0.12" />
      <line x1="60" y1="14" x2="60" y2="24" stroke="#0f766e" strokeWidth="3" />
      <circle cx="60" cy="11" r="5" fill="#14b8a6" />
      <rect x="26" y="24" width="68" height="50" rx="22" fill="url(#hvRobotBody)" stroke="#99d5cc" strokeWidth="2" />
      <rect x="35" y="34" width="50" height="30" rx="14" fill="#0f3d3a" />
      <circle cx="49" cy="49" r="5" fill="#5eead4" />
      <circle cx="71" cy="49" r="5" fill="#5eead4" />
      <path d="M53 57c4 3 10 3 14 0" stroke="#5eead4" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <rect x="20" y="40" width="8" height="18" rx="4" fill="#14b8a6" />
      <rect x="92" y="40" width="8" height="18" rx="4" fill="#14b8a6" />
      <rect x="36" y="76" width="48" height="30" rx="14" fill="url(#hvRobotBody)" stroke="#99d5cc" strokeWidth="2" />
      <path d="M60 84v14M53 91h14" stroke="#14b8a6" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function packageOffPercent(pkg: LabPanel): number | null {
  const mrp = Number(pkg.mrp || 0);
  const rate = Number(pkg.rate || 0);
  if (mrp > rate && rate > 0) return Math.round(((mrp - rate) / mrp) * 100);
  return null;
}

function useRail() {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = useCallback((dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const step = Math.min(560, Math.max(220, el.clientWidth * 0.8));
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  }, []);
  return { ref, scroll };
}

function RailArrows({ onScroll, label }: { onScroll: (dir: -1 | 1) => void; label: string }) {
  return (
    <>
      <button type="button" className="hv-rail-arrow hv-rail-prev" aria-label={`Scroll ${label} left`} onClick={() => onScroll(-1)}>
        ‹
      </button>
      <button type="button" className="hv-rail-arrow hv-rail-next" aria-label={`Scroll ${label} right`} onClick={() => onScroll(1)}>
        ›
      </button>
    </>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [popular, setPopular] = useState<CatalogItem[]>([]);
  const [packages, setPackages] = useState<LabPanel[]>([]);
  const [radiology, setRadiology] = useState<HomeRadiologyService[]>([]);
  const [categories, setCategories] = useState<HealthCategory[]>([]);
  const [steps, setSteps] = useState<CollectionStep[]>([]);
  const [whatsapp, setWhatsapp] = useState<WhatsappCta | null>(null);
  const [headers, setHeaders] = useState<HomeHeaders>({});
  const [, setError] = useState<string | null>(null);
  const [, setLoading] = useState(true);
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [pin, setPin] = useState('');
  const [centreCount, setCentreCount] = useState<number | null>(null);
  const pkgRail = useRail();
  const popularRail = useRail();
  const aiRef = useRef<HTMLDivElement>(null);

  const workflowSteps = useMemo(() => {
    if (steps.length >= 5) return steps.slice(0, 5);
    return FALLBACK_COLLECTION_STEPS.map((fallback, i) => ({
      ...fallback,
      step: i + 1,
      title: steps[i]?.title || fallback.title,
      description: steps[i]?.description || fallback.description,
    }));
  }, [steps]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getHomeContent();
      setPopular(res.data.popular_tests || []);
      setPackages(res.data.health_packages || []);
      setRadiology(res.data.radiology_services || []);
      const cats = (res.data.health_categories as HealthCategory[]) || [];
      setCategories(cats.length ? cats : FALLBACK_CATEGORIES);
      setSteps((res.data.collection_steps as CollectionStep[]) || []);
      setWhatsapp(res.data.whatsapp_cta || null);
      setHeaders(res.data.headers || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load home');
      setCategories(FALLBACK_CATEGORIES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    api
      .listPublicCentres({ latitude: null, longitude: null, radius_km: null })
      .then((res) => setCentreCount((res.data.centers || res.data.centres || []).length))
      .catch(() => setCentreCount(null));
  }, [load]);

  useLiveRefresh(load);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setSlide((s) => (s + 1) % HERO_SLIDES.length), 8000);
    return () => window.clearInterval(id);
  }, [paused]);

  function onFindCentre(e: FormEvent) {
    e.preventDefault();
    const q = pin.trim();
    navigate(q ? `/centres?q=${encodeURIComponent(q)}` : '/centres');
  }

  function focusSymptomChecker() {
    const input = aiRef.current?.querySelector<HTMLInputElement>('.ai-physician-entry input');
    input?.focus();
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const radiologyCards = (radiology.length ? radiology : FALLBACK_RADIOLOGY).slice(0, 4);
  const concernList = (categories.length ? categories : FALLBACK_CATEGORIES).slice(0, 10);
  const searchPlaceholder =
    headers.search_placeholder || 'Search tests & packages (e.g. CBC, thyroid, diabetes)';

  return (
    <div className="home-v2">
      {/* Hero */}
      <section
        className="hv-hero"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        aria-roledescription="carousel"
        aria-label="Featured"
      >
        {HERO_SLIDES.map((s, i) => (
          <img
            key={s.id}
            className={`hv-hero-img${i === slide ? ' is-active' : ''}`}
            src={s.image}
            alt=""
            loading={i === 0 ? 'eager' : 'lazy'}
          />
        ))}
        <div className="hv-hero-fade" />
        <div className="hv-hero-copy">
          <span className="hv-badge">
            <Icon size={14}>{ICONS.shield}</Icon> NABL Accredited
          </span>
          <h1>
            {HERO_SLIDES[slide].title}
            <span>{HERO_SLIDES[slide].accent}</span>
          </h1>
          <p className="hv-hero-sub">{HERO_SLIDES[slide].subtitle}</p>
          <ul className="hv-hero-trust">
            {HERO_TRUST.map((t) => (
              <li key={t.title}>
                <span className="hv-trust-icon">
                  <Icon size={16}>{ICONS[t.icon]}</Icon>
                </span>
                <span>
                  <strong>{t.title}</strong>
                  <small>{t.sub}</small>
                </span>
              </li>
            ))}
          </ul>
          <div className="hv-hero-actions">
            <Link className="hv-btn" to="/diagnostics">
              Book a Lab Test <span aria-hidden>→</span>
            </Link>
            <Link className="hv-btn hv-btn-ghost" to="/diagnostics?q=package">
              Explore Health Packages
            </Link>
          </div>
        </div>
        <div className="hv-hero-seal" aria-label="India's first fair price diagnostic lab">
          <span className="hv-seal-arc" aria-hidden />
          <small>India&apos;s First</small>
          <strong>Fair Price</strong>
          <small>Diagnostic Lab</small>
        </div>
        <div className="hv-hero-dots" role="tablist" aria-label="Slides">
          {HERO_SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === slide}
              aria-label={`Slide ${i + 1}`}
              className={i === slide ? 'is-active' : ''}
              onClick={() => setSlide(i)}
            />
          ))}
        </div>
      </section>

      {/* Quick actions */}
      <nav className="hv-card hv-quick" aria-label="Quick actions">
        {QUICK_ACTIONS.map((qa) => (
          <Link key={qa.title} className="hv-quick-item" to={qa.auth && !isAuthenticated ? '/login' : qa.to}>
            <span className={`hv-quick-icon tone-${qa.tone}`}>
              <Icon size={24}>{ICONS[qa.icon]}</Icon>
            </span>
            <span>{qa.title}</span>
          </Link>
        ))}
      </nav>

      {/* AI health assistant */}
      <section className="hv-card hv-ai" ref={aiRef}>
        <div className="hv-ai-mascot">
          <RobotMascot />
        </div>
        <div className="hv-ai-main">
          <AiPhysicianEntry
            kicker="AI Health Assistant"
            intro="Get guided test suggestions, doctor booking, and nearby centres — by text or voice."
            placeholder={searchPlaceholder}
          />
          <div className="hv-ai-chips">
            <Link className="hv-chip" to="/pharmacy">
              <Icon size={15}>{ICONS.upload}</Icon> Upload Prescription
            </Link>
            <button type="button" className="hv-chip" onClick={focusSymptomChecker}>
              <Icon size={15}>{ICONS.stetho}</Icon> Symptom Checker
            </button>
          </div>
        </div>
        <div className="hv-ai-popular">
          <p>Or try popular searches</p>
          <div className="hv-ai-popular-chips">
            {POPULAR_SEARCHES.map((p) => (
              <Link key={p.label} className="hv-chip hv-chip-soft" to={`/diagnostics?q=${encodeURIComponent(p.q)}`}>
                {p.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* NABL banner */}
      <section className="hv-nabl">
        <div className="hv-nabl-visual">
          <img src="/home/nabl-facility.jpg" alt="" loading="lazy" />
          <div className="hv-nabl-copy">
            <span className="hv-badge hv-badge-light">✓ NABL Accredited</span>
            <h2>Accurate Reports, Trusted Care</h2>
            <p>Professional phlebotomist visits your address.</p>
            <Link className="hv-btn" to="/diagnostics">
              Book a Test <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
        <ul className="hv-nabl-points">
          {NABL_POINTS.map((p) => (
            <li key={p.label}>
              <span className="hv-point-icon">
                <Icon size={16}>{ICONS[p.icon]}</Icon>
              </span>
              {p.label}
            </li>
          ))}
        </ul>
      </section>

      {/* Health packages */}
      <section className="hv-section">
        <div className="hv-head">
          <div>
            <h2>{headers.section_packages_title || 'Health Packages'}</h2>
            <p>Curated panels with transparent pricing.</p>
          </div>
          <Link className="hv-link" to="/diagnostics?q=package">
            View All ›
          </Link>
        </div>
        <div className="hv-rail-wrap">
          <RailArrows onScroll={pkgRail.scroll} label="packages" />
          <div className="hv-rail" ref={pkgRail.ref}>
            {(packages.length
              ? packages.map((pkg, idx) => {
                  const off = packageOffPercent(pkg);
                  const look = PKG_ICONS[idx % PKG_ICONS.length];
                  const to = `/diagnostics/panel/${encodeURIComponent(pkg.panel_id)}`;
                  return (
                    <article key={pkg.panel_id} className="hv-pkg">
                      {off ? <span className="hv-off">{off}% OFF</span> : null}
                      <span className={`hv-pkg-icon tone-${look.tone}`}>
                        <Icon size={22}>{ICONS[look.icon]}</Icon>
                      </span>
                      <h3>{pkg.panel_name}</h3>
                      <p className="hv-muted">
                        {pkg.tests?.length ? `${pkg.tests.length} tests included` : stripHtml(pkg.description)}
                      </p>
                      <PriceTag
                        compact
                        size="sm"
                        item={{
                          name: pkg.panel_id,
                          item_name: pkg.panel_name,
                          standard_rate: Number(pkg.rate),
                          rate: Number(pkg.rate),
                          mrp: pkg.mrp ? Number(pkg.mrp) : undefined,
                          discount_percent: off || pkg.discount_percent,
                          price_basis: pkg.price_basis || (off ? 'ten_percent' : undefined),
                          wallet_earn_amount: pkg.wallet_earn_amount,
                          wallet_earn_percent: pkg.wallet_earn_percent,
                          member_tag: pkg.member_tag,
                          coupon_label: pkg.coupon_label,
                        }}
                      />
                      <div className="hv-pkg-actions">
                        <Link className="hv-btn hv-btn-soft hv-btn-sm" to={to}>
                          View Details
                        </Link>
                        <Link className="hv-btn hv-btn-sm" to={to}>
                          Book Now
                        </Link>
                      </div>
                    </article>
                  );
                })
              : FALLBACK_PACKAGES.map((pkg, idx) => {
                  const look = PKG_ICONS[idx % PKG_ICONS.length];
                  const to = `/diagnostics?q=${encodeURIComponent(pkg.q)}`;
                  const off = Math.round(((pkg.mrp - pkg.rate) / pkg.mrp) * 100);
                  return (
                    <article key={pkg.panel_id} className="hv-pkg">
                      <span className="hv-off">{off}% OFF</span>
                      <span className={`hv-pkg-icon tone-${look.tone}`}>
                        <Icon size={22}>{ICONS[look.icon]}</Icon>
                      </span>
                      <h3>{pkg.panel_name}</h3>
                      <p className="hv-muted">{pkg.tests} tests included</p>
                      <p className="hv-pkg-price">
                        <span className="price-sale">₹{pkg.rate}</span>
                        <span className="price-mrp">₹{pkg.mrp}</span>
                      </p>
                      <div className="hv-pkg-actions">
                        <Link className="hv-btn hv-btn-soft hv-btn-sm" to={to}>
                          View Details
                        </Link>
                        <Link className="hv-btn hv-btn-sm" to={to}>
                          Book Now
                        </Link>
                      </div>
                    </article>
                  );
                }))}
          </div>
        </div>
      </section>

      {/* Nearby centres */}
      <section className="hv-centres">
        <img className="hv-centres-img" src="/home/centre-reception.jpg" alt="" loading="lazy" />
        <div className="hv-centres-fade" />
        <div className="hv-centres-copy">
          <span className="hv-centres-pin">
            <Icon size={22}>{ICONS.pin}</Icon>
          </span>
          <h2>Nearby Remedium Centres</h2>
          <p>Find Remedium labs &amp; centres near you.</p>
          <form className="hv-centres-form" onSubmit={onFindCentre}>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter pincode or location"
              aria-label="Pincode or location"
            />
            <button type="submit" className="hv-btn">
              Find Nearby
            </button>
          </form>
        </div>
        <div className="hv-centres-logo" aria-hidden>
          <strong>Remedium</strong>
          <small>Fair Price Diagnostic Lab</small>
        </div>
        <ul className="hv-centres-stats">
          {centreCount ? (
            <li>
              <strong>{centreCount}</strong>
              <span>Active centres</span>
            </li>
          ) : null}
          <li>
            <strong>NABL</strong>
            <span>Accredited</span>
          </li>
          <li>
            <strong>Trusted</strong>
            <span>by thousands</span>
          </li>
        </ul>
      </section>

      {/* Chronic medicine + offers */}
      <section className="hv-chronic-row">
        <div className="hv-chronic">
          <div className="hv-chronic-copy">
            <span className="hv-pill-badge">Monthly packs</span>
            <h2>Chronic medicine subscription</h2>
            <p>
              Upload your prescription once and get wholesale-rate monthly medicine packs delivered — diabetes, BP,
              thyroid and long-term care.
            </p>
            <ul>
              <li>Up to 60–70% savings vs retail</li>
              <li>1–12 month pack duration</li>
              <li>Pharmacist-reviewed quotation</li>
            </ul>
            <div className="hv-chronic-actions">
              <Link className="hv-btn" to="/pharmacy">
                Start subscription quote
              </Link>
              <Link className="hv-btn hv-btn-ghost" to={isAuthenticated ? '/bookings' : '/login'}>
                Track orders
              </Link>
            </div>
          </div>
          <img className="hv-chronic-img" src="/home/chronic-meds.jpg" alt="" loading="lazy" />
        </div>
        <div className="hv-offers">
          <div className="hv-card hv-offer">
            <span className="hv-offer-icon tone-green">
              <Icon size={26}>{ICONS.gift}</Icon>
            </span>
            <div>
              <strong>Exclusive Offers</strong>
              <p>Save more on health checkups and health packages.</p>
              <Link className="hv-btn hv-btn-ghost hv-btn-sm" to="/diagnostics?q=package">
                View Offers
              </Link>
            </div>
          </div>
          <div className="hv-card hv-offer">
            <span className="hv-offer-icon tone-blue">
              <Icon size={26}>{ICONS.people}</Icon>
            </span>
            <div>
              <strong>Refer &amp; Earn</strong>
              <p>Refer a friend &amp; earn rewards on every booking.</p>
              <Link className="hv-btn hv-btn-ghost hv-btn-sm" to={isAuthenticated ? '/account/refer' : '/login'}>
                Refer Now
              </Link>
            </div>
          </div>
        </div>
      </section>

      {whatsapp?.enabled && whatsapp.url ? (
        <section className="hv-card hv-whatsapp">
          <div>
            <strong>Prefer WhatsApp?</strong>
            <p className="hv-muted">Chat with us to book tests, packages, or home collection.</p>
          </div>
          <a className="hv-btn hv-btn-wa" href={whatsapp.url} target="_blank" rel="noreferrer">
            {whatsapp.label || 'Book on WhatsApp'}
          </a>
        </section>
      ) : null}

      {/* Concerns + radiology */}
      <section className="hv-split">
        <div className="hv-card hv-concerns">
          <div className="hv-head">
            <h2>Browse by concern</h2>
          </div>
          <div className="hv-concern-grid">
            {concernList.map((cat) => {
              const look = concernIcon(cat.label);
              return (
                <Link key={cat.label} className="hv-concern" to={`/diagnostics?q=${encodeURIComponent(cat.query)}`}>
                  <span className={`hv-concern-icon tone-${look.tone}`}>
                    <Icon size={18}>{ICONS[look.icon]}</Icon>
                  </span>
                  {cat.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="hv-card hv-radiology">
          <div className="hv-head">
            <h2>{headers.section_radiology_title || 'Radiology & imaging'}</h2>
            <Link className="hv-link" to="/services">
              View all ›
            </Link>
          </div>
          <div className="hv-radiology-grid">
            {radiologyCards.map((svc) => (
              <article key={svc.title || svc.query} className="hv-radiology-card">
                <strong>{svc.title}</strong>
                <p className="hv-muted">{svc.description}</p>
                <Link className="hv-btn hv-btn-soft hv-btn-sm" to={`/diagnostics?q=${encodeURIComponent(svc.query || svc.title)}`}>
                  Explore
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Popular diagnostics */}
      <section className="hv-section">
        <div className="hv-head">
          <h2>{headers.section_popular_title || 'Popular diagnostics'}</h2>
          <Link className="hv-link" to="/diagnostics">
            View all ›
          </Link>
        </div>
        <div className="hv-rail-wrap">
          <RailArrows onScroll={popularRail.scroll} label="popular diagnostics" />
          <div className="hv-rail" ref={popularRail.ref} role="list">
            {(popular.length
              ? popular.map((item) => {
                  const off = itemDiscountPercent(item);
                  const blurb = stripHtml(item.description || '');
                  return (
                    <article key={item.name} className="hv-test" role="listitem">
                      {off > 0 ? <span className="hv-off">{off}% OFF</span> : null}
                      <h3 title={item.item_name}>{item.item_name}</h3>
                      <p className="hv-muted">
                        {blurb && blurb.toLowerCase() !== item.item_name.toLowerCase() ? blurb : 'Lab test profile'}
                      </p>
                      <PriceTag item={item} size="sm" />
                      <Link className="hv-btn hv-btn-sm" to={`/diagnostics/book/${encodeURIComponent(item.name)}`}>
                        Book
                      </Link>
                    </article>
                  );
                })
              : FALLBACK_POPULAR.map((item) => (
                  <article key={item.name} className="hv-test" role="listitem">
                    <span className="hv-off">{Math.round(((item.mrp - item.rate) / item.mrp) * 100)}% OFF</span>
                    <h3 title={item.item_name}>{item.item_name}</h3>
                    <p className="hv-muted">{item.desc}</p>
                    <p className="hv-pkg-price">
                      <span className="price-sale">₹{item.rate}</span>
                      <span className="price-mrp">₹{item.mrp}</span>
                    </p>
                    <Link className="hv-btn hv-btn-sm" to={`/diagnostics?q=${encodeURIComponent(item.q)}`}>
                      Book
                    </Link>
                  </article>
                )))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="hv-section">
        <div className="hv-head">
          <div>
            <h2>How home sample collection works</h2>
            <p>From booking to report — tracked end to end.</p>
          </div>
        </div>
        <ol className="hv-card hv-flow" aria-label="Home sample collection workflow">
          {workflowSteps.map((s, idx) => (
            <li key={`${s.step}-${s.title}`} className="hv-flow-step">
              <span className="hv-flow-num">{s.step}</span>
              <span className="hv-flow-icon">
                <Icon size={20}>{ICONS[WORKFLOW_ICONS[idx] || 'check']}</Icon>
              </span>
              <strong>{s.title}</strong>
              <p>{s.description}</p>
              {idx < workflowSteps.length - 1 ? (
                <span className="hv-flow-bike" aria-hidden style={{ animationDelay: `${idx * 0.55}s` }}>
                  <DeliveryBikeIcon />
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
