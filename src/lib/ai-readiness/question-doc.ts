import XLSXStyle from "xlsx-js-style";
import type { AiReadinessTemplateDefinition } from "./types";

/**
 * Documenti "da cliente" per le domande dell'assessment: un file per la
 * survey organizzazione e uno per le schede referenti, in PDF (impaginato
 * con gerarchia tipografica, bande di sezione e tabelle livelli) e in Excel
 * (workbook stilizzato). Sempre generati dal template effettivo
 * dell'assessment: ogni modifica alle domande si riflette al download.
 */

export type QuestionDocPayload = {
  assessmentName: string;
  displayName: string;
  anonymous: boolean;
  trackTitle: string;
  trackSubtitle: string;
  generatedAt: Date;
  definition: AiReadinessTemplateDefinition;
};

// ─── Palette (sobria, alto contrasto su carta) ──────────────────────────────
const INK = [0.102, 0.122, 0.18] as const; // quasi nero blu
const ACCENT = [0.024, 0.463, 0.416] as const; // verde profondo
const GRAY = [0.42, 0.447, 0.502] as const;
const LIGHT = [0.949, 0.957, 0.965] as const;
const HAIR = [0.82, 0.84, 0.86] as const;
const WHITE = [1, 1, 1] as const;

type RGB = readonly [number, number, number];

