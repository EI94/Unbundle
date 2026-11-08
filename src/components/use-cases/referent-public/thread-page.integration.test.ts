import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
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

// (Rilascio 6) «Il filo con il team» sulla pagina del referente, sul database di prova, dalle rotte vere e con la
// pagina vera `/rispondi/[token]` resa in questo processo:
// - dopo «Invia» il link resta vivo: un chiarimento del team apre la pagina su «Da completare», con solo le cose
//   nuove e un solo pulsante pieno («Invia»); sotto «Già inviato», con «Modifica» e «Ho un dubbio»;
// - la risposta al chiarimento dalla rotta: la richiesta torna completata, l'informazione «Da verificare», la
//   campanella e l'avviso a chi ha chiesto, la proposta dell'AI in coda;
// - «Ho un dubbio» su una voce e in generale, la risposta del team in «Da completare», poi «vista»;
// - «Modifica» fino ad «A posto» (decisione 3 del titolare), poi «Aggiungi qualcosa»; l'informativa nuova prima di scrivere;
// - le domande nuove nella stessa richiesta («Nuova domanda»);
// - un'email al giorno con tutte le novità («Hai 2 novità sul caso d'uso …»), il link rinnovato, poi il giorno dopo;
// - dopo una riapertura i soliti due promemoria, contati da lì, che parlano del chiarimento;
// - mai chi del team ha scritto, mai le proposte dell'AI, mai note, punteggi o altri use case.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Nessuna
// email vera (mailer finto), nessun modello vero. Dati sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
}
const opts = { skip: !enabled };

type Mail = import("../../../lib/uc/notify/dispatch.ts").OutgoingEmail;
type Link = import("../../../lib/db/queries/use-case-referent-public.ts").ReferentLink;
type Page = (props: { params: Promise<{ token: string }>; searchParams?: Promise<Record<string, string | undefined>> }) => Promise<unknown>;
type RouteModule = { POST?: (request: Request, ctx: { params: Promise<{ token: string }> }) => Promise<Response>; GET?: (request: Request, ctx: { params: Promise<{ token: string }> }) => Promise<Response> };

let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let renderToStaticMarkup: (element: unknown) => string;
let page: Page;
let referents: typeof import("../../../lib/db/queries/use-case-referents.ts");
let thread: typeof import("../../../lib/db/queries/use-case-referent-thread.ts");
let pub: typeof import("../../../lib/db/queries/use-case-referent-public.ts");
let dispatch: typeof import("../../../lib/db/queries/use-case-referent-dispatch.ts");
let calendar: typeof import("../../../lib/uc/calendar.ts");
let viewMod: typeof import("../../../lib/use-cases/referent/view.ts");
const routes: Record<string, RouteModule> = {};

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), other: randomUUID() };
const BASE = "http://localhost:3000";
const storageDir = mkdtempSync(join(tmpdir(), "rispondi-filo-"));
const ENV: Record<string, string | undefined> = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: BASE,
  UC_LOCAL_STORAGE_DIR: storageDir,
};
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_EMAIL_FROM", "NEXT_PUBLIC_APP_URL", "UC_LOCAL_STORAGE_DIR", "UC_SECRET", "VERCEL_ENV", "USE_CASE_REFERENTS", "USE_CASE_REFERENT_AI", "UC_ENABLED", "UC_WORKSPACE_IDS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

/** Il revisore che scrive i chiarimenti: il suo nome non deve mai arrivare alla pagina del referente. */
const OTHER_NAME = "Bruno Verdi";
const ctx = (who: "builder" | "other" = "builder") => ({
  workspaceId: ids.ws,
  actor: { userId: ids[who], role: "function_lead", isLateralSpace: false, kind: "persona" as const },
  channel: "pagina" as const,
});
function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}
const pok = <T,>(r: { ok: true; value: T } | { ok: false; code: string; message: string }, label = "esito"): T => {
  if (!r.ok) assert.fail(`${label}: atteso ok, ricevuto ${r.code} (${r.message})`);
  return r.value;
};

const MODEL = {
  v: 1,
  primary: "tempo",
  components: [{ kind: "ore", key: "tempo-1", lever: "tempo", label: "Controllo delle fatture", confidence: "ipotesi", volumeYear: 3000, unit: "pratiche", minutesPerUnit: 12, automatablePct: 50, basis: "Dal team" }],
};
const SEEN = { kind: "ore", volumeYear: 3000, minutes: 12, eurYear: null };
/** Un giorno lavorativo di Roma dopo oggi, alle 10:30: l'ora delle novità del team (dentro la finestra). */
let NOW: Date;

