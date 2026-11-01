/** Word-order-free lab test search: "fasting blood glucose" finds "Glucose Fasting (Fbs)". */

const ALIASES: Record<string, string[]> = {
  fbg: ['fbs', 'fasting'],
  fbs: ['fbg', 'fasting'],
  ppbs: ['post prandial', 'ppbg'],
  ppbg: ['ppbs', 'post prandial'],
  rbs: ['random', 'rbg'],
  rbg: ['random', 'rbs'],
  sugar: ['glucose'],
  glucose: ['sugar'],
  cbc: ['complete blood count', 'hemogram'],
  hemogram: ['cbc', 'complete blood count'],
  lft: ['liver function'],
  kft: ['kidney function', 'rft', 'renal'],
  rft: ['renal', 'kft', 'kidney function'],
  tft: ['thyroid'],
  hba1c: ['glycated', 'glycosylated', 'a1c'],
};

/** Words that describe most tests; ignored when they are the only reason a test fails to match. */
const GENERIC = new Set(['blood', 'test', 'tests', 'serum', 'level', 'levels', 'profile', 'plasma', 'the', 'of', 'and']);

function tokens(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function hayHas(hay: string, token: string) {
  if (hay.includes(token)) return true;
  return (ALIASES[token] || []).some((alt) => hay.includes(alt));
}

/** True when every meaningful search word (or one of its aliases) appears in any of the fields. */
export function matchesLabTestQuery(query: string, fields: Array<string | null | undefined>) {
  const words = tokens(query);
  if (!words.length) return true;
  const hay = ` ${fields
    .filter(Boolean)
    .map((f) => String(f).toLowerCase().replace(/[^a-z0-9]+/g, ' '))
    .join(' ')} `;
  const compactHay = hay.replace(/\s+/g, '');
  const phrase = words.join('');
  if (compactHay.includes(phrase)) return true;
  const missing = words.filter((w) => !hayHas(hay, w));
  if (!missing.length) return true;
  return missing.every((w) => GENERIC.has(w)) && missing.length < words.length;
}
