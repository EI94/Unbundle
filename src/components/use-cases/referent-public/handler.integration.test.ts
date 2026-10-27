import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// Le API pubbliche `/api/rispondi/[token]/…` chiamate come le chiama Next (SPEC §4.2, §9.2): origine,
// segreto su Vercel, limiti per IP e per link, link sconosciuti, errori senza token nel log, e il giro
// completo informativa → bozza (con il controllo del testo) → file → invio, dalle rotte vere.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Nessuna email vera (mailer finto), nessun Blob vero (cartella locale). Dati sintetici,
//   creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("Run this suite only on a package database hub_<id>");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Ctx = import("../../../lib/use-cases/service.ts").WriteContext;
type Mail = import("../../../lib/uc/notify/dispatch.ts").OutgoingEmail;
type RouteModule = { GET?: Handler; POST?: Handler };
type Handler = (request: Request, ctx: { params: Promise<{ token: string }> }) => Promise<Response>;

let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let referents: typeof import("../../../lib/db/queries/use-case-referents.ts");
let dispatch: typeof import("../../../lib/db/queries/use-case-referent-dispatch.ts");
let handler: typeof import("../../../app/api/rispondi/[token]/handler.ts");
const routes: Record<string, RouteModule> = {};

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), useCase: randomUUID() };
const BUILDER_EMAIL = `builder.rotte.${suffix}@cliente.test`;
const BASE = "http://localhost:3000";
const storageDir = mkdtempSync(join(tmpdir(), "rispondi-rotte-"));
const ENV: Record<string, string | undefined> = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: BASE,
  UC_LOCAL_STORAGE_DIR: storageDir,
};
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "NEXT_PUBLIC_APP_URL", "UC_LOCAL_STORAGE_DIR", "UC_SECRET", "VERCEL_ENV", "USE_CASE_REFERENTS", "UC_ENABLED", "UC_WORKSPACE_IDS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const as = (): Ctx => ({ workspaceId: ids.ws, actor: { userId: ids.builder, role: "function_lead", isLateralSpace: false, kind: "persona" }, channel: "pagina" });

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}

const state = { token: "", requestId: "", tokenId: "", needs: [] as string[] };

async function sendLink(email: string, needIds: string[]): Promise<{ token: string; requestId: string }> {
  const sent = ok(
    await referents.sendReferentRequest(as(), ids.useCase, { contact: { kind: "nuovo", displayName: "Mario Rossi", email }, needIds }, { env: ENV, requester: { name: "Giulia Neri", emailVerified: true } }),
    "invio",
  );
  const outbox: Mail[] = [];
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer: { async send(m: Mail) { outbox.push(m); return { ok: true as const }; } }, sendIntervalMs: 0 });
  const token = /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(outbox[0]?.text ?? "")?.[1];
  assert.ok(token, "il link è nell'email");
  return { token, requestId: sent.requestId };
}

function request(path: string, init: { method?: "GET" | "POST"; body?: unknown; form?: FormData; origin?: string | null; ip?: string } = {}): Request {
  const headers = new Headers({ accept: "application/json" });
  if (init.origin !== null && (init.method ?? "POST") === "POST") headers.set("origin", init.origin ?? BASE);
  if (init.ip) headers.set("x-forwarded-for", init.ip);
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  return new Request(`${BASE}${path}`, { method: init.method ?? "POST", headers, body });
}

