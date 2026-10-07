import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LibraryProvider, useLibrary } from '@/hooks/useLibrary';
import { useSettings } from '@/hooks/useSettings';
import { useApplyTheme } from '@/hooks/useTheme';
import { useWallpaperUrl } from '@/hooks/useWallpaper';
import { isPinEnabled, isUnlockedThisSession, markUnlocked } from '@/lib/lock';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ToastProvider } from './components/Toasts';
import { AllStream, CategoryStream, FeedStream, StarredStream } from './components/StreamView';
import { Settings } from './pages/Settings';
import { Onboarding } from './components/Onboarding';
import { PinGate } from './components/PinGate';

export function App() {
  const { settings } = useSettings();
  useApplyTheme(settings);
  const wallpaperUrl = useWallpaperUrl(settings.wallpaper?.id);

  // null = still deciding, true = show the PIN gate, false = unlocked.
  const [locked, setLocked] = useState<boolean | null>(null);

  useEffect(() => {
    if (isUnlockedThisSession()) {
      setLocked(false);
      return;
    }
    void isPinEnabled().then((on) => setLocked(on));
  }, [settings.pinHash, settings.pinSalt]);

  if (locked === null) return <div className="h-screen w-screen bg-[var(--bg)]" />;
  if (locked) {
    return (
      <PinGate
        onUnlock={() => {
          markUnlocked();
          setLocked(false);
        }}
      />
    );
  }

  return (
    <LibraryProvider>
      <ToastProvider>
        {wallpaperUrl && settings.wallpaper && (
          <Wallpaper
            url={wallpaperUrl}
            dim={settings.wallpaper.dim}
            blur={settings.wallpaper.blur}
          />
        )}
        <div
          className={`relative flex h-screen w-screen flex-col overflow-hidden text-[var(--text)] ${
            wallpaperUrl ? '' : 'bg-[var(--bg)]'
          }`}
        >
          <TopBar />
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="flex min-w-0 flex-1">
              <Gate>
                <Routes>
                  <Route path="/" element={<AllStream />} />
                  <Route path="/starred" element={<StarredStream />} />
                  <Route path="/feed/:feedId" element={<FeedStream />} />
                  <Route path="/category/:categoryId" element={<CategoryStream />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Gate>
            </main>
          </div>
        </div>
      </ToastProvider>
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
