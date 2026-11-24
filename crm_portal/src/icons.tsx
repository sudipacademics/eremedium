import type { ReactElement } from 'react';

export type IconName =
  | 'dashboard'
  | 'leads'
  | 'contacts'
  | 'accounts'
  | 'deals'
  | 'activities'
  | 'campaigns'
  | 'reports'
  | 'settings'
  | 'bookings'
  | 'franchise'
  | 'partner'
  | 'search'
  | 'bell'
  | 'calendar'
  | 'help'
  | 'plus'
  | 'menu'
  | 'close'
  | 'check'
  | 'phone'
  | 'chevron'
  | 'lab'
  | 'aesthetic'
  | 'care'
  | 'nexilab'
  | 'chart'
  | 'users'
  | 'filter'
  | 'edit'
  | 'whatsapp'
  | 'sparkle'
  | 'badge'
  | 'file'
  | 'handshake'
  | 'trophy'
  | 'alarm'
  | 'funnel'
  | 'layers'
  | 'refresh'
  | 'xcircle'
  | 'download'
  | 'bolt'
  | 'send'
  | 'timer'
  | 'smile'
  | 'paperclip';

const paths: Record<IconName, ReactElement> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  leads: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3.5" />
      <path d="M19 8v6M22 11h-6" />
    </>
  ),
  contacts: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3.5" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  accounts: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  deals: (
    <>
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  activities: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </>
  ),
  campaigns: (
    <>
      <path d="M3 11l18-5v12L3 13v-2z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.2-3" />
    </>
  ),
  reports: (
    <>
      <path d="M4 19V5M4 19h16" />
      <path d="M8 15v-4M12 15V8M16 15v-6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  bookings: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </>
  ),
  franchise: (
    <>
      <path d="M3 21h18M5 21V8l7-5 7 5v13" />
      <path d="M9 21v-6h6v6M10 11h4" />
    </>
  ),
  partner: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M3 20c0-3.2 2.7-5.2 6-5.2s6 2 6 5.2M14.5 20c.4-2.2 2.2-3.6 4.5-3.6 1.2 0 2.3.4 3.1 1" />
    </>
  ),
  search: <circle cx="11" cy="11" r="6.5" />,
  bell: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 7H3s3 0 3-7" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 1 1 4.4 2.6c-.8.5-1.5 1.1-1.5 2.1V14" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 13l4 4L19 7" />,
  phone: (
    <>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.5-1.1a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 1.9z" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  lab: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" />
    </>
  ),
  aesthetic: (
    <>
      <path d="M12 3c2.5 3.5 6 6.2 6 10a6 6 0 1 1-12 0c0-3.8 3.5-6.5 6-10z" />
    </>
  ),
  care: (
    <>
      <path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 5.6-7 10-7 10z" />
    </>
  ),
  nexilab: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  chart: (
    <>
      <path d="M4 19V5M4 19h16" />
      <path d="M8 15l4-5 3 3 5-7" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3.5" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  filter: <path d="M4 5h16l-6 8v5l-4 2v-7L4 5z" />,
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M20.5 11.5a8.5 8.5 0 0 1-12.7 7.4L4 20l1.2-3.6A8.5 8.5 0 1 1 20.5 11.5z" />
      <path d="M9.2 9.8c.3-.6.5-.6.8-.6h.6c.2 0 .4 0 .5.4l.7 1.7c.1.3 0 .5-.2.7l-.4.4a5.8 5.8 0 0 0 2.5 2.5l.4-.4c.2-.2.4-.3.7-.2l1.7.7c.3.1.4.3.4.5v.6c0 .3 0 .5-.6.8a6.5 6.5 0 0 1-3-.6 8 8 0 0 1-3.4-3.4 6.5 6.5 0 0 1-.6-3z" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.2 4.2L17.5 8.5 13.2 9.8 12 14l-1.2-4.2L6.5 8.5l4.3-1.3L12 3z" />
      <path d="M18.5 14l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3z" />
      <path d="M5 15l.5 1.6L7 17l-1.5.4L5 19l-.5-1.6L3 17l1.5-.4L5 15z" />
    </>
  ),
  badge: (
    <>
      <circle cx="12" cy="10" r="6" />
      <path d="M9 14.5 8 21l4-2 4 2-1-6.5" />
      <path d="M9.5 10l1.8 1.8L15 8.5" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5-6z" />
      <path d="M14 3v6h6M9 13h6M9 17h4" />
    </>
  ),
  handshake: (
    <>
      <path d="M4 14l3.5-3.5a2 2 0 0 1 2.8 0L12 12" />
      <path d="M20 14l-3.5-3.5a2 2 0 0 0-2.8 0L12 12" />
      <path d="M8 16.5 10 18a2 2 0 0 0 2.8 0l.7-.7" />
      <path d="M16 16.5 14 18a2 2 0 0 1-1.4.6" />
      <path d="M3 11.5 5.5 9a2 2 0 0 1 2.5-.2L9.5 10" />
      <path d="M21 11.5 18.5 9a2 2 0 0 0-2.5-.2L14.5 10" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H5a2 2 0 0 0 0 4h2M17 6h2a2 2 0 0 1 0 4h-2" />
    </>
  ),
  alarm: (
    <>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 10v3.5l2 1.5M5.5 5.5 3 8M18.5 5.5 21 8" />
    </>
  ),
  funnel: (
    <>
      <path d="M4 5h16l-6 7.5V19l-4 2v-8.5L4 5z" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5z" />
      <path d="M3 12l9 5 9-5" />
      <path d="M3 16l9 5 9-5" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.3" />
      <path d="M21 3v6h-6" />
    </>
  ),
  xcircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  send: (
    <>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 1.5M10 2h4" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 10h.01M15.5 10h.01M8.2 14.2a4.2 4.2 0 0 0 7.6 0" />
    </>
  ),
  paperclip: (
    <>
      <path d="M21.4 11.6 12.1 20.9a5.2 5.2 0 0 1-7.4-7.4l9.9-9.9a3.4 3.4 0 0 1 4.8 4.8l-9.9 9.9a1.6 1.6 0 1 1-2.3-2.3l8.5-8.5" />
    </>
  ),
};

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
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
      {name === 'search' ? <path d="M20 20l-3.2-3.2" /> : null}
    </svg>
  );
}

