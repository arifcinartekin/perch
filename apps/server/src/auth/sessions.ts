import { and, eq, lt, ne } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { DB } from '../db';
import { sessions, users } from '../db/schema';
import { HttpError, type AppContext, type Env, type SessionUser } from '../http';
import { randomToken, sha256 } from '../lib/crypto';

// Sessions are opaque random tokens, one per signed-in device. Only their hash
// is stored. Native clients send `Authorization: Bearer`; the web UI uses an
// HttpOnly cookie that scripts can't read.

export const SESSION_COOKIE = 'perch_session';
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** Don't write lastSeenAt on every request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function createSession(db: DB, userId: string, deviceName: string): string {
  const token = randomToken();
  const now = Date.now();
  db.insert(sessions)
    .values({
      id: randomToken(12),
      tokenHash: sha256(token),
      userId,
      deviceName: deviceName.trim().slice(0, 80) || 'Unknown device',
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + SESSION_TTL_MS,
    })
    .run();
  return token;
}

export function setSessionCookie(c: Context, token: string, publicUrl?: string) {
  const secure = (publicUrl ?? c.req.url).startsWith('https:');
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export const clearSessionCookie = (c: Context) => deleteCookie(c, SESSION_COOKIE, { path: '/' });

function tokenFrom(c: Context): string | undefined {
  const header = c.req.header('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || undefined;
  return getCookie(c, SESSION_COOKIE) || undefined;
}

/** Resolve the request's session, or undefined. Slides the expiry forward. */
export function lookupSession(
  db: DB,
  token: string,
  now = Date.now(),
): { sessionId: string; user: SessionUser } | undefined {
  const row = db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      user: {
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        createdAt: users.createdAt,
        email: users.email,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .get();
  if (!row) return undefined;
  if (row.expiresAt <= now) {
    db.delete(sessions).where(eq(sessions.id, row.sessionId)).run();
    return undefined;
  }
  if (now - row.lastSeenAt > TOUCH_INTERVAL_MS) {
    db.update(sessions)
      .set({ lastSeenAt: now, expiresAt: now + SESSION_TTL_MS })
      .where(eq(sessions.id, row.sessionId))
      .run();
  }
  return { sessionId: row.sessionId, user: row.user };
}

/** The request's session, if it carries a valid one. */
export function currentSession(ctx: AppContext, c: Context) {
  const token = tokenFrom(c);
  return token ? lookupSession(ctx.db, token) : undefined;
}

export function requireUser(ctx: AppContext): MiddlewareHandler<Env> {
  return async (c, next) => {
    const session = currentSession(ctx, c);
    if (!session) throw new HttpError(401, 'unauthorized', 'Sign in required');
    c.set('user', session.user);
    c.set('sessionId', session.sessionId);
    await next();
  };
}

export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (c.get('user').role !== 'admin') throw new HttpError(403, 'forbidden', 'Admins only');
  await next();
};

export function revokeAllSessions(db: DB, userId: string) {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export function revokeOtherSessions(db: DB, userId: string, keepSessionId: string) {
  db.delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
    .run();
}

export function purgeExpiredSessions(db: DB, now = Date.now()) {
  db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
}
