import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
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

// D4 subito ovunque (docs/use-case/PIANO-LAVORI.md H2e e §5.4; docs/use-case/DESIGN.md §11,
// §12.1, §12.5 criterio 4; decisioni D4, D13, D14): nelle pagine di oggi, nel link di
// condivisione, in campanella e in Intelligence chi non valuta non vede numeri, note,
// proponente, codici e note pubbliche altrui, né schede nascoste altrui. Delle proprie
// proposte vede codice e nota pubblica. Per i revisori le pagine di oggi non cambiano.
//
// Due modi:
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del
//   pacchetto hub_<id> su 127.0.0.1): le query dei segnali per ruolo, e le pagine vere
//   rese in questo processo con la sessione scelta dalla prova (`@/lib/auth` diventa un
//   modulo che la restituisce; ruolo e accesso si rileggono dal database). I file `.tsx`
//   si traducono qui con TypeScript, solo per questa prova. Il link di condivisione si
//   prova con un token vero: il segreto vive solo in questo processo.
// - Sul harness (HUB_D4_HARNESS=1, app e login dell'hub avviati sul database del
//   pacchetto, fixture di scripts/uc-test/seed-fixtures.mjs): `fetch` dell'HTML con la
//   sessione di `osservatore` e senza sessione, nel workspace «b», che ha l'area spenta.
//   L'app del harness non ha un segreto per i link di condivisione: lì il link senza
//   sessione risponde «Link non più valido», e la vista ridotta la prova il primo modo.
// Dentro `npm run check` si salta: in testa solo moduli di Node; i moduli dell'app
// arrivano con `await import()` dentro `before()`. Dati sintetici, creati e cancellati qui.
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

// ─── Cosa non deve mai arrivare a chi non valuta ─────────────────────

const suffix = randomBytes(3).toString("hex");
const SCORE_LABELS = ["Impatto", "Fattibilità", "Score", "Impact", "Feasibility"] as const;
const marks = {
  internalNote: `NOTA-INTERNA-${suffix}`,
  othersPublicNote: `NOTA-PUBBLICA-ALTRUI-${suffix}`,
  ownPublicNote: `NOTA-PUBBLICA-MIA-${suffix}`,
  description: `PROBLEMA-DESCRITTO-${suffix}`,
  businessCase: `CASO-ECONOMICO-${suffix}`,
  hiddenTitle: `Scheda nascosta altrui ${suffix}`,
  caseSignal: `SEGNALE-SCHEDA-${suffix}`,
  digestSignal: `RIEPILOGO-${suffix}`,
  quarterSignal: `TRIMESTRE-${suffix}`,
  riskSignal: `RISCHIO-${suffix}`,
  opportunitySignal: `OPPORTUNITA-${suffix}`,
};

/** Codici sintetici, unici per questa esecuzione (CHECK `^[A-Z]{2,4}-[0-9]{4,5}$`). */
const codeBase = 10_000 + Math.floor(Math.random() * 80_000);
const codes = {
  scored: `XX-${codeBase}`,
  approved: `XX-${codeBase + 1}`,
  hidden: `XX-${codeBase + 2}`,
  ownByEmail: `XX-${codeBase + 3}`,
  ownHidden: `XX-${codeBase + 4}`,
  generated: `XX-${codeBase + 5}`,
};

/**
 * I numeri seminati in ogni scheda: distinti, così una ricerca di testo li trova in ogni
 * forma in cui una pagina potrebbe mostrarli.
 */
const FIGURES = { impact: 4.37, feasibility: 2.91, overall: 3.64, costOnce: 41_234, valueYear: 98_765 } as const;
const SCORES = [FIGURES.impact, FIGURES.feasibility, FIGURES.overall];
const EUROS = [FIGURES.costOnce, FIGURES.valueYear];

/** `4.37` come numero a sé, col punto o con la virgola (non dentro `14.375`). */
const decimalPattern = (text: string) => new RegExp(`(?<![\\d.,])${text.replace(".", "[.,]")}(?!\\d)`);
/** Grezzi o con la virgola, in tutta la pagina: anche in attributi e dati passati al client. */
const RAW_FIGURES = [
  ...SCORES.map((n) => ({ label: String(n), re: decimalPattern(n.toFixed(2)) })),
  // `41234`, `41.234`, `41 234`: mai dentro un hash esadecimale o un numero più lungo.
  ...EUROS.map((n) => {
    const [thousands, units] = [String(Math.floor(n / 1000)), String(n % 1000).padStart(3, "0")];
    return { label: String(n), re: new RegExp(`(?<![\\da-z])${thousands}[.\\s\\u00a0\\u202f]?${units}(?![\\da-z])`, "i") };
  }),
];
/** Arrotondati a una cifra (`4.4`, `2,9`), solo nel testo che si legge: icone e classi ne sono piene. */
const ROUNDED_FIGURES = SCORES.map((n) => ({ label: n.toFixed(1), re: decimalPattern(n.toFixed(1)) }));

/** Il testo che si legge: senza script, stili e icone, più title, aria-label, alt e placeholder. */
function readableText(html: string): string {
  const attributes = [...html.matchAll(/\s(?:title|aria-label|alt|placeholder)="([^"]*)"/g)].map((match) => match[1]);
  const text = html.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  return `${text} ${attributes.join(" ")}`;
}

/** I numeri seminati che la pagina mostra, in qualunque forma. */
function figuresIn(html: string): string[] {
  const text = readableText(html);
  return [...RAW_FIGURES.filter(({ re }) => re.test(html)), ...ROUNDED_FIGURES.filter(({ re }) => re.test(text))].map(({ label }) => label);
}

