import test from "node:test";
import assert from "node:assert/strict";
import type { CaseRole } from "../vocab.ts";
import {
  DRAFT_AFTER_VIA_MESSAGE,
  attachmentDisposition,
  catalogExportHref,
  clientDraftBeforeVia,
  exportAllowed,
  exportChoices,
  exportFileName,
  exportFormatAllowed,
  parseExportQuery,
} from "./request.ts";

const WS = "22222222-2222-4222-8222-222222222222";
const CASE = "11111111-1111-4111-8111-111111111111";

function q(query: string) {
  return parseExportQuery(new URLSearchParams(query));
}

test("export query: JSON and the latest frozen version by default, bozza and numbers on request", () => {
  assert.deepEqual(q(""), { ok: true, value: { format: "json", version: { kind: "ultima" } } });
  assert.deepEqual(q("format=XLSX&version=3"), { ok: true, value: { format: "xlsx", version: { kind: "numero", version: 3 } } });
  assert.deepEqual(q("format=md&version=bozza"), { ok: true, value: { format: "md", version: { kind: "bozza" } } });
  const pdf = q("format=pdf");
  assert.equal(pdf.ok ? "" : pdf.code, "formato_non_valido");
  for (const bad of ["0", "-1", "1.5", "v2", "1234567", "bozza;drop"]) {
    const r = q(`version=${encodeURIComponent(bad)}`);
    assert.equal(r.ok, false, bad);
    if (!r.ok) assert.equal(r.code, "versione_non_valida");
  }
});

test("who exports what: frozen versions for the validated roles, the draft for Lateral Space (no catalog version given)", () => {
  const frozen = { kind: "ultima" } as const;
  const numbered = { kind: "numero", version: 2 } as const;
  const draft = { kind: "bozza" } as const;
  const cases: [CaseRole[], boolean, boolean][] = [
    [["ls_lead"], true, true],
    [["ls_analista"], true, true],
    [["ls_sviluppatore"], true, false],
    [["owner_cliente"], true, false],
    [["approvatore_privacy"], false, false],
    [["ai_board"], false, false],
    [["osservatore"], false, false],
    [[], false, false],
  ];
  for (const [roles, canFrozen, canDraft] of cases) {
    assert.equal(exportAllowed(roles, frozen).ok, canFrozen, `${roles.join(",")} frozen`);
    assert.equal(exportAllowed(roles, numbered).ok, canFrozen, `${roles.join(",")} numbered`);
    assert.equal(exportAllowed(roles, draft).ok, canDraft, `${roles.join(",")} draft`);
  }
  const refused = exportAllowed(["owner_cliente"], draft);
  assert.equal(refused.ok ? "" : refused.code, "bozza_non_ammessa");
  assert.deepEqual(exportChoices(["ls_sviluppatore"], 0), { validated: false, draft: false });
  assert.deepEqual(exportChoices(["ls_sviluppatore"], 2), { validated: true, draft: false });
  assert.deepEqual(exportChoices(["ls_lead"], 0), { validated: false, draft: true });
});

test("Esporta per ruolo: the client lead downloads the working draft before the via, the validated catalog after", () => {
  const draft = { kind: "bozza" } as const;
  // Before the via (no frozen version): the draft, never the validated catalog.
  assert.equal(exportAllowed(["owner_cliente"], draft, 0).ok, true);
  assert.deepEqual(exportChoices(["owner_cliente"], 0), { validated: false, draft: true });
  // After the via: the validated catalog only, with a plain message for the draft.
  const after = exportAllowed(["owner_cliente"], draft, 3);
  assert.equal(after.ok ? "" : after.code, "bozza_non_ammessa");
  assert.equal(after.ok ? "" : after.message, "Dopo il via allo sviluppo si scarica il catalogo validato.");
  assert.deepEqual(exportChoices(["owner_cliente"], 3), { validated: true, draft: false });
  // Lateral Space keeps the draft after the via; the developer and the other client roles never get it.
  assert.deepEqual(exportChoices(["ls_lead"], 3), { validated: true, draft: true });
  assert.deepEqual(exportChoices(["ls_analista"], 0), { validated: false, draft: true });
  for (const roles of [["ls_sviluppatore"], ["approvatore_privacy"], ["ai_board"], ["osservatore"], []] as CaseRole[][]) {
    const r = exportAllowed(roles, draft, 0);
    assert.equal(r.ok, false, roles.join(",") || "nessun ruolo");
    assert.equal(r.ok ? "" : r.message, "Il tuo ruolo non scarica la bozza del catalogo.");
  }
  assert.equal(DRAFT_AFTER_VIA_MESSAGE, "Dopo il via allo sviluppo si scarica il catalogo validato.");
  // The route asks the read to check the via only for the client lead asking for the draft.
  assert.equal(clientDraftBeforeVia(["owner_cliente"], draft), true);
  assert.equal(clientDraftBeforeVia(["owner_cliente"], { kind: "ultima" }), false);
  assert.equal(clientDraftBeforeVia(["ls_lead"], draft), false);
  assert.equal(clientDraftBeforeVia(["ls_sviluppatore"], draft), false);
});

test("formats per role: Lateral Space downloads JSON, Markdown and Excel, the client only Excel", () => {
  for (const format of ["json", "md", "xlsx"] as const) {
    assert.equal(exportFormatAllowed(["ls_lead"], format).ok, true, format);
    assert.equal(exportFormatAllowed(["ls_sviluppatore"], format).ok, true, format);
  }
  assert.equal(exportFormatAllowed(["owner_cliente"], "xlsx").ok, true);
  for (const format of ["json", "md"] as const) {
    const r = exportFormatAllowed(["owner_cliente"], format);
    assert.equal(r.ok ? "" : r.code, "formato_non_ammesso", format);
    assert.equal(r.ok ? "" : r.message, "Il catalogo si scarica in Excel.");
  }
});

test("file names are plain ASCII from the case code and the version", () => {
  assert.equal(exportFileName("ES-UC-01", 2, "xlsx"), "es-uc-01-catalogo-v2.xlsx");
  assert.equal(exportFileName("ES-UC-01", "bozza", "md"), "es-uc-01-catalogo-bozza.md");
  assert.equal(exportFileName("", 1, "json"), "caso-catalogo-v1.json");
  assert.equal(attachmentDisposition("es-uc-01-catalogo-v2.xlsx"), 'attachment; filename="es-uc-01-catalogo-v2.xlsx"');
  assert.equal(attachmentDisposition('a"b\r\n.json'), 'attachment; filename="a_b__.json"');
});

test("links point to the route handlers, with the version only when asked", () => {
  assert.equal(catalogExportHref(WS, CASE, { format: "xlsx" }), `/dashboard/${WS}/casi-duso/${CASE}/export?format=xlsx`);
  assert.equal(catalogExportHref(WS, CASE, { format: "md", version: "bozza" }), `/dashboard/${WS}/casi-duso/${CASE}/export?format=md&version=bozza`);
  assert.equal(catalogExportHref(WS, CASE, { format: "json", version: 3 }), `/dashboard/${WS}/casi-duso/${CASE}/export?format=json&version=3`);
});
