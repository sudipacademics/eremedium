import type { ReactElement } from 'react';

export type IconName =
  | 'dashboard'
  | 'units'
  | 'lab'
  | 'care'
  | 'aesthetic'
  | 'pharmacy'
  | 'bookings'
  | 'services'
  | 'logistics'
  | 'inventory'
  | 'vendors'
  | 'quality'
  | 'approvals'
  | 'assets'
  | 'reports'
  | 'settings'
  | 'search'
  | 'bell'
  | 'calendar'
  | 'chevron'
  | 'headset'
  | 'coins'
  | 'building'
  | 'vial'
  | 'truck'
  | 'shield'
  | 'chart'
  | 'clipboard'
  | 'box'
  | 'list'
  | 'alert'
  | 'check'
  | 'close'
  | 'menu'
  | 'plus'
  | 'task'
  | 'flag'
  | 'download'
  | 'wrench'
  | 'info'
  | 'ban';

const paths: Record<IconName, ReactElement> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  units: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <path d="M15 15h6M18 12v6" />
    </>
  ),
  lab: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v5.5L6 19.2A2.2 2.2 0 0 0 7.9 22h8.2A2.2 2.2 0 0 0 18 19.2L14 8.5V3" />
      <path d="M8.2 14.5h7.6" />
    </>
  ),
  care: (
    <>
      <rect x="3.5" y="8" width="17" height="12" rx="2" />
      <path d="M8 8V6.2A2.2 2.2 0 0 1 10.2 4h3.6A2.2 2.2 0 0 1 16 6.2V8" />
      <path d="M12 12v4M10 14h4" />
    </>
  ),
  aesthetic: (
    <>
      <path d="M12 3.2 13.3 7.6 17.8 8.8 13.3 10.1 12 14.5 10.7 10.1 6.2 8.8 10.7 7.6 12 3.2z" />
      <path d="M18 14.2 18.7 16.4 19.8 17.1 18.7 17.8 18 20 17.3 17.8 16.2 17.1 17.3 16.4 18 14.2z" />
    </>
  ),
  pharmacy: (
    <>
      <path d="M8.2 14.8 14.6 8.4a3.2 3.2 0 0 1 4.5 4.5l-6.4 6.4a3.2 3.2 0 0 1-4.5-4.5z" />
      <path d="M10 12.2 13.8 16" />
    </>
  ),
  bookings: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3.5v3M16 3.5v3M4 10h16" />
      <path d="M8 14h3M8 17h6" />
    </>
  ),
  services: (
    <>
      <path d="M4 13c2.2-4 5-6 8-6s5.8 2 8 6" />
      <path d="M4 13c2.2 4 5 6 8 6s5.8-2 8-6" />
      <circle cx="12" cy="13" r="2.2" />
    </>
  ),
  logistics: (
    <>
      <path d="M3 7h11v8H3z" />
      <path d="M14 10h4l3 3v2h-7" />
      <circle cx="7" cy="17.5" r="1.6" />
      <circle cx="17" cy="17.5" r="1.6" />
    </>
  ),
  inventory: (
    <>
      <path d="M3 8 12 4l9 4-9 4-9-4z" />
      <path d="M3 8v8l9 4 9-4V8" />
      <path d="M12 12v8" />
    </>
  ),
  vendors: (
    <>
      <path d="M4 10 6 5h12l2 5" />
      <path d="M4 10h16v9H4z" />
      <path d="M10 19v-5h4v5" />
    </>
  ),
  quality: (
    <>
      <path d="M12 3 5 6v6c0 4.2 2.8 7.2 7 8.5 4.2-1.3 7-4.3 7-8.5V6l-7-3z" />
      <path d="M8.8 12.1 11 14.3 15.4 9.8" />
    </>
  ),
  approvals: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" />
    </>
  ),
  assets: (
    <>
      <rect x="3.5" y="10" width="7" height="9" rx="1.2" />
      <rect x="13.5" y="6" width="7" height="13" rx="1.2" />
      <path d="M6 13.5h2M16 9.5h2M16 13h2" />
    </>
  ),
  reports: (
    <>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3V20.5M3.5 12h2.2M18.3 12H20.5M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6 5.8 18.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="M16 16.5 20 20.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5h12l-1.2-2V10a4.8 4.8 0 0 0-9.6 0v4.5L6 16.5z" />
      <path d="M10 16.5a2 2 0 0 0 4 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3.5v3M16 3.5v3M4 10h16" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  headset: (
    <>
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="3.5" y="13" width="4" height="6" rx="1.2" />
      <rect x="16.5" y="13" width="4" height="6" rx="1.2" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="12" cy="7" rx="7" ry="3" />
      <path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" />
      <path d="M5 12v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
      <path d="M8 7.5h2M14 7.5h2M8 11.5h2M14 11.5h2M9 20.5v-3h6v3" />
    </>
  ),
  vial: (
    <>
      <path d="M9 3h6" />
      <rect x="8" y="6" width="8" height="14" rx="3" />
      <path d="M8 12h8" />
    </>
  ),
  truck: (
    <>
      <path d="M3 7h11v8H3zM14 10h4l3 3v2h-7" />
      <circle cx="7" cy="17.5" r="1.5" />
      <circle cx="17" cy="17.5" r="1.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v6c0 4.2 2.8 7.2 7 8.5 4.2-1.3 7-4.3 7-8.5V6l-7-3z" />
    </>
  ),
  chart: (
    <>
      <path d="M4 16.5 9 11l3.2 3.2L20 6.5" />
      <path d="M14.5 6.5H20V12" />
    </>
  ),
  clipboard: (
    <>
      <rect x="6" y="4.5" width="12" height="16" rx="2" />
      <path d="M9 4.5h6v2.2H9z" />
      <path d="M9 11h6M9 14.5h4" />
    </>
  ),
  box: (
    <>
      <path d="M3 8 12 4l9 4-9 4-9-4z" />
      <path d="M3 8v8l9 4 9-4V8" />
    </>
  ),
  list: (
    <>
      <path d="M9 7h11M9 12h11M9 17h11" />
      <path d="M4 7h.1M4 12h.1M4 17h.1" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 3.5 19h17L12 4z" />
      <path d="M12 10v4M12 16.5h.01" />
    </>
  ),
  check: <path d="M5 12.5 10 17.5 19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  task: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 12.2 10.8 15 16 9.5" />
    </>
  ),
  flag: (
    <>
      <path d="M6 4v16" />
      <path d="M6 5h11l-2 3.5L17 12H6" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M8 11.5 12 15.5 16 11.5" />
      <path d="M5 19h14" />
    </>
  ),
  wrench: (
    <>
      <path d="M14.5 6.2a3.2 3.2 0 0 0-4.2 4.1L4.8 15.8a1.8 1.8 0 0 0 2.5 2.5l5.5-5.5a3.2 3.2 0 0 0 4.1-4.2L14.6 10.9 13.2 9.5l1.3-3.3z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M7 17 17 7" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function LogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.2 8.2c2.2-2.4 7.2-2.2 9 .4 1.2 1.7.7 3.4-.8 4.4-1.7 1.1-4 .9-5.6 1.6-1.2.5-1.7 1.2-1.3 2.1.5 1.1 2.2 1.6 4 .9 1.4-.5 2.6-1.3 3.5-2.2"
        fill="none"
        stroke="white"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}
