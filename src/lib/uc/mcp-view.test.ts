import test from "node:test";
import assert from "node:assert/strict";
import {
  caseListView,
  dataDictionaryView,
  gateStatusView,
  openItemsView,
  redactTexts,
  textsHidden,
  validatedCatalogView,
  type GateComputationLike,
} from "./mcp-view.ts";
import { buildCatalogSnapshot, type CatalogSnapshot } from "./snapshot.ts";
import { answer, sampleInput } from "./snapshot.fixtures.ts";

function frozen(): CatalogSnapshot {
  const r = buildCatalogSnapshot(sampleInput());
  assert.ok(r.ok);
  return r.value;
}

const OPEN = { aiEnvironmentApproved: true, clientText: true };
const CLOSED = { aiEnvironmentApproved: false, clientText: true };
const CLOSED_NO_CLIENT_TEXT = { aiEnvironmentApproved: false, clientText: false };

test("texts are hidden only with the AI environment not approved and client texts", () => {
  assert.equal(textsHidden(OPEN), false);
  assert.equal(textsHidden(CLOSED), true);
  assert.equal(textsHidden(CLOSED_NO_CLIENT_TEXT), false);
});

test("the catalog view refuses drafts and missing versions", () => {
  assert.deepEqual(validatedCatalogView(null, OPEN), { ok: false, error: "nessuna_versione_congelata" });
  const draft = buildCatalogSnapshot(sampleInput({ version: "bozza", frozenAt: null }));
  assert.ok(draft.ok);
  assert.deepEqual(validatedCatalogView(draft.value, OPEN), { ok: false, error: "nessuna_versione_congelata" });
});

test("only validated or signed not-applicable items, with the excluded list", () => {
  const v = validatedCatalogView(frozen(), OPEN);
  assert.ok(v.ok);
  assert.equal(v.version, 1);
  assert.deepEqual(v.items.map((i) => i.key), ["q.esempio.01", "q.esempio.02", "q.esempio.04", "q.esempio.05", "richiesta.durata"]);
  for (const i of v.items) assert.ok(i.status === "validata" || i.status === "non_applicabile");
  assert.ok(v.excluded.some((e) => e.key === "q.esempio.03" && e.status === "in_verifica"));
  assert.ok(!v.excluded.some((e) => v.items.some((i) => i.key === e.key)));
  assert.equal(v.text_hidden, undefined);
  const durata = v.items.find((i) => i.key === "richiesta.durata");
  assert.deepEqual(durata?.links, [{ to: "ent.richiesta", relation: "deriva_da" }]);
  assert.equal(durata?.title, "Titolo di richiesta.durata");
});

test("personal values never leave; reserved values only with an approved environment", () => {
  const approved = validatedCatalogView(frozen(), OPEN);
  assert.ok(approved.ok);
  const personal = approved.items.find((i) => i.key === "q.esempio.04")?.answer;
  assert.equal(personal?.value, null);
  assert.equal(personal?.value_hidden, "personale");
  assert.deepEqual(approved.items.find((i) => i.key === "q.esempio.01")?.answer?.value_normalized, { amount_eur: 120 });

  const notApproved = validatedCatalogView(frozen(), CLOSED_NO_CLIENT_TEXT);
  assert.ok(notApproved.ok);
  const reserved = notApproved.items.find((i) => i.key === "q.esempio.01")?.answer;
  assert.equal(reserved?.value, null);
  assert.equal(reserved?.value_normalized, null);
  assert.equal(reserved?.value_hidden, "ambiente_non_approvato");
  // Classe «nessuna»: il valore esce anche senza ambiente approvato.
  assert.deepEqual(notApproved.items.find((i) => i.key === "richiesta.durata")?.answer?.value, { value: 42, unit: "min" });
  assert.ok(!JSON.stringify(notApproved).includes("dato personale inventato"));
});

