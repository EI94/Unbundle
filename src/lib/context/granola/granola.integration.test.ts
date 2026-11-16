import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { installAppModules } from "../../ai/claude-test-kit.ts";
import { CONTEXT_TEXT } from "../text.ts";
import { forgetGranolaDiscovery } from "./endpoints.ts";
import { FAKE_READ_TOOLS, startFakeGranola, type FakeGranola, type FakeMeeting } from "./fake-granola.ts";
import { openGranolaTokens } from "./token-crypto.ts";

// Granola sul database del pacchetto e con il Granola finto su 127.0.0.1 (RILASCIO-9a-COSTRUZIONE.md §8, §11.5):
// collegare (lo stato, i token cifrati), rinnovare, il giro (che cosa entra, che cosa non si salva), «Da smistare»,
// «Assegna», «Lascia fuori», le regole, una call cambiata, il controllo dei testi, «Togli», i limiti di Granola, il
// giro della notte, scollegare. Nessuna richiesta esce da 127.0.0.1; nessun modello: il giro non legge con l'AI.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Dati sintetici,
// creati e cancellati qui.
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
let granola: typeof import("../../db/queries/context-granola.ts");
let sources: typeof import("../../db/queries/context-sources.ts");
let callbackRoute: typeof import("../../../app/api/granola/callback/route.ts");
let metadataRoute: typeof import("../../../app/api/granola/client-metadata/route.ts");

const KEY = randomBytes(32).toString("base64");
const ORIGIN = "https://unbundle.test";
const suffix = randomBytes(3).toString("hex");
const people = ["ls", "ls2", "cli", "top", "out", "ext", "own"] as const;
type Person = (typeof people)[number];
const ids = {
  orgN: randomUUID(),
  orgT: randomUUID(),
  wsN: randomUUID(),
  wsT: randomUUID(),
  ...(Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>),
};
const EMAIL: Record<Person, string> = {
  ls: `paola-${suffix}@ls.test`,
  ls2: `marco-${suffix}@ls.test`,
  cli: `giulia-${suffix}@nardi.test`,
  top: `luca-${suffix}@topjet.test`,
  out: `anna-${suffix}@altrove.test`,
  // Chi costruisce da fuori, con una casella pubblica; una persona del cliente che non è un contatto.
  ext: `alessio-${suffix}@gmail.com`,
  own: `marta-${suffix}@nardi.test`,
};
type Actor = import("../visibility.ts").ContextActor;
const actor = (person: Person, workspace: "wsN" | "wsT" = "wsN", role = "transformation_lead"): Actor => ({
  workspaceId: ids[workspace],
  userId: ids[person],
  role,
  isLateralSpace: EMAIL[person].endsWith("@ls.test"),
  channel: "web",
});
function signIn(person: Person | null) {
  (globalThis as { __granolaSession?: unknown }).__granolaSession = person ? { user: { id: ids[person], name: `Persona ${person}`, email: EMAIL[person], image: null, emailVerified: true } } : null;
}

let fake: FakeGranola;
/** Ogni richiesta che il codice fa con la fetch, tranne quelle al database (le prende il trasporto locale). */
const hosts: string[] = [];
const slept: number[] = [];
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const MEETINGS: Record<string, FakeMeeting> = {
  nardi: {
    id: `m-nardi-${suffix}`,
    title: "Allineamento ordini",
    meetingAt: ago(60 * 24),
    updatedAt: ago(60 * 23),
    url: "https://note.esempio.test/d/nardi",
    participants: `Paola Verdi (note creator) from Lateral Space (${EMAIL.ls}), Giulia Bianchi from Nardi (${EMAIL.cli})`,
    summary: "Il gestionale è SAP Business One. Gli ordini arrivano via e-mail.",
    privateNotes: "Richiamare l'ufficio acquisti.",
  },
  both: {
    id: `m-both-${suffix}`,
    title: `Nardi e TopJet a confronto ${suffix}`,
    meetingAt: ago(60 * 48),
    updatedAt: ago(60 * 47),
    participants: `Paola Verdi (note creator) from Lateral Space (${EMAIL.ls}), Giulia Bianchi from Nardi (${EMAIL.cli}), ${EMAIL.out}`,
    summary: "Confronto tra due clienti.",
  },
  none: { id: `m-none-${suffix}`, title: `Riunione interna ${suffix}`, meetingAt: ago(60 * 50), updatedAt: ago(60 * 49), participants: `Paola (${EMAIL.ls})`, summary: "Organizzazione del lavoro interno." },
  word: { id: `m-word-${suffix}`, title: `Revisione Ferrari ${suffix}`, meetingAt: ago(60 * 72), updatedAt: ago(60 * 71), participants: `Paola (${EMAIL.ls})`, summary: "Revisione del progetto con il cliente." },
  health: {
    id: `m-health-${suffix}`,
    title: "Stato avanzamento TopJet",
    meetingAt: ago(60 * 30),
    updatedAt: ago(60 * 29),
    participants: `Luca Neri (${EMAIL.top})`,
    summary: "Il responsabile è assente per una visita medica fino a lunedì.",
  },
  folder: {
    id: `m-folder-${suffix}`,
    title: "Manutenzione, nella cartella di TopJet",
    meetingAt: ago(60 * 26),
    updatedAt: ago(60 * 25),
    participants: `Paola (${EMAIL.ls})`,
    summary: "Questa call sta nella cartella di TopJet.",
    folderIds: ["f-topjet"],
    transcript: `Parla il responsabile della manutenzione. ${"Una frase della trascrizione. ".repeat(40)}`,
  },
};

