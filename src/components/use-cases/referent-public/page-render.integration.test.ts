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

// La pagina vera `/rispondi/[token]` resa in questo processo (SPEC §4.4, §9.2, Parte 3 §P3.7):
// - le schede dei link che non si possono usare (non valido, revocato, scaduto, non disponibile);
// - l'informativa prima di tutto, le domande solo dopo;
// - mai dettaglio delle esigenze, proponente, note, valori, l'email del referente, link alla dashboard;
// - una domanda a cui ha già pensato il team: «Non serve più: ci ha già pensato il team.», mai il suo testo;
// - nessuna sessione: `@/lib/auth` qui fallisce se qualcuno la chiede.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
// 127.0.0.1). I `.tsx` si traducono qui con TypeScript. Dati sintetici, creati e cancellati qui.
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

type Ctx = import("../../../lib/use-cases/service.ts").WriteContext;
type Mail = import("../../../lib/uc/notify/dispatch.ts").OutgoingEmail;
type Page = (props: { params: Promise<{ token: string }> }) => Promise<unknown>;

let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let renderToStaticMarkup: (element: unknown) => string;
let page: Page;
let referents: typeof import("../../../lib/db/queries/use-case-referents.ts");
let pub: typeof import("../../../lib/db/queries/use-case-referent-public.ts");
let dispatch: typeof import("../../../lib/db/queries/use-case-referent-dispatch.ts");

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), useCase: randomUUID() };
const CODE = `RP-${String(1000 + Math.floor(Math.random() * 8000))}`;
const PROPOSER = `proponente.${suffix}@cliente.test`;
const storageDir = mkdtempSync(join(tmpdir(), "rispondi-pagina-"));
const ENV: Record<string, string | undefined> = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LOCAL_STORAGE_DIR: storageDir,
};
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_EMAIL_FROM", "UC_LOCAL_STORAGE_DIR", "USE_CASE_REFERENTS", "VERCEL_ENV", "UC_ENABLED", "UC_WORKSPACE_IDS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const as = (): Ctx => ({ workspaceId: ids.ws, actor: { userId: ids.builder, role: "function_lead", isLateralSpace: false, kind: "persona" }, channel: "pagina" });

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}

/** L'esito di un comando pubblico (`{ ok, value }` oppure `{ ok: false, code, message }`). */
function pok<T>(result: { ok: true; value: T } | { ok: false; code: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.code} (${result.message})`);
  return result.value;
}

/** L'HTML con le entità più comuni tolte, per cercare i testi come si leggono. */
function readable(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function html(token: string): Promise<string> {
  const element = await page({ params: Promise.resolve({ token }) });
  return readable(renderToStaticMarkup(element));
}

const needs: string[] = [];
let titles: string[] = [];

async function sendLink(email: string, needIds: string[], message: string | null = null): Promise<{ token: string; requestId: string }> {
  const sent = ok(
    await referents.sendReferentRequest(as(), ids.useCase, { contact: { kind: "nuovo", displayName: "Mario Rossi", email }, needIds, message }, { env: ENV, requester: { name: "Giulia Neri", emailVerified: true } }),
    "invio",
  );
  const outbox: Mail[] = [];
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer: { async send(m: Mail) { outbox.push(m); return { ok: true as const }; } }, sendIntervalMs: 0 });
  const token = /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(outbox[0]?.text ?? "")?.[1];
  assert.ok(token, "il link è nell'email");
  return { token, requestId: sent.requestId };
}

async function linkOf(token: string) {
  const resolved = await pub.resolveReferentToken(token, new Date());
  assert.equal(resolved.access, "ok");
  if (resolved.access !== "ok") throw new Error("link");
  return resolved.link;
}

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
  process.env.UC_LOCAL_STORAGE_DIR = storageDir;
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
  page = ((await import("../../../app/rispondi/[token]/page.tsx")) as { default: Page }).default;
  referents = await import("../../../lib/db/queries/use-case-referents.ts");
  pub = await import("../../../lib/db/queries/use-case-referent-public.ts");
  dispatch = await import("../../../lib/db/queries/use-case-referent-dispatch.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione pagina', $2)`, [ids.org, `hub-pagina-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'TopJet prova')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, 'Giulia Neri', now())`, [ids.builder, `builder.pagina.${suffix}@cliente.test`]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'function_lead')`, [ids.ws, ids.builder]);
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, proposed_by, review_notes, value_eur_year)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'DESCRIZIONE-RISERVATA', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed', $4, 'NOTA-RISERVATA', 98765)`,
    [ids.useCase, ids.ws, CODE, PROPOSER],
  );
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  ok(await referents.prepareReferentQuestions(as(), ids.useCase), "prepara");
  const rows = await q(`SELECT n.id::text AS id, n.title FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid ORDER BY n.sort_order, n.id`, [ids.useCase]);
  needs.push(...rows.map((r) => String(r.id)));
  titles = rows.map((r) => String(r.title));
  assert.ok(needs.length >= 6, "sei domande preparate");
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
  await q(`DELETE FROM users WHERE id = $1::uuid`, [ids.builder]);
});

