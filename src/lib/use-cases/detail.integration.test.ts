import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format?: string; source?: string | Uint8Array; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult;
    load?(url: string, context: object, nextLoad: (url: string, context: object) => LoadResult): LoadResult;
  }): void;
};

// La scheda `/use-cases/[id]` (docs/use-case/PIANO-LAVORI.md H4b; docs/use-case/DESIGN.md §6,
// §7.5, §7.6, §11; decisioni D3, D4, D13): le server action di src/lib/actions/use-case-edit.ts
// con una sessione finta, la pagina resa in HTML per ruolo, e i pezzi puri dei capitoli.
//
// Due modi:
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del
//   pacchetto hub_<id> su 127.0.0.1): `@/lib/auth` diventa un modulo che restituisce la
//   sessione scelta dalla prova; ruolo, accesso e «Lateral Space» si rileggono dal database come
//   nell'app. `revalidatePath` registra i percorsi; il modello dell'AI è finto (nessuna chiamata
//   al modello vero). I file `.tsx` si traducono qui con TypeScript.
// - Sul harness (HUB_DETAIL_HARNESS=1, app e login dell'hub avviati sul database del pacchetto
//   con l'area accesa per il workspace «a», fixture di seed-fixtures.mjs e seed-hub.mjs):
//   `fetch` dell'HTML e il browser (scripts/uc-test/cdp.mjs) per le prove di PIANO H4b che
//   guardano il contenuto: scheda nascosta altrui «Use case non trovato» con `noindex` (sotto
//   loading.tsx lo stato è 200), `/use-cases/nuovo` con l'area spenta, la versione superata con
//   il toast e il testo che resta nel campo, «Modifica valutazione» che dopo una versione
//   superata non riporta indietro la valutazione di un collega, e l'ancora di `?capitolo=`.
//   run-db-tests.mjs (`npm run test:use-cases:db`) NON le esegue: non passa HUB_DETAIL_HARNESS
//   né le porte. Si lanciano a mano, con l'app avviata da
//   `node scripts/uc-test/start-app.mjs --flag USE_CASE_HUB_WORKSPACES=<id del workspace «a»>`:
//
//     env -i PATH="$PATH" HOME="$HOME" UC_TEST_ROOT=/private/tmp/<dir>/hub \
//       UC_TEST_PG_PORT=55479 UC_TEST_PG_DB=hub_<id> UC_TEST_APP_PORT=53120 UC_TEST_LOGIN_PORT=53122 \
//       HUB_DETAIL_HARNESS=1 node --no-warnings --import=./scripts/use-case-test/test-hooks.mjs \
//       --test --test-concurrency=1 src/lib/use-cases/detail.integration.test.ts
//
//   In questo modo le prove del database si saltano (HUB_TEST_ISOLATED non c'è) e girano solo
//   quelle del harness; senza UC_TEST_ROOT, UC_TEST_APP_PORT o UC_TEST_LOGIN_PORT falliscono.
// Dentro `npm run check` si salta: in testa solo moduli di Node; i moduli dell'app arrivano con
// `await import()` dentro `before()`. Dati sintetici, creati e cancellati qui.
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

type Actions = typeof import("../actions/use-case-edit.ts");
type Result = import("./decision-ui.ts").DecisionActionResult;
type PageProps = { params: Promise<Record<string, string>>; searchParams?: Promise<Record<string, string>> };
type Page = (props: PageProps) => Promise<unknown>;

let actions: Actions;
let detailModule: typeof import("../../components/use-cases/detail/detail.tsx");
let historyModule: typeof import("../../components/use-cases/detail/section-history.tsx");
let intakeModule: typeof import("../../components/use-cases/detail/intake-details.tsx");
let estimateModule: typeof import("./estimates.ts");
let whatModule: typeof import("../../components/use-cases/detail/section-what.tsx");
let valuationModule: typeof import("../../components/use-cases/detail/section-valuation.tsx");
let formModule: typeof import("../../components/use-cases/detail/valuation-form.tsx");
let aiBoxModule: typeof import("../../components/use-cases/detail/ai-suggestion-box.tsx");
let realizationModule: typeof import("../../components/use-cases/detail/section-realization.tsx");
let inlineModule: typeof import("../../components/use-cases/detail/inline-text-field.tsx");
let chapterNavModule: typeof import("../../components/use-cases/detail/chapter-nav.tsx");
let hideModule: typeof import("../../components/use-cases/detail/hide-from-search-item.tsx");
let notFoundPage: () => unknown;
let pages: { detail: Page; nuovo: Page };
let renderToStaticMarkup: (element: unknown) => string;
let createElementOf: (type: unknown, props: Record<string, unknown> | null) => unknown;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  wsOff: randomUUID(),
  lsLead: randomUUID(),
  lsAnalyst: randomUUID(),
  builder: randomUUID(),
  sponsor: randomUUID(),
  contributor: randomUUID(),
  learner: randomUUID(),
  outsider: randomUUID(),
};
const emails = {
  lsLead: `lslead.${suffix}@ls.test`,
  lsAnalyst: `lsanalyst.${suffix}@ls.test`,
  builder: `builder.${suffix}@cliente.test`,
  sponsor: `sponsor.${suffix}@cliente.test`,
  contributor: `contributor.${suffix}@cliente.test`,
  learner: `learner.${suffix}@cliente.test`,
  outsider: `outsider.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;
const NAMES: Record<Person, string> = {
  lsLead: "Lucia Lateral",
  lsAnalyst: "Andrea Analisi",
  builder: "Bruno Builder",
  sponsor: "Sara Sponsor",
  contributor: "Carla Contributo",
  learner: "Luca Corso",
  outsider: "Omar Esterno",
};

const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "VERCEL_ENV"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

interface AiStub {
  calls: number;
  fail?: boolean;
  during?: () => Promise<void>;
  scores?: Record<string, Record<string, number>>;
}
const state = globalThis as { __hubH4bSession?: unknown; __hubH4bRevalidated?: string[]; __hubH4bAi?: AiStub };

function signIn(person: Person | null): void {
  state.__hubH4bSession = person
    ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: NAMES[person], image: null } }
    : null;
}

function revalidated(): string[] {
  const paths = state.__hubH4bRevalidated ?? [];
  state.__hubH4bRevalidated = [];
  return paths;
}

function ai(): AiStub {
  state.__hubH4bAi ??= { calls: 0 };
  return state.__hubH4bAi;
}

const codeBase = 10_000 + Math.floor(Math.random() * 80_000);
let codeSeq = 0;

interface CardSeed {
  workspaceId?: string;
  title?: string;
  description?: string | null;
  flowDescription?: string | null;
  status?: string;
  review?: string;
  kind?: string | null;
  code?: string | null;
  intake?: Record<string, unknown> | null;
  publicNote?: string | null;
  reviewedBy?: string | null;
  targetQuarter?: string | null;
  proposedBy?: string | null;
  origin?: string;
  customScores?: Record<string, unknown> | null;
  aiSuggestion?: Record<string, unknown> | null;
  reviewNotes?: string | null;
  timeline?: string | null;
}

/** Una scheda sintetica in uno stato preciso, scritta senza passare dal servizio. */
async function seed(c: CardSeed = {}): Promise<{ id: string; code: string | null; title: string }> {
  const id = randomUUID();
  const code = c.code === undefined ? `XX-${codeBase + codeSeq++}` : c.code;
  const title = c.title ?? `Scheda di prova ${suffix} ${codeSeq}`;
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, flow_description, status, portfolio_review_status, portfolio_kind, code,
       intake, public_note, reviewed_by, target_quarter, source, proposed_by, origin, custom_scores, ai_suggestion, review_notes, timeline)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::use_case_status, $7::portfolio_review_status, $8, $9,
       $10::jsonb, $11, $12::uuid, $13, 'web_proposed', $14, $15, $16::jsonb, $17::jsonb, $18, $19)`,
    [
      id,
      c.workspaceId ?? ids.ws,
      title,
      c.description === undefined ? "Problema di prova" : c.description,
      c.flowDescription ?? null,
      c.status ?? "proposed",
      c.review ?? "in_review",
      c.kind === undefined ? "use_case_ai" : c.kind,
      code,
      c.intake === undefined ? null : JSON.stringify(c.intake),
      c.publicNote ?? null,
      c.reviewedBy ?? null,
      c.targetQuarter ?? null,
      c.proposedBy === undefined ? `collega.${suffix}@cliente.test` : c.proposedBy,
      c.origin ?? "adoption",
      c.customScores ? JSON.stringify(c.customScores) : null,
      c.aiSuggestion ? JSON.stringify(c.aiSuggestion) : null,
      c.reviewNotes ?? null,
      c.timeline ?? null,
    ],
  );
  return { id, code, title };
}

async function row(id: string): Promise<Record<string, unknown>> {
  const [r] = await q(`SELECT * FROM use_cases WHERE id = $1::uuid`, [id]);
  assert.ok(r, "la scheda c'è");
  return r;
}

async function versionOf(id: string): Promise<number> {
  return Number((await row(id)).version);
}

async function storia(id: string): Promise<Record<string, unknown>[]> {
  return q(`SELECT action, channel, actor_kind, actor_user_id, fields, phase_before, phase_after FROM use_case_events WHERE use_case_id = $1::uuid ORDER BY at, id`, [id]);
}

function ok(result: Result, label = "esito"): Extract<Result, { ok: true }> {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result;
}

function err(result: Result, error: string, label = "esito"): Extract<Result, { ok: false }> {
  assert.equal(result.ok, false, `${label}: atteso un errore ${error}`);
  assert.equal((result as { error?: string }).error, error, label);
  return result as Extract<Result, { ok: false }>;
}

function pathsOf(useCaseId: string, workspaceId = ids.ws): string[] {
  return [`/dashboard/${workspaceId}/use-cases`, `/dashboard/${workspaceId}/use-cases/${useCaseId}`];
}

const NOT_FOUND = /^NEXT_HTTP_ERROR_FALLBACK;404$/;

/** La pagina resa in HTML con la sessione di `person`, oppure il `digest` di `notFound()` o `redirect()`. */
async function open(
  page: Page,
  person: Person | null,
  params: Record<string, string>,
  searchParams: Record<string, string> = {},
): Promise<{ html: string; element: unknown; digest: null } | { html: null; element: null; digest: string }> {
  signIn(person);
  try {
    const element = await page({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) });
    return { html: renderToStaticMarkup(element), element, digest: null };
  } catch (error) {
    const digest = (error as { digest?: unknown })?.digest;
    if (typeof digest === "string") return { html: null, element: null, digest };
    throw error;
  }
}

async function detailHtml(person: Person, useCaseId: string, searchParams: Record<string, string> = {}, workspaceId = ids.ws) {
  const result = await open(pages.detail, person, { workspaceId, useCaseId }, searchParams);
  assert.equal(result.digest, null, `${person}: atteso HTML, non ${result.digest}`);
  return { html: result.html!, element: result.element };
}

