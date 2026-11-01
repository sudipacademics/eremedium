export type BookingStatus = 'Confirmed' | 'Completed' | 'Pending' | 'Cancelled';
export type PaymentStatus = 'Paid' | 'Pending' | 'Refunded' | 'Partial';

export type AestheticBookingRow = {
  id: string;
  datetime: string;
  customer: string;
  phone: string;
  service: string;
  branch: string;
  status: BookingStatus;
  payment: PaymentStatus;
  amount: number;
};

export type AestheticActivity = {
  id: string;
  title: string;
  detail: string;
  when: string;
  kind: 'booking' | 'payment' | 'product' | 'employee' | 'machine';
};

export type AestheticKpi = {
  id: string;
  label: string;
  value: string;
  delta: number;
  tone: 'mint' | 'rose' | 'sky' | 'lavender' | 'peach';
  icon: 'calendar' | 'rupee' | 'check' | 'box' | 'star';
};

export const DASHBOARD_KPIS: AestheticKpi[] = [
  { id: 'bookings', label: 'Total Bookings', value: '124', delta: 18, tone: 'mint', icon: 'calendar' },
  { id: 'revenue', label: 'Total Revenue', value: '₹2,48,500', delta: 27, tone: 'rose', icon: 'rupee' },
  { id: 'completed', label: 'Services Completed', value: '98', delta: 15, tone: 'sky', icon: 'check' },
  { id: 'products', label: 'Product Sales', value: '₹68,320', delta: 22, tone: 'lavender', icon: 'box' },
  { id: 'rating', label: 'Customer Rating', value: '4.8/5', delta: 12, tone: 'peach', icon: 'star' },
];

export const REVENUE_SERIES = {
  labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
  service: [42000, 51000, 48000, 57500],
  product: [12000, 15500, 14800, 18020],
};

export const BOOKING_STATUS = [
  { key: 'Confirmed', value: 68, pct: 55, color: '#0f766e' },
  { key: 'Completed', value: 34, pct: 27, color: '#34d399' },
  { key: 'Pending', value: 12, pct: 10, color: '#eab308' },
  { key: 'Cancelled', value: 10, pct: 8, color: '#ef4444' },
] as const;

export const RECENT_BOOKINGS: AestheticBookingRow[] = [
  {
    id: 'AE-BK-1042',
    datetime: '16 Oct 2026 · 11:30 AM',
    customer: 'Ananya Roy',
    phone: '98XXXX4521',
    service: 'Hydrafacial',
    branch: 'Bongaon',
    status: 'Confirmed',
    payment: 'Paid',
    amount: 3500,
  },
  {
    id: 'AE-BK-1041',
    datetime: '16 Oct 2026 · 10:00 AM',
    customer: 'Meera Kapoor',
    phone: '97XXXX8812',
    service: 'Laser Hair Removal',
    branch: 'Bongaon',
    status: 'Completed',
    payment: 'Paid',
    amount: 4500,
  },
  {
    id: 'AE-BK-1040',
    datetime: '15 Oct 2026 · 4:15 PM',
    customer: 'Priya Sen',
    phone: '90XXXX2209',
    service: 'Pigmentation Peel',
    branch: 'Barasat',
    status: 'Pending',
    payment: 'Pending',
    amount: 2800,
  },
  {
    id: 'AE-BK-1039',
    datetime: '15 Oct 2026 · 1:00 PM',
    customer: 'Riya Das',
    phone: '91XXXX7740',
    service: 'Anti-Aging Facial',
    branch: 'Bongaon',
    status: 'Confirmed',
    payment: 'Partial',
    amount: 5200,
  },
  {
    id: 'AE-BK-1038',
    datetime: '14 Oct 2026 · 12:30 PM',
    customer: 'Sneha Ghosh',
    phone: '98XXXX1193',
    service: 'Skin Tightening',
    branch: 'Barasat',
    status: 'Cancelled',
    payment: 'Refunded',
    amount: 6000,
  },
  {
    id: 'AE-BK-1037',
    datetime: '14 Oct 2026 · 9:45 AM',
    customer: 'Kavita Bose',
    phone: '96XXXX5534',
    service: 'Hydrafacial',
    branch: 'Bongaon',
    status: 'Completed',
    payment: 'Paid',
    amount: 3500,
  },
];

export const RECENT_ACTIVITY: AestheticActivity[] = [
  {
    id: 'a1',
    title: 'New booking created',
    detail: 'Ananya Roy · Hydrafacial · Bongaon',
    when: '10 minutes ago',
    kind: 'booking',
  },
  {
    id: 'a2',
    title: 'Payment received',
    detail: '₹4,500 · AE-BK-1041 · Meera Kapoor',
    when: '25 minutes ago',
    kind: 'payment',
  },
  {
    id: 'a3',
    title: 'New product sale',
    detail: 'Anti-Aging Serum · Barasat counter',
    when: '1 hour ago',
    kind: 'product',
  },
  {
    id: 'a4',
    title: 'New employee added',
    detail: 'Therapist · Bongaon Branch',
    when: '2 hours ago',
    kind: 'employee',
  },
  {
    id: 'a5',
    title: 'Machine service completed',
    detail: 'Hydrafacial unit · AMC check OK',
    when: '3 hours ago',
    kind: 'machine',
  },
];

export const QUICK_ACTIONS = [
  { to: '/aesthetic-admin/bookings/new', label: 'New Booking', tone: 'mint', icon: 'calendar' },
  { to: '/aesthetic-admin/services', label: 'Add Service', tone: 'sky', icon: 'sparkle' },
  { to: '/aesthetic-admin/products', label: 'Add Product', tone: 'lavender', icon: 'box' },
  { to: '/aesthetic-admin/invoices/new', label: 'Create Invoice', tone: 'peach', icon: 'invoice' },
  { to: '/aesthetic-admin/employees', label: 'Add Employee', tone: 'rose', icon: 'users' },
  { to: '/aesthetic-admin/branches', label: 'Manage Branch', tone: 'teal', icon: 'building' },
] as const;

export function statusTone(status: BookingStatus) {
  switch (status) {
    case 'Confirmed':
      return 'green';
    case 'Completed':
      return 'blue';
    case 'Pending':
      return 'amber';
    case 'Cancelled':
      return 'rose';
    default:
      return 'slate';
  }
}

export function paymentTone(payment: PaymentStatus) {
  switch (payment) {
    case 'Paid':
      return 'green';
    case 'Pending':
      return 'amber';
    case 'Refunded':
      return 'rose';
    case 'Partial':
      return 'sky';
    default:
      return 'slate';
  }
}
