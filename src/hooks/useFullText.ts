import { useCallback, useEffect, useRef, useState } from 'react';
import type { Article, FullText } from '@/lib/types';
import { extractFullText, getCachedFullText, type ExtractFailure } from '@/lib/readability/extract';
import { hasHostPermission, requestHostPermission } from '@/lib/permissions/host';

type State =
  | { status: 'idle' } // no URL, or the feed already ships the whole article
  | { status: 'loading' }
  | { status: 'ready'; data: FullText }
  | { status: 'blocked' } // needs a per-site permission we can't ask for without a click
  | { status: 'error'; reason: ExtractFailure; detail?: string };

// If the feed itself carries a substantial article body, don't bother fetching
// and running Readability — the feed content IS the full text.
const FEED_CONTENT_ENOUGH = 2400;

/**
 * Full-text state for the currently open article. It loads automatically:
 * cache hit → shown instantly; permission already granted → fetched + extracted
 * silently; otherwise `blocked`, and the caller shows a one-tap "load" affordance
 * (a click is required so the browser will show the permission prompt).
 */
export function useFullText(article: Article | null) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const runId = useRef(0);
  const articleRef = useRef(article);
  articleRef.current = article;

  const extract = useCallback(async (opts: { force?: boolean; prompt?: boolean } = {}) => {
    const current = articleRef.current;
    if (!current?.url) {
      setState({ status: 'idle' });
      return;
    }
    const id = ++runId.current;
    setState({ status: 'loading' });
    const result = await extractFullText(current, {
      allowPermissionPrompt: opts.prompt ?? false,
      force: opts.force,
    });
    if (id !== runId.current) return;
    if (result.ok) setState({ status: 'ready', data: result.fullText });
    else if (result.reason === 'permission-denied') setState({ status: 'blocked' });
    else setState({ status: 'error', reason: result.reason, detail: result.detail });
  }, []);

  useEffect(() => {
    const id = ++runId.current;
    if (!article?.url) {
      setState({ status: 'idle' });
      return;
    }
    let alive = true;
    void (async () => {
      const cached = await getCachedFullText(article.id);
      if (!alive || id !== runId.current) return;
      if (cached) {
        setState({ status: 'ready', data: cached });
        return;
      }
      // Feed already has the whole thing — show it, don't fetch.
      if ((article.contentHtml?.length ?? 0) >= FEED_CONTENT_ENOUGH) {
        setState({ status: 'idle' });
        return;
      }
      const granted = await hasHostPermission(article.url!).catch(() => false);
      if (!alive || id !== runId.current) return;
      if (granted) void extract();
      else setState({ status: 'blocked' });
    })();
    return () => {
      alive = false;
    };
  }, [article?.id, article?.url, extract]);

  /** Called from a click: request the per-site permission, then extract. */
  const grant = useCallback(async () => {
    const current = articleRef.current;
    if (!current?.url) return;
    const granted = await requestHostPermission(current.url);
    if (granted) void extract();
    else setState({ status: 'blocked' });
  }, [extract]);

  const reload = useCallback(() => extract({ force: true, prompt: true }), [extract]);

  return { state, grant, reload };
}
