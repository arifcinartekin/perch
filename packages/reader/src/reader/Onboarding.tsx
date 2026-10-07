import { useState } from 'react';
import { Button } from '../components/Button';
import { IconPlus, IconRss, IconSearch } from '../components/icons';
import { AddFeedDialog } from './AddFeedDialog';
import { useBackend } from '../backend';

export function Onboarding() {
  const backend = useBackend();
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-[420px] text-center animate-[slide-up_.24s_ease-out]">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]">
          <IconRss size={26} />
        </div>
        <h1 className="text-[20px] font-bold tracking-tight">Welcome to Perch</h1>
        <p className="mx-auto mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
          {backend.copy.onboarding}
        </p>

        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" onClick={() => setAdding(true)}>
            <IconPlus size={15} /> Add a feed
          </Button>
        </div>

        <div className="mt-8 flex items-start gap-2.5 rounded-[12px] border border-[var(--border)] bg-[var(--bg-solid)] p-3.5 text-left">
          <IconSearch size={16} className="mt-0.5 shrink-0 text-[var(--text-faint)]" />
          <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
            {backend.copy.onboardingNote}
          </p>
        </div>
      </div>

      {adding && <AddFeedDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
