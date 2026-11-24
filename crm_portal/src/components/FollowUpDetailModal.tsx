import { useEffect, useMemo, useState } from 'react';
import {
  FOLLOW_UP_OUTCOMES,
  FOLLOW_UP_TYPES,
  LEAD_STATUSES,
  LOST_REASONS,
  franchiseVerticalLabel,
  leadStatusToDealStage,
  normalizeLeadStatus,
  wingById,
  type CrmActivity,
  type DealStage,
  type FollowUpOutcome,
  type FollowUpType,
  type LeadStatus,
  type LostReason,
} from '../data';
import { sendCrmWhatsApp, syncCrmLeadStatusToReach } from '../crmApi';
import { Icon } from '../icons';
import { loadMessageTemplates } from '../settingsData';
import { useCrm } from '../store';
import { ScheduleFollowUpForm } from './Forms';
import { WingPill } from './ui';

type PanelMode = 'view' | 'edit' | 'update' | 'deal' | 'whatsapp';

function defaultCloseDate() {
  return new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
}

function stageFromLead(stage?: string): DealStage {
  return leadStatusToDealStage(stage || 'New') || 'Opportunity Created';
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function whatsappChannelForWing(wing?: string): 'franchise' | 'service' {
  return wing === 'franchise' || wing === 'nexilab' ? 'franchise' : 'service';
}

function defaultWhatsAppBody(leadName: string, wing?: string, serviceRequired?: string) {
  const name = leadName.split(' ')[0] || leadName;
  if (whatsappChannelForWing(wing) === 'franchise') {
    return `Hi ${name}, this is Smilecure following up on your franchise enquiry. When is a good time to connect?`;
  }
  const service =
    serviceRequired?.trim() ||
    (wing === 'aesthetic'
      ? 'aesthetic consultation'
      : wing === 'care'
        ? 'care consultation'
        : wing === 'lab'
          ? 'lab enquiry'
          : 'consultation');
  return `Hi ${name}, this is Smilecure following up on your ${service}. When is a good time to connect?`;
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
  const [lostReason, setLostReason] = useState<LostReason | ''>('');
  const [lostNote, setLostNote] = useState('');
  const [pendingLost, setPendingLost] = useState(false);
  const [waBody, setWaBody] = useState('');
  const [waSending, setWaSending] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setPanelMode(initialMode === 'deal' ? 'view' : initialMode);
    setCompleteNote('');
    setUpdateNote('');
    setUpdateOutcome('');
    setUpdateType((FOLLOW_UP_TYPES.includes(selected.type as FollowUpType) ? selected.type : 'Call') as FollowUpType);
    setUpdateNextDue(selected.dueAt ? selected.dueAt.slice(0, 16) : '');
    setWaSending(false);
    if (initialMode === 'whatsapp') {
      const lead = selected.leadId
        ? crm.leads.find((l) => l.id === selected.leadId)
        : crm.leads.find(
            (l) => l.name === selected.leadName && (!selected.mobile || l.mobile === selected.mobile),
          );
      setWaBody(defaultWhatsAppBody(selected.leadName, selected.wing, lead?.serviceRequired));
    } else {
      setWaBody('');
    }
    if (initialMode === 'deal') openDealForm(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId]);

  const waTemplates = useMemo(() => {
    const wing = selected?.wing || 'franchise';
    return loadMessageTemplates().filter(
      (t) => t.status === 'active' && (t.wing === 'all' || t.wing === wing),
    );
  }, [selected?.wing]);

  const linkedLead = useMemo(() => {
    if (!selected) return null;
    if (selected.leadId) return crm.leads.find((l) => l.id === selected.leadId) || null;
    return (
      crm.leads.find(
        (l) => l.name === selected.leadName && (!selected.mobile || l.mobile === selected.mobile),
      ) || null
    );
  }, [crm.leads, selected]);

  if (!selected) return null;

  const currentLeadStatus = normalizeLeadStatus(linkedLead?.status || selected.leadStage || 'New');

  const applyLeadStatus = (next: LeadStatus) => {
    const updated = crm.setLeadStatusFromFollowUp(selected.id, next);
    const lead = updated || linkedLead;
    if (lead && (lead.reachLeadId || lead.reachAssignedAt)) {
      void syncCrmLeadStatusToReach(lead.id, next).catch(() => {
        /* soft */
      });
    }
    if (!updated && !selected.leadId && !selected.mobile) {
      crm.pushToast('Could not link this follow-up to a lead — status saved on follow-up only', 'err');
      return;
    }
    crm.pushToast(`Lead status → ${next}`);
  };

  const changeLeadStatus = (next: LeadStatus) => {
    if (next === currentLeadStatus) return;
    if (next === 'Lost' || next === 'Not Interested') {
      setPendingLost(true);
      setLostReason('');
      setLostNote('');
      return;
    }
    setPendingLost(false);
    applyLeadStatus(next);
  };

  const confirmLostFromPanel = () => {
    if (!lostReason) {
      crm.pushToast('Lost reason is mandatory', 'err');
      return;
    }
    const leadId = linkedLead?.id || selected.leadId;
    if (leadId) {
      crm.closeLeadLost(leadId, lostReason, lostNote);
      const lead = linkedLead || crm.leads.find((l) => l.id === leadId);
      if (lead && (lead.reachLeadId || lead.reachAssignedAt)) {
        void syncCrmLeadStatusToReach(lead.id, 'Lost').catch(() => {
          /* soft */
        });
      }
    }
    crm.setLeadStatusFromFollowUp(selected.id, 'Lost');
    setPendingLost(false);
    crm.pushToast(`Lead status → Lost · ${lostReason}`);
  };

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
    if (updateOutcome === 'Not interested') {
      setPendingLost(true);
      setLostReason('');
      setLostNote(updateNote.trim());
      crm.pushToast('Select a lost reason — deal will sync as Lost from this follow-up');
      return;
    }
    if (updateOutcome === 'Ready to proceed') {
      crm.pushToast(`Ready to proceed — create a Deal for ${selected.leadName}`);
      openDealForm(selected);
      return;
    }
    crm.pushToast(`Follow-up outcome: ${updateOutcome} · deal stage synced`);
    setUpdateNote('');
    setUpdateOutcome('');
    setPanelMode('view');
  };

  const sendWhatsApp = async () => {
    const mobile = selected.mobile || linkedLead?.mobile || '';
    if (!mobile) {
      crm.pushToast('No mobile number on this follow-up', 'err');
      return;
    }
    const body = waBody.trim();
    if (!body) {
      crm.pushToast('Enter a WhatsApp message', 'err');
      return;
    }
    const channel = whatsappChannelForWing(selected.wing);
    setWaSending(true);
    try {
      await sendCrmWhatsApp({
        phone: mobile,
        message: body,
        contactName: selected.leadName,
        crmLeadId: selected.leadId || linkedLead?.id,
        wing: selected.wing || linkedLead?.wing || (channel === 'franchise' ? 'franchise' : 'lab'),
        channel,
      });
      crm.logActivityUpdate(selected.id, {
        message: `WhatsApp sent · ${body.slice(0, 180)}`,
        type: 'WhatsApp',
        outcome: 'Discussion ongoing',
      });
      crm.pushToast(`WhatsApp sent to ${selected.leadName}`);
      setWaBody('');
      setPanelMode('view');
    } catch (err) {
      crm.pushToast(err instanceof Error ? err.message : 'WhatsApp send failed', 'err');
    } finally {
      setWaSending(false);
    }
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <WingPill wing={selected.wing} />
            <select
              className="inline-select"
              value={currentLeadStatus}
              aria-label="Lead status"
              title="Change lead status"
              onChange={(e) => changeLeadStatus(e.target.value as LeadStatus)}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
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
            {crm.isManager ? (
              <button
                type="button"
                className="icon-btn"
                title="Delete follow-up"
                aria-label="Delete"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Delete follow-up for ${selected.leadName}? This cannot be undone.`,
                    )
                  ) {
                    return;
                  }
                  const { deleted } = crm.deleteActivities([selected.id]);
                  crm.pushToast(
                    deleted ? 'Follow-up deleted' : 'Could not delete follow-up',
                    deleted ? 'ok' : 'err',
                  );
                  if (deleted) onClose();
                }}
              >
                <Icon name="xcircle" size={16} />
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
              {panelMode === 'update'
                ? 'Follow-up update'
                : panelMode === 'deal'
                  ? 'Mark as Deal'
                  : panelMode === 'whatsapp'
                    ? 'WhatsApp'
                    : 'Edit follow-up'}
            </button>
          </div>
        ) : null}

        <div className="detail-popup-body">
          {panelMode === 'whatsapp' ? (
            <div className="fu-update-form">
              <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: '0.82rem' }}>
                {whatsappChannelForWing(selected.wing) === 'franchise'
                  ? 'Franchise WhatsApp (shared Meta number).'
                  : 'Service WhatsApp (Settings → WhatsApp API → Service).'}{' '}
                To: <strong style={{ color: 'var(--ink)' }}>{selected.mobile || linkedLead?.mobile || '—'}</strong>
              </p>
              {waTemplates.length ? (
                <label className="field" style={{ marginBottom: 10 }}>
                  <span>Template</span>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const tpl = waTemplates.find((t) => t.id === e.target.value);
                      if (!tpl) return;
                      const name = selected.leadName.split(' ')[0] || selected.leadName;
                      setWaBody(
                        tpl.body
                          .replace(/\{\{\s*name\s*\}\}/gi, name)
                          .replace(
                            /\{\{\s*service\s*\}\}/gi,
                            linkedLead?.serviceRequired ||
                              franchiseVerticalLabel(linkedLead?.franchiseVertical) ||
                              wingById(selected.wing).name ||
                              'enquiry',
                          )
                          .replace(/\{\{\s*branch\s*\}\}/gi, selected.branch || linkedLead?.city || 'our team'),
                      );
                    }}
                  >
                    <option value="">Choose a message template…</option>
                    {waTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field" style={{ marginBottom: 10 }}>
                <span>Message *</span>
                <textarea
                  rows={5}
                  value={waBody}
                  onChange={(e) => setWaBody(e.target.value)}
                  placeholder="Hi … following up on your enquiry…"
                  autoFocus
                />
              </label>
            </div>
          ) : panelMode === 'edit' ? (
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
                <span>Stage (from follow-up)</span>
                <input value={dealForm.stage} readOnly />
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
                  <span>Lead status</span>
                  <strong>
                    <select
                      className="inline-select"
                      value={currentLeadStatus}
                      aria-label="Lead status"
                      onChange={(e) => changeLeadStatus(e.target.value as LeadStatus)}
                      style={{ marginTop: 4, maxWidth: '100%' }}
                    >
                      {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </strong>
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

              {pendingLost ? (
                <div className="fu-update-form" style={{ marginBottom: 12 }}>
                  <p style={{ margin: '0 0 8px', fontSize: '0.8rem', color: 'var(--muted)' }}>
                    Select a lost reason to close this lead.
                  </p>
                  <label className="field" style={{ marginBottom: 8 }}>
                    <span>Lost reason *</span>
                    <select
                      value={lostReason}
                      onChange={(e) => setLostReason(e.target.value as LostReason | '')}
                      autoFocus
                    >
                      <option value="">Select reason…</option>
                      {LOST_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field" style={{ marginBottom: 8 }}>
                    <span>Note (optional)</span>
                    <input value={lostNote} onChange={(e) => setLostNote(e.target.value)} placeholder="Extra context…" />
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-ghost" onClick={() => setPendingLost(false)}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-primary" onClick={confirmLostFromPanel} disabled={!lostReason}>
                      Mark Lost
                    </button>
                  </div>
                </div>
              ) : null}

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
          {panelMode === 'whatsapp' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setPanelMode('view')}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={waSending}
                onClick={() => void sendWhatsApp()}
              >
                {waSending ? 'Sending…' : 'Send WhatsApp'}
              </button>
            </div>
          ) : panelMode === 'edit' ? (
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
              {selected.mobile || linkedLead?.mobile ? (
                <button
                  type="button"
                  className="btn lm-wa"
                  style={{ width: '100%', marginBottom: 8 }}
                  onClick={() => {
                    setWaBody(
                      defaultWhatsAppBody(
                        selected.leadName,
                        selected.wing,
                        linkedLead?.serviceRequired,
                      ),
                    );
                    setPanelMode('whatsapp');
                  }}
                >
                  <Icon name="whatsapp" size={15} /> WhatsApp follow-up
                </button>
              ) : null}
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
