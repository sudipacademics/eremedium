import { useEffect, useState } from 'react';
import {
  DEAL_STAGES,
  FOLLOW_UP_OUTCOMES,
  FOLLOW_UP_TYPES,
  wingById,
  type CrmActivity,
  type DealStage,
  type FollowUpOutcome,
  type FollowUpType,
} from '../data';
import { Icon } from '../icons';
import { useCrm } from '../store';
import { ScheduleFollowUpForm } from './Forms';
import { WingPill } from './ui';

type PanelMode = 'view' | 'edit' | 'update' | 'deal';

function defaultCloseDate() {
  return new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
}

function stageFromLead(stage?: string): DealStage {
  if (stage === 'Ready to Proceed') return 'Ready for Conversion';
  if (stage === 'Proposal Required') return 'Proposal Shared';
  if (stage === 'Discussion Ongoing' || stage === 'Interested') return 'Discussion';
  if (stage === 'Qualified') return 'Opportunity Created';
  if (stage === 'Won' || stage === 'Lost') return stage;
  return 'Opportunity Created';
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function FollowUpDetailModal({
  activityId,
  onClose,
  initialMode = 'view',
  onRequestTransfer,
}: {
  activityId: string;
  onClose: () => void;
  initialMode?: PanelMode;
  onRequestTransfer?: (activityId: string) => void;
}) {
  const crm = useCrm();
  const selected = crm.activities.find((a) => a.id === activityId) || null;
  const [panelMode, setPanelMode] = useState<PanelMode>(initialMode);
  const [completeNote, setCompleteNote] = useState('');
  const [updateNote, setUpdateNote] = useState('');
  const [updateType, setUpdateType] = useState<FollowUpType>('Call');
  const [updateNextDue, setUpdateNextDue] = useState('');
  const [updateOutcome, setUpdateOutcome] = useState<FollowUpOutcome | ''>('');
  const [dealForm, setDealForm] = useState({
    title: '',
    stage: 'Opportunity Created' as DealStage,
    value: '',
    closeDate: defaultCloseDate(),
    product: '',
    probability: '50',
  });

  useEffect(() => {
    if (!selected) return;
    setPanelMode(initialMode === 'deal' ? 'view' : initialMode);
    setCompleteNote('');
    setUpdateNote('');
    setUpdateOutcome('');
    setUpdateType((FOLLOW_UP_TYPES.includes(selected.type as FollowUpType) ? selected.type : 'Call') as FollowUpType);
    setUpdateNextDue(selected.dueAt ? selected.dueAt.slice(0, 16) : '');
    if (initialMode === 'deal') openDealForm(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId]);

  if (!selected) return null;

  function openDealForm(a: CrmActivity) {
    const linked = a.leadId ? crm.leads.find((l) => l.id === a.leadId) : undefined;
    setDealForm({
      title: linked?.serviceRequired
        ? `${linked.serviceRequired} — ${a.leadName}`
        : `${wingById(a.wing).short} opportunity — ${a.leadName}`,
      stage: stageFromLead(a.leadStage || linked?.status),
      value: linked?.value ? String(linked.value) : '',
      closeDate: defaultCloseDate(),
      product: linked?.serviceRequired || linked?.franchiseModel || '',
      probability: '50',
    });
    setPanelMode('deal');
  }

  const markDone = () => {
    crm.completeActivity(selected.id, completeNote);
    crm.pushToast(`${selected.leadName} follow-up completed`);
    setCompleteNote('');
    setPanelMode('view');
  };

  const saveFollowUpUpdate = () => {
    if (!updateNote.trim()) {
      crm.pushToast('Enter a follow-up update note', 'err');
      return;
    }
    if (!updateOutcome) {
      crm.pushToast('Select a follow-up outcome', 'err');
      return;
    }
    const nextDueAt = updateNextDue ? new Date(updateNextDue).toISOString() : undefined;
    const updated = crm.logActivityUpdate(selected.id, {
      message: updateNote.trim(),
      type: updateType,
      nextDueAt,
      outcome: updateOutcome,
    });
    if (!updated) return;
    if (updateOutcome === 'Ready to proceed') {
      crm.pushToast(`Ready to proceed — create a Deal for ${selected.leadName}`);
      openDealForm(selected);
      return;
    }
    crm.pushToast(`Follow-up outcome: ${updateOutcome}`);
    setUpdateNote('');
    setUpdateOutcome('');
    setPanelMode('view');
  };

  const saveAsDeal = () => {
    if (!dealForm.title.trim()) {
      crm.pushToast('Enter a deal title', 'err');
      return;
    }
    const value = Number(String(dealForm.value).replace(/,/g, ''));
    if (!Number.isFinite(value) || value < 0) {
      crm.pushToast('Enter a valid deal value', 'err');
      return;
    }
    if (selected.dealId) {
      crm.pushToast(`Already linked to deal ${selected.dealId}`, 'err');
      return;
    }
    const probability = Number(dealForm.probability);
    const deal = crm.createDealFromFollowUp(selected.id, {
      title: dealForm.title.trim(),
      stage: dealForm.stage,
      value,
      closeDate: dealForm.closeDate,
      product: dealForm.product.trim() || undefined,
      probability: Number.isFinite(probability) ? probability : 50,
    });
    if (!deal) {
      crm.pushToast('Could not create deal', 'err');
      return;
    }
    crm.pushToast(`Deal ${deal.id} created · synced to Deals & Opportunities`);
    setPanelMode('view');
  };

  return (
    <div className="detail-popup" role="dialog" aria-modal="true" aria-label={`${selected.leadName} follow-up`}>
      <button type="button" className="detail-popup-backdrop" aria-label="Close" onClick={onClose} />
      <div className="detail-popup-panel fu-detail">
        <div className="fu-detail-head">
          <div>
            <h2>{selected.leadName}</h2>
            <p>
              {selected.mobile || 'No mobile'}
              {selected.leadId ? ` · ${selected.leadId}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <WingPill wing={selected.wing} />
            {crm.isManager && onRequestTransfer ? (
              <button
                type="button"
                className="icon-btn"
                title="Transfer follow-up"
                aria-label="Transfer"
                onClick={() => onRequestTransfer(selected.id)}
              >
                <Icon name="accounts" size={16} />
              </button>
            ) : null}
            <button type="button" className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>

        {panelMode !== 'view' ? (
          <div className="fu-tabs" style={{ borderBottom: '1px solid var(--line)', marginBottom: 12 }}>
            <button type="button" className="fu-tab" onClick={() => setPanelMode('view')}>
              ← Back
            </button>
            <button type="button" className="fu-tab active">
              {panelMode === 'update' ? 'Follow-up update' : panelMode === 'deal' ? 'Mark as Deal' : 'Edit follow-up'}
            </button>
          </div>
        ) : null}

        <div className="detail-popup-body">
          {panelMode === 'edit' ? (
            <ScheduleFollowUpForm
              key={`fu-edit-${selected.id}`}
              formId="fu-popup-edit-form"
              compact
              initial={selected}
              onClose={() => setPanelMode('view')}
            />
          ) : panelMode === 'deal' ? (
            <div className="fu-update-form">
              <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: '0.82rem' }}>
                Creates a deal in <strong>Deals & Opportunities</strong> and updates the linked lead stage.
              </p>
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Deal title *</span>
                <input
                  value={dealForm.title}
                  onChange={(e) => setDealForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. HydraFacial package — Riya Das"
                  autoFocus
                />
              </label>
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Stage *</span>
                <select
                  value={dealForm.stage}
                  onChange={(e) => setDealForm((f) => ({ ...f, stage: e.target.value as DealStage }))}
                >
                  {DEAL_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Product / service / model</span>
                <input
                  value={dealForm.product}
                  onChange={(e) => setDealForm((f) => ({ ...f, product: e.target.value }))}
                  placeholder="HydraFacial / FOFO / Corporate package"
                />
              </label>
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Deal value (₹) *</span>
                <input
                  value={dealForm.value}
                  onChange={(e) => setDealForm((f) => ({ ...f, value: e.target.value }))}
                  inputMode="numeric"
                  placeholder="45000"
                />
              </label>
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Probability of conversion (%)</span>
                <input
                  value={dealForm.probability}
                  onChange={(e) => setDealForm((f) => ({ ...f, probability: e.target.value }))}
                  inputMode="numeric"
                  placeholder="50"
                />
              </label>
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Expected close date *</span>
                <input
                  type="date"
                  value={dealForm.closeDate}
                  onChange={(e) => setDealForm((f) => ({ ...f, closeDate: e.target.value }))}
                />
              </label>
              <div className="meta-stats">
                <div>
                  <span>Lead</span>
                  <strong>{selected.leadName}</strong>
                </div>
                <div>
                  <span>Wing</span>
                  <strong>{wingById(selected.wing).name}</strong>
                </div>
              </div>
            </div>
          ) : panelMode === 'update' ? (
            <div className="fu-update-form">
              <div className="meta-stats" style={{ marginBottom: 12 }}>
                <div>
                  <span>Lead</span>
                  <strong>{selected.leadName}</strong>
                </div>
                <div>
                  <span>Current next</span>
                  <strong>{fmtWhen(selected.dueAt)}</strong>
                </div>
              </div>
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Update type *</span>
                <select value={updateType} onChange={(e) => setUpdateType(e.target.value as FollowUpType)}>
                  {FOLLOW_UP_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Outcome *</span>
                <select
                  value={updateOutcome}
                  onChange={(e) => setUpdateOutcome(e.target.value as FollowUpOutcome | '')}
                  required
                >
                  <option value="">Select outcome</option>
                  {FOLLOW_UP_OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Follow-up update *</span>
                <textarea
                  rows={3}
                  value={updateNote}
                  onChange={(e) => setUpdateNote(e.target.value)}
                  placeholder="What happened on this follow-up? Call outcome, interest, next step…"
                  autoFocus
                />
              </label>
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Reschedule next follow-up</span>
                <input type="datetime-local" value={updateNextDue} onChange={(e) => setUpdateNextDue(e.target.value)} />
              </label>
              <h3 style={{ margin: '4px 0 8px', fontSize: '0.9rem' }}>Recent history</h3>
              <div className="timeline">
                {(selected.history || []).slice(0, 4).map((h, i) => (
                  <div key={`${h.at}-${i}`} className="tl-item">
                    <span>
                      {fmtWhen(h.at)} · {h.type} · {h.actor}
                    </span>
                    <strong>{h.message}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="meta-stats" style={{ marginBottom: 12 }}>
                <div>
                  <span>Lead stage</span>
                  <strong>{selected.leadStage || '—'}</strong>
                </div>
                <div>
                  <span>Follow-up type</span>
                  <strong>{selected.type}</strong>
                </div>
                <div>
                  <span>Next follow-up</span>
                  <strong>{fmtWhen(selected.dueAt)}</strong>
                </div>
                <div>
                  <span>Assigned to</span>
                  <strong>{selected.owner}</strong>
                </div>
              </div>

              {selected.branch ? (
                <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: '0.82rem' }}>
                  Branch: <b style={{ color: 'var(--ink)' }}>{selected.branch}</b> · {wingById(selected.wing).name}
                </p>
              ) : null}

              <label className="field" style={{ marginBottom: 12 }}>
                <span>Notes</span>
                <textarea
                  rows={3}
                  value={selected.notes || ''}
                  onChange={(e) => crm.updateActivity(selected.id, { notes: e.target.value })}
                  placeholder="Context from last interaction…"
                />
              </label>

              <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>Follow-up history</h3>
              <div className="timeline" style={{ marginBottom: 14 }}>
                {(selected.history || []).length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.82rem' }}>No history yet.</p>
                ) : (
                  (selected.history || []).map((h, i) => (
                    <div key={`${h.at}-${i}`} className="tl-item">
                      <span>
                        {fmtWhen(h.at)} · {h.type} · {h.actor}
                      </span>
                      <strong>{h.message}</strong>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="detail-popup-actions">
          {panelMode === 'edit' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setPanelMode('view')}>
                Cancel
              </button>
              <button type="submit" form="fu-popup-edit-form" className="btn btn-primary" style={{ flex: 1 }}>
                Save changes
              </button>
            </div>
          ) : panelMode === 'update' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setPanelMode('view')}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={saveFollowUpUpdate}>
                Save update
              </button>
            </div>
          ) : panelMode === 'deal' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setPanelMode('view')}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={saveAsDeal}>
                Create deal
              </button>
            </div>
          ) : !selected.done ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setPanelMode('edit')}>
                  <Icon name="edit" size={15} /> Edit
                </button>
                <button
                  type="button"
                  className="btn lm-sched"
                  onClick={() => {
                    setUpdateNote('');
                    setUpdateType(
                      (FOLLOW_UP_TYPES.includes(selected.type as FollowUpType) ? selected.type : 'Call') as FollowUpType,
                    );
                    setUpdateNextDue(selected.dueAt ? selected.dueAt.slice(0, 16) : '');
                    setPanelMode('update');
                  }}
                >
                  <Icon name="plus" size={15} /> Update
                </button>
              </div>
              {selected.dealId ? (
                <div className="status Qualified" style={{ justifyContent: 'center', padding: '8px', marginBottom: 8 }}>
                  Linked deal {selected.dealId}
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ width: '100%', marginBottom: 10, borderColor: '#bfdbfe', background: '#eff6ff' }}
                  onClick={() => openDealForm(selected)}
                >
                  <Icon name="deals" size={15} /> Mark as Deals & Opportunities
                </button>
              )}
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Completion note</span>
                <input
                  value={completeNote}
                  onChange={(e) => setCompleteNote(e.target.value)}
                  placeholder="Outcome of this follow-up…"
                />
              </label>
              <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={markDone}>
                Mark as Completed
              </button>
            </>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {!selected.dealId ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ borderColor: '#bfdbfe', background: '#eff6ff' }}
                  onClick={() => openDealForm(selected)}
                >
                  <Icon name="deals" size={15} /> Mark as Deals & Opportunities
                </button>
              ) : (
                <div className="status Qualified" style={{ justifyContent: 'center', padding: '8px' }}>
                  Linked deal {selected.dealId}
                </div>
              )}
              <button
                type="button"
                className="btn lm-sched"
                onClick={() => {
                  setUpdateNote('');
                  setUpdateType(
                    (FOLLOW_UP_TYPES.includes(selected.type as FollowUpType) ? selected.type : 'Call') as FollowUpType,
                  );
                  setUpdateNextDue(selected.dueAt ? selected.dueAt.slice(0, 16) : '');
                  setPanelMode('update');
                }}
              >
                <Icon name="plus" size={15} /> Add follow-up update
              </button>
              <div className="status Completed" style={{ justifyContent: 'center', padding: '10px' }}>
                Completed {selected.completedAt ? fmtWhen(selected.completedAt) : ''}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
