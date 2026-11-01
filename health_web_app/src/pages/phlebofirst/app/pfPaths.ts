import { createContext, useContext } from 'react';

/** Where the shared PhleboFirst screens link to: legacy portal routes, or the phlebofirst.com app. */
export type PfPaths = {
  inApp: boolean;
  requests: string;
  jobs: string;
  earnings: string;
  lab: string;
  ops: string;
};

const LEGACY_PATHS: PfPaths = {
  inApp: false,
  requests: '/pf',
  jobs: '/dashboard/phlebotomist/jobs',
  earnings: '/dashboard/phlebotomist/jobs',
  lab: '/dashboard/pf-inbox',
  ops: '/dashboard/pf-ops',
};

export type PfAppPaths = PfPaths & {
  site: string;
  login: string;
  home: string;
};

/** `base` is empty on phlebofirst.com and `/phlebofirst` for the localhost preview. */
export function pfAppPaths(base = ''): PfAppPaths {
  const home = `${base}/app`;
  return {
    inApp: true,
    site: base || '/',
    login: `${base}/login`,
    home,
    requests: `${home}/requests`,
    jobs: `${home}/jobs`,
    earnings: `${home}/earnings`,
    lab: `${home}/lab`,
    ops: `${home}/ops`,
  };
}

const PfPathsContext = createContext<PfPaths>(LEGACY_PATHS);

export const PfPathsProvider = PfPathsContext.Provider;

export function usePfPaths() {
  return useContext(PfPathsContext);
}

const PfAppPathsContext = createContext<PfAppPaths>(pfAppPaths());

export const PfAppPathsProvider = PfAppPathsContext.Provider;

export function usePfAppPaths() {
  return useContext(PfAppPathsContext);
}

export function pfLoginHref(paths: PfAppPaths, next?: string) {
  return next ? `${paths.login}?next=${encodeURIComponent(next)}` : paths.login;
}

/** Only follow `next` back into this app so the login page cannot be used as an open redirect. */
export function safeNext(paths: PfAppPaths, raw: string | null | undefined) {
  if (!raw || raw.startsWith('//')) return paths.home;
  return raw === paths.home || raw.startsWith(`${paths.home}/`) || raw.startsWith(`${paths.home}?`) ? raw : paths.home;
}
