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

// «Chiedi al referente» nella scheda vera (SPEC §9.3, §P3.9), resa in questo processo con la sessione
// scelta dalla prova:
// - un revisore (function_lead) vede «Chiedi al referente» e ogni motivo che blocca (fornitori non
//   autorizzati ed email spente insieme); finché la finestra non si apre e c'è qualcosa da preparare,
//   «Prepara le domande» accanto, che funziona; dopo averle preparate sparisce (sta nella finestra,
//   rilascio «Pulizia»); poi le richieste, le righe sotto le esigenze, le risposte e i file con
//   «Scarica»; mai «In corso»;
// - nel selettore il suo contatto è «(sei tu)», un collega revisore «Fa parte del team»;
// - un contributore non riceve niente di tutto questo, nemmeno il testo delle risposte.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
// 127.0.0.1). I `.tsx` si traducono qui con TypeScript; `@/lib/auth` restituisce la sessione della
// prova. Dati sintetici, creati e cancellati qui. Nessuna email vera: un mailer finto.
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
type Mail = import("../../../../lib/uc/notify/dispatch.ts").OutgoingEmail;
type Panel = import("../../../../lib/use-cases/referent/contract.ts").UseCaseReferentPanel;

let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let renderToStaticMarkup: (element: unknown) => string;
let pageOfDetail: Page;
let referents: typeof import("../../../../lib/db/queries/use-case-referents.ts");
let pub: typeof import("../../../../lib/db/queries/use-case-referent-public.ts");
let dispatch: typeof import("../../../../lib/db/queries/use-case-referent-dispatch.ts");
let files: typeof import("../../../../lib/db/queries/use-case-referent-files.ts");
let askState: typeof import("./ask-dialog-state.ts");
let sectionNeeds: typeof import("../section-needs.tsx");
let labels: typeof import("../../../../lib/use-cases/referent/labels.ts");
let createElementOf: (type: unknown, props: Record<string, unknown>) => unknown;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), fabio: randomUUID(), contributor: randomUUID(), card: randomUUID() };
type Person = "builder" | "fabio" | "contributor";
const PEOPLE: Person[] = ["builder", "fabio", "contributor"];
const ROLE: Record<Person, string> = { builder: "function_lead", fabio: "function_lead", contributor: "contributor" };
const emails: Record<Person, string> = {
  builder: `giulia.render.${suffix}@cliente.test`,
  fabio: `fabio.render.${suffix}@cliente.test`,
  contributor: `contrib.render.${suffix}@cliente.test`,
};
const NAMES: Record<Person, string> = { builder: `Giulia Neri ${suffix}`, fabio: `Fabio Esempio ${suffix}`, contributor: `Collega ${suffix}` };
const MARIO = { id: randomUUID(), name: `Mario Rossi ${suffix}`, email: `mario.rossi.${suffix}@cliente.test` };
const contacts = { builder: randomUUID(), fabio: randomUUID() };
const ANSWER = `Ogni lunedì, circa due ore ${suffix}.`;
const TEAM_ANSWER = `Lo usiamo con il gestionale ${suffix}.`;
const storageDir = mkdtempSync(join(tmpdir(), "referenti-scheda-"));
const ENV = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LOCAL_STORAGE_DIR: storageDir,
} as Record<string, string | undefined>;
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS", "RESEND_API_KEY", "UC_EMAIL_FROM", "UC_LOCAL_STORAGE_DIR"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const state = globalThis as { __hubServeSession?: unknown; __hubServeRevalidated?: string[] };
const flow = { requestId: "", token: "", needs: [] as string[], fileId: "" };

function as(person: Person): Ctx {
  return { workspaceId: ids.ws, actor: { userId: ids[person], role: ROLE[person], isLateralSpace: false, kind: "persona" }, channel: "pagina" };
}
function ok<T>(result: { ok: true; value: T } | { ok: false; error?: string; code?: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error ?? result.code} (${result.message})`);
  return result.value;
}
function signIn(person: Person): void {
  state.__hubServeSession = { user: { id: ids[person], email: emails[person], emailVerified: true, name: NAMES[person], image: null } };
}
function readable(page: string): string {
  return page.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
async function detailElement(person: Person): Promise<unknown> {
  signIn(person);
  return pageOfDetail({ params: Promise.resolve({ workspaceId: ids.ws, useCaseId: ids.card }), searchParams: Promise.resolve({}) });
}
async function detailHtml(person: Person): Promise<string> {
  return readable(renderToStaticMarkup(await detailElement(person)));
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
async function needsOfCard(): Promise<string[]> {
  const rows = await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid AND n.archived_at IS NULL ORDER BY n.sort_order, n.id`, [ids.card]);
  return rows.map((r) => String(r.id));
}
function fakeMailer() {
  const outbox: Mail[] = [];
  return { outbox, async send(m: Mail) { outbox.push(m); return { ok: true as const }; } };
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

  ENV.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  for (const key of ["UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS", "RESEND_API_KEY", "UC_EMAIL_FROM"] as const) delete process.env[key];
  // I file del team si leggono dalla cartella di prova anche nella pagina (il pannello usa process.env).
  process.env.UC_LOCAL_STORAGE_DIR = storageDir;

  pageOfDetail = (await import("../../../../app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/page.tsx")).default as unknown as Page;
  referents = await import("../../../../lib/db/queries/use-case-referents.ts");
  pub = await import("../../../../lib/db/queries/use-case-referent-public.ts");
  dispatch = await import("../../../../lib/db/queries/use-case-referent-dispatch.ts");
  files = await import("../../../../lib/db/queries/use-case-referent-files.ts");
  askState = await import("./ask-dialog-state.ts");
  sectionNeeds = await import("../section-needs.tsx");
  labels = await import("../../../../lib/use-cases/referent/labels.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione scheda referenti', $2)`, [ids.org, `hub-scheda-ref-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, $3)`, [ids.ws, ids.org, `Rondine prova ${suffix}`]);
  for (const person of PEOPLE) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], NAMES[person]]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], ROLE[person]]);
  }
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, origin, code, source)
     VALUES ($1::uuid, $2::uuid, $3, 'Un problema scritto in prosa, senza numeri', 'proposed', 'in_review', 'use_case_ai', 'adoption', $4, 'web_proposed')`,
    [ids.card, ids.ws, `Fatture fornitori ${suffix}`, `RF-${1000 + Math.floor(Math.random() * 8000)}`],
  );
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(storageDir, { recursive: true, force: true });
  if (!enabled) return;
  await q(`DELETE FROM uc_rate_limits WHERE bucket LIKE 'ucq:%'`);
  await q(`DELETE FROM uc_contacts WHERE workspace_id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [PEOPLE.map((p) => ids[p])]);
});

