import { Suspense, lazy } from 'react';

const TeleporterRoot = lazy(() =>
  import('./TeleporterRoot').then((m) => ({ default: m.TeleporterRoot })),
);

export function TeleporterSiteLazy({ basePath = '' }: { basePath?: string }) {
  return (
    <Suspense fallback={null}>
      <TeleporterRoot basePath={basePath} />
    </Suspense>
  );
}
