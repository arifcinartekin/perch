import { useState } from 'react';
import { feedIdFor } from '@perch/core/feeds';
import { bareHost } from '@perch/core/url';
import { starterPacksFor, type StarterPack } from '@perch/core/starter-packs';
import { Button } from '../components/Button';
import { useBackend, type CategoryChoice } from '../backend';
import { useLibrary } from '../hooks/useLibrary';
import { useToast } from './Toasts';

// Explore: the starter packs, any time (the empty-library screen shows them
// once). Add a whole pack or single feeds; what you already follow is marked.
// The list ships with the app, so browsing it tells no server anything.

const language = typeof navigator === 'undefined' ? 'en' : navigator.language;
const tr = language.toLowerCase().startsWith('tr');
const titleOf = (pack: StarterPack) => (tr ? pack.title.tr : pack.title.en);

export function ExploreView() {
  const backend = useBackend();
  const toast = useToast();
  const { feeds, categories } = useLibrary();
  const [busy, setBusy] = useState<string | null>(null);

  const following = new Set(feeds.flatMap((f) => [f.id, feedIdFor(f.url)]));
  const has = (url: string) => following.has(feedIdFor(url));
  /** The pack's own category when it already exists, else a new one named after it. */
  const categoryFor = (pack: StarterPack): CategoryChoice => {
    const existing = categories.find((c) => c.name === titleOf(pack));
    return existing ? { categoryId: existing.id } : { newCategory: titleOf(pack) };
  };

  const run = async (key: string, work: () => Promise<string>) => {
    setBusy(key);
    try {
      toast(await work(), 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const addPack = (pack: StarterPack) =>
    run(`pack:${pack.id}`, async () => {
      const missing = pack.feeds.filter((f) => !has(f.url)).map((f) => f.url);
      const { added } = await backend.addFeeds(missing, categoryFor(pack));
      return `${added} ${added === 1 ? 'feed' : 'feeds'} added`;
    });

  const addOne = (pack: StarterPack, url: string) =>
    run(`feed:${url}`, async () => (await backend.addFeed(url, categoryFor(pack))).message);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[760px]">
        <h1 className="text-[20px] font-bold tracking-tight">Explore</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
          A few well-known feeds per topic, picked by hand and listed in Perch’s source. Add a whole
          pack into its own category, or just the feeds you want.
        </p>

        <div className="mt-5 flex flex-col gap-3">
          {starterPacksFor(language).map((pack) => {
            const left = pack.feeds.filter((f) => !has(f.url)).length;
            return (
              <section key={pack.id} className="glass-card rounded-[14px] p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[14.5px] font-semibold">{titleOf(pack)}</h2>
                    <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                      {tr ? pack.description.tr : pack.description.en}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={left ? 'default' : 'ghost'}
                    disabled={!left || busy !== null}
                    loading={busy === `pack:${pack.id}`}
                    onClick={() => void addPack(pack)}
                  >
                    {left === 0
                      ? 'All added'
                      : left === pack.feeds.length
                        ? 'Add all'
                        : `Add ${left} more`}
                  </Button>
                </div>
                <ul className="mt-3 divide-y divide-[var(--border)]">
                  {pack.feeds.map((f) => (
                    <li key={f.url} className="flex items-center gap-2 py-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{f.title}</span>
                        <span className="text-[var(--text-faint)]">
                          {' '}
                          · {bareHost(f.url)}
                          {f.lang === 'tr' && !tr ? ' · Turkish' : ''}
                          {f.lang === 'en' && tr ? ' · English' : ''}
                        </span>
                      </span>
                      {has(f.url) ? (
                        <span className="text-[12px] text-[var(--text-faint)]">Added</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          loading={busy === `feed:${f.url}`}
                          onClick={() => void addOne(pack, f.url)}
                        >
                          Add
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
