import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// «Contesto nel lavoro» sul database del pacchetto (rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §5.1): la 0041 e la sua
// sonda, i tre CHECK allargati, le letture per la scheda, il dossier, gli agenti e i prompt, la freschezza e la notte, gli
// avvisi in campanella e i loro agganci, i legami con «Cosa serve», `unbundle impara` e `unbundle nota`, le fonti di
// risposte che non si tolgono.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Dati
//   sintetici e inventati (codici XX-…, persone «Prova …»), creati e cancellati qui. Nessun modello, nessuna e-mail.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let ensure: typeof import("../../db/ensure-schema.ts");
let ddl: typeof import("../../db/context-work-ddl.ts");
let store: typeof import("../../db/queries/context-store.ts");
let work: typeof import("../../db/queries/context-work.ts");
let memory: typeof import("../../db/queries/context-memory.ts");
let freshness: typeof import("../../db/queries/context-freshness.ts");
let needs: typeof import("../../db/queries/context-needs.ts");
let notices: typeof import("../../db/queries/context-notices.ts");
let proposals: typeof import("../../db/queries/context-proposals.ts");
let learning: typeof import("../../db/queries/context-learning.ts");
let sources: typeof import("../../db/queries/context-sources.ts");

const LS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
/** I codici degli use case di prova (`^[A-Z]{2,4}-[0-9]{4,5}$`): i workspace sono nuovi a ogni giro. */
const CODE = (n: number) => `XX-${String(10 + n).padStart(4, "0")}`;

/**
 * Le persone. Nel workspace A (il cliente, con l'ok ai sub-responsabili):
 * - ls: Lateral Space, responsabile del dossier (ls_lead); dev: Lateral Space, sviluppatore del dossier;
 * - rev: cliente, Analista (revisore); con: cliente, Contributore;
 * - ext: costruisce da fuori Lateral Space (Analista, e-mail verificata, concessione sullo use case A, osservatore);
 * - own: cliente, responsabile del cliente nel dossier (owner_cliente), revisore.
 * Nel workspace B (senza l'ok): lsb, Lateral Space.
 */
const people = ["ls", "dev", "rev", "con", "ext", "own", "lsb"] as const;
type Person = (typeof people)[number];
const ids = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  ucA: randomUUID(),
  ucB: randomUUID(),
  ucC: randomUUID(),
  ucX: randomUUID(),
  template: randomUUID(),
  caseA: randomUUID(),
  caseC: randomUUID(),
  ...(Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>),
};
const EMAIL: Record<Person, string> = {
  ls: `ls-${suffix}@ls.test`,
  dev: `dev-${suffix}@ls.test`,
  rev: `rev-${suffix}@cliente.test`,
  con: `con-${suffix}@cliente.test`,
  ext: `ext-${suffix}@esterno.test`,
  own: `own-${suffix}@cliente.test`,
  lsb: `lsb-${suffix}@ls.test`,
};
const ROLE: Record<Person, ["wsA" | "wsB", string]> = {
  ls: ["wsA", "transformation_lead"],
  dev: ["wsA", "analyst"],
  rev: ["wsA", "analyst"],
  con: ["wsA", "contributor"],
  ext: ["wsA", "analyst"],
  own: ["wsA", "function_lead"],
  lsb: ["wsB", "transformation_lead"],
};

type Actor = import("../visibility.ts").ContextActor;
const actor = (person: Person, channel: Actor["channel"] = "web"): Actor => ({
  workspaceId: ids[ROLE[person][0]],
  userId: ids[person],
  role: ROLE[person][1],
  isLateralSpace: EMAIL[person].endsWith("@ls.test"),
  channel,
});

function okValue<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string; fieldErrors?: Record<string, string> }): T {
  assert.ok(result.ok, result.ok ? "" : `${result.error}: ${result.message} ${JSON.stringify(result.fieldErrors ?? {})}`);
  return (result as { ok: true; value: T }).value;
}
const errorOf = (result: { ok: boolean; error?: string }) => (result.ok ? null : (result.error ?? null));

/** Una fonte di prova nel workspace A (appunti di una call, «Solo Lateral Space»). */
async function insertSource(over: { kind?: string; origin?: string; externalId?: string | null; occurredOn?: string; workspace?: "wsA" | "wsB" } = {}): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO context_sources (id, workspace_id, kind, origin, title, occurred_on, body, body_chars, external_id, visibility, read_status, parts_read)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'Call di prova', $5::date, $6, $7, $8, 'ls', 'letto', 1)`,
    [id, ids[over.workspace ?? "wsA"], over.kind ?? "appunti", over.origin ?? "web", over.occurredOn ?? "2026-11-14", over.kind === "risposta" ? null : "Testo di prova.", over.kind === "risposta" ? 0 : 15, over.externalId ?? null],
  );
  return id;
}

/** Un fatto attivo di prova, con la sua fonte (facoltativa), la citazione, i legami e le date. */
async function insertFact(f: {
  statement: string;
  section?: string;
  visibility?: "tutti" | "ls";
  useCases?: string[];
  sourceId?: string | null;
  quote?: string | null;
  supersedesId?: string | null;
  createdAt?: string;
  lastConfirmedAt?: string;
  status?: "attivo" | "superato" | "ritirato";
  endedAt?: string | null;
  workspace?: "wsA" | "wsB";
}): Promise<string> {
  const id = randomUUID();
  const ws = ids[f.workspace ?? "wsA"];
  const status = f.status ?? "attivo";
  await q(
    `INSERT INTO context_facts (id, workspace_id, section, statement, basis, visibility, status, origin, source_id, quote, supersedes_id, created_at, last_confirmed_at, ended_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'detto', $5, $6, $7, $8::uuid, $9, $10::uuid, coalesce($11::timestamptz, now()), coalesce($12::timestamptz, now()), $13::timestamptz)`,
    [
      id,
      ws,
      f.section ?? "sistemi",
      f.statement,
      f.visibility ?? "tutti",
      status,
      f.sourceId ? "fonte" : "manuale",
      f.sourceId ?? null,
      f.quote ?? null,
      f.supersedesId ?? null,
      f.createdAt ?? null,
      f.lastConfirmedAt ?? null,
      status === "attivo" ? null : (f.endedAt ?? new Date().toISOString()),
    ],
  );
  for (const useCase of f.useCases ?? []) await q(`INSERT INTO context_fact_links (workspace_id, fact_id, use_case_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`, [ws, id, useCase]);
  return id;
}

/** Toglie i fatti, gli impegni e le domande di prova del workspace A tra un test e l'altro. */
async function clearMemory() {
  await q(`DELETE FROM context_need_links WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM context_proposals WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM context_fact_links WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`UPDATE context_facts SET supersedes_id = NULL WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM context_facts WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM context_commitments WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM context_questions WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM context_sources WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM context_briefs WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM context_events WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM use_case_notifications WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
}

before(async () => {
  if (!enabled) return;
  process.env.UC_LS_EMAIL_DOMAINS = LS.join(",");
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("../../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  ddl = await import("../../db/context-work-ddl.ts");
  store = await import("../../db/queries/context-store.ts");
  work = await import("../../db/queries/context-work.ts");
  memory = await import("../../db/queries/context-memory.ts");
  freshness = await import("../../db/queries/context-freshness.ts");
  needs = await import("../../db/queries/context-needs.ts");
  notices = await import("../../db/queries/context-notices.ts");
  proposals = await import("../../db/queries/context-proposals.ts");
  learning = await import("../../db/queries/context-learning.ts");
  sources = await import("../../db/queries/context-sources.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione A di prova lavoro', $2), ($3, 'Organizzazione B di prova lavoro', $4)`, [
    ids.orgA,
    `org-lavoro-a-${suffix}`,
    ids.orgB,
    `org-lavoro-b-${suffix}`,
  ]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente A di prova lavoro'), ($3, $4, 'Cliente B di prova lavoro')`, [ids.wsA, ids.orgA, ids.wsB, ids.orgB]);
  for (const person of people) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], `Prova ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids[ROLE[person][0]], ids[person], ROLE[person][1]]);
  }
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $5, 'Ordini automatici', $6), ($2, $5, 'Fatture fornitori', $7), ($3, $5, 'Scarti di produzione', $8), ($4, $9, 'Use case di un altro workspace', $10)`, [
    ids.ucA,
    ids.ucB,
    ids.ucC,
    ids.ucX,
    ids.wsA,
    CODE(1),
    CODE(2),
    CODE(3),
    ids.wsB,
    CODE(9),
  ]);
  // Lo use case A ha un dossier aperto, il C uno chiuso, il B nessuno.
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova lavoro', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.lavoro_${suffix}`, randomBytes(32).toString("hex"), ids.wsA],
  );
  for (const [caseId, useCaseId, status, n] of [
    [ids.caseA, ids.ucA, "pronto_sviluppo", 1],
    [ids.caseC, ids.ucC, "chiuso", 3],
  ] as const) {
    await q(
      `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova lavoro', $7, now())`,
      [caseId, ids.wsA, ids.orgA, useCaseId, ids.template, `XC-${suffix.toUpperCase()}${n}`, status],
    );
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead'), ($1, $3, 'ls_sviluppatore'), ($1, $4, 'owner_cliente'), ($1, $5, 'osservatore')`, [
      caseId,
      ids.ls,
      ids.dev,
      ids.own,
      ids.ext,
    ]);
  }
  await q(`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id) VALUES ($1, $2, $3, $4)`, [ids.wsA, ids.ext, ids.ucA, ids.ls]);
  // L'ok ai sub-responsabili per la lista di oggi: solo nel workspace A.
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role)
     SELECT $1::uuid, $2, 'Registrato da Lateral Space per conto del cliente di prova.', $3::uuid, 'transformation_lead'`,
    [ids.wsA, (await import("../../uc/legal/subprocessors.ts")).SUBPROCESSORS_VERSION, ids.ls],
  );
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE $1 OR bucket LIKE $2`, [`%${ids.wsA}%`, `%${ids.wsB}%`]);
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[ids.orgA, ids.orgB]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [people.map((p) => ids[p])]);
});

