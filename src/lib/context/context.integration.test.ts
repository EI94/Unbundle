import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fakeAppClaude, hang, installAppModules, message, recordLogs, refusal, THINKING, type Reply } from "../ai/claude-test-kit.ts";

// «Contesto» sul database del pacchetto (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §11.2): la 0038 e la sua sonda, la
// tesi del valore per workspace, appunti e documenti, la lettura con il Claude finto, proposte e conferma, la memoria
// per Lateral Space e per il cliente, «Chiedi», «In breve», la notte.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Dati
//   sintetici, creati e cancellati qui. Nessun modello vero: risponde il Claude finto di claude-test-kit.ts.
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
let ensure: typeof import("../db/ensure-schema.ts");
let ddl: typeof import("../db/context-ddl.ts");
let store: typeof import("../db/queries/context-store.ts");
let thesis: typeof import("../db/queries/value-thesis.ts");
let sources: typeof import("../db/queries/context-sources.ts");
let reading: typeof import("../db/queries/context-read.ts");
let consent: typeof import("../db/queries/context-consent.ts");
let proposals: typeof import("../db/queries/context-proposals.ts");
let memory: typeof import("../db/queries/context-memory.ts");
let actors: typeof import("./server/actor.ts");

const LS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");

/**
 * Le persone. Nel workspace A (il cliente con l'ok ai sub-responsabili):
 * - ls: Lateral Space, Responsabile della trasformazione; lsc: Lateral Space, Contributore;
 * - rev: cliente, Analista (revisore); con: cliente, Contributore; lrn: segue solo un corso.
 * Nel workspace B (senza l'ok): lsb, Lateral Space. out: nessun workspace.
 */
const people = ["ls", "lsc", "rev", "con", "lrn", "lsb", "out"] as const;
type Person = (typeof people)[number];
const ids = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  ucA: randomUUID(),
  unitA: randomUUID(),
  goalA: randomUUID(),
  ...(Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>),
};
const EMAIL: Record<Person, string> = {
  ls: `ls-${suffix}@ls.test`,
  lsc: `lsc-${suffix}@ls.test`,
  rev: `rev-${suffix}@cliente.test`,
  con: `con-${suffix}@cliente.test`,
  lrn: `lrn-${suffix}@cliente.test`,
  lsb: `lsb-${suffix}@ls.test`,
  out: `out-${suffix}@altrove.test`,
};
const ROLE: Partial<Record<Person, [workspace: "wsA" | "wsB", role: string]>> = {
  ls: ["wsA", "transformation_lead"],
  lsc: ["wsA", "contributor"],
  rev: ["wsA", "analyst"],
  con: ["wsA", "contributor"],
  lrn: ["wsA", "learner"],
  lsb: ["wsB", "transformation_lead"],
};
/** La sessione finta di `auth()`: null vuol dire «nessuno ha fatto l'accesso». */
function signIn(person: Person | null, emailVerified = true) {
  (globalThis as { __ctxSession?: unknown }).__ctxSession = person ? { user: { id: ids[person], name: `Persona ${person}`, email: EMAIL[person], image: null, emailVerified } } : null;
}

/** Organizzazioni e workspace creati dai singoli test, da cancellare alla fine. */
const extraOrgs: string[] = [];

type Actor = import("./visibility.ts").ContextActor;
const actor = (person: Person, workspace: "wsA" | "wsB" = ROLE[person]?.[0] ?? "wsA", channel: Actor["channel"] = "web"): Actor => ({
  workspaceId: ids[workspace],
  userId: ids[person],
  role: ROLE[person]?.[0] === workspace ? ROLE[person]![1] : null,
  isLateralSpace: EMAIL[person].endsWith("@ls.test"),
  channel,
});

const NOTE = `Call di avvio con il cliente di prova.
Il gestionale è SAP Business One. Gli ordini si inseriscono a mano, ogni mattina.
Il direttore operativo dice: «L’ERP lo cambiamo entro giugno».
Il contratto con Lateral Space vale 40.000 euro.`;

const json = (value: unknown): Reply => message([THINKING, { type: "text", text: JSON.stringify(value) }]);
const NOTHING_SKIPPED = { persone: 0, sanitari: 0, altriClienti: 0, clientiDelCliente: 0 };
type ModelProposal = Record<string, unknown>;
const proposal = (over: ModelProposal = {}): ModelProposal => ({
  tipo: "nuovo",
  testo: "Gli ordini si inseriscono a mano ogni mattina.",
  citazione: "Gli ordini si inseriscono a mano, ogni mattina.",
  base: "detto",
  sezione: "lavoro",
  visibilita: "tutti",
  fattoRif: null,
  domandaRif: null,
  useCase: [],
  parte: null,
  ruolo: null,
  entro: null,
  entita: [],
  collegamenti: [],
  ...over,
});
const answer = (proposte: ModelProposal[], nonRiportati: Partial<typeof NOTHING_SKIPPED> = {}): Reply => json({ proposte, nonRiportati: { ...NOTHING_SKIPPED, ...nonRiportati } });

function okValue<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string; fieldErrors?: Record<string, string> }): T {
  assert.ok(result.ok, result.ok ? "" : `${result.error}: ${result.message} ${JSON.stringify(result.fieldErrors ?? {})}`);
  return (result as { ok: true; value: T }).value;
}
function errOf(result: { ok: boolean; error?: string }): string | null {
  return result.ok ? null : (result.error ?? null);
}

let noteCounter = 0;
/** Un appunto nuovo nel workspace A, con un testo diverso a ogni chiamata. */
async function addNote(body = `${NOTE}\nNota di prova numero ${++noteCounter} (${suffix}).`, who: Person = "ls", title = "Call di avvio") {
  return okValue(await sources.addContextNote(actor(who), { title, occurredOn: "2026-11-14", body, origin: "web" }));
}

before(async () => {
  if (!enabled) return;
  process.env.UC_LS_EMAIL_DOMAINS = LS.join(",");
  // La sessione è finta (Firebase non c'è): `auth()` risponde con la persona che il test mette in `session`.
  await installAppModules({ "@/lib/auth": `export const auth = async () => globalThis.__ctxSession ?? null;` });
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  ddl = await import("../db/context-ddl.ts");
  store = await import("../db/queries/context-store.ts");
  thesis = await import("../db/queries/value-thesis.ts");
  sources = await import("../db/queries/context-sources.ts");
  reading = await import("../db/queries/context-read.ts");
  consent = await import("../db/queries/context-consent.ts");
  proposals = await import("../db/queries/context-proposals.ts");
  memory = await import("../db/queries/context-memory.ts");
  actors = await import("./server/actor.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione A di prova contesto', $2), ($3, 'Organizzazione B di prova contesto', $4)`, [
    ids.orgA,
    `org-ctx-a-${suffix}`,
    ids.orgB,
    `org-ctx-b-${suffix}`,
  ]);
  await q(`INSERT INTO workspaces (id, organization_id, name, system_boundary) VALUES ($1, $2, 'Cliente A di prova', $5::jsonb), ($3, $4, 'Cliente B di prova', NULL)`, [
    ids.wsA,
    ids.orgA,
    ids.wsB,
    ids.orgB,
    JSON.stringify({ includedFunctions: ["Vendite", "Acquisti"], excludedFunctions: ["Produzione"], rationale: "Si parte dalle vendite.", timeHorizon: "12 mesi" }),
  ]);
  for (const person of people) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], `Persona ${person}`]);
    const membership = ROLE[person];
    if (membership) await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids[membership[0]], ids[person], membership[1]]);
  }
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, 'Ordini automatici', 'CX-0001')`, [ids.ucA, ids.wsA]);
  await q(`INSERT INTO departments (id, workspace_id, name, description, team_size) VALUES ($1, $2, 'Acquisti', 'Compra legno e ferramenta', 4)`, [ids.unitA, ids.wsA]);
  await q(`INSERT INTO strategic_goals (id, workspace_id, type, title) VALUES ($1, $2, 'objective', 'Ridurre i tempi di consegna')`, [ids.goalA, ids.wsA]);
  // L'ok ai sub-responsabili per la lista di oggi: solo nel workspace A.
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role)
     SELECT $1::uuid, $2, 'Registrato da Lateral Space per conto del cliente di prova.', $3::uuid, 'transformation_lead'`,
    [ids.wsA, (await import("../uc/legal/subprocessors.ts")).SUBPROCESSORS_VERSION, ids.ls],
  );
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE 'ctx:%' AND (bucket LIKE $1 OR bucket LIKE $2 OR bucket LIKE $3)`, [`%${ids.wsA}%`, `%${ids.wsB}%`, `ctx:u:%`]);
  await q(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[ids.orgA, ids.orgB, ...extraOrgs]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [people.map((p) => ids[p])]);
});

// ─── La 0038 e la sua sonda ──────────────────────────────────────────

/** Tabelle, colonne, indici e vincoli di «Contesto», per vedere se un secondo passaggio cambia qualcosa. */
async function schemaSnapshot(): Promise<string> {
  const rows = await q(
    `SELECT 'col' AS kind, table_name || '.' || column_name || ':' || data_type || ':' || is_nullable AS item FROM information_schema.columns
       WHERE table_schema = 'public' AND (table_name LIKE 'context\\_%' OR (table_name = 'workspaces' AND column_name = 'company_value_thesis'))
     UNION ALL SELECT 'idx', indexname || ':' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND (tablename LIKE 'context\\_%' OR indexname IN ('document_chunks_fts_idx', 'conversation_memory_fts_idx'))
     UNION ALL SELECT 'con', conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname LIKE 'context\\_%'
     ORDER BY 1, 2`,
  );
  return rows.map((r) => `${r.kind} ${r.item}`).join("\n");
}

test("la sonda è vera dopo il self-heal; due passaggi di fila non cambiano niente e non riscrivono la tesi", opts, async () => {
  assert.equal((await q(`SELECT ${ddl.CONTEXT_PROBE_SQL} AS ok`))[0].ok, true);
  assert.equal(await store.contextStoreReady(), true);
  const tables = await q(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`, [[...ddl.CONTEXT_TABLES]]);
  assert.equal(tables[0].n, 17);
  // Una tesi scritta dopo: il self-heal che ripassa non la tocca (riempie solo quando crea la colonna).
  await q(`UPDATE organizations SET company_value_thesis = '{"coreValueProposition":"Tesi dell''organizzazione A"}'::jsonb WHERE id = $1`, [ids.orgA]);
  await q(`UPDATE workspaces SET company_value_thesis = '{"coreValueProposition":"Tesi del workspace A"}'::jsonb WHERE id = $1`, [ids.wsA]);
  const before = await schemaSnapshot();
  await ensure.runContextDdl();
  await ensure.runContextDdl();
  assert.equal(await schemaSnapshot(), before);
  assert.equal((await q(`SELECT ${ddl.CONTEXT_PROBE_SQL} AS ok`))[0].ok, true);
  assert.deepEqual((await q(`SELECT company_value_thesis AS t FROM workspaces WHERE id = $1`, [ids.wsA]))[0].t, { coreValueProposition: "Tesi del workspace A" });
  assert.equal((await q(`SELECT company_value_thesis AS t FROM workspaces WHERE id = $1`, [ids.wsB]))[0].t, null);
  // I CHECK tengono: un appunto «Per tutti» non si può scrivere.
  await assert.rejects(
    q(`INSERT INTO context_sources (workspace_id, kind, origin, title, occurred_on, visibility) VALUES ($1, 'appunti', 'web', 'x', '2026-11-14', 'tutti')`, [ids.wsA]),
    /context_sources_notes_ls_check/,
  );
});

test("la tesi del valore, quando la colonna nasce: un solo workspace; tre con uno solo vicino alla Discovery; due vicini, nessuno", opts, async () => {
  const org = { one: randomUUID(), three: randomUUID(), two: randomUUID(), none: randomUUID() };
  const ws = { one: randomUUID(), a: randomUUID(), b: randomUUID(), c: randomUUID(), x: randomUUID(), y: randomUUID(), n: randomUUID() };
  extraOrgs.push(...Object.values(org));
  const thesisOf = (name: string) => JSON.stringify({ coreValueProposition: `Tesi di ${name}` });
  for (const [key, id] of Object.entries(org)) {
    await q(`INSERT INTO organizations (id, name, slug, company_value_thesis, updated_at) VALUES ($1, $2, $3, $4::jsonb, now())`, [id, `Org tesi ${key}`, `org-tesi-${key}-${suffix}`, key === "none" ? null : thesisOf(key)]);
  }
  const place: Array<[string, string]> = [[ws.one, org.one], [ws.a, org.three], [ws.b, org.three], [ws.c, org.three], [ws.x, org.two], [ws.y, org.two], [ws.n, org.none]];
  for (const [id, orgId] of place) await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace tesi di prova')`, [id, orgId]);
  // Un messaggio di Discovery vicino al salvataggio della tesi (b, x, y), uno lontano (c), una chat di altro tipo (a).
  const talk = async (workspaceId: string, type: string, offset: string) => {
    const conversation = randomUUID();
    await q(`INSERT INTO conversations (id, workspace_id, user_id, type) VALUES ($1, $2, $3, $4::conversation_type)`, [conversation, workspaceId, ids.ls, type]);
    await q(`INSERT INTO messages (conversation_id, role, content, created_at) VALUES ($1, 'user', 'Messaggio di prova', now() + $2::interval)`, [conversation, offset]);
  };
  await talk(ws.b, "leadership_setup", "4 seconds");
  await talk(ws.c, "leadership_setup", "-3 hours");
  await talk(ws.a, "activity_mapping", "1 second");
  await talk(ws.x, "leadership_setup", "2 minutes");
  await talk(ws.y, "leadership_setup", "-5 minutes");

  // Una copia senza la colonna: come la produzione prima della 0038.
  await q(`ALTER TABLE workspaces DROP COLUMN company_value_thesis`);
  assert.equal((await q(`SELECT ${ddl.CONTEXT_PROBE_SQL} AS ok`))[0].ok, false, "senza la colonna la sonda è falsa");
  await ensure.runContextDdl();
  assert.equal((await q(`SELECT ${ddl.CONTEXT_PROBE_SQL} AS ok`))[0].ok, true);

  const got = new Map((await q(`SELECT id, company_value_thesis AS t FROM workspaces WHERE id = ANY($1::uuid[])`, [Object.values(ws)])).map((r) => [String(r.id), r.t as { coreValueProposition?: string } | null]));
  assert.deepEqual(got.get(ws.one), { coreValueProposition: "Tesi di one" }, "un solo workspace: la tesi va a quello");
  assert.deepEqual(got.get(ws.b), { coreValueProposition: "Tesi di three" }, "il solo workspace con la Discovery vicina");
  assert.equal(got.get(ws.a), null, "una chat di mappatura non conta");
  assert.equal(got.get(ws.c), null, "una Discovery di tre ore prima non conta");
  assert.equal(got.get(ws.x), null, "due workspace vicini: a nessuno");
  assert.equal(got.get(ws.y), null);
  assert.equal(got.get(ws.n), null, "senza tesi dell'organizzazione niente da copiare");
  // L'organizzazione non si tocca: resta il valore di partenza.
  assert.deepEqual((await q(`SELECT company_value_thesis AS t FROM organizations WHERE id = $1`, [org.three]))[0].t, { coreValueProposition: "Tesi di three" });
});

