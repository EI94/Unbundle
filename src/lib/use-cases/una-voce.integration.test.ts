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

// Integrazione «Una voce» (docs/use-case/PIANO-LAVORI.md H4i; docs/use-case/DESIGN.md §2.1,
// §2.3-§2.5, §12.1, §12.5 criteri 1 e 2, §14.4; D1, D4). Un workspace con l'area accesa
// (`USE_CASE_HUB_WORKSPACES`) e uno spento, sul database del pacchetto:
// - la barra: 14 voci con tutte le sezioni accese e «Use case» accesa sulle pagine che
//   sostituisce; spenta, le 17 voci di oggi, accese come oggi;
// - i vecchi indirizzi: `redirect()` 307 verso il nuovo, query comprese, prima di ogni
//   lettura; spenta, la pagina di oggi; il link di condivisione porta i membri alla scheda;
// - campanella e Intelligence: i link e le etichette dei segnali delle schede, solo ai
//   revisori; «Segna come letto» (Intelligence e campanella) e «Segna tutti letti» toccano solo
//   i segnali che il ruolo vede;
// - Impostazioni: «Valutazione» e il webhook WhatsApp solo con l'area accesa e solo a chi
//   gestisce il workspace; Overview: il passo e lo strumento «Use case».
// Le pagine si rendono in questo processo con la sessione scelta dalla prova (`@/lib/auth`
// diventa un modulo che la restituisce; ruolo e accesso si rileggono dal database). I file
// `.tsx` si traducono qui con TypeScript, solo per questa prova. Il harness HTTP (307 veri,
// `loading.tsx`, barra nell'HTML) è scripts/use-case-test/redirects.mjs.
// Dentro `npm run check` si salta: in testa solo moduli di Node; i moduli dell'app arrivano
// con `await import()` dentro `before()`. Dati sintetici, creati e cancellati qui.
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

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  on: randomUUID(),
  off: randomUUID(),
  lead: randomUUID(),
  builder: randomUUID(),
  manager: randomUUID(),
  contributor: randomUUID(),
  outsider: randomUUID(),
};
const emails = {
  lead: `lead.${suffix}@ls.test`,
  builder: `builder.${suffix}@cliente.test`,
  manager: `manager.${suffix}@cliente.test`,
  contributor: `contributor.${suffix}@cliente.test`,
  outsider: `outsider.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;
const roles: Record<Exclude<Person, "outsider">, string> = {
  lead: "transformation_lead",
  builder: "function_lead",
  manager: "exec_sponsor",
  contributor: "contributor",
};

const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "PORTFOLIO_SHARE_SECRET"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

type PageProps = { params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string>> };
type Page = (props: PageProps) => Promise<unknown>;
type Topbar = (props: { workspaceId: string; role: string | null; showNotifications?: boolean; useCaseHub?: boolean }) => Promise<unknown>;
type IntelligenceActions = typeof import("../actions/intelligence.ts");

let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let renderToStaticMarkup: (element: unknown) => string;
let createElement: typeof import("react").createElement;
let pathnameContext: import("react").Context<string | null>;
let pages: Record<"portfolio" | "review" | "submit" | "plan" | "settings" | "overview" | "intelligence" | "share" | "newUseCase", Page>;
let notFounds: { useCases: unknown; newUseCase: unknown };
let appSidebar: (props: Record<string, unknown>) => unknown;
let sidebarProvider: (props: Record<string, unknown>) => unknown;
let workspaceTopbar: Topbar;
let intelligence: IntelligenceActions;
let createShareToken: (workspaceId: string) => string;

/** Le schede del workspace acceso (e una di quello spento), create in `before()`. */
const cards = {} as Record<"topHidden" | "top" | "bottom" | "ownHidden" | "othersHidden" | "offCard", { id: string; title: string }>;
/** I segnali, per tipo, nel workspace acceso; più uno delle schede in quello spento. */
const signalIds = {} as Record<"case" | "digest" | "quarter" | "risk" | "opportunity" | "otherWorkspace", string>;

function signIn(person: Person | null): void {
  (globalThis as { __hubH4iSession?: unknown }).__hubH4iSession = person
    ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}`, image: null } }
    : null;
}

/** Area accesa solo per il workspace «on». */
function areaOn(): void {
  process.env.USE_CASE_HUB_WORKSPACES = ids.on;
}

/** La pagina resa in HTML con la sessione di `person`, oppure il `digest` di `notFound()` o `redirect()`. */
async function open(
  page: Page,
  person: Person | null,
  params: Record<string, string>,
  searchParams: Record<string, string> = {},
): Promise<{ element: unknown; digest: null } | { element: null; digest: string }> {
  signIn(person);
  try {
    return { element: await page({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) }), digest: null };
  } catch (error) {
    const digest = (error as { digest?: unknown })?.digest;
    if (typeof digest === "string") return { element: null, digest };
    throw error;
  }
}

