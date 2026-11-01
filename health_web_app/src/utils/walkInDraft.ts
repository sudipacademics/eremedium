/** Partners walk-in Step 1 → Step 2 draft (sessionStorage). */

export type WalkInDraftItem = {
  item_code: string;
  item_name: string;
  retail_rate: number;
  wholesale_rate: number;
  margin?: number;
};

export type WalkInDraft = {
  patientName: string;
  patientPhone: string;
  age: string;
  ageMonths?: string;
  ageDays?: string;
  gender: string;
  address: string;
  whatsapp: string;
  refBy: string;
  referringDoctorId: string | null;
  referringDoctorName: string;
  refCommissionPercent: string;
  selectedItems: WalkInDraftItem[];
  discountInput: string;
  collectionMode: string;
  amountReceived: string;
  paymentDate: string;
  notes: string;
};

const STORAGE_KEY = 'b2b-walk-in-draft';

export function saveWalkInDraft(draft: WalkInDraft) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* ignore quota */
  }
}

export function loadWalkInDraft(): WalkInDraft | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WalkInDraft;
  } catch {
    return null;
  }
}

export function clearWalkInDraft() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

const QUEUE_KEY = 'b2b-catalog-add-codes';

function readQueue(): string[] {
  try {
    const raw = sessionStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function peekWalkInItemQueue(): string[] {
  return readQueue();
}

export function queueWalkInItemCodes(codes: string[]) {
  const next = Array.from(new Set([...readQueue(), ...codes.filter(Boolean)]));
  try {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

export function consumeWalkInItemQueue(): string[] {
  const codes = readQueue();
  try {
    sessionStorage.removeItem(QUEUE_KEY);
  } catch {
    /* ignore */
  }
  return codes;
}