before(async () => {
  if (!enabled) return;
  Object.assign(process.env, { UC_LS_EMAIL_DOMAINS: "ls.test", CONTEXT_TOKEN_KEY: KEY, NEXT_PUBLIC_APP_URL: ORIGIN });
  delete process.env.VERCEL_ENV;
  delete process.env.CONTEXT_GRANOLA;
  delete process.env.CONTEXT_GRANOLA_CLIENT;
  await installAppModules({ "@/lib/auth": `export const auth = async () => globalThis.__granolaSession ?? null;` });
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  await (await import("../../db/ensure-schema.ts")).ensureDbSchema();
  granola = await import("../../db/queries/context-granola.ts");
  sources = await import("../../db/queries/context-sources.ts");
  callbackRoute = await import("../../../app/api/granola/callback/route.ts");
  metadataRoute = await import("../../../app/api/granola/client-metadata/route.ts");

  fake = await startFakeGranola({ meetings: Object.values(MEETINGS), folders: [{ id: "f-topjet", name: "TopJet" }, { id: "f-nardi", name: "Nardi" }] });
  fake.account = { email: `paola-granola-${suffix}@ls.test`, plan: "Business" };
  // La fetch dell'app: solo 127.0.0.1. Le richieste al database le serve prima il trasporto locale.
  globalThis.fetch = ((original) => (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    hosts.push(target.hostname);
    if (target.hostname !== "127.0.0.1") return Promise.reject(new Error(`richiesta fuori da 127.0.0.1: ${target.hostname}`));
    return original(input, init);
  })(globalThis.fetch);
  granola.setGranolaRuntimeForTests({
    fetch: (input, init) => globalThis.fetch(input, init),
    base: fake.endpoints,
    sleep: async (ms) => {
      slept.push(ms);
      await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 300)));
    },
  });

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Nardi di prova', $2), ($3, 'TopJet di prova', $4)`, [ids.orgN, `org-gr-n-${suffix}`, ids.orgT, `org-gr-t-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Nardi Motorsport'), ($3, $4, 'TopJet Rosa')`, [ids.wsN, ids.orgN, ids.wsT, ids.orgT]);
  for (const person of people) await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], `Persona ${person}`]);
  const member = (ws: string, person: Person, role: string) => q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ws, ids[person], role]);
  await member(ids.wsN, "ls", "transformation_lead");
  await member(ids.wsT, "ls", "transformation_lead");
  await member(ids.wsN, "ls2", "analyst");
  await member(ids.wsN, "cli", "contributor");
  await member(ids.wsT, "top", "contributor");
  await member(ids.wsN, "ext", "transformation_lead");
  await member(ids.wsN, "own", "analyst");
  // Le persone del cliente che Unbundle conosce: i contatti e i referenti. Un contatto con una casella pubblica non conta.
  const contact = (ws: string, name: string, email: string) => q(`INSERT INTO uc_contacts (workspace_id, display_name, email) VALUES ($1::uuid, $2, $3)`, [ws, name, email]);
  await contact(ids.wsN, "Giulia Bianchi", EMAIL.cli);
  await contact(ids.wsN, "Mario Verdi", `mario-${suffix}@gmail.com`);
  await contact(ids.wsT, "Luca Neri", EMAIL.top);
});

after(async () => {
  if (!enabled) return;
  granola.setGranolaRuntimeForTests(null);
  await fake.close();
  await q(`DELETE FROM context_granola_clients WHERE issuer = $1`, [fake.url]);
  await q(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[ids.orgN, ids.orgT]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [people.map((p) => ids[p])]);
  // Nessuna richiesta è uscita da 127.0.0.1, e il Granola finto ha ricevuto solo strumenti di lettura.
  assert.ok(hosts.length > 0);
  assert.deepEqual([...new Set(hosts)], ["127.0.0.1"]);
  assert.ok(fake.toolCalls.length > 0);
  assert.ok(fake.toolCalls.every((call) => (FAKE_READ_TOOLS as readonly string[]).includes(call.tool)), [...new Set(fake.toolCalls.map((c) => c.tool))].join(", "));
});

// ─── Aiuti ───────────────────────────────────────────────────────────

type Ok<T> = { ok: true; value: T };
function value<T>(result: Ok<T> | { ok: false; error: string; message: string }): T {
  assert.ok(result.ok, result.ok ? "" : `${result.error}: ${result.message}`);
  return (result as Ok<T>).value;
}

/** «Collega Granola», il sì su Granola, e il ritorno: la risposta della rotta di ritorno. */
async function connect(person: Person = "ls", workspace: "wsN" | "wsT" = "wsN"): Promise<Response> {
  signIn(person);
  const start = value(await granola.startGranolaConnect(actor(person, workspace)));
  const back = await fake.consent(start.url);
  return callbackRoute.GET(new Request(back.toString()));
}

const location = (response: Response) => new URL(response.headers.get("location") ?? "", ORIGIN);
/** Un istante letto dal database (una Date, o un testo) come ISO; null resta null. */
const iso = (value: unknown) => (value === null || value === undefined ? null : (value instanceof Date ? value : new Date(String(value))).toISOString());
const connection = async (person: Person = "ls") => (await q(`SELECT * FROM context_granola_connections WHERE user_id = $1`, [ids[person]]))[0];
const decisionOf = async (meetingId: string, person: Person = "ls") => (await q(`SELECT * FROM context_granola_meetings WHERE user_id = $1 AND meeting_id = $2`, [ids[person], meetingId]))[0];
const sourceOf = async (meetingId: string) => (await q(`SELECT * FROM context_sources WHERE origin = 'granola' AND external_id = $1`, [meetingId]))[0];

// ─── Collegare ───────────────────────────────────────────────────────

test("il documento del cliente: client_id uguale al suo indirizzo, sull'origine pubblica; spento → 404", opts, async () => {
  const response = await metadataRoute.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.client_id, `${ORIGIN}/api/granola/client-metadata`);
  assert.deepEqual(body.redirect_uris, [`${ORIGIN}/api/granola/callback`]);
  assert.equal(body.token_endpoint_auth_method, "none");
  process.env.CONTEXT_GRANOLA = "off";
  try {
    assert.equal((await metadataRoute.GET()).status, 404);
    assert.equal(granola.granolaAvailable(), false);
    assert.equal((await granola.startGranolaConnect(actor("ls"))).ok, false);
  } finally {
    delete process.env.CONTEXT_GRANOLA;
  }
});

test("solo Lateral Space collega; il cliente e chi non ha il ruolo no", opts, async () => {
  for (const who of [actor("cli", "wsN", "contributor"), actor("top", "wsT", "contributor"), actor("ls", "wsN", "learner")]) {
    const result = await granola.startGranolaConnect(who);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error, "permesso_mancante");
  }
  assert.equal(await q(`SELECT 1 FROM context_granola_oauth_states WHERE user_id = ANY($1::uuid[])`, [[ids.cli, ids.top]]).then((r) => r.length), 0);
});

test("collegare: lo stato vale una volta e solo per chi l'ha creato, scade a 10 minuti; nessun token in chiaro", opts, async () => {
  signIn("ls");
  const start = value(await granola.startGranolaConnect(actor("ls")));
  const authorize = new URL(start.url);
  assert.equal(authorize.origin, fake.url);
  assert.equal(authorize.searchParams.get("client_id"), `${ORIGIN}/api/granola/client-metadata`);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("resource"), fake.endpoints.resource);
  const [state] = await q(`SELECT *, extract(epoch FROM expires_at - created_at)::int AS seconds FROM context_granola_oauth_states WHERE user_id = $1`, [ids.ls]);
  assert.equal(state.seconds, 600, "dieci minuti");
  assert.notEqual(state.state_hash, authorize.searchParams.get("state"), "lo stato in chiaro non si salva");
  assert.equal(String(state.verifier_sealed).length > 40, true);
  const back = await fake.consent(start.url);

  // Un'altra persona con lo stesso ritorno: niente, e lo stato resta valido per chi l'ha creato.
  signIn("ls2");
  const stolen = await callbackRoute.GET(new Request(back.toString()));
  assert.equal(stolen.status, 303);
  assert.equal(location(stolen).pathname + location(stolen).search, "/dashboard?granola=scaduto");
  assert.equal(await connection("ls2"), undefined);

  signIn("ls");
  const done = await callbackRoute.GET(new Request(back.toString()));
  assert.equal(done.status, 303);
  assert.equal(done.headers.get("cache-control"), "no-store");
  assert.equal(location(done).href, `${ORIGIN}/dashboard/${ids.wsN}/settings?granola=collegato#granola`);
  // Lo stesso ritorno una seconda volta: lo stato è già usato. Si torna alle Impostazioni del workspace dell'ultimo
  // collegamento, dove la riga dice che è scaduto.
  assert.equal(location(await callbackRoute.GET(new Request(back.toString()))).href, `${ORIGIN}/dashboard/${ids.wsN}/settings?granola=scaduto#granola`);

  const row = await connection("ls");
  assert.equal(row.status, "attiva");
  assert.equal(row.account_email, `paola-granola-${suffix}@ls.test`);
  assert.equal(row.plan, "Business");
  assert.equal(row.client_id, `${ORIGIN}/api/granola/client-metadata`);
  // Nel database nessun token in chiaro: né nel collegamento né negli stati.
  const dump = JSON.stringify(await q(`SELECT row_to_json(c)::text AS r FROM context_granola_connections c UNION ALL SELECT row_to_json(s)::text FROM context_granola_oauth_states s`));
  assert.ok(fake.issued.length > 0);
  for (const issued of fake.issued) {
    assert.equal(dump.includes(issued.accessToken), false);
    assert.equal(dump.includes(issued.refreshToken), false);
  }
  const opened = openGranolaTokens(KEY, ids.ls, String(row.tokens_sealed));
  assert.ok(opened.ok);
  assert.equal(opened.value.accessToken, fake.issued.at(-1)?.accessToken);
  assert.equal(openGranolaTokens(KEY, ids.ls2, String(row.tokens_sealed)).ok, false, "la busta è della persona");

  // Uno stato scaduto non vale più.
  const late = value(await granola.startGranolaConnect(actor("ls")));
  const lateBack = await fake.consent(late.url);
  await q(`UPDATE context_granola_oauth_states SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND used_at IS NULL`, [ids.ls]);
  assert.equal(location(await callbackRoute.GET(new Request(lateBack.toString()))).href, `${ORIGIN}/dashboard/${ids.wsN}/settings?granola=scaduto#granola`);
  // Uno stato che Unbundle non conosce, da chi un collegamento l'ha cominciato: lo stesso.
  const unknown = new URL(lateBack.toString());
  unknown.searchParams.set("state", randomBytes(32).toString("hex"));
  assert.equal(location(await callbackRoute.GET(new Request(unknown.toString()))).href, `${ORIGIN}/dashboard/${ids.wsN}/settings?granola=scaduto#granola`);
  // Senza sessione: al login, e lo stato non si tocca.
  signIn(null);
  const anonymous = await callbackRoute.GET(new Request(lateBack.toString(), { headers: { cookie: "__session=vecchio" } }));
  assert.equal(location(anonymous).pathname, "/login");
  assert.equal(location(anonymous).searchParams.get("session"), "stale");
  assert.equal(location(anonymous).searchParams.has("code"), false);
});

