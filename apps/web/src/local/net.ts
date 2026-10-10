import { API_PREFIX } from '@perch/core/api';

// The web reader fetches feeds and pages the way the extension does, but a
// page can't read other sites (CORS). Requests to other sites go through the
// hub's anonymous proxy instead, without cookies. Perch's own API, here or on
// another relay, goes straight through.

const original = window.fetch.bind(window);

export function routeFetchThroughProxy(): void {
  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const perchApi = url.pathname.startsWith(`${API_PREFIX}/`);
    if (url.origin === location.origin || perchApi) {
      // Here, the session cookie stands in for a token (the Perch account).
      return original(
        input,
        url.origin === location.origin ? { ...init, credentials: 'same-origin' } : init,
      );
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return original(input, init);
    const headers = new Headers(init.headers);
    const proxied = `${API_PREFIX}/proxy?url=${encodeURIComponent(url.toString())}`;
    return original(proxied, {
      method: 'GET',
      headers,
      signal: init.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  };
}