let cards = 0;
async function newCard(): Promise<{ id: string; code: string; needs: string[] }> {
  const id = randomUUID();
  cards++;
  const code = `FP-${String(1000 + cards)}`;
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, value_model, target_quarter, review_notes, value_eur_year)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Le fatture arrivano via PEC.', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed', $4::jsonb, '2027-Q1', 'NOTA-RISERVATA', 98765)`,
    [id, ids.ws, code, JSON.stringify(MODEL)],
  );
  const needs: string[] = [];
  for (const [n, title] of ["Volumi mensili", "Sistemi usati", "Esempio di pratica"].entries()) {
    const need = randomUUID();
    await q(`INSERT INTO use_case_needs (id, workspace_id, type, title, detail, status, owner_side, sort_order) VALUES ($1::uuid, $2::uuid, 'requisito', $3, 'DETTAGLIO-RISERVATO', 'da_chiedere', 'cliente', $4)`, [need, ids.ws, title, n]);
    await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [need, id]);
    needs.push(need);
  }
  return { id, code, needs };
}

const fakeMailer = () => {
  const outbox: Mail[] = [];
  return { outbox, async send(m: Mail) { outbox.push(m); return { ok: true as const }; } };
};
async function send(requestId: string, at?: Date): Promise<Mail[]> {
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId, env: ENV, now: at, mailer, sendIntervalMs: 0 });
  return mailer.outbox;
}

async function linkOf(token: string): Promise<Link> {
  const r = await pub.resolveReferentToken(token, new Date());
  if (r.access !== "ok") assert.fail(`link: ${r.access}`);
  return r.link;
}

let seq = 0;
/** Il referente riceve il link, legge l'informativa, conferma, risponde sulla voce e alle prime due domande, invia. */
async function answeredReferent(card: { id: string; needs: string[] }): Promise<{ requestId: string; token: string; email: string }> {
  const email = `aldo.${seq++}.${suffix}@topjet.test`;
  const sent = ok(
    await referents.sendReferentRequest(
      ctx(),
      card.id,
      { kind: "referente", expectedReferentRequestId: null, contact: { kind: "nuovo", displayName: "Aldo Prova", email }, needIds: card.needs.slice(0, 2) },
      { env: ENV, requester: { name: "Giulia Neri", emailVerified: true } },
    ),
    "invio",
  );
  const outbox = await send(sent.requestId);
  const token = /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(outbox[0]?.text ?? "")?.[1];
  assert.ok(token, "il link nell'email");
  pok(await pub.acceptReferentPrivacy(await linkOf(token!), { version: "ucq-2026-11-2" }, new Date()) as never, "informativa");
  const link = await linkOf(token!);
  pok(await pub.saveReferentCheck(link, { step: 1, confirm: "si", note: null }, new Date()) as never, "passo 1");
  pok(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "tempo-1", seen: SEEN, answer: "meno", timesPerMonth: 200 } }, new Date()) as never, "passo 2");
  pok(await pub.saveReferentDraft(link, { needId: card.needs[0], text: "Circa 200 al mese", dontKnow: false }, new Date()) as never, "bozza 1");
  pok(await pub.saveReferentDraft(link, { needId: card.needs[1], text: "Il gestionale", dontKnow: false }, new Date()) as never, "bozza 2");
  pok(await pub.submitReferentAnswers(link, {}, new Date()) as never, "invia");
  assert.match((await send(sent.requestId)).map((m) => m.subject).join("|"), /grazie per le risposte/);
  return { requestId: sent.requestId, token: token!, email };
}

function request(path: string, body: unknown): Request {
  return new Request(`${BASE}${path}`, { method: "POST", headers: { accept: "application/json", origin: BASE, "content-type": "application/json" }, body: JSON.stringify(body) });
}
/** Una chiamata alla rotta vera, con l'origine giusta. */
async function call(route: string, token: string, body: unknown) {
  const fn = routes[route]?.POST;
  assert.ok(fn, route);
  const res = await fn(request(`/api/rispondi/${token}/${route}`, body), { params: Promise.resolve({ token }) });
  const json = (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: string; message?: string };
  return { status: res.status, json };
}

function readable(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
async function html(token: string): Promise<string> {
  return readable(renderToStaticMarkup(await page({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) })));
}
/** I pulsanti pieni della pagina (quelli senza `variant`: il colore primario). */
function filledButtons(page: string): string[] {
  return [...page.matchAll(/<button[^>]*class="[^"]*\bbg-primary\b[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
}
/** Le etichette accessibili dei pulsanti («Ho un dubbio su «Volumi mensili»»). */
function ariaButtons(page: string): string[] {
  return [...page.matchAll(/<button[^>]*aria-label="([^"]*)"/g)].map((m) => m[1]);
}
/** Quello che la pagina del referente non mostra mai. */
function assertNothingPrivate(page: string, extra: string[] = []) {
  for (const secret of [OTHER_NAME, "NOTA-RISERVATA", "DETTAGLIO-RISERVATO", "98765", "98.765", "PROPOSTA-SEGRETA", "Forse chiedere", "Tocca a noi", ids.other, ...extra]) {
    assert.ok(!page.includes(secret), `la pagina non mostra «${secret}»`);
  }
  assert.doesNotMatch(page, /href="[^"]*\/(dashboard|login)\b/, "nessun link alla dashboard");
  assert.doesNotMatch(page, /\buse case\b/i, "«caso d'uso», mai «use case»");
}
const requestOf = async (id: string) => (await q(`SELECT status, version, reminder_count, expires_at, reopened_at FROM use_case_referent_requests WHERE id = $1::uuid`, [id]))[0];
const needStatus = async (id: string) => String((await q(`SELECT status FROM use_case_needs WHERE id = $1::uuid`, [id]))[0]?.status);

before(async () => {
  if (!enabled) return;
  const { default: ts } = await import("typescript");
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "@/lib/auth": stub("export async function auth() { throw new Error('la pagina pubblica non legge la sessione'); }"),
    "next/navigation": stub("export function redirect() { throw new Error('la pagina pubblica non rimanda altrove'); }\nexport function notFound() { throw new Error('la pagina pubblica non chiama notFound'); }\nexport function useRouter() { return { refresh() {}, push() {} }; }"),
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
  ENV.USE_CASE_HUB_WORKSPACES = ids.ws;
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.UC_EMAIL_FROM = ENV.UC_EMAIL_FROM;
  process.env.NEXT_PUBLIC_APP_URL = BASE;
  process.env.UC_LOCAL_STORAGE_DIR = storageDir;
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
  page = ((await import("../../../app/rispondi/[token]/page.tsx")) as { default: Page }).default;
  referents = await import("../../../lib/db/queries/use-case-referents.ts");
  thread = await import("../../../lib/db/queries/use-case-referent-thread.ts");
  pub = await import("../../../lib/db/queries/use-case-referent-public.ts");
  dispatch = await import("../../../lib/db/queries/use-case-referent-dispatch.ts");
  calendar = await import("../../../lib/uc/calendar.ts");
  viewMod = await import("../../../lib/use-cases/referent/view.ts");
  for (const route of ["doubt", "reply", "add", "edit", "seen", "draft", "submit"]) {
    routes[route] = (await import(`../../../app/api/rispondi/[token]/${route}/route.ts`)) as RouteModule;
  }
  NOW = new Date(calendar.romeLocalToUtc(calendar.addWorkingDays(calendar.romeDate(new Date()), 1), 10).getTime() + 30 * 60_000);
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione filo pagina', $2)`, [ids.org, `hub-filo-pagina-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'TopJet prova')`, [ids.ws, ids.org]);
  for (const [id, name, email] of [[ids.builder, "Giulia Neri", `builder.filo.${suffix}@cliente.test`], [ids.other, OTHER_NAME, `altro.filo.${suffix}@cliente.test`]] as const) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [id, email, name]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'function_lead')`, [ids.ws, id]);
  }
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
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
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.builder, ids.other]]);
});

test("un chiarimento del team apre la pagina su «Da completare»: solo la novità, un solo pulsante pieno; la risposta dalla rotta chiude il giro", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  // Prima di ogni novità: la pagina in sola lettura, con «Modifica» e «Ho un dubbio» sotto le risposte.
  const quiet = await html(r.token);
  assert.ok(quiet.includes("Hai risposto il"), "la scheda finale");
  assert.ok(!quiet.includes("Da completare"));
  assert.deepEqual(filledButtons(quiet), [], "in sola lettura nessun pulsante pieno");
  for (const label of ["Modifica la risposta a «Volumi mensili»", "Ho un dubbio su «Volumi mensili»", "Aggiungi qualcosa a «Controllo delle fatture»", "Ho un dubbio su «Controllo delle fatture»", "Ho un dubbio su «Fatture fornitori»"]) {
    assert.ok(ariaButtons(quiet).includes(label), label);
  }

  const asked = ok(
    await thread.askReferentClarification(ctx("other"), card.id, { requestId: r.requestId, anchor: "domanda", needId: card.needs[0], text: "Al mese o all'anno, più o meno?" }, { env: ENV, now: NOW }),
    "chiarimento",
  );
  // Una proposta dell'AI per i revisori: mai sulla pagina del referente.
  await q(
    `INSERT INTO use_case_referent_suggestions (request_id, workspace_id, use_case_id, anchor, need_id, source_at, status, body, model)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'domanda', $4::uuid, now(), 'proposta', 'PROPOSTA-SEGRETA?', 'modello-finto')`,
    [r.requestId, ids.ws, card.id, card.needs[1]],
  );
  const link = await linkOf(r.token);
  const view = await pub.loadReferentAskView(link, { env: ENV, now: new Date() });
  assert.deepEqual(viewMod.keyPaths(view).filter((k) => !viewMod.PUBLIC_VIEW_KEYS.includes(k)), [], "solo le chiavi del contratto");
  assert.equal(view.thread.followUp, true);
  assert.equal(view.thread.open, true);
  assert.deepEqual(view.thread.messages.map((m) => `${m.side}:${m.kind}:${m.anchor}:${m.waiting}:${m.fresh}`), ["team:chiarimento:domanda:true:false"]);
  assert.equal(view.thread.messages[0].text, "Al mese o all'anno, più o meno?");
  const json = JSON.stringify(view);
  for (const secret of [OTHER_NAME, ids.other, "PROPOSTA-SEGRETA", "modello-finto", "NOTA-RISERVATA", "DETTAGLIO-RISERVATO"]) assert.ok(!json.includes(secret), secret);
  assert.ok(new Date(`${view.expiresOn}T12:00:00Z`).getTime() > Date.now() + 29 * 86_400_000, "il link vale 30 giorni dalla novità");

  const news = await html(r.token);
  for (const text of ["Da completare", "Hai una novità.", "Chiarimento", "Su «Volumi mensili»", "Il team chiede: «Al mese o all'anno, più o meno?»", "La tua risposta", "0 di 1 fatte", "Già inviato", "Il team ha chiesto: «Al mese o all'anno, più o meno?»", "Il gestionale"]) {
    assert.ok(news.includes(text), `«${text}»`);
  }
  assert.deepEqual(filledButtons(news), ["Invia"], "un solo pulsante pieno: «Invia»");
  assert.ok(!news.includes("Prima di iniziare"), "l'informativa di questa versione è già letta");
  assertNothingPrivate(news);

  // La risposta dalla rotta: un codice fiscale si rifiuta con calma, poi la risposta vera.
  const refused = await call("reply", r.token, { messageId: asked.messageId, text: "Il mio codice è RSSMRA80A01H501U" });
  assert.equal(refused.status, 422);
  assert.match(String(refused.json.error), /^testo_/);
  const queuedBefore = (await q(`SELECT 1 FROM use_case_referent_suggestions WHERE request_id = $1::uuid AND need_id = $2::uuid AND status = 'da_fare'`, [r.requestId, card.needs[0]])).length;
  const sent = await call("reply", r.token, { messageId: asked.messageId, text: "Al mese: circa 250 nei mesi pieni." });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  const again = await call("reply", r.token, { messageId: asked.messageId, text: "Di nuovo" });
  assert.equal(again.status, 404, "il doppio clic non risponde due volte");
  assert.equal((await requestOf(r.requestId)).status, "completata");
  assert.equal(await needStatus(card.needs[0]), "in_verifica", "l'informazione torna «Da verificare»");
  const bell = await q(`SELECT kind FROM use_case_notifications WHERE use_case_id = $1::uuid AND recipient_user_id = $2::uuid AND kind = 'risposte'`, [card.id, ids.other]);
  assert.ok(bell.length > 0, "la campanella del team");
  const alert = await q(`SELECT answers FROM use_case_requester_email_items WHERE request_id = $1::uuid`, [r.requestId]);
  assert.ok(alert.some((a) => Number(a.answers) >= 1), "l'avviso a chi ha chiesto");
  const queued = await q(`SELECT status FROM use_case_referent_suggestions WHERE request_id = $1::uuid AND need_id = $2::uuid AND status = 'da_fare'`, [r.requestId, card.needs[0]]);
  assert.equal(queued.length, queuedBefore + 1, "l'AI guarda la risposta dopo, mai qui");
  const done = await html(r.token);
  assert.ok(!done.includes("Da completare"), "niente più di nuovo");
  for (const text of ["Hai risposto il", "Il team ha chiesto: «Al mese o all'anno, più o meno?»", "Hai risposto: «Al mese: circa 250 nei mesi pieni.»"]) assert.ok(done.includes(text), text);
  assertNothingPrivate(done);
});

test("«Ho un dubbio» su una voce e in generale; la risposta del team in «Da completare», poi «vista» sotto la sua voce", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const empty = await call("doubt", r.token, { anchor: "beneficio", componentKey: "tempo-1", text: "   " });
  assert.equal(empty.status, 422, "un dubbio vuoto");
  const doubt = await call("doubt", r.token, { anchor: "beneficio", componentKey: "tempo-1", text: "Contate anche i resi?" });
  assert.equal(doubt.status, 200, JSON.stringify(doubt.json));
  const general = await call("doubt", r.token, { anchor: "generale", text: "Chi vede queste risposte?" });
  assert.equal(general.status, 200);
  const unknown = await call("doubt", r.token, { anchor: "beneficio", componentKey: "voce-che-non-c-e", text: "Dubbio" });
  assert.equal(unknown.status, 404, "una voce che non è della richiesta");
  const bell = await q(`SELECT kind FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'domanda'`, [card.id]);
  assert.ok(bell.length >= 2, "«Il referente ha chiesto qualcosa» a ogni revisore");
  const alert = await q(`SELECT questions FROM use_case_requester_email_items WHERE request_id = $1::uuid`, [r.requestId]);
  assert.ok(alert.some((a) => Number(a.questions) >= 2), "l'avviso a chi ha chiesto conta le domande");
  // Il dubbio si vede sotto la sua voce, subito.
  assert.ok((await html(r.token)).includes("Hai chiesto: «Contate anche i resi?»"));

  const messageId = String(doubt.json.data?.messageId);
  const answered = ok(await thread.answerReferentDoubt(ctx("other"), card.id, { messageId, text: "Sì, anche i resi." }, { env: ENV, now: NOW }), "risposta del team");
  const view = await pub.loadReferentAskView(await linkOf(r.token), { env: ENV, now: new Date() });
  assert.deepEqual(view.thread.messages.filter((m) => m.side === "team").map((m) => `${m.kind}:${m.fresh}:${m.replyTo === messageId}`), ["risposta:true:true"]);
  const news = await html(r.token);
  for (const text of ["Da completare", "Hai una novità.", "Risposta del team", "Su «Controllo delle fatture»", "Il tuo dubbio: «Contate anche i resi?»", "Sì, anche i resi."]) assert.ok(news.includes(text), text);
  assert.deepEqual(filledButtons(news), [], "una risposta da leggere: niente da inviare");
  assertNothingPrivate(news);

  // La pagina l'ha mostrata: «vista». Un id che non è della richiesta non fa niente.
  const seen = await call("seen", r.token, { ids: [answered.messageId, randomUUID()] });
  assert.equal(seen.status, 200);
  assert.equal(seen.json.data?.seen, 1);
  assert.equal((await call("seen", r.token, { ids: [answered.messageId] })).json.data?.seen, 0, "una seconda volta niente");
  assert.equal((await call("seen", r.token, { ids: ["non-un-id"] })).status, 400);
  const later = await html(r.token);
  assert.ok(!later.includes("Da completare"));
  assert.ok(later.includes("Il team ha risposto: «Sì, anche i resi.»"), "sotto la sua voce");
  assert.ok(later.includes("Hai chiesto: «Chi vede queste risposte?»"), "il dubbio generale sotto «Il caso d'uso»");
});

test("«Modifica» finché il team non segna «A posto», poi «Aggiungi qualcosa»; con un'informativa vecchia prima l'informativa", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const edit = await call("edit", r.token, { needId: card.needs[1], text: "Il gestionale e un foglio Excel." });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  let view = await pub.loadReferentAskView(await linkOf(r.token), { env: ENV, now: new Date() });
  const q1 = view.questions.find((x) => x.needId === card.needs[1])!;
  assert.equal(q1.editable, true);
  assert.ok(q1.answer?.editedAt, "«Aggiornata»");
  assert.equal(q1.answer?.text, "Il gestionale e un foglio Excel.");
  const updated = await html(r.token);
  assert.ok(updated.includes("Aggiornata il"));
  assert.ok(updated.includes("Il gestionale e un foglio Excel."));
  // «A posto»: la risposta non si modifica più, si aggiunge.
  await q(`UPDATE use_case_needs SET status = 'validata', done_at = now() WHERE id = $1::uuid`, [card.needs[1]]);
  view = await pub.loadReferentAskView(await linkOf(r.token), { env: ENV, now: new Date() });
  assert.equal(view.questions.find((x) => x.needId === card.needs[1])!.editable, false);
  const locked = await html(r.token);
  assert.ok(ariaButtons(locked).includes("Aggiungi qualcosa a «Sistemi usati»"));
  assert.ok(!ariaButtons(locked).includes("Modifica la risposta a «Sistemi usati»"));
  assert.ok(ariaButtons(locked).includes("Modifica la risposta a «Volumi mensili»"), "l'altra si modifica ancora");
  const closed = await call("edit", r.token, { needId: card.needs[1], text: "Di nuovo" });
  assert.equal(closed.status, 409);
  assert.equal(closed.json.error, "risposta_chiusa");
  assert.match(String(closed.json.message), /«A posto»: puoi aggiungere qualcosa/);
  const added = await call("add", r.token, { anchor: "domanda", needId: card.needs[1], text: "Anche la PEC, da gennaio." });
  assert.equal(added.status, 200);
  assert.equal(await needStatus(card.needs[1]), "in_verifica", "di nuovo da verificare per il team");
  assert.equal((await call("add", r.token, { anchor: "beneficio", componentKey: "tempo-1", text: "D'estate sono la metà." })).status, 200);
  assert.equal((await call("add", r.token, { anchor: "generale", text: "Il caso d'uso vale anche per le note di credito." })).status, 200);
  assert.equal((await call("add", r.token, { anchor: "domanda", needId: card.needs[2], text: "Su una domanda mai fatta" })).status, 404, "solo su una risposta inviata");
  const after = await html(r.token);
  for (const text of ["Hai aggiunto: «Anche la PEC, da gennaio.»", "Hai aggiunto: «D'estate sono la metà.»", "Hai aggiunto: «Il caso d'uso vale anche per le note di credito.»"]) assert.ok(after.includes(text), text);
  // Un'informativa letta in una versione di prima: la pagina si legge, ma per scrivere al team serve «Iniziamo».
  await q(`UPDATE use_case_referent_requests SET privacy_notice_version = 'ucq-2026-11-1' WHERE id = $1::uuid`, [r.requestId]);
  const old = await call("doubt", r.token, { anchor: "generale", text: "Una domanda" });
  assert.equal(old.status, 409);
  assert.equal(old.json.error, "informativa_da_leggere");
  const readOnly = await html(r.token);
  assert.ok(readOnly.includes("Hai risposto il") && !readOnly.includes("Prima di iniziare"), "la sola lettura non chiede l'informativa");
  await q(`UPDATE use_case_referent_requests SET privacy_notice_version = 'ucq-2026-11-2' WHERE id = $1::uuid`, [r.requestId]);
});

test("le domande nuove alla stessa persona: «Nuova domanda» in «Da completare», poi «Invia» dalle rotte", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const v = Number((await requestOf(r.requestId)).version);
  ok(await referents.addToReferentRequest(ctx(), card.id, r.requestId, v, { needIds: [card.needs[2]] }, { env: ENV, now: NOW }), "domande nuove");
  assert.equal((await requestOf(r.requestId)).status, "inviata", "riaperta");
  const view = await pub.loadReferentAskView(await linkOf(r.token), { env: ENV, now: new Date() });
  const fresh = view.questions.find((x) => x.needId === card.needs[2])!;
  assert.equal(fresh.followUp, true);
  assert.equal(fresh.state, "aperta");
  const news = await html(r.token);
  for (const text of ["Da completare", "Hai una novità.", "Nuova domanda", "Esempio di pratica", "Già inviato", "Circa 200 al mese"]) assert.ok(news.includes(text), text);
  assert.deepEqual(filledButtons(news), ["Invia"]);
  assert.ok(ariaButtons(news).includes("Ho un dubbio su «Esempio di pratica»"));
  assertNothingPrivate(news);
  assert.equal((await call("draft", r.token, { needId: card.needs[2], text: "Una fattura di un fornitore di carta.", dontKnow: false })).status, 200);
  const submitted = await call("submit", r.token, { shown: [card.needs[2]] });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
  assert.equal((await requestOf(r.requestId)).status, "completata");
  assert.ok((await html(r.token)).includes("Una fattura di un fornitore di carta."));
});

test("un'email al giorno con tutte le novità: «Hai 2 novità sul caso d'uso …», mai i testi; un'altra novità lo stesso giorno parte il giorno dopo", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  ok(await thread.askReferentClarification(ctx("other"), card.id, { requestId: r.requestId, anchor: "domanda", needId: card.needs[0], text: "Più o meno quante?" }, { env: ENV, now: NOW }), "chiarimento");
  const v = Number((await requestOf(r.requestId)).version);
  ok(await referents.addToReferentRequest(ctx(), card.id, r.requestId, v, { needIds: [card.needs[2]] }, { env: ENV, now: NOW }), "domande nuove");
  const items = await q(`SELECT it.kind, it.new_questions, it.clarifications FROM use_case_referent_email_items it WHERE it.request_id = $1::uuid AND it.state = 'in_coda'`, [r.requestId]);
  assert.deepEqual(items.map((i) => `${i.kind}:${i.new_questions}:${i.clarifications}`), ["nuove:2:1"], "una voce sola, con le due novità");
  const mails = await send(r.requestId, new Date(NOW.getTime() + 60_000));
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, r.email);
  assert.match(mails[0].subject, /^TopJet prova: 2 novità sul caso d'uso «FP-\d+ · Fatture fornitori»$/);
  assert.match(mails[0].text, /Hai 2 novità sul caso d'uso «FP-\d+ · Fatture fornitori», da Giulia Neri: le trovi con lo stesso link\./);
  assert.match(mails[0].text, /Apri le novità/);
  assert.match(mails[0].text, /\/rispondi\/ucq_[A-Za-z0-9_-]{32}/);
  assert.match(mails[0].html, /Lateral Space via Unbundle/);
  for (const secret of ["Più o meno quante", "Esempio di pratica", OTHER_NAME]) assert.ok(!mails[0].text.includes(secret) && !mails[0].html.includes(secret), secret);
  assert.deepEqual(await send(r.requestId, new Date(NOW.getTime() + 120_000)), [], "lo stesso giorno niente altro");
  // La stessa giornata della prova (l'orologio del database è un altro): un'email è già partita oggi.
  await q(`UPDATE use_case_referent_emails SET sent_at = $2::timestamptz WHERE contact_id = (SELECT contact_id FROM use_case_referent_requests WHERE id = $1::uuid) AND status = 'inviata'`, [r.requestId, NOW.toISOString()]);
  await q(`UPDATE use_case_referent_requests SET last_email_at = $2::timestamptz WHERE id = $1::uuid`, [r.requestId, NOW.toISOString()]);
  const later = new Date(NOW.getTime() + 2 * 3_600_000);
  const replyFirst = await linkOf(r.token);
  const [clar] = await q(`SELECT id FROM use_case_referent_messages WHERE request_id = $1::uuid AND kind = 'chiarimento'`, [r.requestId]);
  pok(await thread.replyToReferentClarification(replyFirst, { messageId: String(clar.id), text: "Circa 250." }, new Date()) as never, "risposta");
  ok(await thread.askReferentClarification(ctx("other"), card.id, { requestId: r.requestId, anchor: "domanda", needId: card.needs[1], text: "Anche altri programmi?" }, { env: ENV, now: later }), "un altro chiarimento");
  const [next] = await q(
    `SELECT e.scheduled_at FROM use_case_referent_email_items it JOIN use_case_referent_emails e ON e.id = it.email_id WHERE it.request_id = $1::uuid AND it.state = 'in_coda'`,
    [r.requestId],
  );
  const tomorrow = calendar.romeLocalToUtc(calendar.addWorkingDays(calendar.romeDate(NOW), 1), 9);
  assert.equal(new Date(String(next.scheduled_at)).getTime(), tomorrow.getTime(), "alle 9 del giorno lavorativo dopo");
  assert.deepEqual(await send(r.requestId, new Date(later.getTime() + 60_000)), [], "non oggi");
  // Il giorno dopo per il database: le email di ieri non contano più come «oggi».
  await q(`UPDATE use_case_referent_emails SET sent_at = now() - interval '2 days' WHERE contact_id = (SELECT contact_id FROM use_case_referent_requests WHERE id = $1::uuid) AND status = 'inviata'`, [r.requestId]);
  const nextDay = await send(r.requestId, new Date(tomorrow.getTime() + 3_600_000));
  assert.equal(nextDay.length, 1);
  assert.match(nextDay[0].subject, /^TopJet prova: un chiarimento sul caso d'uso «FP-\d+ · Fatture fornitori»$/);
  const renewed = await requestOf(r.requestId);
  assert.ok(new Date(String(renewed.expires_at)).getTime() >= Date.now() + 29 * 86_400_000, "ogni novità rinnova il link per 30 giorni");
});

test("dopo una riapertura i soliti due promemoria, contati da lì, che parlano del chiarimento", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  // Il primo giro aveva già avuto il suo primo promemoria, dieci giorni fa.
  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const [contact] = await q(`SELECT contact_id FROM use_case_referent_requests WHERE id = $1::uuid`, [r.requestId]);
  const [old] = await q(
    `INSERT INTO use_case_referent_emails (workspace_id, contact_id, request_id, template, dedupe_key, due_at, scheduled_at, status, sent_at)
     VALUES ($1::uuid, $2::uuid, NULL, 'promemoria', $3, $4::timestamptz, $4::timestamptz, 'inviata', $4::timestamptz) RETURNING id`,
    [ids.ws, contact.contact_id, `vecchio:${r.requestId}`, tenDaysAgo],
  );
  await q(`INSERT INTO use_case_referent_email_items (email_id, request_id, workspace_id, kind, state) VALUES ($1::uuid, $2::uuid, $3::uuid, 'primo', 'inviata')`, [old.id, r.requestId, ids.ws]);
  await q(`UPDATE use_case_referent_requests SET reminder_count = 1 WHERE id = $1::uuid`, [r.requestId]);
  ok(await thread.askReferentClarification(ctx("other"), card.id, { requestId: r.requestId, anchor: "domanda", needId: card.needs[0], text: "Più o meno quante?" }, { env: ENV, now: NOW }), "chiarimento");
  const reopened = await requestOf(r.requestId);
  assert.equal(Number(reopened.reminder_count), 0);
  assert.ok(reopened.reopened_at, "riaperta");
  // L'email della novità parte all'ora della prova; la riapertura e l'ultima email si leggono a quell'ora
  // (l'orologio del database è un altro).
  assert.equal((await send(r.requestId, new Date(NOW.getTime() + 60_000))).length, 1);
  const base = NOW;
  await q(`UPDATE use_case_referent_requests SET last_email_at = $2::timestamptz, reopened_at = $2::timestamptz WHERE id = $1::uuid`, [r.requestId, base.toISOString()]);
  // Per il database quell'email non è di «oggi»: i giorni della prova vengono dopo.
  await q(`UPDATE use_case_referent_emails SET sent_at = now() - interval '2 days' WHERE contact_id = $1::uuid AND status = 'inviata' AND sent_at > now() - interval '1 day'`, [contact.contact_id]);
  // Il card dice quando: il terzo giorno lavorativo dalla riapertura.
  const day3 = calendar.addWorkingDays(calendar.romeDate(base), 3);
  const [d, m] = day3.split("-").reverse();
  const viewer = { userId: ids.builder, role: "function_lead", isLateralSpace: false, emailVerified: true, email: `builder.filo.${suffix}@cliente.test` } as never;
  const needsMod = await import("../../../lib/use-cases/needs.ts");
  const all = await (await import("../../../lib/db/queries/use-case-needs.ts")).listWorkspaceNeeds(ids.ws, viewer);
  const panel = await referents.loadUseCaseReferentPanel({
    workspaceId: ids.ws,
    useCaseId: card.id,
    viewer,
    session: { id: ids.builder, name: "Giulia Neri", email: `builder.filo.${suffix}@cliente.test`, emailVerified: true },
    role: "function_lead",
    needs: needsMod.needListsOfUseCase(all ?? [], card.id),
    eligible: true,
    env: ENV,
  });
  const lines = panel?.requests.find((x) => x.id === r.requestId)?.lines ?? [];
  assert.ok(lines.some((l) => l.includes(`Prossimo promemoria dal ${d}/${m}`)), lines.join(" | "));
  // Il giorno 2 niente; il giorno 3 il primo promemoria (prima di questo rilascio il vecchio lo bloccava per sempre).
  const day2 = calendar.romeLocalToUtc(calendar.addWorkingDays(calendar.romeDate(base), 2), 10);
  const early = fakeMailer();
  await referents.runReferentCron({ env: ENV, now: day2, mailer: early });
  assert.equal(early.outbox.filter((x) => x.to === r.email).length, 0, "il secondo giorno lavorativo no");
  const at3 = calendar.romeLocalToUtc(day3, 10);
  const mailer = fakeMailer();
  const counts = await referents.runReferentCron({ env: ENV, now: at3, mailer });
  assert.equal(counts.errors, 0, JSON.stringify(counts));
  const mine = mailer.outbox.filter((x) => x.to === r.email);
  assert.equal(mine.length, 1, JSON.stringify(counts));
  assert.match(mine[0].subject, /^TopJet prova: promemoria sul caso d'uso «FP-\d+ · Fatture fornitori»$/);
  assert.match(mine[0].text, /ti ricordiamo che Giulia Neri aspetta la tua risposta a un chiarimento sul caso d'uso «FP-\d+ · Fatture fornitori»\./);
  assert.doesNotMatch(mine[0].text, /domande aperte|0 domande/);
  assert.equal(Number((await requestOf(r.requestId)).reminder_count), 1);
});
