/// <reference types="vite/client" />

interface ImportMetaEnv {
  /* 'aesthetic' builds the Aesthetic console's session pages (embedded in aesthetics.e-remedium.in). */
  readonly VITE_FLAVOR?: string;
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
