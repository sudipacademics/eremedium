import { Suspense, lazy } from 'react';

const PhleboFirstRoot = lazy(() =>
  import('./PhleboFirstRoot').then((m) => ({ default: m.PhleboFirstRoot })),
);

export function PhleboFirstSiteLazy({ basePath = '' }: { basePath?: string }) {
  return (
    <Suspense fallback={null}>
      <PhleboFirstRoot basePath={basePath} />
    </Suspense>
  );
}
