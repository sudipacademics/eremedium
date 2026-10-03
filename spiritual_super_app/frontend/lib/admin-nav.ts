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

export type AdminIcon =
  | 'dashboard'
  | 'providers'
  | 'joinRequests'
  | 'live'
  | 'bookings'
  | 'orders'
  | 'history'
  | 'products'
  | 'temple'
  | 'blog'
  | 'numerology'
  | 'home'
  | 'banner'
  | 'video'
  | 'links'
  | 'roles'
  | 'audit';

export interface AdminNavItem {
  href: string;
  label: string;
  icon: AdminIcon;
  /** Any one of these grants access. */
  permissions: readonly AdminPermission[];
  /** Key into AdminMe.badges for a count shown beside the item. */
  badge?: 'joinRequestsPending';
}

export interface AdminNavGroup {
  /** Null for the ungrouped Dashboard entry at the top. */
  label: string | null;
  items: readonly AdminNavItem[];
}

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    label: null,
    items: [{ href: '/admin', label: 'Dashboard', icon: 'dashboard', permissions: ['dashboard.view'] }],
  },
  {
    label: 'Provider Operations',
    items: [
      { href: '/admin/astrologers', label: 'Provider Management', icon: 'providers', permissions: ['providers.manage'] },
      {
        href: '/admin/join-requests',
        label: 'Provider Join Requests',
        icon: 'joinRequests',
        permissions: ['joinRequests.manage'],
        badge: 'joinRequestsPending',
      },
    ],
  },
  {
    label: 'Sessions & Bookings',
    items: [
      { href: '/admin/support', label: 'Live Sessions', icon: 'live', permissions: ['support.manage'] },
      { href: '/admin/puja-bookings', label: 'E-Puja Bookings', icon: 'bookings', permissions: ['operations.manage'] },
      { href: '/admin/ayurveda-orders', label: 'Shop Orders', icon: 'orders', permissions: ['operations.manage'] },
      { href: '/admin/history', label: 'Session History', icon: 'history', permissions: ['support.manage', 'finance.view'] },
    ],
  },
  {
    label: 'Content & Resources',
    items: [
      { href: '/admin/ayurveda', label: 'Product Management', icon: 'products', permissions: ['catalog.manage'] },
      { href: '/admin/pujas', label: 'E-Puja Catalog', icon: 'temple', permissions: ['catalog.manage'] },
      { href: '/admin/articles', label: 'Blogs', icon: 'blog', permissions: ['content.manage'] },
      { href: '/admin/numerology', label: 'Numerology', icon: 'numerology', permissions: ['content.manage'] },
    ],
  },
  {
    label: 'Website',
    items: [
      { href: '/admin/home', label: 'Homepage Sections', icon: 'home', permissions: ['content.manage'] },
      { href: '/admin/hero', label: 'Banners & Hero Slider', icon: 'banner', permissions: ['content.manage'] },
      { href: '/admin/reviews', label: 'YouTube Reviews', icon: 'video', permissions: ['content.manage'] },
      { href: '/admin/footer', label: 'Footer & App Links', icon: 'links', permissions: ['content.manage'] },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/admin/staff', label: 'Roles & Permissions', icon: 'roles', permissions: ['staff.manage'] },
      { href: '/admin/audit', label: 'Audit Log', icon: 'audit', permissions: ['audit.view'] },
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

/** Pages whose label matches every word of the query, for the top-bar search. */
export function searchNav(query: string, granted: readonly string[]): AdminNavItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return ALL_ITEMS.filter((item) => canAccess(item, granted)).filter((item) => {
    const label = item.label.toLowerCase();
    return words.every((word) => label.includes(word));
  });
}
