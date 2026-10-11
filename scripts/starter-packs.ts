// Writes the iPhone app's copy of the starter packs from packages/core.
//   npm run starter-packs
import { writeFileSync } from 'node:fs';
import { STARTER_PACKS } from '../packages/core/src/starter-packs.ts';

const out = new URL('../apps/ios/Perch/Support/starter-packs.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(STARTER_PACKS, null, 2)}\n`);
console.log(`Wrote ${STARTER_PACKS.length} packs to ${out.pathname}`);
