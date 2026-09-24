import { SIGN_SHORT, type VargaCode } from './vedic';

export type ChartLanguageId = 'en' | 'sa' | 'hi' | 'bn' | 'mr' | 'gu' | 'pa' | 'or' | 'ta' | 'te' | 'kn' | 'ml';

type Grahas<T> = Record<'Sun' | 'Moon' | 'Mars' | 'Mercury' | 'Jupiter' | 'Venus' | 'Saturn' | 'Rahu' | 'Ketu', T>;

export interface ChartLanguage {
  id: ChartLanguageId;
  /** The language's name in its own script, as shown in the selector. */
  endonym: string;
  english: string;
  /** Unicode numbering system for house numbers, so a Hindi chart reads १..१२. */
  numbering: string;
  kundali: string;
  lagna: string;
  /** Superscript mark for a retrograde (vakri) graha. */
  retro: string;
  grahaShort: Grahas<string>;
  grahaName: Grahas<string>;
  /** Sign labels in chart order, Aries first. */
  signs: readonly string[];
  vargas: Record<VargaCode, string>;
}

const VARGA_CODES: VargaCode[] = [
  'D1', 'D2', 'D3', 'D4', 'D7', 'D9', 'D10', 'D12', 'D16', 'D20', 'D24', 'D27', 'D30', 'D40', 'D45', 'D60',
];

const grahas = (names: string[]): Grahas<string> => ({
  Sun: names[0]!,
  Moon: names[1]!,
  Mars: names[2]!,
  Mercury: names[3]!,
  Jupiter: names[4]!,
  Venus: names[5]!,
  Saturn: names[6]!,
  Rahu: names[7]!,
  Ketu: names[8]!,
});

const vargas = (names: string[]): Record<VargaCode, string> =>
  Object.fromEntries(VARGA_CODES.map((code, i) => [code, names[i]!])) as Record<VargaCode, string>;

const DEVANAGARI_VARGAS = vargas([
  'राशि', 'होरा', 'द्रेष्काण', 'चतुर्थांश', 'सप्तांश', 'नवांश', 'दशांश', 'द्वादशांश',
  'षोडशांश', 'विंशांश', 'चतुर्विंशांश', 'सप्तविंशांश', 'त्रिंशांश', 'खवेदांश', 'अक्षवेदांश', 'षष्ट्यंश',
]);

