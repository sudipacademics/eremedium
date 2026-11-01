import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type BlogPostDetail } from '../../api';
import { assetUrl, config } from '../../config';
import { useDocumentSeo } from '../../components/DocumentSeo';
import { buildBlogPostSchema, extractBlogFaqsFromHtml } from '../../seo/blogSchema';
import { estimateReadingMinutes, extractBlogHeadings } from './blogUtils';

function formatDate(value?: string) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

/** Make /files/... URLs absolute against the ERP host for embedded images. */
function absolutizeHtml(html: string) {
  const base = (config.apiBaseUrl || '').replace(/\/$/, '');
  if (!html) return '';
  if (!base) return html;
  return html.replace(
    /(src|href)=(["'])(\/files\/[^"']+)\2/gi,
    (_m, attr, quote, path) => `${attr}=${quote}${base}${path}${quote}`,
  );
}

function toEmbedUrl(raw?: string): string | null {
  const url = (raw || '').trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.replace('/', '');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v') || (u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : '');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    if (/\.(mp4|webm|ogg)(\?|$)/i.test(u.pathname)) return url;
  } catch {
    return null;
  }
  return null;
}

const ARTICLE_CTAS: { label: string; href: string; secondary?: boolean }[] = [
  { label: 'Book a Lab Test', href: '/diagnostics' },
  { label: 'Find a Centre', href: '/centres', secondary: true },
  { label: 'Book Home Collection', href: '/diagnostics', secondary: true },
];

export function BlogPostPage() {
  const { slug } = useParams();
  const [post, setPost] = useState<BlogPostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!slug) {
      setError('Post not found');
      setLoading(false);
      return;
    }
    setLoading(true);
    void api
      .getBlogPost(slug)
      .then((res) => {
        if (cancelled) return;
        if (res.status === 'error' || !res.data) {
          setError(res.message || 'Post not found');
          setPost(null);
          return;
        }
        setPost(res.data);
        setError('');
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load this article');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const contentHtml = useMemo(() => absolutizeHtml(post?.content || ''), [post?.content]);
  const headings = useMemo(() => extractBlogHeadings(contentHtml), [contentHtml]);
  const readingMin = useMemo(() => estimateReadingMinutes(contentHtml), [contentHtml]);

  const ogImage = useMemo(() => {
    if (!post) return '';
    const path = post.og_image || post.featured_image || '';
    const abs = assetUrl(path);
    if (!abs) return '';
    if (abs.startsWith('http')) return abs;
    if (typeof window !== 'undefined') return `${window.location.origin}${abs}`;
    return abs;
  }, [post]);

  useDocumentSeo({
    title: post?.meta_title || post?.title || 'Blog',
    description: post?.meta_description || post?.excerpt || '',
    keywords: post?.meta_keywords || '',
    image: ogImage,
    canonical: post?.canonical_url || undefined,
    allowIndex: post ? Boolean(post.allow_google_index) : true,
    type: 'article',
  });

  useEffect(() => {
    if (!post) return;
    const faqs = extractBlogFaqsFromHtml(post.content || '');
    const canonical =
      post.canonical_url ||
      (typeof window !== 'undefined' ? `${window.location.origin}/blog/${post.slug}` : '');
    const schema = buildBlogPostSchema({
      title: post.title,
      description: post.meta_description || post.excerpt || '',
      slug: post.slug,
      canonicalUrl: canonical,
      publishedOn: post.published_on,
      authorName: post.author_name,
      imageUrl: ogImage || undefined,
      faqs,
    });
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'blog-post-schema';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
    return () => {
      document.getElementById('blog-post-schema')?.remove();
    };
  }, [post, ogImage]);

  useEffect(() => {
    if (!headings.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.boundingClientRect.top > b.boundingClientRect.top ? 1 : -1));
        if (visible[0]?.target?.id) setActiveSection(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: 0 },
    );
    headings.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [headings, contentHtml]);

  const embed = toEmbedUrl(post?.featured_video_url);
  const featured = assetUrl(post?.featured_image);

  if (loading) {
    return (
      <div className="blog-page blog-article-page">
        <div className="blog-skeleton-hero" aria-hidden />
        <p className="muted blog-status">Loading article…</p>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="blog-page blog-article-page">
        <p className="blog-error">{error || 'Post not found'}</p>
        <Link to="/blog" className="blog-back">
          ← Back to blog
        </Link>
      </div>
    );
  }

  return (
    <div className="blog-page blog-article-page">
      <nav className="blog-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden>›</span>
        <Link to="/blog">Blog</Link>
        <span aria-hidden>›</span>
        <span className="blog-breadcrumb-current">{post.title}</span>
      </nav>

      <header className="blog-hero">
        <div className="blog-hero-copy">
          {post.category ? <span className="blog-chip">{post.category}</span> : null}
          <h1>{post.title}</h1>
          {post.excerpt ? <p className="blog-hero-excerpt">{post.excerpt}</p> : null}
          <div className="blog-article-meta blog-hero-meta">
            {post.author_name ? <span>{post.author_name}</span> : null}
            {post.published_on ? (
              <time dateTime={post.published_on}>{formatDate(post.published_on)}</time>
            ) : null}
            <span>{readingMin} min read</span>
          </div>
        </div>
        <div className="blog-hero-visual" aria-hidden>
          {featured ? (
            <img src={featured} alt="" />
          ) : (
            <div className="blog-hero-visual-fallback">
              <img src="/home/icon-lab.svg" alt="" />
            </div>
          )}
        </div>
      </header>

      {headings.length > 0 ? (
        <nav className="blog-toc-mobile" aria-label="On this page">
          {headings.map((item) => (
            <a key={item.id} href={`#${item.id}`} className={activeSection === item.id ? 'active' : ''}>
              {item.label}
            </a>
          ))}
        </nav>
      ) : null}

      <div className={`blog-article-layout${headings.length ? '' : ' blog-article-layout--single'}`}>
        {headings.length > 0 ? (
          <aside className="blog-toc-sidebar" aria-label="Table of contents">
            <p className="blog-toc-title">On this page</p>
            <nav className="blog-toc-nav">
              {headings.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={activeSection === item.id ? 'active' : ''}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="blog-toc-cta">
              <p className="blog-toc-cta-title">Ready to book?</p>
              {ARTICLE_CTAS.map((cta) => (
                <Link
                  key={cta.label}
                  to={cta.href}
                  className={cta.secondary ? 'btn secondary blog-toc-cta-btn' : 'btn blog-toc-cta-btn'}
                >
                  {cta.label}
                </Link>
              ))}
            </div>
          </aside>
        ) : null}

        <article className="blog-article">
          {embed ? (
            <div className="blog-video">
              {embed.includes('youtube.com') || embed.includes('vimeo.com') ? (
                <iframe
                  src={embed}
                  title={post.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <video src={embed} controls playsInline />
              )}
            </div>
          ) : null}

          <div className="blog-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
        </article>
      </div>

      <footer className="blog-article-footer">
        <div className="blog-article-footer-inner">
          <h2>Take the next step</h2>
          <p>Book tests, find a collection centre, or schedule home sample collection with Remedium Lab.</p>
          <div className="blog-article-footer-actions">
            {ARTICLE_CTAS.map((cta) => (
              <Link
                key={cta.label}
                to={cta.href}
                className={cta.secondary ? 'btn secondary' : 'btn'}
              >
                {cta.label}
              </Link>
            ))}
          </div>
        </div>
      </footer>

      <Link to="/blog" className="blog-back blog-back-bottom">
        ← All articles
      </Link>
    </div>
  );
}
