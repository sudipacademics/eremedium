import { Suspense, lazy } from 'react';

const VaultRoot = lazy(() => import('./VaultRoot').then((m) => ({ default: m.VaultRoot })));

export function VaultSiteLazy({ basePath = '' }: { basePath?: string }) {
  return (
    <Suspense fallback={null}>
      <VaultRoot basePath={basePath} />
    </Suspense>
  );
}