interface HtmlChecks {
  /** Testi che devono esserci. */
  has?: readonly string[];
  /** Testi che non devono esserci, oltre a cifre, etichette dei punteggi, export e note. */
  lacks?: readonly string[];
}

/** Nessun numero di valutazione, nessuna nota, nessun export: D4 sulla pagina intera. */
function assertReduced(html: string, where: string, checks: HtmlChecks = {}) {
  assert.ok(!html.includes("€"), `${where}: «€»`);
  assert.deepEqual(figuresIn(html), [], `${where}: numeri della valutazione`);
  for (const label of SCORE_LABELS) assert.ok(!html.includes(label), `${where}: «${label}»`);
  assert.ok(!html.includes("Export Excel"), `${where}: «Export Excel»`);
  for (const text of [marks.internalNote, marks.othersPublicNote, marks.description, marks.businessCase, marks.hiddenTitle, codes.hidden]) {
    assert.ok(!html.includes(text), `${where}: «${text}»`);
  }
  for (const text of checks.has ?? []) assert.ok(html.includes(text), `${where}: manca «${text}»`);
  for (const text of checks.lacks ?? []) assert.ok(!html.includes(text), `${where}: «${text}»`);
}

// ═══ Primo modo: database del pacchetto e pagine rese in questo processo ═══

type Signals = typeof import("../db/queries/signals.ts");
type PageProps = { params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string>> };
type Page = (props: PageProps) => Promise<unknown>;
type Topbar = (props: { workspaceId: string; role: string | null; showNotifications?: boolean }) => Promise<unknown>;

let signals: Signals;
let renderToStaticMarkup: (element: unknown) => string;
let pages: Record<"portfolio" | "review" | "useCases" | "useCase" | "plan" | "intelligence" | "share", Page>;
let workspaceTopbar: Topbar;
let createShareToken: (workspaceId: string) => string;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  other: randomUUID(),
  lead: randomUUID(),
  builder: randomUUID(),
  manager: randomUUID(),
  analyst: randomUUID(),
  contributor: randomUUID(),
  learner: randomUUID(),
  outsider: randomUUID(),
};
const emails = {
  lead: `lead.${suffix}@ls.test`,
  builder: `builder.${suffix}@cliente.test`,
  manager: `manager.${suffix}@cliente.test`,
  analyst: `analyst.${suffix}@cliente.test`,
  contributor: `contributor.${suffix}@cliente.test`,
  learner: `learner.${suffix}@cliente.test`,
  outsider: `outsider.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;
const roles: Record<Person, string | null> = {
  lead: "transformation_lead",
  builder: "function_lead",
  manager: "exec_sponsor",
  analyst: "analyst",
  contributor: "contributor",
  learner: "learner",
  outsider: null,
};
const REVIEWERS: readonly Person[] = ["lead", "builder", "manager", "analyst"];

/** Le schede del workspace, create in `before()`. */
const cards = {} as Record<"scored" | "approved" | "hidden" | "ownByEmail" | "ownHidden" | "generated", { id: string; title: string }>;
const ENV_KEYS = ["PORTFOLIO_SHARE_SECRET", "UC_ENABLED", "USE_CASE_HUB_WORKSPACES"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const ALL_TYPES = ["new_portfolio_item", "use_case_digest", "use_case_quarter", "risk_alert", "new_use_case_opportunity"];
const CASE_TYPES = ["new_portfolio_item", "use_case_digest", "use_case_quarter"];
const OTHER_TYPES = ["risk_alert", "new_use_case_opportunity"];

function signIn(person: Person | null): void {
  (globalThis as { __hubD4Session?: unknown }).__hubD4Session = person
    ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}`, image: null } }
    : null;
}

/** La pagina resa in HTML con la sessione di `person`, oppure il `digest` di `notFound()` o `redirect()`. */
async function open(
  page: Page,
  person: Person | null,
  params: Record<string, string>,
  searchParams: Record<string, string> = {},
): Promise<{ html: string; digest: null } | { html: null; digest: string }> {
  signIn(person);
  try {
    const element = await page({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) });
    return { html: renderToStaticMarkup(element), digest: null };
  } catch (error) {
    const digest = (error as { digest?: unknown })?.digest;
    if (typeof digest === "string") return { html: null, digest };
    throw error;
  }
}

async function html(page: Page, person: Person | null, params: Record<string, string>, searchParams: Record<string, string> = {}): Promise<string> {
  const result = await open(page, person, params, searchParams);
  assert.equal(result.digest, null, `atteso HTML, non ${result.digest}`);
  return result.html!;
}

const NOT_FOUND = /^NEXT_HTTP_ERROR_FALLBACK;404$/;

/** Gli elementi React che hanno la prop `name`, in profondità (senza rendere i componenti). */
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

