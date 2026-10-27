import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format?: string; source?: string | Uint8Array; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult;
    load?(url: string, context: object, nextLoad: (url: string, context: object) => LoadResult): LoadResult;
  }): void;
};

// La campanella per persona sul database di prova (SPEC §P2.4, §P2.5, §P2.12.2): letture dei segnali
// per persona, «visto fino a» con l'orologio del database, la base dell'iscrizione, la lettura di una
// riga che è cresciuta, «Segna tutte come lette» fino a quello che si è visto, chi riceve cosa, la
// rotta GET/POST e la barra in alto che passa il payload.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Il database di prova va in UTC come Neon (`weekly_signals.created_at` non ha fuso):
//   la prova lo imposta e lo rimette com'era.
// - Dati sintetici, creati e cancellati qui.
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

type Signals = typeof import("../../db/queries/signals.ts");
type BellData = typeof import("../../notifications/bell-data.ts");
type BellWrites = typeof import("../../notifications/bell-writes.ts");
type Notifications = typeof import("../../db/queries/use-case-notifications.ts");
type Route = typeof import("../../../app/api/workspaces/[workspaceId]/bell/route.ts");

let signals: Signals;
let data: BellData;
let writes: BellWrites;
let notifications: Notifications;
let route: Route;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let dbName = "";

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), analyst: randomUUID(), contributor: randomUUID(), learner: randomUUID(), newcomer: randomUUID(), useCase: randomUUID() };
const emails = {
  builder: `builder.campanella.${suffix}@cliente.test`,
  analyst: `analyst.campanella.${suffix}@cliente.test`,
  contributor: `contributor.campanella.${suffix}@cliente.test`,
  learner: `learner.campanella.${suffix}@cliente.test`,
  newcomer: `nuovo.campanella.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;
const ROLE: Record<Person, string> = { builder: "function_lead", analyst: "analyst", contributor: "contributor", learner: "learner", newcomer: "function_lead" };
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_ENABLED", "UC_WORKSPACE_IDS", "UC_LS_EMAIL_DOMAINS", "NEXT_PUBLIC_APP_URL"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function signIn(person: Person | null): void {
  (globalThis as { __bellSession?: unknown }).__bellSession = person ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}` } } : null;
}

async function signal(type: string, title: string, createdAt?: string): Promise<string> {
  const rows = createdAt
    ? await q(`INSERT INTO weekly_signals (workspace_id, signal_type, title, created_at) VALUES ($1::uuid, $2, $3, $4::timestamp) RETURNING id`, [ids.ws, type, title, createdAt])
    : await q(`INSERT INTO weekly_signals (workspace_id, signal_type, title) VALUES ($1::uuid, $2, $3) RETURNING id`, [ids.ws, type, title]);
  return String(rows[0].id);
}

const payload = (person: Person, useCaseHub = true) => data.loadBellPayload({ workspaceId: ids.ws, userId: ids[person], role: ROLE[person], useCaseHub });
const entryOf = (p: Awaited<ReturnType<typeof payload>>, key: string) => p.entries.find((e) => e.key === key);

before(async () => {
  if (!enabled) return;
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "@/lib/auth": stub("export async function auth() { return globalThis.__bellSession ?? null; }"),
    "next/cache": stub("export function revalidatePath() {}\nexport function revalidateTag() {}\nexport function refresh() {}\nexport function unstable_cache(fn) { return fn; }"),
  };
  const { default: ts } = await import("typescript");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(moduleUrl, context, nextLoad) {
      if (!moduleUrl.startsWith("file:") || !moduleUrl.endsWith(".tsx")) return nextLoad(moduleUrl, context);
      const file = fileURLToPath(moduleUrl);
      const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    },
  });
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  // Come Neon: il database in UTC (la sessione di adesso e le prossime).
  dbName = String((await q(`SELECT current_database() AS db`))[0].db);
  await q(`ALTER DATABASE "${dbName.replace(/"/g, "")}" SET timezone TO 'UTC'`);
  await q(`SET timezone TO 'UTC'`);
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  signals = await import("../../db/queries/signals.ts");
  data = await import("../../notifications/bell-data.ts");
  writes = await import("../../notifications/bell-writes.ts");
  notifications = await import("../../db/queries/use-case-notifications.ts");
  route = await import("../../../app/api/workspaces/[workspaceId]/bell/route.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione campanella', $2)`, [ids.org, `hub-campanella-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Campanella prova')`, [ids.ws, ids.org]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    // Il nuovo arrivato si iscrive dopo i segnali vecchi (la sua iscrizione la scrive il test).
    if (person !== "newcomer") {
      await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES ($1::uuid, $2::uuid, $3::member_role, now() - interval '30 days')`, [ids.ws, ids[person], ROLE[person]]);
    }
  }
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Problema', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
    [ids.useCase, ids.ws, `BL-${String(1000 + Math.floor(Math.random() * 8000))}`],
  );
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  signIn(null);
  if (!enabled) return;
  await q(`ALTER DATABASE "${dbName.replace(/"/g, "")}" RESET timezone`);
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

