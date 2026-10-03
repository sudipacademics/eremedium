import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { JoinUsBanner } from '@/components/home/JoinUsBanner';

describe('JoinUsBanner', () => {
  it('invites experts and links to the expert application', () => {
    render(<JoinUsBanner />);

    expect(screen.getByRole('heading', { level: 2, name: 'Join Us' })).toBeInTheDocument();
    expect(screen.getByText('Share Vedic Wisdom. Create a Brighter Tomorrow.')).toBeInTheDocument();
    for (const benefit of [
      'Connect with Thousands of Seekers',
      'Flexible Work Options',
      'Earn with Your Expertise',
      'Trusted & Secure Platform',
    ]) {
      expect(screen.getByText(benefit)).toBeInTheDocument();
    }
    const roles = within(screen.getByRole('list', { name: 'Roles we are hiring for' }));
    expect(roles.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('link', { name: /Join as an Expert/ })).toHaveAttribute('href', '/join');
  });
});
