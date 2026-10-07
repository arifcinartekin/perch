import { getDB } from './db';

// The reader's background image. Kept in IndexedDB (the `meta` store) rather
// than storage.local: images are large binary blobs, and storage.local is
// capped at ~10 MB and JSON-only. Only reader pages touch this.

const KEY = 'wallpaper';

/** Images larger than this on their long edge are scaled down before storing. */
const MAX_EDGE = 3840;
/** Images under this size (and within MAX_EDGE) are stored untouched, e.g. animated GIFs. */
const KEEP_ORIGINAL_BYTES = 2 * 1024 * 1024;
/** Hard cap on what we accept from the picker. */
export const MAX_WALLPAPER_INPUT_BYTES = 40 * 1024 * 1024;

export async function loadWallpaper(): Promise<Blob | undefined> {
  const value = await (await getDB()).get('meta', KEY);
  return value instanceof Blob ? value : undefined;
}

export async function clearWallpaper(): Promise<void> {
  await (await getDB()).delete('meta', KEY);
}

/**
 * Validate, downscale if needed, and store an image the user picked. Returns
 * a new id to put in settings so every open reader picks up the change.
 */
export async function saveWallpaper(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.');
  if (file.size > MAX_WALLPAPER_INPUT_BYTES)
    throw new Error('That image is too large (max 40 MB).');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image format isn’t supported. Try a JPEG, PNG, WebP or GIF.');
  }

  let blob: Blob = file;
  const longEdge = Math.max(bitmap.width, bitmap.height);
  if (file.size > KEEP_ORIGINAL_BYTES || longEdge > MAX_EDGE) {
    const scale = Math.min(1, MAX_EDGE / longEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not process that image.'))),
        'image/webp',
        0.9,
      ),
    );
  }
  bitmap.close();

  await (await getDB()).put('meta', blob, KEY);
  return `${Date.now().toString(36)}-${blob.size.toString(36)}`;
}