export const CHART_LANGUAGES: readonly ChartLanguage[] = [
  {
    id: 'en',
    endonym: 'English',
    english: 'English',
    numbering: 'latn',
    kundali: 'Janma kundali',
    lagna: 'Asc',
    retro: 'R',
    grahaShort: grahas(['Su', 'Mo', 'Ma', 'Me', 'Ju', 'Ve', 'Sa', 'Ra', 'Ke']),
    grahaName: grahas(['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']),
    signs: SIGN_SHORT,
    vargas: vargas([
      'Rasi', 'Hora', 'Drekkana', 'Chaturthamsha', 'Saptamsha', 'Navamsha', 'Dashamsha', 'Dwadashamsha',
      'Shodashamsha', 'Vimshamsha', 'Chaturvimshamsha', 'Saptavimshamsha', 'Trimshamsha', 'Khavedamsha',
      'Akshavedamsha', 'Shashtiamsha',
    ]),
  },
  {
    id: 'sa',
    endonym: 'संस्कृतम्',
    english: 'Sanskrit',
    numbering: 'deva',
    kundali: 'जन्मकुण्डली',
    lagna: 'लग्नम्',
    retro: 'व',
    grahaShort: grahas(['सू', 'च', 'कु', 'बु', 'गु', 'शु', 'श', 'रा', 'के']),
    grahaName: grahas(['सूर्य', 'चन्द्र', 'कुज', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'राहु', 'केतु']),
    signs: ['मेष', 'वृषभ', 'मिथुन', 'कर्कट', 'सिंह', 'कन्या', 'तुला', 'वृश्चिक', 'धनुः', 'मकर', 'कुम्भ', 'मीन'],
    vargas: DEVANAGARI_VARGAS,
  },
  {
    id: 'hi',
    endonym: 'हिन्दी',
    english: 'Hindi',
    numbering: 'deva',
    kundali: 'जन्म कुंडली',
    lagna: 'लग्न',
    retro: 'व',
    grahaShort: grahas(['सू', 'चं', 'मं', 'बु', 'गु', 'शु', 'श', 'रा', 'के']),
    grahaName: grahas(['सूर्य', 'चंद्र', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'राहु', 'केतु']),
    signs: ['मेष', 'वृषभ', 'मिथुन', 'कर्क', 'सिंह', 'कन्या', 'तुला', 'वृश्चिक', 'धनु', 'मकर', 'कुंभ', 'मीन'],
    vargas: DEVANAGARI_VARGAS,
  },
  {
    id: 'bn',
    endonym: 'বাংলা',
    english: 'Bengali',
    numbering: 'beng',
    kundali: 'জন্মকুণ্ডলী',
    lagna: 'লগ্ন',
    retro: 'ব',
    grahaShort: grahas(['র', 'চ', 'ম', 'বু', 'বৃ', 'শু', 'শ', 'রা', 'কে']),
    grahaName: grahas(['রবি', 'চন্দ্র', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি', 'রাহু', 'কেতু']),
    signs: ['মেষ', 'বৃষ', 'মিথুন', 'কর্কট', 'সিংহ', 'কন্যা', 'তুলা', 'বৃশ্চিক', 'ধনু', 'মকর', 'কুম্ভ', 'মীন'],
    vargas: vargas([
      'রাশি', 'হোরা', 'দ্রেক্কাণ', 'চতুর্থাংশ', 'সপ্তাংশ', 'নবাংশ', 'দশাংশ', 'দ্বাদশাংশ',
      'ষোড়শাংশ', 'বিংশাংশ', 'চতুর্বিংশাংশ', 'সপ্তবিংশাংশ', 'ত্রিংশাংশ', 'খবেদাংশ', 'অক্ষবেদাংশ', 'ষষ্ট্যংশ',
    ]),
  },
  {
    id: 'mr',
    endonym: 'मराठी',
    english: 'Marathi',
    numbering: 'deva',
    kundali: 'जन्मकुंडली',
    lagna: 'लग्न',
    retro: 'व',
    grahaShort: grahas(['र', 'चं', 'मं', 'बु', 'गु', 'शु', 'श', 'रा', 'के']),
    grahaName: grahas(['रवि', 'चंद्र', 'मंगळ', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'राहु', 'केतु']),
    signs: ['मेष', 'वृषभ', 'मिथुन', 'कर्क', 'सिंह', 'कन्या', 'तूळ', 'वृश्चिक', 'धनु', 'मकर', 'कुंभ', 'मीन'],
    vargas: DEVANAGARI_VARGAS,
  },
  {
    id: 'gu',
    endonym: 'ગુજરાતી',
    english: 'Gujarati',
    numbering: 'gujr',
    kundali: 'જન્મકુંડળી',
    lagna: 'લગ્ન',
    retro: 'વ',
    grahaShort: grahas(['સૂ', 'ચં', 'મં', 'બુ', 'ગુ', 'શુ', 'શ', 'રા', 'કે']),
    grahaName: grahas(['સૂર્ય', 'ચંદ્ર', 'મંગળ', 'બુધ', 'ગુરુ', 'શુક્ર', 'શનિ', 'રાહુ', 'કેતુ']),
    signs: ['મેષ', 'વૃષભ', 'મિથુન', 'કર્ક', 'સિંહ', 'કન્યા', 'તુલા', 'વૃશ્ચિક', 'ધન', 'મકર', 'કુંભ', 'મીન'],
    vargas: vargas([
      'રાશિ', 'હોરા', 'દ્રેષ્કાણ', 'ચતુર્થાંશ', 'સપ્તાંશ', 'નવાંશ', 'દશાંશ', 'દ્વાદશાંશ',
      'ષોડશાંશ', 'વિંશાંશ', 'ચતુર્વિંશાંશ', 'સપ્તવિંશાંશ', 'ત્રિંશાંશ', 'ખવેદાંશ', 'અક્ષવેદાંશ', 'ષષ્ટ્યંશ',
    ]),
  },
  {
    id: 'pa',
    endonym: 'ਪੰਜਾਬੀ',
    english: 'Punjabi',
    numbering: 'guru',
    kundali: 'ਜਨਮ ਕੁੰਡਲੀ',
    lagna: 'ਲਗਨ',
    retro: 'ਵ',
    grahaShort: grahas(['ਸੂ', 'ਚੰ', 'ਮੰ', 'ਬੁ', 'ਗੁ', 'ਸ਼ੁ', 'ਸ਼', 'ਰਾ', 'ਕੇ']),
    grahaName: grahas(['ਸੂਰਜ', 'ਚੰਦ', 'ਮੰਗਲ', 'ਬੁੱਧ', 'ਗੁਰੂ', 'ਸ਼ੁੱਕਰ', 'ਸ਼ਨੀ', 'ਰਾਹੂ', 'ਕੇਤੂ']),
    signs: ['ਮੇਖ', 'ਬ੍ਰਿਖ', 'ਮਿਥੁਨ', 'ਕਰਕ', 'ਸਿੰਘ', 'ਕੰਨਿਆ', 'ਤੁਲਾ', 'ਬ੍ਰਿਸ਼ਚਕ', 'ਧਨ', 'ਮਕਰ', 'ਕੁੰਭ', 'ਮੀਨ'],
    vargas: vargas([
      'ਰਾਸ਼ੀ', 'ਹੋਰਾ', 'ਦ੍ਰੇਸ਼ਕਾਣ', 'ਚਤੁਰਥਾਂਸ਼', 'ਸਪਤਾਂਸ਼', 'ਨਵਾਂਸ਼', 'ਦਸ਼ਾਂਸ਼', 'ਦ੍ਵਾਦਸ਼ਾਂਸ਼',
      'ਸ਼ੋਡਸ਼ਾਂਸ਼', 'ਵਿੰਸ਼ਾਂਸ਼', 'ਚਤੁਰਵਿੰਸ਼ਾਂਸ਼', 'ਸਪਤਵਿੰਸ਼ਾਂਸ਼', 'ਤ੍ਰਿੰਸ਼ਾਂਸ਼', 'ਖਵੇਦਾਂਸ਼', 'ਅਕਸ਼ਵੇਦਾਂਸ਼', 'ਸ਼ਸ਼ਟਿਅੰਸ਼',
    ]),
  },
  {
    id: 'or',
    endonym: 'ଓଡ଼ିଆ',
    english: 'Odia',
    numbering: 'orya',
    kundali: 'ଜନ୍ମ କୁଣ୍ଡଳୀ',
    lagna: 'ଲଗ୍ନ',
    retro: 'ବ',
    grahaShort: grahas(['ସୂ', 'ଚ', 'ମ', 'ବୁ', 'ଗୁ', 'ଶୁ', 'ଶ', 'ରା', 'କେ']),
    grahaName: grahas(['ସୂର୍ଯ୍ୟ', 'ଚନ୍ଦ୍ର', 'ମଙ୍ଗଳ', 'ବୁଧ', 'ଗୁରୁ', 'ଶୁକ୍ର', 'ଶନି', 'ରାହୁ', 'କେତୁ']),
    signs: ['ମେଷ', 'ବୃଷ', 'ମିଥୁନ', 'କର୍କଟ', 'ସିଂହ', 'କନ୍ୟା', 'ତୁଳା', 'ବୃଶ୍ଚିକ', 'ଧନୁ', 'ମକର', 'କୁମ୍ଭ', 'ମୀନ'],
    vargas: vargas([
      'ରାଶି', 'ହୋରା', 'ଦ୍ରେଷ୍କାଣ', 'ଚତୁର୍ଥାଂଶ', 'ସପ୍ତାଂଶ', 'ନବାଂଶ', 'ଦଶାଂଶ', 'ଦ୍ୱାଦଶାଂଶ',
      'ଷୋଡଶାଂଶ', 'ବିଂଶାଂଶ', 'ଚତୁର୍ବିଂଶାଂଶ', 'ସପ୍ତବିଂଶାଂଶ', 'ତ୍ରିଂଶାଂଶ', 'ଖବେଦାଂଶ', 'ଅକ୍ଷବେଦାଂଶ', 'ଷଷ୍ଟ୍ୟଂଶ',
    ]),
  },
  {
    id: 'ta',
    endonym: 'தமிழ்',
    english: 'Tamil',
    numbering: 'tamldec',
    kundali: 'ஜாதகம்',
    lagna: 'லக்னம்',
    retro: 'வ',
    grahaShort: grahas(['சூரி', 'சந்', 'செவ்', 'புத', 'குரு', 'சுக்', 'சனி', 'ராகு', 'கேது']),
    grahaName: grahas(['சூரியன்', 'சந்திரன்', 'செவ்வாய்', 'புதன்', 'குரு', 'சுக்கிரன்', 'சனி', 'ராகு', 'கேது']),
    signs: ['மேஷம்', 'ரிஷபம்', 'மிதுனம்', 'கடகம்', 'சிம்மம்', 'கன்னி', 'துலாம்', 'விருச்சிகம்', 'தனுசு', 'மகரம்', 'கும்பம்', 'மீனம்'],
    vargas: vargas([
      'ராசி', 'ஹோரை', 'திரேக்காணம்', 'சதுர்த்தாம்சம்', 'சப்தாம்சம்', 'நவாம்சம்', 'தசாம்சம்', 'துவாதசாம்சம்',
      'சோடசாம்சம்', 'விம்சாம்சம்', 'சதுர்விம்சாம்சம்', 'சப்தவிம்சாம்சம்', 'திரிம்சாம்சம்', 'கவேதாம்சம்', 'அக்ஷவேதாம்சம்', 'சஷ்டியாம்சம்',
    ]),
  },
  {
    id: 'te',
    endonym: 'తెలుగు',
    english: 'Telugu',
    numbering: 'telu',
    kundali: 'జాతక చక్రం',
    lagna: 'లగ్నం',
    retro: 'వ',
    grahaShort: grahas(['సూ', 'చం', 'కు', 'బు', 'గు', 'శు', 'శ', 'రా', 'కే']),
    grahaName: grahas(['సూర్యుడు', 'చంద్రుడు', 'కుజుడు', 'బుధుడు', 'గురుడు', 'శుక్రుడు', 'శని', 'రాహువు', 'కేతువు']),
    signs: ['మేషం', 'వృషభం', 'మిథునం', 'కర్కాటకం', 'సింహం', 'కన్య', 'తుల', 'వృశ్చికం', 'ధనుస్సు', 'మకరం', 'కుంభం', 'మీనం'],
    vargas: vargas([
      'రాశి', 'హోర', 'ద్రేక్కాణం', 'చతుర్థాంశ', 'సప్తాంశ', 'నవాంశ', 'దశాంశ', 'ద్వాదశాంశ',
      'షోడశాంశ', 'వింశాంశ', 'చతుర్వింశాంశ', 'సప్తవింశాంశ', 'త్రింశాంశ', 'ఖవేదాంశ', 'అక్షవేదాంశ', 'షష్ట్యంశ',
    ]),
  },
  {
    id: 'kn',
    endonym: 'ಕನ್ನಡ',
    english: 'Kannada',
    numbering: 'knda',
    kundali: 'ಜಾತಕ ಚಕ್ರ',
    lagna: 'ಲಗ್ನ',
    retro: 'ವ',
    grahaShort: grahas(['ಸೂ', 'ಚಂ', 'ಕು', 'ಬು', 'ಗು', 'ಶು', 'ಶ', 'ರಾ', 'ಕೇ']),
    grahaName: grahas(['ಸೂರ್ಯ', 'ಚಂದ್ರ', 'ಕುಜ', 'ಬುಧ', 'ಗುರು', 'ಶುಕ್ರ', 'ಶನಿ', 'ರಾಹು', 'ಕೇತು']),
    signs: ['ಮೇಷ', 'ವೃಷಭ', 'ಮಿಥುನ', 'ಕರ್ಕಾಟಕ', 'ಸಿಂಹ', 'ಕನ್ಯಾ', 'ತುಲಾ', 'ವೃಶ್ಚಿಕ', 'ಧನು', 'ಮಕರ', 'ಕುಂಭ', 'ಮೀನ'],
    vargas: vargas([
      'ರಾಶಿ', 'ಹೋರಾ', 'ದ್ರೇಕ್ಕಾಣ', 'ಚತುರ್ಥಾಂಶ', 'ಸಪ್ತಾಂಶ', 'ನವಾಂಶ', 'ದಶಾಂಶ', 'ದ್ವಾದಶಾಂಶ',
      'ಷೋಡಶಾಂಶ', 'ವಿಂಶಾಂಶ', 'ಚತುರ್ವಿಂಶಾಂಶ', 'ಸಪ್ತವಿಂಶಾಂಶ', 'ತ್ರಿಂಶಾಂಶ', 'ಖವೇದಾಂಶ', 'ಅಕ್ಷವೇದಾಂಶ', 'ಷಷ್ಟ್ಯಂಶ',
    ]),
  },
  {
    id: 'ml',
    endonym: 'മലയാളം',
    english: 'Malayalam',
    numbering: 'mlym',
    kundali: 'ജാതകം',
    lagna: 'ലഗ്നം',
    retro: 'വ',
    grahaShort: grahas(['സൂ', 'ച', 'ചൊ', 'ബു', 'വ്യാ', 'ശു', 'ശ', 'രാ', 'കേ']),
    grahaName: grahas(['സൂര്യൻ', 'ചന്ദ്രൻ', 'ചൊവ്വ', 'ബുധൻ', 'വ്യാഴം', 'ശുക്രൻ', 'ശനി', 'രാഹു', 'കേതു']),
    signs: ['മേടം', 'ഇടവം', 'മിഥുനം', 'കർക്കടകം', 'ചിങ്ങം', 'കന്നി', 'തുലാം', 'വൃശ്ചികം', 'ധനു', 'മകരം', 'കുംഭം', 'മീനം'],
    vargas: vargas([
      'രാശി', 'ഹോര', 'ദ്രേക്കാണം', 'ചതുർഥാംശം', 'സപ്താംശം', 'നവാംശം', 'ദശാംശം', 'ദ്വാദശാംശം',
      'ഷോഡശാംശം', 'വിംശാംശം', 'ചതുർവിംശാംശം', 'സപ്തവിംശാംശം', 'ത്രിംശാംശം', 'ഖവേദാംശം', 'അക്ഷവേദാംശം', 'ഷഷ്ട്യംശം',
    ]),
  },
];

export const ENGLISH = CHART_LANGUAGES[0]!;
export const SANSKRIT = CHART_LANGUAGES[1]!;

export function chartLanguage(id: string | null): ChartLanguage | undefined {
  return CHART_LANGUAGES.find((language) => language.id === id);
}

export function grahaShortIn(language: ChartLanguage, body: string): string {
  return language.grahaShort[body as keyof Grahas<string>] ?? body.slice(0, 2);
}

export function grahaNameIn(language: ChartLanguage, body: string): string {
  return language.grahaName[body as keyof Grahas<string>] ?? body;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** A house number in the language's own digits, falling back to Latin where Intl lacks the system. */
export function localDigits(language: ChartLanguage, value: number): string {
  let formatter = formatters.get(language.numbering);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(`en-u-nu-${language.numbering}`);
    } catch {
      formatter = new Intl.NumberFormat('en');
    }
    formatters.set(language.numbering, formatter);
  }
  return formatter.format(value);
}
