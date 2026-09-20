import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole } from '../auth/jwt.js';
import { authenticate, requireRole, requireUser } from '../plugins/authenticate.js';
import { ContentService, type ArticleInput, type SiteContentInput } from '../services/content.service.js';

const siteBody = z.object({
  heroEyebrow: z.string().min(2).max(120),
  heroTitle: z.string().min(2).max(200),
  heroSubtitle: z.string().min(2).max(500),
  heroImageUrl: z.string().max(500).nullable().optional(),
  promoQuote: z.string().max(200).nullable().optional(),
});

const articleBody = z.object({
  slug: z.string().min(2).max(120).optional(),
  title: z.string().min(2).max(200),
  excerpt: z.string().min(2).max(500),
  body: z.string().min(2).max(50_000),
  coverUrl: z.string().max(500).nullable().optional(),
  ctaHref: z.string().max(200).nullable().optional(),
  published: z.boolean().optional(),
  featured: z.boolean().optional(),
});

const articlePatch = articleBody.partial().extend({
  title: z.string().min(2).max(200).optional(),
  excerpt: z.string().min(2).max(500).optional(),
  body: z.string().min(2).max(50_000).optional(),
});

const listQuery = z.object({
  featured: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const slugParams = z.object({ slug: z.string().min(2).max(120) });
const idParams = z.object({ id: z.string().uuid() });

function toSiteInput(body: z.infer<typeof siteBody>): SiteContentInput {
  return {
    heroEyebrow: body.heroEyebrow,
    heroTitle: body.heroTitle,
    heroSubtitle: body.heroSubtitle,
    ...(body.heroImageUrl !== undefined ? { heroImageUrl: body.heroImageUrl } : {}),
    ...(body.promoQuote !== undefined ? { promoQuote: body.promoQuote } : {}),
  };
}

function toArticleInput(body: z.infer<typeof articleBody>): ArticleInput {
  return {
    title: body.title,
    excerpt: body.excerpt,
    body: body.body,
    ...(body.slug !== undefined ? { slug: body.slug } : {}),
    ...(body.coverUrl !== undefined ? { coverUrl: body.coverUrl } : {}),
    ...(body.ctaHref !== undefined ? { ctaHref: body.ctaHref } : {}),
    ...(body.published !== undefined ? { published: body.published } : {}),
    ...(body.featured !== undefined ? { featured: body.featured } : {}),
  };
}

function toArticlePatch(body: z.infer<typeof articlePatch>): Partial<ArticleInput> {
  return {
    ...(body.slug !== undefined ? { slug: body.slug } : {}),
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.excerpt !== undefined ? { excerpt: body.excerpt } : {}),
    ...(body.body !== undefined ? { body: body.body } : {}),
    ...(body.coverUrl !== undefined ? { coverUrl: body.coverUrl } : {}),
    ...(body.ctaHref !== undefined ? { ctaHref: body.ctaHref } : {}),
    ...(body.published !== undefined ? { published: body.published } : {}),
    ...(body.featured !== undefined ? { featured: body.featured } : {}),
  };
}

/**
 * Public marketing content + ADMIN CMS.
 *
 * Public GETs have no auth so the homepage can load for anonymous visitors.
 * Mutations require ADMIN (phone allowlist via ADMIN_PHONES).
 */
export async function contentPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/home', async () => ContentService.getHome());

  app.get('/articles', async (request) => {
    const query = listQuery.parse(request.query);
    return {
      articles: await ContentService.listArticles({
        publishedOnly: true,
        ...(query.featured ? { featuredOnly: true } : {}),
      }),
    };
  });

  app.get('/articles/:slug', async (request) => {
    const { slug } = slugParams.parse(request.params);
    return ContentService.getArticleBySlug(slug, true);
  });
}

export async function contentAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole(AppRole.ADMIN));

  app.put('/home', async (request) => {
    const claims = requireUser(request);
    const body = siteBody.parse(request.body);
    return ContentService.updateHome(toSiteInput(body), claims.sub);
  });

  app.get('/articles', async () => ({
    articles: await ContentService.listArticles({ publishedOnly: false }),
  }));

  app.post(
    '/articles',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const claims = requireUser(request);
      const body = articleBody.parse(request.body);
      const created = await ContentService.createArticle(toArticleInput(body), claims.sub);
      return reply.code(201).send(created);
    },
  );

  app.patch('/articles/:id', async (request) => {
    const claims = requireUser(request);
    const { id } = idParams.parse(request.params);
    const body = articlePatch.parse(request.body);
    return ContentService.updateArticle(id, toArticlePatch(body), claims.sub);
  });

  app.delete('/articles/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await ContentService.deleteArticle(id);
    return reply.code(204).send();
  });
}
