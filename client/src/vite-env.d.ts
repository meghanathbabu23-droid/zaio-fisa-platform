/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute API origin (e.g. "https://api.example.com"), no
   * trailing slash. Unset in production — see the comment above apiUrl()
   * in src/api.ts for why that matters for admin cookie auth. */
  readonly VITE_API_BASE_URL?: string;
}