async function call(route: string, token: string, init: Parameters<typeof request>[1] = {}) {
  const method = init.method ?? "POST";
  const fn = routes[route]?.[method];
  assert.ok(fn, `${route} ${method}`);
  const res = await fn(request(`/api/rispondi/${token}${route ? `/${route}` : ""}`, init), { params: Promise.resolve({ token }) });
  const json = (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: string; message?: string; issues?: { field?: string }[] };
  return { status: res.status, headers: res.headers, json };
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  ENV.USE_CASE_HUB_WORKSPACES = ids.ws;
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.NEXT_PUBLIC_APP_URL = BASE;
  process.env.UC_LOCAL_STORAGE_DIR = storageDir;
  referents = await import("../../../lib/db/queries/use-case-referents.ts");
  dispatch = await import("../../../lib/db/queries/use-case-referent-dispatch.ts");
  handler = await import("../../../app/api/rispondi/[token]/handler.ts");
  for (const route of ["", "privacy", "draft", "submit", "upload", "upload-token", "upload-complete", "file-remove", "file-confirm"]) {
    routes[route] = (await import(`../../../app/api/rispondi/[token]/${route ? `${route}/` : ""}route.ts`)) as RouteModule;
  }

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione rotte', $2)`, [ids.org, `hub-rotte-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'TopJet prova')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, 'Giulia Neri', now())`, [ids.builder, BUILDER_EMAIL]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'function_lead')`, [ids.ws, ids.builder]);
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Problema di prova', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
    [ids.useCase, ids.ws, `RR-${String(1000 + Math.floor(Math.random() * 8000))}`],
  );
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  ok(await referents.prepareReferentQuestions(as(), ids.useCase), "prepara");
  const needs = await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid ORDER BY n.sort_order, n.id`, [ids.useCase]);
  state.needs = needs.map((r) => String(r.id));
  assert.ok(state.needs.length >= 4);
  const link = await sendLink(`mario.rossi.${suffix}@topjet.test`, state.needs.slice(0, 2));
  state.token = link.token;
  state.requestId = link.requestId;
  const [t] = await q(`SELECT id::text AS id FROM use_case_referent_tokens WHERE request_id = $1::uuid`, [link.requestId]);
  state.tokenId = String(t.id);
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(storageDir, { recursive: true, force: true });
  if (!enabled) return;
  await q(`DELETE FROM uc_rate_limits WHERE bucket LIKE 'ucq:%' OR bucket LIKE 'ip:%'`);
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1::uuid`, [ids.builder]);
});

