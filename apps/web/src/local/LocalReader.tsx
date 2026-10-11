import { useMemo } from 'react';
import type { ServerInfo } from '@perch/core/api';
import { ReaderApp } from '@perch/reader';
import { localBackend } from '@/lib/backend';
import { CommunitySection } from '@/entrypoints/reader/pages/Community';
import { SyncSection } from '@/entrypoints/reader/pages/Sync';
import { routeFetchThroughProxy } from './net';
import { startLocalWorker } from './worker';

// The web reader on a hub: the extension's reader, run in the page. The
// library lives in this browser; a sync chain keeps it in step with your other
// devices; feeds come through the hub's anonymous proxy. Nothing about what
// you read is kept on the server.

export function LocalReader({ info }: { info: ServerInfo }) {
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
          {/* The Perch account, as in the extension: signed in with a token kept in
              this browser, on account.perch.ws (or wherever this server says). */}
          <CommunitySection defaultServer={info.accountUrl ?? location.origin} />
        </>
      }
    />
  );
}