// ─── La 0041 e la sua sonda ──────────────────────────────────────────

/** La tabella, gli indici e i vincoli della 0041, per vedere se un secondo passaggio cambia qualcosa. */
async function schemaSnapshot(): Promise<string> {
  const rows = await q(
    `SELECT 'col' AS kind, column_name || ':' || data_type || ':' || is_nullable AS item FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'context_need_links'
     UNION ALL SELECT 'idx', indexname || ':' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])
     UNION ALL SELECT 'con', conname || ':' || pg_get_constraintdef(oid) || ':' || convalidated FROM pg_constraint
       WHERE conname LIKE 'context\\_need\\_links%' OR conname = ANY($2::text[])
     ORDER BY 1, 2`,
    [[...ddl.CONTEXT_WORK_INDEXES], ["context_sources_kind_check", "context_sources_origin_check", "context_events_channel_check", "use_case_notifications_kind_check"]],
  );
  return rows.map((row) => `${row.kind} ${row.item}`).join("\n");
}

test("la sonda è vera dopo il self-heal, e due passaggi della 0041 non cambiano niente", opts, async () => {
  assert.equal((await q(`SELECT ${ddl.CONTEXT_WORK_PROBE_SQL} AS ok`))[0]?.ok, true);
  assert.equal(await store.contextWorkReady(), true);
  const before = await schemaSnapshot();
  assert.match(before, /con context_need_links_pkey:PRIMARY KEY \(id\):true/);
  await ensure.runContextWorkDdl();
  await ensure.runContextWorkDdl();
  assert.equal(await schemaSnapshot(), before);
  assert.equal((await q(`SELECT ${ddl.CONTEXT_WORK_PROBE_SQL} AS ok`))[0]?.ok, true);
});

test("i tre CHECK allargati accettano i valori nuovi e rifiutano uno inventato; la campanella accetta i due tipi nuovi", opts, async () => {
  const source = await insertSource({ kind: "risposta", origin: "rispondi", externalId: randomUUID() });
  for (const channel of ["cli", "rispondi"]) {
    await q(`INSERT INTO context_events (workspace_id, action, channel) VALUES ($1::uuid, 'fonte_aggiunta', $2)`, [ids.wsA, channel]);
  }
  const rejects = async (statement: string, params: unknown[], constraint: string) => {
    await assert.rejects(q(statement, params), (error: { code?: string; constraint?: string; message?: string }) => error.code === "23514" && (error.constraint === constraint || String(error.message).includes(constraint)), constraint);
  };
  await rejects(`INSERT INTO context_sources (workspace_id, kind, origin, title, occurred_on, visibility) VALUES ($1::uuid, 'inventato', 'web', 'Prova', '2026-11-14', 'ls')`, [ids.wsA], "context_sources_kind_check");
  await rejects(`INSERT INTO context_sources (workspace_id, kind, origin, title, occurred_on, visibility) VALUES ($1::uuid, 'appunti', 'altrove', 'Prova', '2026-11-14', 'ls')`, [ids.wsA], "context_sources_origin_check");
  await rejects(`INSERT INTO context_events (workspace_id, action, channel) VALUES ($1::uuid, 'fonte_aggiunta', 'posta')`, [ids.wsA], "context_events_channel_check");
  for (const kind of ["contesto_nuovo", "dalla_call"]) {
    await q(`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, '2026-11-18')`, [ids.wsA, ids.ucA, ids.rev, kind]);
  }
  await rejects(`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day) VALUES ($1::uuid, $2::uuid, $3::uuid, 'inventato', '2026-11-18')`, [ids.wsA, ids.ucA, ids.rev], "use_case_notifications_kind_check");
  // Un legame «aperto» senza fatto, o «usato» senza data, non entra.
  const need = randomUUID();
  await q(`INSERT INTO use_case_needs (id, workspace_id, type, title, status, owner_side) VALUES ($1::uuid, $2::uuid, 'requisito', 'Come arrivano gli ordini?', 'da_chiedere', 'cliente')`, [need, ids.wsA]);
  await rejects(`INSERT INTO context_need_links (workspace_id, need_id, status) VALUES ($1::uuid, $2::uuid, 'aperta')`, [ids.wsA, need], "context_need_links_fact_check");
  const fact = await insertFact({ statement: "Gli ordini arrivano via e-mail." });
  await rejects(`INSERT INTO context_need_links (workspace_id, need_id, fact_id, status) VALUES ($1::uuid, $2::uuid, $3::uuid, 'usata')`, [ids.wsA, need, fact], "context_need_links_decided_check");
  await q(`DELETE FROM use_case_needs WHERE id = $1::uuid`, [need]);
  await q(`DELETE FROM context_sources WHERE id = $1::uuid`, [source]);
  await clearMemory();
});

// ─── Le letture: la scheda e il dossier ──────────────────────────────

