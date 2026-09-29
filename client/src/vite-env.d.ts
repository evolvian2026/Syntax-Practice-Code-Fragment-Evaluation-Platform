/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API when it is not served from the page's own origin. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
