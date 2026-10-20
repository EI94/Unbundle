import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { buildCatalogSnapshot, snapshotForViewer, type CatalogSnapshot } from "../snapshot.ts";
import { answer, item, sampleInput } from "../snapshot.fixtures.ts";
import { findForbidden } from "../views/copy-guard.ts";
import { CLIENT_ANSWER_KINDS, clientCatalogSheets, renderClientCatalogExport, snapshotForClient } from "./client-catalog.ts";
import { renderCatalogExport } from "./render.ts";

/** The working draft of a case before the via, with every kind of current answer a referent can leave. */
function clientDraft(): CatalogSnapshot {
  const base = sampleInput();
  const r = buildCatalogSnapshot({
    ...base,
    version: "bozza",
    frozenAt: null,
    gate: { ...base.gate!, reviewId: null, decision: null, summaryTextHash: null },
    items: [
      ...base.items,
      item({
        key: "q.bozza.non_so",
        status: "mancante",
        statusReason: "Il referente ha risposto «Non lo so»",
        currentAnswer: answer({ kind: "non_so", value: { who_might_know: "Giulia del commerciale" }, createdAt: "2026-10-02T21:47:00.000Z" }),
      }),
      item({ key: "q.bozza.delega", status: "chiesta", currentAnswer: answer({ kind: "delega", value: { to: "un collega inventato" } }) }),
      item({ key: "q.bozza.na", status: "in_verifica", currentAnswer: answer({ kind: "proposta_na", value: { reason: "Motivo inventato del referente" } }) }),
      item({ key: "q.bozza.chiarimento", status: "in_verifica", currentAnswer: answer({ kind: "risposta_chiarimento", value: { text: "Chiarimento inventato" } }) }),
      item({
        key: "q.bozza.valore",
        status: "in_verifica",
        currentAnswer: answer({ kind: "valore", value: { text: "Trenta richieste al giorno" }, sourceKind: "referente", sourceRef: "contatto-inventato", confidence: "stima", createdAt: "2026-10-03T06:12:00.000Z", textHash: "c".repeat(64) }),
      }),
      item({ key: "q.bozza.solo_ls", status: "in_verifica", valueVisibility: "solo_ls", currentAnswer: answer({ value: { text: "Valore solo per Lateral Space" } }) }),
    ],
  });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

const SECRETS = ["Giulia del commerciale", "un collega inventato", "Motivo inventato del referente", "Chiarimento inventato", "Valore solo per Lateral Space", "contatto-inventato"];

test("the client lead's draft keeps only the values of valore, conferma and correzione answers, never who, when or where from", () => {
  const draft = clientDraft();
  // What the Lateral Space export would carry for the same draft: the leak this module closes.
  assert.ok(JSON.stringify(snapshotForViewer(draft, { roles: ["owner_cliente"] })).includes("Giulia del commerciale"));

  const c = snapshotForClient(snapshotForViewer(draft, { roles: ["owner_cliente"] }));
  assert.deepEqual(CLIENT_ANSWER_KINDS, ["valore", "conferma", "correzione"]);
  const byKey = new Map(c.items.map((i) => [i.key, i]));
  for (const key of ["q.bozza.non_so", "q.bozza.delega", "q.bozza.na", "q.bozza.chiarimento"]) assert.equal(byKey.get(key)?.answer, null, key);
  assert.deepEqual(byKey.get("q.bozza.valore")?.answer, { value: { text: "Trenta richieste al giorno" }, value_hidden: null });
  assert.deepEqual(byKey.get("q.bozza.solo_ls")?.answer, { value: null, value_hidden: "visibilita" });
  assert.deepEqual(byKey.get("q.esempio.04")?.answer, { value: null, value_hidden: "personale" });

  const json = JSON.stringify(c);
  for (const secret of SECRETS) assert.ok(!json.includes(secret), secret);
  for (const field of ["answered_at", "source_kind", "source_ref", "source_basis", "confidence", "text_hash", "status_reason", "valid_from", "explanation"]) {
    assert.ok(!json.includes(`"${field}"`), field);
  }
  assert.ok(!json.includes("2026-10-02T21:47"), "no answer time");
  assert.ok(!json.includes("Non lo so"));
});

test("the client's Excel: client status words, no provenance or answer version columns, the draft marked «non validata»", () => {
  const file = renderClientCatalogExport(snapshotForViewer(clientDraft(), { roles: ["owner_cliente"] }));
  assert.equal(file.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(file.fileName, "es-uc-01-catalogo-bozza.xlsx");
  const wb = XLSX.read(file.body, { type: "array" });
  assert.deepEqual(wb.SheetNames, ["Catalogo", "Dizionario dati", "Regole", "KPI", "Via allo sviluppo"]);
  const all = JSON.stringify(wb.Sheets);
  for (const secret of SECRETS) assert.ok(!all.includes(secret), secret);
  for (const column of ["Provenienza", "Versione risposta", "Valido dal", "Testo confermato (impronta)"]) assert.ok(!all.includes(column), column);
  assert.ok(!all.includes("Manca il dato"), "never the Lateral Space sub-state");
  assert.doesNotMatch(all, /"v":"referente"/, "never the source of an answer");

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Catalogo);
  const row = (key: string) => rows.find((r) => r.ID === key)!;
  assert.equal(row("q.bozza.non_so").Stato, "Da rispondere");
  assert.equal(row("q.bozza.non_so").Valore, "");
  assert.equal(row("q.bozza.non_so").Validazione, "non validata");
  assert.equal(row("q.bozza.valore").Valore, "Trenta richieste al giorno");
  assert.equal(row("q.bozza.valore").Stato, "In verifica");
  assert.equal(row("q.bozza.solo_ls").Valore, "(nascosto per il tuo ruolo)");
  assert.equal(row("q.esempio.02").Valore, "non si applica");
  assert.equal(row("q.esempio.02").Stato, "Non si applica");
  assert.equal(row("q.esempio.01").Validazione, "", "an item in place is not marked");
  assert.equal(row("q.esempio.01").Valore, "120 EUR, IVA esclusa, per ora");
  // Columns and fixed words read well for the client.
  const headers = new Set(Object.values(wb.Sheets).flatMap((ws) => Object.keys(XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)[0] ?? {})));
  for (const text of [...wb.SheetNames, ...headers, "non validata", "non si applica", "(nascosto per il tuo ruolo)", "(nascosto: dato personale)"]) {
    assert.deepEqual(findForbidden(text, "cliente"), [], text);
  }
});

