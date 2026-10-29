import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";
import { DEFAULT_REVIEW_TEAM_NAME } from "../review-team.ts";
import { askedTitle } from "./answers.ts";

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format?: string; source?: string | Uint8Array; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult;
    load?(url: string, context: object, nextLoad: (url: string, context: object) => LoadResult): LoadResult;
  }): void;
};

// La pagina «Use case» con l'area accesa (docs/use-case/PIANO-LAVORI.md H4a; docs/use-case/
// DESIGN.md §4, §5.1, §7.2, §11; decisioni D4, D13, D15): la pagina vera
// (`use-cases/page.tsx`) resa in questo processo con la sessione scelta dalla prova.
//
// - Vista di partenza per ruolo: Lateral Space e AI Builder del cliente «Da decidere» se c'è
//   qualcosa da decidere, altrimenti la Panoramica; lo sponsor del cliente e i contributori la
//   Panoramica. I vecchi `?vista=priorita` e `?vista=roadmap` aprono la Panoramica.
// - Fasce del costo del workspace diverse dalle predefinite: posizione in matrice, linea del
//   costo basso, zone, cifre della Panoramica, etichette delle fasce ed export le usano.
// - Il contributore: titolo, fase e «Quando», solo «Cerca per titolo», codice e nota pubblica
//   delle sole proprie proposte; nessun «€», nessun `[data-figure]`.
// - La testa della Panoramica: le fasi, le cifre ai revisori e «Prossimo passo» con il solo pulsante
//   pieno («Nuovo use case» bordato); con un filtro solo fasi e cifre, ai contributori solo le fasi.
// - Vuoti, filtri senza risultati, i grafici del menu «⋯» (sotto la matrice gli elenchi chiusi «N da
//   stimare», che `stima` apre; «Tipo» solo dove filtra), pannello laterale e pannello rapido.
// - «Agente» (rilascio «Panoramica»): il workspace P ha titoli con il prefisso dell'agente
//   («LIBRA L1 · …») e uno senza; il filtro è solo dei revisori. Le corsie della Panoramica con il
//   tag e le barre del valore, e «Per agente», solo ai revisori.
// - Parte dossier non disponibile (§4.9): «In realizzazione» mostra solo fase e titolo. La
//   lettura del dossier fallisce per finta: `dossierSummaries` risponde «errore» quando la
//   prova accende `__hubH4aDossierError`, altrimenti è quella vera.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del pacchetto
// hub_<id> su 127.0.0.1) gira sul database di prova; dentro `npm run check` si salta (in
// testa solo moduli di Node; i moduli dell'app arrivano con `await import()` in `before()`).
// I file `.tsx` si traducono qui con TypeScript, solo per questa prova; `@/lib/auth`
// restituisce la sessione della prova, ruolo e accesso si rileggono dal database.
// Dati sintetici, creati e cancellati qui.
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
type RouteGet = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type HubModule = typeof import("../../components/use-cases/hub.tsx");
type Access = typeof import("../workspace-access.ts");
type PanelParts = {
  toDecisionItem: typeof import("./decision-ui.ts").toDecisionItem;
  WhenControl: typeof import("../../components/use-cases/when-control.tsx").WhenControl;
  DecisionButtons: typeof import("../../components/use-cases/decision-buttons.tsx").DecisionButtons;
  createElement: (type: unknown, props: unknown) => unknown;
};

let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let renderToStaticMarkup: (element: unknown) => string;
let pageOfUseCases: Page;
let exportGet: RouteGet;
let hub: HubModule;
let access: Access;
let panelParts: PanelParts;
let XLSX: typeof import("xlsx");
let currentQuarter: () => string;
let nextQuarter: (q: string) => string;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  /** Area accesa, fasce del workspace diverse dalle predefinite. */
  wsA: randomUUID(),
  /** Area accesa, niente da decidere: solo una best practice approvata. */
  wsD: randomUUID(),
  /** Area accesa, una sola scheda chiusa: niente da decidere, niente nella Panoramica. */
  wsE: randomUUID(),
  /** Area accesa, nessuno use case. */
  wsZ: randomUUID(),
  /** Area accesa, titoli con il prefisso dell'agente («LIBRA L1 · …») e uno senza (rilascio «Panoramica»). */
  wsP: randomUUID(),
  ls: randomUUID(),
  builder: randomUUID(),
  manager: randomUUID(),
  contributor: randomUUID(),
};
const emails = {
  ls: `ls.h4a.${suffix}@ls.test`,
  builder: `builder.h4a.${suffix}@cliente.test`,
  manager: `sponsor.h4a.${suffix}@cliente.test`,
  contributor: `contributor.h4a.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;
const ROLES: Record<Person, string> = {
  ls: "transformation_lead",
  builder: "function_lead",
  manager: "exec_sponsor",
  contributor: "contributor",
};
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

/** Fasce del costo del workspace A, diverse dalle predefinite (D15), e la sua soglia del costo basso. */
const BANDS_A = {
  limits: [15_000, 40_000, 90_000, 200_000],
  labels: ["Piccolo", "Medio", "Grande", "Molto grande", "Enorme"],
  topReferenceEur: 300_000,
};
const COST_LOW_A = 40_000;
const HIGH = { impact: { efficiency: 4, profitability: 4 } };
const MID = { impact: { efficiency: 3, profitability: 3 } };
const CONTRIBUTOR_KEYS = ["id", "title", "phase", "subState", "phaseLabel", "quando", "own"].sort();
const OWN_KEYS = [...CONTRIBUTOR_KEYS, "code", "publicNote"].sort();
const OWN_NOTE = `Nota pubblica della mia proposta ${suffix}`;
const OWN_QUESTION = `Domanda del team sulla mia proposta ${suffix}`;
const OTHER_NOTE = `Nota pubblica altrui ${suffix}`;
const TEAM_QUESTION = `Quante visite fate al mese? ${suffix}`;
const TEAM_ANSWER = `Circa 40 visite al mese ${suffix}`;

const codeBase = 20_000 + Math.floor(Math.random() * 70_000);
let codeSeq = 0;

interface Seed {
  workspaceId?: string;
  title: string;
  status?: string;
  review?: string;
  kind?: string;
  origin?: string;
  intake?: Record<string, unknown> | null;
  publicNote?: string | null;
  reviewedBy?: string | null;
  targetQuarter?: string | null;
  customScores?: Record<string, unknown> | null;
  proposedBy?: string | null;
  source?: string;
  valueEurYear?: number | null;
  costEurOnce?: number | null;
  costBand?: number | null;
}

/**
 * Una scheda sintetica, scritta senza passare dal servizio. `submitted_at` è un `timestamp` senza
 * fuso che l'app legge come UTC: si scrive l'ora UTC, così i giorni di attesa non dipendono dal fuso
 * del cluster di prova (Europe/Rome: dalle 22 «da 3 giorni» diventava «da 2 giorni»).
 */
async function seed(s: Seed): Promise<{ id: string; code: string; title: string }> {
  const id = randomUUID();
  const code = `XX-${codeBase + codeSeq++}`;
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, origin, code,
       intake, public_note, reviewed_by, target_quarter, custom_scores, source, proposed_by, value_eur_year, cost_eur_once, cost_band,
       submitted_at)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', $4::use_case_status, $5::portfolio_review_status, $6, $7, $8,
       $9::jsonb, $10, $11::uuid, $12, $13::jsonb, $14, $15, $16, $17, $18, ((date_trunc('day', now() AT TIME ZONE 'Europe/Rome') - interval '3 days' + interval '12 hours') AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'UTC')`,
    [
      id,
      s.workspaceId ?? ids.wsA,
      s.title,
      s.status ?? "proposed",
      s.review ?? "in_review",
      s.kind ?? "use_case_ai",
      s.origin ?? "adoption",
      code,
      s.intake ? JSON.stringify(s.intake) : null,
      s.publicNote ?? null,
      s.reviewedBy ?? null,
      s.targetQuarter ?? null,
      s.customScores ? JSON.stringify(s.customScores) : null,
      s.source ?? "web_proposed",
      s.proposedBy === undefined ? `collega.${suffix}@cliente.test` : s.proposedBy,
      s.valueEurYear ?? null,
      s.costEurOnce ?? null,
      s.costBand ?? null,
    ],
  );
  return { id, code, title: s.title };
}

const cards = {} as Record<
  | "newIdea"
  | "serveInfo"
  | "amount"
  | "band"
  | "overdue"
  | "toDecideScored"
  | "answered"
  | "ownByEmail"
  | "ownAsked"
  | "othersWithNote"
  | "othersHidden"
  | "building"
  | "realized"
  | "bestPractice"
  | "dBest"
  | "eClosed",
  { id: string; code: string; title: string }
>;

/** Le schede del workspace P: una per agente (due per LIBRA) e una senza prefisso. */
const agentCards = {} as Record<
  "libraL1" | "libraL2" | "autoH1" | "orsaO1" | "plain" | "sirioS1" | "maiaM1" | "spicaP1" | "denebD1",
  { id: string; code: string; title: string }
>;

function signIn(person: Person | null): void {
  (globalThis as { __hubH4aSession?: unknown }).__hubH4aSession = person
    ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}`, image: null } }
    : null;
}

/** La pagina resa in HTML per `person`. */
async function html(person: Person, workspaceId: string, searchParams: Record<string, string> = {}): Promise<string> {
  signIn(person);
  const element = await pageOfUseCases({ params: Promise.resolve({ workspaceId }), searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(element);
}

/** I dati della pagina e l'albero degli elementi, senza renderli (per i pannelli, che vivono in un portale). */
async function hubTree(person: Person, workspaceId: string, searchParams: Record<string, string>) {
  const workspaceAccess = await access.getWorkspaceAccessForUser(ids[person], workspaceId);
  assert.ok(workspaceAccess, `${person} è nel workspace`);
  const session = { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}`, image: null } };
  const data = await hub.loadUseCaseHub({ workspaceId, session, access: workspaceAccess, searchParams });
  assert.ok(data);
  return { data, tree: hub.UseCaseHub({ data }) as unknown };
}

/** Le prop `name` degli elementi React dell'albero, in profondità (senza rendere i componenti). */
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

/** I pulsanti pieni della pagina: `[data-slot=button]` con la classe `bg-primary` (§5.7). */
function filledButtons(page: string): number {
  return [...page.matchAll(/<(?:a|button)\b[^>]*>/g)].filter(([tag]) => {
    if (!tag.includes('data-slot="button"')) return false;
    const classes = /class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? [];
    return classes.includes("bg-primary");
  }).length;
}

/** Il tag `<a>` di «Nuovo use case» nella testata: il link al pannello rapido o al modulo completo. */
function newUseCaseTag(page: string): string {
  const header = page.slice(page.indexOf('data-slot="hub-header"'), page.indexOf("</header>"));
  const tag = [...header.matchAll(/<a\b[^>]*>/g)].map(([found]) => found).find((found) => /href="[^"]*(?:nuovo=1|\/use-cases\/nuovo)"/.test(found));
  assert.ok(tag, "«Nuovo use case» nella testata");
  return tag;
}