type ReactNode = { type?: unknown; props?: Record<string, unknown> };

/** Gli elementi React dell'albero (senza rendere i componenti), in profondità. */
function elementsOf(node: unknown): ReactNode[] {
  const out: ReactNode[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object" && "props" in value) {
      const element = value as ReactNode;
      out.push(element);
      const props = element.props ?? {};
      for (const child of Object.values(props)) if (child && typeof child === "object") visit(child);
    }
  };
  visit(node);
  return out;
}

/**
 * L'albero della scheda come lo restituisce `UseCaseDetailView` con le prop che la pagina le dà:
 * così si leggono le prop dei pezzi del browser (testata, ancore) senza aprire menu e dialoghi.
 */
function detailTree(page: unknown): unknown {
  const view = elementsOf(page).find((el) => typeof el.type === "function" && (el.type as { name?: string }).name === "UseCaseDetailView");
  assert.ok(view, "la pagina monta UseCaseDetailView");
  return detailModule.UseCaseDetailView(view.props as never);
}

/** Le prop `name` degli elementi dell'albero della scheda. */
function findProp(page: unknown, name: string): unknown[] {
  return elementsOf(detailTree(page))
    .filter((el) => el.props && Object.hasOwn(el.props, name))
    .map((el) => el.props![name]);
}

/** Il testo di un capitolo nell'HTML, da `data-slot="<slot>"` alla sezione successiva. */
function sectionOf(html: string, slot: string): string {
  const start = html.indexOf(`data-slot="${slot}"`);
  if (start === -1) return "";
  const end = html.indexOf("<section", start + 10);
  return html.slice(start, end === -1 ? undefined : end);
}

