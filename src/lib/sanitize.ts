import DOMPurify from 'dompurify';

// HTML sanitisation for feed content. This runs at *render* time, in a DOM
// context (popup / reader page) — never in the background worker. Feed content
// is always treated as untrusted.

const ALLOWED_IFRAME_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
];

let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;

  // Open links in a new tab and strip referrer/opener.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    if (node.tagName === 'IMG') {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('referrerpolicy', 'no-referrer');
      // Some feeds use data-src for lazy loading; promote it.
      const dataSrc = node.getAttribute('data-src');
      if (!node.getAttribute('src') && dataSrc) node.setAttribute('src', dataSrc);
    }
    if (node.tagName === 'IFRAME') {
      const src = node.getAttribute('src') || '';
      let host = '';
      try {
        host = new URL(src, 'https://x.invalid').hostname;
      } catch {
        /* leave host empty -> removed below */
      }
      if (!ALLOWED_IFRAME_HOSTS.includes(host)) {
        node.remove();
      } else {
        node.setAttribute('loading', 'lazy');
        node.setAttribute('referrerpolicy', 'no-referrer');
      }
    }
  });
}

export interface SanitizeOptions {
  /** Base URL to resolve relative `href`/`src` against (the article or feed URL). */
  baseUrl?: string;
  /** Allow video embeds from a small allow-list of hosts. Default true. */
  allowEmbeds?: boolean;
}

export function sanitizeHtml(
  html: string | undefined | null,
  options: SanitizeOptions = {},
): string {
  if (!html) return '';
  installHooks();

  let input = html;
  if (options.baseUrl) {
    input = resolveRelativeUrls(input, options.baseUrl);
  }

  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [
      'a',
      'abbr',
      'b',
      'blockquote',
      'br',
      'caption',
      'cite',
      'code',
      'col',
      'colgroup',
      'dd',
      'del',
      'details',
      'div',
      'dl',
      'dt',
      'em',
      'figcaption',
      'figure',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'i',
      'img',
      'ins',
      'kbd',
      'li',
      'mark',
      'ol',
      'p',
      'pre',
      'q',
      's',
      'samp',
      'section',
      'small',
      'span',
      'strong',
      'sub',
      'summary',
      'sup',
      'table',
      'tbody',
      'td',
      'tfoot',
      'th',
      'thead',
      'time',
      'tr',
      'u',
      'ul',
      'video',
      'audio',
      'source',
      'picture',
      ...(options.allowEmbeds === false ? [] : ['iframe']),
    ],
    ALLOWED_ATTR: [
      'href',
      'src',
      'srcset',
      'alt',
      'title',
      'width',
      'height',
      'colspan',
      'rowspan',
      'datetime',
      'cite',
      'controls',
      'poster',
      'type',
      'media',
      'lang',
      'dir',
      'data-src',
      'allow',
      'allowfullscreen',
      'frameborder',
    ],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'script', 'form', 'input', 'button', 'link', 'meta'],
    FORBID_ATTR: ['style', 'srcdoc', 'on*'],
  });
}

/** Resolve relative URLs in href/src/srcset/poster against a base. */
function resolveRelativeUrls(html: string, baseUrl: string): string {
  return html.replace(
    /\b(href|src|poster)=(["'])(.*?)\2/gi,
    (match, attr: string, quote: string, value: string) => {
      if (!value || /^(https?:|data:|mailto:|#|\/\/)/i.test(value)) return match;
      try {
        return `${attr}=${quote}${new URL(value, baseUrl).toString()}${quote}`;
      } catch {
        return match;
      }
    },
  );
}
