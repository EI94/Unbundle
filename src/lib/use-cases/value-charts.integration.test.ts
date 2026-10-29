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

// I grafici di «Benefici e costi» nella pagina vera (`use-cases/page.tsx`), resa in questo processo
// con la sessione scelta dalla prova (spec di Pierpaolo, 25/10/2026):
//
// - Il menu «⋯»: le voci «Matrice Valore × Costo» e «Matrice Facilità × Beneficio» e, con
//   `mostra=benefici`, la matrice a bolle nella Panoramica (facilità, beneficio, raggio, bordo per
//   il quando, link al pannello) con «Ipotesi di calcolo» sotto.
// - La Panoramica (per ora la Roadmap di prima): quattro cifre in testa, la J-curve (entrata in
//   uso, pareggio), «Valore per tipo di ritorno» (un segmento per use case, la parte da misurare
//   tratteggiata, «(n qualitativi)») e «Ipotesi di calcolo».
// - Un workspace senza modelli resta com'è: solo la matrice nel menu, niente grafici di «Benefici e
//   costi»; il contributore non vede nulla di tutto questo.
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
type HubModule = typeof import("../../components/use-cases/hub.tsx");
type Access = typeof import("../workspace-access.ts");

let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let renderToStaticMarkup: (element: unknown) => string;
let pageOfUseCases: Page;
let hub: HubModule;
let access: Access;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  /** Con «Benefici e costi». */
  wsV: randomUUID(),
  /** Senza modelli: come oggi. */
  wsN: randomUUID(),
  ls: randomUUID(),
  builder: randomUUID(),
  manager: randomUUID(),
  contributor: randomUUID(),
};
const emails = {
  ls: `ls.valore.${suffix}@ls.test`,
  builder: `builder.valore.${suffix}@cliente.test`,
  manager: `sponsor.valore.${suffix}@cliente.test`,
  contributor: `contributor.valore.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;
const ROLES: Record<Person, string> = { ls: "transformation_lead", builder: "function_lead", manager: "exec_sponsor", contributor: "contributor" };
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const PLAN = { quarter: "2026-Q4", startMonth: "2026-11", goLiveMonth: "2027-01" };
/** I golden della spec: 115,5 h · 4.042,5 € all'anno, avvio 560 €, ricorrenti 600 €. */
const FIX_A = {
  v: 1,
  primary: "tempo",
  components: [
    { key: "capacita", lever: "nuove_capacita", label: `Risposte anche fuori orario ${suffix}`, kind: "qualitativo", confidence: "ipotesi" },
    { key: "tempo", lever: "tempo", label: `Smistamento delle richieste ${suffix}`, kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" },
    { key: "qualita", lever: "qualita", label: "Meno errori di smistamento", kind: "qualitativo", confidence: "da_misurare" },
  ],
  ease: 4,
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
  group: "Servizio clienti",
  plan: PLAN,
};
/** 62,4 h · 2.719 € contati, 1.680 € da misurare, avvio 280 €. In realizzazione: solo Roadmap. */
const FIX_B = {
  v: 1,
  primary: "costi",
  components: [
    { key: "costi", lever: "costi", label: "Meno licenze", kind: "euro", eurYear: 535, confidence: "ipotesi" },
    { key: "tempo-1", lever: "tempo", label: "Controllo delle fatture", kind: "ore", volumeYear: 480, minutesPerUnit: 12, automatablePct: 65, confidence: "ipotesi" },
    { key: "tempo-2", lever: "tempo", label: "Solleciti ai fornitori", kind: "ore", volumeYear: 600, minutesPerUnit: 6, automatablePct: 80, confidence: "da_misurare" },
    { key: "rischio", lever: "rischio", label: "Meno pagamenti doppi", kind: "qualitativo", confidence: "da_misurare" },
  ],
  ease: 2,
  costs: { devDays: 2, internalHours: 8, runCostEurYear: 0 },
  group: "Amministrazione",
  plan: PLAN,
};
/** Da decidere, facilità 3, avvio 140 €. */
const SMALL = {
  v: 1,
  primary: "ricavi",
  components: [{ key: "ricavi", lever: "ricavi", label: "Più preventivi chiusi", kind: "euro", eurYear: 1000, confidence: "ipotesi" }],
  ease: 3,
  costs: { devDays: 0, internalHours: 4, runCostEurYear: 0 },
};

const codeBase = 30_000 + Math.floor(Math.random() * 60_000);
let codeSeq = 0;
const cards = {} as Record<"a" | "b" | "small" | "plain" | "plainN", { id: string; code: string }>;

async function seed(s: {
  workspaceId: string;
  title: string;
  status?: string;
  review?: string;
  targetQuarter?: string | null;
  valueModel?: unknown;
  customScores?: unknown;
  valueEurYear?: number | null;
  costEurOnce?: number | null;
}): Promise<{ id: string; code: string }> {
  const id = randomUUID();
  const code = `XV-${codeBase + codeSeq++}`;
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, origin, code,
       target_quarter, value_model, custom_scores, value_eur_year, cost_eur_once, source, proposed_by, submitted_at)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', $4::use_case_status, $5::portfolio_review_status, 'use_case_ai', 'adoption', $6,
       $7, $8::jsonb, $9::jsonb, $10, $11, 'web_proposed', $12, now() - interval '3 days')`,
    [
      id,
      s.workspaceId,
      s.title,
      s.status ?? "accepted",
      s.review ?? "scored",
      code,
      s.targetQuarter ?? null,
      s.valueModel ? JSON.stringify(s.valueModel) : null,
      s.customScores ? JSON.stringify(s.customScores) : null,
      s.valueEurYear ?? null,
      s.costEurOnce ?? null,
      `collega.${suffix}@cliente.test`,
    ],
  );
  return { id, code };
}

