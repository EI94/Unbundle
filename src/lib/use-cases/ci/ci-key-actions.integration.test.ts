import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

// Le azioni della pagina sulla chiave della CI (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.5, §3.2): chi gestisce il
// workspace e chi è responsabile di un caso del repository sì; sviluppatori di Lateral Space, chi costruisce da fuori e il
// cliente no, anche chiamando l'azione direttamente (qui le si chiama così, con una sessione finta). La chiave si vede una
// volta, nella risposta di «Crea» e «Ruota»; mai nei log.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1): `@/lib/auth`
//   restituisce la sessione della prova, `next/cache` e `next/server` registrano invece di toccare Next. Dati sintetici,
//   creati e cancellati qui.
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
let actions: typeof import("../../actions/ci-keys.ts");

const suffix = randomBytes(3).toString("hex");
const REPO = `Voltaen/esempio-azioni-${suffix}`;
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  other: randomUUID(),
  template: randomUUID(),
  uc: randomUUID(),
  dossier: randomUUID(),
  manager: randomUUID(),
  lead: randomUUID(),
  dev: randomUUID(),
  outside: randomUUID(),
  client: randomUUID(),
  stranger: randomUUID(),
};
type Person = "manager" | "lead" | "dev" | "outside" | "client" | "stranger";
const PEOPLE: readonly Person[] = ["manager", "lead", "dev", "outside", "client", "stranger"];
const EMAIL: Record<Person, string> = {
  manager: `gestisce-${suffix}@ls.test`,
  lead: `responsabile-${suffix}@ls.test`,
  dev: `sviluppo-${suffix}@ls.test`,
  outside: `da-fuori-${suffix}@esterni.test`,
  client: `cliente-${suffix}@cliente.test`,
  stranger: `altro-${suffix}@ls.test`,
};
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "VERCEL_ENV"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const state = globalThis as { __ciKeySession?: unknown; __ciKeyRevalidated?: string[]; __ciKeyAfter?: (() => Promise<void>)[] };
const logged: string[] = [];
const consoleBefore = { log: console.log, warn: console.warn, error: console.error, info: console.info };

function signIn(person: Person | null): void {
  state.__ciKeySession = person ? { user: { id: ids[person], email: EMAIL[person], emailVerified: true, name: `Persona ${person}`, image: null } } : null;
}

type AnyResult = { ok: true; data?: unknown; message?: string } | { ok: false; code: string; message: string };
function refused(result: AnyResult, code: string, label: string): void {
  assert.equal(result.ok, false, `${label}: atteso il rifiuto ${code}`);
  assert.equal((result as { code: string }).code, code, label);
}

before(async () => {
  if (!enabled) return;
  for (const level of ["log", "warn", "error", "info"] as const) {
    console[level] = (...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.name} ${a.message}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      consoleBefore[level](...args);
    };
  }
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "next/cache": stub(
      "export function revalidatePath(path) { (globalThis.__ciKeyRevalidated ??= []).push(path); }\nexport function revalidateTag() {}\nexport function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}",
    ),
    "next/server": stub("export function after(task) { (globalThis.__ciKeyAfter ??= []).push(task); }"),
    "@/lib/auth": stub("export async function auth() { return globalThis.__ciKeySession ?? null; }"),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = `${ids.ws},${ids.other}`;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.USE_CASE_HUB_WORKSPACES = `${ids.ws},${ids.other}`;
  delete process.env.VERCEL_ENV;

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  await (await import("../../db/ensure-schema.ts")).ensureDbSchema();
  actions = await import("../../actions/ci-keys.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova azioni CI', $2)`, [ids.org, `org-ci-azioni-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente di prova azioni CI'), ($3, $2, 'Altro cliente azioni CI')`, [ids.ws, ids.org, ids.other]);
  const role: Record<Person, string> = { manager: "transformation_lead", lead: "contributor", dev: "contributor", outside: "analyst", client: "transformation_lead", stranger: "transformation_lead" };
  for (const person of PEOPLE) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], `Persona ${person}`]);
    // Chi viene da un altro workspace non è membro di questo.
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [person === "stranger" ? ids.other : ids.ws, ids[person], role[person]]);
  }
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, 'Caso di prova azioni CI', 'XX-0021')`, [ids.uc, ids.ws]);
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova azioni CI', 'prova', '{"confidential": false}'::jsonb, $3)`,
    [ids.template, `prova.ci_azioni_${suffix}`, randomBytes(32).toString("hex")],
  );
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova azioni CI', 'in_sviluppo', now())`,
    [ids.dossier, ids.ws, ids.org, ids.uc, ids.template, `XA-${suffix.toUpperCase()}`],
  );
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead'), ($1, $3, 'ls_sviluppatore'), ($1, $4, 'ls_sviluppatore'), ($1, $5, 'owner_cliente')`, [
    ids.dossier,
    ids.lead,
    ids.dev,
    ids.outside,
    ids.client,
  ]);
  await q(`INSERT INTO use_case_external_builders (workspace_id, user_id, added_by_user_id) VALUES ($1, $2, $3)`, [ids.ws, ids.outside, ids.manager]);
  await q(`INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder) VALUES ($1, $2, $3, 'casi/xx-0021')`, [ids.uc, ids.ws, REPO]);
});

