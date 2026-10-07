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
}

const bool = (v: string | undefined, fallback: boolean) =>
  v == null || v === '' ? fallback : ['1', 'true', 'on', 'yes'].includes(v.toLowerCase());

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
  if (v == null || v === '') return fallback;
  if ((allowed as string[]).includes(v)) return v as T;
  throw new Error(`${name} must be one of ${allowed.join(', ')} (got "${v}")`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = oneOf('PERCH_MODE', env.PERCH_MODE, ['personal', 'e2e'], 'personal');
  if (mode === 'e2e') {
    throw new Error('PERCH_MODE=e2e is not available yet; use personal.');
  }

  const databaseUrl = env.DATABASE_URL ?? '';
  if (/^postgres(ql)?:/.test(databaseUrl)) {
    throw new Error('Postgres support is coming; leave DATABASE_URL empty to use SQLite.');
  }

  return {
    mode,
    port: int(env.PORT, 8080, 1, 65535),
    host: env.HOST || '0.0.0.0',
    databasePath: databaseUrl.replace(/^(sqlite|file):(\/\/)?/, '') || './data/perch.db',
    publicUrl: env.PERCH_PUBLIC_URL?.replace(/\/+$/, '') || undefined,
    signup: oneOf('PERCH_SIGNUP', env.PERCH_SIGNUP, ['open', 'invite', 'closed'], 'invite'),
    community: bool(env.PERCH_COMMUNITY, false),
    fetchIntervalMin: int(env.PERCH_FETCH_INTERVAL_MIN, 30, 5, 24 * 60),
    fetchAllowPrivate: bool(env.PERCH_FETCH_ALLOW_PRIVATE, false),
    fetchAllowHosts: (env.PERCH_FETCH_ALLOW_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    trustProxy: bool(env.PERCH_TRUST_PROXY, false),
    worker: bool(env.PERCH_WORKER, true),
    webRoot: env.PERCH_WEB_ROOT || undefined,
  };
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
