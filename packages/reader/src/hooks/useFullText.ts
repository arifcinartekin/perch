import { useCallback, useEffect, useRef, useState } from 'react';
import type { Article, FullText } from '@perch/core/types';
import { useBackend, type FullTextFailure } from '../backend';

type State =
  | { status: 'idle' } // no URL, or the feed already ships the whole article
  | { status: 'loading' }
  | { status: 'ready'; data: FullText }
  | { status: 'blocked' } // needs access we can't ask for without a click
  | { status: 'error'; reason: FullTextFailure; detail?: string };

// If the feed itself carries a substantial article body, don't bother fetching
// and running Readability — the feed content IS the full text.
const FEED_CONTENT_ENOUGH = 2400;

/**
 * Full-text state for the currently open article. It loads automatically:
 * cache hit → shown instantly; access already there → fetched + extracted
 * silently; otherwise `blocked`, and the caller shows a one-tap "load"
 * affordance (in the extension a click is needed for the permission prompt).
 */
export function useFullText(article: Article | null) {
  const backend = useBackend();
  const [state, setState] = useState<State>({ status: 'idle' });
  const runId = useRef(0);
  const articleRef = useRef(article);
  articleRef.current = article;

  const extract = useCallback(
    async (opts: { force?: boolean; prompt?: boolean } = {}) => {
      const current = articleRef.current;
      if (!current?.url) {
        setState({ status: 'idle' });
        return;
      }
      const id = ++runId.current;
      setState({ status: 'loading' });
      const result = await backend.fullText.extract(current, opts);
      if (id !== runId.current) return;
      if (result.ok) setState({ status: 'ready', data: result.fullText });
      else if (result.reason === 'permission-denied') setState({ status: 'blocked' });
      else setState({ status: 'error', reason: result.reason, detail: result.detail });
    },
    [backend],
  );

  useEffect(() => {
    const id = ++runId.current;
    if (!article?.url) {
      setState({ status: 'idle' });
      return;
    }
    let alive = true;
    void (async () => {
      const cached = await backend.fullText.cached(article).catch(() => undefined);
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
      const allowed = await backend.fullText.canExtract(article).catch(() => false);
      if (!alive || id !== runId.current) return;
      if (allowed) void extract();
      else setState({ status: 'blocked' });
    })();
    return () => {
      alive = false;
    };
  }, [backend, article?.id, article?.url, extract]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Called from a click: ask for access, then extract. */
  const grant = useCallback(async () => {
    const current = articleRef.current;
    if (!current?.url) return;
    if (await backend.fullText.requestAccess(current)) void extract();
    else setState({ status: 'blocked' });
  }, [backend, extract]);

  const reload = useCallback(() => extract({ force: true, prompt: true }), [extract]);

  return { state, grant, reload };
}
