import { describe, expect, it } from 'vitest';

import { ADMIN_NAV, navItemForPath, searchNav, visibleNav } from '@/lib/admin-nav';

describe('admin navigation', () => {
  it('shows a content manager only the dashboard, content and website pages', () => {
    const groups = visibleNav(['dashboard.view', 'content.manage']);
    expect(groups.map((group) => group.label)).toEqual([null, 'Content & Resources', 'Website']);
    expect(groups[1]!.items.map((item) => item.label)).toEqual(['Blogs', 'Numerology']);
  });

  it('searches only pages the role can open', () => {
    expect(searchNav('orders', ['operations.manage']).map((item) => item.href)).toEqual(['/admin/ayurveda-orders']);
    expect(searchNav('orders', ['content.manage'])).toEqual([]);
    expect(searchNav('join req', ['joinRequests.manage']).map((item) => item.label)).toEqual(['Provider Join Requests']);
    expect(searchNav('  ', ['joinRequests.manage'])).toEqual([]);
  });

  it('gives customer history to support and finance alike', () => {
    for (const permission of ['support.manage', 'finance.view']) {
      const hrefs = visibleNav([permission]).flatMap((group) => group.items.map((item) => item.href));
      expect(hrefs).toContain('/admin/history');
    }
  });

  it('shows everything when every permission is granted', () => {
    const all = [...new Set(ADMIN_NAV.flatMap((group) => group.items.flatMap((item) => item.permissions)))];
    expect(visibleNav(all)).toHaveLength(ADMIN_NAV.length);
  });

  it('maps nested paths to the owning page by longest prefix', () => {
    expect(navItemForPath('/admin')?.label).toBe('Dashboard');
    expect(navItemForPath('/admin/join-requests/abc')?.label).toBe('Provider Join Requests');
    expect(navItemForPath('/admin/nope')).toBeNull();
  });
});
