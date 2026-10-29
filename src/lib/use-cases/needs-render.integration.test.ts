import test, { after, before, beforeEach } from "node:test";
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

// «Cosa serve» nelle pagine vere (spec di Pierpaolo, 25/10/2026), rese in questo processo con la
// sessione scelta dalla prova:
//
// - «Cosa serve»: la sua vista, solo per i revisori, ultima nel selettore: sotto «Requisiti» la riga
//   dei conteggi, poi un'area chiusa per riga con i suoi conteggi (le righe a posto chiuse, «Per N
//   use case» chiuso, prima gli agenti dei titoli), i prossimi passi aperti fino al mese di oggi
//   («Più avanti» e «Senza data» chiusi, i fatti chiusi), «Cosa vi chiediamo questo trimestre»
//   chiuso, una riga per gli use case in realizzazione con la Panoramica. Con un filtro, le esigenze
//   degli use case che lo passano; con una ricerca le aree aperte, con il trimestre di «Prossimo
//   passo» chiuse, il trimestre in testa ai conteggi. La Panoramica non le mostra: ne conta i
//   requisiti per «Prossimo passo» (quelli degli use case approvati per questo trimestre, ognuno una
//   volta), in un workspace a parte, e «Cosa serve» del trimestre conta gli stessi.
// - Il pannello: al massimo tre esigenze aperte, le altre nella scheda.
// - La scheda: il capitolo «Cosa serve» con la modifica; le action scrivono solo per i revisori.
// - Chi non è revisore non riceve esigenze da nessuna parte: pagina, pannello, scheda, action.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del pacchetto
// hub_<id> su 127.0.0.1) gira sul database di prova; dentro `npm run check` si salta. I `.tsx` si
// traducono qui con TypeScript; `@/lib/auth` restituisce la sessione della prova. Dati sintetici,
// creati e cancellati qui.
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
type Ctx = import("./service.ts").WriteContext;

let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let renderToStaticMarkup: (element: unknown) => string;
let createElementOf: (type: unknown, props: unknown) => unknown;
let pageOfUseCases: Page;
let pageOfDetail: Page;
let svc: typeof import("./needs-service.ts");
let needs: typeof import("./needs.ts");
let format: typeof import("./format.ts");
let hub: typeof import("../../components/use-cases/hub.tsx");
let board: typeof import("../../components/use-cases/needs-board.tsx");
let panel: typeof import("../../components/use-cases/use-case-panel.tsx");
let actions: typeof import("../actions/use-case-needs.ts");
let access: typeof import("../workspace-access.ts");

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  /** Con le esigenze. */
  ws: randomUUID(),
  /** Area accesa, nessuna esigenza. */
  wsEmpty: randomUUID(),
  /** Un altro workspace con un'esigenza sua. */
  wsOther: randomUUID(),
  /** «Prossimo passo» della Panoramica: due use case di questo trimestre e i loro requisiti. */
  wsStart: randomUUID(),
  ls: randomUUID(),
  builder: randomUUID(),
  manager: randomUUID(),
  contributor: randomUUID(),
};
const emails = {
  ls: `ls.serve.${suffix}@ls.test`,
  builder: `builder.serve.${suffix}@cliente.test`,
  manager: `sponsor.serve.${suffix}@cliente.test`,
  contributor: `contributor.serve.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;
const ROLES: Record<Person, string> = { ls: "transformation_lead", builder: "function_lead", manager: "exec_sponsor", contributor: "contributor" };
const REVIEWERS = ["ls", "builder", "manager"] as const;
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const state = globalThis as { __hubServeSession?: unknown; __hubServeRevalidated?: string[] };

/** FIX_A della spec, con chi conferma: 6.600 all'anno × 1,5 min × 70% ≈ 116 h · 4.043 €. */
const FIX_A = {
  v: 1,
  primary: "tempo",
  components: [
    { key: "capacita", lever: "nuove_capacita", label: "Risposte anche fuori orario", kind: "qualitativo", confidence: "fonte" },
    { key: "tempo", lever: "tempo", label: "Smistamento delle richieste", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" },
    { key: "qualita", lever: "qualita", label: "Meno errori di smistamento", kind: "qualitativo", confidence: "da_misurare" },
  ],
  ease: 4,
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
  confirmBy: `Giulia, servizio clienti ${suffix}`,
};

const T = {
  access: `Accesso al gestionale ${suffix}`,
  extract: `Estratto delle richieste ${suffix}`,
  decide: `Chi approva le risposte ${suffix}`,
  procedure: `Procedura di smistamento ${suffix}`,
  other: `Una stanza per i test ${suffix}`,
  kickoff: `Kick-off con il servizio clienti ${suffix}`,
  demo: `Prima demo ${suffix}`,
  archived: `Vecchia richiesta ${suffix}`,
  foreign: `Esigenza di un altro workspace ${suffix}`,
};

/** Le esigenze del workspace di «Prossimo passo». */
const START = {
  shared: `Accesso alla posta delle fatture ${suffix}`,
  blocked: `Contratto con il fornitore ${suffix}`,
  verify: `Estratto delle fatture del 2025 ${suffix}`,
  progress: `Estratto dei pagamenti ${suffix}`,
  next: `Regole di riconciliazione ${suffix}`,
};

const codeBase = 40_000 + Math.floor(Math.random() * 50_000);
let codeSeq = 0;
const cards = {} as Record<"quarter" | "proposed" | "progress" | "empty" | "own", { id: string; code: string }>;
const needIds = {} as Record<keyof typeof T, string>;
const startCards = {} as Record<"a" | "b" | "progress" | "next" | "proposed", { id: string; code: string }>;
let today = "";
let dueSoon = "";

async function seed(s: {
  workspaceId: string;
  title: string;
  status?: string;
  review?: string;
  targetQuarter?: string | null;
  valueModel?: unknown;
  proposedBy?: string;
}): Promise<{ id: string; code: string }> {
  const id = randomUUID();
  const code = `XS-${codeBase + codeSeq++}`;
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, origin, code,
       target_quarter, value_model, source, proposed_by, submitted_at)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', $4::use_case_status, $5::portfolio_review_status, 'use_case_ai', 'adoption', $6,
       $7, $8::jsonb, 'web_proposed', $9, now() - interval '3 days')`,
    [id, s.workspaceId, s.title, s.status ?? "accepted", s.review ?? "scored", code, s.targetQuarter ?? null, s.valueModel ? JSON.stringify(s.valueModel) : null, s.proposedBy ?? `collega.${suffix}@cliente.test`],
  );
  return { id, code };
}

function as(person: Person, workspaceId: string = ids.ws): Ctx {
  return { workspaceId, actor: { userId: ids[person], role: ROLES[person], isLateralSpace: person === "ls", kind: "persona" }, channel: "pagina" };
}

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}

/** I percorsi riletti dalle action dall'inizio della prova. */
const revalidated = (): string[] => [...(state.__hubServeRevalidated ?? [])];