function esc(text: string) {
  // Helvetica core: solo Latin-1. Sostituzioni sicure per i caratteri usati.
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, "-")
    .replace(/…/g, "...")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(text: string, size: number, widthPts: number) {
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

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 64;

class PdfBuilder {
  pages: string[][] = [];
  ops: string[] = [];
  y = PAGE_H - MARGIN;

  newPage() {
    if (this.ops.length) this.pages.push(this.ops);
    this.ops = [];
    this.y = PAGE_H - MARGIN;
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
    const lines = wrap(str, size, width ?? CONTENT_W - (x - MARGIN));
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

  finalize(footerLeft: string) {
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
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>");
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
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, "latin1");
  }
}

function typeLabel(t: string) {
  return t === "scale"
    ? "Scala 1-5"
    : t === "single_choice"
      ? "Scelta singola"
      : "Risposta aperta";
}

export function buildQuestionDocPdf(payload: QuestionDocPayload) {
  const doc = new PdfBuilder();
  const def = payload.definition;
  const scored = def.questions.filter((q) => q.answerType !== "text").length;
  const open = def.questions.length - scored;
  const dateLabel = payload.generatedAt.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ── Testata ──
  const headH = 118;
  doc.rect(0, PAGE_W, headH, INK, PAGE_H);
  doc.rect(0, PAGE_W, 3.5, ACCENT, PAGE_H - headH + 3.5);
  doc.ops.push(
    `BT /F2 8.5 Tf ${[0.62, 0.75, 0.72].join(" ")} rg ${MARGIN} ${PAGE_H - 40} Td (${esc(payload.displayName.toUpperCase())}  ·  AI READINESS ASSESSMENT) Tj ET`,
    `BT /F2 21 Tf 1 1 1 rg ${MARGIN} ${PAGE_H - 66} Td (${esc(payload.trackTitle)}) Tj ET`,
    `BT /F1 9.5 Tf ${[0.78, 0.82, 0.86].join(" ")} rg ${MARGIN} ${PAGE_H - 84} Td (${esc(payload.trackSubtitle)}) Tj ET`,
    `BT /F1 8 Tf ${[0.62, 0.67, 0.73].join(" ")} rg ${MARGIN} ${PAGE_H - 102} Td (${esc(`${payload.assessmentName}   ·   ${scored} domande a punteggio${open ? ` + ${open} aperte` : ""}   ·   ${payload.anonymous ? "Raccolta anonima" : "Raccolta nominativa"}   ·   ${dateLabel}`)}) Tj ET`
  );
  doc.y = PAGE_H - headH - 22;

  // ── Guida rapida ──
  doc.text("Come si risponde", { size: 9, font: "B", color: ACCENT, after: 1 });
  doc.text(
    "Per ogni domanda a punteggio si sceglie il livello da 1 a 5 che descrive meglio la situazione: ogni livello e spiegato. Se non si conosce la risposta e disponibile l'opzione «Non so / non applicabile». Le risposte si salvano automaticamente e si puo riprendere in qualsiasi momento.",
    { size: 8.5, color: GRAY, after: 10 }
  );

  // ── Sezioni ──
  let n = 0;
  for (const section of def.sections) {
    const pillar = def.pillars.find((p) => p.id === section.pillarId);
    const questions = def.questions.filter((q) => q.sectionId === section.id);
    if (questions.length === 0) continue;

    doc.ensure(70);
    doc.spacer(6);
    doc.bandText(
      `${(pillar?.title ?? "").toUpperCase()}   —   ${section.title}`,
      { bg: INK, size: 10.5 }
    );
    if (section.description) {
      doc.text(section.description, { size: 8.5, font: "O", color: GRAY, after: 6 });
    }

    for (const question of questions) {
      n += 1;
      const levels = question.answerType === "scale" ? question.levels ?? [] : [];
      const options = question.answerType === "single_choice" ? question.options ?? [] : [];
      const blockEstimate =
        26 +
        (question.description ? 22 : 0) +
        (levels.length + options.length) * 13 +
        (question.allowUnsure ? 13 : 0);
      doc.ensure(Math.min(blockEstimate, 300));

      // numero in accent + domanda in bold
      const numLabel = `${String(n).padStart(2, "0")}`;
      doc.ensure(16);
      doc.y -= 10.5;
      doc.ops.push(
        `BT /F2 10 Tf ${ACCENT.join(" ")} rg ${MARGIN} ${doc.y.toFixed(1)} Td (${numLabel}) Tj ET`
      );
      doc.y += 10.5;
      doc.text(`${question.label}${question.required ? " *" : ""}`, {
        size: 10,
        font: "B",
        x: MARGIN + 24,
        after: 0.5,
      });
      const meta = typeLabel(question.answerType);
      if (question.description) {
        doc.text(question.description, {
          size: 8.3,
          font: "O",
          color: GRAY,
          x: MARGIN + 24,
          after: 1,
        });
      }
      doc.text(meta, { size: 7.3, font: "B", color: ACCENT, x: MARGIN + 24, after: 3 });

      if (levels.length > 0) {
        for (const level of levels) {
          doc.ensure(13);
          // pallino numerato: quadratino chiaro + numero
          doc.rect(MARGIN + 24, 12, 10.5, LIGHT, doc.y + 1);
          doc.y -= 8.5;
          doc.ops.push(
            `BT /F2 7.5 Tf ${INK.join(" ")} rg ${MARGIN + 27.5} ${(doc.y + 0.5).toFixed(1)} Td (${level.value}) Tj ET`
          );
          doc.y += 8.5;
          doc.text(level.label, { size: 8.5, x: MARGIN + 42, after: 2.2 });
        }
        if (question.allowUnsure) {
          doc.ensure(13);
          doc.rect(MARGIN + 24, 12, 10.5, LIGHT, doc.y + 1);
          doc.y -= 8.5;
          doc.ops.push(
            `BT /F2 7.5 Tf ${GRAY.join(" ")} rg ${MARGIN + 27.5} ${(doc.y + 0.5).toFixed(1)} Td (?) Tj ET`
          );
          doc.y += 8.5;
          doc.text("Non so / non applicabile", {
            size: 8.5,
            font: "O",
            color: GRAY,
            x: MARGIN + 42,
            after: 2.2,
          });
        }
      }
      for (const option of options) {
        doc.ensure(13);
        doc.text(`•  ${option.label}`, { size: 8.5, x: MARGIN + 30, after: 2.2 });
      }
      if (question.answerType === "text") {
        doc.text("Spazio per una risposta libera.", {
          size: 8,
          font: "O",
          color: GRAY,
          x: MARGIN + 24,
          after: 2,
        });
      }
      doc.spacer(7);
    }
    doc.spacer(4);
  }

  doc.spacer(4);
  doc.hr();
  doc.text("* risposta obbligatoria", { size: 7.5, color: GRAY });

  return doc.finalize(`${payload.displayName} · ${payload.trackTitle} · ${dateLabel}`);
}

// ─── Excel ──────────────────────────────────────────────────────────────────

const XL_INK = "1A1F2E";
const XL_ACCENT = "067A6E";
const XL_LIGHT = "F1F5F4";
const XL_GRAY = "6B7280";

type Cell = {
  v: string;
  s?: Record<string, unknown>;
};

function headerCell(v: string): Cell {
  return {
    v,
    s: {
      font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10, name: "Calibri" },
      fill: { fgColor: { rgb: XL_INK } },
      alignment: { vertical: "center", wrapText: true },
      border: { bottom: { style: "thin", color: { rgb: XL_INK } } },
    },
  };
}

function sectionCell(v: string): Cell {
  return {
    v,
    s: {
      font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10, name: "Calibri" },
      fill: { fgColor: { rgb: XL_ACCENT } },
      alignment: { vertical: "center" },
    },
  };
}