before(async () => {
  if (!enabled) return;
  const { default: ts } = await import("typescript");
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    // La sessione della prova al posto dei cookie di Firebase.
    "@/lib/auth": stub("export async function auth() { return globalThis.__hubH4bSession ?? null; }"),
    // La cache di Next non c'è fuori da una richiesta: si registrano i percorsi.
    "next/cache": stub(
      "export function revalidatePath(path) { (globalThis.__hubH4bRevalidated ??= []).push(path); }\n" +
        "export function revalidateTag() {}\nexport function refresh() {}\nexport function updateTag() {}\n" +
        "export function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}",
    ),
    // Il modello dell'AI è finto: nessuna chiamata al modello vero, nessuna chiave.
    "@/lib/portfolio/ai-ranking": stub(
      "export async function generatePortfolioScoresWithAi() {\n" +
        "  const s = (globalThis.__hubH4bAi ??= { calls: 0 });\n" +
        "  s.calls += 1;\n" +
        "  if (s.fail) throw new Error('modello non raggiungibile');\n" +
        "  if (s.during) await s.during();\n" +
        "  return { customScores: s.scores ?? { impact: { efficiency: 4, profitability: 2 } }, rationale: 'Motivazione sintetica di prova.', model: 'finto' };\n" +
        "}\n" +
        // Gli altri export del modulo, che la pagina carica con le action del modulo completo: qui non si chiamano.
        "export async function autoScorePortfolioUseCase() { throw new Error('non in questa prova'); }\n" +
        "export async function scorePortfolioUseCaseWithAi() { throw new Error('non in questa prova'); }\n" +
        "export async function recalibrateWorkspacePortfolioWithAi() { throw new Error('non in questa prova'); }",
    ),
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
  actions = await import("../actions/use-case-edit.ts");
  const component = (name: string) => import(`../../components/use-cases/detail/${name}.tsx`);
  detailModule = await component("detail");
  historyModule = await component("section-history");
  intakeModule = await component("intake-details");
  estimateModule = await import("./estimates.ts");
  whatModule = await component("section-what");
  valuationModule = await component("section-valuation");
  formModule = await component("valuation-form");
  aiBoxModule = await component("ai-suggestion-box");
  realizationModule = await component("section-realization");
  inlineModule = await component("inline-text-field");
  chapterNavModule = await component("chapter-nav");
  hideModule = await component("hide-from-search-item");
  const page = async (path: string): Promise<Page> => (await import(path)).default as Page;
  pages = {
    detail: await page("../../app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/page.tsx"),
    nuovo: await page("../../app/(dashboard)/dashboard/[workspaceId]/use-cases/nuovo/page.tsx"),
  };
  notFoundPage = (await import("../../app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/not-found.tsx")).default as () => unknown;
  const { createElement } = await import("react");
  createElementOf = (type, props) => createElement(type as never, props as never);
  const { renderToStaticMarkup: toHtml } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as {
    AppRouterContext: import("react").Context<object | null>;
  };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  renderToStaticMarkup = (element) => toHtml(createElement(AppRouterContext.Provider, { value: router }, element as never));

  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  delete process.env.VERCEL_ENV;

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H4b', $2)`, [ids.org, `hub-h4b-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova H4b'), ($2::uuid, $3::uuid, 'Prova H4b spento')`, [
    ids.ws,
    ids.wsOff,
    ids.org,
  ]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], NAMES[person]]);
  }
  const memberships: Array<[string, Person, string]> = [
    [ids.ws, "lsLead", "transformation_lead"],
    [ids.ws, "lsAnalyst", "analyst"],
    [ids.ws, "builder", "function_lead"],
    [ids.ws, "sponsor", "exec_sponsor"],
    [ids.ws, "contributor", "contributor"],
    [ids.ws, "learner", "learner"],
    [ids.wsOff, "builder", "function_lead"],
    [ids.wsOff, "contributor", "contributor"],
  ];
  for (const [workspaceId, person, role] of memberships) {
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [workspaceId, ids[person], role]);
  }
  revalidated();
});

// Ogni prova parte senza percorsi riletti da quella prima.
beforeEach(() => {
  revalidated();
});

after(async () => {
  signIn(null);
  delete state.__hubH4bAi;
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.wsOff]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

// ═══ «Cosa è»: modifica sul posto (§6.2, §6.8) ═══════════════════════

test("«Cosa è»: un revisore del cliente modifica un campo; una riga di Storia senza testi; pagine rilette", opts, async () => {
  signIn("builder");
  const card = await seed();
  const text = `Come funziona, scritto da ${suffix}`;
  const saved = ok(await actions.updateUseCaseFieldAction(ids.ws, card.id, await versionOf(card.id), "flowDescription", text), "come funziona");
  assert.equal(saved.message, null, "nessun toast per una modifica sul posto");
  const r = await row(card.id);
  assert.equal(r.flow_description, text);
  assert.equal(saved.version, Number(r.version), "la versione restituita è quella salvata");
  assert.deepEqual(revalidated(), pathsOf(card.id));
  const [event] = (await storia(card.id)).slice(-1);
  assert.equal(event.action, "modificato");
  assert.equal(event.channel, "pagina");
  assert.equal(event.actor_user_id, ids.builder);
  assert.deepEqual(event.fields, ["come_funziona"]);
  assert.ok(!JSON.stringify(await storia(card.id)).includes(suffix), "la Storia non ha testi");

  // Vuoto toglie il valore; «Possibile doppione di» si salva in maiuscolo.
  ok(await actions.updateUseCaseFieldAction(ids.ws, card.id, saved.version, "flowDescription", "  "), "svuota");
  assert.equal((await row(card.id)).flow_description, null);
  ok(await actions.updateUseCaseFieldAction(ids.ws, card.id, await versionOf(card.id), "possibleDuplicateOf", "xx-0007"), "doppione");
  assert.equal(((await row(card.id)).intake as Record<string, unknown>).possibleDuplicateOf, "XX-0007");
});

test("«Cosa è»: versione superata con il testo esatto di §6.8; la pagina si rilegge, la scheda non cambia", opts, async () => {
  signIn("builder");
  const card = await seed({ description: "Il problema di prima" });
  const seen = await versionOf(card.id);
  // Qualcun altro modifica la scheda dopo che la pagina l'ha letta.
  ok(await actions.updateUseCaseFieldAction(ids.ws, card.id, seen, "guardrails", "Limiti scritti da un collega"), "collega");
  revalidated();
  const stale = err(await actions.updateUseCaseFieldAction(ids.ws, card.id, seen, "description", "Il problema riscritto"), "versione_superata");
  assert.equal(stale.message, "Qualcuno ha appena modificato questo use case. Ho ricaricato i dati: rifai la modifica.");
  assert.equal(stale.fieldErrors, undefined, "nessun errore di campo: il toast lo dice e il testo resta nel campo");
  assert.deepEqual(revalidated(), pathsOf(card.id), "la pagina si rilegge");
  assert.equal((await row(card.id)).description, "Il problema di prima");
  // Con la versione nuova lo stesso testo passa.
  ok(await actions.updateUseCaseFieldAction(ids.ws, card.id, await versionOf(card.id), "description", "Il problema riscritto"), "riprova");
  assert.equal((await row(card.id)).description, "Il problema riscritto");
});

test("«Cosa è»: errori del campo con il nome del campo; ingressi che la pagina non manda", opts, async () => {
  signIn("builder");
  const card = await seed();
  const version = await versionOf(card.id);
  const short = err(await actions.updateUseCaseFieldAction(ids.ws, card.id, version, "title", "ab"), "dati_non_validi");
  assert.equal(short.fieldErrors?.title, "Il titolo deve avere almeno 3 caratteri.");
  const long = err(await actions.updateUseCaseFieldAction(ids.ws, card.id, version, "aiLab", "x".repeat(121)), "dati_non_validi");
  assert.equal(long.fieldErrors?.aiLab, "Massimo 120 caratteri.");
  const code = err(await actions.updateUseCaseFieldAction(ids.ws, card.id, version, "possibleDuplicateOf", "non un codice"), "dati_non_validi");
  assert.equal(code.fieldErrors?.possibleDuplicateOf, "Scrivi un codice come XX-0012.");
  err(await actions.updateUseCaseFieldAction(ids.ws, card.id, version, "publicNote", "x"), "dati_non_validi", "la nota pubblica ha la sua action");
  err(await actions.updateUseCaseFieldAction(ids.ws, card.id, version, "origin", "transformation"), "dati_non_validi", "campo fuori elenco");
  err(await actions.updateUseCaseFieldAction(ids.ws, card.id, version, "title", 42), "dati_non_validi");
  err(await actions.updateUseCaseFieldAction(ids.ws, "non-un-uuid", version, "title", "Titolo"), "non_trovato");
  assert.equal(await versionOf(card.id), version, "niente è cambiato");
});

test("«Cosa è»: contributore, chi segue un corso e chi non è membro rifiutati; area spenta per il workspace", opts, async () => {
  const card = await seed();
  const version = await versionOf(card.id);
  for (const person of ["contributor", "learner", "outsider"] as const) {
    signIn(person);
    err(await actions.updateUseCaseFieldAction(ids.ws, card.id, version, "description", "Testo"), "permesso_mancante", person);
  }
  signIn("builder");
  const off = await seed({ workspaceId: ids.wsOff });
  err(await actions.updateUseCaseFieldAction(ids.wsOff, off.id, await versionOf(off.id), "description", "Testo"), "area_spenta");
  assert.equal(await versionOf(card.id), version);
});

// ═══ «Valutazione» (§6.3, §7.6) ══════════════════════════════════════

test("«Salva la valutazione»: KPI, valore all'anno e fascia; «valutata»; Storia con i soli nomi dei campi", opts, async () => {
  signIn("builder");
  const card = await seed({ review: "in_review" });
  revalidated();
  const saved = ok(
    await actions.saveValuationAction(ids.ws, card.id, await versionOf(card.id), {
      kpis: { impact: { efficiency: 4, profitability: null } },
      valueEurYear: "60.000",
      cost: { band: 2 },
    }),
    "valutazione",
  );
  const r = await row(card.id);
  assert.deepEqual((r.custom_scores as Record<string, unknown>).impact, { efficiency: 4 });
  assert.equal(r.value_eur_year, 60000);
  assert.equal(r.cost_band, 2);
  assert.equal(r.cost_eur_once, null);
  assert.equal(r.portfolio_review_status, "scored");
  assert.equal(saved.version, Number(r.version));
  assert.deepEqual(revalidated(), pathsOf(card.id));
  const [event] = (await storia(card.id)).slice(-1);
  assert.equal(event.action, "valutato");
  assert.deepEqual([...(event.fields as string[])].sort(), ["costo", "kpi", "valore"]);
  // Con una cifra in euro la «Valutazione» scrive solo la cifra: niente parola, punteggio né zona.
  const valuation = sectionOf((await detailHtml("builder", card.id)).html, "section-valuation");
  assert.ok(valuation.includes("60.000 € all&#x27;anno"), valuation);
  assert.ok(!valuation.includes("Zona:"), "senza zona");
  assert.ok(!valuation.includes("un suggerimento, non la decisione"));
  assert.ok(!valuation.includes("Alto · 4"));
  // Con il solo punteggio la zona resta, con il suggerimento.
  const scored = await seed({ review: "scored", customScores: { impact: { efficiency: 4 }, feasibility: { effort: 2 } } });
  const scoredValuation = sectionOf((await detailHtml("builder", scored.id)).html, "section-valuation");
  assert.ok(scoredValuation.includes("Zona:"), scoredValuation);
  assert.ok(scoredValuation.includes("un suggerimento, non la decisione"));
  // Un importo azzera la fascia (D5).
  ok(await actions.saveValuationAction(ids.ws, card.id, saved.version, { cost: { eurOnce: "40.000" } }), "importo");
  const after = await row(card.id);
  assert.equal(after.cost_eur_once, 40000);
  assert.equal(after.cost_band, null);
});

test("«Salva la valutazione»: importo e fascia insieme, KPI fuori modello, punteggio fuori scala; il contributore no", opts, async () => {
  signIn("builder");
  const card = await seed();
  const version = await versionOf(card.id);
  const both = err(await actions.saveValuationAction(ids.ws, card.id, version, { cost: { eurOnce: 40000, band: 2 } }), "dati_non_validi");
  assert.equal(both.fieldErrors?.cost, "Indica un importo oppure una fascia, non tutti e due.");
  const unknown = err(await actions.saveValuationAction(ids.ws, card.id, version, { kpis: { impact: { inventato: 3 } } }), "dati_non_validi");
  assert.equal(unknown.fieldErrors?.["kpis.impact.inventato"], "Questo KPI non è nel modello del workspace.");
  const range = err(await actions.saveValuationAction(ids.ws, card.id, version, { kpis: { impact: { efficiency: 7 } } }), "dati_non_validi");
  assert.equal(range.fieldErrors?.["kpis.impact.efficiency"], "Il punteggio deve essere tra 1 e 5.");
  const value = err(await actions.saveValuationAction(ids.ws, card.id, version, { valueEurYear: "60,5" }), "dati_non_validi");
  assert.equal(value.fieldErrors?.valueEurYear, "Scrivi un valore in euro all'anno, senza decimali (es. 60000).");
  err(await actions.saveValuationAction(ids.ws, card.id, version, "non un oggetto"), "dati_non_validi");
  signIn("contributor");
  err(await actions.saveValuationAction(ids.ws, card.id, version, { cost: { band: 1 } }), "permesso_mancante");
  assert.equal(await versionOf(card.id), version);
});

test("«Chiedi un nuovo suggerimento»: solo `ai_suggestion`, `version` uguale, poi «Salva la valutazione» con la versione di prima", opts, async () => {
  signIn("builder");
  const card = await seed({ customScores: { impact: { efficiency: 2 } }, reviewedBy: ids.builder, review: "scored" });
  const before = await row(card.id);
  const version = Number(before.version);
  ai().calls = 0;
  delete ai().fail;
  delete ai().during;
  const asked = ok(await actions.requestAiSuggestionAction(ids.ws, card.id, version), "suggerimento");
  assert.equal(asked.message, "Suggerimento AI aggiornato.");
  assert.equal(asked.version, version);
  assert.equal(ai().calls, 1);
  const r = await row(card.id);
  const suggestion = r.ai_suggestion as Record<string, unknown>;
  assert.equal(suggestion.kind, "suggerimento");
  assert.deepEqual(suggestion.scores, { impact: { efficiency: 4, profitability: 2 } });
  assert.equal(suggestion.rationale, "Motivazione sintetica di prova.");
  assert.equal(Number(r.version), version, "scrivere `ai_suggestion` non cambia `version`");
  assert.deepEqual(r.custom_scores, before.custom_scores, "i punteggi del team non cambiano");
  assert.equal(r.reviewed_by, before.reviewed_by);
  assert.equal(r.portfolio_review_status, "scored");
  const [event] = (await storia(card.id)).slice(-1);
  assert.equal(event.action, "suggerimento_ai");
  assert.equal(event.actor_kind, "ai", "nella Storia è l'AI, non una persona");
  assert.equal(event.actor_user_id, null);
  assert.deepEqual(revalidated(), pathsOf(card.id));
  // «Usa questi valori» e «Salva la valutazione» con la versione letta prima del suggerimento.
  ok(await actions.saveValuationAction(ids.ws, card.id, version, { kpis: { impact: { efficiency: 4 } } }), "salva dopo il suggerimento");
});

test("«Chiedi un nuovo suggerimento»: modello che non risponde, scheda cambiata nel frattempo, chi non valuta", opts, async () => {
  signIn("builder");
  const card = await seed();
  const version = await versionOf(card.id);
  ai().calls = 0;
  ai().fail = true;
  const failed = err(await actions.requestAiSuggestionAction(ids.ws, card.id, version), "riprova");
  assert.equal(failed.message, "Suggerimento AI non disponibile. Riprova tra un momento.");
  assert.equal((await row(card.id)).ai_suggestion, null);
  delete ai().fail;

  // Una versione già vecchia: il modello non si chiama.
  ok(await actions.updateUseCaseFieldAction(ids.ws, card.id, version, "aiLab", "AI Lab di prova"), "modifica");
  const callsBefore = ai().calls;
  err(await actions.requestAiSuggestionAction(ids.ws, card.id, version), "versione_superata");
  assert.equal(ai().calls, callsBefore, "nessuna chiamata al modello con una versione vecchia");

  // La scheda cambia mentre il modello risponde: il suggerimento non si salva.
  const current = await versionOf(card.id);
  ai().during = async () => {
    await q(`UPDATE use_cases SET guardrails = 'Cambiato mentre il modello risponde' WHERE id = $1::uuid`, [card.id]);
  };
  revalidated();
  err(await actions.requestAiSuggestionAction(ids.ws, card.id, current), "versione_superata");
  delete ai().during;
  assert.equal((await row(card.id)).ai_suggestion, null);
  assert.deepEqual(revalidated(), pathsOf(card.id), "la pagina si rilegge");

  for (const person of ["contributor", "learner"] as const) {
    signIn(person);
    const calls = ai().calls;
    err(await actions.requestAiSuggestionAction(ids.ws, card.id, await versionOf(card.id)), "permesso_mancante", person);
    assert.equal(ai().calls, calls, `${person}: nessuna chiamata al modello`);
  }
});

// ═══ «Oscura testo» (§6.8, §1.2 punto 10) ════════════════════════════

test("«Oscura testo»: Lateral Space con ruolo da revisore e chi gestisce il workspace sì, l'AI Builder del cliente no", opts, async () => {
  const card = await seed({ description: `Problema da togliere ${suffix}`, publicNote: `Nota da togliere ${suffix}` });
  signIn("builder");
  err(await actions.redactTextAction(ids.ws, card.id, await versionOf(card.id), ["problema"]), "permesso_mancante", "revisore del cliente");
  signIn("lsAnalyst");
  const done = ok(await actions.redactTextAction(ids.ws, card.id, await versionOf(card.id), ["problema", "nota_pubblica"]), "Lateral Space");
  assert.equal(done.message, "Testo oscurato.");
  const r = await row(card.id);
  assert.equal(r.description, "[testo rimosso]");
  assert.equal(r.public_note, "[testo rimosso]");
  const [event] = (await storia(card.id)).slice(-1);
  assert.equal(event.action, "oscurato");
  assert.deepEqual([...(event.fields as string[])].sort(), ["nota_pubblica", "problema"]);
  assert.deepEqual(revalidated(), pathsOf(card.id));
  const other = await seed({ flowDescription: "Come funziona da togliere" });
  signIn("sponsor");
  ok(await actions.redactTextAction(ids.ws, other.id, await versionOf(other.id), ["come_funziona"]), "chi gestisce il workspace (cliente)");
  assert.equal((await row(other.id)).flow_description, "[testo rimosso]");
  err(await actions.redactTextAction(ids.ws, other.id, await versionOf(other.id), []), "dati_non_validi", "nessun campo");
  err(await actions.redactTextAction(ids.ws, other.id, await versionOf(other.id), ["proposta"]), "dati_non_validi", "campo fuori elenco");
});

// ═══ La pagina per ruolo (§6.7, §6.9, §11) ═══════════════════════════

test("revisori: i cinque capitoli; «Proposto da» ed «Email indicata» solo a chi gestisce il workspace", opts, async () => {
  const proposer = `proponente.${suffix}@cliente.test`;
  const submitter = `indicata.${suffix}@cliente.test`;
  const card = await seed({
    status: "accepted",
    review: "scored",
    targetQuarter: "2027-Q1",
    proposedBy: proposer,
    intake: { contractVersion: 2, frequency: "giornaliera", beneficiaries: 3, timeSavedMinutesPerRun: 15, submitterEmail: submitter, flags: { personalData: true } },
  });
  const sponsor = await detailHtml("sponsor", card.id);
  for (const text of ["Cos&#x27;è", "Valutazione", "Decisione", "Realizzazione", "Storia", "Dettagli", "Proposto da", proposer, "Email indicata", submitter]) {
    assert.ok(sponsor.html.includes(text), `chi gestisce il workspace: manca «${text}»`);
  }
  // H4p: un solo riquadro di stime, con la frase che dice cosa conta.
  assert.ok(sponsor.html.includes("Stime non ufficiali") && sponsor.html.includes("Conta la valutazione del team."));
  assert.ok(!sponsor.html.includes("Stima di Claude, non ufficiale"));
  assert.ok(sponsor.html.includes("Circa 180 ore all&#x27;anno (15 minuti × 240 volte × 3 persone)."));
  assert.ok(sponsor.html.includes("Dati personali"), "chip di rischio");
  for (const person of ["builder", "lsAnalyst"] as const) {
    const { html } = await detailHtml(person, card.id);
    assert.ok(html.includes("Cos&#x27;è") && html.includes("Valutazione") && html.includes("Storia"), person);
    for (const text of ["Proposto da", proposer, "Email indicata", submitter]) assert.ok(!html.includes(text), `${person}: «${text}»`);
  }
});

test("revisori: «Oscura testo» per Lateral Space e chi gestisce il workspace, non per l'AI Builder del cliente; ancore per ruolo", opts, async () => {
  const card = await seed({ description: "Un problema", publicNote: "Una nota" });
  const reviewerProp = async (person: Person) => {
    const { element } = await detailHtml(person, card.id);
    const [reviewer] = findProp(element, "reviewer") as Array<{ canRedact: boolean; redactOptions: Array<{ field: string }>; canArchive: boolean } | null>;
    return reviewer;
  };
  assert.equal((await reviewerProp("builder"))?.canRedact, false);
  assert.deepEqual((await reviewerProp("builder"))?.redactOptions, [], "al browser del revisore del cliente nessuna casella");
  for (const person of ["lsAnalyst", "lsLead", "sponsor"] as const) {
    const reviewer = await reviewerProp(person);
    assert.equal(reviewer?.canRedact, true, person);
    assert.deepEqual(reviewer?.redactOptions.map((option) => option.field), ["titolo", "problema", "nota_pubblica"], person);
    assert.equal(reviewer?.canArchive, true, `${person}: «Archivia» da «Da valutare»`);
  }
  const { element } = await detailHtml("builder", card.id, { capitolo: "valutazione" });
  const [chapters] = findProp(element, "chapters") as Array<Array<{ id: string }>>;
  assert.deepEqual(chapters.map((chapter) => chapter.id), ["cosa-e", "valutazione", "decisione", "cosa-serve", "storia"], "senza «Realizzazione» prima dell'approvazione");
  assert.deepEqual(findProp(element, "initial"), ["valutazione"], "?capitolo=");
});

test("contributore: titolo e fase; delle sue proposte codice e nota pubblica, anche nascoste; nascosta altrui «non trovato»", opts, async () => {
  const note = `Nota pubblica mia ${suffix}`;
  const internal = `Nota interna ${suffix}`;
  const own = await seed({ title: `Mia per email ${suffix}`, review: "needs_inputs", reviewedBy: ids.lsLead, publicNote: note, proposedBy: emails.contributor.toUpperCase(), reviewNotes: internal });
  const hiddenNote = `Nota pubblica della mia nascosta ${suffix}`;
  const ownHidden = await seed({ title: `Mia nascosta ${suffix}`, intake: { hiddenFromSearch: true }, proposedBy: ids.contributor, publicNote: hiddenNote });
  const others = await seed({ title: `Altrui ${suffix}`, status: "accepted", review: "scored", targetQuarter: "2027-Q1", publicNote: `Nota altrui ${suffix}`, customScores: { impact: { efficiency: 4 } } });
  const hidden = await seed({ title: `Nascosta altrui ${suffix}`, intake: { hiddenFromSearch: true }, publicNote: `Nota della nascosta altrui ${suffix}` });

  const mine = await detailHtml("contributor", own.id);
  for (const text of [own.code!, own.title, "Da valutare · Serve info", "Nota pubblica", note]) assert.ok(mine.html.includes(text), `propria: manca «${text}»`);
  for (const text of ["Cosa è", "Valutazione", "Storia", "Problema di prova", internal, "€", "data-figure", "Oscura"]) assert.ok(!mine.html.includes(text), `propria: «${text}»`);

  const mineHidden = await detailHtml("contributor", ownHidden.id);
  assert.ok(mineHidden.html.includes(ownHidden.code!) && mineHidden.html.includes(ownHidden.title), "propria nascosta: c'è, con il codice");
  assert.ok(mineHidden.html.includes("Nota pubblica") && mineHidden.html.includes(hiddenNote), "propria nascosta: la nota pubblica (D13, §1.2 punto 3)");

  const theirs = await detailHtml("contributor", others.id);
  assert.ok(theirs.html.includes(others.title) && theirs.html.includes("Approvato · T1 2027"));
  for (const text of [others.code!, `Nota altrui ${suffix}`, "€", "data-figure", "Valore", "Problema di prova"]) assert.ok(!theirs.html.includes(text), `altrui: «${text}»`);
  // Al contributore nessun dato oltre alla sua proiezione, nemmeno nelle prop dei pezzi del browser.
  const [card] = findProp(theirs.element, "card") as Array<Record<string, unknown>>;
  assert.deepEqual(Object.keys(card).sort(), ["code", "id", "phase", "phaseLabel", "subState", "title"]);
  assert.equal(card.code, null);
  assert.deepEqual(findProp(theirs.element, "reviewer"), [], "nessun menu dei revisori");

  const missing = await open(pages.detail, "contributor", { workspaceId: ids.ws, useCaseId: hidden.id });
  // `notFound()` prima di rendere: della nascosta altrui non arriva niente, nemmeno la nota pubblica.
  assert.match(missing.digest ?? "", NOT_FOUND, "nascosta altrui: «Use case non trovato»");
  // Chi segue solo un corso torna alla Formazione; chi non è membro non trova niente.
  const learner = await open(pages.detail, "learner", { workspaceId: ids.ws, useCaseId: others.id });
  assert.match(learner.digest ?? "", /NEXT_REDIRECT/);
  const outsider = await open(pages.detail, "outsider", { workspaceId: ids.ws, useCaseId: others.id });
  assert.match(outsider.digest ?? "", NOT_FOUND);
  const otherWorkspace = await seed({ workspaceId: ids.wsOff });
  const wrong = await open(pages.detail, "builder", { workspaceId: ids.ws, useCaseId: otherWorkspace.id });
  assert.match(wrong.digest ?? "", NOT_FOUND, "una scheda di un altro workspace");
});

test("«Realizzazione»: «Avvia la realizzazione» solo a Lateral Space con la sezione Casi d'uso accesa; «Segna come in realizzazione» con la sezione spenta", opts, async () => {
  const card = await seed({ status: "accepted", review: "scored", targetQuarter: null });
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = ids.ws;
  try {
    const ls = await detailHtml("lsLead", card.id);
    const realization = sectionOf(ls.html, "section-realization");
    assert.ok(realization.includes("Avvia la realizzazione"), "Lateral Space, sezione accesa");
    assert.ok(realization.includes(`/dashboard/${ids.ws}/casi-duso/nuovo?useCaseId=${card.id}`));
    assert.ok(realization.includes("La realizzazione non è ancora partita."));
    for (const person of ["builder", "sponsor"] as const) {
      const { html } = await detailHtml(person, card.id);
      const part = sectionOf(html, "section-realization");
      assert.ok(part.includes("La realizzazione la avvia Lateral Space."), person);
      assert.ok(!part.includes("Avvia la realizzazione") && !html.includes("casi-duso/nuovo"), `${person}: nessun «Avvia»`);
    }
  } finally {
    delete process.env.UC_ENABLED;
    delete process.env.UC_WORKSPACE_IDS;
  }
  const off = await detailHtml("lsLead", card.id);
  const part = sectionOf(off.html, "section-realization");
  assert.ok(part.includes("Segna come in realizzazione"), "sezione spenta: «Segna come in realizzazione»");
  assert.ok(!part.includes("Avvia la realizzazione"));
  const builder = await detailHtml("builder", card.id);
  assert.ok(!builder.html.includes("Segna come in realizzazione"), "il revisore del cliente non lo vede");
});

test("«Cosa è»: un campo vuoto è solo «+ Aggiungi …», senza la riga dell'etichetta; area, strumenti e agente con i titoli della guida", opts, async () => {
  // La guida del connettore del workspace, nella forma di K8 (src/lib/connector/tools.fixtures.ts).
  const guide = {
    areas: [{ id: "amministrazione", label: "Amministrazione" }, { id: "vendite", label: "Vendite" }],
    tools: [{ id: "foglio_calcolo", label: "Foglio di calcolo" }],
    agentCatalog: [{ id: "atlante", nome: "ATLANTE", cosaFa: "Prepara bozze di risposta" }],
  };
  await q(`INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix, guide) VALUES ($1::uuid, $2, 'XX', $3::jsonb)`, [ids.ws, `hub-h4b-${suffix}`, JSON.stringify(guide)]);
  try {
    const card = await seed({ intake: { contractVersion: 2, area: "amministrazione", tools: ["foglio_calcolo"], relatedAgent: "atlante" } });
    const { html } = await detailHtml("builder", card.id);
    const what = sectionOf(html, "section-what");
    assert.ok(what.includes(">Amministrazione<"), "l'area con il titolo della guida");
    assert.ok(!what.includes("amministrazione<"), "mai la chiave dell'area");
    assert.ok(what.includes("Foglio di calcolo") && !what.includes("foglio calcolo"), "lo strumento con il titolo della guida");
    assert.ok(what.includes(">ATLANTE<"), "l'agente collegato con il nome del catalogo");
    // Pieni con l'etichetta; vuoti in una sola riga di «+ Aggiungi …», senza etichetta (§6.2).
    assert.ok(what.includes(">Problema</dt>") && what.includes(">Area</dt>"));
    const emptyRow = what.indexOf('data-slot="what-empty-fields"');
    assert.ok(emptyRow > what.indexOf(">Area</dt>"), "i campi vuoti dopo quelli pieni");
    for (const label of ["Come funziona", "Chi controlla", "Limiti", "Impatto atteso", "Dati", "AI Lab"]) {
      assert.ok(what.includes(inlineModule.addLabelOf(label)), `manca «${inlineModule.addLabelOf(label)}»`);
      assert.ok(!what.includes(`>${label}<`), `${label}: nessuna riga d'etichetta per un campo vuoto`);
    }
    assert.ok(what.includes("+ Aggiungi possibile doppione di") && !what.includes(">Possibile doppione di<"), "«Dettagli»: lo stesso");
  } finally {
    await q(`DELETE FROM workspace_connector_configs WHERE workspace_id = $1::uuid`, [ids.ws]);
  }
});

