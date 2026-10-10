import MarkdownIt from 'markdown-it';

// Notes: a reader's own markdown, one per article. A note is private and syncs
// like the rest of the library (encrypted on a sync chain). Sharing publishes a
// copy, as rendered here, on the reader's Perch Server.

/** Longest note body, in characters. */
export const NOTE_MAX = 10_000;

/** The note as it syncs. id = stateRecordId(feedId, articleId). */
export interface NoteRecordData {
  feedId: string;
  articleId: string;
  /** The article, so the note keeps its context after the article ages out. */
  title: string;
  url?: string;
  feedTitle?: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  /** The public page, while the note is shared. */
  sharedUrl?: string;
}

export interface Note extends NoteRecordData {
  id: string;
}

/** Why a note can't be saved as is, or null. */
export function noteProblem(d: Partial<NoteRecordData> | undefined): string | null {
  if (!d || typeof d !== 'object') return 'missing';
  if (typeof d.feedId !== 'string' || !d.feedId) return 'feedId';
  if (typeof d.articleId !== 'string' || !d.articleId) return 'articleId';
  if (typeof d.title !== 'string' || d.title.length > 1000) return 'title';
  if (typeof d.body !== 'string' || d.body.length > NOTE_MAX) return 'body';
  if (d.url != null && (typeof d.url !== 'string' || d.url.length > 4096)) return 'url';
  if (d.feedTitle != null && (typeof d.feedTitle !== 'string' || d.feedTitle.length > 1000)) {
    return 'feedTitle';
  }
  if (d.sharedUrl != null && (typeof d.sharedUrl !== 'string' || d.sharedUrl.length > 4096)) {
    return 'sharedUrl';
  }
  if (!Number.isFinite(d.createdAt) || !Number.isFinite(d.updatedAt)) return 'time';
  return null;
}

// Raw HTML is escaped, links are limited to safe schemes (markdown-it refuses
// javascript:, vbscript:, file: and data:), and images are left out so a
// shared page never loads anything from elsewhere.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true }).disable(['image']);

const defaultLink =
  md.renderer.rules.link_open ??
  ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  tokens[idx]!.attrSet('rel', 'noopener noreferrer nofollow ugc');
  tokens[idx]!.attrSet('target', '_blank');
  return defaultLink(tokens, idx, opts, env, self);
};

/** A note's markdown as HTML that is safe to put in a page as is. */
export function renderNote(markdown: string): string {
  return md.render(markdown.slice(0, NOTE_MAX));
}

/** The note as plain text, for previews and page descriptions. */
export function notePlainText(markdown: string, max = 200): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