test("(rilascio 5) un revisore che può arrivare in fondo ha «Scegli il referente» nel blocco «Referente», mai spento; niente «Chiedi al referente» né «Prepara le domande» né motivi fuori dalla finestra; il contributore niente", opts, async () => {
  const T = labels.REFERENT_UI_TEXT;
  // (Rilascio 5, §8.4) Su uno use case con il referente da scegliere il referente si sceglie nel suo
  // blocco; «Chiedi al referente» del rilascio 4 non è nella riga.
  const askButton = (html: string) => new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*?${labels.REFERENT_BLOCK_TEXT.choose}</button>`).exec(html)?.[0] ?? "";
  const rowAsk = (html: string) => html.includes(`${T.ask}</button>`);
  // Prima di preparare: niente da chiedere ma qualcosa da preparare; mancano l'ok sui fornitori (la
  // persona di funzione lo può dare) e le email (nessuno le accende): la finestra si apre e lo dice.
  const empty = await detailHtml("builder");
  const ask = askButton(empty);
  assert.ok(ask, "«Scegli il referente» nel blocco");
  assert.ok(empty.includes('data-slot="referent-block" data-state="manca"'), "il blocco «Referente» in «Manca il referente»");
  assert.ok(empty.includes(labels.REFERENT_BLOCK_TEXT.missing));
  assert.ok(!rowAsk(empty), "niente «Chiedi al referente» del rilascio 4");
  assert.doesNotMatch(ask, /disabled=""|aria-disabled="true"/, "mai spento");
  assert.doesNotMatch(ask, /bg-primary/, "secondario: il pulsante pieno è della pagina");
  assert.ok(!empty.includes(`>${T.prepare}<`) && !empty.includes(`${T.prepare}</button>`), "«Prepara le domande» sta nella finestra");
  assert.ok(!empty.includes('data-slot="referent-gates"'), "i motivi non stanno sotto la riga");
  // Con l'email di chi guarda non verificata (un motivo che solo lui può togliere): nessun pulsante, nessun «Prepara».
  state.__hubServeSession = { user: { id: ids.builder, email: emails.builder, emailVerified: false, name: NAMES.builder, image: null } };
  const unverified = readable(renderToStaticMarkup(await pageOfDetail({ params: Promise.resolve({ workspaceId: ids.ws, useCaseId: ids.card }), searchParams: Promise.resolve({}) })));
  assert.equal(askButton(unverified), "", "chi non può finire non entra nei passi");
  assert.ok(!unverified.includes(T.prepare));
  // «Prepara le domande» della finestra chiama l'azione di sempre: la stessa scrittura del server.
  ok(await referents.prepareReferentQuestions(as("builder"), ids.card), "Prepara le domande");
  flow.needs = await needsOfCard();
  assert.ok(flow.needs.length >= 4, `domande preparate: ${flow.needs.length}`);
  const page = await detailHtml("builder");
  assert.ok(askButton(page), "«Scegli il referente» nel blocco");
  assert.ok(!rowAsk(page));
  assert.doesNotMatch(askButton(page), /disabled=""/);
  assert.ok(!page.includes(T.prepare), "nessun «Prepara le domande» nel capitolo");
  assert.ok(!page.includes('data-slot="referent-gates"'));
  assert.ok(!page.includes('data-slot="referent-ask"'), "la finestra si apre solo con un clic");
  // Il pannello porta i motivi per la finestra: l'ok sui fornitori (lo può dare chi guarda) e le email.
  const [panel] = findProp(await detailElement("builder"), "referents").filter(Boolean) as Panel[];
  assert.deepEqual(panel.gates.map((g) => g.code), ["sub_responsabili_mancanti", "email_non_configurata"]);
  assert.ok(panel.gates[0].message.includes(`Rondine prova ${suffix} deve autorizzare i fornitori che usiamo`), "fornitori da autorizzare");
  assert.ok(!Object.hasOwn(panel, "members"), "le persone del workspace non stanno nel pannello della scheda");
  assert.ok(!page.includes(T.requestsHeading), "nessuna richiesta ancora");
  assert.ok(!page.includes("In corso"));

  const contributor = await detailHtml("contributor");
  for (const text of [T.ask, T.prepare, T.gates.emailNotConfigured, T.requestsHeading, "Cosa serve", labels.REFERENT_BLOCK_TEXT.choose, 'data-slot="referent-block"']) assert.ok(!contributor.includes(text), `contributore: ${text}`);
  assert.ok(!contributor.includes('data-slot="referent-ask"'));
  assert.equal(findProp(await detailElement("contributor"), "referents").filter(Boolean).length, 0, "nessun pannello al contributore");
});

/** I pulsanti pieni (`[data-slot=button].bg-primary`, anche i link) di un pezzo di HTML, con il loro testo. */
function filledIn(html: string): string[] {
  return [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .filter(([, , attrs]) => /\sdata-slot="button"/.test(attrs) && (/\sclass="([^"]*)"/.exec(attrs)?.[1].split(/\s+/) ?? []).includes("bg-primary"))
    .map(([, , , body]) => body.replace(/<[^>]+>/g, "").trim());
}

/** Il riquadro «Prossimo passo» e la sezione «Cosa serve» di una scheda. */
function boxAndNeeds(html: string): { box: string; needs: string } {
  const box = html.slice(html.indexOf('data-slot="next-step"'), html.indexOf('data-slot="scheda-grid"'));
  const start = html.indexOf('data-slot="section-needs"');
  return { box, needs: html.slice(start, html.indexOf("</section>", html.indexOf('id="richieste"') > start ? html.indexOf('id="richieste"') : start)) };
}

test("(rilascio 5, rilascio 6) approvata senza referente: il riquadro dice il motivo (G4, G6) o ha «Indica il referente» pieno (G5), che apre «Scegli il referente»; il blocco lo ha, non pieno, solo quando il riquadro non lo ha", opts, async () => {
  const T = labels.REFERENT_UI_TEXT;
  const CHOOSE = labels.REFERENT_BLOCK_TEXT.choose;
  const { GUIDED_TEXT } = await import("../../../../lib/use-cases/guided.ts");
  // (Rilascio 6, B.1) Il pulsante del passo: l'icona e il verbo.
  const INDICA = GUIDED_TEXT.cta.choose;
  const card = randomUUID();
  const quarter = await import("../../../../lib/use-cases/quarter.ts");
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, origin, code, target_quarter, source)
     VALUES ($1::uuid, $2::uuid, $3, 'Un problema scritto in prosa', 'accepted', 'scored', 'use_case_ai', 'adoption', $4, $5, 'web_proposed')`,
    [card, ids.ws, `Approvata ${suffix}`, `RF-${9000 + Math.floor(Math.random() * 900)}`, quarter.currentQuarter()],
  );
  ok(await referents.prepareReferentQuestions(as("builder"), card), "Prepara le domande");
  signIn("builder");
  const element = await pageOfDetail({ params: Promise.resolve({ workspaceId: ids.ws, useCaseId: card }), searchParams: Promise.resolve({}) });
  const html = readable(renderToStaticMarkup(element));
  const askCount = (part: string) => (part.match(new RegExp(`>${CHOOSE}</button>`, "g")) ?? []).length;
  const boxCount = (part: string) => (part.match(new RegExp(`</svg>${INDICA}</button>`, "g")) ?? []).length;
  // Senza l'autorizzazione dei fornitori (la persona di funzione la può dare): G4, con «Autorizza i fornitori»
  // pieno nel riquadro e il motivo nel «?»; il blocco ha «Scegli il referente» non pieno, che apre la finestra (l'ok è lì).
  const g4 = boxAndNeeds(html);
  assert.match(g4.box, /data-key="G4"/);
  assert.match(g4.box, /data-gate="sub_responsabili_mancanti"/);
  assert.match(g4.box, /aria-label="Perché questo passo"/);
  assert.deepEqual(filledIn(html), [GUIDED_TEXT.cta.authorize], "il solo pulsante pieno della pagina");
  assert.equal(boxCount(g4.box), 0, "riquadro: nessun «Indica il referente»");
  assert.equal(askCount(g4.needs), 1, "blocco: «Scegli il referente» per chi può dare l'ok");
  assert.ok(!html.includes(`>${T.ask}</button>`), "niente «Chiedi al referente» del rilascio 4");
  assert.ok(!html.includes('data-slot="referent-gates"'), "il motivo non si ripete sotto la riga");

  const view = (function find(node: unknown): { type: (props: object) => unknown; props: Record<string, unknown> } | null {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    }
    if (!node || typeof node !== "object" || !("props" in node)) return null;
    const el = node as { type: unknown; props: Record<string, unknown> };
    if (typeof el.type === "function" && (el.type as { name?: string }).name === "UseCaseDetailView") return el as never;
    return find(el.props.children);
  })(element);
  assert.ok(view, "la pagina monta UseCaseDetailView");
  const panel = view.props.referents as Panel;
  const render = (gates: unknown[], over: Partial<Panel> = {}) =>
    readable(renderToStaticMarkup(createElementOf(view.type, { ...view.props, referents: { ...panel, available: true, gates, ...over } })));
  const SUB = panel.gates.find((g) => g.code === "sub_responsabili_mancanti")!;
  // L'ok lo dà un'altra persona (Lateral Space, un analista del cliente): G4 dice lo stato e a chi tocca, nessun pulsante.
  const other = render([{ ...SUB, canDeclare: false, message: T.gates.subprocessorsOther.replaceAll("{Azienda}", `Rondine prova ${suffix}`) }]);
  assert.match(boxAndNeeds(other).box, /data-key="G4"/);
  assert.ok(boxAndNeeds(other).box.includes(`>${GUIDED_TEXT.cta.authorizeWaiting}</p>`), "lo stato in parole");
  assert.equal(askCount(other) + boxCount(other), 0, "chi non può dare l'ok non entra nei passi");
  assert.deepEqual(filledIn(other), []);
  // Nessun motivo: G5, un solo «Indica il referente», pieno, nel riquadro; il blocco non lo ripete (né «Manca il referente»).
  const open = render([]);
  const g5 = boxAndNeeds(open);
  assert.match(g5.box, /data-key="G5"/);
  assert.match(g5.box, /data-action="next-step-referent"/);
  assert.deepEqual(filledIn(open), [INDICA], "un solo pulsante pieno: «Indica il referente»");
  assert.deepEqual(filledIn(g5.box), [INDICA], "nel riquadro");
  assert.equal(boxCount(open) + askCount(open), 1, "una volta sola nella pagina");
  assert.ok(!open.includes('data-slot="referent-block" data-state="manca"'), "lo stato si dice una volta");
  // Solo un motivo di sistema: G6 lo dice sotto il pulsante, che resta, bordato, e apre la finestra (che lo dice).
  const system = render([{ code: "email_non_configurata", message: T.gates.emailNotConfigured }]);
  const g6 = boxAndNeeds(system);
  assert.match(g6.box, /data-key="G6"/);
  assert.match(g6.box, /data-gate="email_non_configurata"/);
  assert.ok(g6.box.includes(`>${T.gates.emailNotConfigured}</p>`), "la riga è il motivo, senza «Tocca a»");
  assert.deepEqual(filledIn(system), []);
  assert.equal(boxCount(g6.box), 1, "il riquadro apre la finestra");
  assert.equal(askCount(g6.needs), 0, "il blocco non lo ripete");
  assert.doesNotMatch(new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*?${INDICA}</button>`).exec(system)?.[0] ?? "", /disabled=""/);
  // L'email di chi guarda non verificata: G6 lo dice, nessun pulsante.
  const unverified = render([{ code: "email_non_verificata", message: T.gates.emailNotVerified }]);
  assert.match(boxAndNeeds(unverified).box, /data-key="G6"/);
  assert.equal(askCount(unverified) + boxCount(unverified), 0);
  // Niente da chiedere e niente da preparare: il referente conferma e stima lo stesso (D5), G5 pieno.
  const nothing = render([{ code: "nessuna_domanda", message: T.gates.noQuestions }], { askableNeedIds: [], preparable: [] });
  assert.equal(boxCount(nothing), 1);
  assert.deepEqual(filledIn(nothing), [INDICA]);
  for (const page of [html, other, open, system, unverified, nothing]) {
    assert.ok(!page.includes('data-slot="referent-gates"') && !page.includes(`${T.prepare}</button>`), "niente motivi né «Prepara le domande» fuori dalla finestra");
  }
  await q(`DELETE FROM use_cases WHERE id = $1::uuid`, [card]);
});

test("con l'autorizzazione e le email accese: la richiesta, le righe sotto le esigenze, le risposte e i file con «Scarica»", opts, async () => {
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $2::uuid, $3, $4), ($5::uuid, $2::uuid, $6, $7), ($8::uuid, $2::uuid, $9, $10)`, [
    MARIO.id,
    ids.ws,
    MARIO.name,
    MARIO.email,
    contacts.fabio,
    NAMES.fabio,
    emails.fabio,
    contacts.builder,
    NAMES.builder,
    emails.builder,
  ]);
  const [n0, n1, n2] = flow.needs;
  // (Rilascio 5, D17) L'invio del referente è tutto o niente: la prima domanda in una richiesta che il
  // referente chiude, la seconda in una richiesta nuova alla stessa persona, viva («In attesa»).
  const sent = ok(
    await referents.sendReferentRequest(as("builder"), ids.card, { contact: { kind: "esistente", contactId: MARIO.id }, needIds: [n0], message: "Ci serve per la stima." }, { env: ENV, requester: { name: NAMES.builder, emailVerified: true } }),
    "invio",
  );
  flow.requestId = sent.requestId;
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer, sendIntervalMs: 0 });
  assert.equal(mailer.outbox.length, 1);
  flow.token = /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(mailer.outbox[0].text)?.[1] ?? "";
  assert.ok(flow.token);
  // Il referente risponde dal link alla prima domanda.
  const now = new Date();
  const first = await pub.resolveReferentToken(flow.token, now);
  if (first.access !== "ok") assert.fail("link");
  assert.ok((await pub.acceptReferentPrivacy(first.link, { version: labels.REFERENT_PRIVACY_NOTICE.version }, now)).ok);
  const link = await pub.resolveReferentToken(flow.token, now);
  if (link.access !== "ok") assert.fail("link");
  assert.ok((await pub.saveReferentDraft(link.link, { needId: n0, text: ANSWER, dontKnow: false }, now)).ok);
  const submitted = await pub.submitReferentAnswers(link.link, {}, now);
  assert.ok(submitted.ok, JSON.stringify(submitted));
  // (Rilascio 6) La domanda nuova alla stessa persona entra nella sua richiesta, che torna viva («In attesa»).
  const live = ok(
    await referents.sendReferentRequest(as("builder"), ids.card, { contact: { kind: "esistente", contactId: MARIO.id }, needIds: [n1] }, { env: ENV, requester: { name: NAMES.builder, emailVerified: true } }),
    "seconda richiesta",
  );
  assert.equal(live.requestId, flow.requestId, "la stessa richiesta");
  await dispatch.dispatchReferentEmails({ requestId: live.requestId, env: ENV, mailer: fakeMailer(), sendIntervalMs: 0 });
  // Il team risponde e allega un file su un'altra esigenza, dalla scheda.
  ok(await referents.addReviewerAnswer(as("builder"), ids.card, n2, { text: TEAM_ANSWER }, ENV), "risposta del team");
  const up = ok(await files.uploadReviewerFileServer(as("builder"), ids.card, { needId: n2, fileName: `regole-${suffix}.csv`, declaration: true, bytes: new Uint8Array(Buffer.from(`colonna;valore\n${"Regola: il margine si calcola dal costo orario\n".repeat(6)}`, "utf8")) }, ENV), "file del team");
  flow.fileId = up.fileId;

  const page = await detailHtml("builder");
  const T = labels.REFERENT_UI_TEXT;
  assert.ok(page.includes(T.requestsHeading));
  const requests = page.slice(page.indexOf('data-slot="referent-requests"'));
  assert.ok(requests.includes(MARIO.name));
  // (Rilascio 4) Una parola sola, senza puntino; al massimo un pulsante, il resto in «Altro».
  assert.match(requests, /<p data-slot="referent-request-word" class="text-xs font-medium">In attesa<\/p>/);
  assert.ok(!/data-slot="status-dot"/.test(requests.slice(0, requests.indexOf("</li>"))), "nessun puntino sulla richiesta");
  assert.match(requests, /Inviata il \d{2}\/\d{2} · scade il \d{2}\/\d{2}/);
  assert.ok(requests.includes(`>${T.more}<`), "«Altro»");
  const row = requests.slice(0, requests.indexOf("</li>"));
  for (const action of [T.remind, T.add, T.revoke]) assert.ok(!row.includes(`${action}</button>`), `${action} sta in «Altro»`);
  const rowButtons = [...row.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter((text) => text !== T.more);
  assert.ok(rowButtons.length <= 1, JSON.stringify(rowButtons));
  // Sotto le esigenze: la riga della richiesta, poi risposte e file chiusi sotto «Risposte e file · n».
  assert.match(page, new RegExp(`Chiesta a ${MARIO.name} il \\d{2}/\\d{2} · Risposta ricevuta il \\d{2}/\\d{2}`));
  assert.ok(page.includes(ANSWER), "la risposta del referente");
  assert.ok(page.includes(TEAM_ANSWER), "la risposta del team");
  assert.ok(page.includes(`${NAMES.builder} (team)`), "autore del team");
  assert.ok(page.includes(`regole-${suffix}.csv`));
  assert.ok(page.includes(`href="/dashboard/${ids.ws}/use-cases/${ids.card}/allegati/${flow.fileId}"`), "«Scarica» passa dalla rotta con il controllo");
  assert.ok(page.includes(T.fileDownload));
  assert.match(page, /Risposte e file\u00a0·\u00a01/);
  // «Aggiungi una risposta» e «Allega un file» stanno nel «⋯» della riga (rilascio 3): un menu per
  // riga, niente più icone; si aprono dove l'esigenza accetta una risposta del team.
  assert.ok(page.includes('aria-label="Azioni: '));
  assert.ok(!page.includes(`aria-label="${T.rowAddAnswer}: `) && !page.includes(`aria-label="${T.rowAttachFile}: `), "niente più icone");
  const [shown] = findProp(await detailElement("builder"), "referents").filter(Boolean) as Panel[];
  assert.ok(shown?.answerableNeedIds.map((id) => id.toLowerCase()).includes(n2.toLowerCase()), "l'esigenza accetta una risposta del team");
  const rowActions = (answerable: boolean) =>
    sectionNeeds.needRowActions({ need: { id: n2, title: "x" }, canEdit: true, answerable, onOpen: () => {}, onEdit: () => {} }).map((item) => item.label);
  assert.deepEqual(rowActions(true), [T.rowAddAnswer, T.rowAttachFile, "Modifica"]);
  assert.deepEqual(rowActions(false), ["Modifica"]);
  // Le richieste stanno chiuse sotto «Richieste inviate · 1» (rilascio 6: la risposta e la domanda nuova nella
  // stessa richiesta, viva), con l'ancora di «Vedi le richieste».
  assert.match(page, /<details id="richieste" data-slot="needs-requests" class="scroll-mt-20">/);
  assert.match(page, /Richieste inviate\u00a0·\u00a01/);
  assert.ok(!page.includes("In corso"), "nessun «In corso»");

  // Il contributore: niente richieste, niente referenti, niente risposte, niente file.
  const contributor = await detailHtml("contributor");
  for (const text of [T.requestsHeading, MARIO.name, ANSWER, TEAM_ANSWER, `regole-${suffix}.csv`, "/allegati/", T.silentTag, "Fa parte del team", "(sei tu)"]) {
    assert.ok(!contributor.includes(text), `contributore: ${text}`);
  }
});

