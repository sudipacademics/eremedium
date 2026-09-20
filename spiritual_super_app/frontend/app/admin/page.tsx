'use client';

import Link from 'next/link';

import { AdminGate } from '@/components/admin/AdminGate';

const CARDS = [
  {
    href: '/admin/support',
    title: 'Support board',
    body: 'Open/stuck calls, fund-drops, and recent wallet debits.',
  },
  {
    href: '/admin/puja-bookings',
    title: 'E-Puja fulfilment',
    body: 'Schedule and advance live bookings; attach video + prasad AWB.',
  },
  {
    href: '/admin/ayurveda-orders',
    title: 'Ayurveda fulfilment',
    body: 'Pack and dispatch open shop orders with tracking.',
  },
  {
    href: '/admin/home',
    title: 'Homepage CMS',
    body: 'Hero title, subtitle, image, and promo quote.',
  },
  {
    href: '/admin/articles',
    title: 'Articles',
    body: 'Create, feature, publish, or retire journal posts.',
  },
  {
    href: '/admin/pujas',
    title: 'E-Puja catalog',
    body: 'Temples and priced offerings — create, edit, activate.',
  },
  {
    href: '/admin/ayurveda',
    title: 'Ayurveda products',
    body: 'SKUs, prices, dosha tags — create and edit the shop.',
  },
  {
    href: '/admin/astrologers',
    title: 'Astrologers',
    body: 'Roster, rates, commission, and online/offline.',
  },
] as const;

export default function AdminDashboardPage() {
  return (
    <AdminGate>
      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <Link key={card.href} href={card.href} className="card hover:border-gold-400/40">
            <h2 className="font-semibold">{card.title}</h2>
            <p className="mt-1 text-sm text-slate-400">{card.body}</p>
          </Link>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Admin role is granted only via <code>ADMIN_PHONES</code> at OTP login — no self-promote API.
        Soft-delete uses the <code>active</code> flag so past bookings/orders stay intact.
      </p>
    </AdminGate>
  );
}
