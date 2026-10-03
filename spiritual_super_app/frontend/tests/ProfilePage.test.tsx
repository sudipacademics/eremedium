import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProfilePage from '@/app/profile/page';
import { api, session, type Invoice, type UserProfileDetails, type WalletTransaction } from '@/lib/api';

vi.mock('@/lib/socket', () => ({ useSocketEvent: () => undefined }));

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

const profile: UserProfileDetails = {
  userId: 'u1',
  name: 'Ravi Kumar',
  phone: '+919800000001',
  role: 'USER',
  astrologerId: null,
  dob: '1990-05-14T00:00:00.000Z',
  birthPlace: 'Varanasi',
  gotra: null,
  latitude: null,
  longitude: null,
  email: 'ravi@example.com',
  address: null,
  photoDataUrl: null,
  createdAt: '2025-01-10T00:00:00.000Z',
};

const transactions: WalletTransaction[] = [
  { id: 't1', amount: '1100.00', type: 'DEBIT', referenceType: 'PUJA_BOOKING', title: 'E-Puja booking', detail: 'Mahalakshmi Puja', balanceAfter: '900.00', createdAt: '2026-10-01T10:00:00.000Z' },
  { id: 't2', amount: '2000.00', type: 'CREDIT', referenceType: 'RECHARGE', title: 'Wallet top up', detail: 'Razorpay', balanceAfter: '2000.00', createdAt: '2026-09-30T10:00:00.000Z' },
];

const invoices: Invoice[] = [
  { id: 'i1', number: 'INV-0001', kind: 'PUJA', title: 'Mahalakshmi Puja', description: '', amount: '1100.00', currency: 'INR', issuedAt: '2026-10-01T10:00:00.000Z', paymentMethod: 'Wallet' },
];

function mockApi() {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === 'auth/profile') return profile;
    if (path.startsWith('wallet/transactions')) return { balance: '900.00', currency: 'INR', transactions };
    if (path === 'payments/config') return { enabled: true };
    if (path === 'billing/invoices') return { invoices };
    throw new Error(`unexpected ${path}`);
  });
}

describe('profile page', () => {
  beforeEach(() => {
    session.save('jwt', { userId: 'u1', phone: profile.phone, name: profile.name, role: 'USER', astrologerId: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('shows personal details, wallet history with real descriptions, and invoices', async () => {
    mockApi();
    render(<ProfilePage />);
    await flush();

    expect(screen.getByRole('heading', { name: 'Your Profile' })).toBeInTheDocument();
    const details = screen.getByRole('region', { name: 'Personal Details' });
    expect(within(details).getByText('ravi@example.com')).toBeInTheDocument();
    expect(within(details).getByText('Varanasi')).toBeInTheDocument();
    expect(within(details).getAllByText('Not added yet')).toHaveLength(2);

    expect(screen.getByText('Mahalakshmi Puja', { selector: 'span.block.truncate.text-xs' })).toBeInTheDocument();
    expect(screen.getByText('Wallet top up')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add ₹2,000' })).toBeEnabled();

    const invoiceCard = screen.getByRole('region', { name: 'Downloaded Invoices' });
    expect(within(invoiceCard).getByText(/INV-0001/)).toBeInTheDocument();
    expect(within(invoiceCard).getByRole('button', { name: /Download PDF/ })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Account' });
    expect(within(nav).getByRole('link', { name: /Wallet/ })).toHaveAttribute('href', '#wallet');
    expect(within(nav).queryByText('My Services')).toBeNull();
  });

  it('edits and saves the profile', async () => {
    mockApi();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...profile, gotra: 'Kashyap' });
    render(<ProfilePage />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /Edit Profile/ }));
    fireEvent.change(screen.getByLabelText('Gotra'), { target: { value: 'Kashyap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await flush();

    expect(patch).toHaveBeenCalledWith('auth/profile', expect.objectContaining({ gotra: 'Kashyap', email: 'ravi@example.com' }));
    expect(screen.getByText('Profile saved.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Personal Details' })).getByText('Kashyap')).toBeInTheDocument();
  });
});