test("with client texts and no approved environment, titles, explanations and prose disappear", () => {
  const v = validatedCatalogView(frozen(), CLOSED);
  assert.ok(v.ok);
  assert.equal(v.text_hidden, "ambiente_non_approvato");
  const json = JSON.stringify(v);
  for (const banned of ["Titolo di", "Spiegazione d'esempio", "Esempio inventato", "Dove trovarlo", "Non serve in questo esempio", "Valore d'esempio", "=SOMMA"]) {
    assert.ok(!json.includes(banned), `leaked: ${banned}`);
  }
  const durata = v.items.find((i) => i.key === "richiesta.durata");
  assert.equal(durata?.title, undefined);
  assert.deepEqual(durata?.spec, { tipo_dato: "numero", unita: "min", obbligatorio: true });
  // Il valore tipizzato resta, la prosa no.
  assert.deepEqual(durata?.answer?.value_normalized, { minutes: 42 });
  assert.equal(durata?.answer?.value, undefined);
  const prose = v.items.find((i) => i.key === "q.esempio.05")?.answer;
  assert.equal(prose?.value_hidden, "ambiente_non_approvato");
  // Un testo normalizzato resta prosa: non esce nemmeno come valore normalizzato.
  const input = sampleInput();
  const withText = buildCatalogSnapshot({
    ...input,
    items: input.items.map((i) =>
      i.key === "q.esempio.05"
        ? { ...i, valueVisibility: "owner_e_ls" as const, validatedAnswer: answer({ value: { text: "Prosa del cliente" }, valueNormalized: { text: "Prosa del cliente" } }) }
        : i,
    ),
  });
  assert.ok(withText.ok);
  const hiddenText = validatedCatalogView(withText.value, CLOSED);
  assert.ok(hiddenText.ok);
  assert.equal(hiddenText.items.find((i) => i.key === "q.esempio.05")?.answer?.value_hidden, "ambiente_non_approvato");
  assert.ok(!JSON.stringify(hiddenText).includes("Prosa del cliente"));
  const shownText = validatedCatalogView(withText.value, OPEN);
  assert.ok(shownText.ok);
  assert.deepEqual(shownText.items.find((i) => i.key === "q.esempio.05")?.answer?.value_normalized, { text: "Prosa del cliente" });
  // Restano chiavi, tipi, stati, versioni e collegamenti.
  assert.equal(durata?.kind, "campo");
  assert.equal(durata?.answer?.version, 2);
  assert.equal(durata?.links.length, 1);
});

test("kinds filter both items and the excluded list", () => {
  const v = validatedCatalogView(frozen(), { ...OPEN, kinds: ["campo"] });
  assert.ok(v.ok);
  assert.deepEqual(v.items.map((i) => i.key), ["richiesta.durata"]);
  assert.deepEqual(v.excluded.map((e) => e.key), ["richiesta.cliente"]);
});

test("open items carry role labels and due dates, sorted by module then key, never people", () => {
  const view = openItemsView(
    {
      items: [
        { key: "q.b.02", title: "Seconda", status: "mancante", moduleKey: "mod.b", roleKey: "operativo", dueAt: new Date("2026-10-10T00:00:00Z") },
        { key: "q.a.01", title: "Prima", status: "da_chiedere", moduleKey: "mod.a", roleKey: "direzione", dueAt: null, dueIsProposal: true },
      ],
      roleLabels: { operativo: "Operativo", direzione: "Direzione" },
    },
    OPEN,
  );
  assert.equal(view.count, 2);
  assert.deepEqual(view.items.map((i) => i.key), ["q.a.01", "q.b.02"]);
  assert.equal(view.items[0].role_label, "Direzione");
  assert.equal(view.items[0].due_is_proposal, true);
  assert.equal(view.items[1].due_at, "2026-10-10T00:00:00.000Z");
  const hidden = openItemsView({ items: [{ key: "q.a.01", title: "Prima", status: "chiesta", moduleKey: null, roleKey: "x", dueAt: null }], roleLabels: { x: "Etichetta" } }, CLOSED);
  assert.equal(hidden.items[0].title, undefined);
  assert.equal(hidden.items[0].role_label, undefined);
  assert.equal(hidden.items[0].role_key, "x");
});