function signIn(person: Person | null): void {
  state.__hubServeSession = person ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}`, image: null } } : null;
}

/** I pulsanti pieni della pagina: `[data-slot=button]` con la classe `bg-primary` (§5.7). */
function filledButtons(page: string): string[] {
  return [...page.matchAll(/<(?:a|button)\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));
}

/** L'HTML con le entità più comuni tolte, per cercare i testi come si leggono. */
function readable(page: string): string {
  return page.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function hubHtml(person: Person, workspaceId: string, searchParams: Record<string, string> = {}): Promise<string> {
  signIn(person);
  const element = await pageOfUseCases({ params: Promise.resolve({ workspaceId }), searchParams: Promise.resolve(searchParams) });
  return readable(renderToStaticMarkup(element));
}

async function detailHtml(person: Person, useCaseId: string): Promise<string> {
  signIn(person);
  const element = await pageOfDetail({ params: Promise.resolve({ workspaceId: ids.ws, useCaseId }), searchParams: Promise.resolve({}) });
  return readable(renderToStaticMarkup(element));
}

/** I dati e l'albero della pagina, senza renderli: il pannello vive in un portale. */
async function hubTree(person: Person, workspaceId: string, searchParams: Record<string, string>) {
  const workspaceAccess = await access.getWorkspaceAccessForUser(ids[person], workspaceId);
  assert.ok(workspaceAccess, `${person} è nel workspace`);
  const session = { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}`, image: null } };
  const data = await hub.loadUseCaseHub({ workspaceId, session: session as never, access: workspaceAccess, searchParams });
  assert.ok(data);
  return { data, tree: hub.UseCaseHub({ data }) as unknown };
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

/** Il pezzo di HTML da `data-slot="<slot>"` fino al prossimo `data-slot` dello stesso livello che si chiede. */
function between(page: string, from: string, to?: string): string {
  const start = page.indexOf(from);
  assert.ok(start >= 0, `manca ${from}`);
  const end = to ? page.indexOf(to, start + from.length) : -1;
  return page.slice(start, end === -1 ? undefined : end);
}

/** Chiuso di default: l'apertura del `<details>` senza l'attributo `open` (la classe `open:basis-full` non conta). */
function assertClosed(details: string, label = "chiuso di default"): void {
  assert.doesNotMatch(details.slice(0, details.indexOf(">")).replace(/="[^"]*"/g, ""), /\sopen\b/, label);
}

/** Il `<details>` che contiene `marker`, dalla sua apertura alla chiusura. */
function detailsAround(page: string, marker: string): string {
  const at = page.indexOf(marker);
  assert.ok(at >= 0, `manca ${marker}`);
  const start = page.lastIndexOf("<details", at);
  assert.ok(start >= 0, `${marker} non è dentro un <details>`);
  return page.slice(start, page.indexOf("</details>", at));
}

/** Il testo che si legge di un pezzo di HTML: senza tag (anche con «>» nelle classi, già senza entità), gli spazi uniti. */
const textOf = (html: string) => html.replace(/<(?:[^>"]|"[^"]*")*>/g, "").replace(/\s+/g, " ").trim();

/** La riga dei conteggi sotto «Requisiti» (`data-slot="needs-summary"`), come si legge. */
function summaryOf(page: string): string {
  return textOf(between(page, 'data-slot="needs-summary"', "</p>").replace(/^[^>]*>/, ""));
}

/** Ogni area di «Requisiti»: la chiave, l'apertura del suo `<details>` e il titolo chiuso, come si legge. */
function areasOf(page: string): Array<{ key: string; opening: string; summary: string }> {
  return [...page.matchAll(/<section aria-labelledby="[^"]*" data-need-area="([a-z]+)">(<details[^>]*>)<summary[^>]*>([\s\S]*?)<\/summary>/g)].map(([, key, opening, summary]) => ({
    key,
    opening,
    summary: textOf(summary),
  }));
}

before(async () => {
  if (!enabled) return;
  const { default: ts } = await import("typescript");
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "@/lib/auth": stub("export async function auth() { return globalThis.__hubServeSession ?? null; }"),
    "next/cache": stub(
      "export function revalidatePath(path) { (globalThis.__hubServeRevalidated ??= []).push(path); }\n" +
        "export function revalidateTag() {}\nexport function refresh() {}\nexport function updateTag() {}\n" +
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
  createElementOf = (type, props) => createElement(type as never, props as never);
  const { renderToStaticMarkup: toHtml } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as {
    AppRouterContext: import("react").Context<object | null>;
  };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  renderToStaticMarkup = (element) => toHtml(createElement(AppRouterContext.Provider, { value: router }, element as never));
  pageOfUseCases = (await import("../../app/(dashboard)/dashboard/[workspaceId]/use-cases/page.tsx")).default as unknown as Page;
  pageOfDetail = (await import("../../app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/page.tsx")).default as unknown as Page;
  svc = await import("./needs-service.ts");
  needs = await import("./needs.ts");
  format = await import("./format.ts");
  hub = await import("../../components/use-cases/hub.tsx");
  board = await import("../../components/use-cases/needs-board.tsx");
  panel = await import("../../components/use-cases/use-case-panel.tsx");
  actions = await import("../actions/use-case-needs.ts");
  access = await import("../workspace-access.ts");
  const quarter = await import("./quarter.ts");
  today = quarter.romeToday();
  const due = new Date(`${today}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 20);
  dueSoon = due.toISOString().slice(0, 10);

  process.env.USE_CASE_HUB_WORKSPACES = [ids.ws, ids.wsEmpty, ids.wsOther, ids.wsStart].join(",");
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova cosa serve', $2)`, [ids.org, `hub-serve-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $4::uuid, 'Prova cosa serve'), ($2::uuid, $4::uuid, 'Prova senza esigenze'), ($3::uuid, $4::uuid, 'Altro workspace')`, [
    ids.ws,
    ids.wsEmpty,
    ids.wsOther,
    ids.org,
  ]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova prossimo passo')`, [ids.wsStart, ids.org]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    for (const workspaceId of [ids.ws, ids.wsEmpty, ids.wsOther, ids.wsStart]) {
      await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [workspaceId, ids[person], ROLES[person]]);
    }
  }

  cards.quarter = await seed({ workspaceId: ids.ws, title: `Smistamento ${suffix}`, targetQuarter: quarter.currentQuarter(), valueModel: FIX_A });
  cards.proposed = await seed({ workspaceId: ids.ws, title: `Preventivi ${suffix}`, status: "proposed", review: "in_review" });
  cards.progress = await seed({ workspaceId: ids.ws, title: `Fatture ${suffix}`, status: "in_progress" });
  cards.own = await seed({ workspaceId: ids.ws, title: `Mia proposta ${suffix}`, status: "proposed", review: "in_review", proposedBy: ids.contributor });
  cards.empty = await seed({ workspaceId: ids.wsEmpty, title: `Senza esigenze ${suffix}`, status: "proposed", review: "in_review" });
  const foreignCard = await seed({ workspaceId: ids.wsOther, title: `Altrove ${suffix}`, status: "proposed", review: "in_review" });

  const create = async (key: keyof typeof T, input: Record<string, unknown>, useCaseIds: string[] = [cards.quarter.id], workspaceId = ids.ws) => {
    needIds[key] = ok(await svc.createNeed(as("ls", workspaceId), { title: T[key], ...input }, { useCaseIds }), key).id;
  };
  await create("access", { type: "requisito", kind: "accesso", ownerLabel: "Ufficio IT", ownerSide: "cliente", status: "chiesta", dueOn: dueSoon, availability: "subito" }, [cards.quarter.id, cards.proposed.id]);
  await create("extract", { type: "requisito", kind: "dato", status: "validata" });
  await create("decide", { type: "requisito", kind: "decisione", ownerSide: "insieme", dueLabel: "entro fine mese" });
  await create("procedure", { type: "requisito", kind: "documento", availability: "dopo_a8", dueOn: dueSoon, dueIsProposal: true });
  await create("other", { type: "requisito", kind: "altro" });
  await create("kickoff", { type: "passo", status: "confermata", dueOn: dueSoon, ownerLabel: "Lateral Space" }, []);
  await create("demo", { type: "passo", status: "fatta" }, []);
  await create("archived", { type: "requisito", kind: "accesso" });
  ok(await svc.archiveNeed(as("ls"), needIds.archived, 1, "Non serve più"));
  await create("foreign", { type: "requisito", kind: "accesso" }, [foreignCard.id], ids.wsOther);

  // «Prossimo passo»: due use case approvati per questo trimestre con un requisito in comune, uno
  // bloccato e uno da verificare; uno già partito e uno del trimestre dopo, con i loro requisiti, che
  // non contano; una proposta da decidere, che viene dopo i requisiti.
  const thisQuarter = quarter.currentQuarter();
  startCards.a = await seed({ workspaceId: ids.wsStart, title: `LIBRA L1 · Fatture estere ${suffix}`, targetQuarter: thisQuarter });
  startCards.b = await seed({ workspaceId: ids.wsStart, title: `LIBRA L2 · Pagamenti ${suffix}`, targetQuarter: thisQuarter });
  startCards.progress = await seed({ workspaceId: ids.wsStart, title: `ORSA O1 · Solleciti ${suffix}`, status: "in_progress", targetQuarter: thisQuarter });
  startCards.next = await seed({ workspaceId: ids.wsStart, title: `ORSA O2 · Riconciliazione ${suffix}`, targetQuarter: quarter.nextQuarter(thisQuarter) });
  startCards.proposed = await seed({ workspaceId: ids.wsStart, title: `Proposta da decidere ${suffix}`, status: "proposed", review: "in_review" });
  const startNeed = async (title: string, input: Record<string, unknown>, useCaseIds: string[]) =>
    ok(await svc.createNeed(as("ls", ids.wsStart), { type: "requisito", title, ...input }, { useCaseIds }), title);
  await startNeed(START.shared, { kind: "accesso", ownerSide: "cliente" }, [startCards.a.id, startCards.b.id]);
  await startNeed(START.blocked, { kind: "contratto", ownerSide: "lateral_space", status: "bloccata" }, [startCards.b.id]);
  await startNeed(START.verify, { kind: "dato", status: "in_verifica" }, [startCards.a.id, startCards.b.id]);
  await startNeed(START.progress, { kind: "dato" }, [startCards.progress.id]);
  await startNeed(START.next, { kind: "regola" }, [startCards.next.id]);
});

beforeEach(() => {
  state.__hubServeRevalidated = [];
});

after(async () => {
  signIn(null);
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.wsEmpty, ids.wsOther, ids.wsStart]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((person) => ids[person as Person])]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
});