test("«Decisione»: nota pubblica con l'avviso; per una scheda nascosta la seconda riga; un solo pulsante pieno", opts, async () => {
  const card = await seed({ intake: { hiddenFromSearch: true }, origin: "transformation" });
  const { html } = await detailHtml("builder", card.id);
  const decision = sectionOf(html, "section-decision");
  assert.ok(decision.includes("Chi conosce il codice la legge tramite Claude. Non scrivere dati personali."));
  assert.ok(decision.includes("Questa scheda è nascosta alla ricerca: tramite Claude chi conosce il codice vede solo la fase."));
  const filled = html.match(/data-slot="button"[^>]*class="[^"]*bg-primary[^"]*"/g) ?? [];
  assert.equal(filled.length, 1, "un solo pulsante pieno nella pagina (Approva)");
});

test("«Decisione» dopo una risposta a «Serve info»: prima la domanda del team, poi le risposte di chi ha proposto (D17)", opts, async () => {
  const question = `Quante visite fate al mese? ${suffix}`;
  const answer = `Circa 40 visite al mese ${suffix}`;
  const card = await seed({ publicNote: question, intake: { risposte: [{ at: "2026-10-02T09:00:00.000Z", text: answer }] } });
  const { html } = await detailHtml("builder", card.id);
  const decision = sectionOf(html, "section-decision");
  const asked = decision.indexOf(question);
  const answers = decision.indexOf('data-slot="proposer-answers"');
  assert.ok(asked > 0, "la domanda nel campo «Nota pubblica»");
  assert.ok(answers > asked, "le risposte dopo la domanda");
  assert.ok(decision.indexOf(answer) > answers);
  assert.ok(decision.includes("Risposte di chi ha proposto"));
});

