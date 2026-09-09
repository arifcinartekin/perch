import type { ParsedArticle, ParsedFeed, Enclosure } from '../types';
import { resolveUrl } from '../util/url';
import { resolvePublishedAt } from './dates';

// JSON Feed 1.0 / 1.1 — https://www.jsonfeed.org/version/1.1/

interface JsonFeedAuthor {
  name?: string;
}
interface JsonFeedAttachment {
  url?: string;
  mime_type?: string;
  size_in_bytes?: number;
}
interface JsonFeedItem {
  id?: string | number;
  url?: string;
  external_url?: string;
  title?: string;
  content_html?: string;
  content_text?: string;
  summary?: string;
  image?: string;
  date_published?: string;
  date_modified?: string;
  author?: JsonFeedAuthor;
  authors?: JsonFeedAuthor[];
  attachments?: JsonFeedAttachment[];
}
interface JsonFeedDoc {
  version?: string;
  title?: string;
  home_page_url?: string;
  feed_url?: string;
  icon?: string;
  favicon?: string;
  author?: JsonFeedAuthor;
  authors?: JsonFeedAuthor[];
  items?: JsonFeedItem[];
}

export function isJsonFeed(value: unknown): value is JsonFeedDoc {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as JsonFeedDoc).version === 'string' &&
    (value as JsonFeedDoc).version!.includes('jsonfeed.org') &&
    Array.isArray((value as JsonFeedDoc).items ?? [])
  );
}

export function parseJsonFeed(doc: JsonFeedDoc, feedUrl: string): ParsedFeed {
  const siteUrl = resolveUrl(doc.home_page_url, feedUrl);
  const base = siteUrl ?? feedUrl;
  const feedAuthor = pickAuthor(doc.authors, doc.author);

  const articles = (doc.items ?? [])
    .map((item) => parseItem(item, base, feedAuthor))
    .filter((a): a is ParsedArticle => a !== null);

  return {
    format: 'json',
    title: doc.title ?? siteUrl ?? feedUrl,
    siteUrl,
    iconUrl: resolveUrl(doc.icon ?? doc.favicon, base),
    articles,
  };
}

function parseItem(
  item: JsonFeedItem,
  base: string,
  feedAuthor: string | undefined,
): ParsedArticle | null {
  const url = resolveUrl(item.url ?? item.external_url, base);
  const contentHtml = item.content_html ?? undefined;
  const contentText = item.content_text?.trim() || undefined;
  const summaryHtml = item.summary?.trim() || undefined;

  const enclosures: Enclosure[] = (item.attachments ?? [])
    .map((a): Enclosure | null => {
      const u = resolveUrl(a.url, base);
      return u ? { url: u, type: a.mime_type, length: a.size_in_bytes } : null;
    })
    .filter((e): e is Enclosure => e !== null);

  return {
    guid: item.id != null ? String(item.id) : (url ?? undefined),
    url,
    title: item.title?.trim() || '(untitled)',
    author: pickAuthor(item.authors, item.author) ?? feedAuthor,
    publishedAt: resolvePublishedAt([item.date_published, item.date_modified]),
    updatedAt: item.date_modified ? resolvePublishedAt([item.date_modified]) : undefined,
    summaryHtml,
    // content_text is plain text; wrap it so the renderer treats it as a block.
    contentHtml: contentHtml ?? (contentText ? `<p>${escapeHtml(contentText)}</p>` : undefined),
    enclosures,
  };
}

function pickAuthor(
  authors: JsonFeedAuthor[] | undefined,
  author: JsonFeedAuthor | undefined,
): string | undefined {
  return authors?.find((a) => a.name)?.name ?? author?.name ?? undefined;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}
