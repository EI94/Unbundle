import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../ai/claude-test-kit.ts";

// Le rotte della CLI per il contesto del cliente (rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §2.5, §5.3): `POST nota`,
// `POST impara`, `POST contesto` e lo strato `contesto` di `GET context`. Le rotte, le difese della CLI (`route-kit.ts`),
// il caso e l'idempotenza (`case.ts`) sono quelli veri; il token, il database, il registro dell'idempotenza e le funzioni
// di «Contesto» sono finti (il loro comportamento lo provano i test sul database). Dati inventati: il caso XX-0012.

type Row = Record<string, unknown>;
type Statement = { text: string; params: readonly unknown[] };
type Prova = {
  principal: Row | null;
  access: Row | null;
  /** La persona del token: e-mail e verifica (`@ls.test` è Lateral Space). */
  user: { email: string; email_verified: boolean } | null;
  useCaseRow: Row | null;
  caseAccess: Row | null;
  factory: Row;
  storeReady: boolean;
  workReady: boolean;
  consent: boolean;
  ask: unknown;
  learn: unknown;
  note: unknown;
  read: unknown;
  agent: unknown;
  delta: number;
  names: string[];
  latestPackage: Row | null;
  registry: Map<string, { status: string; hash: string; tool: string; result: Row | null }>;
  released: string[];
  after: Array<() => Promise<void>>;
  calls: Array<[string, unknown[]]>;
  batch(statements: readonly Statement[]): Promise<Row[][]>;
};

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const UC = "33333333-3333-4333-8333-333333333333";
const CASE = "44444444-4444-4444-8444-444444444444";
const TOKEN = "Bearer ubcli_token_di_prova";

const prova: Prova = {
  principal: null,
  access: null,
  user: null,
  useCaseRow: null,
  caseAccess: null,
  factory: {},
  storeReady: true,
  workReady: true,
  consent: true,
  ask: null,
  learn: null,
  note: null,
  read: null,
  agent: null,
  delta: 0,
  names: [],
  latestPackage: null,
  registry: new Map(),
  released: [],
  after: [],
  calls: [],
  async batch(statements) {
    return statements.map((s) => {
      if (s.text.includes("FROM use_cases u")) return prova.useCaseRow ? [prova.useCaseRow] : [];
      if (s.text.includes("FROM users WHERE id")) return prova.user ? [prova.user] : [];
      return [];
    });
  },
};
(globalThis as { __cliRoutes?: Prova }).__cliRoutes = prova;

