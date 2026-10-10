// The slice of the WebExtension `browser` API that the extension's library
// code uses, for a web page. The web reader on a hub runs that code as is:
// storage lives in IndexedDB, "messages to the background" are handled in
// the page, alarms are timers, and site access is always granted (feeds come
// through the hub's proxy). Aliased to `wxt/browser` in vite.config.ts.

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type ChangeListener = (changes: Changes, area: string) => void;
type MessageListener = (message: unknown, sender: object) => Promise<unknown> | undefined;
type AlarmListener = (alarm: { name: string }) => void;

// --- storage.local, in IndexedDB --------------------------------------------

const DB = 'perch-web-local';
let db: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
) {
  const store = (await open()).transaction('kv', mode).objectStore('kv');
  return new Promise<T | undefined>((resolve, reject) => {
    const req = run(store);
    store.transaction.oncomplete = () => resolve(req ? (req.result as T) : undefined);
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

const changeListeners = new Set<ChangeListener>();
// Other tabs of the reader hear about changes too.
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(DB);
channel?.addEventListener('message', (e) => {
  for (const l of changeListeners) l(e.data as Changes, 'local');
});

const emit = (changes: Changes) => {
  for (const l of changeListeners) l(changes, 'local');
  channel?.postMessage(changes);
};

// Values cross into IndexedDB and other tabs by structured clone.
const plain = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

const storage = {
  local: {
    async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
      const list = keys == null ? null : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      if (list == null) {
        const all = await tx<string[]>('readonly', (s) => s.getAllKeys() as IDBRequest<string[]>);
        for (const k of all ?? []) out[k] = await tx('readonly', (s) => s.get(k));
        return out;
      }
      for (const k of list) {
        const v = await tx('readonly', (s) => s.get(k));
        if (v !== undefined) out[k] = v;
      }
      return out;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      const changes: Changes = {};
      for (const [k, value] of Object.entries(items)) {
        const oldValue = await tx('readonly', (s) => s.get(k));
        const newValue = plain(value);
        await tx('readwrite', (s) => {
          s.put(newValue, k);
        });
        changes[k] = { oldValue, newValue };
      }
      emit(changes);
    },
    async remove(keys: string | string[]): Promise<void> {
      const changes: Changes = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        const oldValue = await tx('readonly', (s) => s.get(k));
        await tx('readwrite', (s) => {
          s.delete(k);
        });
        changes[k] = { oldValue };
      }
      emit(changes);
    },
  },
  onChanged: {
    addListener: (l: ChangeListener) => void changeListeners.add(l),
    removeListener: (l: ChangeListener) => void changeListeners.delete(l),
  },
};

// --- runtime: messages to "the background" are handled in the page ----------

const messageListeners = new Set<MessageListener>();

const runtime = {
  async sendMessage(message: unknown): Promise<unknown> {
    for (const l of messageListeners) {
      const answer = l(message, {});
      if (answer !== undefined) return answer;
    }
    throw new Error('Nothing in the page answered that message');
  },
  onMessage: {
    addListener: (l: MessageListener) => void messageListeners.add(l),
    removeListener: (l: MessageListener) => void messageListeners.delete(l),
  },
  onInstalled: { addListener() {} },
  onStartup: { addListener() {} },
  getURL: (path: string) => new URL(path, location.origin).toString(),
  async getPlatformInfo() {
    const ua = navigator.userAgent;
    const os =
      /Mac OS X|Macintosh/.test(ua) && !/iPhone|iPad/.test(ua)
        ? 'mac'
        : /Windows/.test(ua)
          ? 'win'
          : /Android/.test(ua)
            ? 'android'
            : /CrOS/.test(ua)
              ? 'cros'
              : /iPhone|iPad/.test(ua)
                ? 'ios'
                : 'linux';
    return { os };
  },
};

// --- alarms, as timers while the page is open --------------------------------

const alarmListeners = new Set<AlarmListener>();
const timers = new Map<string, { timeout?: number; interval?: number }>();

const alarms = {
  async create(name: string, info: { periodInMinutes?: number; delayInMinutes?: number }) {
    await alarms.clear(name);
    const fire = () => alarmListeners.forEach((l) => l({ name }));
    const period = (info.periodInMinutes ?? 0) * 60_000;
    const delay = (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60_000;
    const entry: { timeout?: number; interval?: number } = {};
    entry.timeout = window.setTimeout(() => {
      fire();
      if (period) entry.interval = window.setInterval(fire, period);
    }, delay);
    timers.set(name, entry);
  },
  async clear(name: string) {
    const t = timers.get(name);
    if (t) {
      clearTimeout(t.timeout);
      clearInterval(t.interval);
      timers.delete(name);
    }
    return Boolean(t);
  },
  onAlarm: {
    addListener: (l: AlarmListener) => void alarmListeners.add(l),
    removeListener: (l: AlarmListener) => void alarmListeners.delete(l),
  },
};

// --- permissions: the page reaches every site through the hub's proxy -------

const noop = { addListener() {}, removeListener() {} };
type Origins = { origins?: string[] };
const permissions = {
  contains: async (_: Origins) => true,
  request: async (_: Origins) => true,
  remove: async (_: Origins) => true,
  onAdded: noop as {
    addListener(l: (p: Origins) => void): void;
    removeListener(l: (p: Origins) => void): void;
  },
  onRemoved: noop as {
    addListener(l: (p: Origins) => void): void;
    removeListener(l: (p: Origins) => void): void;
  },
};

const tabs = {
  query: async (_: object): Promise<{ id?: number; url?: string }[]> => [],
};

export const browser = { storage, runtime, alarms, permissions, tabs };
export default browser;