const sig = { case: "", risk: "", legacy: "" };

test("segnali per persona: un revisore legge, il collega no; una riga vecchia letta per tutti resta letta per tutti", opts, async () => {
  sig.case = await signal("new_portfolio_item", `Nuovo use case ${suffix}`);
  sig.risk = await signal("risk_alert", `Rischio ${suffix}`);
  sig.legacy = await signal("risk_alert", `Vecchio ${suffix}`);
  await q(`UPDATE weekly_signals SET is_read = true WHERE id = $1::uuid`, [sig.legacy]);
  assert.equal(await writes.writeBellRead({ workspaceId: ids.ws, userId: ids.builder, role: ROLE.builder, ref: { source: "segnale", id: sig.case } }), "ok");
  const builder = await payload("builder");
  const analyst = await payload("analyst");
  assert.equal(entryOf(builder, `s:${sig.case}`)?.unread, false);
  assert.equal(entryOf(analyst, `s:${sig.case}`)?.unread, true, "il collega la vede ancora non letta");
  assert.equal(entryOf(builder, `s:${sig.legacy}`)?.unread, false);
  assert.equal(entryOf(analyst, `s:${sig.legacy}`)?.unread, false);
  // Il contributore: nessun segnale delle schede, e la sua «Segna tutti letti» non tocca i revisori.
  const contributor = await payload("contributor");
  assert.equal(entryOf(contributor, `s:${sig.case}`), undefined);
  await signals.markSignalsReadForUser({ workspaceId: ids.ws, userId: ids.contributor, role: "contributor", signalIds: null });
  assert.equal((await q(`SELECT 1 FROM weekly_signal_reads WHERE user_id = $1::uuid AND signal_id = $2::uuid`, [ids.contributor, sig.case])).length, 0);
  assert.equal(entryOf(await payload("analyst"), `s:${sig.risk}`)?.unread, true);
  // Il riepilogo settimanale ritira per tutti: il suo `is_read` vale ancora.
  const unread = await signals.getUnreadSignals(ids.ws, "analyst", ids.analyst);
  assert.ok(!unread.some((s) => s.id === sig.legacy));
});

test("«visto fino a»: aprire la campanella azzera il numero, le righe restano evidenziate; un segnale dopo è nuovo", opts, async () => {
  const before = await payload("analyst");
  assert.ok(before.newCount >= 2, JSON.stringify(before));
  const seen = await writes.writeBellSeen({ workspaceId: ids.ws, userId: ids.analyst });
  const [db] = await q(`SELECT now() AS now`);
  assert.ok(Math.abs(seen.getTime() - new Date(String(db.now)).getTime()) < 60_000, "l'orologio del database");
  const after = await payload("analyst");
  assert.equal(after.newCount, 0);
  assert.ok(after.unreadCount >= 2, "evidenziate finché non si aprono");
  // Un segnale scritto adesso con il valore predefinito del database è «nuovo».
  await new Promise((resolve) => setTimeout(resolve, 5));
  const fresh = await signal("risk_alert", `Fresco ${suffix}`);
  const later = await payload("analyst");
  assert.equal(entryOf(later, `s:${fresh}`)?.unread, true);
  assert.equal(later.newCount, 1);
  // «visto fino a» non torna indietro.
  const again = await writes.writeBellSeen({ workspaceId: ids.ws, userId: ids.analyst });
  assert.ok(again.getTime() >= seen.getTime());
});

test("chi entra dopo: i segnali di prima sono evidenziati ma non nuovi", opts, async () => {
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'function_lead')`, [ids.ws, ids.newcomer]);
  const p = await payload("newcomer");
  assert.ok(p.seenAt, "la base è l'iscrizione");
  assert.ok(p.unreadCount >= 3);
  assert.equal(p.newCount, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await signal("risk_alert", `Dopo l'iscrizione ${suffix}`);
  assert.equal((await payload("newcomer")).newCount, 1);
});

