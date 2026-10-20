import test from "node:test";
import assert from "node:assert/strict";
import {
  caseCoreSql,
  computeCaseReadiness,
  parseCaseCore,
  parseReadinessRows,
  readinessCacheSql,
  readinessReadStatements,
  rowBool,
  rowDate,
  rowIsoDate,
  rowNumber,
  rowStringArray,
  rowToGateItem,
  rowToSnapshotItem,
  rowToSnapshotLink,
  snapshotItemsSql,
  snapshotReadStatements,
  type Row,
} from "./readiness.ts";
import { computeReadiness } from "../semaforo.ts";
import { buildCatalogSnapshot } from "../snapshot.ts";

const NOW = new Date("2026-10-07T10:00:00.000Z");
const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";

function caseRow(over: Row = {}): Row {
  return {
    id: CASE,
    workspace_id: WS,
    organization_id: null,
    code: "PROVA-01",
    title: "Caso di prova",
    status: "raccolta",
    status_before_suspension: null,
    status_changed_at: "2026-10-01T08:00:00Z",
    catalog_revision: "3",
    catalog_version: 0,
    share_epoch: 0,
    settings: { gate_policy: { scope: "request_modules", default_serves_for: ["modello"], default_perimeter: "in_contratto", confirmed: null }, client_text: true },
    contract_refs: '["art. 1"]',
    signers_designation: { owner: { contact_id: "33333333-3333-4333-8333-333333333333", evidence_file_id: "x" } },
    client_owner_contact_id: "33333333-3333-4333-8333-333333333333",
    client_privacy_approver_contact_id: null,
    portfolio_use_case_id: null,
    ai_environment_approved: false,
    template_id: "44444444-4444-4444-8444-444444444444",
    template_version: "1.0.0",
    ls_lead_user_id: null,
    ...over,
  };
}

let seq = 0;
function itemRow(over: Row = {}): Row {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    key: `q.prova.${String(seq).padStart(2, "0")}`,
    kind: "domanda",
    status: "da_chiedere",
    status_reason: null,
    priority: "must",
    perimeter: "in_contratto",
    serves_for: ["modello"],
    in_gate_scope: true,
    defaults_applied: ["serves_for", "perimeter"],
    health_rule_question: false,
    privacy_class: "riservato_azienda",
    response_type: "numero",
    request_module_key: "m.prova",
    owner_role_key: "resp_servizio",
    assignee_contact_id: null,
    stale_at: null,
    na_approved_at: null,
    waiver: null,
    waiver_approved_at: null,
    fallback: null,
    fallback_approved_at: null,
    active_blocker_keys: "[]",
    open_clarification: false,
    answer_text_hash: null,
    answer_version: null,
    responder_role_key: null,
    confirmed_by_role_key: null,
    ...over,
  };
}

test("row helpers read what Neon HTTP and pg return", () => {
  assert.deepEqual(rowStringArray(["a", null, "b"]), ["a", "b"]);
  assert.deepEqual(rowStringArray('["x","y"]'), ["x", "y"]);
  assert.deepEqual(rowStringArray("{ls_lead,osservatore}"), ["ls_lead", "osservatore"]);
  assert.deepEqual(rowStringArray("{}"), []);
  assert.deepEqual(rowStringArray(null), []);
  assert.equal(rowNumber("12"), 12);
  assert.equal(rowNumber("x"), null);
  assert.equal(rowBool("t"), true);
  assert.equal(rowBool("f"), false);
  assert.equal(rowDate("2026-10-01T08:00:00Z")?.toISOString(), "2026-10-01T08:00:00.000Z");
  assert.equal(rowDate("non una data"), null);
  assert.equal(rowIsoDate("2026-10-01"), "2026-10-01");
  assert.equal(rowIsoDate(new Date("2026-10-01T00:00:00Z")), "2026-10-01");
});

test("parseCaseCore reads the gate policy, contract references and designated signers", () => {
  const core = parseCaseCore(caseRow());
  assert.ok(core);
  assert.equal(core.catalogRevision, 3);
  assert.equal(core.policy.scope, "request_modules");
  assert.equal(core.policy.confirmed, null);
  assert.deepEqual(core.contractRefs, ["art. 1"]);
  assert.equal(core.designated.owner, "33333333-3333-4333-8333-333333333333");
  assert.equal(core.designated.privacy, null);
  assert.equal(parseCaseCore(caseRow({ status: "inventato" })), null);
  assert.equal(parseCaseCore(undefined), null);
});

test("the case row is read first, so the revision is read before the items", () => {
  const statements = readinessReadStatements(WS, CASE);
  assert.equal(statements.length, 5);
  assert.match(statements[0].text, /c\.catalog_revision/);
  assert.match(statements[0].text, /setup_completed_at IS NOT NULL/);
  assert.match(statements[1].text, /FROM uc_items i/);
  assert.equal(caseCoreSql(WS, CASE).text, statements[0].text);
  assert.doesNotMatch(statements[1].text, /\.value\b|value_normalized/);
});

