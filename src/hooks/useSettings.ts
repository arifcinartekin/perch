import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/types';
import { getSettings, saveSettings, watchSettings } from '@/lib/storage/settings';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void getSettings().then((s) => {
      if (alive) {
        setSettings(s);
        setLoaded(true);
      }
    });
    const unwatch = watchSettings((s) => alive && setSettings(s));
    return () => {
      alive = false;
      unwatch();
    };
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await saveSettings(patch);
    setSettings(next);
    return next;
  }, []);

  return { settings, loaded, update };
}