async function html(page: Page, person: Person | null, params: Record<string, string>, searchParams: Record<string, string> = {}): Promise<string> {
  const result = await open(page, person, params, searchParams);
  assert.equal(result.digest, null, `atteso HTML, non ${result.digest}`);
  return renderToStaticMarkup(result.element);
}

/** Il redirect atteso: `redirect()` di Next, 307, mai `permanentRedirect()` (308). */
function temporaryRedirect(to: string): string {
  return `NEXT_REDIRECT;replace;${to};307;`;
}

/** Gli elementi React dell'albero (senza rendere i componenti), in profondità. */
function elementsOf(node: unknown): Array<{ type: unknown; props: Record<string, unknown> }> {
  const out: Array<{ type: unknown; props: Record<string, unknown> }> = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object" && "props" in value) {
      const element = value as { type: unknown; props: Record<string, unknown> };
      out.push(element);
      if (element.props) {
        visit(element.props.children);
        for (const [key, inner] of Object.entries(element.props)) if (key !== "children" && inner && typeof inner === "object") visit(inner);
      }
    }
  };
  visit(node);
  return out;
}

const typeName = (element: { type: unknown }) => (typeof element.type === "function" ? (element.type as { name?: string }).name : String(element.type));

/** Le voci della barra resa: titolo, link e stato acceso (`data-active` di `SidebarMenuButton`). */
function sidebarEntries(page: string): Array<{ title: string; href: string; active: boolean }> {
  return [...page.matchAll(/<a\b([^>]*data-sidebar="menu-button"[^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inner]) => ({
    title: inner.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").trim(),
    href: /\shref="([^"]*)"/.exec(attributes)?.[1] ?? "",
    active: /\sdata-active(?:="[^"]*")?(?=[\s>])/.test(attributes) && !/\sdata-active="false"/.test(attributes),
  }));
}

/**
 * La barra laterale resa per `pathname`, con tutte le sezioni accese. Con l'area accesa il layout
 * chiede la voce «Casi d'uso» solo finché `dossierLinksReady` non è vero (P0-16): `casesAvailable`.
 */
function renderSidebar(workspaceId: string, pathname: string, useCaseHub: boolean, casesAvailable = !useCaseHub) {
  const sidebar = createElement(appSidebar as never, {
    workspaceId,
    workspaceName: "Prova H4i",
    learningAvailable: true,
    casesAvailable,
    useCaseHub,
    user: { name: "Persona lead", email: emails.lead, image: null },
  });
  const tree = createElement(pathnameContext.Provider, { value: pathname }, createElement(sidebarProvider as never, null, sidebar));
  return sidebarEntries(renderToStaticMarkup(tree));
}

