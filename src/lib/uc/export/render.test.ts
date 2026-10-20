import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import * as XLSX from "xlsx";
import { buildCatalogSnapshot, snapshotForViewer, type CatalogSnapshot } from "../snapshot.ts";
import { answer, item, sampleInput } from "../snapshot.fixtures.ts";
import { encodeForTransfer, parseStoredSnapshot, renderCatalogExport, withoutPersonalValues } from "./render.ts";

function snap(over: Parameters<typeof sampleInput>[0] = {}): CatalogSnapshot {
  const r = buildCatalogSnapshot(sampleInput(over));
  assert.ok(r.ok);
  return r.value;
}

const CASE = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** Una fotografia manomessa: un valore personale finito dentro per errore. */
function tampered(): CatalogSnapshot {
  const s = snap();
  return {
    ...s,
    items: s.items.map((i) =>
      i.key === "q.esempio.04" && i.answer ? { ...i, answer: { ...i.answer, value: { text: "dato personale inventato" }, value_hidden: undefined } } : i,
    ),
  };
}

test("JSON export is the snapshot itself, pretty printed, without personal values", () => {
  const file = renderCatalogExport(snap(), "json");
  assert.equal(file.contentType, "application/json; charset=utf-8");
  assert.equal(file.fileName, "es-uc-01-catalogo-v1.json");
  const parsed = JSON.parse(decode(file.body)) as CatalogSnapshot;
  assert.equal(parsed.schema, "unbundle.uc-catalog/1");
  assert.equal(parsed.version, 1);
  assert.equal(parsed.items.length, 10);
  assert.equal(parsed.items.find((i) => i.key === "q.esempio.04")?.answer?.value_hidden, "personale");
  assert.ok(!decode(file.body).includes("dato personale inventato"));
});

test("personal values never leave, even from a tampered snapshot or an unknown privacy class", () => {
  const raw = tampered();
  assert.ok(JSON.stringify(raw).includes("dato personale inventato"));
  for (const format of ["json", "md", "xlsx"] as const) {
    const file = renderCatalogExport(raw, format);
    const text = format === "xlsx" ? JSON.stringify(XLSX.read(file.body, { type: "array" }).Sheets) : decode(file.body);
    assert.ok(!text.includes("dato personale inventato"), format);
  }
  const unknown: CatalogSnapshot = {
    ...raw,
    items: raw.items.map((i) => (i.key === "q.esempio.01" ? { ...i, privacy_class: "classe_nuova" as never } : i)),
  };
  const cleaned = withoutPersonalValues(unknown).items.find((i) => i.key === "q.esempio.01");
  assert.equal(cleaned?.answer?.value, null);
  assert.equal(cleaned?.answer?.value_hidden, "personale");
});

test("Markdown export: the draft marks items that are not in place", () => {
  const draft = renderCatalogExport(snap({ version: "bozza", frozenAt: null }), "md");
  assert.equal(draft.contentType, "text/markdown; charset=utf-8");
  assert.equal(draft.fileName, "es-uc-01-catalogo-bozza.md");
  assert.match(decode(draft.body), /Da verificare \(non validata\)/);
  const frozen = renderCatalogExport(snap(), "md");
  assert.ok(!decode(frozen.body).includes("non validata"));
});

test("Excel export: five sheets, formula-safe cells, role filter applied before", () => {
  const forClient = snapshotForViewer(snap(), { roles: ["owner_cliente"] });
  const file = renderCatalogExport(forClient, "xlsx");
  assert.equal(file.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(file.fileName, "es-uc-01-catalogo-v1.xlsx");
  assert.deepEqual([...file.body.slice(0, 2)], [0x50, 0x4b], "zip container");
  const wb = XLSX.read(file.body, { type: "array" });
  assert.deepEqual(wb.SheetNames, ["Catalogo", "Dizionario dati", "Regole", "KPI", "Gate"]);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Catalogo);
  assert.equal(rows.length, 10);
  assert.equal(rows.find((r) => r.ID === "q.esempio.05")?.Valore, "(nascosto per il tuo ruolo)");
  assert.equal(rows.find((r) => r.ID === "q.esempio.01")?.Valore, "120 EUR, IVA esclusa, per ora");
  for (const ws of Object.values(wb.Sheets)) {
    for (const [ref, cell] of Object.entries(ws)) {
      if (ref.startsWith("!")) continue;
      assert.ok(!(cell as { f?: string }).f, `no formulas (${ref})`);
    }
  }

  const forLs = renderCatalogExport(snap(), "xlsx");
  const lsRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.read(forLs.body, { type: "array" }).Sheets.Catalogo);
  assert.equal(lsRows.find((r) => r.ID === "q.esempio.05")?.Valore, "'=SOMMA(A1)");
});

