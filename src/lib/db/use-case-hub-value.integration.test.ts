import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// Schema della 0022 sul database di prova dell'hub: value_model e la sua versione, esigenze e
// legami, lettura e scrittura con Drizzle.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id>
//   su 127.0.0.1) porta lo schema con il vero ensureDbSchema(): sul database con la 0022 la
//   sonda è vera e non cambia nulla; su una copia del modello senza la 0022 applica il DDL.
// - Dentro `npm run check` (nessun loader, nessun database) si salta.
// La migrazione (due volte, parità col self-heal, database come in produzione, sonda) la
// prova scripts/use-case-test/schema-check.mjs. Dati sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
type App = {
  q: (text: string, params?: unknown[]) => Promise<Row[]>;
  ddl: typeof import("./use-case-hub-value-ddl.ts");
  ensure: typeof import("./ensure-schema.ts");
  schema: typeof import("./schema.ts");
  db: typeof import("./index.ts").db;
  eq: typeof import("drizzle-orm").eq;
  and: typeof import("drizzle-orm").and;
};
let app: App;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), ws2: randomUUID() };

const MODEL = {
  v: 1,
  primary: "tempo",
  components: [
    { key: "tempo", lever: "tempo", label: "Smistamento delle richieste", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" },
  ],
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
};

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  const ensure = await import("./ensure-schema.ts");
  await ensure.ensureDbSchema();
  const index = await import("./index.ts");
  const { and, eq } = await import("drizzle-orm");
  app = {
    q: (text, params = []) => sql.query(text, params) as Promise<Row[]>,
    ddl: await import("./use-case-hub-value-ddl.ts"),
    ensure,
    schema: await import("./schema.ts"),
    db: index.db,
    eq,
    and,
  };
  await app.q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova valore', $2)`, [ids.org, `org-valore-${suffix}`]);
  await app.q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $3, 'Workspace di prova valore'), ($2, $3, 'Secondo workspace di prova')`, [ids.ws, ids.ws2, ids.org]);
});

after(async () => {
  if (!enabled) return;
  await app.q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.ws2]]);
  await app.q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
});

async function newUseCase(fields: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
  const columns = ["workspace_id", "title", ...Object.keys(fields)];
  const values = [ids.ws, `Scheda di prova ${randomBytes(2).toString("hex")}`, ...Object.values(fields)];
  const [row] = await app.q(
    `INSERT INTO use_cases (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id, version`,
    values,
  );
  return { id: String(row.id), version: Number(row.version) };
}

async function versionAfter(id: string, set: string, params: unknown[] = []): Promise<number> {
  const [row] = await app.q(`UPDATE use_cases SET ${set} WHERE id = $1 RETURNING version`, [id, ...params]);
  return Number(row.version);
}

async function failure(text: string, params: unknown[] = []): Promise<string> {
  try {
    await app.q(text, params);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail(`la scrittura doveva fallire: ${text.slice(0, 80)}`);
}

/** Una esigenza con i campi minimi; restituisce l'id. */
async function newNeed(fields: Record<string, unknown> = {}, workspaceId = ids.ws): Promise<string> {
  const all = { workspace_id: workspaceId, type: "requisito", title: "Accesso al gestionale", status: "da_chiedere", ...fields };
  const columns = Object.keys(all);
  const [row] = await app.q(
    `INSERT INTO use_case_needs (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    Object.values(all),
  );
  return String(row.id);
}

test("lo schema della 0022 c'è: la sonda è vera; il DDL si riapplica due volte senza errori", opts, async () => {
  const [row] = await app.q(`SELECT ${app.ddl.USE_CASE_VALUE_PROBE_SQL} AS current, current_database() AS db`);
  assert.equal(row.db, process.env.UC_TEST_PG_DB);
  assert.equal(row.current, true);
  await app.ensure.runUseCaseValueDdl();
  await app.ensure.runUseCaseValueDdl();
  const [again] = await app.q(`SELECT ${app.ddl.USE_CASE_VALUE_PROBE_SQL} AS current`);
  assert.equal(again.current, true);
});

