import test from "node:test";
import assert from "node:assert/strict";
import { USE_CASE_CODE_MAX_SEQ } from "../../portfolio/use-case-code.ts";
import { CODES_STOP_REASON, codesWorkspacesSql, missingCodesSql, parseCodesLimit, planCodes } from "./codes.ts";

// use-case-admin codes (docs/use-case/DESIGN.md §10.8). Id e prefissi inventati.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WS_A = id(901);
const WS_B = id(902);
const WS_C = id(903);

test("l'ordine dei codici: coalesce(submitted_at, created_at), poi id", () => {
  assert.match(missingCodesSql(false), /WHERE u\.code IS NULL\s+ORDER BY u\.workspace_id, coalesce\(u\.submitted_at, u\.created_at\), u\.id$/);
  assert.match(missingCodesSql(true), /u\.code IS NULL AND u\.workspace_id = \$1::uuid/);
  assert.match(codesWorkspacesSql(true), /LEFT JOIN workspace_connector_configs c ON c\.workspace_id = w\.id\s+WHERE w\.id = \$1::uuid/);
});

test("piano: i codici seguono il contatore del workspace; senza riga di config si salta", () => {
  const plans = planCodes(
    [
      { workspaceId: WS_A, name: "Acme", prefix: "ACM", nextSeq: 12 },
      { workspaceId: WS_B, name: "Senza config", prefix: null, nextSeq: 0 },
      { workspaceId: WS_C, name: "Completo", prefix: "CO", nextSeq: 3 },
    ],
    [
      { id: id(1), workspaceId: WS_A },
      { id: id(2), workspaceId: WS_A },
      { id: id(3), workspaceId: WS_B },
    ],
  );
  assert.deepEqual(plans, [
    { workspaceId: WS_A, name: "Acme", prefix: "ACM", missing: 2, proposed: [{ id: id(1), code: "ACM-0013" }, { id: id(2), code: "ACM-0014" }], originPending: 0, stop: null },
    { workspaceId: WS_B, name: "Senza config", prefix: null, missing: 1, proposed: [], originPending: 0, stop: "senza_config" },
  ]);
});

test("origine da decidere: il workspace si salta finché origin non ha deciso (§10.7)", () => {
  const plans = planCodes(
    [
      { workspaceId: WS_A, name: "Acme", prefix: "ACM", nextSeq: 0 },
      { workspaceId: WS_B, name: "Senza config", prefix: null, nextSeq: 0 },
      { workspaceId: WS_C, name: "Pronto", prefix: "PR", nextSeq: 0 },
    ],
    [
      { id: id(1), workspaceId: WS_A },
      { id: id(2), workspaceId: WS_B },
      { id: id(3), workspaceId: WS_C },
    ],
    new Map([
      [WS_A, 1],
      [WS_B, 2],
    ]),
  );
  assert.deepEqual(
    plans.map((plan) => [plan.workspaceId, plan.originPending, plan.stop]),
    [
      [WS_A, 1, "origine_da_decidere"],
      [WS_B, 2, "senza_config"],
      [WS_C, 0, null],
    ],
  );
  assert.deepEqual(plans[0].proposed, [{ id: id(1), code: "ACM-0001" }], "a secco il codice si mostra lo stesso");
  assert.equal(CODES_STOP_REASON.origine_da_decidere, "origine da decidere: esegui prima origin");
});

test("oltre 99.999 per workspace il piano si ferma e lo dice", () => {
  const [plan] = planCodes(
    [{ workspaceId: WS_A, name: "Pieno", prefix: "PI", nextSeq: USE_CASE_CODE_MAX_SEQ - 1 }],
    [
      { id: id(1), workspaceId: WS_A },
      { id: id(2), workspaceId: WS_A },
    ],
  );
  assert.deepEqual(plan.proposed, [{ id: id(1), code: "PI-99999" }]);
  assert.equal(plan.stop, "oltre_99999");
  const [full] = planCodes([{ workspaceId: WS_A, name: "Pieno", prefix: "PI", nextSeq: USE_CASE_CODE_MAX_SEQ }], [{ id: id(1), workspaceId: WS_A }]);
  assert.deepEqual(full.proposed, []);
  assert.equal(full.stop, "oltre_99999");
});

test("oltre 9.999 il numero resta intero", () => {
  const [plan] = planCodes([{ workspaceId: WS_A, name: "Grande", prefix: "GR", nextSeq: 9999 }], [{ id: id(1), workspaceId: WS_A }]);
  assert.equal(plan.proposed[0].code, "GR-10000");
});

test("--limit: intero da 1 a 100.000", () => {
  assert.deepEqual(parseCodesLimit(null), { ok: true, limit: null });
  assert.deepEqual(parseCodesLimit("3"), { ok: true, limit: 3 });
  for (const value of ["0", "-1", "1.5", "tre", "", "100001"]) assert.equal(parseCodesLimit(value).ok, false, value);
});
