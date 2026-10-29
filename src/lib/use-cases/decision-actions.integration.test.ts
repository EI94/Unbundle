import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";
import { DEFAULT_REVIEW_TEAM_NAME } from "../review-team.ts";
import { questionLabel } from "./answers.ts";

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format?: string; source?: string | Uint8Array; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult;
    load?(url: string, context: object, nextLoad: (url: string, context: object) => LoadResult): LoadResult;
  }): void;
};

// Decisioni dalla pagina (docs/use-case/PIANO-LAVORI.md H3b; docs/use-case/DESIGN.md §3.6,
// §3.7, §6.4, §6.5, §8.6, §9.1, §12.5 criterio 5, §14.3; decisione D3): le server action di
// src/lib/actions/use-case-decisions.ts con una sessione finta, e il capitolo «Decisione»
// reso in HTML per ruolo e per fase.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del
//   pacchetto hub_<id> su 127.0.0.1): `@/lib/auth` diventa un modulo che restituisce la
//   sessione scelta dalla prova; ruolo, accesso e «Lateral Space» si rileggono dal database
//   come nell'app. `revalidatePath` di `next/cache` registra i percorsi invece di toccare la
//   cache di Next, che qui non c'è. I file `.tsx` si traducono qui con TypeScript.
// - Dentro `npm run check` si salta: in testa solo moduli di Node; i moduli dell'app
//   arrivano con `await import()` dentro `before()`. Dati sintetici, creati e cancellati qui.
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

type Actions = typeof import("../actions/use-case-decisions.ts");
type DecisionUi = typeof import("./decision-ui.ts");
type Quarter = typeof import("./quarter.ts");
type Service = typeof import("./service.ts");
type Section = typeof import("../../components/use-cases/detail/section-decision.tsx");
type Buttons = typeof import("../../components/use-cases/decision-buttons.tsx");
type Result = import("./decision-ui.ts").DecisionActionResult;
type Item = import("./decision-ui.ts").DecisionItem;

let actions: Actions;
let ui: DecisionUi;
let quarter: Quarter;
let svc: Service;
let section: Section;
let buttons: Buttons;
let renderToStaticMarkup: (element: unknown) => string;
let createElement: typeof import("react").createElement;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  wsOff: randomUUID(),
  ls: randomUUID(),
  builder: randomUUID(),
  manager: randomUUID(),
  contributor: randomUUID(),
  learner: randomUUID(),
  outsider: randomUUID(),
};
const emails = {
  ls: `ls.${suffix}@ls.test`,
  builder: `builder.${suffix}@cliente.test`,
  manager: `manager.${suffix}@cliente.test`,
  contributor: `contributor.${suffix}@cliente.test`,
  learner: `learner.${suffix}@cliente.test`,
  outsider: `outsider.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;

const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "VERCEL_ENV"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const state = globalThis as { __hubH3bSession?: unknown; __hubH3bRevalidated?: string[] };

function signIn(person: Person | null): void {
  state.__hubH3bSession = person
    ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}`, image: null } }
    : null;
}

function revalidated(): string[] {
  const paths = state.__hubH3bRevalidated ?? [];
  state.__hubH3bRevalidated = [];
  return paths;
}

let codeSeq = 100;

interface CardSeed {
  workspaceId?: string;
  title?: string;
  status?: string;
  review?: string;
  kind?: string | null;
  code?: string | null;
  intake?: Record<string, unknown> | null;
  publicNote?: string | null;
  reviewedBy?: string | null;
  targetQuarter?: string | null;
  valueEurYear?: number | null;
}