async function seedCard(s: {
  title: string;
  origin?: "adoption" | "transformation";
  hidden?: boolean;
  proposedBy?: string | null;
  workspaceId?: string;
  source?: string;
}): Promise<{ id: string; title: string }> {
  const id = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, status, portfolio_review_status, portfolio_kind, origin, intake, proposed_by, source, category, timeline)
     VALUES ($1::uuid, $2::uuid, $3, 'proposed', 'in_review', 'use_case_ai', $4, $5::jsonb, $6, $7, 'quick_win', 'Q1')`,
    [
      id,
      s.workspaceId ?? ids.on,
      s.title,
      s.origin ?? "adoption",
      s.hidden ? JSON.stringify({ hiddenFromSearch: true }) : null,
      s.proposedBy === undefined ? `collega.${suffix}@cliente.test` : s.proposedBy,
      s.source ?? "web_proposed",
    ],
  );
  return { id, title: s.title };
}

async function seedSignal(workspaceId: string, type: string, title: string, relatedId: string | null = null): Promise<string> {
  const [row] = await q(
    `INSERT INTO weekly_signals (workspace_id, signal_type, title, description, related_entity_type, related_entity_id)
     VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid) RETURNING id`,
    [workspaceId, type, title, `${title} descrizione`, relatedId ? "use_case" : null, relatedId],
  );
  return String(row.id);
}

async function unreadTypes(workspaceId: string): Promise<string[]> {
  const rows = await q(`SELECT signal_type FROM weekly_signals WHERE workspace_id = $1::uuid AND is_read = false ORDER BY signal_type`, [workspaceId]);
  return rows.map((row) => String(row.signal_type));
}

/** I tipi non letti da una persona (SPEC §P2.4: `is_read` per tutti, oppure la sua riga di lettura). */
async function unreadTypesFor(workspaceId: string, person: Person): Promise<string[]> {
  const rows = await q(
    `SELECT s.signal_type FROM weekly_signals s WHERE s.workspace_id = $1::uuid AND s.is_read = false
       AND NOT EXISTS (SELECT 1 FROM weekly_signal_reads r WHERE r.signal_id = s.id AND r.user_id = $2::uuid) ORDER BY s.signal_type`,
    [workspaceId, ids[person]],
  );
  return rows.map((row) => String(row.signal_type));
}

async function markAllUnread(): Promise<void> {
  await q(`UPDATE weekly_signals SET is_read = false WHERE workspace_id = ANY($1::uuid[])`, [[ids.on, ids.off]]);
  await q(`DELETE FROM weekly_signal_reads WHERE workspace_id = ANY($1::uuid[])`, [[ids.on, ids.off]]);
}

before(async () => {
  if (!enabled) return;
  const { default: ts } = await import("typescript");
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    // La sessione della prova al posto dei cookie di Firebase.
    "@/lib/auth": stub("export async function auth() { return globalThis.__hubH4iSession ?? null; }"),
    // La cache di Next non c'è fuori da una richiesta: si registrano i percorsi.
    "next/cache": stub(
      "export function revalidatePath(path) { (globalThis.__hubH4iRevalidated ??= []).push(path); }\n" +
        "export function revalidateTag() {}\nexport function refresh() {}\nexport function updateTag() {}\n" +
        "export function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}",
    ),
    // La barra esce con Firebase: qui non serve, e senza configurazione non si avvia.
    "@/lib/firebase/client": stub("export const firebaseAuth = {}; export const firebaseApp = {};"),
    "firebase/auth": stub("export async function signOut() {}"),
    // Le matrici e il Gantt di oggi (recharts) non si caricano sotto Node puro.
    "@/components/dashboard/use-case-matrix": stub("export function UseCaseMatrix() { return null; }"),
    "@/components/dashboard/gantt-chart": stub("export function GanttChart() { return null; }"),
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
  const react = await import("react");
  createElement = react.createElement;
  const { renderToStaticMarkup: toHtml } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as {
    AppRouterContext: import("react").Context<object | null>;
  };
  ({ PathnameContext: pathnameContext } = (await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js")) as unknown as {
    PathnameContext: import("react").Context<string | null>;
  });
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  renderToStaticMarkup = (element) => toHtml(createElement(AppRouterContext.Provider, { value: router }, element as never));

  const page = async (path: string): Promise<Page> => (await import(path)).default as Page;
  const app = "../../app/(dashboard)/dashboard/[workspaceId]";
  pages = {
    portfolio: await page(`${app}/portfolio/page.tsx`),
    review: await page(`${app}/portfolio/review/[useCaseId]/page.tsx`),
    submit: await page(`${app}/portfolio/submit/page.tsx`),
    plan: await page(`${app}/plan/page.tsx`),
    settings: await page(`${app}/settings/page.tsx`),
    overview: await page(`${app}/page.tsx`),
    intelligence: await page(`${app}/intelligence/page.tsx`),
    newUseCase: await page(`${app}/use-cases/nuovo/page.tsx`),
    share: await page("../../app/share/portfolio/[workspaceId]/[useCaseId]/page.tsx"),
  };
  notFounds = {
    useCases: (await import(`${app}/use-cases/not-found.tsx`)).default,
    newUseCase: (await import(`${app}/use-cases/nuovo/not-found.tsx`)).default,
  };
  appSidebar = (await import("../../components/dashboard/app-sidebar.tsx")).AppSidebar as never;
  sidebarProvider = (await import("../../components/ui/sidebar.tsx")).SidebarProvider as never;
  workspaceTopbar = (await import("../../components/portfolio/workspace-topbar.tsx")).WorkspaceTopbar as unknown as Topbar;
  intelligence = await import("../actions/intelligence.ts");
  const shareLink = await import("../portfolio/share-link.ts");
  createShareToken = (workspaceId) => shareLink.createPortfolioShareToken(workspaceId);

  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.PORTFOLIO_SHARE_SECRET = randomBytes(32).toString("base64");
  delete process.env.UC_ENABLED;
  areaOn();

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H4i', $2)`, [ids.org, `hub-h4i-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova H4i accesa'), ($2::uuid, $3::uuid, 'Prova H4i spenta')`, [
    ids.on,
    ids.off,
    ids.org,
  ]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    if (person === "outsider") continue;
    for (const workspaceId of [ids.on, ids.off]) {
      await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [workspaceId, ids[person], roles[person]]);
    }
  }

  cards.topHidden = await seedCard({ title: `Dall'alto nascosta ${suffix}`, origin: "transformation", hidden: true, proposedBy: null, source: "manual" });
  cards.top = await seedCard({ title: `Dall'alto ${suffix}`, origin: "transformation", proposedBy: null, source: "manual" });
  cards.bottom = await seedCard({ title: `Dal basso ${suffix}` });
  cards.ownHidden = await seedCard({ title: `Mia nascosta ${suffix}`, hidden: true, proposedBy: ids.contributor });
  cards.othersHidden = await seedCard({ title: `Altrui nascosta ${suffix}`, hidden: true, proposedBy: ids.builder });
  cards.offCard = await seedCard({ title: `Area spenta ${suffix}`, workspaceId: ids.off });

  signalIds.risk = await seedSignal(ids.on, "risk_alert", `RISCHIO-${suffix}`);
  signalIds.opportunity = await seedSignal(ids.on, "new_use_case_opportunity", `OPPORTUNITA-${suffix}`);
  signalIds.quarter = await seedSignal(ids.on, "use_case_quarter", `TRIMESTRE-${suffix}`);
  signalIds.digest = await seedSignal(ids.on, "use_case_digest", `RIEPILOGO-${suffix}`);
  signalIds.case = await seedSignal(ids.on, "new_portfolio_item", `SEGNALE-SCHEDA-${suffix}`, cards.bottom.id);
  signalIds.otherWorkspace = await seedSignal(ids.off, "new_portfolio_item", `ALTRO-WORKSPACE-${suffix}`, cards.offCard.id);
});