const P = "globalThis.__cliRoutes";
const record = (name: string, result: string) => `async (...args) => { ${P}.calls.push([${JSON.stringify(name)}, args]); return ${result}; }`;
await installAppModules({
  "next/server": `export function after(task) { ${P}.after.push(task); }`,
  "@/lib/connector/app-deps": `export const appRateLimitExecutor = async () => [];`,
  "@/lib/connector/rate-limit": `export async function consumeRateLimits() { return { ok: true }; }
    export function rateLimitBucket(prefix, ...parts) { return [prefix, ...parts].join(":"); }`,
  "@/lib/db/ensure-schema": `export async function ensureDbSchema() {}`,
  "@/lib/db/uc-executor": `export async function getAppUcExecutor() { return { batch: (statements) => ${P}.batch(statements) }; }`,
  "@/lib/db/queries/use-case-cli-auth": `export async function cliStoreReady() { return true; }
    export async function authenticateCli(executor, authorization) { return authorization === ${JSON.stringify(TOKEN)} ? ${P}.principal : null; }`,
  "@/lib/db/queries/workspace-integrations": `export async function markIntegrationTokenExposed() {}`,
  "@/lib/workspace-access": `export async function getCollaboratorAccess() { return ${P}.access; }`,
  "@/lib/db/queries/uc-access": `export function ucLsDomains() { return ["ls.test"]; }
    export class UcAccessError extends Error { constructor(code, message) { super(message); this.code = code; } }
    export const resolveCaseAccess = ${record("resolveCaseAccess", `${P}.caseAccess`)};`,
  "@/lib/db/queries/use-case-hub": `export function viewerFromSession(user, role) {
    const isLateralSpace = user.emailVerified === true && String(user.email).endsWith("@ls.test");
    return { userId: user.id, email: user.email, emailVerified: user.emailVerified === true, role, isLateralSpace };
  }`,
  "@/lib/use-cases/factory/access": `export async function loadFactoryAccess() { return ${P}.factory; }`,
  "@/lib/db/queries/use-case-factory": `export async function factoryStoreReady() { return true; }
    export const namesToHide = ${record("namesToHide", `${P}.names`)};
    export async function cliCaseExtras() { return { openNeeds: [], proposals: [], repos: [] }; }
    export async function readFactory() { return { ok: true, value: { packages: [], latestPackage: ${P}.latestPackage, open: null, approved: null, decisions: [] } }; }`,
  "@/lib/db/queries/use-case-tasks": `export async function tasksStoreReady() { return false; }
    export async function listTasks() { return []; }`,
  "@/lib/db/queries/team-mcp-requests": `
    export async function readTeamMcpRequest(key) {
      const r = ${P}.registry.get(key.idempotencyKey);
      return r ? { status: r.status, requestHash: r.hash, tool: r.tool, result: r.result, reservedIds: null, attempt: 1, ageSeconds: 0 } : null;
    }
    export async function claimTeamMcpRequest(i) {
      ${P}.registry.set(i.idempotencyKey, { status: "pending", hash: i.requestHash, tool: i.tool, result: null });
      return { status: "claimed", attempt: 1, reservedIds: i.reservedIds, result: null, takeover: false, createdAt: new Date() };
    }
    export async function completeTeamMcpRequest(key, attempt, result) { Object.assign(${P}.registry.get(key.idempotencyKey), { status: "completed", result }); return true; }
    export async function failTeamMcpRequest(key) { ${P}.registry.get(key.idempotencyKey).status = "failed"; return true; }
    export async function releaseTeamMcpRequest(key) { ${P}.registry.delete(key.idempotencyKey); ${P}.released.push(key.idempotencyKey); return true; }`,
  "@/lib/db/queries/context-store": `export async function contextStoreReady() { return ${P}.storeReady; }
    export async function contextWorkReady() { return ${P}.workReady; }`,
  "@/lib/db/queries/context-consent": `export const contextAiConsent = ${record("consent", `${P}.consent`)};`,
  "@/lib/db/queries/context-ask": `export const askContext = ${record("askContext", `${P}.ask`)};`,
  "@/lib/db/queries/context-learning": `export const addLearning = ${record("addLearning", `${P}.learn`)};`,
  "@/lib/db/queries/context-sources": `export const addContextNote = ${record("addContextNote", `${P}.note`)};`,
  "@/lib/db/queries/context-read": `export const readContextSource = ${record("readContextSource", `${P}.read`)};`,
  "@/lib/db/queries/context-work": `export const loadAgentContext = ${record("loadAgentContext", `${P}.agent`)};
    export const contextDeltaSince = ${record("contextDeltaSince", `${P}.delta`)};`,
});

const nota = await import("../../../app/api/cli/nota/route.ts");
const impara = await import("../../../app/api/cli/impara/route.ts");
const contesto = await import("../../../app/api/cli/contesto/route.ts");
const context = await import("../../../app/api/cli/context/route.ts");
const { CLI_NOTE_BODY_BYTES } = await import("./context-commands.ts");

const LS_EMAIL = "lucia@ls.test";
const CLIENT_EMAIL = "olga@cliente.test";

