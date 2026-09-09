// Trigger a file download from an extension page. Extension pages are allowed to
// do this (unlike sandboxed contexts).
export function downloadText(filename: string, contents: string, mime = 'text/plain'): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open a file picker and resolve with the selected file's text, or null if cancelled. */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const done = (v: { name: string; text: string } | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      done({ name: file.name, text: await file.text() });
    });
    // If the dialog is dismissed we may never hear back; a focus fallback resolves null.
    window.addEventListener('focus', () => setTimeout(() => done(null), 500), { once: true });
    input.click();
  });
}