// ─── Cosa serve ──────────────────────────────────────────────────────

test("Cosa serve: la vista dei revisori, una tabella per area, le righe a posto chiuse, «Per» che apre il pannello", opts, async () => {
  for (const person of REVIEWERS) {
    const page = await hubHtml(person, ids.ws, { vista: "cosa-serve" });
    assert.ok(page.includes('data-slot="needs-board"'), person);
    assert.ok(page.includes(">Requisiti<"), person);
  }
  const page = await hubHtml("builder", ids.ws, { vista: "cosa-serve" });
  const requirements = between(page, 'data-slot="needs-requirements"', 'data-slot="needs-steps"');
  // Le aree nell'ordine della pagina, solo quelle con righe.
  const areas = [...requirements.matchAll(/data-need-area="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(areas, ["accessi", "dati", "regole", "altro"]);
  // Sotto «Requisiti» la riga dei conteggi, prima della prima area: i requisiti per stato, mai per persona.
  assert.equal(summaryOf(page), "4 aperti · 3 da chiedere · 1 in attesa · 1 a posto");
  assert.ok(requirements.indexOf('data-slot="needs-summary"') < requirements.indexOf("data-need-area="));
  // Ogni area è una riga chiusa con il nome e i suoi conteggi; si apre sulla sua tabella.
  assert.deepEqual(
    areasOf(requirements).map((area) => [area.key, area.opening, area.summary]),
    [
      ["accessi", '<details data-slot="needs-area">', "Accessi · 1 in attesa"],
      ["dati", '<details data-slot="needs-area">', "Dati e documenti · 1 da chiedere · 1 a posto"],
      ["regole", '<details data-slot="needs-area">', "Regole e decisioni · 1 da chiedere"],
      ["altro", '<details data-slot="needs-area">', "Altro · 1 da chiedere"],
    ],
  );
  // Il nome dell'area dà il titolo alla sezione e alla tabella; l'h3 di prima non c'è.
  assert.ok(requirements.includes('<span id="cosa-serve-area-accessi" class="font-medium text-foreground">Accessi</span>'));
  assert.ok(requirements.includes('<table aria-labelledby="cosa-serve-area-accessi"') && !requirements.includes('<h3 id="cosa-serve-area-'));
  // Senza prefissi nei titoli, nessun tag di agente.
  assert.ok(!page.includes('data-slot="need-agents"'));
  for (const header of ["Che cosa", "Chi", "Per", "Stato", "Entro"]) assert.ok(requirements.includes(`>${header}</th>`), header);

  const accessRow = between(requirements, `data-need="${needIds.access}"`, "</tr>");
  assert.ok(accessRow.includes(T.access));
  assert.ok(accessRow.replace(/<!--.*?-->|<[^>]+>/g, "").includes("Ufficio IT · Cliente"), "Chi: persona e parte");
  // Nella colonna stretta il «·» va a capo con «Cliente», mai da solo in fondo alla riga.
  assert.ok(accessRow.includes('Ufficio IT<span> <span class="whitespace-nowrap">· Cliente</span></span>'), accessRow);
  // Due use case: «Per 2 use case», chiuso, con i due link al pannello.
  const per = detailsAround(accessRow, "Per 2 use case");
  assertClosed(per);
  assert.ok(per.includes('data-slot="need-use-cases"'));
  for (const card of [cards.quarter, cards.proposed]) {
    assert.ok(per.includes(`>${card.code}<`), card.code);
    assert.match(per, new RegExp(`href="[^"]*apri=${card.id}"`), "il link apre il pannello");
  }
  assert.ok(per.includes(`Smistamento ${suffix}`) && per.includes(`Preventivi ${suffix}`), "codice e titolo");
  assert.ok(per.includes(`<span class="sr-only">: ${T.access}</span>`), "il titolo dell'esigenza per i lettori di schermo");
  assert.ok(accessRow.includes(">Chiesta, in attesa<"), "lo stato delle voci");
  assert.ok(accessRow.includes(`>${format.formatDayInYear(dueSoon, today)}<`), "Entro");
  // Uno use case: il suo link per intero, senza <details>.
  const procedureRow = between(requirements, `data-need="${needIds.procedure}"`, "</tr>");
  assert.ok(procedureRow.includes(`>${cards.quarter.code}<`) && procedureRow.includes(`Smistamento ${suffix}`));
  assert.match(procedureRow, new RegExp(`href="[^"]*apri=${cards.quarter.id}"`));
  assert.ok(!procedureRow.includes('data-slot="need-use-cases"'));
  assert.ok(procedureRow.includes("(proposta)"), "la data da confermare");

  // Già a posto: in un <details> chiuso; archiviate e altri workspace: mai.
  const done = detailsAround(requirements, T.extract);
  assert.ok(done.includes("Già a posto · 1"));
  assertClosed(done);
  assert.ok(between(requirements, `data-need="${needIds.decide}"`, "</tr>").includes("entro fine mese"));
  assert.ok(!page.includes(T.archived), "l'archiviata non c'è");
  assert.ok(!page.includes(T.foreign), "le esigenze di un altro workspace non ci sono");
  assert.ok(requirements.includes('data-slot="needs-list"'), "sotto i 56rem del riquadro, l'elenco");
  // «Entro» solo nelle aree con una data: «Altro» non ne ha, e non ha una colonna di «—».
  assert.ok(between(requirements, 'data-need-area="accessi"', 'data-need-area="dati"').includes(">Entro</th>"));
  const other = between(requirements, 'data-need-area="altro"');
  assert.ok(!other.includes(">Entro</th>"), "nessuna colonna «Entro» senza date");
  assert.ok(other.includes(">Per</th>") && other.includes('class="w-[42%] px-3 py-2 font-medium"'), "le altre colonne si allargano");
  // Nell'elenco ogni «·» va a capo con la parte che segue; un solo use case sta su una riga sua.
  const accessItem = between(requirements, `data-need-item="${needIds.access}"`, "</summary>");
  assert.match(accessItem, /<span data-meta="entro" class="inline-flex min-w-0 items-center gap-x-2"><span aria-hidden="true">·<\/span>/);
  const procedureItem = between(requirements, `data-need-item="${needIds.procedure}"`, "</li>");
  assert.match(procedureItem, /<span data-meta="per" class="flex min-w-0 basis-full"><a /);
  // I link restano nella vista: `?vista=cosa-serve&apri=<id>`.
  assert.ok(page.includes(`href="/dashboard/${ids.ws}/use-cases?vista=cosa-serve&apri=${cards.proposed.id}"`));
});

test("Cosa serve: «Prossimi passi» per mese, i fatti chiusi; «Cosa vi chiediamo questo trimestre», chiuso, per use case approvato", opts, async () => {
  const page = await hubHtml("ls", ids.ws, { vista: "cosa-serve" });
  const steps = between(page, 'data-slot="needs-steps"', 'data-slot="needs-quarter"');
  assert.ok(steps.includes(`>${needs.monthHeading(dueSoon.slice(0, 7))}<`), "il mese della scadenza");
  assert.ok(steps.includes(T.kickoff) && steps.includes(">Confermato<"));
  const done = detailsAround(steps, T.demo);
  assert.ok(done.includes("Fatto · 1"));

  const quarter = between(page, 'data-slot="needs-quarter"');
  const opening = page.slice(page.lastIndexOf("<details", page.indexOf('data-slot="needs-quarter"')));
  assert.ok(opening.startsWith('<details data-slot="needs-quarter"'));
  assertClosed(opening);
  const summary = quarter.slice(0, quarter.indexOf("</summary>"));
  assert.ok(summary.includes("Cosa vi chiediamo questo trimestre · 1 use case"));
  const ask = between(quarter, `data-quarter-ask="${cards.quarter.id}"`, "</li><li data-quarter-ask");
  assert.equal(quarter.split("data-quarter-ask=").length - 1, 1, "solo lo use case approvato in questo trimestre");
  assert.ok(ask.includes(`Chi conferma i numeri: <span class="text-foreground">${FIX_A.confirmBy}</span>`));
  assert.ok(ask.includes("6.600 all'anno × 1,5 min × 70% ≈ 116 h · 4.043 €"), "il ritorno da confermare");
  assert.ok(ask.includes("Meno errori di smistamento") && ask.includes("· da misurare"), "anche le voci da misurare");
  assert.ok(!ask.includes("Risposte anche fuori orario"), "le voci con una fonte non si chiedono");
  const section = (title: string, next?: string) => between(ask, `>${title}<`, next ? `>${next}<` : undefined);
  assert.ok(section("Ci serve subito", "Dopo la scheda A.8").includes(T.access));
  assert.ok(section("Ci serve subito", "Dopo la scheda A.8").includes(T.other), "senza «quando»: subito");
  assert.ok(section("Dopo la scheda A.8", "Da decidere").includes(T.procedure));
  assert.ok(section("Da decidere").includes(T.decide));
  assert.ok(!ask.includes(T.extract), "le righe a posto non si chiedono");
});

test("Cosa serve: la sua vista, non nella Panoramica né nei vecchi link; senza esigenze il vuoto", opts, async () => {
  const notThere: Array<Record<string, string>> = [{}, { vista: "panoramica" }, { vista: "priorita" }, { vista: "roadmap", tipo: "diffondere" }];
  for (const searchParams of notThere) {
    const page = await hubHtml("builder", ids.ws, searchParams);
    assert.ok(!page.includes('data-slot="needs-board"'), JSON.stringify(searchParams));
    assert.ok(!page.includes(T.access), JSON.stringify(searchParams));
  }
  assert.ok((await hubHtml("builder", ids.ws, { vista: "cosa-serve" })).includes('data-slot="needs-board"'));
  const empty = await hubHtml("manager", ids.wsEmpty, { vista: "cosa-serve" });
  const blank = between(empty, 'data-slot="needs-board"');
  assert.ok(blank.includes('data-slot="hub-empty"') && blank.includes("Niente da chiedere per ora"));
  assert.ok(blank.includes("Le esigenze si aggiungono dalla scheda di uno use case, nel capitolo «Cosa serve»."));
  assert.ok(!empty.includes('data-slot="needs-requirements"') && !empty.includes('data-slot="needs-quarter"'), "nessun blocco vuoto");
  const overview = await hubHtml("builder", ids.ws, { vista: "panoramica" });
  assert.ok(!overview.includes('data-slot="needs-board"'), "solo nella sua vista");
});

test("Panoramica: il prossimo passo conta i requisiti degli use case di questo trimestre", opts, async () => {
  const quarter = await import("./quarter.ts");
  const thisQuarter = quarter.currentQuarter();
  // Ogni gruppo che conta, con il suo nome: da chiedere, da verificare e bloccati.
  const sentence = `Per partire con il ${quarter.quarterLabel(thisQuarter)}: 1 requisito da chiedere, 1 da verificare e 1 bloccato.`;
  const href = `/dashboard/${ids.wsStart}/use-cases?vista=cosa-serve&trimestre=${thisQuarter}`;
  for (const person of REVIEWERS) {
    const page = await hubHtml(person, ids.wsStart, { vista: "panoramica" });
    const box = between(page, 'data-slot="next-step"', "</section>");
    assert.ok(box.includes(">Prossimo passo</h2>"), person);
    // Il requisito in comune una volta, il bloccato anche se è di Lateral Space; non quelli dello use
    // case già partito né del trimestre dopo; i requisiti prima della proposta da decidere.
    assert.ok(box.includes(`<p class="text-sm">${sentence}</p>`), `${person}: ${box}`);
    assert.match(box, new RegExp(`<a [^>]*href="${href.replace(/[?]/g, "\\?")}"[^>]*>Vedi cosa serve</a>`), person);
    // Il solo pulsante pieno è il suo; «Nuovo use case» è bordato.
    const filled = filledButtons(page);
    assert.equal(filled.length, 1, person);
    assert.ok(filled[0].includes(`href="${href}"`), filled[0]);
    const header = between(page, 'data-slot="hub-header"', "</header>");
    const newUseCase = [...header.matchAll(/<a\b[^>]*>/g)].map(([tag]) => tag).find((tag) => /href="[^"]*(?:nuovo=1|\/use-cases\/nuovo)"/.test(tag));
    assert.ok(newUseCase && !/class="[^"]*\bbg-primary\b/.test(newUseCase), `${person}: «Nuovo use case» bordato`);
    // La Panoramica conta le esigenze ma non le mostra.
    assert.ok(!page.includes('data-slot="needs-board"'), person);
    for (const title of Object.values(START)) assert.ok(!page.includes(title), `${person}: ${title}`);
  }
  // Lo sponsor del cliente (gestore) vede le cifre: i due use case di questo trimestre.
  const manager = await hubHtml("manager", ids.wsStart, { vista: "panoramica" });
  assert.ok(manager.includes('data-slot="overview-figures"'));
  assert.match(manager, /data-figure="totale-trimestre"[^>]*><p[^>]*><span class="whitespace-nowrap">2<\/span><\/p><p class="text-sm">use case in questo trimestre</);
  // Il link porta a «Cosa serve» del trimestre: proprio i requisiti contati, non gli altri, con gli
  // stessi numeri del riquadro nella riga sotto «Requisiti», che comincia dal trimestre: ogni numero
  // della frase si ritrova con la sua parola.
  const target = await hubHtml("builder", ids.wsStart, { vista: "cosa-serve", trimestre: thisQuarter });
  assert.ok(target.includes(START.shared) && target.includes(START.blocked) && target.includes(START.verify));
  assert.ok(!target.includes(START.progress) && !target.includes(START.next));
  assert.equal(summaryOf(target), `${quarter.quarterLabel(thisQuarter)} · 3 aperti · 1 da chiedere · 1 da verificare · 1 bloccato`);
  for (const piece of ["1 da chiedere", "1 da verificare", "1 bloccato"]) assert.ok(summaryOf(target).includes(piece), piece);
  // Il filtro del trimestre non apre le aree: si arriva sui conteggi, non su tutte le tabelle.
  const areas = areasOf(target);
  assert.ok(areas.length > 0);
  for (const area of areas) assert.equal(area.opening, '<details data-slot="needs-area">', area.key);
  // Il requisito dei due use case di LIBRA: il tag dell'agente una volta sola, prima di «Per 2 use case».
  const shared = between(target, START.shared, "</tr>");
  const tags = [...between(shared, 'data-slot="need-agents"', "Per 2 use case").matchAll(/data-slot="agent-tag"[^>]*><span class="truncate">([^<]*)</g)].map((match) => match[1]);
  assert.deepEqual(tags, ["LIBRA"]);
  assert.ok(shared.indexOf('data-slot="need-agents"') < shared.indexOf("Per 2 use case"));
  // Il requisito di un solo use case: nessun tag, il link dice già «LIBRA L2».
  const blocked = between(target, START.blocked, "</tr>");
  assert.ok(!blocked.includes('data-slot="need-agents"'), blocked);
  assert.ok(blocked.includes(`LIBRA L2 · Pagamenti ${suffix}`));
  // Con un filtro il riquadro non c'è: dice tutto il workspace.
  const filtered = await hubHtml("builder", ids.wsStart, { vista: "panoramica", agente: "LIBRA" });
  assert.ok(!filtered.includes('data-slot="next-step"') && filtered.includes('data-slot="phase-strip"'));
  // Il contributore: le fasi, nessun riquadro, nessuna esigenza.
  const contributor = await hubHtml("contributor", ids.wsStart, { vista: "panoramica" });
  assert.ok(contributor.includes('data-slot="phase-strip"'));
  for (const text of ['data-slot="next-step"', 'data-slot="overview-figures"', "Per partire con", "requisit", ...Object.values(START)]) {
    assert.ok(!contributor.includes(text), `contributore: «${text}»`);
  }
  const { data } = await hubTree("contributor", ids.wsStart, { vista: "panoramica" });
  assert.equal(data.needs, null);
  // I revisori le leggono sulle corsie senza filtri, per «Prossimo passo»; non con un filtro, che lo
  // toglie, né con un grafico del menu «⋯». Il pannello e «Cosa serve» le leggono anche con un filtro.
  assert.ok((await hubTree("builder", ids.wsStart, { vista: "panoramica" })).data.needs?.length);
  assert.equal((await hubTree("builder", ids.wsStart, { vista: "panoramica", mostra: "matrice" })).data.needs, null);
  const filters: Array<Record<string, string>> = [{ agente: "LIBRA" }, { q: "Fatture" }, { trimestre: thisQuarter }, { origine: "adoption" }];
  for (const filter of filters) {
    assert.equal((await hubTree("builder", ids.wsStart, { vista: "panoramica", ...filter })).data.needs, null, JSON.stringify(filter));
  }
  assert.ok((await hubTree("builder", ids.wsStart, { vista: "panoramica", agente: "LIBRA", apri: startCards.a.id })).data.needs?.length, "il pannello");
  assert.ok((await hubTree("builder", ids.wsStart, { vista: "cosa-serve", agente: "LIBRA" })).data.needs?.length, "«Cosa serve»");
});

test("Cosa serve: gli use case in realizzazione si leggono nella Panoramica, mai le card dei dossier qui", opts, () => {
  const emptyBoard = { areas: [], steps: [], stepsDone: [], quarter: [], counts: needs.emptyNeedAskCounts() };
  const render = (props: Record<string, unknown>) =>
    readable(renderToStaticMarkup(createElementOf(board.NeedsBoardView, { hrefOf: (id: string) => `?apri=${id}`, today: "2026-10-29", ...props })));
  const realizationHref = "/p#panoramica-in-realizzazione";
  const blank = render({ board: emptyBoard, inRealization: 1, realizationHref });
  assert.ok(blank.includes('data-slot="hub-empty"') && blank.includes("Niente da chiedere per ora"));
  assert.ok(blank.includes("1 use case è già in realizzazione."));
  assert.match(blank, /<a [^>]*href="\/p#panoramica-in-realizzazione"[^>]*>Vai alla Panoramica<\/a>/);
  assert.ok(!blank.includes('data-slot="dossier-card"'));

  const row = {
    id: randomUUID(),
    type: "requisito",
    kind: "accesso",
    title: `Una riga ${suffix}`,
    detail: null,
    owner: null,
    status: { label: "Da chiedere", tone: "grigio" },
    done: false,
    due: null,
    availability: null,
    useCases: [],
    forLabel: null,
  };
  const oneToAsk = { ...needs.emptyNeedAskCounts(), open: 1, toAsk: 1 };
  const filled = { ...emptyBoard, areas: [{ key: "accessi", label: "Accessi", open: [row], done: [], counts: oneToAsk }], counts: oneToAsk };
  const two = render({ board: filled, inRealization: 2, realizationHref });
  const line = between(two, 'data-slot="needs-in-progress"');
  assert.ok(two.indexOf('data-slot="needs-in-progress"') > two.indexOf('data-slot="needs-requirements"'), "dopo i blocchi");
  assert.ok(line.includes("2 use case sono già in realizzazione.") && /href="\/p#panoramica-in-realizzazione"[^>]*>Vai alla Panoramica</.test(line));
  assert.ok(!two.includes('data-slot="dossier-card"'));
  assert.equal(summaryOf(two), "1 aperto · 1 da chiedere");
  for (const props of [{ inRealization: 0, realizationHref }, { inRealization: 2, realizationHref: null }]) {
    const html = render({ board: filled, ...props });
    assert.ok(!html.includes('data-slot="needs-in-progress"') && !html.includes("Vai alla Panoramica"), JSON.stringify(props));
  }
});

test("Cosa serve: «Prossimi passi» aperti fino al mese di oggi, poi «Più avanti» e «Senza data» chiusi; gli agenti in «Per»", opts, async () => {
  const { agentPalette } = await import("./agents.ts");
  const step = (title: string, useCases: Array<{ id: string; code: string | null; title: string }> = []) => ({
    id: randomUUID(),
    type: "passo",
    kind: "altro",
    title: `${title} ${suffix}`,
    detail: null,
    owner: null,
    status: { label: "Confermato", tone: "blu" },
    done: false,
    due: null,
    availability: null,
    useCases,
    forLabel: null,
  });
  const ref = (code: string, title: string) => ({ id: randomUUID(), code, title });
  const agentsRefs = [ref("TJ-0001", "LIBRA L1 · Lettura delle fatture estere"), ref("TJ-0002", "ORSA O1 · Solleciti ai clienti"), ref("TJ-0003", "LIBRA L3 · Riconciliazione")];
  const plainRef = ref("TJ-0004", "Smistamento delle richieste");
  const month = (key: string, label: string, rows: unknown[]) => ({ key, label, rows });
  const steps = [
    month("2026-10", "Ottobre 2026", [step("Questo mese", agentsRefs), step("Un solo agente", [agentsRefs[1]])]),
    month("2026-11", "Novembre 2026", [step("Il mese prossimo", [plainRef])]),
    month("2027-01", "Gennaio 2027", [step("Fra tre mesi")]),
    month("senza_data", "Senza data", [step("Da fissare")]),
  ];
  const html = readable(
    renderToStaticMarkup(
      createElementOf(board.NeedsBoardView, {
        board: { areas: [], steps, stepsDone: [], quarter: [], counts: needs.emptyNeedAskCounts() },
        today: "2026-10-29",
        agents: agentPalette([...agentsRefs, plainRef]),
        hrefOf: (id: string) => `?apri=${id}`,
      }),
    ),
  );
  // Questo mese: aperto, fuori da ogni <details> (prima di lui ogni <details> è già chiuso).
  const before = html.slice(0, html.indexOf(`Questo mese ${suffix}`));
  assert.equal(before.split("<details").length, before.split("</details>").length, "Questo mese: fuori da ogni <details>");
  assert.ok(html.includes(">Ottobre 2026<"));
  // Dal mese prossimo, sotto «Più avanti», chiuso: novembre e gennaio.
  const later = detailsAround(html, `Fra tre mesi ${suffix}`);
  assert.match(later, /^<details data-slot="needs-steps-later">/);
  assert.ok(later.includes("Più avanti · 2 passi") && later.includes(">Novembre 2026<") && later.includes(">Gennaio 2027<"));
  assert.ok(later.includes(`Il mese prossimo ${suffix}`), "il mese prossimo sta in «Più avanti»");
  const undated = detailsAround(html, `Da fissare ${suffix}`);
  assert.match(undated, /^<details data-slot="needs-steps-undated">/);
  assert.ok(undated.includes("Senza data · 1 passo"));
  // Gli agenti dei titoli, una volta ciascuno, prima di «Per 3 use case»; nessuno senza prefisso.
  const withAgents = between(html, `Questo mese ${suffix}`, "</li>");
  const agentTags = between(withAgents, 'data-slot="need-agents"', 'data-slot="need-use-cases"');
  const names = [...agentTags.matchAll(/data-slot="agent-tag" data-tone="(\d+)"[^>]*><span class="truncate">([^<]*)</g)].map((match) => match[2]);
  assert.deepEqual(names, ["LIBRA", "ORSA"]);
  assert.ok(withAgents.indexOf('data-meta="agenti"') < withAgents.indexOf("Per 3 use case"), "prima gli agenti");
  assert.ok(!between(html, `Il mese prossimo ${suffix}`, "</li>").includes('data-slot="need-agents"'), "senza prefisso, nessun tag");
  // Con un solo use case il link dice già l'agente: nessun tag, l'agente una volta sola, anche per i lettori di schermo.
  const single = between(html, `Un solo agente ${suffix}`, "</li>");
  assert.ok(!single.includes('data-slot="need-agents"') && !single.includes('data-slot="agent-tag"'), single);
  assert.equal(readable(single.replace(/<[^>]+>/g, "")).split("ORSA").length - 1, 1, "«ORSA» una volta");
  assert.ok(single.includes("TJ-0002") && single.includes("ORSA O1 · Solleciti ai clienti"));
});

test("Cosa serve con i filtri: le esigenze degli use case che passano, la ricerca nel titolo, il vuoto dei filtri", opts, async () => {
  const byCode = await hubHtml("builder", ids.ws, { vista: "cosa-serve", q: cards.proposed.code });
  assert.ok(byCode.includes(T.access), "collegata allo use case cercato");
  for (const title of [T.extract, T.procedure, T.kickoff]) assert.ok(!byCode.includes(title), title);
  // Con una ricerca i conteggi seguono il filtro e le aree sono aperte: si legge subito quello che si cerca.
  assert.equal(summaryOf(byCode), "1 aperto · 1 in attesa");
  assert.deepEqual(
    areasOf(byCode).map((area) => [area.key, area.opening, area.summary]),
    [["accessi", '<details data-slot="needs-area" open="">', "Accessi · 1 in attesa"]],
  );
  // «Per» nomina comunque tutti gli use case dell'esigenza.
  assert.ok(detailsAround(byCode, "Per 2 use case").includes(`>${cards.quarter.code}<`));

  // (La ricerca resta anche nel campo «Cerca»: il passo si cerca nei blocchi.)
  const byTitle = await hubHtml("builder", ids.ws, { vista: "cosa-serve", q: T.kickoff });
  assert.ok(between(byTitle, 'data-slot="needs-steps"').includes(T.kickoff), "un passo senza use case, per il titolo");
  assert.ok(!byTitle.includes(T.access));
  // La ✕ «Togli i filtri» della barra, al telefono nella riga: torna a «Cosa serve» senza filtri.
  assert.match(byTitle, new RegExp(`aria-label="Togli i filtri"[^>]*href="/dashboard/${ids.ws}/use-cases\\?vista=cosa-serve"`));

  // Nessuno use case ha questa origine: niente da chiedere, con «Togli i filtri».
  const none = await hubHtml("builder", ids.ws, { vista: "cosa-serve", origine: "transformation" });
  const blank = between(none, 'data-slot="needs-board"');
  assert.ok(blank.includes("Niente da chiedere con questi filtri."));
  assert.match(blank, new RegExp(`<a [^>]*href="/dashboard/${ids.ws}/use-cases\\?vista=cosa-serve"[^>]*>Togli i filtri</a>`));
  for (const title of Object.values(T)) assert.ok(!none.includes(title), title);
});

test("Cosa serve: i grafici del menu «⋯» (prima in «Priorità») non leggono né esigenze né dossier", opts, async () => {
  const { data } = await hubTree("builder", ids.ws, { vista: "priorita", mostra: "matrice" });
  assert.equal(data.chart, "matrice");
  assert.equal(data.needs, null);
  assert.equal(data.dossierColumn, null);
});

// ─── Pannello e scheda ───────────────────────────────────────────────

test("pannello: al massimo tre esigenze aperte, le altre nella scheda; senza esigenze niente blocco", opts, async () => {
  let data: { needs: import("./needs.ts").PanelNeeds | null } | undefined;
  for (const vista of ["priorita", "cosa-serve"]) {
    const { tree } = await hubTree("builder", ids.ws, { vista, apri: cards.quarter.id });
    data = findProp(tree, "data").find((value) => (value as { projection?: string })?.projection === "revisore") as typeof data;
    assert.ok(data?.needs, vista);
    assert.equal(data.needs.rows.length, 3, vista);
    assert.equal(data.needs.more, 1, "quattro aperte: tre e «Un'altra»");
    assert.equal(data.needs.rows[0].title, T.access, "prima la scadenza più vicina");
    assert.ok(data.needs.rows.every((row) => !row.done));
  }
  assert.ok(data?.needs);
  const html = readable(renderToStaticMarkup(createElementOf(panel.PanelNeedsBlock, { needs: data.needs, href: `/dashboard/${ids.ws}/use-cases/${cards.quarter.id}?capitolo=cosa-serve` })));
  assert.ok(html.includes('data-slot="panel-needs"') && html.includes(">Cosa serve<"));
  assert.equal(html.split("data-need=").length - 1, 3);
  assert.ok(html.includes("Un'altra nella scheda") && html.includes("capitolo=cosa-serve"));

  const none = await hubTree("builder", ids.ws, { vista: "roadmap", apri: cards.progress.id });
  const noneData = findProp(none.tree, "data").find((value) => (value as { projection?: string })?.projection === "revisore") as { needs: unknown };
  assert.equal(noneData.needs, null);
});

test("scheda: il capitolo «Cosa serve» con le esigenze collegate, le righe a posto chiuse e la modifica", opts, async () => {
  const page = await detailHtml("builder", cards.quarter.id);
  assert.ok(page.includes('href="#cosa-serve"'), "l'ancora");
  const section = between(page, 'data-slot="section-needs"', "</section>");
  assert.ok(section.includes(">Requisiti<"));
  for (const key of ["access", "decide", "procedure", "other", "extract"] as const) assert.ok(section.includes(T[key]), key);
  assert.ok(!section.includes(T.kickoff), "i passi non collegati non ci sono");
  assert.ok(!section.includes(T.archived));
  assert.ok(detailsAround(section, T.extract).includes("Già a posto · 1"));
  // Gli altri use case dell'esigenza, chiusi: il link porta al loro capitolo «Cosa serve».
  const also = detailsAround(section, "Serve anche a un altro use case");
  assertClosed(also);
  assert.ok(also.includes(`href="/dashboard/${ids.ws}/use-cases/${cards.proposed.id}?capitolo=cosa-serve"`));
  assert.ok(also.includes(cards.proposed.code) && also.includes(`Preventivi ${suffix}`));
  assert.ok(also.includes(`: ${T.access}`), "il titolo dell'esigenza per i lettori di schermo");
  assert.ok(!section.includes("Anche per"));
  assert.ok(section.includes(`aria-label="Modifica: ${T.access}"`));
  assert.ok(section.includes(">Aggiungi<") && section.includes(">Collega un'esigenza<"));
  const other = await detailHtml("builder", cards.progress.id);
  assert.ok(between(other, 'data-slot="section-needs"', "</section>").includes("Niente per ora."));
});

test("chi non è revisore: niente esigenze in «Cosa serve», Panoramica, pannello, scheda e dati della pagina", opts, async () => {
  const views: Array<Record<string, string>> = [
    { vista: "cosa-serve" },
    { vista: "cosa-serve", apri: cards.quarter.id },
    { vista: "priorita" },
    { vista: "panoramica" },
    { vista: "da-decidere", apri: cards.own.id },
    { apri: cards.quarter.id },
  ];
  for (const searchParams of views) {
    const page = await hubHtml("contributor", ids.ws, searchParams);
    assert.ok(!page.includes('data-slot="needs-board"'), JSON.stringify(searchParams));
    assert.ok(!page.includes('data-slot="needs-summary"') && !page.includes('data-slot="need-agents"'), JSON.stringify(searchParams));
    for (const title of Object.values(T)) assert.ok(!page.includes(title), `${JSON.stringify(searchParams)}: ${title}`);
    const { data, tree } = await hubTree("contributor", ids.ws, searchParams);
    assert.equal(data.needs, null);
    for (const title of Object.values(T)) assert.ok(!JSON.stringify(findProp(tree, "data")).includes(title), title);
  }
  const own = await detailHtml("contributor", cards.own.id);
  assert.ok(!own.includes('data-slot="section-needs"') && !own.includes("Cosa serve"));
});

// ─── Action della pagina ─────────────────────────────────────────────

test("action: scrive solo un revisore, rilegge la pagina; versione vecchia e motivo mancante", opts, async () => {
  signIn("contributor");
  const refused = await actions.createNeedAction(ids.ws, cards.own.id, { type: "requisito", title: "Non si scrive" });
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.error, "permesso_mancante");
  assert.deepEqual(revalidated(), []);

  signIn("builder");
  const created = await actions.createNeedAction(ids.ws, cards.progress.id, { type: "passo", title: `Dalla scheda ${suffix}` });
  assert.ok(created.ok, JSON.stringify(created));
  assert.equal(created.message, "Aggiunta.");
  assert.deepEqual(revalidated(), [`/dashboard/${ids.ws}/use-cases`, `/dashboard/${ids.ws}/use-cases/${cards.progress.id}`]);
  const [link] = await q(`SELECT use_case_id::text AS id FROM use_case_need_links WHERE need_id = $1::uuid`, [created.id]);
  assert.equal(link.id, cards.progress.id, "nasce collegata allo use case della scheda");

  const updated = await actions.updateNeedAction(ids.ws, cards.progress.id, created.id, created.version, { status: "fatta" });
  assert.ok(updated.ok);
  const stale = await actions.updateNeedAction(ids.ws, cards.progress.id, created.id, created.version, { title: "Vecchia" });
  assert.equal(!stale.ok && stale.error, "versione_superata");
  assert.equal(stale.message, "Qualcuno ha appena modificato questa esigenza. Ho ricaricato i dati: rifai la modifica.");
  const noReason = await actions.archiveNeedAction(ids.ws, cards.progress.id, created.id, updated.ok ? updated.version : 0, " ");
  assert.equal(!noReason.ok && noReason.fieldErrors?.archiveReason, "Scrivi perché la archivi.");
  const archived = await actions.archiveNeedAction(ids.ws, cards.progress.id, created.id, updated.ok ? updated.version : 0, "Fatta in un altro modo");
  assert.ok(archived.ok);
  assert.equal(archived.message, "Archiviata.");
  const [row] = await q(`SELECT archived_at, archive_reason, done_at FROM use_case_needs WHERE id = $1::uuid`, [created.id]);
  assert.ok(row.archived_at && row.done_at);
  assert.equal(row.archive_reason, "Fatta in un altro modo");

  signIn("contributor");
  const unlink = await actions.unlinkNeedAction(ids.ws, cards.quarter.id, needIds.access, cards.proposed.id);
  assert.equal(!unlink.ok && unlink.error, "permesso_mancante");
  signIn("ls");
  const relink = await actions.linkNeedAction(ids.ws, cards.progress.id, needIds.kickoff, cards.progress.id);
  assert.ok(relink.ok);
  assert.ok(revalidated().includes(`/dashboard/${ids.ws}/use-cases/${cards.progress.id}`));
  const back = await actions.unlinkNeedAction(ids.ws, cards.progress.id, needIds.kickoff, cards.progress.id);
  assert.ok(back.ok);
});

