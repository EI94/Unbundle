import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { SubmitContributionDeps } from "../portfolio/submit-contribution.ts";
import type { UcExecutor } from "../db/uc-executor.ts";
import { hashIntegrationToken } from "./auth.ts";
import { EXAMPLE_CONNECTOR_PROFILE_INPUT, EXAMPLE_INSTRUCTIONS_TEMPLATE, EXAMPLE_OUTSIDE_FOUNDATION_NOTE, exampleSubmission } from "./contract.fixtures.ts";
import type { ExposedTokenAlertDeps } from "./exposed-token-alert.ts";
import type { ConnectorHandlerDeps } from "./handler.ts";
import { SEARCH_RESULTS_NOTE } from "./tools.ts";
import { EXAMPLE_GUIDE } from "./tools.fixtures.ts";
import { connectorSearchVectorSql } from "../db/connector-ddl.ts";

// Opt-in integration suite for connector package K6 (prompt WP6) on the connector's own
// local cluster: search of similar contributions (accents, apostrophes, exclusions,
// limits, matching agents), status by code for the contract states, and the hand-off to
// «Casi d'uso» («Avvia caso d'uso» on a contribution that came from the connector, with
// UC_ENABLED=true, then linkedCaseCode and AVVIATA_COME_CASO). Real route handler with the
// SDK client in memory, real SQL; ranking, notifications and Slack are fakes.
//   node scripts/connettore-test/run-db-tests.mjs
// Same guards as route.integration.test.ts. Synthetic data, created and deleted here; test
// tokens are generated at run time and never printed.
const url = process.env.DATABASE_URL;
const enabled = process.env.CONN_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Connector DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), lead: randomUUID(), wsA: randomUUID(), wsB: randomUUID() };
const slugs = { a: `k6-a-${suffix}`, b: `k6-b-${suffix}` };
const LS_DOMAIN = "ls.test";
const tokens = {} as Record<"a" | "b", { token: string; id: string }>;
// Profilo e modello delle istruzioni nella riga del workspace (decisione 1 dell'arresto B).
const BASE_ENV = { MCP_CONNECTOR_ENABLED: "true" };
const SUBMITTER = { name: "Persona di prova K6", email: `proponente.k6.${suffix}@esempio.test` };
const INTERNAL_NOTE = `Nota interna riservata ${suffix}`;
const TITLES = {
  accents: `Qualità delle schede tecniche dei fornitori ${suffix}`,
  started: `Smistamento delle richieste di preventivo ${suffix}`,
  plain: `Qualita delle risposte ai preventivi urgenti ${suffix}`,
};
/** L'espressione del vecchio indice full-text (`use_cases_search_italian_idx`), senza unaccent: solo per il controllo. */
const LEGACY_SEARCH_VECTOR_SQL = `to_tsvector('italian', coalesce(title, '') || ' ' || coalesce(description, ''))`;
const CONTRACT_RESULT_KEYS = ["area", "code", "kind", "month", "statusCode", "statusLabel", "title"];
const STATUS_KEYS = ["code", "title", "kind", "area", "statusCode", "statusLabel", "statusChangedAt", "publicNote", "linkedCaseCode", "duplicateOfCode"];

const fakeAlertDeps: ExposedTokenAlertDeps = { findAdminChannel: async () => null, post: async () => undefined };

type Structured = Record<string, unknown>;
let handle: (request: Request, slug: string, deps: ConnectorHandlerDeps) => Promise<Response>;
let depsOn: ConnectorHandlerDeps;
let depsOff: ConnectorHandlerDeps;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];
const codes: Record<string, string> = {};

/** Moduli della sezione Casi d'uso, caricati solo se le tabelle uc ci sono. */
let uc: {
  exec: UcExecutor;
  templateId: string;
  cases: typeof import("../db/queries/uc-cases.ts");
  shell: typeof import("../db/queries/uc-shell.ts");
  nav: typeof import("../db/queries/uc-nav.ts");
} | null = null;

