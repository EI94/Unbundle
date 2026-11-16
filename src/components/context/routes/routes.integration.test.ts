import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fakeAppClaude, installAppModules, message, recordLogs, refusal, THINKING, type Reply } from "../../../lib/ai/claude-test-kit.ts";

// Le rotte e le azioni della pagina «Contesto» sul database del pacchetto, con il Claude finto (rilascio 9a,
// RILASCIO-9a-COSTRUZIONE.md §3.5, §11.3): «Aggiungi appunti», la lettura, «Da confermare» con la selezione della
// pagina, il pannello di un fatto, «Chiedi al contesto». Le rotte e le funzioni condivise sono quelle vere; finti solo
// la sessione, `revalidatePath` e `after` (fuori da una richiesta di Next non ci sono).
//
// - Con HUB_TEST_ISOLATED=true e un DATABASE_URL di loopback su una copia hub_<id> (scripts/use-case-test/
//   run-db-tests.mjs, che prende src/lib/context/** e src/components/context/**). Dati sintetici, creati e cancellati
//   qui. Nessun modello vero.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
type Prova = { session: unknown; revalidated: string[]; afterTasks: Array<() => unknown> };
const prova: Prova = { session: null, revalidated: [], afterTasks: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let sourcesRoute: typeof import("../../../app/api/context/[workspaceId]/sources/route.ts");
let readRoute: typeof import("../../../app/api/context/[workspaceId]/sources/[sourceId]/read/route.ts");
let factRoute: typeof import("../../../app/api/context/[workspaceId]/facts/[factId]/route.ts");
let askRoute: typeof import("../../../app/api/context/[workspaceId]/ask/route.ts");
let actions: typeof import("../../../lib/actions/context.ts");
let proposals: typeof import("../../../lib/db/queries/context-proposals.ts");
let memory: typeof import("../../../lib/db/queries/context-memory.ts");
let viewModel: typeof import("../view-model.ts");

const suffix = randomBytes(3).toString("hex");
const people = ["ls", "rev", "lrn", "lsb"] as const;
type Person = (typeof people)[number];
const ids = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  ...(Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>),
};
const EMAIL: Record<Person, string> = { ls: `ls-${suffix}@ls.test`, rev: `rev-${suffix}@cliente.test`, lrn: `lrn-${suffix}@cliente.test`, lsb: `lsb-${suffix}@ls.test` };
const ROLE: Record<Person, ["wsA" | "wsB", string]> = { ls: ["wsA", "transformation_lead"], rev: ["wsA", "analyst"], lrn: ["wsA", "learner"], lsb: ["wsB", "transformation_lead"] };

function signIn(person: Person | null) {
  prova.session = person ? { user: { id: ids[person], name: `Persona ${person}`, email: EMAIL[person], image: null, emailVerified: true } } : null;
}

