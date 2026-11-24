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
      { to: '/aesthetic-admin/bookings/patients', label: 'Patient Directory' },
      { to: '/aesthetic-admin/bookings/calendar', label: 'Calendar View' },
      { to: '/aesthetic-admin/bookings/reviews', label: 'Ratings & Reviews' },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    icon: 'sparkle',
    items: [
      { to: '/aesthetic-admin/services', label: 'Service Management' },
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
      { to: '/aesthetic-admin/products/inventory', label: 'Inventory' },
    ],
  },
  {
    id: 'machines',
    label: 'Machines',
    icon: 'machine',
    to: '/aesthetic-admin/machines',
  },
  {
    id: 'invoices',
    label: 'Invoices',
    icon: 'invoice',
    items: [
      { to: '/aesthetic-admin/invoices', label: 'Invoice List' },
      { to: '/aesthetic-admin/invoices/new', label: 'Create Invoice' },
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
