export const UNITS = [
  { id: 'lab', name: 'Lab', short: 'Lab Operations', full: 'Diagnostic & Pathology' },
  { id: 'care', name: 'Care', short: 'Care Operations', full: 'Pain Relief & Physiotherapy' },
  { id: 'aesthetic', name: 'Aesthetic', short: 'Aesthetic Operations', full: 'Skin, Hair & Aesthetic Clinic' },
  { id: 'pharmacy', name: 'Pharmacy', short: 'Pharmacy Operations', full: 'Medicine & Health Products' },
] as const;

export type UnitId = (typeof UNITS)[number]['id'];

export function isUnitId(value: string | undefined): value is UnitId {
  return UNITS.some((unit) => unit.id === value);
}

export function unitById(id: UnitId) {
  return UNITS.find((unit) => unit.id === id)!;
}

export const NETWORK = {
  activeUnits: 56,
  labUnits: 32,
  careUnits: 8,
  aestheticUnits: 6,
  pharmacyUnits: 10,
  assets: 1246,
  inService: 1102,
  underService: 68,
  inactive: 76,
  slaTarget: 95,
};

export const DELTAS = {
  bookings: '↑ 12.6% vs last 7 days',
  revenue: '↑ 14.8%',
  collections: '↑ 11.2%',
  deliveries: '↑ 13.4%',
};

export type Totals = {
  bookings: number;
  revenue: number;
  collections: number;
  deliveries: number;
  sla: number;
  today: Record<UnitId, number>;
  week: Record<UnitId, number>;
};

export const INITIAL_TOTALS: Totals = {
  bookings: 4892,
  revenue: 2876340,
  collections: 2948,
  deliveries: 4621,
  sla: 96.8,
  today: { lab: 1024, care: 236, aesthetic: 298, pharmacy: 386 },
  week: { lab: 1924, care: 612, aesthetic: 838, pharmacy: 1518 },
};

export const UNIT_REVENUE: Record<UnitId, number> = {
  lab: 1240000,
  care: 310000,
  aesthetic: 840000,
  pharmacy: 486340,
};

export const APPROVED_EARLIER = 42;

export function formatNumber(value: number) {
  return value.toLocaleString('en-IN');
}