async function seedCard(s: {
  title: string;
  status?: string;
  review?: string;
  kind?: string | null;
  code?: string | null;
  intake?: Record<string, unknown> | null;
  publicNote?: string | null;
  reviewedBy?: string | null;
  targetQuarter?: string | null;
  proposedBy?: string | null;
  source?: string;
  /** Al posto di `FIGURES.overall`, per l'ordine delle liste; `null` senza punteggio. */
  overall?: number | null;
  /** Minuti fa; senza, adesso. */
  createdMinutesAgo?: number;
}): Promise<{ id: string; title: string }> {
  const id = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, business_case, status, portfolio_review_status, portfolio_kind, code,
       intake, public_note, reviewed_by, target_quarter, proposed_by, source, review_notes, category, timeline,
       custom_scores, overall_impact_score, overall_feasibility_score, overall_score, impact_economic, feasibility_data,
       cost_eur_once, value_eur_year, created_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::use_case_status, $7::portfolio_review_status, $8, $9,
       $10::jsonb, $11, $12::uuid, $13, $14, $15, $16, 'quick_win', 'Q1',
       '{"impact": {"efficiency": 4}}'::jsonb, $17, $18, $19, 4, 3, $20, $21, now() - make_interval(mins => $22))`,
    [
      id,
      ids.ws,
      s.title,
      marks.description,
      marks.businessCase,
      s.status ?? "proposed",
      s.review ?? "scored",
      s.kind === undefined ? "use_case_ai" : s.kind,
      s.code ?? null,
      s.intake ? JSON.stringify(s.intake) : null,
      s.publicNote ?? null,
      s.reviewedBy ?? null,
      s.targetQuarter ?? null,
      s.proposedBy === undefined ? `collega.${suffix}@cliente.test` : s.proposedBy,
      s.source ?? "web_proposed",
      marks.internalNote,
      FIGURES.impact,
      FIGURES.feasibility,
      s.overall === undefined ? FIGURES.overall : s.overall,
      FIGURES.costOnce,
      FIGURES.valueYear,
      s.createdMinutesAgo ?? 0,
    ],
  );
  return { id, title: s.title };
}

before(async () => {
  if (!enabled) return;
  // I file `.tsx` delle pagine e dei componenti: JSX e tipi tolti da TypeScript, solo qui.
  const { default: ts } = await import("typescript");
  // `@/lib/auth` legge i cookie di Next: qui restituisce la sessione della prova. La matrice
  // di /use-cases (recharts) non si carica sotto Node puro: la sua pagina la monta solo per
  // i revisori, e qui diventa un componente vuoto.
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "@/lib/auth": stub("export async function auth() { return globalThis.__hubD4Session ?? null; }"),
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
  signals = await import("../db/queries/signals.ts");
  // I componenti client dei revisori chiamano `useRouter()`: un router che non naviga.
  const { createElement } = await import("react");
  const { renderToStaticMarkup: toHtml } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as {
    AppRouterContext: import("react").Context<object | null>;
  };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  renderToStaticMarkup = (element) => toHtml(createElement(AppRouterContext.Provider, { value: router }, element as never));
  const page = async (path: string): Promise<Page> => (await import(path)).default as Page;
  pages = {
    portfolio: await page("../../app/(dashboard)/dashboard/[workspaceId]/portfolio/page.tsx"),
    review: await page("../../app/(dashboard)/dashboard/[workspaceId]/portfolio/review/[useCaseId]/page.tsx"),
    useCases: await page("../../app/(dashboard)/dashboard/[workspaceId]/use-cases/page.tsx"),
    useCase: await page("../../app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/page.tsx"),
    plan: await page("../../app/(dashboard)/dashboard/[workspaceId]/plan/page.tsx"),
    intelligence: await page("../../app/(dashboard)/dashboard/[workspaceId]/intelligence/page.tsx"),
    share: await page("../../app/share/portfolio/[workspaceId]/[useCaseId]/page.tsx"),
  };
  workspaceTopbar = (await import("../../components/portfolio/workspace-topbar.tsx")).WorkspaceTopbar as unknown as Topbar;
  const shareLink = await import("../portfolio/share-link.ts");
  createShareToken = (workspaceId) => shareLink.createPortfolioShareToken(workspaceId);

  // Il segreto dei link di condivisione vive solo in questo processo. Area e sezione Casi
  // d'uso spente: D4 vale anche così.
  process.env.PORTFOLIO_SHARE_SECRET = randomBytes(32).toString("base64");
  delete process.env.UC_ENABLED;
  delete process.env.USE_CASE_HUB_WORKSPACES;

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H2e', $2)`, [ids.org, `hub-h2e-${ids.org}`]);
  await q(
    `INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova H2e'), ($2::uuid, $3::uuid, 'Prova H2e altro')`,
    [ids.ws, ids.other, ids.org],
  );
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    const role = roles[person];
    if (role) {
      await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], role]);
    }
  }

  cards.scored = await seedCard({ title: `Proposta valutata ${suffix}`, code: codes.scored, publicNote: marks.othersPublicNote });
  cards.approved = await seedCard({ title: `Proposta approvata ${suffix}`, status: "accepted", code: codes.approved, targetQuarter: "2027-Q1" });
  cards.hidden = await seedCard({
    title: marks.hiddenTitle,
    code: codes.hidden,
    intake: { hiddenFromSearch: true },
    proposedBy: ids.builder,
    source: "manual",
  });
  cards.ownByEmail = await seedCard({
    title: `Mia proposta per email ${suffix}`,
    code: codes.ownByEmail,
    review: "needs_inputs",
    reviewedBy: ids.lead,
    publicNote: marks.ownPublicNote,
    proposedBy: emails.contributor.toUpperCase(),
  });
  cards.ownHidden = await seedCard({
    title: `Mia proposta nascosta ${suffix}`,
    code: codes.ownHidden,
    intake: { hiddenFromSearch: true },
    proposedBy: ids.contributor,
    source: "learning",
  });
  // Una scheda di oggi senza tipo del portfolio (Activity mapping): solo in /use-cases e /plan.
  cards.generated = await seedCard({ title: `Dalle attività ${suffix}`, code: codes.generated, kind: null, status: "draft", source: "activity_mapping", proposedBy: null });

  // Un segnale per tipo, dal più vecchio al più recente; quelli delle schede sono i più recenti.
  const signalRows: Array<[string, string, boolean]> = [
    ["risk_alert", marks.riskSignal, false],
    ["new_use_case_opportunity", marks.opportunitySignal, true],
    ["use_case_quarter", marks.quarterSignal, false],
    ["use_case_digest", marks.digestSignal, false],
    ["new_portfolio_item", marks.caseSignal, false],
  ];
  for (const [index, [type, title, read]] of signalRows.entries()) {
    await q(
      `INSERT INTO weekly_signals (workspace_id, signal_type, title, description, related_entity_type, related_entity_id, is_read, created_at)
       VALUES ($1::uuid, $2, $3, $4, 'use_case', $5::uuid, $6, now() - make_interval(mins => $7))`,
      [ids.ws, type, title, `${title} descrizione`, cards.scored.id, read, 50 - index],
    );
  }
  // L'altro workspace: i suoi segnali non compaiono mai.
  await q(`INSERT INTO weekly_signals (workspace_id, signal_type, title) VALUES ($1::uuid, 'risk_alert', $2), ($1::uuid, 'new_portfolio_item', $2)`, [
    ids.other,
    `ALTRO-WORKSPACE-${suffix}`,
  ]);
});

