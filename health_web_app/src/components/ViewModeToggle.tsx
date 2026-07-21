import { ViewMode } from '../hooks/useViewMode';

type Props = {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
};

export function ViewModeToggle({ mode, onChange }: Props) {
  return (
    <div className="view-toggle" role="group" aria-label="View mode">
      <button
        type="button"
        className={`view-toggle-btn ${mode === 'cards' ? 'active' : ''}`}
        onClick={() => onChange('cards')}
      >
        Cards
      </button>
      <button
        type="button"
        className={`view-toggle-btn ${mode === 'list' ? 'active' : ''}`}
        onClick={() => onChange('list')}
      >
        List
      </button>
    </div>
  );
}
