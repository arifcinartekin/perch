// Writes the iPhone and Android apps' copies of the starter packs from packages/core.
//   npm run starter-packs
import { writeFileSync } from 'node:fs';
import { STARTER_PACKS } from '../packages/core/src/starter-packs.ts';

for (const path of [
  '../apps/ios/Perch/Support/starter-packs.json',
  '../apps/android/app/src/main/assets/starter-packs.json',
]) {
  const out = new URL(path, import.meta.url);
  writeFileSync(out, `${JSON.stringify(STARTER_PACKS, null, 2)}\n`);
  console.log(`Wrote ${STARTER_PACKS.length} packs to ${out.pathname}`);
}
