import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type BlogPostSummary } from '../../api';
import { assetUrl } from '../../config';
import { useDocumentSeo } from '../../components/DocumentSeo';
import { estimateReadingMinutes } from './blogUtils';

function formatDate(value?: string) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

function cardPlaceholder(category?: string) {
  const key = (category || '').toLowerCase();
  if (key.includes('knowledge')) return '/home/icon-reports.svg';
  if (key.includes('franchise') || key.includes('press')) return '/home/icon-doctor.svg';
  return '/home/icon-lab.svg';
}

export function BlogListPage() {
  const [posts, setPosts] = useState<BlogPostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useDocumentSeo({
    title: 'Health Blog | Remedium Lab',
    description:
      'Health tips, lab insights, fair-price diagnostics, and Remedium news for patients and families across India.',
    keywords:
      'Remedium blog, fair price diagnostic lab, blood test tips, home sample collection, health checkup India',
    canonical: 'https://www.e-remedium.in/blog',
    allowIndex: true,
    type: 'website',
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .listBlogPosts({ limit: 24 })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 'error') {
          setError(res.message || 'Unable to load blog posts');
          setPosts([]);
          return;
        }
        setPosts(res.data?.posts || []);
        setError('');
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load blog posts');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const featured = posts[0];
  const rest = posts.slice(1);

  return (
    <div className="blog-page blog-list-page">
      <header className="blog-list-hero">
        <div className="blog-list-hero-copy">
          <p className="brand-kicker">Remedium · Insights</p>
          <h1>Health Blog</h1>
          <p>
            Practical guidance on diagnostics, wellness, and everyday health — curated by the Remedium
            editorial team.
          </p>
        </div>
        <div className="blog-list-hero-art" aria-hidden>
          <img src="/home/icon-lab.svg" alt="" />
        </div>
      </header>

      {loading ? <p className="muted blog-status">Loading articles…</p> : null}
      {error ? <p className="blog-error">{error}</p> : null}

      {!loading && !error && posts.length === 0 ? (
        <p className="muted blog-status">No published articles yet. Check back soon.</p>
      ) : null}

      {!loading && !error && featured ? (
        <article className="blog-featured-card">
          <Link to={`/blog/${featured.slug}`} className="blog-featured-link">
            <div className="blog-featured-media">
              {assetUrl(featured.featured_image) ? (
                <img src={assetUrl(featured.featured_image)!} alt="" loading="eager" />
              ) : (
                <div className="blog-featured-placeholder">
                  <img src={cardPlaceholder(featured.category)} alt="" />
                </div>
              )}
            </div>
            <div className="blog-featured-body">
              <span className="blog-chip">Featured</span>
              {featured.category ? <span className="blog-chip blog-chip-muted">{featured.category}</span> : null}
              <h2>{featured.title}</h2>
              {featured.excerpt ? <p>{featured.excerpt}</p> : null}
              <div className="blog-card-meta">
                {featured.author_name ? <span>{featured.author_name}</span> : null}
                {featured.published_on ? (
                  <time dateTime={featured.published_on}>{formatDate(featured.published_on)}</time>
                ) : null}
                {featured.excerpt ? (
                  <span>{estimateReadingMinutes(featured.excerpt)} min read</span>
                ) : null}
              </div>
              <span className="blog-read-more">Read article →</span>
            </div>
          </Link>
        </article>
      ) : null}

      {rest.length > 0 ? (
        <>
          <h2 className="blog-grid-title">More articles</h2>
          <div className="blog-grid">
            {rest.map((post) => {
              const img = assetUrl(post.featured_image);
              return (
                <article key={post.name} className="blog-card">
                  <Link to={`/blog/${post.slug}`} className="blog-card-link">
                    {img ? (
                      <div className="blog-card-media">
                        <img src={img} alt="" loading="lazy" />
                      </div>
                    ) : (
                      <div className="blog-card-media blog-card-media-placeholder">
                        <img src={cardPlaceholder(post.category)} alt="" loading="lazy" />
                      </div>
                    )}
                    <div className="blog-card-body">
                      {post.category ? <span className="blog-chip">{post.category}</span> : null}
                      <h3>{post.title}</h3>
                      {post.excerpt ? <p>{post.excerpt}</p> : null}
                      <div className="blog-card-meta">
                        {post.author_name ? <span>{post.author_name}</span> : null}
                        {post.published_on ? (
                          <time dateTime={post.published_on}>{formatDate(post.published_on)}</time>
                        ) : null}
                      </div>
                      <span className="blog-read-more">Read more →</span>
                    </div>
                  </Link>
                </article>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
