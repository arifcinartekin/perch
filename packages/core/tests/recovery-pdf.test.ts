import { recoveryPdf } from '../src/recovery-pdf';

describe('recovery PDF', () => {
  it('is a well-formed one-page PDF naming the account', async () => {
    const blob = recoveryPdf({
      code: 'K7QM-2XRA-9PDE-H4TN-W8CB',
      username: 'quiet_heron42',
      host: 'app.perch.ws',
    });
    const pdf = await blob.text();
    expect(blob.type).toBe('application/pdf');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('(K7QM-2XRA-9PDE-H4TN-W8CB) Tj');
    expect(pdf).toContain('@quiet_heron42 on app.perch.ws');
    // startxref points at the xref table, and each entry at its object.
    const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(start, start + 4)).toBe('xref');
    const offsets = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => +m[1]!);
    offsets.forEach((o, i) => expect(pdf.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
});
