import type { ParsedFeed } from '../types';
import { parseAtom, isAtom } from './atom';
import { parseJsonFeed, isJsonFeed } from './jsonfeed';
import { parseRss, isRss } from './rss';
import { parseXml } from './xml';

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedParseError';
  }
}

/**
 * Parse a feed document of unknown type. `contentType` is only a hint; detection
 * falls back to sniffing the body so a mislabelled feed still parses.
 */
export function parseFeed(
  body: string,
  contentType: string | undefined,
  feedUrl: string,
): ParsedFeed {
  const trimmed = body.replace(/^﻿/, '').trimStart();
  if (!trimmed) throw new FeedParseError('Empty response body');

  const looksJson =
    (contentType?.includes('json') ?? false) || trimmed.startsWith('{') || trimmed.startsWith('[');

  if (looksJson) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch (err) {
      if (!trimmed.startsWith('<')) {
        throw new FeedParseError(`Not valid JSON: ${(err as Error).message}`);
      }
      json = undefined;
    }
    if (json !== undefined) {
      if (isJsonFeed(json)) return parseJsonFeed(json, feedUrl);
      throw new FeedParseError('JSON document is not a JSON Feed');
    }
  }

  let doc;
  try {
    doc = parseXml(trimmed);
  } catch (err) {
    throw new FeedParseError(`Malformed XML: ${(err as Error).message}`);
  }

  if (isRss(doc)) return parseRss(doc, feedUrl);
  if (isAtom(doc)) return parseAtom(doc, feedUrl);

  throw new FeedParseError('Unrecognised feed format (not RSS, Atom, or JSON Feed)');
}

/**
 * Cheap check on the first bytes of a response: does this look like a feed at
 * all? Used by feed discovery to reject 404 HTML pages without a full parse.
 */
export function sniffIsFeed(snippet: string, contentType?: string): boolean {
  const ct = contentType?.toLowerCase() ?? '';
  if (ct.includes('rss') || ct.includes('atom') || ct.includes('xml')) return true;
  const head = snippet.replace(/^﻿/, '').trimStart().slice(0, 1000).toLowerCase();
  if (
    head.startsWith('<?xml') ||
    head.includes('<rss') ||
    head.includes('<feed') ||
    head.includes('<rdf:rdf')
  ) {
    return true;
  }
  if ((ct.includes('json') || head.startsWith('{')) && head.includes('jsonfeed.org')) return true;
  return false;
}

export { parseXml } from './xml';
export { FeedParseError as ParseError };
