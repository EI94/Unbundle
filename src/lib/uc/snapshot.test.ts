import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogSnapshot,
  diffSnapshots,
  excludedItems,
  isFrozen,
  snapshotForViewer,
  snapshotHash,
  stableStringify,
  validatedItems,
  type CatalogSnapshot,
} from "./snapshot.ts";
import { answer, item, sampleInput } from "./snapshot.fixtures.ts";

function build(over: Parameters<typeof sampleInput>[0] = {}): CatalogSnapshot {
  const r = buildCatalogSnapshot(sampleInput(over));
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

test("stableStringify sorts keys at every level and drops undefined", () => {
  assert.equal(stableStringify({ b: 1, a: { d: [3, { z: 1, y: undefined, x: 2 }], c: null } }), '{"a":{"c":null,"d":[3,{"x":2,"z":1}]},"b":1}');
  assert.equal(stableStringify({ d: new Date("2026-01-02T03:04:05.000Z"), n: Number.NaN }), '{"d":"2026-01-02T03:04:05.000Z","n":null}');
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => stableStringify(cyclic));
});

test("the hash is stable whatever the input order", () => {
  const a = build();
  const input = sampleInput();
  const b = build({ items: [...input.items].reverse(), links: [...input.links].reverse() });
  assert.equal(snapshotHash(a), snapshotHash(b));
  assert.match(snapshotHash(a), /^[0-9a-f]{64}$/);
  assert.notEqual(snapshotHash(a), snapshotHash(build({ version: 2 })));
});

test("a frozen snapshot carries only validated values and never personal ones", () => {
  const s = build();
  assert.equal(s.schema, "unbundle.uc-catalog/1");
  assert.equal(s.version, 1);
  assert.equal(s.frozen_at, "2026-10-01T10:00:00.000Z");
  const byKey = new Map(s.items.map((i) => [i.key, i]));
  assert.deepEqual(byKey.get("richiesta.durata")?.answer?.value_normalized, { minutes: 42 });
  assert.equal(byKey.get("richiesta.durata")?.answer?.validated, true);
  assert.equal(byKey.get("richiesta.durata")?.unit, "min");
  // In verifica: in una versione congelata non entra la risposta non validata.
  assert.equal(byKey.get("q.esempio.03")?.answer, null);
  // Personale validata: nessun valore.
  const personal = byKey.get("q.esempio.04")?.answer;
  assert.equal(personal?.value, null);
  assert.equal(personal?.value_normalized, null);
  assert.equal(personal?.value_hidden, "personale");
  assert.ok(!JSON.stringify(s).includes("dato personale inventato"));
  // NA firmata.
  assert.equal(byKey.get("q.esempio.02")?.na?.approved_at, "2026-09-22T09:00:00.000Z");
  assert.equal(s.counts.total, 10);
  assert.equal(s.counts.by_status.validata, 4);
  assert.deepEqual(s.items.map((i) => i.key), [...s.items.map((i) => i.key)].sort());
});

test("a draft marks current answers as not validated", () => {
  const s = build({ version: "bozza", frozenAt: null });
  assert.equal(s.frozen_at, null);
  assert.equal(isFrozen(s), false);
  const current = s.items.find((i) => i.key === "q.esempio.03")?.answer;
  assert.equal(current?.validated, false);
  assert.equal(current?.source_kind, "dichiarato_in_call");
  assert.deepEqual(validatedItems(s), [], "a draft never exposes a validated view");
  assert.equal(excludedItems(s).length, s.items.length);
});

test("invalid versions, missing freeze date and duplicate keys are refused", () => {
  assert.equal(buildCatalogSnapshot(sampleInput({ version: 0 })).ok, false);
  assert.equal(buildCatalogSnapshot(sampleInput({ frozenAt: null })).ok, false);
  const input = sampleInput();
  const dup = buildCatalogSnapshot({ ...input, items: [...input.items, item({ key: "q.esempio.01" })] });
  assert.equal(dup.ok, false);
  assert.equal(dup.ok ? "" : dup.code, "chiave_doppia");
});

test("logically deleted items and their links leave the snapshot", () => {
  const input = sampleInput();
  const s = build({ items: input.items.map((i) => (i.key === "richiesta.durata" ? { ...i, deletedAt: "2026-09-30T00:00:00Z" } : i)) });
  assert.ok(!s.items.some((i) => i.key === "richiesta.durata"));
  assert.ok(!s.links.some((l) => l.from === "richiesta.durata" || l.to === "richiesta.durata"));
});

test("the validated view keeps only green or blue items of a frozen version", () => {
  const s = build();
  assert.deepEqual(validatedItems(s).map((i) => i.key), ["q.esempio.01", "q.esempio.02", "q.esempio.04", "q.esempio.05", "richiesta.durata"]);
  const excluded = excludedItems(s);
  assert.ok(excluded.some((e) => e.key === "q.esempio.03" && e.status === "in_verifica"));
  assert.ok(!excluded.some((e) => e.key === "q.esempio.01"));
  // Un NA senza firme non è blu.
  const unsigned = build({ items: sampleInput().items.map((i) => (i.key === "q.esempio.02" ? { ...i, naApprovedAt: null } : i)) });
  assert.ok(!validatedItems(unsigned).some((i) => i.key === "q.esempio.02"));
});

test("value visibility is applied per role", () => {
  const s = build();
  const solo = (roles: Parameters<typeof snapshotForViewer>[1]["roles"]) =>
    snapshotForViewer(s, { roles }).items.find((i) => i.key === "q.esempio.05")?.answer;
  assert.deepEqual(solo(["ls_analista"])?.value, { text: "=SOMMA(A1)" });
  assert.equal(solo(["owner_cliente"])?.value, null);
  assert.equal(solo(["owner_cliente"])?.value_hidden, "visibilita");
  const ownerAndLs = (roles: Parameters<typeof snapshotForViewer>[1]["roles"]) =>
    snapshotForViewer(s, { roles }).items.find((i) => i.key === "q.esempio.01")?.answer?.value;
  assert.ok(ownerAndLs(["owner_cliente"]));
  assert.equal(ownerAndLs(["osservatore"]), null);
  assert.equal(ownerAndLs([]), null);
});

test("diff lists added, removed and changed items with their fields", () => {
  const v1 = build();
  const input = sampleInput();
  const v2 = build({
    version: 2,
    items: [
      ...input.items
        .filter((i) => i.key !== "q.esempio.05")
        .map((i) =>
          i.key === "q.esempio.03"
            ? { ...i, status: "validata" as const, validatedAt: "2026-10-02T00:00:00Z", validatedAnswer: answer({ version: 3 }) }
            : i,
        ),
      item({ key: "q.esempio.06" }),
    ],
    links: [...input.links, { fromKey: "q.esempio.03", toKey: "richiesta.durata", relation: "precisa", cardinality: null, note: null }],
  });
  const d = diffSnapshots(v1, v2);
  assert.equal(d.from_version, 1);
  assert.equal(d.to_version, 2);
  assert.deepEqual(d.added, ["q.esempio.06"]);
  assert.deepEqual(d.removed, ["q.esempio.05"]);
  assert.deepEqual(d.changed, [{ key: "q.esempio.03", fields: ["status", "validated_at", "answer", "links"] }]);
  assert.deepEqual(diffSnapshots(v1, v1).changed, []);
  const first = diffSnapshots(null, v1);
  assert.equal(first.from_version, null);
  assert.equal(first.added.length, v1.items.length);
});
