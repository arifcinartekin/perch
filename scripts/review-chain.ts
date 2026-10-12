// Makes a sync chain for app reviewers to join: a few starter feeds in a
// category and a note, on a relay (sync.perch.ws unless given). Prints the
// code, which goes only into App Store Connect / Play Console, never the repo.
//   npm run review-chain [-- https://relay.example.com]
import {
  deriveChainKeys,
  formatChainCode,
  newChainSecret,
  sealRecord,
} from '../packages/core/src/chain.ts';
import { feedIdFor } from '../packages/core/src/feeds.ts';
import { STARTER_PACKS } from '../packages/core/src/starter-packs.ts';
import { formatHlc } from '../packages/core/src/sync.ts';

const relay = (process.argv[2] ?? 'https://sync.perch.ws').replace(/\/+$/, '');
const secret = newChainSecret();
const code = formatChainCode(secret);
const keys = await deriveChainKeys(secret);

async function call(path: string, body: unknown) {
  const res = await fetch(`${relay}/api/v1/chain${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${keys.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${relay} answered ${res.status}: ${await res.text()}`);
  return res.json();
}

const now = Date.now();
let counter = 0;
const hlc = () => formatHlc(now, counter++, 'review');
const pack = STARTER_PACKS.find((p) => p.id === 'science') ?? STARTER_PACKS[0]!;
const feeds = pack.feeds.slice(0, 4);
const records = [
  { type: 'category', id: 'review', data: { name: pack.title.en, order: 10, collapsed: false } },
  ...feeds.map((f, i) => ({
    type: 'feed',
    id: feedIdFor(f.url),
    data: { url: f.url, title: f.title, categoryId: 'review', addedAt: now - i },
  })),
  {
    type: 'note',
    id: `${feedIdFor(feeds[0]!.url)}:welcome`,
    data: {
      feedId: feedIdFor(feeds[0]!.url),
      articleId: 'welcome',
      title: 'A note that came through the chain',
      feedTitle: feeds[0]!.title,
      body: 'Notes, feeds and settings travel between devices end-to-end encrypted.',
      createdAt: now,
      updatedAt: now,
    },
  },
];

await call('', {});
const sealed = await Promise.all(
  records.map((r) => sealRecord(keys, { ...r, hlc: hlc() } as never)),
);
const res = (await call('/push', { records: sealed })) as { results: { status: string }[] };
const ok = res.results.filter((r) => r.status === 'ok').length;
console.log(`${ok}/${records.length} records on ${relay}`);
console.log(code);
