import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// «Raccolta informazioni» nelle pagine vere (SPEC §P2.10.3–5, §P2.12.3), con una scheda per stato:
// - la scheda, per un revisore (function_lead): il chip accanto alla pillola della fase con solo lo
//   stato a parole, che non sembra una fase; in cima a «Cosa serve» una riga sola, «N di M
//   informazioni ricevute» (tra parentesi le da verificare) e che cosa resta, gruppo per gruppo
//   (rilascio «Pulizia»: niente date, niente frasi);
// - la pagina «Use case»: il chip corto solo nelle righe di «Da decidere» e nelle card della Panoramica
//   che chiedono a qualcuno di fare qualcosa («da verificare», «senza risposta»); il filtro
//   «Informazioni» con i cinque stati;
// - il contributore: niente di tutto questo; la fase non cambia mai da sola.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
// 127.0.0.1). Dati sintetici, creati e cancellati qui. Nessuna email vera.
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

type PageProps = { params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string>> };
type Page = (props: PageProps) => Promise<unknown>;
type Ctx = import("../../../../lib/use-cases/service.ts").WriteContext;

let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let renderToStaticMarkup: (element: unknown) => string;
let pageOfDetail: Page;
let pageOfUseCases: Page;
let referents: typeof import("../../../../lib/db/queries/use-case-referents.ts");
let hub: typeof import("../../hub.tsx");
let access: typeof import("../../../../lib/workspace-access.ts");
let progress: typeof import("../../../../lib/use-cases/info-progress.ts");

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), contributor: randomUUID() };
type Person = "builder" | "contributor";
const PEOPLE: Person[] = ["builder", "contributor"];
const ROLE: Record<Person, string> = { builder: "function_lead", contributor: "contributor" };
const emails: Record<Person, string> = { builder: `giulia.info.${suffix}@cliente.test`, contributor: `contrib.info.${suffix}@cliente.test` };
const MARIO = { id: randomUUID(), email: `mario.info.${suffix}@cliente.test` };
type CardKey = "ask" | "wait" | "verify" | "silent" | "done";
const CARDS: CardKey[] = ["ask", "wait", "verify", "silent", "done"];
const codeBase = 1000 + Math.floor(Math.random() * 8000);
const cards = Object.fromEntries(CARDS.map((key) => [key, randomUUID()])) as Record<CardKey, string>;
const storageDir = mkdtempSync(join(tmpdir(), "referenti-info-"));
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
const state = globalThis as { __hubServeSession?: unknown };

function as(person: Person): Ctx {
  return { workspaceId: ids.ws, actor: { userId: ids[person], role: ROLE[person], isLateralSpace: false, kind: "persona" }, channel: "pagina" };
}
function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}
const session = (person: Person) => ({ user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}`, image: null } });
function readable(page: string): string {
  return page.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
async function detailHtml(person: Person, card: string): Promise<string> {
  state.__hubServeSession = session(person);
  return readable(renderToStaticMarkup(await pageOfDetail({ params: Promise.resolve({ workspaceId: ids.ws, useCaseId: card }), searchParams: Promise.resolve({}) })));
}
async function hubHtml(person: Person, searchParams: Record<string, string>): Promise<string> {
  state.__hubServeSession = session(person);
  return readable(renderToStaticMarkup(await pageOfUseCases({ params: Promise.resolve({ workspaceId: ids.ws }), searchParams: Promise.resolve(searchParams) })));
}
function findProp(node: unknown, name: string): unknown[] {
  const out: unknown[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object" && "props" in value) {
      const props = (value as { props: Record<string, unknown> }).props;
      if (props && Object.hasOwn(props, name)) out.push(props[name]);
      if (props) {
        visit(props.children);
        for (const [key, inner] of Object.entries(props)) if (key !== "children" && inner && typeof inner === "object" && "props" in inner) visit(inner);
      }
    }
  };
  visit(node);
  return out;
}
/** Il pezzo di HTML di un elemento con `data-slot` e `data-id`, fino alla prossima riga dello stesso tipo. */
function itemHtml(page: string, slot: string, id: string): string {
  const start = page.indexOf(`data-slot="${slot}" data-id="${id}"`);
  assert.ok(start >= 0, `manca ${slot} ${id}`);
  const next = page.indexOf(`data-slot="${slot}"`, start + 10);
  return page.slice(start, next === -1 ? undefined : next);
}
async function needsOf(card: string): Promise<string[]> {
  const rows = await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid AND n.archived_at IS NULL ORDER BY n.sort_order, n.id`, [card]);
  return rows.map((r) => String(r.id));
}

