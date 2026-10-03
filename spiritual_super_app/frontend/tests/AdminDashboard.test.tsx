import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AdminDashboardPage from '@/app/admin/page';
import type { AdminDashboard, AdminMe } from '@/lib/admin-types';
import { api, session } from '@/lib/api';

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock('next/navigation', () => ({ usePathname: () => '/admin', useRouter: () => router }));

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

const kpi = (total: number, inPeriod: number, changePct: number | null) => ({ total, inPeriod, changePct });

function dashboard(overrides: Partial<AdminDashboard> = {}): AdminDashboard {
  return {
    generatedAt: '2026-10-03T06:00:00.000Z',
    period: 'month',
    periodLabel: 'This Month',
    kpis: {
      users: kpi(1240, 85, 12.5),
      providers: kpi(42, 3, -25),
      joinRequests: { ...kpi(18, 6, null), pending: 4 },
      consultations: kpi(310, 40, 5),
      pujaBookings: kpi(56, 7, 0),
      shopOrders: kpi(88, 9, 50),
      revenue: kpi(892000, 64000, 8.2),
    },
    revenueTrend: {
      range: 'year',
      months: [
        { month: '2026-09', label: 'Sep', consultations: 20000, epuja: 8000, shop: 4000 },
        { month: '2026-10', label: 'Oct', consultations: 30000, epuja: 9000, shop: 5000 },
      ],
    },
    serviceRevenue: {
      total: 892000,
      items: [
        { key: 'consultations', label: 'Consultations', amount: 600000, pct: 67.3 },
        { key: 'epuja', label: 'E-Puja', amount: 292000, pct: 32.7 },
      ],
    },
    userGrowth: [
      { month: '2026-09', label: 'Sep', newUsers: 70, total: 1155 },
      { month: '2026-10', label: 'Oct', newUsers: 85, total: 1240 },
    ],
    pending: { joinRequests: 4, pujaBookings: 2, shopOrders: 0, liveCalls: 1 },
    latestJoinRequests: [
      {
        id: 'jr1',
        applicationNo: 'VS-0001',
        name: 'Ravi Shastri',
        categoryLabel: 'Pandit',
        city: 'Varanasi',
        status: 'PENDING',
        statusLabel: 'Pending',
        createdAt: '2026-10-03T05:00:00.000Z',
      },
    ],
    recentConsultations: [],
    latestOrders: [],
    topLocations: { basis: 10, items: [{ label: 'Delhi', count: 4, pct: 40 }] },
    providersByCategory: [{ category: 'ASTROLOGER', label: 'Astrologer', count: 40 }],
    topServices: [{ label: 'Rudrabhishek', kind: 'E-Puja', count: 12 }],
    recentActivity: [{ kind: 'join', text: 'Ravi Shastri applied as Pandit', at: '2026-10-03T05:00:00.000Z', href: '/admin/join-requests/jr1' }],
    ...overrides,
  };
}

function me(overrides: Partial<AdminMe> = {}): AdminMe {
  return {
    name: 'Anita Rao',
    phone: '+919800000001',
    role: 'SUPER_ADMIN',
    roleLabel: 'Super Admin',
    permissions: [
      'dashboard.view',
      'content.manage',
      'catalog.manage',
      'operations.manage',
      'support.manage',
      'finance.view',
      'providers.manage',
      'joinRequests.manage',
      'staff.manage',
      'audit.view',
    ],
    viaAdminPhones: true,
    badges: { joinRequestsPending: 4 },
    ...overrides,
  };
}

function mockApi(admin: AdminMe, data: AdminDashboard) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === 'admin/me') return admin;
    if (path.startsWith('admin/dashboard')) return data;
    if (path.startsWith('notifications')) return { items: [], unread: 0, nextCursor: null };
    throw new Error(`unexpected ${path}`);
  });
}

describe('admin dashboard', () => {
  beforeEach(() => {
    session.save('jwt', { id: 'u1', phone: '+919800000001', name: 'Anita Rao', role: 'ADMIN', astrologerId: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('renders the welcome banner, KPIs, money panels and the join-request badge for a super admin', async () => {
    const get = mockApi(me(), dashboard());
    render(<AdminDashboardPage />);
    await flush();

    expect(screen.getByRole('heading', { name: /Welcome Back, Anita/ })).toBeInTheDocument();
    const kpis = screen.getByRole('region', { name: 'Key figures' });
    expect(within(kpis).getByText('1,240')).toBeInTheDocument();
    expect(within(kpis).getByText('₹8.92L')).toBeInTheDocument();
    expect(within(kpis).getByText('↓ 25.0%')).toBeInTheDocument();
    expect(screen.getByText('Revenue Overview')).toBeInTheDocument();
    expect(screen.getByText('Service Wise Revenue')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ravi Shastri' })).toHaveAttribute('href', '/admin/join-requests/jr1');
    expect(within(screen.getByRole('link', { name: /Provider Join Requests/ })).getByText('4')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('admin/dashboard?period=month&revenueRange=year&growthMonths=6');
  });

  it('refetches when the period changes', async () => {
    const get = mockApi(me(), dashboard());
    render(<AdminDashboardPage />);
    await flush();

    fireEvent.change(screen.getByLabelText('Dashboard period'), { target: { value: 'year' } });
    await flush();
    expect(get).toHaveBeenCalledWith('admin/dashboard?period=year&revenueRange=year&growthMonths=6');
  });

  it('hides money, customer lists and other teams’ actions from a content manager', async () => {
    mockApi(
      me({ role: 'CONTENT_MANAGER', roleLabel: 'Content Manager', permissions: ['dashboard.view', 'content.manage'] }),
      dashboard({ kpis: { ...dashboard().kpis, revenue: null }, revenueTrend: null, serviceRevenue: null, latestJoinRequests: [] }),
    );
    render(<AdminDashboardPage />);
    await flush();

    expect(screen.queryByText('Total Revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('Revenue Overview')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest Provider Join Requests')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent Consultations')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Publish Blog' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add Provider' })).not.toBeInTheDocument();
  });
});
