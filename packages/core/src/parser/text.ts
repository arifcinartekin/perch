// Plain text from feed HTML: titles marked type="html" (Atom) and RSS titles,
// which in practice often carry escaped markup and entities ("Android&#8217;s").

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED[body.toLowerCase()] ?? match;
  });
}

/** Strip tags, decode entities, collapse whitespace. */
export function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return (
    decodeEntities(html.replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim() || undefined
  );
}
