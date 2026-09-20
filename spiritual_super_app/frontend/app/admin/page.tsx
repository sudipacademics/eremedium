'use client';

import Link from 'next/link';

import { AdminGate } from '@/components/admin/AdminGate';

export default function AdminDashboardPage() {
  return (
    <AdminGate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/home" className="card hover:border-gold-400/40">
          <h2 className="font-semibold">Homepage CMS</h2>
          <p className="mt-1 text-sm text-slate-400">
            Edit hero title, subtitle, image, and promo quote shown on `/`.
          </p>
        </Link>
        <Link href="/admin/articles" className="card hover:border-gold-400/40">
          <h2 className="font-semibold">Articles</h2>
          <p className="mt-1 text-sm text-slate-400">
            Create, feature, publish, or retire marketing articles.
          </p>
        </Link>
        <div className="card">
          <h2 className="font-semibold">Puja fulfilment</h2>
          <p className="mt-1 text-sm text-slate-400">
            API: <code className="text-xs">GET /api/v1/pujas/admin/fulfilment</code>
          </p>
        </div>
        <div className="card">
          <h2 className="font-semibold">Ayurveda fulfilment</h2>
          <p className="mt-1 text-sm text-slate-400">
            API: <code className="text-xs">GET /api/v1/ayurveda/shop/admin/fulfilment</code>
          </p>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Admin role is granted only via <code>ADMIN_PHONES</code> at OTP login — no self-promote API.
      </p>
    </AdminGate>
  );
}