/** Il pezzo di HTML da `data-slot="<slot>"` alla chiusura della sua `</section>`. */
function sectionOf(page: string, slot: string): string {
  const start = page.indexOf(`data-slot="${slot}"`);
  assert.ok(start >= 0, slot);
  return page.slice(start, page.indexOf("</section>", start));
}

/** La vista a schermo (`data-view` della pagina). */
function viewOf(page: string): string | null {
  return /data-slot="use-case-hub" data-view="([a-z-]+)"/.exec(page)?.[1] ?? null;
}

/** Il pezzo di HTML di un elemento con `data-id`, fino alla chiusura del suo `<li>`. */
function rowOf(page: string, id: string): string {
  const start = page.indexOf(`data-id="${id}"`);
  assert.ok(start >= 0, `riga ${id}`);
  const end = page.indexOf("</li>", start);
  return page.slice(start, end);
}

/**
 * Sopra un grafico del menu «⋯»: il link di «‹ Torna alla Panoramica» (con `&amp;`, com'è nell'HTML) e
 * il nome del grafico. Dal riquadro alla chiusura dell'h2: il pulsante scrive il suo `data-slot` sull'`<a>`.
 */
function chartHeaderOf(page: string): { href: string; text: string; title: string } {
  const start = page.indexOf('data-slot="chart-header"');
  assert.ok(start >= 0, "«Torna alla Panoramica» sopra il grafico");
  const header = page.slice(start, page.indexOf("</h2>", start) + 5);
  return {
    href: /<a [^>]*href="([^"]*)"/.exec(header)?.[1] ?? "",
    text: /<a [^>]*>([\s\S]*?)<\/a>/.exec(header)?.[1].replace(/<[^>]+>/g, "") ?? "",
    title: /<h2[^>]*>([^<]*)<\/h2>/.exec(header)?.[1] ?? "",
  };
}

/**
 * Le decisioni del pannello aperto di un revisore (`?apri=`): «Quando» se è approvato, poi i
 * pulsanti, con le prop che passa `UseCasePanel`. Il pannello vive in un portale, che non arriva
 * nell'HTML: qui si rendono da soli i due componenti del suo blocco.
 */
async function panelOf(person: Person, workspaceId: string, searchParams: Record<string, string>): Promise<string> {
  const { data, tree } = await hubTree(person, workspaceId, searchParams);
  const panel = findProp(tree, "data").find((value) => (value as { projection?: string })?.projection === "revisore") as
    | { item: Parameters<PanelParts["toDecisionItem"]>[0] & { phase: string }; candidates: unknown[] }
    | undefined;
  assert.ok(panel, "il pannello di un revisore");
  assert.ok(data.abilities.canDecide, "chi guarda decide");
  const props = { workspaceId, item: panelParts.toDecisionItem(panel.item), today: data.list.today, canDecide: true };
  const when = panel.item.phase === "approvato" ? renderToStaticMarkup(panelParts.createElement(panelParts.WhenControl, { ...props, labelledBy: "quando" })) : "";
  return when + renderToStaticMarkup(panelParts.createElement(panelParts.DecisionButtons, { ...props, candidates: panel.candidates }));
}

/** Le voci dei grafici nel menu «⋯» (`HubHeader.menu.charts`): il contenuto del menu non è nell'HTML finché è chiuso. */
async function menuCharts(person: Person, workspaceId: string, searchParams: Record<string, string>) {
  const { tree } = await hubTree(person, workspaceId, searchParams);
  const [menu] = findProp(tree, "menu") as Array<{ charts: Array<{ label: string; href: string }> } | null>;
  return menu;
}

before(async () => {
  if (!enabled) return;
  const { default: ts } = await import("typescript");
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const dossiers = JSON.stringify(new URL("../db/queries/use-case-dossiers.ts", import.meta.url).href);
  const stubs: Record<string, string> = {
    // La lettura vera, salvo `dossierSummaries` quando la prova vuole la parte dossier in errore.
    "@/lib/db/queries/use-case-dossiers": stub(
      `export * from ${dossiers}; import * as real from ${dossiers};
       export function dossierSummaries(...args) {
         return globalThis.__hubH4aDossierError ? Promise.resolve({ ok: false, motivo: "errore" }) : real.dossierSummaries(...args);
       }`,
    ),
    "@/lib/auth": stub("export async function auth() { return globalThis.__hubH4aSession ?? null; }"),
    // La matrice di oggi (recharts) non si carica sotto Node puro: serve solo all'area spenta.
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
  // I componenti client chiamano `useRouter()`: un router che non naviga.
  const { createElement } = await import("react");
  const { renderToStaticMarkup: toHtml } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as {
    AppRouterContext: import("react").Context<object | null>;
  };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  renderToStaticMarkup = (element) => toHtml(createElement(AppRouterContext.Provider, { value: router }, element as never));
  pageOfUseCases = (await import("../../app/(dashboard)/dashboard/[workspaceId]/use-cases/page.tsx")).default as unknown as Page;
  exportGet = (await import("../../app/(dashboard)/dashboard/[workspaceId]/portfolio/export/route.ts")).GET as unknown as RouteGet;
  hub = await import("../../components/use-cases/hub.tsx");
  access = await import("../workspace-access.ts");
  panelParts = {
    toDecisionItem: (await import("./decision-ui.ts")).toDecisionItem,
    WhenControl: (await import("../../components/use-cases/when-control.tsx")).WhenControl,
    DecisionButtons: (await import("../../components/use-cases/decision-buttons.tsx")).DecisionButtons,
    createElement: (type, props) => createElement(type as never, props as never),
  };
  XLSX = await import("xlsx");
  const quarter = await import("./quarter.ts");
  currentQuarter = () => quarter.currentQuarter();
  nextQuarter = (value) => quarter.nextQuarter(value);

  process.env.USE_CASE_HUB_WORKSPACES = [ids.wsA, ids.wsD, ids.wsE, ids.wsZ, ids.wsP].join(",");
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H4a', $2)`, [ids.org, `hub-h4a-${ids.org}`]);
  await q(
    `INSERT INTO workspaces (id, organization_id, name) VALUES
       ($1::uuid, $5::uuid, 'Prova H4a A'), ($2::uuid, $5::uuid, 'Prova H4a D'), ($3::uuid, $5::uuid, 'Prova H4a E'), ($4::uuid, $5::uuid, 'Prova H4a Z')`,
    [ids.wsA, ids.wsD, ids.wsE, ids.wsZ, ids.org],
  );
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova H4a P')`, [ids.wsP, ids.org]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    for (const workspaceId of [ids.wsA, ids.wsD, ids.wsE, ids.wsZ, ids.wsP]) {
      await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [workspaceId, ids[person], ROLES[person]]);
    }
  }
  await q(`INSERT INTO workspace_scoring_models (workspace_id, impact_flag_enabled, config) VALUES ($1::uuid, false, $2::jsonb)`, [
    ids.wsA,
    JSON.stringify({ costBands: BANDS_A, thresholds: { highImpact: 3.5, midImpact: 2.5, highFeasibility: 3.5, costLowMaxEur: COST_LOW_A } }),
  ]);

  const thisQuarter = currentQuarter();
  cards.newIdea = await seed({ title: `Idea nuova ${suffix}`, review: "needs_inputs" });
  cards.serveInfo = await seed({ title: `Serve info ${suffix}`, review: "needs_inputs", reviewedBy: ids.ls, publicNote: OTHER_NOTE });
  cards.amount = await seed({
    title: `Approvata con importo ${suffix}`,
    status: "accepted",
    review: "scored",
    targetQuarter: thisQuarter,
    customScores: HIGH,
    costEurOnce: 30_000,
    valueEurYear: 50_000,
  });
  cards.band = await seed({
    title: `Approvata con fascia ${suffix}`,
    status: "accepted",
    review: "scored",
    targetQuarter: nextQuarter(thisQuarter),
    customScores: HIGH,
    costBand: 2,
    valueEurYear: 25_000,
    origin: "transformation",
  });
  // Approvata per un trimestre passato, senza Valore né Costo: «Scaduti».
  cards.overdue = await seed({ title: `Approvata scaduta ${suffix}`, status: "accepted", review: "scored", targetQuarter: "2020-Q1" });
  cards.toDecideScored = await seed({
    title: `Da decidere, valutata ${suffix}`,
    review: "scored",
    customScores: MID,
    costEurOnce: 120_000,
    // Dati raccolti dal connettore: la «Stima di Claude, non ufficiale» del pannello (§7.5).
    intake: {
      frequency: "settimanale",
      beneficiaries: 4,
      timeSavedMinutesPerRun: 30,
      valuePerRunEur: 25,
      proposerEstimate: { efficiency: { score: 4 }, effort: { score: 2 }, impactFlag: { value: "verde" } },
    },
  });
  // Da decidere con il solo Valore, tornata da «Serve info» con una risposta di chi ha proposto
  // (D17): la riga dice quale cifra manca («Costo: da stimare»), il pannello la domanda e la risposta.
  cards.answered = await seed({
    title: `Solo Valore, con risposta ${suffix}`,
    review: "in_review",
    customScores: HIGH,
    publicNote: TEAM_QUESTION,
    intake: {
      risposte: [{ at: "2026-10-01T09:00:00.000Z", text: "Prima risposta di prova." }, { at: "2026-10-02T09:00:00.000Z", text: TEAM_ANSWER }],
      // In attesa di una decisione: la scrive `answerInfoRequest`, la toglie ogni decisione.
      rispostaInAttesa: "2026-10-02T09:00:00.000Z",
    },
  });
  cards.ownByEmail = await seed({
    title: `Mia proposta ${suffix}`,
    review: "needs_inputs",
    publicNote: OWN_NOTE,
    proposedBy: emails.contributor.toUpperCase(),
  });
  // La propria proposta in «Serve info»: il contributore la vede con «Rispondi» (D17).
  cards.ownAsked = await seed({
    title: `Mia proposta con domanda ${suffix}`,
    review: "needs_inputs",
    reviewedBy: ids.ls,
    publicNote: OWN_QUESTION,
    proposedBy: emails.contributor,
  });
  cards.othersWithNote = await seed({ title: `Proposta altrui ${suffix}`, review: "needs_inputs", publicNote: OTHER_NOTE });
  cards.othersHidden = await seed({
    title: `Altrui nascosta ${suffix}`,
    origin: "transformation",
    source: "manual",
    intake: { hiddenFromSearch: true },
    proposedBy: null,
  });
  cards.building = await seed({ title: `In realizzazione ${suffix}`, status: "in_progress", review: "scored" });
  cards.realized = await seed({ title: `Realizzata ${suffix}`, status: "implemented", review: "scored", valueEurYear: 30_000 });
  cards.bestPractice = await seed({ title: `Best practice ${suffix}`, kind: "best_practice", status: "accepted", review: "scored" });
  cards.dBest = await seed({ workspaceId: ids.wsD, title: `Best practice di D ${suffix}`, kind: "best_practice", status: "accepted", review: "scored" });
  cards.eClosed = await seed({ workspaceId: ids.wsE, title: `Chiusa di E ${suffix}`, status: "rejected", review: "scored" });

  // Workspace P: gli agenti dal titolo (rilascio «Panoramica»). Due LIBRA con gli euro, un agente
  // senza cifre, uno scaduto, uno senza prefisso e senza trimestre, poi le altre fasi.
  const wsP = ids.wsP;
  const accepted = { workspaceId: wsP, status: "accepted", review: "scored" };
  agentCards.libraL1 = await seed({ ...accepted, title: `LIBRA L1 · Lettura delle fatture estere ${suffix}`, targetQuarter: thisQuarter, valueEurYear: 12_250, costEurOnce: 700 });
  agentCards.libraL2 = await seed({
    ...accepted,
    title: `LIBRA L2 · Riconciliazione dei pagamenti ${suffix}`,
    targetQuarter: nextQuarter(thisQuarter),
    valueEurYear: 5_000,
    costBand: 2,
    origin: "adoption",
  });
  agentCards.autoH1 = await seed({ ...accepted, title: `AUTO H1 · Cedolini consegnati ${suffix}`, targetQuarter: nextQuarter(nextQuarter(thisQuarter)) });
  agentCards.orsaO1 = await seed({ ...accepted, title: `ORSA O1 · Solleciti ai clienti ${suffix}`, targetQuarter: "2020-Q1", valueEurYear: 3_000 });
  agentCards.plain = await seed({ ...accepted, title: `Smistamento delle richieste ${suffix}` });
  agentCards.sirioS1 = await seed({ workspaceId: wsP, title: `SIRIO S1 · Budget di cassa ${suffix}`, status: "in_progress", review: "scored" });
  agentCards.maiaM1 = await seed({ workspaceId: wsP, title: `MAIA M1 · Report mensile ${suffix}`, status: "implemented", review: "scored", valueEurYear: 8_000 });
  agentCards.spicaP1 = await seed({ workspaceId: wsP, title: `SPICA P1 · Note spese ${suffix}`, review: "needs_inputs" });
  agentCards.denebD1 = await seed({ ...accepted, title: `DENEB D1 · Buone pratiche di onboarding ${suffix}`, kind: "best_practice", targetQuarter: thisQuarter });
});

