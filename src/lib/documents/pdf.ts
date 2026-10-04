/**
 * Generatore PDF minimo, senza dipendenze: rettangoli, testo Helvetica
 * (Latin-1), impaginazione su più pagine e piè di pagina numerato.
 *
 * Estratto dai documenti dell'AI Readiness perché lo usa anche il registro
 * della formazione IA: un solo generatore, una sola resa tipografica.
 */
// ─── Palette (sobria, alto contrasto su carta) ──────────────────────────────
export const INK = [0.102, 0.122, 0.18] as const; // quasi nero blu
export const ACCENT = [0.024, 0.463, 0.416] as const; // verde profondo
export const GRAY = [0.42, 0.447, 0.502] as const;
export const LIGHT = [0.949, 0.957, 0.965] as const;
export const HAIR = [0.82, 0.84, 0.86] as const;
export const WHITE = [1, 1, 1] as const;

export type RGB = readonly [number, number, number];

export function esc(text: string) {
  // I font usano WinAnsiEncoding: coincide con Latin-1 per le lettere
  // accentate. I pochi caratteri tipografici fuori da Latin-1 hanno un loro
  // byte; tutto il resto diventa «?» invece di un carattere sbagliato.
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, "-")
    .replace(/…/g, "...")
    .replace(/€/g, "\x80")
    .replace(/•/g, "\x95")
    .replace(/[^\x20-\x7e\xa0-\xff\x80\x95]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export function wrap(text: string, size: number, widthPts: number) {
  const maxChars = Math.max(12, Math.floor(widthPts / (size * 0.5)));
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

// ─── Misura del testo ─────────────────────────────────────────────────────
// Larghezze AFM di Helvetica e Helvetica-Bold (millesimi di em), caratteri
// 32–126. Le lettere accentate misurano come la loro lettera base.
const HELVETICA = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELVETICA_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const SPECIAL: Record<string, number> = { "«": 556, "»": 556, "·": 278, "°": 400, "\u00a0": 278, "€": 556, "•": 350, "ß": 611, "æ": 889 };

function charWidth(char: string, bold: boolean) {
  if (SPECIAL[char] !== undefined) return SPECIAL[char];
  const base = char.normalize("NFD")[0] ?? char;
  const code = base.charCodeAt(0);
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  return code >= 32 && code <= 126 ? table[code - 32] : 556;
}

/** Larghezza in punti di una riga di testo. */
export function measure(text: string, size: number, bold = false) {
  let total = 0;
  for (const char of text) total += charWidth(char, bold);
  return (total / 1000) * size;
}

/**
 * A capo misurato sui caratteri reali. Una parola più larga della colonna
 * (un'impronta, un indirizzo email) si spezza invece di uscire dal margine.
 */
export function wrapMeasured(text: string, size: number, widthPts: number, bold = false) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const rawWord of paragraph.replace(/\s+/g, " ").trim().split(" ")) {
      let word = rawWord;
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate, size, bold) <= widthPts) { current = candidate; continue; }
      if (current) lines.push(current);
      current = "";
      while (measure(word, size, bold) > widthPts) {
        let cut = word.length - 1;
        while (cut > 1 && measure(word.slice(0, cut), size, bold) > widthPts) cut--;
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      current = word;
    }
    lines.push(current);
  }
  return lines.length ? lines : [""];
}

export const PAGE_W = 595;
export const PAGE_H = 842;
export const MARGIN = 56;
export const CONTENT_W = PAGE_W - MARGIN * 2;
export const BOTTOM = 64;

export type TableColumn = { title: string; width: number };

export class PdfBuilder {
  pages: string[][] = [];
  ops: string[] = [];
  y = PAGE_H - MARGIN;
  /** A capo sulle larghezze reali dei caratteri invece che su una media. */
  precise = false;
  /** Intestazione ripetuta in cima a ogni pagina nuova (es. quella di una tabella). */
  private onNewPage: (() => void) | null = null;

  newPage() {
    if (this.ops.length) this.pages.push(this.ops);
    this.ops = [];
    this.y = PAGE_H - MARGIN;
    const repeat = this.onNewPage;
    if (repeat) { this.onNewPage = null; repeat(); this.onNewPage = repeat; }
  }
  ensure(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }
  rect(x: number, w: number, h: number, color: RGB, yTop = this.y) {
    this.ops.push(
      `${color.join(" ")} rg ${x.toFixed(1)} ${(yTop - h).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`
    );
  }
  hr(color: RGB = HAIR) {
    this.ensure(8);
    this.rect(MARGIN, CONTENT_W, 0.7, color);
    this.y -= 8;
  }
  spacer(h: number) {
    this.y -= h;
  }
  text(
    str: string,
    {
      size = 9.5,
      font = "R" as "R" | "B" | "O",
      color = INK as RGB,
      x = MARGIN,
      width,
      lineGap = 3.2,
      after = 0,
    }: {
      size?: number;
      font?: "R" | "B" | "O";
      color?: RGB;
      x?: number;
      width?: number;
      lineGap?: number;
      after?: number;
    } = {}
  ) {
    const fontKey = font === "B" ? "F2" : font === "O" ? "F3" : "F1";
    const available = width ?? CONTENT_W - (x - MARGIN);
    const lines = this.precise ? wrapMeasured(str, size, available, font === "B") : wrap(str, size, available);
    for (const line of lines) {
      this.ensure(size + lineGap);
      this.y -= size;
      this.ops.push(
        `BT /${fontKey} ${size} Tf ${color.join(" ")} rg ${x.toFixed(1)} ${this.y.toFixed(1)} Td (${esc(line)}) Tj ET`
      );
      this.y -= lineGap;
    }
    this.y -= after;
  }
  /** Una riga di testo a una posizione precisa, senza spostare il cursore. */
  line(str: string, x: number, baseline: number, { size = 9, font = "R" as "R" | "B" | "O", color = INK as RGB } = {}) {
    const fontKey = font === "B" ? "F2" : font === "O" ? "F3" : "F1";
    this.ops.push(`BT /${fontKey} ${size} Tf ${color.join(" ")} rg ${x.toFixed(1)} ${baseline.toFixed(1)} Td (${esc(str)}) Tj ET`);
  }