test("il ritorno con un rifiuto su Granola → annullato; un codice sbagliato → errore; il collegamento di prima resta", opts, async () => {
  signIn("ls");
  fake.denyConsent = true;
  try {
    const denied = await connect("ls", "wsT");
    assert.equal(location(denied).href, `${ORIGIN}/dashboard/${ids.wsT}/settings?granola=annullato#granola`);
  } finally {
    fake.denyConsent = false;
  }
  const start = value(await granola.startGranolaConnect(actor("ls")));
  const back = await fake.consent(start.url);
  back.searchParams.set("code", "codice-inventato");
  const wrong = await callbackRoute.GET(new Request(back.toString()));
  assert.equal(location(wrong).search, "?granola=errore");
  assert.equal((await connection("ls")).status, "attiva");
  // Un guasto dopo aver preso lo stato (qui token così lunghi che la colonna non li tiene): di nuovo alle Impostazioni, con «errore».
  const before = String((await connection("ls")).tokens_sealed);
  fake.tokenPadding = 7_900;
  try {
    const broken = await connect("ls", "wsT");
    assert.equal(location(broken).href, `${ORIGIN}/dashboard/${ids.wsT}/settings?granola=errore#granola`);
  } finally {
    fake.tokenPadding = 0;
  }
  assert.equal(String((await connection("ls")).tokens_sealed), before, "il collegamento di prima non cambia");
});

test("chi smette di essere di Lateral Space tra «Collega Granola» e il ritorno: errore, e nessun collegamento", opts, async () => {
  signIn("ls2");
  const start = value(await granola.startGranolaConnect(actor("ls2")));
  const back = await fake.consent(start.url);
  // Nel frattempo l'e-mail della persona non è più di Lateral Space (il ritorno rilegge la persona dal database).
  await q(`UPDATE users SET email = $2 WHERE id = $1`, [ids.ls2, `marco-${suffix}@altrove.test`]);
  try {
    const issuedBefore = fake.issued.length;
    const response = await callbackRoute.GET(new Request(back.toString()));
    assert.equal(location(response).href, `${ORIGIN}/dashboard/${ids.wsN}/settings?granola=errore#granola`);
    assert.equal(await connection("ls2"), undefined, "nessun collegamento");
    assert.equal(fake.issued.length, issuedBefore, "il codice non si cambia in token");
  } finally {
    await q(`UPDATE users SET email = $2 WHERE id = $1`, [ids.ls2, EMAIL.ls2]);
    signIn(null);
  }
});

test("lo stato di Granola per la pagina e per Impostazioni", opts, async () => {
  const status = await granola.loadGranolaStatus({ userId: ids.ls, workspaceId: ids.wsN });
  assert.deepEqual(
    { ...status, lastSyncAt: null },
    { available: true, connected: true, status: "attiva", accountEmail: `paola-granola-${suffix}@ls.test`, plan: "Business", lastSyncAt: null, stale: true, unsortedCount: 0, blockedCount: 0 },
  );
  assert.deepEqual(await granola.loadGranolaStatus({ userId: ids.cli, workspaceId: ids.wsN }), { ...status, connected: false, status: null, accountEmail: null, plan: null, stale: false, available: true });
  assert.equal((await granola.loadGranolaStatus({ userId: "non-un-id", workspaceId: ids.wsN })).available, false);
});

// ─── Rinnovare ───────────────────────────────────────────────────────

