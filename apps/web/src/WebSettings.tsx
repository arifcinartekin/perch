import { useCallback, useEffect, useState } from 'react';
import type {
  Device,
  HiddenShare,
  ReportItem,
  ReportReason,
  Invite,
  OpmlImportResponse,
  PreloginResponse,
  PublicUser,
  ServerInfo,
} from '@perch/core/api';
import { API_PREFIX } from '@perch/core/api';
import { deriveKeys } from '@perch/core/auth';
import { relativeTime } from '@perch/core/time';
import { newRecoveryCode } from '@perch/core/recovery';
import { Button, RecoveryCode, Row, Section, Spinner, pickTextFile, useToast } from '@perch/reader';
import { ServerError, api } from './api';

// Settings that only exist on the web: the account on this server, signed-in
// email address, devices, invites (admins), OPML import/export and deleting
// the account.

export function WebSettings({
  user,
  onSignOut,
  hub = false,
}: {
  user: PublicUser;
  onSignOut: () => void;
  /** A hub keeps no library, so there's nothing to import or export. */
  hub?: boolean;
}) {
  return (
    <>
      <AccountSection user={user} onSignOut={onSignOut} hub={hub} />
      <EmailSection user={user} />
      <RecoverySection user={user} />
      <DevicesSection />
      {user.role === 'admin' && <ReportsSection />}
      {user.role === 'admin' && <InvitesSection />}
      {!hub && <OpmlSection />}
      <DeleteAccountSection user={user} onDeleted={onSignOut} hub={hub} />
    </>
  );
}

function AccountSection({
  user,
  onSignOut,
  hub,
}: {
  user: PublicUser;
  onSignOut: () => void;
  hub: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Account">
      <Row
        label={`Signed in as ${user.username}`}
        hint={
          hub
            ? `Your Perch account on ${location.host}: your name for sharing notes. Sign in with it in the extension or the iPhone app under Settings → Perch account.`
            : `${user.role === 'admin' ? 'Admin of' : 'Account on'} ${location.host}. Use the same username and password in the Perch extension (Settings → Sync) to sync with it.`
        }
      >
        <Button
          size="sm"
          variant="default"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await api('/auth/logout', { body: {} }).catch(() => {});
            onSignOut();
          }}
        >
          Sign out
        </Button>
      </Row>
    </Section>
  );
}

const fieldClass =
  'w-full rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg-solid)] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]';

/**
 * Add or change the account's address, confirmed with an emailed code, or
 * remove it. Hidden when the server can't send mail and there's none to remove.
 */
