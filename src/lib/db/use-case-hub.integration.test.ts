import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// Schema della 0020 sul database di prova dell'hub (docs/use-case/DESIGN.md §10.1-10.3,
// docs/use-case/PIANO-LAVORI.md H1a): versione, trigger di creazione, CHECK, richieste
// del MCP del team, token personali e lettura con Drizzle.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id>
//   su 127.0.0.1) porta lo schema con il vero ensureDbSchema(): sul database con la 0020
//   la sonda è vera e non cambia nulla; su una copia del modello senza la 0020 applica il
//   DDL dell'hub, come in produzione.
// - Dentro `npm run check` (nessun loader, nessun database) si salta: in testa importa solo
//   moduli di Node e i moduli dell'app arrivano con `await import()` dentro `before()`.
// Lo schema della migrazione (due volte, parità col self-heal, doppioni dei dossier, sonda)
// lo prova scripts/use-case-test/schema-check.mjs.
// Dati sintetici, creati e cancellati dalla suite.
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
type Ddl = typeof import("./use-case-hub-ddl.ts");
type Schema = typeof import("./schema.ts");
type App = {
  q: (text: string, params?: unknown[]) => Promise<Row[]>;
  ddl: Ddl;
  schema: Schema;
  db: typeof import("./index.ts").db;
  eq: typeof import("drizzle-orm").eq;
};
let app: App;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), reviewer: randomUUID(), owner: randomUUID(), leaver: randomUUID() };

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  const ensure = await import("./ensure-schema.ts");
  await ensure.ensureDbSchema();
  const index = await import("./index.ts");
  const { eq } = await import("drizzle-orm");
  app = {
    q: (text, params = []) => sql.query(text, params) as Promise<Row[]>,
    ddl: await import("./use-case-hub-ddl.ts"),
    schema: await import("./schema.ts"),
    db: index.db,
    eq,
  };
  await app.q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova hub', $2)`, [ids.org, `org-hub-${suffix}`]);
  await app.q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova hub')`, [ids.ws, ids.org]);
  await app.q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Revisore di prova', now()), ($3, $4, 'Persona con token', now())`, [
    ids.reviewer,
    `revisore.${suffix}@ls.test`,
    ids.owner,
    `token.${suffix}@cliente.test`,
  ]);
});

after(async () => {
  if (!enabled) return;
  await app.q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await app.q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await app.q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.reviewer, ids.owner, ids.leaver]]);
});

/** Una scheda nuova nella forma di oggi; restituisce id e versione. */
async function newUseCase(fields: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
  const columns = ["workspace_id", "title", ...Object.keys(fields)];
  const values = [ids.ws, `Scheda di prova ${randomBytes(2).toString("hex")}`, ...Object.values(fields)];
  const [row] = await app.q(
    `INSERT INTO use_cases (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id, version`,
    values,
  );
  return { id: String(row.id), version: Number(row.version) };
}

async function versionAfter(id: string, set: string): Promise<number> {
  const [row] = await app.q(`UPDATE use_cases SET ${set} WHERE id = $1 RETURNING version`, [id]);
  return Number(row.version);
}