/** Una scheda sintetica in uno stato preciso, scritta senza passare dal servizio. */
async function seed(c: CardSeed = {}): Promise<{ id: string; code: string | null }> {
  const id = randomUUID();
  const code = c.code === undefined ? `XX-${String(codeSeq++).padStart(4, "0")}` : c.code;
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code,
       intake, public_note, reviewed_by, target_quarter, value_eur_year, source)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', $4::use_case_status, $5::portfolio_review_status, $6, $7,
       $8::jsonb, $9, $10::uuid, $11, $12, 'web_proposed')`,
    [
      id,
      c.workspaceId ?? ids.ws,
      c.title ?? `Proposta di prova ${suffix}`,
      c.status ?? "proposed",
      c.review ?? "in_review",
      c.kind === undefined ? "use_case_ai" : c.kind,
      code,
      c.intake === undefined ? null : JSON.stringify(c.intake),
      c.publicNote ?? null,
      c.reviewedBy ?? null,
      c.targetQuarter ?? null,
      c.valueEurYear ?? null,
    ],
  );
  return { id, code };
}

/** `intake` della scheda, come oggetto. */
async function intakeOf(id: string): Promise<Record<string, unknown> | null> {
  return ((await row(id)).intake as Record<string, unknown> | null) ?? null;
}

async function row(id: string): Promise<Record<string, unknown>> {
  const [r] = await q(`SELECT *, review_by::text AS review_by_text FROM use_cases WHERE id = $1::uuid`, [id]);
  assert.ok(r, "la scheda c'è");
  return r;
}

async function versionOf(id: string): Promise<number> {
  return Number((await row(id)).version);
}

async function storia(id: string): Promise<Record<string, unknown>[]> {
  return q(`SELECT action, channel, actor_kind, actor_user_id, fields, phase_before, phase_after FROM use_case_events WHERE use_case_id = $1::uuid ORDER BY at, id`, [id]);
}

function ok(result: Result, label = "esito"): Extract<Result, { ok: true }> {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result;
}

function err(result: Result, error: string, label = "esito"): Extract<Result, { ok: false }> {
  assert.equal(result.ok, false, `${label}: atteso un errore ${error}`);
  assert.equal((result as { error?: string }).error, error, label);
  return result as Extract<Result, { ok: false }>;
}

function pathsOf(useCaseId: string, workspaceId = ids.ws): string[] {
  return [`/dashboard/${workspaceId}/use-cases`, `/dashboard/${workspaceId}/use-cases/${useCaseId}`];
}

before(async () => {
  if (!enabled) return;
  const { default: ts } = await import("typescript");
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    // La sessione della prova al posto dei cookie di Firebase.
    "@/lib/auth": stub("export async function auth() { return globalThis.__hubH3bSession ?? null; }"),
    // La cache di Next non c'è fuori da una richiesta: si registrano i percorsi.
    "next/cache": stub(
      "export function revalidatePath(path) { (globalThis.__hubH3bRevalidated ??= []).push(path); }\n" +
        "export function revalidateTag() {}\nexport function refresh() {}\nexport function updateTag() {}\n" +
        "export function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}",
    ),
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
  actions = await import("../actions/use-case-decisions.ts");
  ui = await import("./decision-ui.ts");
  quarter = await import("./quarter.ts");
  svc = await import("./service.ts");
  section = await import("../../components/use-cases/detail/section-decision.tsx");
  buttons = await import("../../components/use-cases/decision-buttons.tsx");
  const react = await import("react");
  createElement = react.createElement;
  const { renderToStaticMarkup: toHtml } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as {
    AppRouterContext: import("react").Context<object | null>;
  };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  renderToStaticMarkup = (element) => toHtml(createElement(AppRouterContext.Provider, { value: router }, element as never));

  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H3b', $2)`, [ids.org, `hub-h3b-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova H3b'), ($2::uuid, $3::uuid, 'Prova H3b spento')`, [
    ids.ws,
    ids.wsOff,
    ids.org,
  ]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona di prova ${person}`]);
  }
  const memberships: Array<[string, Person, string]> = [
    [ids.ws, "ls", "transformation_lead"],
    [ids.ws, "builder", "function_lead"],
    [ids.ws, "manager", "exec_sponsor"],
    [ids.ws, "contributor", "contributor"],
    [ids.ws, "learner", "learner"],
    [ids.wsOff, "builder", "function_lead"],
  ];
  for (const [workspaceId, person, role] of memberships) {
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [workspaceId, ids[person], role]);
  }
  revalidated();
});

after(async () => {
  signIn(null);
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.wsOff]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

// ─── Criterio 5: l'AI Builder del cliente decide dalla pagina (D3) ───

test("l'AI Builder del cliente approva, rimanda e sceglie «Quando» dalla pagina, con toast, Storia e pagine rilette", opts, async () => {
  signIn("builder");
  const now = new Date();
  const card = await seed();
  const approved = ok(await actions.decideUseCaseAction(ids.ws, card.id, await versionOf(card.id), { type: "approva", quando: "questo_trimestre" }), "approva");
  assert.equal(approved.message, "Approvato. Lo trovi nella Panoramica.");
  let r = await row(card.id);
  assert.equal(r.status, "accepted");
  assert.equal(r.target_quarter, quarter.currentQuarter(now));
  assert.equal(r.review_by, null);
  assert.equal(approved.version, Number(r.version), "la versione restituita è quella salvata");
  assert.deepEqual(revalidated(), pathsOf(card.id));
  const [approval] = (await storia(card.id)).slice(-1);
  assert.equal(approval.action, "decisione");
  assert.equal(approval.channel, "pagina");
  assert.equal(approval.actor_user_id, ids.builder);
  assert.equal(approval.phase_after, "approvato.trimestre");

  const when = ok(await actions.setWhenAction(ids.ws, card.id, approved.version, "prossimo_trimestre"), "quando");
  assert.equal(when.message, null, "«Quando» non ha un toast: lo dice il controllo");
  r = await row(card.id);
  assert.equal(r.target_quarter, quarter.nextQuarter(quarter.currentQuarter(now)));
  const [whenEvent] = (await storia(card.id)).slice(-1);
  assert.equal(whenEvent.action, "quando");
  assert.deepEqual(whenEvent.fields, ["quando"]);
  assert.deepEqual(revalidated(), pathsOf(card.id));
  // La stessa scelta non scrive niente.
  ok(await actions.setWhenAction(ids.ws, card.id, when.version, "prossimo_trimestre"), "quando uguale");
  assert.equal(await versionOf(card.id), when.version);
  ok(await actions.setWhenAction(ids.ws, card.id, when.version, "piu_avanti"), "più avanti");
  assert.equal((await row(card.id)).target_quarter, null);

  const later = await seed({ status: "draft", review: "needs_inputs" });
  const reviewBy = ui.addMonths(quarter.romeToday(now), 1);
  const postponed = ok(await actions.decideUseCaseAction(ids.ws, later.id, await versionOf(later.id), { type: "rimanda", reviewBy }), "rimanda");
  assert.equal(postponed.message, `Rimandato al ${ui.futureDayLabel(reviewBy, quarter.romeToday(now))}.`);
  r = await row(later.id);
  assert.equal(r.status, "proposed", "anche da una bozza");
  assert.equal(r.review_by_text, reviewBy);
  assert.equal((await storia(later.id)).slice(-1)[0].phase_after, "da_valutare.rimandata");
  // Una data che non è futura la rifiuta il servizio, sul campo della data.
  const past = await seed();
  const refused = err(await actions.decideUseCaseAction(ids.ws, past.id, await versionOf(past.id), { type: "rimanda", reviewBy: quarter.romeToday(now) }), "dati_non_validi");
  assert.equal(refused.fieldErrors?.reviewBy, "Scegli una data dopo oggi.");
});

test("decidono tutti i revisori: anche chi gestisce il workspace del cliente e Lateral Space (D3)", opts, async () => {
  for (const person of ["manager", "ls"] as const) {
    signIn(person);
    const card = await seed();
    ok(await actions.decideUseCaseAction(ids.ws, card.id, await versionOf(card.id), { type: "approva", quando: "piu_avanti" }), person);
    assert.equal((await row(card.id)).status, "accepted", person);
  }
});

// ─── Chi non decide ──────────────────────────────────────────────────

test("il contributore è rifiutato da ogni action; chi segue solo un corso e chi non è membro pure; niente cambia, la pagina si rilegge", opts, async () => {
  const card = await seed({ status: "accepted", review: "scored", targetQuarter: null });
  const version = await versionOf(card.id);
  const before = await storia(card.id);
  revalidated();
  for (const person of ["contributor", "learner", "outsider"] as const) {
    signIn(person);
    const calls: Array<[string, Promise<Result>]> = [
      ["decide", actions.decideUseCaseAction(ids.ws, card.id, version, { type: "non_avviare", publicNote: "Nota di prova" })],
      ["quando", actions.setWhenAction(ids.ws, card.id, version, "questo_trimestre")],
      ["nascondi", actions.setHiddenFromSearchAction(ids.ws, card.id, version, true)],
      ["realizzazione", actions.markRealizationAction(ids.ws, card.id, version)],
      ["nota", actions.savePublicNoteAction(ids.ws, card.id, version, "Una nota pubblica")],
    ];
    for (const [label, call] of calls) err(await call, "permesso_mancante", `${person} ${label}`);
  }
  assert.equal(await versionOf(card.id), version, "nessuna scrittura");
  assert.deepEqual(await storia(card.id), before, "nessuna riga di Storia");
  // Un ruolo tolto o un accesso perso mentre la pagina era aperta: la pagina si rilegge e i
  // pulsanti spariscono (§9.1), invece di restare a fallire a ogni clic.
  assert.deepEqual(revalidated(), Array.from({ length: 15 }, () => pathsOf(card.id)).flat(), "la pagina si rilegge dopo ogni rifiuto");
});

test("una decisione che il servizio rifiuta perché la pagina è vecchia la rilegge; un ingresso sbagliato no", opts, async () => {
  signIn("builder");
  // La fase è cambiata senza che la pagina lo sapesse (come un dossier passato a un altro
  // stato, che non alza `version`): il servizio rifiuta e la pagina si rilegge.
  const building = await seed({ status: "in_progress", review: "scored" });
  revalidated();
  err(await actions.decideUseCaseAction(ids.ws, building.id, await versionOf(building.id), { type: "approva", quando: "piu_avanti" }), "transizione_non_ammessa");
  assert.deepEqual(revalidated(), pathsOf(building.id), "fase cambiata");

  // Il ruolo cambia mentre la pagina è aperta: `version` resta uguale, la pagina si rilegge.
  const card = await seed();
  const version = await versionOf(card.id);
  await q(`UPDATE workspace_memberships SET role = 'contributor'::member_role WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.builder]);
  try {
    err(await actions.decideUseCaseAction(ids.ws, card.id, version, { type: "approva", quando: "piu_avanti" }), "permesso_mancante");
    assert.deepEqual(revalidated(), pathsOf(card.id), "ruolo tolto");
  } finally {
    await q(`UPDATE workspace_memberships SET role = 'function_lead'::member_role WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.builder]);
  }

  // Un campo sbagliato resta nel dialogo con il testo scritto: niente da rileggere.
  const missing = err(await actions.decideUseCaseAction(ids.ws, card.id, version, { type: "serve_info", publicNote: "  " }), "dati_non_validi");
  assert.equal(missing.fieldErrors?.publicNote, "Scrivi la nota pubblica.");
  err(await actions.decideUseCaseAction(ids.ws, card.id, version, { type: "rimanda", reviewBy: quarter.romeToday() }), "dati_non_validi", "data non futura");
  assert.deepEqual(revalidated(), [], "un ingresso sbagliato non rilegge la pagina");
  assert.equal(await versionOf(card.id), version);
});

// ─── «Segna come in realizzazione»: solo Lateral Space ───────────────

test("«Segna come in realizzazione» solo per Lateral Space, con la sezione Casi d'uso spenta", opts, async () => {
  const card = await seed({ status: "accepted", review: "scored" });
  for (const person of ["builder", "manager"] as const) {
    signIn(person);
    const refused = err(await actions.markRealizationAction(ids.ws, card.id, await versionOf(card.id)), "permesso_mancante", person);
    assert.equal(refused.message, "Solo Lateral Space può farlo.");
  }
  assert.equal((await row(card.id)).status, "accepted");

  // Con i dossier accesi per il workspace si usa «Avvia la realizzazione».
  signIn("ls");
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = ids.ws;
  delete process.env.VERCEL_ENV;
  try {
    const refused = err(await actions.markRealizationAction(ids.ws, card.id, await versionOf(card.id)), "transizione_non_ammessa", "dossier accesi");
    assert.equal(refused.message, "Con i dossier accesi per questo workspace si usa «Avvia la realizzazione».");
  } finally {
    delete process.env.UC_ENABLED;
    delete process.env.UC_WORKSPACE_IDS;
  }

  const marked = ok(await actions.markRealizationAction(ids.ws, card.id, await versionOf(card.id)), "ls");
  assert.equal(marked.message, "Segnato come in realizzazione.");
  const r = await row(card.id);
  assert.equal(r.status, "in_progress");
  const [event] = (await storia(card.id)).slice(-1);
  assert.equal(event.actor_user_id, ids.ls);
  assert.equal(event.phase_after, "in_realizzazione.senza_dossier");
  assert.deepEqual(revalidated().slice(-2), pathsOf(card.id));
  // «Segna come in realizzazione» non passa da `decideUseCaseAction`.
  const other = await seed({ status: "accepted", review: "scored" });
  err(await actions.decideUseCaseAction(ids.ws, other.id, await versionOf(other.id), { type: "segna_in_realizzazione" }), "dati_non_validi");
  assert.equal((await row(other.id)).status, "accepted");
});

// ─── Le altre decisioni dalla pagina ─────────────────────────────────

test("Serve info e Non avviare con la nota pubblica obbligatoria; Doppione di…, Archivia, Riapri, Segna come diffusa e realizzato", opts, async () => {
  signIn("builder");
  const card = await seed();
  const missing = err(await actions.decideUseCaseAction(ids.ws, card.id, await versionOf(card.id), { type: "serve_info", publicNote: "  " }), "dati_non_validi");
  assert.equal(missing.fieldErrors?.publicNote, "Scrivi la nota pubblica.");
  const info = ok(await actions.decideUseCaseAction(ids.ws, card.id, await versionOf(card.id), { type: "serve_info", publicNote: " Quante richieste al giorno? " }), "serve info");
  assert.equal(info.message, "Richiesta salvata. La nota è visibile a chi conosce il codice.");
  let r = await row(card.id);
  assert.equal(r.portfolio_review_status, "needs_inputs");
  assert.equal(r.reviewed_by, ids.builder);
  assert.equal(r.public_note, "Quante richieste al giorno?");

  err(await actions.decideUseCaseAction(ids.ws, card.id, await versionOf(card.id), { type: "non_avviare", publicNote: "" }), "dati_non_validi", "non avviare senza nota");
  const rejected = ok(await actions.decideUseCaseAction(ids.ws, card.id, await versionOf(card.id), { type: "non_avviare", publicNote: "Fuori dal budget di quest'anno." }));
  assert.equal(rejected.message, "Segnato come non avviato.");
  r = await row(card.id);
  assert.equal(r.status, "rejected");
  assert.equal(r.public_note, "Fuori dal budget di quest'anno.");

  const reopened = ok(await actions.decideUseCaseAction(ids.ws, card.id, await versionOf(card.id), { type: "riapri" }), "riapri");
  assert.equal(reopened.message, "Riaperto.");
  r = await row(card.id);
  assert.equal(r.status, "proposed");
  assert.equal(r.portfolio_review_status, "in_review", "non torna «Serve info» con la nota vecchia");

  const original = await seed({ title: `Originale ${suffix}` });
  const self = err(await actions.decideUseCaseAction(ids.ws, card.id, await versionOf(card.id), { type: "doppione", ofCode: String(card.code) }), "dati_non_validi");
  assert.equal(self.fieldErrors?.ofCode, "Scegli un altro use case: non può essere doppione di sé stesso.");
  const unknown = err(await actions.decideUseCaseAction(ids.ws, card.id, await versionOf(card.id), { type: "doppione", ofCode: "XX-9999" }), "dati_non_validi");
  assert.equal(unknown.fieldErrors?.ofCode, "Nessuno use case con questo codice in questo workspace.");
  const dup = ok(await actions.decideUseCaseAction(ids.ws, card.id, await versionOf(card.id), { type: "doppione", ofCode: String(original.code).toLowerCase() }), "doppione");
  assert.equal(dup.message, `Segnato come doppione di ${original.code}.`);
  r = await row(card.id);
  assert.equal(r.portfolio_review_status, "archived");
  assert.deepEqual(r.intake, { archiveReason: "duplicato", duplicateOfCode: original.code });

  const archived = await seed({ status: "accepted", review: "scored" });
  err(await actions.decideUseCaseAction(ids.ws, archived.id, await versionOf(archived.id), { type: "archivia", reason: "duplicato" }), "dati_non_validi", "motivo fuori elenco");
  const arch = ok(await actions.decideUseCaseAction(ids.ws, archived.id, await versionOf(archived.id), { type: "archivia", reason: "ritirato" }), "archivia");
  assert.equal(arch.message, "Archiviato.");
  assert.equal((await row(archived.id)).portfolio_review_status, "archived");

  const practice = await seed({ status: "accepted", review: "scored", kind: "best_practice" });
  const spread = ok(await actions.decideUseCaseAction(ids.ws, practice.id, await versionOf(practice.id), { type: "segna_diffusa" }), "diffusa");
  assert.equal(spread.message, "Segnata come diffusa.");
  assert.equal((await row(practice.id)).status, "implemented");

  const building = await seed({ status: "in_progress", review: "scored" });
  const done = ok(await actions.decideUseCaseAction(ids.ws, building.id, await versionOf(building.id), { type: "segna_realizzato" }), "realizzato");
  assert.equal(done.message, "Segnato come realizzato.");
  assert.equal((await row(building.id)).status, "implemented");
  // Una decisione fuori fase: il messaggio del servizio, nessuna scrittura.
  const wrong = err(await actions.decideUseCaseAction(ids.ws, building.id, await versionOf(building.id), { type: "approva", quando: "piu_avanti" }), "transizione_non_ammessa");
  assert.equal(wrong.message, "In questa fase non si può.");
});

test("«Approva» con «Mostralo ai colleghi» e le action di «Nascondi dalla ricerca» e «Mostra ai colleghi» (§8.6)", opts, async () => {
  signIn("builder");
  const hidden = await seed({ intake: { hiddenFromSearch: true } });
  ok(await actions.decideUseCaseAction(ids.ws, hidden.id, await versionOf(hidden.id), { type: "approva", quando: "piu_avanti", showToColleagues: true }));
  assert.equal((await intakeOf(hidden.id))?.hiddenFromSearch, false);

  const card = await seed();
  const hide = ok(await actions.setHiddenFromSearchAction(ids.ws, card.id, await versionOf(card.id), true), "nascondi");
  assert.equal(hide.message, "Nascosta alla ricerca.");
  assert.equal((await intakeOf(card.id))?.hiddenFromSearch, true);
  assert.equal((await storia(card.id)).slice(-1)[0].action, "visibilita");
  const show = ok(await actions.setHiddenFromSearchAction(ids.ws, card.id, hide.version, false), "mostra");
  assert.equal(show.message, "Visibile ai colleghi.");
  assert.equal((await intakeOf(card.id))?.hiddenFromSearch, false);
  err(await actions.setHiddenFromSearchAction(ids.ws, card.id, show.version, "true"), "dati_non_validi", "non un booleano");
});

test("nota pubblica all'uscita dal campo: salva, non riscrive la stessa, vuota la toglie, oltre 1.000 caratteri no", opts, async () => {
  signIn("builder");
  const card = await seed();
  const saved = ok(await actions.savePublicNoteAction(ids.ws, card.id, await versionOf(card.id), "  Servono i volumi del mese.  "), "salva");
  assert.equal(saved.message, null, "nessun toast: «Salvata.» accanto al campo");
  assert.equal((await row(card.id)).public_note, "Servono i volumi del mese.");
  const [event] = (await storia(card.id)).slice(-1);
  assert.equal(event.action, "modificato");
  assert.deepEqual(event.fields, ["nota_pubblica"]);
  const same = ok(await actions.savePublicNoteAction(ids.ws, card.id, saved.version, "Servono i volumi del mese."), "uguale");
  assert.equal(same.version, saved.version, "la stessa nota non scrive");
  const long = err(await actions.savePublicNoteAction(ids.ws, card.id, saved.version, "x".repeat(1001)), "dati_non_validi");
  assert.equal(long.fieldErrors?.publicNote, "Massimo 1.000 caratteri.");
  ok(await actions.savePublicNoteAction(ids.ws, card.id, saved.version, ""), "togli");
  assert.equal((await row(card.id)).public_note, null);
});

// ─── Versione, area, ingresso ────────────────────────────────────────

test("versione superata: il testo esatto di §6.8, nessuna scrittura, la pagina si rilegge", opts, async () => {
  signIn("builder");
  const card = await seed();
  const stale = await versionOf(card.id);
  ok(await actions.savePublicNoteAction(ids.ws, card.id, stale, "Una nota"));
  revalidated();
  const before = await row(card.id);
  const refused = err(await actions.decideUseCaseAction(ids.ws, card.id, stale, { type: "approva", quando: "piu_avanti" }), "versione_superata");
  assert.equal(refused.message, "Qualcuno ha appena modificato questo use case. Ho ricaricato i dati: rifai la modifica.");
  assert.equal((await row(card.id)).status, before.status);
  assert.equal(await versionOf(card.id), Number(before.version));
  assert.deepEqual(revalidated(), pathsOf(card.id), "la scheda e la lista si rileggono");
  err(await actions.setWhenAction(ids.ws, card.id, stale, "piu_avanti"), "versione_superata", "quando");
  err(await actions.savePublicNoteAction(ids.ws, card.id, stale, "Altra nota"), "versione_superata", "nota");
});

test("«Quando» con le etichette di un trimestre già finito: niente si salva e la pagina si rilegge", opts, async () => {
  signIn("builder");
  const today = quarter.romeToday();
  // Una pagina letta tre mesi fa: le sue etichette sono di un altro trimestre.
  const oldPage = ui.addMonths(today, -3);
  const card = await seed();
  const version = await versionOf(card.id);
  revalidated();
  const approve = { type: "approva", quando: "prossimo_trimestre" } as const;
  const refused = err(await actions.decideUseCaseAction(ids.ws, card.id, version, approve, oldPage), "dati_non_validi", "Approva");
  assert.deepEqual(refused, ui.staleWhenLabelsResult({ field: true }), "il messaggio sotto le scelte del dialogo");
  assert.equal((await row(card.id)).status, "proposed");
  assert.equal(await versionOf(card.id), version);
  assert.deepEqual(revalidated(), pathsOf(card.id), "la pagina si rilegge con le etichette nuove");

  // Con le etichette di oggi si salva il trimestre che dicono.
  const approved = ok(await actions.decideUseCaseAction(ids.ws, card.id, version, approve, today), "Approva");
  assert.equal((await row(card.id)).target_quarter, quarter.nextQuarter(quarter.currentQuarter()));
  revalidated();

  const stale = err(await actions.setWhenAction(ids.ws, card.id, approved.version, "questo_trimestre", oldPage), "dati_non_validi", "Quando");
  assert.deepEqual(stale, ui.staleWhenLabelsResult({ field: false }), "un toast: il controllo non ha un campo");
  assert.equal((await row(card.id)).target_quarter, quarter.nextQuarter(quarter.currentQuarter()));
  assert.equal(await versionOf(card.id), approved.version);
  assert.deepEqual(revalidated(), pathsOf(card.id));
  // «Più avanti» non ha un trimestre: le etichette non contano.
  const later = ok(await actions.setWhenAction(ids.ws, card.id, approved.version, "piu_avanti", oldPage), "Più avanti");
  assert.equal((await row(card.id)).target_quarter, null);
  ok(await actions.setWhenAction(ids.ws, card.id, later.version, "questo_trimestre", today), "Quando di oggi");
  assert.equal((await row(card.id)).target_quarter, quarter.currentQuarter());
  revalidated();

  // Un giorno che la pagina non manda: ingresso non valido, nessuna rilettura.
  const now = await versionOf(card.id);
  err(await actions.setWhenAction(ids.ws, card.id, now, "prossimo_trimestre", "31/12/2026"), "dati_non_validi", "giorno illeggibile");
  assert.deepEqual(revalidated(), []);
  assert.equal(await versionOf(card.id), now);
});

test("la coda della pagina: nota all'uscita dal campo e subito dopo «Quando» o «Serve info», con la versione letta con la pagina", opts, async () => {
  signIn("builder");
  const queue = ui.createDecisionWriteQueue();
  // Approvato: il campo e «Quando» nello stesso capitolo, tutti e due dalla pagina alla stessa versione.
  const approved = await seed({ status: "accepted", review: "scored" });
  const page = await versionOf(approved.id);
  const note = queue.send(approved.id, page, (version) => actions.savePublicNoteAction(ids.ws, approved.id, version, "Servono i volumi."));
  const when = queue.send(approved.id, page, (version) => actions.setWhenAction(ids.ws, approved.id, version, "prossimo_trimestre"));
  ok(await note, "nota");
  ok(await when, "«Quando» dopo la nota: nessuna versione superata");
  const after = await row(approved.id);
  assert.equal(after.public_note, "Servono i volumi.");
  assert.equal(after.target_quarter, quarter.nextQuarter(quarter.currentQuarter()));

  // Da valutare: la nota e poi «Serve info» con il testo appena scritto.
  const toDecide = await seed();
  const start = await versionOf(toDecide.id);
  const saved = queue.send(toDecide.id, start, (version) => actions.savePublicNoteAction(ids.ws, toDecide.id, version, "Quante richieste al giorno?"));
  const info = queue.send(toDecide.id, start, (version) =>
    actions.decideUseCaseAction(ids.ws, toDecide.id, version, { type: "serve_info", publicNote: "Quante richieste al giorno?" }),
  );
  ok(await saved, "nota");
  ok(await info, "«Serve info» dopo la nota");
  assert.equal((await row(toDecide.id)).portfolio_review_status, "needs_inputs");

  // Un'altra persona scrive nel frattempo: resta una versione superata.
  const other = await seed();
  const otherPage = await versionOf(other.id);
  ok(await queue.send(other.id, otherPage, (version) => actions.savePublicNoteAction(ids.ws, other.id, version, "Prima nota")));
  signIn("ls");
  ok(await actions.savePublicNoteAction(ids.ws, other.id, await versionOf(other.id), "Nota di un'altra persona"));
  signIn("builder");
  err(await queue.send(other.id, otherPage, (version) => actions.setHiddenFromSearchAction(ids.ws, other.id, version, true)), "versione_superata");
  assert.equal((await row(other.id)).public_note, "Nota di un'altra persona");
});

test("area spenta per il workspace: «area_spenta», anche per un revisore", opts, async () => {
  signIn("builder");
  const card = await seed({ workspaceId: ids.wsOff });
  const version = await versionOf(card.id);
  const refused = err(await actions.decideUseCaseAction(ids.wsOff, card.id, version, { type: "approva", quando: "piu_avanti" }), "area_spenta");
  assert.equal(refused.message, "L'area Use case non è attiva per questo workspace.");
  err(await actions.setHiddenFromSearchAction(ids.wsOff, card.id, version, true), "area_spenta");
  assert.equal(await versionOf(card.id), version);
  // L'area spenta mentre la pagina era aperta: la pagina si rilegge (e porta alla pagina di oggi).
  assert.deepEqual(revalidated().slice(-4), [...pathsOf(card.id, ids.wsOff), ...pathsOf(card.id, ids.wsOff)]);
});

test("ingresso: solo le forme della pagina; una scheda di un altro workspace non si trova", opts, async () => {
  signIn("builder");
  const card = await seed();
  const version = await versionOf(card.id);
  revalidated();
  for (const raw of [{ type: "cancella" }, { type: "approva", quando: "2027-Q3" }, { type: "non_avviare", publicNote: null, legacy: true }, null]) {
    const refused = err(await actions.decideUseCaseAction(ids.ws, card.id, version, raw), "dati_non_validi", JSON.stringify(raw));
    assert.equal(refused.message, "Decisione non valida.");
  }
  err(await actions.setWhenAction(ids.ws, card.id, version, "2027-Q3"), "dati_non_validi", "trimestre esplicito");
  err(await actions.decideUseCaseAction("non-un-uuid", card.id, version, { type: "riapri" }), "non_trovato");
  err(await actions.decideUseCaseAction(ids.ws, card.id, Number.NaN, { type: "riapri" }), "non_trovato");
  assert.deepEqual(revalidated(), [], "un ingresso che la pagina non manda non rilegge niente");
  // La scheda del workspace spento, chiesta dal workspace acceso: non trovata.
  const elsewhere = await seed({ workspaceId: ids.wsOff });
  err(await actions.decideUseCaseAction(ids.ws, elsewhere.id, await versionOf(elsewhere.id), { type: "approva", quando: "piu_avanti" }), "non_trovato");
  assert.deepEqual(revalidated(), pathsOf(elsewhere.id), "una scheda che non c'è più: la pagina si rilegge");
  assert.equal(await versionOf(card.id), version, "nessuna scrittura");
});

test("sessione scaduta: il redirect della action al login non diventa il toast «Non riusciamo a salvare»", opts, async () => {
  const { redirect } = await import("next/navigation");
  let thrown: unknown;
  try {
    redirect("/login");
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, "redirect() lancia");
  assert.equal(buttons.isNextNavigation(thrown), true);
  assert.equal(buttons.isNextNavigation(new Error("Failed to fetch")), false, "la rete resta un errore da mostrare");
  assert.equal(buttons.isNextNavigation(undefined), false);
});

test("i testi del browser coincidono con quelli del servizio", opts, () => {
  assert.equal(ui.ACTION_FAILED_MESSAGE, svc.SERVICE_MESSAGES.riprova);
  assert.equal(ui.REDACTED_PLACEHOLDER, svc.REDACTED_TEXT);
});

// ─── Il capitolo «Decisione» reso per ruolo e per fase ───────────────

interface RenderedButton {
  label: string;
  filled: boolean;
  disabled: boolean;
}

/** I `<button>` della pagina: testo (o `aria-label`), pieno (`[data-slot=button].bg-primary`), spento. */
function buttonsIn(html: string): RenderedButton[] {
  const out: RenderedButton[] = [];
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = match[1];
    const classes = /\sclass="([^"]*)"/.exec(attrs)?.[1].split(/\s+/) ?? [];
    const label = /\saria-label="([^"]*)"/.exec(attrs)?.[1] ?? match[2].replace(/<[^>]+>/g, "").trim();
    out.push({
      label,
      filled: /\sdata-slot="button"/.test(attrs) && classes.includes("bg-primary"),
      disabled: /\sdisabled(?:=""|(?=[\s/]|$))/.test(attrs),
    });
  }
  return out;
}

function readableText(html: string): string {
  return html.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

function decisionItem(over: Partial<Item>): Item {
  return {
    id: randomUUID(),
    code: "XX-0012",
    title: "Smistamento richieste",
    phase: "da_valutare",
    subState: "nuova",
    phaseLabel: "Da valutare · Nuova",
    kind: "da_costruire",
    hiddenFromSearch: false,
    publicNote: null,
    targetQuarter: null,
    reviewBy: null,
    waitingSince: quarter.romeToday(),
    value: { source: null, perYear: null },
    cost: null,
    dossier: null,
    version: 3,
    ...over,
  };
}

function renderSection(item: Item, canDecide = true): string {
  return renderToStaticMarkup(createElement(section.SectionDecision, { workspaceId: ids.ws, item, today: quarter.romeToday(), canDecide }));
}

test("capitolo «Decisione»: i pulsanti di §6.4 per fase, un solo pulsante pieno, mai pulsanti spenti", opts, () => {
  const cases: Array<[string, Partial<Item>, string | null, string[]]> = [
    ["da valutare", {}, "Approva", ["Rimanda", "Serve info", "Non avviare", "Altre decisioni"]],
    ["approvato da costruire", { phase: "approvato", subState: "piu_avanti", phaseLabel: "Approvato · Più avanti" }, null, ["Non avviare", "Altre decisioni"]],
    ["approvato da diffondere", { phase: "approvato", subState: "piu_avanti", phaseLabel: "Approvato · Più avanti", kind: "da_diffondere" }, "Segna come diffusa", ["Non avviare", "Altre decisioni"]],
    ["in realizzazione senza dossier", { phase: "in_realizzazione", subState: "senza_dossier", phaseLabel: "In realizzazione · Senza dossier" }, "Segna come realizzato", ["Non avviare", "Altre decisioni"]],
    ["in realizzazione, dossier chiuso", { phase: "in_realizzazione", subState: "dossier", phaseLabel: "In realizzazione · Chiuso", dossier: { status: "chiuso" } }, null, ["Non avviare", "Altre decisioni"]],
    ["in realizzazione, dossier in uso", { phase: "in_realizzazione", subState: "dossier", phaseLabel: "In realizzazione · In uso", dossier: { status: "in_esercizio" } }, "Segna come realizzato", []],
    ["in realizzazione, dossier attivo", { phase: "in_realizzazione", subState: "dossier", phaseLabel: "In realizzazione · In sviluppo", dossier: { status: "in_sviluppo" } }, null, []],
    ["realizzato", { phase: "realizzato", subState: "realizzato", phaseLabel: "Realizzato" }, null, ["Altre decisioni"]],
    ["chiuso", { phase: "chiuso", subState: "non_avviato", phaseLabel: "Chiuso · Non avviato" }, "Riapri", []],
    ["chiuso archiviato, dossier chiuso", { phase: "chiuso", subState: "archiviato", phaseLabel: "Chiuso · Archiviato", dossier: { status: "chiuso" } }, "Riapri", []],
    // «Non avviare» con il dossier chiuso (§6.5): «Riapri» il servizio lo rifiuta, quindi non c'è.
    ["chiuso non avviato, dossier chiuso", { phase: "chiuso", subState: "non_avviato", phaseLabel: "Chiuso · Non avviato", dossier: { status: "chiuso" } }, null, []],
    // Archiviata ma ancora `rejected`, con un dossier (righe di prima dell'area): lo stesso.
    [
      "chiuso archiviato rejected, dossier chiuso",
      { phase: "chiuso", subState: "archiviato", phaseLabel: "Chiuso · Archiviato", dossier: { status: "chiuso" }, status: "rejected" },
      null,
      [],
    ],
  ];
  for (const [label, over, primary, others] of cases) {
    const html = renderSection(decisionItem(over));
    const shown = buttonsIn(html);
    const filled = shown.filter((b) => b.filled);
    assert.ok(filled.length <= 1, `${label}: ${filled.length} pulsanti pieni`);
    assert.deepEqual(filled.map((b) => b.label), primary ? [primary] : [], `${label}: pulsante pieno`);
    assert.deepEqual(shown.filter((b) => !b.filled).map((b) => b.label), others, `${label}: pulsanti outline e menu`);
    assert.ok(!shown.some((b) => b.disabled), `${label}: nessun pulsante spento`);
    assert.doesNotMatch(html, /<[^>]+\sdisabled(?:=""|(?=[\s/>]))/, `${label}: nessun controllo spento`);
  }
});

/** Gli elementi React di un albero non ancora reso, in profondità. */
function* elementsIn(node: unknown): Generator<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) {
    for (const child of node) yield* elementsIn(child);
    return;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as { type: unknown; props: Record<string, unknown> };
  yield element;
  yield* elementsIn(element.props.children);
}

test("capitolo «Decisione»: ai pezzi del browser solo le parti delle decisioni e id, codice e titolo dei candidati", opts, () => {
  const detail = {
    ...decisionItem({ publicNote: "Nota" }),
    reviewNotes: "NOTA INTERNA",
    description: "PROBLEMA DELLA SCHEDA",
  };
  // Come li passerebbe la scheda: gli `HubItem` interi del workspace.
  const candidates = [
    { id: randomUUID(), code: "XX-0007", title: "Smistamento email", publicNote: "NOTA DI UN ALTRO", problemPreview: "PROBLEMA DI UN ALTRO", value: { score: 4 } },
    { id: randomUUID(), code: null, title: "Bozza", reviewNotes: "NOTA INTERNA DI UN ALTRO", dossier: { status: "raccolta" } },
  ];
  const tree = section.SectionDecision({ workspaceId: ids.ws, item: detail, today: quarter.romeToday(), canDecide: true, candidates });
  const clientParts = [...elementsIn(tree)].filter((element) => typeof element.type === "function");
  const decisionButtons = clientParts.find((element) => element.type === buttons.DecisionButtons);
  assert.ok(decisionButtons, "i pulsanti ci sono");
  assert.deepEqual(decisionButtons.props.candidates, candidates.map(({ id, code, title }) => ({ id, code, title })));
  assert.deepEqual(decisionButtons.props.item, ui.toDecisionItem(detail));
  for (const part of clientParts) {
    const props = JSON.stringify({ ...part.props, children: undefined });
    for (const text of ["NOTA INTERNA", "PROBLEMA", "NOTA DI UN ALTRO", "raccolta"]) assert.ok(!props.includes(text), `${text} non arriva al browser`);
  }
});

test("capitolo «Decisione»: riga della decisione, «Quando» solo da approvato, nota pubblica con l'avviso", opts, async () => {
  const { findHubForbidden } = await import("./copy-guard.ts");
  const now = new Date();
  const toDecide = renderSection(decisionItem({ waitingSince: ui.addDays(quarter.romeToday(now), -6) }));
  // H4p: la fase sta nella pillola della testata; qui solo l'attesa.
  assert.ok(readableText(toDecide).includes("Decisione"));
  assert.ok(readableText(toDecide).includes("In attesa da 6 giorni"));
  assert.ok(!readableText(toDecide).includes("Da decidere ·"));
  assert.ok(!toDecide.includes("Questo trimestre"), "«Quando» solo in fase Approvato");
  assert.ok(readableText(toDecide).includes("Nota pubblica"));
  assert.ok(readableText(toDecide).includes("Chi conosce il codice la legge tramite Claude. Non scrivere dati personali."));
  assert.ok(!toDecide.includes("Questa scheda è nascosta alla ricerca"));
  assert.deepEqual(findHubForbidden(readableText(toDecide), "area"), []);

  const hidden = renderSection(decisionItem({ hiddenFromSearch: true, publicNote: "Quante richieste arrivano a settimana?" }));
  assert.ok(readableText(hidden).includes("Questa scheda è nascosta alla ricerca: tramite Claude chi conosce il codice vede solo la fase."));
  assert.ok(hidden.includes("Quante richieste arrivano a settimana?"));

  const approved = renderSection(
    decisionItem({ phase: "approvato", subState: "trimestre", phaseLabel: `Approvato · ${quarter.quarterLabel(quarter.currentQuarter(now))}`, targetQuarter: quarter.currentQuarter(now) }),
  );
  const text = readableText(approved);
  assert.ok(!text.includes("Approvato ·"), "la fase non si ripete sotto «Decisione»");
  // «Quando»: la parola e il trimestre su due righe, mai a capo tra le scelte (H4p).
  for (const choice of ["questo_trimestre", "prossimo_trimestre", "piu_avanti"] as const) {
    const parts = quarter.whenChoiceParts(choice, now);
    assert.ok(text.includes(parts.title), parts.title);
    if (parts.quarter) assert.ok(text.includes(parts.quarter), parts.quarter);
  }
  for (const option of ui.whenOptions(now)) assert.ok(approved.includes(`aria-label="${option.label}"`), option.label);
  const savedChoice = /<[^>]*aria-label="Questo trimestre[^"]*"[^>]*>/.exec(approved)?.[0] ?? "";
  assert.ok(savedChoice.includes('role="radio"') && savedChoice.includes('aria-checked="true"'), "la scelta salvata è selezionata");
  assert.deepEqual(findHubForbidden(text, "area"), []);
});

test("capitolo «Decisione» per il contributore: la nota pubblica delle proprie proposte, «Rispondi» in «Serve info» (D17); per chi non decide niente pulsanti", opts, () => {
  const today = quarter.romeToday();
  const base = { id: randomUUID(), title: "Smistamento richieste", phase: "da_valutare" as const, subState: "serve_info" as const, phaseLabel: "Da valutare · Serve info", quando: null };
  const asked = renderToStaticMarkup(
    createElement(section.ContributorDecisionSection, { workspaceId: ids.ws, teamName: DEFAULT_REVIEW_TEAM_NAME, useCase: { ...base, own: true, code: "XX-0012", publicNote: "Quante richieste arrivano a settimana?" } }),
  );
  assert.ok(asked.includes(questionLabel(DEFAULT_REVIEW_TEAM_NAME)) && asked.includes("Quante richieste arrivano a settimana?"));
  assert.ok(asked.includes("<textarea") && asked.includes("La tua risposta"), "il campo della risposta");
  assert.deepEqual(buttonsIn(asked).map((b) => b.label), ["Invia la risposta"]);
  const closed = { ...base, phase: "chiuso" as const, subState: "non_avviato" as const, phaseLabel: "Chiuso · Non avviato" };
  const own = renderToStaticMarkup(
    createElement(section.ContributorDecisionSection, { workspaceId: ids.ws, teamName: DEFAULT_REVIEW_TEAM_NAME, useCase: { ...closed, own: true, code: "XX-0012", publicNote: "Non ora: manca il budget." } }),
  );
  assert.ok(own.includes("Nota pubblica") && own.includes("Non ora: manca il budget."));
  assert.ok(!own.includes("<button"), "in sola lettura");
  assert.equal(renderToStaticMarkup(createElement(section.ContributorDecisionSection, { workspaceId: ids.ws, teamName: DEFAULT_REVIEW_TEAM_NAME, useCase: { ...base, own: false } })), "", "proposta altrui");
  assert.equal(renderToStaticMarkup(createElement(section.ContributorDecisionSection, { workspaceId: ids.ws, teamName: DEFAULT_REVIEW_TEAM_NAME, useCase: { ...closed, own: true, code: "XX-0012", publicNote: null } })), "");
  // Senza `canDecide` (chi non decide) nessun pulsante, nessun campo da scrivere.
  const readOnly = renderToStaticMarkup(createElement(section.SectionDecision, { workspaceId: ids.ws, item: decisionItem({ publicNote: "Nota" }), today, canDecide: false }));
  assert.deepEqual(buttonsIn(readOnly), []);
  assert.ok(!readOnly.includes("<textarea"));
});

test("«Segna come in realizzazione» si mostra solo a Lateral Space, approvato «Da costruire», senza dossier, sezione spenta", opts, () => {
  const approved = decisionItem({ phase: "approvato", subState: "piu_avanti", phaseLabel: "Approvato · Più avanti" });
  const render = (props: { canMarkInProgress: boolean; dossiersEnabled: boolean }, item = approved) =>
    renderToStaticMarkup(createElement(buttons.MarkInProgressButton, { workspaceId: ids.ws, item, ...props }));
  const shown = buttonsIn(render({ canMarkInProgress: true, dossiersEnabled: false }));
  assert.deepEqual(shown, [{ label: "Segna come in realizzazione", filled: false, disabled: false }], "outline");
  assert.equal(render({ canMarkInProgress: false, dossiersEnabled: false }), "", "AI Builder del cliente");
  assert.equal(render({ canMarkInProgress: true, dossiersEnabled: true }), "", "dossier accesi");
  assert.equal(render({ canMarkInProgress: true, dossiersEnabled: false }, { ...approved, kind: "da_diffondere" }), "");
});