test("data dictionary groups fields under entities, structure only", () => {
  const items = sampleInput().items.map((i) => ({
    key: i.key,
    kind: i.kind,
    parentKey: i.parentKey,
    title: i.title,
    explanation: i.explanation,
    spec: i.spec,
    privacyClass: i.privacyClass,
    priority: i.priority,
    status: i.status,
  }));
  items.push({ key: "altro.campo", kind: "campo", parentKey: "ent.assente", title: "x", explanation: null, spec: {}, privacyClass: "nessuna", priority: null, status: "da_chiedere" });
  const d = dataDictionaryView(items, OPEN);
  assert.equal(d.entities.length, 1);
  assert.deepEqual(d.entities[0].fields.map((f) => [f.key, f.data_type, f.unit, f.required]), [
    ["richiesta.cliente", "testo", null, null],
    ["richiesta.durata", "numero", "min", true],
  ]);
  assert.deepEqual(d.orphan_fields, ["altro.campo"]);
  const hidden = dataDictionaryView(items, CLOSED);
  assert.equal(hidden.entities[0].title, undefined);
  assert.deepEqual(hidden.entities[0].spec, {}, "entity prose in spec is hidden");
  assert.equal(hidden.entities[0].fields[1].data_type, "numero");
});

test("gate status keeps counts, conditions and dated role-only history", () => {
  const computation: GateComputationLike = {
    gate: "G1",
    available: true,
    required: 3,
    ok: 1,
    ready: false,
    byStatus: { validata: 1, chiesta: 2 },
    should: { total: 2, ok: 0 },
    waivers: { used: 0, cap: 0 },
    conditions: [{ key: "voci", ok: false, message: "Mancano 2 voci" }],
    missing: [{ key: "q.a.01", status: "chiesta", reason: "testo", moduleKey: "mod.a", roleKey: "operativo" }],
  };
  const v = gateStatusView(
    {
      computation,
      reviews: [
        { gateKey: "G1", decision: "respinto", proposedAt: "2026-09-01T00:00:00Z", decidedAt: "2026-09-02T00:00:00Z", catalogVersion: null, approvals: [{ ruolo: "ls_lead", at: "2026-09-01T00:00:00Z", metodo: "account" }] },
      ],
    },
    CLOSED,
  );
  assert.equal(v.required, 3);
  assert.deepEqual(v.missing, [{ key: "q.a.01", status: "chiesta", module_key: "mod.a", role_key: "operativo" }]);
  assert.deepEqual(v.history[0].approvals, [{ ruolo: "ls_lead", at: "2026-09-01T00:00:00Z", metodo: "account" }]);
  assert.equal(v.conditions[0].message, "Mancano 2 voci");
  assert.ok(!JSON.stringify(v).includes("user_id"));
});

test("case list hides titles per case and keeps readiness", () => {
  const v = caseListView([
    { id: "b", code: "ES-02", title: "Secondo", status: "raccolta", catalogVersion: 0, readiness: { green_pct: 10, scope_total: 20, G1: { required: 5, ok: 1, ready: false } }, options: CLOSED },
    { id: "a", code: "ES-01", title: "Primo", status: "pronto_sviluppo", catalogVersion: 1, readiness: null, options: OPEN },
  ]);
  assert.deepEqual(v.cases.map((c) => c.code), ["ES-01", "ES-02"]);
  assert.equal(v.cases[0].title, "Primo");
  assert.equal(v.cases[1].title, undefined);
  assert.equal(v.cases[1].text_hidden, "ambiente_non_approvato");
  assert.deepEqual(v.cases[1].g1, { required: 5, ok: 1, ready: false });
  assert.equal(v.cases[1].catalog_version, null);
});

test("redactTexts leaves views untouched when texts may be shown", () => {
  const view = { title: "x", spec: { formula: "a+b" } };
  assert.equal(redactTexts(view, OPEN), view);
  assert.deepEqual(redactTexts(view, CLOSED), { spec: {}, text_hidden: "ambiente_non_approvato" });
});