test("«Storia»: righe senza testi, persona solo per le azioni del team, creazione senza persona; «La storia parte dal»", opts, async () => {
  signIn("builder");
  const secret = `Testo che non entra nella Storia ${suffix}`;
  const card = await seed();
  ok(await actions.updateUseCaseFieldAction(ids.ws, card.id, await versionOf(card.id), "description", secret), "modifica");
  const { html } = await detailHtml("lsLead", card.id);
  const history = sectionOf(html, "section-history");
  assert.ok(history.includes("Modificato: Problema · pagina"), history);
  assert.ok(history.includes(NAMES.builder), "la persona del team");
  assert.ok(history.includes("Creato · dal modulo web"));
  assert.ok(!/Creato[^<]*(Bruno|Carla|collega)/.test(history), "la creazione non dice chi ha proposto");
  assert.ok(!history.includes(secret), "nessun testo nella Storia");
  assert.ok(!history.includes("La storia parte dal"), "la Storia comincia con la scheda");

  // Una scheda più vecchia della Storia: la riga in fondo.
  const old = await seed();
  await q(`DELETE FROM use_case_events WHERE use_case_id = $1::uuid`, [old.id]);
  await q(`UPDATE use_cases SET created_at = now() - interval '40 days', submitted_at = now() - interval '40 days' WHERE id = $1::uuid`, [old.id]);
  ok(await actions.updateUseCaseFieldAction(ids.ws, old.id, await versionOf(old.id), "aiLab", "AI Lab Vendite"), "prima riga");
  const oldHtml = sectionOf((await detailHtml("lsLead", old.id)).html, "section-history");
  assert.match(oldHtml, /La storia parte dal \d{1,2} [a-z]{3} \d{4}\./);
});

test("area spenta per il workspace: la scheda di oggi; `/use-cases/nuovo` risponde «non trovato»", opts, async () => {
  const card = await seed({ workspaceId: ids.wsOff });
  const legacy = await open(pages.detail, "builder", { workspaceId: ids.wsOff, useCaseId: card.id });
  assert.equal(legacy.digest, null);
  assert.ok(legacy.html!.includes("Torna al portfolio"), "la pagina di oggi");
  assert.ok(!legacy.html!.includes('data-slot="use-case-detail"'));
  const nuovo = await open(pages.nuovo, "builder", { workspaceId: ids.wsOff });
  assert.match(nuovo.digest ?? "", NOT_FOUND);
  const html = renderToStaticMarkup(createElementOf(notFoundPage, null));
  assert.ok(html.includes("Use case non trovato") && html.includes("Forse è di un altro workspace, o il link è sbagliato."));
});

// ═══ I pezzi puri dei capitoli ═══════════════════════════════════════

test("capitoli: `?capitolo=`, ancore per ruolo, «Realizzazione» dalla fase Approvato in poi", opts, () => {
  const { chapterFromParam, detailChapters, showsRealization } = detailModule;
  assert.equal(chapterFromParam("realizzazione"), "realizzazione");
  assert.equal(chapterFromParam(["storia"]), "storia");
  assert.equal(chapterFromParam("cosa"), "cosa-e");
  assert.equal(chapterFromParam("proponente"), null);
  assert.equal(chapterFromParam(undefined), null);
  assert.deepEqual(detailChapters({ isReviewer: false, canSeeHistory: false }, { showRealization: true }), []);
  assert.deepEqual(
    detailChapters({ isReviewer: true, canSeeHistory: true }, { showRealization: true }).map((c) => c.label),
    ["Cos'è", "Valutazione", "Decisione", "Realizzazione", "Storia"],
  );
  assert.deepEqual(
    detailChapters({ isReviewer: true, canSeeHistory: true, canSeeNeeds: true }, { showRealization: true }).map((c) => c.label),
    ["Cos'è", "Valutazione", "Decisione", "Cosa serve", "Realizzazione", "Storia"],
  );
  assert.deepEqual(detailChapters({ isReviewer: false, canSeeHistory: false, canSeeNeeds: false }, { showRealization: true }), []);
  assert.equal(showsRealization({ phase: "da_valutare", kind: "da_costruire", dossier: null }), false);
  assert.equal(showsRealization({ phase: "approvato", kind: "da_costruire", dossier: null }), true);
  assert.equal(showsRealization({ phase: "chiuso", kind: "da_costruire", dossier: null }), false);
  assert.equal(showsRealization({ phase: "chiuso", kind: "da_costruire", dossier: { status: "chiuso" } }), true);
  assert.equal(showsRealization({ phase: "realizzato", kind: "da_diffondere", dossier: null }), true);
  assert.equal(showsRealization({ phase: "in_realizzazione", kind: "da_diffondere", dossier: null }), false);

  // L'ancora del capitolo in vista: l'ultimo salito sopra la linea; in fondo alla pagina l'ultimo visibile.
  const sections = (tops: number[]) => ["cosa-e", "valutazione", "decisione", "realizzazione", "storia"].map((id, i) => ({ id, top: tops[i] }));
  const view = { line: 130, height: 800, atBottom: false };
  assert.equal(chapterNavModule.activeChapterAt(sections([250, 900, 1500, 2100, 2400]), view), "cosa-e", "in cima: il primo");
  assert.equal(chapterNavModule.activeChapterAt(sections([-600, 112, 700, 1300, 1600]), view), "valutazione", "arrivato con un'ancora (scroll-mt-28)");
  assert.equal(chapterNavModule.activeChapterAt(sections([-1400, -700, 40, 400, 650]), view), "decisione", "la linea, non la finestra");
  assert.equal(chapterNavModule.activeChapterAt(sections([-1400, -700, 40, 400, 650]), { ...view, atBottom: true }), "storia", "in fondo: l'ultimo visibile");
  assert.equal(chapterNavModule.activeChapterAt(sections([-1400, -700, 40, 400, 900]), { ...view, atBottom: true }), "realizzazione");
  assert.equal(chapterNavModule.activeChapterAt([], view), null);
});

test("«Oscura testo»: solo i campi con un testo, etichette del tipo, mai un testo già oscurato", opts, () => {
  const base = {
    kind: "da_diffondere" as const,
    title: "Titolo",
    description: "Prima",
    flowDescription: "[testo rimosso]",
    humanInTheLoop: null,
    guardrails: null,
    businessCase: " ",
    dataRequirements: null,
    sustainabilityImpact: null,
    area: null,
    aiLab: "AI Lab",
    publicNote: null,
    intake: { proposerEstimate: { efficiency: { score: 4, reasoning: "Conto dei minuti" } } },
    aiSuggestion: null,
    reviewNotes: "Auto-ranking AI:\nMotivazione",
  };
  assert.deepEqual(detailModule.redactOptions(base), [
    { field: "titolo", label: "Titolo" },
    { field: "problema", label: "Prima" },
    { field: "ai_lab", label: "AI Lab" },
    { field: "intake", label: "Dati raccolti da Claude" },
    { field: "motivazione_ai", label: "Motivazione dell'AI" },
  ]);
  const redacted = detailModule.redactOptions({ ...base, reviewNotes: "Auto-ranking AI:\n[testo rimosso]", intake: null });
  assert.ok(!redacted.some((option) => option.field === "motivazione_ai" || option.field === "intake"));
});

test("Storia: decisioni dai codici di fase, campi per nome, canali", opts, () => {
  const { decisionText, eventActionText, historyRowParts } = historyModule;
  assert.equal(decisionText("da_valutare.nuova", "approvato.trimestre"), "Approvato");
  assert.equal(decisionText("da_valutare.nuova", "approvato.piu_avanti"), "Approvato (Più avanti)");
  assert.equal(decisionText("da_valutare.valutata", "da_valutare.rimandata"), "Rimandato");
  assert.equal(decisionText("chiuso.non_avviato", "da_valutare.nuova"), "Riaperto");
  assert.equal(decisionText("approvato.trimestre", "chiuso.doppione"), "Doppione");
  assert.equal(decisionText("approvato.piu_avanti", "realizzato.diffusa"), "Diffusa");
  assert.equal(eventActionText({ action: "valutato", fields: ["valore", "costo"], phaseBefore: null, phaseAfter: null }, "da_costruire"), "Valutazione modificata: Valore all'anno, Costo");
  assert.equal(eventActionText({ action: "oscurato", fields: ["problema"], phaseBefore: null, phaseAfter: null }, "da_diffondere"), "Testo oscurato: Prima");
  const at = new Date("2026-10-14T10:00:00Z");
  assert.deepEqual(
    historyRowParts({ id: "1", at, actorKind: "persona", actorName: "Nome Cognome", channel: "pagina", action: "decisione", fields: [], phaseBefore: "da_valutare.nuova", phaseAfter: "approvato.trimestre" }, { kind: "da_costruire", today: "2026-10-19" }),
    ["14 ott", "Nome Cognome", "Decisione: Approvato", "pagina"],
  );
  assert.deepEqual(
    historyRowParts({ id: "2", at, actorKind: "proponente", actorName: null, channel: "slack", action: "creato", fields: [], phaseBefore: null, phaseAfter: null }, { kind: "da_costruire", today: "2026-10-19" }),
    ["14 ott", "Creato", "da Slack"],
  );
  assert.deepEqual(
    historyRowParts({ id: "3", at, actorKind: "ai", actorName: "Non mostrare", channel: "ai", action: "suggerimento_ai", fields: [], phaseBefore: null, phaseAfter: null }, { kind: "da_costruire", today: "2027-02-01" }),
    ["14 ott 2026", "Suggerimento AI", "AI"],
    "una persona solo per le persone",
  );
});

