'use client';

import { UPACHARAS, type Upachara } from './templeCatalog';

export function UpacharaTray({
  offered,
  busy,
  onOffer,
  onOfferAll,
  onReset,
}: {
  offered: ReadonlySet<string>;
  busy: boolean;
  onOffer: (u: Upachara) => void;
  onOfferAll: () => void;
  onReset: () => void;
}) {
  const done = offered.size;
  const total = UPACHARAS.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-ved-green-900">Shodashopachar</h2>
          <p className="text-sm text-ved-green-800/60">
            Sixteen sacred offerings · {done}/{total} complete
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || done === total}
            onClick={onOfferAll}
            className="rounded-full bg-ved-green-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Offer all
          </button>
          <button
            type="button"
            disabled={busy || done === 0}
            onClick={onReset}
            className="rounded-full border border-ved-green-900/15 bg-white px-4 py-2 text-xs font-semibold text-ved-green-800 disabled:opacity-40"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-ved-cream-200">
        <div
          className="h-full rounded-full bg-ved-gold-500 transition-all duration-500"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {UPACHARAS.map((u) => {
          const isOffered = offered.has(u.id);
          return (
            <button
              key={u.id}
              type="button"
              disabled={busy}
              onClick={() => onOffer(u)}
              className={`flex flex-col items-start gap-1 rounded-2xl border px-3 py-3 text-left transition ${
                isOffered
                  ? 'border-ved-gold-400/60 bg-ved-gold-50 shadow-sm'
                  : 'border-ved-green-900/10 bg-white hover:border-ved-green-500/30 hover:shadow-sm'
              } disabled:opacity-50`}
            >
              <span className="text-lg">{u.icon}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ved-gold-600">
                {u.index.toString().padStart(2, '0')}
              </span>
              <span className="text-xs font-semibold text-ved-green-900">{u.sanskrit}</span>
              <span className="line-clamp-2 text-[10px] text-ved-green-800/55">{u.english}</span>
              {isOffered && (
                <span className="mt-1 text-[10px] font-semibold text-ved-green-700">Offered ✓</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
