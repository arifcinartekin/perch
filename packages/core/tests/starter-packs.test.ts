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

  it('match the copies the iPhone and Android apps ship (npm run starter-packs)', () => {
    for (const path of [
      '../../../apps/ios/Perch/Support/starter-packs.json',
      '../../../apps/android/app/src/main/assets/starter-packs.json',
    ]) {
      expect(JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))).toEqual(
        STARTER_PACKS,
      );
    }
  });
});
