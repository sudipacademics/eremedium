export type AdminPermission =
  | 'dashboard.view'
  | 'content.manage'
  | 'catalog.manage'
  | 'operations.manage'
  | 'support.manage'
  | 'finance.view'
  | 'providers.manage'
  | 'joinRequests.manage'
  | 'staff.manage'
  | 'audit.view';

export interface AdminNavItem {
  href: string;
  label: string;
  icon: string;
  /** Any one of these grants access. */
  permissions: readonly AdminPermission[];
}

export interface AdminNavGroup {
  label: string;
  items: readonly AdminNavItem[];
}

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard', icon: '◈', permissions: ['dashboard.view'] }],
  },
  {
    label: 'Providers',
    items: [
      { href: '/admin/join-requests', label: 'Provider Join Requests', icon: '✦', permissions: ['joinRequests.manage'] },
      { href: '/admin/astrologers', label: 'Provider roster', icon: '☉', permissions: ['providers.manage'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/support', label: 'Support board', icon: '☏', permissions: ['support.manage'] },
      { href: '/admin/history', label: 'Customer history', icon: '⌕', permissions: ['support.manage', 'finance.view'] },
      { href: '/admin/puja-bookings', label: 'E-Puja bookings', icon: '🕯', permissions: ['operations.manage'] },
      { href: '/admin/ayurveda-orders', label: 'Shop orders', icon: '📦', permissions: ['operations.manage'] },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { href: '/admin/pujas', label: 'E-Puja catalog', icon: '🛕', permissions: ['catalog.manage'] },
      { href: '/admin/ayurveda', label: 'Products', icon: '🌿', permissions: ['catalog.manage'] },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/home', label: 'Homepage', icon: '⌂', permissions: ['content.manage'] },
      { href: '/admin/hero', label: 'Hero slides', icon: '▣', permissions: ['content.manage'] },
      { href: '/admin/reviews', label: 'YouTube reviews', icon: '▶', permissions: ['content.manage'] },
      { href: '/admin/articles', label: 'Articles', icon: '✎', permissions: ['content.manage'] },
      { href: '/admin/numerology', label: 'Numerology', icon: '९', permissions: ['content.manage'] },
      { href: '/admin/footer', label: 'Footer & app links', icon: '⛓', permissions: ['content.manage'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/admin/staff', label: 'Staff & roles', icon: '⚑', permissions: ['staff.manage'] },
      { href: '/admin/audit', label: 'Audit log', icon: '☰', permissions: ['audit.view'] },
    ],
  },
];

const ALL_ITEMS = ADMIN_NAV.flatMap((group) => group.items);

export function canAccess(item: Pick<AdminNavItem, 'permissions'>, granted: readonly string[]): boolean {
  return item.permissions.some((permission) => granted.includes(permission));
}

/** The nav entry that owns a path: the longest matching prefix, so /admin/join-requests/x maps to Join Requests. */
export function navItemForPath(pathname: string): AdminNavItem | null {
  let best: AdminNavItem | null = null;
  for (const item of ALL_ITEMS) {
    const matches = item.href === '/admin' ? pathname === '/admin' : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

export function visibleNav(granted: readonly string[]): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({ ...group, items: group.items.filter((item) => canAccess(item, granted)) })).filter(
    (group) => group.items.length > 0,
  );
}
