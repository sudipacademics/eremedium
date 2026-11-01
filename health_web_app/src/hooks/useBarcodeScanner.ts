import { useCallback, useMemo, useState } from 'react';

/** Open / close state for <BarcodeScanner>; spread `scannerProps` onto the component. */
export function useBarcodeScanner(onDetected: (code: string) => void, keepOpen = false) {
  const [open, setOpen] = useState(false);
  const openScanner = useCallback(() => setOpen(true), []);
  const closeScanner = useCallback(() => setOpen(false), []);
  const handleDetected = useCallback(
    (code: string) => {
      if (!keepOpen) setOpen(false);
      onDetected(code);
    },
    [keepOpen, onDetected],
  );
  const scannerProps = useMemo(
    () => ({ open, onClose: closeScanner, onDetected: handleDetected, continuous: keepOpen }),
    [open, closeScanner, handleDetected, keepOpen],
  );
  return { open, openScanner, closeScanner, scannerProps };
}
