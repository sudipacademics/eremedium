import type { CollectionTubeRow } from '../api';

export type SampleLine = {
  item_name?: string;
  sample_type?: string;
  sample_requirement_label?: string;
  collection_tubes?: CollectionTubeRow[];
};

export function tubesForLine(row: SampleLine): CollectionTubeRow[] {
  return Array.isArray(row.collection_tubes) ? row.collection_tubes : [];
}

export function tubeVolumeLabel(tube: CollectionTubeRow) {
  return tube.volume_ml != null && Number(tube.volume_ml) > 0 ? `${Number(tube.volume_ml)} ml` : '—';
}

export function aggregateDrawPlan(lines: SampleLine[]): CollectionTubeRow[] {
  const buckets = new Map<string, CollectionTubeRow & { linked: string[] }>();
  for (const line of lines) {
    const label = line.item_name || '';
    for (const tube of tubesForLine(line)) {
      const code = tube.tube_code || 'TUBE';
      const existing = buckets.get(code);
      if (!existing) {
        buckets.set(code, {
          ...tube,
          volume_ml: Number(tube.volume_ml || 0),
          linked: label ? [label] : [],
        });
        continue;
      }
      existing.volume_ml = Number(existing.volume_ml || 0) + Number(tube.volume_ml || 0);
      if (label && !existing.linked.includes(label)) existing.linked.push(label);
    }
  }
  return Array.from(buckets.values())
    .map((row) => ({
      ...row,
      linked_tests: row.linked.join(', '),
    }))
    .sort((a, b) => Number(a.draw_order || 0) - Number(b.draw_order || 0));
}

export function NablSampleCell({ row }: { row: SampleLine }) {
  const tubes = tubesForLine(row);
  return (
    <div className="nabl-sample-cell">
      <span className="nabl-kicker">Sample</span>
      <strong>{row.sample_type || '—'}</strong>
      {tubes.length ? (
        <ul className="nabl-tube-chips">
          {tubes.map((tube) => (
            <li key={`${tube.tube_code}-${tube.draw_order || 0}`}>
              <b>{tube.tube_code || 'Tube'}</b>
              {tube.cap_color ? <em>{tube.cap_color}</em> : null}
              <span>{tubeVolumeLabel(tube)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <small>{row.sample_requirement_label || 'No tube mapped'}</small>
      )}
    </div>
  );
}

export function NablDrawPlan({ lines }: { lines: SampleLine[] }) {
  const tubes = aggregateDrawPlan(lines);
  if (!tubes.length) return null;
  return (
    <section className="nabl-draw-plan" aria-label="Collection draw plan">
      <header>
        <h3>Collection draw plan</h3>
        <span>{tubes.length} tube{tubes.length === 1 ? '' : 's'} · CLSI order</span>
      </header>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Tube</th>
            <th>Cap</th>
            <th>Vol req</th>
            <th>Sample</th>
            <th>Tests</th>
          </tr>
        </thead>
        <tbody>
          {tubes.map((tube) => (
            <tr key={tube.tube_code}>
              <td>{tube.draw_order ?? '—'}</td>
              <td><strong>{tube.tube_code || '—'}</strong></td>
              <td>{tube.cap_color || '—'}</td>
              <td>{tubeVolumeLabel(tube)}</td>
              <td>{tube.specimen || '—'}</td>
              <td>{tube.linked_tests || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
