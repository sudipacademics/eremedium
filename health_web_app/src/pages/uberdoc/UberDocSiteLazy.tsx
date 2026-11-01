import { Suspense, lazy } from 'react';

const UberDocRoot = lazy(() => import('./UberDocRoot').then((m) => ({ default: m.UberDocRoot })));

export function UberDocSiteLazy({ basePath = '' }: { basePath?: string }) {
  return (
    <Suspense fallback={null}>
      <UberDocRoot basePath={basePath} />
    </Suspense>
  );
}