/** Il messaggio d'errore di una scrittura che deve fallire. */
async function failure(text: string, params: unknown[] = []): Promise<string> {
  try {
    await app.q(text, params);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail(`la scrittura doveva fallire: ${text.slice(0, 80)}`);
}

test("lo schema dell'hub c'è: la sonda del self-heal è vera", opts, async () => {
  const [row] = await app.q(`SELECT ${app.ddl.USE_CASE_HUB_PROBE_SQL} AS current, current_database() AS db`);
  assert.equal(row.db, process.env.UC_TEST_PG_DB);
  assert.equal(row.current, true);
});

test("versione: sale di uno per ogni colonna che una persona modifica", opts, async () => {
  const { id, version } = await newUseCase({ status: "proposed" });
  assert.equal(version, 1);
  // Una modifica per colonna di §10.1. La fascia passa prima dell'importo: insieme non stanno.
  const changes: Array<[column: string, set: string]> = [
    ["title", "title = 'Titolo corretto'"],
    ["description", "description = 'Problema riscritto'"],
    ["flow_description", "flow_description = 'Come funziona'"],
    ["human_in_the_loop", "human_in_the_loop = 'Chi controlla'"],
    ["guardrails", "guardrails = 'Limiti'"],
    ["business_case", "business_case = 'Impatto atteso'"],
    ["data_requirements", "data_requirements = 'Dati'"],
    ["sustainability_impact", "sustainability_impact = 'Impatto ESG'"],
    ["origin", "origin = 'transformation'"],
    ["portfolio_kind", "portfolio_kind = 'best_practice'"],
    ["ai_lab", "ai_lab = 'AI Lab di prova · 12 ott'"],
    ["intake", `intake = '{"area": "Amministrazione"}'::jsonb`],
    ["public_note", "public_note = 'Nota pubblica di prova'"],
    ["custom_scores", `custom_scores = '{"impact": {"tempo": 4}}'::jsonb`],
    ["value_eur_year", "value_eur_year = 18000"],
    ["cost_band", "cost_band = 2"],
    ["cost_eur_once", "cost_band = NULL, cost_eur_once = 40000"],
    ["status", "status = 'accepted'"],
    ["portfolio_review_status", "portfolio_review_status = 'scored'"],
    ["target_quarter", "target_quarter = '2027-Q1'"],
    ["review_by", "review_by = '2027-01-14'"],
  ];
  assert.deepEqual(changes.map(([column]) => column).sort(), [...app.ddl.VERSIONED_USE_CASE_COLUMNS].sort());
  let expected = version;
  for (const [column, set] of changes) {
    expected += 1;
    assert.equal(await versionAfter(id, set), expected, column);
  }
  // Riportare un valore al precedente è di nuovo una modifica.
  assert.equal(await versionAfter(id, "title = 'Titolo di nuovo diverso'"), expected + 1);
});

test("versione: non sale per AI, ricalcoli, codice, date tecniche, valori uguali o version scritta a mano", opts, async () => {
  const { id } = await newUseCase({ status: "proposed", description: "Problema" });
  const unchanged: Array<[label: string, set: string]> = [
    ["ai_suggestion", `ai_suggestion = '{"scores": {"impact": {"tempo": 3}}, "rationale": "stima", "kind": "auto"}'::jsonb`],
    ["overall_impact_score", "overall_impact_score = 3.5"],
    ["overall_feasibility_score", "overall_feasibility_score = 2.5"],
    ["overall_esg_score", "overall_esg_score = 1.5"],
    ["overall_score", "overall_score = 3.1"],
    ["category", "category = 'quick_win'"],
    ["code", `code = 'XX-${String(Math.floor(Math.random() * 9000) + 1000)}'`],
    ["updated_at", "updated_at = now()"],
    ["status_changed_at", "status_changed_at = now() - interval '1 day'"],
    ["stesso titolo", "title = title"],
    ["stesso stato", "status = 'proposed'"],
    ["version a mano", "version = 99"],
    ["tutto insieme", "ai_suggestion = NULL, overall_score = 2.2, category = 'not_yet', updated_at = now(), version = 7"],
  ];
  for (const [label, set] of unchanged) assert.equal(await versionAfter(id, set), 1, label);
});

test("trigger di creazione: una riga «creato» per ogni source, col canale giusto e senza persona", opts, async () => {
  // DESIGN §10.3, scritta qui per esteso: la tabella del documento, non quella del modulo.
  const cases: Array<[source: string | null, channel: string, actorKind: string]> = [
    ["web_proposed", "web", "proponente"],
    ["slack_proposed", "slack", "proponente"],
    ["claude_mcp", "rest", "proponente"],
    ["claude_connector", "connettore", "proponente"],
    ["learning", "corsi", "proponente"],
    ["ai_readiness_assessment", "ai_readiness", "proponente"],
    ["activity_mapping", "activity_mapping", "sistema"],
    [null, "activity_mapping", "sistema"],
    ["manual", "pagina", "proponente"],
    ["team_mcp", "mcp_team", "proponente"],
    ["un_canale_nuovo", "altro", "proponente"],
  ];
  for (const [source, channel, actorKind] of cases) {
    const { id } = await newUseCase({ source, proposed_by: `persona.${suffix}@cliente.test` });
    const events = await app.q(
      `SELECT workspace_id, action, channel, actor_kind, actor_user_id, fields, phase_before, phase_after FROM use_case_events WHERE use_case_id = $1`,
      [id],
    );
    assert.equal(events.length, 1, String(source));
    assert.deepEqual(
      { ...events[0], fields: [...(events[0].fields as string[])] },
      {
        workspace_id: ids.ws,
        action: "creato",
        channel,
        actor_kind: actorKind,
        actor_user_id: null,
        fields: [],
        phase_before: null,
        phase_after: null,
      },
      String(source),
    );
  }
});

test("le modifiche non scrivono righe di Storia da sole: le scrive solo il servizio", opts, async () => {
  const { id } = await newUseCase({ source: "manual" });
  await versionAfter(id, "title = 'Titolo cambiato', status = 'accepted'");
  const [row] = await app.q(`SELECT count(*)::int AS n FROM use_case_events WHERE use_case_id = $1`, [id]);
  assert.equal(row.n, 1);
});

test("Storia: il CHECK su fields rifiuta un valore fuori elenco; actor, canale e azione sono chiusi", opts, async () => {
  const { id } = await newUseCase({ source: "manual" });
  const insert = `INSERT INTO use_case_events (workspace_id, use_case_id, actor_user_id, actor_kind, channel, action, fields)
                  VALUES ($1, $2, $3, $4, $5, $6, $7::text[])`;
  await app.q(insert, [ids.ws, id, ids.reviewer, "persona", "pagina", "modificato", ["titolo", "costo"]]);
  assert.match(
    await failure(insert, [ids.ws, id, ids.reviewer, "persona", "pagina", "modificato", ["titolo", "Il testo scritto da una persona"]]),
    /use_case_events_fields_check/,
  );
  assert.match(await failure(insert, [ids.ws, id, ids.reviewer, "proponente", "pagina", "creato", []]), /use_case_events_actor_check/);
  assert.match(await failure(insert, [ids.ws, id, null, "persona", "email", "modificato", []]), /use_case_events_channel_check/);
  assert.match(await failure(insert, [ids.ws, id, null, "persona", "pagina", "cancellato", []]), /use_case_events_action_check/);
  assert.match(await failure(insert, [ids.ws, id, null, "robot", "pagina", "modificato", []]), /use_case_events_actor_kind_check/);
});

test("Storia: chi lascia Unbundle non porta via le righe, che restano «persona» senza utente", opts, async () => {
  // Una persona del team solo per questa prova, con una sua riga di Storia (DESIGN §10.3).
  await app.q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Revisore che lascia', now())`, [
    ids.leaver,
    `uscente.${suffix}@ls.test`,
  ]);
  const { id } = await newUseCase({ source: "manual" });
  const [event] = await app.q(
    `INSERT INTO use_case_events (workspace_id, use_case_id, actor_user_id, actor_kind, channel, action, fields)
     VALUES ($1, $2, $3, 'persona', 'pagina', 'modificato', ARRAY['titolo']) RETURNING id`,
    [ids.ws, id, ids.leaver],
  );
  await app.q(`DELETE FROM users WHERE id = $1`, [ids.leaver]);
  // Si legge per scheda e per riga, mai per persona (art. 15.4).
  const rows = await app.q(
    `SELECT id, action, actor_kind, actor_user_id, fields FROM use_case_events WHERE use_case_id = $1 ORDER BY action`,
    [id],
  );
  assert.deepEqual(
    rows.map((row) => ({ ...row, fields: [...(row.fields as string[])] })),
    [
      { id: rows[0].id, action: "creato", actor_kind: "proponente", actor_user_id: null, fields: [] },
      { id: event.id, action: "modificato", actor_kind: "persona", actor_user_id: null, fields: ["titolo"] },
    ],
  );
});

