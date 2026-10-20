import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { buildPdf, buildRawPdf, pdfPage, pdfString, pdfTextContent, type PdfStreamEncoding, type RawPdfObject } from "./fixtures.ts";
import { PDF_LIMITS, extractPdfText, glyphToUnicode, looksLikePdf, type PdfText } from "./pdf-text.ts";

// Invented text only: no client data.
const PARAGRAPH = "Il documento descrive le regole di pianificazione dei voli e il calcolo dei margini per ogni tratta prevista";
const LONG_LINES = Array.from({ length: 6 }, (_, i) => `${PARAGRAPH} (riga ${i + 1}).`);
const HELVETICA = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

function extract(bytes: Uint8Array): PdfText {
  const result = extractPdfText(bytes);
  assert.ok(result.ok, result.ok ? "" : `${result.code}: ${result.message}`);
  return result.value;
}

function code(bytes: Uint8Array, limits = PDF_LIMITS): string | undefined {
  const result = extractPdfText(bytes, limits);
  return result.ok ? undefined : result.code;
}

/** One page, font F1 = Helvetica, and the given content stream. */
function onePage(content: string, encoding: PdfStreamEncoding = "flate", extra: RawPdfObject[] = [], resources = "<< /Font << /F1 3 0 R >> >>"): Buffer {
  return buildRawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    HELVETICA,
    pdfPage(2, 5, resources),
    { dict: "", data: content, encoding },
    ...extra,
  ]);
}

test("only bytes starting with %PDF- are PDFs", () => {
  assert.equal(looksLikePdf(Buffer.from("%PDF-1.7")), true);
  assert.equal(looksLikePdf(Buffer.from("%!PS-Adobe")), false);
  assert.equal(code(Buffer.from("not a pdf")), "pdf_non_valido");
  assert.equal(code(Buffer.from("%PDF-1.7\n%%EOF\n")), "pdf_non_valido");
});

test("text in FlateDecode content streams is extracted line by line", () => {
  const text = extract(buildPdf([{ content: pdfTextContent(LONG_LINES) }, { content: pdfTextContent(["Seconda pagina del documento"]) }]));
  assert.equal(text.pages, 2);
  assert.match(text.text, /pianificazione dei voli e il calcolo dei margini/);
  assert.match(text.text, /\(riga 1\)\.\n.*\(riga 2\)/);
  assert.match(text.text, /Seconda pagina del documento/);
  assert.ok(text.letters > 400);
  assert.equal(text.nonPrintableRatio, 0);
  assert.equal(text.lowText, false);
  assert.deepEqual(text.reasons, []);
});

test("literal string escapes, octal codes and nested parentheses are decoded", () => {
  const content = `BT /F1 12 Tf 72 700 Td (Parentesi \\(annidate\\) e (vere) \\\\ barra \\101\\102 fine) Tj ET`;
  const text = extract(onePage(content));
  assert.match(text.text, /Parentesi \(annidate\) e \(vere\) \\ barra AB fine/);
});

test("TJ arrays keep words together and turn wide gaps into spaces", () => {
  const content = "BT /F1 12 Tf 72 700 Td [(Pia) -15 (nifica) 20 (zione) -400 (del) -300 (volo)] TJ ET";
  const text = extract(onePage(content));
  assert.match(text.text, /Pianificazione del volo/);
});

test("Td and Tm moves become spaces or new lines", () => {
  const content = "BT /F1 12 Tf 72 700 Td (Prima parte) Tj 120 0 Td (seconda parte) Tj 0 -14 Td (riga sotto) Tj 1 0 0 1 72 600 Tm (molto sotto) Tj ET";
  const text = extract(onePage(content));
  assert.match(text.text, /Prima parte seconda parte\nriga sotto\nmolto sotto/);
});

test("every supported stream filter is decoded", () => {
  const content = pdfTextContent(["Filtro di prova con parole", "seconda riga del filtro"]);
  for (const encoding of ["none", "flate", "raw-deflate", "ahx-flate", "lzw", "a85", "rl", "png-up"] as const) {
    const text = extract(onePage(content, encoding));
    assert.match(text.text, /Filtro di prova con parole\nseconda riga del filtro/, encoding);
    assert.deepEqual(
      text.reasons.filter((r) => r !== "poche_lettere"),
      [],
      encoding,
    );
  }
});

test("a wrong /Length falls back to endstream", () => {
  const pdf = buildRawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    HELVETICA,
    pdfPage(2, 5, "<< /Font << /F1 3 0 R >> >>"),
    { dict: "", data: pdfTextContent(["Lunghezza sbagliata ma testo leggibile"]), encoding: "none", declaredLength: 7 },
  ]);
  assert.match(extract(pdf).text, /Lunghezza sbagliata ma testo leggibile/);
});

