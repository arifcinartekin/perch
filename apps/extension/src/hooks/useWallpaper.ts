import { useEffect, useState } from 'react';
import { loadWallpaper } from '@/lib/storage/wallpaper';

/**
 * Object URL for the stored background image, reloaded whenever the id in
 * settings changes (so every open reader tab follows along).
 */
export function useWallpaperUrl(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setUrl(null);
      return;
    }
    let alive = true;
    let objectUrl: string | null = null;
    void loadWallpaper()
      .then((blob) => {
        if (!alive || !blob) return setUrl(null);
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  return url;
}