test("live readiness from rows equals the pure computation on the same items", () => {
  const items = [
    itemRow({ status: "validata" }),
    itemRow({ status: "in_verifica" }),
    itemRow({ status: "bloccata", active_blocker_keys: '["a8"]' }),
    itemRow({ priority: "should" }),
    itemRow({ kind: "campo", key: "ordine.importo", request_module_key: null, in_gate_scope: false, defaults_applied: null }),
  ];
  const input = parseReadinessRows([[caseRow()], items, [], [], [{ id: "b1", key: "a8", label: "A.8", status: "attivo", scope: {}, approvals: "[]", items: "1" }]]);
  assert.ok(input);
  const live = computeCaseReadiness(input, NOW);
  const direct = computeReadiness({
    items: items.map(rowToGateItem),
    links: [],
    datasets: [],
    blockers: [{ key: "a8", status: "attivo" }],
    now: NOW,
    catalogRevision: 3,
    caseCode: "PROVA-01",
    caseStatus: "raccolta",
    statusBeforeSuspension: null,
    policy: { scope: "request_modules" },
  });
  assert.deepEqual(live.readiness, direct.readiness);
  assert.equal(live.readiness.scope_total, 4, "the header counts the items of the request modules");
  assert.equal(live.g1.required, 3);
  assert.equal(live.g1.ok, 1);
  assert.equal(live.g1.ready, false);
  assert.equal(input.blockers[0].items, 1);
  assert.equal(parseReadinessRows([[], [], [], [], []]), null);
});

test("rowToGateItem keeps defaults applied and the active blocker keys", () => {
  const g = rowToGateItem(itemRow({ defaults_applied: '["serves_for","altro"]', active_blocker_keys: ["accesso_sistema"], health_rule_question: "t" }));
  assert.deepEqual(g.defaultsApplied, ["serves_for"]);
  assert.deepEqual(g.activeBlockerKeys, ["accesso_sistema"]);
  assert.equal(g.healthRuleQuestion, true);
});

test("the readiness cache is written only at the revision it was computed on", () => {
  const input = parseReadinessRows([[caseRow()], [itemRow()], [], [], []]);
  assert.ok(input);
  const s = readinessCacheSql(CASE, computeCaseReadiness(input, NOW).readiness);
  assert.match(s.text, /WHERE id = \$2::uuid AND catalog_revision = \$3::int/);
  assert.equal(s.params[2], 3);
});

test("snapshot reads never return personal, health or erased values", () => {
  const s = snapshotItemsSql(CASE);
  assert.match(s.text, /CASE WHEN i\.privacy_class IN \('personale', 'personale_equipaggio', 'escluso_sanitario'\) OR va\.erased_at IS NOT NULL THEN NULL ELSE va\.value END/);
  assert.match(s.text, /CASE WHEN i\.privacy_class IN \('personale', 'personale_equipaggio', 'escluso_sanitario'\) OR ca\.erased_at IS NOT NULL THEN NULL ELSE ca\.value_normalized END/);
  assert.equal(snapshotReadStatements(WS, CASE).length, 4);
});

test("snapshot rows build a frozen catalog with only the validated answer", () => {
  const validated = rowToSnapshotItem({
    key: "q.prova.01",
    kind: "domanda",
    section: "modello_dati",
    parent_key: null,
    title: "Quante richieste al giorno?",
    spec: {},
    priority: "must",
    serves_for: ["modello"],
    privacy_class: "nessuna",
    value_visibility: "owner_e_ls",
    availability: [],
    perimeter: "in_contratto",
    levers: ["tempo"],
    response_type: "numero",
    response_config: { unit: "richieste" },
    request_module_key: "m.prova",
    owner_role_key: "resp_servizio",
    in_gate_scope: true,
    status: "validata",
    validated_at: "2026-10-05T10:00:00Z",
    va_id: "a1",
    va_version: 2,
    va_kind: "valore",
    va_value: { value: 40, unit: "richieste" },
    va_value_normalized: null,
    va_source_kind: "referente",
    va_valid_from: null,
    va_created_at: "2026-10-04T10:00:00Z",
    ca_id: "a1",
    ca_version: 2,
    ca_kind: "valore",
    ca_value: { value: 40 },
    ca_source_kind: "referente",
    ca_created_at: "2026-10-04T10:00:00Z",
  });
  const open = rowToSnapshotItem({ key: "q.prova.02", kind: "domanda", section: "modello_dati", title: "Altro", status: "in_verifica", privacy_class: "nessuna", ca_id: "a2", ca_version: 1, ca_kind: "valore", ca_value: { text: "x" }, ca_source_kind: "referente", ca_created_at: "2026-10-04T10:00:00Z" });
  const snapshot = buildCatalogSnapshot({
    case: { id: CASE, workspaceId: WS, code: "PROVA-01", title: "Caso", perimeterLabel: null, contractRefs: [], dataControllerLabel: null },
    template: { key: "esempio.minimo", version: "1.0.0", hash: "h" },
    version: 1,
    frozenAt: NOW,
    gate: null,
    items: [validated, open],
    links: [rowToSnapshotLink({ from_key: "q.prova.02", to_key: "q.prova.01", relation: "precisa", cardinality: null, note: null })],
  });
  assert.ok(snapshot.ok);
  const [first, second] = snapshot.value.items;
  assert.equal(first.answer?.version, 2);
  assert.equal(first.answer?.validated, true);
  assert.equal(first.unit, "richieste");
  assert.equal(second.answer, null, "an open answer never enters a frozen version");
  assert.equal(snapshot.value.links.length, 1);
});
