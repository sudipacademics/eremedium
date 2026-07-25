import type { AlliedHealthService } from '../../api';

export type WellnessTheme = 'clinic' | 'indic';

export type WellnessTab = {
  id: string;
  label: string;
  keywords: string[];
};

export type WellnessConcern = {
  tab: string;
  label: string;
  query: string;
  image: string;
};

export type WellnessClinicConfig = {
  wingId: string;
  kicker: string;
  headline: string;
  lead: string;
  heroImage: string;
  heroFallback: string;
  departmentName: string;
  theme: WellnessTheme;
  stickyTitle: string;
  stickySub: string;
  trust: Array<{ title: string; text: string }>;
  tabs: WellnessTab[];
  concerns: WellnessConcern[];
  quotes: Array<{ quote: string; name: string; focus: string }>;
  hubTeaser: string;
};

function matchTab(service: AlliedHealthService, tabs: WellnessTab[]): string {
  const text = `${service.service_name} ${service.item_group || ''} ${service.short_description || ''}`.toLowerCase();
  for (const tab of tabs) {
    if (tab.keywords.some((k) => text.includes(k.toLowerCase()))) return tab.id;
  }
  return tabs[0]?.id || 'all';
}

export function serviceMatchesTab(
  service: AlliedHealthService,
  tabId: string,
  tabs: WellnessTab[],
): boolean {
  return matchTab(service, tabs) === tabId;
}