/** Chi chiama: una persona di Lateral Space nel team del caso (ls_lead), con un token di tutti i suoi casi. */
function asLateralSpaceBuilder(): void {
  prova.principal = { tokenId: "token-1", workspaceId: WS, userId: USER, caseUseCaseId: null, expiresAt: null };
  prova.access = { role: "analyst", workspace: { id: WS, name: "Workspace di prova" }, source: "workspace" };
  prova.user = { email: LS_EMAIL, email_verified: true };
  prova.useCaseRow = { id: UC, code: "XX-0012", title: "Smistamento di prova", case_id: CASE, email: LS_EMAIL, email_verified: true };
  prova.caseAccess = { caseId: CASE, workspaceId: WS, code: "CASO-1", title: "Dossier di prova", status: "in_sviluppo", roles: ["ls_lead"], storedRoles: ["ls_lead"], implicitObserver: false, readOnly: false };
  prova.factory = { roles: ["ls_lead"], readOnly: false, external: false, blocked: null };
}

/** Chi chiama: il responsabile del cliente nel caso (owner_cliente): legge il caso, non costruisce, non è di Lateral Space. */
function asClientOwner(): void {
  asLateralSpaceBuilder();
  prova.user = { email: CLIENT_EMAIL, email_verified: true };
  prova.useCaseRow = { ...prova.useCaseRow, email: CLIENT_EMAIL };
  prova.caseAccess = { ...prova.caseAccess, roles: ["owner_cliente"], storedRoles: ["owner_cliente"] };
  prova.factory = { roles: ["owner_cliente"], readOnly: false, external: false, blocked: null };
}

beforeEach(() => {
  asLateralSpaceBuilder();
  Object.assign(prova, {
    storeReady: true,
    workReady: true,
    consent: true,
    ask: { ok: true, value: { status: "niente" } },
    learn: { ok: true, value: { esito: "proposta", proposalId: "proposta-1" } },
    note: { ok: true, value: { sourceId: "fonte-1", created: true, readStatus: "da_leggere" } },
    read: { ok: true, value: { status: "letto", proposals: 2, skipped: {} } },
    agent: null,
    delta: 0,
    names: [],
    latestPackage: null,
    registry: new Map(),
    released: [],
    after: [],
    calls: [],
  });
});