const json = (value: unknown): Reply => message([THINKING, { type: "text", text: JSON.stringify(value) }]);
const NOTHING_SKIPPED = { persone: 0, sanitari: 0, altriClienti: 0, clientiDelCliente: 0 };
const modelProposal = (over: Record<string, unknown>) => ({
  tipo: "nuovo",
  testo: "",
  citazione: "",
  base: "detto",
  sezione: "sistemi",
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

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const postJson = (path: string, body: unknown) => new Request(`https://unbundle.test${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function addNote(workspace: "wsA" | "wsB", body: string, title = "Call di avvio"): Promise<string> {
  const response = await sourcesRoute.POST(postJson(`/api/context/${ids[workspace]}/sources`, { title, occurredOn: "2026-11-14", body }), params({ workspaceId: ids[workspace] }));
  assert.equal(response.status, 200, await response.clone().text());
  return ((await response.json()) as { sourceId: string }).sourceId;
}
async function readNote(workspace: "wsA" | "wsB", sourceId: string, again = false) {
  const response = await readRoute.POST(postJson(`/api/context/${ids[workspace]}/sources/${sourceId}/read`, again ? { again: true } : {}), params({ workspaceId: ids[workspace], sourceId }));
  return { status: response.status, body: (await response.json()) as { outcome?: Record<string, unknown> } };
}
async function ask(workspace: "wsA" | "wsB", question: string) {
  const response = await askRoute.POST(postJson(`/api/context/${ids[workspace]}/ask`, { question }), params({ workspaceId: ids[workspace] }));
  return { status: response.status, headers: response.headers, body: (await response.json()) as Record<string, unknown> };
}

before(async () => {
  if (!enabled) return;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  await installAppModules({
    "@/lib/auth": `export const auth = async () => globalThis.__prova.session;`,
    "next/cache": `export function revalidatePath(path, type) { globalThis.__prova.revalidated.push(path + (type ? "|" + type : "")); }`,
    "next/server": `export function after(task) { globalThis.__prova.afterTasks.push(task); }`,
  });
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, values = []) => sql.query(text, values) as Promise<Row[]>;
  await (await import("../../../lib/db/ensure-schema.ts")).ensureDbSchema();
  sourcesRoute = await import("../../../app/api/context/[workspaceId]/sources/route.ts");
  readRoute = await import("../../../app/api/context/[workspaceId]/sources/[sourceId]/read/route.ts");
  factRoute = await import("../../../app/api/context/[workspaceId]/facts/[factId]/route.ts");
  askRoute = await import("../../../app/api/context/[workspaceId]/ask/route.ts");
  actions = await import("../../../lib/actions/context.ts");
  proposals = await import("../../../lib/db/queries/context-proposals.ts");
  memory = await import("../../../lib/db/queries/context-memory.ts");
  viewModel = await import("../view-model.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione A della pagina', $2), ($3, 'Organizzazione B della pagina', $4)`, [ids.orgA, `org-ctxp-a-${suffix}`, ids.orgB, `org-ctxp-b-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente A della pagina'), ($3, $4, 'Cliente B della pagina')`, [ids.wsA, ids.orgA, ids.wsB, ids.orgB]);
  for (const person of people) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], `Persona ${person}`]);
    const [workspace, role] = ROLE[person];
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids[workspace], ids[person], role]);
  }
  // L'ok ai sub-responsabili per la lista di oggi: solo nel workspace A.
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role)
     SELECT $1::uuid, $2, 'Registrato da Lateral Space per conto del cliente di prova.', $3::uuid, 'transformation_lead'`,
    [ids.wsA, (await import("../../../lib/uc/legal/subprocessors.ts")).SUBPROCESSORS_VERSION, ids.ls],
  );
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE 'ctx:%' AND (bucket LIKE $1 OR bucket LIKE $2 OR bucket = ANY($3::text[]))`, [`%${ids.wsA}%`, `%${ids.wsB}%`, people.map((p) => `ctx:u:${ids[p]}:ask`)]);
  await q(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[ids.orgA, ids.orgB]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [people.map((p) => ids[p])]);
});

const NOTE = `Call di avvio con il cliente della pagina ${suffix}.
Il gestionale è SAP Business One da tre anni.
Forse cambieranno il magazzino entro l'estate.`;

// ─── «Aggiungi appunti» ──────────────────────────────────────────────

