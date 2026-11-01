import { REMEDIUM_BRAND } from './brandSchema';

export type BlogFaqPair = { question: string; answer: string };

/** Parse embedded FAQ accordion from blog HTML seed content. */
export function extractBlogFaqsFromHtml(html: string): BlogFaqPair[] {
  if (typeof DOMParser === 'undefined' || !html) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('details.lab-faq-item'))
    .map((el) => {
      const question = el.querySelector('summary')?.textContent?.trim() || '';
      const answer = el.querySelector('.lab-faq-answer')?.textContent?.trim() || '';
      return { question, answer };
    })
    .filter((row) => row.question && row.answer);
}

type BlogSchemaInput = {
  title: string;
  description: string;
  slug: string;
  canonicalUrl: string;
  publishedOn?: string;
  authorName?: string;
  imageUrl?: string;
  faqs?: BlogFaqPair[];
};

/** Article/BlogPosting + BreadcrumbList + optional FAQPage for blog posts. */
export function buildBlogPostSchema(input: BlogSchemaInput) {
  const base = REMEDIUM_BRAND.siteUrl.replace(/\/+$/, '');
  const pageUrl = input.canonicalUrl || `${base}/blog/${input.slug}`;
  const orgId = `${base}/#organization`;

  const graph: Record<string, unknown>[] = [
    {
      '@type': 'BreadcrumbList',
      '@id': `${pageUrl}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${base}/` },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${base}/blog` },
        { '@type': 'ListItem', position: 3, name: input.title, item: pageUrl },
      ],
    },
    {
      '@type': 'BlogPosting',
      '@id': `${pageUrl}#article`,
      headline: input.title,
      description: input.description,
      url: pageUrl,
      mainEntityOfPage: pageUrl,
      datePublished: input.publishedOn,
      dateModified: input.publishedOn,
      author: {
        '@type': 'Organization',
        name: input.authorName || 'Remedium Editorial Team',
      },
      publisher: { '@id': orgId },
      image: input.imageUrl || REMEDIUM_BRAND.logoUrl,
      inLanguage: 'en-IN',
      isAccessibleForFree: true,
    },
  ];

  const faqs = input.faqs || [];
  if (faqs.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${pageUrl}#faq`,
      mainEntity: faqs.map((row) => ({
        '@type': 'Question',
        name: row.question,
        acceptedAnswer: { '@type': 'Answer', text: row.answer },
      })),
    });
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}