after(async () => {
  signIn(null);
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  // I workspace portano via schede, segnali, iscrizioni e modelli di valutazione.
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.on, ids.off]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.lead, ids.builder, ids.manager, ids.contributor, ids.outsider]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
});

// ─── Barra laterale (DESIGN §2.1, §12.5 criterio 1) ──────────────────

const TODAY_ENTRIES = [
  "Overview",
  "AI Readiness",
  "Formazione",
  "Raccolta & ranking",
  "Discovery",
  "Contesto",
  "Strategia",
  "Activity mapping",
  "Value map",
  "Use cases",
  "Casi d'uso",
  "Piano",
  "Report",
  "Blueprints",
  "Simulazione",
  "Intelligence",
  "Impostazioni",
];
const HUB_ENTRIES = [
  "Overview",
  "AI Readiness",
  "Formazione",
  "Use case",
  "Discovery",
  "Contesto",
  "Strategia",
  "Activity mapping",
  "Value map",
  "Report",
  "Blueprints",
  "Simulazione",
  "Intelligence",
  "Impostazioni",
];

test("barra, area accesa: 14 voci e «Use case» accesa su use-cases, portfolio, plan e casi-duso", opts, () => {
  const base = `/dashboard/${ids.on}`;
  const entries = renderSidebar(ids.on, `${base}/use-cases`, true);
  assert.deepEqual(entries.map((entry) => entry.title), HUB_ENTRIES);
  assert.equal(entries.find((entry) => entry.title === "Use case")?.href, `${base}/use-cases`);
  for (const rest of ["/use-cases", "/use-cases/nuovo", `/use-cases/${cards.top.id}`, `/portfolio/review/${cards.top.id}`, "/portfolio", "/plan", "/casi-duso", `/casi-duso/${randomUUID()}/domande`]) {
    const active = renderSidebar(ids.on, `${base}${rest}`, true).filter((entry) => entry.active).map((entry) => entry.title);
    assert.deepEqual(active, ["Use case"], rest);
  }
  // Le altre voci restano accese anche sulle loro pagine annidate; Overview solo sulla base.
  assert.deepEqual(renderSidebar(ids.on, `${base}/learning/programma`, true).filter((e) => e.active).map((e) => e.title), ["Formazione"]);
  assert.deepEqual(renderSidebar(ids.on, base, true).filter((e) => e.active).map((e) => e.title), ["Overview"]);
});

test("barra, area accesa prima di P0-16: «Casi d'uso» resta sotto «Use case» e tiene /casi-duso", opts, () => {
  const base = `/dashboard/${ids.on}`;
  const entries = renderSidebar(ids.on, `${base}/use-cases`, true, true);
  const expected = [...HUB_ENTRIES];
  expected.splice(expected.indexOf("Use case") + 1, 0, "Casi d'uso");
  assert.deepEqual(entries.map((entry) => entry.title), expected);
  assert.equal(entries.find((entry) => entry.title === "Casi d'uso")?.href, `${base}/casi-duso`);
  const activeAt = (rest: string) => renderSidebar(ids.on, `${base}${rest}`, true, true).filter((e) => e.active).map((e) => e.title);
  for (const rest of ["/use-cases", `/use-cases/${cards.top.id}`, "/portfolio", "/plan"]) assert.deepEqual(activeAt(rest), ["Use case"], rest);
  for (const rest of ["/casi-duso", `/casi-duso/${randomUUID()}/domande`]) assert.deepEqual(activeAt(rest), ["Casi d'uso"], rest);
});