test("la tesi per workspace: due workspace della stessa organizzazione salvano due tesi e ognuno rilegge la sua", opts, async () => {
  const org = randomUUID();
  const [first, second, third] = [randomUUID(), randomUUID(), randomUUID()];
  extraOrgs.push(org);
  await q(`INSERT INTO organizations (id, name, slug, company_value_thesis) VALUES ($1, 'Org due tesi', $2, '{"coreValueProposition":"Tesi di partenza"}'::jsonb)`, [org, `org-due-tesi-${suffix}`]);
  for (const id of [first, second, third]) await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace due tesi')`, [id, org]);
  const one = { coreValueProposition: "Cucine su misura", strategicNodes: ["Progettazione"], commodityNodes: [], marginDrivers: [], keyRisks: [], aiReadiness: "Bassa" };
  const two = { ...one, coreValueProposition: "Noleggio di aerei" };
  assert.equal(await thesis.saveWorkspaceValueThesis(first, one), true);
  assert.equal(await thesis.saveWorkspaceValueThesis(second, two), true);
  assert.deepEqual(await thesis.getWorkspaceValueThesis(first), one);
  assert.deepEqual(await thesis.getWorkspaceValueThesis(second), two);
  // Il terzo non ha la sua: con più workspace nell'organizzazione non eredita quella di partenza.
  assert.equal(await thesis.getWorkspaceValueThesis(third), null);
  // L'organizzazione non si scrive più.
  assert.deepEqual((await q(`SELECT company_value_thesis AS t FROM organizations WHERE id = $1`, [org]))[0].t, { coreValueProposition: "Tesi di partenza" });
  // Un'organizzazione con un solo workspace: finché il workspace non ha la sua, vale quella di partenza.
  await q(`UPDATE workspaces SET company_value_thesis = NULL WHERE id = $1`, [ids.wsA]);
  assert.deepEqual(await thesis.getWorkspaceValueThesis(ids.wsA), { coreValueProposition: "Tesi dell'organizzazione A" });
  assert.equal(await thesis.saveWorkspaceValueThesis(ids.wsA, one), true);
  assert.deepEqual(await thesis.getWorkspaceValueThesis(ids.wsA), one);
  // Un id che non esiste o non è un id.
  assert.equal(await thesis.getWorkspaceValueThesis(randomUUID()), null);
  assert.equal(await thesis.getWorkspaceValueThesis("non-un-id"), null);
  assert.equal(await thesis.saveWorkspaceValueThesis(randomUUID(), one), false);
});

// ─── Chi chiama ──────────────────────────────────────────────────────

test("contextActorForUser rilegge ruolo e Lateral Space; chi non ha accesso, o segue solo un corso, non ha un attore", opts, async () => {
  assert.deepEqual(await actors.contextActorForUser(ids.ls, ids.wsA, "cron"), { workspaceId: ids.wsA, userId: ids.ls, role: "transformation_lead", isLateralSpace: true, channel: "cron" });
  assert.deepEqual(await actors.contextActorForUser(ids.rev, ids.wsA, "granola"), { workspaceId: ids.wsA, userId: ids.rev, role: "analyst", isLateralSpace: false, channel: "granola" });
  assert.equal(await actors.contextActorForUser(ids.lrn, ids.wsA, "cron"), null);
  assert.equal(await actors.contextActorForUser(ids.out, ids.wsA, "cron"), null);
  assert.equal(await actors.contextActorForUser(ids.ls, ids.wsB, "cron"), null, "Lateral Space, ma non in questo workspace");
  assert.equal(await actors.contextActorForUser("non-un-id", ids.wsA, "cron"), null);
  assert.deepEqual(actors.contextActorFor({ id: ids.con, email: EMAIL.con, emailVerified: true }, { role: "contributor" }, ids.wsA), actor("con"));
  // Un'e-mail di Lateral Space non verificata non è Lateral Space.
  assert.equal(actors.contextActorFor({ id: ids.ls, email: EMAIL.ls, emailVerified: false }, { role: "analyst" }, ids.wsA).isLateralSpace, false);
});

test("contextActorFromSession: senza sessione 401, senza accesso 404 (anche per chi segue solo un corso), altrimenti chi chiama", opts, async () => {
  signIn(null);
  assert.deepEqual(await actors.contextActorFromSession(ids.wsA), { ok: false, status: 401 });
  signIn("ls");
  assert.deepEqual(await actors.contextActorFromSession(ids.wsA), { ok: true, actor: actor("ls") });
  assert.deepEqual(await actors.contextActorFromSession(ids.wsB), { ok: false, status: 404 }, "un altro workspace non si dice che c'è");
  assert.deepEqual(await actors.contextActorFromSession("non-un-id"), { ok: false, status: 404 });
  assert.deepEqual(await actors.contextActorFromSession(randomUUID()), { ok: false, status: 404 });
  signIn("con");
  assert.deepEqual(await actors.contextActorFromSession(ids.wsA), { ok: true, actor: actor("con") });
  signIn("lrn");
  assert.deepEqual(await actors.contextActorFromSession(ids.wsA), { ok: false, status: 404 });
  signIn("out");
  assert.deepEqual(await actors.contextActorFromSession(ids.wsA), { ok: false, status: 404 });
  // Un'e-mail di Lateral Space non verificata: entra come collaboratore, non come Lateral Space.
  signIn("lsc", false);
  const unverified = await actors.contextActorFromSession(ids.wsA);
  assert.equal(unverified.ok && unverified.actor.isLateralSpace, false);
  signIn(null);
});

// ─── Appunti ─────────────────────────────────────────────────────────

test("addContextNote: salva, scrive la storia senza testi, e lo stesso testo due volte è una riga sola", opts, async () => {
  const body = `${NOTE}\nPrima nota (${suffix}).`;
  const first = await addNote(body);
  assert.equal(first.created, true);
  assert.equal(first.readStatus, "da_leggere");
  const [row] = await q(`SELECT kind, origin, title, occurred_on::text AS day, body, body_chars, body_hash, visibility, read_status, parts_total, added_by_user_id::text AS who FROM context_sources WHERE id = $1`, [first.sourceId]);
  assert.deepEqual(
    { kind: row.kind, origin: row.origin, title: row.title, day: row.day, visibility: row.visibility, status: row.read_status, parts: row.parts_total, who: row.who },
    { kind: "appunti", origin: "web", title: "Call di avvio", day: "2026-11-14", visibility: "ls", status: "da_leggere", parts: 1, who: ids.ls },
  );
  assert.equal(row.body, body);
  assert.equal(row.body_chars, body.length);
  assert.match(String(row.body_hash), /^[0-9a-f]{64}$/);
  // Lo stesso testo, anche con altri a capo e da un'altra persona: torna la riga di prima.
  const again = okValue(await sources.addContextNote(actor("lsc", "wsA", "claude"), { title: "Un altro titolo", occurredOn: "2026-11-15", body: `${body.replace(/\n/g, "\r\n")}\r\n`, origin: "claude" }));
  assert.deepEqual(again, { sourceId: first.sourceId, created: false, readStatus: "da_leggere" });
  // Due salvataggi insieme dello stesso testo: una riga sola.
  const twin = `${NOTE}\nNota gemella (${suffix}).`;
  const [a, b] = await Promise.all([addNote(twin), addNote(twin)]);
  assert.equal(a.sourceId, b.sourceId);
  assert.deepEqual([a.created, b.created].sort(), [false, true]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_sources WHERE workspace_id = $1 AND body_hash = (SELECT body_hash FROM context_sources WHERE id = $2)`, [ids.wsA, a.sourceId]))[0].n, 1);
  // La storia: una riga per appunto nato, con chi l'ha aggiunto; nel dettaglio solo codici e numeri.
  const events = await q(`SELECT action, channel, actor_user_id::text AS who, detail FROM context_events WHERE source_id = $1`, [first.sourceId]);
  assert.deepEqual(events, [{ action: "fonte_aggiunta", channel: "web", who: ids.ls, detail: { origine: "web", tipo: "appunti", caratteri: body.length } }]);
  // Lo stesso testo in un altro workspace è un altro appunto.
  const other = okValue(await sources.addContextNote(actor("lsb"), { title: "Call di avvio", occurredOn: "2026-11-14", body, origin: "web" }));
  assert.equal(other.created, true);
  assert.notEqual(other.sourceId, first.sourceId);
});

test("addContextNote: solo Lateral Space; i campi sbagliati dicono quale; «visita medica» ferma il salvataggio con la parola trovata", opts, async () => {
  const valid = { title: "Call di avvio", occurredOn: "2026-11-14", body: `${NOTE}\nNota da non salvare (${suffix}).`, origin: "web" as const };
  for (const person of ["rev", "con", "lrn", "out"] as const) {
    assert.equal(errOf(await sources.addContextNote(actor(person), valid)), "permesso_mancante", person);
  }
  // Lateral Space, ma in un workspace dove non è.
  assert.equal(errOf(await sources.addContextNote(actor("ls", "wsB"), valid)), "permesso_mancante");
  const bad = await sources.addContextNote(actor("ls"), { title: " a ", occurredOn: "2026-02-30", body: "corto", participants: "x".repeat(501), link: "http://esempio.test/nota", origin: "web" });
  assert.equal(errOf(bad), "dati_non_validi");
  assert.deepEqual(!bad.ok && bad.fieldErrors, {
    title: "Scrivi un titolo.",
    occurredOn: "Scegli una data.",
    body: "Scrivi almeno qualche riga.",
    participants: "Al massimo 500 caratteri.",
    link: "Il link deve cominciare con https://.",
  });
  assert.deepEqual(!bad.ok && bad.message, "Controlla i campi indicati.");
  const tooLong = await sources.addContextNote(actor("ls"), { ...valid, body: "parola ".repeat(50_000) });
  assert.deepEqual(!tooLong.ok && tooLong.fieldErrors, { body: "Gli appunti superano 300.000 caratteri: dividili in due." });
  const health = await sources.addContextNote(actor("ls"), { ...valid, body: `${NOTE}\nIl magazziniere è assente per una visita medica.` });
  assert.equal(errOf(health), "dati_non_validi");
  assert.deepEqual(!health.ok && health.fieldErrors, { body: "Negli appunti ci sono dati sanitari («visita medica»). Toglili e riprova." });
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_sources WHERE workspace_id = $1 AND body LIKE '%visita medica%'`, [ids.wsA]))[0].n, 0, "niente salvato");
  // Un nome nel testo e in «Con chi» passa: l'appunto lo vede solo Lateral Space.
  const named = okValue(await sources.addContextNote(actor("ls"), { ...valid, body: `${NOTE}\nMario Rossi conferma le date (${suffix}).`, participants: "Mario Rossi, Anna Bianchi", link: "https://esempio.test/nota" }));
  assert.equal(named.created, true);
});

test("upsertExternalNote: la call di Granola nasce una volta; con lo stesso testo cambia solo la data; con un testo nuovo si rilegge", opts, async () => {
  const meeting = `not_${suffix}_1`;
  const input = { title: "Call settimanale", occurredOn: "2026-11-10", body: `[Riassunto di Granola]\nIl magazzino passa a due turni (${suffix}).`, origin: "granola" as const, externalId: meeting, externalUpdatedAt: new Date("2026-11-10T10:00:00Z") };
  const created = okValue(await sources.upsertExternalNote(actor("ls", "wsA", "granola"), input));
  assert.deepEqual({ created: created.created, changed: created.changed, status: created.readStatus }, { created: true, changed: true, status: "da_leggere" });
  // Una proposta aperta e una già confermata su questo appunto.
  await q(
    `INSERT INTO context_proposals (workspace_id, source_id, position, kind, statement, basis, section, visibility, status, decided_at)
     VALUES ($1, $2, 1, 'nuovo', 'Il magazzino passa a due turni.', 'detto', 'lavoro', 'tutti', 'aperta', NULL), ($1, $2, 2, 'nuovo', 'Il magazzino è a Udine.', 'detto', 'lavoro', 'tutti', 'confermata', now())`,
    [ids.wsA, created.sourceId],
  );
  await q(`UPDATE context_sources SET read_status = 'letto', parts_read = 1 WHERE id = $1`, [created.sourceId]);
  const same = okValue(await sources.upsertExternalNote(actor("ls", "wsA", "granola"), { ...input, externalUpdatedAt: new Date("2026-11-11T09:00:00Z") }));
  assert.deepEqual({ id: same.sourceId, created: same.created, changed: same.changed, status: same.readStatus }, { id: created.sourceId, created: false, changed: false, status: "letto" });
  assert.equal((await q(`SELECT (external_updated_at = '2026-11-11T09:00:00Z'::timestamptz) AS same FROM context_sources WHERE id = $1`, [created.sourceId]))[0].same, true);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_proposals WHERE source_id = $1 AND status = 'aperta'`, [created.sourceId]))[0].n, 1, "le proposte restano");
  // La call cambia dopo: torna da leggere, le proposte aperte diventano superate, le confermate restano.
  const changed = okValue(await sources.upsertExternalNote(actor("lsc", "wsA", "granola"), { ...input, title: "Call settimanale, rivista", body: `${input.body}\nDa gennaio anche il sabato.` }));
  assert.deepEqual({ id: changed.sourceId, created: changed.created, changed: changed.changed, status: changed.readStatus }, { id: created.sourceId, created: false, changed: true, status: "da_leggere" });
  const [row] = await q(`SELECT title, read_status, parts_read, version FROM context_sources WHERE id = $1`, [created.sourceId]);
  assert.deepEqual(row, { title: "Call settimanale, rivista", read_status: "da_leggere", parts_read: 0, version: 2 });
  assert.deepEqual((await q(`SELECT status FROM context_proposals WHERE source_id = $1 ORDER BY position`, [created.sourceId])).map((r) => r.status), ["superata", "confermata"]);
  assert.deepEqual((await q(`SELECT action FROM context_events WHERE source_id = $1 ORDER BY at`, [created.sourceId])).map((r) => r.action), ["fonte_aggiunta", "fonte_aggiornata"]);
  // Due giri insieme sulla stessa call nuova: una riga sola.
  const twin = { ...input, externalId: `not_${suffix}_2`, body: `[Riassunto di Granola]\nUn'altra call (${suffix}).` };
  const [x, y] = await Promise.all([sources.upsertExternalNote(actor("ls", "wsA", "granola"), twin), sources.upsertExternalNote(actor("lsc", "wsA", "granola"), twin)]);
  assert.equal(okValue(x).sourceId, okValue(y).sourceId);
  // Il controllo dei testi vale anche qui, e chi non è di Lateral Space non passa.
  assert.equal(errOf(await sources.upsertExternalNote(actor("ls", "wsA", "granola"), { ...input, externalId: `not_${suffix}_3`, body: `${input.body}\nIl titolare ha una visita medica.` })), "dati_non_validi");
  assert.equal(errOf(await sources.upsertExternalNote(actor("rev", "wsA", "granola"), { ...input, externalId: `not_${suffix}_4` })), "permesso_mancante");
});

// ─── Lettura ─────────────────────────────────────────────────────────

