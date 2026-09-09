import { useCallback, useEffect, useState } from 'react';
import type { Article, FullText } from '@/lib/types';
import { extractFullText, getCachedFullText, type ExtractFailure } from '@/lib/readability/extract';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: FullText }
  | { status: 'error'; reason: ExtractFailure; detail?: string };

/**
 * Full-text extraction state for one article. Loads from cache immediately;
 * `run()` performs the fetch+extract (call it from a click so a permission
 * prompt is allowed).
 */
export function useFullText(article: Article | null, active: boolean) {
  const [state, setState] = useState<State>({ status: 'idle' });

  useEffect(() => {
    setState({ status: 'idle' });
    if (!article || !active) return;
    let alive = true;
    void getCachedFullText(article.id).then((cached) => {
      if (alive && cached) setState({ status: 'ready', data: cached });
    });
    return () => {
      alive = false;
    };
  }, [article?.id, active]);

  const run = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!article) return;
      setState({ status: 'loading' });
      const result = await extractFullText(article, {
        allowPermissionPrompt: true,
        force: opts.force,
      });
      if (result.ok) setState({ status: 'ready', data: result.fullText });
      else setState({ status: 'error', reason: result.reason, detail: result.detail });
    },
    [article?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return { state, run };
}