test("GET: la vista con il link giusto, senza scrivere niente; un link sconosciuto o malformato → 404 uniforme", opts, async () => {
  const view = await call("", state.token, { method: "GET" });
  assert.equal(view.status, 200);
  assert.equal(view.headers.get("cache-control"), "no-store");
  assert.equal(view.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(view.json.ok, true);
  const data = view.json.data as { state: string; questions: unknown[]; privacy: { accepted: boolean } };
  assert.equal(data.state, "aperta");
  assert.equal(data.questions.length, 2);
  assert.equal(data.privacy.accepted, false);
  const counters = await q(`SELECT count(*)::int AS n FROM uc_rate_limits WHERE bucket LIKE $1`, [`ucq:${state.tokenId}:%`]);
  assert.equal(counters[0].n, 0, "una GET non conta nei limiti");

  for (const token of [`ucq_${"Z".repeat(32)}`, "non-un-link", `ucq_${"a".repeat(31)}`]) {
    const r = await call("", token, { method: "GET" });
    assert.equal(r.status, 404, token);
    assert.equal(r.json.error, "link_non_valido");
    const w = await call("privacy", token, { body: { version: "ucq-2026-10-1" } });
    assert.equal(w.status, 404);
    assert.equal(w.json.error, "link_non_valido");
  }
});

test("scritture: un'origine diversa o assente → 403 origine_non_ammessa, niente scritto", opts, async () => {
  for (const origin of ["https://altro.example", null, "null"]) {
    const r = await call("privacy", state.token, { body: { version: "ucq-2026-10-1" }, origin });
    assert.equal(r.status, 403, String(origin));
    assert.equal(r.json.error, "origine_non_ammessa");
  }
  const [row] = await q(`SELECT privacy_accepted_at FROM use_case_referent_requests WHERE id = $1::uuid`, [state.requestId]);
  assert.equal(row.privacy_accepted_at, null);
  const broken = await routes.draft.POST!(
    new Request(`${BASE}/api/rispondi/${state.token}/draft`, { method: "POST", headers: { origin: BASE, "content-type": "application/json" }, body: "{" }),
    { params: Promise.resolve({ token: state.token }) },
  );
  assert.equal(broken.status, 400, "un corpo JSON rotto");
  const notJson = await routes.draft.POST!(
    new Request(`${BASE}/api/rispondi/${state.token}/draft`, { method: "POST", headers: { origin: BASE, "content-type": "text/plain" }, body: "ciao" }),
    { params: Promise.resolve({ token: state.token }) },
  );
  assert.equal(notJson.status, 415, "un corpo che non è JSON");
});

test("su Vercel (anteprima o produzione) senza UC_SECRET le scritture rispondono 503", opts, async () => {
  try {
    for (const env of ["preview", "production"]) {
      process.env.VERCEL_ENV = env;
      const r = await call("privacy", state.token, { body: { version: "ucq-2026-10-1" } });
      assert.equal(r.status, 503, env);
      assert.equal(r.json.error, "non_disponibile");
    }
    // In anteprima la funzione è spenta: anche la lettura dice «link non valido».
    process.env.VERCEL_ENV = "preview";
    assert.equal((await call("", state.token, { method: "GET" })).status, 404);
    // In produzione si legge anche senza segreto.
    process.env.VERCEL_ENV = "production";
    assert.equal((await call("", state.token, { method: "GET" })).status, 200);
    // Con il segreto le scritture tornano.
    process.env.UC_SECRET = `segreto-di-prova-${suffix}-abcdefghijklmnop`;
    assert.equal((await call("privacy", state.token, { body: { version: "ucq-2025-01-1" } })).json.error, "informativa_cambiata");
  } finally {
    delete process.env.VERCEL_ENV;
    delete process.env.UC_SECRET;
  }
});

test("la funzione spenta o il workspace fuori dall'area: link non valido, come ogni altro", opts, async () => {
  try {
    process.env.USE_CASE_REFERENTS = "off";
    assert.equal((await call("", state.token, { method: "GET" })).json.error, "link_non_valido");
    delete process.env.USE_CASE_REFERENTS;
    process.env.USE_CASE_HUB_WORKSPACES = randomUUID();
    assert.equal((await call("privacy", state.token, { body: { version: "ucq-2026-10-1" } })).json.error, "link_non_valido");
    // Spegnere i dossier non spegne questa funzione.
    process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
    process.env.UC_ENABLED = "false";
    assert.equal((await call("", state.token, { method: "GET" })).status, 200);
  } finally {
    delete process.env.USE_CASE_REFERENTS;
    delete process.env.UC_ENABLED;
    process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  }
});

test("dalle rotte: informativa, bozza bloccata dal controllo del testo, bozza, file, invio", opts, async () => {
  const [n0, n1] = state.needs;
  // Prima dell'informativa niente bozze.
  const early = await call("draft", state.token, { body: { needId: n0, text: "Ogni giorno", dontKnow: false } });
  assert.equal(early.status, 409);
  assert.equal(early.json.error, "informativa_da_leggere");
  const accepted = await call("privacy", state.token, { body: { version: "ucq-2026-10-1" } });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.json.data, { accepted: true });

  // Nella bozza i dati sanitari bloccano subito: niente si salva.
  const blocked = await call("draft", state.token, { body: { needId: n0, text: "Dopo la visita medica del collega", dontKnow: false } });
  assert.equal(blocked.status, 422);
  assert.match(String(blocked.json.error), /^testo_/);
  assert.equal((await q(`SELECT count(*)::int AS n FROM use_case_need_answers WHERE request_id = $1::uuid`, [state.requestId]))[0].n, 0);
  // Email e telefoni nella bozza: salvata con un avviso, poi l'invio la rifiuta sulla sua domanda.
  const warned = await call("draft", state.token, { body: { needId: n0, text: `Chiedete a mario.rossi.${suffix}@topjet.test`, dontKnow: false } });
  assert.equal(warned.status, 200);
  assert.ok(Array.isArray(warned.json.data?.warnings) && (warned.json.data.warnings as unknown[]).length > 0, "un avviso sotto il campo");
  const refused = await call("submit", state.token, { body: {} });
  assert.equal(refused.status, 422);
  assert.equal(refused.json.error, "risposte_da_correggere");
  assert.ok(refused.json.issues?.some((i) => i.field?.toLowerCase() === n0.toLowerCase()), "il problema è sulla sua domanda");
  assert.equal((await q(`SELECT status FROM use_case_needs WHERE id = $1::uuid`, [n0]))[0].status, "chiesta", "niente inviato");

  const saved = await call("draft", state.token, { body: { needId: n0, text: "Circa 20 fatture al giorno, 5.000 all'anno.", dontKnow: false } });
  assert.equal(saved.status, 200);
  assert.equal(typeof saved.json.data?.savedAt, "string");

  // Un file sulla seconda domanda: caricato, tolto, caricato di nuovo.
  const upload = async () => {
    const form = new FormData();
    form.set("file", new File(["mese;fatture\nottobre;420\nnovembre;390\n"], "volumi.csv", { type: "text/csv" }));
    form.set("needId", n1);
    form.set("declaration", "true");
    return call("upload", state.token, { form });
  };
  const noDeclaration = new FormData();
  noDeclaration.set("file", new File(["a;b\n1;2\n"], "x.csv", { type: "text/csv" }));
  noDeclaration.set("needId", n1);
  noDeclaration.set("declaration", "false");
  assert.notEqual((await call("upload", state.token, { form: noDeclaration })).status, 200, "senza la dichiarazione il file non entra");
  const first = await upload();
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.data?.status, "pulito");
  const removed = await call("file-remove", state.token, { body: { fileId: first.json.data?.fileId } });
  assert.equal(removed.status, 200);
  const again = await upload();
  assert.equal(again.json.data?.status, "pulito");
  assert.equal((await call("file-confirm", state.token, { body: { fileId: again.json.data?.fileId } })).status, 404, "niente da confermare su un file senza avvisi");

  const sent = await call("submit", state.token, { body: {} });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.deepEqual(sent.json.data, { submitted: 2, open: 0, state: "completata" });
  const statuses = await q(`SELECT status FROM use_case_needs WHERE id = ANY($1::uuid[]) ORDER BY id`, [[n0, n1]]);
  assert.deepEqual(statuses.map((r) => r.status), ["in_verifica", "in_verifica"]);
  const view = await call("", state.token, { method: "GET" });
  assert.equal((view.json.data as { state: string }).state, "completata");
  // Un file inviato non si toglie più.
  assert.equal((await call("file-remove", state.token, { body: { fileId: again.json.data?.fileId } })).json.error, "file_gia_inviato");
  // Dopo l'invio la domanda non accetta altre bozze.
  assert.equal((await call("draft", state.token, { body: { needId: n0, text: "Altro", dontKnow: false } })).status, 404);
});

