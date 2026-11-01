const base = (size: number) =>
  ({
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  });

export type AdminIconName =
  | 'dashboard'
  | 'calendar'
  | 'sparkle'
  | 'box'
  | 'machine'
  | 'invoice'
  | 'building'
  | 'users'
  | 'settings'
  | 'search'
  | 'bell'
  | 'chevron'
  | 'pin'
  | 'rupee'
  | 'check'
  | 'star'
  | 'more'
  | 'eye'
  | 'menu'
  | 'logout'
  | 'trendUp';

export function AdminIcon({
  name,
  size = 18,
  className,
}: {
  name: AdminIconName;
  size?: number;
  className?: string;
}) {
  const p = { ...base(size), className };
  switch (name) {
    case 'dashboard':
      return (
        <svg {...p}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" />
          <rect x="13.5" y="10.5" width="7" height="10" rx="1.5" />
          <rect x="3.5" y="13" width="7" height="7.5" rx="1.5" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...p}>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M8 3.5v3M16 3.5v3M3.5 10h17" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg {...p}>
          <path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.5 10.2 12.6 4.5 10.8 10.2 9z" />
          <path d="M18 4.5v3M19.5 6h-3" />
        </svg>
      );
    case 'box':
      return (
        <svg {...p}>
          <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7z" />
          <path d="M4 8.5 12 13l8-4.5M12 13v7" />
        </svg>
      );
    case 'machine':
      return (
        <svg {...p}>
          <rect x="4" y="5" width="16" height="12" rx="2" />
          <path d="M8 21h8M12 17v4M8 9h.01M12 9h.01M16 9h.01" />
        </svg>
      );
    case 'invoice':
      return (
        <svg {...p}>
          <path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14l-3-1.5-2.5 1.5-2.5-1.5-3 1.5V5A1.5 1.5 0 0 1 7 3.5z" />
          <path d="M9 8h6M9 11.5h6M9 15h3.5" />
        </svg>
      );
    case 'building':
      return (
        <svg {...p}>
          <path d="M4 20h16M6 20V8l6-4 6 4v12" />
          <path d="M10 20v-5h4v5M9 11h.01M15 11h.01M9 14h.01M15 14h.01" />
        </svg>
      );
    case 'users':
      return (
        <svg {...p}>
          <circle cx="9" cy="8" r="2.8" />
          <circle cx="16.5" cy="9" r="2.2" />
          <path d="M3.5 18c1.4-3 3.6-4.5 5.5-4.5S13 15 14.5 18" />
          <path d="M14 14.2c1.1-.4 2.4-.4 3.6 0 1.1.4 2 1.2 2.9 2.4" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3.5v2.2M12 18.3V20.5M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6" />
        </svg>
      );
    case 'search':
      return (
        <svg {...p}>
          <circle cx="11" cy="11" r="6" />
          <path d="m16 16 4 4" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...p}>
          <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5l1.5-2z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
      );
    case 'chevron':
      return (
        <svg {...p}>
          <path d="m8 10 4 4 4-4" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...p}>
          <path d="M12 21s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10z" />
          <circle cx="12" cy="11" r="2" />
        </svg>
      );
    case 'rupee':
      return (
        <svg {...p}>
          <path d="M7 6h10M7 10h10M11 6c3 0 5 2 5 4.5S14 15 11 15H7l7 5" />
        </svg>
      );
    case 'check':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m8.5 12.2 2.3 2.3 4.7-5" />
        </svg>
      );
    case 'star':
      return (
        <svg {...p} fill="currentColor" stroke="none">
          <path d="m12 3.2 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.6 7.2 18.1l.9-5.4L4.2 8.9l5.4-.8L12 3.2z" />
        </svg>
      );
    case 'more':
      return (
        <svg {...p}>
          <circle cx="12" cy="5" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'eye':
      return (
        <svg {...p}>
          <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...p}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case 'logout':
      return (
        <svg {...p}>
          <path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h7A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 10 18.5V17" />
          <path d="M14 12H4m0 0 2.5-2.5M4 12l2.5 2.5" />
        </svg>
      );
    case 'trendUp':
      return (
        <svg {...p}>
          <path d="M4 16 10 10l3.5 3.5L20 7" />
          <path d="M14 7h6v6" />
        </svg>
      );
    default:
      return null;
  }
}
