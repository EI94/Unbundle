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

/** Il passo «Informazioni» del percorso della scheda: dal suo `<li>` al successivo. */
function infoStepOf(page: string): string {
  const start = page.indexOf('data-step="informazioni"');
  return start === -1 ? "" : page.slice(start, page.indexOf("</li>", start));
}

test("la scheda: niente chip nella testata; il passo «Informazioni» del percorso; in cima a «Cosa serve» una riga con i conteggi", opts, async () => {
  const page = await detailHtml("builder", cards.wait);
  const header = page.slice(page.indexOf('data-slot="detail-header"'), page.indexOf("</header>"));
  // La testata dei revisori non dice più fase e informazioni: lo dicono il percorso e «Prossimo passo».
  for (const slot of ["phase-pill", "info-chip"]) assert.ok(!header.includes(`data-slot="${slot}"`), slot);
  assert.ok(!page.includes("Informazioni: in attesa"), "nessun chip, in nessun punto della scheda");
  // Da valutare: il passo «Informazioni» viene dopo, senza conteggi.
  assert.match(infoStepOf(page), /data-state="dopo"/);
  assert.doesNotMatch(textOf(infoStepOf(page)), /\d di \d|a posto/, "nessun conteggio prima dell'approvazione");
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
  assert.ok(!verify.includes("Informazioni: da verificare") && !verify.includes('data-slot="info-chip"'));
  // La da verificare è tra le ricevute: tra parentesi, così ricevute e «da chiedere» fanno il totale.
  assert.equal(textOf(summaryOf(verify)), `1${N}di ${verifyTotal}${N}informazioni ricevute (1 da verificare)${N}· ${verifyTotal - 1}${N}da${N}chiedere`);
  // La stessa, approvata per questo trimestre (G1): «Vedi le risposte» è il pulsante pieno del riquadro
  // e porta a «Cosa serve». Poi torna una proposta, come la vogliono le prove della pagina «Use case».
  const { currentQuarter } = await import("../../../../lib/use-cases/quarter.ts");
  await q(`UPDATE use_cases SET status = 'accepted', portfolio_review_status = 'scored', target_quarter = $2 WHERE id = $1::uuid`, [cards.verify, currentQuarter()]);
  const verifyApproved = await detailHtml("builder", cards.verify);
  await q(`UPDATE use_cases SET status = 'proposed', portfolio_review_status = 'in_review', target_quarter = NULL WHERE id = $1::uuid`, [cards.verify]);
  assert.match(verifyApproved, /data-slot="next-step" data-key="G1"/);
  const verifyBox = verifyApproved.slice(verifyApproved.indexOf('data-slot="next-step"'), verifyApproved.indexOf('data-slot="scheda-grid"'));
  // (Rilascio 6, B.1) Il passo è un pulsante con l'icona e il verbo: «Verifica le risposte».
  const seeAnswers = /<a\b([^>]*)><svg\b[\s\S]*?<\/svg>Verifica le risposte<\/a>/.exec(verifyBox);
  assert.ok(seeAnswers && /\shref="#cosa-serve"/.test(seeAnswers[1]) && /\sclass="[^"]*\bbg-primary\b/.test(seeAnswers[1]), "G1: «Verifica le risposte» pieno, verso #cosa-serve");
  assert.match(verifyApproved, /id="cosa-serve"/, "l'ancora c'è");
  const silent = await detailHtml("builder", cards.silent);
  const silentTotal = (await needsOf(cards.silent)).length;
  // Approvata per questo trimestre: «Informazioni» è il passo di adesso, con «0 di N»; il riquadro dice di sollecitare.
  assert.match(infoStepOf(silent), /data-state="adesso"/);
  assert.ok(textOf(infoStepOf(silent)).endsWith(`0 di ${silentTotal}`), textOf(infoStepOf(silent)));
  assert.match(silent, /data-slot="next-step" data-key="G2"/);
  // Con una richiesta inviata «Sollecita le risposte» è il pulsante pieno del riquadro e porta a «Richieste inviate».
  const silentBox = silent.slice(silent.indexOf('data-slot="next-step"'), silent.indexOf('data-slot="scheda-grid"'));
  const seeRequests = /<a\b([^>]*)><svg\b[\s\S]*?<\/svg>Sollecita le risposte<\/a>/.exec(silentBox);
  assert.ok(seeRequests && /\shref="#richieste"/.test(seeRequests[1]) && /\sclass="[^"]*\bbg-primary\b/.test(seeRequests[1]), "G2: «Sollecita le risposte» pieno, verso #richieste");
  assert.match(silent, /<details id="richieste"/, "l'ancora c'è");
  assert.ok(!silent.includes("Informazioni: senza risposta"));
  assert.equal(textOf(summaryOf(silent)), `0${N}di ${silentTotal}${N}informazioni ricevute${N}· 2${N}senza${N}risposta${N}· ${silentTotal - 2}${N}da${N}chiedere`);
  // (Rilascio 4) Una parola sola, la stessa della campanella: «Nessuna risposta».
  assert.ok(silent.includes('data-slot="referent-request-word" class="text-xs font-medium">Nessuna risposta</p>'), "la richiesta scaduta senza risposta, in una parola, nelle «Richieste»");
  const done = await detailHtml("builder", cards.done);
  assert.match(infoStepOf(done), /data-state="fatto"/);
  assert.ok(textOf(infoStepOf(done)).endsWith("a posto"), textOf(infoStepOf(done)));
  assert.match(done, /data-slot="next-step" data-key="G9"/, "complete: avviare la realizzazione");
  assert.ok(textOf(summaryOf(done)).endsWith(`${N}· tutte${N}a${N}posto`), textOf(summaryOf(done)));
  const ask = await detailHtml("builder", cards.ask);
  const askTotal = (await needsOf(cards.ask)).length;
  assert.ok(!ask.includes("Informazioni: da chiedere"));
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