before(async () => {
  if (!enabled) return;
  const { default: ts } = await import("typescript");
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "@/lib/auth": stub("export async function auth() { return globalThis.__hubServeSession ?? null; }"),
    "next/cache": stub(
      "export function revalidatePath() {}\nexport function revalidateTag() {}\nexport function refresh() {}\nexport function updateTag() {}\n" +
        "export function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}",
    ),
    "@/lib/portfolio/ai-ranking": stub(
      "export async function generatePortfolioScoresWithAi() { throw new Error('non in questa prova'); }\n" +
        "export async function autoScorePortfolioUseCase() { throw new Error('non in questa prova'); }\n" +
        "export async function scorePortfolioUseCaseWithAi() { throw new Error('non in questa prova'); }\n" +
        "export async function recalibrateWorkspacePortfolioWithAi() { throw new Error('non in questa prova'); }",
    ),
    "@/components/dashboard/use-case-matrix": stub("export function UseCaseMatrix() { return null; }"),
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
  const { createElement } = await import("react");
  const { renderToStaticMarkup: toHtml } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as {
    AppRouterContext: import("react").Context<object | null>;
  };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  renderToStaticMarkup = (element) => toHtml(createElement(AppRouterContext.Provider, { value: router }, element as never));

  ENV.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  for (const key of ["UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS"] as const) delete process.env[key];
  pageOfDetail = (await import("../../../../app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/page.tsx")).default as unknown as Page;
  pageOfUseCases = (await import("../../../../app/(dashboard)/dashboard/[workspaceId]/use-cases/page.tsx")).default as unknown as Page;
  referents = await import("../../../../lib/db/queries/use-case-referents.ts");
  hub = await import("../../hub.tsx");
  access = await import("../../../../lib/workspace-access.ts");
  progress = await import("../../../../lib/use-cases/info-progress.ts");
  const quarter = await import("../../../../lib/use-cases/quarter.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione raccolta informazioni', $2)`, [ids.org, `hub-info-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Raccolta informazioni')`, [ids.ws, ids.org]);
  for (const person of PEOPLE) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], ROLE[person]]);
  }
  for (const key of CARDS) {
    // «Da decidere»: le tre proposte; Panoramica: le due approvate per questo trimestre.
    const approved = key === "silent" || key === "done";
    await q(
      `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, origin, code, target_quarter, source, submitted_at)
       VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', $4::use_case_status, $5::portfolio_review_status, 'use_case_ai', 'adoption', $6, $7, 'web_proposed', now() - interval '2 days')`,
      [cards[key], ids.ws, `Scheda ${key} ${suffix}`, approved ? "accepted" : "proposed", approved ? "scored" : "in_review", `RI-${codeBase + CARDS.indexOf(key)}`, approved ? quarter.currentQuarter() : null],
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
  await q(`DELETE FROM uc_contacts WHERE workspace_id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [PEOPLE.map((p) => ids[p])]);
});

const phases: Record<string, string> = {};

test("preparazione: una scheda per stato, con richieste, risposte e scadenze vere", opts, async () => {
  for (const key of CARDS) phases[key] = String((await q(`SELECT status, portfolio_review_status FROM use_cases WHERE id = $1::uuid`, [cards[key]]))[0]?.status);
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $2::uuid, 'Mario Rossi', $3)`, [MARIO.id, ids.ws, MARIO.email]);
  for (const key of CARDS) ok(await referents.prepareReferentQuestions(as("builder"), cards[key]), `Prepara ${key}`);
  const ask = async (card: string, n: number) =>
    ok(
      await referents.sendReferentRequest(as("builder"), card, { contact: { kind: "esistente", contactId: MARIO.id }, needIds: (await needsOf(card)).slice(0, n) }, { env: ENV, requester: { name: "Persona builder", emailVerified: true } }),
      "invio",
    );
  await ask(cards.wait, 2);
  const silent = await ask(cards.silent, 2);
  // Il link è scaduto senza risposta: la richiesta resta «inviata» nel database, il revisore la legge scaduta.
  await q(`UPDATE use_case_referent_requests SET created_at = now() - interval '31 days', sent_at = now() - interval '31 days', expires_at = now() - interval '1 minute' WHERE id = $1::uuid`, [silent.requestId]);
  const [v0] = await needsOf(cards.verify);
  ok(await referents.addReviewerAnswer(as("builder"), cards.verify, v0, { text: "Circa venti fatture al giorno." }, ENV), "risposta del team");
  await q(`UPDATE use_case_needs n SET status = 'validata' FROM use_case_need_links l WHERE l.need_id = n.id AND l.use_case_id = $1::uuid`, [cards.done]);
});

