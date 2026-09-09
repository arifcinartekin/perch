import { browser } from 'wxt/browser';
import { getSettings } from '../storage/settings';

const READER_PATH = '/reader.html';

/** Open (or focus) the full-screen reader according to the user's setting. */
export async function openReader(): Promise<void> {
  const settings = await getSettings();
  const url = browser.runtime.getURL(READER_PATH);

  if (settings.openMode === 'window') {
    // Re-use an existing detached reader window if one is open.
    const wins = await browser.windows.getAll({ populate: true });
    for (const win of wins) {
      if (win.tabs?.some((t) => t.url?.startsWith(url)) && win.id != null) {
        await browser.windows.update(win.id, { focused: true });
        return;
      }
    }
    const { width, height, left, top } = await preferredWindowBounds();
    await browser.windows.create({ url, type: 'popup', width, height, left, top });
    return;
  }

  // Tab mode: focus an existing reader tab if present, else open one.
  const existing = await browser.tabs.query({ url: `${url}*` });
  const tab = existing[0];
  if (tab?.id != null) {
    await browser.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await browser.windows.update(tab.windowId, { focused: true });
    return;
  }
  await browser.tabs.create({ url });
}

async function preferredWindowBounds() {
  try {
    const current = await browser.windows.getCurrent();
    const sw = current.width ?? 1440;
    const sh = current.height ?? 900;
    const width = Math.round(sw * 0.9);
    const height = Math.round(sh * 0.9);
    return {
      width,
      height,
      left: (current.left ?? 0) + Math.round((sw - width) / 2),
      top: (current.top ?? 0) + Math.round((sh - height) / 2),
    };
  } catch {
    return { width: 1280, height: 800, left: 80, top: 60 };
  }
}