test("readContextSource con il Claude finto: le proposte si salvano, passate dalle regole; la storia dice quante, senza testi", opts, async () => {
  const note = await addNote();
  const requests = fakeAppClaude([
    answer(
      [
        proposal({ useCase: ["CX-0001"], entita: [{ nome: "Acquisti", tipo: "unita" }, { nome: "SAP Business One", tipo: "sistema" }], collegamenti: [{ da: "Acquisti", verbo: "usa", a: "SAP Business One" }] }),
        proposal({ tipo: "nuovo", testo: "Il cliente vuole cambiare fornitore di legno.", citazione: "Vogliamo cambiare fornitore al più presto.", sezione: "obiettivi" }),
        proposal({ tipo: "impegno", testo: "Mandare l'elenco dei fornitori.", citazione: "", sezione: null, parte: "cliente", ruolo: "responsabile acquisti", entro: "2026-11-30" }),
        proposal({ tipo: "nuovo", testo: "Mario Rossi decide gli acquisti.", citazione: "", sezione: "persone" }),
        proposal({ tipo: "nuovo", testo: "Il magazziniere è assente per una visita medica.", citazione: "", sezione: "persone" }),
      ],
      { persone: 2 },
    ),
  ]);
  const outcome = okValue(await reading.readContextSource(actor("ls"), note.sourceId));
  assert.deepEqual(outcome, { status: "letto", proposals: 4, skipped: { persone: 2, sanitari: 1 } });
  assert.equal(requests.length, 1);
  // Nel prompt: il cliente, la memoria, gli elenchi, gli appunti nel loro blocco; mai «Con chi».
  const body = JSON.stringify(requests[0].body);
  assert.ok(body.includes("Cliente A di prova") && body.includes("CX-0001 | Ordini automatici") && body.includes("U1 | Acquisti") && body.includes("O1 | Ridurre i tempi di consegna"));
  assert.ok(/<appunti-[a-z0-9]{12}>/.test(body));
  const rows = await q(`SELECT position, kind, statement, quote, basis, section, visibility, use_case_ids::text[] AS ucs, party, role_label, due_on::text AS due, entities, relations, issue, status FROM context_proposals WHERE source_id = $1 ORDER BY position`, [note.sourceId]);
  assert.deepEqual(rows.map((r) => [r.position, r.kind, r.basis, r.issue, r.status]), [
    [1, "nuovo", "detto", null, "aperta"],
    [2, "nuovo", "dedotto", null, "aperta"],
    [3, "impegno", "dedotto", null, "aperta"],
    [4, "nuovo", "dedotto", "nome_persona", "aperta"],
  ]);
  assert.equal(rows[0].quote, "Gli ordini si inseriscono a mano, ogni mattina.");
  assert.equal(rows[1].quote, null, "una citazione che gli appunti non contengono non si salva");
  assert.deepEqual(rows[0].ucs, [ids.ucA]);
  assert.deepEqual(rows[0].entities, [{ name: "Acquisti", type: "unita", refId: ids.unitA }, { name: "SAP Business One", type: "sistema" }]);
  assert.deepEqual(rows[0].relations, [{ from: "Acquisti", verb: "usa", to: "SAP Business One" }]);
  assert.deepEqual([rows[2].section, rows[2].party, rows[2].role_label, rows[2].due], [null, "cliente", "responsabile acquisti", "2026-11-30"]);
  const [source] = await q(`SELECT read_status, read_reason, read_attempts, parts_read, parts_total, skipped, read_at IS NOT NULL AS read, read_started_at FROM context_sources WHERE id = $1`, [note.sourceId]);
  assert.deepEqual(source, { read_status: "letto", read_reason: null, read_attempts: 0, parts_read: 1, parts_total: 1, skipped: { persone: 2, sanitari: 1 }, read: true, read_started_at: null });
  const [event] = await q(`SELECT action, channel, actor_user_id::text AS who, detail FROM context_events WHERE source_id = $1 AND action = 'fonte_letta'`, [note.sourceId]);
  assert.deepEqual(event, { action: "fonte_letta", channel: "web", who: ids.ls, detail: { proposte: 4, parte: 1, parti: 1, oltre_il_tetto: 0 } });
  // Niente è entrato in memoria: lo fa solo la conferma di una persona.
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_facts WHERE source_id = $1`, [note.sourceId]))[0].n, 0);
  // Una seconda lettura non richiama il modello: la fonte è già letta.
  const none = fakeAppClaude([]);
  assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), note.sourceId)), { status: "letto", proposals: 4, skipped: { persone: 2, sanitari: 1 } });
  assert.equal(none.length, 0);
});

test("readContextSource: un rifiuto lascia l'appunto «non letto», senza proposte; il tempo scaduto lo riporta da leggere; al terzo errore resta non letto", opts, async (t) => {
  const lines = recordLogs(t);
  const refused = await addNote();
  fakeAppClaude([refusal([], "general_harms")]);
  assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), refused.sourceId)), { status: "rifiuto" });
  assert.deepEqual((await q(`SELECT read_status, read_reason, read_started_at FROM context_sources WHERE id = $1`, [refused.sourceId]))[0], { read_status: "non_letto", read_reason: "rifiuto", read_started_at: null });
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_proposals WHERE source_id = $1`, [refused.sourceId]))[0].n, 0);
  // Non si riprova da soli: senza «Rileggi» il modello non riparte.
  const quiet = fakeAppClaude([]);
  assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), refused.sourceId)), { status: "rifiuto" });
  assert.equal(quiet.length, 0);

  const slow = await addNote();
  fakeAppClaude([hang]);
  assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), slow.sourceId, { timeoutMs: 60 })), { status: "tempo" });
  assert.deepEqual((await q(`SELECT read_status, read_reason, read_attempts, read_started_at FROM context_sources WHERE id = $1`, [slow.sourceId]))[0], { read_status: "da_leggere", read_reason: "tempo", read_attempts: 1, read_started_at: null });

  const broken = await addNote();
  const apiError: Reply = () => Response.json({ type: "error", error: { type: "invalid_request_error", message: "Richiesta con testi riservati" } }, { status: 400 });
  for (const [attempt, status] of [[1, "da_leggere"], [2, "da_leggere"], [3, "non_letto"]] as const) {
    fakeAppClaude([apiError]);
    assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), broken.sourceId)), { status: "errore" }, `tentativo ${attempt}`);
    assert.deepEqual((await q(`SELECT read_status, read_reason, read_attempts FROM context_sources WHERE id = $1`, [broken.sourceId]))[0], { read_status: status, read_reason: "errore", read_attempts: attempt });
  }
  // Un oggetto che non rispetta lo schema è un errore come gli altri.
  const invalid = await addNote();
  fakeAppClaude([json({ proposte: [{ tipo: "ordine" }], nonRiportati: {} })]);
  assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), invalid.sourceId)), { status: "errore" });
  // «Rileggi» riparte da capo, anche dopo un rifiuto.
  fakeAppClaude([answer([proposal()])]);
  assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), refused.sourceId, { again: true })), { status: "letto", proposals: 1, skipped: {} });
  // Nei log: codici e id, mai i testi degli appunti o il messaggio dell'API.
  assert.ok(lines.some((l) => l.startsWith("[context/read] risposta_rifiutata ")));
  assert.ok(lines.some((l) => l.startsWith("[context/read] tempo_scaduto ")));
  assert.ok(lines.some((l) => l.startsWith("[context/read] lettura_non_riuscita ") && l.includes(broken.sourceId)));
  for (const line of lines) assert.doesNotMatch(line, /gestionale|SAP|riservati|Call di avvio/, line);
});

test("readContextSource senza l'ok ai sub-responsabili: l'appunto resta salvato, nessuna richiesta al modello, il tentativo non conta", opts, async () => {
  assert.equal(await consent.contextAiConsentNow(ids.wsA), true);
  assert.equal(await consent.contextAiConsentNow(ids.wsB), false);
  const note = okValue(await sources.addContextNote(actor("lsb"), { title: "Call senza ok", occurredOn: "2026-11-14", body: `${NOTE}\nWorkspace senza ok (${suffix}).`, origin: "web" }));
  const requests = fakeAppClaude([answer([proposal()])]);
  assert.deepEqual(okValue(await reading.readContextSource(actor("lsb"), note.sourceId)), { status: "ok_mancante" });
  assert.equal(requests.length, 0, "senza l'ok niente parte verso il modello");
  assert.deepEqual((await q(`SELECT read_status, read_reason, read_attempts FROM context_sources WHERE id = $1`, [note.sourceId]))[0], { read_status: "da_leggere", read_reason: "ok_mancante", read_attempts: 0 });
  // L'avviso per chi guarda: Lateral Space con il ruolo giusto può registrare l'ok con un clic.
  const notice = await consent.loadAiConsentNotice({ workspaceId: ids.wsB, userId: ids.lsb, role: "transformation_lead" });
  assert.equal(notice?.declarer, "lateral_space");
  assert.equal(notice?.buttonLabel, "Registra l'ok di Cliente B di prova");
  assert.equal(await consent.loadAiConsentNotice({ workspaceId: ids.wsA, userId: ids.ls, role: "transformation_lead" }), null);
});

test("readContextSource: due letture insieme leggono una volta sola; solo Lateral Space; un appunto di un altro workspace non si trova", opts, async () => {
  const note = await addNote();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slowAnswer: Reply = async (init) => {
    await gate;
    return answer([proposal()])(init);
  };
  const requests = fakeAppClaude([slowAnswer]);
  const first = reading.readContextSource(actor("ls"), note.sourceId);
  // La seconda arriva mentre la prima aspetta il modello.
  while (requests.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(okValue(await reading.readContextSource(actor("lsc"), note.sourceId)), { status: "in_lettura" });
  assert.deepEqual(okValue(await reading.readContextSource(actor("lsc"), note.sourceId, { again: true })), { status: "in_lettura" }, "«Rileggi» non tocca una lettura in corso");
  release();
  assert.deepEqual(okValue(await first), { status: "letto", proposals: 1, skipped: {} });
  assert.equal(requests.length, 1, "una sola chiamata al modello");
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_proposals WHERE source_id = $1`, [note.sourceId]))[0].n, 1);
  // Una presa in carico rimasta appesa (più di 180 secondi) si riprende.
  const stuck = await addNote();
  await q(`UPDATE context_sources SET read_status = 'in_lettura', read_started_at = now() - interval '181 seconds', read_attempts = 1 WHERE id = $1`, [stuck.sourceId]);
  fakeAppClaude([answer([])]);
  assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), stuck.sourceId)), { status: "letto", proposals: 0, skipped: {} });
  // Chi non è di Lateral Space non legge; un id di un altro workspace non si trova.
  const quiet = fakeAppClaude([]);
  const unread = await addNote();
  for (const person of ["rev", "con", "lrn", "out"] as const) assert.equal(errOf(await reading.readContextSource(actor(person), unread.sourceId)), "permesso_mancante", person);
  assert.equal(errOf(await reading.readContextSource(actor("lsb"), unread.sourceId)), "non_trovato");
  assert.equal(errOf(await reading.readContextSource(actor("ls"), randomUUID())), "non_trovato");
  assert.equal(errOf(await reading.readContextSource(actor("ls"), "non-un-id")), "non_trovato");
  assert.equal(quiet.length, 0);
});

test("un appunto lungo si legge in più parti, una chiamata per richiesta; le parti dopo sanno che cosa è già stato proposto", opts, async () => {
  const line = (i: number) => `Riga ${String(i).padStart(6, "0")} degli appunti lunghi di prova ${suffix}, con qualche parola in più.\n`;
  let long = "";
  for (let i = 0; long.length < 150_000; i++) long += line(i);
  const note = okValue(await sources.addContextNote(actor("ls"), { title: "Trascrizione lunga", occurredOn: "2026-11-12", body: long, origin: "web", kind: "trascrizione" }));
  assert.equal((await q(`SELECT parts_total FROM context_sources WHERE id = $1`, [note.sourceId]))[0].parts_total, 2);
  const quote = line(3).trim();
  const requests = fakeAppClaude([
    answer([proposal({ testo: "La prima parte parla di righe.", citazione: quote })], { altriClienti: 1 }),
    answer([proposal({ testo: "La prima parte parla di righe.", citazione: quote }), proposal({ testo: "La seconda parte parla di altre righe.", citazione: "" })], { altriClienti: 2 }),
  ]);
  assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), note.sourceId)), { status: "in_corso", partsRead: 1, partsTotal: 2 });
  assert.equal(requests.length, 1);
  assert.deepEqual((await q(`SELECT read_status, parts_read FROM context_sources WHERE id = $1`, [note.sourceId]))[0], { read_status: "da_leggere", parts_read: 1 });
  assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), note.sourceId)), { status: "letto", proposals: 2, skipped: { altri_clienti: 3 } });
  assert.equal(requests.length, 2);
  const [one, two] = requests.map((r) => JSON.stringify(r.body.messages));
  assert.ok(one.includes("Parte 1 di 2") && two.includes("Parte 2 di 2"));
  assert.ok(two.includes("GIÀ PROPOSTO DA QUESTI APPUNTI\\n- La prima parte parla di righe."), "la seconda parte riceve le frasi della prima");
  assert.deepEqual((await q(`SELECT position, statement FROM context_proposals WHERE source_id = $1 ORDER BY position`, [note.sourceId])).map((r) => [r.position, r.statement]), [
    [1, "La prima parte parla di righe."],
    [2, "La seconda parte parla di altre righe."],
  ]);
});

// ─── Documenti, elenco, «Togli» ──────────────────────────────────────

let docCounter = 0;
async function addDocument(who: Person, over: Record<string, unknown> = {}) {
  docCounter += 1;
  return sources.saveUploadedDocument(actor(who), {
    fileName: `verbale-${docCounter}.docx`,
    fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileSize: 12_345,
    blobUrl: `https://archivio.test/verbale-${docCounter}-${suffix}.docx`,
    extractedText: `Verbale di prova ${docCounter}. Il magazzino lavora su due turni.`,
    summary: "",
    departmentId: null,
    title: `Verbale ${docCounter}`,
    occurredOn: "2026-11-13",
    visibility: "tutti",
    origin: "web",
    ...over,
  } as Parameters<typeof sources.saveUploadedDocument>[1]);
}

test("saveUploadedDocument: il documento e la sua fonte nascono insieme; «Solo Lateral Space» lo decide solo Lateral Space; l'unità deve essere del workspace", opts, async () => {
  const mine = okValue(await addDocument("ls", { visibility: "ls", departmentId: ids.unitA }));
  const [row] = await q(
    `SELECT s.kind, s.origin, s.visibility, s.read_status, s.body, s.body_chars, s.document_id::text AS doc, d.user_id::text AS who, d.department_id::text AS unit, d.extracted_text
     FROM context_sources s JOIN uploaded_documents d ON d.id = s.document_id WHERE s.id = $1`,
    [mine.sourceId],
  );
  assert.deepEqual(
    { kind: row.kind, origin: row.origin, visibility: row.visibility, status: row.read_status, body: row.body, doc: row.doc, who: row.who, unit: row.unit },
    { kind: "documento", origin: "web", visibility: "ls", status: "da_leggere", body: null, doc: mine.documentId, who: ids.ls, unit: ids.unitA },
  );
  assert.equal(row.body_chars, String(row.extracted_text).length, "la fonte non tiene una copia del testo: solo quanti caratteri sono");
  // Il cliente carica: il documento è sempre «Per tutti», anche se chiede altro.
  const theirs = okValue(await addDocument("con", { visibility: "ls" }));
  assert.equal((await q(`SELECT visibility FROM context_sources WHERE id = $1`, [theirs.sourceId]))[0].visibility, "tutti");
  // Un'unità di un altro workspace: niente si scrive.
  const otherUnit = randomUUID();
  await q(`INSERT INTO departments (id, workspace_id, name) VALUES ($1, $2, 'Unità del workspace B')`, [otherUnit, ids.wsB]);
  const before = (await q(`SELECT count(*)::int AS n FROM uploaded_documents WHERE workspace_id = $1`, [ids.wsA]))[0].n;
  const wrong = await addDocument("ls", { departmentId: otherUnit });
  assert.equal(errOf(wrong), "dati_non_validi");
  assert.equal((await q(`SELECT count(*)::int AS n FROM uploaded_documents WHERE workspace_id = $1`, [ids.wsA]))[0].n, before);
  // Chi segue solo un corso, o non è nel workspace, non carica; un file oltre 4 MB no.
  for (const person of ["lrn", "out"] as const) assert.equal(errOf(await addDocument(person)), "permesso_mancante", person);
  assert.equal(errOf(await addDocument("ls", { fileSize: 4 * 1024 * 1024 + 1 })), "dati_non_validi");
});

test("l'elenco: Lateral Space vede tutto con lo stato della lettura; il cliente solo i documenti «Per tutti», senza appunti né proposte", opts, async () => {
  const note = await addNote();
  fakeAppClaude([answer([proposal({ testo: `Fatto per l'elenco ${suffix}.`, citazione: "" })])]);
  okValue(await reading.readContextSource(actor("ls"), note.sourceId));
  const internal = okValue(await addDocument("ls", { visibility: "ls" }));
  const shared = okValue(await addDocument("con"));
  const forLs = await sources.listContextSources(actor("ls"));
  const byId = new Map(forLs.map((s) => [s.id, s]));
  assert.deepEqual(
    { state: byId.get(note.sourceId)?.state, open: byId.get(note.sourceId)?.openProposals, kind: byId.get(note.sourceId)?.kind, canRemove: byId.get(note.sourceId)?.canRemove, document: byId.get(note.sourceId)?.document },
    { state: "da_confermare", open: 1, kind: "appunti", canRemove: true, document: null },
  );
  assert.equal(byId.get(internal.sourceId)?.visibility, "ls");
  assert.deepEqual(byId.get(shared.sourceId)?.document && { ...byId.get(shared.sourceId)!.document, id: "x" }, { id: "x", fileName: `verbale-${docCounter}.docx`, fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileSize: 12_345 });
  // Dal più recente: la data della call, poi quando è stato aggiunto.
  const days = forLs.map((s) => s.occurredOn);
  assert.deepEqual(days, [...days].sort().reverse());
  // Il cliente: solo i documenti «Per tutti». Mai un appunto, mai un documento interno, mai lo stato della lettura.
  for (const person of ["rev", "con"] as const) {
    const list = await sources.listContextSources(actor(person));
    assert.ok(list.length >= 1);
    assert.ok(list.every((s) => s.kind === "documento" && s.visibility === "tutti" && s.openProposals === 0 && s.readReason === null && s.state === "letto"), person);
    assert.equal(list.some((s) => s.id === note.sourceId || s.id === internal.sourceId), false, person);
    assert.ok(list.some((s) => s.id === shared.sourceId), person);
  }
  // «Togli»: il contributore solo sui suoi; il revisore (Analista) sui suoi; Lateral Space su tutti.
  assert.equal((await sources.listContextSources(actor("con"))).find((s) => s.id === shared.sourceId)?.canRemove, true);
  assert.equal((await sources.listContextSources(actor("rev"))).find((s) => s.id === shared.sourceId)?.canRemove, false);
  assert.equal(byId.get(shared.sourceId)?.canRemove, true);
  // Chi segue solo un corso, chi non è nel workspace, e Lateral Space di un altro workspace: niente.
  assert.deepEqual(await sources.listContextSources(actor("lrn")), []);
  assert.deepEqual(await sources.listContextSources(actor("out")), []);
  assert.equal((await sources.listContextSources(actor("lsb"))).some((s) => byId.has(s.id)), false);
});

