import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";

// Le rotte del server di «Chiedi al referente» sul database di prova (SPEC §2.5): i file di «Cosa
// serve» (`…/use-cases/[useCaseId]/allegati/**`: sessione, stessa origine, ruolo; il download con le
// intestazioni giuste e lo stesso 404 per ogni rifiuto) e il cron dei giorni feriali.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). La sessione è quella scelta dalla prova (`@/lib/auth` sostituito); l'archivio è una
//   cartella temporanea. Dati sintetici, creati e cancellati qui.
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

type Referents = typeof import("../../db/queries/use-case-referents.ts");
type Public = typeof import("../../db/queries/use-case-referent-public.ts");
type Dispatch = typeof import("../../db/queries/use-case-referent-dispatch.ts");
type Ctx = import("../service.ts").WriteContext;
type Mail = import("../../uc/notify/dispatch.ts").OutgoingEmail;

let referents: Referents;
let pub: Public;
let dispatch: Dispatch;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), other: randomUUID(), builder: randomUUID(), analyst: randomUUID(), contributor: randomUUID(), ls: randomUUID(), useCase: randomUUID(), otherCard: randomUUID() };
const emails = {
  builder: `builder.referenti.${suffix}@cliente.test`,
  analyst: `analyst.referenti.${suffix}@cliente.test`,
  contributor: `contributor.referenti.${suffix}@cliente.test`,
  ls: `ls.referenti.${suffix}@ls.test`,
};
type Person = keyof typeof emails;
const ROLE: Record<Person, string> = { builder: "function_lead", analyst: "analyst", contributor: "contributor", ls: "transformation_lead" };
const REFERENT_EMAIL = `mario.rossi.${suffix}@topjet.test`;
const storageDir = mkdtempSync(join(tmpdir(), "referenti-"));

const ENV = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LOCAL_STORAGE_DIR: storageDir,
} as Record<string, string | undefined>;
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function as(person: Person, workspaceId: string = ids.ws): Ctx {
  return { workspaceId, actor: { userId: ids[person], role: ROLE[person], isLateralSpace: person === "ls", kind: "persona" }, channel: "pagina" };
}
const requester = (person: Person) => ({ name: `Persona ${person}`, emailVerified: true });

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}
function refused(result: { ok: boolean; error?: string }, error: string, label = "rifiuto") {
  assert.equal(result.ok, false, label);
  assert.equal(result.error, error, label);
}

function fakeMailer() {
  const outbox: Mail[] = [];
  return { outbox, async send(m: Mail) { outbox.push(m); return { ok: true as const }; } };
}
const tokenOf = (m: Mail) => /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(m.text)?.[1] ?? null;

async function needIds(useCaseId: string = ids.useCase): Promise<string[]> {
  const rows = await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid ORDER BY n.sort_order, n.id`, [useCaseId]);
  return rows.map((r) => String(r.id));
}
async function statusOf(needId: string): Promise<string> {
  return String((await q(`SELECT status FROM use_case_needs WHERE id = $1::uuid`, [needId]))[0]?.status);
}
async function useCaseSnapshot(): Promise<string> {
  return JSON.stringify(await q(`SELECT version, portfolio_review_status, intake, updated_at FROM use_cases WHERE id = $1::uuid`, [ids.useCase]));
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  ENV.USE_CASE_HUB_WORKSPACES = [ids.ws, ids.other].join(",");
  process.env.USE_CASE_HUB_WORKSPACES = ENV.USE_CASE_HUB_WORKSPACES;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  delete process.env.USE_CASE_REFERENTS;
  referents = await import("../../db/queries/use-case-referents.ts");
  pub = await import("../../db/queries/use-case-referent-public.ts");
  dispatch = await import("../../db/queries/use-case-referent-dispatch.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione referenti', $2)`, [ids.org, `hub-referenti-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'TopJet prova'), ($2::uuid, $3::uuid, 'Altro workspace')`, [ids.ws, ids.other, ids.org]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    for (const ws of [ids.ws, ids.other]) await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ws, ids[person], ROLE[person]]);
  }
  for (const [id, ws, code] of [
    [ids.useCase, ids.ws, `RF-${String(1000 + Math.floor(Math.random() * 8000))}`],
    [ids.otherCard, ids.other, `RG-${String(1000 + Math.floor(Math.random() * 8000))}`],
  ]) {
    await q(
      `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
       VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Problema di prova', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
      [id, ws, code],
    );
  }
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(storageDir, { recursive: true, force: true });
  if (!enabled) return;
  await q(`DELETE FROM uc_rate_limits WHERE bucket LIKE 'ucq:%'`);
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.other]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

const state = { requestId: "", contactId: "", token: "", needs: [] as string[] };


type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

function signIn(person: Person | null): void {
  (globalThis as { __routesSession?: unknown }).__routesSession = person ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}` } } : null;
}
const APP = "../../../app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/allegati";
let fileId = "";
const csv = new TextEncoder().encode(`colonna;valore\n${Array.from({ length: 6 }, (_, i) => `Regola ${i + 1}: il margine si calcola dal costo orario`).join("\n")}\n`);