test("«A chi»: il proprio contatto «(sei tu)» e non si sceglie, un collega revisore «Fa parte del team»", opts, async () => {
  const [panel] = findProp(await detailElement("builder"), "referents").filter(Boolean) as Panel[];
  assert.ok(panel?.available);
  const A = labels.REFERENT_UI_TEXT.askDialog;
  const own = panel.contacts.find((c) => c.id === contacts.builder);
  const colleague = panel.contacts.find((c) => c.id === contacts.fabio);
  const mario = panel.contacts.find((c) => c.id === MARIO.id);
  assert.ok(own && colleague && mario);
  assert.ok(askState.contactRowLine(own).endsWith(A.suffix.sei_tu), askState.contactRowLine(own));
  assert.equal(own.selectable, false);
  assert.ok(askState.contactRowLine(colleague).includes(A.teamTag), askState.contactRowLine(colleague));
  assert.equal(colleague.selectable, true);
  assert.ok(!askState.contactRowLine(mario).includes(A.teamTag));
  assert.ok(askState.contactRowLine(mario).endsWith(A.suffix.richiesta_aperta), "Mario ha già una richiesta su questa scheda");
  assert.equal(askState.askSelfHint(panel), A.selfHint);
  // Fabio vede il contrario: Giulia «Fa parte del team», lui «(sei tu)».
  const [forFederico] = findProp(await detailElement("fabio"), "referents").filter(Boolean) as Panel[];
  assert.ok(askState.contactRowLine(forFederico.contacts.find((c) => c.id === contacts.builder)!).includes(A.teamTag));
  assert.ok(askState.contactRowLine(forFederico.contacts.find((c) => c.id === contacts.fabio)!).endsWith(A.suffix.sei_tu));
  // Mai un numero, un corso o un altro ruolo nelle righe; le persone del workspace non stanno nel pannello.
  for (const option of [...panel.contacts, ...forFederico.contacts]) assert.doesNotMatch(askState.contactRowLine(option), /\d|corso|formazione|learner|contributor/i, option.displayName);
  assert.ok(!Object.hasOwn(panel, "members") && !Object.hasOwn(forFederico, "members"));
  // Il contributore non riceve né il pannello né le righe.
  const contributor = await detailHtml("contributor");
  for (const text of [A.teamTag, A.suffix.sei_tu, A.selfHint]) assert.ok(!contributor.includes(text), text);
});