test("«Dettagli» e «Stima di Claude, non ufficiale»: etichette in italiano; nessun riquadro senza dati del connettore", opts, () => {
  const intake = {
    tools: ["excel", "altro"],
    toolsOther: "Gestionale interno",
    frequency: "settimanale",
    beneficiaries: 1,
    timeSavedMinutesPerRun: 30,
    valuePerRunEur: 20,
    qualityGain: "sensibile",
    developmentStatus: "prototipo",
    relatedAgent: "non_so",
    flags: { personalData: false, safetyRelated: true, outsideFoundation: false },
    proposerEstimate: { efficiency: { score: 4 }, effort: { score: 2 }, impactFlag: { value: "verde" } },
  };
  assert.deepEqual(intakeModule.collectedDataRows(intake), [
    { label: "Strumenti", value: "excel, Gestionale interno" },
    { label: "Frequenza", value: "Ogni settimana" },
    { label: "Persone che ne beneficiano", value: "1" },
    { label: "Minuti per volta", value: "30" },
    { label: "Euro per volta", value: "20 €" },
    { label: "Qualità", value: "Miglioramento sensibile" },
    { label: "Stato di sviluppo", value: "Prototipo" },
    { label: "Agente collegato", value: "Non lo sa" },
    { label: "Segnalazioni", value: "Sicurezza" },
  ]);
  assert.deepEqual(intakeModule.collectedDataRows({ hiddenFromSearch: true }), []);
  // Con la guida del connettore (forma di K8, src/lib/connector/tools.fixtures.ts): titoli, mai chiavi.
  const guide = intakeModule.guideLabels({
    areas: [{ id: "amministrazione", label: "Amministrazione" }, "vendite", { id: "operazioni" }, { label: "senza id" }],
    tools: [{ id: "foglio_calcolo", label: "Foglio di calcolo" }, { id: "gestionale", label: "Gestionale" }],
    agentCatalog: [{ id: "atlante", nome: "ATLANTE", cosaFa: "Prepara bozze" }],
  });
  assert.deepEqual(guide.areas, [
    { value: "amministrazione", label: "Amministrazione" },
    { value: "vendite", label: "vendite" },
    { value: "operazioni", label: "operazioni" },
  ]);
  assert.deepEqual(
    intakeModule.collectedDataRows({ tools: ["foglio_calcolo", "posta_elettronica"], relatedAgent: "atlante" }, guide),
    [
      { label: "Strumenti", value: "Foglio di calcolo, posta elettronica" },
      { label: "Agente collegato", value: "ATLANTE" },
    ],
    "senza titolo nella guida, la chiave resa leggibile",
  );
  assert.deepEqual(intakeModule.guideLabels(null), { areas: null, tools: {}, agents: {} });
  assert.deepEqual(intakeModule.guideLabels({ areas: [] }).areas, null, "elenco vuoto: l'area è un testo libero");
  assert.equal(inlineModule.optionLabelOf("amministrazione", guide.areas), "Amministrazione");
  assert.equal(inlineModule.optionLabelOf("Ufficio acquisti", guide.areas), "Ufficio acquisti", "un'area fuori elenco si legge com'è");
  assert.equal(inlineModule.optionLabelOf(null, guide.areas), null);
  assert.equal(intakeModule.urgencyText("quick_win"), "Soluzione rapida");
  assert.equal(intakeModule.urgencyText("Quick win"), "Soluzione rapida");
  assert.equal(intakeModule.urgencyText("Entro l'estate"), "Entro l'estate");
  // «Stime non ufficiali» (H4p): parole semplici, niente «semaforo» né «sforzo».
  assert.deepEqual(estimateModule.unofficialEstimateLines(intake), [
    "Circa 20 ore all'anno (30 minuti × 48 volte × 1 persona).",
    "Circa 960 € all'anno, secondo chi ha proposto.",
    "Secondo chi ha proposto: efficienza 4 su 5, impegno 2 su 5, nessun rischio particolare.",
  ]);
  assert.deepEqual(estimateModule.unofficialEstimateLines({ hiddenFromSearch: true }), []);
});

test("«Cosa è» e «Valutazione»: campi per tipo, KPI del modello, «Sforzo» al posto della parola inglese, KPI cambiati", opts, () => {
  const fields = whatModule.whatFieldRows(
    { kind: "da_diffondere", title: "T", description: null, flowDescription: null, humanInTheLoop: null, guardrails: null, businessCase: null, dataRequirements: null, area: null, aiLab: null, sustainabilityImpact: null },
    { esgEnabled: false },
  );
  assert.deepEqual(fields.map((f) => f.label), ["Titolo", "Prima", "Adesso", "Chi la usa", "Risultato", "Cosa serve per copiarla", "Area", "AI Lab"]);
  assert.equal(fields.find((f) => f.field === "area")?.max, 80);
  const groups = valuationModule.valuationKpiGroups(
    {
      dimensions: {
        impact: [{ id: "efficiency", label: "Efficienza", description: "Rubrica" } as never],
        feasibility: [{ id: "effort", label: "Effort" } as never],
        esg: [{ id: "social", label: "Sociale" } as never],
      },
    },
    { esgEnabled: false },
  );
  assert.deepEqual(groups, [
    { dimension: "impact", title: "Valore", kpis: [{ id: "efficiency", label: "Efficienza", description: "Rubrica" }] },
    { dimension: "feasibility", title: "Fattibilità", kpis: [{ id: "effort", label: "Sforzo", description: null }] },
  ]);
  assert.deepEqual(valuationModule.personKpiValues({ impact: { efficiency: 3.6, ghost: 2 } }, groups), { impact: { efficiency: 4 } });
  const saved = { impact: { efficiency: 4 } };
  assert.equal(formModule.changedKpis(groups, saved, { impact: { efficiency: 4 } }), undefined, "niente cambiato: niente `kpis`");
  assert.deepEqual(formModule.changedKpis(groups, saved, { feasibility: { effort: 2 } }), { impact: { efficiency: null }, feasibility: { effort: 2 } });
  // Solo i campi cambiati rispetto alla base del modulo; senza cambi `kpis: {}` (la scheda diventa «valutata»).
  const base = { kpis: saved, valueEurYear: 60000, cost: { band: 2 as const } };
  assert.deepEqual(formModule.valuationPayload({ groups, base, values: saved, valueText: "60.000", cost: { band: 2 } }), { kpis: {} }, "niente cambiato");
  assert.deepEqual(formModule.valuationPayload({ groups, base, values: saved, valueText: " ", cost: { band: 2 } }), { valueEurYear: null }, "valore tolto");
  assert.deepEqual(formModule.valuationPayload({ groups, base, values: saved, valueText: "60,5", cost: { band: 2 } }), { valueEurYear: "60,5" }, "un testo non valido va al servizio");
  assert.deepEqual(
    formModule.valuationPayload({ groups, base, values: { impact: { efficiency: 2 } }, valueText: "60000", cost: { eurOnce: 40000 } }),
    { kpis: { impact: { efficiency: 2 } }, cost: { eurOnce: 40000 } },
  );
  assert.equal(formModule.sameCost(null, null), true);
  assert.equal(formModule.sameCost({ band: 2 }, { band: 2 }), true);
  assert.equal(formModule.sameCost({ band: 2 }, { eurOnce: 2 }), false);
  assert.equal(formModule.sameCost({ eurOnce: 0 }, null), false);
  assert.equal(formModule.sameValueText("", null), true);
  assert.equal(formModule.sameValueText("60.000", 60000), true);
  assert.equal(formModule.sameValueText("abc", null), false);
  assert.deepEqual(formModule.valuationBaseOf(4, saved, null, { costEurOnce: null, costBand: 3 }), { version: 4, kpis: saved, valueEurYear: null, cost: { band: 3 }, model: null });
  // «Benefici e costi»: il modello parte solo se è cambiato; null lo toglie.
  const valueModel = {
    v: 1 as const,
    primary: "tempo" as const,
    components: [{ key: "t", lever: "tempo" as const, label: "Voce di prova", kind: "qualitativo" as const, confidence: "ipotesi" as const }],
  };
  assert.deepEqual(formModule.valuationPayload({ groups, base: { ...base, model: valueModel }, values: saved, valueText: "60.000", cost: { band: 2 }, model: valueModel }), { kpis: {} });
  assert.deepEqual(formModule.valuationPayload({ groups, base: { ...base, model: valueModel }, values: saved, valueText: "60.000", cost: { band: 2 }, model: null }), { model: null });
  assert.deepEqual(formModule.valuationPayload({ groups, base, values: saved, valueText: "60.000", cost: { band: 2 }, model: valueModel }), { model: valueModel });
  // Dopo una versione superata: i KPI cambiati dalla persona restano, gli altri prendono quelli riletti.
  assert.deepEqual(
    formModule.rebaseKpis(groups, { impact: { efficiency: 3 } }, { impact: { efficiency: 5 }, feasibility: { effort: 1 } }, { impact: { efficiency: 3 }, feasibility: { effort: 4 } }),
    { impact: { efficiency: 5 }, feasibility: { effort: 4 } },
  );
  assert.deepEqual(formModule.rebaseKpis(groups, { impact: { efficiency: 3 } }, { impact: { efficiency: 5 } }, {}), { impact: {} }, "«Nessun valore» scelto resta");
  assert.deepEqual(formModule.mergeKpiValues({ impact: { efficiency: 2, profitability: 3 } }, { impact: { efficiency: 5 } }), { impact: { efficiency: 5, profitability: 3 } });
  assert.deepEqual(aiBoxModule.aiValuesForForm({ impact: { efficiency: 3.7, removed: 4 }, feasibility: { effort: 9 } }, groups), { impact: { efficiency: 4 } }, "solo i KPI del modello, solo da 1 a 5");
});