let keys = 0;
function post(path: string, body: unknown, opts: { key?: string | null; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { authorization: TOKEN, "content-type": "application/json", accept: "application/json", "user-agent": "unbundle-cli/1.6.0", ...(opts.headers ?? {}) };
  const key = opts.key === undefined ? `cli-${String(++keys).padStart(40, "0")}` : opts.key;
  if (key !== null) headers["idempotency-key"] = key;
  return new Request(`https://unbundle.test/api/cli/${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}
const get = (query: string) => new Request(`https://unbundle.test/api/cli/context?${query}`, { headers: { authorization: TOKEN, accept: "application/json" } });
const callsOf = (name: string) => prova.calls.filter(([n]) => n === name).map(([, args]) => args);
async function errorOf(response: Response): Promise<{ codice: string; messaggio: string }> {
  return ((await response.json()) as { errore: { codice: string; messaggio: string } }).errore;
}

const NOTE = { titolo: "Call di avvio", data: "2026-11-14", testo: "Il gestionale esporta le fatture solo in CSV, ogni notte.", conChi: "Responsabile amministrativo" };
const LEARN = { caso: "XX-0012", testo: "Il gestionale esporta le fatture solo in CSV, ogni notte.", confermato: true };

test("le rotte: funzioni Node; `contesto` dentro i 60 secondi della CLI, `nota` con il tempo della lettura dopo la risposta", () => {
  assert.deepEqual([contesto.runtime, contesto.maxDuration], ["nodejs", 60]);
  assert.deepEqual([nota.runtime, nota.maxDuration], ["nodejs", 120]);
  assert.equal(impara.runtime, "nodejs");
  assert.equal(context.runtime, "nodejs");
});

// ─── `nota` ──────────────────────────────────────────────────────────

test("nota: chi non è di Lateral Space riceve 403 `solo_lateral_space`, anche con un dominio di Lateral Space non verificato; niente si salva", async () => {
  for (const user of [{ email: CLIENT_EMAIL, email_verified: true }, { email: LS_EMAIL, email_verified: false }, null]) {
    prova.user = user;
    const response = await nota.POST(post("nota", NOTE));
    assert.equal(response.status, 403, JSON.stringify(user));
    assert.deepEqual(await errorOf(response), { codice: "solo_lateral_space", messaggio: "Gli appunti li aggiunge solo Lateral Space." });
  }
  assert.deepEqual(callsOf("addContextNote"), []);
});

test("nota: oltre 600 KB di testo 413 con la frase di §2.5; il limite è sul testo, non sul corpo JSON, che può pesare di più", async () => {
  const max = 600 * 1024;
  // Oltre 600 KB di testo, in un corpo che resta sotto il limite del corpo: 413 dal controllo del testo.
  const over = await nota.POST(post("nota", { ...NOTE, testo: "a".repeat(max + 1) }));
  assert.equal(over.status, 413);
  assert.deepEqual(await errorOf(over), { codice: "troppo_grande", messaggio: "Il file è troppo grande per la CLI, o non è testo: usa «Aggiungi appunti» sul web." });
  assert.deepEqual(callsOf("addContextNote"), []);
  // 600 KB di testo a righe corte: ogni a capo nel JSON pesa due byte, il corpo supera i 700 KB, ma passa.
  const lines = `${"r".repeat(4)}\n`.repeat(max / 5);
  const body = JSON.stringify({ ...NOTE, testo: lines });
  assert.ok(Buffer.byteLength(body) > 700 * 1024 && Buffer.byteLength(body) < CLI_NOTE_BODY_BYTES, String(Buffer.byteLength(body)));
  const ok = await nota.POST(post("nota", body));
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
  assert.equal((callsOf("addContextNote")[0][1] as { body: string }).body.length, max);
  // Un corpo dichiarato oltre il limite del corpo: 413 prima di leggere il token. Le altre rotte restano a 64 KB.
  const declared = await nota.POST(post("nota", NOTE, { headers: { "content-length": String(CLI_NOTE_BODY_BYTES + 1) } }));
  assert.equal(declared.status, 413);
  const small = await impara.POST(post("impara", { ...LEARN, testo: "x".repeat(70 * 1024) }));
  assert.equal(small.status, 413, "64 KB per le altre rotte");
});

test("nota: un PDF non è testo (422, la stessa frase)", async () => {
  const response = await nota.POST(post("nota", { ...NOTE, testo: "%PDF-1.7\n1 0 obj" }));
  assert.equal(response.status, 422);
  assert.deepEqual(await errorOf(response), { codice: "non_testo", messaggio: "Il file è troppo grande per la CLI, o non è testo: usa «Aggiungi appunti» sul web." });
});

test("nota: senza Idempotency-Key 400 `idempotenza` e niente si salva; con la stessa chiave la seconda risponde come la prima, senza salvare né leggere due volte", async () => {
  for (const key of [null, "corta", "con spazi dentro"]) {
    const response = await nota.POST(post("nota", NOTE, { key }));
    assert.equal(response.status, 400, String(key));
    assert.equal((await errorOf(response)).codice, "idempotenza");
  }
  assert.deepEqual(callsOf("addContextNote"), []);
  const key = "cli-0123456789abcdef0123456789abcdef01234567";
  const first = await nota.POST(post("nota", NOTE, { key }));
  assert.equal(first.status, 200);
  const again = await nota.POST(post("nota", NOTE, { key }));
  assert.equal(again.status, 200);
  const repeated = (await again.json()) as Row;
  assert.equal(repeated.ripetuta, true);
  assert.equal(callsOf("addContextNote").length, 1, "salvati una volta sola");
  assert.equal(prova.after.length, 1, "la lettura parte una volta sola");
  // La stessa chiave con un altro corpo: conflitto.
  const other = await nota.POST(post("nota", { ...NOTE, titolo: "Un'altra call" }, { key }));
  assert.equal(other.status, 409);
});

test("nota: salvati con l'origine `cli` per la persona del token; la lettura parte dopo la risposta, con l'ok; il link a «Da confermare»", async () => {
  const response = await nota.POST(post("nota", NOTE));
  assert.equal(response.status, 200);
  const json = (await response.json()) as { testo: string; dati: Row };
  const link = `https://unbundle.test/dashboard/${WS}/contesto/conferma?fonte=fonte-1`;
  assert.equal(json.testo, `Appunti salvati: li leggo adesso. Le proposte arrivano in «Da confermare»: ${link}`);
  assert.deepEqual(json.dati, { fonte: "fonte-1", nuova: true, link });
  const [actor, input] = callsOf("addContextNote")[0] as [Row, Row];
  assert.deepEqual(actor, { workspaceId: WS, userId: USER, role: "analyst", isLateralSpace: true, channel: "cli" });
  assert.deepEqual(input, { title: "Call di avvio", occurredOn: "2026-11-14", body: NOTE.testo, participants: "Responsabile amministrativo", link: null, origin: "cli" });
  // La lettura non è partita prima della risposta: parte dopo, con la persona e la fonte.
  assert.deepEqual(callsOf("readContextSource"), []);
  assert.equal(prova.after.length, 1);
  await prova.after[0]();
  assert.deepEqual(callsOf("readContextSource"), [[actor, "fonte-1"]]);
});

test("nota: senza l'ok ai fornitori di AI niente lettura e la frase dell'ok; gli stessi appunti già salvati «ci sono già»", async () => {
  prova.consent = false;
  const saved = (await (await nota.POST(post("nota", NOTE))).json()) as { testo: string; dati: Row };
  assert.equal(saved.testo, "Appunti salvati. Per leggerli con l'AI serve l'ok del cliente ai fornitori: si registra da Unbundle.");
  assert.equal(prova.after.length, 0);
  prova.consent = true;
  prova.note = { ok: true, value: { sourceId: "fonte-0", created: false, readStatus: "letto" } };
  const duplicate = (await (await nota.POST(post("nota", NOTE))).json()) as { testo: string; dati: Row };
  assert.equal(duplicate.testo, `Questi appunti ci sono già: https://unbundle.test/dashboard/${WS}/contesto?vista=appunti&fonte=fonte-0`);
  assert.equal(duplicate.dati.nuova, false);
  assert.equal(prova.after.length, 0, "appunti già salvati: niente lettura nuova");
});

test("nota: i no di `addContextNote` (dati sanitari, titolo) sono 422 con il messaggio e liberano la chiave; senza la 0041 503", async () => {
  prova.note = { ok: false, error: "dati_non_validi", message: "Controlla i campi indicati.", fieldErrors: { body: "Negli appunti ci sono dati sanitari («diabete»). Toglili e riprova." } };
  const key = "cli-ffffffffffffffffffffffffffffffffffffffff";
  const refused = await nota.POST(post("nota", NOTE, { key }));
  assert.equal(refused.status, 422);
  assert.deepEqual(await errorOf(refused), { codice: "dati_non_validi", messaggio: "Negli appunti ci sono dati sanitari («diabete»). Toglili e riprova." });
  assert.deepEqual(prova.released, [key], "la chiave torna libera");
  prova.workReady = false;
  const off = await nota.POST(post("nota", NOTE));
  assert.equal(off.status, 503);
  assert.deepEqual(await errorOf(off), { codice: "non_disponibile", messaggio: "Unbundle non risponde: riprova tra qualche minuto." });
  assert.equal(off.headers.get("retry-after"), "60");
});

// ─── `impara` ────────────────────────────────────────────────────────

test("impara: senza `confermato: true` 400 `conferma`, prima di ogni altra cosa; una sezione sconosciuta 400 con l'elenco", async () => {
  for (const body of [{ ...LEARN, confermato: undefined }, { ...LEARN, confermato: false }, { ...LEARN, confermato: "true" }]) {
    const response = await impara.POST(post("impara", body));
    assert.equal(response.status, 400);
    assert.deepEqual(await errorOf(response), { codice: "conferma", messaggio: "Serve il sì della persona: chiedilo, poi ripeti con --si." });
  }
  const section = await impara.POST(post("impara", { ...LEARN, sezione: "colori" }));
  assert.equal(section.status, 400);
  assert.deepEqual(await errorOf(section), { codice: "sezione", messaggio: "Sezione sconosciuta: una tra azienda, persone, lavoro, sistemi, obiettivi, regole, parole." });
  assert.deepEqual(callsOf("resolveCaseAccess"), [], "non si apre nemmeno il caso");
  assert.deepEqual(callsOf("addLearning"), []);
});

test("impara: chi nel caso non costruisce riceve 403; nessuna proposta", async () => {
  asClientOwner();
  const response = await impara.POST(post("impara", LEARN));
  assert.equal(response.status, 403);
  assert.deepEqual(await errorOf(response), { codice: "permesso_negato", messaggio: "Nel team del caso non hai un ruolo che costruisce: te lo dà il responsabile del caso." });
  assert.deepEqual(callsOf("addLearning"), []);
});

test("impara: una proposta per chi costruisce, con lo use case, il codice e la sezione; Lateral Space dall'e-mail verificata", async () => {
  const response = await impara.POST(post("impara", { ...LEARN, sezione: "regole" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { testo: "Salvato come proposta: Lateral Space la controlla prima che entri nella memoria del cliente.", dati: { esito: "proposta", proposta: "proposta-1" } });
  const [actor, input] = callsOf("addLearning")[0] as [Row, Row];
  assert.deepEqual(actor, { workspaceId: WS, userId: USER, role: "analyst", isLateralSpace: true, channel: "cli" });
  assert.deepEqual(input, { useCaseId: UC, code: "XX-0012", text: LEARN.testo, section: "regole" });
  // Chi costruisce da fuori: la proposta nasce lo stesso, come persona che non è di Lateral Space.
  prova.user = { email: "esterno@esterno.test", email_verified: true };
  prova.factory = { roles: ["builder_esterno"], readOnly: false, external: true, blocked: null };
  assert.equal((await impara.POST(post("impara", LEARN))).status, 200);
  assert.equal((callsOf("addLearning")[1][0] as Row).isLateralSpace, false);
  assert.equal((callsOf("addLearning")[1][1] as Row).section, undefined, "senza sezione decide addLearning («sistemi»)");
});

test("impara: già in memoria, già proposta; il tetto del giorno 429 `limite` con Retry-After; un nome 422; la chiave si libera", async () => {
  prova.learn = { ok: true, value: { esito: "riconferma", proposalId: "proposta-2" } };
  assert.equal(((await (await impara.POST(post("impara", LEARN))).json()) as { testo: string }).testo, "Lo sappiamo già: ho chiesto di riconfermarlo.");
  prova.learn = { ok: true, value: { esito: "gia_proposta" } };
  assert.deepEqual(await (await impara.POST(post("impara", LEARN))).json(), { testo: "È già tra le proposte da confermare.", dati: { esito: "gia_proposta", proposta: null } });
  prova.learn = { ok: true, value: { esito: "limite", retryAfterSeconds: 4000 } };
  const key = "cli-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const limit = await impara.POST(post("impara", LEARN, { key }));
  assert.equal(limit.status, 429);
  assert.equal(limit.headers.get("retry-after"), "4000");
  assert.deepEqual(await errorOf(limit), { codice: "limite", messaggio: "Per oggi le cose imparate sono tante: riprova domani o scrivile sul web." });
  assert.ok(prova.released.includes(key), "domani la stessa frase con la stessa chiave riparte");
  prova.learn = { ok: false, error: "dati_non_validi", message: "Non scrivere nomi di persone: indica il ruolo.", fieldErrors: { testo: "Non scrivere nomi di persone: indica il ruolo." } };
  const named = await impara.POST(post("impara", LEARN));
  assert.equal(named.status, 422);
  assert.equal((await errorOf(named)).messaggio, "Non scrivere nomi di persone: indica il ruolo.");
  prova.workReady = false;
  assert.equal((await impara.POST(post("impara", LEARN))).status, 503);
});

// ─── `contesto` ──────────────────────────────────────────────────────

test("contesto: troppe domande 429 `limite` con il messaggio e Retry-After; la CLI non riprova", async () => {
  prova.ask = { ok: true, value: { status: "limite", retryAfterSeconds: 125 } };
  const response = await contesto.POST(post("contesto", { caso: "XX-0012", domanda: "Che gestionale usano?" }, { key: null }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "125");
  assert.deepEqual(await errorOf(response), { codice: "limite", messaggio: "Troppe domande in poco tempo: riprova tra qualche minuto." });
});

test("contesto: la domanda sempre come chi non è di Lateral Space (D1), anche quando chiede Lateral Space; dentro i tempi della CLI", async () => {
  prova.ask = { ok: true, value: { status: "risposta", answer: "Usano SAP Business One [1].", sources: [{ n: 1, kind: "fatto", label: "Call 14 nov", date: "2026-11-15", excerpt: "Il gestionale è SAP Business One." }] } };
  const response = await contesto.POST(post("contesto", { caso: "XX-0012", domanda: "Che gestionale usano?" }, { key: null }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    testo: "Risposta:\nUsano SAP Business One [1].\nFonti:\n[1] Fatto · Call 14 nov · Il gestionale è SAP Business One.",
    dati: { stato: "risposta", risposta: "Usano SAP Business One [1].", fonti: [{ n: 1, tipo: "fatto", etichetta: "Call 14 nov", data: "2026-11-15", brano: "Il gestionale è SAP Business One." }] },
  });
  const [actor, question, opts] = callsOf("askContext")[0] as [Row, string, { timeoutMs: number }];
  assert.deepEqual(actor, { workspaceId: WS, userId: USER, role: "contributor", isLateralSpace: false, channel: "cli" });
  assert.equal(question, "Che gestionale usano?");
  assert.ok(opts.timeoutMs > 0 && opts.timeoutMs <= 40_000, String(opts.timeoutMs));
});

test("contesto: i nomi che Unbundle conosce diventano «una persona»; senza l'ok i brani; chi non legge il caso non chiede", async () => {
  prova.names = ["Mario Rossi"];
  prova.ask = { ok: true, value: { status: "solo_ricerca", sources: [{ n: 1, kind: "documento", label: "Verbale di Rossi", date: "2026-11-10", excerpt: "Le fatture le controlla Mario Rossi." }] } };
  const json = (await (await contesto.POST(post("contesto", { caso: "XX-0012", domanda: "Chi controlla le fatture?" }, { key: null }))).json()) as { testo: string };
  assert.equal(json.testo, "Per una risposta scritta serve l'ok del cliente ai fornitori di AI. Ecco che cosa ho trovato:\n[1] Documento · Verbale di una persona del 10/11/2026 · Le fatture le controlla una persona.");
  prova.caseAccess = null;
  const outside = await contesto.POST(post("contesto", { caso: "XX-0012", domanda: "Chi controlla le fatture?" }, { key: null }));
  assert.equal(outside.status, 404);
  assert.equal(callsOf("askContext").length, 1);
  asLateralSpaceBuilder();
  prova.storeReady = false;
  assert.equal((await contesto.POST(post("contesto", { caso: "XX-0012", domanda: "Chi controlla le fatture?" }, { key: null }))).status, 503);
  prova.storeReady = true;
  prova.ask = { ok: false, error: "riprova", message: "Non è riuscito. Riprova tra poco." };
  const failed = await contesto.POST(post("contesto", { caso: "XX-0012", domanda: "Chi controlla le fatture?" }, { key: null }));
  assert.equal(failed.status, 503);
  assert.equal((await errorOf(failed)).messaggio, "Non riesco a rispondere adesso. Riprova tra poco.");
});

// ─── `context?strato=contesto` ───────────────────────────────────────

const AGENT = {
  brief: ["Azienda di arredamento con due stabilimenti."],
  caseFacts: [{ statement: "Le quotazioni le firma Mario Rossi.", section: "lavoro", source: "call", on: "2026-11-14" }],
  rules: [],
  words: [],
  commitments: [{ statement: "Inviare l'esportazione delle fatture", party: "cliente", role: "Responsabile amministrativo", dueOn: "2026-11-25" }],
  questions: [],
  since: null,
};

test("context: lo strato `contesto` da loadAgentContext, con i nomi coperti, anche in `dati.contesto`; uno strato sconosciuto lo elenca", async () => {
  prova.names = ["Mario Rossi"];
  prova.agent = AGENT;
  const response = await context.GET(get("caso=XX-0012&strato=contesto&dal=2026-11-01"));
  assert.equal(response.status, 200);
  const json = (await response.json()) as { testo: string; dati: { contesto: { caseFacts: Array<{ statement: string }> } } };
  assert.match(json.testo, /^Contesto del cliente per XX-0012\n\nIn breve\n/);
  assert.match(json.testo, /\n- Le quotazioni le firma una persona\. \(call del 14\/11\/2026\)\n/);
  assert.match(json.testo, /\n- Inviare l'esportazione delle fatture · del cliente · Responsabile amministrativo · entro il 25\/11\/2026\n/);
  assert.equal(json.dati.contesto.caseFacts[0].statement, "Le quotazioni le firma una persona.");
  assert.doesNotMatch(JSON.stringify(json), /Mario|Rossi/);
  const [loaded] = callsOf("loadAgentContext")[0] as [Row];
  assert.deepEqual(Object.keys(loaded).sort(), ["since", "useCaseId", "workspaceId"], "niente su chi chiede: sempre «Per tutti»");
  assert.deepEqual([loaded.workspaceId, loaded.useCaseId, (loaded.since as Date).toISOString()], [WS, UC, "2026-11-01T00:00:00.000Z"]);
  const unknown = await context.GET(get("caso=XX-0012&strato=tutto"));
  assert.equal(unknown.status, 400);
  assert.deepEqual(await errorOf(unknown), { codice: "strato", messaggio: "Strato sconosciuto: uno tra progetto, decisioni, pacchetto, domande, contesto." });
});

test("context: lo strato `contesto` con l'archivio che non risponde è 503 da riprovare, non «caso non trovato»", async () => {
  prova.agent = null;
  const response = await context.GET(get("caso=XX-0012&strato=contesto"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.deepEqual(await errorOf(response), { codice: "non_disponibile", messaggio: "Unbundle non risponde: riprova tra qualche minuto." });
});

test("context: il brief ha la riga del contesto; le novità contano dall'ultimo pacchetto solo se ha CONTESTO.md", async () => {
  prova.delta = 3;
  prova.latestPackage = { version: 2, createdAt: "2026-11-10T09:00:00.000Z", source: "generato", files: { "PACCHETTO.md": "#", "BRIEF.md": "#", VERSIONE: "k2", "CONTESTO.md": "#" } };
  const brief = (await (await context.GET(get("caso=XX-0012"))).json()) as { testo: string; dati: Row };
  assert.match(brief.testo, /\nPacchetto: k2 del 10\/11\/2026 \(«unbundle start» lo porta nel repository\)\.\nContesto: 3 novità dopo il pacchetto k2 \(unbundle context XX-0012 --contesto\)\.\n/);
  assert.equal("contesto" in brief.dati, false);
  assert.equal(((callsOf("contextDeltaSince")[0][0] as Row).since as Date).toISOString(), "2026-11-10T09:00:00.000Z");
  // Un pacchetto senza CONTESTO.md: contano tutti i fatti (`since` nullo).
  prova.latestPackage = { ...prova.latestPackage, files: { "PACCHETTO.md": "#", "BRIEF.md": "#", VERSIONE: "k2" } };
  await context.GET(get("caso=XX-0012"));
  assert.equal((callsOf("contextDeltaSince")[1][0] as Row).since, null);
  // Gli altri strati non leggono il contesto.
  await context.GET(get("caso=XX-0012&strato=decisioni"));
  assert.equal(callsOf("contextDeltaSince").length, 2);
  assert.equal(callsOf("loadAgentContext").length, 0);
});
