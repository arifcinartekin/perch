/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "web" here; the extension's build sets "chrome" or "firefox". */
  readonly BROWSER?: string;
}