test("la pagina «Use case»: (rilascio 5) nelle righe e nelle card lo stato del referente al posto del chip corto; il filtro «Informazioni» con i cinque stati", opts, async () => {
  const decide = await hubHtml("builder", { vista: "da-decidere" });
  // (Rilascio 5, §10.3) Il chip corto di «Raccolta informazioni» non c'è più: c'è lo stato del referente.
  assert.ok(!itemHtml(decide, "use-case-row", cards.verify).includes('data-slot="info-chip"'));
  // Le richieste qui sono di sole domande: nessun referente, quindi «Manca il referente» (vince su «da verificare», D21).
  assert.ok(itemHtml(decide, "use-case-row", cards.verify).includes('data-slot="referent-chip" data-state="manca"'));
  for (const key of ["ask", "wait"] as const) assert.ok(!itemHtml(decide, "use-case-row", cards[key]).includes('data-slot="info-chip"'), key);
  // Le card delle corsie della Panoramica.
  const overview = await hubHtml("builder", { vista: "panoramica" });
  assert.ok(itemHtml(overview, "lane-card", cards.silent).includes('data-slot="referent-chip"'));
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

/** L'elemento `Arrival` della scheda: l'ancora a cui la pagina arriva con il suo `?capitolo=` (`initial`). */
function arrivalOf(page: unknown): string | null {
  type El = { type?: unknown; props?: Record<string, unknown> };
  const named = (node: unknown, name: string): El | null => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = named(child, name);
        if (found) return found;
      }
      return null;
    }
    if (!node || typeof node !== "object" || !("props" in node)) return null;
    const el = node as El;
    if (typeof el.type === "function" && (el.type as { name?: string }).name === name) return el;
    return named(el.props?.children, name);
  };
  const view = named(page, "UseCaseDetailView");
  assert.ok(view, "la pagina monta UseCaseDetailView");
  // UseCaseDetailView è un componente del server senza hook: chiamato con le sue props dà l'albero della scheda.
  const arrival = named((view.type as (props: unknown) => unknown)(view.props), "Arrival");
  return (arrival?.props?.initial as string | null | undefined) ?? null;
}

