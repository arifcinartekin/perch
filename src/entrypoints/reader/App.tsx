import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LibraryProvider, useLibrary } from '@/hooks/useLibrary';
import { useSettings } from '@/hooks/useSettings';
import { useApplyTheme } from '@/hooks/useTheme';
import { isPinEnabled, isUnlockedThisSession, markUnlocked } from '@/lib/lock';
import { Sidebar } from './components/Sidebar';
import { ToastProvider } from './components/Toasts';
import { AllStream, CategoryStream, FeedStream, StarredStream } from './components/StreamView';
import { Settings } from './pages/Settings';
import { Onboarding } from './components/Onboarding';
import { PinGate } from './components/PinGate';

export function App() {
  const { settings } = useSettings();
  useApplyTheme(settings.theme);

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
        <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
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
      </ToastProvider>
    </LibraryProvider>
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
