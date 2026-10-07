import type { ParsedArticle, ParsedFeed, Enclosure } from '../types';
import { resolveUrl } from '../url';
import { resolvePublishedAt } from './dates';
import { asArray, attr, text, type XmlDoc } from './xml';

// Atom 1.0 (`<feed xmlns="http://www.w3.org/2005/Atom">`).

export function isAtom(doc: XmlDoc): boolean {
  return 'feed' in doc && typeof doc.feed === 'object';
}

export function parseAtom(doc: XmlDoc, feedUrl: string): ParsedFeed {
  const feed = (doc.feed ?? {}) as Record<string, unknown>;

  const siteUrl = pickLink(feed.link, feedUrl, ['alternate', '']) ?? feedUrl;
  const base = siteUrl;

  const iconUrl =
    resolveUrl(text(feed.icon), base) ?? resolveUrl(text(feed.logo), base) ?? undefined;

  const feedAuthor = authorName(feed.author);

  const articles = asArray(feed.entry)
    .map((entry) => parseEntry(entry as Record<string, unknown>, base, feedAuthor))
    .filter((a): a is ParsedArticle => a !== null);

  return {
    format: 'atom',
    title: text(feed.title) ?? siteUrl ?? feedUrl,
    siteUrl,
    iconUrl,
    articles,
  };
}

function parseEntry(
  entry: Record<string, unknown>,
  base: string,
  feedAuthor: string | undefined,
): ParsedArticle | null {
  const url = pickLink(entry.link, base, ['alternate', '']);

  const title = stripToText(text(entry.title)) ?? '(untitled)';

  const contentHtml = richText(entry.content);
  const summaryHtml = richText(entry.summary);

  const publishedAt = resolvePublishedAt([
    text(entry.published),
    text(entry.updated),
    text(entry['dc:date']),
  ]);
  const updated = text(entry.updated);

  return {
    guid: text(entry.id) ?? url ?? undefined,
    url,
    title,
    author: authorName(entry.author) ?? feedAuthor,
    publishedAt,
    updatedAt: updated ? resolvePublishedAt([updated]) : undefined,
    summaryHtml: summaryHtml === contentHtml ? undefined : summaryHtml,
    contentHtml,
    enclosures: collectEnclosures(entry.link, base),
  };
}

function collectEnclosures(link: unknown, base: string): Enclosure[] {
  const out: Enclosure[] = [];
  for (const l of asArray(link)) {
    if (attr(l, 'rel') === 'enclosure') {
      const url = resolveUrl(attr(l, 'href'), base);
      if (url) {
        const length = attr(l, 'length');
        out.push({
          url,
          type: attr(l, 'type'),
          length: length ? Number(length) || undefined : undefined,
        });
      }
    }
  }
  return out;
}

/** Pick the first `<link>` whose rel is in `rels` (""=missing rel counts as alternate). */
function pickLink(link: unknown, base: string, rels: string[]): string | undefined {
  const links = asArray(link);
  for (const wanted of rels) {
    for (const l of links) {
      const rel = attr(l, 'rel') ?? '';
      if (rel === wanted) {
        const href = resolveUrl(attr(l, 'href'), base);
        if (href) return href;
      }
    }
  }
  // Last resort: any link with an href.
  for (const l of links) {
    const href = resolveUrl(attr(l, 'href'), base);
    if (href) return href;
  }
  return undefined;
}

function authorName(author: unknown): string | undefined {
  for (const a of asArray(author)) {
    const name = text((a as Record<string, unknown>)?.name) ?? text(a);
    if (name) return name;
  }
  return undefined;
}

/**
 * Atom text constructs: type="text" | "html" | "xhtml". html/text arrive as a
 * string. xhtml arrives as a nested object; we best-effort flatten it to text.
 */
function richText(node: unknown): string | undefined {
  // Tolerate a malformed feed that repeats <content>/<summary>.
  const one = Array.isArray(node) ? node[0] : node;
  const s = text(one);
  if (s) return s;
  if (one && typeof one === 'object') {
    const div = (one as Record<string, unknown>).div;
    if (div != null) return flatten(div);
  }
  return undefined;
}

function flatten(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(flatten).filter(Boolean).join(' ') || undefined;
  if (typeof node === 'object') {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.startsWith('@_') || k === '#text') {
        if (k === '#text' && typeof v === 'string') parts.push(v);
        continue;
      }
      const f = flatten(v);
      if (f) parts.push(f);
    }
    return parts.join(' ').trim() || undefined;
  }
  return undefined;
}

function stripToText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return (
    html
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim() || undefined
  );
}
