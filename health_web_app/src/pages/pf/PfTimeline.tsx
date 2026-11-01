import type { PfTimelineStep } from '../../types/phlebofirst';
import './pf.css';

const BAD = new Set(['Rejected', 'Cancelled', 'Expired']);

function when(raw?: string | null) {
  if (!raw) return '';
  const d = new Date(String(raw).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

export function PfTimeline({ steps }: { steps: PfTimelineStep[] }) {
  if (!steps?.length) return null;
  let current = -1;
  steps.forEach((s, i) => {
    if (s.done) current = i;
  });
  return (
    <ol className="pf-timeline" aria-label="Request progress">
      {steps.map((step, i) => {
        const bad = BAD.has(step.status);
        const cls = [
          'pf-step',
          step.done ? 'is-done' : '',
          i === current ? 'is-current' : '',
          bad && step.done ? 'is-bad' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <li key={`${step.status}-${i}`} className={cls} aria-current={i === current ? 'step' : undefined}>
            <span className="pf-step-dot" aria-hidden>
              {step.done ? (bad ? '✕' : '✓') : ''}
            </span>
            <span className="pf-step-copy">
              <b>{step.status}</b>
              {step.done && step.at ? <small>{when(step.at)}</small> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
