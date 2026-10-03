import { describe, expect, it } from 'vitest';

import { ADMIN_NAV, navItemForPath, visibleNav } from '@/lib/admin-nav';

describe('admin navigation', () => {
  it('shows a content manager only the dashboard and content pages', () => {
    const groups = visibleNav(['dashboard.view', 'content.manage']);
    expect(groups.map((group) => group.label)).toEqual(['Overview', 'Content']);
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