test("pezzi del browser: tasti del campo, «+ Aggiungi …», voce del menu, variante di «Realizzazione»", opts, () => {
  const { inlineKeyAction, addLabelOf, sameFieldText } = inlineModule;
  assert.equal(inlineKeyAction("Escape", { shiftKey: false, multiline: true }), "annulla");
  assert.equal(inlineKeyAction("Enter", { shiftKey: false, multiline: true }), "salva");
  assert.equal(inlineKeyAction("Enter", { shiftKey: true, multiline: true }), null, "Maiusc+Invio va a capo");
  assert.equal(inlineKeyAction("Enter", { shiftKey: true, multiline: false }), "salva");
  assert.equal(inlineKeyAction("Enter", { shiftKey: false, multiline: false, composing: true }), null);
  assert.equal(addLabelOf("Problema"), "+ Aggiungi problema");
  assert.equal(addLabelOf("AI Lab"), "+ Aggiungi AI Lab");
  assert.equal(sameFieldText(" testo ", "testo"), true);
  assert.equal(hideModule.hideFromSearchLabel(true), "Mostra ai colleghi");
  assert.equal(hideModule.hideFromSearchLabel(false), "Nascondi dalla ricerca");
  const { realizationVariant } = realizationModule;
  const approved = { phase: "approvato" as const, subState: "piu_avanti" as const, kind: "da_costruire" as const, dossier: null };
  assert.equal(realizationVariant(approved, { dossierRead: "ok", canStartRealization: true, canMarkInProgress: true }), "avvia");
  assert.equal(realizationVariant(approved, { dossierRead: "spenta", canStartRealization: true, canMarkInProgress: true }), "segna");
  assert.equal(realizationVariant(approved, { dossierRead: "ok", canStartRealization: false, canMarkInProgress: false }), "lo_avvia_ls");
  assert.equal(realizationVariant(approved, { dossierRead: "errore", canStartRealization: true, canMarkInProgress: true }), "non_disponibile");
  assert.equal(realizationVariant({ ...approved, dossier: { status: "raccolta" } }, { dossierRead: "ok", canStartRealization: true, canMarkInProgress: true }), "dossier");
  assert.equal(realizationVariant({ ...approved, phase: "realizzato", subState: "diffusa", kind: "da_diffondere" }, { dossierRead: "ok", canStartRealization: false, canMarkInProgress: false }), "diffusa");
});

// ═══ Secondo modo: il harness (HTML e browser) ═══════════════════════