/** Quello che la pagina non mostra mai, in nessuno stato. */
function assertNothingPrivate(page: string, extra: string[] = []) {
  for (const secret of ["NOTA-RISERVATA", "DESCRIZIONE-RISERVATA", "98765", "98.765", PROPOSER, "Serve per stimare", "@topjet.test", ...extra]) {
    assert.ok(!page.includes(secret), `la pagina non mostra «${secret}»`);
  }
  assert.doesNotMatch(page, /href="[^"]*\/(dashboard|login)\b/, "nessun link alla dashboard o all'accesso");
  assert.ok(page.includes("Lateral Space via Unbundle."), "il piè di pagina");
}

const state = { token: "", requestId: "" };

test("prima l'informativa: nessuna domanda, bozza o caricamento prima di «Ho letto, iniziamo»", opts, async () => {
  const link = await sendLink(`mario.rossi.${suffix}@topjet.test`, needs.slice(0, 2), "Ci serve per la stima di fine mese.");
  Object.assign(state, link);
  const first = await html(link.token);
  for (const text of [
    "TopJet prova",
    `${CODE} · Fatture fornitori`,
    "Giulia Neri ti chiede alcune informazioni.",
    "Il messaggio di Giulia Neri",
    "Ci serve per la stima di fine mese.",
    "Prima di iniziare",
    "Tre cose da sapere sulle tue risposte.",
    "Leggi l'informativa completa",
    "Ho letto, iniziamo",
    "Come usiamo le tue risposte",
  ]) {
    assert.ok(first.includes(text), text);
  }
  assert.match(first, /<h1[^>]*>[^<]*Fatture fornitori<\/h1>/);
  for (const absent of ["La tua risposta", "Invia le risposte", "Allega un file", "Domanda 1 di 2", titles[0], titles[1]]) assert.ok(!first.includes(absent), `prima dell'informativa: niente «${absent}»`);
  assert.doesNotMatch(first, /<textarea|type="file"/);
  assertNothingPrivate(first);
});

test("dopo l'informativa: le domande con risposta, «Non lo so», file e invio", opts, async () => {
  pok(await pub.acceptReferentPrivacy(await linkOf(state.token), { version: "ucq-2026-10-1" }, new Date()), "informativa");
  const shown = await html(state.token);
  for (const text of [
    "Domanda 1 di 2",
    "Domanda 2 di 2",
    titles[0],
    titles[1],
    "La tua risposta",
    "Scrivi qui. Bastano poche righe.",
    "Non lo so",
    "Il file non contiene dati sanitari né dati personali che non ti abbiamo chiesto.",
    "Allega un file",
    "PDF, Word, Excel, PowerPoint, CSV o testo. Fino a 4 MB. Niente foto.",
    "Invia le risposte",
    "Invii solo le domande a cui hai risposto. Le altre restano qui: puoi tornare con lo stesso link fino al",
  ]) {
    assert.ok(shown.includes(text), text);
  }
  assert.ok(!shown.includes("Prima di iniziare"), "il riquadro dell'informativa non c'è più");
  for (const other of titles.slice(2)) assert.ok(!shown.includes(other), "solo le domande di questa richiesta");
  assert.match(shown, /<textarea[^>]*maxLength="4000"|<textarea[^>]*maxlength="4000"/);
  assertNothingPrivate(shown);
});