test("POST …/sources: Lateral Space salva; lo stesso testo due volte è lo stesso appunto; «visita medica» 422 con la parola; il cliente 404; senza sessione 401", opts, async () => {
  signIn("ls");
  const body = `${NOTE}\nPrima prova di salvataggio.`;
  const first = await sourcesRoute.POST(postJson(`/api/context/${ids.wsA}/sources`, { title: "Call di avvio", occurredOn: "2026-11-14", body }), params({ workspaceId: ids.wsA }));
  assert.equal(first.status, 200);
  const saved = (await first.json()) as { sourceId: string; created: boolean; readStatus: string };
  assert.deepEqual([saved.created, saved.readStatus], [true, "da_leggere"]);
  const again = await sourcesRoute.POST(postJson(`/api/context/${ids.wsA}/sources`, { title: "Un altro titolo", occurredOn: "2026-11-15", body }), params({ workspaceId: ids.wsA }));
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { sourceId: saved.sourceId, created: false, readStatus: "da_leggere" });

  const health = await sourcesRoute.POST(postJson(`/api/context/${ids.wsA}/sources`, { title: "Call", occurredOn: "2026-11-14", body: `${NOTE}\nIl direttore ha una visita medica martedì.` }), params({ workspaceId: ids.wsA }));
  assert.equal(health.status, 422);
  const blocked = (await health.json()) as { error: string; fieldErrors: Record<string, string> };
  assert.equal(blocked.error, "dati_non_validi");
  assert.match(blocked.fieldErrors.body, /dati sanitari \(«visita medica»\)/);

  for (const [person, status] of [
    ["rev", 404],
    ["lrn", 404],
    [null, 401],
  ] as const) {
    signIn(person);
    const response = await sourcesRoute.POST(postJson(`/api/context/${ids.wsA}/sources`, { title: "Call", occurredOn: "2026-11-14", body: `${NOTE}\nDa ${person}.` }), params({ workspaceId: ids.wsA }));
    assert.equal(response.status, status, String(person));
  }
  const rows = await q(`SELECT count(*)::int AS n FROM context_sources WHERE workspace_id = $1`, [ids.wsA]);
  assert.equal(rows[0].n, 1, "un solo appunto salvato");
});

// ─── La lettura ──────────────────────────────────────────────────────

let readSourceId = "";

test("POST …/read con il Claude finto: 200 con le proposte, una sola richiesta al modello, senza tool; il cliente 404", opts, async () => {
  signIn("ls");
  readSourceId = await addNote("wsA", NOTE);
  const requests = fakeAppClaude([
    json({
      proposte: [
        modelProposal({ testo: `Il gestionale è SAP Business One ${suffix}.`, citazione: "Il gestionale è SAP Business One da tre anni." }),
        modelProposal({ testo: `Il magazzino cambierà entro l'estate ${suffix}.`, citazione: "Forse cambieranno il magazzino entro l'estate.", base: "dedotto", sezione: "lavoro" }),
      ],
      nonRiportati: { ...NOTHING_SKIPPED, persone: 1 },
    }),
  ]);
  const read = await readNote("wsA", readSourceId);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.outcome, { status: "letto", proposals: 2, skipped: { persone: 1 } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.tools, undefined);
  // Il cliente non legge: 404, e il modello non parte.
  signIn("rev");
  const none = fakeAppClaude([]);
  assert.equal((await readNote("wsA", readSourceId)).status, 404);
  assert.equal(none.length, 0);
});