test("costo: importo e fascia insieme rifiutati, uno solo ammesso; CHECK su fascia, trimestre, origine e suggerimento", opts, async () => {
  assert.match(
    await failure(`INSERT INTO use_cases (workspace_id, title, cost_eur_once, cost_band) VALUES ($1, 'Doppio costo', 40000, 3)`, [ids.ws]),
    /use_cases_cost_one_source_check/,
  );
  const { id } = await newUseCase({ cost_eur_once: 40000 });
  assert.match(await failure(`UPDATE use_cases SET cost_band = 2 WHERE id = $1`, [id]), /use_cases_cost_one_source_check/);
  assert.equal(await versionAfter(id, "cost_eur_once = NULL, cost_band = 2"), 2);
  const bad: Array<[set: string, constraint: RegExp]> = [
    ["cost_band = 6", /use_cases_cost_band_check/],
    ["cost_band = NULL, cost_eur_once = -1", /use_cases_cost_eur_once_check/],
    ["value_eur_year = 1000000001", /use_cases_value_eur_year_check/],
    ["target_quarter = '2027-Q5'", /use_cases_target_quarter_check/],
    ["target_quarter = 'T1 2027'", /use_cases_target_quarter_check/],
    ["origin = 'altro'", /use_cases_origin_check/],
    ["ai_suggestion = '[1, 2]'::jsonb", /use_cases_ai_suggestion_check/],
  ];
  for (const [set, constraint] of bad) assert.match(await failure(`UPDATE use_cases SET ${set} WHERE id = $1`, [id]), constraint, set);
});

