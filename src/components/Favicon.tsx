import { useState } from 'react';
import type { Feed } from '@/lib/types';
import { faviconUrl, letterTile } from '@/lib/feeds/favicon';

export function Favicon({ feed, size = 16 }: { feed: Feed; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : faviconUrl(feed);

  if (!src) {
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

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="shrink-0 rounded-[5px] object-cover"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
