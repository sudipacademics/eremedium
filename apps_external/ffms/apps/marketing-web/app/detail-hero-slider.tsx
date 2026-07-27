'use client';

import { useEffect, useMemo, useState } from 'react';
import { ModelPageContent } from './marketing-pages';

type HeroSlide = ModelPageContent['hero']['slides'][number];

function Arrow({ direction }: { direction: 'left' | 'right' }) {
  const points = direction === 'left' ? '14 4 6 12 14 20' : '10 4 18 12 10 20';
  return <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points={points} /></svg>;
}

export function DetailHeroSlider({ slides }: { slides: HeroSlide[] }) {
  const visibleSlides = useMemo(
    () => slides.filter((slide) => slide.is_published !== false && slide.image_url).sort((first, second) => first.sort_order - second.sort_order),
    [slides],
  );
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(0);
  }, [visibleSlides.length]);

  useEffect(() => {
    if (visibleSlides.length < 2) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % visibleSlides.length), 6000);
    return () => window.clearInterval(timer);
  }, [visibleSlides.length]);

  if (!visibleSlides.length) {
    return <div className="centre">REMEDIUM <em>LAB</em><small>DIAGNOSTICS COLLECTION CENTRE</small></div>;
  }

  const slide = visibleSlides[active] ?? visibleSlides[0];
  const move = (direction: -1 | 1) => setActive((current) => (current + direction + visibleSlides.length) % visibleSlides.length);

  return <div className="detail-hero-slider" aria-label="Franchise hero images">
    <img className="detail-hero-slide-image" src={slide.image_url} alt={slide.alt || ''} />
    {visibleSlides.length > 1 ? <div className="detail-hero-slider-controls">
      <button type="button" aria-label="Previous hero image" onClick={() => move(-1)}><Arrow direction="left" /></button>
      <div className="detail-hero-slider-dots">
        {visibleSlides.map((item, index) => (
          <button
            type="button"
            key={item.id}
            aria-label={`Show hero image ${index + 1}`}
            aria-current={index === active}
            className={index === active ? 'active' : ''}
            onClick={() => setActive(index)}
          />
        ))}
      </div>
      <button type="button" aria-label="Next hero image" onClick={() => move(1)}><Arrow direction="right" /></button>
    </div> : null}
  </div>;
}