test("richieste del MCP del team: id riservati, chiave unica per principal, stato chiuso", opts, async () => {
  const reserved = [randomUUID(), randomUUID()];
  const insert = `INSERT INTO use_case_mcp_requests (workspace_id, principal_key, idempotency_key, tool, request_hash, reserved_ids, status)
                  VALUES ($1, $2, $3, 'create_use_cases', repeat('e', 64), $4::uuid[], $5)`;
  await app.q(insert, [ids.ws, `user:${ids.reviewer}`, `chiave-${suffix}`, reserved, "pending"]);
  const [row] = await app.q(
    `SELECT reserved_ids, status, attempt, result FROM use_case_mcp_requests WHERE workspace_id = $1 AND idempotency_key = $2`,
    [ids.ws, `chiave-${suffix}`],
  );
  assert.equal(row.status, "pending");
  assert.equal(row.attempt, 1);
  assert.equal(row.result, null);
  assert.deepEqual([...(row.reserved_ids as string[])], reserved);
  assert.match(await failure(insert, [ids.ws, `user:${ids.reviewer}`, `chiave-${suffix}`, null, "pending"]), /use_case_mcp_requests_pkey/);
  assert.match(await failure(insert, [ids.ws, `user:${ids.reviewer}`, `altra-${suffix}`, null, "boh"]), /use_case_mcp_requests_status_check/);
  // Stessa chiave, altro principal: è un'altra richiesta.
  await app.q(insert, [ids.ws, `user:${ids.owner}`, `chiave-${suffix}`, null, "completed"]);
});

