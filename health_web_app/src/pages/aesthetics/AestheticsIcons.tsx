type IconProps = { size?: number; className?: string };

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

export function AeIcon({
  name,
  size = 22,
  className,
}: {
  name:
    | 'user'
    | 'pin'
    | 'chevron'
    | 'check'
    | 'arrow'
    | 'cart'
    | 'play'
    | 'star'
    | 'team'
    | 'tech'
    | 'plan'
    | 'safe'
    | 'clients'
    | 'treatments'
    | 'branches'
    | 'years'
    | 'facebook'
    | 'instagram'
    | 'youtube'
    | 'whatsapp'
    | 'phone'
    | 'mail'
    | 'hydra'
    | 'tight'
    | 'laser'
    | 'pigment'
    | 'scar'
    | 'mole'
    | 'weight'
    | 'aging'
    | 'doctor'
    | 'device'
    | 'heart';
  size?: number;
  className?: string;
}) {
  const p = { ...base(size), className };
  switch (name) {
    case 'user':
      return (
        <svg {...p}>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5 19c1.6-3.2 4-4.8 7-4.8S17.4 15.8 19 19" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...p}>
          <path d="M12 21s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10z" />
          <circle cx="12" cy="11" r="2" />
        </svg>
      );
    case 'chevron':
      return (
        <svg {...p}>
          <path d="m7 10 5 5 5-5" />
        </svg>
      );
    case 'check':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.5 2.2 2.2 4.8-5" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...p}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case 'cart':
      return (
        <svg {...p}>
          <circle cx="9" cy="20" r="1.2" />
          <circle cx="17" cy="20" r="1.2" />
          <path d="M3 4h2l1.5 10h11l2-7H7" />
        </svg>
      );
    case 'play':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="m10 8.5 6 3.5-6 3.5v-7z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'star':
      return (
        <svg {...p} fill="currentColor" stroke="none">
          <path d="m12 3.2 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.6 7.2 18.1l.9-5.4L4.2 8.9l5.4-.8L12 3.2z" />
        </svg>
      );
    case 'team':
      return (
        <svg {...p}>
          <circle cx="9" cy="8" r="2.8" />
          <circle cx="16.5" cy="9" r="2.2" />
          <path d="M3.5 18c1.4-3 3.6-4.5 5.5-4.5S13 15 14.5 18" />
          <path d="M14 14.2c1.1-.4 2.4-.4 3.6 0 1.1.4 2 1.2 2.9 2.4" />
        </svg>
      );
    case 'tech':
      return (
        <svg {...p}>
          <rect x="4" y="5" width="16" height="12" rx="2" />
          <path d="M9 21h6M12 17v4" />
          <path d="M8 10h.01M12 10h.01M16 10h.01" />
        </svg>
      );
    case 'plan':
      return (
        <svg {...p}>
          <path d="M8 4h8a2 2 0 0 1 2 2v14l-6-3-6 3V6a2 2 0 0 1 2-2z" />
          <path d="M9 9h6M9 12h4" />
        </svg>
      );
    case 'safe':
      return (
        <svg {...p}>
          <path d="M12 3 4.5 6.2v5.3c0 4.8 3.2 8.1 7.5 9.5 4.3-1.4 7.5-4.7 7.5-9.5V6.2L12 3z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'clients':
      return (
        <svg {...p}>
          <path d="M16 19c0-2.8-2-4.5-4-4.5S8 16.2 8 19" />
          <circle cx="12" cy="9" r="3" />
          <path d="M19.5 18.5c.2-1.8-1-3.1-2.5-3.4" />
          <circle cx="17.5" cy="9.5" r="2" />
          <path d="M4.5 18.5c-.2-1.8 1-3.1 2.5-3.4" />
          <circle cx="6.5" cy="9.5" r="2" />
        </svg>
      );
    case 'treatments':
      return (
        <svg {...p}>
          <path d="M12 3v6M9 6h6" />
          <path d="M8 12a4 4 0 0 0 8 0" />
          <path d="M10 20h4" />
        </svg>
      );
    case 'branches':
      return (
        <svg {...p}>
          <path d="M4 20h16M6 20V9l6-4 6 4v11" />
          <path d="M10 20v-5h4v5" />
        </svg>
      );
    case 'years':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 1.5" />
        </svg>
      );
    case 'facebook':
      return (
        <svg {...p}>
          <path d="M14 9h2.5V6H14a4 4 0 0 0-4 4v2H8v3h2v6h3v-6h2.2l.5-3H13v-1.5A1.5 1.5 0 0 1 14.5 9H14z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg {...p}>
          <rect x="4" y="4" width="16" height="16" rx="4" />
          <circle cx="12" cy="12" r="3.5" />
          <circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'youtube':
      return (
        <svg {...p}>
          <rect x="3" y="7" width="18" height="11" rx="3" />
          <path d="m10 10 5 2.5-5 2.5V10z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg {...p}>
          <path d="M5.2 18.8 6 15.5A7.5 7.5 0 1 1 8.5 18l-3.3.8z" />
          <path d="M9.2 10.2c.3-.6.5-.6.8-.6h.6c.2 0 .4.1.5.4l.7 1.7c.1.2 0 .4-.1.5l-.4.4a5 5 0 0 0 2.2 2.2l.4-.4c.2-.2.4-.2.5-.1l1.7.7c.3.1.4.3.4.5v.6c0 .3 0 .5-.6.8a4.2 4.2 0 0 1-5.4-1.6 6.5 6.5 0 0 1-1.3-3.5z" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...p}>
          <path d="M7.5 4.5h3l1.2 3.2-1.8 1.2a10 10 0 0 0 4.8 4.8l1.2-1.8 3.2 1.2v3A2 2 0 0 1 17 18 12.5 12.5 0 0 1 4.5 5.5a2 2 0 0 1 3-1z" />
        </svg>
      );
    case 'mail':
      return (
        <svg {...p}>
          <rect x="3.5" y="6" width="17" height="12" rx="2" />
          <path d="m5 8 7 5 7-5" />
        </svg>
      );
    case 'doctor':
      return (
        <svg {...p}>
          <circle cx="12" cy="7" r="3" />
          <path d="M6 19c1.2-3.2 3.4-4.8 6-4.8s4.8 1.6 6 4.8" />
          <path d="M16.5 9.5h3M18 8v3" />
        </svg>
      );
    case 'device':
      return (
        <svg {...p}>
          <rect x="5" y="4" width="14" height="16" rx="2" />
          <path d="M9 8h6M9 12h6M9 16h3" />
        </svg>
      );
    case 'heart':
      return (
        <svg {...p}>
          <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
        </svg>
      );
    case 'hydra':
      return (
        <svg {...p}>
          <path d="M12 3c-2 4-5 6.5-5 10a5 5 0 0 0 10 0c0-3.5-3-6-5-10z" />
        </svg>
      );
    case 'tight':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
    case 'laser':
      return (
        <svg {...p}>
          <path d="M4 18 14 4M14 4h4v4" />
          <path d="M8 20h12" />
        </svg>
      );
    case 'pigment':
      return (
        <svg {...p}>
          <circle cx="9" cy="10" r="3" />
          <circle cx="15" cy="13" r="2.5" />
          <circle cx="12" cy="17" r="1.8" />
        </svg>
      );
    case 'scar':
      return (
        <svg {...p}>
          <path d="M7 7c2 2 4 2 6 0s4-2 6 0" />
          <path d="M7 12c2 2 4 2 6 0s4-2 6 0" />
          <path d="M7 17c2 2 4 2 6 0s4-2 6 0" />
        </svg>
      );
    case 'mole':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'weight':
      return (
        <svg {...p}>
          <path d="M7 8h10l1 12H6L7 8z" />
          <path d="M10 8a2 2 0 0 1 4 0" />
        </svg>
      );
    case 'aging':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8" />
          <path d="M8 13c1.2 1.5 2.6 2.2 4 2.2S14.8 14.5 16 13" />
          <path d="M9 10h.01M15 10h.01" />
        </svg>
      );
    default:
      return null;
  }
}

export function AeMark({ size = 36 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="ae-mark">
      <defs>
        <linearGradient id="aeMarkGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0f766e" />
          <stop offset="100%" stopColor="#5eead4" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#aeMarkGrad)" />
      <path
        d="M12 26c2.4-6.5 5.2-10 8-12 2.8 2 5.6 5.5 8 12"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="20" cy="16" r="2.2" fill="#fff" />
    </svg>
  );
}
