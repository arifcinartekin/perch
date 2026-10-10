// A one-page PDF with a recovery code, to keep or print. Written by hand with
// the PDF's built-in fonts, so it needs no library and no network, and works
// the same in the browser and the extension. Text is ASCII (usernames are, and
// the wording is English); the iPhone app draws its own, localised.

const PAGE = { w: 595.28, h: 841.89 }; // A4
const MARGIN = 64;
const INK = '0.071 0.082 0.110';
const MUTED = '0.357 0.376 0.439';
const FAINT = '0.541 0.561 0.612';
const ACCENT = '1 0.478 0.102';
const CREAM = '0.969 0.961 0.941';
const EYE = '0.957 0.945 0.918';
const LINE = '0.886 0.871 0.839';
/** Bezier handle length for a quarter circle. */
const K = 0.5523;

export interface RecoveryPdfInput {
  code: string;
  username: string;
  host: string;
  date?: Date;
}

export function recoveryPdf({ code, username, host, date = new Date() }: RecoveryPdfInput): Blob {
  const out: string[] = [];
  const op = (...lines: string[]) => out.push(...lines);

  // Logo: the bird from brand/, in its own 440-unit box, scaled to 54 pt.
  const s = 54 / 440;
  const top = PAGE.h - 62;
  op('q', `${s} 0 0 ${-s} ${MARGIN - 39 * s} ${top + 53 * s} cm`);
  op(`${ACCENT} rg`, '362 132 m 462 168 l 372 192 l h f');
  op(
    `${INK} rg`,
    '392 176 m 392 120 352 84 304 84 c 252 84 214 118 208 164 c 150 188 96 250 56 330 c',
    '172 336 l 188 388 232 416 284 416 c 350 416 400 366 404 296 c 406 262 394 236 380 222 c',
    '388 210 392 194 392 176 c h f',
  );
  op(`${ACCENT} RG`, '15 w', '1 J');
  for (const r of [64, 114]) op(quarterArc(214, 330, r), 'S');
  op(`${ACCENT} rg`, circle(214, 330, 14), 'f');
  op(`${EYE} rg`, circle(338, 150, 10), 'f');
  op(`${INK} RG`, '10 w', '262 410 m 262 440 l S', '312 410 m 312 440 l S');
  op(`${INK} rg`, roundedRect(96, 436, 340, 26, 13), 'f');
  op('Q');
  text(op, 'F2', 28, MARGIN + 66, top - 40, INK, 'Perch');

  // Title and whose code it is.
  text(op, 'F2', 26, MARGIN, 650, INK, 'Recovery code');
  text(op, 'F1', 13, MARGIN, 626, MUTED, `For @${ascii(username)} on ${ascii(host)}`);

  // The code, in a cream box.
  const boxW = PAGE.w - 2 * MARGIN;
  op(`${CREAM} rg`, `${LINE} RG`, '1 w', roundedRect(MARGIN, 526, boxW, 76, 14), 'B');
  const size = 26;
  const codeW = code.length * size * 0.6; // Courier: every glyph is 0.6 em
  text(op, 'F3', size, MARGIN + (boxW - codeW) / 2, 555, INK, ascii(code));
  text(op, 'F1', 10, MARGIN, 506, FAINT, `Made on ${date.toISOString().slice(0, 10)}`);

  let y = 456;
  const heading = (t: string) => {
    text(op, 'F2', 13, MARGIN, y, INK, t);
    y -= 22;
  };
  const para = (...lines: string[]) => {
    for (const l of lines) {
      text(op, 'F1', 11.5, MARGIN, y, MUTED, l);
      y -= 17;
    }
    y -= 14;
  };
  heading('Keep it safe');
  para(
    'If you forget your password, this code is the only way back into your account.',
    'The server keeps only a scrambled copy, so nobody can tell it to you again.',
    'Store it somewhere private: a password manager, or printed and put away.',
    'Anyone with this code and your username can set a new password for your account.',
  );
  heading('To use it');
  para(
    '1.  Open Perch, choose Sign in, then "Forgot your password?".',
    '2.  Enter your username, this code and a new password.',
    '3.  Your other devices are signed out. You can make a new code in Settings,',
    '     which replaces this one.',
  );

  op(`${LINE} RG`, '0.8 w', `${MARGIN} 84 m ${PAGE.w - MARGIN} 84 l S`);
  text(op, 'F1', 9.5, MARGIN, 66, FAINT, 'perch.ws');
  const note = 'Keep this page private.';
  text(op, 'F1', 9.5, PAGE.w - MARGIN - note.length * 9.5 * 0.5, 66, FAINT, note);

  return pdf(out.join('\n'), `Perch recovery code for ${ascii(username)}`);
}

function text(
  op: (...l: string[]) => void,
  font: string,
  size: number,
  x: number,
  y: number,
  color: string,
  s: string,
) {
  op('BT', `${color} rg`, `/${font} ${size} Tf`, `${x.toFixed(2)} ${y.toFixed(2)} Td`);
  op(`(${s.replace(/[\\()]/g, (c) => `\\${c}`)}) Tj`, 'ET');
}

/** The quarter circle from the top of (cx, cy, r) round to its right. */
const quarterArc = (cx: number, cy: number, r: number) =>
  `${cx} ${cy - r} m ${cx + K * r} ${cy - r} ${cx + r} ${cy - K * r} ${cx + r} ${cy} c`;

function circle(cx: number, cy: number, r: number): string {
  const k = K * r;
  return [
    `${cx + r} ${cy} m`,
    `${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c`,
    `${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c`,
    `${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c`,
    `${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c h`,
  ].join(' ');
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const k = K * r;
  return [
    `${x + r} ${y} m ${x + w - r} ${y} l`,
    `${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r} c`,
    `${x + w} ${y + h - r} l`,
    `${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h} c`,
    `${x + r} ${y + h} l`,
    `${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r} c`,
    `${x} ${y + r} l`,
    `${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y} c h`,
  ].join(' ');
}

/** Anything outside printable ASCII becomes "?": the built-in fonts can't show it. */
const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, '?');

/** Wraps a content stream in the objects a one-page PDF needs, with a correct xref. */
function pdf(content: string, title: string): Blob {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Contents 4 0 R ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${title.replace(/[\\()]/g, (c) => `\\${c}`)}) /Producer (Perch) >>`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) body += `${String(o).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 8 0 R >>\n`;
  body += `startxref\n${xref}\n%%EOF\n`;
  return new Blob([body], { type: 'application/pdf' });
}