function bodyCell(v: string, opts: { bold?: boolean; gray?: boolean; band?: boolean; center?: boolean } = {}): Cell {
  return {
    v,
    s: {
      font: {
        bold: opts.bold ?? false,
        sz: 9.5,
        name: "Calibri",
        color: { rgb: opts.gray ? XL_GRAY : XL_INK },
      },
      ...(opts.band ? { fill: { fgColor: { rgb: XL_LIGHT } } } : {}),
      alignment: {
        vertical: "top",
        wrapText: true,
        ...(opts.center ? { horizontal: "center" } : {}),
      },
      border: { bottom: { style: "thin", color: { rgb: "E5E7EB" } } },
    },
  };
}

export function buildQuestionDocXlsx(payload: QuestionDocPayload) {
  const def = payload.definition;
  const wb = XLSXStyle.utils.book_new();

  // ── Copertina ──
  const scored = def.questions.filter((q) => q.answerType !== "text").length;
  const coverRows: Cell[][] = [
    [],
    [
      {
        v: payload.trackTitle,
        s: { font: { bold: true, sz: 20, color: { rgb: XL_INK }, name: "Calibri" } },
      },
    ],
    [{ v: payload.trackSubtitle, s: { font: { sz: 11, color: { rgb: XL_GRAY }, name: "Calibri" } } }],
    [],
    [bodyCell("Assessment", { bold: true }), bodyCell(payload.assessmentName)],
    [bodyCell("Organizzazione", { bold: true }), bodyCell(payload.displayName)],
    [
      bodyCell("Domande", { bold: true }),
      bodyCell(`${scored} a punteggio + ${def.questions.length - scored} aperte`),
    ],
    [
      bodyCell("Raccolta", { bold: true }),
      bodyCell(payload.anonymous ? "Anonima (risultati aggregati)" : "Nominativa (risultati aggregati)"),
    ],
    [
      bodyCell("Generato il", { bold: true }),
      bodyCell(payload.generatedAt.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })),
    ],
    [],
    [
      bodyCell(
        "Scala di risposta: per ogni domanda a punteggio si sceglie il livello 1-5 che descrive meglio la situazione (ogni livello e spiegato nel foglio Domande). E sempre disponibile l'opzione «Non so / non applicabile».",
        { gray: true }
      ),
    ],
  ];
  const cover = XLSXStyle.utils.aoa_to_sheet(coverRows);
  cover["!cols"] = [{ wch: 20 }, { wch: 70 }];
  cover["!merges"] = [
    { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
    { s: { r: 10, c: 0 }, e: { r: 10, c: 1 } },
  ];
  XLSXStyle.utils.book_append_sheet(wb, cover, "Copertina");

  // ── Domande ──
  const header = [
    "N.",
    "Sezione",
    "Domanda",
    "Aiuto / esempio",
    "Tipo",
    "Obblig.",
    "Livello 1",
    "Livello 2",
    "Livello 3",
    "Livello 4",
    "Livello 5",
    "Opzioni (scelta singola)",
  ];
  const rows: Cell[][] = [header.map(headerCell)];
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
  let n = 0;
  let r = 1;
  for (const section of def.sections) {
    const pillar = def.pillars.find((p) => p.id === section.pillarId);
    const questions = def.questions.filter((q) => q.sectionId === section.id);
    if (questions.length === 0) continue;
    rows.push([sectionCell(`${pillar?.title ?? ""} — ${section.title}`)]);
    merges.push({ s: { r, c: 0 }, e: { r, c: header.length - 1 } });
    r += 1;
    for (const question of questions) {
      n += 1;
      const band = n % 2 === 0;
      const levels = [1, 2, 3, 4, 5].map(
        (v) => question.levels?.find((l) => l.value === v)?.label ?? ""
      );
      rows.push([
        bodyCell(String(n), { bold: true, band, center: true }),
        bodyCell(section.title, { gray: true, band }),
        bodyCell(question.label, { bold: true, band }),
        bodyCell(question.description ?? "", { gray: true, band }),
        bodyCell(typeLabel(question.answerType), { band, center: true }),
        bodyCell(question.required ? "Si" : "No", { band, center: true }),
        ...levels.map((label) => bodyCell(label, { band })),
        bodyCell(
          (question.options ?? []).map((o) => `• ${o.label}`).join("\n"),
          { band }
        ),
      ]);
      r += 1;
    }
  }
  const sheet = XLSXStyle.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 4 },
    { wch: 20 },
    { wch: 44 },
    { wch: 36 },
    { wch: 12 },
    { wch: 7 },
    { wch: 26 },
    { wch: 26 },
    { wch: 26 },
    { wch: 26 },
    { wch: 26 },
    { wch: 44 },
  ];
  sheet["!rows"] = [{ hpt: 26 }];
  sheet["!merges"] = merges;
  XLSXStyle.utils.book_append_sheet(wb, sheet, "Domande");

  return XLSXStyle.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
