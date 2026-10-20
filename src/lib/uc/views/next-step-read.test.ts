import test from "node:test";
import assert from "node:assert/strict";
import { lowerId, parseNextStepRows } from "../../db/queries/uc-next-step.ts";
import { PENDING_SIGNATURE_STATEMENTS } from "../../db/queries/uc-signatures.ts";
import type { Row } from "../sql/readiness.ts";
import type { Readiness } from "../semaforo.ts";

// The rows of `nextStepStatements` as Postgres returns them: uuids in lower case.
const CASE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const UPPER = CASE.toUpperCase();
const NOW = new Date("2026-10-14T09:00:00Z");

function readiness(revision: number, required: number, ok: number): Readiness {
  return {
    computed_at: "2026-10-14T08:00:00.000Z",
    catalog_revision: revision,
    scope_total: required,
    per_stato: { da_chiedere: required - ok, chiesta: 0, mancante: 0, parziale: 0, in_verifica: 0, validata: ok, non_applicabile: 0, bloccata: 0 },
    green_pct: 0,
    G1: { required, ok, ready: ok === required, should: { total: 0, ok: 0 }, waivers: { used: 0, cap: 0 } },
    coverage_model: { literal_required: 0, covered_by_questions: 0, ok: 0 },
    gate_reconfirm: false,
  };
}

function rows(i: { cache: Readiness | null; revision: number; gate?: boolean }): Row[][] {
  const cases: Row[] = [
    {
      id: CASE,
      status: "raccolta",
      status_before_suspension: null,
      status_changed_at: null,
      readiness: i.cache === null ? null : JSON.stringify(i.cache),
      catalog_revision: String(i.revision),
      catalog_version: "0",
      signers_designation: null,
      catalog_frozen_at: null,
      next_milestone: null,
      pending_review: null,
      referents: "2",
      privacy_member: false,
      a8_active: false,
    },
  ];
  const counts: Row[] = [{ case_id: CASE, g_da_fare: "4", g_da_verificare: "1", g_bloccate: "0", g_a_posto: "5", to_verify_for_me: "1" }];
  const signatures: Row[][] = Array.from({ length: PENDING_SIGNATURE_STATEMENTS }, () => []);
  if (i.gate) signatures[0] = [{ id: "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9", approvals: "[]" }];
  return [cases, counts, [], ...signatures];
}

test("an upper-case case id finds the lower-case row, its roles and its signatures", () => {
  const read = parseNextStepRows(rows({ cache: readiness(3, 10, 5), revision: 3, gate: true }), {
    caseIds: [UPPER],
    rolesByCase: new Map([[UPPER, ["ls_lead"]]]),
    now: NOW,
  });
  assert.deepEqual([...read.keys()], [CASE], "keys as Postgres writes them");
  const r = read.get(lowerId(UPPER));
  assert.ok(r, "the dossier is found");
  assert.equal(r.input.toVerifyForMe, 1);
  assert.equal(r.signatures.length, 1, "the roles of the upper-case key reach the signatures");
  assert.equal(r.signatures[0].kind, "via");
});

test("the cache is stale when it is missing or behind catalog_revision; a live readiness replaces it", () => {
  const parse = (cache: Readiness | null, revision: number, live?: Readiness) =>
    parseNextStepRows(rows({ cache, revision }), {
      caseIds: [CASE],
      rolesByCase: new Map([[CASE, ["ls_lead"]]]),
      now: NOW,
      liveReadiness: live ? new Map([[UPPER, live]]) : undefined,
    }).get(CASE)!;

  const current = parse(readiness(3, 10, 5), 3);
  assert.equal(current.stale, false);
  assert.deepEqual([current.input.g1.ok, current.input.g1.required], [5, 10], "from the cache");

  const behind = parse(readiness(3, 10, 5), 4);
  assert.equal(behind.stale, true, "a command bumped the revision; after() has not refreshed the cache yet");
  assert.equal(parse(null, 0).stale, true, "no cache at all");

  const live = parse(readiness(3, 10, 5), 4, readiness(4, 10, 10));
  assert.equal(live.stale, false);
  assert.deepEqual([live.input.g1.ok, live.input.g1.required, live.input.g1.ready], [10, 10, true], "the live numbers, not the previous command's");
  assert.equal(live.readiness?.catalog_revision, 4);
});
