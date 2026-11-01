import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { CommentPresetRow } from '../types/labReport';

const CATEGORIES = ['All', 'General', 'Technical', 'Interpretation', 'Critical', 'Sample issue'] as const;
type Category = (typeof CATEGORIES)[number];

type Draft = {
  mode: 'create' | 'edit';
  id?: string;
  title: string;
  category: Exclude<Category, 'All'>;
  text: string;
};

function plainOf(row: Pick<CommentPresetRow, 'text' | 'plain'>) {
  if (row.plain) return row.plain.trim();
  const html = row.text || '';
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, '').trim();
  const box = document.createElement('div');
  box.innerHTML = html;
  return (box.innerText || box.textContent || '').replace(/\u00a0/g, ' ').trim();
}

function titleOf(row: CommentPresetRow) {
  return (row.title || plainOf(row).split('\n')[0] || 'Untitled preset').trim();
}

export function RemarkPresetLibrary({
  locked,
  remarks,
  onInsert,
}: {
  locked: boolean;
  remarks: string;
  onInsert: (text: string) => void;
}) {
  const [presets, setPresets] = useState<CommentPresetRow[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('All');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    const res = await api.listCommentPresets(search.trim());
    setPresets(res.data?.presets || []);
  }, [search]);

  useEffect(() => {
    void load().catch(() => setError('Could not load the Result Entry remark library.'));
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return presets.filter((p) => {
      if (category !== 'All' && p.category !== category) return false;
      if (!q) return true;
      return `${titleOf(p)} ${plainOf(p)} ${p.category}`.toLowerCase().includes(q);
    });
  }, [category, presets, search]);

  async function submitDraft() {
    if (!draft) return;
    const text = draft.text.trim();
    if (!text) {
      setError('Preset text cannot be empty.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (draft.mode === 'edit' && draft.id && !String(draft.id).startsWith('starter-')) {
        await api.updateCommentPreset({
          preset_id: draft.id,
          title: draft.title,
          category: draft.category,
          text,
        });
      } else {
        await api.saveCommentPreset({
          title: draft.title,
          category: draft.category,
          text,
        });
      }
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save preset.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="po-library">
      <div className="po-library-head">
        <strong>Remark Template Library</strong>
        <span>Same library as Result Entry</span>
      </div>
      <label className="po-search po-library-search">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search remark templates…"
          aria-label="Search remark templates"
        />
      </label>
      <div className="po-library-cats">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={`po-chip${category === c ? ' is-on' : ''}`} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="po-library-list">
        {visible.length ? (
          visible.map((p) => (
            <article key={p.id || p.name} className="po-library-item">
              <div className="po-library-item-top">
                <b>{titleOf(p)}</b>
                <span>{p.category}</span>
              </div>
              <p>{plainOf(p)}</p>
              <div className="po-library-item-actions">
                <button type="button" className="po-chip" disabled={locked} onClick={() => onInsert(plainOf(p))}>
                  Insert
                </button>
                <button
                  type="button"
                  className="po-chip"
                  disabled={busy}
                  onClick={() =>
                    setDraft({
                      mode: 'edit',
                      id: p.id || p.name,
                      title: titleOf(p),
                      category: (CATEGORIES.includes(p.category as Category) && p.category !== 'All'
                        ? p.category
                        : 'General') as Exclude<Category, 'All'>,
                      text: plainOf(p),
                    })
                  }
                >
                  Edit
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className="po-empty">No templates match this search.</p>
        )}
      </div>
      <button
        type="button"
        className="po-chip"
        disabled={locked || !remarks.trim()}
        onClick={() =>
          setDraft({
            mode: 'create',
            title: remarks.trim().split('\n')[0].slice(0, 140),
            category: 'Interpretation',
            text: remarks.trim(),
          })
        }
      >
        Save current remarks as template
      </button>
      {error ? <p className="po-error">{error}</p> : null}

      {draft ? (
        <div className="po-modal" role="dialog" aria-modal="true">
          <div className="po-modal-card">
            <h2>{draft.mode === 'edit' ? 'Edit remark template' : 'Save to remark library'}</h2>
            <p>This updates the shared Result Entry / Pathologist remark library.</p>
            <label>
              Title
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                style={{ width: '100%', height: 40, marginTop: 6, borderRadius: 8, border: '1px solid #dbe4ea', padding: '0 10px', boxSizing: 'border-box' }}
              />
            </label>
            <label>
              Category
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as Exclude<Category, 'All'> })}
                style={{ width: '100%', height: 40, marginTop: 6, borderRadius: 8, border: '1px solid #dbe4ea', padding: '0 10px', boxSizing: 'border-box' }}
              >
                {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              placeholder="Template text"
            />
            <div className="po-actions">
              <button type="button" className="po-btn ghost" onClick={() => setDraft(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="po-btn primary" onClick={() => void submitDraft()} disabled={busy || !draft.text.trim()}>
                {busy ? 'Saving…' : draft.mode === 'edit' ? 'Update template' : 'Save template'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