/** Il testo di un pezzo di HTML, senza i tag. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, "");
/** Il blocco in cima a «Cosa serve»: dal suo `<div>` al primo `</div>`. */
function summaryOf(page: string): string {
  const start = page.lastIndexOf("<div", page.indexOf('data-slot="info-summary"'));
  assert.ok(start >= 0, "il riepilogo in cima a «Cosa serve»");
  return page.slice(start, page.indexOf("</div>", start) + "</div>".length);
}

test("la scheda: nella testata solo lo stato a parole, non una pillola; in cima a «Cosa serve» una riga con i conteggi", opts, async () => {
  const page = await detailHtml("builder", cards.wait);
  const header = page.slice(page.indexOf('data-slot="detail-header"'), page.indexOf("</header>"));
  const pill = header.indexOf('data-slot="phase-pill"');
  const chip = header.indexOf('data-slot="info-chip"');
  assert.ok(pill >= 0 && chip > pill, "il chip viene subito dopo la pillola della fase");
  const chipHtml = header.slice(chip - 300, header.indexOf("</span></span>", chip));
  assert.match(chipHtml, /aria-label="Informazioni: in attesa"/);
  assert.ok(header.includes(">Informazioni: in attesa</span>"), "il testo visibile del chip");
  // Nella testata niente date, promemoria o numeri dopo «Informazioni:».
  const words = header.slice(header.indexOf(">Informazioni:") + 1);
  const said = words.slice(0, words.indexOf("<"));
  assert.equal(said, "Informazioni: in attesa");
  assert.doesNotMatch(said.slice("Informazioni:".length), /dal |promemoria|\d/, said);
  const chipTag = header.slice(header.lastIndexOf("<span", chip), header.indexOf(">", chip));
  assert.doesNotMatch(chipTag, /rounded-full|border/, chipTag);
  // In cima a «Cosa serve»: una riga, i conteggi e che cosa resta; niente titolo, chip o maiuscolo.
  const summary = summaryOf(page);
  const total = (await needsOf(cards.wait)).length;
  // A schermo ogni gruppo resta intero e il «·» con il gruppo prima (U+00A0).
  const N = "\u00a0";
  assert.equal(textOf(summary), `0${N}di ${total}${N}informazioni ricevute${N}· 2${N}in${N}attesa${N}· ${total - 2}${N}da${N}chiedere`);
  assert.match(summary, new RegExp(`aria-label="${progress.INFO_PROGRESS_TEXT.summaryHeading}"`));
  for (const text of ["Informazioni:", 'data-slot="info-chip"', "uppercase"]) assert.ok(!summary.includes(text), `riepilogo: ${text}`);
  // Da verificare e senza risposta: i conteggi giusti; la fase non cambia mai da sola.
  const verify = await detailHtml("builder", cards.verify);
  const verifyTotal = (await needsOf(cards.verify)).length;
  assert.ok(verify.includes("Informazioni: da verificare"));
  // La da verificare è tra le ricevute: tra parentesi, così ricevute e «da chiedere» fanno il totale.
  assert.equal(textOf(summaryOf(verify)), `1${N}di ${verifyTotal}${N}informazioni ricevute (1 da verificare)${N}· ${verifyTotal - 1}${N}da${N}chiedere`);
  const silent = await detailHtml("builder", cards.silent);
  const silentTotal = (await needsOf(cards.silent)).length;
  assert.ok(silent.includes("Informazioni: senza risposta"));
  assert.equal(textOf(summaryOf(silent)), `0${N}di ${silentTotal}${N}informazioni ricevute${N}· 2${N}senza${N}risposta${N}· ${silentTotal - 2}${N}da${N}chiedere`);
  assert.ok(silent.includes("Scaduta senza risposta"), "la richiesta in rosso, con la sua data nelle «Richieste»");
  const done = await detailHtml("builder", cards.done);
  assert.ok(done.includes("Informazioni: complete"));
  assert.ok(textOf(summaryOf(done)).endsWith(`${N}· tutte${N}a${N}posto`), textOf(summaryOf(done)));
  const ask = await detailHtml("builder", cards.ask);
  const askTotal = (await needsOf(cards.ask)).length;
  assert.ok(ask.includes("Informazioni: da chiedere"));
  assert.ok(textOf(summaryOf(ask)).endsWith(`${N}· ${askTotal}${N}da${N}chiedere`), textOf(summaryOf(ask)));
  for (const key of CARDS) assert.equal(String((await q(`SELECT status FROM use_cases WHERE id = $1::uuid`, [cards[key]]))[0]?.status), phases[key], `${key}: la fase resta`);
});