test("loadUseCaseContext: Lateral Space vede tutto, il cliente solo «Per tutti»; mai una citazione; novità, impegni, domande", opts, async () => {
  await clearMemory();
  const call = await insertSource({ occurredOn: "2026-11-14" });
  const answers = await insertSource({ kind: "risposta", origin: "rispondi", externalId: randomUUID(), occurredOn: "2026-11-12" });
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const before = await insertFact({ statement: "Il gestionale è un foglio di calcolo.", useCases: [ids.ucA], createdAt: old, lastConfirmedAt: old, status: "superato", endedAt: new Date().toISOString() });
  await insertFact({ statement: "Il gestionale è SAP Business One.", useCases: [ids.ucA], sourceId: call, quote: "usiamo SAP B1 da anni", supersedesId: before });
  await insertFact({ statement: "Il contratto vale una cifra riservata.", section: "regole", visibility: "ls", useCases: [ids.ucA], sourceId: call, quote: "il contratto vale" });
  await insertFact({ statement: "Gli ordini si contano a mano.", section: "lavoro", useCases: [ids.ucA], sourceId: answers, createdAt: old, lastConfirmedAt: old });
  await insertFact({ statement: "Un fatto di un altro use case.", useCases: [ids.ucB] });
  await q(`INSERT INTO context_commitments (workspace_id, statement, party, role_label, due_on, visibility, origin, use_case_ids) VALUES
    ($1::uuid, 'Inviare l''esportazione delle fatture', 'cliente', 'Responsabile amministrativo', '2026-11-25', 'tutti', 'manuale', $2::uuid[]),
    ($1::uuid, 'Rivedere il preventivo', 'nostra', NULL, NULL, 'ls', 'manuale', $2::uuid[]),
    ($1::uuid, 'Impegno di un altro use case', 'nostra', NULL, NULL, 'tutti', 'manuale', $3::uuid[])`, [ids.wsA, `{${ids.ucA}}`, `{${ids.ucB}}`]);
  await q(`INSERT INTO context_questions (workspace_id, question, ask_whom, visibility, origin, use_case_ids) VALUES
    ($1::uuid, 'Chi approva gli acquisti sopra soglia?', 'Direzione acquisti', 'tutti', 'manuale', $2::uuid[]),
    ($1::uuid, 'Quanto vale il rinnovo?', NULL, 'ls', 'manuale', $2::uuid[])`, [ids.wsA, `{${ids.ucA}}`]);

  const ls = await work.loadUseCaseContext(actor("ls"), ids.ucA);
  assert.ok(ls);
  assert.deepEqual(ls.facts.map((f) => [f.section, f.statement, f.tag]), [
    ["lavoro", "Gli ordini si contano a mano.", null],
    ["sistemi", "Il gestionale è SAP Business One.", "cambiato"],
    ["regole", "Il contratto vale una cifra riservata.", "nuovo"],
  ]);
  assert.deepEqual(ls.facts.map((f) => f.sourceLabel), ["Referente 12 nov", "Call 14 nov", "Call 14 nov"]);
  assert.equal(ls.novelties, 2);
  assert.equal(ls.more, 0);
  assert.deepEqual(ls.commitments.map((c) => c.statement), ["Inviare l'esportazione delle fatture", "Rivedere il preventivo"]);
  // Le due domande nascono nello stesso istante: l'ordine tra loro non conta.
  assert.deepEqual(ls.questions.map((x) => x.question).sort(), ["Chi approva gli acquisti sopra soglia?", "Quanto vale il rinnovo?"]);

  const client = await work.loadUseCaseContext(actor("rev"), ids.ucA);
  assert.ok(client);
  assert.deepEqual(client.facts.map((f) => f.statement), ["Gli ordini si contano a mano.", "Il gestionale è SAP Business One."]);
  assert.ok(client.facts.every((f) => f.visibility === "tutti"));
  assert.equal(client.novelties, 1);
  assert.deepEqual(client.commitments.map((c) => c.statement), ["Inviare l'esportazione delle fatture"]);
  assert.deepEqual(client.questions.map((x) => x.question), ["Chi approva gli acquisti sopra soglia?"]);
  for (const view of [ls, client]) {
    const text = JSON.stringify(view);
    assert.doesNotMatch(text, /usiamo SAP B1|il contratto vale"|Prova ls|confirmedBy/, "mai una citazione, mai chi ha confermato");
  }
  // Uno use case di un altro workspace, chi non apre «Contesto», un id che non è un uuid: null.
  assert.equal(await work.loadUseCaseContext(actor("ls"), ids.ucX), null);
  assert.equal(await work.loadUseCaseContext({ ...actor("rev"), role: "learner" }, ids.ucA), null);
  assert.equal(await work.loadUseCaseContext(actor("ls"), "non-un-uuid"), null);
  // Senza niente: le liste vuote (la pagina non mostra la piega).
  const empty = await work.loadUseCaseContext(actor("ls"), ids.ucC);
  assert.deepEqual(empty, { facts: [], more: 0, novelties: 0, commitments: [], questions: [] });
});

test("loadUseCaseContext: al massimo 40 fatti, le novità sempre dentro, «e altri n nel contesto»", opts, async () => {
  await clearMemory();
  const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
  for (let i = 0; i < 44; i++) await insertFact({ statement: `Fatto vecchio numero ${i + 1}.`, section: "azienda", useCases: [ids.ucA], createdAt: old, lastConfirmedAt: old });
  await insertFact({ statement: "Una parola nuova del cliente.", section: "parole", useCases: [ids.ucA] });
  const view = await work.loadUseCaseContext(actor("rev"), ids.ucA);
  assert.ok(view);
  assert.equal(view.facts.length, 40);
  assert.equal(view.more, 5);
  assert.equal(view.novelties, 1);
  assert.equal(view.facts[view.facts.length - 1].statement, "Una parola nuova del cliente.", "per sezione: «parole» per ultima, ma c'è");
  assert.equal(view.facts[view.facts.length - 1].tag, "nuovo");
});

// ─── Le letture: gli agenti e il pacchetto ───────────────────────────

test("loadAgentContext: solo «Per tutti», per tutti; regole e parole del workspace senza doppioni; impegni e domande dello use case", opts, async () => {
  await clearMemory();
  const call = await insertSource({ occurredOn: "2026-11-14" });
  const learned = await insertSource({ origin: "cli", externalId: `impara:${randomUUID()}`, occurredOn: "2026-11-18" });
  await insertFact({ statement: "Il gestionale è SAP Business One.", useCases: [ids.ucA], sourceId: call, quote: "usiamo SAP B1" });
  await insertFact({ statement: "Il prezzo concordato è riservato.", section: "regole", visibility: "ls", useCases: [ids.ucA] });
  await insertFact({ statement: "I dati restano in Italia.", section: "regole", useCases: [ids.ucA], sourceId: learned });
  await insertFact({ statement: "Nessun dato personale nei test.", section: "regole" });
  await insertFact({ statement: "La marginalità interna è riservata.", section: "regole", visibility: "ls" });
  await insertFact({ statement: "«Commessa» vuol dire ordine con progetto.", section: "parole" });
  await insertFact({ statement: "Un fatto di un altro use case.", section: "sistemi", useCases: [ids.ucB] });
  await q(`INSERT INTO context_commitments (workspace_id, statement, party, role_label, due_on, visibility, origin, use_case_ids) VALUES
    ($1::uuid, 'Inviare l''esportazione delle fatture', 'cliente', 'Responsabile amministrativo', '2026-11-25', 'tutti', 'manuale', $2::uuid[]),
    ($1::uuid, 'Rivedere il preventivo', 'nostra', NULL, NULL, 'ls', 'manuale', $2::uuid[])`, [ids.wsA, `{${ids.ucA}}`]);
  await q(`INSERT INTO context_questions (workspace_id, question, ask_whom, visibility, origin, use_case_ids) VALUES
    ($1::uuid, 'Chi approva gli acquisti sopra soglia?', 'Direzione acquisti', 'tutti', 'manuale', $2::uuid[]),
    ($1::uuid, 'Quanto vale il rinnovo?', NULL, 'ls', 'manuale', $2::uuid[])`, [ids.wsA, `{${ids.ucA}}`]);
  await q(`INSERT INTO context_briefs (workspace_id, lines, facts_hash) VALUES ($1::uuid, $2::jsonb, $3)`, [ids.wsA, JSON.stringify(["Azienda di arredamento di prova.", "Usa SAP Business One."]), "0".repeat(64)]);

  const ctx = await work.loadAgentContext({ workspaceId: ids.wsA, useCaseId: ids.ucA });
  assert.ok(ctx);
  assert.deepEqual(ctx.brief, ["Azienda di arredamento di prova.", "Usa SAP Business One."]);
  assert.deepEqual(ctx.caseFacts.map((f) => [f.section, f.statement, f.source]), [
    ["sistemi", "Il gestionale è SAP Business One.", "call"],
    ["regole", "I dati restano in Italia.", "costruzione"],
  ]);
  assert.deepEqual(ctx.caseFacts.map((f) => f.on), ["2026-11-14", "2026-11-18"]);
  assert.deepEqual(ctx.rules.map((f) => f.statement), ["Nessun dato personale nei test."], "le regole del workspace, senza quelle già dello use case");
  assert.deepEqual(ctx.words.map((f) => f.statement), ["«Commessa» vuol dire ordine con progetto."]);
  assert.equal(ctx.words[0].source, "manuale");
  assert.deepEqual(ctx.commitments, [{ statement: "Inviare l'esportazione delle fatture", party: "cliente", role: "Responsabile amministrativo", dueOn: "2026-11-25" }]);
  assert.deepEqual(ctx.questions, [{ question: "Chi approva gli acquisti sopra soglia?", askWhom: "Direzione acquisti" }]);
  assert.equal(ctx.since, null);
  const text = JSON.stringify(ctx);
  assert.doesNotMatch(text, /riservat|rinnovo|preventivo|usiamo SAP B1/, "mai «Solo Lateral Space», mai citazioni");
  assert.equal(await work.loadAgentContext({ workspaceId: ids.wsA, useCaseId: ids.ucX }), null, "uno use case di un altro workspace");
  assert.equal(await work.loadAgentContext({ workspaceId: ids.wsB, useCaseId: ids.ucA }), null);
});

test("loadAgentContext con `since` e contextDeltaSince: nuovi, cambiati e tolti dopo una data, solo «Per tutti» e nel perimetro", opts, async () => {
  await clearMemory();
  const before = "2026-10-01T10:00:00Z";
  const cut = new Date("2026-11-01T00:00:00Z");
  const oldFact = await insertFact({ statement: "Il magazzino è a Bologna.", section: "azienda", useCases: [ids.ucA], createdAt: before, lastConfirmedAt: before, status: "superato" });
  await insertFact({ statement: "Il magazzino è a Modena.", section: "azienda", useCases: [ids.ucA], supersedesId: oldFact });
  await insertFact({ statement: "Gli ordini arrivano via e-mail.", section: "lavoro", useCases: [ids.ucA] });
  await insertFact({ statement: "Un fatto vecchio che resta.", section: "lavoro", useCases: [ids.ucA], createdAt: before, lastConfirmedAt: before });
  await insertFact({ statement: "Una regola tolta.", section: "regole", createdAt: before, lastConfirmedAt: before, status: "ritirato", endedAt: "2026-11-05T10:00:00Z" });
  await insertFact({ statement: "Un fatto riservato nuovo.", section: "lavoro", visibility: "ls", useCases: [ids.ucA] });
  await insertFact({ statement: "Un fatto nuovo di un altro use case.", section: "sistemi", useCases: [ids.ucB] });

  const ctx = await work.loadAgentContext({ workspaceId: ids.wsA, useCaseId: ids.ucA, since: cut });
  assert.ok(ctx);
  assert.deepEqual(ctx.since, { from: "2026-11-01", added: 1, changed: 1, retired: 1 });
  assert.deepEqual(ctx.caseFacts.map((f) => f.statement), ["Il magazzino è a Modena.", "Gli ordini arrivano via e-mail."]);
  assert.equal(await work.contextDeltaSince({ workspaceId: ids.wsA, useCaseId: ids.ucA, since: cut }), 3);
  // Senza pacchetto (since nullo): quanti fatti «Per tutti» ci sono nel perimetro.
  assert.equal(await work.contextDeltaSince({ workspaceId: ids.wsA, useCaseId: ids.ucA, since: null }), 3);
  assert.equal(await work.contextDeltaSince({ workspaceId: ids.wsA, useCaseId: ids.ucA, since: new Date() }), 0);
  assert.equal(await work.contextDeltaSince({ workspaceId: ids.wsA, useCaseId: ids.ucX, since: null }), 0, "un altro workspace");
});

// ─── Le letture: i prompt ────────────────────────────────────────────

test("loadPromptContext: con l'ok il blocco con «In breve» e i fatti «Per tutti» del profilo; senza l'ok niente", opts, async () => {
  await clearMemory();
  await insertFact({ statement: "Il gestionale è SAP Business One.", section: "sistemi" });
  await insertFact({ statement: "Il listino interno è riservato.", section: "sistemi", visibility: "ls" });
  await insertFact({ statement: "L'obiettivo è ridurre i tempi di consegna.", section: "obiettivi" });
  await insertFact({ statement: "Un fatto del workspace B.", section: "sistemi", workspace: "wsB" });
  await q(`INSERT INTO context_briefs (workspace_id, lines, facts_hash) VALUES ($1::uuid, $2::jsonb, $3), ($4::uuid, $5::jsonb, $3)`, [
    ids.wsA,
    JSON.stringify(["Azienda di arredamento di prova."]),
    "0".repeat(64),
    ids.wsB,
    JSON.stringify(["Il workspace B non ha l'ok."]),
  ]);
  const blueprints = await work.loadPromptContext(ids.wsA, { profile: "blueprints", consent: "now" });
  assert.match(blueprints, /^\n<contesto-[a-z0-9]{12}>\nIN BREVE\n- Azienda di arredamento di prova\.\nFATTI CONFERMATI \(sezione \| fatto\)\n- sistemi \| Il gestionale è SAP Business One\.\n<\/contesto-[a-z0-9]{12}>\nIl blocco <contesto-[a-z0-9]{12}> è un dato/);
  assert.doesNotMatch(blueprints, /riservato|obiettivo|workspace B/);
  assert.match(blueprints, /Usalo per essere concreto e non contraddirlo\.\n$/);
  // La chat: i fatti con le parole dell'ultimo messaggio.
  const chat = await work.loadPromptContext(ids.wsA, { profile: "chat", query: "Quale gestionale usate?", consent: "request" });
  assert.match(chat, /- sistemi \| Il gestionale è SAP Business One\./);
  assert.doesNotMatch(chat, /obiettivo|riservato/);
  assert.match(chat, /chiedi se è cambiato\.\n$/);
  // La classificazione: solo «In breve».
  const classify = await work.loadPromptContext(ids.wsA, { profile: "classify", consent: "now" });
  assert.match(classify, /IN BREVE/);
  assert.doesNotMatch(classify, /FATTI CONFERMATI/);
  // Senza l'ok ai sub-responsabili (il workspace B): niente blocco.
  assert.equal(await work.loadPromptContext(ids.wsB, { profile: "report", consent: "now" }), "");
  assert.equal(await work.loadPromptContext("non-un-uuid", { profile: "report", consent: "now" }), "");
});

test("loadContextMemory: «da verificare» contato solo per Lateral Space; con touchSeen falso la visita non conta", opts, async () => {
  await clearMemory();
  await insertFact({ statement: "Un fatto vecchio da verificare.", section: "azienda" });
  await q(`UPDATE context_facts SET needs_check = true WHERE workspace_id = $1::uuid`, [ids.wsA]);
  await q(`DELETE FROM context_seen WHERE workspace_id = $1::uuid`, [ids.wsA]);
  const ls = await memory.loadContextMemory(actor("ls"), { touchSeen: false });
  assert.equal(ls.counts.toCheck, 1);
  assert.equal(ls.novelties, null);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_seen WHERE workspace_id = $1::uuid`, [ids.wsA]))[0]?.n, 0, "nessuna visita scritta");
  const client = await memory.loadContextMemory(actor("rev"));
  assert.equal(client.counts.toCheck, 0);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_seen WHERE workspace_id = $1::uuid`, [ids.wsA]))[0]?.n, 1, "la pagina sì");
});

