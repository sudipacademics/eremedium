'use client';

import { ReactElement, ReactNode, useEffect, useMemo, useState } from 'react';
import { RFMS_PORTAL_ORIGIN, appPath } from '@rfms/utils';
import { useCompanyProfile } from './company-profile';
import { ModelPageContent, useMarketingPages, youtubePreviewUrl } from './marketing-pages';
import { SiteFooter } from './site-footer';
import { SiteNav } from './site-nav';
import { DetailHeroSlider } from './detail-hero-slider';
import { AvailableTerritorySection } from './available-territories';
import './franchise-detail.css';
import './company-profile.css';
import './site.css';

function applyHref(url: string, model: 'FOFO' | 'FOCO') {
  const value = url.trim();
  if (!value || value === '/#apply' || value === '#apply') return `${RFMS_PORTAL_ORIGIN}?model=${model}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value === '/onboard' || value === '/onboard/') return `${RFMS_PORTAL_ORIGIN}?model=${model}`;
  return value.startsWith('/') ? appPath(value) : `${RFMS_PORTAL_ORIGIN}?model=${model}`;
}

function RichParagraphs({ text }: { text: string }) {
  return <>
    {text.split(/\n{2,}/).filter(Boolean).map((paragraph) => <p key={paragraph.slice(0, 40)}>{paragraph}</p>)}
  </>;
}

function usePageSeo(seo?: { title: string; description: string; keywords: string }) {
  useEffect(() => {
    if (!seo?.title) return;
    document.title = seo.title;
    const description = document.querySelector('meta[name="description"]') ?? Object.assign(document.createElement('meta'), { name: 'description' });
    if (!description.parentElement) document.head.appendChild(description);
    description.setAttribute('content', seo.description);
    const keywords = document.querySelector('meta[name="keywords"]') ?? Object.assign(document.createElement('meta'), { name: 'keywords' });
    if (!keywords.parentElement) document.head.appendChild(keywords);
    keywords.setAttribute('content', seo.keywords);
  }, [seo]);
}

function parseCalculatorNumber(raw: string) {
  const value = raw.trim();
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Keep the field editable (allow empty) and avoid a sticky leading 0 while typing. */
function calculatorInputValue(raw: string) {
  if (raw === '') return '';
  if (!/^\d*\.?\d*$/.test(raw)) return raw;
  if (raw.includes('.')) return raw.replace(/^0+(?=\d)/, '') || '0';
  return raw.replace(/^0+(?=\d)/, '') || (raw === '0' ? '0' : '');
}

function ModelPageSections({ model, page }: { model: 'FOFO' | 'FOCO'; page: ModelPageContent }) {
  const [samples, setSamples] = useState('800');
  const [avg, setAvg] = useState('600');
  const [fofoUnits, setFofoUnits] = useState('');
  const samplesN = useMemo(() => parseCalculatorNumber(samples), [samples]);
  const avgN = useMemo(() => parseCalculatorNumber(avg), [avg]);
  const fofoUnitsN = useMemo(() => Math.floor(parseCalculatorNumber(fofoUnits)), [fofoUnits]);
  const revenue = useMemo(() => samplesN * avgN, [samplesN, avgN]);
  const baseProfit = revenue * 0.30;
  const fofoUplift = revenue * 0.20 * fofoUnitsN;
  const profit = model === 'FOFO' ? baseProfit : baseProfit + fofoUplift;
  const format = (value: number) => `INR ${Math.round(value).toLocaleString('en-IN')}`;
  const storyEmbed = youtubePreviewUrl(page.success_story.youtube_embed_code || page.success_story.youtube_embed_url);

  const blocks = [
    page.calculator.is_published ? {
      sort: page.calculator.sort_order,
      key: 'calculator',
      node: <article key="calculator">
        <h2>{page.calculator.title}</h2>
        <label>Estimated monthly samples<input type="number" min="0" inputMode="numeric" value={samples} onChange={(event) => setSamples(calculatorInputValue(event.target.value))} /></label>
        <label>Average test value (INR)<input type="number" min="0" inputMode="numeric" value={avg} onChange={(event) => setAvg(calculatorInputValue(event.target.value))} /></label>
        {model === 'FOCO' ? <label>FOFO units under your unit<input type="number" min="0" inputMode="numeric" placeholder="0" value={fofoUnits} onChange={(event) => setFofoUnits(calculatorInputValue(event.target.value))} /></label> : null}
        <div className="estimate"><span>Estimated monthly revenue <b>{format(revenue)}</b></span><span>Base profit (30% revenue) <b>{format(baseProfit)}</b></span>{model === 'FOCO' ? <span>FOFO uplift ({fofoUnitsN} x 20% revenue) <b>{format(fofoUplift)}</b></span> : null}<span>Estimated monthly profit <b>{format(profit)}</b></span><small>{page.calculator.note}</small></div>
      </article>,
    } : null,
    page.success_story.is_published ? {
      sort: page.success_story.sort_order,
      key: 'success_story',
      node: <article key="success_story">
        <h2>{page.success_story.title}</h2>
        {storyEmbed ? <div className="video"><iframe src={storyEmbed} title={`${model} success story`} allowFullScreen /></div> : page.success_story.image_url ? <img className="detail-section-image" src={page.success_story.image_url} alt="" /> : <div className="video">{page.success_story.subtitle}</div>}
        <h3>{page.success_story.subtitle}</h3>
        <RichParagraphs text={page.success_story.body} />
      </article>,
    } : null,
    page.territory.is_published ? {
      sort: page.territory.sort_order,
      key: 'territory',
      node: <article className="territory-card territory-opportunity-panel" key="territory">
        <AvailableTerritorySection
          model={model}
          title={page.territory.title}
          subtitle={page.territory.subtitle}
          footerNote={page.territory.description}
        />
      </article>,
    } : null,
    page.investment.is_published && page.investment.items.length ? {
      sort: page.investment.sort_order,
      key: 'investment',
      node: <article key="investment">
        <h2>{page.investment.title}</h2>
        <ul className="detail-list">{page.investment.items.map((item) => <li key={item.id}><b>{item.label}</b><span>{item.value}</span><p>{item.description}</p></li>)}</ul>
      </article>,
    } : null,
    page.benefits.is_published && page.benefits.items.length ? {
      sort: page.benefits.sort_order,
      key: 'benefits',
      node: <article key="benefits">
        <h2>{page.benefits.title}</h2>
        <ul className="detail-list">{page.benefits.items.map((item) => <li key={item.id}><b>{item.title}</b><p>{item.description}</p></li>)}</ul>
      </article>,
    } : null,
    page.features.is_published && page.features.items.length ? {
      sort: page.features.sort_order,
      key: 'features',
      node: <article key="features">
        <h2>{page.features.title}</h2>
        <ul className="detail-list">{page.features.items.map((item) => <li key={item.id}><b>{item.title}</b><p>{item.description}</p></li>)}</ul>
      </article>,
    } : null,
    page.faqs.is_published && page.faqs.items.length ? {
      sort: page.faqs.sort_order,
      key: 'faqs',
      node: <article key="faqs">
        <h2>{page.faqs.title}</h2>
        <div className="detail-faq">{page.faqs.items.map((item) => <details key={item.id}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>
      </article>,
    } : null,
    page.support_timeline.is_published ? {
      sort: page.support_timeline.sort_order,
      key: 'support_timeline',
      node: <section className="support-line" key="support_timeline"><h2>{page.support_timeline.title}</h2>{page.support_timeline.steps.map((item, index) => <span key={item.id}><b>{index + 1}</b>{item.title}</span>)}</section>,
    } : null,
    page.cta.is_published ? {
      sort: page.cta.sort_order,
      key: 'cta',
      node: <section className="detail-cta" key="cta"><div><h2>{page.cta.title}</h2><p>{page.cta.description}</p><a className="apply" href={applyHref(page.cta.button_url, model)}>{page.cta.button_text}</a></div></section>,
    } : null,
  ].filter((block): block is { sort: number; key: string; node: ReactElement } => Boolean(block)).sort((first, second) => first.sort - second.sort);

  const output: ReactNode[] = [];
  let gridArticles: ReactNode[] = [];
  blocks.forEach((block) => {
    if (block.key === 'support_timeline' || block.key === 'cta') {
      if (gridArticles.length) {
        output.push(<section className="detail-grid" key={`grid-${output.length}`}>{gridArticles}</section>);
        gridArticles = [];
      }
      output.push(block.node);
      return;
    }
    gridArticles.push(block.node);
  });
  if (gridArticles.length) output.push(<section className="detail-grid" key={`grid-${output.length}`}>{gridArticles}</section>);

  return <>{output}</>;
}

export function FranchiseDetail({ model }: { model: 'FOFO' | 'FOCO' }) {
  const company = useCompanyProfile();
  const marketing = useMarketingPages();
  const page = model === 'FOFO' ? marketing?.fofo_page : marketing?.foco_page;
  const applyHrefValue = applyHref(page?.hero.cta_url ?? '', model);
  usePageSeo(page?.seo);

  if (!page?.is_published) {
    return <main id="top" className="detail"><SiteNav variant="detail" showLogin={false} applyHref={applyHrefValue} /><section className="detail-hero"><div><h1>{model} Franchise Opportunity</h1><p>This page is currently unavailable. Please check back soon.</p></div></section><SiteFooter company={company} /></main>;
  }

  return <main id="top" className="detail">
    <SiteNav variant="detail" showLogin={false} applyHref={applyHrefValue} />
    <section className="detail-hero">
      <div className="detail-hero-visual">
        <DetailHeroSlider slides={page.hero.slides?.length ? page.hero.slides : page.hero.banner_image_url ? [{ id: 'legacy-banner', image_url: page.hero.banner_image_url, alt: '', sort_order: 1, is_published: true }] : []} />
      </div>
      <div className="detail-hero-copy">
        <h1>{page.hero.title}</h1>
        <p><strong>{page.hero.subtitle}</strong> {page.hero.description}</p>
        <a className="apply" href={applyHrefValue}>{page.hero.cta_text}</a>
      </div>
    </section>
    <ModelPageSections model={model} page={page} />
    <SiteFooter company={company} />
  </main>;
}
