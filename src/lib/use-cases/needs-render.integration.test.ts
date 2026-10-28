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
// - «Cosa serve»: la sua vista, solo per i revisori, ultima nel selettore: i requisiti per area (le
//   righe a posto chiuse, «Per N use case» chiuso), i prossimi passi per mese (i fatti chiusi), «Cosa
//   vi chiediamo questo trimestre» chiuso, una riga per gli use case in realizzazione con la Roadmap.
//   Con un filtro, le esigenze degli use case che lo passano. «Priorità» non le ha più.
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

const codeBase = 40_000 + Math.floor(Math.random() * 50_000);
let codeSeq = 0;
const cards = {} as Record<"quarter" | "proposed" | "progress" | "empty" | "own", { id: string; code: string }>;
const needIds = {} as Record<keyof typeof T, string>;
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

  process.env.USE_CASE_HUB_WORKSPACES = [ids.ws, ids.wsEmpty, ids.wsOther].join(",");
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
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    for (const workspaceId of [ids.ws, ids.wsEmpty, ids.wsOther]) {
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
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.wsEmpty, ids.wsOther]]);
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
  for (const header of ["Che cosa", "Chi", "Per", "Stato", "Entro"]) assert.ok(requirements.includes(`>${header}</th>`), header);

  const accessRow = between(requirements, `data-need="${needIds.access}"`, "</tr>");
  assert.ok(accessRow.includes(T.access));
  assert.ok(accessRow.includes("Ufficio IT · Cliente"), "Chi: persona e parte");
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

test("Cosa serve: la sua vista, non in Priorità né nella Roadmap; senza esigenze il vuoto", opts, async () => {
  const notThere: Array<Record<string, string>> = [{}, { vista: "priorita" }, { vista: "priorita", tipo: "diffondere" }];
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
  const roadmap = await hubHtml("builder", ids.ws, { vista: "roadmap" });
  assert.ok(!roadmap.includes('data-slot="needs-board"'), "solo nella sua vista");
});

test("Cosa serve: gli use case in realizzazione si leggono nella Roadmap, mai le card dei dossier qui", opts, () => {
  const emptyBoard = { areas: [], steps: [], stepsDone: [], quarter: [] };
  const render = (props: Record<string, unknown>) => readable(renderToStaticMarkup(createElementOf(board.NeedsBoardView, { hrefOf: (id: string) => `?apri=${id}`, ...props })));
  const blank = render({ board: emptyBoard, inRealization: 1, roadmapHref: "/r" });
  assert.ok(blank.includes('data-slot="hub-empty"') && blank.includes("Niente da chiedere per ora"));
  assert.ok(blank.includes("1 use case è già in realizzazione."));
  assert.match(blank, /<a [^>]*href="\/r"[^>]*>Vai alla Roadmap<\/a>/);
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
  const filled = { ...emptyBoard, areas: [{ key: "accessi", label: "Accessi", open: [row], done: [] }] };
  const two = render({ board: filled, inRealization: 2, roadmapHref: "/r" });
  const line = between(two, 'data-slot="needs-in-progress"');
  assert.ok(two.indexOf('data-slot="needs-in-progress"') > two.indexOf('data-slot="needs-requirements"'), "dopo i blocchi");
  assert.ok(line.includes("2 use case sono già in realizzazione.") && /href="\/r"[^>]*>Vai alla Roadmap</.test(line));
  assert.ok(!two.includes('data-slot="dossier-card"'));
  for (const props of [{ inRealization: 0, roadmapHref: "/r" }, { inRealization: 2, roadmapHref: null }]) {
    const html = render({ board: filled, ...props });
    assert.ok(!html.includes('data-slot="needs-in-progress"') && !html.includes("Vai alla Roadmap"), JSON.stringify(props));
  }
});

test("Cosa serve con i filtri: le esigenze degli use case che passano, la ricerca nel titolo, il vuoto dei filtri", opts, async () => {
  const byCode = await hubHtml("builder", ids.ws, { vista: "cosa-serve", q: cards.proposed.code });
  assert.ok(byCode.includes(T.access), "collegata allo use case cercato");
  for (const title of [T.extract, T.procedure, T.kickoff]) assert.ok(!byCode.includes(title), title);
  // «Per» nomina comunque tutti gli use case dell'esigenza.
  assert.ok(detailsAround(byCode, "Per 2 use case").includes(`>${cards.quarter.code}<`));

  // (La ricerca resta anche nel campo «Cerca»: il passo si cerca nei blocchi.)
  const byTitle = await hubHtml("builder", ids.ws, { vista: "cosa-serve", q: T.kickoff });
  assert.ok(between(byTitle, 'data-slot="needs-steps"').includes(T.kickoff), "un passo senza use case, per il titolo");
  assert.ok(!byTitle.includes(T.access));

  // Nessuno use case ha questa origine: niente da chiedere, con «Togli i filtri».
  const none = await hubHtml("builder", ids.ws, { vista: "cosa-serve", origine: "transformation" });
  const blank = between(none, 'data-slot="needs-board"');
  assert.ok(blank.includes("Niente da chiedere con questi filtri."));
  assert.match(blank, new RegExp(`<a [^>]*href="/dashboard/${ids.ws}/use-cases\\?vista=cosa-serve"[^>]*>Togli i filtri</a>`));
  for (const title of Object.values(T)) assert.ok(!none.includes(title), title);
});

test("Cosa serve: Priorità non legge né esigenze né dossier", opts, async () => {
  const { data } = await hubTree("builder", ids.ws, { vista: "priorita" });
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

test("chi non è revisore: niente esigenze in «Cosa serve», Priorità, pannello, scheda e dati della pagina", opts, async () => {
  const views: Array<Record<string, string>> = [
    { vista: "cosa-serve" },
    { vista: "cosa-serve", apri: cards.quarter.id },
    { vista: "priorita" },
    { vista: "roadmap" },
    { vista: "da-decidere", apri: cards.own.id },
    { apri: cards.quarter.id },
  ];
  for (const searchParams of views) {
    const page = await hubHtml("contributor", ids.ws, searchParams);
    assert.ok(!page.includes('data-slot="needs-board"'), JSON.stringify(searchParams));
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
