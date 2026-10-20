import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_PAYLOAD_FIELDS,
  UC_EVENT_TYPES,
  eventActorFrom,
  eventInsertFromSql,
  eventInsertSql,
  eventPayload,
} from "../db/queries/uc-events.ts";
import { enqueueForLsMembersSql, enqueueSql, notificationPayload } from "../db/queries/uc-notifications.ts";
import { runUcBatch, ucErrorCode, type UcExecutor } from "../db/uc-executor.ts";
import { toStatement } from "./sql/statement.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

test("event types follow the DB format and every type has a payload allowlist", () => {
  assert.equal(new Set(UC_EVENT_TYPES).size, UC_EVENT_TYPES.length);
  for (const type of UC_EVENT_TYPES) {
    assert.match(type, /^[a-z_]+\.[a-z_]+$/);
    assert.ok(Array.isArray(EVENT_PAYLOAD_FIELDS[type]), type);
  }
});

test("event payload keeps keys, states, versions and counts, and drops values, texts, emails and tokens", () => {
  const payload = eventPayload("risposta.inviata", {
    item_key: "q.esempio.11",
    version: 2,
    kind: "valore",
    response_type: "valuta",
    source_kind: "referente",
    value: { amount: 1200 },
    note: "testo libero",
    email: "persona@cliente.test",
    ip: "10.0.0.1",
  });
  assert.deepEqual(payload, { item_key: "q.esempio.11", version: 2, kind: "valore", response_type: "valuta", source_kind: "referente" });
});

test("event payload drops invalid values of allowed fields instead of storing them", () => {
  assert.deepEqual(eventPayload("voce.stato_cambiato", { item_key: "Mario Rossi", reason: "Vedi email di mario@x.it", trigger: "valida" }), { trigger: "valida" });
  assert.deepEqual(eventPayload("link.copiato", { token_id: "ucr_abcdefghijklmnopqrstuvwxyz012345" }), {});
  assert.deepEqual(eventPayload("voce.assegnata", { item_key: "ucr_abcdefghijklmnopqrstuvwxyz012345", count: 3 }), { count: 3 });
  assert.deepEqual(eventPayload("link.aperto", { anything: 1 }), {});
  assert.deepEqual(eventPayload("voce.stato_importato", { counts: { da_chiedere: 3, "Not A Code": 1 } }), {});
  assert.deepEqual(eventPayload("voce.stato_importato", { counts: { da_chiedere: 3, bloccata: 1 }, count: 4 }), { counts: { da_chiedere: 3, bloccata: 1 }, count: 4 });
});