// ─── La freschezza e la notte ────────────────────────────────────────

test("markStaleFacts: sei mesi e un giorno sì, sei mesi esatti e meno un giorno no; version e updated_at restano; un evento per workspace", opts, async () => {
  await clearMemory();
  const now = new Date("2026-11-18T09:00:00Z");
  const stale = await insertFact({ statement: "Un fatto confermato sei mesi e un giorno fa.", createdAt: "2026-05-17T08:00:00Z", lastConfirmedAt: "2026-05-17T08:00:00Z" });
  const exact = await insertFact({ statement: "Un fatto confermato sei mesi esatti fa.", createdAt: "2026-05-18T08:00:00Z", lastConfirmedAt: "2026-05-18T08:00:00Z" });
  const fresh = await insertFact({ statement: "Un fatto confermato sei mesi meno un giorno fa.", createdAt: "2026-05-19T08:00:00Z", lastConfirmedAt: "2026-05-19T08:00:00Z" });
  const retired = await insertFact({ statement: "Un fatto ritirato vecchio.", createdAt: "2026-01-10T08:00:00Z", lastConfirmedAt: "2026-01-10T08:00:00Z", status: "ritirato" });
  const other = await insertFact({ statement: "Un fatto vecchio del workspace B.", workspace: "wsB", createdAt: "2026-03-01T08:00:00Z", lastConfirmedAt: "2026-03-01T08:00:00Z" });
  const stamp = async (id: string) => (await q(`SELECT needs_check, version, updated_at::text AS updated FROM context_facts WHERE id = $1::uuid`, [id]))[0];
  const before = await stamp(stale);

  assert.ok((await freshness.markStaleFacts(now)) >= 2);
  assert.equal((await stamp(stale))?.needs_check, true, "sei mesi e un giorno");
  assert.equal((await stamp(exact))?.needs_check, false, "sei mesi esatti");
  assert.equal((await stamp(fresh))?.needs_check, false, "sei mesi meno un giorno");
  assert.equal((await stamp(retired))?.needs_check, false, "solo i fatti attivi");
  assert.equal((await stamp(other))?.needs_check, true, "in ogni workspace");
  assert.deepEqual({ version: (await stamp(stale))?.version, updated: (await stamp(stale))?.updated }, { version: before?.version, updated: before?.updated }, "né version né updated_at");
  const events = async () => (await q(`SELECT workspace_id, channel, detail FROM context_events WHERE action = 'fatti_da_verificare' AND workspace_id = ANY($1::uuid[]) ORDER BY workspace_id`, [[ids.wsA, ids.wsB]])).map((e) => [e.workspace_id === ids.wsA ? "A" : "B", e.channel, e.detail]);
  assert.deepEqual((await events()).sort(), [["A", "cron", { n: 1 }], ["B", "cron", { n: 1 }]]);
  // Un secondo giro non risegna e non scrive altri eventi.
  await freshness.markStaleFacts(now);
  assert.equal((await events()).length, 2);
});

