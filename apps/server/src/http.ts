import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { ApiError } from '@perch/core/api';
import type { Config } from './config';
import type { DB } from './db';
import type { SafeFetch } from './lib/safe-fetch';
import type { FeedWorker } from './feeds/worker';
import type { Notifier } from './lib/notifier';
import type { SyncService } from './sync/service';

export interface AppContext {
  config: Config;
  db: DB;
  /** Instance secret: signs fake prelogin salts. Generated once, kept in `meta`. */
  secret: string;
  fetch: SafeFetch;
  worker: FeedWorker;
  sync: SyncService;
  notifier: Notifier;
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  createdAt: number;
}

export type Env = {
  Variables: {
    user: SessionUser;
    sessionId: string;
  };
};

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (message: string) => new HttpError(400, 'bad-request', message);
export const notFound = (what = 'Not found') => new HttpError(404, 'not-found', what);

export function errorResponse(c: Context, err: unknown) {
  if (err instanceof HttpError) {
    const body: ApiError = { error: err.code, message: err.message };
    return c.json(body, err.status);
  }
  console.error(err);
  return c.json<ApiError>({ error: 'internal', message: 'Internal server error' }, 500);
}

/** Parse a JSON object body or fail with 400. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('Request body must be JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export function str(
  body: Record<string, unknown>,
  key: string,
  opts: { max?: number; optional?: boolean } = {},
): string {
  const v = body[key];
  if (v == null && opts.optional) return '';
  if (typeof v !== 'string') throw badRequest(`"${key}" must be a string`);
  if (v.length > (opts.max ?? 2048)) throw badRequest(`"${key}" is too long`);
  return v;
}

export function clientIp(c: Context, config: Config): string {
  if (config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
