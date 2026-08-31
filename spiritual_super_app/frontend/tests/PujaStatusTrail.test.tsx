import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PujaStatusTrail } from '@/components/PujaStatusTrail';
import type { PujaBooking } from '@/lib/api';

function booking(overrides: Partial<PujaBooking> = {}): PujaBooking {
  return {
    id: 'b1',
    status: 'CONFIRMED',
    pujaName: 'Rudrabhishek',
    packagePrice: '2100.00',
    templeId: 't1',
    templeName: 'Mahakaleshwar',
    templeLocation: 'Ujjain',
    liveStreamUrl: null,
    sankalpName: 'Ananya Sharma',
    sankalpGotra: 'Bharadwaja',
    sankalpWish: null,
    referredByAstrologerId: null,
    scheduledFor: null,
    performedAt: null,
    videoProofUrl: null,
    prasadAwb: null,
    prasadCourier: null,
    prasadDispatchedAt: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('the fulfilment trail', () => {
  it('shows every stage of the journey', () => {
    render(<PujaStatusTrail booking={booking()} />);

    expect(screen.getByText('Booked')).toBeInTheDocument();
    expect(screen.getByText('Being performed')).toBeInTheDocument();
    expect(screen.getByText('Performed')).toBeInTheDocument();
    expect(screen.getByText('Prasad posted')).toBeInTheDocument();
  });

  /**
   * The devotee is hundreds of kilometres from the temple, so this trail is the only evidence they
   * have. Showing proof for a stage that has not happened would be a false claim about their money.
   */
  it('offers no recording before the puja has been performed', () => {
    render(
      <PujaStatusTrail
        booking={booking({ status: 'IN_PROGRESS', videoProofUrl: 'https://proof.example.com/p.mp4' })}
      />,
    );

    expect(screen.queryByText('Watch the recording')).not.toBeInTheDocument();
  });

  it('offers no courier tracking before the prasad has been posted', () => {
    render(<PujaStatusTrail booking={booking({ status: 'COMPLETED', prasadAwb: 'AWB123' })} />);

    expect(screen.queryByText(/AWB123/)).not.toBeInTheDocument();
  });

  it('links the recording once the puja is performed', () => {
    render(
      <PujaStatusTrail
        booking={booking({
          status: 'COMPLETED',
          performedAt: '2026-08-05T04:30:00.000Z',
          videoProofUrl: 'https://proof.example.com/p.mp4',
        })}
      />,
    );

    const link = screen.getByRole('link', { name: 'Watch the recording' });
    expect(link).toHaveAttribute('href', 'https://proof.example.com/p.mp4');
    // Opening a temple's video must not navigate away from an app that may be mid-call.
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows the courier and tracking number once the prasad is posted', () => {
    render(
      <PujaStatusTrail
        booking={booking({
          status: 'PRASAD_DISPATCHED',
          performedAt: '2026-08-05T04:30:00.000Z',
          videoProofUrl: 'https://proof.example.com/p.mp4',
          prasadAwb: 'AWB123456',
          prasadCourier: 'Bluedart',
          prasadDispatchedAt: '2026-08-06T09:00:00.000Z',
        })}
      />,
    );

    expect(screen.getByText(/Bluedart/)).toBeInTheDocument();
    expect(screen.getByText('AWB123456')).toBeInTheDocument();
  });

  it('shows the scheduled date while the booking is still waiting', () => {
    render(<PujaStatusTrail booking={booking({ scheduledFor: '2026-09-15T04:30:00.000Z' })} />);

    expect(screen.getByText(/Scheduled for/)).toBeInTheDocument();
  });
});