test("POST …/read: un rifiuto risponde 200 «rifiuto» e niente si propone; senza l'ok «ok_mancante» e nessuna richiesta al modello", opts, async (t) => {
  const lines = recordLogs(t);
  signIn("ls");
  const refused = await addNote("wsA", `${NOTE}\nAppunto che il modello rifiuta.`, "Call rifiutata");
  fakeAppClaude([refusal([], "general_harms")]);
  const read = await readNote("wsA", refused);
  assert.deepEqual([read.status, read.body.outcome], [200, { status: "rifiuto" }]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_proposals WHERE source_id = $1`, [refused]))[0].n, 0);
  assert.ok(lines.some((line) => line.startsWith("[context/read] risposta_rifiutata ")), lines.join("\n"));
  for (const line of lines) assert.doesNotMatch(line, /modello rifiuta|gestionale|SAP|Call/, "nei log nessun testo dell'appunto");

  signIn("lsb");
  const withoutOk = await addNote("wsB", `${NOTE}\nNel workspace senza ok.`);
  const none = fakeAppClaude([]);
  const pending = await readNote("wsB", withoutOk);
  assert.deepEqual([pending.status, pending.body.outcome], [200, { status: "ok_mancante" }]);
  assert.equal(none.length, 0, "senza l'ok il testo non va al modello");
});

// ─── «Da confermare» ─────────────────────────────────────────────────

test("«Conferma (n)» con la selezione della pagina: entra la «detto», la «dedotta» resta da confermare; la pagina si aggiorna e «In breve» si riscrive dopo", opts, async () => {
  signIn("ls");
  const lsActor = { workspaceId: ids.wsA, userId: ids.ls, role: "transformation_lead", isLateralSpace: true, channel: "web" as const };
  const open = await proposals.listOpenProposals(lsActor, { sourceId: readSourceId });
  assert.ok(open);
  const selection = viewModel.initialSelection(open);
  const items = viewModel.selectedItems(open, selection);
  assert.equal(viewModel.confirmCount(open, selection), 1, "solo la «detto» parte spuntata");
  prova.revalidated = [];
  prova.afterTasks = [];
  const result = await actions.confirmProposalsAction(ids.wsA, items);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.ok && result.value.newFacts, 1);
  assert.deepEqual(prova.revalidated, [`/dashboard/${ids.wsA}/contesto|layout`]);
  assert.equal(prova.afterTasks.length, 1);

  const view = await memory.loadContextMemory(lsActor);
  const statements = view.sections.flatMap((s) => s.facts.map((f) => f.statement));
  assert.ok(statements.includes(`Il gestionale è SAP Business One ${suffix}.`));
  assert.equal(statements.some((s) => s.startsWith("Il magazzino cambierà")), false, "la «dedotta» non entra da sola");
  const left = await proposals.listOpenProposals(lsActor, { sourceId: readSourceId });
  assert.deepEqual(left?.proposals.map((p) => p.basis), ["dedotto"]);
  assert.equal(viewModel.afterConfirm({ leftHere: 1, remaining: result.ok ? result.value.remaining : 0, filtered: true }), "resta");

  // «In breve» parte dopo la risposta, con almeno tre fatti «Per tutti».
  for (const statement of [`Producono cucine su misura ${suffix}.`, `Hanno due stabilimenti in Friuli ${suffix}.`]) {
    assert.ok((await actions.writeFactAction(ids.wsA, { statement, section: "azienda", visibility: "tutti" })).ok);
  }
  const brief = fakeAppClaude([json({ righe: ["Produce cucine su misura in due stabilimenti.", "Il gestionale è SAP Business One."] })]);
  await prova.afterTasks[0]();
  assert.equal(brief.length, 1);
  assert.deepEqual((await memory.loadContextMemory(lsActor)).brief?.lines, ["Produce cucine su misura in due stabilimenti.", "Il gestionale è SAP Business One."]);
});

test("le azioni rifiutano chi non è di Lateral Space anche sul database: niente si conferma", opts, async () => {
  signIn("rev");
  const lsActor = { workspaceId: ids.wsA, userId: ids.ls, role: "transformation_lead", isLateralSpace: true, channel: "web" as const };
  const open = await proposals.listOpenProposals(lsActor, { sourceId: readSourceId });
  assert.ok(open && open.proposals.length === 1);
  const item = { id: open.proposals[0].id, version: open.proposals[0].version };
  prova.revalidated = [];
  const result = await actions.confirmProposalsAction(ids.wsA, [item]);
  assert.deepEqual([result.ok, result.ok ? null : result.error], [false, "permesso_mancante"]);
  assert.deepEqual(prova.revalidated, []);
  assert.equal((await proposals.listOpenProposals(lsActor, { sourceId: readSourceId }))?.proposals.length, 1);
});

// ─── Il pannello di un fatto ─────────────────────────────────────────

test("GET …/facts/<id>: Lateral Space vede citazione e chi ha confermato; il cliente il fatto senza; un fatto «Solo Lateral Space» al cliente 404", opts, async () => {
  const [fact] = await q(`SELECT id FROM context_facts WHERE workspace_id = $1 AND statement = $2`, [ids.wsA, `Il gestionale è SAP Business One ${suffix}.`]);
  const factId = String(fact.id);
  const get = (id: string) => factRoute.GET(new Request(`https://unbundle.test/api/context/${ids.wsA}/facts/${id}`), params({ workspaceId: ids.wsA, factId: id }));
  signIn("ls");
  const forLs = (await (await get(factId)).json()) as Record<string, unknown>;
  assert.equal(forLs.quote, "Il gestionale è SAP Business One da tre anni.");
  assert.equal((forLs.confirmedBy as { name: string } | null)?.name, "Persona ls");
  signIn("rev");
  const response = await get(factId);
  assert.equal(response.status, 200);
  const forClient = (await response.json()) as Record<string, unknown>;
  assert.deepEqual([forClient.statement, forClient.quote, forClient.confirmedBy, forClient.source, forClient.history], [`Il gestionale è SAP Business One ${suffix}.`, null, null, null, []]);

  signIn("ls");
  const written = await actions.writeFactAction(ids.wsA, { statement: `Il contratto vale 40.000 euro ${suffix}.`, section: "regole", visibility: "ls" });
  assert.ok(written.ok);
  signIn("rev");
  assert.equal((await get(written.ok ? written.value.factId : "")).status, 404);
});

// ─── «Chiedi al contesto» ────────────────────────────────────────────

test("POST …/ask: la risposta con le fonti; «non lo sappiamo»; oltre il limite 429 con Retry-After, senza modello", opts, async () => {
  signIn("rev");
  const question = `Che gestionale usano ${suffix}?`;
  const requests = fakeAppClaude([json({ saputo: true, risposta: "Usano SAP Business One.", fonti: [1] })]);
  const answered = await ask("wsA", question);
  assert.equal(answered.status, 200);
  assert.equal(answered.body.status, "risposta");
  assert.equal(answered.body.answer, "Usano SAP Business One.");
  assert.ok(Array.isArray(answered.body.sources) && (answered.body.sources as unknown[]).length === 1);
  assert.equal(requests.length, 1);

  fakeAppClaude([json({ saputo: false, risposta: "", fonti: [] })]);
  const unknown = await ask("wsA", question);
  assert.deepEqual([unknown.status, unknown.body.status], [200, "non_so"]);

  const bucket = `ctx:u:${ids.rev}:ask`;
  await q(`DELETE FROM connector_rate_limits WHERE bucket = $1`, [bucket]);
  await q(`INSERT INTO connector_rate_limits (bucket, window_start, count) VALUES ($1, date_trunc('hour', now(), 'UTC'), 30)`, [bucket]);
  const none = fakeAppClaude([]);
  const limited = await ask("wsA", question);
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { error: "limite", message: "Troppe domande in poco tempo. Riprova tra qualche minuto." });
  const retryAfter = Number(limited.headers.get("retry-after"));
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 3600, String(retryAfter));
  assert.equal(none.length, 0);
});

test("POST …/ask senza l'ok ai fornitori: i brani trovati, senza risposta scritta e senza modello", opts, async () => {
  signIn("lsb");
  assert.ok((await actions.writeFactAction(ids.wsB, { statement: `Il magazzino ${suffix} è a Trieste.`, section: "lavoro", visibility: "tutti" })).ok);
  const none = fakeAppClaude([]);
  const result = await ask("wsB", `Dove si trova il magazzino ${suffix}?`);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "solo_ricerca");
  const found = result.body.sources as Array<{ kind: string; excerpt: string }>;
  assert.ok(found.some((s) => s.kind === "fatto" && s.excerpt === `Il magazzino ${suffix} è a Trieste.`), JSON.stringify(found));
  assert.equal(none.length, 0);
});
