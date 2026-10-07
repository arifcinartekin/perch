import { Readability } from '@mozilla/readability';
import { hasHostPermission, requestHostPermission } from '../permissions/host';
import { sanitizeHtml } from '@perch/reader';
import { getFullText, saveFullText } from '../storage/fulltext';
import type { Article, FullText } from '@perch/core/types';

// Full-text extraction. This runs ONLY in the reader page, which has a DOM and
// can request per-origin host permission from a user gesture. The background
// worker never does this.

export type ExtractFailure = 'no-url' | 'permission-denied' | 'fetch-failed' | 'extract-failed';

export type ExtractResult =
  | { ok: true; fullText: FullText; fromCache: boolean }
  | { ok: false; reason: ExtractFailure; detail?: string };

const FETCH_TIMEOUT_MS = 20000;

export async function getCachedFullText(articleId: string): Promise<FullText | undefined> {
  return getFullText(articleId);
}

/**
 * Fetch + extract the readable content for an article.
 *
 * @param options.allowPermissionPrompt when true (call this from a click!), a
 *   missing host permission for the article's origin is requested interactively.
 */
export async function extractFullText(
  article: Article,
  options: { allowPermissionPrompt?: boolean; force?: boolean } = {},
): Promise<ExtractResult> {
  if (!article.url) return { ok: false, reason: 'no-url' };

  // Do the permission check FIRST so a prompt (when allowed) fires before any
  // other await can consume the user-gesture token. request() returns true with
  // no UI when the origin is already granted.
  const granted = options.allowPermissionPrompt
    ? await requestHostPermission(article.url)
    : await hasHostPermission(article.url);
  if (!granted) return { ok: false, reason: 'permission-denied' };

  if (!options.force) {
    const cached = await getFullText(article.id);
    if (cached) return { ok: true, fullText: cached, fromCache: true };
  }

  let html: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(article.url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, reason: 'fetch-failed', detail: `HTTP ${res.status}` };
    html = await res.text();
  } catch (err) {
    return { ok: false, reason: 'fetch-failed', detail: (err as Error).message };
  }

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Readability resolves relative URLs against the document's base URI.
    let baseEl = doc.querySelector('base');
    if (!baseEl) {
      baseEl = doc.createElement('base');
      doc.head.prepend(baseEl);
    }
    baseEl.setAttribute('href', article.url);

    const parsed = new Readability(doc, { charThreshold: 200 }).parse();
    if (!parsed || !parsed.content) {
      return { ok: false, reason: 'extract-failed' };
    }

    const fullText: FullText = {
      articleId: article.id,
      html: sanitizeHtml(parsed.content, { baseUrl: article.url }),
      title: parsed.title ?? undefined,
      byline: parsed.byline ?? undefined,
      excerpt: parsed.excerpt ?? undefined,
      extractedAt: Date.now(),
    };
    await saveFullText(fullText);
    return { ok: true, fullText, fromCache: false };
  } catch (err) {
    return { ok: false, reason: 'extract-failed', detail: (err as Error).message };
  }
}