test("getContextSource: il testo, «Con chi» e chi l'ha aggiunto solo a Lateral Space; al cliente solo un documento «Per tutti», senza niente di interno", opts, async () => {
  const body = `${NOTE}\nNota con i partecipanti (${suffix}).`;
  const note = okValue(await sources.addContextNote(actor("ls"), { title: "Call con il direttore", occurredOn: "2026-11-09", body, participants: "Mario Rossi, Anna Bianchi", link: "https://esempio.test/call", origin: "web" }));
  const detail = await sources.getContextSource(actor("lsc"), note.sourceId);
  assert.deepEqual(
    detail && { title: detail.title, body: detail.body, participants: detail.participants, link: detail.link, addedByName: detail.addedByName, state: detail.state, parts: [detail.partsRead, detail.partsTotal], purged: detail.textPurgedAt },
    { title: "Call con il direttore", body, participants: "Mario Rossi, Anna Bianchi", link: "https://esempio.test/call", addedByName: "Persona ls", state: "da_leggere", parts: [0, 1], purged: null },
  );
  for (const person of ["rev", "con", "lrn", "out", "lsb"] as const) assert.equal(await sources.getContextSource(actor(person), note.sourceId), null, person);
  const shared = okValue(await addDocument("con", { participants: "Giulia Verdi", link: "https://esempio.test/doc" }));
  const forClient = await sources.getContextSource(actor("rev"), shared.sourceId);
  assert.deepEqual(forClient && { kind: forClient.kind, body: forClient.body, participants: forClient.participants, link: forClient.link, addedByName: forClient.addedByName, skipped: forClient.skipped, canRemove: forClient.canRemove }, {
    kind: "documento",
    body: null,
    participants: null,
    link: null,
    addedByName: null,
    skipped: {},
    canRemove: false,
  });
  const internal = okValue(await addDocument("ls", { visibility: "ls" }));
  assert.equal(await sources.getContextSource(actor("rev"), internal.sourceId), null);
  assert.equal((await sources.getContextSource(actor("ls"), internal.sourceId))?.document?.id, internal.documentId);
  assert.equal(await sources.getContextSource(actor("ls"), "non-un-id"), null);
});

test("un documento si legge dal suo testo; senza testo resta «non letto» e il modello non parte", opts, async () => {
  const doc = okValue(await addDocument("ls", { visibility: "ls", extractedText: "Procedura acquisti. Gli ordini sopra i 10.000 euro li approva il direttore operativo." }));
  const requests = fakeAppClaude([answer([proposal({ testo: "Gli ordini sopra i 10.000 euro li approva il direttore operativo.", citazione: "Gli ordini sopra i 10.000 euro li approva il direttore operativo.", sezione: "regole" })])]);
  assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), doc.sourceId)), { status: "letto", proposals: 1, skipped: {} });
  assert.ok(JSON.stringify(requests[0].body.messages).includes("Procedura acquisti."));
  assert.equal((await q(`SELECT quote FROM context_proposals WHERE source_id = $1`, [doc.sourceId]))[0].quote, "Gli ordini sopra i 10.000 euro li approva il direttore operativo.");
  const empty = okValue(await addDocument("ls", { extractedText: "   " }));
  const none = fakeAppClaude([]);
  assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), empty.sourceId)), { status: "letto", proposals: 0, skipped: {} });
  assert.equal(none.length, 0);
  assert.deepEqual((await q(`SELECT read_status, read_reason FROM context_sources WHERE id = $1`, [empty.sourceId]))[0], { read_status: "non_letto", read_reason: "vuoto" });
  assert.equal((await sources.listContextSources(actor("ls"))).find((s) => s.id === empty.sourceId)?.state, "non_letto");
});

test("setDocumentVisibility: solo Lateral Space, solo sui documenti; il cliente lo vede appena diventa «Per tutti»", opts, async () => {
  const doc = okValue(await addDocument("ls", { visibility: "ls" }));
  assert.equal(await sources.getContextSource(actor("con"), doc.sourceId), null);
  for (const person of ["rev", "con", "lrn"] as const) assert.equal(errOf(await sources.setDocumentVisibility(actor(person), doc.sourceId, "tutti")), "permesso_mancante", person);
  assert.equal(errOf(await sources.setDocumentVisibility(actor("lsb"), doc.sourceId, "tutti")), "non_trovato");
  assert.equal(okValue(await sources.setDocumentVisibility(actor("ls"), doc.sourceId, "tutti")), true);
  assert.equal((await sources.getContextSource(actor("con"), doc.sourceId))?.visibility, "tutti");
  assert.deepEqual((await q(`SELECT action, actor_user_id::text AS who, detail FROM context_events WHERE source_id = $1 AND action = 'visibilita_cambiata'`, [doc.sourceId])), [
    { action: "visibilita_cambiata", who: ids.ls, detail: { da: "ls", a: "tutti" } },
  ]);
  // La stessa visibilità non scrive un'altra riga di storia.
  assert.equal(okValue(await sources.setDocumentVisibility(actor("ls"), doc.sourceId, "tutti")), true);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_events WHERE source_id = $1 AND action = 'visibilita_cambiata'`, [doc.sourceId]))[0].n, 1);
  // Un appunto resta sempre «Solo Lateral Space».
  const note = await addNote();
  assert.equal(errOf(await sources.setDocumentVisibility(actor("ls"), note.sourceId, "tutti")), "dati_non_validi");
  assert.equal(errOf(await sources.setDocumentVisibility(actor("ls"), doc.sourceId, "pubblico" as never)), "dati_non_validi");
});

test("removeContextSource: i fatti restano «senza fonte», le proposte spariscono; di un documento si cancellano file e frammenti; la call di Granola non rientra", opts, async () => {
  // Un appunto di Granola con una proposta aperta e un fatto confermato.
  const meeting = `not_${suffix}_togli`;
  const note = okValue(await sources.upsertExternalNote(actor("ls", "wsA", "granola"), { title: "Call da togliere", occurredOn: "2026-11-08", body: `[Riassunto di Granola]\nIl cliente apre un secondo magazzino (${suffix}).`, origin: "granola", externalId: meeting, externalUpdatedAt: null }));
  const fact = randomUUID();
  await q(`INSERT INTO context_facts (id, workspace_id, section, statement, basis, visibility, origin, source_id, quote) VALUES ($1, $2, 'azienda', 'Il cliente apre un secondo magazzino.', 'detto', 'tutti', 'fonte', $3, 'Il cliente apre un secondo magazzino')`, [fact, ids.wsA, note.sourceId]);
  await q(`INSERT INTO context_proposals (workspace_id, source_id, position, kind, statement, basis, section, visibility) VALUES ($1, $2, 1, 'nuovo', 'Il magazzino nuovo è a Trieste.', 'dedotto', 'azienda', 'tutti')`, [ids.wsA, note.sourceId]);
  await q(`INSERT INTO context_granola_meetings (user_id, meeting_id, decision, decided_by, workspace_id, source_id) VALUES ($1, $2, 'entrata', 'regola', $3, $4)`, [ids.ls, meeting, ids.wsA, note.sourceId]);
  // Chi non è di Lateral Space non toglie un appunto, e non sa nemmeno che c'è.
  for (const person of ["rev", "con"] as const) assert.equal(errOf(await sources.removeContextSource(actor(person), note.sourceId)), "non_trovato", person);
  assert.equal(errOf(await sources.removeContextSource(actor("lrn"), note.sourceId)), "permesso_mancante");
  assert.equal(errOf(await sources.removeContextSource(actor("lsb"), note.sourceId)), "non_trovato");
  assert.equal(okValue(await sources.removeContextSource(actor("lsc"), note.sourceId)), true);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_sources WHERE id = $1`, [note.sourceId]))[0].n, 0);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_proposals WHERE source_id = $1`, [note.sourceId]))[0].n, 0, "le proposte spariscono");
  assert.deepEqual((await q(`SELECT status, origin, source_id, quote FROM context_facts WHERE id = $1`, [fact]))[0], { status: "attivo", origin: "fonte", source_id: null, quote: "Il cliente apre un secondo magazzino" }, "il fatto resta, senza fonte, con la sua citazione");
  assert.deepEqual((await q(`SELECT decision, decided_by, workspace_id, source_id FROM context_granola_meetings WHERE user_id = $1 AND meeting_id = $2`, [ids.ls, meeting]))[0], { decision: "fuori", decided_by: "persona", workspace_id: null, source_id: null });
  assert.deepEqual((await q(`SELECT action, actor_user_id::text AS who FROM context_events WHERE source_id = $1 AND action = 'fonte_tolta'`, [note.sourceId])), [{ action: "fonte_tolta", who: ids.lsc }], "la storia resta anche dopo");
  assert.equal(errOf(await sources.removeContextSource(actor("ls"), note.sourceId)), "non_trovato", "già tolto");

  // Un documento del contributore: lo toglie lui; un Analista no; con il documento vanno il file e i frammenti.
  const doc = okValue(await addDocument("con"));
  await q(`INSERT INTO document_chunks (document_id, workspace_id, content, chunk_index) VALUES ($1, $2, 'Il magazzino lavora su due turni.', 0)`, [doc.documentId, ids.wsA]);
  const blob = String((await q(`SELECT blob_url FROM uploaded_documents WHERE id = $1`, [doc.documentId]))[0].blob_url);
  const deleted: string[] = [];
  const deps = { deleteBlob: async (target: string) => void deleted.push(target) };
  assert.equal(errOf(await sources.removeContextSource(actor("rev"), doc.sourceId, deps)), "permesso_mancante");
  assert.deepEqual(deleted, []);
  assert.equal(okValue(await sources.removeContextSource(actor("con"), doc.sourceId, deps)), true);
  assert.deepEqual(deleted, [blob]);
  for (const table of ["uploaded_documents WHERE id", "document_chunks WHERE document_id", "context_sources WHERE document_id"]) {
    assert.equal((await q(`SELECT count(*)::int AS n FROM ${table} = $1`, [doc.documentId]))[0].n, 0, table);
  }
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_events WHERE source_id = $1 AND action = 'documento_tolto'`, [doc.sourceId]))[0].n, 1);
  // Un documento «Solo Lateral Space» per il cliente non esiste; se il file non si cancella, la riga è tolta lo stesso.
  const internal = okValue(await addDocument("ls", { visibility: "ls" }));
  assert.equal(errOf(await sources.removeContextSource(actor("rev"), internal.sourceId, deps)), "non_trovato");
  assert.equal(okValue(await sources.removeContextSource(actor("ls"), internal.sourceId, { deleteBlob: async () => { throw new Error("archivio non raggiungibile"); } })), true);
  assert.equal((await q(`SELECT count(*)::int AS n FROM uploaded_documents WHERE id = $1`, [internal.documentId]))[0].n, 0);
});