test("(Parte 3) una domanda a cui ha già pensato il team: «Non serve più», mai il suo testo; poi la scheda «vuota»", opts, async () => {
  ok(await referents.addReviewerAnswer(as(), ids.useCase, needs[1], { text: "Usano il gestionale interno TESTO-DEL-TEAM." }), "risposta del team");
  const partly = await html(state.token);
  assert.ok(partly.includes("Non serve più: ci ha già pensato il team."));
  assert.ok(partly.includes("Domanda 2 di 2"), "conta come le altre");
  assert.ok(!partly.includes("TESTO-DEL-TEAM"), "mai cosa ha scritto il team");
  assert.ok(!partly.includes("Giulia Neri (team)"), "mai chi");
  assert.equal((partly.match(/<textarea/g) ?? []).length, 1, "un solo campo: la domanda ancora aperta");
  assertNothingPrivate(partly, ["TESTO-DEL-TEAM"]);

  ok(await referents.addReviewerAnswer(as(), ids.useCase, needs[0], { text: "Venti al giorno ALTRO-TESTO-DEL-TEAM." }), "seconda risposta del team");
  const done = await html(state.token);
  assert.ok(done.includes("Non ci sono più domande per te. Grazie per la disponibilità."));
  assert.ok(!done.includes("Hai risposto a tutte le domande. Grazie!"));
  assert.equal((done.match(/Non serve più: ci ha già pensato il team\./g) ?? []).length, 2);
  assert.doesNotMatch(done, /<textarea|type="file"|Invia le risposte/);
  assertNothingPrivate(done, ["TESTO-DEL-TEAM", "ALTRO-TESTO-DEL-TEAM"]);
});

test("una risposta inviata si legge, in sola lettura, con «Inviata il …»; poi «Hai risposto a tutte le domande»", opts, async () => {
  const link = await sendLink(`anna.bianchi.${suffix}@topjet.test`, needs.slice(2, 3));
  const l = await linkOf(link.token);
  pok(await pub.acceptReferentPrivacy(l, { version: "ucq-2026-10-1" }, new Date()), "informativa");
  const l2 = await linkOf(link.token);
  pok(await pub.saveReferentDraft(l2, { needId: needs[2], text: "Due persone, mezza giornata.", dontKnow: false }, new Date()), "bozza");
  const draftPage = await html(link.token);
  assert.ok(draftPage.includes("Due persone, mezza giornata."), "la bozza torna nel campo");
  pok(await pub.submitReferentAnswers(l2, {}, new Date()), "invio");
  const sent = await html(link.token);
  assert.ok(sent.includes("Hai risposto a tutte le domande. Grazie!"));
  assert.match(sent, /Inviata il \d{2}\/\d{2}/);
  assert.ok(sent.includes("Due persone, mezza giornata."));
  assert.doesNotMatch(sent, /<textarea|Invia le risposte/);
  assertNothingPrivate(sent);
});

test("le schede dei link che non si possono usare, senza dati della richiesta", opts, async () => {
  const unknown = await html(`ucq_${randomBytes(24).toString("base64url")}`);
  assert.ok(unknown.includes("Link non valido"));
  assert.ok(unknown.includes("Questo link non è più valido. Chiedi a chi te l'ha mandato un link nuovo."));
  assert.ok((await html("non-un-link")).includes("Link non valido"));

  const toRevoke = await sendLink(`luca.verdi.${suffix}@topjet.test`, needs.slice(3, 4));
  const [r] = await q(`SELECT version FROM use_case_referent_requests WHERE id = $1::uuid`, [toRevoke.requestId]);
  ok(await referents.revokeReferentRequest(as(), ids.useCase, toRevoke.requestId, Number(r.version)), "revoca");
  const revoked = await html(toRevoke.token);
  assert.ok(revoked.includes("Link revocato"));
  assert.ok(!revoked.includes("Fatture fornitori") && !revoked.includes("Giulia Neri"), "niente della richiesta");

  const toExpire = await sendLink(`sara.neri.${suffix}@topjet.test`, needs.slice(4, 5));
  await q(`UPDATE use_case_referent_tokens SET expires_at = now() - interval '1 minute' WHERE request_id = $1::uuid`, [toExpire.requestId]);
  const expired = await html(toExpire.token);
  assert.ok(expired.includes("Link scaduto"));
  assert.ok(!expired.includes("Fatture fornitori"));

  process.env.USE_CASE_REFERENTS = "off";
  try {
    assert.ok((await html(state.token)).includes("Non disponibile"));
  } finally {
    delete process.env.USE_CASE_REFERENTS;
  }
  for (const p of [unknown, revoked, expired]) {
    assert.doesNotMatch(p, /href="[^"]*\/(dashboard|login)\b/);
    assert.ok(p.includes("Lateral Space via Unbundle."));
  }
});
