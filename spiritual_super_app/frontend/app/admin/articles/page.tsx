'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api, type CmsArticle } from '@/lib/api';

const empty = {
  slug: '',
  title: '',
  excerpt: '',
  body: '',
  coverUrl: '',
  ctaHref: '',
  published: true,
  featured: true,
};

export default function AdminArticlesPage() {
  const [articles, setArticles] = useState<CmsArticle[]>([]);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .get<{ articles: CmsArticle[] }>('content/admin/articles')
      .then((res) => setArticles(res.articles))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load articles'),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('content/admin/articles', {
        slug: form.slug || undefined,
        title: form.title,
        excerpt: form.excerpt,
        body: form.body,
        coverUrl: form.coverUrl || null,
        ctaHref: form.ctaHref || null,
        published: form.published,
        featured: form.featured,
      });
      setForm(empty);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(article: CmsArticle, patch: Partial<CmsArticle>) {
    setError(null);
    try {
      await api.patch(`content/admin/articles/${article.id}`, patch);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Update failed');
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this article?')) return;
    try {
      await api.del(`content/admin/articles/${id}`);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Delete failed');
    }
  }

  return (
    <AdminGate>
      <form onSubmit={onCreate} className="card space-y-3">
        <h2 className="text-lg font-semibold">New article</h2>
        <input
          className="input"
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          required
        />
        <input
          className="input"
          placeholder="Slug (optional)"
          value={form.slug}
          onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
        />
        <input
          className="input"
          placeholder="Excerpt"
          value={form.excerpt}
          onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))}
          required
        />
        <textarea
          className="input min-h-[8rem]"
          placeholder="Body (markdown)"
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          required
        />
        <input
          className="input"
          placeholder="Cover URL (https unsplash/pexels)"
          value={form.coverUrl}
          onChange={(e) => setForm((f) => ({ ...f, coverUrl: e.target.value }))}
        />
        <input
          className="input"
          placeholder="CTA href (/gochar)"
          value={form.ctaHref}
          onChange={(e) => setForm((f) => ({ ...f, ctaHref: e.target.value }))}
        />
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.published}
              onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))}
            />
            Published
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.featured}
              onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))}
            />
            Featured
          </label>
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create article'}
        </button>
      </form>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      <div className="space-y-3">
        {articles.map((article) => (
          <article key={article.id} className="card flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{article.title}</h3>
              <p className="text-xs text-slate-400">
                /{article.slug} · {article.published ? 'published' : 'draft'}
                {article.featured ? ' · featured' : ''}
              </p>
              <p className="mt-1 text-sm text-slate-300">{article.excerpt}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => toggle(article, { featured: !article.featured })}
              >
                {article.featured ? 'Unfeature' : 'Feature'}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => toggle(article, { published: !article.published })}
              >
                {article.published ? 'Unpublish' : 'Publish'}
              </button>
              <button type="button" className="btn-danger text-xs" onClick={() => void remove(article.id)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </AdminGate>
  );
}
