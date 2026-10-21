import test from "node:test";
import assert from "node:assert/strict";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../db/schema.ts";
import { UC_DDL, UC_TABLE_NAMES } from "./ddl.ts";

interface DdlColumn {
  type: string;
  notNull: boolean;
  hasDefault: boolean;
}

/** Columns of each `CREATE TABLE IF NOT EXISTS uc_*` in UC_DDL, read from the SQL text. */
function parseDdl(): Map<string, Map<string, DdlColumn>> {
  const tables = new Map<string, Map<string, DdlColumn>>();
  for (const statement of UC_DDL) {
    const head = statement.match(/^CREATE TABLE IF NOT EXISTS (uc_[a-z_]+) \(\n/);
    if (!head) continue;
    const columns = new Map<string, DdlColumn>();
    for (const line of statement.split("\n").slice(1, -1)) {
      const m = line.match(/^  ([a-z_0-9]+) ((?:varchar|char)\(\d+\)|[a-z]+)(.*?),?$/);
      if (!m || m[1] === "constraint") continue;
      const rest = m[3];
      columns.set(m[1], {
        type: m[2] === "timestamptz" ? "timestamp with time zone" : m[2],
        notNull: / NOT NULL| PRIMARY KEY/.test(rest),
        hasDefault: / DEFAULT /.test(rest),
      });
    }
    tables.set(head[1], columns);
  }
  return tables;
}

const drizzleTables: PgTable[] = (Object.values(schema) as unknown[]).filter(
  (value): value is PgTable => is(value, PgTable) && getTableName(value).startsWith("uc_"),
);

test("Drizzle declares exactly the 28 uc tables of the DDL", () => {
  assert.deepEqual(drizzleTables.map((t) => getTableName(t)).sort(), [...UC_TABLE_NAMES].sort());
});

test("for every uc table, Drizzle columns match the DDL: names, types, NOT NULL and defaults", () => {
  const ddl = parseDdl();
  assert.equal(ddl.size, 28);
  for (const table of drizzleTables) {
    const name = getTableName(table);
    const expected = ddl.get(name);
    assert.ok(expected, `${name} missing in UC_DDL`);
    const columns = Object.values(getTableColumns(table));
    assert.deepEqual(columns.map((c) => c.name).sort(), [...expected.keys()].sort(), `${name}: column names`);
    for (const column of columns) {
      const d: DdlColumn = expected.get(column.name)!;
      assert.equal(column.getSQLType(), d.type, `${name}.${column.name}: type`);
      assert.equal(column.notNull || column.primary, d.notNull, `${name}.${column.name}: NOT NULL`);
      assert.equal(column.hasDefault, d.hasDefault, `${name}.${column.name}: default`);
    }
  }
});

test("timestamps are timestamptz everywhere in the uc tables", () => {
  for (const table of drizzleTables) {
    for (const column of Object.values(getTableColumns(table))) {
      if (column.getSQLType().startsWith("timestamp")) assert.equal(column.getSQLType(), "timestamp with time zone", `${getTableName(table)}.${column.name}`);
    }
  }
});