test("versione: sale di uno quando cambia value_model, anche insieme a un'altra colonna", opts, async () => {
  const { id, version } = await newUseCase({ status: "accepted" });
  assert.equal(version, 1);
  assert.equal(await versionAfter(id, "value_model = $2::jsonb", [JSON.stringify(MODEL)]), 2);
  // Lo stesso modello, con le chiavi in un altro ordine: jsonb uguale, versione ferma.
  const reordered = { components: MODEL.components, costs: MODEL.costs, primary: MODEL.primary, v: 1 };
  assert.equal(await versionAfter(id, "value_model = $2::jsonb", [JSON.stringify(reordered)]), 2);
  const changed = { ...MODEL, ease: 4 };
  assert.equal(await versionAfter(id, "value_model = $2::jsonb", [JSON.stringify(changed)]), 3);
  // Insieme a una colonna della 0020: una sola volta.
  assert.equal(await versionAfter(id, "title = 'Titolo nuovo', value_model = $2::jsonb", [JSON.stringify(MODEL)]), 4);
  // Toglierlo è una modifica.
  assert.equal(await versionAfter(id, "value_model = NULL"), 5);
  assert.equal(await versionAfter(id, "value_model = NULL"), 5);
});

test("versione: chi la scrive a mano non la cambia; AI e ricalcoli non la toccano", opts, async () => {
  const { id } = await newUseCase({ status: "accepted" });
  assert.equal(await versionAfter(id, "version = 99"), 1);
  assert.equal(await versionAfter(id, "version = 42, value_model = $2::jsonb", [JSON.stringify(MODEL)]), 2);
  assert.equal(await versionAfter(id, `ai_suggestion = '{"kind": "auto"}'::jsonb, overall_score = 3.3, updated_at = now()`), 2);
  assert.equal(await versionAfter(id, "version = 7"), 2);
});

test("value_model è un oggetto: array, testo e numero rifiutati", opts, async () => {
  const { id } = await newUseCase();
  for (const value of ["[]", '"testo"', "3"]) {
    const message = await failure(`UPDATE use_cases SET value_model = $2::jsonb WHERE id = $1`, [id, value]);
    assert.match(message, /use_cases_value_model_check/, value);
  }
});

test("esigenze: default, stato secondo il tipo, vocabolari chiusi, motivo di archiviazione solo con la data", opts, async () => {
  const id = await newNeed();
  const [row] = await app.q(`SELECT kind, due_is_proposal, sort_order, version, created_at IS NOT NULL AS created FROM use_case_needs WHERE id = $1`, [id]);
  assert.deepEqual(row, { kind: "altro", due_is_proposal: false, sort_order: 0, version: 1, created: true });
  for (const status of app.ddl.USE_CASE_NEED_REQUIREMENT_STATUSES) await newNeed({ status });
  for (const status of app.ddl.USE_CASE_NEED_STEP_STATUSES) await newNeed({ type: "passo", status, title: "Riunione di avvio" });
  const wrongs: Array<[Record<string, unknown>, string]> = [
    [{ status: "fatta" }, "use_case_needs_status_check"],
    [{ type: "passo", status: "validata" }, "use_case_needs_status_check"],
    // Un tipo sconosciuto non ha nemmeno stati ammessi: scatta il primo dei due CHECK.
    [{ type: "attivita" }, "use_case_needs_(status|type)_check"],
    [{ kind: "budget" }, "use_case_needs_kind_check"],
    [{ owner_side: "consulente" }, "use_case_needs_owner_side_check"],
    [{ availability: "domani" }, "use_case_needs_availability_check"],
    [{ archive_reason: "doppione" }, "use_case_needs_archive_check"],
  ];
  for (const [fields, constraint] of wrongs) {
    const message = await newNeed(fields).then(
      () => assert.fail(`doveva fallire: ${JSON.stringify(fields)}`),
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    assert.match(message, new RegExp(constraint), JSON.stringify(fields));
  }
  await newNeed({ archived_at: new Date().toISOString(), archive_reason: "Non serve più" });
});

test("esigenze: import_key unica per workspace, libera tra workspace diversi e quando manca", opts, async () => {
  const key = `import-${suffix}`;
  await newNeed({ import_key: key });
  assert.match(await failure(`INSERT INTO use_case_needs (workspace_id, type, title, status, import_key) VALUES ($1, 'requisito', 'Doppione', 'chiesta', $2)`, [ids.ws, key]), /use_case_needs_import_key_unique/);
  await newNeed({ import_key: key }, ids.ws2);
  await newNeed({ import_key: null });
  await newNeed({ import_key: null });
  // L'upsert per chiave (save_needs) usa il vincolo come bersaglio.
  const [upserted] = await app.q(
    `INSERT INTO use_case_needs (workspace_id, type, title, status, import_key) VALUES ($1, 'requisito', 'Titolo aggiornato', 'chiesta', $2)
     ON CONFLICT (workspace_id, import_key) DO UPDATE SET title = EXCLUDED.title, version = use_case_needs.version + 1 RETURNING title, version`,
    [ids.ws, key],
  );
  assert.deepEqual(upserted, { title: "Titolo aggiornato", version: 2 });
});

test("legami: uno per coppia; spariscono con la scheda o con l'esigenza; le esigenze con il workspace", opts, async () => {
  const need = await newNeed({ title: "Dati delle fatture" });
  const a = await newUseCase();
  const b = await newUseCase();
  await app.q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1, $2), ($1, $3)`, [need, a.id, b.id]);
  assert.match(await failure(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1, $2)`, [need, a.id]), /use_case_need_links_pkey/);
  await app.q(`DELETE FROM use_cases WHERE id = $1`, [a.id]);
  const [left] = await app.q(`SELECT count(*)::int AS links, (SELECT count(*)::int FROM use_case_needs WHERE id = $1) AS needs FROM use_case_need_links WHERE need_id = $1`, [need]);
  assert.deepEqual(left, { links: 1, needs: 1 });
  await app.q(`DELETE FROM use_case_needs WHERE id = $1`, [need]);
  const [gone] = await app.q(`SELECT count(*)::int AS n FROM use_case_need_links WHERE use_case_id = $1`, [b.id]);
  assert.equal(gone.n, 0);
  const ws = randomUUID();
  await app.q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace da cancellare')`, [ws, ids.org]);
  await newNeed({}, ws);
  await app.q(`DELETE FROM workspaces WHERE id = $1`, [ws]);
  const [none] = await app.q(`SELECT count(*)::int AS n FROM use_case_needs WHERE workspace_id = $1`, [ws]);
  assert.equal(none.n, 0);
});