test("barra, area spenta: le 17 voci di oggi, accese come oggi", opts, () => {
  const base = `/dashboard/${ids.off}`;
  const entries = renderSidebar(ids.off, `${base}/portfolio`, false);
  assert.deepEqual(entries.map((entry) => entry.title), TODAY_ENTRIES);
  assert.equal(entries.find((entry) => entry.title === "Raccolta & ranking")?.href, `${base}/portfolio`);
  const activeAt = (rest: string) => renderSidebar(ids.off, `${base}${rest}`, false).filter((e) => e.active).map((e) => e.title);
  assert.deepEqual(activeAt("/portfolio"), ["Raccolta & ranking"]);
  assert.deepEqual(activeAt("/plan"), ["Piano"]);
  assert.deepEqual(activeAt("/use-cases"), ["Use cases"]);
  // Oggi solo l'indirizzo esatto, tranne «Casi d'uso», che resta accesa dentro un dossier.
  assert.deepEqual(activeAt(`/portfolio/review/${cards.offCard.id}`), []);
  assert.deepEqual(activeAt(`/use-cases/${cards.offCard.id}`), []);
  assert.deepEqual(activeAt("/learning/programma"), []);
  assert.deepEqual(activeAt(`/casi-duso/${randomUUID()}/domande`), ["Casi d'uso"]);
});

// ─── Vecchi indirizzi (DESIGN §2.3, §2.4; PIANO-LAVORI §5.5) ─────────

test("area accesa: /portfolio, /portfolio/review/<id>, /portfolio/submit e /plan rispondono redirect() 307", opts, async () => {
  areaOn();
  const hub = `/dashboard/${ids.on}/use-cases`;
  const logged: string[] = [];
  const info = console.info;
  console.info = (line: unknown) => void logged.push(String(line));
  try {
    const portfolio = await open(pages.portfolio, "lead", { workspaceId: ids.on }, { joined: "1", thanks: "1", created: cards.bottom.id, waveBudget: "100" });
    assert.equal(portfolio.digest, temporaryRedirect(`${hub}?vista=da-decidere&joined=1&thanks=1&created=${cards.bottom.id}`));
    assert.equal((await open(pages.portfolio, "contributor", { workspaceId: ids.on })).digest, temporaryRedirect(`${hub}?vista=da-decidere`));
    assert.equal((await open(pages.review, "builder", { workspaceId: ids.on, useCaseId: cards.top.id })).digest, temporaryRedirect(`${hub}/${cards.top.id}`));
    assert.equal((await open(pages.submit, "contributor", { workspaceId: ids.on })).digest, temporaryRedirect(`${hub}/nuovo`));
    assert.equal((await open(pages.plan, "manager", { workspaceId: ids.on })).digest, temporaryRedirect(`${hub}?vista=roadmap`));
    // Prima di ogni lettura: anche chi non è membro riceve il redirect; la pagina nuova decide.
    assert.equal((await open(pages.plan, "outsider", { workspaceId: ids.on })).digest, temporaryRedirect(`${hub}?vista=roadmap`));
  } finally {
    console.info = info;
  }
  // Una riga di log per redirect, senza id né query (§2.4).
  const lines = logged.map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(
    lines.map((line) => line.from),
    ["/portfolio", "/portfolio", "/portfolio/review", "/portfolio/submit", "/plan", "/plan"],
  );
  for (const line of lines) assert.deepEqual(Object.keys(line).sort(), ["area", "from", "op"]);
  assert.ok(!logged.join(" ").includes(cards.top.id) && !logged.join(" ").includes(ids.on), "nessun id nel log");
});

test("area spenta: le stesse pagine rispondono come oggi", opts, async () => {
  areaOn();
  const portfolio = await html(pages.portfolio, "lead", { workspaceId: ids.off }, { joined: "1" });
  assert.ok(portfolio.includes("Raccolta &amp; Ranking"), "/portfolio di oggi");
  assert.ok(portfolio.includes("Benvenuto in Prova H4i spenta"), "il benvenuto di ?joined=");
  const review = await html(pages.review, "builder", { workspaceId: ids.off, useCaseId: cards.offCard.id });
  assert.ok(review.includes(cards.offCard.title), "/portfolio/review/<id> di oggi");
  const submit = await html(pages.submit, "contributor", { workspaceId: ids.off });
  assert.ok(submit.includes("Nuovo contributo"), "/portfolio/submit di oggi");
  const plan = await html(pages.plan, "contributor", { workspaceId: ids.off });
  assert.ok(plan.includes("Unbundle Plan"), "/plan di oggi");
  // E con l'elenco vuoto l'area è spenta ovunque.
  delete process.env.USE_CASE_HUB_WORKSPACES;
  try {
    assert.equal((await open(pages.plan, "contributor", { workspaceId: ids.on })).digest, null);
  } finally {
    areaOn();
  }
});