test("il contributore non vede né il chip né il riepilogo né il testo dello stato", opts, async () => {
  for (const key of CARDS) {
    const page = await detailHtml("contributor", cards[key]);
    for (const text of ["data-slot=\"info-chip\"", "data-slot=\"info-summary\"", "Informazioni:", "informazioni ricevute", progress.INFO_PROGRESS_TEXT.summaryHeading]) assert.ok(!page.includes(text), `${key}: ${text}`);
  }
  for (const vista of ["da-decidere", "panoramica"]) {
    const page = await hubHtml("contributor", { vista });
    assert.ok(!page.includes('data-slot="info-chip"'), vista);
    assert.ok(!page.includes("Info: "), vista);
  }
});

test("la pagina «Use case»: il chip corto solo per «da verificare» e «senza risposta»; il filtro con i cinque stati", opts, async () => {
  const decide = await hubHtml("builder", { vista: "da-decidere" });
  assert.ok(itemHtml(decide, "use-case-row", cards.verify).includes("Info: da verificare"));
  for (const key of ["ask", "wait"] as const) assert.ok(!itemHtml(decide, "use-case-row", cards[key]).includes('data-slot="info-chip"'), key);
  // Le card delle corsie della Panoramica.
  const overview = await hubHtml("builder", { vista: "panoramica" });
  assert.ok(itemHtml(overview, "lane-card", cards.silent).includes("Info: senza risposta"));
  assert.ok(!itemHtml(overview, "lane-card", cards.done).includes('data-slot="info-chip"'));
  // Il filtro «Informazioni»: cinque voci nell'ordine fisso.
  const workspaceAccess = await access.getWorkspaceAccessForUser(ids.builder, ids.ws);
  assert.ok(workspaceAccess);
  const data = await hub.loadUseCaseHub({ workspaceId: ids.ws, session: session("builder") as never, access: workspaceAccess, searchParams: { vista: "da-decidere" } });
  assert.ok(data?.info);
  const [more] = findProp(hub.UseCaseHub({ data }) as unknown, "more") as Array<{ infos?: Array<{ value: string; label: string }> }>;
  assert.deepEqual(more.infos?.map((o) => o.label), ["Da chiedere", "In attesa", "Da verificare", "Senza risposta", "Complete"]);
  // Con il filtro, solo le schede di quello stato.
  const filtered = await hubHtml("builder", { vista: "da-decidere", info: "da-verificare" });
  assert.ok(filtered.includes(`data-id="${cards.verify}"`));
  for (const key of ["ask", "wait"] as const) assert.ok(!filtered.includes(`data-id="${cards[key]}"`), key);
  // Il contributore non ha il filtro: il parametro si ignora.
  const contributorAccess = await access.getWorkspaceAccessForUser(ids.contributor, ids.ws);
  const forContributor = await hub.loadUseCaseHub({ workspaceId: ids.ws, session: session("contributor") as never, access: contributorAccess!, searchParams: { vista: "da-decidere", info: "da-verificare" } });
  assert.equal(forContributor?.info, null);
  assert.equal(forContributor?.params.info, null);
});