test("«Da verificare»: solo Lateral Space legge e riconferma; «Ancora veri» toglie il segno e rinfresca la data; un altro workspace è «non trovato»", opts, async () => {
  await clearMemory();
  const call = await insertSource({ occurredOn: "2026-05-02" });
  const stale = await insertFact({ statement: "Il magazzino è a Modena.", section: "azienda", sourceId: call, createdAt: "2026-05-02T08:00:00Z", lastConfirmedAt: "2026-05-02T08:00:00Z" });
  const second = await insertFact({ statement: "Le consegne partono il lunedì.", section: "lavoro", createdAt: "2026-04-02T08:00:00Z", lastConfirmedAt: "2026-04-02T08:00:00Z" });
  const other = await insertFact({ statement: "Un fatto del workspace B da verificare.", workspace: "wsB" });
  await q(`UPDATE context_facts SET needs_check = true WHERE id = ANY($1::uuid[])`, [[stale, second, other]]);

  assert.equal(await freshness.listFactsToCheck(actor("rev")), null, "il cliente non vede la pagina");
  const list = await freshness.listFactsToCheck(actor("ls"));
  assert.deepEqual(list?.map((f) => [f.statement, f.needsCheck, f.lastConfirmedOn]), [
    ["Le consegne partono il lunedì.", true, "2026-04-02"],
    ["Il magazzino è a Modena.", true, "2026-05-02"],
  ]);
  assert.equal(list?.[1].sourceLabel, "Call 2 mag");

  assert.equal(errorOf(await freshness.reconfirmFacts(actor("rev"), [stale])), "permesso_mancante");
  assert.equal(errorOf(await freshness.reconfirmFacts(actor("ls"), [])), "dati_non_validi");
  assert.equal(errorOf(await freshness.reconfirmFacts(actor("ls"), ["non-un-uuid"])), "dati_non_validi");
  assert.equal(errorOf(await freshness.reconfirmFacts(actor("ls"), Array.from({ length: 76 }, () => randomUUID()))), "dati_non_validi");
  assert.equal(errorOf(await freshness.reconfirmFacts(actor("ls"), [other])), "non_trovato", "un fatto di un altro workspace");
  assert.equal((await q(`SELECT needs_check FROM context_facts WHERE id = $1::uuid`, [other]))[0]?.needs_check, true);

  assert.deepEqual(okValue(await freshness.reconfirmFacts(actor("ls"), [stale, second, other])), { reconfirmed: 2 });
  const after = await q(`SELECT needs_check, confirmed_by_user_id, last_confirmed_at > now() - interval '1 minute' AS recent FROM context_facts WHERE id = ANY($1::uuid[]) ORDER BY statement`, [[stale, second]]);
  assert.deepEqual(after.map((r) => [r.needs_check, r.confirmed_by_user_id, r.recent]), [
    [false, ids.ls, true],
    [false, ids.ls, true],
  ]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_events WHERE workspace_id = $1::uuid AND action = 'fatto_riconfermato' AND actor_user_id = $2::uuid`, [ids.wsA, ids.ls]))[0]?.n, 2);
  assert.deepEqual(await freshness.listFactsToCheck(actor("ls")), []);
  assert.equal((await memory.loadContextMemory(actor("ls"), { touchSeen: false })).counts.toCheck, 0);
});

test("la notte cancella i legami «proposta» di proposte non più aperte, e tiene gli altri", opts, async () => {
  await clearMemory();
  const source = await insertSource();
  const need = randomUUID();
  await q(`INSERT INTO use_case_needs (id, workspace_id, type, title, status, owner_side) VALUES ($1::uuid, $2::uuid, 'requisito', 'Come arrivano gli ordini?', 'da_chiedere', 'cliente')`, [need, ids.wsA]);
  const proposal = async (status: "aperta" | "scartata", position: number) => {
    const id = randomUUID();
    await q(
      `INSERT INTO context_proposals (id, workspace_id, source_id, position, kind, statement, basis, section, visibility, status, decided_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'nuovo', 'Gli ordini arrivano via e-mail.', 'detto', 'lavoro', 'tutti', $5::text, CASE WHEN $5::text = 'aperta' THEN NULL ELSE now() END)`,
      [id, ids.wsA, source, position, status],
    );
    await q(`INSERT INTO context_need_links (workspace_id, need_id, proposal_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`, [ids.wsA, need, id]);
    return id;
  };
  const open = await proposal("aperta", 1);
  await proposal("scartata", 2);
  assert.ok((await needs.purgeOrphanNeedLinks()) >= 1);
  const left = await q(`SELECT proposal_id FROM context_need_links WHERE workspace_id = $1::uuid`, [ids.wsA]);
  assert.deepEqual(left.map((r) => r.proposal_id), [open]);
  await q(`DELETE FROM use_case_needs WHERE id = $1::uuid`, [need]);
});

// ─── Gli avvisi in campanella ────────────────────────────────────────

/** Chi ha una riga di quel tipo per quello use case nel workspace A, in ordine. */
async function notified(useCaseId: string, kind: "contesto_nuovo" | "dalla_call" = "contesto_nuovo"): Promise<string[]> {
  const rows = await q(`SELECT recipient_user_id FROM use_case_notifications WHERE workspace_id = $1::uuid AND use_case_id = $2::uuid AND kind = $3 ORDER BY 1`, [ids.wsA, useCaseId, kind]);
  return rows.map((row) => String(row.recipient_user_id));
}
const who = (...persons: Person[]) => persons.map((p) => ids[p]).sort();
const clearNotices = () => q(`DELETE FROM use_case_notifications WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);

test("notifyContextChange: chi costruisce e il responsabile sì, chi ha agito no; da fuori solo per «Per tutti»; niente senza dossier o con il dossier chiuso", opts, async () => {
  await clearMemory();
  // Un fatto «Solo Lateral Space»: lo sviluppatore sì, il responsabile no (ha agito lui), chi costruisce da fuori no.
  const internal = await insertFact({ statement: "Il prezzo concordato è riservato.", visibility: "ls", useCases: [ids.ucA] });
  await notices.notifyContextChange({ workspaceId: ids.wsA, actorUserId: ids.ls, factIds: [internal] });
  assert.deepEqual(await notified(ids.ucA), who("dev"));
  await clearNotices();
  // Un fatto «Per tutti»: anche chi costruisce da fuori. Il responsabile del cliente e chi rivede soltanto no.
  const shared = await insertFact({ statement: "Il gestionale è SAP Business One.", useCases: [ids.ucA, ids.ucB, ids.ucC] });
  await notices.notifyContextChange({ workspaceId: ids.wsA, actorUserId: ids.dev, factIds: [shared] });
  assert.deepEqual(await notified(ids.ucA), who("ls", "ext"));
  assert.deepEqual(await notified(ids.ucB), [], "senza dossier niente");
  assert.deepEqual(await notified(ids.ucC), [], "con il dossier chiuso niente");
  // Lo stesso giorno: una riga per persona, che torna da leggere.
  await q(`UPDATE use_case_notifications SET read_at = now() WHERE workspace_id = $1::uuid`, [ids.wsA]);
  await notices.notifyContextChange({ workspaceId: ids.wsA, actorUserId: ids.dev, factIds: [shared, internal] });
  const rows = await q(`SELECT recipient_user_id, read_at FROM use_case_notifications WHERE workspace_id = $1::uuid AND kind = 'contesto_nuovo'`, [ids.wsA]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.read_at === null));
  // Un fatto di un altro workspace, o un id che non è un fatto: niente.
  await clearNotices();
  const foreign = await insertFact({ statement: "Un fatto del workspace B.", workspace: "wsB" });
  await notices.notifyContextChange({ workspaceId: ids.wsA, actorUserId: null, factIds: [foreign, "non-un-uuid"] });
  assert.equal((await q(`SELECT count(*)::int AS n FROM use_case_notifications WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]))[0]?.n, 0);
});

test("le scritture avvisano: «Scrivi un fatto», un testo nuovo, use case aggiunti e tolti (solo quelli), la visibilità allargata o ristretta, «Non più vero», la conferma; la sezione e la riconferma no", opts, async () => {
  await clearMemory();
  const ls = actor("ls");
  const written = okValue(await memory.writeFact(ls, { statement: "Gli ordini arrivano via e-mail.", section: "lavoro", visibility: "tutti", useCaseIds: [ids.ucA] }));
  assert.deepEqual(await notified(ids.ucA), who("dev", "ext"));
  await clearNotices();
  // Solo la sezione: nessun avviso.
  okValue(await memory.editFact(ls, written.factId, 1, { section: "sistemi" }));
  assert.deepEqual(await notified(ids.ucA), []);
  // La riconferma non è un cambio.
  okValue(await memory.reconfirmFact(ls, written.factId));
  assert.deepEqual(await notified(ids.ucA), []);
  // Un testo nuovo: una versione nuova, con gli use case di prima.
  const edited = okValue(await memory.editFact(actor("dev"), written.factId, 2, { statement: "Gli ordini arrivano via e-mail e via portale." }));
  assert.deepEqual(await notified(ids.ucA), who("ls", "ext"));
  await clearNotices();
  // «Non più vero».
  const version = Number((await q(`SELECT version FROM context_facts WHERE id = $1::uuid`, [edited.factId]))[0]?.version);
  okValue(await memory.retireFact(ls, edited.factId, version));
  assert.deepEqual(await notified(ids.ucA), who("dev", "ext"));
  await clearNotices();
  // Un fatto «Solo Lateral Space» che diventa «Per tutti»: anche chi costruisce da fuori.
  const hidden = okValue(await memory.writeFact(ls, { statement: "Il magazzino è a Modena.", section: "azienda", visibility: "ls", useCaseIds: [ids.ucA] }));
  assert.deepEqual(await notified(ids.ucA), who("dev"));
  await clearNotices();
  okValue(await memory.editFact(ls, hidden.factId, 1, { visibility: "tutti" }));
  assert.deepEqual(await notified(ids.ucA), who("dev", "ext"));
  await clearNotices();
  // Un fatto «Per tutti» ristretto a «Solo Lateral Space»: chi costruisce ha un CONTESTO.md da aggiornare, anche da fuori.
  const narrowed = okValue(await memory.writeFact(ls, { statement: "Il listino segue i volumi.", section: "lavoro", visibility: "tutti", useCaseIds: [ids.ucA] }));
  await clearNotices();
  okValue(await memory.editFact(ls, narrowed.factId, 1, { visibility: "ls" }));
  assert.deepEqual(await notified(ids.ucA), who("dev", "ext"));
  await clearNotices();
  // Use case aggiunti o tolti: avvisano solo gli use case che cambiano.
  const loose = okValue(await memory.writeFact(ls, { statement: "Le consegne partono il lunedì.", section: "lavoro", visibility: "tutti" }));
  assert.deepEqual(await notified(ids.ucA), [], "senza use case nessuno da avvisare");
  okValue(await memory.editFact(ls, loose.factId, 1, { useCaseIds: [ids.ucA] }));
  assert.deepEqual(await notified(ids.ucA), who("dev", "ext"));
  await clearNotices();
  // Lo use case B in più: per lo use case A niente è cambiato, e chi lo costruisce non riceve niente.
  okValue(await memory.editFact(ls, loose.factId, 2, { useCaseIds: [ids.ucA, ids.ucB] }));
  assert.deepEqual(await notified(ids.ucA), [], "lo use case A vede lo stesso fatto");
  // Tolto dallo use case A: chi lo costruisce lo perde, anche da fuori.
  okValue(await memory.editFact(ls, loose.factId, 3, { useCaseIds: [ids.ucB] }));
  assert.deepEqual(await notified(ids.ucA), who("dev", "ext"));
  await clearNotices();
  // La conferma di una proposta nuova legata allo use case.
  const source = await insertSource();
  const proposal = randomUUID();
  await q(
    `INSERT INTO context_proposals (id, workspace_id, source_id, position, kind, statement, basis, section, visibility, use_case_ids)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'nuovo', 'Il gestionale esporta le fatture in CSV.', 'detto', 'sistemi', 'tutti', $4::uuid[])`,
    [proposal, ids.wsA, source, `{${ids.ucA}}`],
  );
  okValue(await proposals.confirmProposals(ls, [{ id: proposal, version: 1 }]));
  assert.deepEqual(await notified(ids.ucA), who("dev", "ext"));
});

test("notifyNeedAnswered: «Una risposta per «Cosa serve»» ai revisori degli use case della richiesta, tranne chi ha confermato", opts, async () => {
  await clearMemory();
  const need = randomUUID();
  const foreign = randomUUID();
  await q(`INSERT INTO use_case_needs (id, workspace_id, type, title, status, owner_side) VALUES ($1::uuid, $2::uuid, 'requisito', 'Come arrivano gli ordini?', 'chiesta', 'cliente'), ($3::uuid, $4::uuid, 'requisito', 'Una richiesta del workspace B', 'chiesta', 'cliente')`, [
    need,
    ids.wsA,
    foreign,
    ids.wsB,
  ]);
  await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid), ($1::uuid, $3::uuid), ($4::uuid, $5::uuid)`, [need, ids.ucA, ids.ucB, foreign, ids.ucX]);
  await notices.notifyNeedAnswered({ workspaceId: ids.wsA, actorUserId: ids.ls, needIds: [need, foreign] });
  // I revisori del workspace (Contributore no), tranne chi ha confermato; per i due use case della richiesta.
  for (const useCase of [ids.ucA, ids.ucB]) assert.deepEqual(await notified(useCase, "dalla_call"), who("dev", "rev", "ext", "own"));
  assert.equal((await q(`SELECT count(*)::int AS n FROM use_case_notifications WHERE workspace_id = $1::uuid`, [ids.wsB]))[0]?.n, 0, "mai per un altro workspace");
  const row = (await q(`SELECT answers, documents, unknowns, follow_up FROM use_case_notifications WHERE workspace_id = $1::uuid AND kind = 'dalla_call' LIMIT 1`, [ids.wsA]))[0];
  assert.deepEqual(row, { answers: 0, documents: 0, unknowns: 0, follow_up: null }, "senza contatori");
  await q(`DELETE FROM use_case_needs WHERE id = ANY($1::uuid[])`, [[need, foreign]]);
});

// ─── I legami con «Cosa serve» ───────────────────────────────────────

test("«Cosa serve»: la scheda vede solo i legami aperti di richieste aperte del cliente con un fatto «Per tutti»; «Chiudi con questo», «Non risponde»; un altro workspace è «non trovato»", opts, async () => {
  await clearMemory();
  const call = await insertSource({ occurredOn: "2026-11-14" });
  const documentId = randomUUID();
  await q(`INSERT INTO uploaded_documents (id, workspace_id, user_id, file_name, file_type, file_size, blob_url) VALUES ($1::uuid, $2::uuid, $3::uuid, 'ordini.txt', 'text/plain', 10, 'https://blob.test/ordini.txt')`, [documentId, ids.wsA, ids.ls]);
  const doc = randomUUID();
  await q(`INSERT INTO context_sources (id, workspace_id, kind, origin, title, occurred_on, document_id, visibility, read_status, parts_read) VALUES ($1::uuid, $2::uuid, 'documento', 'web', 'Ordini', '2026-11-10', $3::uuid, 'tutti', 'letto', 1)`, [doc, ids.wsA, documentId]);
  const need = async (title: string, status: string, ownerSide: string | null, useCases: string[], type = "requisito") => {
    const id = randomUUID();
    await q(`INSERT INTO use_case_needs (id, workspace_id, type, title, status, owner_side) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`, [id, ids.wsA, type, title, status, ownerSide]);
    for (const useCase of useCases) await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [id, useCase]);
    return id;
  };
  const link = async (needId: string, factId: string | null, status = "aperta") => {
    const id = randomUUID();
    await q(`INSERT INTO context_need_links (id, workspace_id, need_id, fact_id, status) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)`, [id, ids.wsA, needId, factId, status]);
    return id;
  };
  const shared = await insertFact({ statement: "Gli ordini arrivano via e-mail.", section: "lavoro", sourceId: call });
  const fromDoc = await insertFact({ statement: "Le fatture si esportano in CSV.", section: "sistemi", sourceId: doc });
  const internal = await insertFact({ statement: "Il listino è riservato.", section: "regole", visibility: "ls", sourceId: call });
  const open = await need("Come arrivano gli ordini?", "chiesta", "cliente", [ids.ucA]);
  const together = await need("In che formato esportate le fatture?", "da_chiedere", null, [ids.ucA, ids.ucB]);
  const closed = await need("Chi approva gli ordini?", "validata", "cliente", [ids.ucA]);
  const team = await need("Una richiesta del team", "chiesta", "lateral_space", [ids.ucA]);
  const hidden = await need("Quanto costa il listino?", "chiesta", "cliente", [ids.ucA]);
  const step = await need("Un prossimo passo", "proposta", "cliente", [ids.ucA], "passo");
  const proposed = await need("Una richiesta con un legame solo proposto", "chiesta", "cliente", [ids.ucA]);
  const used = await link(open, shared);
  const dismissed = await link(together, fromDoc);
  for (const [needId, factId] of [[closed, shared], [team, shared], [hidden, internal], [step, shared]] as const) await link(needId, factId);
  await link(proposed, null, "proposta");

  assert.deepEqual(await needs.listNeedLinks(actor("rev"), ids.ucA), {
    [open]: { id: used, needId: open, statement: "Gli ordini arrivano via e-mail.", from: "call", date: "14 nov" },
    [together]: { id: dismissed, needId: together, statement: "Le fatture si esportano in CSV.", from: "documento", date: "10 nov" },
  });
  assert.deepEqual(Object.keys(await needs.listNeedLinks(actor("rev"), ids.ucB)), [together], "una richiesta di due use case");
  assert.deepEqual(await needs.listNeedLinks(actor("con"), ids.ucA), {}, "chi contribuisce non vede «Cosa serve»");
  assert.deepEqual(await needs.listNeedLinks(actor("lsb"), ids.ucA), {}, "un altro workspace");

  assert.equal(errorOf(await needs.markNeedLinkUsed(actor("con"), used)), "permesso_mancante");
  assert.equal(errorOf(await needs.markNeedLinkUsed(actor("lsb"), used)), "non_trovato", "un legame di un altro workspace");
  assert.equal(errorOf(await needs.markNeedLinkUsed(actor("rev"), "non-un-uuid")), "non_trovato");
  okValue(await needs.markNeedLinkUsed(actor("rev"), used));
  assert.equal(errorOf(await needs.markNeedLinkUsed(actor("rev"), used)), "versione_superata", "già usato");
  okValue(await needs.dismissNeedLink(actor("own"), dismissed));
  assert.equal(errorOf(await needs.dismissNeedLink(actor("lsb"), dismissed)), "non_trovato");
  const decided = await q(`SELECT id, status, decided_by_user_id, decided_at IS NOT NULL AS dated, version FROM context_need_links WHERE id = ANY($1::uuid[]) ORDER BY status DESC`, [[used, dismissed]]);
  assert.deepEqual(decided.map((r) => [r.id, r.status, r.decided_by_user_id, r.dated, r.version]), [
    [used, "usata", ids.rev, true, 2],
    [dismissed, "scartata", ids.own, true, 2],
  ]);
  const events = await q(`SELECT action, actor_user_id, fact_id, detail FROM context_events WHERE workspace_id = $1::uuid AND action LIKE 'richiesta\\_%' ORDER BY action`, [ids.wsA]);
  assert.deepEqual(events.map((e) => [e.action, e.actor_user_id, e.fact_id, e.detail]), [
    ["richiesta_chiusa", null, shared, { esigenza: open }],
    ["richiesta_scartata", null, fromDoc, { esigenza: together }],
  ]);
  assert.deepEqual(await needs.listNeedLinks(actor("rev"), ids.ucA), {}, "usati e scartati spariscono");
  await q(`DELETE FROM use_case_needs WHERE id = ANY($1::uuid[])`, [[open, together, closed, team, hidden, step, proposed]]);
  await q(`DELETE FROM uploaded_documents WHERE id = $1::uuid`, [documentId]);
});

// ─── `unbundle impara`, `unbundle nota`, le fonti nuove ──────────────

test("addLearning: una proposta «Solo Lateral Space» mai preselezionata, la riconferma, «già proposta», il nome fermato, la frase lunga, il tetto del giorno", opts, async () => {
  await clearMemory();
  await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE $1`, [`ctx:ws:${ids.wsA}:impara%`]);
  const cli = (person: Person) => actor(person, "cli");
  const learn = (person: Person, text: string, section?: "sistemi" | "regole") => learning.addLearning(cli(person), { useCaseId: ids.ucA, code: CODE(1), text, section });

  const first = okValue(await learn("dev", "Il gestionale esporta le fatture solo in CSV, ogni notte."));
  assert.equal(first.esito, "proposta");
  const proposalId = (first as { proposalId: string }).proposalId;
  const [row] = await q(
    `SELECT p.kind, p.basis, p.section, p.visibility, p.use_case_ids::text AS use_cases, p.target_fact_id, s.kind AS source_kind, s.origin, s.external_id, s.title, s.read_status, s.added_by_user_id
     FROM context_proposals p JOIN context_sources s ON s.id = p.source_id WHERE p.id = $1::uuid`,
    [proposalId],
  );
  assert.deepEqual({ ...row, external_id: String(row?.external_id).slice(0, 7) }, {
    kind: "nuovo",
    basis: "detto",
    section: "sistemi",
    visibility: "ls",
    use_cases: `{${ids.ucA}}`,
    target_fact_id: null,
    source_kind: "appunti",
    origin: "cli",
    external_id: "impara:",
    title: `Imparato costruendo ${CODE(1)}`,
    read_status: "letto",
    added_by_user_id: ids.dev,
  });
  // In «Da confermare»: mai preselezionata, con la fonte «da chi costruisce».
  const open = await proposals.listOpenProposals(actor("ls"));
  assert.ok(open);
  const view = open.proposals.find((p) => p.id === proposalId);
  assert.equal(view?.preselected, false);
  assert.equal(open.sources.find((src) => src.id === view?.sourceId)?.learned, true);
  assert.deepEqual((await q(`SELECT action, channel, actor_user_id, detail FROM context_events WHERE workspace_id = $1::uuid AND action = 'cosa_imparata'`, [ids.wsA])).map((e) => [e.action, e.channel, e.actor_user_id, e.detail]), [
    ["cosa_imparata", "cli", ids.dev, { esito: "proposta", sezione: "sistemi" }],
  ]);

  // La stessa frase, scritta un po' diversa: è già tra le proposte.
  assert.deepEqual(okValue(await learn("ls", "il gestionale esporta le fatture solo in csv ogni notte")), { esito: "gia_proposta" });
  // La frase di un fatto in memoria: una proposta di riconferma.
  const known = await insertFact({ statement: "I dati restano in Italia.", section: "regole" });
  const again = okValue(await learn("ls", "I dati restano in Italia.", "regole"));
  assert.equal(again.esito, "riconferma");
  assert.equal((await q(`SELECT kind, target_fact_id FROM context_proposals WHERE id = $1::uuid`, [(again as { proposalId: string }).proposalId]))[0]?.target_fact_id, known);
  // Un fatto «Solo Lateral Space» non si rivela a chi costruisce da fuori: per lui è una proposta nuova.
  await insertFact({ statement: "Il listino segue la marginalità interna.", section: "regole", visibility: "ls" });
  assert.equal(okValue(await learn("ext", "Il listino segue la marginalità interna.", "regole")).esito, "proposta");

  // I controlli: un nome, una frase lunga o corta, uno use case di un altro workspace, chi non apre «Contesto».
  const named = await learn("dev", "Mario Rossi approva gli ordini sopra soglia.");
  assert.equal(errorOf(named), "dati_non_validi");
  assert.match((named as { message: string }).message, /nom/i);
  assert.equal(errorOf(await learn("dev", `Il processo ${"lungo ".repeat(40)}`)), "dati_non_validi");
  assert.equal((await learn("dev", `Il processo ${"lungo ".repeat(40)}`) as { message: string }).message, "Al massimo 200 caratteri: una cosa per volta.");
  assert.equal(errorOf(await learn("dev", "Corto.")), "dati_non_validi");
  assert.equal(errorOf(await learning.addLearning(cli("dev"), { useCaseId: ids.ucX, code: CODE(9), text: "Una cosa di un altro workspace." })), "non_trovato");
  assert.equal(errorOf(await learning.addLearning({ ...cli("dev"), role: "learner" }, { useCaseId: ids.ucA, code: CODE(1), text: "Una cosa imparata da chi segue un corso." })), "permesso_mancante");

  // Il tetto del giorno: 30 per workspace. Le quattro arrivate fin qui contano; quelle fermate dai controlli no.
  let saved = 0;
  let limited: { esito: string; retryAfterSeconds?: number } | null = null;
  for (let i = 0; i < 40 && !limited; i++) {
    const outcome = okValue(await learn("dev", `La cosa imparata numero ${i + 1} sul gestionale.`));
    if (outcome.esito === "limite") limited = outcome;
    else saved += 1;
  }
  assert.equal(saved, 26);
  assert.ok(limited && (limited.retryAfterSeconds ?? 0) > 0);
  await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE $1`, [`ctx:ws:${ids.wsA}:impara%`]);
});

test("`unbundle nota`: un appunto con l'origine «cli», solo per Lateral Space; le fonti di risposte non si tolgono", opts, async () => {
  await clearMemory();
  const note = okValue(await sources.addContextNote(actor("ls", "cli"), { title: "Call di avvio", occurredOn: "2026-11-18", body: "Appunti di prova della call di avvio con il cliente di prova.", origin: "cli" }));
  assert.equal(note.created, true);
  assert.deepEqual((await q(`SELECT origin, kind, visibility, read_status FROM context_sources WHERE id = $1::uuid`, [note.sourceId]))[0], { origin: "cli", kind: "appunti", visibility: "ls", read_status: "da_leggere" });
  assert.equal(errorOf(await sources.addContextNote(actor("ext", "cli"), { title: "Call di avvio", occurredOn: "2026-11-18", body: "Appunti di prova di chi costruisce da fuori.", origin: "cli" })), "permesso_mancante");
  assert.equal((await q(`SELECT channel FROM context_events WHERE source_id = $1::uuid AND action = 'fonte_aggiunta'`, [note.sourceId]))[0]?.channel, "cli");
  // Una fonte di risposte del referente: nell'elenco senza «Togli», e «Togli» non passa.
  const answers = await insertSource({ kind: "risposta", origin: "rispondi", externalId: randomUUID() });
  const listed = (await sources.listContextSources(actor("ls"))).find((src) => src.id === answers);
  assert.equal(listed?.canRemove, false);
  assert.equal((await sources.getContextSource(actor("ls"), answers))?.canRemove, false);
  assert.equal((await sources.listContextSources(actor("ls"))).find((src) => src.id === note.sourceId)?.canRemove, true);
  assert.equal(errorOf(await sources.removeContextSource(actor("ls"), answers)), "permesso_mancante");
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_sources WHERE id = $1::uuid`, [answers]))[0]?.n, 1);
});
