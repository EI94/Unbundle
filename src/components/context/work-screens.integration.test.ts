import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// «Da verificare» sul database del pacchetto (rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §2.10, §5.2): la pagina vera per
// Lateral Space e «non trovata» per il cliente, «Ancora veri (n)» con l'azione vera. Finti solo la sessione,
// `revalidatePath` e `after` (fuori da una richiesta di Next non ci sono); nessun modello.
//
// - Con HUB_TEST_ISOLATED=true e un DATABASE_URL di loopback su una copia hub_<id> (scripts/use-case-test/
//   run-db-tests.mjs, che prende src/components/context/**). Dati sintetici e inventati, creati e cancellati qui.
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
type Page = (props: { params: Promise<Record<string, string>> }) => Promise<unknown>;

let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let verifyPage: Page;
let actions: typeof import("../../lib/actions/context-work.ts");
let renderToStaticMarkup: (element: unknown) => string;

const suffix = randomBytes(3).toString("hex");
const people = ["ls", "rev"] as const;
type Person = (typeof people)[number];
const ids = { org: randomUUID(), ws: randomUUID(), ...(Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>) };
const EMAIL: Record<Person, string> = { ls: `ls-${suffix}@ls.test`, rev: `rev-${suffix}@cliente.test` };
const ROLE: Record<Person, string> = { ls: "transformation_lead", rev: "analyst" };

function signIn(person: Person | null) {
  prova.session = person ? { user: { id: ids[person], name: `Persona ${person}`, email: EMAIL[person], image: null, emailVerified: true } } : null;
}

/** La pagina resa in HTML con la sessione di `person`, oppure il `digest` di `notFound()`. */
async function openVerify(person: Person): Promise<{ html: string | null; digest: string | null }> {
  signIn(person);
  try {
    const element = await verifyPage({ params: Promise.resolve({ workspaceId: ids.ws }) });
    return { html: renderToStaticMarkup(element), digest: null };
  } catch (error) {
    const digest = (error as { digest?: unknown })?.digest;
    if (typeof digest === "string") return { html: null, digest };
    throw error;
  }
}

/** Un fatto attivo di prova, «Scritto a mano», con la sua ultima conferma. */
async function insertFact(statement: string, lastConfirmedAt: string, needsCheck: boolean): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO context_facts (id, workspace_id, section, statement, basis, visibility, status, origin, needs_check, last_confirmed_at)
     VALUES ($1::uuid, $2::uuid, 'sistemi', $3, 'detto', 'tutti', 'attivo', 'manuale', $4, $5::timestamptz)`,
    [id, ids.ws, statement, needsCheck, lastConfirmedAt],
  );
  return id;
}

before(async () => {
  if (!enabled) return;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  await installAppModules({
    "@/lib/auth": `export const auth = async () => globalThis.__prova.session;`,
    "next/cache": `export function revalidatePath(path, type) { globalThis.__prova.revalidated.push(path + (type ? "|" + type : "")); }`,
    "next/server": `export function after(task) { globalThis.__prova.afterTasks.push(task); }`,
  });
  await enableTsxImports();
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, values = []) => sql.query(text, values) as Promise<Row[]>;
  await (await import("../../lib/db/ensure-schema.ts")).ensureDbSchema();
  verifyPage = (await import("../../app/(dashboard)/dashboard/[workspaceId]/contesto/verifica/page.tsx")).default as Page;
  actions = await import("../../lib/actions/context-work.ts");
  const react = await import("react");
  const server = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  // I pulsanti della pagina rileggono la pagina con il router dell'app: qui uno che non fa niente.
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: import("react").Context<object | null> };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  renderToStaticMarkup = (element) => server.renderToStaticMarkup(react.createElement(AppRouterContext.Provider, { value: router }, element as never));

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova verifica', $2)`, [ids.org, `org-verifica-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente di prova verifica')`, [ids.ws, ids.org]);
  for (const person of people) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], `Persona ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], ROLE[person]]);
  }
});

after(async () => {
  signIn(null);
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [people.map((p) => ids[p])]);
});

test("«Da verificare»: Lateral Space vede i fatti fermi, il cliente «non trovata»; «Ancora veri (n)» li rinfresca e la pagina si rilegge", opts, async () => {
  const sevenMonthsAgo = new Date(Date.now() - 213 * 86_400_000).toISOString();
  const staleStatement = `Il magazzino si chiude il venerdì ${suffix}.`;
  const freshStatement = `Il gestionale è un foglio di calcolo ${suffix}.`;
  const stale = await insertFact(staleStatement, sevenMonthsAgo, true);
  await insertFact(freshStatement, new Date().toISOString(), false);

  // Il cliente (revisore, non di Lateral Space): la pagina non c'è.
  assert.deepEqual(await openVerify("rev"), { html: null, digest: "NEXT_HTTP_ERROR_FALLBACK;404" });

  // Lateral Space: il fatto fermo, non quello fresco; nessuna casella spuntata; «Ancora veri (0)» spento.
  const page = await openVerify("ls");
  assert.ok(page.html, page.digest ?? "");
  const html = page.html!;
  assert.ok(html.includes(staleStatement), "il fatto da verificare");
  assert.ok(!html.includes(freshStatement), "un fatto riconfermato di recente non c'è");
  assert.ok(html.includes("Scritto a mano · Ultima conferma: "));
  assert.equal((html.match(/role="checkbox"[^>]*aria-checked="true"/g) ?? []).length, 0);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Ancora veri \(0\)<\/button>/);

  // «Ancora veri (n)»: il cliente no; Lateral Space sì, e «Contesto» si rilegge (con la riga di servizio e la pagina).
  signIn("rev");
  const denied = await actions.reconfirmFactsAction(ids.ws, [stale]);
  assert.deepEqual([denied.ok, denied.ok ? null : denied.error], [false, "permesso_mancante"]);
  signIn("ls");
  prova.revalidated = [];
  const done = await actions.reconfirmFactsAction(ids.ws, [stale]);
  assert.deepEqual(done, { ok: true, value: { reconfirmed: 1 } });
  assert.deepEqual(prova.revalidated, [`/dashboard/${ids.ws}/contesto|layout`]);
  const [row] = await q(`SELECT needs_check, version, last_confirmed_at > now() - interval '1 minute' AS fresh FROM context_facts WHERE id = $1::uuid`, [stale]);
  assert.deepEqual(row, { needs_check: false, version: 1, fresh: true }, "il segno tolto, la data di oggi, nessuna versione nuova");
  // Senza sessione nessuna riconferma.
  signIn(null);
  const anonymous = await actions.reconfirmFactsAction(ids.ws, [stale]);
  assert.equal(anonymous.ok, false);

  // La pagina di nuovo: niente da verificare.
  const empty = await openVerify("ls");
  assert.ok(empty.html?.includes("Niente da verificare.") && empty.html.includes("Torna alla memoria"));
  assert.equal(prova.afterTasks.length, 0, "nessuna riscrittura di «In breve» per una riconferma");
});