after(async () => {
  signIn(null);
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  // I workspace portano via schede, iscrizioni e modelli di valutazione.
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsD, ids.wsE, ids.wsZ, ids.wsP]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((person) => ids[person as Person])]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
});

// ─── Vista di partenza (§4.2) ────────────────────────────────────────

test("vista di partenza per ruolo: revisori «Da decidere» se c'è qualcosa, altrimenti la Panoramica; sponsor del cliente e contributori la Panoramica", opts, async () => {
  assert.equal(viewOf(await html("ls", ids.wsA)), "da-decidere", "Lateral Space");
  assert.equal(viewOf(await html("builder", ids.wsA)), "da-decidere", "AI Builder del cliente");
  assert.equal(viewOf(await html("manager", ids.wsA)), "panoramica", "sponsor del cliente");
  assert.equal(viewOf(await html("contributor", ids.wsA)), "panoramica", "contributore");
  // Niente da decidere: i revisori partono dalla Panoramica.
  assert.equal(viewOf(await html("ls", ids.wsD)), "panoramica");
  assert.equal(viewOf(await html("builder", ids.wsE)), "panoramica");
  assert.equal(viewOf(await html("contributor", ids.wsD)), "panoramica");
  // Una vista scelta vince; il vecchio nome vale la Panoramica; «Cosa serve» non è dei contributori.
  assert.equal(viewOf(await html("manager", ids.wsA, { vista: "da-decidere" })), "da-decidere");
  assert.equal(viewOf(await html("contributor", ids.wsA, { vista: "priorita" })), "panoramica");
  assert.equal(viewOf(await html("contributor", ids.wsA, { vista: "cosa-serve" })), "panoramica");
  assert.equal(viewOf(await html("manager", ids.wsA, { vista: "cosa-serve" })), "cosa-serve");
});

/** I segmenti del selettore delle viste: etichetta e contatore, nell'ordine. */
function switcherOf(page: string): Array<{ label: string; count: string | null; href: string }> {
  const start = page.indexOf('data-slot="segmented-nav"');
  assert.ok(start >= 0, "il selettore delle viste");
  const nav = page.slice(start, page.indexOf("</nav>", start));
  return [...nav.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, inner]) => ({
    href,
    label: /<span>([^<]*)<\/span>/.exec(inner)?.[1] ?? "",
    count: /<span class="text-xs text-muted-foreground tabular-nums">([^<]*)<\/span>/.exec(inner)?.[1] ?? null,
  }));
}

test("selettore delle viste: ai revisori «Panoramica», «Da decidere» e «Cosa serve», senza contatore sull'ultima; al contributore due", opts, async () => {
  for (const person of ["ls", "builder", "manager"] as const) {
    const segments = switcherOf(await html(person, ids.wsA, { vista: "panoramica" }));
    assert.deepEqual(segments.map((segment) => segment.label), ["Panoramica", "Da decidere", "Cosa serve"], person);
    assert.equal(segments[0].href, `/dashboard/${ids.wsA}/use-cases?vista=panoramica`);
    const last = segments[2];
    assert.equal(last.count, null, `${person}: nessun numero su «Cosa serve»`);
    assert.equal(last.href, `/dashboard/${ids.wsA}/use-cases?vista=cosa-serve`);
  }
  const contributor = switcherOf(await html("contributor", ids.wsA, { vista: "panoramica" }));
  assert.deepEqual(contributor.map((segment) => segment.label), ["Panoramica", "In valutazione"]);
});

test("«Cosa serve»: un solo pulsante pieno, «Tipo» è un filtro, niente matrice né corsie", opts, async () => {
  const page = await html("ls", ids.wsA, { vista: "cosa-serve" });
  assert.equal(viewOf(page), "cosa-serve");
  assert.equal(filledButtons(page), 1, "un solo pulsante pieno");
  assert.ok(page.includes('aria-label="Tipo: Tutti"'), "«Tipo» come filtro");
  assert.ok(page.includes('data-slot="needs-board"'));
  assert.ok(!page.includes('data-slot="value-cost-matrix"') && !page.includes('data-slot="lanes"'));
  assert.ok(!page.includes('data-slot="show-toggle"') && !page.includes('data-slot="chart-header"'), "nessun interruttore e nessun grafico");
});

test("testata: H1, un solo pulsante pieno «Nuovo use case» (pannello rapido per Lateral Space), bordato con «Prossimo passo»; menu «⋯» solo ai revisori", opts, async () => {
  const ls = await html("ls", ids.wsA);
  assert.match(ls, /<h1[^>]*>Use case<\/h1>/);
  assert.ok(ls.includes("Dal basso e dall&#x27;alto: quali use case realizzare e quando.") || ls.includes("Dal basso e dall'alto: quali use case realizzare e quando."));
  assert.match(ls, /href="\/dashboard\/[^"]+\/use-cases\?vista=da-decidere&amp;nuovo=1"/, "Lateral Space: pannello rapido");
  assert.ok(ls.includes('aria-label="Altre azioni"'));
  const builder = await html("builder", ids.wsA);
  assert.ok(builder.includes(`href="/dashboard/${ids.wsA}/use-cases/nuovo"`), "revisore del cliente: modulo completo");
  const contributor = await html("contributor", ids.wsA);
  assert.ok(contributor.includes(`href="/dashboard/${ids.wsA}/use-cases/nuovo"`));
  assert.ok(!contributor.includes('aria-label="Altre azioni"'), "niente menu «⋯» per il contributore");
  for (const page of [ls, builder, contributor]) {
    assert.equal(filledButtons(page), 1, "un solo pulsante pieno");
  }
  // Nella Panoramica con «Prossimo passo» (in A ci sono proposte da decidere) il pulsante pieno è il
  // suo: «Nuovo use case» resta, bordato.
  for (const person of ["ls", "builder"] as const) {
    const overview = await html(person, ids.wsA, { vista: "panoramica" });
    assert.equal(filledButtons(overview), 1, `${person}: un solo pulsante pieno`);
    const box = sectionOf(overview, "next-step");
    assert.equal(filledButtons(box), 1, `${person}: il pulsante pieno è in «Prossimo passo»`);
    assert.ok(box.includes("aspettano una decisione.") && box.includes("Vedi le proposte"), box);
    assert.match(box, new RegExp(`href="/dashboard/${ids.wsA}/use-cases\\?vista=da-decidere"`));
    const button = newUseCaseTag(overview);
    assert.ok(!/class="[^"]*\bbg-primary\b/.test(button), `${person}: «Nuovo use case» bordato`);
    assert.match(button, /class="[^"]*\bdark:border-input\b/);
  }
  // Senza riquadro (il contributore) «Nuovo use case» resta pieno.
  assert.match(newUseCaseTag(await html("contributor", ids.wsA, { vista: "panoramica" })), /class="[^"]*\bbg-primary\b/);
});

// ─── Fasce del workspace (D15) ───────────────────────────────────────