  /** Coppie etichetta–valore su due colonne. */
  pairs(items: [string, string][], { labelWidth = 150, size = 9.5 } = {}) {
    const lineH = size + 3.4;
    for (const [label, value] of items) {
      const labelLines = wrapMeasured(label, size, labelWidth - 10, true);
      const valueLines = wrapMeasured(value, size, CONTENT_W - labelWidth);
      const height = Math.max(labelLines.length, valueLines.length) * lineH + 4;
      this.ensure(height);
      labelLines.forEach((l, i) => this.line(l, MARGIN, this.y - size - i * lineH, { size, font: "B", color: GRAY }));
      valueLines.forEach((l, i) => this.line(l, MARGIN + labelWidth, this.y - size - i * lineH, { size }));
      this.y -= height;
    }
  }

  /**
   * Tabella: intestazione ripetuta su ogni pagina, righe che vanno a capo
   * dentro la propria colonna e non si spezzano fra due pagine.
   */
  table(columns: TableColumn[], rows: string[][], { size = 8, padX = 4, padY = 4 } = {}) {
    const lineH = size + 2.6;
    const total = columns.reduce((n, c) => n + c.width, 0);
    const scale = CONTENT_W / total;
    const widths = columns.map((c) => c.width * scale);
    const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((n, w) => n + w, 0));
    const header = () => {
      const lines = columns.map((c, i) => wrapMeasured(c.title, size, widths[i] - padX * 2, true));
      const h = Math.max(...lines.map((l) => l.length)) * lineH + padY * 2;
      this.rect(MARGIN, CONTENT_W, h, LIGHT);
      lines.forEach((cell, i) => cell.forEach((l, j) => this.line(l, xs[i] + padX, this.y - padY - size - j * lineH + 1.5, { size, font: "B" })));
      this.y -= h;
    };
    this.ensure(lineH * 4 + padY * 4);
    header();
    this.onNewPage = header;
    rows.forEach((row) => {
      const lines = row.map((cell, i) => wrapMeasured(cell ?? "", size, widths[i] - padX * 2));
      const h = Math.max(...lines.map((l) => l.length)) * lineH + padY * 2;
      this.ensure(h);
      lines.forEach((cell, i) => cell.forEach((l, j) => this.line(l, xs[i] + padX, this.y - padY - size - j * lineH + 1.5, { size })));
      this.y -= h;
      this.rect(MARGIN, CONTENT_W, 0.5, HAIR);
    });
    this.onNewPage = null;
    this.y -= 6;
  }

  /** Riga di testo su una banda colorata piena. */
  bandText(str: string, opts: { bg: RGB; color?: RGB; size?: number; padY?: number; font?: "R" | "B" }) {
    const size = opts.size ?? 11;
    const padY = opts.padY ?? 8;
    const h = size + padY * 2;
    this.ensure(h + 4);
    this.rect(MARGIN, CONTENT_W, h, opts.bg);
    this.ops.push(
      `BT /${opts.font === "R" ? "F1" : "F2"} ${size} Tf ${(opts.color ?? WHITE).join(" ")} rg ${MARGIN + 12} ${(this.y - padY - size + 1.5).toFixed(1)} Td (${esc(str)}) Tj ET`
    );
    this.y -= h + 4;
  }

  finalize(footerLeft: string, info?: { title: string; author?: string; subject?: string }) {
    if (this.ops.length) this.pages.push(this.ops);
    const total = this.pages.length;
    const objects: string[] = [];
    const pageIds = this.pages.map((_, i) => 3 + i);
    const fontR = 3 + total;
    const fontB = fontR + 1;
    const fontO = fontB + 1;
    const contentIds = this.pages.map((_, i) => fontO + 1 + i);

    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    objects.push(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${total} >>`
    );
    this.pages.forEach((_, i) => {
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R /F3 ${fontO} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`
      );
    });
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");
    this.pages.forEach((pageOps, i) => {
      const footer = [
        `${HAIR.join(" ")} rg ${MARGIN} 46 ${CONTENT_W} 0.7 re f`,
        `BT /F1 7.5 Tf ${GRAY.join(" ")} rg ${MARGIN} 34 Td (${esc(footerLeft)}) Tj ET`,
        `BT /F1 7.5 Tf ${GRAY.join(" ")} rg ${PAGE_W - MARGIN - 60} 34 Td (Pagina ${i + 1} di ${total}) Tj ET`,
      ].join("\n");
      const stream = [...pageOps, footer].join("\n");
      objects.push(
        `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`
      );
    });

    let infoRef = "";
    if (info) {
      const fields = [`/Title (${esc(info.title)})`, `/Producer (Unbundle)`];
      if (info.author) fields.push(`/Author (${esc(info.author)})`);
      if (info.subject) fields.push(`/Subject (${esc(info.subject)})`);
      objects.push(`<< ${fields.join(" ")} >>`);
      infoRef = ` /Info ${objects.length} 0 R`;
    }

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf, "latin1"));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf, "latin1");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${infoRef} >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, "latin1");
  }
}