test("link di condivisione: i membri vanno alla scheda nuova con l'area accesa, a quella di oggi con l'area spenta", opts, async () => {
  areaOn();
  const on = await open(pages.share, "contributor", { workspaceId: ids.on, useCaseId: cards.bottom.id }, { token: createShareToken(ids.on) });
  assert.equal(on.digest, temporaryRedirect(`/dashboard/${ids.on}/use-cases/${cards.bottom.id}`));
  const off = await open(pages.share, "contributor", { workspaceId: ids.off, useCaseId: cards.offCard.id }, { token: createShareToken(ids.off) });
  assert.equal(off.digest, temporaryRedirect(`/dashboard/${ids.off}/portfolio/review/${cards.offCard.id}`));
  // Chi non è membro vede la forma ridotta; «Accedi» riporta alla scheda giusta.
  const reduced = await html(pages.share, "outsider", { workspaceId: ids.on, useCaseId: cards.bottom.id }, { token: createShareToken(ids.on) });
  assert.ok(reduced.includes(encodeURIComponent(`/dashboard/${ids.on}/use-cases/${cards.bottom.id}`)), "login verso /use-cases/<id>");
  const reducedOff = await html(pages.share, "outsider", { workspaceId: ids.off, useCaseId: cards.offCard.id }, { token: createShareToken(ids.off) });
  assert.ok(reducedOff.includes(encodeURIComponent(`/dashboard/${ids.off}/portfolio/review/${cards.offCard.id}`)), "login come oggi");
});

test("/use-cases/nuovo con l'area spenta: notFound() e la pagina «non trovato» dell'area", opts, async () => {
  areaOn();
  const off = await open(pages.newUseCase, "contributor", { workspaceId: ids.off });
  assert.equal(off.digest, "NEXT_HTTP_ERROR_FALLBACK;404");
  assert.equal(notFounds.newUseCase, notFounds.useCases, "nuovo/not-found.tsx è quello di /use-cases");
  const shown = renderToStaticMarkup(createElement(notFounds.newUseCase as never));
  assert.ok(shown.includes("Use case non trovato") && shown.includes("Forse è di un altro workspace, o il link è sbagliato."));
  assert.ok(!shown.includes("<form"), "nessun modulo");
});

// ─── Campanella e Intelligence (D4, DESIGN §2.5, §14.3) ──────────────

test("campanella: i link dei segnali seguono l'area del workspace", opts, async () => {
  areaOn();
  const signalsOf = async (workspaceId: string, role: string, useCaseHub: boolean) => {
    const tree = await workspaceTopbar({ workspaceId, role, useCaseHub });
    // La campanella riceve il payload della persona (SPEC §P2.5): le righe «segnale» hanno la chiave `s:<id>`.
    const [initial] = elementsOf(tree)
      .filter((element) => Object.hasOwn(element.props, "initial"))
      .map((element) => element.props.initial) as Array<{ entries: Array<{ key: string; source: string; href: string | null }> }>;
    assert.ok(initial && Array.isArray(initial.entries), "la campanella riceve le righe");
    const typeOf = new Map((await q(`SELECT id::text AS id, signal_type FROM weekly_signals WHERE workspace_id = $1::uuid`, [workspaceId])).map((r) => [`s:${r.id}`, String(r.signal_type)]));
    return Object.fromEntries(initial.entries.filter((e) => e.source === "segnale").map((e) => [typeOf.get(e.key), e.href]));
  };
  const on = await signalsOf(ids.on, "function_lead", true);
  assert.equal(on.new_portfolio_item, `/dashboard/${ids.on}/use-cases/${cards.bottom.id}`);
  assert.equal(on.use_case_digest, `/dashboard/${ids.on}/use-cases?vista=da-decidere`);
  assert.equal(on.use_case_quarter, `/dashboard/${ids.on}/use-cases?vista=roadmap`);
  assert.equal(on.risk_alert, null);
  // Spenta: come oggi, solo il nuovo contributo, verso la revisione.
  const off = await signalsOf(ids.off, "function_lead", false);
  assert.equal(off.new_portfolio_item, `/dashboard/${ids.off}/portfolio/review/${cards.offCard.id}`);
  // Il contributore non riceve i segnali delle schede (H2e), con l'area accesa o spenta.
  assert.deepEqual(Object.keys(await signalsOf(ids.on, "contributor", true)).sort(), ["new_use_case_opportunity", "risk_alert"]);
});

test("Intelligence: i segnali delle schede con il loro nome e i riepiloghi con il link, solo ai revisori", opts, async () => {
  areaOn();
  const reviewer = await html(pages.intelligence, "builder", { workspaceId: ids.on });
  for (const label of ["Nuovo use case", "Use case", "Roadmap"]) assert.ok(reviewer.includes(`>${label}</span>`), `etichetta «${label}»`);
  for (const raw of ["new_portfolio_item", "use_case_digest", "use_case_quarter"]) assert.ok(!reviewer.includes(`>${raw}<`), `nessuna chiave grezza ${raw}`);
  assert.ok(reviewer.includes(`href="/dashboard/${ids.on}/use-cases?vista=da-decidere"`), "link del riepilogo");
  assert.ok(reviewer.includes(`href="/dashboard/${ids.on}/use-cases?vista=roadmap"`), "link del trimestre");
  const contributor = await html(pages.intelligence, "contributor", { workspaceId: ids.on });
  for (const text of [`SEGNALE-SCHEDA-${suffix}`, `RIEPILOGO-${suffix}`, `TRIMESTRE-${suffix}`, "/use-cases?vista="]) {
    assert.ok(!contributor.includes(text), `contributore: «${text}»`);
  }
  assert.ok(contributor.includes(`RISCHIO-${suffix}`));
});

