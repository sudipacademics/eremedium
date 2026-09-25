import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeroSlider } from '@/components/home/HeroSlider';
import type { HeroSlide } from '@/lib/api';

const slide = (id: string, title: string, extra: Partial<HeroSlide> = {}): HeroSlide => ({
  id,
  eyebrow: null,
  title,
  description: null,
  imageUrl: '/brand/vedsutra-hero-mandala.png',
  imageVersion: null,
  ctaText: null,
  ctaHref: null,
  ...extra,
});

function currentSlide(): HTMLElement {
  return screen.getAllByRole('group', { hidden: true }).find((el) => el.getAttribute('aria-hidden') === 'false')!;
}

describe('HeroSlider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('falls back to the default Vedsutra slide when the backend has none', () => {
    render(<HeroSlider slides={[]} promoQuote="Aligned with the Stars" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Your Life, Guided by Vedic Wisdom');
    expect(heading.querySelector('.text-ved-gold-500')).toHaveTextContent('Vedic Wisdom');
    expect(screen.getByText('Aligned with the Stars')).toBeInTheDocument();
    expect(screen.queryByLabelText('Next slide')).not.toBeInTheDocument();
  });

  it('shows the CTA and rotates through live slides, pausing on hover', () => {
    const slides = [
      slide('a', 'First *slide*', { ctaText: 'Book a Puja', ctaHref: '/pujas' }),
      slide('b', 'Second slide'),
    ];
    render(<HeroSlider slides={slides} promoQuote="Quote" />);
    expect(currentSlide()).toHaveTextContent('First slide');
    expect(screen.getByRole('link', { name: /Book a Puja/ })).toHaveAttribute('href', '/pujas');

    act(() => void vi.advanceTimersByTime(6000));
    expect(currentSlide()).toHaveTextContent('Second slide');

    fireEvent.mouseEnter(screen.getByRole('region', { name: 'Featured' }));
    act(() => void vi.advanceTimersByTime(12000));
    expect(currentSlide()).toHaveTextContent('Second slide');

    fireEvent.click(screen.getByLabelText('Show slide 1'));
    expect(currentSlide()).toHaveTextContent('First slide');
  });
});