export const WELLNESS_CLINIC_CONFIGS: Record<string, WellnessClinicConfig> = {
  aesthetics: {
    wingId: 'aesthetics',
    kicker: 'Remedium Aesthetics',
    headline: 'Skin & aesthetic specialists',
    lead: 'Advanced dermatology-led treatments for skin, hair, and body — consult-first, clear pricing, lasting confidence.',
    heroImage: '/wellness/aesthetics-hero.jpg',
    heroFallback: '/wellness/aesthetics.svg',
    departmentName: 'Aesthetic Dermatology',
    theme: 'clinic',
    stickyTitle: 'Ready for clearer, healthier skin?',
    stickySub: 'Session-based plans with transparent pricing.',
    trust: [
      { title: 'Dermatology-led care', text: 'Consult-first plans guided by aesthetic dermatology expertise.' },
      { title: 'Personalised protocols', text: 'A structured consult to understand your skin, hair, and body goals.' },
      { title: 'Transparent pricing', text: 'Session rates shown upfront — no surprise add-ons at the desk.' },
      { title: 'Session-based results', text: 'Clear plans so you know what to expect across visits.' },
      { title: 'One health ecosystem', text: 'Labs, doctors, and aesthetics under Remedium.' },
    ],
    tabs: [
      { id: 'Skin', label: 'Skin', keywords: ['acne', 'peel', 'pigment', 'facial', 'botox', 'filler', 'melasma', 'mole', 'wart', 'glow', 'rejuven', 'micro', 'tattoo', 'medi'] },
      { id: 'Hair', label: 'Hair', keywords: ['hair', 'prp', 'scalp', 'trich'] },
      { id: 'Body', label: 'Body', keywords: ['body', 'contour', 'fat', 'stretch', 'polish', 'wrap', 'massage', 'hand', 'foot'] },
    ],
    concerns: [
      { tab: 'Skin', label: 'Acne & scars', query: 'acne', image: '/wellness/aesthetics-skin.jpg' },
      { tab: 'Skin', label: 'Pigmentation', query: 'pigment', image: '/wellness/aesthetics-skin.jpg' },
      { tab: 'Hair', label: 'Hair fall', query: 'hair', image: '/wellness/aesthetics-hair.jpg' },
      { tab: 'Hair', label: 'PRP restoration', query: 'prp', image: '/wellness/aesthetics-hair.jpg' },
      { tab: 'Body', label: 'Contouring', query: 'contour', image: '/wellness/aesthetics-body.jpg' },
      { tab: 'Body', label: 'Stretch marks', query: 'stretch', image: '/wellness/aesthetics-body.jpg' },
    ],
    quotes: [
      { quote: 'The consult felt thorough — they explained options without pushing packages.', name: 'Ananya R.', focus: 'Skin rejuvenation' },
      { quote: 'Laser sessions were clear on cost and after-care.', name: 'Meera K.', focus: 'Laser hair removal' },
      { quote: 'PRP plan was paced properly. Easy to track under My orders.', name: 'Rohan S.', focus: 'Hair restoration' },
    ],
    hubTeaser: 'Skin, hair & body — dermatology-led sessions with transparent pricing.',
  },

  psychology: {
    wingId: 'psychology',
    kicker: 'Remedium Psychology',
    headline: 'Mind care, one session at a time',
    lead: 'Counselling and therapy sessions that meet you where you are — confidential, structured, and easy to book.',
    heroImage: '/wellness/psychology-hero.jpg',
    heroFallback: '/wellness/psychology.svg',
    departmentName: 'Psychology & Mental Health',
    theme: 'clinic',
    stickyTitle: 'Ready to talk it through?',
    stickySub: 'Book a counselling or therapy session online.',
    trust: [
      { title: 'Session-based care', text: 'Book individual sessions — no opaque long-term lock-ins.' },
      { title: 'Confidential space', text: 'Private consults with clear boundaries and professional ethics.' },
      { title: 'Evidence-informed', text: 'Counselling approaches matched to your goals in the first session.' },
      { title: 'Flexible scheduling', text: 'Pick a slot that fits your week; track visits in My orders.' },
      { title: 'Part of Remedium', text: 'Mental health alongside labs and doctors when you need the full picture.' },
    ],
    tabs: [
      { id: 'Therapy', label: 'Therapy', keywords: ['therap', 'counsel', 'psychotherap', 'cbt', 'session'] },
      { id: 'Stress', label: 'Stress', keywords: ['stress', 'burnout', 'anxiety', 'panic', 'worry'] },
      { id: 'Life', label: 'Life', keywords: ['family', 'couple', 'relation', 'child', 'teen', 'career', 'grief'] },
    ],
    concerns: [
      { tab: 'Stress', label: 'Anxiety', query: 'anxiety', image: '/wellness/psychology-hero.jpg' },
      { tab: 'Stress', label: 'Burnout', query: 'stress', image: '/wellness/psychology-hero.jpg' },
      { tab: 'Therapy', label: 'Individual therapy', query: 'therap', image: '/wellness/psychology-hero.jpg' },
      { tab: 'Life', label: 'Relationships', query: 'relation', image: '/wellness/psychology-hero.jpg' },
      { tab: 'Life', label: 'Family support', query: 'family', image: '/wellness/psychology-hero.jpg' },
    ],
    quotes: [
      { quote: 'First session set clear goals without feeling rushed.', name: 'Priya M.', focus: 'Counselling' },
      { quote: 'Helped me pace work stress — booking from the app was simple.', name: 'Arjun T.', focus: 'Stress support' },
      { quote: 'Felt heard. Follow-up sessions were easy to schedule.', name: 'Nisha K.', focus: 'Therapy' },
    ],
    hubTeaser: 'Counselling & therapy sessions — confidential, goal-led, bookable online.',
  },

  physiotherapy: {
    wingId: 'physiotherapy',
    kicker: 'Remedium Physiotherapy',
    headline: 'Move better, session by session',
    lead: 'Rehab and pain-relief sessions for back, joints, sports, and posture — assessed, guided, and tracked.',
    heroImage: '/wellness/physio-hero.jpg',
    heroFallback: '/wellness/physiotherapy.svg',
    departmentName: 'Physiotherapy & Rehabilitation',
    theme: 'clinic',
    stickyTitle: 'Book a physio session',
    stickySub: 'Assessment-led plans with clear session goals.',
    trust: [
      { title: 'Assessment first', text: 'Every plan starts with how you move and what hurts.' },
      { title: 'Session goals', text: 'Know what each visit is working toward — strength, mobility, or relief.' },
      { title: 'Transparent rates', text: 'Session pricing upfront before you confirm.' },
      { title: 'Home carryover', text: 'Exercises you can continue between clinic visits.' },
      { title: 'Sports to desk', text: 'From injury rehab to posture care for everyday life.' },
    ],
    tabs: [
      { id: 'Spine', label: 'Spine', keywords: ['back', 'spine', 'neck', 'lumbar', 'cervical'] },
      { id: 'Joints', label: 'Joints', keywords: ['knee', 'shoulder', 'hip', 'ankle', 'joint', 'arthritis'] },
      { id: 'Sports', label: 'Sports', keywords: ['sport', 'athlete', 'injury', 'rehab', 'sprain'] },
      { id: 'Posture', label: 'Posture', keywords: ['posture', 'ergonomic', 'desk', 'gait'] },
    ],
    concerns: [
      { tab: 'Spine', label: 'Back pain', query: 'back', image: '/wellness/physio-hero.jpg' },
      { tab: 'Spine', label: 'Neck strain', query: 'neck', image: '/wellness/physio-hero.jpg' },
      { tab: 'Joints', label: 'Knee care', query: 'knee', image: '/wellness/physio-hero.jpg' },
      { tab: 'Sports', label: 'Sports injury', query: 'sport', image: '/wellness/physio-hero.jpg' },
      { tab: 'Posture', label: 'Desk posture', query: 'posture', image: '/wellness/physio-hero.jpg' },
    ],
    quotes: [
      { quote: 'Clear exercise plan after the first assessment.', name: 'Vikram S.', focus: 'Back rehab' },
      { quote: 'Knee sessions were paced well — I could book next slots myself.', name: 'Sneha P.', focus: 'Joints' },
      { quote: 'Posture tips for desk work made a real difference.', name: 'Karan D.', focus: 'Posture' },
    ],
    hubTeaser: 'Rehab & pain-relief sessions — spine, joints, sports, and posture.',
  },

  chiropractic: {
    wingId: 'chiropractic',
    kicker: 'Remedium Chiropractic',
    headline: 'Spine & posture, carefully guided',
    lead: 'Session-based chiropractic and osteopathy care for alignment, mobility, and lasting comfort.',
    heroImage: '/wellness/chiro-hero.jpg',
    heroFallback: '/wellness/chiropractic.svg',
    departmentName: 'Chiropractic & Osteopathy',
    theme: 'clinic',
    stickyTitle: 'Book an alignment session',
    stickySub: 'Gentle, structured visits for spine and posture.',
    trust: [
      { title: 'Hands-on care', text: 'Focused sessions for spine, joints, and soft tissue.' },
      { title: 'Explain then treat', text: 'You understand the plan before any adjustment.' },
      { title: 'Session clarity', text: 'Book one visit or a short course — rates are visible.' },
      { title: 'Mobility focus', text: 'Designed to help you move with less stiffness day to day.' },
      { title: 'Desk to active', text: 'Support whether you sit all day or train hard.' },
    ],
    tabs: [
      { id: 'Spine', label: 'Spine', keywords: ['spine', 'back', 'adjust', 'alignment', 'lumbar'] },
      { id: 'Neck', label: 'Neck', keywords: ['neck', 'cervical', 'whiplash'] },
      { id: 'Posture', label: 'Posture', keywords: ['posture', 'desk', 'scoliosis'] },
      { id: 'Mobility', label: 'Mobility', keywords: ['osteo', 'mobil', 'soft tissue', 'stretch'] },
    ],
    concerns: [
      { tab: 'Spine', label: 'Lower back', query: 'back', image: '/wellness/chiro-hero.jpg' },
      { tab: 'Neck', label: 'Neck tension', query: 'neck', image: '/wellness/chiro-hero.jpg' },
      { tab: 'Posture', label: 'Desk posture', query: 'posture', image: '/wellness/chiro-hero.jpg' },
      { tab: 'Mobility', label: 'Stiffness', query: 'mobil', image: '/wellness/chiro-hero.jpg' },
    ],
    quotes: [
      { quote: 'Felt safer knowing they explained every step.', name: 'Leena A.', focus: 'Spine care' },
      { quote: 'Neck sessions helped my desk strain within a few visits.', name: 'Imran H.', focus: 'Neck' },
      { quote: 'Easy booking and clear pricing per session.', name: 'Divya R.', focus: 'Posture' },
    ],
    hubTeaser: 'Spine, posture & osteopathy — careful, session-based care.',
  },

  ayurvedic: {
    wingId: 'ayurvedic',
    kicker: 'आयुर्वेद · Remedium Ayurveda',
    headline: 'Balance body & mind the Ayurvedic way',
    lead: 'Classical therapies and consults in session form — Abhyanga, Panchakarma guidance, and dinacharya support rooted in Indic wisdom.',
    heroImage: '/wellness/ayurveda-hero.jpg',
    heroFallback: '/wellness/ayurvedic.svg',
    departmentName: 'Ayurveda & Naturopathy',
    theme: 'indic',
    stickyTitle: 'Begin your Ayurveda session',
    stickySub: 'Consult-led therapies with transparent session rates.',
    trust: [
      { title: 'Śāstra-informed care', text: 'Protocols guided by classical Ayurvedic principles.' },
      { title: 'Prakṛti-aware', text: 'Consult first to understand your constitution and goals.' },
      { title: 'Session clarity', text: 'Book therapies and follow-ups one visit at a time.' },
      { title: 'Gentle therapies', text: 'From Abhyanga to specialised treatments — paced for you.' },
      { title: 'Living routine', text: 'Dinacharya tips you can carry home between sessions.' },
    ],
    tabs: [
      { id: 'Consult', label: 'Consult', keywords: ['consult', 'assessment', 'prakriti', 'dosha'] },
      { id: 'Therapy', label: 'Therapies', keywords: ['abhyang', 'massage', 'shiro', 'nasya', 'pizhichil', 'udvartan'] },
      { id: 'Detox', label: 'Detox', keywords: ['panchakarma', 'detox', 'virechan', 'basti', 'vaman'] },
      { id: 'Skin', label: 'Skin & hair', keywords: ['skin', 'hair', 'lepa', 'mukha'] },
    ],
    concerns: [
      { tab: 'Consult', label: 'Dosha consult', query: 'consult', image: '/wellness/ayurveda-hero.jpg' },
      { tab: 'Therapy', label: 'Abhyanga', query: 'abhyang', image: '/wellness/ayurveda-hero.jpg' },
      { tab: 'Detox', label: 'Panchakarma', query: 'panchakarma', image: '/wellness/ayurveda-hero.jpg' },
      { tab: 'Skin', label: 'Skin & hair', query: 'skin', image: '/wellness/ayurveda-hero.jpg' },
    ],
    quotes: [
      { quote: 'The consult connected my lifestyle to the therapy plan clearly.', name: 'Kavitha S.', focus: 'Ayurveda consult' },
      { quote: 'Abhyanga sessions felt grounding — booking was straightforward.', name: 'Amit B.', focus: 'Therapies' },
      { quote: 'Appreciated the Indic approach without overselling packages.', name: 'Shruti N.', focus: 'Holistic care' },
    ],
    hubTeaser: 'Ayurveda & naturopathy sessions — Indic therapies, consult-led.',
  },

  yoga: {
    wingId: 'yoga',
    kicker: 'योग · Remedium Yoga',
    headline: 'Asana, breath & stillness — in sessions',
    lead: 'Group and guided yoga sessions for strength, prāṇāyāma, and mindfulness — an Indic path to everyday calm.',
    heroImage: '/wellness/yoga-hero.jpg',
    heroFallback: '/wellness/yoga.svg',
    departmentName: 'Yoga & Mindfulness',
    theme: 'indic',
    stickyTitle: 'Join a yoga session',
    stickySub: 'Asana, breathwork, and meditation — book your spot.',
    trust: [
      { title: 'Guru-paramparā spirit', text: 'Sessions rooted in classical yoga practice, taught accessibly.' },
      { title: 'Breath meets body', text: 'Asana and prāṇāyāma woven into each class rhythm.' },
      { title: 'Session booking', text: 'Join class by class — transparent fees, clear schedule.' },
      { title: 'All levels welcome', text: 'From first mat to deeper practice — paced with care.' },
      { title: 'Mindfulness included', text: 'Close with stillness so calm carries into your day.' },
    ],
    tabs: [
      { id: 'Asana', label: 'Asana', keywords: ['yoga', 'asana', 'flow', 'hatha', 'vinyasa', 'class'] },
      { id: 'Breath', label: 'Prāṇāyāma', keywords: ['breath', 'pranayam', 'prāṇ', 'respir'] },
      { id: 'Stillness', label: 'Meditation', keywords: ['meditat', 'mindful', 'dhyan', 'relax'] },
      { id: 'Restore', label: 'Restore', keywords: ['yin', 'restor', 'evening', 'gentle', 'senior'] },
    ],
    concerns: [
      { tab: 'Asana', label: 'Beginner flow', query: 'yoga', image: '/wellness/yoga-hero.jpg' },
      { tab: 'Breath', label: 'Breathwork', query: 'breath', image: '/wellness/yoga-hero.jpg' },
      { tab: 'Stillness', label: 'Meditation', query: 'meditat', image: '/wellness/yoga-hero.jpg' },
      { tab: 'Restore', label: 'Evening calm', query: 'restor', image: '/wellness/yoga-hero.jpg' },
    ],
    quotes: [
      { quote: 'Classes felt authentic without being intimidating.', name: 'Neha J.', focus: 'Asana' },
      { quote: 'Breath sessions helped my evenings unwind.', name: 'Suresh L.', focus: 'Prāṇāyāma' },
      { quote: 'Love booking one session at a time from the app.', name: 'Isha V.', focus: 'Mindfulness' },
    ],
    hubTeaser: 'Yoga & mindfulness sessions — asana, breath, and stillness.',
  },
};

export function getWellnessClinicConfig(wingId: string): WellnessClinicConfig | null {
  return WELLNESS_CLINIC_CONFIGS[wingId] || null;
}
