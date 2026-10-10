import { useState } from 'react';
import { downloadText } from '../lib/download';
import { Button } from './Button';

// The recovery code, shown once after it's made. The server keeps only its
// hash, so this is the only time anyone sees it.

export function RecoveryCode({
  code,
  host,
  onDone,
  doneLabel = 'Continue',
}: {
  code: string;
  host: string;
  onDone: () => void;
  doneLabel?: string;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] leading-relaxed text-[var(--text-muted)]">
        This is your recovery code. If you forget your password, it’s the only way back into your
        account. Keep it somewhere safe, like a password manager. It won’t be shown again.
      </p>
      <code className="select-all rounded-[10px] border border-[var(--border-strong)] bg-[var(--bg-solid)] px-3 py-3 text-center font-mono text-[16px] tracking-wider">
        {code}
      </code>
      <div className="flex gap-2">
        <Button size="sm" variant="default" type="button" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          size="sm"
          variant="default"
          type="button"
          onClick={() =>
            downloadText(
              `perch-recovery-${host}.txt`,
              `Perch recovery code for ${host}\n\n${code}\n`,
              'text/plain',
            )
          }
        >
          Save as file
        </Button>
      </div>
      <label className="flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I’ve saved my recovery code
      </label>
      <Button variant="primary" type="button" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}