test("una riga di use case cresciuta dopo che la persona l'ha vista resta non letta, con i conteggi nuovi", opts, async () => {
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  const executor = await getAppUcExecutor();
  await executor.batch([notifications.notifyReviewersSql({ workspaceId: ids.ws, useCaseId: ids.useCase, kind: "risposte", answers: 1, unknowns: 0, documents: 0, actorUserId: null })]);
  const first = (await payload("builder")).entries.find((e) => e.source === "use_case");
  assert.ok(first && first.ref.source === "use_case");
  if (!first || first.ref.source !== "use_case") return;
  assert.equal(first.description, "1 risposta da verificare in «Cosa serve».");
  const seenAt = first.ref.at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await executor.batch([notifications.notifyReviewersSql({ workspaceId: ids.ws, useCaseId: ids.useCase, kind: "risposte", answers: 2, unknowns: 0, documents: 0, actorUserId: null })]);
  assert.equal(await writes.writeBellRead({ workspaceId: ids.ws, userId: ids.builder, role: ROLE.builder, ref: { source: "use_case", id: first.ref.id, at: seenAt } }), "ok");
  const grown = (await payload("builder")).entries.find((e) => e.key === first.key);
  assert.equal(grown?.unread, true, "cresciuta dopo: resta non letta");
  assert.equal(grown?.description, "3 risposte da verificare in «Cosa serve».");
  if (grown?.ref.source === "use_case") {
    await writes.writeBellRead({ workspaceId: ids.ws, userId: ids.builder, role: ROLE.builder, ref: grown.ref });
  }
  assert.equal((await payload("builder")).entries.find((e) => e.key === first.key)?.unread, false);
  // Le righe sono per persona: l'analista la vede ancora non letta; il contributore non la riceve.
  const analystRows = (await payload("analyst")).entries.filter((e) => e.source === "use_case");
  assert.equal(analystRows.length, 1);
  assert.equal(analystRows[0].unread, true);
  assert.notEqual(analystRows[0].key, first.key, "una riga per persona");
  assert.equal((await payload("contributor")).entries.filter((e) => e.source === "use_case").length, 0);
});

test("«Segna tutte come lette» fino a quello che si è visto: una riga arrivata dopo resta non letta", opts, async () => {
  const shown = await payload("analyst");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const late = await signal("risk_alert", `In ritardo ${suffix}`);
  const upTo = new Date(shown.latestAt!);
  await signals.markSignalsReadForUser({ workspaceId: ids.ws, userId: ids.analyst, role: ROLE.analyst, signalIds: null, upTo });
  await notifications.markUseCaseNotificationsRead({ userId: ids.analyst, workspaceId: ids.ws, id: null, upTo });
  await writes.writeBellSeen({ workspaceId: ids.ws, userId: ids.analyst });
  const after = await payload("analyst");
  assert.deepEqual(after.entries.filter((e) => e.unread).map((e) => e.key), [`s:${late}`]);
  assert.equal(after.newCount, 0);
  // Gli altri non cambiano.
  assert.ok((await payload("builder")).entries.some((e) => e.key === `s:${sig.risk}` && e.unread));
});

test("chi riceve cosa: un revisore che perde il ruolo non vede più le sue righe; le email solo a chi ha già chiesto", opts, async () => {
  const shown = await payload("builder");
  assert.deepEqual(shown.emailAlerts, { shown: false, on: true });
  const contact = randomUUID();
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $2::uuid, 'Mario Rossi', $3)`, [contact, ids.ws, `mario.${suffix}@topjet.test`]);
  await q(
    `INSERT INTO use_case_referent_requests (workspace_id, use_case_id, contact_id, requested_by_user_id, requester_name, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Persona builder', now() + interval '30 days')`,
    [ids.ws, ids.useCase, contact, ids.builder],
  );
  assert.deepEqual((await payload("builder")).emailAlerts, { shown: true, on: true });
  await q(`UPDATE workspace_memberships SET role = 'contributor' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.builder]);
  const demoted = await data.loadBellPayload({ workspaceId: ids.ws, userId: ids.builder, role: "contributor", useCaseHub: true });
  assert.equal(demoted.entries.filter((e) => e.source === "use_case").length, 0);
  assert.equal(demoted.emailAlerts.shown, false);
  await q(`UPDATE workspace_memberships SET role = 'function_lead' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.builder]);
  // Dossier: con UC_ENABLED ma il workspace fuori da UC_WORKSPACE_IDS niente righe dei dossier.
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = randomUUID();
  try {
    assert.equal((await payload("builder")).entries.filter((e) => e.source === "dossier").length, 0);
  } finally {
    delete process.env.UC_ENABLED;
    delete process.env.UC_WORKSPACE_IDS;
  }
});

