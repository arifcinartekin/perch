import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { currentSession } from './auth/sessions';
import type { AppContext, Env } from './http';

// DiscourseConnect: a Discourse forum (community.perch.ws) signs people in
// with their Perch account instead of asking for an email address. The forum
// sends its visitor here with a signed nonce; we ask the visitor to confirm,
// then send back a signed payload with the username and a stable id, and
// nothing else. Discourse insists on an email field, so it gets an address
// under .invalid that can never receive mail (the forum runs with email off).
//
// The forum and this server share PERCH_DISCOURSE_SECRET; the forum's
// "discourse connect url" is <account address>/discourse/sso.

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('hex');

function verified(secret: string, sso: string, sig: string): boolean {
  const expected = Buffer.from(sign(secret, sso), 'hex');
  const actual = Buffer.from(sig, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The fields Discourse sends, or null when the request isn't a valid one from our forum. */
function request(ctx: AppContext, sso: string | undefined, sig: string | undefined) {
  const forum = ctx.config.discourse;
  if (!forum || !sso || !sig || sso.length > 4096 || !/^[0-9a-f]{64}$/i.test(sig)) return null;
  if (!verified(forum.secret, sso, sig)) return null;
  const fields = new URLSearchParams(Buffer.from(sso, 'base64').toString('utf8'));
  const nonce = fields.get('nonce');
  const returnUrl = fields.get('return_sso_url');
  if (!nonce || !returnUrl) return null;
  // Only back to our own forum, so a stolen secret can't bounce people elsewhere.
  try {
    if (new URL(returnUrl).origin !== new URL(forum.url).origin) return null;
  } catch {
    return null;
  }
  return { nonce, returnUrl };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** A small page in Perch's colours (light and dark), English or Turkish. */
function page(lang: 'en' | 'tr', body: string): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Perch</title>
<style>
:root{color-scheme:light dark;--bg:#f7f5f0;--card:#fff;--text:#12151c;--muted:#555a66;--ember:#ff7a1a}
@media (prefers-color-scheme:dark){:root{--bg:#0e1118;--card:#161a24;--text:#f4f1ea;--muted:#b8b4aa}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,sans-serif;padding:16px;box-sizing:border-box}
main{max-width:420px;background:var(--card);border-radius:20px;padding:28px;box-shadow:0 20px 48px -24px rgba(0,0,0,.4)}
h1{font-size:22px;margin:0 0 8px}p{color:var(--muted);margin:0 0 16px}
button{font:600 15px system-ui,sans-serif;background:var(--ember);color:#12151c;border:0;border-radius:12px;padding:12px 18px;cursor:pointer}
a{color:var(--muted)}.row{display:flex;gap:16px;align-items:center}
</style></head><body><main>${body}</main></body></html>`;
}

export function discourseRoutes(ctx: AppContext) {
  const app = new Hono<Env>();

  // Nothing but its own styles; the form may go here and, by the redirect
  // that follows, to the forum.
  app.use('*', async (c, next) => {
    await next();
    c.header(
      'content-security-policy',
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(ctx.config.discourse!.url).origin}; frame-ancestors 'none'; base-uri 'none'`,
    );
    c.header('cache-control', 'no-store');
  });

  const text = (accept: string | undefined) => {
    const tr = /^tr\b/i.test(accept ?? '');
    return {
      lang: (tr ? 'tr' : 'en') as 'en' | 'tr',
      title: tr ? 'Foruma giriş' : 'Sign in to the forum',
      as: (name: string, host: string) =>
        tr
          ? `${esc(host)} adresine <strong>@${esc(name)}</strong> olarak giriş yapacaksın. Foruma yalnızca kullanıcı adın ve hesabının sabit kimliği gider; e-posta adresi ya da başka bir bilgi gitmez.`
          : `You're signing in to ${esc(host)} as <strong>@${esc(name)}</strong>. The forum gets only your username and your account's fixed id: no email address, nothing else.`,
      go: tr ? 'Devam et' : 'Continue',
      cancel: tr ? 'Vazgeç' : 'Cancel',
      bad: tr
        ? 'Bu giriş bağlantısı geçerli değil. Forumdan yeniden dene.'
        : "This sign-in link isn't valid. Try again from the forum.",
    };
  };

  // Discourse sends the visitor here. Signed out: sign in first, then come back.
  app.get('/sso', (c) => {
    const t = text(c.req.header('accept-language'));
    const req = request(ctx, c.req.query('sso'), c.req.query('sig'));
    if (!req) return c.html(page(t.lang, `<h1>${t.title}</h1><p>${t.bad}</p>`), 400);
    const session = currentSession(ctx, c);
    if (!session) {
      const here = new URL(c.req.url);
      return c.redirect(`/?next=${encodeURIComponent(here.pathname + here.search)}`, 302);
    }
    const host = new URL(req.returnUrl).host;
    return c.html(
      page(
        t.lang,
        `<h1>${t.title}</h1><p>${t.as(session.user.username, host)}</p>
<form method="post" class="row"><input type="hidden" name="sso" value="${esc(c.req.query('sso')!)}">
<input type="hidden" name="sig" value="${esc(c.req.query('sig')!)}">
<button type="submit">${t.go}</button><a href="${esc(new URL(req.returnUrl).origin)}">${t.cancel}</a></form>`,
      ),
    );
  });

  // Confirmed: back to the forum with the signed answer. The session cookie is
  // SameSite=Strict, so only a form on this site can get here signed in.
  app.post('/sso', async (c) => {
    const t = text(c.req.header('accept-language'));
    const form = await c.req.parseBody();
    const sso = typeof form.sso === 'string' ? form.sso : undefined;
    const sig = typeof form.sig === 'string' ? form.sig : undefined;
    const req = request(ctx, sso, sig);
    const session = currentSession(ctx, c);
    if (!req || !session) return c.html(page(t.lang, `<h1>${t.title}</h1><p>${t.bad}</p>`), 400);
    const user = session.user;
    const payload = Buffer.from(
      new URLSearchParams({
        nonce: req.nonce,
        external_id: user.id,
        username: user.username,
        name: user.displayName || user.username,
        email: `${user.id}@users.perch.invalid`,
        require_activation: 'false',
        suppress_welcome_message: 'true',
        admin: String(user.role === 'admin'),
      }).toString(),
    ).toString('base64');
    const back = new URL(req.returnUrl);
    back.searchParams.set('sso', payload);
    back.searchParams.set('sig', sign(ctx.config.discourse!.secret, payload));
    return c.redirect(back.toString(), 302);
  });

  return app;
}
