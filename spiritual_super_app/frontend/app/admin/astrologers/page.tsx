'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api, astrologerPhotoUrl } from '@/lib/api';
import { resizeSquarePhoto } from '@/lib/photo';

const PHOTO_SIZE = 320;

interface AdminAstrologer {
  id: string;
  displayName: string;
  perMinuteRate: string;
  commissionSplit: string;
  status: string;
  languages: string[];
  expertise: string[];
  experienceYears: number | null;
  photoVersion: number | null;
  phone: string;
  userName: string | null;
  createdAt: string;
}

function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export default function AdminAstrologersPage() {
  const [rows, setRows] = useState<AdminAstrologer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .get<{ astrologers: AdminAstrologer[] }>('astrologers/admin/roster')
      .then((res) => setRows(res.astrologers))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load roster'),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(row: AdminAstrologer, body: Record<string, unknown>, done: string, failure: string) {
    setError(null);
    setMessage(null);
    try {
      await api.patch(`astrologers/admin/${row.id}`, body);
      setMessage(`${row.displayName}: ${done}`);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : failure);
    }
  }

  async function onPhoto(row: AdminAstrologer, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const photoDataUrl = await resizeSquarePhoto(file, PHOTO_SIZE, 0.82);
      await patch(row, { photoDataUrl }, 'photo updated', 'Photo upload failed');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read that image');
    }
  }

  return (
    <AdminGate>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {message && <p className="text-sm text-emerald-300">{message}</p>}
      <p className="text-sm text-slate-400">
        New astrologers still apply from <strong>My console</strong>. Here you set the public profile shown on the
        homepage (photo, expertise, languages, experience), rates, commission and online status. Busy / in-call
        cannot be forced offline mid-session. Changes appear on the homepage within about 30 seconds.
      </p>

      <div className="space-y-2">
        {rows.map((row) => {
          const photo = astrologerPhotoUrl(row);
          return (
            <article key={row.id} className="card space-y-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-white/10">
                    {photo ? (
                      <Image src={photo} alt="" width={56} height={56} unoptimized className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full place-items-center text-lg font-semibold text-slate-300">
                        {row.displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="font-medium">{row.displayName}</p>
                    <p className="text-xs text-slate-400">
                      {row.phone} · status <span className="text-saffron-300">{row.status}</span>
                    </p>
                    <div className="mt-1 flex gap-3 text-xs">
                      <label className="cursor-pointer text-ved-gold-300 hover:underline">
                        {photo ? 'Replace photo' : 'Upload photo'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="sr-only"
                          onChange={(e) => void onPhoto(row, e)}
                        />
                      </label>
                      {photo && (
                        <button
                          type="button"
                          className="text-slate-400 hover:text-rose-300"
                          onClick={() => void patch(row, { photoDataUrl: null }, 'photo removed', 'Could not remove photo')}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    disabled={row.status === 'BUSY' || row.status === 'IN_CALL'}
                    onClick={() => void patch(row, { online: true }, 'now online', 'Availability update failed')}
                  >
                    Go online
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    disabled={row.status === 'BUSY' || row.status === 'IN_CALL'}
                    onClick={() => void patch(row, { online: false }, 'now offline', 'Availability update failed')}
                  >
                    Go offline
                  </button>
                </div>
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <label className="block">
                  <span className="label">Expertise (comma-separated, up to 8)</span>
                  <input
                    className="input py-1.5"
                    placeholder="Vedic, Numerology, Tarot"
                    defaultValue={row.expertise.join(', ')}
                    onBlur={(e) => {
                      const next = splitTags(e.target.value);
                      if (next.join(',') !== row.expertise.join(',')) {
                        void patch(row, { expertise: next }, 'expertise saved', 'Expertise update failed');
                      }
                    }}
                  />
                </label>
                <label className="block">
                  <span className="label">Languages (comma-separated)</span>
                  <input
                    className="input py-1.5"
                    placeholder="English, Hindi"
                    defaultValue={row.languages.join(', ')}
                    onBlur={(e) => {
                      const next = splitTags(e.target.value);
                      if (next.length > 0 && next.join(',') !== row.languages.join(',')) {
                        void patch(row, { languages: next }, 'languages saved', 'Languages update failed');
                      }
                    }}
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-2">
                  Experience (yrs)
                  <input
                    className="input w-20 py-1.5"
                    inputMode="numeric"
                    defaultValue={row.experienceYears ?? ''}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const next = raw === '' ? null : Number(raw);
                      if (next !== row.experienceYears) {
                        void patch(row, { experienceYears: next }, 'experience saved', 'Experience must be 0–80 years');
                      }
                    }}
                  />
                </label>
                <label className="flex items-center gap-2">
                  ₹/min
                  <input
                    className="input w-24 py-1.5"
                    defaultValue={row.perMinuteRate}
                    onBlur={(e) => {
                      if (e.target.value !== row.perMinuteRate) {
                        void patch(row, { perMinuteRate: e.target.value }, 'rate saved', 'Rate update failed');
                      }
                    }}
                  />
                </label>
                <label className="flex items-center gap-2">
                  Commission (0–1)
                  <input
                    className="input w-24 py-1.5"
                    defaultValue={row.commissionSplit}
                    onBlur={(e) => {
                      if (e.target.value !== row.commissionSplit) {
                        void patch(row, { commissionSplit: e.target.value }, 'commission saved', 'Commission update failed');
                      }
                    }}
                  />
                </label>
              </div>
            </article>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-slate-500">No astrologer profiles yet.</p>}
      </div>
    </AdminGate>
  );
}
