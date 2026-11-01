import type { MouseEvent, ReactNode } from 'react';

import { navigateWithHandoff, phleboFirstHandoffUrl } from '../../../auth/portalHandoff';

/** Opens a phlebofirst.com app screen from another portal, keeping the user signed in. */
export function PfOpenAppLink({
  path,
  className,
  children = 'Open in PhleboFirst app',
}: {
  path: string;
  className?: string;
  children?: ReactNode;
}) {
  const href = phleboFirstHandoffUrl(path);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    void navigateWithHandoff(href);
  };
  return (
    <a className={className} href={href} onClick={onClick}>
      {children}
    </a>
  );
}
