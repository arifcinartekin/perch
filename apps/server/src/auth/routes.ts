import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { DEFAULT_KDF, isValidKdf, toBase64Url } from '@perch/core/auth';
import type {
  AuthResponse,
  Device,
  EmailPurpose,
  Invite,
  PowChallenge,
  PreloginResponse,
  PublicUser,
} from '@perch/core/api';
import { normalizeRecoveryCode } from '@perch/core/recovery';
import { normalizeUsername, usernameProblem } from '@perch/core/username';
import { invites, sessions, users } from '../db/schema';
import {
  HttpError,
  badRequest,
  clientIp,
  jsonBody,
  notFound,
  str,
  type AppContext,
  type Env,
} from '../http';
import { DUMMY_AUTH_HASH, hashAuthKey, hmac, randomToken, verifyAuthKey } from '../lib/crypto';
import { RateLimiter } from '../lib/ratelimit';
import { PowGate } from './pow';
import {
  checkCode,
  codeEmail,
  consumeCode,
  emailCodeFrom,
  emailId,
  emailLang,
  noticeEmail,
  normalizeEmail,
  issueCode,
} from './email';
import {
  clearSessionCookie,
  createSession,
  currentSession,
  requireAdmin,
  requireUser,
  revokeAllSessions,
  revokeOtherSessions,
  setSessionCookie,
} from './sessions';

const AUTH_KEY = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url
const SALT = /^[A-Za-z0-9_-]{22,86}$/; // 16–64 bytes

const USERNAME_MESSAGES = {
  'too-short': 'Username must be at least 3 characters',
  'too-long': 'Username must be at most 24 characters',
  'invalid-characters': 'Username may only contain letters, digits, _ and .',
  reserved: 'That username is reserved',
} as const;

function authKeyFrom(body: Record<string, unknown>, key = 'authKey'): string {
  const v = str(body, key, { max: 64 });
  if (!AUTH_KEY.test(v)) throw badRequest(`"${key}" must be a 32-byte base64url key`);
  return v;
}

function kdfFrom(body: Record<string, unknown>) {
  const salt = str(body, 'salt', { max: 128 });
  if (!SALT.test(salt)) throw badRequest('"salt" must be 16–64 bytes, base64url');
  if (!isValidKdf(body.kdf)) throw badRequest('"kdf" parameters are missing or out of range');
  const { algorithm, memory, iterations, parallelism } = body.kdf;
  return { salt, kdf: { algorithm, memory, iterations, parallelism } };
}

/** The account as its owner sees it. Addresses and codes are kept only as hashes, so it says whether there is one. */
const publicUser = (
  u: Omit<PublicUser, 'hasEmail' | 'hasRecovery'> & {
    emailId?: string | null;
    recoveryHash?: string | null;
  },
): PublicUser => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  createdAt: u.createdAt,
  ...(u.emailId && { hasEmail: true }),
  ...(u.recoveryHash && { hasRecovery: true }),
});

/** A recovery code from the body, hashed for storing; undefined when absent. */
async function recoveryHashFrom(body: Record<string, unknown>): Promise<string | undefined> {
  if (body.recoveryCode == null) return undefined;
  const code = normalizeRecoveryCode(str(body, 'recoveryCode', { max: 64 }));
  if (!code) throw badRequest('"recoveryCode" is not a recovery code');
  return hashAuthKey(code);
}

const PURPOSES: EmailPurpose[] = ['signup', 'reset', 'change'];