test("(rilascio 5) il referente scelto: il blocco «Referente» con la richiesta viva, la riga sotto il titolo, «Chiedi a un'altra persona», «Richieste inviate» senza le sue richieste", opts, async () => {
  const B = labels.REFERENT_BLOCK_TEXT;
  const A = labels.REFERENT_ASSIGN_TEXT;
  const T = labels.REFERENT_UI_TEXT;
  const [before] = findProp(await detailElement("builder"), "referents").filter(Boolean) as Panel[];
  assert.equal(before.referent ?? null, null, "prima: nessun referente");
  const free = (await needsOfCard()).filter((id) => before.askableNeedIds.includes(id));
  // «Scegli il referente» con il contenuto che manda la finestra (`assignPayload`): la richiesta al
  // referente, una domanda con «Serve un file», la richiesta al referente vista (nessuna).
  const assign = await import("./assign-dialog-state.ts");
  const payload = assign.assignPayload(
    { choice: contacts.fabio, name: "", email: "", role: "", needIds: free.slice(0, 1), fileRequired: free.slice(0, 1), message: "" },
    { mode: "scegli", questions: free, panel: before, previous: null },
  );
  assert.deepEqual([payload.kind, payload.expectedReferentRequestId, payload.fileRequired], ["referente", null, free.slice(0, 1)]);
  const sent = ok(await referents.sendReferentRequest(as("builder"), ids.card, payload, { env: ENV, requester: { name: NAMES.builder, emailVerified: true } }), "scegli il referente");
  // Lo stesso clic ripetuto (rete lenta, doppio clic) entro 60 secondi: la stessa richiesta, niente di nuovo.
  const again = ok(await referents.sendReferentRequest(as("builder"), ids.card, payload, { env: ENV, requester: { name: NAMES.builder, emailVerified: true } }), "di nuovo");
  assert.equal(again.requestId, sent.requestId);
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer: fakeMailer(), sendIntervalMs: 0 });
  const element = await detailElement("builder");
  const [panel] = findProp(element, "referents").filter(Boolean) as Panel[];
  assert.equal(panel.referent?.contact.id, contacts.fabio);
  // Le risposte di Mario e del team sono ancora da verificare (§3.4: vince «Risposte da verificare»).
  assert.equal(panel.referent?.state, "da_verificare");
  assert.equal(panel.referent?.live, true);
  assert.equal(panel.referent?.referentRequestId, sent.requestId);
  assert.equal(panel.latestReferentRequestId, sent.requestId);
  const page = readable(renderToStaticMarkup(element));
  assert.match(page, /data-slot="referent-block" data-state="da_verificare"/);
  assert.ok(page.includes(`>${B.heading}<`));
  assert.ok(page.includes(NAMES.fabio));
  assert.match(page, /In attesa del referente · inviata il \d{1,2} [a-z]{3} · scade il \d{1,2} [a-z]{3}/);
  // (Rilascio 6, B.1.2) Lo stato si dice una volta, nel blocco: niente riga sotto il titolo.
  assert.ok(!page.includes('data-slot="referent-line"'));
  // «Chiedi a un'altra persona» solo con un referente; mai «Chiedi al referente» del rilascio 4 su questo use case.
  assert.ok(page.includes(`${A.other}</button>`));
  assert.ok(!page.includes(`>${T.ask}</button>`));
  // Il blocco non ha pulsanti pieni; «Altro» ha promemoria, cambio, revoca.
  const block = page.slice(page.indexOf('data-slot="referent-block"'), page.indexOf("</section>", page.indexOf('data-slot="referent-block"')));
  assert.doesNotMatch(block, /bg-primary/);
  assert.ok(block.includes(`>${B.more}<`));
  // «Richieste inviate»: le richieste a Mario sì, quella al referente no (D34).
  const requests = page.slice(page.indexOf('data-slot="referent-requests"'));
  assert.ok(requests.includes(MARIO.name));
  assert.ok(!requests.slice(0, requests.indexOf("</details>")).includes(NAMES.fabio), "la richiesta al referente sta nel suo blocco");
  // Il contributore: niente nome, niente blocco.
  const contributor = await detailHtml("contributor");
  for (const text of [NAMES.fabio, 'data-slot="referent-block"', 'data-slot="referent-line"', A.other]) assert.ok(!contributor.includes(text), text);

  // «Cambia referente» con il contenuto della finestra: Mario, che ha già delle domande aperte (D49),
  // diventa il referente; la richiesta di Fabio è revocata e le domande aperte passano a Mario.
  const row = assign.assignContactRow(panel.contacts.find((c) => c.id === MARIO.id)!, panel);
  assert.deepEqual(row, { selectable: true, suffix: A.hasQuestions });
  const draft = { choice: MARIO.id, name: "", email: "", role: "", needIds: [] as string[], fileRequired: [] as string[], message: "" };
  const carried = assign.carriedNeedIds(panel, "cambia", draft);
  assert.ok(carried.length > 0, "le domande aperte di Mario e di Fabio");
  const questions = assign.assignQuestionIds(panel, "cambia", carried, Object.keys(panel.needs));
  const change = assign.assignPayload({ ...draft, needIds: carried }, { mode: "cambia", questions, panel, previous: null });
  assert.deepEqual([change.kind, change.replaceReferent, change.expectedReferentRequestId], ["referente", true, sent.requestId]);
  const changed = ok(await referents.sendReferentRequest(as("builder"), ids.card, change, { env: ENV, requester: { name: NAMES.builder, emailVerified: true } }), "cambia referente");
  const [federicoRequest] = await q(`SELECT status FROM use_case_referent_requests WHERE id = $1::uuid`, [sent.requestId]);
  assert.equal(federicoRequest.status, "revocata");
  const [after] = findProp(await detailElement("builder"), "referents").filter(Boolean) as Panel[];
  assert.equal(after.referent?.contact.id, MARIO.id);
  assert.equal(after.referent?.referentRequestId, changed.requestId);
  assert.equal((await q(`SELECT count(*)::int AS n FROM use_case_referent_requests WHERE use_case_id = $1::uuid AND contact_id = $2::uuid AND status = 'inviata'`, [ids.card, MARIO.id]))[0].n, 1, "una sola richiesta viva a Mario");
});

