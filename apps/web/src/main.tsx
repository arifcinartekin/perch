import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import type { PublicUser, ServerInfo } from '@perch/core/api';
import { ReaderApp, Spinner } from '@perch/reader';
import './styles.css';
import { SIGNED_OUT_EVENT, api } from './api';
import { Auth } from './Auth';
import { Hub } from './Hub';
import { createServerBackend } from './backend';
import { WebSettings } from './WebSettings';

type Session =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'signed-out'; info: ServerInfo }
  | { status: 'signed-in'; user: PublicUser; info: ServerInfo };

function App() {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  const check = async () => {
    let info: ServerInfo;
    try {
      info = await api<ServerInfo>('/server');
    } catch (err) {
      return setSession({ status: 'error', message: (err as Error).message });
    }
    try {
      const { user } = await api<{ user: PublicUser }>('/auth/me');
      setSession({ status: 'signed-in', user, info });
    } catch {
      setSession({ status: 'signed-out', info });
    }
  };

  useEffect(() => {
    void check();
    const onSignedOut = () => void check();
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, []);

  if (session.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size={20} />
      </div>
    );
  }
  if (session.status === 'error') {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center text-[13px] text-[var(--text-muted)]">
        {session.message}
      </div>
    );
  }
  if (session.status === 'signed-out') {
    return (
      <Auth
        info={session.info}
        onSignedIn={(user) => setSession({ status: 'signed-in', user, info: session.info })}
      />
    );
  }
  // A hub keeps no libraries: its web app is the Perch account.
  if (session.info.mode === 'hub') {
    return (
      <Hub
        key={session.user.id}
        user={session.user}
        info={session.info}
        onSignOut={() => void check()}
      />
    );
  }
  return <Reader key={session.user.id} user={session.user} onSignOut={() => void check()} />;
}

function Reader({ user, onSignOut }: { user: PublicUser; onSignOut: () => void }) {
  // One backend per signed-in account.
  const backend = useMemo(() => createServerBackend(), []);
  useEffect(() => () => backend.close(), [backend]);
  return (
    <ReaderApp
      backend={backend}
      settingsExtra={<WebSettings user={user} onSignOut={onSignOut} />}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Installable, and the app shell opens without a network round trip.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
