import { useCallback, useEffect, useState } from 'react';
import type { Device, Invite, OpmlImportResponse, PublicUser, ServerInfo } from '@perch/core/api';
import { API_PREFIX } from '@perch/core/api';
import { relativeTime } from '@perch/core/time';
import { Button, Row, Section, Spinner, pickTextFile, useToast } from '@perch/reader';
import { ServerError, api } from './api';

// Settings that only exist on the web: the account on this server, signed-in
// email address, devices, invites (admins) and OPML import/export.

export function WebSettings({ user, onSignOut }: { user: PublicUser; onSignOut: () => void }) {
  return (
    <>
      <AccountSection user={user} onSignOut={onSignOut} />
      <EmailSection user={user} />
      <DevicesSection />
      {user.role === 'admin' && <InvitesSection />}
      <OpmlSection />
    </>
  );
}

function AccountSection({ user, onSignOut }: { user: PublicUser; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Account">
      <Row
        label={`Signed in as ${user.username}`}
        hint={`${user.role === 'admin' ? 'Admin of' : 'Account on'} ${location.host}. Use the same username and password in the Perch extension (Settings → Sync) to sync with it.`}
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

/** Add or change the account's address, confirmed with an emailed code. Hidden when the server can't send mail. */
function EmailSection({ user }: { user: PublicUser }) {
  const toast = useToast();
  const [available, setAvailable] = useState(false);
  const [current, setCurrent] = useState(user.email);
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
  if (!available) return null;

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
      setCurrent(res.user.email);
      setEditing(false);
      setSentTo(null);
      setCode('');
      toast('Email address saved', 'success');
    });

  return (
    <Section title="Email">
      <Row
        label={current ?? 'No email address'}
        hint={
          current
            ? 'Used to reset your password. It is never shown to anyone.'
            : 'Add one so you can reset your password if you forget it.'
        }
      >
        {!editing && (
          <Button size="sm" variant="default" onClick={() => setEditing(true)}>
            {current ? 'Change' : 'Add'}
          </Button>
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