test("Drizzle legge e scrive value_model, esigenze e legami con lo schema dell'app", opts, async () => {
  const { and, db, eq, schema } = app;
  const [card] = await db.insert(schema.useCases).values({ workspaceId: ids.ws, title: "Scheda con benefici", source: "manual" }).returning();
  assert.equal(card.valueModel, null);
  const [updated] = await db
    .update(schema.useCases)
    .set({ valueModel: MODEL as (typeof schema.useCases.$inferInsert)["valueModel"] })
    .where(eq(schema.useCases.id, card.id))
    .returning();
  assert.equal(updated.version, card.version + 1);
  assert.deepEqual(updated.valueModel, MODEL);
  const [need] = await db
    .insert(schema.useCaseNeeds)
    .values({ workspaceId: ids.ws, type: "passo", kind: "decisione", title: "Decidere chi conferma", status: "proposta", dueOn: "2026-11-30", importKey: `drizzle-${suffix}` })
    .returning();
  assert.equal(need.dueOn, "2026-11-30");
  assert.equal(need.dueIsProposal, false);
  assert.ok(need.createdAt instanceof Date);
  await db.insert(schema.useCaseNeedLinks).values({ needId: need.id, useCaseId: card.id });
  const linked = await db
    .select({ title: schema.useCaseNeeds.title, code: schema.useCases.id })
    .from(schema.useCaseNeedLinks)
    .innerJoin(schema.useCaseNeeds, eq(schema.useCaseNeeds.id, schema.useCaseNeedLinks.needId))
    .innerJoin(schema.useCases, eq(schema.useCases.id, schema.useCaseNeedLinks.useCaseId))
    .where(and(eq(schema.useCaseNeeds.workspaceId, ids.ws), eq(schema.useCaseNeedLinks.useCaseId, card.id)));
  assert.deepEqual(linked, [{ title: "Decidere chi conferma", code: card.id }]);
  const [again] = await db
    .insert(schema.useCaseNeeds)
    .values({ workspaceId: ids.ws, type: "passo", title: "Decidere chi conferma i numeri", status: "confermata", importKey: `drizzle-${suffix}` })
    .onConflictDoUpdate({ target: [schema.useCaseNeeds.workspaceId, schema.useCaseNeeds.importKey], set: { title: "Decidere chi conferma i numeri", status: "confermata" } })
    .returning();
  assert.equal(again.id, need.id);
  assert.equal(again.status, "confermata");
});
