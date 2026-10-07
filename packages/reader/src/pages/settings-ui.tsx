// Small building blocks shared by the settings sections.

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
        {title}
      </h2>
      <div className="flex flex-col gap-4 rounded-[14px] border border-[var(--border)] bg-[var(--bg-solid)] p-4">
        {children}
      </div>
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && (
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex overflow-hidden rounded-[9px] border border-[var(--border-strong)]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
            value === o.value
              ? 'bg-[var(--button)] text-[var(--button-contrast)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--accent-soft)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full px-[3px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
        checked ? 'bg-[var(--button)]' : 'bg-[color-mix(in_srgb,var(--text)_28%,transparent)]'
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-[var(--button-contrast)] shadow transition-transform duration-150 ${
          checked ? 'translate-x-[16px]' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
