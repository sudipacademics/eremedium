'use client';

import { useEffect, useState } from 'react';
import { RFMS_API_BASE, RFMS_PORTAL_ORIGIN, appPath, clampHeroSlideText, HERO_SLIDE_DESCRIPTION_MAX, HERO_SLIDE_TITLE_MAX } from '@rfms/utils';

type HeroSlide = {
  id: string;
  title: string;
  description: string;
  primary_button_text: string;
  primary_button_url: string;
  secondary_button_text: string;
  secondary_button_url: string;
  image_url: string;
  sort_order: number;
};

const API_BASE = RFMS_API_BASE;

function defaultSlide(companyName: string): HeroSlide {
  return {
    id: 'default-hero-slide',
    title: 'Build a trusted diagnostics business in your community.',
    description: `Bring reliable diagnostics closer to patients with structured operations, quality systems and ongoing support from ${companyName}.`,
    primary_button_text: 'Apply for franchisee', primary_button_url: RFMS_PORTAL_ORIGIN,
    secondary_button_text: 'Check territory availability →', secondary_button_url: appPath('/#territory'), image_url: '', sort_order: 0,
  };
}

function applicationLink(url: string) {
  const value = String(url ?? '').trim();
  if (!value || value === '/#apply' || value === '#apply') return RFMS_PORTAL_ORIGIN;
  if (value === '/onboard' || value === '/onboard/') return RFMS_PORTAL_ORIGIN;
  return appPath(value);
}

function Arrow({ direction }: { direction: 'left' | 'right' }) {
  const points = direction === 'left' ? '14 4 6 12 14 20' : '10 4 18 12 10 20';
  return <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points={points} /></svg>;
}

export function HeroSlider({ companyName }: { companyName: string }) {
  const [slides, setSlides] = useState<HeroSlide[]>(() => [defaultSlide(companyName)]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let mounted = true;
    void fetch(`${API_BASE}/content/hero-slides`)
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (!mounted || !response.ok || !payload?.success || !Array.isArray(payload.data) || !payload.data.length) return;
        setSlides(payload.data); setActive(0);
      })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % slides.length), 6000);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  const slide = slides[active] ?? slides[0];
  const title = clampHeroSlideText(slide.title, HERO_SLIDE_TITLE_MAX);
  const description = clampHeroSlideText(slide.description, HERO_SLIDE_DESCRIPTION_MAX);
  const move = (direction: -1 | 1) => setActive((current) => (current + direction + slides.length) % slides.length);

  return <section id="top" className="hero hero-slider" aria-label="Franchise opportunities">
    <div className="hero-slide-copy" aria-live="polite">
      <h1 title={slide.title}>{title}</h1><p title={slide.description}>{description}</p>
      <div className="hero-actions">
        <a className="primary" href={applicationLink(slide.primary_button_url)}>{slide.primary_button_text}</a>
        {slide.secondary_button_text && slide.secondary_button_url ? <a className="text-link" href={applicationLink(slide.secondary_button_url)}>{slide.secondary_button_text}</a> : null}
      </div>
    </div>
    <div className="hero-slider-visual">
      {slide.image_url ? <img className="hero-slide-image" src={slide.image_url} alt="" /> : <div className="hero-visual hero-default-visual"><div className="lab-sign">REMEDIUM <em>LAB</em><small>DIAGNOSTICS COLLECTION CENTRE</small></div><div className="owner">RL<div>Trusted local diagnostics<br /><b>for every neighbourhood.</b></div></div></div>}
      {slides.length > 1 ? <div className="hero-slider-controls"><button type="button" aria-label="Previous hero slide" onClick={() => move(-1)}><Arrow direction="left" /></button><div className="hero-slider-dots">{slides.map((item, index) => <button type="button" aria-label={`Show slide ${index + 1}: ${item.title}`} aria-current={index === active} className={index === active ? 'active' : ''} onClick={() => setActive(index)} key={item.id} />)}</div><button type="button" aria-label="Next hero slide" onClick={() => move(1)}><Arrow direction="right" /></button></div> : null}
    </div>
  </section>;
}
