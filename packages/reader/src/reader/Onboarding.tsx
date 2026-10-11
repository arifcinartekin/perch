import { useState } from 'react';
import { Button } from '../components/Button';
import { IconPlus, IconSearch } from '../components/icons';
import { PerchMark } from '../components/PerchMark';
import { AddFeedDialog } from './AddFeedDialog';
import { StarterPacks } from './StarterPacks';
import { useBackend } from '../backend';

export function Onboarding() {
  const backend = useBackend();
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-8 sm:items-center">
      <div className="w-full max-w-[640px] text-center animate-[slide-up_.24s_ease-out]">
        <PerchMark size={88} className="mx-auto mb-4" />
        <h1 className="text-[20px] font-bold tracking-tight">Welcome to Perch</h1>
        <p className="mx-auto mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
          {backend.copy.onboarding}
        </p>

        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" onClick={() => setAdding(true)}>
            <IconPlus size={15} /> Add a feed
          </Button>
        </div>

        <StarterPacks />

        <div className="glass-card mt-8 flex items-start gap-2.5 rounded-[14px] p-3.5 text-left">
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
