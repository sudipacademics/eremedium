import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  api,
  HrPolicySnippet,
  StaffAppraisalRow,
  StaffPerformanceHub,
  TrainingEventRow,
  TrainingFile,
  TrainingProgramRow,
} from '../../api';
import './collector-v2.css';

type ContentTab = 'all' | 'video' | 'sop' | 'guidelines' | 'assessments';
type Detail =
  | { kind: 'event'; id: string }
  | { kind: 'program'; id: string }
  | { kind: 'policy'; id: string }
  | { kind: 'appraisal'; id: string }
  | { kind: 'feedback'; id: string }
  | null;

function Ico({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function matchesQuery(query: string, ...parts: Array<string | undefined | null>) {
  if (!query) return true;
  return parts.some((part) => (part || '').toLowerCase().includes(query));
}

function isCompletedEvent(event: TrainingEventRow) {
  const status = (event.event_status || '').toLowerCase();
  const attendance = (event.attendance || '').toLowerCase();
  return status === 'completed' || attendance === 'present';
}

function isVideoFile(file?: TrainingFile) {
  return (file?.kind || '').toLowerCase() === 'video';
}

function isDocumentFile(file?: TrainingFile) {
  return (file?.kind || '').toLowerCase() === 'document';
}

function eventHasVideo(event: TrainingEventRow) {
  const type = (event.type || '').toLowerCase();
  if (/\b(video|online|webinar|e-?learn)\b/.test(type)) return true;
  return (event.files || []).some(isVideoFile);
}

function textLooksLikeSop(...parts: Array<string | undefined | null>) {
  return /\bsop\b|standard operating|nabl|quality|infection|label|biohazard|waste|home visit|emergency/.test(
    parts.join(' ').toLowerCase(),
  );
}

function programDocuments(program: TrainingProgramRow) {
  return (program.files || []).filter(isDocumentFile);
}

function eventDocuments(event: TrainingEventRow) {
  return (event.files || []).filter(isDocumentFile);
}

function formatBytes(size?: number) {
  if (!size || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 16);
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(start?: string, end?: string) {
  if (!start || !end) return '';
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (!from || !to || to <= from) return '';
  const mins = Math.round((to - from) / 60000);
  if (mins >= 8 * 60) return '';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function fileHref(url?: string) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith('/') ? url : `/${url}`;
}

function ProgressRing({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const radius = 34;
  const circ = 2 * Math.PI * radius;
  return (
    <svg className="cts-ring" viewBox="0 0 88 88" aria-hidden>
      <circle className="cts-ring-track" cx="44" cy="44" r={radius} />
      <circle
        className="cts-ring-value"
        cx="44"
        cy="44"
        r={radius}
        strokeDasharray={`${(pct / 100) * circ} ${circ}`}
      />
      <text x="44" y="49">{pct}%</text>
    </svg>
  );
}

function moduleTone(title: string) {
  const text = title.toLowerCase();
  if (text.includes('tube') || text.includes('type')) return 'rose';
  if (text.includes('label') || text.includes('barcode')) return 'amber';
  if (text.includes('waste') || text.includes('bio')) return 'slate';
  if (text.includes('patient') || text.includes('service') || text.includes('communic')) return 'sky';
  if (text.includes('storage') || text.includes('transport') || text.includes('erp')) return 'indigo';
  if (text.includes('nabl') || text.includes('quality')) return 'teal';
  return 'teal';
}

function GuidelineIcon({ slug }: { slug: string }) {
  if (slug.includes('leave') || slug.includes('attendance')) {
    return (
      <Ico>
        <path d="M9 11l2 2 4-4" />
        <rect x="4" y="4" width="16" height="16" rx="3" />
      </Ico>
    );
  }
  if (slug.includes('salary') || slug.includes('allowance') || slug.includes('incentive')) {
    return (
      <Ico>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v8M9.5 10.5h4.2a1.8 1.8 0 0 1 0 3.6H9.5" />
      </Ico>
    );
  }
  if (slug.includes('conduct') || slug.includes('supervis')) {
    return (
      <Ico>
        <path d="M12 3l7 4v5c0 5-3.2 7.8-7 9-3.8-1.2-7-4-7-9V7z" />
      </Ico>
    );
  }
  return (
    <Ico>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5M12 16h.01" />
    </Ico>
  );
}

export function PhlebotomistTrainingPage() {
  const videoRef = useRef<HTMLElement | null>(null);
  const sopRef = useRef<HTMLElement | null>(null);
  const guideRef = useRef<HTMLElement | null>(null);
  const assessRef = useRef<HTMLElement | null>(null);

  const [data, setData] = useState<StaffPerformanceHub | null>(null);
  const [tab, setTab] = useState<ContentTab>('all');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Detail>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reflections, setReflections] = useState('');
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [feedbackRating, setFeedbackRating] = useState('4');
  const [feedbackText, setFeedbackText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [hubRes, policyRes] = await Promise.all([
        api.getStaffPerformanceHub(),
        api.listHrPolicySnippets().catch(() => null),
      ]);
      const hub = hubRes.data;
      if (!hub.policies?.length && policyRes?.data.policies?.length) {
        hub.policies = policyRes.data.policies;
      }
      setData(hub);
      const firstAppraisal = hub.appraisals?.[0];
      if (firstAppraisal?.reflections) setReflections(firstAppraisal.reflections);
      const initial: Record<string, number> = {};
      for (const row of firstAppraisal?.self_ratings || []) {
        if (row.criteria) initial[row.criteria] = Number(row.rating || 0);
      }
      setRatings(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load training');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const events = useMemo(
    () =>
      (data?.training_events || []).filter((row) =>
        matchesQuery(q, row.event_name, row.training_program, row.introduction, row.type, row.event_status),
      ),
    [data, q],
  );
  const programs = useMemo(
    () =>
      (data?.training_programs || []).filter((row) =>
        matchesQuery(q, row.training_program, row.description, row.status),
      ),
    [data, q],
  );
  const policies = useMemo(
    () => (data?.policies || []).filter((row) => matchesQuery(q, row.name, row.slug, row.body)),
    [data, q],
  );
  const appraisals = useMemo(
    () =>
      (data?.appraisals || []).filter((row) =>
        matchesQuery(q, row.appraisal_cycle, row.appraisal_template, row.name, row.reflections),
      ),
    [data, q],
  );
  const kras = useMemo(
    () => (data?.kras || []).filter((row) => matchesQuery(q, row.title, row.description, row.name)),
    [data, q],
  );

  const videoEvents = events.filter(eventHasVideo);
  const sessionEvents = videoEvents.length ? videoEvents : events;
  const sopPrograms = programs.filter(
    (row) => textLooksLikeSop(row.training_program, row.description) || programDocuments(row).length > 0,
  );
  const sopEvents = events.filter(
    (row) => textLooksLikeSop(row.event_name, row.training_program, row.introduction) || eventDocuments(row).length > 0,
  );
  const sopList = sopPrograms.length || sopEvents.length ? { programs: sopPrograms, events: sopEvents } : { programs, events: [] };

  const completed = events.filter(isCompletedEvent).length;
  const remaining = Math.max(events.length - completed, 0);
  const assessmentsPassed = appraisals.filter((row) => row.self_score != null).length;
  const moduleTotal = events.length || programs.length;
  const moduleDone = events.length ? completed : 0;
  const progressPct = moduleTotal ? Math.round((moduleDone / moduleTotal) * 100) : 0;
  const nextEvent = events.find((row) => !isCompletedEvent(row)) || events[0];
  const nextAppraisal = appraisals.find((row) => row.self_score == null);

  const selectedEvent =
    detail?.kind === 'event' || detail?.kind === 'feedback'
      ? events.find((row) => row.name === detail.id) || data?.training_events.find((row) => row.name === detail.id)
      : undefined;
  const selectedProgram =
    detail?.kind === 'program' ? programs.find((row) => row.name === detail.id) || data?.training_programs.find((row) => row.name === detail.id) : undefined;
  const selectedPolicy =
    detail?.kind === 'policy' ? policies.find((row) => row.slug === detail.id || row.name === detail.id) : undefined;
  const selectedAppraisal =
    detail?.kind === 'appraisal'
      ? appraisals.find((row) => row.name === detail.id) || data?.appraisals.find((row) => row.name === detail.id)
      : undefined;

  function openEvent(event: TrainingEventRow) {
    setDetail({ kind: 'event', id: event.name });
    setMessage(null);
  }

  function continueLearning() {
    if (nextEvent) {
      setTab('all');
      openEvent(nextEvent);
      videoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (nextAppraisal) {
      setTab('assessments');
      setDetail({ kind: 'appraisal', id: nextAppraisal.name });
      assessRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function onAppraisalSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedAppraisal) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const criteria = data?.feedback_criteria || [];
      const ratingRows = criteria.map((row) => ({
        criteria: row.criteria || row.name,
        rating: ratings[row.criteria || row.name] || 0,
        per_weightage: 0,
      }));
      const res = await api.submitAppraisalSelfReview({
        appraisal: selectedAppraisal.name,
        reflections,
        ratings: ratingRows.filter((row) => row.rating > 0),
      });
      setMessage(res.message || 'Self review saved');
      if (res.data?.appraisal) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                appraisals: prev.appraisals.map((row) =>
                  row.name === res.data.appraisal.name ? res.data.appraisal : row,
                ),
              }
            : prev,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save self review');
    } finally {
      setSubmitting(false);
    }
  }

  async function onTrainingFeedbackSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedEvent) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.submitTrainingFeedback({
        training_event: selectedEvent.name,
        rating: Number(feedbackRating),
        feedback: feedbackText,
      });
      setMessage(res.message || 'Feedback submitted');
      setFeedbackText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit feedback');
    } finally {
      setSubmitting(false);
    }
  }

  function onSelectAppraisal(appraisal: StaffAppraisalRow) {
    setDetail({ kind: 'appraisal', id: appraisal.name });
    setReflections(appraisal.reflections || '');
    const initial: Record<string, number> = {};
    for (const row of appraisal.self_ratings || []) {
      if (row.criteria) initial[row.criteria] = Number(row.rating || 0);
    }
    setRatings(initial);
    setMessage(null);
  }

  const showVideo = tab === 'all' || tab === 'video';
  const showSop = tab === 'all' || tab === 'sop';
  const showGuide = tab === 'all' || tab === 'guidelines';
  const showAssess = tab === 'all' || tab === 'assessments';

  return (
    <div className="cp-page cts-page">
      <section className="cts-hero">
        <div className="cts-hero-copy">
          <h1>Training & SOP</h1>
          <p>Learn best practices, watch assigned training, and follow standard operating procedures for accurate, safe sample collection.</p>
        </div>
        <ul className="cts-hero-benefits">
          <li>
            <span className="cts-hero-ico">
              <Ico>
                <path d="M12 21s-7-4.4-7-10a7 7 0 0 1 14 0c0 5.6-7 10-7 10z" />
              </Ico>
            </span>
            Better Patient Experience
          </li>
          <li>
            <span className="cts-hero-ico">
              <Ico>
                <path d="M9 12l2 2 4-4" />
                <circle cx="12" cy="12" r="8" />
              </Ico>
            </span>
            Accurate Sample Collection
          </li>
          <li>
            <span className="cts-hero-ico">
              <Ico>
                <path d="M12 3l7 4v5c0 5-3.2 7.8-7 9-3.8-1.2-7-4-7-9V7z" />
              </Ico>
            </span>
            Safe & Standard Process
          </li>
        </ul>
        <div className="cts-hero-art" aria-hidden>
          <span className="cts-flask" />
        </div>
      </section>

      <div className="cts-toolbar">
        <nav className="cts-tabs" aria-label="Training content">
          {(
            [
              ['all', 'All Content'],
              ['video', 'Video Training'],
              ['sop', 'SOP Documents'],
              ['guidelines', 'Guidelines'],
              ['assessments', 'Assessments'],
            ] as Array<[ContentTab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`cts-tab${tab === key ? ' is-on' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <label className="cts-search">
          <Ico>
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </Ico>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search training, SOP or topic..."
          />
        </label>
      </div>

      {error ? <p className="cp-error">{error}</p> : null}
      {message ? <p className="cts-ok">{message}</p> : null}

      {loading ? <p className="cp-empty">Loading training & SOP…</p> : null}

      {!loading && !data?.performance_available ? (
        <p className="cp-empty">
          HRMS training modules are not fully installed yet.
          {data?.missing_modules?.length ? ` Missing: ${data.missing_modules.join(', ')}.` : ''}
        </p>
      ) : null}

      {!loading && data?.performance_available ? (
        <>
          <section className="cts-progress">
            <div className="cts-progress-ring">
              <ProgressRing value={progressPct} />
              <span>Completed</span>
            </div>
            <div className="cts-progress-stats">
              <div>
                <strong>{moduleDone} / {moduleTotal || 0}</strong>
                <span>Modules Completed</span>
              </div>
              <div>
                <strong>{remaining}</strong>
                <span>Remaining</span>
              </div>
              <div>
                <strong>{assessmentsPassed}</strong>
                <span>Assessments Passed</span>
              </div>
            </div>
            <div className="cts-progress-next">
              <small>Next</small>
              <b>{nextEvent?.event_name || nextAppraisal?.appraisal_cycle || 'All assigned training complete'}</b>
              <button type="button" className="cts-continue" onClick={continueLearning} disabled={!nextEvent && !nextAppraisal}>
                Continue Learning
              </button>
            </div>
          </section>

          {showVideo ? (
            <section className="cts-section" ref={videoRef}>
              <div className="cts-section-head">
                <div>
                  <h2>
                    <span className="cts-dot play" />
                    Training modules
                  </h2>
                  <p>Assigned programs and sessions from your training hub. Playable video appears only when a file is attached.</p>
                </div>
                {tab === 'all' ? (
                  <button type="button" className="cts-viewall" onClick={() => setTab('video')}>
                    View All Videos
                  </button>
                ) : null}
              </div>
              {sessionEvents.length ? (
                <div className="cts-video-grid">
                  {sessionEvents.map((event) => {
                    const files = event.files || [];
                    const video = files.find(isVideoFile);
                    const pct = isCompletedEvent(event) ? 100 : 0;
                    return (
                      <button
                        key={event.name}
                        type="button"
                        className={`cts-video-card${detail?.kind === 'event' && detail.id === event.name ? ' is-on' : ''}`}
                        onClick={() => openEvent(event)}
                      >
                        <div className={`cts-thumb tone-${moduleTone(event.event_name || event.training_program || '')}`}>
                          {video ? <span className="cts-live-tag">Video attached</span> : null}
                          <span className="cts-play" aria-hidden>
                            ▶
                          </span>
                          {formatDuration(event.start_time, event.end_time) ? (
                            <span className="cts-dur">{formatDuration(event.start_time, event.end_time)}</span>
                          ) : event.start_time ? (
                            <span className="cts-dur">{formatWhen(event.start_time)}</span>
                          ) : null}
                        </div>
                        <strong>{event.event_name || event.training_program || event.name}</strong>
                        <div className="cts-bar">
                          <i style={{ width: `${pct}%` }} />
                        </div>
                        <small>
                          {event.event_status || 'Scheduled'}
                          {event.training_program ? ` · ${event.training_program}` : ''}
                          {` · Progress ${pct}%`}
                        </small>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="cp-empty">No training events are assigned to you yet.</p>
              )}
            </section>
          ) : null}

          {showSop ? (
            <section className="cts-section" ref={sopRef}>
              <div className="cts-section-head">
                <div>
                  <h2>
                    <span className="cts-dot pdf" />
                    SOP documents
                  </h2>
                  <p>Standard operating procedures from assigned programs. Download is enabled only when a file is attached.</p>
                </div>
                {tab === 'all' ? (
                  <button type="button" className="cts-viewall" onClick={() => setTab('sop')}>
                    View All Documents
                  </button>
                ) : null}
              </div>
              {sopList.programs.length || sopList.events.length ? (
                <div className="cts-docs">
                  {sopList.programs.map((program) => {
                    const docs = programDocuments(program);
                    return (
                      <article key={program.name} className="cts-doc">
                        <span className="cts-doc-ico">PDF</span>
                        <div>
                          <strong>{program.training_program || program.name}</strong>
                          <small>
                            {docs[0] ? `${docs[0].file_name || 'Attached file'}${formatBytes(docs[0].file_size) ? ` · ${formatBytes(docs[0].file_size)}` : ''}` : 'No document attached'}
                          </small>
                        </div>
                        {docs[0]?.file_url ? (
                          <a className="cts-doc-btn" href={fileHref(docs[0].file_url)} target="_blank" rel="noreferrer">
                            Download
                          </a>
                        ) : (
                          <button type="button" className="cts-doc-btn" onClick={() => setDetail({ kind: 'program', id: program.name })}>
                            View
                          </button>
                        )}
                      </article>
                    );
                  })}
                  {sopList.events.map((event) => {
                    const docs = eventDocuments(event);
                    if (!docs.length && sopList.programs.length) return null;
                    return (
                      <article key={`ev-${event.name}`} className="cts-doc">
                        <span className="cts-doc-ico">PDF</span>
                        <div>
                          <strong>{event.event_name || event.name}</strong>
                          <small>
                            {docs[0] ? `${docs[0].file_name || 'Attached file'}${formatBytes(docs[0].file_size) ? ` · ${formatBytes(docs[0].file_size)}` : ''}` : 'Session notes — no file attached'}
                          </small>
                        </div>
                        {docs[0]?.file_url ? (
                          <a className="cts-doc-btn" href={fileHref(docs[0].file_url)} target="_blank" rel="noreferrer">
                            Download
                          </a>
                        ) : (
                          <button type="button" className="cts-doc-btn" onClick={() => openEvent(event)}>
                            View
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="cp-empty">No SOP documents are attached to your programs yet.</p>
              )}
            </section>
          ) : null}

          {showGuide ? (
            <section className="cts-section" ref={guideRef}>
              <div className="cts-section-head">
                <div>
                  <h2>
                    <span className="cts-dot guide" />
                    Guidelines & important information
                  </h2>
                  <p>Published company policies and key result areas for field collection work.</p>
                </div>
                {tab === 'all' ? (
                  <button type="button" className="cts-viewall" onClick={() => setTab('guidelines')}>
                    View All
                  </button>
                ) : null}
              </div>
              {policies.length || kras.length ? (
                <div className="cts-guides">
                  {policies.map((policy) => (
                    <button
                      key={policy.slug || policy.name}
                      type="button"
                      className={`cts-guide${detail?.kind === 'policy' && detail.id === policy.slug ? ' is-on' : ''}`}
                      onClick={() => setDetail({ kind: 'policy', id: policy.slug })}
                    >
                      <span className="cts-guide-ico">
                        <GuidelineIcon slug={policy.slug || ''} />
                      </span>
                      <strong>{policy.name}</strong>
                      <small>View guideline</small>
                    </button>
                  ))}
                  {kras.map((kra) => (
                    <article key={kra.name} className="cts-guide is-static">
                      <span className="cts-guide-ico">
                        <Ico>
                          <path d="M9 11l2 2 4-4" />
                          <rect x="4" y="4" width="16" height="16" rx="3" />
                        </Ico>
                      </span>
                      <strong>{kra.title || kra.name}</strong>
                      <small>{kra.description || 'Assigned KRA'}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="cp-empty">No published guidelines are available for this login yet.</p>
              )}
            </section>
          ) : null}

          {showAssess ? (
            <section className="cts-section" ref={assessRef}>
              <div className="cts-section-head">
                <div>
                  <h2>
                    <span className="cts-dot quiz" />
                    Assessments
                  </h2>
                  <p>Self-appraisal and training feedback from your live HRMS record. No dummy quizzes.</p>
                </div>
                {tab === 'all' ? (
                  <button type="button" className="cts-viewall" onClick={() => setTab('assessments')}>
                    View All
                  </button>
                ) : null}
              </div>
              {appraisals.length || events.length ? (
                <div className="cts-assess">
                  {appraisals.map((appraisal) => {
                    const passed = appraisal.self_score != null;
                    return (
                      <article key={appraisal.name} className="cts-quiz">
                        <span className="cts-quiz-ico">A</span>
                        <div>
                          <strong>{appraisal.appraisal_cycle || appraisal.name}</strong>
                          <small>{appraisal.appraisal_template || 'Self appraisal'}{passed ? ` · Score ${appraisal.self_score}` : ''}</small>
                        </div>
                        <button
                          type="button"
                          className={passed ? 'cts-passed' : 'cts-start'}
                          onClick={() => onSelectAppraisal(appraisal)}
                        >
                          {passed ? 'Passed' : 'Start'}
                        </button>
                      </article>
                    );
                  })}
                  {events.map((event) => (
                    <article key={`fb-${event.name}`} className="cts-quiz">
                      <span className="cts-quiz-ico alt">F</span>
                      <div>
                        <strong>{event.event_name || event.name}</strong>
                        <small>Training feedback{event.event_status ? ` · ${event.event_status}` : ''}</small>
                      </div>
                      <button
                        type="button"
                        className="cts-start"
                        onClick={() => {
                          setDetail({ kind: 'feedback', id: event.name });
                          setMessage(null);
                        }}
                      >
                        Start
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="cp-empty">No appraisals or training events are available for assessment yet.</p>
              )}
            </section>
          ) : null}

          {detail && (selectedEvent || selectedProgram || selectedPolicy || selectedAppraisal) ? (
            <section className="cts-detail" aria-live="polite">
              {selectedEvent ? (
                <EventDetail
                  event={selectedEvent}
                  feedbackMode={detail.kind === 'feedback'}
                  feedbackRating={feedbackRating}
                  feedbackText={feedbackText}
                  submitting={submitting}
                  onRating={setFeedbackRating}
                  onText={setFeedbackText}
                  onSubmit={onTrainingFeedbackSubmit}
                  onClose={() => setDetail(null)}
                />
              ) : null}
              {selectedProgram ? (
                <ProgramDetail program={selectedProgram} onClose={() => setDetail(null)} />
              ) : null}
              {selectedPolicy ? (
                <PolicyDetail policy={selectedPolicy} onClose={() => setDetail(null)} />
              ) : null}
              {selectedAppraisal ? (
                <AppraisalDetail
                  appraisal={selectedAppraisal}
                  criteria={data?.feedback_criteria || []}
                  reflections={reflections}
                  ratings={ratings}
                  submitting={submitting}
                  onReflections={setReflections}
                  onRating={(key, value) => setRatings((prev) => ({ ...prev, [key]: value }))}
                  onSubmit={onAppraisalSubmit}
                  onClose={() => setDetail(null)}
                />
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function FileList({ files }: { files?: TrainingFile[] }) {
  const list = files || [];
  if (!list.length) return <p className="muted">No file is attached to this record.</p>;
  return (
    <ul className="cts-files">
      {list.map((file) => (
        <li key={`${file.file_url}-${file.file_name}`}>
          {file.file_url ? (
            <a href={fileHref(file.file_url)} target="_blank" rel="noreferrer">
              {file.file_name || file.file_url}
            </a>
          ) : (
            <span>{file.file_name || 'Untitled file'}</span>
          )}
          {formatBytes(file.file_size) ? <small>{formatBytes(file.file_size)}</small> : null}
        </li>
      ))}
    </ul>
  );
}

function EventDetail({
  event,
  feedbackMode,
  feedbackRating,
  feedbackText,
  submitting,
  onRating,
  onText,
  onSubmit,
  onClose,
}: {
  event: TrainingEventRow;
  feedbackMode: boolean;
  feedbackRating: string;
  feedbackText: string;
  submitting: boolean;
  onRating: (value: string) => void;
  onText: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}) {
  const video = (event.files || []).find(isVideoFile);
  return (
    <>
      <div className="cts-detail-head">
        <div>
          <h3>{event.event_name || event.name}</h3>
          <p>
            {[event.training_program, event.event_status, event.type, formatWhen(event.start_time)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button type="button" className="cts-close" onClick={onClose}>
          Close
        </button>
      </div>
      {video?.file_url ? (
        <video className="cts-player" controls src={fileHref(video.file_url)} />
      ) : (
        <p className="muted">This session has no attached video. Use the schedule and notes below.</p>
      )}
      {event.introduction ? <p>{event.introduction}</p> : null}
      <FileList files={event.files} />
      <form className="cts-form" onSubmit={onSubmit}>
        <h4>{feedbackMode ? 'Training feedback' : 'Submit feedback'}</h4>
        <label>
          Rating (1–5)
          <input type="number" min={1} max={5} step={0.5} value={feedbackRating} onChange={(e) => onRating(e.target.value)} />
        </label>
        <label>
          Comments
          <textarea rows={3} value={feedbackText} onChange={(e) => onText(e.target.value)} placeholder="What was useful? What should improve?" />
        </label>
        <button type="submit" className="cts-continue" disabled={submitting}>
          {submitting ? 'Saving…' : 'Submit feedback'}
        </button>
      </form>
    </>
  );
}

function ProgramDetail({ program, onClose }: { program: TrainingProgramRow; onClose: () => void }) {
  return (
    <>
      <div className="cts-detail-head">
        <div>
          <h3>{program.training_program || program.name}</h3>
          <p>{program.status || 'Training program'}</p>
        </div>
        <button type="button" className="cts-close" onClick={onClose}>
          Close
        </button>
      </div>
      {program.description ? <p>{program.description}</p> : <p className="muted">No description is stored for this program.</p>}
      <FileList files={program.files} />
    </>
  );
}

function PolicyDetail({ policy, onClose }: { policy: HrPolicySnippet; onClose: () => void }) {
  return (
    <>
      <div className="cts-detail-head">
        <div>
          <h3>{policy.name}</h3>
          <p>Published policy</p>
        </div>
        <button type="button" className="cts-close" onClick={onClose}>
          Close
        </button>
      </div>
      <pre className="cts-policy-body">{policy.body || 'No policy text is published for this item.'}</pre>
    </>
  );
}

function AppraisalDetail({
  appraisal,
  criteria,
  reflections,
  ratings,
  submitting,
  onReflections,
  onRating,
  onSubmit,
  onClose,
}: {
  appraisal: StaffAppraisalRow;
  criteria: Array<{ name: string; criteria?: string }>;
  reflections: string;
  ratings: Record<string, number>;
  submitting: boolean;
  onReflections: (value: string) => void;
  onRating: (key: string, value: number) => void;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="cts-detail-head">
        <div>
          <h3>{appraisal.appraisal_cycle || appraisal.name}</h3>
          <p>
            {appraisal.appraisal_template || 'Self appraisal'}
            {appraisal.self_score != null ? ` · Self score ${appraisal.self_score}` : ''}
          </p>
        </div>
        <button type="button" className="cts-close" onClick={onClose}>
          Close
        </button>
      </div>
      <form className="cts-form" onSubmit={onSubmit}>
        <label>
          Self reflection
          <textarea
            rows={5}
            value={reflections}
            onChange={(e) => onReflections(e.target.value)}
            placeholder="Achievements, challenges, support needed…"
          />
        </label>
        {criteria.length ? (
          <fieldset>
            <legend>Rate yourself (1–5)</legend>
            {criteria.map((row) => {
              const key = row.criteria || row.name;
              return (
                <label key={row.name}>
                  {key}
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.5}
                    value={ratings[key] ?? ''}
                    onChange={(e) => onRating(key, Number(e.target.value))}
                  />
                </label>
              );
            })}
          </fieldset>
        ) : null}
        <button type="submit" className="cts-continue" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save self review'}
        </button>
      </form>
    </>
  );
}