test("il rinnovo cambia il refresh_token; due rinnovi insieme ne fanno uno", opts, async () => {
  const before = openGranolaTokens(KEY, ids.ls, String((await connection("ls")).tokens_sealed));
  assert.ok(before.ok);
  await q(`UPDATE context_granola_connections SET access_expires_at = now() + interval '30 seconds' WHERE user_id = $1`, [ids.ls]);
  const refreshesBefore = fake.tokenRequests.filter((r) => r.grantType === "refresh_token").length;
  assert.deepEqual(value(await granola.listGranolaFolders(actor("ls"))), [
    { id: "f-topjet", name: "TopJet" },
    { id: "f-nardi", name: "Nardi" },
  ]);
  const after = openGranolaTokens(KEY, ids.ls, String((await connection("ls")).tokens_sealed));
  assert.ok(after.ok);
  assert.notEqual(after.value.refreshToken, before.value.refreshToken, "il refresh_token cambia");
  assert.notEqual(after.value.accessToken, before.value.accessToken);
  assert.equal(fake.isLive(before.value.refreshToken ?? ""), false);
  assert.equal(fake.tokenRequests.filter((r) => r.grantType === "refresh_token").length, refreshesBefore + 1);
  assert.equal((await connection("ls")).refreshing_until, null, "il turno è libero");

  // Due richieste insieme con il token in scadenza: un rinnovo solo, l'altra aspetta e rilegge.
  await q(`UPDATE context_granola_connections SET access_expires_at = now() - interval '1 minute' WHERE user_id = $1`, [ids.ls]);
  fake.tokenDelayMs = 150;
  try {
    const [one, two] = await Promise.all([granola.listGranolaFolders(actor("ls")), granola.listGranolaFolders(actor("ls"))]);
    assert.ok(one.ok && two.ok);
  } finally {
    fake.tokenDelayMs = 0;
  }
  assert.equal(fake.tokenRequests.filter((r) => r.grantType === "refresh_token").length, refreshesBefore + 2);
  assert.ok(slept.includes(1_500), "chi non ha il turno aspetta 1,5 secondi e rilegge");
});

test("un 401 dell'MCP: un rinnovo e di nuovo la chiamata; invalid_grant → da ricollegare, e si ricollega", opts, async () => {
  fake.expireAccessTokens();
  assert.ok((await granola.listGranolaFolders(actor("ls"))).ok, "il token rifiutato si rinnova da solo");

  await q(`UPDATE context_granola_connections SET access_expires_at = now() - interval '1 minute' WHERE user_id = $1`, [ids.ls]);
  fake.invalidGrant = true;
  try {
    const result = await granola.listGranolaFolders(actor("ls"));
    assert.deepEqual(result, { ok: false, error: "riprova", message: "Il collegamento è scaduto." });
  } finally {
    fake.invalidGrant = false;
  }
  const row = await connection("ls");
  assert.equal(row.status, "da_ricollegare");
  assert.equal(row.last_error, "token_scaduto");
  const status = await granola.loadGranolaStatus({ userId: ids.ls, workspaceId: ids.wsN });
  assert.equal(status.status, "da_ricollegare");
  assert.equal(status.stale, false, "da ricollegare non fa partire il giro");
  assert.equal((await granola.syncGranolaForUser(ids.ls, { force: true })).status, "da_ricollegare");
  // «Ricollega»: di nuovo attiva.
  assert.equal(location(await connect("ls")).search, "?granola=collegato");
  assert.equal((await connection("ls")).status, "attiva");
});

// ─── Il giro ─────────────────────────────────────────────────────────