function EmailSection({ user }: { user: PublicUser }) {
  const toast = useToast();
  const [available, setAvailable] = useState(false);
  const [current, setCurrent] = useState(!!user.hasEmail);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<ServerInfo>('/server').then(
      (i) => setAvailable(!!i.email),
      () => {},
    );
  }, []);
  if (!available && !current) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof ServerError ? err.message : 'Something went wrong. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      await api('/auth/email/code', {
        body: { email: email.trim(), purpose: 'change', lang: navigator.language },
      });
      setSentTo(email.trim());
    });
  const confirm = () =>
    run(async () => {
      const res = await api<{ user: PublicUser }>('/auth/email', {
        body: { email: sentTo, code },
      });
      setCurrent(!!res.user.hasEmail);
      setEditing(false);
      setSentTo(null);
      setCode('');
      toast('Email address saved', 'success');
    });

  return (
    <Section title="Email">
      <Row
        label={current ? 'An email address is added' : 'No email address'}
        hint={
          !available
            ? 'This server doesn’t send email any more, so the address isn’t used. You can remove it.'
            : current
              ? 'Used only to reset your password. The server keeps a hash of it, not the address, so it can’t show it here.'
              : 'Add one so you can reset your password if you forget it.'
        }
      >
        {!editing && (
          <div className="flex gap-2">
            {available && (
              <Button size="sm" variant="default" onClick={() => setEditing(true)}>
                {current ? 'Change' : 'Add'}
              </Button>
            )}
            {current && (
              <Button
                size="sm"
                variant="ghost"
                loading={busy}
                onClick={() =>
                  run(async () => {
                    const res = await api<{ user: PublicUser }>('/auth/email', {
                      method: 'DELETE',
                    });
                    setCurrent(!!res.user.hasEmail);
                    toast('Email address removed', 'success');
                  })
                }
              >
                Remove
              </Button>
            )}
          </div>
        )}
      </Row>
      {editing && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void (sentTo ? confirm() : send());
          }}
        >
          {sentTo ? (
            <>
              <p className="text-[12px] text-[var(--text-muted)]">
                Enter the 6-digit code we sent to {sentTo}.
              </p>
              <input
                className={fieldClass}
                placeholder="Code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </>
          ) : (
            <input
              className={fieldClass}
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" type="submit" loading={busy}>
              {sentTo ? 'Confirm' : 'Send code'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => {
                setEditing(false);
                setSentTo(null);
                setCode('');
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function DevicesSection() {
  const toast = useToast();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const load = useCallback(
    () => void api<{ devices: Device[] }>('/devices').then((r) => setDevices(r.devices)),
    [],
  );
  useEffect(load, [load]);

  return (
    <Section title="Devices">
      {!devices ? (
        <Spinner size={14} />
      ) : (
        devices.map((d) => (
          <Row
            key={d.id}
            label={d.current ? `${d.name} (this browser)` : d.name}
            hint={`Signed in ${relativeTime(d.createdAt)} · last seen ${relativeTime(d.lastSeenAt)}`}
          >
            {!d.current && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await api(`/devices/${d.id}`, { method: 'DELETE' });
                  toast(`${d.name} signed out`, 'info');
                  load();
                }}
              >
                Sign out
              </Button>
            )}
          </Row>
        ))
      )}
    </Section>
  );
}

function InvitesSection() {
  const toast = useToast();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const load = useCallback(
    () => void api<{ invites: Invite[] }>('/admin/invites').then((r) => setInvites(r.invites)),
    [],
  );
  useEffect(load, [load]);

  const create = async () => {
    const { code } = await api<{ code: string }>('/admin/invites', { body: {} });
    await navigator.clipboard?.writeText(code).catch(() => {});
    toast('Invite code created and copied', 'success');
    load();
  };

  const open = invites?.filter((i) => !i.usedBy) ?? [];
  const used = invites?.filter((i) => i.usedBy) ?? [];

  return (
    <Section title="Invites">
      <Row
        label="Invite someone"
        hint="New accounts on this server need a code. Each code works once."
      >
        <Button size="sm" variant="default" onClick={create}>
          New invite code
        </Button>
      </Row>
      {open.map((i) => (
        <Row key={i.code} label={i.code} hint={`Created ${relativeTime(i.createdAt)} · unused`}>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await api(`/admin/invites/${i.code}`, { method: 'DELETE' });
              load();
            }}
          >
            Revoke
          </Button>
        </Row>
      ))}
      {used.length > 0 && (
        <p className="text-[11.5px] text-[var(--text-faint)]">
          Used by {used.map((i) => i.usedBy).join(', ')}.
        </p>
      )}
    </Section>
  );
}

