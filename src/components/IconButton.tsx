import type { ButtonHTMLAttributes, ReactNode } from 'react';

// One consistent icon-button used across every header (sidebar, stream, article).
// A fixed square so rows line up and hover targets are uniform.

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  children: ReactNode;
}

export function IconButton({ label, active, className = '', children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-40 ${
        active ? 'text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