function signIn(person: Person | null): void {
  (globalThis as { __hubValoreSession?: unknown }).__hubValoreSession = person
    ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}`, image: null } }
    : null;
}

async function html(person: Person, workspaceId: string, searchParams: Record<string, string> = {}): Promise<string> {
  signIn(person);
  const element = await pageOfUseCases({ params: Promise.resolve({ workspaceId }), searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(element);
}

/** I dati della pagina e l'albero degli elementi, senza renderli (il contenuto del menu «⋯» non è nell'HTML finché è chiuso). */
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

/** Le voci dei grafici nel menu «⋯» (`HubHeader.menu.charts`). */
async function menuCharts(person: Person, workspaceId: string, searchParams: Record<string, string> = {}) {
  const { tree } = await hubTree(person, workspaceId, searchParams);
  const [menu] = findProp(tree, "menu") as Array<{ charts: Array<{ label: string; href: string }> } | null>;
  assert.ok(menu, `${person}: il menu «⋯»`);
  return menu.charts;
}

/** «‹ Torna alla Panoramica» e il nome del grafico: dal riquadro alla chiusura dell'h2 (il pulsante scrive il suo `data-slot` sull'`<a>`). */
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

/** Il pezzo di HTML del `<li>` che contiene l'attributo `marker`, dalla sua apertura alla chiusura. */
function itemOf(page: string, marker: string): string {
  const at = page.indexOf(marker);
  assert.ok(at >= 0, `manca ${marker}`);
  const start = page.lastIndexOf("<li", at);
  return page.slice(start, page.indexOf("</li>", at));
}

/** Il testo di una cifra in testa alla Roadmap (`data-figure="totale-…"`). */
function tileOf(page: string, key: string): string {
  const start = page.indexOf(`data-figure="totale-${key}"`);
  assert.ok(start >= 0, `manca la cifra ${key}`);
  return page.slice(start, page.indexOf("</div>", page.indexOf("</p>", page.indexOf("</p>", start) + 4) + 4)).replace(/<[^>]+>/g, " ");
}

const count = (page: string, needle: string) => page.split(needle).length - 1;

before(async () => {
  if (!enabled) return;
  const { default: ts } = await import("typescript");
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "@/lib/auth": stub("export async function auth() { return globalThis.__hubValoreSession ?? null; }"),
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
  hub = await import("../../components/use-cases/hub.tsx");
  access = await import("../workspace-access.ts");
  const quarter = await import("./quarter.ts");
  const thisQuarter = quarter.currentQuarter();

  process.env.USE_CASE_HUB_WORKSPACES = [ids.wsV, ids.wsN].join(",");
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova valore', $2)`, [ids.org, `hub-grafici-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova grafici'), ($2::uuid, $3::uuid, 'Prova senza modelli')`, [
    ids.wsV,
    ids.wsN,
    ids.org,
  ]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    for (const workspaceId of [ids.wsV, ids.wsN]) {
      await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [workspaceId, ids[person], ROLES[person]]);
    }
  }
  // Il primo mese della curva fisso, come i golden: le cifre non dipendono dal giorno della prova.
  await q(`INSERT INTO workspace_scoring_models (workspace_id, impact_flag_enabled, config) VALUES ($1::uuid, false, $2::jsonb)`, [
    ids.wsV,
    JSON.stringify({ valueParams: { originMonth: "2026-11" } }),
  ]);

  cards.a = await seed({ workspaceId: ids.wsV, title: `Smistamento ${suffix}`, targetQuarter: thisQuarter, valueModel: FIX_A });
  cards.b = await seed({ workspaceId: ids.wsV, title: `Fatture ${suffix}`, status: "in_progress", valueModel: FIX_B });
  cards.small = await seed({ workspaceId: ids.wsV, title: `Preventivi ${suffix}`, status: "proposed", review: "in_review", valueModel: SMALL });
  cards.plain = await seed({
    workspaceId: ids.wsV,
    title: `Senza modello ${suffix}`,
    targetQuarter: quarter.nextQuarter(thisQuarter),
    customScores: { impact: { efficiency: 4, profitability: 4 } },
    costEurOnce: 20_000,
    valueEurYear: 30_000,
  });
  cards.plainN = await seed({
    workspaceId: ids.wsN,
    title: `Approvata senza modello ${suffix}`,
    targetQuarter: thisQuarter,
    customScores: { impact: { efficiency: 4, profitability: 4 } },
    costEurOnce: 20_000,
    valueEurYear: 30_000,
  });
});