// ─── Storia (drizzle/0023) ───────────────────────────────────────────

/** Le righe della Storia della scheda, senza la data: «Persona ls · Cosa serve: … · pagina». */
function historyRows(page: string): string[] {
  const section = between(page, 'data-slot="section-history"', "</section>");
  return [...section.matchAll(/<li data-action="([a-z_]+)"[^>]*>([^<]*)<\/li>/g)].map((match) => match[2].split(" · ").slice(1).join(" · "));
}

test("Storia: i cambi di «Cosa serve» nelle righe della scheda per i revisori, senza testi; mai per chi non è revisore", opts, async () => {
  // La scheda dove l'action della prova sopra ha aggiunto, cambiato, archiviato, collegato e scollegato.
  for (const person of REVIEWERS) {
    const rows = historyRows(await detailHtml(person, cards.progress.id));
    assert.deepEqual(
      rows.filter((text) => text.includes("Cosa serve")),
      [
        "Persona ls · Cosa serve: scollegato un prossimo passo · pagina",
        "Persona ls · Cosa serve: collegato un prossimo passo · pagina",
        "Persona builder · Cosa serve: archiviato un prossimo passo · pagina",
        "Persona builder · Cosa serve: stato di un prossimo passo, «Proposto» → «Fatto» · pagina",
        "Persona builder · Cosa serve: aggiunto un prossimo passo · pagina",
      ],
      person,
    );
    assert.equal(rows.at(-1), "Creato · dal modulo web", "la creazione resta la prima riga");
  }
  const quarter = historyRows(await detailHtml("manager", cards.quarter.id));
  assert.equal(quarter.filter((text) => text === "Persona ls · Cosa serve: aggiunto un requisito · pagina").length, 6, "una per esigenza collegata");
  assert.ok(quarter.includes("Persona ls · Cosa serve: archiviato un requisito · pagina"));
  const page = await detailHtml("builder", cards.quarter.id);
  const history = between(page, 'data-slot="section-history"', "</section>");
  for (const text of [T.access, T.archived, "Non serve più", "Ufficio IT"]) assert.ok(!history.includes(text), `nessun testo dell'esigenza: ${text}`);

  // La proposta del contributore riceve una riga «Cosa serve»: lui non vede né la Storia né la riga.
  ok(await svc.linkNeed(as("ls"), needIds.decide, cards.own.id));
  assert.ok(historyRows(await detailHtml("builder", cards.own.id)).includes("Persona ls · Cosa serve: collegato un requisito · pagina"));
  const own = await detailHtml("contributor", cards.own.id);
  assert.ok(!own.includes('data-slot="section-history"'), "il contributore non ha la Storia");
  assert.ok(!own.includes("Cosa serve") && !own.includes("collegato un requisito") && !own.includes(T.decide));
  const [stored] = await q(`SELECT count(*)::int AS n FROM use_case_events WHERE use_case_id = $1::uuid AND 'cosa_serve' = ANY(fields)`, [cards.own.id]);
  assert.equal(stored.n, 1, "la riga c'è, e resta ai revisori");
});
