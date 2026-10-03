import type { ProviderCategory } from './admin-types';
import { resizeBannerImage } from './photo';

export const MAX_DOCUMENTS = 5;
export const DOCUMENT_MAX_BYTES = 2_621_440;
const ACCEPTED_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export const DOCUMENT_LABELS = ['ID proof', 'Qualification certificate', 'Address proof', 'Experience letter', 'Other'] as const;

export const LANGUAGE_SUGGESTIONS = [
  'Hindi', 'English', 'Sanskrit', 'Bengali', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Odia', 'Punjabi',
] as const;

export const EXPERTISE_SUGGESTIONS: Record<ProviderCategory, readonly string[]> = {
  ASTROLOGER: ['Vedic Astrology', 'KP System', 'Prashna', 'Lal Kitab', 'Nadi', 'Tarot', 'Palmistry', 'Muhurta'],
  NUMEROLOGIST: ['Chaldean', 'Pythagorean', 'Name Correction', 'Mobile Numerology', 'Business Names', 'Lo Shu Grid'],
  VASTU_EXPERT: ['Residential Vastu', 'Commercial Vastu', 'Industrial Vastu', 'Plot Selection', 'Remedial Vastu'],
  AYURVEDA_EXPERT: ['Panchakarma', 'Prakriti Analysis', 'Nadi Pariksha', 'Diet & Lifestyle', 'Herbal Medicine', 'Yoga Therapy'],
  PANDIT: ['Griha Pravesh', 'Satyanarayan Katha', 'Rudrabhishek', 'Vivah Sanskar', 'Navgraha Shanti', 'Shraddha'],
  SPIRITUAL_GUIDE: ['Meditation', 'Mantra Sadhana', 'Bhakti', 'Life Coaching', 'Pranayama', 'Gita Study'],
  OTHER: [],
};

export const SERVICE_SUGGESTIONS: Record<ProviderCategory, readonly string[]> = {
  ASTROLOGER: ['Call consultation', 'Chat consultation', 'Kundali reading', 'Match making', 'Career guidance', 'Remedies'],
  NUMEROLOGIST: ['Call consultation', 'Numerology report', 'Name correction', 'Business name analysis'],
  VASTU_EXPERT: ['Site visit', 'Online Vastu consultation', 'Floor plan review', 'Vastu remedies'],
  AYURVEDA_EXPERT: ['Online consultation', 'Diet plan', 'Prakriti assessment', 'Wellness programme'],
  PANDIT: ['Home puja', 'Online puja', 'Temple puja', 'Wedding ceremonies', 'Havan'],
  SPIRITUAL_GUIDE: ['One-to-one sessions', 'Group sessions', 'Online courses', 'Retreats'],
  OTHER: ['Call consultation', 'Online sessions'],
};

export interface PreparedDocument {
  name: string;
  label: string;
  dataUrl: string;
  size: number;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

/** Large photos of documents are scaled down rather than rejected; PDFs must already fit. */
export async function prepareDocument(file: File, label: string): Promise<PreparedDocument> {
  if (!ACCEPTED_DOCUMENT_TYPES.includes(file.type)) {
    throw new Error(`${file.name}: use a PDF, JPG, PNG or WebP file`);
  }
  if (file.type !== 'application/pdf' && file.size > DOCUMENT_MAX_BYTES) {
    const dataUrl = await resizeBannerImage(file, 2200, 0.85);
    const size = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
    if (size > DOCUMENT_MAX_BYTES) throw new Error(`${file.name} is too large even after compression`);
    return { name: file.name.replace(/\.[^.]+$/, dataUrl.startsWith('data:image/webp') ? '.webp' : '.jpg'), label, dataUrl, size };
  }
  if (file.size > DOCUMENT_MAX_BYTES) {
    throw new Error(`${file.name} is larger than 2.5 MB`);
  }
  return { name: file.name, label, dataUrl: await readAsDataUrl(file), size: file.size };
}