test("preparazione: la sessione della prova, un file pulito del team", opts, async () => {
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "@/lib/auth": stub("export async function auth() { return globalThis.__routesSession ?? null; }"),
    "next/cache": stub("export function revalidatePath() {}\nexport function revalidateTag() {}\nexport function refresh() {}"),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  process.env.UC_LOCAL_STORAGE_DIR = ENV.UC_LOCAL_STORAGE_DIR;
  ok(await referents.prepareReferentQuestions(as("builder"), ids.useCase));
  state.needs = await needIds();
  const files = await import("../../db/queries/use-case-referent-files.ts");
  const up = await files.uploadReviewerFileServer(as("builder"), ids.useCase, { needId: state.needs[0], fileName: "regole \"ottobre\".csv", declaration: true, bytes: csv }, ENV);
  assert.ok(up.ok, JSON.stringify(up));
  if (up.ok) fileId = up.value.fileId;
});

test("download: 401 senza sessione, lo stesso 404 per il contributore, un altro workspace e un file sconosciuto; 200 con le intestazioni", opts, async () => {
  const route = await import(`${APP}/[fileId]/route.ts`);
  const get = (ws: string, uc: string, file: string) => route.GET(new Request(`http://localhost:3000/dashboard/${ws}/use-cases/${uc}/allegati/${file}`), { params: Promise.resolve({ workspaceId: ws, useCaseId: uc, fileId: file }) });
  signIn(null);
  assert.equal((await get(ids.ws, ids.useCase, fileId)).status, 401);
  signIn("contributor");
  const contributor = await get(ids.ws, ids.useCase, fileId);
  assert.equal(contributor.status, 404);
  const body404 = await contributor.text();
  signIn("builder");
  for (const [ws, uc, f] of [
    [ids.other, ids.useCase, fileId],
    [ids.ws, ids.otherCard, fileId],
    [ids.ws, ids.useCase, randomUUID()],
  ]) {
    const res = await get(ws, uc, f);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), body404, "lo stesso 404");
  }
  const okRes = await get(ids.ws, ids.useCase, fileId);
  assert.equal(okRes.status, 200);
  assert.equal(okRes.headers.get("cache-control"), "private, no-store");
  assert.equal(okRes.headers.get("x-content-type-options"), "nosniff");
  assert.equal(okRes.headers.get("content-security-policy"), "sandbox; default-src 'none'");
  assert.match(okRes.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.equal(Number(okRes.headers.get("content-length")), csv.byteLength);
  assert.equal((await okRes.arrayBuffer()).byteLength, csv.byteLength);
  // Un prefetch non scarica niente.
  const prefetch = await route.GET(new Request(`http://localhost:3000/x`, { headers: { "next-router-prefetch": "1" } }), { params: Promise.resolve({ workspaceId: ids.ws, useCaseId: ids.useCase, fileId }) });
  assert.equal(prefetch.status, 204);
});

test("caricamento: un'altra origine 403; senza sessione 401; il contributore 404; il revisore carica", opts, async () => {
  const route = await import(`${APP}/upload/route.ts`);
  const form = () => {
    const fd = new FormData();
    fd.set("file", new File([csv], "regole.csv", { type: "text/csv" }));
    fd.set("needId", state.needs[1]);
    fd.set("declaration", "true");
    return fd;
  };
  const post = (headers: Record<string, string>) =>
    route.POST(new Request(`http://localhost:3000/dashboard/${ids.ws}/use-cases/${ids.useCase}/allegati/upload`, { method: "POST", body: form(), headers }), {
      params: Promise.resolve({ workspaceId: ids.ws, useCaseId: ids.useCase }),
    });
  signIn("builder");
  assert.equal((await post({ origin: "https://altro.example", host: "localhost:3000" })).status, 403);
  signIn(null);
  assert.equal((await post({ origin: "http://localhost:3000", host: "localhost:3000" })).status, 401);
  signIn("contributor");
  assert.equal((await post({ origin: "http://localhost:3000", host: "localhost:3000" })).status, 404);
  signIn("builder");
  const res = await post({ origin: "http://localhost:3000", host: "localhost:3000" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; data: { status: string } };
  assert.ok(body.ok && body.data.status === "pulito", JSON.stringify(body));
  assert.equal(await statusOf(state.needs[1]), "in_verifica");
});

test("cron: spento 404, senza segreto o con un segreto sbagliato 401, poi soli conteggi", opts, async () => {
  const route = await import("../../../app/api/cron/use-case-referents/route.ts");
  const call = (auth?: string) => route.GET(new Request("http://localhost:3000/api/cron/use-case-referents", { headers: auth ? { authorization: auth } : {} }));
  const before = { secret: process.env.CRON_SECRET, off: process.env.USE_CASE_REFERENTS };
  try {
    process.env.USE_CASE_REFERENTS = "off";
    assert.equal((await call("Bearer x")).status, 404);
    delete process.env.USE_CASE_REFERENTS;
    delete process.env.CRON_SECRET;
    assert.equal((await call("Bearer undefined")).status, 401, "un segreto assente rifiuta sempre");
    process.env.CRON_SECRET = `segreto-${suffix}`;
    assert.equal((await call("Bearer sbagliato")).status, 401);
    const res = await call(`Bearer segreto-${suffix}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.job, "use-case-referents");
    for (const [key, value] of Object.entries(body)) if (key !== "job") assert.equal(typeof value, "number", key);
  } finally {
    if (before.secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before.secret;
    if (before.off === undefined) delete process.env.USE_CASE_REFERENTS;
    else process.env.USE_CASE_REFERENTS = before.off;
  }
});

// Gli aiuti di prova comuni alle suite di «Chiedi al referente»: questa non li usa tutti.
void (() => [pub, dispatch, REFERENT_EMAIL, requester, refused, fakeMailer, tokenOf, useCaseSnapshot]);
