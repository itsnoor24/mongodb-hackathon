/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REVIEWER_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}