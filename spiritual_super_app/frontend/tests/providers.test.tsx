import { describe, expect, it } from 'vitest';

import { filterProviders, inTab, platformCommissionPct, providersCsv, tabCounts, todayIst, type ProviderItem } from '@/lib/providers';

function provider(overrides: Partial<ProviderItem>): ProviderItem {
  return {
    id: 'a',
    code: 'VDP000001',
    displayName: 'Pt. Raghav Sharma',
    photoVersion: null,
    category: 'ASTROLOGER',
    categoryLabel: 'Astrologer',
    presence: 'IDLE',
    accountStatus: 'ACTIVE',
    suspendedAt: null,
    suspensionReason: null,
    deboardReason: null,
    deboardEffectiveAt: null,
    kycStatus: 'VERIFIED',
    identityVerified: true,
    profileApproved: true,
    languages: ['Hindi', 'English'],
    expertise: ['Vedic', 'Kundali'],
    services: [],
    experienceYears: 12,
    perMinuteRate: '25.00',
    commissionSplit: '0.7000',
    rating: null,
    ratingCount: 0,
    sessions: 0,
    totalEarnings: '0.00',
    monthEarnings: '0.00',
    grossRevenue: '0.00',
    pendingPayout: '0.00',
    availableDays: [],
    phone: '+919812345678',
    email: null,
    location: null,
    joinRequest: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const items = [
  provider({ id: '1' }),
  provider({ id: '2', displayName: 'Acharya Meera', presence: 'OFFLINE', category: 'NUMEROLOGIST', categoryLabel: 'Numerologist', languages: ['Tamil'], expertise: ['Name Numerology'], kycStatus: 'PENDING' }),
  provider({ id: '3', displayName: 'Guru Dev', accountStatus: 'SUSPENDED', presence: 'OFFLINE' }),
  provider({ id: '4', displayName: 'Swami Anand', accountStatus: 'DEBOARDING' }),
  provider({ id: '5', displayName: 'Pandit Old', accountStatus: 'DEBOARDED', presence: 'OFFLINE', kycStatus: 'PENDING' }),
];

describe('provider tabs', () => {
  it('counts each tab from account status, presence and KYC', () => {
    expect(tabCounts(items)).toEqual({ all: 5, online: 2, offline: 1, pending: 1, suspended: 1, deboarding: 2 });
  });

  it('never shows suspended providers as online', () => {
    expect(inTab(provider({ accountStatus: 'SUSPENDED', presence: 'IDLE' }), 'online')).toBe(false);
  });
});

describe('provider filters', () => {
  it('searches name, expertise, ID and phone digits', () => {
    expect(filterProviders(items, { search: 'meera', category: '', status: '', language: '' }).map((p) => p.id)).toEqual(['2']);
    expect(filterProviders(items, { search: 'kundali', category: '', status: '', language: '' })).toHaveLength(4);
    expect(filterProviders(items, { search: '98123', category: '', status: '', language: '' })).toHaveLength(5);
  });

  it('combines category, language and status filters', () => {
    expect(filterProviders(items, { search: '', category: 'NUMEROLOGIST', status: '', language: '' }).map((p) => p.id)).toEqual(['2']);
    expect(filterProviders(items, { search: '', category: '', status: '', language: 'tamil' }).map((p) => p.id)).toEqual(['2']);
    expect(filterProviders(items, { search: '', category: '', status: 'kyc:PENDING', language: '' }).map((p) => p.id)).toEqual(['2', '5']);
    expect(filterProviders(items, { search: '', category: '', status: 'online', language: '' }).map((p) => p.id)).toEqual(['1', '4']);
  });
});

describe('formatting', () => {
  it('shows the platform side of the stored provider share', () => {
    expect(platformCommissionPct('0.7000')).toBe(30);
    expect(platformCommissionPct('0.5')).toBe(50);
  });

  it('escapes CSV cells', () => {
    const csv = providersCsv([provider({ displayName: 'Sharma, "Guruji"' })]);
    expect(csv.split('\n')[1]).toContain('"Sharma, ""Guruji"""');
  });

  it('uses the Indian calendar day', () => {
    expect(todayIst(new Date('2026-10-03T19:00:00Z'))).toBe('2026-10-04');
  });
});
