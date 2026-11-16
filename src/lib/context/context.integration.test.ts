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
