import test from "node:test";
import assert from "node:assert/strict";
import { enqueueForLsMembersSql, enqueueSql } from "../../db/queries/uc-notifications.ts";
import { toStatement } from "../sql/statement.ts";
import { BELL_SUFFIX_ROOM, bellPrefix, dedupeKey } from "./dedupe.ts";

const REQ = "0f8fad5b-d9cb-469f-a165-70867728950e";
const WS = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CASE = "16fd2706-8baf-433b-82eb-8c7fada847da";
const USER = "6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b";
const NOW = new Date("2026-10-05T22:30:00Z"); // martedì 6 ottobre, 00:30 a Roma

test("request keys allow at most one send per day, per epoch, in Rome time", () => {
  assert.equal(dedupeKey.richiesta(REQ, 0, NOW), `richiesta:${REQ}:0:2026-10-06`);
  assert.notEqual(dedupeKey.richiesta(REQ, 1, NOW), dedupeKey.richiesta(REQ, 0, NOW), "a new epoch is a new send");
  assert.throws(() => dedupeKey.richiesta(REQ, -1, NOW));
});

test("reminders: two at most, plus one Owner escalation per request", () => {
  assert.equal(dedupeKey.promemoria(REQ, 1), `promemoria_1:${REQ}`);
  assert.equal(dedupeKey.promemoria(REQ, 2), `promemoria_2:${REQ}`);
  assert.throws(() => dedupeKey.promemoria(REQ, 3 as 1));
  assert.equal(dedupeKey.owner(REQ), `owner:${REQ}`);
});

test("keys are normalized to lowercase ids and never accept tokens or free text", () => {
  assert.equal(dedupeKey.chiarimento(REQ.toUpperCase()), `chiarimento:${REQ}`);
  assert.throws(() => dedupeKey.delega("ucr_abcdefabcdefabcdefabcdefabcdefab"));
  assert.throws(() => dedupeKey.delega("Mario Rossi"));
  assert.throws(() => dedupeKey.approvazione("review", REQ, "owner", "giro con spazi"));
});

test("approvals, digests, freshness and answer groups", () => {
  assert.equal(dedupeKey.approvazione("review", REQ, "owner"), `approvazione:review:${REQ}:owner`);
  assert.equal(dedupeKey.approvazione("item", REQ, "owner", 2), `approvazione:item:${REQ}:owner:2`);
  assert.throws(() => dedupeKey.approvazione("altro" as "item", REQ, "owner"));
  assert.equal(dedupeKey.riepilogo(WS, NOW, { contactId: CASE }), `riepilogo:${WS}:2026-W41:c-${CASE}`);
  assert.equal(dedupeKey.riepilogo(WS, NOW, { userId: USER }), `riepilogo:${WS}:2026-W41:u-${USER}`);
  assert.equal(dedupeKey.scaduto(CASE, NOW), `scaduto:${CASE}:2026-10-06`);
  assert.equal(dedupeKey.risposte(CASE, NOW, USER), `risposte:${CASE}:2026-10-06:${USER}`);
  assert.equal(dedupeKey.delegaConferma(REQ), `delega_conferma:${REQ}`);
});

test("bell prefixes leave room for the member id", () => {
  const prefixes = [
    bellPrefix.bloccoSciolto(CASE),
    bellPrefix.gatePronto(CASE, 12),
    bellPrefix.gateApprovato(REQ),
    bellPrefix.datoScaduto(CASE, NOW),
    bellPrefix.lsLeadDaIndicare(CASE, NOW),
    bellPrefix.ownerDaIndicare(REQ),
    bellPrefix.delegaDaApprovare(REQ),
    bellPrefix.riepilogo(WS, NOW),
  ];
  for (const p of prefixes) assert.ok(p.length + BELL_SUFFIX_ROOM <= 200, p);
  assert.equal(new Set(prefixes).size, prefixes.length);
  assert.throws(() => bellPrefix.gatePronto(CASE, -1));
});

test("keys are accepted by the queue SQL builders", () => {
  const s = toStatement(
    enqueueSql({
      workspaceId: WS,
      caseId: CASE,
      requestId: REQ,
      recipient: { contactId: USER },
      channel: "email",
      templateKey: "promemoria_1",
      dedupeKey: dedupeKey.promemoria(REQ, 1),
    }),
  );
  assert.ok(s.params.includes(`promemoria_1:${REQ}`));
  const bell = toStatement(
    enqueueForLsMembersSql({ workspaceId: WS, caseId: CASE, templateKey: "blocco_sciolto", dedupeKeyPrefix: bellPrefix.bloccoSciolto(CASE) }),
  );
  assert.ok(bell.params.includes(`blocco_sciolto:${CASE}`));
});
