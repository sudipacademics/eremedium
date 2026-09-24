'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { AyurvedaProduct, ProductCategory } from '@/lib/api';

import { CAROUSEL_ARROW, useCarousel } from './useCarousel';

const SHOP_QUERY: Record<ProductCategory, string> = { AYURVEDA: 'ayurveda', CRYSTAL: 'crystal' };
const PLACEHOLDER: Record<ProductCategory, string> = { AYURVEDA: '🌿', CRYSTAL: '💎' };

export function shopHref(category: ProductCategory, productId?: string): string {
  const params = new URLSearchParams({ category: SHOP_QUERY[category] });
  if (productId) params.set('product', productId);
  return `/ayurveda?${params.toString()}`;
}

function formatPrice(price: string): string {
  const value = Number(price);
  return Number.isFinite(value)
    ? `₹${value.toLocaleString('en-IN', { maximumFractionDigits: value % 1 === 0 ? 0 : 2 })}`
    : `₹${price}`;
}

/** Horizontal, swipeable product row with arrow controls on larger screens. */
export function ProductCarousel({
  title,
  category,
  products,
  loading,
  linkLabel = 'Shop all',
}: {
  title: string;
  category: ProductCategory;
  products: AyurvedaProduct[];
  loading: boolean;
  linkLabel?: string;
}) {
  const { track, edges, measure, scroll } = useCarousel(products.length);

  if (!loading && products.length === 0) return null;

  const arrow = CAROUSEL_ARROW;

  return (
    <section className="mx-auto max-w-7xl px-4 pb-12" aria-roledescription="carousel" aria-label={title}>
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-display text-3xl font-semibold text-ved-green-900">{title}</h2>
        <div className="flex items-center gap-2">
          <button type="button" className={arrow} onClick={() => scroll(-1)} disabled={edges.start} aria-label="Previous products">
            ‹
          </button>
          <button type="button" className={arrow} onClick={() => scroll(1)} disabled={edges.end} aria-label="Next products">
            ›
          </button>
          <Link href={shopHref(category)} className="ml-1 text-sm font-medium text-ved-gold-600 hover:underline">
            {linkLabel}
          </Link>
        </div>
      </div>

      <ul
        ref={track}
        onScroll={measure}
        className="scrollbar-none mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2"
      >
        {loading
          ? Array.from({ length: 5 }, (_, i) => (
              <li
                key={i}
                aria-hidden
                className="h-[19rem] w-[70%] shrink-0 animate-pulse rounded-2xl bg-white/70 sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-4rem)/5)]"
              />
            ))
          : products.map((product) => (
              <li
                key={product.id}
                className="w-[70%] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-4rem)/5)]"
              >
                <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-ved-green-900/8 bg-white shadow-sm transition hover:border-ved-green-500/25 hover:shadow-md">
                  <div className="relative aspect-square overflow-hidden bg-ved-cream-200">
                    {product.imageUrl ? (
                      <Image
                        src={product.imageUrl}
                        alt={product.name}
                        fill
                        className="object-cover transition duration-500 group-hover:scale-105"
                        sizes="(max-width: 640px) 70vw, (max-width: 1024px) 33vw, 20vw"
                      />
                    ) : (
                      <span className="grid h-full place-items-center text-4xl">{PLACEHOLDER[category]}</span>
                    )}
                    <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ved-green-800">
                      {product.formFactor}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <h3 className="line-clamp-2 text-sm font-semibold text-ved-green-900">{product.name}</h3>
                    {product.suitedDoshas.length > 0 && (
                      <p className="text-[11px] text-ved-green-800/55">
                        {product.suitedDoshas.map((d) => d.charAt(0) + d.slice(1).toLowerCase()).join(' · ')}
                      </p>
                    )}
                    <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                      <span className="font-display text-lg font-semibold text-ved-green-900">
                        {formatPrice(product.price)}
                      </span>
                      <Link
                        href={shopHref(category, product.id)}
                        className="rounded-full bg-ved-green-800 px-3.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-ved-green-700"
                        aria-label={`Buy ${product.name}`}
                      >
                        Buy Now
                      </Link>
                    </div>
                  </div>
                </article>
              </li>
            ))}
      </ul>
    </section>
  );
}
