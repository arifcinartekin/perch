import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '@perch/core/types';
import { useBackend } from '../backend';

export function useSettings() {
  const backend = useBackend();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void backend.getSettings().then((s) => {
      if (alive) {
        setSettings(s);
        setLoaded(true);
      }
    });
    const unwatch = backend.watch({ settings: (s) => alive && setSettings(s) });
    return () => {
      alive = false;
      unwatch();
    };
  }, [backend]);

  const update = useCallback(
    async (patch: Partial<Settings>) => {
      const next = await backend.saveSettings(patch);
      setSettings(next);
      return next;
    },
    [backend],
  );

  return { settings, loaded, update };
}