test("Intelligence, «Segna tutti letti» e «Segna come letto»: per persona, e il contributore non tocca i segnali delle schede", opts, async () => {
  areaOn();
  await markAllUnread();
  const ALL = ["new_portfolio_item", "new_use_case_opportunity", "risk_alert", "use_case_digest", "use_case_quarter"];
  try {
    signIn("contributor");
    await intelligence.markAllSignalsRead(ids.on);
    // Per il contributore: letti i segnali che vede; i segnali delle schede non li tocca.
    assert.deepEqual(await unreadTypesFor(ids.on, "contributor"), ["new_portfolio_item", "use_case_digest", "use_case_quarter"]);
    // Per il revisore niente cambia, e `is_read` resta quello di prima (SPEC §P2.4).
    assert.deepEqual(await unreadTypesFor(ids.on, "builder"), ALL);
    assert.deepEqual(await unreadTypes(ids.on), ALL);

    // Anche con l'id di un segnale delle schede: niente.
    await intelligence.markSignalAsRead(ids.on, signalIds.digest);
    await intelligence.markSignalAsRead(ids.on, signalIds.case);
    assert.deepEqual(await unreadTypesFor(ids.on, "contributor"), ["new_portfolio_item", "use_case_digest", "use_case_quarter"]);

    // I segnali che vede sì, solo per lui; mai un segnale di un altro workspace.
    await markAllUnread();
    assert.deepEqual(await intelligence.markSignalAsRead(ids.on, signalIds.risk), { ok: true });
    assert.ok(!(await unreadTypesFor(ids.on, "contributor")).includes("risk_alert"));
    assert.ok((await unreadTypesFor(ids.on, "builder")).includes("risk_alert"));
    await intelligence.markSignalAsRead(ids.on, signalIds.otherWorkspace);
    assert.deepEqual(await unreadTypesFor(ids.off, "contributor"), ["new_portfolio_item"]);

    // Il revisore li segna tutti, solo per sé e solo nel suo workspace.
    signIn("builder");
    await intelligence.markSignalAsRead(ids.on, signalIds.digest);
    assert.ok(!(await unreadTypesFor(ids.on, "builder")).includes("use_case_digest"));
    await intelligence.markAllSignalsRead(ids.on);
    assert.deepEqual(await unreadTypesFor(ids.on, "builder"), []);
    assert.deepEqual(await unreadTypesFor(ids.off, "builder"), ["new_portfolio_item"]);
    assert.ok((await unreadTypesFor(ids.on, "contributor")).includes("new_use_case_opportunity"), "il contributore non è toccato");

    // Chi non è membro non arriva alla query.
    await markAllUnread();
    signIn("outsider");
    await assert.rejects(intelligence.markAllSignalsRead(ids.on), /non accessibile/);
    assert.equal((await unreadTypesFor(ids.on, "outsider")).length, 5);
  } finally {
    await markAllUnread();
    signIn(null);
  }
});

test("Campanella, «ho aperto questa riga»: per persona, e non spegne ai revisori i segnali delle schede", opts, async () => {
  areaOn();
  // La scrittura che la campanella fa quando si apre un segnale (POST /api/workspaces/<ws>/bell).
  const { writeBellRead } = await import("../notifications/bell-writes.ts");
  const read = (person: Exclude<Person, "outsider">, signalId: string) => writeBellRead({ workspaceId: ids.on, userId: ids[person], role: roles[person], ref: { source: "segnale", id: signalId } });
  await markAllUnread();
  try {
    // Il contributore, anche con l'id di un segnale delle schede: niente.
    for (const id of [signalIds.case, signalIds.digest, signalIds.quarter]) assert.equal(await read("contributor", id), "ok");
    assert.deepEqual(await unreadTypesFor(ids.on, "contributor"), ["new_portfolio_item", "new_use_case_opportunity", "risk_alert", "use_case_digest", "use_case_quarter"]);
    // I segnali che vede sì, solo per lui.
    await read("contributor", signalIds.risk);
    assert.ok(!(await unreadTypesFor(ids.on, "contributor")).includes("risk_alert"));
    assert.ok((await unreadTypesFor(ids.on, "builder")).includes("risk_alert"));
    // Mai un segnale di un altro workspace.
    await read("contributor", signalIds.otherWorkspace);
    assert.deepEqual(await unreadTypesFor(ids.off, "contributor"), ["new_portfolio_item"]);
    // Il revisore segna letto il segnale delle schede che riceve, per sé.
    await read("builder", signalIds.case);
    assert.ok(!(await unreadTypesFor(ids.on, "builder")).includes("new_portfolio_item"));
    assert.ok((await unreadTypesFor(ids.on, "contributor")).includes("new_portfolio_item"));
  } finally {
    await markAllUnread();
  }
});

