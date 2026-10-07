import { API_PREFIX, type ApiError } from '@perch/core/api';

// Same-origin calls to the Perch Server that serves this page. The session is
// an HttpOnly cookie, so nothing here ever touches a token.

export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

/** Fired when the session ends (signed out elsewhere, expired). */
export const SIGNED_OUT_EVENT = 'perch:signed-out';

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; raw?: string } = {},
): Promise<T> {
  const hasBody = init.body !== undefined || init.raw !== undefined;
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      method: init.method ?? (hasBody ? 'POST' : 'GET'),
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      credentials: 'same-origin',
    });
  } catch {
    throw new ServerError(0, 'network', 'Can’t reach the server. Check your connection.');
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    }
    throw new ServerError(
      res.status,
      body?.error ?? 'http',
      body?.message ?? `The server answered ${res.status}`,
    );
  }
  return body as T;
}