test("purgeExpiredNoteText: a 12 mesi e un giorno il testo si cancella, restano i fatti e le citazioni; a 12 mesi meno un giorno no", opts, async () => {
  const old = await addNote(`${NOTE}\nNota vecchia (${suffix}).`);
  const recent = await addNote(`${NOTE}\nNota quasi vecchia (${suffix}).`);
  const unread = await addNote(`${NOTE}\nNota vecchia mai letta (${suffix}).`);
  const doc = okValue(await addDocument("ls"));
  // Adesso è adesso: invecchiano solo le righe di questo test, le altre del database non si toccano.
  const now = new Date();
  await q(`UPDATE context_sources SET created_at = $2::timestamptz - interval '12 months' - interval '1 day', read_status = 'letto', participants = 'Mario Rossi' WHERE id = $1`, [old.sourceId, now.toISOString()]);
  await q(`UPDATE context_sources SET created_at = $2::timestamptz - interval '12 months' + interval '1 day' WHERE id = $1`, [recent.sourceId, now.toISOString()]);
  await q(`UPDATE context_sources SET created_at = $3::timestamptz - interval '13 months' WHERE id = ANY($1::uuid[]) OR id = $2`, [[unread.sourceId], doc.sourceId, now.toISOString()]);
  const fact = randomUUID();
  await q(`INSERT INTO context_facts (id, workspace_id, section, statement, basis, visibility, origin, source_id, quote) VALUES ($1, $2, 'sistemi', 'Il gestionale è SAP Business One (nota vecchia).', 'detto', 'tutti', 'fonte', $3, 'Il gestionale è SAP Business One.')`, [fact, ids.wsA, old.sourceId]);
  await q(`INSERT INTO context_proposals (workspace_id, source_id, position, kind, statement, basis, section, visibility) VALUES ($1, $2, 1, 'nuovo', 'Proposta rimasta aperta.', 'dedotto', 'azienda', 'tutti')`, [ids.wsA, old.sourceId]);
  assert.equal(await sources.purgeExpiredNoteText(now), 2, "i due appunti vecchi, non il documento né l'appunto di 12 mesi meno un giorno");
  assert.deepEqual((await q(`SELECT body, body_hash, participants, text_purged_at IS NOT NULL AS purged, read_status, title FROM context_sources WHERE id = $1`, [old.sourceId]))[0], {
    body: null,
    body_hash: null,
    participants: null,
    purged: true,
    read_status: "letto",
    title: "Call di avvio",
  });
  assert.deepEqual((await q(`SELECT status, source_id::text AS source, quote FROM context_facts WHERE id = $1`, [fact]))[0], { status: "attivo", source: old.sourceId, quote: "Il gestionale è SAP Business One." });
  assert.equal((await q(`SELECT status FROM context_proposals WHERE source_id = $1`, [old.sourceId]))[0].status, "superata");
  assert.equal((await q(`SELECT text_purged_at IS NOT NULL AS purged FROM context_sources WHERE id = $1`, [recent.sourceId]))[0].purged, false);
  // Un appunto mai letto non si potrà più leggere; un documento non è un appunto: non si tocca.
  assert.deepEqual((await q(`SELECT read_status, read_reason FROM context_sources WHERE id = $1`, [unread.sourceId]))[0], { read_status: "non_letto", read_reason: "vuoto" });
  assert.equal((await q(`SELECT text_purged_at IS NOT NULL AS purged FROM context_sources WHERE id = $1`, [doc.sourceId]))[0].purged, false);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_events WHERE source_id = $1 AND action = 'testo_cancellato' AND channel = 'cron' AND actor_user_id IS NULL`, [old.sourceId]))[0].n, 1);
  // Dopo: il testo non si vede più, e non si legge più.
  const detail = await sources.getContextSource(actor("ls"), old.sourceId);
  assert.equal(detail?.body, null);
  assert.ok(detail?.textPurgedAt instanceof Date);
  const none = fakeAppClaude([]);
  assert.equal(errOf(await reading.readContextSource(actor("ls"), old.sourceId, { again: true })), "dati_non_validi");
  assert.equal(none.length, 0);
  // Un secondo giro non cancella di nuovo.
  assert.equal(await sources.purgeExpiredNoteText(now), 0);
});

// ─── Proposte e conferma ─────────────────────────────────────────────

/** Un appunto nuovo letto dal Claude finto: restituisce le sue proposte aperte, come le vede Lateral Space. */
async function readProposals(modelProposals: ModelProposal[], body?: string) {
  const note = await addNote(body);
  fakeAppClaude([answer(modelProposals)]);
  okValue(await reading.readContextSource(actor("ls"), note.sourceId));
  const open = await proposals.listOpenProposals(actor("ls"), { sourceId: note.sourceId });
  assert.ok(open);
  return { sourceId: note.sourceId, open, all: [...open.proposals, ...open.reconfirmed] };
}
const pick = (list: Array<{ id: string; version: number }>) => list.map((p) => ({ id: p.id, version: p.version }));
/** Un fatto attivo scritto direttamente, per le prove che partono da una memoria già piena. */
async function seedFact(statement: string, over: { visibility?: string; section?: string } = {}) {
  const id = randomUUID();
  await q(`INSERT INTO context_facts (id, workspace_id, section, statement, basis, visibility, origin) VALUES ($1, $2, $3, $4, 'detto', $5, 'manuale')`, [id, ids.wsA, over.section ?? "sistemi", statement, over.visibility ?? "tutti"]);
  return id;
}

test("listOpenProposals: solo Lateral Space; i gruppi, la preselezione («dedotto» e conflitti mai), il fatto di prima, la domanda che si chiude", opts, async () => {
  const erp = await seedFact(`Il gestionale è SAP Business One ${suffix}.`);
  const question = randomUUID();
  await q(`INSERT INTO context_questions (id, workspace_id, question, visibility, origin) VALUES ($1, $2, 'Quando cambia il gestionale?', 'ls', 'manuale')`, [question, ids.wsA]);
  const { sourceId, open } = await readProposals([
    proposal({ useCase: ["CX-0001"] }),
    proposal({ tipo: "conflitto", testo: `Il gestionale è Odoo ${suffix}.`, citazione: "Il gestionale è SAP Business One.", fattoRif: "F1", sezione: "sistemi" }),
    proposal({ tipo: "cambia", testo: `Il gestionale è SAP S/4HANA ${suffix}.`, citazione: "", fattoRif: "F1", sezione: "sistemi" }),
    proposal({ tipo: "conferma", testo: "x", citazione: "Il gestionale è SAP Business One.", fattoRif: "F1" }),
    proposal({ tipo: "nuovo", testo: `Il gestionale cambia entro giugno ${suffix}.`, citazione: "L'ERP lo cambiamo entro giugno", domandaRif: "D1", sezione: "sistemi" }),
    proposal({ tipo: "nuovo", testo: "Mario Rossi decide gli acquisti.", citazione: "", sezione: "persone" }),
    proposal({ tipo: "impegno", testo: `Mandare l'elenco dei fornitori ${suffix}.`, citazione: "", sezione: null, parte: "cliente", ruolo: "responsabile acquisti", entro: "2026-11-30" }),
  ]);
  assert.deepEqual(open.sources.map((s) => [s.id, s.title, s.occurredOn]), [[sourceId, "Call di avvio", "2026-11-14"]]);
  assert.deepEqual(open.proposals.map((p) => [p.kind, p.basis, p.preselected, p.issue]), [
    ["nuovo", "detto", true, null],
    ["conflitto", "detto", false, null],
    ["cambia", "dedotto", false, null],
    ["nuovo", "detto", true, null],
    ["nuovo", "dedotto", false, "nome_persona"],
    ["impegno", "dedotto", false, null],
  ]);
  assert.deepEqual(open.reconfirmed.map((p) => [p.kind, p.statement, p.preselected]), [["conferma", `Il gestionale è SAP Business One ${suffix}.`, true]]);
  const [first, conflict, , answers, named, commitment] = open.proposals;
  assert.deepEqual(first.useCases, [{ id: ids.ucA, code: "CX-0001", title: "Ordini automatici" }]);
  assert.deepEqual(conflict.before, { factId: erp, statement: `Il gestionale è SAP Business One ${suffix}.`, sourceLabel: "Scritto a mano", date: conflict.before?.date });
  assert.match(conflict.before?.date ?? "", /^\d{1,2} [a-z]{3}/, "la data come a schermo: «14 nov»");
  assert.deepEqual(answers.closesQuestion, { id: question, question: "Quando cambia il gestionale?" });
  assert.equal(named.issueMessage, "Non scrivere nomi di persone: indica il ruolo, per esempio «il responsabile commerciale».");
  assert.deepEqual([commitment.party, commitment.roleLabel, commitment.dueOn, commitment.section], ["cliente", "responsabile acquisti", "2026-11-30", null]);
  // Tutte le proposte aperte del workspace, e mai a chi non è di Lateral Space.
  const everything = await proposals.listOpenProposals(actor("lsc"));
  assert.ok(everything && everything.proposals.length >= open.proposals.length && everything.sources.some((s) => s.id === sourceId));
  for (const person of ["rev", "con", "lrn", "out"] as const) assert.equal(await proposals.listOpenProposals(actor(person)), null, person);
  assert.deepEqual(await proposals.listOpenProposals(actor("lsb"), { sourceId }), { sources: [], proposals: [], reconfirmed: [] }, "un appunto di un altro workspace non ha proposte, per lui");
  assert.equal(await proposals.countOpenProposals(actor("rev")), 0);
  assert.ok((await proposals.countOpenProposals(actor("ls"))) >= 7);
  await proposals.discardProposals(actor("ls"), [...open.proposals, ...open.reconfirmed].map((p) => p.id));
});

test("editProposal: corregge sul posto, ricalcola il controllo dei testi, alza la versione; una versione vecchia non passa", opts, async () => {
  const { all } = await readProposals([
    proposal({ tipo: "nuovo", testo: "Mario Rossi decide gli acquisti.", citazione: "", sezione: "persone" }),
    proposal({ tipo: "impegno", testo: `Preparare la proposta ${suffix}.`, citazione: "", sezione: null, parte: "nostra" }),
  ]);
  const [named, commitment] = all;
  assert.equal(named.issue, "nome_persona");
  const fixed = okValue(await proposals.editProposal(actor("ls"), named.id, named.version, { statement: "  Il responsabile acquisti   decide gli acquisti. ", section: "lavoro", visibility: "ls", useCaseIds: [ids.ucA] }));
  assert.deepEqual(
    { statement: fixed.statement, issue: fixed.issue, section: fixed.section, visibility: fixed.visibility, version: fixed.version, useCases: fixed.useCases.map((u) => u.code), preselected: fixed.preselected },
    { statement: "Il responsabile acquisti decide gli acquisti.", issue: null, section: "lavoro", visibility: "ls", version: named.version + 1, useCases: ["CX-0001"], preselected: false },
  );
  assert.equal((await q(`SELECT edited FROM context_proposals WHERE id = $1`, [named.id]))[0].edited, true);
  // La versione di prima non vale più.
  assert.equal(errOf(await proposals.editProposal(actor("ls"), named.id, named.version, { statement: "Un altro testo." })), "versione_superata");
  // Un testo lungo si salva ma va accorciato; un nome torna a fermare la proposta; un dato sanitario non si salva.
  const long = okValue(await proposals.editProposal(actor("ls"), named.id, fixed.version, { statement: `Il responsabile acquisti decide ${"e ancora decide ".repeat(14)}gli acquisti.` }));
  assert.equal(long.issue, "lungo");
  assert.equal(long.issueMessage, "Accorcia la frase: al massimo 200 caratteri.");
  const again = okValue(await proposals.editProposal(actor("ls"), named.id, long.version, { statement: "Anna Bianchi decide gli acquisti." }));
  assert.equal(again.issue, "nome_persona");
  const health = await proposals.editProposal(actor("ls"), named.id, again.version, { statement: "Il responsabile acquisti è assente per una visita medica." });
  assert.equal(errOf(health), "dati_non_validi");
  assert.match(String(!health.ok && health.fieldErrors?.statement), /dati sanitari/);
  // I campi di un impegno: parte, ruolo (mai un nome), data vera. Un fatto non ha una parte.
  const done = okValue(await proposals.editProposal(actor("lsc"), commitment.id, commitment.version, { party: "cliente", roleLabel: "direttore operativo", dueOn: "2026-12-15" }));
  assert.deepEqual([done.party, done.roleLabel, done.dueOn], ["cliente", "direttore operativo", "2026-12-15"]);
  const bad = await proposals.editProposal(actor("ls"), commitment.id, done.version, { roleLabel: "Mario Rossi", dueOn: "2026-02-30", section: "lavoro", useCaseIds: [randomUUID()] });
  assert.deepEqual(Object.keys((!bad.ok && bad.fieldErrors) || {}).sort(), ["dueOn", "roleLabel", "section", "useCaseIds"]);
  assert.equal(errOf(await proposals.editProposal(actor("ls"), named.id, again.version, { party: "cliente" })), "dati_non_validi");
  // Solo Lateral Space, solo nel suo workspace.
  for (const person of ["rev", "con", "lrn"] as const) assert.equal(errOf(await proposals.editProposal(actor(person), named.id, again.version, { statement: "Testo." })), "permesso_mancante", person);
  assert.equal(errOf(await proposals.editProposal(actor("lsb"), named.id, again.version, { statement: "Testo." })), "non_trovato");
  await proposals.discardProposals(actor("ls"), all.map((p) => p.id));
});

test("discardProposals: le proposte scartate non entrano e non si ripropongono; solo Lateral Space", opts, async () => {
  const { sourceId, all } = await readProposals([proposal({ testo: `Fatto da scartare ${suffix}.`, citazione: "" }), proposal({ testo: `Fatto da tenere ${suffix}.`, citazione: "" })]);
  for (const person of ["rev", "con", "lrn"] as const) assert.equal(errOf(await proposals.discardProposals(actor(person), [all[0].id])), "permesso_mancante", person);
  assert.deepEqual(okValue(await proposals.discardProposals(actor("lsb"), [all[0].id])), { discarded: 0 }, "di un altro workspace: niente");
  assert.deepEqual(okValue(await proposals.discardProposals(actor("ls"), [all[0].id, all[0].id, randomUUID()])), { discarded: 1 });
  assert.deepEqual((await q(`SELECT status, decided_by_user_id::text AS who FROM context_proposals WHERE id = $1`, [all[0].id]))[0], { status: "scartata", who: ids.ls });
  assert.deepEqual((await q(`SELECT detail FROM context_events WHERE workspace_id = $1 AND action = 'proposte_scartate' ORDER BY at DESC LIMIT 1`, [ids.wsA]))[0].detail, { n: 1 });
  assert.equal(errOf(await proposals.discardProposals(actor("ls"), [])), "dati_non_validi");
  assert.equal(errOf(await proposals.discardProposals(actor("ls"), ["non-un-id"])), "dati_non_validi");
  // Una rilettura riceve la frase scartata in «Già proposto», e non la ripropone.
  const requests = fakeAppClaude([answer([proposal({ testo: `Fatto da scartare ${suffix}.`, citazione: "" }), proposal({ testo: `Fatto nuovo dopo la rilettura ${suffix}.`, citazione: "" })])]);
  assert.deepEqual(okValue(await reading.readContextSource(actor("ls"), sourceId, { again: true })), { status: "letto", proposals: 1, skipped: {} });
  assert.ok(JSON.stringify(requests[0].body.messages).includes(`- Fatto da scartare ${suffix}.`));
  assert.deepEqual((await q(`SELECT statement, status FROM context_proposals WHERE source_id = $1 ORDER BY position`, [sourceId])).map((r) => [r.statement, r.status]), [
    [`Fatto da scartare ${suffix}.`, "scartata"],
    [`Fatto da tenere ${suffix}.`, "superata"],
    [`Fatto nuovo dopo la rilettura ${suffix}.`, "aperta"],
  ]);
  await proposals.discardProposals(actor("ls"), (await proposals.listOpenProposals(actor("ls"), { sourceId }))!.proposals.map((p) => p.id));
});