after(async () => {
  signIn(null);
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  // I workspace portano via schede, segnali, iscrizioni e modelli di valutazione.
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.other]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(ids).filter((id) => id !== ids.org && id !== ids.ws && id !== ids.other)]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
});

// ─── Segnali per ruolo (campanella e Intelligence) ───────────────────

const types = (rows: Array<{ signalType: string }>) => rows.map((row) => row.signalType).sort();

test("getSignalsByWorkspace: i segnali delle schede solo ai revisori, di ogni ruolo", opts, async () => {
  for (const person of REVIEWERS) {
    assert.deepEqual(types(await signals.getSignalsByWorkspace(ids.ws, 50, roles[person])), [...ALL_TYPES].sort(), person);
  }
  for (const role of ["contributor", "learner", null, "", "ruolo_sconosciuto"]) {
    const rows = await signals.getSignalsByWorkspace(ids.ws, 50, role);
    assert.deepEqual(types(rows), [...OTHER_TYPES].sort(), `ruolo ${role}`);
    for (const row of rows) assert.ok(!CASE_TYPES.includes(row.signalType));
  }
  // Senza ruolo, la query sceglie la forma ridotta: chi la chiama senza dirlo non vede le schede.
  assert.deepEqual(types(await signals.getSignalsByWorkspace(ids.ws)), [...OTHER_TYPES].sort());
  // Mai i segnali di un altro workspace.
  for (const role of ["exec_sponsor", "contributor"]) {
    for (const row of await signals.getSignalsByWorkspace(ids.ws, 50, role)) assert.notEqual(row.title, `ALTRO-WORKSPACE-${suffix}`);
  }
});

test("getSignalsByWorkspace: il limite vale dopo il filtro, in ordine dal più recente", opts, async () => {
  // I tre segnali delle schede sono i più recenti: il contributore riceve comunque il suo più recente.
  assert.deepEqual(
    (await signals.getSignalsByWorkspace(ids.ws, 1, "contributor")).map((row) => row.title),
    [marks.opportunitySignal],
  );
  assert.deepEqual(
    (await signals.getSignalsByWorkspace(ids.ws, 2, "function_lead")).map((row) => row.title),
    [marks.caseSignal, marks.digestSignal],
  );
});

test("getUnreadSignals: stessa regola, solo i non letti", opts, async () => {
  for (const person of REVIEWERS) {
    assert.deepEqual(
      types(await signals.getUnreadSignals(ids.ws, roles[person])),
      ["new_portfolio_item", "risk_alert", "use_case_digest", "use_case_quarter"],
      person,
    );
  }
  for (const role of ["contributor", "learner", null]) {
    assert.deepEqual(types(await signals.getUnreadSignals(ids.ws, role)), ["risk_alert"], `ruolo ${role}`);
  }
  assert.deepEqual(types(await signals.getUnreadSignals(ids.ws)), ["risk_alert"]);
});

test("campanella: la barra in alto passa alla campanella solo i segnali che il ruolo vede", opts, async () => {
  const bell = async (role: string | null) => {
    const [initial] = findProp(await workspaceTopbar({ workspaceId: ids.ws, role }), "initialSignals") as Array<Array<{ signalType: string; title: string }>>;
    assert.ok(Array.isArray(initial), "la campanella riceve i segnali");
    return initial;
  };
  const contributor = await bell("contributor");
  assert.deepEqual(types(contributor), [...OTHER_TYPES].sort());
  assert.ok(!JSON.stringify(contributor).includes(marks.caseSignal));
  assert.deepEqual(types(await bell("function_lead")), [...ALL_TYPES].sort());
});

