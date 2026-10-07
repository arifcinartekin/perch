import { browser } from 'wxt/browser';
import type { TabDiscovery } from '@perch/core/types';

// A tiny typed wrapper around `browser.runtime.sendMessage`. No dependency — the
// whole protocol is the `MessageMap` below. Each key maps request payload -> response.

export interface MessageMap {
  'discovery:get': {
    request: { tabId?: number };
    response: TabDiscovery | null;
  };
  'discovery:rescan': {
    request: { tabId: number };
    response: TabDiscovery | null;
  };
  'feed:add': {
    request: {
      url: string;
      title?: string;
      siteUrl?: string;
      iconUrl?: string;
      categoryId?: string;
      needsPermission?: boolean;
    };
    response: { feedId: string; created: boolean };
  };
  'feed:remove': {
    request: { feedId: string };
    response: { ok: true };
  };
  'feeds:refresh': {
    request: { feedIds?: string[] };
    response: { refreshed: number; failed: number };
  };
  'reader:open': {
    request: Record<string, never>;
    response: { ok: true };
  };
  'badge:clear': {
    request: { tabId: number };
    response: { ok: true };
  };
  'sync:now': {
    request: Record<string, never>;
    response: { pulled: number; pushed: number };
  };
  'alarms:reschedule': {
    request: Record<string, never>;
    response: { ok: true };
  };
}

export type MessageType = keyof MessageMap;

/** The subset of `runtime.MessageSender` Perch actually reads. */
export interface MessageSender {
  tab?: { id?: number; url?: string };
  url?: string;
  id?: string;
}

interface Envelope<T extends MessageType> {
  __perch: true;
  type: T;
  payload: MessageMap[T]['request'];
}

export async function sendMessage<T extends MessageType>(
  type: T,
  payload: MessageMap[T]['request'] = {} as MessageMap[T]['request'],
): Promise<MessageMap[T]['response']> {
  const envelope: Envelope<T> = { __perch: true, type, payload };
  const response = await browser.runtime.sendMessage(envelope);
  if (response && typeof response === 'object' && '__perchError' in response) {
    throw new Error(String((response as { __perchError: unknown }).__perchError));
  }
  return response as MessageMap[T]['response'];
}

type Handlers = {
  [T in MessageType]?: (
    payload: MessageMap[T]['request'],
    sender: MessageSender,
  ) => Promise<MessageMap[T]['response']> | MessageMap[T]['response'];
};

/**
 * Register handlers in the background worker. Returns a disposer. Only one call
 * site is expected (the background entrypoint).
 */
export function registerMessageHandlers(handlers: Handlers): () => void {
  // Returning a Promise from the listener is the response value. This is
  // supported by both modern Chromium (MV3) and the Firefox WebExtension polyfill,
  // and avoids the `return true` + sendResponse channel-lifetime footgun.
  const listener = (message: unknown, sender: MessageSender): Promise<unknown> | undefined => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as Envelope<MessageType>).__perch !== true
    ) {
      return undefined; // not ours — let other listeners handle it
    }
    const envelope = message as Envelope<MessageType>;
    const handler = handlers[envelope.type];
    if (!handler) return undefined;

    return Promise.resolve(handler(envelope.payload as never, sender)).catch((err) => ({
      __perchError: String(err?.message ?? err),
    }));
  };

  // The polyfilled listener type is broader than what we accept; cast at the boundary.
  const bound = listener as unknown as Parameters<typeof browser.runtime.onMessage.addListener>[0];
  browser.runtime.onMessage.addListener(bound);
  return () => browser.runtime.onMessage.removeListener(bound);
}