test("rotta GET: 401 senza sessione, 404 a chi segue solo i corsi e a un altro workspace, 200 privata; non scrive", opts, async () => {
  const get = (ws: string) => route.GET(new Request(`http://localhost:3000/api/workspaces/${ws}/bell`), { params: Promise.resolve({ workspaceId: ws }) });
  signIn(null);
  assert.equal((await get(ids.ws)).status, 401);
  signIn("learner");
  assert.equal((await get(ids.ws)).status, 404);
  signIn("analyst");
  assert.equal((await get(randomUUID())).status, 404);
  const before = await q(`SELECT seen_at FROM workspace_bell_state WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.analyst]);
  const res = await get(ids.ws);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  const body = (await res.json()) as { ok: boolean; payload: { workspaceId: string } };
  assert.ok(body.ok && body.payload.workspaceId === ids.ws);
  const after = await q(`SELECT seen_at FROM workspace_bell_state WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.analyst]);
  assert.deepEqual(after, before, "la lettura non scrive «visto»");
});

test("rotta POST: stessa origine, JSON, corpo valido, sessione; «seen» e «read» solo per chi chiama", opts, async () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    route.POST(
      new Request(`http://localhost:3000/api/workspaces/${ids.ws}/bell`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", host: "localhost:3000", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      { params: Promise.resolve({ workspaceId: ids.ws }) },
    );
  signIn("analyst");
  assert.equal((await post({ op: "seen" }, { origin: "https://altro.example" })).status, 403);
  assert.equal((await post({ op: "seen" }, { "content-type": "text/plain" })).status, 415);
  assert.equal((await post({ op: "seen", extra: 1 })).status, 400);
  assert.equal((await post("{")).status, 400);
  signIn(null);
  assert.equal((await post({ op: "seen" })).status, 401);
  signIn("learner");
  assert.equal((await post({ op: "seen" })).status, 404);
  signIn("analyst");
  const seen = await post({ op: "seen" });
  assert.equal(seen.status, 200);
  const body = (await seen.json()) as { ok: boolean; seenAt: string };
  assert.ok(body.ok && Date.parse(body.seenAt) > 0);
  // La riga di un'altra persona: non scrive niente (e risponde ok).
  const others = await q(`SELECT id::text AS id, last_event_at FROM use_case_notifications WHERE workspace_id = $1::uuid AND recipient_user_id = $2::uuid LIMIT 1`, [ids.ws, ids.builder]);
  if (others[0]) {
    await q(`UPDATE use_case_notifications SET read_at = NULL WHERE id = $1::uuid`, [others[0].id]);
    const res = await post({ op: "read", ref: { source: "use_case", id: String(others[0].id), at: new Date().toISOString() } });
    assert.equal(res.status, 200);
    assert.equal((await q(`SELECT read_at FROM use_case_notifications WHERE id = $1::uuid`, [others[0].id]))[0].read_at, null);
  }
});

test("la barra in alto passa alla campanella il payload della persona", opts, async () => {
  const { WorkspaceTopbar } = await import("../../../components/portfolio/workspace-topbar.tsx");
  const tree = await WorkspaceTopbar({ workspaceId: ids.ws, role: ROLE.analyst, userId: ids.analyst, useCaseHub: true });
  const found: unknown[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object" && "props" in node) {
      const props = (node as { props: Record<string, unknown> }).props;
      if (props && Object.hasOwn(props, "initial")) found.push(props.initial);
      assert.ok(!props || !Object.hasOwn(props, "initialSignals"));
      if (props) visit(props.children);
    }
  };
  visit(tree);
  assert.equal(found.length, 1);
  const initial = found[0] as { workspaceId: string; entries: unknown[] };
  assert.equal(initial.workspaceId, ids.ws);
  assert.ok(initial.entries.length > 0);
});
