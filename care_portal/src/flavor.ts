/* One codebase, two products: the Care portal, and the session pages of the Remedium Aesthetic console
   (build with `npm run build:aesthetic`). Physiotherapy plans become aesthetic treatment plans there. */
export const AES = import.meta.env.VITE_FLAVOR === 'aesthetic';
export const API_BASE = import.meta.env.VITE_API_BASE || '/care-api';

export const F = {
  brand: AES ? 'Remedium Aesthetic' : 'Remedium Care',
  service: AES ? 'Aesthetic Treatment' : 'Physiotherapy',
  item: AES ? 'Treatment' : 'Therapy',
  items: AES ? 'Treatments' : 'Therapies',
  therapist: AES ? 'Therapist' : 'Physiotherapist',
  plan: AES ? 'treatment plan' : 'therapy plan',
  Plan: AES ? 'Treatment plan' : 'Therapy plan',
  master: AES ? 'Service Management' : 'Physiotherapy → Therapy Master',
  packages: AES ? 'Treatment Plans → Packages' : 'Physiotherapy → Packages',
};

/* Practitioner roles are stored with the Care names; the Aesthetic console shows its own. */
export const roleLabel = (role: string) => {
  if (!AES) return role;
  if (role === 'Physiotherapist') return 'Therapist';
  if (role === 'Cosmetologist') return 'Cosmetologist';
  return role;
};

export const AES_SPECIALITIES = [
  'Dermatology',
  'Cosmetic Dermatology',
  'Aesthetic Medicine',
  'Cosmetology',
  'Trichology',
  'Laser & Energy Devices',
  'Injectables',
  'Skin Rejuvenation',
  'Hair Restoration',
  'Plastic Surgery',
];
