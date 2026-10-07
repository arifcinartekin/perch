import { XMLParser } from 'fast-xml-parser';

// A single shared XML parser configuration used for both RSS and Atom.
// - Attributes are kept, prefixed with `@_`.
// - Namespace prefixes are preserved (we read `content:encoded`, `dc:creator`,
//   `media:content`, `atom:link`, …).
// - Repeatable elements are always coerced to arrays so callers don't have to
//   branch on "one vs many".
const ALWAYS_ARRAY = new Set([
  'rss.channel.item',
  'rdf:RDF.item',
  'feed.entry',
  'feed.link',
  'feed.author',
  'feed.category',
  'rss.channel.item.category',
  'rss.channel.item.enclosure',
  'feed.entry.link',
  'feed.entry.author',
  'feed.entry.category',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
  removeNSPrefix: false,
  isArray: (_name, jpath) => {
    // Depending on the `jPath` option, fast-xml-parser passes either a string
    // path or a MatcherView; normalise to a string.
    const path = typeof jpath === 'string' ? jpath : jpath.toString();
    return ALWAYS_ARRAY.has(path);
  },
});

export interface XmlDoc {
  [key: string]: unknown;
}

/** Parse an XML string. Throws if it is not well-formed enough to read. */
export function parseXml(xml: string): XmlDoc {
  // Strip a BOM and leading whitespace/pre-declaration junk some feeds ship with.
  const cleaned = xml.replace(/^﻿/, '').replace(/^\s+/, '');
  return parser.parse(cleaned) as XmlDoc;
}

/** Coerce a fast-xml-parser value to a plain string (handles `{ '#text': ... }`). */
export function text(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const t = (value as Record<string, unknown>)['#text'];
    if (typeof t === 'string') return t.trim() || undefined;
    if (typeof t === 'number') return String(t);
  }
  return undefined;
}

/** Read an attribute (`@_name`) off a node. */
export function attr(node: unknown, name: string): string | undefined {
  if (node && typeof node === 'object') {
    const v = (node as Record<string, unknown>)[`@_${name}`];
    if (typeof v === 'string') return v.trim() || undefined;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/** Always return an array for a value that fast-xml-parser may give as one or many. */
export function asArray<T = unknown>(value: unknown): T[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]) as T[];
}
