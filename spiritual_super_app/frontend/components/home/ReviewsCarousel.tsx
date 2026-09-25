'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import { api, youtubeEmbedUrl, youtubeThumbnailUrl, type ReviewVideo } from '@/lib/api';

import { CAROUSEL_ARROW, useCarousel } from './useCarousel';

function PlayIcon() {
  return (
    <svg viewBox="0 0 68 48" className="h-12 w-[4.25rem] drop-shadow-lg" aria-hidden>
      <path
        d="M66.5 7.7a8.5 8.5 0 0 0-6-6C55.2.3 34 .3 34 .3s-21.2 0-26.5 1.4a8.5 8.5 0 0 0-6 6C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.5 8.5 0 0 0 6 6C12.8 47.7 34 47.7 34 47.7s21.2 0 26.5-1.4a8.5 8.5 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z"
        className="fill-ved-green-800/90 transition group-hover:fill-[#FF0000]"
      />
      <path d="M45 24 27 14v20z" fill="#fff" />
    </svg>
  );
}

/**
 * Homepage "Reviews": admin-managed YouTube videos (Admin → Reviews). Thumbnails load from YouTube's
 * image CDN; the player iframe is created only when a visitor presses play, so the page stays light.
 */
export function ReviewsCarousel() {
  const [videos, setVideos] = useState<ReviewVideo[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const { track, edges, measure, scroll } = useCarousel(videos?.length ?? 0);

  useEffect(() => {
    void api
      .get<{ videos: ReviewVideo[] }>('content/review-videos')
      .then((res) => setVideos(res.videos))
      .catch(() => setVideos([]));
  }, []);

  if (!videos || videos.length === 0) return null;

  return (
    <section className="bg-[#F7F4EE]" aria-roledescription="carousel" aria-label="Reviews">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ved-gold-600">
              In their own words
            </p>
            <h2 className="mt-1 font-display text-3xl font-semibold text-ved-green-900">Reviews</h2>
          </div>
          {videos.length > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" className={CAROUSEL_ARROW} onClick={() => scroll(-1)} disabled={edges.start} aria-label="Previous reviews">
                ‹
              </button>
              <button type="button" className={CAROUSEL_ARROW} onClick={() => scroll(1)} disabled={edges.end} aria-label="Next reviews">
                ›
              </button>
            </div>
          )}
        </div>

        <ul
          ref={track}
          onScroll={measure}
          className="scrollbar-none mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2"
        >
          {videos.map((video) => (
            <li
              key={video.id}
              className="w-[85%] shrink-0 snap-start sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-2rem)/3)]"
            >
              <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-ved-green-900/8 bg-white shadow-sm">
                <div className="relative aspect-video overflow-hidden bg-ved-green-900">
                  {playing === video.id ? (
                    <iframe
                      src={youtubeEmbedUrl(video.youtubeId)}
                      title={video.title}
                      className="absolute inset-0 h-full w-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  ) : (
                    <button
                      type="button"
                      className="group absolute inset-0 grid place-items-center"
                      onClick={() => setPlaying(video.id)}
                      aria-label={`Play video: ${video.title}`}
                    >
                      <Image
                        src={youtubeThumbnailUrl(video.youtubeId)}
                        alt=""
                        fill
                        unoptimized
                        className="object-cover transition duration-500 group-hover:scale-105"
                        sizes="(max-width: 640px) 85vw, (max-width: 1024px) 50vw, 33vw"
                      />
                      <span className="absolute inset-0 bg-black/10 transition group-hover:bg-black/25" />
                      <span className="relative">
                        <PlayIcon />
                      </span>
                    </button>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-4">
                  <h3 className="line-clamp-2 font-semibold text-ved-green-900">{video.title}</h3>
                  {video.description && (
                    <p className="line-clamp-3 text-sm text-ved-green-800/65">{video.description}</p>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
