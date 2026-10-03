import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));

const { newsletterBody } = await import('../src/services/newsletter.service.js');

describe('newsletterBody', () => {
  it('trims and lower-cases the email so duplicates collapse', () => {
    expect(newsletterBody.parse({ email: '  Seeker@Example.COM ' })).toEqual({ email: 'seeker@example.com' });
  });

  it('rejects invalid emails and extra fields', () => {
    expect(newsletterBody.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(newsletterBody.safeParse({ email: 'a@b.co', name: 'x' }).success).toBe(false);
  });
});