test("limite per link: la 31ª apertura in un minuto → 429 con Retry-After", opts, async () => {
  await alignToMinute();
  let last = 0;
  let retry: string | null = null;
  for (let i = 0; i < 31; i++) {
    const r = await call("privacy", state.token, { body: { version: "ucq-2026-10-1" } });
    last = r.status;
    retry = r.headers.get("retry-after");
  }
  assert.equal(last, 429);
  assert.ok(Number(retry) >= 1);
});

test("limite per IP: con UC_SECRET la 121ª scrittura in un minuto dallo stesso IP → 429 con Retry-After", opts, async () => {
  process.env.UC_SECRET = `segreto-di-prova-${suffix}-abcdefghijklmnop`;
  try {
    await alignToMinute();
    const unknown = `ucq_${randomBytes(24).toString("base64url")}`;
    for (let i = 0; i < 120; i++) {
      const r = await call("draft", unknown, { body: { needId: state.needs[0], text: "x", dontKnow: false }, ip: "203.0.113.7" });
      assert.equal(r.status, 404, `chiamata ${i + 1}`);
    }
    const over = await call("draft", unknown, { body: { needId: state.needs[0], text: "x", dontKnow: false }, ip: "203.0.113.7" });
    assert.equal(over.status, 429);
    assert.equal(over.json.error, "troppe_richieste");
    assert.ok(Number(over.headers.get("retry-after")) >= 1);
    // Un altro IP passa.
    assert.equal((await call("draft", unknown, { body: { needId: state.needs[0], text: "x", dontKnow: false }, ip: "198.51.100.9" })).status, 404);
  } finally {
    delete process.env.UC_SECRET;
  }
});

test("un'eccezione nel comando → 500 «errore», e nel log non c'è il token", opts, async () => {
  const lines: string[] = [];
  const original = { error: console.error, warn: console.warn, info: console.info, log: console.log };
  const capture = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  console.error = capture;
  console.warn = capture;
  console.info = capture;
  console.log = capture;
  let res: Response;
  try {
    res = await handler.handleReferentPublic(request(`/api/rispondi/${state.token}`, { method: "GET" }), state.token, { write: false, rate: null }, async () => {
      throw new Error(`guasto con ${state.token}`);
    });
  } finally {
    Object.assign(console, original);
  }
  assert.equal(res.status, 500);
  const json = (await res.json()) as { error: string; message: string };
  assert.equal(json.error, "errore");
  assert.ok(!json.message.includes(state.token));
  assert.ok(lines.length > 0, "l'errore finisce nel log");
  assert.ok(lines.every((l) => !l.includes(state.token) && !l.includes("guasto")), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes("use-case.rispondi") && l.includes('"op":"vista"')));
});

/** I limiti contano per minuto: si parte all'inizio di un minuto, così la prova non lo attraversa. */
async function alignToMinute(): Promise<void> {
  const s = new Date().getUTCSeconds();
  if (s >= 45) await new Promise((resolve) => setTimeout(resolve, (61 - s) * 1000));
}
