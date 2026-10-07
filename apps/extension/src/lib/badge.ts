import { browser } from 'wxt/browser';

// The toolbar badge is a single orange dot that means "this page has feeds you
// haven't added yet". It is per-tab so it clears as you navigate.

const DOT = '●';
const DOT_COLOR = '#ff7a1a'; // brand ember

function action() {
  // MV3 Chrome: browser.action. Firefox MV3 also exposes browser.action.
  return browser.action ?? browser.browserAction;
}

export async function showDiscoveryDot(tabId: number): Promise<void> {
  const a = action();
  if (!a) return;
  try {
    await a.setBadgeBackgroundColor({ tabId, color: DOT_COLOR });
    await a.setBadgeText({ tabId, text: DOT });
    if (a.setBadgeTextColor) await a.setBadgeTextColor({ tabId, color: DOT_COLOR });
  } catch {
    /* tab may have closed */
  }
}

export async function clearDiscoveryDot(tabId: number): Promise<void> {
  const a = action();
  if (!a) return;
  try {
    await a.setBadgeText({ tabId, text: '' });
  } catch {
    /* tab may have closed */
  }
}