test("confirmProposals: un fatto nuovo, una decisione, un impegno, una domanda; entità e collegamenti; la domanda chiusa dal fatto che le risponde", opts, async () => {
  const question = randomUUID();
  await q(`INSERT INTO context_questions (id, workspace_id, question, visibility, origin) VALUES ($1, $2, $3, 'tutti', 'manuale')`, [question, ids.wsA, `Chi approva gli ordini grandi ${suffix}?`]);
  const { sourceId, all } = await readProposals([
    proposal({
      testo: `Gli ordini grandi li approva il direttore operativo ${suffix}.`,
      citazione: "Il direttore operativo dice",
      sezione: "persone",
      domandaRif: "D1",
      useCase: ["CX-0001"],
      entita: [{ nome: "Direttore operativo", tipo: "ruolo" }, { nome: "Acquisti", tipo: "unita" }, { nome: `SAP ${suffix}`, tipo: "sistema" }, { nome: "CX-0001", tipo: "use_case" }, { nome: "Ridurre i tempi di consegna", tipo: "obiettivo" }],
      collegamenti: [{ da: "Direttore operativo", verbo: "decide", a: "Acquisti" }, { da: "Acquisti", verbo: "usa", a: `SAP ${suffix}` }],
    }),
    proposal({ tipo: "decisione", testo: `Si parte dagli ordini automatici ${suffix}.`, citazione: "", sezione: "obiettivi", visibilita: "ls" }),
    proposal({ tipo: "impegno", testo: `Mandare l'elenco dei fornitori entro fine mese ${suffix}.`, citazione: "", sezione: null, parte: "cliente", ruolo: "responsabile acquisti", entro: "2026-11-30", useCase: ["CX-0001"] }),
    proposal({ tipo: "domanda", testo: `Quanti ordini arrivano ogni giorno ${suffix}?`, citazione: "", sezione: null, ruolo: "responsabile acquisti", visibilita: "ls" }),
  ]);
  const result = okValue(await proposals.confirmProposals(actor("ls"), pick(all)));
  assert.deepEqual({ ...result, remaining: 0 }, { confirmed: 4, newFacts: 2, changedFacts: 0, reconfirmed: 0, commitments: 1, questions: 1, remaining: 0 });
  const facts = await q(`SELECT id, kind, section, statement, basis, visibility, status, origin, source_id::text AS source, quote, confirmed_by_user_id::text AS who, supersedes_id FROM context_facts WHERE source_id = $1 ORDER BY created_at, statement`, [sourceId]);
  const fact = facts.find((f) => f.kind === "fatto")!;
  const decision = facts.find((f) => f.kind === "decisione")!;
  assert.deepEqual(
    { section: fact.section, statement: fact.statement, basis: fact.basis, visibility: fact.visibility, status: fact.status, origin: fact.origin, source: fact.source, quote: fact.quote, who: fact.who, supersedes: fact.supersedes_id },
    { section: "persone", statement: `Gli ordini grandi li approva il direttore operativo ${suffix}.`, basis: "detto", visibility: "tutti", status: "attivo", origin: "fonte", source: sourceId, quote: "Il direttore operativo dice", who: ids.ls, supersedes: null },
  );
  assert.deepEqual([decision.section, decision.basis, decision.visibility, decision.quote], ["obiettivi", "dedotto", "ls", null], "un fatto dedotto resta segnato, anche dopo la conferma");
  // I legami: lo use case, e le entità (quelle di Unbundle con la loro riga, le altre con il nome).
  assert.deepEqual((await q(`SELECT use_case_id::text AS uc FROM context_fact_links WHERE fact_id = $1 AND use_case_id IS NOT NULL`, [fact.id])).map((r) => r.uc), [ids.ucA]);
  const entities = await q(
    `SELECT e.type, e.name, e.name_key, e.department_id::text AS unit, e.goal_id::text AS goal, e.use_case_id::text AS uc
     FROM context_fact_links l JOIN context_entities e ON e.id = l.entity_id WHERE l.fact_id = $1 ORDER BY e.type, e.name`,
    [fact.id],
  );
  assert.deepEqual(entities, [
    { type: "obiettivo", name: "Ridurre i tempi di consegna", name_key: ids.goalA, unit: null, goal: ids.goalA, uc: null },
    { type: "ruolo", name: "Direttore operativo", name_key: "direttore operativo", unit: null, goal: null, uc: null },
    { type: "sistema", name: `SAP ${suffix}`, name_key: `sap ${suffix}`, unit: null, goal: null, uc: null },
    { type: "unita", name: "Acquisti", name_key: ids.unitA, unit: ids.unitA, goal: null, uc: null },
    { type: "use_case", name: "Ordini automatici", name_key: ids.ucA, unit: null, goal: null, uc: ids.ucA },
  ]);
  const relations = await q(
    `SELECT a.name AS from_name, r.verb, b.name AS to_name FROM context_relations r JOIN context_entities a ON a.id = r.from_entity_id JOIN context_entities b ON b.id = r.to_entity_id WHERE r.fact_id = $1 ORDER BY r.verb`,
    [fact.id],
  );
  assert.deepEqual(relations, [{ from_name: "Direttore operativo", verb: "decide", to_name: "Acquisti" }, { from_name: "Acquisti", verb: "usa", to_name: `SAP ${suffix}` }]);
  // La domanda aperta a cui il fatto risponde si chiude con quel fatto.
  assert.deepEqual((await q(`SELECT status, closed_by_fact_id::text AS fact, closed_at IS NOT NULL AS closed FROM context_questions WHERE id = $1`, [question]))[0], { status: "chiusa", fact: fact.id, closed: true });
  // L'impegno e la domanda: per parte e per ruolo, mai per persona.
  assert.deepEqual((await q(`SELECT statement, party, role_label, due_on::text AS due, status, visibility, origin, use_case_ids::text[] AS ucs FROM context_commitments WHERE source_id = $1`, [sourceId]))[0], {
    statement: `Mandare l'elenco dei fornitori entro fine mese ${suffix}.`,
    party: "cliente",
    role_label: "responsabile acquisti",
    due: "2026-11-30",
    status: "aperto",
    visibility: "tutti",
    origin: "fonte",
    ucs: [ids.ucA],
  });
  assert.deepEqual((await q(`SELECT question, ask_whom, status, visibility FROM context_questions WHERE source_id = $1`, [sourceId]))[0], { question: `Quanti ordini arrivano ogni giorno ${suffix}?`, ask_whom: "responsabile acquisti", status: "aperta", visibility: "ls" });
  // Le proposte sono confermate, con che cosa sono diventate; la fonte risulta confermata.
  const decidedRows = await q(`SELECT kind, status, result_id IS NOT NULL AS has_result, decided_by_user_id::text AS who FROM context_proposals WHERE source_id = $1 ORDER BY position`, [sourceId]);
  assert.deepEqual(decidedRows.map((r) => [r.status, r.has_result, r.who]), Array.from({ length: 4 }, () => ["confermata", true, ids.ls]));
  assert.equal((await sources.listContextSources(actor("ls"))).find((s) => s.id === sourceId)?.state, "confermato");
  // La storia: chi ha confermato i fatti; impegni e domande senza attore; nessun testo nel dettaglio.
  const events = await q(`SELECT action, actor_user_id::text AS who, detail FROM context_events WHERE source_id = $1 AND at >= (SELECT min(decided_at) FROM context_proposals WHERE source_id = $1) ORDER BY action`, [sourceId]);
  assert.deepEqual(events.map((e) => [e.action, e.who]), [
    ["domanda_aggiunta", null],
    ["fatto_confermato", ids.ls],
    ["fatto_confermato", ids.ls],
    ["impegno_aggiunto", null],
    ["proposte_confermate", ids.ls],
  ]);
  assert.deepEqual(events.find((e) => e.action === "proposte_confermate")?.detail, { n: 4 });
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_events WHERE question_id = $1 AND action = 'domanda_chiusa'`, [question]))[0].n, 1);
  for (const e of events) assert.doesNotMatch(JSON.stringify(e.detail), /direttore|ordini|fornitori/);
  // Confermare due volte le stesse proposte: non sono più aperte.
  assert.equal(errOf(await proposals.confirmProposals(actor("ls"), pick(all))), "versione_superata");
});

test("confirmProposals: «cambia» fa una versione nuova e lascia quella di prima nella storia; «conferma» rinfresca la data; un conflitto si risolve con «Prima» o con «Ora»", opts, async () => {
  const erp = await seedFact(`Il gestionale di prova è SAP Business One ${suffix}.`);
  const people = await seedFact(`I dipendenti di prova sono 400 ${suffix}.`, { section: "azienda", visibility: "ls" });
  const site = await seedFact(`La sede di prova è a Udine ${suffix}.`, { section: "azienda" });
  const shifts = await seedFact(`Il magazzino di prova lavora su un turno ${suffix}.`, { section: "lavoro" });
  await q(`INSERT INTO context_fact_links (workspace_id, fact_id, use_case_id) VALUES ($1, $2, $3)`, [ids.wsA, erp, ids.ucA]);
  await q(`UPDATE context_facts SET last_confirmed_at = now() - interval '40 days', needs_check = true WHERE id = ANY($1::uuid[])`, [[erp, people, site, shifts]]);
  // I riferimenti F1…Fn seguono l'ordine della memoria (dal più recente): li cerchiamo per testo nel prompt.
  const note = await addNote();
  const requests = fakeAppClaude([
    (init) => {
      const prompt = JSON.parse(String(init?.body)).messages[0].content[0].text as string;
      const ref = (text: string) => prompt.split("\n").find((line) => line.includes(text))?.split(" | ")[0] ?? "F0";
      return answer([
        proposal({ tipo: "cambia", testo: `Il gestionale di prova è SAP S/4HANA ${suffix}.`, citazione: "", fattoRif: ref("gestionale di prova"), sezione: "sistemi", visibilita: "tutti" }),
        proposal({ tipo: "cambia", testo: `I dipendenti di prova sono 420 ${suffix}.`, citazione: "", fattoRif: ref("dipendenti di prova"), sezione: "azienda", visibilita: "tutti" }),
        proposal({ tipo: "conferma", testo: "x", citazione: "", fattoRif: ref("sede di prova") }),
        proposal({ tipo: "conflitto", testo: `Il magazzino di prova lavora su due turni ${suffix}.`, citazione: "", fattoRif: ref("magazzino di prova"), sezione: "lavoro" }),
      ])(init);
    },
  ]);
  okValue(await reading.readContextSource(actor("ls"), note.sourceId));
  assert.equal(requests.length, 1);
  const open = (await proposals.listOpenProposals(actor("ls"), { sourceId: note.sourceId }))!;
  const [changeErp, changePeople, conflict] = open.proposals;
  const [reconfirm] = open.reconfirmed;
  assert.equal(changePeople.visibility, "ls", "un fatto «Solo Lateral Space» cambiato resta «Solo Lateral Space»");
  // Un conflitto senza scelta non entra, e niente si scrive.
  const noChoice = await proposals.confirmProposals(actor("ls"), pick([changeErp, conflict]));
  assert.equal(errOf(noChoice), "dati_non_validi");
  assert.deepEqual(!noChoice.ok && noChoice.fieldErrors, { [conflict.id]: "Scegli quale tenere." });
  assert.equal((await q(`SELECT status FROM context_facts WHERE id = $1`, [erp]))[0].status, "attivo", "niente scritto");
  // «Prima»: resta il fatto in memoria, e la proposta è scartata.
  const result = okValue(await proposals.confirmProposals(actor("lsc"), [...pick([changeErp, changePeople, reconfirm]), { id: conflict.id, version: conflict.version, resolution: "prima" }]));
  assert.deepEqual({ ...result, remaining: 0 }, { confirmed: 4, newFacts: 0, changedFacts: 2, reconfirmed: 2, commitments: 0, questions: 0, remaining: 0 });
  // «Cambia»: il vecchio è superato, con la data di fine; il nuovo lo sostituisce e tiene il tipo, e lo use case di prima.
  const chain = await q(`SELECT id, statement, status, ended_at IS NOT NULL AS ended, supersedes_id::text AS supersedes, visibility, version FROM context_facts WHERE id = $1 OR supersedes_id = $1 ORDER BY created_at`, [erp]);
  assert.deepEqual(chain.map((f) => [f.statement, f.status, f.ended, f.supersedes]), [
    [`Il gestionale di prova è SAP Business One ${suffix}.`, "superato", true, null],
    [`Il gestionale di prova è SAP S/4HANA ${suffix}.`, "attivo", false, erp],
  ]);
  assert.deepEqual((await q(`SELECT use_case_id::text AS uc FROM context_fact_links WHERE fact_id = $1`, [chain[1].id])).map((r) => r.uc), [ids.ucA]);
  assert.equal((await q(`SELECT visibility FROM context_facts WHERE supersedes_id = $1`, [people]))[0].visibility, "ls");
  // «Conferma» e «Prima»: la data si rinfresca, il fatto non è più «da verificare», la versione non cambia.
  for (const id of [site, shifts]) {
    assert.deepEqual((await q(`SELECT status, needs_check, (last_confirmed_at > now() - interval '1 minute') AS fresh, confirmed_by_user_id::text AS who, version FROM context_facts WHERE id = $1`, [id]))[0], { status: "attivo", needs_check: false, fresh: true, who: ids.lsc, version: 1 });
  }
  assert.deepEqual((await q(`SELECT status, result_id::text AS result FROM context_proposals WHERE id = $1`, [conflict.id]))[0], { status: "scartata", result: shifts });
  const kinds = (await q(`SELECT action, detail FROM context_events WHERE source_id = $1 AND action IN ('fatto_cambiato', 'fatto_riconfermato', 'conflitto_risolto') ORDER BY action`, [note.sourceId])).map((e) => [e.action, e.detail]);
  assert.deepEqual(kinds, [["conflitto_risolto", { scelta: "prima" }], ["fatto_cambiato", {}], ["fatto_cambiato", {}], ["fatto_riconfermato", {}]]);

  // «Ora»: il conflitto diventa una versione nuova.
  const { all } = await readProposals([proposal({ tipo: "conflitto", testo: `La sede di prova è a Trieste ${suffix}.`, citazione: "", fattoRif: "F1", sezione: "azienda" })], `${NOTE}\nSeconda call sulla sede (${suffix}).`);
  // (F1 è il fatto appena riconfermato per ultimo: la sede o il magazzino. Qui conta solo che il conflitto si risolva.)
  const target = all[0].before!.factId;
  okValue(await proposals.confirmProposals(actor("ls"), [{ id: all[0].id, version: all[0].version, resolution: "ora" }]));
  assert.equal((await q(`SELECT status FROM context_facts WHERE id = $1`, [target]))[0].status, "superato");
  assert.deepEqual((await q(`SELECT statement, status FROM context_facts WHERE supersedes_id = $1`, [target]))[0], { statement: `La sede di prova è a Trieste ${suffix}.`, status: "attivo" });
  assert.deepEqual((await q(`SELECT detail FROM context_events WHERE action = 'conflitto_risolto' AND fact_id = (SELECT id FROM context_facts WHERE supersedes_id = $1)`, [target]))[0].detail, { scelta: "ora" });
});

test("confirmProposals: una proposta da correggere non entra e niente si scrive; troppe voci, nessuna voce, una versione vecchia; solo Lateral Space", opts, async () => {
  const { sourceId, all } = await readProposals([
    proposal({ testo: `Fatto buono ${suffix}.`, citazione: "" }),
    proposal({ testo: "Mario Rossi decide gli acquisti.", citazione: "", sezione: "persone" }),
    proposal({ testo: `Un fatto troppo lungo ${"che continua ".repeat(20)}${suffix}.`, citazione: "" }),
  ]);
  const [good, named, long] = all;
  const blocked = await proposals.confirmProposals(actor("ls"), pick(all));
  assert.equal(errOf(blocked), "dati_non_validi");
  assert.deepEqual(!blocked.ok && blocked.fieldErrors, {
    [named.id]: "Non scrivere nomi di persone: indica il ruolo, per esempio «il responsabile commerciale».",
    [long.id]: "Accorcia la frase: al massimo 200 caratteri.",
  });
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_facts WHERE source_id = $1`, [sourceId]))[0].n, 0, "tutte o nessuna: nemmeno il fatto buono è entrato");
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_proposals WHERE source_id = $1 AND status = 'aperta'`, [sourceId]))[0].n, 3);
  // Una proposta scritta nel database con un nome ma senza `issue` (come se il controllo fosse stato saltato): il controllo si rifà alla conferma.
  await q(`UPDATE context_proposals SET issue = NULL WHERE id = $1`, [named.id]);
  const recheck = await proposals.confirmProposals(actor("ls"), pick([named]));
  assert.deepEqual(!recheck.ok && recheck.fieldErrors, { [named.id]: "Non scrivere nomi di persone: indica il ruolo, per esempio «il responsabile commerciale»." });
  // Nessuna voce, troppe voci, voci doppie, una versione che non è quella vista.
  assert.equal(errOf(await proposals.confirmProposals(actor("ls"), [])), "dati_non_validi");
  const many = Array.from({ length: 76 }, () => ({ id: randomUUID(), version: 1 }));
  const tooMany = await proposals.confirmProposals(actor("ls"), many);
  assert.deepEqual([errOf(tooMany), !tooMany.ok && tooMany.message], ["dati_non_validi", "Al massimo 75 proposte alla volta."]);
  assert.equal(errOf(await proposals.confirmProposals(actor("ls"), [...pick([good]), ...pick([good])])), "dati_non_validi");
  assert.equal(errOf(await proposals.confirmProposals(actor("ls"), [{ id: good.id, version: good.version + 1 }])), "versione_superata");
  assert.equal(errOf(await proposals.confirmProposals(actor("ls"), [{ id: randomUUID(), version: 1 }])), "versione_superata");
  assert.equal(errOf(await proposals.confirmProposals(actor("lsb"), pick([good]))), "versione_superata", "di un altro workspace: per lui non c'è");
  for (const person of ["rev", "con", "lrn", "out"] as const) assert.equal(errOf(await proposals.confirmProposals(actor(person), pick([good]))), "permesso_mancante", person);
  // Il fatto buono, da solo, entra; restano le altre due.
  const done = okValue(await proposals.confirmProposals(actor("ls"), pick([good])));
  assert.equal(done.newFacts, 1);
  assert.ok(done.remaining >= 2);
  await proposals.discardProposals(actor("ls"), [named.id, long.id]);
});

test("due conferme insieme sullo stesso fatto: una vince, l'altra torna «versione superata» e non scrive niente", opts, async () => {
  const fact = await seedFact(`Il fatto conteso ${suffix} vale 1.`, { section: "azienda" });
  const one = await readProposals([proposal({ tipo: "cambia", testo: `Il fatto conteso ${suffix} vale 2.`, citazione: "", fattoRif: "F1", sezione: "azienda" })], `${NOTE}\nPrima call sul fatto conteso (${suffix}).`);
  const two = await readProposals([proposal({ tipo: "cambia", testo: `Il fatto conteso ${suffix} vale 3.`, citazione: "", fattoRif: "F1", sezione: "azienda" })], `${NOTE}\nSeconda call sul fatto conteso (${suffix}).`);
  assert.equal(one.all[0].before?.factId, fact);
  assert.equal(two.all[0].before?.factId, fact);
  const [a, b] = await Promise.all([proposals.confirmProposals(actor("ls"), pick(one.all)), proposals.confirmProposals(actor("lsc"), pick(two.all))]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true], "una sola conferma passa");
  assert.equal(errOf(a.ok ? b : a), "versione_superata");
  const versions = await q(`SELECT statement, status FROM context_facts WHERE supersedes_id = $1`, [fact]);
  assert.equal(versions.length, 1, "il fatto si sostituisce una volta sola");
  assert.equal(versions[0].status, "attivo");
  const loser = a.ok ? two : one;
  assert.equal((await q(`SELECT status FROM context_proposals WHERE id = $1`, [loser.all[0].id]))[0].status, "aperta", "la proposta che ha perso resta aperta");
  // Riletta, la proposta rimasta punta alla versione attiva: la conferma adesso passa, e la storia ha tre versioni.
  const again = (await proposals.listOpenProposals(actor("ls"), { sourceId: loser.sourceId }))!.proposals[0];
  assert.notEqual(again.before?.factId, fact);
  okValue(await proposals.confirmProposals(actor("ls"), pick([again])));
  const history = await q(
    `WITH RECURSIVE chain AS (SELECT id, statement, status, 0 AS depth FROM context_facts WHERE id = $1
       UNION ALL SELECT n.id, n.statement, n.status, c.depth + 1 FROM chain c JOIN context_facts n ON n.supersedes_id = c.id)
     SELECT status FROM chain ORDER BY depth`,
    [fact],
  );
  assert.deepEqual(history.map((h) => h.status), ["superato", "superato", "attivo"]);
});

test("due proposte della stessa conferma sullo stesso fatto si mettono in fila; un fatto ritirato fa della proposta un fatto nuovo", opts, async () => {
  const fact = await seedFact(`Il fatto in fila ${suffix} vale 1.`, { section: "azienda" });
  const { all } = await readProposals([
    proposal({ tipo: "cambia", testo: `Il fatto in fila ${suffix} vale 2.`, citazione: "", fattoRif: "F1", sezione: "azienda" }),
    proposal({ tipo: "cambia", testo: `Il fatto in fila ${suffix} vale 3.`, citazione: "", fattoRif: "F1", sezione: "azienda" }),
    proposal({ tipo: "conferma", testo: "x", citazione: "", fattoRif: "F1" }),
  ]);
  okValue(await proposals.confirmProposals(actor("ls"), pick(all)));
  const history = await q(
    `WITH RECURSIVE chain AS (SELECT id, statement, status, 0 AS depth FROM context_facts WHERE id = $1
       UNION ALL SELECT n.id, n.statement, n.status, c.depth + 1 FROM chain c JOIN context_facts n ON n.supersedes_id = c.id)
     SELECT statement, status FROM chain ORDER BY depth`,
    [fact],
  );
  assert.deepEqual(history.map((h) => [h.statement, h.status]), [
    [`Il fatto in fila ${suffix} vale 1.`, "superato"],
    [`Il fatto in fila ${suffix} vale 2.`, "superato"],
    [`Il fatto in fila ${suffix} vale 3.`, "attivo"],
  ]);
  // Il bersaglio ritirato dopo la lettura: la proposta vale come un fatto nuovo, senza «Prima».
  const gone = await seedFact(`Il fatto ritirato ${suffix}.`, { section: "azienda" });
  const later = await readProposals([proposal({ tipo: "cambia", testo: `Il fatto ritirato ${suffix}, aggiornato.`, citazione: "", fattoRif: "F1", sezione: "azienda" })], `${NOTE}\nCall sul fatto ritirato (${suffix}).`);
  assert.equal(later.all[0].before?.factId, gone);
  await q(`UPDATE context_facts SET status = 'ritirato', ended_at = now() WHERE id = $1`, [gone]);
  const view = (await proposals.listOpenProposals(actor("ls"), { sourceId: later.sourceId }))!.proposals[0];
  assert.deepEqual([view.kind, view.before], ["nuovo", null]);
  const result = okValue(await proposals.confirmProposals(actor("ls"), pick([view])));
  assert.deepEqual([result.newFacts, result.changedFacts], [1, 0]);
  assert.deepEqual((await q(`SELECT supersedes_id, status FROM context_facts WHERE statement = $1`, [`Il fatto ritirato ${suffix}, aggiornato.`]))[0], { supersedes_id: null, status: "attivo" });
});

// ─── La Memoria ──────────────────────────────────────────────────────

const allFacts = (view: Awaited<ReturnType<typeof memory.loadContextMemory>>) => view.sections.flatMap((s) => s.facts);

test("loadContextMemory: Lateral Space vede tutto con la fonte; il cliente mai un fatto «Solo Lateral Space», mai una proposta, mai un appunto da leggere", opts, async () => {
  const { sourceId, all } = await readProposals([
    proposal({ testo: `Il magazzino della memoria è a Udine ${suffix}.`, citazione: "Il gestionale è SAP Business One.", sezione: "lavoro", visibilita: "tutti" }),
    proposal({ testo: `Il margine della memoria è del 12% ${suffix}.`, citazione: "Il contratto con Lateral Space vale 40.000 euro.", sezione: "azienda", visibilita: "ls" }),
    proposal({ tipo: "impegno", testo: `Mandare il listino della memoria ${suffix}.`, citazione: "", sezione: null, parte: "cliente", ruolo: "responsabile commerciale", entro: "2020-01-15", visibilita: "tutti" }),
    proposal({ tipo: "impegno", testo: `Preparare l'offerta della memoria ${suffix}.`, citazione: "", sezione: null, parte: "nostra", visibilita: "ls" }),
    proposal({ tipo: "domanda", testo: `Chi firma il rinnovo della memoria ${suffix}?`, citazione: "", sezione: null, ruolo: "direttore generale", visibilita: "ls" }),
    proposal({ tipo: "domanda", testo: `Quanti magazzini ci sono nella memoria ${suffix}?`, citazione: "", sezione: null, visibilita: "tutti" }),
  ]);
  okValue(await proposals.confirmProposals(actor("ls"), pick(all)));
  const manual = okValue(await memory.writeFact(actor("ls"), { statement: `Il cliente della memoria vende in Austria ${suffix}.`, section: "azienda", visibility: "tutti" }));
  const pendingNote = await addNote();

  const forLs = await memory.loadContextMemory(actor("lsc"));
  assert.deepEqual(forLs.sections.map((s) => s.section), ["azienda", "persone", "lavoro", "sistemi", "obiettivi", "regole", "parole"]);
  const lsFacts = allFacts(forLs);
  const shared = lsFacts.find((f) => f.statement === `Il magazzino della memoria è a Udine ${suffix}.`)!;
  const internal = lsFacts.find((f) => f.statement === `Il margine della memoria è del 12% ${suffix}.`)!;
  const written = lsFacts.find((f) => f.id === manual.factId)!;
  assert.deepEqual(
    { section: shared.section, basis: shared.basis, visibility: shared.visibility, needsCheck: shared.needsCheck, sourceKind: shared.sourceKind, sourceLabel: shared.sourceLabel, kind: shared.kind },
    { section: "lavoro", basis: "detto", visibility: "tutti", needsCheck: false, sourceKind: "call", sourceLabel: "Call 14 nov", kind: "fatto" },
  );
  assert.match(shared.lastConfirmedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(internal.visibility, "ls");
  assert.deepEqual([written.sourceKind, written.sourceLabel, written.basis], ["manuale", "Scritto a mano", "detto"]);
  assert.ok(forLs.sections.find((s) => s.section === "azienda")!.facts.includes(written), "ogni fatto nella sua sezione");
  // «Prossimi passi»: aperti, per parte; scaduto se la data è passata. «Domande aperte».
  const theirs = forLs.nextSteps.cliente.find((c) => c.statement === `Mandare il listino della memoria ${suffix}.`)!;
  assert.deepEqual({ party: theirs.party, roleLabel: theirs.roleLabel, dueOn: theirs.dueOn, overdue: theirs.overdue, visibility: theirs.visibility }, { party: "cliente", roleLabel: "responsabile commerciale", dueOn: "2020-01-15", overdue: true, visibility: "tutti" });
  const ours = forLs.nextSteps.nostri.find((c) => c.statement === `Preparare l'offerta della memoria ${suffix}.`)!;
  assert.deepEqual([ours.overdue, ours.dueOn, ours.visibility], [false, null, "ls"]);
  assert.ok(forLs.questions.some((x) => x.question === `Chi firma il rinnovo della memoria ${suffix}?` && x.askWhom === "direttore generale" && x.visibility === "ls"));
  // I conteggi di servizio: solo per Lateral Space.
  assert.equal(forLs.counts.facts, lsFacts.length);
  assert.ok(forLs.counts.unreadSources >= 1 && forLs.counts.pendingSourceIds.length >= 1 && forLs.counts.pendingSourceIds.length <= 20);
  assert.ok(forLs.counts.unreadSources > 20 || forLs.counts.pendingSourceIds.includes(pendingNote.sourceId));

  for (const person of ["rev", "con"] as const) {
    const view = await memory.loadContextMemory(actor(person));
    const facts = allFacts(view);
    assert.ok(facts.length > 0 && facts.every((f) => f.visibility === "tutti"), `${person}: solo fatti «Per tutti»`);
    assert.ok(facts.some((f) => f.id === shared.id) && facts.some((f) => f.id === manual.factId));
    assert.equal(facts.some((f) => f.id === internal.id), false, `${person}: mai un fatto «Solo Lateral Space»`);
    assert.equal(JSON.stringify(view).includes("12%"), false, `${person}: nemmeno il suo testo`);
    assert.equal(JSON.stringify(view).includes("Il contratto con Lateral Space vale"), false, `${person}: mai una citazione`);
    assert.ok([...view.nextSteps.cliente, ...view.nextSteps.nostri].every((c) => c.visibility === "tutti"));
    assert.ok(view.nextSteps.cliente.some((c) => c.id === theirs.id));
    assert.equal(view.nextSteps.nostri.some((c) => c.id === ours.id), false);
    assert.ok(view.questions.every((x) => x.visibility === "tutti"));
    assert.ok(view.questions.some((x) => x.question === `Quanti magazzini ci sono nella memoria ${suffix}?`));
    assert.deepEqual({ ...view.counts, facts: 0 }, { facts: 0, openProposals: 0, unreadSources: 0, pendingSourceIds: [] }, `${person}: niente di interno`);
  }
  // Chi segue solo un corso, chi non è nel workspace, e Lateral Space di un altro workspace: una memoria vuota.
  for (const who of [actor("lrn"), actor("out"), actor("ls", "wsB")]) {
    const none = await memory.loadContextMemory(who);
    assert.equal(allFacts(none).length + none.questions.length + none.nextSteps.cliente.length + none.nextSteps.nostri.length, 0);
    assert.equal(none.sections.every((s) => s.live.length === 0), true);
  }
  const other = await memory.loadContextMemory(actor("lsb"));
  assert.equal(allFacts(other).some((f) => lsFacts.some((x) => x.id === f.id)), false, "un altro workspace ha la sua memoria");
  await sources.removeContextSource(actor("ls"), pendingNote.sourceId);
  // Gli appunti di questa prova risultano confermati.
  assert.equal((await sources.getContextSource(actor("ls"), sourceId))?.state, "confermato");
});