export function formatINR(value: number) {
  return `₹${value.toLocaleString('en-IN')}`;
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export type Branch = {
  id: string;
  name: string;
  area: string;
  unit: UnitId;
  bookings: number;
  revenue: number;
  sla: number;
};

export const BRANCHES: Branch[] = [
  { id: 'chh', name: 'Central Health Hub', area: 'Kolkata', unit: 'lab', bookings: 342, revenue: 228560, sla: 96.4 },
  { id: 'bcc', name: 'Barasat Care Centre', area: 'Barasat', unit: 'care', bookings: 118, revenue: 86420, sla: 95.1 },
  { id: 'boa', name: 'Bongaon Aesthetic', area: 'Bongaon', unit: 'aesthetic', bookings: 164, revenue: 196300, sla: 95.8 },
  { id: 'anp', name: 'Ashoknagar Pharmacy', area: 'Ashoknagar', unit: 'pharmacy', bookings: 292, revenue: 154780, sla: 97.6 },
  { id: 'sll', name: 'Salt Lake Lab', area: 'Salt Lake', unit: 'lab', bookings: 128, revenue: 74200, sla: 97.2 },
  { id: 'ddc', name: 'Dum Dum Care', area: 'Dum Dum', unit: 'care', bookings: 74, revenue: 41800, sla: 96.1 },
  { id: 'hwa', name: 'Howrah Aesthetic', area: 'Howrah', unit: 'aesthetic', bookings: 91, revenue: 112400, sla: 95.4 },
  { id: 'brp', name: 'Barrackpore Pharmacy', area: 'Barrackpore', unit: 'pharmacy', bookings: 140, revenue: 68440, sla: 96.9 },
  { id: 'ncp', name: 'Nadia Collection Point', area: 'Krishnanagar', unit: 'lab', bookings: 86, revenue: 41200, sla: 92.4 },
  { id: 'bhc', name: 'Basirhat Care', area: 'Basirhat', unit: 'care', bookings: 54, revenue: 28640, sla: 91.1 },
  { id: 'hba', name: 'Habra Aesthetic', area: 'Habra', unit: 'aesthetic', bookings: 71, revenue: 68400, sla: 93.6 },
  { id: 'rph', name: 'Ranaghat Pharmacy', area: 'Ranaghat', unit: 'pharmacy', bookings: 96, revenue: 41220, sla: 90.8 },
  { id: 'krl', name: 'Krishnanagar Lab', area: 'Krishnanagar', unit: 'lab', bookings: 77, revenue: 36800, sla: 94.2 },
  { id: 'bhc2', name: 'Barasat Home Care', area: 'Barasat', unit: 'care', bookings: 41, revenue: 22480, sla: 89.6 },
  { id: 'naa', name: 'Naihati Aesthetic', area: 'Naihati', unit: 'aesthetic', bookings: 63, revenue: 54210, sla: 94.8 },
  { id: 'kph', name: 'Kalyani Pharmacy', area: 'Kalyani', unit: 'pharmacy', bookings: 88, revenue: 39140, sla: 93.1 },
];

export const DASHBOARD_BRANCH_IDS = ['chh', 'bcc', 'boa', 'anp'];

export const SERVICES: Record<UnitId, string[]> = {
  lab: ['CBC', 'Thyroid profile', 'HbA1c', 'Lipid profile', 'Vitamin D', 'Home collection'],
  care: ['Physiotherapy session', 'Pain consultation', 'Posture therapy', 'Home care visit'],
  aesthetic: ['Hydrafacial', 'Laser hair reduction', 'Chemical peel', 'Hair PRP', 'Skin consultation'],
  pharmacy: ['Counter order', 'Prescription refill', 'Cold-chain delivery', 'Ward supply'],
};

export type BookingStatus = 'Scheduled' | 'In progress' | 'Completed' | 'Delayed';

export type Booking = {
  id: string;
  patient: string;
  mobile: string;
  unit: UnitId;
  branch: string;
  service: string;
  when: string;
  amount: number;
  status: BookingStatus;
  session?: boolean;
};

export const INITIAL_BOOKINGS: Booking[] = [
  { id: 'BK-48291', patient: 'Ananya Sen', mobile: '9830011201', unit: 'lab', branch: 'Central Health Hub', service: 'Thyroid profile', when: '01 Nov 2026 · 09:10 AM', amount: 890, status: 'In progress' },
  { id: 'BK-48288', patient: 'Rahul Das', mobile: '9830012244', unit: 'care', branch: 'Barasat Care Centre', service: 'Physiotherapy session', when: '01 Nov 2026 · 11:00 AM', amount: 750, status: 'Delayed' },
  { id: 'BK-48276', patient: 'Moumita Ghosh', mobile: '9903122281', unit: 'aesthetic', branch: 'Bongaon Aesthetic', service: 'Hydrafacial', when: '01 Nov 2026 · 01:30 PM', amount: 3200, status: 'Scheduled' },
  { id: 'BK-48270', patient: 'Sourav Pal', mobile: '9831021190', unit: 'pharmacy', branch: 'Ashoknagar Pharmacy', service: 'Prescription refill', when: '01 Nov 2026 · 08:40 AM', amount: 640, status: 'Completed' },
  { id: 'BK-48261', patient: 'Nandita Roy', mobile: '9874412300', unit: 'lab', branch: 'Salt Lake Lab', service: 'Home collection', when: '01 Nov 2026 · 07:20 AM', amount: 1450, status: 'Completed' },
  { id: 'BK-48254', patient: 'Imran Sheikh', mobile: '9830117782', unit: 'aesthetic', branch: 'Howrah Aesthetic', service: 'Laser hair reduction', when: '31 Oct 2026 · 05:00 PM', amount: 4800, status: 'Delayed' },
  { id: 'BK-48240', patient: 'Piu Banerjee', mobile: '9830026611', unit: 'care', branch: 'Dum Dum Care', service: 'Home care visit', when: '01 Nov 2026 · 04:00 PM', amount: 1100, status: 'Scheduled' },
  { id: 'BK-48233', patient: 'Arjun Nair', mobile: '9903011455', unit: 'pharmacy', branch: 'Barrackpore Pharmacy', service: 'Cold-chain delivery', when: '01 Nov 2026 · 02:15 PM', amount: 980, status: 'In progress' },
];

export type Task = {
  id: string;
  title: string;
  detail: string;
  priority: 'High' | 'Medium' | 'Low';
  done: boolean;
};

export const INITIAL_TASKS: Task[] = [
  { id: 'TS-1', title: 'Review pending sample collections (18)', detail: 'Lab Operations · Due: Today, 12:00 PM', priority: 'High', done: false },
  { id: 'TS-2', title: 'Follow up service delay — Care (5)', detail: 'Care Operations · Due: Today, 04:00 PM', priority: 'Medium', done: false },
  { id: 'TS-3', title: 'Aesthetic appointment capacity review', detail: 'Aesthetic Operations · Due: Tomorrow', priority: 'Medium', done: false },
  { id: 'TS-4', title: 'Process pharmacy low-stock requisition', detail: 'Pharmacy Operations · Completed today', priority: 'Low', done: true },
];

export type ApprovalStatus = 'Pending' | 'In Review' | 'Approved' | 'Rejected';

export type Approval = {
  id: string;
  title: string;
  type: string;
  unit: UnitId;
  requester: string;
  status: ApprovalStatus;
  age: string;
};

export const INITIAL_APPROVALS: Approval[] = [
  { id: 'AP-3101', title: 'Low-stock requisition · Vitamin D3 60k', type: 'Purchase', unit: 'pharmacy', requester: 'Ashoknagar Pharmacy', status: 'Pending', age: '25 min' },
  { id: 'AP-3102', title: 'Low-stock requisition · Insulin glargine', type: 'Purchase', unit: 'pharmacy', requester: 'Barrackpore Pharmacy', status: 'Pending', age: '40 min' },
  { id: 'AP-3103', title: 'Reagent purchase · CBC kits', type: 'Purchase', unit: 'lab', requester: 'Central Health Hub', status: 'Pending', age: '1 hr' },
  { id: 'AP-3104', title: 'Aesthetic machine AMC renewal', type: 'Maintenance', unit: 'aesthetic', requester: 'Bongaon Aesthetic', status: 'Pending', age: '2 hr' },
  { id: 'AP-3105', title: 'Care overtime · night shift', type: 'HR', unit: 'care', requester: 'Barasat Care Centre', status: 'Pending', age: '3 hr' },
  { id: 'AP-3106', title: 'New vendor · Medilife Supplies', type: 'Vendor', unit: 'lab', requester: 'Central purchase', status: 'Pending', age: '4 hr' },
  { id: 'AP-3107', title: 'Sample recollection waiver', type: 'Quality', unit: 'lab', requester: 'Salt Lake Lab', status: 'Pending', age: '5 hr' },
  { id: 'AP-3108', title: 'Discount above cap · Hydrafacial', type: 'Pricing', unit: 'aesthetic', requester: 'Howrah Aesthetic', status: 'Pending', age: '6 hr' },
  { id: 'AP-3109', title: 'Asset write-off · idle centrifuge', type: 'Asset', unit: 'lab', requester: 'Nadia Collection Point', status: 'Pending', age: 'Yesterday' },
  { id: 'AP-3110', title: 'Shift swap · Care physiotherapist', type: 'HR', unit: 'care', requester: 'Dum Dum Care', status: 'Pending', age: 'Yesterday' },
  { id: 'AP-3111', title: 'Cold-chain excursion review', type: 'Quality', unit: 'pharmacy', requester: 'Kalyani Pharmacy', status: 'Pending', age: 'Yesterday' },
  { id: 'AP-3112', title: 'Collection route change · Salt Lake', type: 'Logistics', unit: 'lab', requester: 'Logistics desk', status: 'Pending', age: 'Yesterday' },
  { id: 'AP-3088', title: 'Analyzer calibration sign-off', type: 'Quality', unit: 'lab', requester: 'Central Health Hub', status: 'In Review', age: 'Today' },
  { id: 'AP-3084', title: 'Physiotherapist credential renewal', type: 'HR', unit: 'care', requester: 'People desk', status: 'In Review', age: 'Today' },
  { id: 'AP-3081', title: 'Schedule H register audit', type: 'Quality', unit: 'pharmacy', requester: 'Ashoknagar Pharmacy', status: 'In Review', age: 'Yesterday' },
  { id: 'AP-3010', title: 'Home-collection van fuel advance', type: 'Logistics', unit: 'lab', requester: 'Logistics desk', status: 'Approved', age: '2 days' },
  { id: 'AP-3008', title: 'Pharmacy return to vendor', type: 'Purchase', unit: 'pharmacy', requester: 'Ashoknagar Pharmacy', status: 'Approved', age: '2 days' },
  { id: 'AP-3004', title: 'Laser room consumables', type: 'Purchase', unit: 'aesthetic', requester: 'Bongaon Aesthetic', status: 'Approved', age: '3 days' },
  { id: 'AP-2991', title: 'Camp booking block · Barasat', type: 'Logistics', unit: 'lab', requester: 'Reach desk', status: 'Approved', age: '4 days' },
  { id: 'AP-2984', title: 'Uniform issue · collectors', type: 'HR', unit: 'lab', requester: 'People desk', status: 'Approved', age: '5 days' },
  { id: 'AP-2977', title: 'QC reagent lot release', type: 'Quality', unit: 'lab', requester: 'Quality desk', status: 'Approved', age: '6 days' },
  { id: 'AP-2960', title: 'Unlisted aesthetic package discount', type: 'Pricing', unit: 'aesthetic', requester: 'Naihati Aesthetic', status: 'Rejected', age: '3 days' },
  { id: 'AP-2954', title: 'Same-day vendor payment without GRN', type: 'Purchase', unit: 'pharmacy', requester: 'Ranaghat Pharmacy', status: 'Rejected', age: '4 days' },
];

export type ServiceJob = {
  id: string;
  unit: UnitId;
  branch: string;
  service: string;
  patient: string;
  slot: string;
  status: 'On time' | 'Delayed' | 'Completed' | 'Queued';
};

const CARE_DELAYS: Array<[string, string, string]> = [
  ['Physiotherapy session', 'Barasat Care Centre', 'Rina Mondal'],
  ['Home care visit', 'Barasat Home Care', 'Amit Saha'],
  ['Pain consultation', 'Basirhat Care', 'Kaberi Dutta'],
  ['Posture therapy', 'Dum Dum Care', 'Soham Bose'],
  ['Ultrasound therapy', 'Barasat Care Centre', 'Lina Paul'],
];

const AESTHETIC_DELAYS: Array<[string, string, string]> = [
  ['Hydrafacial', 'Bongaon Aesthetic', 'Tania Iqbal'],
  ['Laser hair reduction', 'Howrah Aesthetic', 'Rakesh Jain'],
  ['Chemical peel', 'Habra Aesthetic', 'Oindrila Mitra'],
  ['Hair PRP', 'Naihati Aesthetic', 'Farhan Ali'],
];

export const SERVICE_JOBS: ServiceJob[] = [
  ...CARE_DELAYS.map(([service, branch, patient], index) => ({
    id: `SV-C${index + 1}`,
    unit: 'care' as const,
    branch,
    service,
    patient,
    slot: 'Today · afternoon',
    status: 'Delayed' as const,
  })),
  ...AESTHETIC_DELAYS.map(([service, branch, patient], index) => ({
    id: `SV-A${index + 1}`,
    unit: 'aesthetic' as const,
    branch,
    service,
    patient,
    slot: 'Today · evening',
    status: 'Delayed' as const,
  })),
  { id: 'SV-11', unit: 'lab', branch: 'Central Health Hub', service: 'Home collection', patient: 'Ananya Sen', slot: 'Today · 09:10 AM', status: 'On time' },
  { id: 'SV-12', unit: 'pharmacy', branch: 'Ashoknagar Pharmacy', service: 'Counter order', patient: 'Sourav Pal', slot: 'Today · 08:40 AM', status: 'Completed' },
  { id: 'SV-13', unit: 'care', branch: 'Dum Dum Care', service: 'Pain consultation', patient: 'Piu Banerjee', slot: 'Today · 04:00 PM', status: 'Queued' },
];

export type Move = {
  id: string;
  kind: 'Sample pickup' | 'Sample dispatch' | 'Pharmacy delivery' | 'Equipment';
  unit: UnitId;
  from: string;
  to: string;
  handler: string;
  status: 'Assigned' | 'In transit' | 'Pending' | 'Delivered';
  slot: string;
};

const DISPATCH_TO = ['Salt Lake', 'Howrah', 'Dum Dum', 'Barasat', 'Bongaon', 'Kalyani'];

export const MOVES: Move[] = [
  ...DISPATCH_TO.map((place, index) => ({
    id: `LG-D${index + 1}`,
    kind: 'Sample dispatch' as const,
    unit: 'lab' as const,
    from: 'Central Health Hub',
    to: place,
    handler: 'Lab logistics',
    status: 'Pending' as const,
    slot: 'Today · before 2:00 PM',
  })),
  { id: 'LG-21', kind: 'Sample pickup', unit: 'lab', from: 'Salt Lake residence', to: 'Central Health Hub', handler: 'Collector · R. Mondal', status: 'In transit', slot: 'Today · 07:20 AM' },
  { id: 'LG-22', kind: 'Pharmacy delivery', unit: 'pharmacy', from: 'Ashoknagar Pharmacy', to: 'Barasat Care Centre', handler: 'Rider · S. Das', status: 'Assigned', slot: 'Today · 02:15 PM' },
  { id: 'LG-23', kind: 'Equipment', unit: 'care', from: 'Dum Dum Care', to: 'Service vendor', handler: 'Care desk', status: 'Delivered', slot: '31 Oct · 11:00 AM' },
];

export type StockItem = {
  id: string;
  name: string;
  unit: UnitId;
  branch: string;
  stock: number;
  reorder: number;
  uom: string;
};

const LOW_STOCK: Array<[string, number, number]> = [
  ['Vitamin D3 60k', 6, 24],
  ['Paracetamol 650', 18, 40],
  ['Azithromycin 500', 4, 20],
  ['Pantoprazole 40', 9, 30],
  ['Cetirizine 10', 11, 25],
  ['ORS sachets', 8, 36],
  ['Insulin glargine pen', 2, 10],
  ['Metformin 500', 14, 40],
  ['Atorvastatin 10', 7, 20],
  ['Amoxicillin 500', 5, 24],
  ['Surgical masks', 20, 80],
  ['Digital thermometer', 1, 6],
];

export const STOCK: StockItem[] = [
  ...LOW_STOCK.map(([name, stock, reorder], index) => ({
    id: `IT-${index + 1}`,
    name,
    unit: 'pharmacy' as const,
    branch: index % 2 === 0 ? 'Ashoknagar Pharmacy' : 'Barrackpore Pharmacy',
    stock,
    reorder,
    uom: 'Pack',
  })),
  { id: 'IT-13', name: 'Hand rub 500 ml', unit: 'pharmacy', branch: 'Ashoknagar Pharmacy', stock: 40, reorder: 12, uom: 'Bottle' },
  { id: 'IT-14', name: 'CBC reagent kit', unit: 'lab', branch: 'Central Health Hub', stock: 6, reorder: 8, uom: 'Kit' },
  { id: 'IT-15', name: 'Physio gel', unit: 'care', branch: 'Barasat Care Centre', stock: 22, reorder: 10, uom: 'Tube' },
];

export type Vendor = {
  id: string;
  name: string;
  category: string;
  units: string;
  orders: number;
  rating: string;
  contact: string;
  status: 'Active' | 'On hold';
};

export const VENDORS: Vendor[] = [
  { id: 'VN-1', name: 'Medilife Diagnostics Supplies', category: 'Reagents', units: 'Lab', orders: 6, rating: '4.6', contact: 'accounts@medilife.example', status: 'Active' },
  { id: 'VN-2', name: 'CareLine Consumables', category: 'Clinic consumables', units: 'Care', orders: 3, rating: '4.4', contact: 'hello@careline.example', status: 'Active' },
  { id: 'VN-3', name: 'DermaSource Aesthetic', category: 'Devices & peels', units: 'Aesthetic', orders: 2, rating: '4.7', contact: 'orders@dermasource.example', status: 'Active' },
  { id: 'VN-4', name: 'PharmaNest Distributors', category: 'Medicines', units: 'Pharmacy', orders: 8, rating: '4.5', contact: 'dispatch@pharmanest.example', status: 'Active' },
  { id: 'VN-5', name: 'ColdChain Bengal', category: 'Cold logistics', units: 'Pharmacy · Lab', orders: 4, rating: '4.2', contact: 'ops@coldchain.example', status: 'Active' },
  { id: 'VN-6', name: 'North 24 Service Engineers', category: 'Equipment AMC', units: 'All units', orders: 1, rating: '3.8', contact: 'service@n24.example', status: 'On hold' },
];

export type Asset = {
  id: string;
  name: string;
  unit: UnitId;
  branch: string;
  status: 'In Service' | 'Under Service' | 'Inactive';
  next: string;
};

export const ASSETS: Asset[] = [
  { id: 'AS-1044', name: 'Hematology analyzer', unit: 'lab', branch: 'Central Health Hub', status: 'In Service', next: '18 Nov 2026' },
  { id: 'AS-1102', name: 'Centrifuge · bay 2', unit: 'lab', branch: 'Nadia Collection Point', status: 'Inactive', next: 'Write-off pending' },
  { id: 'AS-2210', name: 'IFT / ultrasound combo', unit: 'care', branch: 'Barasat Care Centre', status: 'Under Service', next: 'Due today' },
  { id: 'AS-2218', name: 'Traction table', unit: 'care', branch: 'Dum Dum Care', status: 'Under Service', next: 'Due today' },
  { id: 'AS-3304', name: 'Diode laser', unit: 'aesthetic', branch: 'Bongaon Aesthetic', status: 'In Service', next: '02 Dec 2026' },
  { id: 'AS-3311', name: 'Hydrafacial system', unit: 'aesthetic', branch: 'Howrah Aesthetic', status: 'In Service', next: '20 Nov 2026' },
  { id: 'AS-4402', name: 'Pharmacy cold cabinet', unit: 'pharmacy', branch: 'Kalyani Pharmacy', status: 'In Service', next: '09 Nov 2026' },
  { id: 'AS-1188', name: 'Biochemistry analyzer', unit: 'lab', branch: 'Krishnanagar Lab', status: 'Under Service', next: '04 Nov 2026' },
];

export type Requisition = {
  id: string;
  item: string;
  unit: UnitId;
  branch: string;
  qty: number;
  note: string;
  age: string;
};

export type Issue = {
  id: string;
  title: string;
  unit: UnitId;
  severity: 'High' | 'Medium' | 'Low';
  note: string;
};

export const HELPDESK = {
  label: 'Operations Helpdesk',
  email: 'support@remedium.in',
};