test("markAllVisibleSignalsRead: «Segna tutti letti» tocca solo i segnali che il ruolo vede", opts, async () => {
  const saved = await q(`SELECT id, is_read FROM weekly_signals WHERE workspace_id = ANY($1::uuid[])`, [[ids.ws, ids.other]]);
  try {
    // `is_read` è uno per il workspace: il contributore non spegne ai revisori i segnali delle schede.
    await signals.markAllVisibleSignalsRead(ids.ws, "contributor");
    assert.deepEqual(types(await signals.getUnreadSignals(ids.ws, "contributor")), []);
    assert.deepEqual(types(await signals.getUnreadSignals(ids.ws, "function_lead")), [...CASE_TYPES].sort());
    await signals.markAllVisibleSignalsRead(ids.ws, "function_lead");
    assert.deepEqual(types(await signals.getUnreadSignals(ids.ws, "function_lead")), []);
    // Mai i segnali di un altro workspace.
    assert.deepEqual(types(await signals.getUnreadSignals(ids.other, "function_lead")), ["new_portfolio_item", "risk_alert"]);
  } finally {
    for (const row of saved) await q(`UPDATE weekly_signals SET is_read = $2 WHERE id = $1::uuid`, [row.id, row.is_read]);
  }
});

// ─── Pagine di oggi per chi non valuta ───────────────────────────────

test("/portfolio: il contributore vede titolo e fase, i propri codici, nessun numero, nota o export", opts, async () => {
  const page = await html(pages.portfolio, "contributor", { workspaceId: ids.ws });
  assertReduced(page, "/portfolio contributore", {
    has: [
      cards.scored.title,
      cards.approved.title,
      cards.ownByEmail.title,
      cards.ownHidden.title,
      "Approvato · T1 2027",
      "Da valutare · Serve info",
      codes.ownByEmail,
      codes.ownHidden,
      "Nuovo contributo",
    ],
    lacks: [codes.scored, codes.approved, marks.ownPublicNote, "Ranking contributi", "Waves", cards.generated.title],
  });
});

test("/portfolio: per i revisori la pagina resta quella di oggi", opts, async () => {
  for (const person of REVIEWERS) {
    const page = await html(pages.portfolio, person, { workspaceId: ids.ws });
    for (const text of ["Ranking contributi", "Impatto / Fattibilità", "Export Excel", "Impact", "Feasibility", "Score", cards.hidden.title]) {
      assert.ok(page.includes(text), `${person}: manca «${text}»`);
    }
  }
});

test("/portfolio/review/<id>: la scheda del contributore, come DESIGN §6.9", opts, async () => {
  const others = await html(pages.review, "contributor", { workspaceId: ids.ws, useCaseId: cards.scored.id });
  // H4p: delle proposte altrui la sola fase, senza lo smistamento del team.
  assertReduced(others, "scheda altrui", { has: [cards.scored.title, "Da valutare"], lacks: [codes.scored, "Nota pubblica", "Valutata"] });

  const own = await html(pages.review, "contributor", { workspaceId: ids.ws, useCaseId: cards.ownByEmail.id });
  assertReduced(own, "scheda propria", { has: [cards.ownByEmail.title, codes.ownByEmail, "Nota pubblica", marks.ownPublicNote, "Da valutare · Serve info"] });

  // Una propria proposta nascosta alla ricerca resta sua; una nascosta altrui non c'è.
  const ownHidden = await html(pages.review, "contributor", { workspaceId: ids.ws, useCaseId: cards.ownHidden.id });
  assertReduced(ownHidden, "propria nascosta", { has: [cards.ownHidden.title, codes.ownHidden] });
  const hidden = await open(pages.review, "contributor", { workspaceId: ids.ws, useCaseId: cards.hidden.id });
  assert.match(hidden.digest ?? "", NOT_FOUND);

  // Il revisore vede la scheda di oggi: punteggi e note del revisore nel modulo.
  const reviewer = await html(pages.review, "builder", { workspaceId: ids.ws, useCaseId: cards.hidden.id });
  for (const text of ["Valutazione (0–5)", "Impatto:", "Fattibilità:", marks.description, marks.internalNote]) {
    assert.ok(reviewer.includes(text), `revisore: manca «${text}»`);
  }
});

test("/use-cases e /use-cases/<id>: niente punteggi, matrice e sotto-punteggi per il contributore", opts, async () => {
  const list = await html(pages.useCases, "contributor", { workspaceId: ids.ws });
  assertReduced(list, "/use-cases contributore", {
    has: [cards.scored.title, cards.generated.title, cards.ownHidden.title, codes.ownByEmail, "Approvato · T1 2027"],
    lacks: [codes.generated, "Quick Win", "Matrice", "Genera"],
  });

  const detail = await html(pages.useCase, "contributor", { workspaceId: ids.ws, useCaseId: cards.approved.id });
  assertReduced(detail, "/use-cases/<id> contributore", {
    has: [cards.approved.title, "Approvato · T1 2027"],
    lacks: [codes.approved, "Business Case", "Scoring", "Quick Win", "Q1"],
  });
  const own = await html(pages.useCase, "contributor", { workspaceId: ids.ws, useCaseId: cards.ownByEmail.id });
  assertReduced(own, "/use-cases/<id> propria", { has: [codes.ownByEmail, marks.ownPublicNote] });
  assert.match((await open(pages.useCase, "contributor", { workspaceId: ids.ws, useCaseId: cards.hidden.id })).digest ?? "", NOT_FOUND);

  const reviewer = await html(pages.useCases, "analyst", { workspaceId: ids.ws });
  for (const text of ["Matrice Impatto", "Quick Win (", "Genera Use Cases"]) assert.ok(reviewer.includes(text), `revisore: manca «${text}»`);
  const reviewerDetail = await html(pages.useCase, "analyst", { workspaceId: ids.ws, useCaseId: cards.approved.id });
  for (const text of ["Score totale", "Scoring Impatto", marks.businessCase]) assert.ok(reviewerDetail.includes(text), `revisore: manca «${text}»`);
  // La scheda del revisore mostra i punteggi arrotondati: la ricerca dei numeri li trova.
  for (const label of ROUNDED_FIGURES.map((figure) => figure.label)) assert.ok(figuresIn(reviewerDetail).includes(label), `revisore: manca «${label}»`);
});