test("fasce del workspace diverse dalle predefinite: matrice, linea del costo basso, zone ed etichette le usano", opts, async () => {
  // Il vecchio link della matrice di «Priorità»: la stessa matrice, nella Panoramica.
  const page = await html("ls", ids.wsA, { vista: "priorita", mostra: "matrice" });
  assert.equal(viewOf(page), "panoramica");
  assert.ok(page.includes('data-slot="value-cost-matrix"'));
  assert.ok(!page.includes('data-slot="lanes"'), "la matrice al posto delle corsie");
  // Dal menu «⋯»: sopra la matrice «‹ Torna alla Panoramica», che torna alle corsie, e il nome del grafico.
  assert.deepEqual(chartHeaderOf(page), { href: `/dashboard/${ids.wsA}/use-cases?vista=panoramica`, text: "Torna alla Panoramica", title: "Matrice Valore × Costo" });
  assert.ok(page.includes('data-chart="matrice"'));
  // 30.000 € nella seconda fascia del workspace (15.001-40.000): 1,5 + 14.999/24.999 ≈ 2,1 → 32 %.
  // Con le fasce predefinite (25.001-65.000) sarebbe 1,625 → 22,5 %.
  const point = new RegExp(`left:([\\d.]+)%;top:([\\d.]+)%"[^>]*><a[^>]*data-point="${cards.amount.id}"`).exec(page);
  assert.ok(point, "punto dello use case con importo");
  assert.ok(Math.abs(Number(point[1]) - 32) < 0.1, `posizione del costo ${point[1]}`);
  assert.ok(Math.abs(Number(point[2]) - 30) < 0.1, `Valore 4 → 30 %: ${point[2]}`);
  // Una fascia sola sta al centro della sua fascia: la seconda → 30 %.
  const band = new RegExp(`left:([\\d.]+)%;top:([\\d.]+)%"[^>]*><a[^>]*data-point="${cards.band.id}"`).exec(page);
  assert.ok(band && Math.abs(Number(band[1]) - 30) < 0.1, `fascia 2 al centro: ${band?.[1]}`);
  // Costo basso 40.000 € = fine della seconda fascia del workspace → 2,5 → 40 %.
  assert.match(page, /<line x1="40" x2="40" y1="0" y2="100"[^>]*stroke-dasharray/, "linea tratteggiata del costo basso");
  // Valore alto 3,5 → 40 % dall'alto.
  assert.match(page, /<line x1="0" x2="100" y1="40" y2="40"[^>]*stroke-dasharray/, "linea tratteggiata del Valore alto");
  for (const label of BANDS_A.labels) assert.ok(page.includes(`title="${label}"`), `etichetta della fascia ${label}`);
  for (const zone of ["Subito", "Da pianificare", "Se avanza tempo", "Non ora"]) assert.ok(page.includes(zone), zone);
  // Le etichette stanno dalla loro parte della linea del costo basso (40 %), anche al telefono.
  assert.match(page, /style="max-width:calc\(40% - 0\.75rem\)"[^>]*>Se avanza tempo</);
  assert.match(page, /style="left:calc\(40% \+ 0\.5rem\)"[^>]*>Non ora</);
  assert.ok(page.includes("Le zone sono un suggerimento, non la decisione."));

  // Zone con la soglia del workspace: la matrice qui sopra le disegna, l'export le scrive (la prova
  // dell'export «Fascia»). La lista di «Priorità» non c'è più: il vecchio link apre le corsie.
  const list = await html("ls", ids.wsA, { vista: "priorita", mostra: "lista" });
  assert.equal(viewOf(list), "panoramica");
  assert.ok(list.includes('data-slot="lanes"') && !list.includes('data-slot="chart-header"'));
  // Senza la lista, «Approva» e «Quando» stanno nel pannello: su una da decidere le decisioni, su
  // una approvata il trimestre.
  const toDecide = await panelOf("ls", ids.wsA, { vista: "panoramica", apri: cards.toDecideScored.id });
  assert.ok(toDecide.includes("Approva"), "«Approva» nel pannello");
  const approved = await panelOf("ls", ids.wsA, { vista: "panoramica", apri: cards.amount.id });
  assert.match(approved, /data-slot="when-control"/);
});

test("fasce del workspace: «costo di avvio» con il riferimento della fascia, «su N use case · M da fascia»", opts, async () => {
  const page = await html("builder", ids.wsA, { vista: "panoramica" });
  const figures = sectionOf(page, "overview-figures");
  // 30.000 € (importo) + 40.000 € (seconda fascia del workspace); con le predefinite sarebbe 95.000 €.
  const cost = figures.slice(figures.indexOf('data-figure="totale-costo"'));
  assert.match(cost, /^data-figure="totale-costo"[^>]*><p[^>]*><span class="whitespace-nowrap">70\.000 €<\/span><\/p><p class="text-sm">costo di avvio<\/p><p[^>]*>su 2 use case · 1 da fascia</);
  // 50.000 € + 25.000 €, «su 2 use case».
  const value = figures.slice(figures.indexOf('data-figure="totale-valore"'));
  assert.match(value, /^data-figure="totale-valore"[^>]*><p[^>]*><span class="whitespace-nowrap">75\.000 €<\/span><\/p><p class="text-sm">valore contato all&#x27;anno<\/p><p[^>]*>su 2 use case</);
  assert.ok(page.includes("su 2 use case<"));
  for (const text of ["Valore misurato", "Valore atteso all", "Costo impegnato"]) assert.ok(!page.includes(text), text);
  // Le fasi: le proposte da decidere, gli approvati delle corsie (con lo scaduto e la best practice),
  // quello in realizzazione e quello realizzato.
  const strip = sectionOf(page, "phase-strip").replace(/^[^>]*>|<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.match(strip, /^Da decidere \d+ → Approvati 4 → In realizzazione 1 → Realizzati 1$/);
  // Lo use case di questo trimestre e lo scaduto, come nella corsia.
  assert.match(figures, /data-figure="totale-trimestre"[^>]*><p[^>]*><span class="whitespace-nowrap">2<\/span><\/p><p class="text-sm">use case in questo trimestre</);
  // La card della Panoramica: l'avvio con la sua fonte e gli euro all'anno, senza parola né «Valore:» e «Costo:».
  const amount = rowOf(page, cards.amount.id);
  assert.ok(amount.includes("avvio 30.000 €"), amount);
  assert.match(amount, /data-source="team_importo"/);
  assert.ok(amount.includes("50.000 € all&#x27;anno") || amount.includes("50.000 € all'anno"), amount);
  assert.doesNotMatch(amount, />Alto</);
  assert.ok(!amount.includes("Valore: ") && !amount.includes("Costo: "), amount);
  const band = rowOf(page, cards.band.id);
  assert.ok(band.includes("avvio €€ · fascia"), band);
  assert.match(band, /data-source="team_fascia"/);
  // Senza cifre: «Valore: da stimare»; il costo che manca non si scrive (lo dice il pannello).
  const overdue = rowOf(page, cards.overdue.id);
  assert.ok(!overdue.includes('data-figure="costo"'), overdue);
  assert.match(overdue, /Valore: <\/span><span[^>]*>da stimare</);
  // Best practice approvata: «Da diffondere», il Valore e senza costo.
  const best = rowOf(page, cards.bestPractice.id);
  assert.ok(best.includes("Da diffondere"));
  assert.match(best, /data-figure="valore"/);
  assert.ok(!best.includes('data-figure="costo"'));
  // Le corsie per trimestre; «Realizzati» chiusi, con il mese.
  assert.ok(page.includes("Questo trimestre · T"));
  assert.ok(page.includes("Prossimo trimestre · T"));
  const done = page.slice(page.indexOf('data-slot="panoramica-realizzati"'), page.indexOf("</details>", page.indexOf('data-slot="panoramica-realizzati"')));
  assert.ok(done.includes(`data-id="${cards.realized.id}"`), "il realizzato dentro «Realizzati»");
  assert.match(rowOf(page, cards.realized.id), />Realizzato</);
});

test("fasce del workspace: la colonna «Fascia» dell'export usa le etichette del workspace", opts, async () => {
  signIn("builder");
  const res = await exportGet(new Request("http://127.0.0.1/export"), { params: Promise.resolve({ workspaceId: ids.wsA }) });
  assert.equal(res.status, 200);
  const workbook = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]]);
  const byCode = new Map(rows.map((row) => [row.Codice, row]));
  assert.equal(byCode.get(cards.band.code)?.Fascia, "€€ · Medio");
  assert.equal(byCode.get(cards.amount.code)?.Fascia, "€€ · Medio");
  assert.equal(byCode.get(cards.toDecideScored.code)?.Fascia, "€€€€ · Molto grande");
  assert.equal(byCode.get(cards.amount.code)?.Zona, "Subito");
});

// ─── Le tre viste ────────────────────────────────────────────────────

