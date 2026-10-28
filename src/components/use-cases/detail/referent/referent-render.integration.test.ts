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
let labels: typeof import("../../../../lib/use-cases/referent/labels.ts");

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), federico: randomUUID(), contributor: randomUUID(), card: randomUUID() };
type Person = "builder" | "federico" | "contributor";
const PEOPLE: Person[] = ["builder", "federico", "contributor"];
const ROLE: Record<Person, string> = { builder: "function_lead", federico: "function_lead", contributor: "contributor" };
const emails: Record<Person, string> = {
  builder: `giulia.render.${suffix}@cliente.test`,
  federico: `federico.render.${suffix}@cliente.test`,
  contributor: `contrib.render.${suffix}@cliente.test`,
};
const NAMES: Record<Person, string> = { builder: `Giulia Neri ${suffix}`, federico: `Federico Barsi ${suffix}`, contributor: `Collega ${suffix}` };
const MARIO = { id: randomUUID(), name: `Mario Rossi ${suffix}`, email: `mario.rossi.${suffix}@cliente.test` };
const contacts = { builder: randomUUID(), federico: randomUUID() };
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
  labels = await import("../../../../lib/use-cases/referent/labels.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione scheda referenti', $2)`, [ids.org, `hub-scheda-ref-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, $3)`, [ids.ws, ids.org, `TopJet prova ${suffix}`]);
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

test("un revisore vede «Chiedi al referente» spento e ogni motivo insieme, con «Prepara le domande» accanto finché c'è da preparare; il contributore niente", opts, async () => {
  const T = labels.REFERENT_UI_TEXT;
  const askButton = (html: string) => new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*?${T.ask}</button>`).exec(html)?.[0] ?? "";
  const prepareButton = (html: string) => new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*?${T.prepare}</button>`).exec(html)?.[0] ?? "";
  // Prima di preparare: niente da chiedere, e le email e i fornitori tengono chiusa la finestra; le
  // domande standard si possono preparare lo stesso, con «Prepara le domande» accanto, e il motivo
  // «Non ci sono domande da fare» che lo nomina dice il vero.
  const empty = await detailHtml("builder");
  assert.match(askButton(empty), /disabled=""/);
  const prepare = prepareButton(empty);
  assert.ok(prepare, "«Prepara le domande» nel capitolo");
  assert.doesNotMatch(prepare, /disabled=""|aria-disabled="true"/);
  assert.match(prepare, /aria-describedby="cosa-serve-chiedi-motivi"/);
  const emptyGates = empty.slice(empty.indexOf('data-slot="referent-gates"'));
  for (const gate of ["sub_responsabili_mancanti", "email_non_configurata", "nessuna_domanda"]) assert.ok(emptyGates.includes(`data-gate="${gate}"`), gate);
  assert.ok(emptyGates.includes(T.gates.noQuestions), "il motivo «Non ci sono domande da fare»");
  assert.ok(!empty.includes(T.gates.noQuestionsPage));
  // Anche con l'email di chi guarda non verificata (un motivo suo) si può preparare.
  state.__hubServeSession = { user: { id: ids.builder, email: emails.builder, emailVerified: false, name: NAMES.builder, image: null } };
  const unverified = readable(renderToStaticMarkup(await pageOfDetail({ params: Promise.resolve({ workspaceId: ids.ws, useCaseId: ids.card }), searchParams: Promise.resolve({}) })));
  assert.ok(unverified.includes('data-gate="email_non_verificata"'), "il motivo dell'email non verificata");
  assert.ok(prepareButton(unverified), "«Prepara le domande» anche con l'email non verificata");
  // Il pulsante chiama l'azione di sempre: la stessa scrittura del server.
  ok(await referents.prepareReferentQuestions(as("builder"), ids.card), "Prepara le domande");
  flow.needs = await needsOfCard();
  assert.ok(flow.needs.length >= 4, `domande preparate: ${flow.needs.length}`);
  const page = await detailHtml("builder");
  for (const text of [T.ask, labels.REFERENT_UI_TEXT.gates.emailNotConfigured, T.gates.subprocessorsLink]) assert.ok(page.includes(text), text);
  // Dopo averle preparate non manca più niente da preparare: «Prepara le domande» sparisce dal
  // capitolo, e con le domande da fare non c'è più il motivo «Non ci sono domande da fare».
  assert.ok(!page.includes(T.prepare), "nessun «Prepara le domande» nel capitolo");
  assert.ok(!page.includes('data-gate="nessuna_domanda"'));
  assert.ok(!page.includes('data-slot="prepare-reason"'));
  // La persona di funzione può dare l'autorizzazione lei stessa: il testo lo dice, con il nome dell'azienda.
  assert.ok(page.includes(`TopJet prova ${suffix} deve autorizzare i fornitori che usiamo`), "fornitori da autorizzare");
  assert.match(page, /data-slot="referent-gates"[^>]*role="status"|role="status"[^>]*data-slot="referent-gates"/);
  assert.ok(page.includes(`/dashboard/${ids.ws}/settings#sub-responsabili`));
  // Il pulsante è spento e dice perché.
  const ask = askButton(page);
  assert.ok(ask, "il pulsante «Chiedi al referente»");
  assert.match(ask, /disabled=""/);
  assert.match(ask, /aria-describedby="cosa-serve-chiedi-motivi"/);
  assert.ok(!page.includes(T.requestsHeading), "nessuna richiesta ancora");
  assert.ok(!page.includes("In corso"));

  const contributor = await detailHtml("contributor");
  for (const text of [T.ask, T.prepare, T.gates.emailNotConfigured, T.requestsHeading, "Cosa serve"]) assert.ok(!contributor.includes(text), `contributore: ${text}`);
  assert.equal(findProp(await detailElement("contributor"), "referents").filter(Boolean).length, 0, "nessun pannello al contributore");
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
    contacts.federico,
    NAMES.federico,
    emails.federico,
    contacts.builder,
    NAMES.builder,
    emails.builder,
  ]);
  const [n0, n1, n2] = flow.needs;
  const sent = ok(
    await referents.sendReferentRequest(as("builder"), ids.card, { contact: { kind: "esistente", contactId: MARIO.id }, needIds: [n0, n1], message: "Ci serve per la stima." }, { env: ENV, requester: { name: NAMES.builder, emailVerified: true } }),
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
  // Il team risponde e allega un file su un'altra esigenza, dalla scheda.
  ok(await referents.addReviewerAnswer(as("builder"), ids.card, n2, { text: TEAM_ANSWER }, ENV), "risposta del team");
  const up = ok(await files.uploadReviewerFileServer(as("builder"), ids.card, { needId: n2, fileName: `regole-${suffix}.csv`, declaration: true, bytes: new Uint8Array(Buffer.from(`colonna;valore\n${"Regola: il margine si calcola dal costo orario\n".repeat(6)}`, "utf8")) }, ENV), "file del team");
  flow.fileId = up.fileId;

  const page = await detailHtml("builder");
  const T = labels.REFERENT_UI_TEXT;
  assert.ok(page.includes(T.requestsHeading));
  const requests = page.slice(page.indexOf('data-slot="referent-requests"'));
  assert.ok(requests.includes(MARIO.name));
  assert.ok(requests.includes(labels.REFERENT_STATUS_LABEL.inviata), "In attesa");
  assert.match(requests, /Inviata il \d{2}\/\d{2} · scade il \d{2}\/\d{2}/);
  for (const action of [T.remind, T.add, T.revoke, T.more]) assert.ok(requests.includes(action), action);
  // Sotto le esigenze: la riga della richiesta, poi risposte e file chiusi sotto «Risposte e file · n».
  assert.match(page, new RegExp(`Chiesta a ${MARIO.name} il \\d{2}/\\d{2} · Risposta ricevuta il \\d{2}/\\d{2}`));
  assert.ok(page.includes(ANSWER), "la risposta del referente");
  assert.ok(page.includes(TEAM_ANSWER), "la risposta del team");
  assert.ok(page.includes(`${NAMES.builder} (team)`), "autore del team");
  assert.ok(page.includes(`regole-${suffix}.csv`));
  assert.ok(page.includes(`href="/dashboard/${ids.ws}/use-cases/${ids.card}/allegati/${flow.fileId}"`), "«Scarica» passa dalla rotta con il controllo");
  assert.ok(page.includes(T.fileDownload));
  assert.match(page, /Risposte e file · 1/);
  assert.ok(page.includes(T.rowAddAnswer) && page.includes(T.rowAttachFile));
  assert.ok(!page.includes("In corso"), "nessun «In corso»");

  // Il contributore: niente richieste, niente referenti, niente risposte, niente file.
  const contributor = await detailHtml("contributor");
  for (const text of [T.requestsHeading, MARIO.name, ANSWER, TEAM_ANSWER, `regole-${suffix}.csv`, "/allegati/", T.silentTag, "Fa parte del team", "(sei tu)"]) {
    assert.ok(!contributor.includes(text), `contributore: ${text}`);
  }
});

