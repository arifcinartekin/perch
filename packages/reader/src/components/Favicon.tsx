import type { Feed } from '@perch/core/types';
import { letterTile } from '@perch/core/favicon';

// A feed's initial on a coloured tile. No favicons: loading them would tell
// each site, from your own address, that you follow it — the web reader
// otherwise never talks to those sites at all. The iPhone app does the same.
export function Favicon({ feed, size = 16 }: { feed: Feed; size?: number }) {
  const { letter, bg } = letterTile(feed);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[5px] font-semibold text-white"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.6 }}
    >
      {letter}
    </span>
  );
}