test("«Da decidere»: righe con Valore e Costo con la fonte, giorni di attesa, «Serve info» sotto «In attesa di risposta»", opts, async () => {
  const page = await html("ls", ids.wsA, { vista: "da-decidere" });
  const row = rowOf(page, cards.toDecideScored.id);
  assert.ok(row.includes(cards.toDecideScored.code));
  assert.ok(row.includes("120.000 €"));
  assert.match(row, /data-cost-source="team_importo"/);
  assert.match(row, /data-source="team_importo"/);
  assert.ok(row.includes("Valutata"));
  assert.ok(row.includes("da 3 giorni"));
  const divider = page.indexOf("In attesa di risposta");
  assert.ok(divider > 0);
  assert.ok(page.indexOf(`data-id="${cards.serveInfo.id}"`) > divider, "«Serve info» sotto il divisore");
  assert.ok(page.indexOf(`data-id="${cards.newIdea.id}"`) < divider);
  // Il contatore non conta «Serve info»: Idea nuova, Da decidere valutata, Solo Valore con risposta, Mia proposta, Altrui, Altrui nascosta.
  assert.match(page, /Da decidere<\/span><span class="text-xs text-muted-foreground tabular-nums">6</);
  // Telefono (§4.6, D5): la seconda riga va a capo, il costo non si accorcia mai e la sua fonte
  // resta a schermo; «Valore:» e «Costo:» a ogni larghezza, così ogni riga dice lo stesso (H7).
  const tagOf = (html: string, figure: string) => new RegExp(`<span data-figure="${figure}"[^>]*>`).exec(html)?.[0] ?? "";
  assert.match(row, /<span class="flex min-w-0 flex-wrap /);
  assert.ok(!tagOf(row, "costo").includes("truncate"), tagOf(row, "costo"));
  assert.ok(!tagOf(row, "costo").includes("first-child]:hidden") && !tagOf(row, "valore").includes("first-child]:hidden"));
  assert.ok(row.includes("Valore: ") && row.includes("Costo: "));
  const valueOnly = rowOf(page, cards.answered.id);
  assert.match(valueOnly, /Costo: <\/span><span[^>]*>da stimare</);
  assert.ok(!tagOf(valueOnly, "valore").includes("first-child]:hidden"), "«Valore: Alto» anche sul telefono");
  // D17 (H7): una risposta non ancora decisa si legge «Risposta ricevuta», non «Nuova».
  assert.ok(valueOnly.includes(">Risposta ricevuta<") && !valueOnly.includes(">Nuova<"), "risposta ricevuta");
  // Approvate e realizzate non ci sono.
  assert.ok(!page.includes(`data-id="${cards.amount.id}"`));
  assert.ok(!page.includes(`data-id="${cards.realized.id}"`));
});

test("vecchi link di «Priorità»: la Panoramica", opts, async () => {
  const page = await html("ls", ids.wsA, { vista: "priorita" });
  assert.equal(viewOf(page), "panoramica");
  for (const text of ['data-slot="chart-header"', 'data-slot="value-cost-matrix"']) {
    assert.ok(!page.includes(text), `senza grafico: niente ${text}`);
  }
  assert.ok(page.includes('data-slot="lanes"'), "le corsie");
  // «Da costruire | Da diffondere» sceglieva la lista: nella Panoramica «Tipo» è un filtro.
  assert.ok(page.includes('aria-label="Tipo: Tutti"'));
  assert.equal((page.match(/data-slot="filter-bar"/g) ?? []).length, 1, "una sola riga di filtri");
  const diffuse = await html("ls", ids.wsA, { vista: "priorita", tipo: "diffondere" });
  assert.equal(viewOf(diffuse), "panoramica");
  assert.ok(diffuse.includes('aria-label="Tipo: Da diffondere"'));
  assert.ok(rowOf(diffuse, cards.bestPractice.id).includes(cards.bestPractice.title), "la best practice nella Panoramica");
  // Il chip «N da stimare» di prima (`tipo=costruire&stima=mancante`) apre la matrice: lì «da stimare» non filtra.
  const toEstimate = await html("ls", ids.wsA, { vista: "priorita", tipo: "costruire", stima: "mancante" });
  assert.ok(toEstimate.includes('data-chart="matrice"'));
  assert.ok(toEstimate.includes(`data-point="${cards.amount.id}"`), "lo use case con importo ha il suo punto");
  assert.ok(!toEstimate.includes("Togli i filtri"));
  // `stima` non passa alle altre viste, e il contatore di «Da decidere» conta come loro.
  const withEstimate = await html("ls", ids.wsA, { vista: "panoramica", stima: "mancante" });
  assert.deepEqual(
    switcherOf(withEstimate).map((segment) => segment.href),
    ["panoramica", "da-decidere", "cosa-serve"].map((view) => `/dashboard/${ids.wsA}/use-cases?vista=${view}`),
  );
  const decideCountOf = (html: string) => /Da decidere<\/span><span class="text-xs text-muted-foreground tabular-nums">(\d+)</.exec(html)?.[1];
  assert.ok(decideCountOf(page));
  assert.equal(decideCountOf(withEstimate), decideCountOf(page));
});

test("vecchi link: ?vista=priorita e ?vista=roadmap aprono la Panoramica con gli altri parametri", opts, async () => {
  for (const person of ["ls", "builder", "manager"] as const) {
    const page = await html(person, ids.wsA, { vista: "roadmap", origine: "adoption", apri: cards.amount.id });
    assert.equal(viewOf(page), "panoramica", person);
    assert.match(page, /<a [^>]*aria-current="page"[^>]*><span>Panoramica<\/span>/, `${person}: «Panoramica» è la vista scelta`);
    assert.ok(page.includes("Togli i filtri"), `${person}: l'origine resta un filtro`);
    const { data } = await hubTree(person, ids.wsA, { vista: "roadmap", origine: "adoption", apri: cards.amount.id });
    assert.equal(data.params.apri, cards.amount.id, `${person}: il pannello resta aperto`);
    assert.equal(data.params.origine, "adoption");
    const chart = await html(person, ids.wsA, { vista: "roadmap", mostra: "matrice" });
    assert.ok(chart.includes('data-chart="matrice"'), person);
    assert.equal(chartHeaderOf(chart).href, `/dashboard/${ids.wsA}/use-cases?vista=panoramica`, person);
  }
  // Il contributore non ha grafici né menu «⋯».
  const contributor = await html("contributor", ids.wsA, { vista: "priorita", mostra: "matrice" });
  assert.equal(viewOf(contributor), "panoramica");
  assert.ok(!contributor.includes('data-slot="chart-header"') && !contributor.includes('data-slot="value-cost-matrix"'));
  assert.ok(!contributor.includes('aria-label="Altre azioni"'), "niente menu «⋯»");
});

test("Panoramica: letture solo dove servono", opts, async () => {
  const lanes = await hubTree("builder", ids.wsA, { vista: "panoramica" });
  assert.equal(lanes.data.chart, null);
  assert.deepEqual(lanes.data.charts, ["matrice"]);
  // Un grafico del menu «⋯» al posto delle corsie: niente card dei dossier.
  const matrix = await hubTree("builder", ids.wsA, { vista: "panoramica", mostra: "matrice" });
  assert.equal(matrix.data.chart, "matrice");
  assert.equal(matrix.data.dossierColumn, null);
  // Il contributore: niente grafici, niente esigenze.
  const contributor = await hubTree("contributor", ids.wsA, { vista: "panoramica" });
  assert.deepEqual(contributor.data.charts, []);
  assert.equal(contributor.data.chart, null);
  assert.equal(contributor.data.needs, null);
  // I sub-responsabili sono un avviso di Lateral Space: il revisore del cliente non li legge.
  assert.equal(lanes.data.subprocessorsPending, false);
});

test("menu «⋯»: i grafici con i filtri di adesso, mai ai contributori", opts, async () => {
  // Con un pannello aperto e «da stimare»: la Panoramica con l'origine di adesso, senza `stima` né
  // `apri`. Nessuna scheda di A ha «Benefici e costi»: solo la matrice.
  for (const person of ["ls", "builder", "manager"] as const) {
    const menu = await menuCharts(person, ids.wsA, { vista: "panoramica", origine: "transformation", stima: "mancante", apri: cards.amount.id });
    assert.ok(menu, person);
    assert.deepEqual(
      menu.charts,
      [{ label: "Matrice Valore × Costo", href: `/dashboard/${ids.wsA}/use-cases?vista=panoramica&mostra=matrice&origine=transformation` }],
      person,
    );
  }
  assert.equal(await menuCharts("contributor", ids.wsA, { vista: "panoramica" }), null, "niente menu «⋯» per il contributore");
  // Nessuno use case da mettere in ordine (D: solo una best practice; E: una scheda chiusa): nessun grafico.
  assert.deepEqual((await menuCharts("ls", ids.wsD, { vista: "panoramica" }))?.charts, []);
  assert.deepEqual((await menuCharts("builder", ids.wsE, { vista: "panoramica" }))?.charts, []);
});

test("grafici del menu «⋯»: tengono i filtri; «Torna alla Panoramica» li tiene, «Togli i filtri» tiene il grafico", opts, async () => {
  const page = await html("ls", ids.wsA, { vista: "panoramica", mostra: "matrice", origine: "adoption" });
  assert.equal(chartHeaderOf(page).href, `/dashboard/${ids.wsA}/use-cases?vista=panoramica&amp;origine=adoption`);
  assert.match(page, new RegExp(`href="/dashboard/${ids.wsA}/use-cases\\?vista=panoramica&amp;mostra=matrice"[^>]*>Togli i filtri<`));
  assert.ok(page.includes('data-slot="value-cost-matrix"'));
  assert.ok(!page.includes('data-slot="lanes"'), "il grafico al posto delle corsie");

  // Nessuna scheda con questi filtri: «Torna alla Panoramica» resta sopra il vuoto.
  const none = await html("ls", ids.wsA, { vista: "priorita", mostra: "matrice", q: "nessuna-corrispondenza" });
  assert.equal(chartHeaderOf(none).title, "Matrice Valore × Costo");
  assert.ok(none.includes("Nessuno use case con questi filtri."));
  assert.ok(none.includes('data-chart="matrice"'));

  // La matrice è solo «Da costruire»: il tipo non filtra, «Tipo» non c'è, e resta nell'indirizzo per il ritorno.
  const diffuse = await html("ls", ids.wsA, { vista: "panoramica", mostra: "matrice", tipo: "diffondere" });
  assert.ok(diffuse.includes(`data-point="${cards.amount.id}"`), "la matrice con i suoi punti");
  assert.ok(!diffuse.includes('aria-label="Tipo:'), "niente «Tipo» sulla matrice");
  assert.ok(chartHeaderOf(diffuse).href.includes("&amp;tipo=diffondere"), chartHeaderOf(diffuse).href);
  assert.ok(!diffuse.includes("Togli i filtri"), "il tipo non è un filtro sulla matrice");

  // I vecchi link: «Da diffondere» con `mostra` e `mostra=lista` aprono le corsie, senza grafico.
  const oldDiffuse = await html("ls", ids.wsA, { vista: "priorita", tipo: "diffondere", mostra: "matrice" });
  assert.equal(viewOf(oldDiffuse), "panoramica");
  assert.ok(!oldDiffuse.includes('data-slot="chart-header"') && !oldDiffuse.includes('data-slot="value-cost-matrix"'));
  const oldList = await html("ls", ids.wsA, { vista: "priorita", mostra: "lista" });
  assert.ok(!oldList.includes('data-slot="chart-header"') && !oldList.includes('data-slot="value-cost-matrix"'));

  // «Torna alla Panoramica» è un contorno: la pagina tiene un solo pulsante pieno, con le corsie e con il grafico.
  assert.equal(filledButtons(await html("ls", ids.wsA, { vista: "panoramica" })), 1, "corsie");
  assert.equal(filledButtons(page), 1, "matrice");
});

/** Il `<details>` con quel `data-slot`: la sua apertura e il contenuto fino alla chiusura. */
function detailsOf(page: string, slot: string): { open: boolean; summary: string; html: string } {
  const at = page.indexOf(`data-slot="${slot}"`);
  assert.ok(at >= 0, slot);
  const start = page.lastIndexOf("<details", at);
  const html = page.slice(start, page.indexOf("</details>", at));
  const opening = html.slice(0, html.indexOf(">") + 1);
  return {
    open: /\sopen\b/.test(opening.replace(/="[^"]*"/g, "")),
    summary: (/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, ""),
    html,
  };
}

test("«da stimare» resta alla matrice: un elenco chiuso sotto, che l'indirizzo apre", opts, async () => {
  // Gli use case da mettere in ordine senza Valore o senza Costo: tutti nell'elenco, con il loro codice.
  const toEstimate = [cards.newIdea, cards.serveInfo, cards.overdue, cards.answered, cards.ownByEmail, cards.ownAsked, cards.othersWithNote, cards.othersHidden];
  const page = await html("ls", ids.wsA, { vista: "panoramica", mostra: "matrice", stima: "mancante" });
  assert.ok(page.includes('data-chart="matrice"'));
  const list = detailsOf(page, "to-estimate");
  assert.equal(list.open, true, "aperto: l'indirizzo lo chiede");
  assert.equal(list.summary, `${toEstimate.length} da stimare`);
  for (const card of toEstimate) {
    assert.ok(list.html.includes(`>${card.code}<`), `${card.title}: nell'elenco`);
    assert.match(list.html, new RegExp(`href="[^"]*apri=${card.id}"`), `${card.title}: il link al pannello`);
  }
  // «da stimare» non filtra: i punti restano, chi ha un punto non è nell'elenco.
  for (const card of [cards.amount, cards.band, cards.toDecideScored]) {
    assert.ok(page.includes(`data-point="${card.id}"`), `${card.title}: il punto`);
    assert.ok(!list.html.includes(`>${card.code}<`), `${card.title}: non da stimare`);
  }
  assert.ok(!page.includes("Togli i filtri"), "non è un filtro");
  assert.ok(!page.includes('data-slot="off-matrix"'), "nessuna scheda con «Benefici e costi»");
  assert.equal(chartHeaderOf(page).href, `/dashboard/${ids.wsA}/use-cases?vista=panoramica`, "il ritorno senza «da stimare»");
  // Senza `stima` l'elenco c'è, chiuso.
  assert.equal(detailsOf(await html("ls", ids.wsA, { vista: "panoramica", mostra: "matrice" }), "to-estimate").open, false);
  // Il vecchio chip di «Priorità» (`tipo=costruire&stima=mancante`): la stessa pagina.
  const legacy = await html("ls", ids.wsA, { vista: "priorita", tipo: "costruire", stima: "mancante" });
  assert.ok(legacy.includes('data-chart="matrice"'));
  assert.equal(legacy, page);
});

test("«Tipo» sui grafici: le due matrici sono «Da costruire» e non lo hanno; la Panoramica sì", opts, async () => {
  for (const mostra of ["matrice", "benefici"] as const) {
    // In A nessuno ha «Benefici e costi»: anche le bolle aprono la matrice.
    const page = await html("ls", ids.wsA, { vista: "panoramica", mostra });
    assert.ok(page.includes('data-chart="matrice"'), mostra);
    assert.ok(!page.includes('aria-label="Tipo:'), `${mostra}: niente «Tipo»`);
    // `tipo=diffondere` non svuota la matrice e resta nel ritorno.
    const diffuse = await html("ls", ids.wsA, { vista: "panoramica", mostra, tipo: "diffondere" });
    assert.ok(diffuse.includes(`data-point="${cards.amount.id}"`) && diffuse.includes('data-slot="to-estimate"'), mostra);
    assert.ok(chartHeaderOf(diffuse).href.includes("&amp;tipo=diffondere"), chartHeaderOf(diffuse).href);
    assert.ok(!diffuse.includes("Nessuno use case"), mostra);
  }
  assert.ok((await html("ls", ids.wsA, { vista: "panoramica" })).includes('aria-label="Tipo: Tutti"'), "la Panoramica");
});

test("niente si perde senza la lista di «Priorità»: nel pannello «Quando», «Approva» e «Segna come diffusa»", opts, async () => {
  const approved = await panelOf("ls", ids.wsA, { vista: "panoramica", apri: cards.amount.id });
  assert.match(approved, /role="radiogroup"[^>]*data-slot="when-control"|data-slot="when-control"[^>]*role="radiogroup"/, "il controllo segmentato");
  const toDecide = await panelOf("ls", ids.wsA, { vista: "panoramica", apri: cards.toDecideScored.id });
  assert.ok(toDecide.includes("Approva"));
  const best = await panelOf("ls", ids.wsA, { vista: "panoramica", apri: cards.bestPractice.id });
  assert.ok(best.includes("Segna come diffusa"), "la best practice approvata si segna diffusa dal pannello");
});

test("filtri: origine, tipo e «Altri filtri» ai revisori; senza risultati «Nessuno use case con questi filtri.»", opts, async () => {
  const page = await html("ls", ids.wsA, { vista: "da-decidere" });
  for (const text of ["Tutte", "AI Adoption", "AI Transformation", "Cerca per titolo o codice", "Altri filtri", ">Tipo:<"]) {
    assert.ok(page.includes(text), text);
  }
  const transformation = await html("ls", ids.wsA, { vista: "panoramica", origine: "transformation" });
  assert.ok(transformation.includes(`data-id="${cards.band.id}"`));
  assert.ok(!transformation.includes(`data-id="${cards.amount.id}"`));
  assert.ok(transformation.includes("Togli i filtri"));
  // Con un filtro le fasi e le cifre seguono il filtro; «Su tutto il portafoglio» e «Prossimo passo»
  // dicono tutto il workspace e non ci sono: il pulsante pieno torna «Nuovo use case».
  assert.ok(transformation.includes('data-slot="phase-strip"') && transformation.includes('data-slot="overview-figures"'));
  assert.ok(!transformation.includes('data-slot="next-step"') && !transformation.includes('data-slot="portfolio-line"'));
  assert.equal(filledButtons(transformation), 1);
  assert.match(newUseCaseTag(transformation), /class="[^"]*\bbg-primary\b/);
  // Nessuno use case con questi filtri: niente testa, solo il vuoto delle corsie.
  const nothing = await html("ls", ids.wsA, { vista: "panoramica", q: "nessuna-corrispondenza" });
  assert.ok(nothing.includes("Nessuno use case con questi filtri.") && !nothing.includes('data-slot="panoramica-top"'));
  const none = await html("ls", ids.wsA, { vista: "da-decidere", q: "nessuna-corrispondenza" });
  assert.ok(none.includes("Nessuno use case con questi filtri."));
  assert.match(none, /href="\/dashboard\/[^"]+\/use-cases\?vista=da-decidere"[^>]*>Togli i filtri</);
  // «Altri filtri»: un valore dell'indirizzo che nessuno use case ha resta scelto con il suo testo, mai la chiave.
  const shared = await hubTree("ls", ids.wsA, { vista: "panoramica", canale: "team_mcp", trimestre: "2031-Q2" });
  const [more] = findProp(shared.tree, "more") as Array<{ channels: Array<{ value: string; label: string }>; quarters: Array<{ value: string; label: string }> }>;
  assert.deepEqual(
    more.channels.find((option) => option.value === "team_mcp"),
    { value: "team_mcp", label: "MCP del team" },
  );
  assert.deepEqual(
    more.quarters.find((option) => option.value === "2031-Q2"),
    { value: "2031-Q2", label: "T2 2031" },
  );
  // Nessun filtro per persona, nemmeno scritto a mano nell'URL (art. 15.4).
  const plain = await html("ls", ids.wsA, { vista: "da-decidere" });
  const forged = await html("ls", ids.wsA, { vista: "da-decidere", proponente: emails.contributor, proposedBy: ids.contributor, autore: "x", persona: "y" });
  assert.equal(forged, plain);
});

// ─── «Agente» (rilascio «Panoramica») ─────────────────────────────────

test("filtro «Agente»: il prefisso del titolo, solo ai revisori", opts, async () => {
  const all = Object.values(agentCards);
  /** Le schede del workspace P a schermo, nell'ordine di `agentCards`. */
  const shown = (page: string) => all.filter((card) => page.includes(`data-id="${card.id}"`)).map((card) => card.title);
  const libra = await html("ls", ids.wsP, { vista: "panoramica", agente: "LIBRA" });
  assert.equal(viewOf(libra), "panoramica");
  assert.deepEqual(shown(libra), [agentCards.libraL1.title, agentCards.libraL2.title]);
  assert.ok(libra.includes("Togli i filtri"));
  const others = await html("ls", ids.wsP, { vista: "panoramica", agente: "altri" });
  assert.deepEqual(shown(others), [agentCards.plain.title], "«Altri use case»: i titoli senza prefisso");
  // Le voci di «Agente», da tutte le schede del workspace (anche quelle da decidere), «Altri use case» in fondo.
  const { tree } = await hubTree("ls", ids.wsP, { vista: "panoramica", agente: "LIBRA" });
  const [more] = findProp(tree, "more") as Array<{ agents: Array<{ value: string; label: string }> }>;
  assert.deepEqual(
    more.agents.map((option) => option.value),
    ["AUTO", "DENEB", "LIBRA", "MAIA", "ORSA", "SIRIO", "SPICA", "altri"],
  );
  assert.equal(more.agents.at(-1)?.label, "Altri use case");
  // Il filtro passa alle altre viste con il selettore, come l'area, e restringe «Da decidere».
  const segments = switcherOf(libra);
  assert.ok(segments.every((segment) => segment.href.includes("agente=LIBRA")), JSON.stringify(segments));
  assert.deepEqual(shown(await html("ls", ids.wsP, { vista: "da-decidere", agente: "SPICA" })), [agentCards.spicaP1.title]);
  assert.deepEqual(shown(await html("ls", ids.wsP, { vista: "da-decidere", agente: "LIBRA" })), []);
  // Senza prefissi nei titoli il campo non c'è.
  const [moreA] = findProp((await hubTree("ls", ids.wsA, { vista: "panoramica" })).tree, "more") as Array<{ agents: unknown[] }>;
  assert.deepEqual(moreA.agents, []);
  // Il contributore: nessun «Agente», il filtro dell'indirizzo non vale.
  const contributor = await html("contributor", ids.wsP, { vista: "panoramica", agente: "LIBRA" });
  for (const card of [agentCards.libraL1, agentCards.libraL2, agentCards.autoH1, agentCards.orsaO1, agentCards.plain]) {
    assert.ok(contributor.includes(`data-id="${card.id}"`), card.title);
  }
  assert.ok(!contributor.includes("Agente") && !contributor.includes("Togli i filtri"));
  const forContributor = await hubTree("contributor", ids.wsP, { vista: "panoramica", agente: "LIBRA" });
  assert.equal(forContributor.data.params.agente, null);
  assert.deepEqual(findProp(forContributor.tree, "more"), [undefined]);
});

test("Panoramica: tag degli agenti, corsie e barre", opts, async () => {
  const page = await html("ls", ids.wsP, { vista: "panoramica" });
  const toneOf = (card: string) => /data-slot="agent-tag" data-tone="([^"]+)"/.exec(card)?.[1];
  const widthOf = (card: string) => /data-slot="value-bar"[^>]*><span[^>]*style="width:([^"]+)"/.exec(card)?.[1];
  const l1 = rowOf(page, agentCards.libraL1.id);
  const l2 = rowOf(page, agentCards.libraL2.id);
  const orsa = rowOf(page, agentCards.orsaO1.id);
  // Lo stesso agente, lo stesso colore; un altro agente un altro.
  assert.match(l1, /data-agent="LIBRA"/);
  assert.match(l2, /data-agent="LIBRA"/);
  assert.ok(toneOf(l1) && toneOf(l1) !== "neutro" && toneOf(l1) === toneOf(l2), `${toneOf(l1)} ${toneOf(l2)}`);
  assert.notEqual(toneOf(orsa), toneOf(l1));
  assert.ok(!rowOf(page, agentCards.plain.id).includes("agent-tag"), "senza prefisso niente tag");
  // «Questo trimestre»: lo scaduto ORSA in cima, poi LIBRA L1 con gli euro, poi la best practice DENEB senza.
  const lane = page.slice(page.indexOf('data-slot="lane" data-lane="questo_trimestre"'), page.indexOf('data-slot="lane" data-lane="prossimo_trimestre"'));
  assert.deepEqual(
    [...lane.matchAll(/data-slot="lane-card" data-id="([^"]+)"/g)].map((match) => match[1]),
    [agentCards.orsaO1.id, agentCards.libraL1.id, agentCards.denebD1.id],
  );
  // Le barre sulla scala del più grande degli approvati (12.250 €): 5.000 € e 3.000 €.
  assert.deepEqual([widthOf(l1), widthOf(l2), widthOf(orsa)], ["100.0%", "40.8%", "24.5%"]);
  // Il titolo senza il prefisso, che resta per i lettori di schermo; il tag è nascosto a loro.
  assert.ok(l1.includes(`<span class="sr-only">LIBRA L1 · </span>Lettura delle fatture estere ${suffix}`), l1);
  assert.match(l1, /data-slot="agent-tag" data-tone="[^"]+" aria-hidden="true"/);
  // Un filtro non cambia né la scala né i colori.
  for (const filter of [{ origine: "adoption" }, { agente: "LIBRA" }] as Array<Record<string, string>>) {
    const filtered = await html("ls", ids.wsP, { vista: "panoramica", ...filter });
    assert.equal(widthOf(rowOf(filtered, agentCards.libraL2.id)), "40.8%", JSON.stringify(filter));
    assert.equal(toneOf(rowOf(filtered, agentCards.libraL1.id)), toneOf(l1), JSON.stringify(filter));
  }
  // Il contributore: gli stessi colori, dal titolo che vede già; nessun euro, nessuna barra.
  const contributor = await html("contributor", ids.wsP, { vista: "panoramica" });
  assert.equal(toneOf(rowOf(contributor, agentCards.libraL1.id)), toneOf(l1));
  assert.equal(toneOf(rowOf(contributor, agentCards.orsaO1.id)), toneOf(orsa));
  assert.ok(!contributor.includes("€") && !contributor.includes('data-slot="value-bar"') && !contributor.includes("data-figure"));
});

