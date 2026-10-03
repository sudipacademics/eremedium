'use client';

import Link from 'next/link';

import { AdminGate } from '@/components/admin/AdminGate';
import { TestimonialManager } from '@/components/admin/reviews/TestimonialManager';
import { VideoManager } from '@/components/admin/reviews/VideoManager';

export default function AdminReviewsPage() {
  return (
    <AdminGate>
      <div className="space-y-8">
        <p className="text-sm text-slate-400">
          Each slide of the homepage &ldquo;Reviews&rdquo; carousel shows one published video between two published
          testimonials. The &ldquo;Watch all Reviews on YouTube&rdquo; button uses the YouTube link in{' '}
          <Link href="/admin/footer" className="underline">
            Footer settings
          </Link>
          .
        </p>
        <VideoManager />
        <TestimonialManager />
      </div>
    </AdminGate>
  );
}