const captured: string[] = [];
const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };

async function connect(slug: string, token: string, deps: ConnectorHandlerDeps = depsOn) {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:53130/api/mcp/connettore/${slug}`), {
    fetch: async (input: string | URL, init?: RequestInit) => handle(new Request(input, init), slug, deps),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "prova-k6", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, content: result.structuredContent as Structured };
}

async function search(client: Client, query: string, extra: Record<string, unknown> = {}) {
  const out = await call(client, "find_similar_contributions", { query, ...extra });
  assert.equal(out.isError, false, JSON.stringify(out.content));
  return out.content as { results: Structured[]; matchingAgents: Structured[]; note: string };
}

async function status(client: Client, code: string) {
  const out = await call(client, "get_contribution_status", { code });
  assert.equal(out.isError, false, JSON.stringify(out.content));
  return out.content;
}

/** Giorno di oggi in ora italiana, dall'orologio del database. */
async function romeToday() {
  return String((await one(`SELECT to_char(now() AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS d`)).d);
}

before(async () => {
  if (!enabled) return;
  for (const level of ["log", "info", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      originalConsole[level](...args);
    };
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  const [integrations, appTools, handler, rest] = await Promise.all([
    import("../db/queries/workspace-integrations.ts"),
    import("./app-tools.ts"),
    import("./handler.ts"),
    import("../portfolio/submission-http.ts"),
  ]);
  handle = handler.handleConnectorRequest;
  const submit: SubmitContributionDeps = {
    ...rest.appSubmitContributionDeps,
    autoScore: async (params) => {
      const useCase = await rest.appSubmitContributionDeps.getUseCaseById(params.useCaseId);
      if (!useCase) throw new Error("missing");
      return useCase;
    },
    notify: async () => {},
  };
  const deps = (env: Record<string, string>) => appTools.appConnectorHandlerDeps({ schedule: () => {}, env, submit, alertDeps: fakeAlertDeps });
  depsOn = deps({ ...BASE_ENV, UC_ENABLED: "true" });
  depsOff = deps(BASE_ENV);

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova K6', $2)`, [ids.org, `org-k6-${suffix}`]);
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Lateral Space di prova', now())`, [ids.lead, `k6-lead-${suffix}@${LS_DOMAIN}`]);
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'transformation_lead')`, [ids.lead, ids.org]);
  for (const [id, name] of [[ids.wsA, "A"], [ids.wsB, "B"]]) {
    await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)`, [id, ids.org, `Workspace K6 ${name} ${suffix}`]);
  }
  const guide = JSON.stringify(EXAMPLE_GUIDE);
  await q(
    `INSERT INTO workspace_connector_configs (workspace_id, slug, enabled, code_prefix, workspace_display_name, guide, guide_version, profile, instructions_template)
     VALUES ($1, $2, true, 'TJ', 'Alfa e Beta', $3::jsonb, '2026-10.1', $6::jsonb, $7), ($4, $5, true, 'TB', 'Gamma', $3::jsonb, '2026-10.1', $6::jsonb, $7)`,
    [ids.wsA, slugs.a, guide, ids.wsB, slugs.b, JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT), EXAMPLE_INSTRUCTIONS_TEMPLATE]
  );
  for (const [name, workspaceId] of [["a", ids.wsA], ["b", ids.wsB]] as const) {
    const { token, row } = await integrations.createConnectorIntegrationToken({ workspaceId, label: "Connettore di prova K6", createdByUserId: ids.lead });
    tokens[name] = { token, id: row.id };
  }

  // Sezione Casi d'uso: solo se le tabelle uc esistono (il ramo del connettore parte da feat/casi-duso).
  const present = await one(`SELECT to_regclass('public.uc_cases') IS NOT NULL AS ok`);
  if (present.ok === true) {
    const [executor, templates, load, cases, shell, nav] = await Promise.all([
      import("../db/uc-executor.ts"),
      import("../db/queries/uc-templates.ts"),
      import("../uc/template/load.ts"),
      import("../db/queries/uc-cases.ts"),
      import("../db/queries/uc-shell.ts"),
      import("../db/queries/uc-nav.ts"),
    ]);
    const exec = executor.createUcExecutor(sql);
    const value = JSON.parse(readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8")) as Record<string, unknown>;
    value.key = `prova.connettore_${suffix}`;
    const plan = load.planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.wsA });
    assert.ok(plan.ok);
    const loaded = await templates.applyTemplateLoad(exec, plan.plan, { actorUserId: ids.lead, publish: true });
    assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
    uc = { exec, templateId: loaded.value.templateId, cases, shell, nav };
  }
});

