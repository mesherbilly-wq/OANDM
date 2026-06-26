/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SIMPRO_JOB_DISCOVERY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