after(async () => {
  signIn(null);
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsV, ids.wsN]]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((person) => ids[person as Person])]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
});

// ─── I grafici del menu «⋯» ──────────────────────────────────────────

test("menu «⋯»: «Matrice Valore × Costo» e «Matrice Facilità × Beneficio»; le bolle con facilità, beneficio, quando e il link al pannello", opts, async () => {
  for (const person of ["ls", "builder", "manager"] as const) {
    const charts = await menuCharts(person, ids.wsV);
    assert.deepEqual(
      charts.map((chart) => chart.label),
      ["Matrice Valore × Costo", "Matrice Facilità × Beneficio"],
      person,
    );
    assert.ok(charts[1].href.endsWith("?vista=panoramica&mostra=benefici"), `${person}: ${charts[1].href}`);
  }

  const page = await html("builder", ids.wsV, { vista: "panoramica", mostra: "benefici" });
  assert.ok(page.includes('data-slot="benefit-bubbles"'));
  assert.ok(!page.includes('data-slot="value-cost-matrix"'), "le bolle al posto della matrice, non insieme");
  // Le schede di «Da costruire» con un modello e la facilità: A (approvata) e «Preventivi» (da decidere).
  assert.equal(count(page, "data-bubble="), 2);
  const a = itemOf(page, `data-bubble="${cards.a.id}"`);
  assert.match(a, /data-when="questo_trimestre"/);
  assert.ok(a.includes(`aria-label="${cards.a.code} Smistamento ${suffix}. Facilità 4 · 4.043 €/anno · avvio 560 € · ricorrenti 600 €/anno · questo trimestre · Gruppo Servizio clienti"`), a);
  assert.ok(a.includes(`apri=${cards.a.id}`), "il clic apre il pannello");
  assert.match(a, /width:36px;height:36px/, "avvio massimo: raggio 18 px");
  const small = itemOf(page, `data-bubble="${cards.small.id}"`);
  assert.match(small, /data-when="da_decidere"/);
  assert.match(small, /width:23px;height:23px/, "5 + 13·√(140 / 560) = 11,5 px");
  assert.match(small, /bg-uc-serie-altro\/15/, "senza gruppo, da decidere: grigio chiaro");
  assert.ok(!page.includes(`data-bubble="${cards.b.id}"`), "in realizzazione: non è da mettere in ordine");
  assert.ok(!page.includes(`data-bubble="${cards.plain.id}"`), "senza modello: non è tra le bolle");
  assert.ok(page.includes('data-slot="benefit-bubbles-list"'), "sotto i 768 px, l'elenco");
  // Nell'elenco il codice non va a capo («TJ-» / «0010») e ogni parte della riga resta intera.
  const phoneList = page.slice(page.indexOf('data-slot="benefit-bubbles-list"'));
  assert.ok(phoneList.includes(`<span class="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">${cards.a.code}</span>`), "il codice intero");
  for (const part of ["4.043 €/anno", "avvio 560 €", "ricorrenti 600 €/anno"]) assert.ok(phoneList.includes(`<span class="whitespace-nowrap">${part}</span>`), part);
  assert.ok(page.includes("Servizio clienti"), "la legenda dei gruppi");
  assert.ok(page.includes(">Senza gruppo<"), "il grigio dice che sono schede senza gruppo, non «Altro»");
  assert.ok(page.includes('data-slot="value-params-summary"') && page.includes("Ipotesi di calcolo"));
  // Sopra le bolle «‹ Torna alla Panoramica», che torna alle corsie, e il nome del grafico.
  assert.deepEqual(chartHeaderOf(page), { href: `/dashboard/${ids.wsV}/use-cases?vista=panoramica`, text: "Torna alla Panoramica", title: "Matrice Facilità × Beneficio" });
  assert.ok(page.includes('data-chart="benefici"'));
});

