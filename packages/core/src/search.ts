import type { Article } from './types';

// Free-text article search, shared by the extension's IndexedDB scan and the
// server's reader API so both match the same way.

/**
 * Case- and accent-insensitive folding so "istanbul" finds "İstanbul" and
 * "cafe" finds "Café". Also folds the Turkish dotless ı.
 */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/ı/g, 'i');
}

export function searchTerms(text: string | undefined): string[] {
  return text ? foldText(text).split(/\s+/).filter(Boolean) : [];
}

const stripHtml = (html: string | undefined) =>
  html ? html.replace(/<[^>]*>/g, ' ').replace(/&[a-z0-9#]+;/gi, ' ') : '';

/** Folded title, author and body text — what search terms are matched against. */
export function searchableText(
  a: Pick<Article, 'title' | 'author' | 'summaryHtml' | 'contentHtml'>,
): string {
  return foldText(
    `${a.title}\n${a.author ?? ''}\n${stripHtml(a.summaryHtml)}\n${stripHtml(a.contentHtml)}`,
  );
}

/** True when every term occurs somewhere in the article's searchable text. */
export function matchesTerms(a: Article, terms: string[]): boolean {
  const haystack = searchableText(a);
  return terms.every((t) => haystack.includes(t));
}
