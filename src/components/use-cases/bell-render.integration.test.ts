import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
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

// La campanella resa sul server (SPEC §P2.12.3, R10): solo il pulsante, perché il menu di Base UI non
// si rende sul server (il portale aspetta il browser). Il nome accessibile dice quante sono nuove,
// il numero rosso è «3», «9+» da 10, niente con 0. E la barra in alto: a un contributore non arriva
// nessuna riga degli use case, nemmeno se nel database ce ne fosse una a suo nome.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
// 127.0.0.1). Dati sintetici, creati e cancellati qui.
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

type BellPayload = import("../../lib/notifications/bell.ts").BellPayload;
type BellEntry = import("../../lib/notifications/bell.ts").BellEntry;

let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let render: (element: unknown) => string;
let createElementOf: (type: unknown, props: unknown) => unknown;
let bellModule: typeof import("../portfolio/notifications-bell.tsx");
let topbar: typeof import("../portfolio/workspace-topbar.tsx");
let dbName = "";

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), reviewer: randomUUID(), contributor: randomUUID(), card: randomUUID() };
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_ENABLED", "UC_WORKSPACE_IDS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 27, 9, minutes)).toISOString();
function entry(n: number): BellEntry {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return { key: `s:${id}`, source: "segnale", ref: { source: "segnale", id }, context: null, title: `Riga ${n}`, description: null, href: null, activityAt: at(n), when: "27 ott, 10:00", unread: true };
}
function payload(count: number): BellPayload {
  const entries = Array.from({ length: count }, (_, i) => entry(i + 1)).reverse();
  return { workspaceId: "ws", entries, newCount: count, unreadCount: count, seenAt: null, latestAt: entries[0]?.activityAt ?? null, emailAlerts: { shown: false, on: true }, generatedAt: at(59) };
}
function findProp(node: unknown, name: string): unknown[] {
  const out: unknown[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object" && "props" in value) {
      const props = (value as { props: Record<string, unknown> }).props;
      if (props && Object.hasOwn(props, name)) out.push(props[name]);
      if (props) visit(props.children);
    }
  };
  visit(node);
  return out;
}

before(async () => {
  if (!enabled) return;
  const { default: ts } = await import("typescript");
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "@/lib/auth": stub("export async function auth() { return null; }"),
    "next/cache": stub("export function revalidatePath() {}\nexport function revalidateTag() {}\nexport function refresh() {}\nexport function updateTag() {}\nexport function unstable_cache(fn) { return fn; }"),
  };
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
  // Come Neon: il database in UTC (la sessione di adesso e le prossime), come bell.integration.test.ts.
  dbName = String((await q(`SELECT current_database() AS db`))[0].db).replace(/"/g, "");
  await q(`ALTER DATABASE "${dbName}" SET timezone TO 'UTC'`);
  await q(`SET timezone TO 'UTC'`);
  const { createElement } = await import("react");
  createElementOf = (type, props) => createElement(type as never, props as never);
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as {
    AppRouterContext: import("react").Context<object | null>;
  };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  render = (element) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element as never));
  bellModule = await import("../portfolio/notifications-bell.tsx");
  topbar = await import("../portfolio/workspace-topbar.tsx");

  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione campanella', $2)`, [ids.org, `hub-bell-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Campanella')`, [ids.ws, ids.org]);
  for (const [person, role] of [["reviewer", "function_lead"], ["contributor", "contributor"]] as const) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], `${person}.bell.${suffix}@cliente.test`, `Persona ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], role]);
  }
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', 'proposed', 'in_review', 'use_case_ai', $4, 'web_proposed')`,
    [ids.card, ids.ws, `Fatture ${suffix}`, `RB-${1000 + Math.floor(Math.random() * 8000)}`],
  );
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`ALTER DATABASE "${dbName}" RESET timezone`);
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.reviewer, ids.contributor]]);
});

function trigger(count: number): string {
  return render(createElementOf(bellModule.NotificationsBell, { workspaceId: ids.ws, initial: payload(count) }));
}

test("il pulsante: «Notifiche, 3 nuove» e «3»; «9+» da 10; niente numero con 0; il menu non si rende sul server", opts, () => {
  const three = trigger(3);
  assert.match(three, /aria-label="Notifiche, 3 nuove"/);
  assert.match(three, /data-slot="notifications-badge"[^>]*>3<\/span>/);
  assert.match(three, /aria-hidden="true"[^>]*data-slot="notifications-badge"|data-slot="notifications-badge"[^>]*aria-hidden="true"/, "il numero è solo visivo: lo dice già il nome");
  assert.match(trigger(1), /aria-label="Notifiche, 1 nuova"/);
  const twelve = trigger(12);
  assert.match(twelve, /aria-label="Notifiche, 12 nuove"/);
  assert.match(twelve, />9\+<\/span>/);
  const none = trigger(0);
  assert.match(none, /aria-label="Notifiche"/);
  assert.doesNotMatch(none, /notifications-badge/);
  // Bersaglio da dito al telefono, più piccolo dal tablet.
  assert.match(three, /class="[^"]*size-11[^"]*sm:size-9/);
  assert.doesNotMatch(three, /Riga 1|Segna tutte come lette/, "le righe stanno nel menu, che il server non rende");
});

test("la barra in alto: al contributore nessuna riga degli use case, al revisore sì", opts, async () => {
  for (const person of ["reviewer", "contributor"] as const) {
    await q(`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day, answers) VALUES ($1::uuid, $2::uuid, $3::uuid, 'risposte', current_date, 2)`, [
      ids.ws,
      ids.card,
      ids[person],
    ]);
  }
  const element = async (person: "reviewer" | "contributor", role: string) => topbar.WorkspaceTopbar({ workspaceId: ids.ws, role, userId: ids[person], useCaseHub: true });
  const [forContributor] = findProp(await element("contributor", "contributor"), "initial") as BellPayload[];
  assert.ok(forContributor, "la campanella c'è");
  assert.equal(forContributor.entries.filter((e) => e.source === "use_case").length, 0);
  assert.equal(forContributor.emailAlerts.shown, false);
  const [forReviewer] = findProp(await element("reviewer", "function_lead"), "initial") as BellPayload[];
  const rows = forReviewer.entries.filter((e) => e.source === "use_case");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].href?.endsWith(`/use-cases/${ids.card}?capitolo=cosa-serve`));
  assert.equal(forReviewer.newCount, 1);
});
