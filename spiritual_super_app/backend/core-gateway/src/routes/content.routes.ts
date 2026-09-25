import { ProductCategory } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppRole } from '../auth/jwt.js';
import { authenticate, requireRole, requireUser } from '../plugins/authenticate.js';
import { AstrologerDirectoryService } from '../services/astrologer-directory.service.js';
import { AyurvedaService } from '../services/ayurveda.service.js';
import { ContentError } from '../services/content-security.js';
import { ContentService, type ArticleInput, type SiteContentInput } from '../services/content.service.js';
import { FooterService, type FooterSettingsInput } from '../services/footer.service.js';
import { HeroService, type HeroSlideInput } from '../services/hero.service.js';

const footerLink = z.string().max(500).nullable().optional();
const footerBody = z
  .object({
    facebookUrl: footerLink,
    instagramUrl: footerLink,
    youtubeUrl: footerLink,
    xUrl: footerLink,
    linkedinUrl: footerLink,
    whatsappUrl: footerLink,
    appStoreUrl: footerLink,
    playStoreUrl: footerLink,
  })
  .strict();

function toFooterInput(body: z.infer<typeof footerBody>): FooterSettingsInput {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as FooterSettingsInput;
}

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

const heroFields = {
  eyebrow: z.string().max(120).nullable().optional(),
  title: z.string().min(2).max(160),
  description: z.string().max(400).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  /** Size and format are checked by the service. */
  imageData: z.string().nullable().optional(),
  ctaText: z.string().max(40).nullable().optional(),
  ctaHref: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
};
const heroSlideBody = z.object(heroFields).strict();
const heroSlidePatch = z.object({ ...heroFields, title: heroFields.title.optional() }).strict();
const heroOrderBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

function toHeroInput(body: z.infer<typeof heroSlidePatch>): HeroSlideInput {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as HeroSlideInput;
}

const productsQuery = z.object({ category: z.nativeEnum(ProductCategory).optional() });

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

  app.get('/footer', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return FooterService.get();
  });

  app.get('/products', async (request, reply) => {
    const { category } = productsQuery.parse(request.query);
    reply.header('Cache-Control', 'public, max-age=60');
    const products = await AyurvedaService.listProducts(category === undefined ? {} : { category });
    return { products };
  });

  app.get('/hero-slides', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=30');
    return { slides: await HeroService.listLive() };
  });

  app.get('/hero-slides/:id/image', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const image = await HeroService.image(id);
    if (!image) {
      throw new ContentError('No uploaded image', 404);
    }
    return reply
      .header('Content-Type', image.contentType)
      .header('Cache-Control', 'public, max-age=86400')
      .send(image.bytes);
  });

  app.get('/astrologers', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=10');
    return { astrologers: await AstrologerDirectoryService.list() };
  });

  app.get('/astrologers/:id/photo', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const photo = await AstrologerDirectoryService.photo(id);
    if (!photo) {
      throw new ContentError('No photo', 404);
    }
    return reply
      .header('Content-Type', photo.contentType)
      .header('Cache-Control', 'public, max-age=86400')
      .send(photo.bytes);
  });

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

  app.put('/footer', async (request) => {
    const claims = requireUser(request);
    const body = footerBody.parse(request.body);
    return FooterService.update(toFooterInput(body), claims.sub);
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

  app.get('/hero-slides', async () => ({ slides: await HeroService.listAll() }));

  app.post('/hero-slides', async (request, reply) => {
    const claims = requireUser(request);
    const body = heroSlideBody.parse(request.body);
    return reply.code(201).send(await HeroService.create(toHeroInput(body) as HeroSlideInput & { title: string }, claims.sub));
  });

  app.put('/hero-slides/order', async (request) => {
    const { ids } = heroOrderBody.parse(request.body);
    return { slides: await HeroService.reorder(ids) };
  });

  app.patch('/hero-slides/:id', async (request) => {
    const claims = requireUser(request);
    const { id } = idParams.parse(request.params);
    const body = heroSlidePatch.parse(request.body);
    return HeroService.update(id, toHeroInput(body), claims.sub);
  });

  app.delete('/hero-slides/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await HeroService.remove(id);
    return reply.code(204).send();
  });
}