test("bolle: con «Benefici e costi» nel workspace e un filtro che li esclude, le bolle restano, vuote", opts, async () => {
  // La voce del menu dipende dal workspace, non dalla vista filtrata: una ricerca che trova solo la
  // scheda senza modello non riporta alla matrice.
  const page = await html("builder", ids.wsV, { vista: "panoramica", mostra: "benefici", q: `Senza modello ${suffix}` });
  assert.equal(chartHeaderOf(page).title, "Matrice Facilità × Beneficio");
  assert.ok(page.includes('data-chart="benefici"'));
  assert.ok(page.includes("Nessuno use case della vista ha la facilità in «Benefici e costi»."));
  assert.ok(!page.includes('data-slot="value-cost-matrix"'), "non la matrice");
  assert.ok(!page.includes("data-bubble="));
});

// ─── La Panoramica (la Roadmap di prima) ─────────────────────────────

test("Panoramica: quattro cifre, «Su tutto il portafoglio», J-curve con entrata in uso e pareggio, «Valore per tipo di ritorno», «Ipotesi di calcolo»", opts, async () => {
  for (const person of ["ls", "builder", "manager"] as const) {
    const page = await html(person, ids.wsV, { vista: "panoramica" });
    assert.ok(page.includes('data-slot="roadmap-value"'), person);
    // 115,5 h + 62,4 h = 177,9 h; FIX_A + FIX_B: pareggio al mese 5 da nov 26, aprile 2027. Una riga
    // sotto le cifre, al posto delle due cifre di prima.
    assert.match(
      page,
      /<p data-slot="portfolio-line" class="text-sm text-muted-foreground">Su tutto il portafoglio: 178 ore liberate all&#x27;anno, pareggio previsto ad aprile 2027\.<\/p>/,
      person,
    );
    assert.ok(!page.includes('data-figure="totale-ore"') && !page.includes('data-figure="totale-pareggio"'), person);
    assert.ok(page.includes('data-figure="totale-valore"') && page.includes('data-figure="totale-costo"'), person);
    // B è in realizzazione: i suoi 1.680 € da misurare, fuori dal valore contato.
    assert.match(tileOf(page, "da-misurare"), /fino a\s+1\.680 €\s+valore da misurare all&#x27;anno\s+su 1 use case/, person);
    assert.match(tileOf(page, "trimestre"), /1\s+use case in questo trimestre\s+T\d \d{4}/, person);
    assert.match(page, /@3xl\/hub:grid-cols-4/, `${person}: quattro cifre`);
  }

  const page = await html("builder", ids.wsV, { vista: "panoramica" });
  assert.ok(page.includes('data-slot="value-jcurve"'));
  assert.equal(count(page, 'data-go-live="2027-01"'), 1, "una linea tratteggiata per mese di entrata in uso");
  assert.ok(page.includes("Pareggio · apr 27"));
  assert.ok(page.includes("Da nov 26, per 24 mesi"));
  assert.ok(page.includes('data-slot="value-jcurve-list"'), "sotto i 768 px, le tappe");

  assert.ok(page.includes('data-slot="value-by-lever"'));
  const tempo = itemOf(page, 'data-lever="tempo"');
  // Un segmento per use case, dal più grande: A (4.042,5 €) prima di B (2.184 €); la parte da misurare di B tratteggiata.
  const segments = [...tempo.matchAll(/data-segment="([^"]+)"( data-pending="true")?/g)].map((match) => [match[1], Boolean(match[2])]);
  assert.deepEqual(segments, [
    [cards.a.id, false],
    [cards.b.id, false],
    [cards.b.id, true],
  ]);
  assert.ok(tempo.includes("6.227 €"), "il totale contato, senza la parte da misurare");
  assert.ok(tempo.includes(`aria-label="${cards.b.code} Fatture ${suffix}: da misurare, fino a 1.680 €, fuori dal totale · Risparmio di tempo · Gruppo Amministrazione"`));
  assert.ok(itemOf(page, 'data-lever="nuove_capacita"').includes("(1 qualitativo)"));
  assert.ok(itemOf(page, 'data-lever="rischio"').includes("(1 qualitativo)"));
  for (const label of ["Risparmio di tempo", "Più output", "Più qualità", "Nuove capacità", "Decisioni migliori", "Meno costi", "Più ricavi", "Meno rischio"]) {
    assert.ok(page.includes(label), `la riga «${label}»`);
  }
  assert.ok(!page.includes(`data-segment="${cards.small.id}"`), "da decidere: non è nel piano");
  assert.ok(page.includes('data-slot="value-by-lever-list"'), "sotto i 768 px, l'elenco");
  assert.ok(page.includes("Ipotesi di calcolo"));
  // Il popover è chiuso: le voci non sono ancora nella pagina.
  assert.ok(!page.includes(`Smistamento delle richieste ${suffix}`));
});

// ─── Come oggi ───────────────────────────────────────────────────────

test("senza modelli: nel menu solo «Matrice Valore × Costo» e le cifre di oggi; `mostra=benefici` vale la matrice", opts, async () => {
  assert.deepEqual(
    (await menuCharts("builder", ids.wsN)).map((chart) => chart.label),
    ["Matrice Valore × Costo"],
  );
  // Un vecchio link di «Priorità» con le bolle, in un workspace senza «Benefici e costi».
  const forced = await html("builder", ids.wsN, { vista: "priorita", mostra: "benefici" });
  assert.ok(forced.includes('data-slot="value-cost-matrix"'), "la matrice di oggi");
  assert.ok(!forced.includes('data-slot="benefit-bubbles"'));
  assert.equal(chartHeaderOf(forced).title, "Matrice Valore × Costo");
  assert.ok(forced.includes('data-chart="matrice"'));
  assert.ok(!forced.includes("Ipotesi di calcolo"));
  const roadmap = await html("builder", ids.wsN, { vista: "panoramica" });
  assert.ok(roadmap.includes('data-figure="totale-valore"'));
  for (const text of [
    'data-slot="roadmap-value"',
    'data-slot="portfolio-line"',
    'data-figure="totale-da-misurare"',
    'data-figure="totale-ore"',
    'data-figure="totale-pareggio"',
    "value-jcurve",
    "value-by-lever",
    "Ipotesi di calcolo",
  ]) {
    assert.ok(!roadmap.includes(text), `senza modelli: niente ${text}`);
  }
});

test("contributore: nessun grafico, nessuna ipotesi, nessuna voce", opts, async () => {
  const overview = await html("contributor", ids.wsV, { vista: "panoramica" });
  const priority = await html("contributor", ids.wsV, { vista: "priorita", mostra: "benefici" });
  for (const page of [overview, priority]) {
    for (const text of ["roadmap-value", "benefit-bubbles", "value-jcurve", "value-by-lever", "data-figure", "Ipotesi di calcolo", "Pareggio", "Servizio clienti", "€", "Benefici", "Torna alla Panoramica", "Matrice", "chart-header"]) {
      assert.ok(!page.includes(text), `contributore: «${text}»`);
    }
  }
});