test("/plan: niente cifre, zone o sequenza per il contributore", opts, async () => {
  const page = await html(pages.plan, "contributor", { workspaceId: ids.ws });
  assertReduced(page, "/plan contributore", {
    has: [cards.scored.title, cards.approved.title, "Approvato · T1 2027", codes.ownByEmail],
    lacks: [codes.scored, codes.approved, "Quick Win", "Fase 1", "Timeline Gantt", "Piano di Sequencing"],
  });
  const reviewer = await html(pages.plan, "manager", { workspaceId: ids.ws });
  for (const text of ["Timeline Gantt", "Piano di Sequencing"]) assert.ok(reviewer.includes(text), `revisore: manca «${text}»`);
});

test("liste del contributore in ordine di arrivo, mai in ordine di punteggio", opts, async () => {
  // `getUseCasesByWorkspace` ordina per punteggio, NULL in testa: quell'ordine è la classifica
  // dei revisori. Qui la più vecchia ha il punteggio più alto, la più recente il più basso e
  // quella di mezzo nessuno.
  const older = await seedCard({ title: `Arrivata per prima ${suffix}`, overall: 4.89, createdMinutesAgo: 600 });
  const unscored = await seedCard({ title: `Arrivata senza punteggio ${suffix}`, overall: null, createdMinutesAgo: 450 });
  const newer = await seedCard({ title: `Arrivata per ultima ${suffix}`, overall: 1.23, createdMinutesAgo: 300 });
  const positions = (page: string) => [newer, unscored, older].map((card) => page.indexOf(card.title));
  try {
    for (const [name, page] of [["/use-cases", pages.useCases], ["/plan", pages.plan], ["/portfolio", pages.portfolio]] as const) {
      const [first, second, third] = positions(await html(page, "contributor", { workspaceId: ids.ws }));
      assert.ok(first >= 0 && first < second && second < third, `${name}: dalla più recente alla più vecchia (${first}, ${second}, ${third})`);
    }
    // La query di partenza le dà per punteggio, NULL in testa: senza il riordino le liste sarebbero la classifica.
    const { getUseCasesByWorkspace } = await import("../db/queries/use-cases.ts");
    const byScore = (await getUseCasesByWorkspace(ids.ws)).map((row) => row.id).filter((id) => [older.id, unscored.id, newer.id].includes(id));
    assert.deepEqual(byScore, [unscored.id, older.id, newer.id]);
  } finally {
    await q(`DELETE FROM use_cases WHERE id = ANY($1::uuid[])`, [[older.id, unscored.id, newer.id]]);
  }
});

test("/portfolio, ricevuta dell'invio da un corso: la matrice la promette solo a chi la vede", opts, async () => {
  const page = await html(pages.portfolio, "contributor", { workspaceId: ids.ws }, { created: cards.ownHidden.id });
  assertReduced(page, "ricevuta del contributore", { has: ["Proposta ricevuta nel portfolio", "Trovi la sua fase nella lista qui sotto."], lacks: ["matrice"] });

  const reviewers = await seedCard({ title: `Dal corso di un revisore ${suffix}`, source: "learning", proposedBy: ids.builder });
  try {
    const reviewer = await html(pages.portfolio, "builder", { workspaceId: ids.ws }, { created: reviewers.id });
    for (const text of ["Proposta ricevuta nel portfolio", "La proposta può comparire nella matrice dopo la valutazione dei referenti."]) {
      assert.ok(reviewer.includes(text), `revisore: manca «${text}»`);
    }
  } finally {
    await q(`DELETE FROM use_cases WHERE id = $1::uuid`, [reviewers.id]);
  }
});

test("/intelligence: niente segnali delle schede né zone per il contributore", opts, async () => {
  const page = await html(pages.intelligence, "contributor", { workspaceId: ids.ws });
  assertReduced(page, "/intelligence contributore", {
    has: [marks.riskSignal, marks.opportunitySignal],
    lacks: [marks.caseSignal, marks.digestSignal, marks.quarterSignal, "quick wins"],
  });
  const reviewer = await html(pages.intelligence, "builder", { workspaceId: ids.ws });
  for (const text of [marks.caseSignal, marks.digestSignal, marks.quarterSignal, "quick wins"]) {
    assert.ok(reviewer.includes(text), `revisore: manca «${text}»`);
  }
});

// ─── Link di condivisione (D14) ──────────────────────────────────────

test("link di condivisione senza sessione: la sola proposta del link, senza codice", opts, async () => {
  const token = createShareToken(ids.ws);
  const approved = await html(pages.share, null, { workspaceId: ids.ws, useCaseId: cards.approved.id }, { token });
  assertReduced(approved, "condivisione", {
    has: ["<h1", ">Use case</h1>", cards.approved.title, "Approvato", "Quando", "T1 2027", "Accedi per aprire la scheda"],
    // Solo ciò che elenca D14: niente riga «lo valuta» sotto una proposta già approvata.
    lacks: [codes.approved, cards.scored.title, cards.ownByEmail.title, "Raccolta", "Matrice", "Quick win", "Strategic bet", "valuta"],
  });
  for (const code of Object.values(codes)) assert.ok(!approved.includes(code), `condivisione: codice ${code}`);

  // Una proposta con nota pubblica: la nota non c'è, nemmeno per chi l'ha proposta.
  const own = await html(pages.share, null, { workspaceId: ids.ws, useCaseId: cards.ownByEmail.id }, { token });
  // Chi non è membro non è riconosciuto come chi ha proposto: la sola fase (D14, H4p).
  assertReduced(own, "condivisione, nota pubblica", { has: [cards.ownByEmail.title, "Da valutare"], lacks: [marks.ownPublicNote, codes.ownByEmail, "Quando", "Serve info"] });
});

