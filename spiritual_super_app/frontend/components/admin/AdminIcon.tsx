import type { AdminIcon as NavIcon } from '@/lib/admin-nav';

export type AdminIconName =
  | NavIcon
  | 'users'
  | 'consultation'
  | 'cart'
  | 'rupee'
  | 'menu'
  | 'search'
  | 'bell'
  | 'calendar'
  | 'chevronDown'
  | 'chevronRight'
  | 'arrowRight'
  | 'logout'
  | 'external'
  | 'userPlus'
  | 'box'
  | 'chart'
  | 'phone'
  | 'pin'
  | 'check';

/** 24×24 stroke paths (Lucide-style) so icons inherit text colour. */
const PATHS: Record<AdminIconName, string[]> = {
  dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  providers: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 7a4 4 0 1 0 0 .01', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  joinRequests: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M12 18v-6', 'M9 15h6'],
  live: ['M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z'],
  bookings: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 16l2 2 4-4'],
  orders: ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z', 'M3 6h18', 'M16 10a4 4 0 0 1-8 0'],
  history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l4 2'],
  products: ['M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z', 'M2 21c0-3 1.9-5.4 5.2-6.1C9.5 14.4 12 13 13 12'],
  temple: ['M12 2l3 4H9z', 'M5 10h14', 'M7 6h10l2 4H5z', 'M6 10v10', 'M18 10v10', 'M10 20v-5h4v5', 'M3 20h18'],
  blog: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z'],
  numerology: ['M4 9h16', 'M4 15h16', 'M10 3 8 21', 'M16 3l-2 18'],
  home: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  banner: ['M3 5h18v14H3z', 'M8.5 10a1.5 1.5 0 1 0 0 .01', 'M21 15l-5-5L5 19'],
  video: ['M22.5 6.4a2.8 2.8 0 0 0-1.9-2C18.9 4 12 4 12 4s-6.9 0-8.6.5a2.8 2.8 0 0 0-2 1.9A29 29 0 0 0 1 12a29 29 0 0 0 .5 5.6 2.8 2.8 0 0 0 1.9 2C5.1 20 12 20 12 20s6.9 0 8.6-.5a2.8 2.8 0 0 0 2-1.9A29 29 0 0 0 23 12a29 29 0 0 0-.5-5.6z', 'M9.8 15.5 15.5 12 9.8 8.5z'],
  links: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
  roles: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
  audit: ['M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2', 'M9 3h6v4H9z', 'M9 12h6', 'M9 16h4'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 7a4 4 0 1 0 0 .01', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  consultation: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', 'M8 9h8', 'M8 13h5'],
  cart: ['M9 21a1 1 0 1 0 0 .01', 'M20 21a1 1 0 1 0 0 .01', 'M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6'],
  rupee: ['M6 3h12', 'M6 8h12', 'M6 13l8.5 8', 'M6 13h3a5 5 0 0 0 0-10'],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  bell: ['M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
  calendar: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronRight: ['M9 18l6-6-6-6'],
  arrowRight: ['M5 12h14', 'M12 5l7 7-7 7'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  external: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14 21 3'],
  userPlus: ['M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M8.5 7a4 4 0 1 0 0 .01', 'M20 8v6', 'M23 11h-6'],
  box: ['M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z', 'M3.3 7 12 12l8.7-5', 'M12 22V12'],
  chart: ['M3 3v18h18', 'M7 15l4-4 3 3 5-6'],
  phone: ['M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5', 'M12 18h.01'],
  pin: ['M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z', 'M12 10a3 3 0 1 0 0 .01'],
  check: ['M20 6 9 17l-5-5'],
};

export function AdminIcon({ name, className = 'h-5 w-5' }: { name: AdminIconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The Vedsutra lotus mark used in the admin sidebar and welcome banner. */
export function LotusMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 48" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden>
      <path d="M32 6c6 7 8 15 0 30C24 21 26 13 32 6z" />
      <path d="M32 36C27 25 20 18 10 16c0 11 8 20 22 20z" />
      <path d="M32 36c5-11 12-18 22-20 0 11-8 20-22 20z" />
      <path d="M32 36C24 31 13 30 4 33c6 7 17 8 28 3z" />
      <path d="M32 36c8-5 19-6 28-3-6 7-17 8-28 3z" />
      <path d="M14 42h36" />
    </svg>
  );
}