after(async () => {
  if (!enabled) return;
  Object.assign(console, originalConsole);
  const patterns = [ids.wsA, ids.wsB, ...Object.values(tokens).map((t) => t.id)].map((p) => `%${p}%`);
  await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE ANY($1::text[])`, [patterns]);
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.lead]);
});

test("ricerca: parole accentate, apostrofi e simboli trovano la segnalazione; solo i campi del contratto e la nota", opts, async () => {
  const client = await connect(slugs.a, tokens.a.token);
  const submitted = await call(client, "submit_contribution", {
    ...exampleSubmission({
      idempotencyKey: `k6-${suffix}-0001`,
      title: TITLES.accents,
      problem: "L'attività di verifica delle schede tecniche si fa a mano, perché i formati cambiano a ogni fornitore.",
      submittedBy: SUBMITTER,
      relatedAgent: "atlante",
    }),
  });
  assert.equal(submitted.isError, false, JSON.stringify(submitted.content));
  codes.accents = String(submitted.content.code);
  await q(`UPDATE use_cases SET review_notes = $3, custom_scores = '{"kpi": 4}'::jsonb WHERE workspace_id = $1 AND code = $2`, [ids.wsA, codes.accents, INTERNAL_NOTE]);

  for (const query of [
    "qualità schede fornitori", // tre parole chiave, una accentata
    "dell'attività perché", // apostrofo e accenti; «dell» e «perché» sono parole vuote
    "qualità & schede | !fornitori <-> :* \"tecniche\"", // simboli della sintassi di tsquery: tolti
    "QUALITÀ   Schede", // maiuscole
    "qualita", // una parola sola, senza accento: la trova solo unaccent (coda della 0019)
    "QUALITA", // lo stesso, in maiuscolo
  ]) {
    const found = await search(client, query);
    const hit = found.results.find((r) => r.code === codes.accents);
    assert.ok(hit, `${query}: ${JSON.stringify(found.results.map((r) => r.code))}`);
    assert.deepEqual(Object.keys(hit).sort(), [...CONTRACT_RESULT_KEYS, "relatedAgent"].sort(), query);
    assert.equal(hit.title, TITLES.accents);
    assert.equal(hit.statusCode, "RICEVUTA");
    assert.equal(hit.relatedAgent, "atlante");
    assert.match(String(hit.month), /^\d{4}-\d{2}$/);
    assert.equal(found.note, SEARCH_RESULTS_NOTE);
    const text = JSON.stringify(found);
    for (const forbidden of [SUBMITTER.name, SUBMITTER.email, INTERNAL_NOTE, EXAMPLE_OUTSIDE_FOUNDATION_NOTE, "kpi", "reviewNotes", "proposedBy", "submittedAt"]) {
      assert.equal(text.includes(forbidden), false, `${query}: ${forbidden}`);
    }
  }
  // Il contrario: una parola scritta senza accento nel titolo si trova scrivendola con l'accento.
  const plain = await call(client, "submit_contribution", {
    ...exampleSubmission({ idempotencyKey: `k6-${suffix}-0003`, title: TITLES.plain, submittedBy: SUBMITTER }),
  });
  assert.equal(plain.isError, false, JSON.stringify(plain.content));
  codes.plain = String(plain.content.code);
  const accented = await search(client, "qualità");
  assert.ok(accented.results.some((r) => r.code === codes.plain), JSON.stringify(accented.results.map((r) => r.code)));
  assert.ok(accented.results.some((r) => r.code === codes.accents), "e anche il titolo con l'accento");
  // Controllo: con l'espressione del vecchio indice (senza unaccent) le stesse parole singole non
  // si trovano, perché la configurazione italian riduce «qualità» a «qualit» e «qualita» a «qual».
  // Quindi la ricerca sopra trova grazie a public.connector_unaccent, non per caso.
  for (const [query, code, label] of [
    ["qualita", codes.accents, "«qualita» e il titolo «Qualità»"],
    ["qualità", codes.plain, "«qualità» e il titolo «Qualita»"],
  ] as const) {
    const row = await one(
      `SELECT ${LEGACY_SEARCH_VECTOR_SQL} @@ websearch_to_tsquery('italian', $3) AS legacy,
              ${connectorSearchVectorSql("")} @@ websearch_to_tsquery('italian', public.connector_unaccent($3)) AS unaccented
         FROM use_cases WHERE workspace_id = $1 AND code = $2`,
      [ids.wsA, code, query]
    );
    assert.deepEqual(row, { legacy: false, unaccented: true }, label);
  }
  // Una ricerca di sole parole vuote o simboli non trova nulla e non dà errore.
  assert.deepEqual((await search(client, "della per con")).results, []);
  assert.deepEqual((await search(client, "!!! ??? ...")).results, []);
  await client.close();
});

test("ricerca: agenti già progettati dalle parole chiave della guida, anche senza segnalazioni simili", opts, async () => {
  const client = await connect(slugs.a, tokens.a.token);
  const found = await search(client, "bozze di risposta alle email dei clienti");
  assert.deepEqual(found.matchingAgents, [{ id: "atlante", nome: "ATLANTE", sistema: "Sistema Alfa", cosaFa: "Prepara bozze di risposta" }]);
  assert.equal(JSON.stringify(found).includes("keywords"), false);
  assert.deepEqual((await search(client, "qualità schede fornitori")).matchingAgents, []);
  await client.close();
});

/** Le righe della tabella degli stati, inserite come le lascia la dashboard. */
// `set`: colonne in più, con `$3` = codice della prima segnalazione e `$4` = persona di Lateral Space.
const STATE_ROWS: Array<{ n: string; status: string; review: string; set?: string; code: string; label: (first: string) => string }> = [
  { n: "0101", status: "proposed", review: "needs_inputs", code: "RICEVUTA", label: () => "Ricevuta" },
  { n: "0102", status: "proposed", review: "in_review", code: "IN_VALUTAZIONE", label: () => "In valutazione" },
  {
    n: "0103",
    status: "proposed",
    review: "in_review",
    set: `intake = jsonb_build_object('possibleDuplicateOf', $3::text)`,
    code: "POSSIBILE_DOPPIONE",
    label: (first) => `In valutazione (possibile doppione di ${first})`,
  },
  {
    n: "0104",
    status: "proposed",
    review: "needs_inputs",
    set: `reviewed_by = $4::uuid, public_note = 'Serve il numero di pratiche al mese.'`,
    code: "SERVONO_INFORMAZIONI",
    label: () => "Servono informazioni da te",
  },
  { n: "0105", status: "proposed", review: "scored", code: "VALUTATA", label: () => "Valutata, in attesa di decisione" },
  { n: "0106", status: "accepted", review: "scored", code: "APPROVATA", label: () => "Approvata" },
  { n: "0107", status: "in_progress", review: "scored", code: "IN_SVILUPPO", label: () => "In sviluppo" },
  { n: "0108", status: "implemented", review: "scored", code: "REALIZZATA", label: () => "Realizzata" },
  { n: "0109", status: "rejected", review: "scored", code: "NON_AVVIATA", label: () => "Non avviata per ora" },
  {
    n: "0110",
    status: "proposed",
    review: "archived",
    set: `intake = jsonb_build_object('archiveReason', 'duplicato', 'duplicateOfCode', $3::text)`,
    code: "DOPPIONE",
    label: (first) => `Unita a ${first}`,
  },
  {
    n: "0111",
    status: "accepted",
    review: "archived",
    set: `intake = jsonb_build_object('archiveReason', 'superato')`,
    code: "ARCHIVIATA",
    label: () => "Archiviata",
  },
];

test("stato per codice: gli stati del contratto letti dal database, con il giorno del cambio in ora italiana", opts, async () => {
  for (const row of STATE_ROWS) {
    await q(
      `INSERT INTO use_cases (workspace_id, code, title, description, status, portfolio_review_status, portfolio_kind, review_notes, proposed_by)
       VALUES ($1, $2, $3, 'Registro di prova per la tabella degli stati.', $4::use_case_status, $5::portfolio_review_status, 'use_case_ai', $6, $7)`,
      [ids.wsA, `TJ-${row.n}`, `Registro delle prove ${row.n} ${suffix}`, row.status, row.review, INTERNAL_NOTE, SUBMITTER.name]
    );
    if (row.set) {
      await q(`UPDATE use_cases SET ${row.set} WHERE workspace_id = $1 AND code = $2 AND $3::text IS NOT NULL AND $4::uuid IS NOT NULL`, [
        ids.wsA,
        `TJ-${row.n}`,
        codes.accents,
        ids.lead,
      ]);
    }
  }
  const today = await romeToday();
  const client = await connect(slugs.a, tokens.a.token);
  for (const row of STATE_ROWS) {
    const content = await status(client, `TJ-${row.n}`);
    assert.deepEqual(Object.keys(content), STATUS_KEYS, row.n);
    assert.equal(content.statusCode, row.code, row.n);
    assert.equal(content.statusLabel, row.label(codes.accents), row.n);
    assert.equal(content.statusChangedAt, today, row.n);
    assert.equal(content.linkedCaseCode, null, row.n);
    assert.equal(content.duplicateOfCode, row.code === "DOPPIONE" ? codes.accents : null, row.n);
    assert.equal(content.publicNote, row.code === "SERVONO_INFORMAZIONI" ? "Serve il numero di pratiche al mese." : null, row.n);
    const text = JSON.stringify(content);
    for (const forbidden of [INTERNAL_NOTE, SUBMITTER.name, ids.lead, "reviewedBy", "score"]) assert.equal(text.includes(forbidden), false, `${row.n}: ${forbidden}`);
  }
  // statusChangedAt viene da status_changed_at, come giorno in ora italiana.
  await q(`UPDATE use_cases SET status_changed_at = '2026-03-29 22:30:00+00' WHERE workspace_id = $1 AND code = 'TJ-0101'`, [ids.wsA]);
  assert.equal((await status(client, "TJ-0101")).statusChangedAt, "2026-03-30", "00:30 CEST del 30 marzo");
  await q(`UPDATE use_cases SET status_changed_at = '2026-10-25 22:30:00+00' WHERE workspace_id = $1 AND code = 'TJ-0101'`, [ids.wsA]);
  assert.equal((await status(client, "TJ-0101")).statusChangedAt, "2026-10-25", "23:30 CET del 25 ottobre");
  // Un cambio di stato vero (il trigger) riporta il giorno a oggi.
  await q(`UPDATE use_cases SET portfolio_review_status = 'in_review' WHERE workspace_id = $1 AND code = 'TJ-0101'`, [ids.wsA]);
  const moved = await status(client, "TJ-0101");
  assert.equal(moved.statusCode, "IN_VALUTAZIONE");
  assert.equal(moved.statusChangedAt, today);
  await q(`UPDATE use_cases SET portfolio_review_status = 'needs_inputs' WHERE workspace_id = $1 AND code = 'TJ-0101'`, [ids.wsA]);
  // Nascosta dalla ricerca: forma ridotta, con titolo, area e nota pubblica null.
  await q(`UPDATE use_cases SET intake = coalesce(intake, '{}'::jsonb) || '{"hiddenFromSearch": true, "area": "amministrazione"}'::jsonb WHERE workspace_id = $1 AND code = 'TJ-0104'`, [ids.wsA]);
  const hidden = await status(client, "TJ-0104");
  assert.deepEqual(hidden, {
    code: "TJ-0104",
    title: null,
    kind: null,
    area: null,
    statusCode: "SERVONO_INFORMAZIONI",
    statusLabel: "Servono informazioni da te",
    statusChangedAt: today,
    publicNote: null,
    linkedCaseCode: null,
    duplicateOfCode: null,
  });
  // Senza codice, in fase 1 (identità dichiarata): identity_required.
  const noCode = await call(client, "get_contribution_status", {});
  assert.equal(noCode.isError, true);
  assert.equal(noCode.content.error, "identity_required");
  await client.close();
});

test("ricerca: escluse nascoste, archiviate non doppioni e senza codice; il doppione archiviato resta; 5 risultati di default, al massimo 10", opts, async () => {
  await q(
    `INSERT INTO use_cases (workspace_id, title, description, status) VALUES ($1, $2, 'Registro di prova senza codice.', 'proposed')`,
    [ids.wsA, `Registro delle prove senza codice ${suffix}`]
  );
  const client = await connect(slugs.a, tokens.a.token);
  const all = await search(client, "registro prove", { limit: 10 });
  const found = all.results.map((r) => String(r.code));
  // 11 righe della tabella: fuori la nascosta (0104) e l'archiviata non doppione (0111); dentro il doppione (0110).
  assert.equal(found.length, 9, found.join(","));
  for (const code of ["TJ-0104", "TJ-0111"]) assert.equal(found.includes(code), false, code);
  assert.ok(all.results.every((r) => typeof r.code === "string" && r.code !== ""), "nessuna senza codice");
  const duplicate = all.results.find((r) => r.code === "TJ-0110");
  assert.equal(duplicate?.statusCode, "DOPPIONE");
  assert.equal(duplicate?.statusLabel, `Unita a ${codes.accents}`);
  assert.equal((await search(client, "registro prove")).results.length, 5, "5 di default");
  const tooMany = await call(client, "find_similar_contributions", { query: "registro prove", limit: 11 });
  assert.equal(tooMany.content.error, "invalid_payload");
  // Un altro workspace non vede nulla di A.
  const other = await connect(slugs.b, tokens.b.token);
  assert.deepEqual((await search(other, "registro prove", { limit: 10 })).results, []);
  assert.equal((await call(other, "get_contribution_status", { code: "TJ-0106" })).content.error, "not_found");
  await other.close();
  await client.close();
});

test("«Avvia caso d'uso» su una segnalazione del connettore (UC_ENABLED=true): pulsante, procedura e stato AVVIATA_COME_CASO", opts, async (t) => {
  if (!uc) return t.skip("tabelle uc assenti in questo database");
  const client = await connect(slugs.a, tokens.a.token);
  const key = `k6-${suffix}-0002`;
  const payload = exampleSubmission({ idempotencyKey: key, title: TITLES.started, submittedBy: SUBMITTER });
  const submitted = await call(client, "submit_contribution", { ...payload });
  assert.equal(submitted.content.statusCode, "RICEVUTA");
  const code = String(submitted.content.code);
  const card = await one(`SELECT id::text AS id, source FROM use_cases WHERE workspace_id = $1 AND code = $2`, [ids.wsA, code]);
  assert.equal(card.source, "claude_connector");
  const useCaseId = String(card.id);

  // Lateral Space approva la segnalazione dalla dashboard.
  await q(`UPDATE use_cases SET status = 'accepted', portfolio_review_status = 'scored', reviewed_by = $3 WHERE id = $1 AND workspace_id = $2`, [useCaseId, ids.wsA, ids.lead]);
  assert.equal((await status(client, code)).statusCode, "APPROVATA");

  const previous = { enabled: process.env.UC_ENABLED, domains: process.env.UC_LS_EMAIL_DOMAINS, workspaces: process.env.UC_WORKSPACE_IDS };
  process.env.UC_ENABLED = "true";
  process.env.UC_LS_EMAIL_DOMAINS = LS_DOMAIN;
  // Dal ridisegno dei Casi d'uso la sezione si accende anche per workspace (UC_WORKSPACE_IDS).
  process.env.UC_WORKSPACE_IDS = ids.wsA;
  try {
    // Il pulsante della scheda (`use-cases/[useCaseId]/page.tsx`): visibile a Lateral Space.
    const link = await uc.nav.portfolioCaseLink({ userId: ids.lead, workspaceId: ids.wsA, role: "transformation_lead", useCaseId, useCaseStatus: "accepted" });
    assert.deepEqual(link, { existing: null, canStart: true });
    // La procedura «Nuovo caso» (`casi-duso/nuovo?useCaseId=…`) elenca la scheda e la preseleziona.
    const startable = await uc.shell.listStartablePortfolioCards(uc.exec, ids.wsA);
    assert.ok(startable.some((c) => c.id === useCaseId && c.title === TITLES.started));
    // Il server della procedura (`createCaseAction` → `createCase`), come dal pulsante.
    const lead = await uc.cases.loadUserContext(uc.exec, ids.lead, [LS_DOMAIN]);
    assert.equal(lead?.isLateralSpace, true);
    const caseCode = `K6-UC-${suffix.toUpperCase()}`;
    const created = await uc.cases.createCase(uc.exec, {
      workspaceId: ids.wsA,
      user: lead!,
      canReviewWorkspacePortfolio: true,
      input: { templateId: uc.templateId, code: caseCode, title: TITLES.started, portfolioUseCaseId: useCaseId },
    });
    assert.ok(created.ok, created.ok ? "" : created.message);
    assert.equal(created.value.code, caseCode);
    // Dopo: la scheda porta al caso, non si avvia un secondo caso, non è più tra quelle avviabili.
    assert.deepEqual(
      await uc.nav.portfolioCaseLink({ userId: ids.lead, workspaceId: ids.wsA, role: "transformation_lead", useCaseId, useCaseStatus: "accepted" }),
      { existing: { id: created.value.caseId, code: caseCode }, canStart: false }
    );
    const again = await uc.cases.createCase(uc.exec, {
      workspaceId: ids.wsA,
      user: lead!,
      canReviewWorkspacePortfolio: true,
      input: { templateId: uc.templateId, code: `${caseCode}-B`, title: TITLES.started, portfolioUseCaseId: useCaseId },
    });
    assert.equal(again.ok ? null : again.code, "caso_gia_avviato");
    assert.equal((await uc.shell.listStartablePortfolioCards(uc.exec, ids.wsA)).some((c) => c.id === useCaseId), false);

    // Il connettore: stato AVVIATA_COME_CASO con il codice del caso, nello stato e nella ricerca.
    const started = await status(client, code);
    assert.equal(started.statusCode, "AVVIATA_COME_CASO");
    assert.equal(started.statusLabel, "Avviata come caso d'uso");
    assert.equal(started.linkedCaseCode, caseCode);
    // statusChangedAt: il giorno dell'avvio del dossier (setup_completed_at, ora italiana),
    // non quello dell'ultimo cambio della scheda (decisione del 19/10/2026).
    const setupDay = await one(`SELECT to_char(setup_completed_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS d FROM uc_cases WHERE id = $1`, [created.value.caseId]);
    assert.equal(started.statusChangedAt, String(setupDay.d));
    await q(`UPDATE use_cases SET status_changed_at = '2026-10-01 08:00:00+00' WHERE id = $1`, [useCaseId]);
    await q(`UPDATE uc_cases SET setup_completed_at = '2026-10-15 22:30:00+00' WHERE id = $1`, [created.value.caseId]);
    assert.equal((await status(client, code)).statusChangedAt, "2026-10-16", "00:30 CEST del 16 ottobre");
    await q(`UPDATE uc_cases SET setup_completed_at = '2026-10-25 22:30:00+00' WHERE id = $1`, [created.value.caseId]);
    assert.equal((await status(client, code)).statusChangedAt, "2026-10-25", "23:30 CET del 25 ottobre");
    await q(`UPDATE uc_cases SET setup_completed_at = now() WHERE id = $1`, [created.value.caseId]);
    const hit = (await search(client, "smistamento richieste preventivo")).results.find((r) => r.code === code);
    assert.equal(hit?.statusCode, "AVVIATA_COME_CASO");
    // Lo stesso invio ripetuto (stessa chiave) risponde con lo stato attuale, come lo stato per codice.
    const replay = await call(client, "submit_contribution", { ...payload });
    assert.equal(replay.content.duplicate, true);
    assert.equal(replay.content.statusCode, "AVVIATA_COME_CASO");

    // Senza UC_ENABLED nell'app: nessuna lettura uc, la segnalazione resta APPROVATA, con il giorno della scheda.
    const off = await connect(slugs.a, tokens.a.token, depsOff);
    const plain = await status(off, code);
    assert.equal(plain.statusCode, "APPROVATA");
    assert.equal(plain.linkedCaseCode, null);
    assert.equal(plain.statusChangedAt, "2026-10-01");
    await off.close();

    // Un caso non completato (creazione a metà) non conta.
    await q(`UPDATE uc_cases SET setup_completed_at = NULL WHERE id = $1`, [created.value.caseId]);
    const incomplete = await status(client, code);
    assert.equal(incomplete.statusCode, "APPROVATA");
    assert.equal(incomplete.linkedCaseCode, null);
    await q(`UPDATE uc_cases SET setup_completed_at = now() WHERE id = $1`, [created.value.caseId]);

    // Nascosta dalla ricerca: forma ridotta senza il codice del caso, stato invariato.
    await q(`UPDATE use_cases SET intake = intake || '{"hiddenFromSearch": true}'::jsonb WHERE id = $1`, [useCaseId]);
    const reduced = await status(client, code);
    assert.equal(reduced.statusCode, "AVVIATA_COME_CASO");
    assert.equal(reduced.linkedCaseCode, null);
    assert.equal(reduced.title, null);
    await q(`UPDATE use_cases SET intake = intake - 'hiddenFromSearch' WHERE id = $1`, [useCaseId]);

    // Un altro workspace non vede né la segnalazione né il caso.
    const other = await connect(slugs.b, tokens.b.token);
    assert.equal((await call(other, "get_contribution_status", { code })).content.error, "not_found");
    await other.close();
  } finally {
    if (previous.enabled === undefined) delete process.env.UC_ENABLED;
    else process.env.UC_ENABLED = previous.enabled;
    if (previous.domains === undefined) delete process.env.UC_LS_EMAIL_DOMAINS;
    else process.env.UC_LS_EMAIL_DOMAINS = previous.domains;
    if (previous.workspaces === undefined) delete process.env.UC_WORKSPACE_IDS;
    else process.env.UC_WORKSPACE_IDS = previous.workspaces;
    await client.close();
  }
});

test("log: in tutta la suite nessun token, hash, testo della segnalazione, nome o email", opts, () => {
  const secrets = Object.values(tokens).flatMap((t) => [t.token, hashIntegrationToken(t.token)]);
  for (const line of captured) {
    for (const secret of secrets) assert.equal(line.includes(secret), false);
    for (const text of [...Object.values(TITLES), SUBMITTER.name, SUBMITTER.email, INTERNAL_NOTE, "schede tecniche", "Registro delle prove"]) {
      assert.equal(line.includes(text), false, "testo nel log");
    }
  }
  assert.ok(captured.some((line) => line.startsWith("[mcp] call ") && line.includes('"tool":"find_similar_contributions"')));
});
