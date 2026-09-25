'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { loginHref, session } from '@/lib/api';

export function AdminGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const profile = session.profile;
    if (!session.token || !profile) {
      router.replace(loginHref(window.location.pathname));
      return;
    }
    if (profile.role !== 'ADMIN') {
      router.replace('/');
      return;
    }
    setOk(true);
  }, [router]);

  if (!ok) {
    return <p className="p-6 text-sm text-ved-green-800/60">Checking admin access…</p>;
  }

  return (
    <div className="admin-dark mx-auto max-w-5xl space-y-6 rounded-3xl bg-ved-green-950 px-4 py-6 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-ved-gold-400">Vedsutra Admin</p>
          <h1 className="font-display text-2xl font-semibold text-white">Content & operations</h1>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm">
          <Link href="/admin" className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15">
            Dashboard
          </Link>
          <Link href="/admin/support" className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15">
            Support
          </Link>
          <Link href="/admin/history" className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15">
            History
          </Link>
          <Link
            href="/admin/puja-bookings"
            className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15"
          >
            Puja ops
          </Link>
          <Link
            href="/admin/ayurveda-orders"
            className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15"
          >
            Shop ops
          </Link>
          <Link href="/admin/home" className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15">
            Homepage
          </Link>
          <Link href="/admin/hero" className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15">
            Hero slides
          </Link>
          <Link href="/admin/articles" className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15">
            Articles
          </Link>
          <Link href="/admin/footer" className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15">
            Footer
          </Link>
          <Link href="/" className="rounded-lg px-3 py-1.5 text-slate-400 hover:text-white">
            ← Site
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
