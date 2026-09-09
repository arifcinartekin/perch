import { useEffect, useRef, useState } from 'react';
import { IconRss } from '@/components/icons';
import { verifyPin } from '@/lib/lock';

export function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (pin.length !== 6) return;
    let alive = true;
    setChecking(true);
    void verifyPin(pin).then((ok) => {
      if (!alive) return;
      setChecking(false);
      if (ok) {
        onUnlock();
      } else {
        setError(true);
        setPin('');
        setTimeout(() => alive && setError(false), 600);
      }
    });
    return () => {
      alive = false;
    };
  }, [pin, onUnlock]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg)] px-6">
      <div className="w-full max-w-[320px] text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--text)]">
          <IconRss size={22} />
        </div>
        <h1 className="text-[17px] font-semibold tracking-tight">Enter your PIN</h1>
        <p className="mt-1 text-[12.5px] text-[var(--text-faint)]">
          Perch is locked. Enter your 6-digit PIN to continue.
        </p>

        <div
          className={`mt-6 flex justify-center gap-2 ${error ? 'animate-[shake_.4s]' : ''}`}
          onClick={() => inputRef.current?.focus()}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={`flex h-11 w-9 items-center justify-center rounded-[10px] border text-[18px] ${
                i === pin.length ? 'border-[var(--text)]' : 'border-[var(--border-strong)]'
              }`}
            >
              {pin[i] ? '•' : ''}
            </span>
          ))}
        </div>

        <input
          ref={inputRef}
          value={pin}
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          disabled={checking}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className="sr-only"
          aria-label="PIN"
        />
        {error && <p className="mt-3 text-[12px] text-[#ef4444]">Wrong PIN — try again.</p>}
      </div>
    </div>
  );
}