// ─── Impostazioni (DESIGN §13, §14.3; PIANO-LAVORI H4i) ───────────────

test("Impostazioni: «Valutazione» e WhatsApp solo con l'area accesa e solo a chi gestisce il workspace", opts, async () => {
  areaOn();
  await q(`UPDATE workspaces SET whatsapp_webhook_url = $2 WHERE id = ANY($1::uuid[])`, [[ids.on, ids.off], "https://relay.example.test/hook"]);
  const settings = async (person: Person, workspaceId: string) => {
    const result = await open(pages.settings, person, { workspaceId });
    assert.equal(result.digest, null);
    const elements = elementsOf(result.element);
    return {
      valuation: elements.filter((element) => typeName(element) === "ValuationSettings").map((element) => element.props),
      whatsapp: elements.filter((element) => typeName(element) === "WhatsappWebhookForm").map((element) => element.props),
      anchors: elements.map((element) => element.props.href).filter((href): href is string => typeof href === "string" && href.startsWith("#")),
      ids: elements.map((element) => element.props.id).filter((id): id is string => typeof id === "string"),
    };
  };

  for (const person of ["lead", "manager"] as const) {
    const on = await settings(person, ids.on);
    assert.deepEqual(on.valuation, [{ workspaceId: ids.on, id: "valutazione-use-case" }], `${person}: Valutazione`);
    assert.equal(on.whatsapp.length, 1, `${person}: WhatsApp`);
    assert.equal(on.whatsapp[0].initialUrl, "https://relay.example.test/hook");
    assert.equal(on.whatsapp[0].workspaceId, ids.on);
    assert.deepEqual(on.anchors, ["#persone", "#integrazioni", "#valutazione-use-case", "#zona-pericolosa"]);
    assert.ok(on.ids.includes("valutazione"), "«Criteri ESG» tiene la sua ancora");
  }
  for (const person of ["builder", "contributor"] as const) {
    const on = await settings(person, ids.on);
    assert.deepEqual([on.valuation.length, on.whatsapp.length], [0, 0], `${person}: niente`);
    assert.deepEqual(on.anchors, ["#persone", "#integrazioni", "#valutazione", "#zona-pericolosa"]);
  }
  // Area spenta: le impostazioni di oggi, anche per chi gestisce il workspace.
  const off = await settings("lead", ids.off);
  assert.deepEqual([off.valuation.length, off.whatsapp.length], [0, 0]);
  assert.deepEqual(off.anchors, ["#persone", "#integrazioni", "#valutazione", "#zona-pericolosa"]);
});

// ─── Overview (DESIGN §2.5) ───────────────────────────────────────────

test("Overview, area accesa: il passo «Use case» per ruolo e uno strumento «Use case»", opts, async () => {
  areaOn();
  const base = `/dashboard/${ids.on}/use-cases`;
  const reviewer = await html(pages.overview, "builder", { workspaceId: ids.on });
  // Le due dall'alto, anche quella nascosta alla ricerca; con il filtro dell'origine.
  assert.ok(reviewer.includes("2 use case dall&#x27;alto") || reviewer.includes("2 use case dall'alto"), "2 use case dall'alto");
  assert.ok(reviewer.includes(`href="${base}?origine=transformation"`));
  assert.ok(reviewer.includes(`href="${base}"`), "lo strumento «Use case»");
  for (const text of ["Raccolta &amp; ranking", ">Piano<", "Use cases", `/dashboard/${ids.on}/portfolio`, `/dashboard/${ids.on}/plan`]) {
    assert.ok(!reviewer.includes(text), `revisore: «${text}»`);
  }
  // Il contributore conta quello che vede: la dall'alto visibile, quella dal basso e la sua nascosta.
  const contributor = await html(pages.overview, "contributor", { workspaceId: ids.on });
  assert.ok(contributor.includes(">3 use case<"), "3 use case");
  assert.ok(!contributor.includes("dall&#x27;alto") && !contributor.includes("origine="), "niente origine al contributore");
  // Il Percorso resta di 4 passi: nessun passo «Realizzazione».
  assert.ok(!reviewer.includes("Realizzazione"), "nessun 5° passo");
});

test("Overview, area spenta: passo e strumenti di oggi", opts, async () => {
  areaOn();
  const page = await html(pages.overview, "builder", { workspaceId: ids.off });
  for (const text of ["Use cases", "1 use case identificati", "Raccolta &amp; ranking", ">Piano<", `/dashboard/${ids.off}/portfolio`, `/dashboard/${ids.off}/plan`]) {
    assert.ok(page.includes(text), `manca «${text}»`);
  }
  assert.ok(!page.includes("dall&#x27;alto"));
});
