import { notePlainText, renderNote } from '@perch/core/notes';

// The public page of a shared note, rendered here with no scripts at all. The
// note is markdown rendered without raw HTML or images, so the page loads
// nothing from anywhere else.

export const PAGE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

const safeHref = (url: string | null | undefined) =>
  url && /^https?:\/\//i.test(url) ? esc(url) : null;

export interface SharedNote {
  slug: string;
  title: string;
  url: string | null;
  feedTitle: string | null;
  body: string;
  author: string;
  updatedAt: number;
}

const MARK = `<svg class="mark" viewBox="39 53 440 440" aria-hidden="true">
  <polygon class="accent" points="362,132 462,168 372,192" />
  <path class="ink" d="M 392 176 C 392 120 352 84 304 84 C 252 84 214 118 208 164 C 150 188 96 250 56 330 L 172 336 C 188 388 232 416 284 416 C 350 416 400 366 404 296 C 406 262 394 236 380 222 C 388 210 392 194 392 176 Z" />
  <g class="waves" fill="none" stroke-width="15" stroke-linecap="round">
    <path d="M 214 266 A 64 64 0 0 1 278 330" /><path d="M 214 216 A 114 114 0 0 1 328 330" />
  </g>
  <circle class="accent" cx="214" cy="330" r="14" />
  <circle class="eye" cx="338" cy="150" r="10" />
  <g class="legs" stroke-width="10" stroke-linecap="round">
    <line x1="262" y1="410" x2="262" y2="440" /><line x1="312" y1="410" x2="312" y2="440" />
  </g>
  <rect class="perch" x="96" y="436" width="340" height="26" rx="13" />
</svg>`;

const STYLE = `
:root{--bg:#f7f5f0;--text:#12151c;--muted:#5b6070;--accent:#ff7a1a;--accent-text:#b35512;--glass:rgba(255,255,255,.6);--border:rgba(18,21,28,.08);--shadow:0 1px 0 rgba(255,255,255,.7) inset,0 20px 50px -24px rgba(18,21,28,.28);--glow-1:rgba(255,122,26,.28);--glow-2:rgba(120,140,220,.16);--eye:#f4f1ea;--perch:var(--text);--code:rgba(18,21,28,.06);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0e1118;--text:#f4f1ea;--muted:#a7abb6;--accent-text:#ff8c3a;--glass:rgba(24,28,39,.6);--border:rgba(255,255,255,.07);--shadow:0 1px 0 rgba(255,255,255,.06) inset,0 24px 60px -24px rgba(0,0,0,.7);--glow-1:rgba(255,122,26,.22);--glow-2:rgba(70,90,180,.2);--eye:#12151c;--perch:var(--accent);--code:rgba(255,255,255,.07);color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;padding:40px 16px;background:radial-gradient(40rem 30rem at 15% 0%,var(--glow-1),transparent 70%),radial-gradient(36rem 28rem at 90% 100%,var(--glow-2),transparent 70%),var(--bg);color:var(--text);font:17px/1.65 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}
.wrap{max-width:680px;margin:0 auto}
header{display:flex;align-items:center;gap:10px;margin-bottom:20px;color:var(--muted);font-size:14px}
header a{color:inherit;text-decoration:none;font-weight:600}
.mark{width:28px;height:28px;display:block}
.accent{fill:var(--accent)}.ink{fill:var(--text)}.waves{stroke:var(--accent)}.eye{fill:var(--eye)}.legs{stroke:var(--text)}.perch{fill:var(--perch)}
main{padding:32px;border-radius:22px;background:var(--glass);border:1px solid var(--border);box-shadow:var(--shadow);-webkit-backdrop-filter:blur(22px) saturate(160%);backdrop-filter:blur(22px) saturate(160%)}
.source{margin:0 0 4px;color:var(--muted);font-size:14px}
h1{margin:0 0 6px;font-size:1.5rem;line-height:1.3;letter-spacing:-.01em}
h1 a{color:inherit;text-decoration:none}h1 a:hover{text-decoration:underline}
.by{margin:0 0 24px;color:var(--muted);font-size:14px}
.note{border-top:1px solid var(--border);padding-top:20px;overflow-wrap:anywhere}
.note a{color:var(--accent-text)}
.note blockquote{margin:1em 0;padding:.1em 1em;border-left:3px solid var(--accent);color:var(--muted)}
.note code{background:var(--code);padding:.1em .35em;border-radius:6px;font-size:.9em}
.note pre{background:var(--code);padding:12px 14px;border-radius:10px;overflow:auto}.note pre code{background:none;padding:0}
.note h1,.note h2,.note h3{font-size:1.15rem;line-height:1.35;margin:1.4em 0 .5em}
.note hr{border:0;border-top:1px solid var(--border);margin:1.5em 0}
footer{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 20px;margin-top:18px;color:var(--muted);font-size:13px}
footer a{color:inherit}
details{margin-top:28px;font-size:14px;color:var(--muted)}
summary{cursor:pointer}
form{display:grid;gap:10px;margin-top:12px}
select,textarea,input{font:inherit;font-size:14px;padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text)}
textarea{min-height:80px;resize:vertical}
button{justify-self:start;font:inherit;font-size:14px;font-weight:600;padding:8px 16px;border-radius:999px;border:0;background:var(--accent);color:#12151c;cursor:pointer}
@media (max-width:480px){main{padding:24px 18px}body{padding:24px 16px}}
`;

