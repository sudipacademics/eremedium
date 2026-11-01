import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type BlogPostSummary, type SiteCmsPage } from '../../api';
import { assetUrl } from '../../config';
import { useDocumentSeo } from '../../components/DocumentSeo';

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

export function PressPage() {
  const [intro, setIntro] = useState<SiteCmsPage | null>(null);
  const [posts, setPosts] = useState<BlogPostSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.getSiteCmsPage('press'),
      api.listBlogPosts({ limit: 24, category: 'Press' }),
    ])
      .then(([cms, blog]) => {
        if (cancelled) return;
        if (cms.status === 'success') setIntro(cms.data);
        const pressPosts = blog.data?.posts || [];
        if (pressPosts.length) {
          setPosts(pressPosts);
        } else {
          return api.listBlogPosts({ limit: 12, category: 'News' }).then((news) => {
            if (!cancelled) setPosts(news.data?.posts || []);
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useDocumentSeo({
    title: intro?.meta_title || 'News & Press | Remedium',
    description:
      intro?.meta_description ||
      "Latest Remedium news, press releases, and media updates from India's first fair price diagnostic lab network.",
    keywords: intro?.meta_keywords || 'Remedium news, Remedium press, diagnostic lab announcements',
    allowIndex: true,
  });

  return (
    <div className="blog-page">
      <header className="page-intro blog-intro">
        <p className="muted">Remedium · Media</p>
        <h1>{intro?.title || 'News & Press'}</h1>
        <p>{intro?.subtitle || 'Official announcements and media coverage.'}</p>
        {intro?.body ? (
          <div className="cms-body" dangerouslySetInnerHTML={{ __html: intro.body }} />
        ) : null}
      </header>

      {loading ? <p className="muted blog-status">Loading updates…</p> : null}
      {!loading && posts.length === 0 ? (
        <p className="muted blog-status">
          No press posts yet. Publish HEC Blog Post entries with category <strong>Press</strong> or{' '}
          <strong>News</strong> in ERP.
        </p>
      ) : null}

      <div className="blog-grid">
        {posts.map((post) => {
          const img = assetUrl(post.featured_image);
          return (
            <article key={post.name} className="blog-card">
              <Link to={`/blog/${post.slug}`} className="blog-card-link">
                {img ? <img src={img} alt="" className="blog-card-image" loading="lazy" /> : null}
                <div className="blog-card-body">
                  {post.category ? <span className="blog-card-category">{post.category}</span> : null}
                  <h2>{post.title}</h2>
                  {post.excerpt ? <p>{post.excerpt}</p> : null}
                  {post.published_on ? (
                    <time className="muted" dateTime={post.published_on}>
                      {formatDate(post.published_on)}
                    </time>
                  ) : null}
                </div>
              </Link>
            </article>
          );
        })}
      </div>
    </div>
  );
}