test("(rilascio 5.1) la risposta per beneficio sulla scheda: ogni voce con la risposta accanto, «Usa la stima di {Nome}» sotto la voce, mai pieno; il contributore niente", opts, async () => {
  const B = labels.REFERENT_BLOCK_TEXT;
  const model = {
    v: 1,
    primary: "tempo",
    components: [
      { kind: "ore", key: "tempo-1", lever: "tempo", label: "Controllo delle fatture", confidence: "ipotesi", volumeYear: 3000, minutesPerUnit: 12, automatablePct: 50 },
      { kind: "euro", key: "costi-1", lever: "costi", label: "Meno solleciti", confidence: "ipotesi", eurYear: 4000 },
      { kind: "qualitativo", key: "qualita-1", lever: "qualita", label: "Meno errori", confidence: "da_misurare" },
    ],
  };
  await q(`UPDATE use_cases SET value_model = $2::jsonb WHERE id = $1::uuid`, [ids.card, JSON.stringify(model)]);
  const [panel] = findProp(await detailElement("builder"), "referents").filter(Boolean) as Panel[];
  const requestId = panel.referent!.referentRequestId;
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId, env: ENV, mailer, sendIntervalMs: 0 });
  const token = /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(mailer.outbox[0]?.text ?? "")?.[1];
  assert.ok(token, "il link del referente");
  const first = await pub.resolveReferentToken(token!, new Date());
  if (first.access !== "ok") assert.fail("link");
  ok(await pub.acceptReferentPrivacy(first.link, { version: "ucq-2026-11-2" }, new Date()) as never, "informativa");
  const resolved = await pub.resolveReferentToken(token!, new Date());
  if (resolved.access !== "ok") assert.fail("link");
  const link = resolved.link;
  ok(await pub.saveReferentCheck(link, { step: 1, confirm: "si", note: null }, new Date()) as never, "passo 1");
  const seen = { "tempo-1": { kind: "ore", volumeYear: 3000, minutes: 12, eurYear: null }, "costi-1": { kind: "euro", volumeYear: null, minutes: null, eurYear: 4000 }, "qualita-1": { kind: "qualitativo", volumeYear: null, minutes: null, eurYear: null } };
  ok(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "tempo-1", seen: seen["tempo-1"], answer: "piu", timesPerMonth: 300 } }, new Date()) as never, "ore");
  ok(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "costi-1", seen: seen["costi-1"], answer: "si" } }, new Date()) as never, "euro");
  ok(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "qualita-1", seen: seen["qualita-1"], answer: "no", comment: "Solo a fine mese." } }, new Date()) as never, "qualitativa");
  const view = await pub.loadReferentAskPage(token!, { env: ENV, now: new Date() });
  if (view.access !== "ok") assert.fail("vista");
  for (const qn of view.view.questions.filter((x) => x.state === "aperta")) ok(await pub.saveReferentDraft(link, { needId: qn.needId, text: null, dontKnow: true }, new Date()) as never, "non ce l'ho");
  ok(await pub.submitReferentAnswers(link, {}, new Date()) as never, "invia");

  const page = await detailHtml("builder");
  const block = page.slice(page.indexOf('data-slot="referent-block"'), page.indexOf("</section>", page.indexOf('data-slot="referent-block"')));
  for (const text of [
    "Controllo delle fatture: il team stimava 600 ore di lavoro l'anno.",
    "è di più. Circa 720 ore (300 al mese, 12 minuti).",
    "Meno solleciti: il team stimava 4.000 € l'anno.",
    "Meno errori.",
    // (Rilascio 6, B.5) «{Nome}: no.», non più «non succede».
    `${MARIO.name}: no.`,
    "Solo a fine mese.",
  ]) {
    assert.ok(block.includes(text), text);
  }
  assert.equal((block.match(/data-slot="referent-benefit-answer"/g) ?? []).length, 3);
  assert.match(block, /data-action="referent-adopt" data-benefit="tempo-1"/);
  assert.match(block, /data-action="referent-seen" data-benefit="qualita-1"/);
  assert.ok(!/data-benefit="costi-1"[^>]*data-action|data-action="[^"]+" data-benefit="costi-1"/.test(block), "«Sì»: niente da decidere");
  assert.ok(block.includes(`${labels.fillText(B.adopt, { Nome: MARIO.name })}</button>`));
  assert.doesNotMatch(block, /bg-primary/, "nessun pulsante pieno nel blocco");
  assert.ok(!block.includes("Il tempo:"), "niente righe della stima del tempo del rilascio 5");
  assert.ok(!block.includes("succede"), "«sì» / «no», mai «succede»");
  const contributor = await detailHtml("contributor");
  for (const text of ["Controllo delle fatture: il team stimava", "Solo a fine mese.", "referent-benefit-answer", "4.000 €"]) assert.ok(!contributor.includes(text), text);
});