test("a stored version must be the requested one, of the same case and workspace", () => {
  const s = snap();
  const asStored = JSON.parse(JSON.stringify(s)) as unknown;
  const parsed = parseStoredSnapshot(asStored, { caseId: CASE, workspaceId: WS, version: 1 });
  assert.ok(parsed.ok);
  assert.equal(parsed.value.items.length, 10);
  assert.ok(parseStoredSnapshot(JSON.stringify(s), { caseId: CASE, workspaceId: WS, version: 1 }).ok, "jsonb as text");

  const refusals: [unknown, { caseId: string; workspaceId: string; version: number }][] = [
    [asStored, { caseId: "99999999-9999-4999-8999-999999999999", workspaceId: WS, version: 1 }],
    [asStored, { caseId: CASE, workspaceId: "99999999-9999-4999-8999-999999999999", version: 1 }],
    [asStored, { caseId: CASE, workspaceId: WS, version: 2 }],
    [{ ...s, schema: "altro/1" }, { caseId: CASE, workspaceId: WS, version: 1 }],
    [{ ...s, items: [{ key: 1 }] }, { caseId: CASE, workspaceId: WS, version: 1 }],
    [{ ...s, items: [{ ...s.items[0], answer: "x" }] }, { caseId: CASE, workspaceId: WS, version: 1 }],
    [{ ...s, frozen_at: null }, { caseId: CASE, workspaceId: WS, version: 1 }],
    ["{not json", { caseId: CASE, workspaceId: WS, version: 1 }],
    [null, { caseId: CASE, workspaceId: WS, version: 1 }],
  ];
  for (const [raw, expect] of refusals) {
    const r = parseStoredSnapshot(raw, expect);
    assert.equal(r.ok ? "" : r.code, "versione_illeggibile");
  }
  const leaked = parseStoredSnapshot(JSON.parse(JSON.stringify(tampered())), { caseId: CASE, workspaceId: WS, version: 1 });
  assert.ok(leaked.ok);
  assert.ok(!JSON.stringify(leaked.value).includes("dato personale inventato"));
});

test("a draft from live items keeps current answers marked as not validated", () => {
  const input = sampleInput({ version: "bozza", frozenAt: null });
  const s = snap({ ...input, items: [...input.items, item({ key: "q.esempio.10", status: "in_verifica", currentAnswer: answer({ value: { text: "Valore nuovo" } }) })] });
  const file = renderCatalogExport(s, "json");
  const parsed = JSON.parse(decode(file.body)) as CatalogSnapshot;
  assert.equal(parsed.version, "bozza");
  assert.equal(parsed.items.find((i) => i.key === "q.esempio.10")?.answer?.validated, false);
});

test("transfer encoding: gzip for large text exports when the browser accepts it, never for Excel", () => {
  const big = { body: new TextEncoder().encode(JSON.stringify({ x: "a".repeat(100_000) })), contentType: "application/json; charset=utf-8", fileName: "x.json" };
  const gz = encodeForTransfer(big, "gzip, deflate, br");
  assert.equal(gz.contentEncoding, "gzip");
  assert.ok(gz.body.byteLength < big.body.byteLength / 10);
  assert.deepEqual(new Uint8Array(gunzipSync(gz.body)), big.body);
  assert.equal(encodeForTransfer(big, null).contentEncoding, null);
  assert.equal(encodeForTransfer(big, "br").contentEncoding, null);
  assert.equal(encodeForTransfer(big, "gzip;q=0, br").contentEncoding, null);
  assert.equal(encodeForTransfer(big, "GZIP;q=0.5").contentEncoding, "gzip");
  const small = renderCatalogExport(snap(), "md");
  assert.equal(encodeForTransfer(small, "gzip").contentEncoding, null);
  const xlsx = { ...big, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  assert.equal(encodeForTransfer(xlsx, "gzip").contentEncoding, null);
});
