import { createHash, randomUUID } from 'node:crypto';

import { prisma } from '../lib/prisma.js';
import {
  assertSafeImageUrl,
  assertSafeInternalHref,
  ContentError,
  slugify,
} from './content-security.js';

export { ContentError, assertSafeImageUrl, assertSafeInternalHref } from './content-security.js';

export interface SiteContentView {
  readonly heroEyebrow: string;
  readonly heroTitle: string;
  readonly heroSubtitle: string;
  readonly heroImageUrl: string | null;
  readonly promoQuote: string | null;
  readonly updatedAt: string;
}

export interface ArticleListItem {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly coverUrl: string | null;
  readonly ctaHref: string | null;
  readonly published: boolean;
  readonly featured: boolean;
  readonly publishedAt: string | null;
}

export interface ArticleView extends ArticleListItem {
  readonly body: string;
  readonly updatedAt: string;
}

export interface SiteContentInput {
  readonly heroEyebrow: string;
  readonly heroTitle: string;
  readonly heroSubtitle: string;
  readonly heroImageUrl?: string | null;
  readonly promoQuote?: string | null;
}

export interface ArticleInput {
  readonly slug?: string;
  readonly title: string;
  readonly excerpt: string;
  readonly body: string;
  readonly coverUrl?: string | null;
  readonly ctaHref?: string | null;
  readonly published?: boolean;
  readonly featured?: boolean;
}

function mapSite(row: {
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  heroImageUrl: string | null;
  promoQuote: string | null;
  updatedAt: Date;
}): SiteContentView {
  return {
    heroEyebrow: row.heroEyebrow,
    heroTitle: row.heroTitle,
    heroSubtitle: row.heroSubtitle,
    heroImageUrl: row.heroImageUrl,
    promoQuote: row.promoQuote,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapArticleList(row: {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverUrl: string | null;
  ctaHref: string | null;
  published: boolean;
  featured: boolean;
  publishedAt: Date | null;
}): ArticleListItem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    coverUrl: row.coverUrl,
    ctaHref: row.ctaHref,
    published: row.published,
    featured: row.featured,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

export const ContentService = {
  async getHome(): Promise<SiteContentView> {
    const row = await prisma.siteContent.findUnique({ where: { id: 'default' } });
    if (!row) {
      throw new ContentError('Homepage content is not seeded', 503);
    }
    return mapSite(row);
  },

  async updateHome(input: SiteContentInput, adminUserId: string): Promise<SiteContentView> {
    const data = {
      heroEyebrow: input.heroEyebrow.trim(),
      heroTitle: input.heroTitle.trim(),
      heroSubtitle: input.heroSubtitle.trim(),
      heroImageUrl: assertSafeImageUrl(input.heroImageUrl),
      promoQuote: input.promoQuote?.trim() ? input.promoQuote.trim().slice(0, 200) : null,
      updatedBy: adminUserId,
    };
    const row = await prisma.siteContent.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });
    return mapSite(row);
  },

  async listArticles(options: {
    readonly publishedOnly: boolean;
    readonly featuredOnly?: boolean;
  }): Promise<ArticleListItem[]> {
    const rows = await prisma.article.findMany({
      where: {
        ...(options.publishedOnly ? { published: true } : {}),
        ...(options.featuredOnly ? { featured: true } : {}),
      },
      orderBy: [{ featured: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return rows.map(mapArticleList);
  },

  async getArticleBySlug(slug: string, publishedOnly: boolean): Promise<ArticleView> {
    const row = await prisma.article.findUnique({ where: { slug } });
    if (!row || (publishedOnly && !row.published)) {
      throw new ContentError('Article not found', 404);
    }
    return {
      ...mapArticleList(row),
      body: row.body,
      updatedAt: row.updatedAt.toISOString(),
    };
  },

  async createArticle(input: ArticleInput, adminUserId: string): Promise<ArticleView> {
    const slug = slugify(input.slug || input.title);
    if (slug.length < 2) {
      throw new ContentError('Slug is required');
    }
    const published = input.published === true;
    try {
      const row = await prisma.article.create({
        data: {
          id: randomUUID(),
          slug,
          title: input.title.trim(),
          excerpt: input.excerpt.trim(),
          body: input.body.trim(),
          coverUrl: assertSafeImageUrl(input.coverUrl),
          ctaHref: assertSafeInternalHref(input.ctaHref),
          published,
          featured: input.featured === true,
          publishedAt: published ? new Date() : null,
          updatedBy: adminUserId,
        },
      });
      return {
        ...mapArticleList(row),
        body: row.body,
        updatedAt: row.updatedAt.toISOString(),
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new ContentError('An article with this slug already exists', 409);
      }
      throw error;
    }
  },

  async updateArticle(
    id: string,
    input: Partial<ArticleInput>,
    adminUserId: string,
  ): Promise<ArticleView> {
    const existing = await prisma.article.findUnique({ where: { id } });
    if (!existing) {
      throw new ContentError('Article not found', 404);
    }

    const published = input.published ?? existing.published;
    const data = {
      ...(input.slug !== undefined ? { slug: slugify(input.slug) } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.excerpt !== undefined ? { excerpt: input.excerpt.trim() } : {}),
      ...(input.body !== undefined ? { body: input.body.trim() } : {}),
      ...(input.coverUrl !== undefined ? { coverUrl: assertSafeImageUrl(input.coverUrl) } : {}),
      ...(input.ctaHref !== undefined ? { ctaHref: assertSafeInternalHref(input.ctaHref) } : {}),
      ...(input.featured !== undefined ? { featured: input.featured } : {}),
      published,
      publishedAt:
        published && !existing.publishedAt
          ? new Date()
          : published
            ? existing.publishedAt
            : null,
      updatedBy: adminUserId,
    };

    try {
      const row = await prisma.article.update({ where: { id }, data });
      return {
        ...mapArticleList(row),
        body: row.body,
        updatedAt: row.updatedAt.toISOString(),
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new ContentError('An article with this slug already exists', 409);
      }
      throw error;
    }
  },

  async deleteArticle(id: string): Promise<void> {
    try {
      await prisma.article.delete({ where: { id } });
    } catch {
      throw new ContentError('Article not found', 404);
    }
  },

  etagFor(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
  },
};