function OpmlSection() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Import & export">
      <Row
        label="Export subscriptions"
        hint="An OPML file every feed reader understands, FreshRSS included."
      >
        <a
          href={`${API_PREFIX}/reader/opml`}
          download="perch-subscriptions.opml"
          className="inline-flex h-7 items-center rounded-[8px] border border-[var(--border-strong)] px-2.5 text-[12px] font-medium hover:bg-[var(--accent-soft)]"
        >
          Download OPML
        </a>
      </Row>
      <Row
        label="Import subscriptions"
        hint="From FreshRSS, Feedly, Inoreader or any OPML export. Feeds are fetched in the background."
      >
        <Button
          size="sm"
          variant="default"
          loading={busy}
          onClick={async () => {
            const file = await pickTextFile('.opml,.xml,text/xml,application/xml');
            if (!file) return;
            setBusy(true);
            try {
              const r = await api<OpmlImportResponse>('/reader/opml', { raw: file.text });
              toast(
                `Imported ${r.added} feed${r.added === 1 ? '' : 's'}` +
                  (r.existing ? ` (${r.existing} already here)` : ''),
                'success',
              );
            } catch (err) {
              toast((err as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Import OPML
        </Button>
      </Row>
    </Section>
  );
}

/** Make a new recovery code (the old one stops working), after the password. */
function RecoverySection({ user }: { user: PublicUser }) {
  const toast = useToast();
  const [available, setAvailable] = useState(false);
  const [has, setHas] = useState(!!user.hasRecovery);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    void api<ServerInfo>('/server').then(
      (i) => setAvailable(!!i.recovery),
      () => {},
    );
  }, []);
  if (!available) return null;

  const create = async () => {
    setBusy(true);
    try {
      const pre = await api<PreloginResponse>('/auth/prelogin', {
        body: { username: user.username },
      });
      const { authKey } = await deriveKeys(password, pre.salt, pre.kdf);
      const recoveryCode = newRecoveryCode();
      await api('/auth/recovery', { body: { authKey, recoveryCode } });
      setHas(true);
      setOpen(false);
      setPassword('');
      setShown(recoveryCode);
    } catch (err) {
      toast(err instanceof ServerError ? err.message : 'Something went wrong. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Recovery code">
      {shown ? (
        <div className="px-1 pb-2">
          <RecoveryCode
            code={shown}
            username={user.username}
            host={location.host}
            doneLabel="Done"
            onDone={() => setShown(null)}
          />
        </div>
      ) : (
        <>
          <Row
            label={has ? 'A recovery code is set' : 'No recovery code'}
            hint={
              has
                ? 'If you forget your password, the code lets you set a new one. Making a new code replaces the old one.'
                : 'Without one, a forgotten password means a lost account. Make one and keep it somewhere safe.'
            }
          >
            {!open && (
              <Button size="sm" variant="default" onClick={() => setOpen(true)}>
                {has ? 'New code…' : 'Make one…'}
              </Button>
            )}
          </Row>
          {open && (
            <form
              className="flex flex-wrap items-center gap-2 px-1 pb-2"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <input
                type="password"
                autoComplete="current-password"
                required
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${fieldClass} max-w-[240px]`}
              />
              <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!password}>
                Make code
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </form>
          )}
        </>
      )}
    </Section>
  );
}

/** Deletes the account and everything on this server with it, after the password. */
function DeleteAccountSection({
  user,
  onDeleted,
  hub,
}: {
  user: PublicUser;
  onDeleted: () => void;
  hub: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      const pre = await api<PreloginResponse>('/auth/prelogin', {
        body: { username: user.username },
      });
      const { authKey } = await deriveKeys(password, pre.salt, pre.kdf);
      await api('/auth/delete', { body: { authKey } });
      onDeleted();
    } catch (err) {
      toast(err instanceof ServerError ? err.message : 'Something went wrong. Try again.', 'error');
      setBusy(false);
    }
  };

  return (
    <Section title="Delete account">
      <Row
        label="Delete your account"
        hint={
          hub
            ? `Removes your account on ${location.host} and every note you shared from it. It can’t be undone. Your library on your devices isn’t affected.`
            : `Removes your account on ${location.host} with your feeds, read state, settings, notes and shared pages. It can’t be undone. What’s stored on your devices stays there.`
        }
      >
        {!open && (
          <Button size="sm" variant="default" onClick={() => setOpen(true)}>
            Delete…
          </Button>
        )}
      </Row>
      {open && (
        <form
          className="flex flex-wrap items-center gap-2 px-1 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            void remove();
          }}
        >
          <input
            type="password"
            autoComplete="current-password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${fieldClass} max-w-[240px]`}
          />
          <Button size="sm" variant="danger" type="submit" loading={busy} disabled={!password}>
            Delete my account
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      )}
    </Section>
  );
}

const REASONS: Record<ReportReason, string> = {
  illegal: 'Illegal',
  harassment: 'Harassment or hate',
  spam: 'Spam',
  other: 'Something else',
};

/**
 * Reports on shared notes (admins). Removing takes the page down for every
 * report on it; dismissing leaves it up. A removed page can be put back,
 * e.g. when its author objects. Under Law 5651, aim to look within 48 hours.
 */
function ReportsSection() {
  const toast = useToast();
  const [reports, setReports] = useState<ReportItem[] | null>(null);
  const [hidden, setHidden] = useState<HiddenShare[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [open, removed] = await Promise.all([
        api<{ reports: ReportItem[] }>('/admin/reports'),
        api<{ hidden: HiddenShare[] }>('/admin/reports/hidden'),
      ]);
      setReports(open.reports);
      setHidden(removed.hidden);
    } catch {
      setReports([]);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const act = async (key: string, work: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await work();
      toast(done, 'success');
      await load();
    } catch (err) {
      toast(err instanceof ServerError ? err.message : 'Something went wrong. Try again.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Reports">
      {reports === null ? (
        <Spinner size={16} />
      ) : reports.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-muted)]">No open reports.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((r) => (
            <li
              key={r.id}
              className="rounded-[12px] border border-[var(--border)] p-3 text-[12.5px] leading-relaxed"
            >
              <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-[var(--text-faint)]">
                <span className="font-semibold text-[var(--text)]">{REASONS[r.reason]}</span>
                <span>· {relativeTime(r.createdAt)}</span>
                {r.contact && (
                  <a href={`mailto:${r.contact}`} className="underline">
                    {r.contact}
                  </a>
                )}
              </div>
              {r.details && <p className="mt-1 whitespace-pre-wrap">{r.details}</p>}
              <div className="mt-2 rounded-[9px] bg-[var(--bg-solid)] p-2.5">
                <a
                  href={r.share.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                >
                  {r.share.title || 'Untitled'}
                </a>
                <span className="text-[var(--text-faint)]"> · @{r.share.author}</span>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[var(--text-muted)]">
                  {r.share.body}
                </p>
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === `hide:${r.id}`}
                  onClick={() =>
                    void act(
                      `hide:${r.id}`,
                      () => api(`/admin/reports/${r.id}`, { body: { action: 'hide' } }),
                      'Page removed',
                    )
                  }
                >
                  Remove page
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === `dismiss:${r.id}`}
                  onClick={() =>
                    void act(
                      `dismiss:${r.id}`,
                      () => api(`/admin/reports/${r.id}`, { body: { action: 'dismiss' } }),
                      'Report dismissed',
                    )
                  }
                >
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {hidden.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
            Removed pages
          </div>
          <ul className="flex flex-col gap-1.5">
            {hidden.map((h) => (
              <li key={h.slug} className="flex items-center gap-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate">
                  {h.title || 'Untitled'}
                  <span className="text-[var(--text-faint)]">
                    {' '}
                    · @{h.author} · {relativeTime(h.hiddenAt)}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === `restore:${h.slug}`}
                  onClick={() =>
                    void act(
                      `restore:${h.slug}`,
                      () => api(`/admin/reports/hidden/${h.slug}/restore`, { body: {} }),
                      'Page restored',
                    )
                  }
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[11px] text-[var(--text-faint)]">
        Reporters’ addresses are deleted once a report is dealt with. Law 5651 expects unlawful
        content to be removed promptly after notice; aim to look within 48 hours.
      </p>
    </Section>
  );
}
