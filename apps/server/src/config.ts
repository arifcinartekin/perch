import type { ServerMode, SignupPolicy } from '@perch/core/api';

// Everything is configured through environment variables so a Docker install
// is one `docker run` with a few `-e` flags.

export interface Config {
  mode: ServerMode;
  port: number;
  host: string;
  /** SQLite file path (Docker: /data/perch.db), or ":memory:" in tests. */
  databasePath: string;
  publicUrl?: string;
  signup: SignupPolicy;
  community: boolean;
  /** Relay sync chains (sync without an account) for anyone who asks. */
  chain: boolean;
  /** Minutes between refreshes of the same feed. */
  fetchIntervalMin: number;
  /** Allow fetching feeds on private / loopback addresses (home-network feeds). */
  fetchAllowPrivate: boolean;
  /** Hostnames that may resolve to private addresses even when the above is off. */
  fetchAllowHosts: string[];
  /** Trust X-Forwarded-For (only behind a reverse proxy you control). */
  trustProxy: boolean;
  /** Run the background feed worker. Off in tests, which drive it directly. */
  worker: boolean;
  /** Serve the web UI from this folder when set. */
  webRoot?: string;
  /** How email is sent, if at all. `log` prints messages to stdout (development). */
  email?: EmailConfig;
  /** This server's privacy policy and terms, linked from sign-up and shared pages. */
  privacyUrl?: string;
  termsUrl?: string;
  /** Keys the hashes kept instead of email addresses. Kept out of the database. */
  emailKey?: string;
  /** Proof-of-work difficulty for signing up, in bits; 0 for none. */
  signupPow: number;
  /** Hub mode: delete libraries left from when the server was personal. */
  purgeLibraries: boolean;
}

export type EmailConfig =
  { provider: 'resend'; apiKey: string; from: string } | { provider: 'log'; from: string };

const bool = (v: string | undefined, fallback: boolean) =>
  v == null || v.trim() === ''
    ? fallback
    : ['1', 'true', 'on', 'yes'].includes(v.trim().toLowerCase());

const int = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function oneOf<T extends string>(
  name: string,
  v: string | undefined,
  allowed: T[],
  fallback: T,
): T {
  // Stray spaces in an .env line ("open  ") aren't worth refusing to start over.
  v = v?.trim();
  if (v == null || v === '') return fallback;
  if ((allowed as string[]).includes(v)) return v as T;
  throw new Error(`${name} must be one of ${allowed.join(', ')} (got "${v}")`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = oneOf('PERCH_MODE', env.PERCH_MODE, ['personal', 'hub', 'e2e'], 'personal');
  if (mode === 'e2e') {
    throw new Error('PERCH_MODE=e2e is not available yet; use personal.');
  }

  const databaseUrl = env.DATABASE_URL ?? '';
  if (/^postgres(ql)?:/.test(databaseUrl)) {
    throw new Error('Postgres support is coming; leave DATABASE_URL empty to use SQLite.');
  }

  const signup = oneOf(
    'PERCH_SIGNUP',
    env.PERCH_SIGNUP,
    ['open', 'invite', 'email', 'closed'],
    'invite',
  );
  const email = emailConfig(env);
  if (signup === 'email' && !email) {
    throw new Error('PERCH_SIGNUP=email needs email: set PERCH_EMAIL=resend and RESEND_API_KEY.');
  }

  return {
    mode,
    port: int(env.PORT, 8080, 1, 65535),
    host: env.HOST || '0.0.0.0',
    databasePath: databaseUrl.replace(/^(sqlite|file):(\/\/)?/, '') || './data/perch.db',
    publicUrl: env.PERCH_PUBLIC_URL?.replace(/\/+$/, '') || undefined,
    signup,
    community: bool(env.PERCH_COMMUNITY, false),
    chain: bool(env.PERCH_CHAIN, false),
    fetchIntervalMin: int(env.PERCH_FETCH_INTERVAL_MIN, 30, 5, 24 * 60),
    fetchAllowPrivate: bool(env.PERCH_FETCH_ALLOW_PRIVATE, false),
    fetchAllowHosts: (env.PERCH_FETCH_ALLOW_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    trustProxy: bool(env.PERCH_TRUST_PROXY, false),
    // A hub fetches no feeds.
    worker: mode !== 'hub' && bool(env.PERCH_WORKER, true),
    webRoot: env.PERCH_WEB_ROOT || undefined,
    email,
    privacyUrl: httpUrl('PERCH_PRIVACY_URL', env.PERCH_PRIVACY_URL),
    termsUrl: httpUrl('PERCH_TERMS_URL', env.PERCH_TERMS_URL),
    emailKey: emailKey(env.PERCH_EMAIL_KEY),
    signupPow: int(env.PERCH_SIGNUP_POW, 0, 0, 28),
    purgeLibraries: bool(env.PERCH_PURGE_LIBRARIES, false),
  };
}

function emailKey(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (v.length < 32) throw new Error('PERCH_EMAIL_KEY must be at least 32 characters.');
  return v;
}

function httpUrl(name: string, value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(v)) throw new Error(`${name} must be an http(s) URL.`);
  return v;
}

// Each server sends mail with its own provider account; nothing here reaches
// another server's. Off unless PERCH_EMAIL is set.
function emailConfig(env: NodeJS.ProcessEnv): EmailConfig | undefined {
  const provider = oneOf('PERCH_EMAIL', env.PERCH_EMAIL, ['resend', 'log', 'off'], 'off');
  if (provider === 'off') return undefined;
  const from = env.PERCH_EMAIL_FROM?.trim() || 'Perch <noreply@localhost>';
  if (provider === 'log') return { provider, from };
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error('PERCH_EMAIL=resend needs RESEND_API_KEY.');
  if (!env.PERCH_EMAIL_FROM?.trim()) {
    throw new Error(
      'PERCH_EMAIL=resend needs PERCH_EMAIL_FROM, e.g. "Perch <noreply@mail.example.com>".',
    );
  }
  return { provider, apiKey, from };
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({}),
    databasePath: ':memory:',
    signup: 'open',
    worker: false,
    fetchAllowPrivate: true,
    ...overrides,
  };
}
