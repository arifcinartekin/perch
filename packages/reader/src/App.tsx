import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BackendProvider, type ReaderBackend } from './backend';
import { LibraryProvider, useLibrary } from './hooks/useLibrary';
import { NotesProvider } from './hooks/useNotes';
import { NotesView } from './reader/NotesView';
import { useSettings } from './hooks/useSettings';
import { useApplyTheme } from './hooks/useTheme';
import { useWallpaperUrl } from './hooks/useWallpaper';
import { Sidebar } from './reader/Sidebar';
import { TopBar } from './reader/TopBar';
import { ToastProvider } from './reader/Toasts';
import { AllStream, CategoryStream, FeedStream, StarredStream } from './reader/StreamView';
import { Settings } from './pages/Settings';
import { Onboarding } from './reader/Onboarding';

export interface ReaderAppProps {
  backend: ReaderBackend;
  /** Host-specific sections appended to the Settings page. */
  settingsExtra?: ReactNode;
}

/** The full reader. The host provides the router (hash or browser history). */
export function ReaderApp({ backend, settingsExtra }: ReaderAppProps) {
  return (
    <BackendProvider backend={backend}>
      <Shell settingsExtra={settingsExtra} />
    </BackendProvider>
  );
}

function Shell({ settingsExtra }: { settingsExtra?: ReactNode }) {
  const { settings } = useSettings();
  useApplyTheme(settings);
  const wallpaperUrl = useWallpaperUrl(settings.wallpaper?.id);

  return (
    <LibraryProvider>
      <NotesProvider>
        <ToastProvider>
          {wallpaperUrl && settings.wallpaper && (
            <Wallpaper
              url={wallpaperUrl}
              dim={settings.wallpaper.dim}
              blur={settings.wallpaper.blur}
            />
          )}
          {/* Floating glass panels over the backdrop (or the background image). */}
          <div className="relative flex h-screen w-screen flex-col gap-2.5 overflow-hidden p-2.5 text-[var(--text)]">
            <TopBar />
            <div className="flex min-h-0 flex-1 gap-2.5">
              <Sidebar />
              <main className="reader-surface flex min-w-0 flex-1 overflow-hidden rounded-[18px]">
                <Gate>
                  <Routes>
                    <Route path="/" element={<AllStream />} />
                    <Route path="/starred" element={<StarredStream />} />
                    <Route path="/notes" element={<NotesView />} />
                    <Route path="/feed/:feedId" element={<FeedStream />} />
                    <Route path="/category/:categoryId" element={<CategoryStream />} />
                    <Route path="/settings" element={<Settings extra={settingsExtra} />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Gate>
              </main>
            </div>
          </div>
        </ToastProvider>
      </NotesProvider>
    </LibraryProvider>
  );
}

/** The background image, plus an overlay in the background colour to dim it. */
function Wallpaper({ url, dim, blur }: { url: string; dim: number; blur: number }) {
  // Flag <html> so reader surfaces switch to their frosted-glass styling.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-wallpaper', '');
    return () => root.removeAttribute('data-wallpaper');
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        className="absolute bg-cover bg-center"
        style={{
          backgroundImage: `url("${url}")`,
          // Overscan so blurred edges don't fade to transparent.
          inset: blur ? -blur * 2 : 0,
          filter: blur ? `blur(${blur}px)` : undefined,
        }}
      />
      <div className="absolute inset-0 bg-[var(--bg)]" style={{ opacity: dim / 100 }} />
    </div>
  );
}

/** Show onboarding until the first feed is added (except on the settings route). */
function Gate({ children }: { children: React.ReactNode }) {
  const { feeds, loading } = useLibrary();
  const { pathname } = useLocation();
  if (loading) return <div className="flex-1" />;
  if (feeds.length === 0 && pathname !== '/settings') return <Onboarding />;
  return <>{children}</>;
}
