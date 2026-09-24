/**
 * Minimal single-page PDF writer for invoices.
 *
 * Uses the two standard Helvetica faces every PDF reader ships, so no font files are embedded and
 * no dependency is needed. Those faces only cover WinAnsi (Latin-1), so text outside it is
 * transliterated or replaced; callers should not pass the rupee sign.
 */

export type Rgb = readonly [number, number, number];

type FontKey = 'regular' | 'bold';

const FONT_RESOURCE: Record<FontKey, string> = { regular: 'F1', bold: 'F2' };

/** Standard Helvetica AFM advance widths (per 1000 em) for ASCII 32..126, used for right alignment. */
const ASCII_WIDTHS: Record<FontKey, readonly number[]> = {
  regular: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778,
    722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
    278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ],
  bold: [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778,
    722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
    278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ],
};
const DEFAULT_WIDTH: Record<FontKey, number> = { regular: 556, bold: 611 };

function toWinAnsi(text: string): string {
  return text
    .replace(/\u20B9/g, 'Rs.')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00B7/g, '-')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function escapePdfString(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function num(value: number): string {
  return Number(value.toFixed(2)).toString();
}

export class PdfPage {
  static readonly WIDTH = 595.28;
  static readonly HEIGHT = 841.89;

  private readonly ops: string[] = [];

  textWidth(text: string, size: number, font: FontKey = 'regular'): number {
    const table = ASCII_WIDTHS[font];
    let units = 0;
    for (const ch of toWinAnsi(text)) units += table[ch.charCodeAt(0) - 32] ?? DEFAULT_WIDTH[font];
    return (units / 1000) * size;
  }

  /** `y` is measured from the top of the page, which is how layouts are easier to reason about. */
  text(
    x: number,
    y: number,
    value: string,
    opts: { size?: number; font?: FontKey; color?: Rgb; align?: 'left' | 'right' } = {},
  ): void {
    const size = opts.size ?? 10;
    const font = opts.font ?? 'regular';
    const [r, g, b] = opts.color ?? [0.1, 0.1, 0.1];
    const clean = toWinAnsi(value);
    const left = opts.align === 'right' ? x - this.textWidth(clean, size, font) : x;
    this.ops.push(
      `BT /${FONT_RESOURCE[font]} ${num(size)} Tf ${num(r)} ${num(g)} ${num(b)} rg ` +
        `${num(left)} ${num(PdfPage.HEIGHT - y)} Td (${escapePdfString(clean)}) Tj ET`,
    );
  }

  /** Greedy word wrap; returns the y just below the last line. */
  wrappedText(
    x: number,
    y: number,
    value: string,
    maxWidth: number,
    opts: { size?: number; font?: FontKey; color?: Rgb; lineHeight?: number } = {},
  ): number {
    const size = opts.size ?? 10;
    const lineHeight = opts.lineHeight ?? size * 1.4;
    const words = toWinAnsi(value).split(/\s+/).filter(Boolean);
    let line = '';
    let cursor = y;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && this.textWidth(candidate, size, opts.font) > maxWidth) {
        this.text(x, cursor, line, opts);
        cursor += lineHeight;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      this.text(x, cursor, line, opts);
      cursor += lineHeight;
    }
    return cursor;
  }

  rect(x: number, y: number, width: number, height: number, fill: Rgb): void {
    const [r, g, b] = fill;
    this.ops.push(
      `${num(r)} ${num(g)} ${num(b)} rg ${num(x)} ${num(PdfPage.HEIGHT - y - height)} ${num(width)} ${num(height)} re f`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb, width = 0.75): void {
    const [r, g, b] = color;
    this.ops.push(
      `${num(r)} ${num(g)} ${num(b)} RG ${num(width)} w ${num(x1)} ${num(PdfPage.HEIGHT - y1)} m ` +
        `${num(x2)} ${num(PdfPage.HEIGHT - y2)} l S`,
    );
  }

  toBuffer(title: string): Buffer {
    const content = this.ops.join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PdfPage.WIDTH} ${PdfPage.HEIGHT}] ` +
        '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
      `<< /Title (${escapePdfString(toWinAnsi(title))}) /Producer (Vedsutra) >>`,
    ];

    let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets: number[] = [];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(body, 'latin1'));
      body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(body, 'latin1');
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) body += `${offset.toString().padStart(10, '0')} 00000 n \n`;
    body +=
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(body, 'latin1');
  }
}