test("ToUnicode CMaps decode two-byte Identity-H fonts", () => {
  // bfrange maps 0x0041..0x005A to A..Z, bfchar maps the rest used below.
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
3 beginbfchar <0003> <0020> <0101> <00E8> <0102> <0061>
endbfchar
2 beginbfrange <0041> <005A> <0041> <0061> <0063> [<0062> <0063> <0064>]
endbfrange endcmap CMapName currentdict /CMap defineresource pop end end`;
  const hex = (codes: number[]) => `<${codes.map((c) => c.toString(16).padStart(4, "0")).join("")}>`;
  const word = (s: string) =>
    [...s].map((ch) => (ch === " " ? 3 : ch === "è" ? 0x101 : ch === "a" ? 0x102 : ch >= "A" && ch <= "Z" ? ch.charCodeAt(0) : 0x61 + "bcd".indexOf(ch)));
  const content = `BT /F2 12 Tf 72 700 Td ${hex(word("VISITA MEDICA"))} Tj 0 -14 Td ${hex(word("PERCHè abcd"))} Tj ET`;
  const pdf = buildRawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /Inventato /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 6 0 R >>",
    pdfPage(2, 5, "<< /Font << /F2 3 0 R >> >>"),
    { dict: "", data: content },
    { dict: "", data: cmap },
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Inventato >>",
  ]);
  const text = extract(pdf);
  assert.match(text.text, /VISITA MEDICA\nPERCHè abcd/);
  assert.equal(text.undecodableGlyphs, 0);
});

test("a two-byte font without ToUnicode cannot be read and asks for review", () => {
  const glyphs = `<${"0041".repeat(300)}>`;
  const pdf = buildRawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /Inventato /Encoding /Identity-H >>",
    pdfPage(2, 5, "<< /Font << /F2 3 0 R >> >>"),
    { dict: "", data: `BT /F2 12 Tf 72 700 Td ${glyphs} Tj ET` },
  ]);
  const text = extract(pdf);
  assert.equal(text.undecodableGlyphs, 300);
  assert.equal(text.lowText, true);
  assert.ok(text.reasons.includes("font_senza_mappa"));
  assert.ok(text.reasons.includes("caratteri_non_stampabili"));
});

test("Differences arrays map glyph names to Unicode", () => {
  assert.equal(glyphToUnicode("egrave"), "è");
  assert.equal(glyphToUnicode("Agrave"), "À");
  assert.equal(glyphToUnicode("uni00E8"), "è");
  assert.equal(glyphToUnicode("u1F600"), "😀");
  assert.equal(glyphToUnicode("f_i"), "fi");
  assert.equal(glyphToUnicode("a.sc"), "a");
  assert.equal(glyphToUnicode("constructor"), null);
  assert.equal(glyphToUnicode("g17"), null);
  const font = "<< /Type /Font /Subtype /Type1 /BaseFont /Inventato /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [1 /egrave /uni00E0 /g17] >> >>";
  const pdf = buildRawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    font,
    pdfPage(2, 5, "<< /Font << /F1 3 0 R >> >>"),
    { dict: "", data: "BT /F1 12 Tf 72 700 Td (perch\\001 citt\\002 \\003) Tj ET" },
  ]);
  const text = extract(pdf);
  assert.match(text.text, /perchè città �/);
  assert.equal(text.undecodableGlyphs, 1);
});

test("form XObjects, annotations and unused content streams are read too", () => {
  const pdf = buildRawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    HELVETICA,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /XObject << /Fm1 6 0 R >> >> /Contents 5 0 R /Annots [7 0 R] >>",
    { dict: "", data: "BT /F1 12 Tf 72 700 Td (Testo della pagina) Tj ET q /Fm1 Do Q" },
    { dict: "/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /Font << /F1 3 0 R >> >>", data: "BT /F1 10 Tf 10 10 Td (Testo dentro il modulo) Tj ET" },
    `<< /Type /Annot /Subtype /Text /Rect [0 0 10 10] /Contents ${pdfString("Nota a margine inventata")} >>`,
    { dict: "", data: "BT /F1 10 Tf 10 10 Td (Testo nascosto mai usato) Tj ET" },
    `<< /Type /Annot /Subtype /Widget /FT /Sig /V 10 0 R >>`,
    `<< /Type /Sig /Contents <${"ff".repeat(64)}> /ByteRange [0 1 2 3] >>`,
  ]);
  const text = extract(pdf);
  assert.match(text.text, /Testo della pagina/);
  assert.match(text.text, /Testo dentro il modulo/);
  assert.match(text.text, /Nota a margine inventata/);
  assert.match(text.text, /Testo nascosto mai usato/);
  assert.equal(text.text.includes("ÿ"), false);
});

test("objects inside object streams are found", () => {
  // Objects 3 (font) and 4 (page) live in the object stream 6.
  const inner = [HELVETICA, pdfPage(2, 5, "<< /Font << /F1 3 0 R >> >>")];
  let header = "";
  let body = "";
  inner.forEach((obj, i) => {
    header += `${i + 3} ${body.length} `;
    body += `${obj}\n`;
  });
  const objstm = `${header}\n${body}`;
  const pdf = buildRawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "null",
    "null",
    { dict: "", data: pdfTextContent(["Testo con oggetti compressi"]) },
    { dict: `/Type /ObjStm /N 2 /First ${header.length + 1}`, data: objstm },
  ]);
  // The placeholders 3 and 4 are null at the top level: remove them so the object stream wins.
  const cleaned = Buffer.from(pdf.toString("latin1").replace("3 0 obj\nnull\nendobj\n", "").replace("4 0 obj\nnull\nendobj\n", ""), "latin1");
  const text = extract(cleaned);
  // The page itself comes from the object stream: without it there would be no page at all.
  assert.equal(text.pages, 1);
  assert.match(text.text, /Testo con oggetti compressi/);
});

test("few letters, scanned pages and glyph-by-glyph text ask for manual review", () => {
  const short = extract(buildPdf([{ content: pdfTextContent(["Solo poche parole"]) }]));
  assert.equal(short.lowText, true);
  assert.deepEqual(short.reasons, ["poche_lettere"]);

  const scan = buildRawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R 7 0 R] /Count 2 >>",
    HELVETICA,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    { dict: "", data: pdfTextContent(LONG_LINES) },
    { dict: "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode", data: "\xff\xd8\xff\xe0", encoding: "none" },
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 6 0 R >> >> /Contents 8 0 R >>",
    { dict: "", data: "q 595 0 0 842 0 0 cm /Im1 Do Q" },
  ]);
  const scanned = extract(scan);
  assert.equal(scanned.imagePagesWithoutText, 1);
  assert.deepEqual(scanned.reasons, ["pagine_immagine"]);

  const glyphs = [...LONG_LINES.join(" ")].map((ch, i) => `${pdfString(ch)} Tj ${i % 80 === 79 ? "0 -14" : "6 0"} Td`).join("\n");
  const fragmented = extract(onePage(`BT /F1 12 Tf 72 700 Td\n${glyphs}\nET`));
  assert.ok(fragmented.reasons.includes("testo_frammentato"));
  assert.equal(fragmented.lowText, true);
});

test("inline images are skipped even when their bytes look like operators", () => {
  const binary = "(Testo finto) Tj ET BT";
  const content = `BT /F1 12 Tf 72 700 Td (Prima) Tj ET\nBI /W 4 /H 4 /BPC 8 /CS /G ID ${binary} EI\nBT /F1 12 Tf 72 680 Td (Dopo) Tj ET`;
  const text = extract(onePage(content));
  assert.match(text.text, /Prima\nDopo/);
  assert.equal(text.text.includes("Testo finto"), false);
});

test("unsupported filters on page content ask for review", () => {
  const pdf = buildRawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    HELVETICA,
    pdfPage(2, 5, "<< /Font << /F1 3 0 R >> >>"),
    { dict: "/Filter /InventatoDecode", data: "xxxx", encoding: "none" },
  ]);
  const text = extract(pdf);
  assert.ok(text.reasons.includes("flussi_non_leggibili"));
});

test("encrypted PDFs, scripts and attachments are refused", () => {
  const encrypted = buildRawPdf(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [] /Count 0 >>", "<< /Filter /Standard /V 2 /R 3 >>"], {
    trailer: "/Encrypt 3 0 R",
  });
  assert.equal(code(encrypted), "pdf_cifrato");
  assert.equal(code(buildPdf([{ content: pdfTextContent(["x"]) }], { encrypt: true })), "pdf_cifrato");

  const script = onePage(pdfTextContent(LONG_LINES), "flate", [`<< /S /JavaScript /JS ${pdfString("app.alert(1)")} >>`]);
  assert.equal(code(script), "contenuto_attivo");
  const launch = onePage(pdfTextContent(LONG_LINES), "flate", ["<< /S /Launch /F (calc.exe) >>"]);
  assert.equal(code(launch), "contenuto_attivo");
  const attachment = onePage(pdfTextContent(LONG_LINES), "flate", ["<< /Type /Filespec /F (dati.csv) /EF << /F 7 0 R >> >>", { dict: "/Type /EmbeddedFile", data: "a;b\n1;2\n" }]);
  assert.equal(code(attachment), "oggetto_incorporato");
});

test("decompression bombs and budgets are enforced", () => {
  const zeros = Buffer.alloc(5 * 1024 * 1024);
  assert.ok(deflateSync(zeros).length < 64 * 1024);
  const bomb = onePage(pdfTextContent(LONG_LINES), "flate", [{ dict: "", data: zeros }]);
  assert.equal(code(bomb), "pdf_bomba");

  const pdf = buildPdf([{ content: pdfTextContent(LONG_LINES) }, { content: pdfTextContent(LONG_LINES) }]);
  assert.equal(code(pdf, { ...PDF_LIMITS, maxTotalDecodedBytes: 1000 }), "pdf_troppo_grande");
  assert.equal(code(pdf, { ...PDF_LIMITS, maxStreams: 1 }), "pdf_troppi_flussi");
  assert.equal(PDF_LIMITS.maxStreams, 2000);
  assert.equal(PDF_LIMITS.maxTotalDecodedBytes, 50 * 1024 * 1024);
  assert.equal(PDF_LIMITS.maxRatio, 100);
});

test("more than 2,000 streams are refused", () => {
  const extra: RawPdfObject[] = Array.from({ length: 2001 }, () => ({ dict: "", data: "x", encoding: "none" as const }));
  assert.equal(code(onePage(pdfTextContent(["x"]), "flate", extra)), "pdf_troppi_flussi");
});

test("deep nesting does not crash the parser", () => {
  const deep = `${"[".repeat(5000)}${"]".repeat(5000)}`;
  const pdf = onePage(pdfTextContent(LONG_LINES), "flate", [deep]);
  assert.match(extract(pdf).text, /pianificazione/);
});

test("the text limit truncates instead of growing without bounds", () => {
  const result = extractPdfText(buildPdf([{ content: pdfTextContent(LONG_LINES) }]), { ...PDF_LIMITS, maxTextChars: 50 });
  assert.ok(result.ok);
  assert.equal(result.value.truncated, true);
  assert.ok(result.value.text.length <= 50);
  assert.ok(result.value.reasons.includes("testo_troncato"));
  assert.equal(result.value.lowText, true);
});

test("unterminated strings cannot make the structure scan quadratic", () => {
  // Every object is followed by a string that never closes: before the work budget each
  // object re-read the rest of the file (seconds at 200 KB, hours at 4 MB).
  const cases = [
    `%PDF-1.4\n${"1 0 obj 1 (\n".repeat(400_000)}`,
    `%PDF-1.4\n1 0 obj << >> endobj\n${"trailer (\n".repeat(400_000)}`,
  ];
  for (const source of cases) {
    const started = Date.now();
    const result = extractPdfText(Buffer.from(source, "latin1"));
    assert.ok(Date.now() - started < 3_000, "linear time");
    assert.equal(result.ok ? "ok" : result.code, "pdf_troppi_flussi");
  }
  // A single unterminated string is read once and the file is still processed.
  assert.notEqual(code(Buffer.from(`%PDF-1.4\n${"1 0 obj (\n".repeat(400_000)}`, "latin1")), "pdf_troppi_flussi");
});

test("objects inside an object stream stop where the next object starts", () => {
  // Object 3 is a string that never closes: it must not swallow object 4 (the page).
  const inner = ["(senza chiusura", pdfPage(2, 5, "<< /Font << /F1 6 0 R >> >>")];
  let header = "";
  let body = "";
  inner.forEach((obj, i) => {
    header += `${i + 3} ${body.length} `;
    body += `${obj}\n`;
  });
  const pdf = buildRawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "null",
    "null",
    { dict: "", data: pdfTextContent(["Testo con oggetti compressi e una stringa aperta"]) },
    HELVETICA,
    { dict: `/Type /ObjStm /N 2 /First ${header.length + 1}`, data: `${header}\n${body}` },
  ]);
  const cleaned = Buffer.from(pdf.toString("latin1").replace("3 0 obj\nnull\nendobj\n", "").replace("4 0 obj\nnull\nendobj\n", ""), "latin1");
  const text = extract(cleaned);
  assert.equal(text.pages, 1);
  assert.match(text.text, /stringa aperta/);
});
