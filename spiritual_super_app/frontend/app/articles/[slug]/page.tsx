'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, type CmsArticle } from '@/lib/api';

/** Minimal markdown → safe React-ish plain rendering (no HTML). */
function renderMarkdown(body: string) {
  return body.split(/\n\n+/).map((block, index) => {
    const trimmed = block.trim();
    if (trimmed.startsWith('## ')) {
      return (
        <h2 key={index} className="mt-6 font-display text-2xl font-semibold text-navy-950">
          {trimmed.slice(3)}
        </h2>
      );
    }
    if (trimmed.startsWith('# ')) {
      return (
        <h1 key={index} className="mt-4 font-display text-3xl font-semibold text-navy-950">
          {trimmed.slice(2)}
        </h1>
      );
    }
    if (/^[-*] /.test(trimmed)) {
      const items = trimmed.split('\n').map((line) => line.replace(/^[-*] /, ''));
      return (
        <ul key={index} className="mt-3 list-disc space-y-1 pl-5 text-sm text-navy-800/80">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    }
    if (/^\d+\. /.test(trimmed)) {
      const items = trimmed.split('\n').map((line) => line.replace(/^\d+\. /, ''));
      return (
        <ol key={index} className="mt-3 list-decimal space-y-1 pl-5 text-sm text-navy-800/80">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    }
    return (
      <p key={index} className="mt-3 text-sm leading-relaxed text-navy-800/80">
        {trimmed.replace(/\*\*(.+?)\*\*/g, '$1')}
      </p>
    );
  });
}

export default function ArticlePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [article, setArticle] = useState<CmsArticle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    void api
      .get<CmsArticle>(`content/articles/${slug}`)
      .then(setArticle)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Article not found'),
      );
  }, [slug]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-rose-700">{error}</p>
        <Link href="/" className="mt-4 inline-block text-gold-600">
          ← Home
        </Link>
      </div>
    );
  }

  if (!article) {
    return <p className="px-4 py-16 text-center text-sm text-navy-800/60">Loading…</p>;
  }

  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      {article.coverUrl && (
        <div className="relative mb-8 h-56 overflow-hidden rounded-2xl sm:h-72">
          <Image src={article.coverUrl} alt="" fill className="object-cover" sizes="800px" />
        </div>
      )}
      <p className="text-xs uppercase tracking-wider text-gold-600">Nakshya journal</p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-navy-950">{article.title}</h1>
      <p className="mt-3 text-base text-navy-800/70">{article.excerpt}</p>
      <div className="mt-8 border-t border-navy-900/10 pt-6">{renderMarkdown(article.body ?? '')}</div>
      {article.ctaHref && (
        <Link href={article.ctaHref} className="btn-gold mt-10 inline-flex">
          Continue →
        </Link>
      )}
      <div className="mt-8">
        <Link href="/" className="text-sm text-navy-800/60 hover:text-navy-950">
          ← Back to home
        </Link>
      </div>
    </article>
  );
}
