import test from "node:test";
import assert from "node:assert/strict";
import { isValidCodePrefix, isValidWorkspaceSlug } from "../prefix.ts";
import { INSERT_CONFIGS_SQL, parsePrefixesFile, planConfigs, workspacesSql } from "./configs.ts";

// use-case-admin configs (docs/use-case/DESIGN.md §10.6, D6). Nomi di workspace inventati.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("--prefixes: oggetto con id di workspace e prefissi di 2-4 lettere maiuscole", () => {
  const ok = parsePrefixesFile({ [id(1).toUpperCase()]: "ACM", [id(2)]: "XY" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual([...ok.prefixes], [[id(1), "ACM"], [id(2), "XY"]]);
  for (const value of [null, [], "ACM", { "ws-1": "ACM" }, { [id(1)]: "acm" }, { [id(1)]: "A" }, { [id(1)]: "ABCDE" }, { [id(1)]: 12 }]) {
    assert.equal(parsePrefixesFile(value).ok, false, JSON.stringify(value));
  }
});

test("una riga per ogni workspace senza; le esistenti restano come sono", () => {
  const planned = planConfigs(
    [
      { id: id(1), name: "Acme Industrie" },
      { id: id(2), name: "Banca Popolare Esempio" },
      { id: id(3), name: "Città Società" },
    ],
    [{ workspaceId: id(2), slug: "bpe", codePrefix: "BP" }],
  );
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.deepEqual(planned.plan.create, [
    { workspaceId: id(1), name: "Acme Industrie", prefix: "AI", prefixFrom: "nome", slug: "acme-industrie" },
    { workspaceId: id(3), name: "Città Società", prefix: "CS", prefixFrom: "nome", slug: "citta-societa" },
  ]);
  assert.deepEqual(planned.plan.existing, [{ workspaceId: id(2), slug: "bpe", codePrefix: "BP", name: "Banca Popolare Esempio" }]);
});

test("slug unici: contro quelli già usati e quelli proposti nello stesso giro", () => {
  const planned = planConfigs(
    [
      { id: id(1), name: "Acme" },
      { id: id(2), name: "ACME" },
      { id: id(3), name: "!!!" },
      { id: id(4), name: "Acme" },
    ],
    [{ workspaceId: id(9), slug: "acme", codePrefix: "ACM" }],
  );
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const slugs = planned.plan.create.map((row) => row.slug);
  assert.deepEqual(slugs, ["acme-2", "acme-3", "ws-00000000", "acme-4"]);
  assert.ok(slugs.every(isValidWorkspaceSlug));
  assert.ok(planned.plan.create.every((row) => isValidCodePrefix(row.prefix)));
  assert.equal(planned.plan.create[2].prefix, "UC", "nome senza lettere: UC");
});

test("--prefixes: vale per i workspace dell'ambito senza riga, altrimenti si ferma", () => {
  const workspaces = [
    { id: id(1), name: "Acme Industrie" },
    { id: id(2), name: "Banca Popolare Esempio" },
  ];
  const existing = [{ workspaceId: id(2), slug: "bpe", codePrefix: "BP" }];
  const ok = planConfigs(workspaces, existing, new Map([[id(1), "ACM"]]));
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.plan.create.map((row) => [row.prefix, row.prefixFrom]), [["ACM", "file"]]);
  assert.equal(planConfigs(workspaces, existing, new Map([[id(2), "BPX"]])).ok, false, "riga esistente");
  assert.equal(planConfigs(workspaces, existing, new Map([[id(7), "ZZ"]])).ok, false, "fuori ambito");
});

test("SQL: enabled false e contatore a zero; un conflitto non ferma le altre righe", () => {
  assert.match(INSERT_CONFIGS_SQL, /false, 0/);
  assert.match(INSERT_CONFIGS_SQL, /ON CONFLICT DO NOTHING/);
  assert.match(INSERT_CONFIGS_SQL, /JOIN workspaces w ON w\.id = x\.workspace_id/);
  assert.match(workspacesSql(true), /WHERE w\.id = \$1::uuid/);
  assert.doesNotMatch(workspacesSql(false), /\$1/);
});