test("Panoramica «Per agente»: una card per agente, poi le corsie del solo agente; solo ai revisori, con gli agenti nel titolo", opts, async () => {
  /** I segmenti di «Per trimestre | Per agente»: etichetta, link e se è quello scelto. */
  const groupingOf = (page: string) => {
    const start = page.indexOf('data-slot="plan-grouping"');
    assert.ok(start >= 0, "«Per trimestre | Per agente»");
    return [...page.slice(start, page.indexOf("</nav>", start)).matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
      label: /<span>([^<]*)<\/span>/.exec(inner)?.[1] ?? "",
      href: /href="([^"]*)"/.exec(attrs)?.[1] ?? "",
      current: attrs.includes('aria-current="page"'),
    }));
  };
  const base = `/dashboard/${ids.wsP}/use-cases`;
  const grid = await html("ls", ids.wsP, { vista: "panoramica", mostra: "agenti", origine: "adoption" });
  assert.ok(grid.includes('data-slot="agent-grid"') && !grid.includes('data-slot="lanes"'));
  assert.match(grid, /aria-label="Use case per agente" data-slot="panorama-plan"/);
  // Chi ha più euro contati in testa, poi più use case, poi il nome; «Altri use case» in fondo.
  assert.deepEqual(
    [...grid.matchAll(/data-slot="agent-card" data-agent="([^"]+)"/g)].map((match) => match[1]),
    ["LIBRA", "ORSA", "AUTO", "DENEB", "altri"],
  );
  assert.deepEqual(
    groupingOf(grid).map((segment) => [segment.label, segment.current]),
    [
      ["Per trimestre", false],
      ["Per agente", true],
    ],
  );
  const libraCard = grid.slice(grid.indexOf('data-agent="LIBRA"'), grid.indexOf("</li>", grid.indexOf('data-agent="LIBRA"')));
  assert.equal(/<a [^>]*href="([^"]*)"/.exec(libraCard)?.[1], `${base}?vista=panoramica&amp;origine=adoption&amp;agente=LIBRA#panoramica-approvati`);
  assert.equal(filledButtons(grid), 1, "un solo pulsante pieno");

  // Dopo il clic: le corsie del solo LIBRA, con il suo nome per i lettori di schermo.
  const libra = await html("ls", ids.wsP, { vista: "panoramica", agente: "LIBRA", origine: "adoption" });
  assert.match(libra, /<section id="panoramica-approvati" tabindex="-1" aria-label="Use case di LIBRA per trimestre" data-slot="panorama-plan"/);
  assert.deepEqual(
    Object.values(agentCards)
      .filter((card) => libra.includes(`data-id="${card.id}"`))
      .map((card) => card.id),
    [agentCards.libraL1.id, agentCards.libraL2.id],
  );
  // «Per trimestre» tiene ogni filtro; «Per agente» toglie solo l'agente.
  const [byQuarter, byAgent] = groupingOf(libra);
  assert.deepEqual([byQuarter.current, byAgent.current], [true, false]);
  assert.equal(byQuarter.href, `${base}?vista=panoramica&amp;origine=adoption&amp;agente=LIBRA`);
  assert.equal(byAgent.href, `${base}?vista=panoramica&amp;mostra=agenti&amp;origine=adoption`);
  assert.match(await html("ls", ids.wsP, { vista: "panoramica", agente: "altri" }), /aria-label="Altri use case per trimestre"/);

  // Il contributore non ha la scelta: `mostra` non vale per lui.
  const contributor = await html("contributor", ids.wsP, { vista: "panoramica", mostra: "agenti" });
  assert.ok(!contributor.includes("plan-grouping") && !contributor.includes("agent-grid") && contributor.includes('data-slot="lanes"'));
  // Senza agenti nei titoli niente scelta, e un vecchio `mostra=agenti` mostra le corsie.
  const plain = await html("ls", ids.wsA, { vista: "panoramica", mostra: "agenti" });
  assert.ok(!plain.includes("plan-grouping") && !plain.includes("agent-grid") && plain.includes('data-slot="lanes"'));
});

