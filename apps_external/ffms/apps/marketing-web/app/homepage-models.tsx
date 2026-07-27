'use client';

import { appPath } from '@rfms/utils';
import { HomepageModelsContent } from './marketing-pages';

export function HomepageModels({ content }: { content: HomepageModelsContent | null }) {
  if (!content?.is_published) return null;

  const cards = [
    content.fofo,
    content.foco,
  ].filter((card): card is NonNullable<typeof content.fofo> => Boolean(card)).sort((first, second) => (first?.sort_order ?? 0) - (second?.sort_order ?? 0));

  return (
    <section id="models" className="section">
      <h2>{content.heading}</h2>
      <p className="intro">{content.intro}</p>
      <div className="models">
        {cards.map((card) => (
          <article key={card.title}>
            {card.image_url ? <img className="model-card-image" src={card.image_url} alt="" /> : null}
            <div className="model-title"><h3>{card.title}</h3><span>{card.subtitle}</span></div>
            <p>{card.description}</p>
            <ul>{card.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            <a className="model-link" href={appPath(card.button_url)}>{card.button_text}</a>
          </article>
        ))}
      </div>
    </section>
  );
}
