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

/** Knowledge Centre — ERP-managed intro + HEC Blog Post articles. */
export function KnowledgeCentrePage() {
  const [intro, setIntro] = useState<SiteCmsPage | null>(null);
  const [posts, setPosts] = useState<BlogPostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.getSiteCmsPage('knowledge'), api.listBlogPosts({ limit: 24 })])
      .then(([cms, blog]) => {
        if (cancelled) return;
        if (cms.status === 'success') setIntro(cms.data);
        if (blog.status === 'error') {
          setError(blog.message || 'Unable to load articles');
          setPosts([]);
          return;
        }
        setPosts(blog.data?.posts || []);
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load articles');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useDocumentSeo({
    title: intro?.meta_title || 'Knowledge Centre | Remedium',
    description:
      intro?.meta_description ||
      'Remedium Knowledge Centre — diagnostics guides, preventive health, and wellness articles.',
    keywords:
      intro?.meta_keywords ||
      'Remedium, Remedium Lab, Remedium Care, Knowledge Centre, fair price diagnostic lab India',
    allowIndex: true,
  });

  return (
    <div className="blog-page">
      <header className="page-intro blog-intro">
        <p className="muted">Remedium · Knowledge Centre</p>
        <h1>{intro?.title || 'Knowledge Centre'}</h1>
        <p>
          {intro?.subtitle ||
            'Health education, lab test guides, and wellness insights from the Remedium team.'}
        </p>
        {intro?.body ? (
          <div className="cms-body" dangerouslySetInnerHTML={{ __html: intro.body }} />
        ) : null}
      </header>

      {loading ? <p className="muted blog-status">Loading articles…</p> : null}
      {error ? <p className="blog-error">{error}</p> : null}
      {!loading && !error && posts.length === 0 ? (
        <p className="muted blog-status">No published articles yet. Check back soon.</p>
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
