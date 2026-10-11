import { useState } from 'react';
import { starterPacksFor, type StarterPack } from '@perch/core/starter-packs';
import { Button } from '../components/Button';
import { useBackend } from '../backend';
import { useToast } from './Toasts';

// A few well-known feeds per topic, for an empty library. The list ships with
// the app (packages/core/src/starter-packs.ts): picking one tells no server.

const language = typeof navigator === 'undefined' ? 'en' : navigator.language;
const tr = language.toLowerCase().startsWith('tr');

export function StarterPacks() {
  const backend = useBackend();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const add = async (pack: StarterPack) => {
    setBusy(pack.id);
    try {
      const { added } = await backend.addFeeds(
        pack.feeds.map((f) => f.url),
        { newCategory: tr ? pack.title.tr : pack.title.en },
      );
      setDone((d) => new Set(d).add(pack.id));
      toast(`${added} ${added === 1 ? 'feed' : 'feeds'} added`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Starter packs" className="mt-8 text-left">
      <h2 className="text-[13px] font-semibold">Or start with a few well-known feeds</h2>
      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
        Picked by hand and listed in Perch’s source. Each pack goes into its own category; remove
        anything you don’t want.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {starterPacksFor(language).map((pack) => (
          <div key={pack.id} className="glass-card flex flex-col rounded-[14px] p-3.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">
                  {tr ? pack.title.tr : pack.title.en}
                </div>
                <div className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">
                  {tr ? pack.description.tr : pack.description.en}
                </div>
              </div>
              <Button
                size="sm"
                variant={done.has(pack.id) ? 'ghost' : 'default'}
                loading={busy === pack.id}
                disabled={done.has(pack.id) || (busy !== null && busy !== pack.id)}
                onClick={() => void add(pack)}
              >
                {done.has(pack.id) ? 'Added' : 'Add'}
              </Button>
            </div>
            <div className="mt-2 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
              {pack.feeds.map((f) => f.title).join(' · ')}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