export function authRoutes(ctx: AppContext) {
  const { db, config } = ctx;
  const app = new Hono<Env>();
  const auth = requireUser(ctx);

  // Per IP: all attempts. Per username: failures only, so a typo-prone owner
  // isn't locked out by their own successful logins.
  const ipLimit = new RateLimiter(30, 10 * 60 * 1000);
  const userLimit = new RateLimiter(10, 15 * 60 * 1000);
  const registerLimit = new RateLimiter(5, 60 * 60 * 1000);
  // Codes cost us mail: per IP, and per address so one inbox can't be flooded.
  const codeIpLimit = new RateLimiter(10, 60 * 60 * 1000);
  const codeEmailLimit = new RateLimiter(3, 15 * 60 * 1000);
  const resetLimit = new RateLimiter(10, 60 * 60 * 1000);
  const recoverIpLimit = new RateLimiter(10, 60 * 60 * 1000);
  const recoverUserLimit = new RateLimiter(5, 60 * 60 * 1000);
  const pow = config.signupPow > 0 ? new PowGate(ctx.secret, config.signupPow) : null;

  const throttle = (limiter: RateLimiter, key: string) => {
    const wait = limiter.retryAfter(key);
    if (wait > 0) {
      throw new HttpError(429, 'rate-limited', `Too many attempts; try again in ${wait}s`);
    }
  };

  // The address people know the server by, for the emails' wording.
  const host = (c: Context) => new URL(config.publicUrl ?? c.req.url).host;
  const userByEmail = (id: string) =>
    db.select({ id: users.id }).from(users).where(eq(users.emailId, id)).get();
  const idOf = (email: string) => emailId(ctx.emailKey, email);

  const issue = (
    c: Parameters<typeof setSessionCookie>[0],
    user: Parameters<typeof publicUser>[0],
    device: string,
  ) => {
    const token = createSession(db, user.id, device || (c.req.header('user-agent') ?? ''));
    setSessionCookie(c, token, config.publicUrl);
    return c.json<AuthResponse>({ token, user: publicUser(user) });
  };

  app.post('/prelogin', async (c) => {
    const username = normalizeUsername(str(await jsonBody(c), 'username', { max: 64 }));
    const user = db
      .select({ salt: users.kdfSalt, kdf: users.kdfParams })
      .from(users)
      .where(eq(users.username, username))
      .get();
    // Unknown names get a stable fake salt, so this can't be used to test
    // whether an account exists.
    const response: PreloginResponse = user ?? {
      salt: toBase64Url(hmac(ctx.secret, `prelogin:${username}`).subarray(0, 16)),
      kdf: DEFAULT_KDF,
    };
    return c.json(response);
  });

  app.get('/challenge', (c) => {
    if (!pow) throw notFound('This server asks for no proof of work');
    return c.json<PowChallenge>(pow.issue());
  });

  app.post('/register', async (c) => {
    const ip = clientIp(c, config);
    throttle(registerLimit, ip);

    const body = await jsonBody(c);
    // Checked first: it's what makes the rest of the work worth doing. The
    // first account (the person setting the server up) doesn't need one.
    if (pow && db.select({ n: count() }).from(users).get()!.n > 0) pow.check(body.pow);
    const username = normalizeUsername(str(body, 'username', { max: 64 }));
    const problem = usernameProblem(username);
    if (problem) throw new HttpError(400, `username-${problem}`, USERNAME_MESSAGES[problem]);
    const authKey = authKeyFrom(body);
    const { salt, kdf } = kdfFrom(body);
    const inviteCode = str(body, 'invite', { max: 64, optional: true }).trim();
    // Email signup proves the address with a code; other policies don't take one,
    // since an address nobody confirmed can't be used to reset the password.
    const byEmail = config.signup === 'email';
    let email: string | null = null;
    let emailCode = '';
    if (byEmail) {
      if (body.email == null || body.emailCode == null) {
        throw new HttpError(403, 'email-required', 'Confirm your email address to sign up');
      }
      email = await idOf(normalizeEmail(str(body, 'email', { max: 320 })));
      emailCode = emailCodeFrom(body, 'emailCode');
      checkCode(db, ctx.secret, email, 'signup', emailCode);
    }
    const displayName =
      str(body, 'displayName', { max: 64, optional: true }).trim() || str(body, 'username').trim();

    const authHash = await hashAuthKey(authKey);
    const recoveryHash = await recoveryHashFrom(body);
    const id = crypto.randomUUID();

    // Check the policy and claim the invite in the same transaction as the
    // insert, so two signups can't both become admin or share one invite.
    const user = db.transaction((tx) => {
      const isFirst = tx.select({ n: count() }).from(users).get()!.n === 0;
      const needsInvite = !isFirst && config.signup === 'invite';
      if (!isFirst && config.signup === 'closed') {
        throw new HttpError(403, 'signup-closed', 'This server is not accepting new accounts');
      }
      if (needsInvite && !inviteCode) {
        throw new HttpError(403, 'invite-required', 'An invite code is required');
      }
      if (tx.select({ id: users.id }).from(users).where(eq(users.username, username)).get()) {
        throw new HttpError(409, 'username-taken', 'That username is taken');
      }
      if (email && tx.select({ id: users.id }).from(users).where(eq(users.emailId, email)).get()) {
        throw new HttpError(409, 'email-taken', 'That email address already has an account');
      }
      if (email) consumeCode(tx, ctx.secret, email, 'signup', emailCode);
      const created = tx
        .insert(users)
        .values({
          id,
          username,
          displayName,
          authHash,
          kdfSalt: salt,
          kdfParams: kdf,
          role: isFirst ? 'admin' : 'user',
          emailId: email,
          recoveryHash,
          createdAt: Date.now(),
        })
        .returning()
        .get();
      if (needsInvite) {
        // Claimed after the insert (usedBy references the new user); throwing
        // here rolls the account back.
        const claimed = tx
          .update(invites)
          .set({ usedBy: id, usedAt: Date.now() })
          .where(and(eq(invites.code, inviteCode), isNull(invites.usedBy)))
          .returning({ code: invites.code })
          .get();
        if (!claimed) throw new HttpError(403, 'invite-invalid', 'That invite code is not valid');
      }
      return created;
    });

    registerLimit.hit(ip);
    return issue(c, user, str(body, 'deviceName', { max: 80, optional: true }));
  });

  app.post('/email/code', async (c) => {
    const mailer = ctx.mailer;
    if (!mailer) throw new HttpError(404, 'email-unavailable', 'This server does not send email');
    const body = await jsonBody(c);
    const email = normalizeEmail(str(body, 'email', { max: 320 }));
    const purpose = str(body, 'purpose', { max: 16 }) as EmailPurpose;
    if (!PURPOSES.includes(purpose)) throw badRequest('"purpose" must be signup, reset or change');
    const lang = emailLang(body.lang);

    if (purpose === 'signup' && config.signup !== 'email') {
      throw new HttpError(403, 'signup-closed', 'This server does not take email signups');
    }
    const session = purpose === 'change' ? currentSession(ctx, c) : undefined;
    if (purpose === 'change' && !session)
      throw new HttpError(401, 'unauthorized', 'Sign in required');

    const ip = clientIp(c, config);
    throttle(codeIpLimit, ip);
    codeIpLimit.hit(ip);
    const id = await idOf(email);
    throttle(codeEmailLimit, id);
    codeEmailLimit.hit(id);

    // The answer is the same whether or not the address has an account; what
    // differs is the email, which only the address's owner reads. The address
    // is used to send it and then forgotten.
    const owner = userByEmail(id);
    const code = () => issueCode(db, ctx.secret, id, purpose);
    let mail;
    if (purpose === 'signup') {
      mail = owner
        ? noticeEmail(email, 'taken', lang, host(c))
        : codeEmail(email, purpose, code(), lang, host(c));
    } else if (purpose === 'reset') {
      if (owner) mail = codeEmail(email, purpose, code(), lang, host(c));
    } else if (owner && owner.id !== session!.user.id) {
      mail = noticeEmail(email, 'inUse', lang, host(c));
    } else if (!owner) {
      mail = codeEmail(email, purpose, code(), lang, host(c));
    }
    if (mail) {
      try {
        await mailer.send(mail);
      } catch (err) {
        console.error('Sending email failed:', err);
        throw new HttpError(502, 'email-failed', 'The email could not be sent; try again later');
      }
    }
    return c.json({ ok: true });
  });

  app.post('/reset', async (c) => {
    const ip = clientIp(c, config);
    throttle(resetLimit, ip);
    resetLimit.hit(ip);
    const body = await jsonBody(c);
    const email = await idOf(normalizeEmail(str(body, 'email', { max: 320 })));
    const code = emailCodeFrom(body);
    const authKey = authKeyFrom(body);
    const { salt, kdf } = kdfFrom(body);
    checkCode(db, ctx.secret, email, 'reset', code);
    const authHash = await hashAuthKey(authKey);

    const user = db.transaction((tx) => {
      consumeCode(tx, ctx.secret, email, 'reset', code);
      const row = tx
        .update(users)
        .set({ authHash, kdfSalt: salt, kdfParams: kdf })
        .where(eq(users.emailId, email))
        .returning()
        .get();
      if (!row) throw new HttpError(400, 'email-code-invalid', 'That code is wrong or has expired');
      return row;
    });
    // Whoever knew the old password is signed out everywhere.
    revokeAllSessions(db, user.id);
    userLimit.reset(user.username);
    return issue(c, user, str(body, 'deviceName', { max: 80, optional: true }));
  });

  // Works whether or not the server sends email, so an address added while it
  // did can always be taken off.
  app.delete('/email', auth, (c) => {
    const user = db
      .update(users)
      .set({ emailId: null })
      .where(eq(users.id, c.get('user').id))
      .returning()
      .get()!;
    return c.json({ user: publicUser(user) });
  });

  app.post('/email', auth, async (c) => {
    const body = await jsonBody(c);
    const email = await idOf(normalizeEmail(str(body, 'email', { max: 320 })));
    const code = emailCodeFrom(body);
    checkCode(db, ctx.secret, email, 'change', code);
    const me = c.get('user');
    const user = db.transaction((tx) => {
      const owner = tx.select({ id: users.id }).from(users).where(eq(users.emailId, email)).get();
      if (owner && owner.id !== me.id) {
        throw new HttpError(409, 'email-taken', 'That email address already has an account');
      }
      consumeCode(tx, ctx.secret, email, 'change', code);
      return tx.update(users).set({ emailId: email }).where(eq(users.id, me.id)).returning().get()!;
    });
    return c.json({ user: publicUser(user) });
  });

  // Without email, the recovery code is how a forgotten password is replaced.
  // Wrong guesses are limited per address and per account; the code has 100
  // bits, so they're only there to keep the server's work down.
  app.post('/recover', async (c) => {
    const ip = clientIp(c, config);
    const body = await jsonBody(c);
    const username = normalizeUsername(str(body, 'username', { max: 64 }));
    throttle(recoverIpLimit, ip);
    throttle(recoverUserLimit, username);
    recoverIpLimit.hit(ip);
    const code = normalizeRecoveryCode(str(body, 'recoveryCode', { max: 64 })) ?? '';
    const authKey = authKeyFrom(body);
    const { salt, kdf } = kdfFrom(body);

    const user = db.select().from(users).where(eq(users.username, username)).get();
    const ok = await verifyAuthKey(code, user?.recoveryHash ?? DUMMY_AUTH_HASH);
    if (!user || !user.recoveryHash || !ok) {
      recoverUserLimit.hit(username);
      throw new HttpError(401, 'recovery-invalid', 'That username and recovery code don’t match');
    }
    const updated = db
      .update(users)
      .set({ authHash: await hashAuthKey(authKey), kdfSalt: salt, kdfParams: kdf })
      .where(eq(users.id, user.id))
      .returning()
      .get()!;
    // Whoever knew the old password is signed out everywhere.
    revokeAllSessions(db, user.id);
    recoverUserLimit.reset(username);
    userLimit.reset(username);
    return issue(c, updated, str(body, 'deviceName', { max: 80, optional: true }));
  });

  app.post('/recovery', auth, async (c) => {
    const body = await jsonBody(c);
    const authKey = authKeyFrom(body);
    const recoveryHash = await recoveryHashFrom(body);
    if (!recoveryHash) throw badRequest('"recoveryCode" is required');
    const me = c.get('user');
    const row = db
      .select({ authHash: users.authHash })
      .from(users)
      .where(eq(users.id, me.id))
      .get();
    if (!row || !(await verifyAuthKey(authKey, row.authHash))) {
      throw new HttpError(401, 'invalid-credentials', 'Password is wrong');
    }
    const user = db
      .update(users)
      .set({ recoveryHash })
      .where(eq(users.id, me.id))
      .returning()
      .get()!;
    return c.json({ user: publicUser(user) });
  });

  app.post('/login', async (c) => {
    const ip = clientIp(c, config);
    const body = await jsonBody(c);
    const username = normalizeUsername(str(body, 'username', { max: 64 }));
    const authKey = authKeyFrom(body);
    throttle(ipLimit, ip);
    throttle(userLimit, username);
    ipLimit.hit(ip);

    const user = db.select().from(users).where(eq(users.username, username)).get();
    // Verify against a dummy hash for unknown users so timing doesn't leak existence.
    const ok = await verifyAuthKey(authKey, user?.authHash ?? DUMMY_AUTH_HASH);
    if (!user || !ok) {
      userLimit.hit(username);
      throw new HttpError(401, 'invalid-credentials', 'Wrong username or password');
    }
    userLimit.reset(username);
    return issue(c, user, str(body, 'deviceName', { max: 80, optional: true }));
  });

  app.post('/logout', auth, (c) => {
    db.delete(sessions)
      .where(eq(sessions.id, c.get('sessionId')))
      .run();
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get('/me', auth, (c) => c.json({ user: publicUser(c.get('user')) }));

  app.post('/password', auth, async (c) => {
    const body = await jsonBody(c);
    const current = authKeyFrom(body);
    const next = authKeyFrom(body, 'newAuthKey');
    const { salt, kdf } = kdfFrom(body);
    const me = c.get('user');
    const row = db
      .select({ authHash: users.authHash })
      .from(users)
      .where(eq(users.id, me.id))
      .get();
    if (!row || !(await verifyAuthKey(current, row.authHash))) {
      throw new HttpError(401, 'invalid-credentials', 'Current password is wrong');
    }
    db.update(users)
      .set({ authHash: await hashAuthKey(next), kdfSalt: salt, kdfParams: kdf })
      .where(eq(users.id, me.id))
      .run();
    // Other devices hold sessions made with the old password; sign them out.
    revokeOtherSessions(db, me.id, c.get('sessionId'));
    return c.json({ ok: true });
  });

  // Deleting the account removes everything stored with it: sessions, library,
  // read state, settings, notes and their public pages (the schema cascades).
  app.post('/delete', auth, async (c) => {
    const authKey = authKeyFrom(await jsonBody(c));
    const me = c.get('user');
    const row = db
      .select({ authHash: users.authHash, role: users.role })
      .from(users)
      .where(eq(users.id, me.id))
      .get();
    if (!row || !(await verifyAuthKey(authKey, row.authHash))) {
      throw new HttpError(401, 'invalid-credentials', 'Password is wrong');
    }
    db.transaction((tx) => {
      if (row.role === 'admin') {
        // A server with people on it keeps someone who can run it.
        const admins = tx.select({ n: count() }).from(users).where(eq(users.role, 'admin')).get()!
          .n;
        const everyone = tx.select({ n: count() }).from(users).get()!.n;
        if (admins === 1 && everyone > 1) {
          throw new HttpError(
            409,
            'last-admin',
            'You run this server and others use it; make someone else an admin first',
          );
        }
      }
      tx.delete(users).where(eq(users.id, me.id)).run();
    });
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  return app;
}

export function deviceRoutes(ctx: AppContext) {
  const { db } = ctx;
  const app = new Hono<Env>();
  app.use(requireUser(ctx));

  app.get('/', (c) => {
    const rows = db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, c.get('user').id))
      .orderBy(desc(sessions.lastSeenAt))
      .all();
    const devices: Device[] = rows.map((s) => ({
      id: s.id,
      name: s.deviceName,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      current: s.id === c.get('sessionId'),
    }));
    return c.json({ devices });
  });

  app.delete('/:id', (c) => {
    const removed = db
      .delete(sessions)
      .where(and(eq(sessions.id, c.req.param('id')), eq(sessions.userId, c.get('user').id)))
      .returning({ id: sessions.id })
      .get();
    if (!removed) throw notFound('No such device');
    if (removed.id === c.get('sessionId')) clearSessionCookie(c);
    return c.json({ ok: true });
  });

  return app;
}

export function adminRoutes(ctx: AppContext) {
  const { db } = ctx;
  const app = new Hono<Env>();
  app.use(requireUser(ctx), requireAdmin);

  app.get('/invites', (c) => {
    const rows = db
      .select({
        code: invites.code,
        createdAt: invites.createdAt,
        usedBy: users.username,
        usedAt: invites.usedAt,
      })
      .from(invites)
      .leftJoin(users, eq(users.id, invites.usedBy))
      .orderBy(desc(invites.createdAt))
      .all();
    const list: Invite[] = rows.map((r) => ({
      code: r.code,
      createdAt: r.createdAt,
      usedBy: r.usedBy ?? undefined,
      usedAt: r.usedAt ?? undefined,
    }));
    return c.json({ invites: list });
  });

  app.post('/invites', (c) => {
    const code = randomToken(9);
    db.insert(invites)
      .values({ code, createdBy: c.get('user').id, createdAt: Date.now() })
      .run();
    return c.json({ code });
  });

  app.delete('/invites/:code', (c) => {
    db.delete(invites)
      .where(and(eq(invites.code, c.req.param('code')), isNull(invites.usedBy)))
      .run();
    return c.json({ ok: true });
  });

  return app;
}
