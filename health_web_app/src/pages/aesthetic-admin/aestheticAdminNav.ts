export type AdminNavItem = {
  to: string;
  label: string;
};

export type AdminNavGroup = {
  id: string;
  label: string;
  icon: string;
  items?: AdminNavItem[];
  to?: string;
};

export const AESTHETIC_ADMIN_NAV: AdminNavGroup[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', to: '/aesthetic-admin' },
  {
    id: 'bookings',
    label: 'Bookings',
    icon: 'calendar',
    items: [
      { to: '/aesthetic-admin/bookings', label: 'All Bookings' },
      { to: '/aesthetic-admin/bookings/calendar', label: 'Calendar View' },
      { to: '/aesthetic-admin/bookings/new', label: 'New Booking' },
      { to: '/aesthetic-admin/bookings/walk-in', label: 'Walk-in Booking' },
      { to: '/aesthetic-admin/bookings/reviews', label: 'Ratings & Reviews' },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    icon: 'sparkle',
    items: [
      { to: '/aesthetic-admin/services', label: 'Service List' },
      { to: '/aesthetic-admin/services/sessions', label: 'Session Management' },
      { to: '/aesthetic-admin/services/plans', label: 'Treatment Plans' },
      { to: '/aesthetic-admin/services/categories', label: 'Service Categories' },
    ],
  },
  {
    id: 'products',
    label: 'Products',
    icon: 'box',
    items: [
      { to: '/aesthetic-admin/products', label: 'Sales Products' },
      { to: '/aesthetic-admin/products/procedure', label: 'Procedure Products' },
      { to: '/aesthetic-admin/products/categories', label: 'Categories' },
      { to: '/aesthetic-admin/products/inventory', label: 'Inventory' },
      { to: '/aesthetic-admin/products/purchase', label: 'Purchase & Stock' },
    ],
  },
  {
    id: 'machines',
    label: 'Machines',
    icon: 'machine',
    items: [
      { to: '/aesthetic-admin/machines', label: 'Machine List' },
      { to: '/aesthetic-admin/machines/service', label: 'Service & Maintenance' },
      { to: '/aesthetic-admin/machines/amc', label: 'AMC Tracking' },
    ],
  },
  {
    id: 'invoices',
    label: 'Invoices',
    icon: 'invoice',
    items: [
      { to: '/aesthetic-admin/invoices', label: 'Invoice List' },
      { to: '/aesthetic-admin/invoices/new', label: 'Create Invoice' },
      { to: '/aesthetic-admin/invoices/payments', label: 'Payment Records' },
    ],
  },
  {
    id: 'branches',
    label: 'Branches',
    icon: 'building',
    items: [{ to: '/aesthetic-admin/branches', label: 'Branch Management' }],
  },
  {
    id: 'employees',
    label: 'Employees',
    icon: 'users',
    items: [
      { to: '/aesthetic-admin/employees', label: 'Employee Profile' },
      { to: '/aesthetic-admin/employees/attendance', label: 'Attendance' },
      { to: '/aesthetic-admin/employees/roles', label: 'Roles & Permissions' },
    ],
  },
  { id: 'settings', label: 'Settings', icon: 'settings', to: '/aesthetic-admin/settings' },
];

export const AESTHETIC_ADMIN_BRANCHES = [
  { id: 'bongaon', label: 'Bongaon Branch' },
  { id: 'barasat', label: 'Barasat Branch' },
] as const;
