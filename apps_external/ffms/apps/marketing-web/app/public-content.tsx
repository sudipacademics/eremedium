'use client';

import { useEffect, useState } from 'react';

type SuccessStory = { id: string; title: string; youtube_embed_url: string; sort_order: number };
type FeaturedFranchisee = { id: string; name: string; location: string; franchise_type: 'FOFO' | 'FOCO'; image_url: string; sort_order: number };

const API_BASE = process.env.NEXT_PUBLIC_RFMS_API_URL ?? 'http://localhost:8080/api/v1';

function Arrow({ direction }: { direction: 'left' | 'right' }) {
  const points = direction === 'left' ? '14 4 6 12 14 20' : '10 4 18 12 10 20';
  return <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points={points} /></svg>;
}

export function PublicContent() {
  const [stories, setStories] = useState<SuccessStory[]>([]);
  const [franchisees, setFranchisees] = useState<FeaturedFranchisee[]>([]);
  const [active, setActive] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [storiesResponse, franchiseesResponse] = await Promise.all([
          fetch(`${API_BASE}/content/success-stories`),
          fetch(`${API_BASE}/content/featured-franchisees`),
        ]);
        const [storiesPayload, franchiseesPayload] = await Promise.all([storiesResponse.json(), franchiseesResponse.json()]);
        if (!mounted) return;
        setStories(storiesResponse.ok && storiesPayload?.success ? storiesPayload.data : []);
        setFranchisees(franchiseesResponse.ok && franchiseesPayload?.success ? franchiseesPayload.data : []);
      } catch {
        if (mounted) { setStories([]); setFranchisees([]); }
      } finally {
        if (mounted) setLoaded(true);
      }
    }
    void load();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (franchisees.length < 2) return;
    const interval = window.setInterval(() => setActive((current) => (current + 1) % franchisees.length), 5000);
    return () => window.clearInterval(interval);
  }, [franchisees.length]);

  function move(direction: -1 | 1) {
    setActive((current) => (current + direction + franchisees.length) % franchisees.length);
  }

  const partner = franchisees[active];

  return <>
    <section className="stories public-stories">
      <h2>Success stories</h2>
      <p>Hear from franchise partners building trusted diagnostics businesses.</p>
      {stories.length ? <div className="story-grid published-story-grid">{stories.map((story) => <article key={story.id}><div className="story-video"><iframe src={story.youtube_embed_url} title={story.title} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div><b>{story.title}</b></article>)}</div> : <div className="public-empty">{loaded ? 'Partner videos will appear here after they are published by the Remedium Lab Admin.' : 'Loading partner videos...'}</div>}
    </section>

    <section className="featured-franchisees" aria-labelledby="franchisee-showcase-title">
      <div className="featured-heading"><div><h2 id="franchisee-showcase-title">Our growing franchise network</h2><p>Meet the active franchise partners building diagnostics access across West Bengal.</p></div>{franchisees.length > 1 ? <div className="slider-controls"><button type="button" onClick={() => move(-1)} aria-label="Previous franchisee"><Arrow direction="left" /></button><button type="button" onClick={() => move(1)} aria-label="Next franchisee"><Arrow direction="right" /></button></div> : null}</div>
      {partner ? <div className="franchisee-slider" aria-live="polite"><article className="franchisee-slide" key={partner.id}><div className="franchisee-image"><img src={partner.image_url} alt={`${partner.name} in ${partner.location}`} /></div><div className="franchisee-copy"><span>{partner.franchise_type} franchisee</span><h3>{partner.name}</h3><p>{partner.location}, West Bengal</p><small>Ongoing Remedium Lab franchise partner</small><div className="slider-dots">{franchisees.map((item, index) => <button type="button" aria-label={`Show ${item.name}`} aria-current={index === active} className={index === active ? 'active' : ''} onClick={() => setActive(index)} key={item.id} />)}</div></div></article></div> : <div className="public-empty feature-empty">{loaded ? 'Featured franchisees will appear here after they are added by the Remedium Lab Admin.' : 'Loading featured franchisees...'}</div>}
    </section>
  </>;
}