test("(rilascio 6) il filo sulla scheda: «Chiedi un chiarimento» sotto ogni risposta, il chiarimento in attesa, «Messaggi» con «Rispondi», «Tocca a noi», il suggerimento dell'AI; mai pieno; il contributore niente", opts, async () => {
  const thread = await import("../../../../lib/db/queries/use-case-referent-thread.ts");
  const calendar = await import("../../../../lib/uc/calendar.ts");
  const R = labels.REFERENT_THREAD_TEXT;
  const now = new Date(calendar.romeLocalToUtc(calendar.addWorkingDays(calendar.romeDate(new Date()), 1), 10).getTime());
  const [panel] = findProp(await detailElement("builder"), "referents").filter(Boolean) as Panel[];
  const requestId = panel.referent!.referentRequestId;
  const tempo = panel.referent!.check!.benefits!.find((b) => b.key === "tempo-1")!;
  assert.equal(tempo.clarify?.pending, null, "si può chiedere un chiarimento sulla voce");
  ok(await thread.askReferentClarification(as("builder"), ids.card, { requestId, anchor: "beneficio", componentKey: "tempo-1", text: `Quante al mese, più o meno ${suffix}?` }, { env: ENV, now }), "chiarimento");
  // Il referente ha un dubbio, dal suo link.
  const [token] = (await q(`SELECT 1 FROM use_case_referent_tokens WHERE request_id = $1::uuid LIMIT 1`, [requestId])).map(() => "x");
  assert.ok(token);
  const link = { tokenId: randomUUID(), requestId, workspaceId: ids.ws, useCaseId: ids.card, contactId: panel.referent!.contact.id, status: "inviata" as const, privacyAccepted: true, expiresAt: new Date(Date.now() + 86_400_000) };
  const doubt = await thread.postReferentDoubt(link, { anchor: "generale", text: `Posso allegare un esempio ${suffix}?` }, new Date());
  assert.ok(doubt.ok, JSON.stringify(doubt));
  // Una proposta dell'AI su un'altra voce.
  await q(
    `INSERT INTO use_case_referent_suggestions (request_id, workspace_id, use_case_id, anchor, component_key, source_at, status, body) VALUES ($1::uuid, $2::uuid, $3::uuid, 'beneficio', 'qualita-1', now(), 'proposta', $4)`,
    [requestId, ids.ws, ids.card, `Succede ogni mese ${suffix}?`],
  );

  const page = await detailHtml("builder");
  const start = page.indexOf('data-slot="referent-block"');
  const block = page.slice(start, page.indexOf("</section>", start));
  assert.ok(block.includes(`${"Il referente ha chiesto qualcosa"}`), "lo stato");
  assert.ok(block.includes(`· ${R.turnTeam}`), "«Tocca a noi»");
  assert.ok(block.includes(`>${R.heading}<`), "«Messaggi»");
  assert.ok(block.includes(`Posso allegare un esempio ${suffix}?`), "il dubbio");
  assert.ok(block.includes(`Quante al mese, più o meno ${suffix}?`), "il chiarimento nel filo");
  assert.ok(block.includes(labels.fillText(R.pending, { testo: `Quante al mese, più o meno ${suffix}?` })), "il chiarimento in attesa sotto la voce");
  assert.match(block, /data-action="thread-reply"/, "«Rispondi» sul dubbio");
  assert.ok((block.match(/data-action="thread-clarify"/g) ?? []).length >= 2, "«Chiedi un chiarimento» sulle altre voci e sulla conferma");
  // «Chiedi un chiarimento» sullo use case sta sotto «Lo use case: confermato.», prima della prima voce: mai due
  // uguali di fila sotto l'ultima voce. La finestra dice di che cosa si chiede.
  const confirmedAt = block.indexOf(labels.REFERENT_BLOCK_TEXT.confirmed);
  const generalAt = block.indexOf('data-action="thread-clarify"');
  const firstBenefitAt = block.indexOf('data-slot="referent-benefit-answer"');
  assert.ok(confirmedAt > 0 && confirmedAt < generalAt && generalAt < firstBenefitAt, "sotto la conferma, prima delle voci");
  const lastBenefitAt = block.lastIndexOf('data-slot="referent-benefit-answer"');
  assert.ok((block.slice(lastBenefitAt).match(/data-action="thread-clarify"/g) ?? []).length <= 1, "sotto l'ultima voce solo il suo");
  const [general] = findProp(await detailElement("builder"), "referents").filter(Boolean) as Panel[];
  assert.equal(general.referent?.check?.clarify?.quote, "Lo use case: sì, è così.");
  assert.ok(block.includes(labels.fillText(R.suggestion, { testo: `Succede ogni mese ${suffix}?` })), "il suggerimento dell'AI");
  assert.ok(block.includes(`>${R.suggestionAsk}</button>`) && block.includes(`>${R.suggestionDismiss}</button>`));
  assert.doesNotMatch(block, /bg-primary/, "nessun pulsante pieno nel blocco");
  assert.ok(!block.includes("caso d'uso"), "sulla scheda «use case»");
  // Lo use case è da valutare: «Prossimo passo» resta la decisione («Rispondi al referente» vale da approvato, guided.test.ts).
  assert.match(page, /data-slot="next-step" data-key="H7"/);
  // Sotto le domande risposte «Non ce l'ho»: «Chiedi un chiarimento».
  const needs = page.slice(page.indexOf('data-slot="needs-requirements"'));
  assert.match(needs, /data-action="thread-clarify"/);
  // Il contributore: niente del filo, nessuna proposta.
  const contributor = await detailHtml("contributor");
  for (const text of [R.heading, R.clarify, R.reply, R.turnTeam, `Posso allegare un esempio ${suffix}?`, `Succede ogni mese ${suffix}?`, `Quante al mese, più o meno ${suffix}?`, "thread-"]) {
    assert.ok(!contributor.includes(text), `contributore: ${text}`);
  }
});
