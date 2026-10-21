import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLEAR_SENT_DRAFTS_SQL, SLACK_DRAFT_TEXT_COLUMNS, countByWorkspace, sentDraftsSql } from "./slack-drafts.ts";

// use-case-admin slack-drafts (docs/use-case/DESIGN.md §6.8 e §10.5).

test("le colonne di testo sono quelle di slack_use_case_drafts in schema.ts", () => {
  const schema = readFileSync(new URL("../../db/schema.ts", import.meta.url), "utf8");
  const start = schema.indexOf('pgTable("slack_use_case_drafts"');
  const block = schema.slice(start, schema.indexOf("});", start));
  const textColumns = [...block.matchAll(/(?:text|varchar)\("([a-z_0-9]+)"/g)]
    .map((match) => match[1])
    .filter((column) => !/^(slack_|contribution_kind|status)/.test(column));
  assert.deepEqual([...SLACK_DRAFT_TEXT_COLUMNS].sort(), textColumns.sort());
});

test("solo le bozze inviate da oltre 10 minuti, con almeno un testo", () => {
  for (const sql of [sentDraftsSql(false), CLEAR_SENT_DRAFTS_SQL]) {
    assert.match(sql, /d\.status = 'submitted'/);
    assert.match(sql, /coalesce\(d\.submitted_at, d\.updated_at\) < now\(\) - interval '10 minutes'/);
    for (const column of SLACK_DRAFT_TEXT_COLUMNS) assert.match(sql, new RegExp(`d\\.${column} IS NOT NULL`));
  }
  assert.match(sentDraftsSql(true), /AND d\.workspace_id = \$1::uuid/);
});

test("le colonne di testo vanno a NULL, il resto resta", () => {
  const set = CLEAR_SENT_DRAFTS_SQL.slice(CLEAR_SENT_DRAFTS_SQL.indexOf(" SET "), CLEAR_SENT_DRAFTS_SQL.indexOf(" WHERE "));
  assert.deepEqual(
    set.replace(/^\s*SET\s+/, "").trim().split(/,\s*/),
    SLACK_DRAFT_TEXT_COLUMNS.map((column) => `${column} = NULL`),
  );
});

test("l'uscita conta le bozze per workspace, senza testi", () => {
  assert.deepEqual(
    countByWorkspace([{ workspaceId: "a" }, { workspaceId: "b" }, { workspaceId: "a" }]),
    [
      { workspace: "a", bozze: 2 },
      { workspace: "b", bozze: 1 },
    ],
  );
});
