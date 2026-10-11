import { readFileSync } from 'node:fs';
import { STARTER_PACKS, starterPacksFor } from '../src/starter-packs';

describe('starter packs', () => {
  it('have unique ids and feeds, with https addresses', () => {
    expect(new Set(STARTER_PACKS.map((p) => p.id)).size).toBe(STARTER_PACKS.length);
    const urls = STARTER_PACKS.flatMap((p) => p.feeds.map((f) => f.url));
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(new URL(url).protocol).toBe('https:');
  });

  it('come in the viewer’s language first', () => {
    expect(starterPacksFor('tr-TR')[0]!.lang).toBe('tr');
    expect(starterPacksFor('en-GB')[0]!.lang).toBe('en');
  });

  it('match the copy the iPhone app ships (npm run starter-packs)', () => {
    const ios = JSON.parse(
      readFileSync(
        new URL('../../../apps/ios/Perch/Support/starter-packs.json', import.meta.url),
        'utf8',
      ),
    );
    expect(ios).toEqual(STARTER_PACKS);
  });
});