test("token personali: owner_user_id facoltativo, il token sparisce con la persona", opts, async () => {
  const insert = `INSERT INTO workspace_integration_tokens (workspace_id, label, token_hash, token_prefix, owner_user_id)
                  VALUES ($1, $2, $3, 'prova...', $4) RETURNING id`;
  const [personal] = await app.q(insert, [ids.ws, "Token personale di prova", `${randomBytes(32).toString("hex")}`, ids.owner]);
  const [shared] = await app.q(insert, [ids.ws, "Token di workspace di prova", `${randomBytes(32).toString("hex")}`, null]);
  await app.q(`DELETE FROM users WHERE id = $1`, [ids.owner]);
  const rows = await app.q(`SELECT id FROM workspace_integration_tokens WHERE id = ANY($1::uuid[])`, [[personal.id, shared.id]]);
  assert.deepEqual(rows.map((r) => r.id), [shared.id]);
  // Ricrea la persona per le prove dopo e per la pulizia.
  await app.q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Persona con token', now())`, [
    ids.owner,
    `token.${suffix}@cliente.test`,
  ]);
});

test("Drizzle legge e scrive le colonne e le tabelle nuove con lo schema dell'app", opts, async () => {
  const { db, eq, schema } = app;
  const [created] = await db
    .insert(schema.useCases)
    .values({ workspaceId: ids.ws, title: "Scheda scritta da Drizzle", source: "web_proposed" })
    .returning();
  assert.equal(created.origin, "adoption");
  assert.equal(created.version, 1);
  assert.equal(created.aiSuggestion, null);
  assert.equal(created.costBand, null);
  assert.equal(created.reviewBy, null);
  const [updated] = await db
    .update(schema.useCases)
    .set({ targetQuarter: "2027-Q2", reviewBy: "2027-03-01", costBand: 3, aiLab: "AI Lab di prova" })
    .where(eq(schema.useCases.id, created.id))
    .returning();
  assert.equal(updated.version, 2);
  assert.equal(updated.reviewBy, "2027-03-01");
  assert.equal(updated.costBand, 3);
  const events = await db.select().from(schema.useCaseEvents).where(eq(schema.useCaseEvents.useCaseId, created.id));
  assert.equal(events.length, 1);
  assert.equal(events[0].channel, "web");
  assert.deepEqual(events[0].fields, []);
  assert.ok(events[0].at instanceof Date);
  const reserved = [randomUUID()];
  await db.insert(schema.useCaseMcpRequests).values({
    workspaceId: ids.ws,
    principalKey: `user:${ids.reviewer}`,
    idempotencyKey: `drizzle-${suffix}`,
    tool: "create_use_cases",
    requestHash: "f".repeat(64),
    reservedIds: reserved,
  });
  const [request] = await db
    .select()
    .from(schema.useCaseMcpRequests)
    .where(eq(schema.useCaseMcpRequests.idempotencyKey, `drizzle-${suffix}`));
  assert.deepEqual(request.reservedIds, reserved);
  assert.equal(request.status, "pending");
  const tokens = await db
    .select({ id: schema.workspaceIntegrationTokens.id, owner: schema.workspaceIntegrationTokens.ownerUserId })
    .from(schema.workspaceIntegrationTokens)
    .where(eq(schema.workspaceIntegrationTokens.workspaceId, ids.ws));
  assert.ok(tokens.every((t) => t.owner === null || typeof t.owner === "string"));
});

test("cancellare una scheda toglie la sua Storia; nessun indice per persona", opts, async () => {
  const { id } = await newUseCase({ source: "manual" });
  await app.q(`DELETE FROM use_cases WHERE id = $1`, [id]);
  const [left] = await app.q(`SELECT count(*)::int AS n FROM use_case_events WHERE use_case_id = $1`, [id]);
  assert.equal(left.n, 0);
  const indexes = await app.q(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('use_cases', 'use_case_events')
       AND (indexdef ~ 'proposed_by' OR indexdef ~ 'actor_user_id')`,
  );
  assert.deepEqual(indexes, []);
});
