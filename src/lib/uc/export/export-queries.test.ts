import test from "node:test";
import assert from "node:assert/strict";
import type { UcExecutor, UcRow } from "../../db/uc-executor.ts";
import { loadExportSnapshot, recordCatalogExport } from "../../db/queries/uc-export.ts";
import { buildCatalogSnapshot } from "../snapshot.ts";
import { sampleInput } from "../snapshot.fixtures.ts";
import type { UcStatement } from "../sql/statement.ts";

// Esecutore finto: risponde alle letture riconoscendo la SQL e registra i batch.
// Le prove sul database vero stanno nei test di integrazione del harness.

const CASE = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

type Responder = (s: UcStatement, index: number, batch: readonly UcStatement[]) => UcRow[];

function fakeExecutor(respond: Responder, onBatch?: (batch: readonly UcStatement[]) => void): UcExecutor & { batches: UcStatement[][] } {
  const batches: UcStatement[][] = [];
  return {
    batches,
    async batch(statements) {
      batches.push([...statements]);
      onBatch?.(statements);
      return statements.map((s, i) => respond(s, i, statements));
    },
  };
}

function storedSnapshot(version = 1, caseId = CASE) {
  const r = buildCatalogSnapshot(sampleInput({ version, case: { ...sampleInput().case, id: caseId } }));
  assert.ok(r.ok);
  return JSON.parse(JSON.stringify(r.value)) as Record<string, unknown>;
}

test("frozen export: the latest version by default, a precise one on request, never another case", async () => {
  const latest = fakeExecutor((s) => (/FROM uc_catalog_versions v/.test(s.text) ? [{ version: 1, snapshot: storedSnapshot(1) }] : []));
  const r = await loadExportSnapshot(latest, { workspaceId: WS, caseId: CASE, version: { kind: "ultima" } });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(r.value.version, 1);
  const sql = latest.batches[0][0];
  assert.match(sql.text, /c\.workspace_id = \$2::uuid AND c\.setup_completed_at IS NOT NULL\nORDER BY v\.version DESC\nLIMIT 1$/);
  assert.deepEqual(sql.params, [CASE, WS]);

  const precise = fakeExecutor(() => []);
  const missing = await loadExportSnapshot(precise, { workspaceId: WS, caseId: CASE, version: { kind: "numero", version: 2 } });
  assert.equal(missing.ok ? "" : missing.code, "versione_assente");
  assert.match(precise.batches[0][0].text, /AND v\.version = \$3::int/);
  assert.deepEqual(precise.batches[0][0].params, [CASE, WS, 2]);

  const none = await loadExportSnapshot(fakeExecutor(() => []), { workspaceId: WS, caseId: CASE, version: { kind: "ultima" } });
  assert.equal(none.ok ? "" : none.code, "nessuna_versione");

  const other = fakeExecutor(() => [{ version: 1, snapshot: storedSnapshot(1, "99999999-9999-4999-8999-999999999999") }]);
  const refused = await loadExportSnapshot(other, { workspaceId: WS, caseId: CASE, version: { kind: "ultima" } });
  assert.equal(refused.ok ? "" : refused.code, "versione_illeggibile");

  const noQuery = fakeExecutor(() => []);
  const bad = await loadExportSnapshot(noQuery, { workspaceId: "nope", caseId: CASE, version: { kind: "ultima" } });
  assert.equal(bad.ok ? "" : bad.code, "non_trovato");
  assert.equal(noQuery.batches.length, 0);
});

const coreRow = {
  id: CASE,
  workspace_id: WS,
  organization_id: null,
  code: "ES-UC-01",
  title: "Gestione richieste d'esempio",
  status: "raccolta",
  status_before_suspension: null,
  status_changed_at: "2026-09-01T00:00:00.000Z",
  catalog_revision: 4,
  catalog_version: 0,
  share_epoch: 0,
  settings: {},
  contract_refs: [],
  signers_designation: {},
  client_owner_contact_id: null,
  client_privacy_approver_contact_id: null,
  portfolio_use_case_id: null,
  ai_environment_approved: false,
  template_id: "44444444-4444-4444-8444-444444444444",
  template_version: "1.0.0",
  ls_lead_user_id: USER,
};

const itemRow = (over: Record<string, unknown>) => ({
  key: "q.esempio.01",
  kind: "domanda",
  section: "modello_dati",
  parent_key: null,
  title: "Titolo d'esempio",
  spec: {},
  priority: "must",
  serves_for: ["modello"],
  privacy_class: "nessuna",
  value_visibility: "owner_e_ls",
  availability: [],
  perimeter: "in_contratto",
  levers: [],
  response_type: "testo",
  response_config: {},
  request_module_key: "mod.esempio",
  in_gate_scope: true,
  status: "da_chiedere",
  ...over,
});

test("draft export: built live in one transaction, current answers marked as not validated", async () => {
  const exec = fakeExecutor((s, i) => {
    if (i === 0) return [coreRow];
    if (/^SELECT c\.id, c\.workspace_id, c\.code, c\.title, c\.perimeter_label/.test(s.text)) {
      return [{ id: CASE, workspace_id: WS, code: "ES-UC-01", title: "Gestione", perimeter_label: null, contract_refs: [], data_controller_label: null, template_key: "esempio.minimo", template_version: "1.0.0", template_hash: "a".repeat(64) }];
    }
    if (/^SELECT i\.key, i\.kind, i\.section/.test(s.text)) {
      return [
        itemRow({ status: "in_verifica", ca_id: "a1", ca_version: 1, ca_kind: "valore", ca_value: { text: "Valore in verifica" }, ca_source_kind: "referente", ca_created_at: "2026-09-02T00:00:00.000Z" }),
        itemRow({ key: "q.esempio.02", privacy_class: "personale", status: "in_verifica", ca_id: "a2", ca_version: 1, ca_kind: "valore", ca_value: null, ca_source_kind: "referente", ca_created_at: "2026-09-02T00:00:00.000Z" }),
      ];
    }
    return [];
  });
  const r = await loadExportSnapshot(exec, { workspaceId: WS, caseId: CASE, version: { kind: "bozza" } });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(exec.batches.length, 1, "one transaction");
  assert.equal(exec.batches[0].length, 8);
  assert.equal(r.value.version, "bozza");
  assert.equal(r.value.frozen_at, null);
  assert.deepEqual({ decision: r.value.gate?.decision, review: r.value.gate?.review_id, hash: r.value.gate?.summary_text_hash }, { decision: null, review: null, hash: null });
  const first = r.value.items.find((i) => i.key === "q.esempio.01");
  assert.equal(first?.answer?.validated, false);
  assert.deepEqual(first?.answer?.value, { text: "Valore in verifica" });
  assert.equal(r.value.items.find((i) => i.key === "q.esempio.02")?.answer?.value_hidden, "personale");
});

test("every download writes one audit event with format and version only", async () => {
  const exec = fakeExecutor(() => []);
  await recordCatalogExport(exec, { workspaceId: WS, caseId: CASE, actor: { type: "utente", userId: USER }, format: "xlsx", version: "bozza" });
  const [s] = exec.batches[0];
  assert.match(s.text, /^INSERT INTO uc_events/);
  assert.ok(s.params.includes("catalogo.esportato"));
  assert.ok(s.params.includes('{"format":"xlsx","version":"bozza"}'));
});