function layout(opts: { title: string; description?: string; url?: string; body: string }): string {
  const meta = [
    `<meta property="og:title" content="${esc(opts.title)}" />`,
    opts.description &&
      `<meta name="description" content="${esc(opts.description)}" /><meta property="og:description" content="${esc(opts.description)}" />`,
    opts.url && `<meta property="og:url" content="${esc(opts.url)}" />`,
    '<meta property="og:type" content="article" /><meta property="og:site_name" content="Perch" />',
    '<meta name="twitter:card" content="summary" />',
  ]
    .filter(Boolean)
    .join('\n    ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(opts.title)}</title>
    <meta name="robots" content="noindex, nofollow" />
    <meta name="referrer" content="no-referrer" />
    <meta name="color-scheme" content="light dark" />
    ${meta}
    <style>${STYLE}</style>
  </head>
  <body>
    <div class="wrap">
      <header>${MARK}<a href="https://perch.ws">Perch</a><span>· a note shared from the reader</span></header>
      ${opts.body}
    </div>
  </body>
</html>`;
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' });

/** The operator's policy pages, for the footer. */
export interface LegalLinks {
  privacyUrl?: string;
  termsUrl?: string;
}

const legalLinks = (legal: LegalLinks = {}) =>
  [
    legal.termsUrl && `<a href="${esc(legal.termsUrl)}">Terms</a>`,
    legal.privacyUrl && `<a href="${esc(legal.privacyUrl)}">Privacy</a>`,
  ]
    .filter(Boolean)
    .join(' · ');

export function sharedPage(note: SharedNote, pageUrl: string, legal?: LegalLinks): string {
  const href = safeHref(note.url);
  const title = esc(note.title || 'Untitled');
  return layout({
    title: `${note.title || 'Untitled'} · a note on Perch`,
    description: notePlainText(note.body, 200),
    url: pageUrl,
    body: `<main>
        ${note.feedTitle ? `<p class="source">${esc(note.feedTitle)}</p>` : ''}
        <h1>${href ? `<a href="${href}" rel="noopener noreferrer nofollow ugc" target="_blank">${title}</a>` : title}</h1>
        <p class="by">Note by @${esc(note.author)} · ${formatDate(note.updatedAt)}${href ? ` · <a href="${href}" rel="noopener noreferrer nofollow ugc" target="_blank" style="color:inherit">Read the article</a>` : ''}</p>
        <div class="note">${renderNote(note.body)}</div>
      </main>
      <details>
        <summary>Report this note</summary>
        <form method="post" action="/shared/${esc(note.slug)}/report">
          <select name="reason" required>
            <option value="illegal">It’s illegal</option>
            <option value="harassment">Harassment or hate</option>
            <option value="spam">Spam</option>
            <option value="other">Something else</option>
          </select>
          <textarea name="details" maxlength="2000" placeholder="What’s wrong? (optional)"></textarea>
          <input name="contact" type="email" maxlength="320" placeholder="Your email, if you’d like to hear back (optional)" />
          <button type="submit">Send report</button>
        </form>
      </details>
      <footer>
        <span>Notes are written by Perch readers, not by Perch or the article’s publisher.</span>
        <span>${legalLinks(legal)}${legal?.termsUrl || legal?.privacyUrl ? ' · ' : ''}<a href="https://perch.ws">Get Perch</a></span>
      </footer>`,
  });
}

/** A short page for removed, missing or reported notes. */
export function messagePage(title: string, text: string): string {
  return layout({
    title: `${title} · Perch`,
    body: `<main><h1>${esc(title)}</h1><p class="by" style="margin:0">${esc(text)}</p></main>
      <footer><span></span><a href="https://perch.ws">perch.ws</a></footer>`,
  });
}