// ─── Contributori (D4, D13) ──────────────────────────────────────────

test("contributore: titolo, fase e «Quando»; solo «Cerca per titolo»; codice delle sole proprie; nessun numero", opts, async () => {
  for (const vista of ["da-decidere", "panoramica"]) {
    const page = await html("contributor", ids.wsA, { vista });
    assert.ok(!page.includes("€"), `${vista}: «€»`);
    assert.ok(!page.includes("data-figure"), `${vista}: [data-figure]`);
    assert.ok(!page.includes('data-slot="value-bar"'), `${vista}: barre del valore`);
    assert.ok(page.includes('placeholder="Cerca per titolo"'), vista);
    for (const text of ["Cerca per titolo o codice", "Altri filtri", "AI Adoption", "AI Transformation", ">Tipo:<", "Priorità", "Cosa serve", "Requisiti", cards.othersHidden.title]) {
      assert.ok(!page.includes(text), `${vista}: «${text}»`);
    }
    for (const card of [cards.newIdea, cards.amount, cards.band, cards.othersWithNote]) assert.ok(!page.includes(card.code), `${vista}: codice altrui ${card.code}`);
  }
  const decide = await html("contributor", ids.wsA, { vista: "da-decidere" });
  assert.ok(decide.includes(cards.ownByEmail.code), "codice della propria proposta");
  assert.ok(decide.includes(cards.othersWithNote.title));
  assert.ok(!decide.includes(OTHER_NOTE) && !decide.includes(OWN_NOTE) && !decide.includes(OWN_QUESTION), "le note si leggono nel pannello");
  // «In valutazione» dice già la fase: le righe altrui senza pillola, le proprie con fase e sotto-stato.
  assert.ok(!rowOf(decide, cards.othersWithNote.id).includes('data-slot="phase-pill"'), "niente «Da valutare» ripetuto");
  assert.ok(rowOf(decide, cards.ownByEmail.id).includes('data-slot="phase-pill"'));
  assert.ok(rowOf(decide, cards.ownAsked.id).includes("Da valutare · Serve info") && rowOf(decide, cards.ownAsked.id).includes("Rispondi"));
  // Sopra la lista un avviso per ogni propria proposta in «Serve info», con «Rispondi» al pannello.
  const noticeAt = decide.indexOf('data-slot="answer-notice"');
  assert.ok(noticeAt > 0 && noticeAt < decide.indexOf('data-slot="use-case-row"'), "l'avviso sta sopra la lista");
  const notice = decide.slice(noticeAt, decide.indexOf("</ul>", noticeAt));
  assert.ok(notice.includes(`${askedTitle(DEFAULT_REVIEW_TEAM_NAME)}:`) && notice.includes(cards.ownAsked.code) && notice.includes(cards.ownAsked.title));
  assert.match(notice, new RegExp(`href="[^"]*apri=${cards.ownAsked.id}"[^>]*>Rispondi`));
  assert.ok(!notice.includes(cards.ownByEmail.code), "solo le proprie in «Serve info»");
  // L'ordine della lista resta quello del server (art. 15.4): l'avviso non sposta le righe, e le
  // proprie proposte non vanno in cima (nessun ordine per proponente, §4.7).
  const order = [...decide.matchAll(/data-slot="use-case-row" data-id="([^"]+)"/g)].map((m) => m[1]);
  const listed = await hub.loadUseCaseHub({
    workspaceId: ids.wsA,
    session: { user: { id: ids.contributor, email: emails.contributor, emailVerified: true, name: "Persona contributor", image: null } },
    access: (await access.getWorkspaceAccessForUser(ids.contributor, ids.wsA))!,
    searchParams: { vista: "da-decidere" },
  });
  assert.deepEqual(order, listed!.list.items.filter((item) => item.phase === "da_valutare").map((item) => item.id));
  // Ai revisori niente avviso.
  assert.ok(!(await html("ls", ids.wsA, { vista: "da-decidere" })).includes('data-slot="answer-notice"'));
  const overview = await html("contributor", ids.wsA, { vista: "panoramica" });
  assert.ok(overview.includes(cards.amount.title) && overview.includes("Approvato · T"));
  // In testa solo le fasi: «In valutazione» senza numero; né cifre, né riga, né «Prossimo passo».
  const strip = sectionOf(overview, "phase-strip");
  const evaluating = strip.slice(strip.indexOf('data-step="da_decidere"'), strip.indexOf("</li>", strip.indexOf('data-step="da_decidere"')));
  assert.ok(evaluating.includes(">In valutazione<"), evaluating);
  assert.ok(!evaluating.includes("tabular-nums") && !evaluating.includes("—"), "nessun numero su «In valutazione»");
  for (const text of ['data-slot="overview-figures"', 'data-slot="next-step"', 'data-slot="portfolio-line"', "costo di avvio", "Su tutto il portafoglio", "Prossimo passo"]) {
    assert.ok(!overview.includes(text), `contributore: «${text}»`);
  }
  assert.equal(filledButtons(overview), 1, "il pulsante pieno resta «Nuovo use case»");
  // La ricerca del contributore: il codice di una proposta altrui non trova nulla.
  assert.ok((await html("contributor", ids.wsA, { vista: "panoramica", q: cards.amount.code })).includes("Nessuno use case con questi filtri."));
  assert.ok((await html("contributor", ids.wsA, { vista: "da-decidere", q: cards.ownByEmail.code })).includes(cards.ownByEmail.title));
});