test("eventInsertSql parametrizes every value and minimizes the payload", () => {
  const s = toStatement(
    eventInsertSql({
      type: "caso.creato",
      workspaceId: WS,
      caseId: CASE,
      actor: { type: "utente", userId: USER },
      targetType: "caso",
      targetId: CASE,
      payload: { code: "ES-UC-01", items: 45, title: "testo del cliente" },
      userAgent: "x".repeat(400),
    }),
  );
  assert.match(s.text, /^INSERT INTO uc_events \(workspace_id, case_id, actor_type/);
  assert.ok(!s.text.includes("ES-UC-01"));
  assert.equal(s.params.length, 14);
  assert.deepEqual(JSON.parse(s.params[11] as string), { code: "ES-UC-01", items: 45 });
  assert.equal((s.params[13] as string).length, 300);
  assert.throws(() => eventInsertSql({ type: "caso.creato", workspaceId: WS, actor: { type: "sistema" }, ipHash: "1.2.3.4" }));
  assert.throws(() => eventInsertSql({ type: "nope.nope" as never, workspaceId: WS, actor: { type: "sistema" } }));
});

test("eventInsertFromSql writes one event per changed row with row payload fields", () => {
  const s = toStatement(
    eventInsertFromSql({
      type: "voce.stato_cambiato",
      workspaceId: WS,
      caseId: CASE,
      actor: { type: "utente", userId: USER },
      targetType: "voce",
      from: "changed",
      targetIdColumn: "changed.id",
      fromStateColumn: "changed.old_status",
      toStateColumn: "changed.status",
      payload: { trigger: "valida" },
      rowPayload: { item_key: "changed.key" },
    }),
  );
  assert.match(s.text, /jsonb_build_object\('item_key', changed\.key\)/);
  assert.match(s.text, /FROM changed$/);
  assert.throws(() => eventInsertFromSql({ type: "voce.stato_cambiato", workspaceId: WS, actor: { type: "sistema" }, from: "changed; drop" }));
  assert.throws(() =>
    eventInsertFromSql({ type: "voce.stato_cambiato", workspaceId: WS, actor: { type: "sistema" }, from: "changed", rowPayload: { mime: "changed.mime" } }),
  );
});

test("an approval link acts as a referent in the audit", () => {
  assert.deepEqual(eventActorFrom({ type: "owner_link", contactId: "c1", requestId: "r1", designation: "owner" }), { type: "referente", contactId: "c1" });
  assert.deepEqual(eventActorFrom({ type: "sistema", job: "seed" }), { type: "sistema" });
});

test("notifications dedupe on the key, never carry values or tokens, and the bell is only for users", () => {
  const s = toStatement(
    enqueueSql({
      workspaceId: WS,
      caseId: CASE,
      recipient: { contactId: USER },
      channel: "email",
      templateKey: "richiesta_inviata",
      payload: { items: 8, minutes: 20, token: "ucr_secret", value: 3 },
      dedupeKey: `richiesta:${CASE}:0:2026-10-07`,
      holdReason: "email_non_configurata",
    }),
  );
  assert.match(s.text, /ON CONFLICT \(dedupe_key\) DO NOTHING$/);
  assert.ok(s.params.some((p) => p === '{"items":8,"minutes":20}'));
  assert.throws(() => enqueueSql({ workspaceId: WS, recipient: { contactId: USER }, channel: "in_app", templateKey: "gate_pronto", dedupeKey: "x" }));
  assert.throws(() => enqueueSql({ workspaceId: WS, recipient: { userId: USER }, channel: "in_app", templateKey: "nope" as never, dedupeKey: "x" }));
  assert.throws(() => enqueueSql({ workspaceId: WS, recipient: { userId: USER }, channel: "in_app", templateKey: "gate_pronto", dedupeKey: "bad key with spaces" }));
  assert.deepEqual(notificationPayload({ item_keys: ["q.a.01", "ucr_x"], gate: "G1" }), { gate: "G1" });
});

test("the Lateral Space bell fans out to ls_* members only", () => {
  const s = toStatement(enqueueForLsMembersSql({ workspaceId: WS, caseId: CASE, templateKey: "gate_pronto", dedupeKeyPrefix: `gate_pronto:${CASE}` }));
  assert.match(s.text, /role IN \('ls_lead', 'ls_analista', 'ls_sviluppatore'\)/);
  assert.match(s.text, /'in_app'/);
  assert.match(s.text, /\|\| ':' \|\| m\.user_id::text/);
});

test("uc errors become codes; other errors propagate", async () => {
  assert.equal(ucErrorCode(new Error("uc:conflitto")), "conflitto");
  assert.equal(ucErrorCode(new Error("ERROR: uc:sola_aggiunta")), "sola_aggiunta");
  assert.equal(ucErrorCode(new Error("duplicate key value")), null);
  const failing = (error: Error): UcExecutor => ({ batch: async () => Promise.reject(error) });
  const result = await runUcBatch(failing(new Error("uc:conflitto")), [{ text: "SELECT 1", params: [] }]);
  assert.deepEqual(result, { ok: false, code: "conflitto", message: "Qualcuno ha appena modificato questi dati. Aggiorna la pagina e riprova." });
  await assert.rejects(() => runUcBatch(failing(new Error("network down")), []), /network down/);
  const okExec: UcExecutor = { batch: async () => [[{ ok: true }]] };
  assert.deepEqual(await runUcBatch(okExec, []), { ok: true, rows: [[{ ok: true }]] });
});
