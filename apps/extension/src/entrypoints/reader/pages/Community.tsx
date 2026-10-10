import { useEffect, useState } from 'react';
import { newRecoveryCode } from '@perch/core/recovery';
import { Button, Dialog, RecoveryCode, Row, Section, Spinner, useToast } from '@perch/reader';
import {
  clearCommunity,
  getCommunity,
  saveCommunity,
  watchCommunity,
  type CommunityAccount,
} from '@/lib/community';
import { deleteAccount, setRecoveryCode, signOutRemote } from '@/lib/sync/client';
import { SignInForm } from './Sync';

// Settings → Perch account: the name notes are shared under. Kept apart from
// Sync on purpose: any library, however it syncs, can share through it.

const inputClass =
  'w-full rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg-solid)] px-2.5 py-1.5 text-[13px]';

export function CommunitySection() {
  const [account, setAccount] = useState<CommunityAccount | null | undefined>(undefined);
  const [form, setForm] = useState(false);

  useEffect(() => {
    const load = () => void getCommunity().then(setAccount);
    load();
    return watchCommunity(load);
  }, []);

  let body: React.ReactNode;
  if (account === undefined) {
    body = <Spinner size={14} />;
  } else if (account) {
    body = <Connected account={account} />;
  } else if (form) {
    body = (
      <SignInForm
        purpose="community"
        onCancel={() => setForm(false)}
        onSignedIn={async ({ server, username, token }) => {
          await saveCommunity({ server, username, token });
          setForm(false);
        }}
      />
    );
  } else {
    body = (
      <Row
        label="Perch account"
        hint="Your name for sharing notes as public pages, on app.perch.ws or a server you run. It
        doesn’t sync your library and isn’t needed to read: your feeds stay in this browser."
      >
        <Button size="sm" variant="default" onClick={() => setForm(true)}>
          Sign in or create
        </Button>
      </Row>
    );
  }
  return <Section title="Perch account">{body}</Section>;
}

function Connected({ account }: { account: CommunityAccount }) {
  const toast = useToast();
  const host = new URL(account.server).host;
  const [dialog, setDialog] = useState<null | 'recovery' | 'delete'>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  const close = () => {
    setDialog(null);
    setPassword('');
    setError(null);
    setShown(null);
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Row
        label={`@${account.username} on ${host}`}
        hint="Notes you share are published under this name. Change your password or see your signed-in devices on the web."
      >
        <div className="flex flex-wrap gap-2">
          <a
            href={account.server}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-[9px] px-2.5 py-1 text-[12.5px] font-medium text-[var(--accent-text)] hover:underline"
          >
            Manage
          </a>
          <Button size="sm" variant="default" onClick={() => setDialog('recovery')}>
            New recovery code
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await signOutRemote(account);
              await clearCommunity();
              toast('Signed out of your Perch account', 'info');
            }}
          >
            Sign out
          </Button>
        </div>
      </Row>
      <button
        type="button"
        className="mt-1 text-[11.5px] text-[var(--text-faint)] hover:text-[#ef4444]"
        onClick={() => setDialog('delete')}
      >
        Delete Perch account…
      </button>

      {dialog && (
        <Dialog
          title={dialog === 'delete' ? 'Delete your Perch account?' : 'New recovery code'}
          onClose={close}
          footer={
            shown ? undefined : (
              <>
                <Button size="sm" variant="ghost" onClick={close}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant={dialog === 'delete' ? 'danger' : 'primary'}
                  loading={busy}
                  disabled={!password}
                  onClick={() =>
                    run(async () => {
                      if (dialog === 'delete') {
                        await deleteAccount(account, password);
                        await clearCommunity();
                        toast('Perch account deleted', 'info');
                        close();
                      } else {
                        const code = newRecoveryCode();
                        await setRecoveryCode(account, password, code);
                        setShown(code);
                      }
                    })
                  }
                >
                  {dialog === 'delete' ? 'Delete account' : 'Make code'}
                </Button>
              </>
            )
          }
        >
          {shown ? (
            <RecoveryCode
              code={shown}
              username={account.username}
              host={host}
              doneLabel="Done"
              onDone={close}
            />
          ) : (
            <>
              <p className="mb-3 text-[13px] text-[var(--text-muted)]">
                {dialog === 'delete'
                  ? `This removes your account on ${host} and every note you shared from it. Your library here isn’t affected. It can’t be undone.`
                  : 'Making a new recovery code replaces the old one, which stops working.'}
              </p>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
              {error && <p className="mt-2 text-[11.5px] text-[#ef4444]">{error}</p>}
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