test("link di condivisione di una scheda nascosta: solo la fase", opts, async () => {
  const token = createShareToken(ids.ws);
  const page = await html(pages.share, null, { workspaceId: ids.ws, useCaseId: cards.ownHidden.id }, { token });
  assertReduced(page, "condivisione nascosta", { has: ["Fase", "Da valutare"], lacks: [cards.ownHidden.title, codes.ownHidden, "Valutata", "Quando"] });
});

test("link di condivisione: chi non è membro o segue un corso vede la vista ridotta, i membri vanno alla scheda", opts, async () => {
  const token = createShareToken(ids.ws);
  for (const person of ["learner", "outsider"] as const) {
    const page = await html(pages.share, person, { workspaceId: ids.ws, useCaseId: cards.scored.id }, { token });
    assertReduced(page, `condivisione ${person}`, { has: [cards.scored.title, "Accedi per aprire la scheda"], lacks: [codes.scored] });
  }
  for (const person of ["contributor", "builder"] as const) {
    const result = await open(pages.share, person, { workspaceId: ids.ws, useCaseId: cards.scored.id }, { token });
    assert.match(result.digest ?? "", new RegExp(`^NEXT_REDIRECT;[a-z]+;/dashboard/${ids.ws}/portfolio/review/${cards.scored.id};`), person);
  }
  // Un token non valido: nessun dato del portfolio.
  const invalid = await html(pages.share, null, { workspaceId: ids.ws, useCaseId: cards.scored.id }, { token: "1.x" });
  assertReduced(invalid, "token non valido", { has: ["Link non più valido"], lacks: [cards.scored.title] });
});

// ═══ Secondo modo: HTML sul harness ═════════════════════════════════