/** La scheda aperta da un link (campanella, email): dove arriva, il tag e il contenuto di «Richieste inviate». */
async function landingOf(person: Person, card: string, href: string) {
  state.__hubServeSession = session(person);
  const searchParams = Object.fromEntries(new URL(href, "http://localhost:3000").searchParams);
  const element = await pageOfDetail({ params: Promise.resolve({ workspaceId: ids.ws, useCaseId: card }), searchParams: Promise.resolve(searchParams) });
  const html = readable(renderToStaticMarkup(element));
  const tag = /<details id="richieste"[^>]*>/.exec(html);
  return {
    html,
    target: person === "contributor" ? null : arrivalOf(element),
    tag: tag?.[0] ?? null,
    requests: tag ? html.slice(tag.index, html.indexOf("</details>", tag.index)) : "",
  };
}

test("`?capitolo=richieste`: «Richieste inviate» aperta dal server con «Chiedi di nuovo»; senza richieste, «Cosa serve»", opts, async () => {
  const landing = await landingOf("builder", cards.silent, "/x?capitolo=richieste");
  assert.equal(landing.target, "richieste", "arriva a «Richieste inviate» (il fuoco va al suo riassunto)");
  assert.ok(landing.tag, "la piega «Richieste inviate» c'è");
  assert.match(landing.tag!, /\sopen=""/, "aperta dal server");
  assert.ok(landing.requests.includes("Chiedi di nuovo") && landing.requests.includes("Nessuna risposta"), "la richiesta scaduta con «Chiedi di nuovo»");
  // Con `?capitolo=cosa-serve` (risposte, documenti, informazioni complete) la piega resta chiusa.
  const needs = await landingOf("builder", cards.silent, "/x?capitolo=cosa-serve");
  assert.equal(needs.target, "cosa-serve");
  assert.ok(needs.tag && !/\sopen=""/.test(needs.tag), "con «Cosa serve» «Richieste inviate» resta chiusa");
  // Una scheda senza richieste: arriva a «Cosa serve», nessuna piega da aprire.
  const none = await landingOf("builder", cards.ask, "/x?capitolo=richieste");
  assert.equal(none.target, "cosa-serve");
  assert.equal(none.tag, null);
  assert.match(none.html, /id="cosa-serve"/);
  // Il contributore: la sua scheda, senza «Cosa serve» né richieste.
  const contributor = await landingOf("contributor", cards.silent, "/x?capitolo=richieste");
  assert.ok(!contributor.html.includes('id="cosa-serve"') && contributor.tag === null && !contributor.html.includes("Chiedi di nuovo"));
});

test("«Nessuna risposta»: la riga della campanella e l'email di chi ha chiesto con il solo seguito portano a «Richieste inviate»", opts, async () => {
  const { noticeHref } = await import("../../../../lib/notifications/bell.ts");
  const { planRequesterAlert } = await import("../../../../lib/use-cases/referent/alerts.ts");
  const now = new Date();
  // L'email a chi ha chiesto con il solo seguito («il link è scaduto»), come la pianifica l'invio.
  const plan = planRequesterAlert(
    { id: "a1", workspaceId: ids.ws, recipientUserId: ids.builder, sendOn: "2026-11-02", scheduledAt: now, dueAt: now, attempts: 0 },
    {
      company: "Raccolta informazioni",
      featureOn: true,
      subprocessorsAuthorized: true,
      recipient: { email: emails.builder, verified: true, reviewer: true, alertsOn: true },
      items: [{ requestId: randomUUID(), useCaseId: cards.silent, code: "RI-1", title: "Scheda silent", createdAt: now, answers: 0, unknowns: 0, documents: 0, followUp: "scaduta", requestPurged: false }],
    },
    { env: ENV, origin: "http://localhost:3000", now },
  );
  assert.equal(plan.action, "send");
  const links = { campanella: noticeHref(ids.ws, { kind: "senza_risposta", useCaseId: cards.silent }), email: plan.action === "send" ? plan.input.entries[0].link : "" };
  for (const [from, href] of Object.entries(links)) {
    assert.ok(href.endsWith(`/use-cases/${cards.silent}?capitolo=richieste`), `${from}: ${href.replace(ids.ws, "<ws>").replace(cards.silent, "<uc>")}`);
    const landing = await landingOf("builder", cards.silent, href);
    assert.equal(landing.target, "richieste", from);
    assert.match(landing.tag ?? "", /\sopen=""/, from);
    assert.ok(landing.requests.includes("Chiedi di nuovo"), from);
  }
});
