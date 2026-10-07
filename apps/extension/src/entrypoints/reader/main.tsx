import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ReaderApp, useApplyTheme } from '@perch/reader';
import '@/assets/tailwind.css';
import { useSettings } from '@/hooks/useSettings';
import { localBackend } from '@/lib/backend';
import { isPinEnabled, isUnlockedThisSession, markUnlocked } from '@/lib/lock';
import { PinGate } from './components/PinGate';
import { ExtensionSettings } from './ExtensionSettings';

function Root() {
  const { settings } = useSettings();
  useApplyTheme(settings);

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
  return <ReaderApp backend={localBackend} settingsExtra={<ExtensionSettings />} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Root />
    </HashRouter>
  </StrictMode>,
);