test("il selettore: il proprio contatto «(sei tu)» e non si sceglie, un collega revisore «Fa parte del team»", opts, async () => {
  const [panel] = findProp(await detailElement("builder"), "referents").filter(Boolean) as Panel[];
  assert.ok(panel?.available);
  const choices = askState.contactChoices(panel);
  const own = choices.find((c) => c.value === contacts.builder);
  const colleague = choices.find((c) => c.value === contacts.federico);
  const mario = choices.find((c) => c.value === MARIO.id);
  assert.ok(own && colleague && mario);
  assert.ok(own.label.endsWith(labels.REFERENT_UI_TEXT.askDialog.suffix.sei_tu), own.label);
  assert.equal(own.disabled, true);
  assert.ok(colleague.label.includes(labels.REFERENT_UI_TEXT.askDialog.teamTag), colleague.label);
  assert.equal(colleague.disabled, false);
  assert.ok(!mario.label.includes(labels.REFERENT_UI_TEXT.askDialog.teamTag));
  assert.ok(mario.label.endsWith(labels.REFERENT_UI_TEXT.askDialog.suffix.richiesta_aperta), "Mario ha già una richiesta su questa scheda");
  assert.equal(askState.askSelfHint(panel), labels.REFERENT_UI_TEXT.askDialog.selfHint);
  // Federico vede il contrario: Giulia «Fa parte del team», lui «(sei tu)».
  const [forFederico] = findProp(await detailElement("federico"), "referents").filter(Boolean) as Panel[];
  const fromFederico = askState.contactChoices(forFederico);
  assert.ok(fromFederico.find((c) => c.value === contacts.builder)?.label.includes(labels.REFERENT_UI_TEXT.askDialog.teamTag));
  assert.ok(fromFederico.find((c) => c.value === contacts.federico)?.label.endsWith(labels.REFERENT_UI_TEXT.askDialog.suffix.sei_tu));
  // Mai un numero, un corso o un altro ruolo nelle voci.
  for (const choice of [...choices, ...fromFederico]) assert.doesNotMatch(choice.label, /corso|formazione|learner|contributor/i, choice.label);
  // Il contributore non riceve né il pannello né le voci.
  const contributor = await detailHtml("contributor");
  for (const text of [labels.REFERENT_UI_TEXT.askDialog.teamTag, labels.REFERENT_UI_TEXT.askDialog.suffix.sei_tu, labels.REFERENT_UI_TEXT.askDialog.selfHint]) assert.ok(!contributor.includes(text), text);
});
