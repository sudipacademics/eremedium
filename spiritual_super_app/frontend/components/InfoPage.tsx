import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/SiteFooter';

/** Full-width public page: cream header band, readable content column, site footer. */
export function InfoPage({
  eyebrow,
  title,
  intro,
  updated,
  wide = false,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  /** Shown as "Last updated …" on policy pages. */
  updated?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="bg-[#F7F4EE] text-ved-green-900">
      <section className="border-b border-ved-green-900/5 bg-[#F1EDE4]">
        <div className={`mx-auto px-4 py-12 ${wide ? 'max-w-7xl' : 'max-w-3xl'}`}>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ved-gold-600">{eyebrow}</p>
          <h1 className="mt-2 font-display text-4xl font-semibold text-ved-green-900 sm:text-5xl">{title}</h1>
          {intro && <p className="mt-3 max-w-2xl text-base text-ved-green-800/70">{intro}</p>}
          {updated && <p className="mt-3 text-xs text-ved-green-800/50">Last updated {updated}</p>}
        </div>
      </section>
      <div className={`mx-auto px-4 py-12 ${wide ? 'max-w-7xl' : 'max-w-3xl'}`}>{children}</div>
      <SiteFooter />
    </div>
  );
}

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="font-display text-2xl font-semibold text-ved-green-900">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ved-green-800/80 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