test("il giro: una call di un solo cliente entra da leggere; quelle di due clienti o di nessuno non lasciano niente", opts, async () => {
  // La cartella di TopJet per questo workspace: la cartella vince sul titolo.
  value(await granola.saveGranolaRules(actor("ls", "wsT"), { folderId: "f-topjet", folderName: "TopJet", emails: [], domains: [], titleWords: ["TopJet"], wantTranscript: false }));
  const calls = fake.toolCalls.length;
  const result = await granola.syncGranolaForUser(ids.ls, { force: true });
  assert.equal(result.status, "fatto");
  assert.deepEqual({ ...result, status: undefined }, { status: undefined, imported: 2, updated: 0, blocked: 1, unsorted: 3 });

  // Nardi per i partecipanti, la call della cartella in TopJet.
  const nardi = await sourceOf(MEETINGS.nardi.id);
  assert.equal(nardi.workspace_id, ids.wsN);
  assert.deepEqual([nardi.read_status, nardi.kind, nardi.visibility, nardi.added_by_user_id], ["da_leggere", "appunti", "ls", ids.ls]);
  assert.match(String(nardi.body), /^\[Riassunto di Granola\]\nIl gestionale è SAP Business One\. Gli ordini arrivano via e-mail\.\n\n\[Note di chi ha registrato\]\nRichiamare l'ufficio acquisti\.$/);
  assert.equal(nardi.link, "https://note.esempio.test/d/nardi");
  assert.equal(nardi.title, "Allineamento ordini");
  assert.match(String(nardi.participants), /Giulia Bianchi/);
  assert.equal((await sourceOf(MEETINGS.folder.id)).workspace_id, ids.wsT);
  const event = await q(`SELECT channel, detail FROM context_events WHERE source_id = $1`, [nardi.id]);
  assert.deepEqual(event.map((e) => e.channel), ["granola"]);
  assert.equal(JSON.stringify(event).includes("SAP"), false, "nella storia nessun testo");

  // Le call senza un solo cliente: nessuna riga con il loro titolo o il loro testo, in nessuna tabella di «Contesto».
  for (const meeting of [MEETINGS.both, MEETINGS.none, MEETINGS.word]) {
    assert.equal(await sourceOf(meeting.id), undefined);
    assert.equal(await decisionOf(meeting.id), undefined, "nemmeno l'id: non c'è una decisione");
  }
  const everything = await q(`
    SELECT row_to_json(x)::text AS r FROM context_sources x
    UNION ALL SELECT row_to_json(x)::text FROM context_granola_meetings x
    UNION ALL SELECT row_to_json(x)::text FROM context_granola_links x
    UNION ALL SELECT row_to_json(x)::text FROM context_events x`);
  const text = everything.map((r) => String(r.r)).join("\n");
  for (const secret of [MEETINGS.both.title, MEETINGS.none.title, MEETINGS.word.title, "Confronto tra due clienti", "Organizzazione del lavoro interno"]) assert.equal(text.includes(secret), false, secret);

  // La call con «visita medica»: resta fuori, con il codice, senza testo.
  const health = await decisionOf(MEETINGS.health.id);
  assert.deepEqual([health.decision, health.decided_by, health.workspace_id, health.block_code, health.source_id], ["bloccata", "regola", ids.wsT, "sanitario", null]);
  assert.equal(await sourceOf(MEETINGS.health.id), undefined);
  assert.equal((await granola.loadGranolaStatus({ userId: ids.ls, workspaceId: ids.wsT })).blockedCount, 1);

  const row = await connection("ls");
  assert.equal(row.unsorted_count, 3);
  assert.equal(row.last_error, null);
  assert.ok(row.last_sync_ok_at);
  assert.equal(iso(row.synced_through), MEETINGS.nardi.updatedAt, "la call cambiata per ultima");
  assert.equal(row.syncing_until, null);
  // Il giro intero: gli ultimi 30 giorni, prima la cartella poi senza; e solo strumenti di lettura.
  const mine = fake.toolCalls.slice(calls);
  const searches = mine.filter((c) => c.tool === "search_meetings");
  assert.equal(searches[0].args.folder_id, "f-topjet");
  assert.equal(searches[1].args.folder_id, undefined);
  assert.ok(typeof searches[1].args.from_date === "string" && typeof searches[1].args.to_date === "string");
  assert.equal(searches[1].args.limit, 100);
  assert.equal(searches[1].args.max_participants, 30);
  assert.deepEqual(mine.find((c) => c.tool === "get_meetings")?.args.attachments, "none");
  // Il giro non legge con il modello: solo gli strumenti di Granola.
  assert.deepEqual([...new Set(mine.map((c) => c.tool))].sort(), ["get_meetings", "search_meetings"]);
});

test("un giro di meno di 30 minuti fa: recente; due giri insieme: uno solo", opts, async () => {
  assert.equal((await granola.syncGranolaForUser(ids.ls)).status, "recente");
  await q(`UPDATE context_granola_connections SET syncing_until = now() + interval '1 minute' WHERE user_id = $1`, [ids.ls]);
  assert.equal((await granola.syncGranolaForUser(ids.ls, { force: true })).status, "in_corso");
  await q(`UPDATE context_granola_connections SET syncing_until = NULL WHERE user_id = $1`, [ids.ls]);
  assert.equal((await granola.syncGranolaForUser(ids.cli, { force: true })).status, "non_collegato");
});

test("il giro di chi è collegato ma non è più di Lateral Space: non_collegato, senza chiedere niente a Granola", opts, async () => {
  assert.equal((await connection("ls")).status, "attiva");
  const calls = fake.toolCalls.length;
  await q(`UPDATE users SET email = $2 WHERE id = $1`, [ids.ls, `paola-${suffix}@altrove.test`]);
  try {
    assert.equal((await granola.syncGranolaForUser(ids.ls, { force: true })).status, "non_collegato");
    assert.equal(fake.toolCalls.length, calls, "nessuna chiamata a Granola");
  } finally {
    await q(`UPDATE users SET email = $2 WHERE id = $1`, [ids.ls, EMAIL.ls]);
  }
});

test("«Da smistare» dal vivo; «Assegna» e «Lascia fuori»; il conto scende", opts, async () => {
  const unsorted = value(await granola.listGranolaUnsorted(actor("ls")));
  assert.deepEqual(unsorted.map((m) => m.id).sort(), [MEETINGS.both.id, MEETINGS.none.id, MEETINGS.word.id].sort());
  const both = unsorted.find((m) => m.id === MEETINGS.both.id);
  assert.equal(both?.title, MEETINGS.both.title);
  assert.match(both?.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(both?.participants, `Giulia Bianchi, ${EMAIL.out}`, "i nomi, o l'e-mail senza nome; senza chi ha registrato");
  assert.equal(await decisionOf(MEETINGS.both.id), undefined, "leggere «Da smistare» non salva niente");
  // Il cliente non vede «Da smistare».
  assert.equal(errorOf(await granola.listGranolaUnsorted(actor("cli", "wsN", "contributor"))), "permesso_mancante");

  const assigned = value(await granola.assignGranolaMeeting(actor("ls"), MEETINGS.both.id));
  const source = await sourceOf(MEETINGS.both.id);
  assert.equal(source.id, assigned.sourceId);
  assert.equal(source.workspace_id, ids.wsN);
  assert.equal(source.read_status, "da_leggere");
  const decision = await decisionOf(MEETINGS.both.id);
  assert.deepEqual([decision.decision, decision.decided_by, decision.workspace_id], ["entrata", "persona", ids.wsN]);
  // Assegnare di nuovo: lo stesso appunto. Da un altro workspace: non si trova.
  assert.equal(value(await granola.assignGranolaMeeting(actor("ls"), MEETINGS.both.id)).sourceId, assigned.sourceId);
  assert.equal(errorOf(await granola.assignGranolaMeeting(actor("ls", "wsT"), MEETINGS.both.id)), "non_trovato");

  assert.deepEqual(value(await granola.leaveOutGranolaMeetings(actor("ls"), [MEETINGS.none.id, MEETINGS.none.id])), { left: 1 });
  const out = await decisionOf(MEETINGS.none.id);
  assert.deepEqual([out.decision, out.decided_by, out.workspace_id, out.source_id, out.meeting_updated_at, out.block_code], ["fuori", "persona", null, null, null, null]);
  assert.deepEqual(value(await granola.leaveOutGranolaMeetings(actor("ls"), [MEETINGS.none.id])), { left: 0 }, "già fuori");
  assert.equal(errorOf(await granola.leaveOutGranolaMeetings(actor("ls"), ["evt_futura"])), "dati_non_validi");
  assert.equal((await connection("ls")).unsorted_count, 1);
  assert.deepEqual(value(await granola.listGranolaUnsorted(actor("ls"))).map((m) => m.id), [MEETINGS.word.id]);
  assert.equal((await connection("ls")).unsorted_count, 1);
});

function errorOf(result: { ok: boolean; error?: string }): string | null {
  return result.ok ? null : (result.error ?? null);
}

test("le regole: si leggono con le parole predefinite; una parola aggiunta al titolo fa entrare al giro dopo una call di prima", opts, async () => {
  const rules = await granola.readGranolaRules(actor("ls"));
  // Una persona sola del cliente: il contatto con l'indirizzo dell'azienda. Non i membri del workspace, non una casella pubblica.
  assert.deepEqual(rules, { folder: null, knownPeople: 1, emails: [], domains: [], titleWords: ["Nardi"], titleWordsAreDefault: true, wantTranscript: false, transcriptAvailable: true });
  // Una casella pubblica non vale come dominio: farebbe entrare le call di chiunque.
  const publicDomain = await granola.saveGranolaRules(actor("ls"), { folderId: null, folderName: null, emails: [], domains: ["@Gmail.com"], titleWords: ["Nardi"], wantTranscript: false });
  assert.deepEqual([errorOf(publicDomain), !publicDomain.ok && publicDomain.fieldErrors], ["dati_non_validi", { domains: "Gmail, Outlook e le altre caselle pubbliche non valgono come dominio: aggiungi l'indirizzo intero della persona." }]);
  assert.equal(await granola.readGranolaRules(actor("cli", "wsN", "contributor")), null);
  const topjet = await granola.readGranolaRules(actor("ls", "wsT"));
  assert.deepEqual(topjet?.folder, { id: "f-topjet", name: "TopJet" });
  assert.equal(topjet?.titleWordsAreDefault, true, "le parole uguali alle predefinite non si salvano");

  // Valori sbagliati: errori per campo, niente si salva.
  const invalid = await granola.saveGranolaRules(actor("ls"), { folderId: null, folderName: null, emails: ["non è un'e-mail"], domains: ["nardi"], titleWords: [], wantTranscript: false });
  assert.equal(errorOf(invalid), "dati_non_validi");
  assert.deepEqual(!invalid.ok && invalid.fieldErrors, { emails: "Scrivi un'e-mail o un dominio.", domains: "Scrivi un'e-mail o un dominio." });

  // Due call con una persona in Gmail, che nessuna regola riconosce ancora (Alessio è un membro del workspace, non un contatto).
  const byAddress: FakeMeeting = { id: `m-gmail-${suffix}`, title: `Revisione disegni ${suffix}`, meetingAt: ago(60 * 20), updatedAt: ago(60 * 19), participants: `Alessio (${EMAIL.ext})`, summary: "Revisione dei disegni." };
  const sameProvider: FakeMeeting = { id: `m-gmail2-${suffix}`, title: `Prova dei colori ${suffix}`, meetingAt: ago(60 * 21), updatedAt: ago(60 * 20), participants: `Chiara (chiara-${suffix}@gmail.com)`, summary: "Prova dei colori." };
  fake.meetings.push(byAddress, sameProvider);

  // Un indirizzo intero in una casella pubblica, scritto a mano, si accetta: nomina una persona sola.
  value(await granola.saveGranolaRules(actor("ls"), { folderId: null, folderName: null, emails: ["Acquisti@Nardi.test", `p@ls.test`, EMAIL.ext.toUpperCase()], domains: ["@nardi-group.test"], titleWords: ["Nardi", "Ferrari"], wantTranscript: false }));
  const saved = (await q(`SELECT emails, domains, title_words, updated_by_user_id FROM context_granola_rules WHERE workspace_id = $1`, [ids.wsN]))[0];
  assert.deepEqual([saved.emails, saved.domains, saved.title_words, saved.updated_by_user_id], [["acquisti@nardi.test", EMAIL.ext], ["nardi-group.test"], ["Nardi", "Ferrari"], ids.ls]);
  assert.equal((await granola.readGranolaRules(actor("ls")))?.knownPeople, 1, "gli indirizzi scritti a mano non sono persone già note");
  const result = await granola.syncGranolaForUser(ids.ls, { force: true });
  assert.equal(result.status, "fatto");
  assert.equal(result.imported, 2, "il giro dopo una regola cambiata è intero: la parola nel titolo e l'indirizzo");
  assert.equal((await sourceOf(MEETINGS.word.id)).workspace_id, ids.wsN);
  assert.equal((await decisionOf(MEETINGS.word.id)).decided_by, "regola");
  // L'indirizzo vale per quella persona sola: un altro indirizzo della stessa casella resta da smistare.
  assert.equal((await sourceOf(byAddress.id)).workspace_id, ids.wsN);
  assert.equal(await sourceOf(sameProvider.id), undefined);
  assert.equal(await decisionOf(sameProvider.id), undefined);
  assert.ok(value(await granola.listGranolaUnsorted(actor("ls"))).some((m) => m.id === sameProvider.id));
  // Salvare le stesse regole non cambia la data: il giro dopo non torna intero.
  const stamp = (await q(`SELECT updated_at FROM context_granola_rules WHERE workspace_id = $1`, [ids.wsN]))[0].updated_at;
  value(await granola.saveGranolaRules(actor("ls"), { folderId: null, folderName: null, emails: ["acquisti@nardi.test", EMAIL.ext], domains: ["nardi-group.test"], titleWords: ["Nardi", "Ferrari"], wantTranscript: false }));
  assert.equal(iso((await q(`SELECT updated_at FROM context_granola_rules WHERE workspace_id = $1`, [ids.wsN]))[0].updated_at), iso(stamp));
});

test("una call cambiata su Granola torna da leggere, con le proposte aperte superate; il giro breve chiede solo le call cambiate", opts, async () => {
  const source = await sourceOf(MEETINGS.nardi.id);
  await q(`UPDATE context_sources SET read_status = 'letto', read_at = now() WHERE id = $1`, [source.id]);
  const [proposal] = await q(
    `INSERT INTO context_proposals (workspace_id, source_id, position, kind, statement, basis, section, visibility) VALUES ($1, $2, 0, 'nuovo', 'Il gestionale è SAP Business One.', 'detto', 'sistemi', 'tutti') RETURNING id`,
    [ids.wsN, source.id],
  );
  MEETINGS.nardi.summary = "Il gestionale diventa SAP S/4HANA da gennaio.";
  MEETINGS.nardi.updatedAt = new Date().toISOString();
  const calls = fake.toolCalls.length;
  const result = await granola.syncGranolaForUser(ids.ls, { force: true });
  assert.deepEqual([result.status, result.imported, result.updated], ["fatto", 0, 1]);
  const search = fake.toolCalls.slice(calls).find((c) => c.tool === "search_meetings");
  assert.equal(typeof search?.args.updated_after, "string", "il giro breve");
  assert.equal(search?.args.from_date, undefined);
  const changed = await sourceOf(MEETINGS.nardi.id);
  assert.equal(changed.id, source.id, "la stessa fonte, aggiornata");
  assert.equal(changed.read_status, "da_leggere");
  assert.match(String(changed.body), /S\/4HANA/);
  assert.equal((await q(`SELECT status FROM context_proposals WHERE id = $1`, [proposal.id]))[0].status, "superata");
  assert.equal(iso((await decisionOf(MEETINGS.nardi.id)).meeting_updated_at), MEETINGS.nardi.updatedAt);
  // Lo stesso giro di nuovo: la call non è più cambiata e si salta.
  const again = await granola.syncGranolaForUser(ids.ls, { force: true });
  assert.deepEqual([again.imported, again.updated], [0, 0]);
});

test("un appunto tolto non rientra, nemmeno se la call cambia; una call bloccata e poi corretta entra", opts, async () => {
  const source = await sourceOf(MEETINGS.word.id);
  value(await sources.removeContextSource(actor("ls"), String(source.id)));
  const decision = await decisionOf(MEETINGS.word.id);
  assert.deepEqual([decision.decision, decision.workspace_id, decision.source_id], ["fuori", null, null]);
  MEETINGS.word.updatedAt = new Date().toISOString();
  MEETINGS.health.summary = "Il responsabile ha chiesto il piano dei turni.";
  MEETINGS.health.updatedAt = new Date().toISOString();
  const result = await granola.syncGranolaForUser(ids.ls, { force: true });
  assert.equal(result.status, "fatto");
  assert.equal(await sourceOf(MEETINGS.word.id), undefined, "tolto resta tolto");
  assert.equal((await decisionOf(MEETINGS.word.id)).decision, "fuori");
  const health = await decisionOf(MEETINGS.health.id);
  assert.deepEqual([health.decision, health.block_code], ["entrata", null]);
  assert.equal((await sourceOf(MEETINGS.health.id)).workspace_id, ids.wsT);
});

test("un appunto tolto mentre il giro lo rilegge non rientra", opts, async () => {
  const source = await sourceOf(MEETINGS.folder.id);
  MEETINGS.folder.summary = "La call della cartella è cambiata.";
  MEETINGS.folder.updatedAt = new Date().toISOString();
  fake.toolDelays.get_meetings = 400;
  try {
    const from = fake.toolCalls.length;
    const started = Date.now();
    const running = granola.syncGranolaForUser(ids.ls, { force: true });
    // Il giro sta leggendo la nota: la persona toglie l'appunto.
    const reading = () => fake.toolCalls.slice(from).some((c) => c.tool === "get_meetings" && (c.args.meeting_ids as string[]).includes(MEETINGS.folder.id));
    for (let i = 0; i < 100 && !reading(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(reading(), "il giro sta leggendo la nota");
    value(await sources.removeContextSource(actor("ls", "wsT"), String(source.id)));
    const result = await running;
    assert.ok(Date.now() - started >= 400, "la persona ha tolto l'appunto mentre il giro leggeva");
    assert.deepEqual([result.status, result.imported, result.updated], ["fatto", 0, 0]);
  } finally {
    delete fake.toolDelays.get_meetings;
  }
  assert.equal(await sourceOf(MEETINGS.folder.id), undefined, "tolto resta tolto");
  assert.equal((await decisionOf(MEETINGS.folder.id)).decision, "fuori");
});

test("Granola chiede di aspettare: poco, si aspetta e si riprova; tanto, il giro si ferma senza spostare synced_through", opts, async () => {
  fake.rateLimits.push({ tool: "search_meetings", seconds: 2 });
  slept.length = 0;
  const short = await granola.syncGranolaForUser(ids.ls, { force: true });
  assert.equal(short.status, "fatto");
  assert.ok(slept.includes(2_000), "aspetta i secondi chiesti");

  const before = await connection("ls");
  fake.rateLimits.push({ tool: "search_meetings", seconds: 60 });
  const long = await granola.syncGranolaForUser(ids.ls, { force: true });
  assert.equal(long.status, "limite");
  const after = await connection("ls");
  assert.equal(iso(after.synced_through), iso(before.synced_through));
  assert.equal(iso(after.last_sync_ok_at), iso(before.last_sync_ok_at));
  assert.equal(after.last_error, "limite");
  assert.equal(after.syncing_until, null, "il turno si libera anche così");
  const live = await granola.listGranolaUnsorted(actor("ls"));
  assert.equal(live.ok, true);
  fake.rateLimits.push({ tool: "*", seconds: 60 });
  assert.deepEqual(await granola.listGranolaUnsorted(actor("ls")), { ok: false, error: "riprova", message: "Granola chiede di aspettare. Riprova tra qualche minuto." });
});

test("la trascrizione solo se il workspace la chiede e il piano la dà; una call omessa da Granola si chiede da sola", opts, async () => {
  const transcriptCall: FakeMeeting = {
    id: `m-trascr-${suffix}`,
    title: "Riunione con TopJet sui turni",
    meetingAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    participants: `Luca (${EMAIL.top})`,
    summary: "Si parla dei turni della manutenzione.",
    transcript: `Il responsabile dice che i turni sono tre. ${"Seguono dettagli sui turni. ".repeat(3000)}`,
  };
  const second: FakeMeeting = { ...transcriptCall, id: `m-seconda-${suffix}`, title: "Seconda call con TopJet", transcript: null, summary: "Seconda sintesi per TopJet." };
  fake.meetings.push(transcriptCall, second);
  value(await granola.saveGranolaRules(actor("ls", "wsT"), { folderId: "f-topjet", folderName: "TopJet", emails: [], domains: [], titleWords: ["TopJet"], wantTranscript: true }));
  fake.notesPerResponse = 1;
  try {
    const result = await granola.syncGranolaForUser(ids.ls, { force: true });
    assert.equal(result.status, "fatto");
    assert.equal(result.imported, 2, "anche la call che Granola ha omesso");
  } finally {
    fake.notesPerResponse = null;
  }
  const withTranscript = await sourceOf(transcriptCall.id);
  assert.equal(withTranscript.kind, "trascrizione");
  assert.match(String(withTranscript.body), /\[Trascrizione\]\nIl responsabile dice che i turni sono tre\./);
  assert.equal(String(withTranscript.body), `[Riassunto di Granola]\nSi parla dei turni della manutenzione.\n\n[Trascrizione]\n${transcriptCall.transcript!.trim()}`, "i pezzi uniti ridanno la trascrizione");
  const transcriptCalls = fake.toolCalls.filter((c) => c.tool === "get_meeting_transcript" && c.args.meeting_id === transcriptCall.id);
  assert.deepEqual(transcriptCalls.map((c) => [c.args.max_chars, c.args.offset]), [
    [40000, 0],
    [40000, 40000],
    [40000, 80000],
  ]);
  assert.equal((await sourceOf(second.id)).kind, "appunti", "senza trascrizione");

  // Il piano gratuito non la dà: un errore «piano» le spegne per il resto del giro.
  fake.account.plan = "Free";
  transcriptCall.updatedAt = new Date().toISOString();
  second.updatedAt = new Date().toISOString();
  second.transcript = "Testo che non arriva.";
  const before = fake.toolCalls.length;
  try {
    const result = await granola.syncGranolaForUser(ids.ls, { force: true });
    assert.equal(result.status, "fatto");
  } finally {
    fake.account.plan = "Business";
  }
  assert.equal(fake.toolCalls.slice(before).filter((c) => c.tool === "get_meeting_transcript").length, 1, "dopo il primo «piano» non si chiede più");
  assert.equal((await sourceOf(transcriptCall.id)).kind, "appunti");
});

test("una call che Granola elenca ma di cui non dà la nota si salta, senza fermare il giro breve", opts, async () => {
  const noteless: FakeMeeting = { id: `m-senza-nota-${suffix}`, title: "Call senza nota", meetingAt: new Date().toISOString(), updatedAt: new Date().toISOString(), participants: `Giulia (${EMAIL.cli})`, summary: "Non arriva.", noteless: true };
  fake.meetings.push(noteless);
  const calls = fake.toolCalls.length;
  const result = await granola.syncGranolaForUser(ids.ls, { force: true });
  assert.deepEqual([result.status, result.imported], ["fatto", 0]);
  const asked = fake.toolCalls.slice(calls).filter((c) => c.tool === "get_meetings").map((c) => c.args.meeting_ids);
  assert.deepEqual(asked.at(-1), [noteless.id], "richiesta di nuovo da sola");
  assert.equal(await decisionOf(noteless.id), undefined);
  assert.equal(await sourceOf(noteless.id), undefined);
  const row = await connection("ls");
  assert.equal(iso(row.synced_through), noteless.updatedAt, "synced_through va avanti lo stesso");
  assert.equal(row.last_error, null);
});

test("«Assegna» una call senza note: lo dice, e non salva niente", opts, async () => {
  const empty: FakeMeeting = { id: `m-vuota-${suffix}`, title: `Call ancora vuota ${suffix}`, meetingAt: ago(60), updatedAt: ago(59), participants: `Paola (${EMAIL.ls})`, summary: null, privateNotes: null };
  fake.meetings.push(empty);
  try {
    const result = await granola.assignGranolaMeeting(actor("ls"), empty.id);
    assert.deepEqual(result, { ok: false, error: "dati_non_validi", message: CONTEXT_TEXT.granola.noNotes });
    assert.equal(await decisionOf(empty.id), undefined);
    assert.equal(await sourceOf(empty.id), undefined);
  } finally {
    fake.meetings.splice(fake.meetings.indexOf(empty), 1);
  }
});

// ─── La notte e scollegare ───────────────────────────────────────────

test("la registrazione dinamica (riserva) si fa una volta sola e si riusa", opts, async () => {
  process.env.CONTEXT_GRANOLA_CLIENT = "dcr";
  try {
    const first = new URL(value(await granola.startGranolaConnect(actor("ls2"))).url);
    const second = new URL(value(await granola.startGranolaConnect(actor("ls2"))).url);
    assert.match(first.searchParams.get("client_id") ?? "", /^dcr-/);
    assert.equal(second.searchParams.get("client_id"), first.searchParams.get("client_id"));
    assert.equal(fake.registrations.length, 1);
    const back = await fake.consent(first.toString());
    signIn("ls2");
    assert.equal(location(await callbackRoute.GET(new Request(back.toString()))).search, "?granola=collegato");
    assert.equal((await connection("ls2")).client_id, first.searchParams.get("client_id"), "il collegamento tiene il client_id con cui è nato");
  } finally {
    delete process.env.CONTEXT_GRANOLA_CLIENT;
    forgetGranolaDiscovery();
  }
});

test("il giro della notte: scollega chi non è più di Lateral Space, cancella gli stati scaduti da un giorno, fa il giro degli altri", opts, async () => {
  await q(`INSERT INTO context_granola_oauth_states (state_hash, user_id, workspace_id, verifier_sealed, client_id, redirect_uri, created_at, expires_at)
           VALUES ($1, $2, $3, 'x', 'c', 'r', now() - interval '3 days', now() - interval '2 days')`, [randomBytes(32).toString("hex"), ids.ls, ids.wsN]);
  await q(`UPDATE users SET email = $2 WHERE id = $1`, [ids.ls2, `marco-${suffix}@altrove.test`]);
  const revokedBefore = fake.revoked.length;
  const totals = await granola.syncGranolaAll({ budgetMs: 30_000 });
  assert.deepEqual(totals, { users: 1, imported: 0, errors: 0 });
  assert.equal(await connection("ls2"), undefined, "chi non è più di Lateral Space è scollegato");
  assert.equal(fake.revoked.length, revokedBefore + 1, "e il suo token revocato");
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_granola_oauth_states WHERE expires_at < now() - interval '1 day'`))[0].n, 0);
  assert.ok((await connection("ls")).last_sync_at);
});

test("scollegare revoca e cancella il collegamento e i legami; gli appunti e le decisioni sulle call restano, anche ricollegando", opts, async () => {
  const tokens = openGranolaTokens(KEY, ids.ls, String((await connection("ls")).tokens_sealed));
  assert.ok(tokens.ok);
  const imported = Number((await q(`SELECT count(*)::int AS n FROM context_sources WHERE origin = 'granola' AND added_by_user_id = $1`, [ids.ls]))[0].n);
  assert.ok(imported >= 4);
  const decisions = async () => (await q(`SELECT meeting_id, decision FROM context_granola_meetings WHERE user_id = $1 ORDER BY meeting_id`, [ids.ls])).map((r) => `${r.meeting_id}:${r.decision}`);
  const decided = await decisions();
  assert.ok(decided.includes(`${MEETINGS.none.id}:fuori`) && decided.includes(`${MEETINGS.both.id}:entrata`), decided.join(" "));
  const unsortedBefore = value(await granola.listGranolaUnsorted(actor("ls"))).map((m) => m.id).sort();
  value(await granola.disconnectGranola(ids.ls));
  assert.deepEqual(fake.revoked.at(-1), { token: tokens.value.refreshToken, hint: "refresh_token", clientId: `${ORIGIN}/api/granola/client-metadata` });
  for (const table of ["context_granola_connections", "context_granola_links", "context_granola_oauth_states"]) {
    assert.equal((await q(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [ids.ls]))[0].n, 0, table);
  }
  assert.deepEqual(await decisions(), decided, "le decisioni sulle call restano: solo gli id");
  assert.equal(Number((await q(`SELECT count(*)::int AS n FROM context_sources WHERE origin = 'granola' AND added_by_user_id = $1`, [ids.ls]))[0].n), imported);
  assert.equal((await granola.loadGranolaStatus({ userId: ids.ls, workspaceId: ids.wsN })).connected, false);
  assert.equal(errorOf(await granola.listGranolaUnsorted(actor("ls"))), "non_trovato");
  assert.equal((await granola.syncGranolaForUser(ids.ls, { force: true })).status, "non_collegato");

  // Ricollegato: le call assegnate o lasciate fuori restano decise, e il giro non fa entrare doppioni.
  assert.equal(location(await connect("ls")).search, "?granola=collegato");
  assert.deepEqual(value(await granola.listGranolaUnsorted(actor("ls"))).map((m) => m.id).sort(), unsortedBefore);
  assert.equal((await granola.syncGranolaForUser(ids.ls, { force: true })).status, "fatto");
  assert.equal(Number((await q(`SELECT count(*)::int AS n FROM context_sources WHERE origin = 'granola' AND added_by_user_id = $1`, [ids.ls]))[0].n), imported);
  assert.equal(await sourceOf(MEETINGS.none.id), undefined, "lasciata fuori resta fuori");
  assert.deepEqual(await decisions(), decided);
  value(await granola.disconnectGranola(ids.ls));
});
