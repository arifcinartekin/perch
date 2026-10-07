// The Perch logo, coloured by the theme so it follows a custom accent. The
// bird takes the text colour (ink on light, cream on dark), the beak and waves
// the accent; the eye and the perch switch per scheme as in the brand files
// (--logo-eye, --logo-perch in styles.css). Sources: brand/src.

const BODY =
  'M 392 176 C 392 120 352 84 304 84 C 252 84 214 118 208 164 C 150 188 96 250 56 330 L 172 336 C 188 388 232 416 284 416 C 350 416 400 366 404 296 C 406 262 394 236 380 222 C 388 210 392 194 392 176 Z';

const INK = 'var(--logo-body, var(--text))';
const ACCENT = 'var(--accent)';
const EYE = 'var(--logo-eye, var(--bg-solid))';
const PERCH = 'var(--logo-perch, var(--accent))';

function a11y(title?: string) {
  return title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const };
}

/** The bird on its perch, in the 512-unit space of perch-mark-*.svg. */
function Bird() {
  return (
    <>
      <polygon points="362,132 462,168 372,192" fill={ACCENT} />
      <path d={BODY} fill={INK} />
      <g fill="none" stroke={ACCENT} strokeWidth={15} strokeLinecap="round">
        <path d="M 214 266 A 64 64 0 0 1 278 330" />
        <path d="M 214 216 A 114 114 0 0 1 328 330" />
      </g>
      <circle cx={214} cy={330} r={14} fill={ACCENT} />
      <circle cx={338} cy={150} r={10} fill={EYE} />
      <g stroke={INK} strokeWidth={10} strokeLinecap="round">
        <line x1={262} y1={410} x2={262} y2={440} />
        <line x1={312} y1={410} x2={312} y2={440} />
      </g>
      <rect x={96} y={436} width={340} height={26} rx={13} fill={PERCH} />
    </>
  );
}

/**
 * The bird alone. Under 28 px it switches to the simplified drawing, which
 * keeps the wave and the perch legible (brand/src/perch-mark-small.svg).
 */
export function PerchMark({
  size = 24,
  className,
  title,
}: {
  size?: number;
  className?: string;
  /** Accessible name; omit when the logo sits next to the word "Perch". */
  title?: string;
}) {
  if (size < 28) {
    return (
      <svg
        viewBox="39 53 440 440"
        width={size}
        height={size}
        className={className}
        {...a11y(title)}
      >
        <polygon points="356,128 470,168 366,198" fill={ACCENT} />
        <path d={BODY} fill={INK} />
        <path
          d="M 214 228 A 102 102 0 0 1 316 330"
          fill="none"
          stroke={ACCENT}
          strokeWidth={34}
          strokeLinecap="round"
        />
        <circle cx={220} cy={324} r={26} fill={ACCENT} />
        <circle cx={336} cy={150} r={20} fill={EYE} />
        <rect x={90} y={428} width={352} height={42} rx={21} fill={PERCH} />
      </svg>
    );
  }

  return (
    <svg viewBox="39 53 440 440" width={size} height={size} className={className} {...a11y(title)}>
      <Bird />
    </svg>
  );
}

/**
 * The bird with the "perch" wordmark beside it (perch-logo-horizontal-*.svg),
 * cropped to the drawing. `height` is the full height, descender included.
 */
export function PerchLogo({
  height = 26,
  className,
  title = 'Perch',
}: {
  height?: number;
  className?: string;
  title?: string;
}) {
  const [x, y, w, h] = [88, 106, 1548, 473];
  return (
    <svg
      viewBox={`${x} ${y} ${w} ${h}`}
      height={height}
      width={(height * w) / h}
      className={className}
      {...a11y(title)}
    >
      <g transform="translate(40 30)">
        <Bird />
      </g>
      <g
        transform="translate(660 292)"
        fill="none"
        stroke={INK}
        strokeWidth={38}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 0 20 L 0 260" />
        <circle cx={80} cy={100} r={80} />
        <path d="M 226 100 L 386 100 A 80 80 0 1 0 367.3 151.4" />
        <path d="M 452 20 L 452 180" />
        <path d="M 452 100 A 80 80 0 0 1 532 20" />
        <path d="M 723.3 48.6 A 80 80 0 1 0 723.3 151.4" />
        <path d="M 789 -60 L 789 180" />
        <path d="M 789 100 A 80 80 0 0 1 949 100 L 949 180" />
      </g>
    </svg>
  );
}
