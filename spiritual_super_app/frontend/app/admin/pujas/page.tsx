'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { AdminGate } from '@/components/admin/AdminGate';
import { api } from '@/lib/api';

interface Offering {
  id: string;
  name: string;
  description: string | null;
  price: string;
  durationLabel: string | null;
  prasadIncluded: string | null;
  active: boolean;
}

interface Temple {
  id: string;
  name: string;
  location: string;
  primaryDeity: string;
  liveStreamUrl: string | null;
  active: boolean;
  offerings: Offering[];
}

export default function AdminPujasPage() {
  const [temples, setTemples] = useState<Temple[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templeForm, setTempleForm] = useState({
    name: '',
    location: '',
    primaryDeity: '',
    liveStreamUrl: '',
  });
  const [offeringForm, setOfferingForm] = useState({
    templeId: '',
    name: '',
    price: '',
    description: '',
    durationLabel: '',
    prasadIncluded: '',
  });

  const load = useCallback(() => {
    void api
      .get<{ temples: Temple[] }>('pujas/admin/catalog')
      .then((res) => {
        setTemples(res.temples);
        setOfferingForm((f) =>
          f.templeId || !res.temples[0] ? f : { ...f, templeId: res.temples[0].id },
        );
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load catalog'),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createTemple(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('pujas/admin/temples', {
        name: templeForm.name,
        location: templeForm.location,
        primaryDeity: templeForm.primaryDeity,
        ...(templeForm.liveStreamUrl ? { liveStreamUrl: templeForm.liveStreamUrl } : {}),
      });
      setTempleForm({ name: '', location: '', primaryDeity: '', liveStreamUrl: '' });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Create temple failed');
    } finally {
      setBusy(false);
    }
  }

  async function createOffering(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('pujas/admin/offerings', {
        templeId: offeringForm.templeId,
        name: offeringForm.name,
        price: offeringForm.price,
        active: true,
        ...(offeringForm.description ? { description: offeringForm.description } : {}),
        ...(offeringForm.durationLabel ? { durationLabel: offeringForm.durationLabel } : {}),
        ...(offeringForm.prasadIncluded ? { prasadIncluded: offeringForm.prasadIncluded } : {}),
      });
      setOfferingForm((f) => ({
        ...f,
        name: '',
        price: '',
        description: '',
        durationLabel: '',
        prasadIncluded: '',
      }));
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Create offering failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleTemple(temple: Temple) {
    try {
      await api.patch(`pujas/admin/temples/${temple.id}`, { active: !temple.active });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Update failed');
    }
  }

  async function saveOfferingPrice(offering: Offering, price: string) {
    try {
      await api.patch(`pujas/admin/offerings/${offering.id}`, { price });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Price update failed');
    }
  }

  async function toggleOffering(offering: Offering) {
    try {
      await api.patch(`pujas/admin/offerings/${offering.id}`, { active: !offering.active });
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Update failed');
    }
  }

  return (
    <AdminGate>
      {error && <p className="text-sm text-rose-300">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={createTemple} className="card space-y-3">
          <h2 className="font-semibold">Add temple</h2>
          <input
            className="input"
            placeholder="Name"
            value={templeForm.name}
            onChange={(e) => setTempleForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder="Location"
            value={templeForm.location}
            onChange={(e) => setTempleForm((f) => ({ ...f, location: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder="Primary deity"
            value={templeForm.primaryDeity}
            onChange={(e) => setTempleForm((f) => ({ ...f, primaryDeity: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder="Live stream URL (optional)"
            value={templeForm.liveStreamUrl}
            onChange={(e) => setTempleForm((f) => ({ ...f, liveStreamUrl: e.target.value }))}
          />
          <button type="submit" className="btn-primary" disabled={busy}>
            Create temple
          </button>
        </form>

        <form onSubmit={createOffering} className="card space-y-3">
          <h2 className="font-semibold">Add offering</h2>
          <select
            className="input"
            value={offeringForm.templeId}
            onChange={(e) => setOfferingForm((f) => ({ ...f, templeId: e.target.value }))}
            required
          >
            <option value="">Select temple…</option>
            {temples.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Puja name"
            value={offeringForm.name}
            onChange={(e) => setOfferingForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder="Price (e.g. 1100.00)"
            value={offeringForm.price}
            onChange={(e) => setOfferingForm((f) => ({ ...f, price: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder="Description"
            value={offeringForm.description}
            onChange={(e) => setOfferingForm((f) => ({ ...f, description: e.target.value }))}
          />
          <input
            className="input"
            placeholder="Duration label"
            value={offeringForm.durationLabel}
            onChange={(e) => setOfferingForm((f) => ({ ...f, durationLabel: e.target.value }))}
          />
          <input
            className="input"
            placeholder="Prasad included"
            value={offeringForm.prasadIncluded}
            onChange={(e) => setOfferingForm((f) => ({ ...f, prasadIncluded: e.target.value }))}
          />
          <button type="submit" className="btn-primary" disabled={busy || !offeringForm.templeId}>
            Create offering
          </button>
        </form>
      </div>

      <div className="space-y-4">
        {temples.map((temple) => (
          <section key={temple.id} className="card space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">
                  {temple.name}{' '}
                  <span className="text-xs font-normal text-slate-400">
                    {temple.active ? 'active' : 'hidden'}
                  </span>
                </h3>
                <p className="text-sm text-slate-400">
                  {temple.location} · {temple.primaryDeity}
                </p>
              </div>
              <button type="button" className="btn-ghost text-xs" onClick={() => void toggleTemple(temple)}>
                {temple.active ? 'Hide temple' : 'Activate temple'}
              </button>
            </div>
            <ul className="space-y-2">
              {temple.offerings.map((offering) => (
                <li
                  key={offering.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {offering.name}{' '}
                      <span className="text-xs text-slate-500">
                        {offering.active ? '' : '(inactive)'}
                      </span>
                    </p>
                    <p className="text-xs text-slate-400">{offering.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      className="input w-28 py-1.5 text-sm"
                      defaultValue={offering.price}
                      onBlur={(e) => {
                        if (e.target.value !== offering.price) {
                          void saveOfferingPrice(offering, e.target.value);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => void toggleOffering(offering)}
                    >
                      {offering.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </li>
              ))}
              {temple.offerings.length === 0 && (
                <p className="text-sm text-slate-500">No offerings yet.</p>
              )}
            </ul>
          </section>
        ))}
      </div>
    </AdminGate>
  );
}
