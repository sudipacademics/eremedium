'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { InfoPage } from '@/components/InfoPage';
import { api, type CmsArticle } from '@/lib/api';

export default function BlogPage() {
  const [articles, setArticles] = useState<CmsArticle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<{ articles: CmsArticle[] }>('content/articles')
      .then((res) => setArticles(res.articles))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load articles'),
      );
  }, []);

  return (
    <InfoPage
      eyebrow="Blog"
      title="Wisdom for everyday life"
      intro="Articles on astrology, rituals, festivals and Ayurveda from the Vedsutra team."
      wide
    >
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {articles === null && !error && <p className="text-sm text-ved-green-800/60">Loading articles…</p>}
      {articles !== null && articles.length === 0 && (
        <p className="rounded-xl bg-white px-4 py-3 text-sm text-ved-green-800/65">
          New articles are on their way. Meanwhile, explore the{' '}
          <Link href="/knowledge" className="font-semibold text-ved-gold-600 hover:underline">
            Knowledge
          </Link>{' '}
          section.
        </p>
      )}
      {articles !== null && articles.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((article) => (
            <Link
              key={article.id}
              href={`/articles/${article.slug}`}
              className="overflow-hidden rounded-2xl border border-ved-green-900/8 bg-white shadow-sm transition hover:border-ved-green-500/25"
            >
              <div className="relative h-40 bg-ved-green-100">
                {article.coverUrl ? (
                  <Image src={article.coverUrl} alt="" fill className="object-cover" sizes="(min-width: 1024px) 33vw, 100vw" />
                ) : (
                  <div className="grid h-full place-items-center text-3xl text-ved-green-600">☽</div>
                )}
              </div>
              <div className="space-y-2 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ved-gold-600">Wisdom</p>
                <h2 className="font-display text-lg font-semibold leading-snug text-ved-green-900">
                  {article.title}
                </h2>
                <p className="line-clamp-2 text-sm text-ved-green-800/60">{article.excerpt}</p>
                <span className="text-xs font-semibold text-ved-green-700">Read More →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </InfoPage>
  );
}
