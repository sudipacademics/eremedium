import { useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';

export type MobileNavItem =
  | { type: 'link'; to: string; label: string; end?: boolean }
  | { type: 'button'; label: string; onClick: () => void };

type Props = {
  open: boolean;
  onClose: () => void;
  items: MobileNavItem[];
};

export function MobileNav({ open, onClose, items }: Props) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="mobile-nav-root" role="presentation" onClick={onClose}>
      <div
        className="mobile-nav-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mobile-nav-head">
          <strong>Menu</strong>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu">
            ✕
          </button>
        </div>
        <nav className="mobile-nav-links">
          {items.map((item) =>
            item.type === 'link' ? (
              <NavLink key={item.to + item.label} to={item.to} end={item.end} onClick={onClose}>
                {item.label}
              </NavLink>
            ) : (
              <button key={item.label} type="button" className="mobile-nav-btn" onClick={item.onClick}>
                {item.label}
              </button>
            ),
          )}
        </nav>
      </div>
    </div>
  );
}

export function MobileMenuButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="icon-btn mobile-menu-btn"
      aria-label={open ? 'Close menu' : 'Open menu'}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="hamburger" data-open={open ? 'true' : 'false'} aria-hidden>
        <span />
        <span />
        <span />
      </span>
    </button>
  );
}

export function MobileBottomNav({
  items,
}: {
  items: Array<{ to: string; label: string; end?: boolean; badge?: number }>;
}) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Primary">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className="mobile-bottom-nav-item">
          <span className="mobile-bottom-nav-label">{item.label}</span>
          {item.badge && item.badge > 0 ? <span className="mobile-bottom-badge">{item.badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}

export function MobileBrandLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="brand brand-mobile">
      {children}
    </Link>
  );
}
