// URL helpers shared by the parser, discovery, and permission code.

/** Resolve a possibly-relative URL against a base. Returns undefined on failure. */
export function resolveUrl(
  href: string | undefined | null,
  base: string | undefined,
): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed, base || undefined).toString();
  } catch {
    return undefined;
  }
}

/** Normalise a feed URL for identity/dedupe: lowercase host, strip hash, strip trailing slash. */
export function normalizeFeedUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    // Drop the default port.
    if (
      (u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')
    ) {
      u.port = '';
    }
    return u.toString();
  } catch {
    return raw.trim();
  }
}

/** "https://example.com" for a URL, or undefined if it can't be parsed. */
export function originOf(raw: string): string | undefined {
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

/** Registrable-ish hostname without the leading "www.". */
export function bareHost(raw: string): string | undefined {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** "https://example.com/*" match pattern for a URL, or null if it has no origin. */
export function originPattern(url: string): string | null {
  const origin = originOf(url);
  return origin ? `${origin}/*` : null;
}

/** True for http(s) URLs only — everything Perch fetches must be one of these. */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
