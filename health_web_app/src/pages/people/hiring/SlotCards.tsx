import type { HirePortalSlot } from '../../../api';

export function SlotCards({ slots }: { slots: HirePortalSlot[] }) {
  return (
    <div className="hire-slots">
      {slots.map((s) => {
        const full = s.limit !== null && s.used >= s.limit;
        return (
          <article key={s.portal} className={`hire-slot ${full ? 'full' : ''}`}>
            <div>
              <b>{s.portal}</b>
              <span className="muted">
                {s.limit === null ? `${s.used} live · unlimited` : `${s.used} of ${s.limit} slots used`}
              </span>
            </div>
            {s.limit !== null ? (
              <div className="hire-slot-dots" aria-hidden>
                {Array.from({ length: s.limit }).map((_, i) => (
                  <i key={i} className={i < s.used ? 'on' : ''} />
                ))}
              </div>
            ) : null}
            <a href={s.employer_url} target="_blank" rel="noreferrer" className="hrms-btn secondary">
              Open {s.portal}
            </a>
          </article>
        );
      })}
    </div>
  );
}
