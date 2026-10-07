import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'default' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded-[10px] transition-colors ' +
  'disabled:opacity-50 disabled:pointer-events-none select-none focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';

const sizes: Record<Size, string> = {
  sm: 'text-[12px] px-2.5 py-1.5',
  md: 'text-[13px] px-3.5 py-2',
};

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--button)] text-[var(--button-contrast)] hover:brightness-110 active:brightness-95',
  default:
    'bg-[var(--bg-solid)] text-[var(--text)] border border-[var(--border-strong)] hover:bg-[color-mix(in_srgb,var(--text)_5%,var(--bg-solid))]',
  ghost:
    'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_7%,transparent)]',
  danger:
    'bg-[color-mix(in_srgb,#ef4444_12%,var(--bg-solid))] text-[#ef4444] border border-[color-mix(in_srgb,#ef4444_35%,transparent)] hover:bg-[color-mix(in_srgb,#ef4444_20%,var(--bg-solid))]',
};

export function Button({
  variant = 'default',
  size = 'md',
  loading,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : null}
      {children}
    </button>
  );
}
