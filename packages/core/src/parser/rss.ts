import type { ParsedArticle, ParsedFeed, Enclosure } from '../types';
import { htmlToText } from './text';
import { resolveUrl } from '../url';
import { resolvePublishedAt } from './dates';
import { asArray, attr, text, type XmlDoc } from './xml';

// Handles RSS 2.0 (`<rss><channel>`) and RSS 1.0 / RDF (`<rdf:RDF>`).

export function isRss(doc: XmlDoc): boolean {
  return 'rss' in doc || 'rdf:RDF' in doc || 'RDF' in doc;
}

export function parseRss(doc: XmlDoc, feedUrl: string): ParsedFeed {
  const rss = (doc.rss ?? {}) as Record<string, unknown>;
  const rdf = (doc['rdf:RDF'] ?? doc.RDF ?? {}) as Record<string, unknown>;
  const isRdf = !doc.rss;

  const channel = ((isRdf ? rdf.channel : rss.channel) ?? {}) as Record<string, unknown>;

  const siteUrl =
    resolveUrl(pickLink(channel.link), feedUrl) ?? resolveUrl(text(channel.link), feedUrl);
  const base = siteUrl ?? feedUrl;

  const image = (channel.image ?? {}) as Record<string, unknown>;
  const iconUrl = resolveUrl(text(image.url) ?? attr(channel['itunes:image'], 'href'), base);

  // In RDF, <item> elements are siblings of <channel>; in RSS 2.0 they are inside it.
  const rawItems = isRdf ? asArray(rdf.item) : asArray(channel.item);

  const articles = rawItems
    .map((item) => parseItem(item as Record<string, unknown>, base))
    .filter((a): a is ParsedArticle => a !== null);

  return {
    format: 'rss',
    title: text(channel.title) ?? siteUrl ?? feedUrl,
    siteUrl,
    iconUrl,
    articles,
  };
}

function parseItem(item: Record<string, unknown>, base: string): ParsedArticle | null {
  const url =
    resolveUrl(pickLink(item.link), base) ??
    resolveUrl(text(item.link), base) ??
    resolveUrl(guidIfLink(item.guid), base);

  const title = htmlToText(text(item.title)) ?? '(untitled)';

  const contentHtml = text(item['content:encoded']) ?? undefined;
  const summaryHtml = text(item.description) ?? text(item['dc:description']) ?? undefined;

  const author =
    text(item['dc:creator']) ??
    text(item.author) ??
    text((item['itunes:author'] as unknown) ?? undefined) ??
    undefined;

  const publishedAt = resolvePublishedAt([
    text(item.pubDate),
    text(item['dc:date']),
    text(item.published),
    text(item.date),
  ]);

  const guid = text(item.guid) ?? url ?? undefined;

  return {
    guid,
    url,
    title,
    author,
    publishedAt,
    // If description and content:encoded are identical, keep only the full one.
    summaryHtml: summaryHtml === contentHtml ? undefined : summaryHtml,
    contentHtml,
    enclosures: collectEnclosures(item, base),
  };
}

function collectEnclosures(item: Record<string, unknown>, base: string): Enclosure[] {
  const out: Enclosure[] = [];
  for (const enc of asArray(item.enclosure)) {
    const url = resolveUrl(attr(enc, 'url'), base);
    if (url) {
      const length = attr(enc, 'length');
      out.push({
        url,
        type: attr(enc, 'type'),
        length: length ? Number(length) || undefined : undefined,
      });
    }
  }
  for (const media of asArray(item['media:content'])) {
    const url = resolveUrl(attr(media, 'url'), base);
    if (url && !out.some((e) => e.url === url)) {
      out.push({ url, type: attr(media, 'type') });
    }
  }
  return out;
}

/** RSS 2.0 `<link>` is text; some feeds emit an Atom-style `<link href>` too. */
function pickLink(link: unknown): string | undefined {
  for (const l of asArray(link)) {
    const href = attr(l, 'href');
    const rel = attr(l, 'rel');
    if (href && (!rel || rel === 'alternate')) return href;
  }
  return undefined;
}

function guidIfLink(guid: unknown): string | undefined {
  const isPermalink = attr(guid, 'isPermaLink');
  const value = text(guid);
  if (value && isPermalink !== 'false' && /^https?:\/\//i.test(value)) return value;
  return undefined;
}
