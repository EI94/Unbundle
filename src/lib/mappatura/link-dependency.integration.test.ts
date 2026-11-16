import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { connect, enabled, insertActivity, newFixture, opts, seed, unseed, type Connection } from "./integration-kit.ts";

// La dipendenza tra due passi che scrive l'assistente (`linkActivityDependency`, docs/mappatura/MAPPATURA-BOARD-PIANO.md
// §5.1, §6) sul database del pacchetto: un'istruzione sola, che scrive solo se le due attività sono del workspace della
// richiesta e quella che dipende è dell'unità della richiesta. Prima della board il tool inseriva qualunque coppia di
// id esistenti, anche di due clienti diversi. Con scripts/use-case-test/run-db-tests.mjs; dati inventati, creati e
// cancellati qui.

const f = newFixture();
let db: Connection;
let link: typeof import("./board-sql.ts")["linkDependencyStatement"];
const ids: Record<"s1" | "s2" | "other" | "foreign", string> = { s1: "", s2: "", other: "", foreign: "" };

const scope = () => ({ workspaceId: f.ws, departmentId: f.unit });
const run = async (where: { workspaceId: string; departmentId: string }, source: string, target: string, type: string | null = null): Promise<boolean> => {
  const [rows] = await db.exec.batch([link(where, source, target, type)]);
  return rows?.[0]?.linked === true;
};
const pairs = async () =>
  (await db.q(`SELECT source_activity_id AS s, target_activity_id AS t, dependency_type AS type FROM activity_dependencies WHERE source_activity_id = ANY($1::uuid[]) OR target_activity_id = ANY($1::uuid[]) ORDER BY 1, 2`, [Object.values(ids)])).map(
    (row) => `${row.s}>${row.t}${row.type ? `:${row.type}` : ""}`,
  );
const revision = async () => Number((await db.q(`SELECT revision FROM mapping_boards WHERE department_id = $1 AND workspace_id = $2`, [f.unit, f.ws]))[0]?.revision ?? -1);

before(async () => {
  if (!enabled) return;
  db = await connect();
  link = (await import("./board-sql.ts")).linkDependencyStatement;
  await seed(db.q, f, "dipendenze");
  ids.s1 = await insertActivity(db.q, f, { title: "Raccolta delle richieste", minutesAgo: 3 });
  ids.s2 = await insertActivity(db.q, f, { title: "Confronto delle offerte", minutesAgo: 2 });
  ids.other = await insertActivity(db.q, f, { title: "Controllo della merce", unit: f.otherUnit });
  ids.foreign = await insertActivity(db.q, f, { title: "Passo di un altro cliente", unit: f.foreignUnit, ws: f.otherWs });
  // La board dell'unità c'è (la prima lettura adotta i passi e crea la sua riga).
  const store = await import("./board-store.ts");
  assert.ok(await store.readBoard(db.exec, scope(), { userId: f.lead, role: "transformation_lead" }));
});

after(async () => {
  if (!enabled) return;
  await unseed(db.q, f);
});

test("una coppia nuova si scrive e alza la revisione della board; la stessa coppia di nuovo riesce senza una riga in più", opts, async () => {
  const start = await revision();
  assert.ok(start >= 0, "la board ha la sua riga");
  assert.equal(await run(scope(), ids.s2, ids.s1, "input"), true);
  assert.deepEqual(await pairs(), [`${ids.s2}>${ids.s1}:input`]);
  assert.equal(await revision(), start + 1, "la board aperta rilegge e trova il collegamento");
  assert.equal(await run(scope(), ids.s2, ids.s1, "input"), true, "una coppia già presente vale come collegata");
  assert.deepEqual(await pairs(), [`${ids.s2}>${ids.s1}:input`]);
  assert.equal(await revision(), start + 1, "niente di nuovo, la revisione resta");
});

test("il passo da cui si dipende può stare in un'altra unità dello stesso workspace", opts, async () => {
  assert.equal(await run(scope(), ids.s1, ids.other), true);
  assert.ok((await pairs()).includes(`${ids.s1}>${ids.other}`));
});

test("rifiutati senza scrivere: la sorgente fuori dall'unità, la destinazione di un altro workspace, un passo da sé, lo scope di un altro workspace", opts, async () => {
  const before = await pairs();
  const start = await revision();
  assert.equal(await run(scope(), ids.other, ids.s1), false, "chi dipende non è di questa unità");
  assert.equal(await run(scope(), ids.s1, ids.foreign), false, "la destinazione è di un altro cliente");
  assert.equal(await run(scope(), ids.s1, ids.s1), false, "un passo non dipende da sé");
  assert.equal(await run({ workspaceId: f.otherWs, departmentId: f.unit }, ids.s1, ids.s2), false, "l'unità non è di quel workspace");
  assert.equal(await run(scope(), ids.s1, "00000000-0000-4000-8000-000000000000"), false, "un id che non c'è");
  assert.deepEqual(await pairs(), before, "nessuna riga scritta");
  assert.equal(await revision(), start, "la board non cambia");
});
