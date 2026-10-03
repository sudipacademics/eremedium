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
    expect(currentSlide()).toHaveTextContent('Aligned with the Stars');
  });

  it('fills the 3D stack with companion cards when fewer than three slides are live', () => {
    render(<HeroSlider slides={[]} promoQuote="Aligned with the Stars" />);
    const cards = screen.getAllByRole('group', { hidden: true });
    expect(cards).toHaveLength(3);
    expect(cards[1]).toHaveTextContent('Natural Remedies for a Healthier You');
    expect(cards[2]).toHaveTextContent('Connect with Divine Energy');
    expect(screen.getByLabelText('Next slide')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Show slide/ })).toHaveLength(3);
  });

  it('uses only the live slides once three or more are published', () => {
    render(<HeroSlider slides={[slide('a', 'One'), slide('b', 'Two'), slide('c', 'Three'), slide('d', 'Four')]} promoQuote="Quote" />);
    expect(screen.getAllByRole('group', { hidden: true })).toHaveLength(4);
    expect(screen.queryByText('Connect with Divine Energy')).not.toBeInTheDocument();
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

  const three = () => [slide('a', 'Connect with *Divine Energy*'), slide('b', 'Aligned with the Stars'), slide('c', 'Natural Remedies')];

  it('keeps the hero heading fixed while the cards change', () => {
    render(<HeroSlider slides={three()} promoQuote="Quote" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Your Life, Guided by Vedic Wisdom');

    fireEvent.click(screen.getByLabelText('Next slide'));
    expect(currentSlide()).toHaveTextContent('Aligned with the Stars');
    expect(screen.getByRole('heading', { level: 1 })).toBe(heading);
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });

  it('stacks the neighbours behind the active card and brings a clicked one to the front', () => {
    render(<HeroSlider slides={three()} promoQuote="Quote" />);
    const cards = screen.getAllByRole('group', { hidden: true });
    const z = (el: HTMLElement) => Number(el.style.zIndex);
    expect(z(cards[0]!)).toBeGreaterThan(z(cards[1]!));
    expect(z(cards[1]!)).toBe(z(cards[2]!));
    expect(cards[2]!.style.transform).toContain('rotateY(18deg)');
    expect(cards[1]!.style.transform).toContain('rotateY(-18deg)');

    fireEvent.click(cards[2]!);
    expect(currentSlide()).toHaveTextContent('Natural Remedies');
  });

  it('moves with the keyboard arrows and with a horizontal swipe, ignoring vertical scrolls', () => {
    render(<HeroSlider slides={three()} promoQuote="Quote" />);
    const next = screen.getByLabelText('Next slide');
    fireEvent.keyDown(next, { key: 'ArrowLeft' });
    expect(currentSlide()).toHaveTextContent('Natural Remedies');
    fireEvent.keyDown(next, { key: 'ArrowRight' });
    expect(currentSlide()).toHaveTextContent('Connect with Divine Energy');

    const stage = currentSlide().parentElement!;
    fireEvent.pointerDown(stage, { clientX: 300, clientY: 100 });
    fireEvent.pointerUp(stage, { clientX: 200, clientY: 110 });
    expect(currentSlide()).toHaveTextContent('Aligned with the Stars');

    fireEvent.pointerDown(stage, { clientX: 200, clientY: 100 });
    fireEvent.pointerUp(stage, { clientX: 150, clientY: 260 });
    expect(currentSlide()).toHaveTextContent('Aligned with the Stars');
  });
});