test("la Memoria mostra i dati della Discovery nella sezione giusta, letti dal vivo; dipendenti e ricavo solo ai revisori", opts, async () => {
  await q(`INSERT INTO program_settings (workspace_id, employees, employees_source, revenue_eur, revenue_source) VALUES ($1, 420, 'manuale', 12000000, 'manuale') ON CONFLICT (workspace_id) DO UPDATE SET employees = 420, revenue_eur = 12000000`, [ids.wsA]);
  assert.equal(await thesis.saveWorkspaceValueThesis(ids.wsA, { coreValueProposition: "Cucine su misura per il mercato italiano.", strategicNodes: ["Progettazione"], commodityNodes: ["Contabilità"], marginDrivers: [], keyRisks: [], aiReadiness: "Bassa" }), true);
  await q(`INSERT INTO activities (department_id, workspace_id, title) VALUES ($1, $2, 'Ordini ai fornitori'), ($1, $2, 'Controllo delle consegne')`, [ids.unitA, ids.wsA]);
  const view = await memory.loadContextMemory(actor("ls"));
  const live = (section: string) => view.sections.find((s) => s.section === section)!.live.map((row) => (row.tag ? `${row.tag}: ${row.text}` : row.text));
  assert.deepEqual(live("azienda"), ["Cucine su misura per il mercato italiano.", "Nodi strategici: Progettazione", "Nodi commodity: Contabilità", "Maturità AI: Bassa", "Dipendenti: 420", "Ricavo dell'ultimo anno: 12 mln €"]);
  assert.deepEqual(live("lavoro"), ["Acquisti: Compra legno e ferramenta · 4 persone · 2 attività mappate"]);
  assert.deepEqual(live("obiettivi"), ["Obiettivo: Ridurre i tempi di consegna"]);
  assert.deepEqual(live("regole"), ["Perimetro: incluse Vendite, Acquisti; escluse Produzione", "Si parte dalle vendite.", "Orizzonte: 12 mesi"]);
  assert.deepEqual([live("persone"), live("sistemi"), live("parole")], [[], [], []]);
  // I dati della Discovery non sono fatti: non hanno una riga in memoria.
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_facts WHERE workspace_id = $1 AND statement LIKE 'Cucine su misura per il mercato%'`, [ids.wsA]))[0].n, 0);
  // Le cifre: i revisori sì (anche del cliente), i contributori no (nemmeno di Lateral Space).
  const figures = async (person: Person) => (await memory.loadContextMemory(actor(person))).sections[0].live.some((row) => /Dipendenti|Ricavo/.test(row.text));
  assert.deepEqual([await figures("ls"), await figures("rev"), await figures("lsc"), await figures("con")], [true, true, false, false]);
  // Si leggono dal vivo: una modifica alla Discovery si vede subito.
  await q(`UPDATE departments SET team_size = 5 WHERE id = $1`, [ids.unitA]);
  assert.deepEqual((await memory.loadContextMemory(actor("con"))).sections.find((s) => s.section === "lavoro")!.live.map((r) => r.text), ["Acquisti: Compra legno e ferramenta · 5 persone · 2 attività mappate"]);
});

test("«Novità per te»: niente alla prima visita; dopo 31 minuti i fatti nati dopo, non i propri, non quelli riconfermati; durante la visita restano", opts, async () => {
  const viewer = actor("rev");
  const t0 = new Date("2026-11-16T09:00:00Z");
  await q(`DELETE FROM context_seen WHERE workspace_id = $1 AND user_id = ANY($2::uuid[])`, [ids.wsA, [ids.rev, ids.ls]]);
  assert.equal(await memory.touchContextSeen(viewer, t0), null, "prima visita");
  assert.equal(await memory.touchContextSeen(viewer, new Date(t0.getTime() + 29 * 60_000)), null, "la stessa visita");
  const second = await memory.touchContextSeen(viewer, new Date(t0.getTime() + 31 * 60_000));
  assert.equal(second?.toISOString(), t0.toISOString(), "dopo 31 minuti è una visita nuova: la visita di prima è quella delle 9");
  assert.equal((await memory.touchContextSeen(viewer, new Date(t0.getTime() + 40 * 60_000)))?.toISOString(), t0.toISOString(), "durante la visita la visita di prima non si muove");
  assert.equal(await memory.touchContextSeen(actor("lrn"), t0), null);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_seen WHERE user_id = $1`, [ids.lrn]))[0].n, 0, "chi segue solo un corso non lascia tracce");

  // La visita di prima del revisore è nel passato vero: i fatti nati adesso sono novità.
  await q(`UPDATE context_seen SET seen_at = now() - interval '2 hours', previous_seen_at = now() - interval '3 days' WHERE workspace_id = $1 AND user_id = $2`, [ids.wsA, ids.rev]);
  const old = await seedFact(`Il fatto vecchio delle novità ${suffix}.`, { section: "azienda" });
  await q(`UPDATE context_facts SET created_at = now() - interval '3 hours', last_confirmed_at = now() - interval '3 hours' WHERE id = $1`, [old]);
  const fresh = okValue(await memory.writeFact(actor("ls"), { statement: `Il fatto nuovo delle novità ${suffix}.`, section: "lavoro", visibility: "tutti" }));
  const hidden = okValue(await memory.writeFact(actor("ls"), { statement: `Il fatto interno delle novità ${suffix}.`, section: "lavoro", visibility: "ls" }));
  const base = okValue(await memory.writeFact(actor("ls"), { statement: `Il fatto delle novità vale 1 ${suffix}.`, section: "azienda", visibility: "tutti" }));
  await q(`UPDATE context_facts SET created_at = now() - interval '3 hours' WHERE id = $1`, [base.factId]);
  const changed = okValue(await memory.editFact(actor("ls"), base.factId, 1, { statement: `Il fatto delle novità vale 2 ${suffix}.` }));
  okValue(await memory.reconfirmFact(actor("ls"), old));

  const view = await memory.loadContextMemory(viewer);
  assert.ok(view.novelties, "ci sono novità");
  const items = new Map(view.novelties!.items.map((n) => [n.factId, n]));
  assert.deepEqual(items.get(fresh.factId), { factId: fresh.factId, statement: `Il fatto nuovo delle novità ${suffix}.`, section: "lavoro", tag: "nuovo" });
  assert.equal(items.get(changed.factId)?.tag, "cambiato");
  assert.equal(items.has(hidden.factId), false, "mai un fatto che chi guarda non può vedere");
  assert.equal(items.has(old), false, "un fatto solo riconfermato non è una novità");
  assert.ok(view.novelties!.items.length <= 5);
  assert.ok(view.novelties!.more >= 0);
  // Durante la stessa visita le novità restano; chi le ha confermate non le vede tra le sue.
  assert.ok((await memory.loadContextMemory(viewer)).novelties?.items.some((n) => n.factId === fresh.factId));
  await q(`INSERT INTO context_seen (workspace_id, user_id, seen_at, previous_seen_at) VALUES ($1, $2, now() - interval '2 hours', now() - interval '3 days') ON CONFLICT (workspace_id, user_id) DO UPDATE SET seen_at = excluded.seen_at, previous_seen_at = excluded.previous_seen_at`, [ids.wsA, ids.ls]);
  const mine = await memory.loadContextMemory(actor("ls"));
  assert.equal(mine.novelties?.items.some((n) => n.factId === fresh.factId || n.factId === changed.factId) ?? false, false, "non le proprie");
  // Alla prima visita, niente.
  await q(`DELETE FROM context_seen WHERE workspace_id = $1 AND user_id = $2`, [ids.wsA, ids.con]);
  assert.equal((await memory.loadContextMemory(actor("con"))).novelties, null);
});