after(async () => {
  for (const level of ["log", "warn", "error", "info"] as const) console[level] = consoleBefore[level];
  for (const key of ENV_KEYS) {
    if (envBefore[key] === undefined) delete process.env[key];
    else process.env[key] = envBefore[key];
  }
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1, $2)`, [ids.ws, ids.other]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [PEOPLE.map((p) => ids[p])]);
});

test("sviluppatori di Lateral Space, chi costruisce da fuori e il cliente: «Crea», «Ruota» e «Revoca» rifiutati, anche chiamati direttamente", opts, async () => {
  for (const person of ["dev", "outside", "client"] as const) {
    signIn(person);
    refused(await actions.createCiKeyAction(ids.ws, { repo: REPO }), "permesso_negato", `crea: ${person}`);
    refused(await actions.rotateCiKeyAction(ids.ws, { repo: REPO }), "permesso_negato", `ruota: ${person}`);
    refused(await actions.revokeCiKeyAction(ids.ws, { repo: REPO }), "permesso_negato", `revoca: ${person}`);
  }
  const [none] = await q(`SELECT count(*)::int AS n FROM use_case_ci_keys WHERE workspace_id = $1`, [ids.ws]);
  assert.equal(none.n, 0, "nessuna chiave");
  // Chi non è nel workspace non arriva nemmeno ai controlli della chiave; senza sessione, il login.
  signIn("stranger");
  await assert.rejects(actions.createCiKeyAction(ids.ws, { repo: REPO }), /Workspace non trovato o non accessibile/);
  signIn(null);
  await assert.rejects(actions.createCiKeyAction(ids.ws, { repo: REPO }));
});

test("il responsabile del caso crea la chiave, una volta sola; chi gestisce il workspace la ruota e la revoca", opts, async () => {
  state.__ciKeyRevalidated = [];
  state.__ciKeyAfter = [];
  signIn("lead");
  const created = await actions.createCiKeyAction(ids.ws, { repo: REPO });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.match(created.data.key, /^ub_ci_[A-Za-z0-9_-]{43}$/);
  assert.equal(created.data.repo, REPO);
  assert.equal(created.data.prefix, created.data.key.slice(0, 10));
  assert.equal(created.data.oldUntil, null);
  assert.equal(created.message, "Chiave nuova creata: mettila su GitHub.");
  assert.deepEqual(state.__ciKeyRevalidated, [`/dashboard/${ids.ws}/agent-factory`]);
  assert.equal(state.__ciKeyAfter.length, 1, "l'e-mail a chi gestisce il workspace, dopo la risposta");
  refused(await actions.createCiKeyAction(ids.ws, { repo: REPO }), "gia_collegata", "una seconda");
  // Il responsabile gestisce le chiavi solo dei repository dei suoi casi: per un altro, il permesso prima di tutto.
  refused(await actions.createCiKeyAction(ids.ws, { repo: "Voltaen/senza-casi" }), "permesso_negato", "un repository non suo");
  refused(await actions.createCiKeyAction(ids.ws, {}), "dati_non_validi", "senza repository");

  signIn("manager");
  refused(await actions.createCiKeyAction(ids.ws, { repo: "Voltaen/senza-casi" }), "repo_senza_casi", "senza casi");
  const rotated = await actions.rotateCiKeyAction(ids.ws, { repo: REPO });
  assert.equal(rotated.ok, true);
  if (!rotated.ok) return;
  assert.notEqual(rotated.data.key, created.data.key);
  assert.ok(rotated.data.oldUntil && new Date(rotated.data.oldUntil).getTime() <= Date.now() + 7 * 86_400_000 + 1000);
  refused(await actions.rotateCiKeyAction(ids.ws, { repo: REPO }), "rotazione_in_corso", "la seconda rotazione");
  const revoked = await actions.revokeCiKeyAction(ids.ws, { repo: REPO });
  assert.deepEqual(revoked, { ok: true, data: { repo: REPO, revoked: 2 }, message: "Chiave revocata." });
  refused(await actions.revokeCiKeyAction(ids.ws, { repo: REPO }), "nessuna_chiave", "niente da revocare");
  // In tabella solo l'impronta e il prefisso, mai la chiave.
  const rows = await q(`SELECT token_hash, token_prefix FROM use_case_ci_keys WHERE workspace_id = $1`, [ids.ws]);
  for (const row of rows) for (const key of [created.data.key, rotated.data.key]) assert.ok(!Object.values(row).includes(key));
});

test("la sezione spenta per il workspace: «Non ancora disponibile», a chiunque", opts, async () => {
  signIn("manager");
  process.env.UC_ENABLED = "false";
  try {
    refused(await actions.createCiKeyAction(ids.ws, { repo: REPO }), "non_disponibile", "spenta");
  } finally {
    process.env.UC_ENABLED = "true";
  }
});

test("mai ub_ci_ nei log delle azioni", opts, async () => {
  assert.ok(!logged.some((line) => line.includes("ub_ci_")));
});