if (process.env.HUB_DETAIL_HARNESS === "1") {
  describe("sul harness: «non trovato» dal contenuto, area spenta, versione superata nel browser", () => {
    const port = process.env.UC_TEST_PG_PORT?.trim() || "55479";
    const database = process.env.UC_TEST_PG_DB?.trim() ?? "";
    // Niente porte predefinite: cdp.mjs, senza UC_TEST_LOGIN_PORT, entrerebbe dal login dei dossier.
    const appPort = process.env.UC_TEST_APP_PORT?.trim() ?? "";
    const loginPort = process.env.UC_TEST_LOGIN_PORT?.trim() ?? "";
    const root = process.env.UC_TEST_ROOT ?? "";
    if (!/^\d+$/.test(appPort) || !/^\d+$/.test(loginPort)) throw new Error("Set UC_TEST_APP_PORT and UC_TEST_LOGIN_PORT to the hub's app and login ports (53120, 53122)");
    // 55439 Learning, 55449 Casi d'uso, 55469 connettore: mai qui.
    if (["55439", "55449", "55469"].includes(port) || !/^hub_[a-z0-9][a-z0-9_]{0,39}$/.test(database)) {
      throw new Error("The harness run needs the hub cluster and a package database hub_<id> (UC_TEST_PG_PORT, UC_TEST_PG_DB)");
    }
    if (["53110", "53130"].includes(appPort) || ["53112", "53132"].includes(loginPort)) throw new Error("Use the hub's app and login ports");
    if (!root.startsWith("/private/tmp/") && !root.startsWith("/tmp/")) throw new Error("Set UC_TEST_ROOT to the harness directory");
    const app = `http://127.0.0.1:${appPort}`;
    const login = `http://127.0.0.1:${loginPort}`;
    /** scripts/uc-test/cdp.mjs (Casi d'uso C0), usato com'è. */
    const loadCdp = () => import(pathToFileURL(`${process.cwd()}/scripts/uc-test/cdp.mjs`).href);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    let client: { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; end(): Promise<void> };
    let fixtures: {
      workspaces: Record<"a" | "b", { workspaceId: string }>;
      hub: { useCases: Record<"a" | "b", Array<{ key: string; id: string; code: string | null; title: string }>> };
    };
    const created: string[] = [];

    async function cookieOf(account: string, to: string): Promise<string> {
      const response = await fetch(`${login}/as/${account}?to=${encodeURIComponent(to)}`, { redirect: "manual" });
      assert.equal(response.status, 302, "il login di prova risponde con il cookie");
      const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
      assert.match(cookie, /^__session=/);
      return cookie;
    }

    async function get(path: string, cookie: string): Promise<{ status: number; body: string }> {
      const response = await fetch(`${app}${path}`, { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(120_000) });
      return { status: response.status, body: await response.text() };
    }

    const seeded = (letter: "a" | "b", key: string) => {
      const found = fixtures.hub.useCases[letter].find((item) => item.key === key);
      assert.ok(found, `seed-hub: ${key}`);
      return found;
    };

    before(async () => {
      fixtures = JSON.parse(readFileSync(`${root.replace(/\/+$/, "")}/uc-fixtures/synthetic-fixtures.json`, "utf8"));
      const { default: pg } = (await import("pg")) as unknown as { default: { Client: new (config: object) => typeof client & { connect(): Promise<void> } } };
      const connection = new pg.Client({ host: "127.0.0.1", port: Number(port), user: "uc_test", database });
      await connection.connect();
      client = connection;
    });

    after(async () => {
      if (!client) return;
      if (created.length) await client.query(`DELETE FROM use_cases WHERE id = ANY($1::uuid[])`, [created]);
      await client.end();
    });

    test("osservatore: scheda nascosta altrui «Use case non trovato» con noindex (stato 200 sotto loading.tsx); la sua nascosta sì", async () => {
      const ws = fixtures.workspaces.a.workspaceId;
      const cookie = await cookieOf("osservatore", `/dashboard/${ws}/use-cases`);
      const hidden = seeded("a", "nascosta");
      // L'HTML: sotto loading.tsx lo stato resta 200; ci sono noindex e il segnale del 404, e
      // nessun dato della scheda, nemmeno nei dati della pagina.
      const page = await get(`/dashboard/${ws}/use-cases/${hidden.id}`, cookie);
      assert.ok(page.status < 500, `stato ${page.status}`);
      assert.match(page.body, /<meta name="robots" content="noindex"/, "noindex");
      assert.ok(page.body.includes("NEXT_HTTP_ERROR_FALLBACK;404"), "il confine «non trovato»");
      assert.ok(!page.body.includes(hidden.title) && !(hidden.code && page.body.includes(hidden.code)), "nessun dato della scheda");
      // Il contenuto: «Use case non trovato» (not-found.tsx) lo rende il browser al posto della scheda.
      const cdp = await loadCdp();
      const browser = await cdp.launchBrowser({ colorScheme: "dark" });
      try {
        const tab = await cdp.newPage(browser, { width: 1440 });
        await cdp.loginAs(tab, "osservatore", { to: `/dashboard/${ws}`, loginOrigin: login });
        await cdp.navigate(tab, `${app}/dashboard/${ws}/use-cases/${hidden.id}`);
        const shown = await cdp.evaluate(tab, () => ({
          text: document.body.innerText,
          h1: document.querySelector("h1")?.textContent ?? null,
          noindex: Boolean(document.querySelector('meta[name="robots"][content*="noindex"]')),
        }));
        assert.equal(shown.h1, "Use case non trovato");
        assert.ok(shown.text.includes("Forse è di un altro workspace, o il link è sbagliato."));
        assert.ok(shown.text.includes("Torna agli use case"));
        assert.equal(shown.noindex, true);
        assert.ok(!shown.text.includes(hidden.title));
        await cdp.closePage(tab);
      } finally {
        await browser.close();
      }
      const own = seeded("a", "osservatore-id");
      const mine = await get(`/dashboard/${ws}/use-cases/${own.id}`, cookie);
      assert.equal(mine.status, 200);
      assert.ok(mine.body.includes(own.title) && mine.body.includes(own.code!), "la sua proposta nascosta, con il codice");
      assert.ok(!mine.body.includes("NEXT_HTTP_ERROR_FALLBACK;404"));
      const byEmail = seeded("a", "osservatore-email");
      const note = await get(`/dashboard/${ws}/use-cases/${byEmail.id}`, cookie);
      assert.ok(note.body.includes(byEmail.code!) && note.body.includes("Quante richieste arrivano a settimana?"), "codice e nota pubblica della sua proposta");
      const other = seeded("a", "r09");
      const theirs = await get(`/dashboard/${ws}/use-cases/${other.id}`, cookie);
      assert.ok(theirs.body.includes(other.title) && !theirs.body.includes(other.code!), "altrui: titolo senza codice");
      assert.ok(!/€|data-figure/.test(theirs.body), "nessuna cifra, nemmeno nei dati della pagina");
    });

    test("area spenta nel workspace «b»: `/use-cases/nuovo` è «non trovato», riconosciuto dal contenuto", async () => {
      const ws = fixtures.workspaces.b.workspaceId;
      const cookie = await cookieOf("ls-lead", `/dashboard/${ws}/use-cases`);
      const page = await get(`/dashboard/${ws}/use-cases/nuovo`, cookie);
      assert.ok(page.status < 500, `stato ${page.status}`);
      assert.match(page.body, /<meta name="robots" content="noindex"/);
      assert.ok(!page.body.includes("Nuovo use case"), "nessun modulo, nemmeno nei dati della pagina");
      // Il contenuto che si vede, non i dati della pagina (dove il segnale del 404 c'è sempre):
      // `use-cases/nuovo` non ha un suo not-found.tsx (DESIGN §2.2, §4.9), quindi la pagina
      // «non trovato» di Next; con un confine dell'area, «Use case non trovato».
      const cdp = await loadCdp();
      const browser = await cdp.launchBrowser({ colorScheme: "dark" });
      try {
        const tab = await cdp.newPage(browser, { width: 1440 });
        await cdp.loginAs(tab, "ls-lead", { to: `/dashboard/${ws}`, loginOrigin: login });
        await cdp.navigate(tab, `${app}/dashboard/${ws}/use-cases/nuovo`);
        const shown = await cdp.evaluate(tab, () => ({
          text: document.body.innerText,
          heading: [...document.querySelectorAll("h1, h2")].map((el) => el.textContent?.trim() ?? "").join(" | "),
          forms: document.querySelectorAll("form").length,
          noindex: Boolean(document.querySelector('meta[name="robots"][content*="noindex"]')),
        }));
        assert.match(shown.text, /This page could not be found\.|Use case non trovato/, `la pagina «non trovato»: ${shown.heading}`);
        assert.ok(!/Nuovo use case|Invia lo use case|Che cosa proponi\?/.test(shown.text), "nessun modulo a schermo");
        assert.equal(shown.forms, 0, "nessun modulo nella pagina");
        assert.equal(shown.noindex, true);
        await cdp.closePage(tab);
      } finally {
        await browser.close();
      }
    });

    test("nel browser: `?capitolo=` tiene evidenziata la sua ancora anche per i capitoli in fondo; scorrendo, il capitolo in vista", async () => {
      const ws = fixtures.workspaces.a.workspaceId;
      const cdp = await loadCdp();
      const browser = await cdp.launchBrowser({ colorScheme: "dark" });
      const current = (tab: unknown) =>
        cdp.evaluate(tab, () => document.querySelector('nav[aria-label="Capitoli"] a[aria-current="location"]')?.getAttribute("data-chapter") ?? null);
      try {
        for (const width of [1440, 400]) {
          const tab = await cdp.newPage(browser, { width });
          await cdp.loginAs(tab, "ls-lead", { to: `/dashboard/${ws}`, loginOrigin: login });
          for (const [key, chapter] of [
            ["r09", "realizzazione"],
            ["r17", "storia"],
            ["r09", "valutazione"],
          ] as const) {
            await cdp.navigate(tab, `${app}/dashboard/${ws}/use-cases/${seeded("a", key).id}?capitolo=${chapter}`);
            await sleep(600);
            assert.equal(await current(tab), chapter, `${width} px, ?capitolo=${chapter}: l'ancora evidenziata`);
          }
          // La persona scorre (rotella) fino in cima: il capitolo in vista è il primo.
          await cdp.evaluate(tab, () => {
            window.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true }));
            window.scrollTo(0, 0);
          });
          await sleep(400);
          assert.equal(await current(tab), "cosa-e", `${width} px: in cima, «Cosa è»`);
          // Fino in fondo: l'ultimo capitolo visibile.
          await cdp.evaluate(tab, () => {
            window.dispatchEvent(new WheelEvent("wheel", { deltaY: 400, bubbles: true }));
            window.scrollTo(0, document.documentElement.scrollHeight);
          });
          await sleep(400);
          assert.equal(await current(tab), "storia", `${width} px: in fondo, «Storia»`);
          await cdp.closePage(tab);
        }
      } finally {
        await browser.close();
      }
    });

    test("nel browser: versione superata, il toast di §6.8 e il testo che resta nel campo", async () => {
      const ws = fixtures.workspaces.a.workspaceId;
      const id = randomUUID();
      const code = `XX-${80_000 + Math.floor(Math.random() * 9_999)}`;
      await client.query(
        `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
         VALUES ($1::uuid, $2::uuid, $3, 'Problema sintetico', 'proposed', 'in_review', 'use_case_ai', $4, 'manual')`,
        [id, ws, `Scheda del browser ${suffix}`, code],
      );
      created.push(id);
      const cdp = await loadCdp();
      const browser = await cdp.launchBrowser({ colorScheme: "dark" });
      try {
        const page = await cdp.newPage(browser, { width: 1440 });
        await cdp.loginAs(page, "ls-lead", { to: `/dashboard/${ws}`, loginOrigin: login });
        await cdp.navigate(page, `${app}/dashboard/${ws}/use-cases/${id}`);
        const typed = `Testo scritto nel campo ${suffix}`;
        // «+ Aggiungi come funziona»: il campo si apre.
        const opened = await cdp.evaluate(page, (label: string) => {
          const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
          button?.click();
          return Boolean(button);
        }, "+ Aggiungi come funziona");
        assert.equal(opened, true, "«+ Aggiungi come funziona»");
        await new Promise((resolve) => setTimeout(resolve, 300));
        await cdp.evaluate(page, (text: string) => {
          const area = document.querySelector('[data-field="flowDescription"] textarea') as HTMLTextAreaElement | null;
          if (!area) throw new Error("nessun campo");
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
          setter.call(area, text);
          area.dispatchEvent(new Event("input", { bubbles: true }));
        }, typed);
        // Un collega modifica la scheda nel frattempo.
        await client.query(`UPDATE use_cases SET guardrails = 'Limiti di un collega' WHERE id = $1::uuid`, [id]);
        await cdp.evaluate(page, () => {
          const area = document.querySelector('[data-field="flowDescription"] textarea') as HTMLTextAreaElement;
          area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        });
        let seen: { toast: boolean; value: string | null } = { toast: false, value: null };
        for (let i = 0; i < 40 && !seen.toast; i++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          seen = await cdp.evaluate(page, () => ({
            toast: document.body.innerText.includes("Qualcuno ha appena modificato questo use case. Ho ricaricato i dati: rifai la modifica."),
            value: (document.querySelector('[data-field="flowDescription"] textarea') as HTMLTextAreaElement | null)?.value ?? null,
          }));
        }
        assert.equal(seen.toast, true, "il toast della versione superata");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const still = await cdp.evaluate(page, () => ({
          value: (document.querySelector('[data-field="flowDescription"] textarea') as HTMLTextAreaElement | null)?.value ?? null,
          limits: document.body.innerText.includes("Limiti di un collega"),
        }));
        assert.equal(still.value, typed, "il testo scritto resta nel campo");
        assert.equal(still.limits, true, "la pagina si è ricaricata con la modifica del collega");
        const [r] = (await client.query(`SELECT flow_description FROM use_cases WHERE id = $1::uuid`, [id])).rows;
        assert.equal(r.flow_description, null, "niente salvato con la versione vecchia");
        await cdp.closePage(page);
      } finally {
        await browser.close();
      }
    });

    test("nel browser: «Modifica valutazione» dopo una versione superata non riporta indietro la valutazione di un collega", async () => {
      const ws = fixtures.workspaces.a.workspaceId;
      const id = randomUUID();
      const code = `XX-${80_000 + Math.floor(Math.random() * 9_999)}`;
      await client.query(
        `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, cost_band, value_eur_year, custom_scores)
         VALUES ($1::uuid, $2::uuid, $3, 'Problema sintetico', 'proposed', 'in_review', 'use_case_ai', $4, 'manual', 2, 60000, '{"impact":{"efficiency":3}}'::jsonb)`,
        [id, ws, `Scheda della valutazione ${suffix}`, code],
      );
      created.push(id);
      const cdp = await loadCdp();
      const browser = await cdp.launchBrowser({ colorScheme: "dark" });
      const formState = (page: unknown) =>
        cdp.evaluate(page, () => {
          const form = document.querySelector('[data-slot="valuation-form"]');
          const label = [...(form?.querySelectorAll("label") ?? [])].find((el) => el.textContent?.trim() === "Valore all'anno (facoltativo)");
          const value = label ? (document.getElementById(label.htmlFor) as HTMLInputElement | null) : null;
          return {
            open: Boolean(form),
            value: value?.value ?? null,
            cost: (form?.querySelector('input[type="hidden"][name="cost"]') as HTMLInputElement | null)?.value ?? null,
            toast: document.body.innerText.includes("Qualcuno ha appena modificato questo use case. Ho ricaricato i dati: rifai la modifica."),
          };
        });
      const clickButton = (page: unknown, text: string) =>
        cdp.evaluate(page, (label: string) => {
          const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
          button?.click();
          return Boolean(button);
        }, text);
      try {
        const page = await cdp.newPage(browser, { width: 1440 });
        await cdp.loginAs(page, "ls-lead", { to: `/dashboard/${ws}`, loginOrigin: login });
        await cdp.navigate(page, `${app}/dashboard/${ws}/use-cases/${id}`);
        assert.equal(await clickButton(page, "Modifica valutazione"), true, "«Modifica valutazione»");
        await sleep(300);
        assert.equal((await formState(page)).cost, '{"band":2}', "il modulo parte dal costo salvato");
        // La persona cambia solo il valore all'anno.
        await cdp.evaluate(page, () => {
          const form = document.querySelector('[data-slot="valuation-form"]')!;
          const label = [...form.querySelectorAll("label")].find((el) => el.textContent?.trim() === "Valore all'anno (facoltativo)")!;
          const input = document.getElementById(label.htmlFor) as HTMLInputElement;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "75000");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        // Un collega salva costo e KPI nel frattempo.
        await client.query(`UPDATE use_cases SET cost_eur_once = 40000, cost_band = NULL, custom_scores = '{"impact":{"efficiency":5}}'::jsonb WHERE id = $1::uuid`, [id]);
        assert.equal(await clickButton(page, "Salva la valutazione"), true);
        let seen = await formState(page);
        for (let i = 0; i < 40 && !seen.toast; i++) {
          await sleep(250);
          seen = await formState(page);
        }
        assert.equal(seen.toast, true, "il toast della versione superata");
        // Riletta la pagina: il valore scritto resta, il costo non toccato è quello del collega.
        for (let i = 0; i < 40 && seen.cost !== '{"eurOnce":40000}'; i++) {
          await sleep(250);
          seen = await formState(page);
        }
        assert.equal(seen.open, true, "il modulo resta aperto");
        assert.equal(seen.value, "75000", "il valore scritto resta nel campo");
        assert.equal(seen.cost, '{"eurOnce":40000}', "il costo non toccato mostra quello del collega");
        let [r] = (await client.query(`SELECT value_eur_year, cost_band, cost_eur_once, custom_scores FROM use_cases WHERE id = $1::uuid`, [id])).rows;
        assert.equal(Number(r.value_eur_year), 60000, "niente salvato con la versione vecchia");
        // Di nuovo «Salva la valutazione»: parte solo il valore, con la versione nuova.
        assert.equal(await clickButton(page, "Salva la valutazione"), true);
        for (let i = 0; i < 40 && seen.open; i++) {
          await sleep(250);
          seen = await formState(page);
        }
        assert.equal(seen.open, false, "salvato: il modulo si chiude");
        [r] = (await client.query(`SELECT value_eur_year, cost_band, cost_eur_once, custom_scores, portfolio_review_status FROM use_cases WHERE id = $1::uuid`, [id])).rows;
        assert.equal(Number(r.value_eur_year), 75000, "il valore della persona");
        assert.equal(Number(r.cost_eur_once), 40000, "il costo del collega resta");
        assert.equal(r.cost_band, null);
        assert.deepEqual((r.custom_scores as { impact?: unknown }).impact, { efficiency: 5 }, "i KPI del collega restano");
        assert.equal(r.portfolio_review_status, "scored");
        await cdp.closePage(page);
      } finally {
        await browser.close();
      }
    });
  });
}