test("the client sheet keeps the columns of Lateral Space that say nothing about the answers", () => {
  const forClient = snapshotForViewer(clientDraft(), { roles: ["owner_cliente"] });
  const ls = XLSX.read(renderCatalogExport(forClient, "xlsx").body, { type: "array" });
  const client = clientCatalogSheets(snapshotForClient(forClient));
  const answerColumns = new Set(["Provenienza", "Versione risposta", "Valido dal", "Testo confermato (impronta)"]);
  assert.deepEqual(
    Object.keys(client[4].rows[0]),
    ["Decisione", "Indispensabili", "A posto", "Deroghe", "Versione del catalogo", "Congelato il"],
    "the via without its code, rule or hash",
  );
  for (const sheet of client.slice(0, 4)) {
    const lsColumns = Object.keys(XLSX.utils.sheet_to_json<Record<string, unknown>>(ls.Sheets[sheet.name])[0] ?? {});
    const clientColumns = Object.keys(sheet.rows[0] ?? {});
    assert.deepEqual(
      clientColumns.filter((c) => c !== "Validazione"),
      lsColumns.filter((c) => !answerColumns.has(c) && c !== "Validazione"),
      sheet.name,
    );
  }
  // After the via the client gets the validated catalog with the same sheet, without the draft flag.
  const frozen = buildCatalogSnapshot(sampleInput());
  assert.ok(frozen.ok);
  const sheets = clientCatalogSheets(snapshotForClient(snapshotForViewer(frozen.value, { roles: ["owner_cliente"] })));
  assert.ok(sheets[0].rows.every((r) => !("Validazione" in r)));
  assert.doesNotMatch(JSON.stringify(sheets), /:"referente"/);
});
