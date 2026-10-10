import { useEffect, useMemo, useState } from 'react';
import type { PublicUser } from '@perch/core/api';
import { Button, ReaderApp, Row, Section } from '@perch/reader';
import { localBackend } from '@/lib/backend';
import { clearCommunity, getCommunity, saveCommunity } from '@/lib/community';
import { SyncSection } from '@/entrypoints/reader/pages/Sync';
import { routeFetchThroughProxy } from './net';
import { startLocalWorker } from './worker';

// The web reader on a hub: the extension's reader, run in the page. The
// library lives in this browser; a sync chain keeps it in step with your other
// devices; feeds come through the hub's anonymous proxy. Nothing about what
// you read is kept on the server.

export function LocalReader() {
  const backend = useMemo(() => {
    routeFetchThroughProxy();
    startLocalWorker();
    return localBackend;
  }, []);

  return (
    <ReaderApp
      backend={backend}
      settingsExtra={
        <>
          <SyncSection servers={false} />
          <AccountSection />
        </>
      }
    />
  );
}

/**
 * The Perch account here is this server's sign-in (the session cookie); the
 * reader shares notes through it like the extension does through its account.
 */
function AccountSection() {
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/v1/auth/me').catch(() => null);
      if (res?.ok) {
        const { user } = (await res.json()) as { user: PublicUser };
        await saveCommunity({ server: location.origin, username: user.username, token: '' });
        setUser(user);
      } else {
        if ((await getCommunity())?.server === location.origin) await clearCommunity();
        setUser(null);
      }
    })();
  }, []);

  return (
    <Section title="Perch account">
      {user ? (
        <Row
          label={`@${user.username}`}
          hint="Notes you share are published under this name. Your library stays in this browser."
        >
          <a
            href="/account"
            className="text-[12.5px] font-medium text-[var(--accent-text)] hover:underline"
          >
            Manage
          </a>
        </Row>
      ) : (
        user === null && (
          <Row
            label="Perch account"
            hint="Your name for sharing notes. You don’t need one to read: your feeds stay in this browser."
          >
            <Button size="sm" variant="default" onClick={() => location.assign('/account')}>
              Sign in or create
            </Button>
          </Row>
        )
      )}
    </Section>
  );
}