test("getFactDetail: fonte, ultima conferma e use case per tutti; citazione, storia e chi ha confermato solo a Lateral Space", opts, async () => {
  const { sourceId, all } = await readProposals([proposal({ testo: `Il dettaglio di prova vale 1 ${suffix}.`, citazione: "Il gestionale è SAP Business One.", sezione: "sistemi", useCase: ["CX-0001"] })]);
  okValue(await proposals.confirmProposals(actor("ls"), pick(all)));
  const first = String((await q(`SELECT id FROM context_facts WHERE source_id = $1`, [sourceId]))[0].id);
  const second = okValue(await memory.editFact(actor("lsc"), first, 1, { statement: `Il dettaglio di prova vale 2 ${suffix}.` })).factId;
  const third = okValue(await memory.editFact(actor("ls"), second, 1, { statement: `Il dettaglio di prova vale 3 ${suffix}.` })).factId;
  const detail = await memory.getFactDetail(actor("ls"), third);
  assert.ok(detail);
  assert.deepEqual(
    { statement: detail.statement, sourceKind: detail.sourceKind, sourceLabel: detail.sourceLabel, useCases: detail.useCases, quote: detail.quote, source: detail.source, confirmedBy: detail.confirmedBy?.name, version: detail.version },
    { statement: `Il dettaglio di prova vale 3 ${suffix}.`, sourceKind: "manuale", sourceLabel: "Scritto a mano", useCases: [{ id: ids.ucA, code: "CX-0001", title: "Ordini automatici" }], quote: null, source: null, confirmedBy: "Persona ls", version: 1 },
  );
  // La storia: le versioni di prima, dalla più recente, ognuna con la sua fonte.
  assert.deepEqual(detail.history.map((h) => [h.statement, h.sourceLabel, h.to !== null]), [
    [`Il dettaglio di prova vale 2 ${suffix}.`, "Scritto a mano", true],
    [`Il dettaglio di prova vale 1 ${suffix}.`, "Call 14 nov", true],
  ]);
  // La prima versione porta la citazione e l'appunto da cui viene.
  const origin = await memory.getFactDetail(actor("ls"), first);
  assert.deepEqual([origin?.quote, origin?.source, origin?.history], ["Il gestionale è SAP Business One.", { id: sourceId, title: "Call di avvio", occurredOn: "2026-11-14" }, []]);
  // Il cliente: la fonte, la data, gli use case; niente citazione, storia, appunto, chi ha confermato. E mai una versione superata.
  for (const person of ["rev", "con"] as const) {
    const view = await memory.getFactDetail(actor(person), third);
    assert.deepEqual(
      view && { statement: view.statement, sourceLabel: view.sourceLabel, useCases: view.useCases.map((u) => u.code), quote: view.quote, source: view.source, history: view.history, confirmedBy: view.confirmedBy },
      { statement: `Il dettaglio di prova vale 3 ${suffix}.`, sourceLabel: "Scritto a mano", useCases: ["CX-0001"], quote: null, source: null, history: [], confirmedBy: null },
      person,
    );
    assert.equal(await memory.getFactDetail(actor(person), first), null, `${person}: una versione superata non si vede`);
  }
  const internal = okValue(await memory.writeFact(actor("ls"), { statement: `Il dettaglio interno di prova ${suffix}.`, section: "regole", visibility: "ls" }));
  assert.equal(await memory.getFactDetail(actor("rev"), internal.factId), null);
  assert.ok(await memory.getFactDetail(actor("lsc"), internal.factId));
  for (const who of [actor("lrn"), actor("out"), actor("lsb")]) assert.equal(await memory.getFactDetail(who, third), null);
  assert.equal(await memory.getFactDetail(actor("ls"), "non-un-id"), null);
});

test("un conflitto aperto segna il fatto «da verificare», per Lateral Space", opts, async () => {
  const fact = await seedFact(`Il fatto da verificare ${suffix} è vero.`, { section: "regole" });
  const { all } = await readProposals([proposal({ tipo: "conflitto", testo: `Il fatto da verificare ${suffix} non è vero.`, citazione: "", fattoRif: "F1", sezione: "regole" })]);
  assert.equal(all[0].before?.factId, fact);
  const find = async (person: Person) => allFacts(await memory.loadContextMemory(actor(person))).find((f) => f.id === fact);
  assert.equal((await find("ls"))?.needsCheck, true);
  assert.equal((await memory.getFactDetail(actor("ls"), fact))?.needsCheck, true);
  assert.equal((await find("rev"))?.needsCheck, false, "il conflitto è una proposta: la vede solo Lateral Space");
  okValue(await proposals.confirmProposals(actor("ls"), [{ id: all[0].id, version: all[0].version, resolution: "prima" }]));
  assert.equal((await find("ls"))?.needsCheck, false);
});

test("writeFact, editFact, reconfirmFact, retireFact: solo Lateral Space; un nome non entra; un testo nuovo è una versione nuova; il resto aggiorna la riga", opts, async () => {
  const input = { statement: `Il fatto scritto a mano ${suffix}.`, section: "parole" as const, visibility: "tutti" as const, useCaseIds: [ids.ucA] };
  for (const person of ["rev", "con", "lrn", "out"] as const) assert.equal(errOf(await memory.writeFact(actor(person), input)), "permesso_mancante", person);
  const bad = await memory.writeFact(actor("ls"), { statement: "Mario Rossi decide gli acquisti.", section: "persone", visibility: "tutti" });
  assert.deepEqual([errOf(bad), !bad.ok && bad.fieldErrors], ["dati_non_validi", { statement: "Non scrivere nomi di persone: indica il ruolo, per esempio «il responsabile commerciale»." }]);
  const invalid = await memory.writeFact(actor("ls"), { statement: "x", section: "altro" as never, visibility: "pubblico" as never, useCaseIds: [randomUUID()] });
  assert.deepEqual(Object.keys((!invalid.ok && invalid.fieldErrors) || {}).sort(), ["section", "statement", "useCaseIds", "visibility"]);
  assert.equal(errOf(await memory.writeFact(actor("ls"), { ...input, statement: "y".repeat(201) })), "dati_non_validi");
  const { factId } = okValue(await memory.writeFact(actor("ls"), input));
  assert.deepEqual((await q(`SELECT kind, basis, origin, status, source_id, quote, version, confirmed_by_user_id::text AS who FROM context_facts WHERE id = $1`, [factId]))[0], { kind: "fatto", basis: "detto", origin: "manuale", status: "attivo", source_id: null, quote: null, version: 1, who: ids.ls });
  assert.deepEqual((await q(`SELECT action, actor_user_id::text AS who FROM context_events WHERE fact_id = $1`, [factId])), [{ action: "fatto_scritto", who: ids.ls }]);
  // Sezione e visibilità aggiornano la riga (versione + 1) e lasciano una riga di storia l'una.
  assert.deepEqual(okValue(await memory.editFact(actor("lsc"), factId, 1, { section: "regole", visibility: "ls", useCaseIds: [] })), { factId });
  assert.deepEqual((await q(`SELECT section, visibility, version, status FROM context_facts WHERE id = $1`, [factId]))[0], { section: "regole", visibility: "ls", version: 2, status: "attivo" });
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_fact_links WHERE fact_id = $1`, [factId]))[0].n, 0);
  assert.deepEqual((await q(`SELECT action, detail FROM context_events WHERE fact_id = $1 AND action IN ('sezione_cambiata', 'visibilita_cambiata') ORDER BY action`, [factId])), [
    { action: "sezione_cambiata", detail: { da: "parole", a: "regole" } },
    { action: "visibilita_cambiata", detail: { da: "tutti", a: "ls" } },
  ]);
  // La versione di prima non vale più; un testo con un nome non passa.
  assert.equal(errOf(await memory.editFact(actor("ls"), factId, 1, { section: "azienda" })), "versione_superata");
  assert.equal(errOf(await memory.editFact(actor("ls"), factId, 2, { statement: "Anna Bianchi decide tutto." })), "dati_non_validi");
  // Un testo nuovo: una versione nuova che tiene sezione e visibilità; quella di prima passa alla storia.
  const next = okValue(await memory.editFact(actor("ls"), factId, 2, { statement: `Il fatto scritto a mano, corretto ${suffix}.` })).factId;
  assert.notEqual(next, factId);
  assert.deepEqual((await q(`SELECT status, ended_at IS NOT NULL AS ended FROM context_facts WHERE id = $1`, [factId]))[0], { status: "superato", ended: true });
  assert.deepEqual((await q(`SELECT section, visibility, status, origin, supersedes_id::text AS supersedes, version FROM context_facts WHERE id = $1`, [next]))[0], { section: "regole", visibility: "ls", status: "attivo", origin: "manuale", supersedes: factId, version: 1 });
  assert.equal(errOf(await memory.editFact(actor("ls"), factId, 3, { statement: "Un terzo testo di prova." })), "versione_superata", "una versione superata non si modifica");
  // «Ancora vero»: la data si rinfresca e la versione non cambia. «Non più vero»: ritirato, resta nella storia.
  await q(`UPDATE context_facts SET last_confirmed_at = now() - interval '200 days', needs_check = true WHERE id = $1`, [next]);
  for (const person of ["rev", "con"] as const) assert.equal(errOf(await memory.reconfirmFact(actor(person), next)), "permesso_mancante", person);
  assert.equal(okValue(await memory.reconfirmFact(actor("lsc"), next)), true);
  assert.deepEqual((await q(`SELECT needs_check, (last_confirmed_at > now() - interval '1 minute') AS fresh, confirmed_by_user_id::text AS who, version FROM context_facts WHERE id = $1`, [next]))[0], { needs_check: false, fresh: true, who: ids.lsc, version: 1 });
  assert.equal(errOf(await memory.reconfirmFact(actor("ls"), factId)), "non_trovato", "solo un fatto attivo");
  assert.equal(errOf(await memory.retireFact(actor("rev"), next, 1)), "permesso_mancante");
  assert.equal(errOf(await memory.retireFact(actor("lsb"), next, 1)), "non_trovato");
  assert.equal(errOf(await memory.retireFact(actor("ls"), next, 9)), "versione_superata");
  assert.equal(okValue(await memory.retireFact(actor("ls"), next, 1)), true);
  assert.deepEqual((await q(`SELECT status, ended_at IS NOT NULL AS ended FROM context_facts WHERE id = $1`, [next]))[0], { status: "ritirato", ended: true });
  assert.equal(allFacts(await memory.loadContextMemory(actor("ls"))).some((f) => f.id === next), false, "un fatto ritirato esce dalla memoria");
  assert.deepEqual((await q(`SELECT action FROM context_events WHERE fact_id = $1 ORDER BY at`, [next])).map((e) => e.action), ["fatto_cambiato", "fatto_riconfermato", "fatto_ritirato"]);
});

test("impegni e domande: «Fatto», «Riapri», «Chiusa» solo per Lateral Space; una domanda da «Chiedi» la aggiunge chi apre la pagina", opts, async () => {
  const commitment = randomUUID();
  const question = randomUUID();
  await q(`INSERT INTO context_commitments (id, workspace_id, statement, party, visibility, origin) VALUES ($1, $2, $3, 'cliente', 'tutti', 'manuale')`, [commitment, ids.wsA, `Impegno da chiudere ${suffix}.`]);
  await q(`INSERT INTO context_questions (id, workspace_id, question, visibility, origin) VALUES ($1, $2, $3, 'tutti', 'manuale')`, [question, ids.wsA, `Domanda da chiudere ${suffix}?`]);
  for (const person of ["rev", "con", "lrn"] as const) {
    assert.equal(errOf(await memory.closeCommitment(actor(person), commitment, 1)), "permesso_mancante", person);
    assert.equal(errOf(await memory.closeQuestion(actor(person), question, 1)), "permesso_mancante", person);
  }
  assert.equal(errOf(await memory.closeCommitment(actor("lsb"), commitment, 1)), "non_trovato");
  assert.equal(errOf(await memory.closeCommitment(actor("ls"), commitment, 2)), "versione_superata");
  assert.equal(okValue(await memory.closeCommitment(actor("ls"), commitment, 1)), true);
  assert.deepEqual((await q(`SELECT status, closed_at IS NOT NULL AS closed, version FROM context_commitments WHERE id = $1`, [commitment]))[0], { status: "fatto", closed: true, version: 2 });
  assert.equal((await memory.loadContextMemory(actor("ls"))).nextSteps.cliente.some((c) => c.id === commitment), false, "un impegno fatto esce dai prossimi passi");
  assert.equal(errOf(await memory.closeCommitment(actor("ls"), commitment, 2)), "versione_superata", "già fatto");
  assert.equal(okValue(await memory.reopenCommitment(actor("lsc"), commitment, 2)), true);
  assert.deepEqual((await q(`SELECT status, closed_at, version FROM context_commitments WHERE id = $1`, [commitment]))[0], { status: "aperto", closed_at: null, version: 3 });
  assert.equal(okValue(await memory.closeQuestion(actor("ls"), question, 1)), true);
  assert.deepEqual((await q(`SELECT status, closed_at IS NOT NULL AS closed FROM context_questions WHERE id = $1`, [question]))[0], { status: "chiusa", closed: true });
  // La storia di impegni e domande non dice chi: valgono per parte e per ruolo.
  const events = await q(`SELECT action, actor_user_id FROM context_events WHERE commitment_id = $1 OR question_id = $2 ORDER BY at`, [commitment, question]);
  assert.deepEqual(events, [{ action: "impegno_chiuso", actor_user_id: null }, { action: "impegno_riaperto", actor_user_id: null }, { action: "domanda_chiusa", actor_user_id: null }]);

  // «Aggiungi alle domande aperte»: `ls` da Lateral Space, `tutti` dal cliente; la stessa domanda non si aggiunge due volte.
  const asked = okValue(await memory.addQuestion(actor("con"), { question: `  Quanti ordini arrivano al giorno ${suffix}? `, askWhom: "responsabile acquisti" }));
  assert.deepEqual((await q(`SELECT question, ask_whom, visibility, origin, status FROM context_questions WHERE id = $1`, [asked.questionId]))[0], { question: `Quanti ordini arrivano al giorno ${suffix}?`, ask_whom: "responsabile acquisti", visibility: "tutti", origin: "chiedi", status: "aperta" });
  assert.deepEqual(okValue(await memory.addQuestion(actor("rev"), { question: `quanti ordini arrivano al giorno ${suffix}?` })), asked);
  const internal = okValue(await memory.addQuestion(actor("ls"), { question: `Quanto margine ha il cliente ${suffix}?` }));
  assert.equal((await q(`SELECT visibility FROM context_questions WHERE id = $1`, [internal.questionId]))[0].visibility, "ls");
  // Il cliente fa la stessa domanda: non vede quella interna, e nasce la sua.
  const theirs = okValue(await memory.addQuestion(actor("con"), { question: `Quanto margine ha il cliente ${suffix}?` }));
  assert.notEqual(theirs.questionId, internal.questionId);
  assert.equal(errOf(await memory.addQuestion(actor("lrn"), { question: "Una domanda di prova?" })), "permesso_mancante");
  const wrong = await memory.addQuestion(actor("con"), { question: "Che cosa decide Mario Rossi?", askWhom: "Anna Bianchi" });
  assert.deepEqual(Object.keys((!wrong.ok && wrong.fieldErrors) || {}).sort(), ["askWhom", "question"]);
  assert.equal(errOf(await memory.addQuestion(actor("con"), { question: "a" })), "dati_non_validi");
});
