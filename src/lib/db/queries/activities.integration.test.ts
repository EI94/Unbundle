import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// `getDependenciesByDepartment` (activities.ts, accanto) sul database del pacchetto. La pagina di prima di un'unità
// completata la chiama sempre: con la board ogni unità completata ha dei passi, e un ritorno alla build di prima la
// incontra con una, due o più attività (docs/mappatura/MAPPATURA-BOARD-PIANO.md §11, «Rollback»).
// Il file non usa il kit della mappatura e sta accanto alla query: la correzione, questa prova e la riga del runner che
// la trova (le suite di src/lib/db/queries) sono un commit solo, che va anche su main da solo.
// Con scripts/use-case-test/run-db-tests.mjs. Dati inventati, creati e cancellati qui.

const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url) && new URL(url!).hostname === "127.0.0.1";
const opts = { skip: !enabled };

const ids = { org: randomUUID(), ws: randomUUID(), unit: randomUUID(), other: randomUUID() };
const suffix = randomBytes(3).toString("hex");
let q: (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Array<Record<string, unknown>>>;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova dipendenze', $2)`, [ids.org, `org-dipendenze-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova dipendenze')`, [ids.ws, ids.org]);
  await q(`INSERT INTO departments (id, workspace_id, name) VALUES ($1, $3, 'Ufficio acquisti'), ($2, $3, 'Magazzino')`, [ids.unit, ids.other, ids.ws]);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
});

async function activity(unit: string, title: string): Promise<string> {
  const id = randomUUID();
  await q(`INSERT INTO activities (id, department_id, workspace_id, title) VALUES ($1, $2, $3, $4)`, [id, unit, ids.ws, title]);
  return id;
}

test("le dipendenze di un'unità con nessuna, una, due o più attività: quelle che toccano l'unità, in un verso o nell'altro", opts, async () => {
  const { getDependenciesByDepartment } = await import("./activities.ts");
  const pairs = async () =>
    (await getDependenciesByDepartment(ids.unit)).map((row) => `${row.sourceActivityId}>${row.targetActivityId}`).sort();

  assert.deepEqual(await pairs(), [], "nessuna attività");
  const richieste = await activity(ids.unit, "Raccolta delle richieste");
  assert.deepEqual(await pairs(), [], "un'attività, nessuna dipendenza");

  const ordine = await activity(ids.unit, "Invio dell'ordine");
  const colli = await activity(ids.other, "Controllo dei colli");
  const scaffale = await activity(ids.other, "Collocazione a scaffale");
  await q(`INSERT INTO activity_dependencies (source_activity_id, target_activity_id, dependency_type) VALUES ($1, $2, 'input'), ($3, $1, 'input'), ($4, $3, 'input')`, [
    ordine,
    richieste,
    colli,
    scaffale,
  ]);
  // Due attività nell'unità: la dipendenza tra loro e quella che arriva da un'altra unità; non quella tra due attività
  // dell'altra unità.
  assert.deepEqual(await pairs(), [`${colli}>${ordine}`, `${ordine}>${richieste}`].sort());
});