if (process.env.HUB_D4_HARNESS === "1") {
  describe("sul harness: HTML con la sessione di osservatore e senza sessione, nel workspace «b» spento", () => {
    const port = process.env.UC_TEST_PG_PORT?.trim() || "55479";
    const database = process.env.UC_TEST_PG_DB?.trim() ?? "";
    const appPort = process.env.UC_TEST_APP_PORT?.trim() || "53120";
    const loginPort = process.env.UC_TEST_LOGIN_PORT?.trim() || "53122";
    const root = process.env.UC_TEST_ROOT ?? "";
    // 55439 Learning, 55449 Casi d'uso, 55469 connettore: mai qui.
    if (["55439", "55449", "55469"].includes(port) || !/^hub_[a-z0-9][a-z0-9_]{0,39}$/.test(database)) {
      throw new Error("The harness run needs the hub cluster and a package database hub_<id> (UC_TEST_PG_PORT, UC_TEST_PG_DB)");
    }
    if (["53110", "53130"].includes(appPort) || ["53112", "53132"].includes(loginPort)) throw new Error("Use the hub's app and login ports");
    if (!root.startsWith("/private/tmp/") && !root.startsWith("/tmp/")) throw new Error("Set UC_TEST_ROOT to the harness directory");
    const app = `http://127.0.0.1:${appPort}`;
    const login = `http://127.0.0.1:${loginPort}`;

    let client: { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>; end(): Promise<void> };
    let ws = "";
    let observer = { id: "", email: "" };
    let cookie = "";
    let addedMembership = false;
    const seeded: Record<"visible" | "approved" | "hidden" | "own", { id: string; title: string; code: string }> = {} as never;
    const harnessSuffix = randomBytes(3).toString("hex");
    const hBase = 10_000 + Math.floor(Math.random() * 80_000);

    async function get(path: string, withCookie: boolean): Promise<{ status: number; body: string }> {
      const response = await fetch(`${app}${path}`, { headers: withCookie ? { cookie } : {}, redirect: "manual", signal: AbortSignal.timeout(120_000) });
      return { status: response.status, body: await response.text() };
    }

    before(async () => {
      const fixtures = JSON.parse(readFileSync(`${root.replace(/\/+$/, "")}/uc-fixtures/synthetic-fixtures.json`, "utf8"));
      ws = fixtures.workspaces.b.workspaceId;
      observer = { id: fixtures.accounts.osservatore.id, email: fixtures.accounts.osservatore.email };
      const { default: pg } = (await import("pg")) as unknown as { default: { Client: new (config: object) => typeof client & { connect(): Promise<void> } } };
      const connection = new pg.Client({ host: "127.0.0.1", port: Number(port), user: "uc_test", database });
      await connection.connect();
      client = connection;
      const membership = await client.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'contributor') ON CONFLICT (workspace_id, user_id) DO NOTHING RETURNING id`,
        [ws, observer.id],
      );
      addedMembership = (membership.rowCount ?? 0) > 0;
      const role = await client.query(`SELECT role FROM workspace_memberships WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ws, observer.id]);
      assert.equal(role.rows[0]?.role, "contributor", "osservatore deve essere contributore nel workspace «b»");

      const insert = async (key: keyof typeof seeded, title: string, extra: { status?: string; targetQuarter?: string; intake?: object; proposedBy?: string; publicNote?: string }, n: number) => {
        const id = randomUUID();
        const code = `YY-${hBase + n}`;
        await client.query(
          `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, intake, public_note,
             target_quarter, proposed_by, source, review_notes, category, custom_scores, overall_impact_score, overall_feasibility_score, overall_score, cost_eur_once)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::use_case_status, 'scored', 'use_case_ai', $6, $7::jsonb, $8, $9, $10, 'web_proposed', $11, 'quick_win',
             '{"impact": {"efficiency": 4}}'::jsonb, $12, $13, $14, $15)`,
          [id, ws, title, marks.description, extra.status ?? "proposed", code, extra.intake ? JSON.stringify(extra.intake) : null, extra.publicNote ?? null,
            extra.targetQuarter ?? null, extra.proposedBy ?? `collega.${harnessSuffix}@cliente.test`, marks.internalNote,
            FIGURES.impact, FIGURES.feasibility, FIGURES.overall, FIGURES.costOnce],
        );
        seeded[key] = { id, title, code };
      };
      await insert("visible", `Proposta altrui ${harnessSuffix}`, { publicNote: marks.othersPublicNote }, 0);
      await insert("approved", `Proposta approvata ${harnessSuffix}`, { status: "accepted", targetQuarter: "2027-Q1" }, 1);
      await insert("hidden", marks.hiddenTitle, { intake: { hiddenFromSearch: true } }, 2);
      await insert("own", `Mia proposta ${harnessSuffix}`, { proposedBy: observer.email, publicNote: marks.ownPublicNote }, 3);
      for (const [type, title] of [["new_portfolio_item", marks.caseSignal], ["use_case_digest", marks.digestSignal], ["risk_alert", marks.riskSignal]]) {
        await client.query(`INSERT INTO weekly_signals (workspace_id, signal_type, title, description) VALUES ($1::uuid, $2, $3, $4)`, [ws, type, title, `${title} descrizione`]);
      }

      const signInResponse = await fetch(`${login}/as/osservatore?to=${encodeURIComponent(`/dashboard/${ws}/portfolio`)}`, { redirect: "manual" });
      const setCookie = signInResponse.headers.get("set-cookie") ?? "";
      assert.equal(signInResponse.status, 302, "il login di prova risponde con il cookie");
      cookie = setCookie.split(";")[0];
      assert.match(cookie, /^__session=/);
    });

    after(async () => {
      if (!client) return;
      const cardIds = Object.values(seeded).map((card) => card.id);
      await client.query(`DELETE FROM use_cases WHERE id = ANY($1::uuid[])`, [cardIds]);
      await client.query(`DELETE FROM weekly_signals WHERE workspace_id = $1::uuid AND title = ANY($2::text[])`, [
        ws,
        [marks.caseSignal, marks.digestSignal, marks.riskSignal],
      ]);
      if (addedMembership) await client.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ws, observer.id]);
      await client.end();
    });

    test("pagine di oggi e Intelligence con la sessione di osservatore", async () => {
      const routes = [
        `/dashboard/${ws}/portfolio`,
        `/dashboard/${ws}/portfolio/review/${seeded.visible.id}`,
        `/dashboard/${ws}/portfolio/review/${seeded.own.id}`,
        `/dashboard/${ws}/use-cases`,
        `/dashboard/${ws}/use-cases/${seeded.approved.id}`,
        `/dashboard/${ws}/plan`,
        `/dashboard/${ws}/intelligence`,
      ];
      for (const route of routes) {
        const { status, body } = await get(route, true);
        assert.equal(status, 200, `${route}: stato ${status}`);
        // La campanella è nel layout di ogni pagina: il segnale di rischio sì, quelli delle schede no.
        assertReduced(body, route, {
          has: [marks.riskSignal],
          lacks: [marks.caseSignal, marks.digestSignal, seeded.visible.code, seeded.approved.code, "Application error"],
        });
      }
      const list = await get(`/dashboard/${ws}/portfolio`, true);
      assertReduced(list.body, "/portfolio", { has: [seeded.visible.title, seeded.approved.title, seeded.own.title, seeded.own.code] });
      const own = await get(`/dashboard/${ws}/portfolio/review/${seeded.own.id}`, true);
      assertReduced(own.body, "scheda propria", { has: [seeded.own.code, marks.ownPublicNote] });
      // Una scheda nascosta altrui non c'è: la pagina «non trovato», senza il titolo.
      const hidden = await get(`/dashboard/${ws}/portfolio/review/${seeded.hidden.id}`, true);
      assertReduced(hidden.body, "scheda nascosta altrui");
    });

    test("link di condivisione senza sessione: nessun codice, nessun numero, nessun'altra scheda", async () => {
      // Un token ben formato. L'app del harness non ha il segreto dei link: risponde «Link non più valido».
      const exp = Math.floor(Date.now() / 1000) + 86_400;
      const token = `${exp}.${createHmac("sha256", randomBytes(32)).update(`portfolio-share:v2:${ws}:0:${exp}`).digest("base64url")}`;
      for (const card of Object.values(seeded)) {
        const { status, body } = await get(`/share/portfolio/${ws}/${card.id}?token=${encodeURIComponent(token)}`, false);
        assert.equal(status, 200, `condivisione: stato ${status}`);
        assertReduced(body, "condivisione", { lacks: [...Object.values(seeded).map((s) => s.code), seeded.visible.title, seeded.own.title, marks.ownPublicNote] });
      }
    });
  });
}