test("Panoramica: gli scaduti in cima a «Questo trimestre» con «Scaduto» ai revisori", opts, async () => {
  const reviewer = await html("builder", ids.wsA, { vista: "panoramica" });
  const overdue = rowOf(reviewer, cards.overdue.id);
  assert.match(overdue, /data-lane="questo_trimestre"/);
  const lane = reviewer.slice(reviewer.indexOf('data-slot="lane" data-lane="questo_trimestre"'));
  assert.equal(/data-slot="lane-card" data-id="([^"]+)"/.exec(lane)?.[1], cards.overdue.id, "il primo della corsia");
  // Il tema dell'app è scuro senza la classe `.dark`: il rosso è quello che si legge lì (H4p).
  assert.ok(overdue.includes(">Scaduto<") && overdue.includes("text-red-300"), overdue);
  assert.ok(overdue.includes(">T1 2020<"), "il trimestre passato accanto a «Scaduto»");
  assert.ok(!reviewer.includes(">Scaduti<"), "nessun gruppo «Scaduti»");
  // Al contributore niente tag, niente rosso e niente trimestre a parte: lo dice la sua pillola, nessun giudizio sul team.
  const contributor = await html("contributor", ids.wsA, { vista: "panoramica" });
  const card = rowOf(contributor, cards.overdue.id);
  assert.ok(card.includes(cards.overdue.title));
  assert.ok(!contributor.includes(">Scaduto<"), "niente tag «Scaduto» al contributore");
  assert.ok(!contributor.includes("text-red-300"), "niente rosso al contributore");
  assert.ok(!card.includes(">T1 2020<"), "niente trimestre a parte");
  assert.ok(card.includes(">Approvato · T1 2020<"), "la pillola della fase");
});

// ─── Parte dossier non disponibile (§4.9) ────────────────────────────

test("parte dossier non disponibile: «In realizzazione» mostra solo fase e titolo, mai «Senza dossier»", opts, async () => {
  // Sezione Casi d'uso spenta: nessun dossier, e «Senza dossier» è vero.
  const off = await html("ls", ids.wsA, { vista: "panoramica" });
  assert.ok(rowOf(off, cards.building.id).includes("In realizzazione · Senza dossier"));
  const flags = globalThis as { __hubH4aDossierError?: boolean };
  flags.__hubH4aDossierError = true;
  try {
    for (const person of ["ls", "manager", "contributor"] as const) {
      const page = await html(person, ids.wsA, { vista: "panoramica" });
      const card = rowOf(page, cards.building.id);
      assert.ok(card.includes(cards.building.title), person);
      assert.ok(card.includes(">In realizzazione<"), `${person}: ${card}`);
      assert.ok(!page.includes("Senza dossier"), `${person}: niente «Senza dossier»`);
    }
    // Il pannello riceve lo stesso ripiego.
    for (const person of ["builder", "contributor"] as const) {
      const { tree } = await hubTree(person, ids.wsA, { vista: "panoramica", apri: cards.building.id });
      assert.deepEqual(findProp(tree, "dossierDown"), [true, true], `${person}: Panoramica e pannello`);
    }
  } finally {
    delete flags.__hubH4aDossierError;
  }
});

// ─── Pannelli ────────────────────────────────────────────────────────

test("pannello laterale: il contributore vede codice e nota pubblica delle sole proprie; i revisori tutto, senza proponente", opts, async () => {
  const own = await hubTree("contributor", ids.wsA, { vista: "da-decidere", apri: cards.ownByEmail.id });
  const ownPanel = findProp(own.tree, "data").find((value) => (value as { projection?: string })?.projection) as { projection: string; item: Record<string, unknown> };
  assert.equal(ownPanel.projection, "contributore");
  assert.deepEqual(Object.keys(ownPanel.item).sort(), OWN_KEYS);
  assert.equal(ownPanel.item.code, cards.ownByEmail.code);
  assert.equal(ownPanel.item.publicNote, OWN_NOTE);
  assert.deepEqual(own.data.panelEstimate, [], "i dati raccolti non si leggono per il contributore");

  const other = await hubTree("contributor", ids.wsA, { vista: "da-decidere", apri: cards.othersWithNote.id });
  const otherPanel = findProp(other.tree, "data").find((value) => (value as { projection?: string })?.projection) as { projection: string; item: Record<string, unknown> };
  assert.deepEqual(Object.keys(otherPanel.item).sort(), CONTRIBUTOR_KEYS);
  assert.ok(!JSON.stringify(otherPanel).includes(OTHER_NOTE));

  // Una scheda nascosta altrui non si apre per il contributore.
  const hidden = await hubTree("contributor", ids.wsA, { apri: cards.othersHidden.id });
  assert.equal(findProp(hidden.tree, "data").filter((value) => (value as { projection?: string })?.projection).length, 0);

  const reviewer = await hubTree("builder", ids.wsA, { vista: "da-decidere", apri: cards.amount.id });
  const panel = findProp(reviewer.tree, "data").find((value) => (value as { projection?: string })?.projection) as {
    projection: string;
    item: { cost: { source: string; bandLabel: string }; code: string };
    candidates: Array<Record<string, unknown>>;
    estimate: string[];
  };
  assert.equal(panel.projection, "revisore");
  assert.equal(panel.item.code, cards.amount.code);
  assert.equal(panel.item.cost.source, "team_importo");
  assert.equal(panel.item.cost.bandLabel, "Medio");
  assert.ok(panel.candidates.length > 0);
  for (const candidate of panel.candidates) assert.deepEqual(Object.keys(candidate).sort(), ["code", "id", "title"]);
  assert.deepEqual(panel.estimate, [], "senza dati raccolti niente «Stima di Claude»");
  assert.deepEqual((panel as unknown as { answers: unknown[] }).answers, [], "senza risposte niente risposte");
  // D17: una risposta ricevuta riporta lo use case in «Da decidere» con «Nuova»: il pannello dei
  // revisori ha la domanda del team (la nota pubblica) e le risposte, che decidono qui.
  for (const person of ["ls", "builder"] as const) {
    const answered = await hubTree(person, ids.wsA, { vista: "da-decidere", apri: cards.answered.id });
    const answeredPanel = findProp(answered.tree, "data").find((value) => (value as { projection?: string })?.projection) as {
      item: { publicNote: string | null; subState: string; phase: string };
      answers: Array<{ at: string; text: string }>;
    };
    assert.equal(answeredPanel.item.publicNote, TEAM_QUESTION, person);
    assert.deepEqual([answeredPanel.item.phase, answeredPanel.item.subState], ["da_valutare", "nuova"], person);
    assert.deepEqual(answeredPanel.answers.map((answer) => answer.text), ["Prima risposta di prova.", TEAM_ANSWER], person);
  }
  // Il contributore non riceve le risposte di altri, nemmeno aprendo la scheda.
  const notMine = await hubTree("contributor", ids.wsA, { vista: "da-decidere", apri: cards.answered.id });
  assert.deepEqual(notMine.data.panelAnswers, []);
  assert.equal(notMine.data.panelOwnAnswer, null);
  assert.ok(!JSON.stringify(findProp(notMine.tree, "data")).includes(TEAM_ANSWER));
  // «Stima di Claude, non ufficiale» (§7.5): ore con il conto, euro e stima di chi ha proposto.
  for (const person of ["ls", "manager"] as const) {
    const collected = await hubTree(person, ids.wsA, { vista: "da-decidere", apri: cards.toDecideScored.id });
    const collectedPanel = findProp(collected.tree, "data").find((value) => (value as { projection?: string })?.projection) as { estimate: string[] };
    assert.deepEqual(
      collectedPanel.estimate,
      [
        "Circa 100 ore all'anno (30 minuti × 48 volte × 4 persone).",
        "Circa 4.800 € all'anno, secondo chi ha proposto.",
        "Secondo chi ha proposto: efficienza 4 su 5, impegno 2 su 5, nessun rischio particolare.",
      ],
      person,
    );
  }
  assert.doesNotMatch(JSON.stringify(panel), /proposed_?by|submitter_?email|submitted_?by_?user_?id/i);
});

test("pannello rapido: solo per Lateral Space, con le voci di «AI Lab»", opts, async () => {
  const ls = await hubTree("ls", ids.wsA, { nuovo: "1" });
  assert.ok(ls.data.quickCreate, "Lateral Space: pannello rapido");
  assert.equal(findProp(ls.tree, "aiLabs").length, 1);
  for (const person of ["builder", "manager", "contributor"] as const) {
    const other = await hubTree(person, ids.wsA, { nuovo: "1" });
    assert.equal(other.data.quickCreate, null, person);
    assert.equal(findProp(other.tree, "aiLabs").length, 0, person);
  }
});

// ─── Vuoti (§4.3-4.5, §4.9) ──────────────────────────────────────────

test("vuoti: nessuno use case, niente da decidere, niente da mettere in ordine, Panoramica vuota", opts, async () => {
  const zReviewer = await html("ls", ids.wsZ);
  assert.ok(zReviewer.includes("Nessuno use case, per ora"));
  assert.ok(zReviewer.includes("Aggiungine uno o proponili da Activity mapping."));
  assert.equal(filledButtons(zReviewer), 1, "un solo pulsante pieno anche nel vuoto");
  assert.ok(!zReviewer.includes('data-slot="panoramica-top"'), "nessuna testa senza use case");
  const zContributor = await html("contributor", ids.wsZ);
  assert.ok(zContributor.includes("Proponi il primo use case.") && !zContributor.includes('data-slot="panoramica-top"'));

  const eDecide = await html("ls", ids.wsE, { vista: "da-decidere" });
  assert.ok(eDecide.includes("Niente da decidere") && eDecide.includes("Le nuove proposte arrivano qui.") && eDecide.includes("Vai alla Panoramica"));
  assert.match(eDecide, new RegExp(`href="/dashboard/${ids.wsE}/use-cases\\?vista=panoramica"[^>]*>Vai alla Panoramica<`));
  const eContributor = await html("contributor", ids.wsE, { vista: "da-decidere" });
  // H4p: per i contributori «In valutazione».
  assert.ok(eContributor.includes("Nessuno use case in valutazione") && !eContributor.includes("Vai alla Panoramica"));
  // Nessuno use case approvato, in realizzazione o realizzato: le corsie dicono il loro vuoto.
  const eOverview = await html("ls", ids.wsE, { vista: "panoramica" });
  assert.ok(eOverview.includes("Niente in programma, per ora") && eOverview.includes("Approva uno use case e scegli quando farlo."));
  const eMatrix = await html("ls", ids.wsE, { vista: "panoramica", mostra: "matrice" });
  assert.ok(eMatrix.includes("Nessuno use case da mettere in ordine"));
  // «Da diffondere» di prima è il filtro della Panoramica: senza best practice, nessun risultato.
  assert.ok((await html("ls", ids.wsE, { vista: "priorita", tipo: "diffondere" })).includes("Nessuno use case con questi filtri."));
  // D: solo una best practice approvata, nessuna da costruire con Valore e Costo.
  assert.ok((await html("ls", ids.wsD, { vista: "panoramica", mostra: "matrice" })).includes("Nessuno use case da mettere in ordine"));
});
