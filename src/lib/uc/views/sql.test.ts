import test from "node:test";
import assert from "node:assert/strict";
import { raw } from "../sql/statement.ts";
import { templatePartsColumns } from "../sql/template-parts.ts";
import * as sql from "./sql.ts";
import { CASE_ID, ITEM, WS_ID } from "./view.fixtures.ts";

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-/;

test("every builder filters by case and keeps ids out of the SQL text", () => {
  const statements = [
    sql.caseViewContextSql(WS_ID, CASE_ID, templatePartsColumns(["a".repeat(64)])),
    sql.contactsSql(WS_ID),
    sql.roleGroupsSql(CASE_ID),
    sql.roleGroupItemsSql(CASE_ID, "resp_servizio", false),
    sql.catalogSelectionSql(raw("i.case_id = 'x'")),
    sql.itemDetailSql(CASE_ID, ITEM),
    sql.itemAnswersSql(CASE_ID, ITEM),
    sql.itemFilesSql(CASE_ID, ITEM, false),
    sql.itemValidationsSql(CASE_ID, ITEM),
    sql.itemCommentsSql(CASE_ID, ITEM, false),
    sql.itemLinksSql(CASE_ID, ITEM),
    sql.itemEventsSql(CASE_ID, ITEM, true),
    sql.itemsOfKindsSql(CASE_ID, ["regola"]),
    sql.linksTouchingKindsSql(CASE_ID, ["kpi"]),
    sql.requiredDocumentsSql(CASE_ID, false),
    sql.caseFilesSql(CASE_ID, false),
    sql.caseDatasetsSql(CASE_ID, false),
    sql.currentMapsSql(CASE_ID),
  ];
  for (const s of statements) {
    assert.ok(!ID.test(s.text), s.text.slice(0, 80));
    assert.ok(/^\s*SELECT|^\s*WITH|^SELECT/.test(s.text), "only reads");
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/.test(s.text), "no writes");
  }
});

test("answer values of personal and health classes, and erased ones, never leave the database", () => {
  for (const s of [sql.itemAnswersSql(CASE_ID, ITEM)]) {
    assert.match(s.text, /CASE WHEN i\.privacy_class IN \('personale', 'personale_equipaggio', 'escluso_sanitario'\) OR a\.erased_at IS NOT NULL THEN NULL ELSE a\.value END/);
    assert.ok(!s.text.includes("value_encrypted AS"), "the encrypted value is never selected");
  }
  assert.match(sql.itemAnswersSql(CASE_ID, ITEM).text, /THEN NULL ELSE a\.note END AS note/);
});

test("client filters: internal comments, referent events, personal zone files", () => {
  const comments = sql.itemCommentsSql(CASE_ID, ITEM, false);
  assert.match(comments.text, /cm\.visibility = 'condiviso'/);
  assert.equal(comments.params[2], false);
  const events = sql.itemEventsSql(CASE_ID, ITEM, true);
  assert.match(events.text, /e\.actor_type = 'referente' OR e\.event_type IN \('link\.aperto', 'informativa\.vista'\)/);
  assert.equal(events.params[2], true);
  assert.match(sql.caseFilesSql(CASE_ID, false).text, /f\.storage_zone = 'standard'/);
  assert.match(sql.caseFilesSql(CASE_ID, true).text, /CASE WHEN f\.storage_zone = 'standard' AND f\.scan_status = 'pulito' THEN f\.preview END/);
});

test("the case context asks for the template's roles and modules only for a template the process has not seen", () => {
  const known = "b".repeat(64);
  const s = sql.caseViewContextSql(WS_ID, CASE_ID, templatePartsColumns([known]));
  assert.match(s.text, /c\.setup_completed_at IS NOT NULL/);
  assert.match(s.text, /t\.definition_hash AS template_hash/);
  assert.match(s.text, /CASE WHEN t\.definition_hash = ANY\(\$1::text\[\]\) THEN NULL ELSE jsonb_build_object\(/);
  assert.match(s.text, /END AS template_parts/);
  assert.ok(!/AS template_roles|AS modules/.test(s.text), "the old columns are not read twice");
  assert.ok(!/t\.definition\s*(,|AS)/.test(s.text), "never the whole definition");
  assert.deepEqual(s.params, [[known], CASE_ID, WS_ID]);
});

test("selecting all results returns ids and statuses only, one row past the limit", () => {
  const s = sql.catalogSelectionSql(raw("true"));
  assert.match(s.text, /^SELECT i\.id, i\.status FROM uc_items i WHERE true/);
  assert.deepEqual(s.params, [sql.CATALOG_SELECTION_MAX + 1]);
  const role = sql.roleGroupItemsSql(CASE_ID, "resp_servizio", false);
  assert.match(role.text, /^SELECT i\.id, i\.status FROM uc_items i/);
  assert.match(role.text, /i\.owner_role_key = \$\d+::text/);
  assert.match(role.text, /OR i\.assignee_contact_id IS NULL/);
  assert.ok(role.params.includes("resp_servizio") && role.params.includes(false));
  const groups = sql.roleGroupsSql(CASE_ID);
  assert.match(groups.text, /count\(\*\)::int AS items/);
  assert.ok(!/jsonb_agg\(i\.id/.test(groups.text), "the page carries counts, not thousands of ids");
});
