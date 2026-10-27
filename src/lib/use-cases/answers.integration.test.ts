import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult;
  }): void;
};

// «Rispondi» su «Serve info» (decisione D17; docs/use-case/DESIGN.md §1.1, §3.5, §6.9, §10.3,
// §11; PIANO-LAVORI H4p, §5.4): la server action `answerInfoRequestAction` con una sessione
// finta, il servizio `answerInfoRequest` e le letture che ne seguono.
//
// - Risponde solo chi ha proposto (per id o per email verificata), solo in «Serve info».
// - La risposta sta in `intake.risposte` (data e testo semplice, lunghezza limitata), la scheda
//   torna `in_review` (connettore IN_VALUTAZIONE), la Storia ha una riga senza testo e senza
//   persona, i revisori hanno un segnale in campanella che i contributori non vedono.
// - Art. 15.4: nessun dato su chi ha proposto esce dalla action, dalla Storia o dal segnale;
//   nessun conteggio per persona.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
// 127.0.0.1). Dentro `npm run check` si salta. Dati sintetici, creati e cancellati qui.
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
type Service = typeof import("./service.ts");
type Hub = typeof import("../db/queries/use-case-hub.ts");
type Signals = typeof import("../db/queries/signals.ts");
type Status = typeof import("../connector/status.ts");
type Result = import("./decision-ui.ts").DecisionActionResult;

let actions: Actions;
let svc: Service;
let hub: Hub;
let signals: Signals;
let status: Status;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  wsOff: randomUUID(),
  builder: randomUUID(),
  contributor: randomUUID(),
  colleague: randomUUID(),
  unverified: randomUUID(),
};
const emails = {
  builder: `builder.${suffix}@cliente.test`,
  contributor: `contributor.${suffix}@cliente.test`,
  colleague: `colleague.${suffix}@cliente.test`,
  unverified: `unverified.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;

const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const state = globalThis as { __hubH4pSession?: unknown; __hubH4pRevalidated?: string[] };

function signIn(person: Person | null): void {
  state.__hubH4pSession = person
    ? { user: { id: ids[person], email: emails[person], emailVerified: person !== "unverified", name: `Persona ${person}`, image: null } }
    : null;
}

function revalidated(): string[] {
  const paths = state.__hubH4pRevalidated ?? [];
  state.__hubH4pRevalidated = [];
  return paths;
}

const QUESTION = "Quante richieste arrivano a settimana?";
const ANSWER = "Circa 120 a settimana, quasi tutte via email.\nIl lunedì il doppio.";
/**
 * Pezzi del testo della risposta che non compaiono mai per caso in un uuid o in una data: le prove
 * «il testo non c'è» cercano questi, non «120» (che un id casuale o un istante possono contenere).
 */
const ANSWER_PARTS = ANSWER.split("\n").map((line) => line.trim());
const carriesAnswer = (value: unknown) => {
  const json = JSON.stringify(value) ?? "";
  return ANSWER_PARTS.some((part) => json.includes(part)) || json.includes("Circa 120");
};
let codeSeq = 500;

/** Una proposta in «Serve info» (o in un altro stato), scritta senza passare dal servizio. */
async function seed(c: { proposedBy?: string | null; review?: string; reviewedBy?: string | null; publicNote?: string | null; workspaceId?: string; intake?: Record<string, unknown> } = {}) {
  const id = randomUUID();
  const code = `XX-${String(codeSeq++).padStart(4, "0")}`;
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code,
       intake, public_note, reviewed_by, proposed_by, source)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', 'proposed', $4::portfolio_review_status, 'use_case_ai', $5,
       $6::jsonb, $7, $8::uuid, $9, 'web_proposed')`,
    [
      id,
      c.workspaceId ?? ids.ws,
      `Proposta di prova ${suffix} ${codeSeq}`,
      c.review ?? "needs_inputs",
      code,
      c.intake ? JSON.stringify(c.intake) : null,
      c.publicNote === undefined ? QUESTION : c.publicNote,
      c.reviewedBy === undefined ? ids.builder : c.reviewedBy,
      c.proposedBy === undefined ? emails.contributor : c.proposedBy,
    ],
  );
  return { id, code };
}

async function row(id: string): Promise<Record<string, unknown>> {
  const [r] = await q(`SELECT * FROM use_cases WHERE id = $1::uuid`, [id]);
  assert.ok(r, "la scheda c'è");
  return r;
}

async function storia(id: string): Promise<Record<string, unknown>[]> {
  return q(`SELECT action, channel, actor_kind, actor_user_id, fields, phase_before, phase_after FROM use_case_events WHERE use_case_id = $1::uuid ORDER BY at, id`, [id]);
}

async function signalsOf(id: string): Promise<Record<string, unknown>[]> {
  return q(`SELECT signal_type, title, description, related_entity_type FROM weekly_signals WHERE related_entity_id = $1::uuid`, [id]);
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

function viewer(person: Person, role: string) {
  return { userId: ids[person], email: emails[person], emailVerified: person !== "unverified", role, isLateralSpace: false };
}

before(async () => {
  if (!enabled) return;
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "@/lib/auth": stub("export async function auth() { return globalThis.__hubH4pSession ?? null; }"),
    "next/cache": stub(
      "export function revalidatePath(path) { (globalThis.__hubH4pRevalidated ??= []).push(path); }\n" +
        "export function revalidateTag() {}\nexport function refresh() {}\nexport function updateTag() {}\n" +
        "export function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}",
    ),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  actions = await import("../actions/use-case-decisions.ts");
  svc = await import("./service.ts");
  hub = await import("../db/queries/use-case-hub.ts");
  signals = await import("../db/queries/signals.ts");
  status = await import("../connector/status.ts");

  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H4p', $2)`, [ids.org, `hub-h4p-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova H4p'), ($2::uuid, $3::uuid, 'Prova H4p spento')`, [
    ids.ws,
    ids.wsOff,
    ids.org,
  ]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, ${person === "unverified" ? "NULL" : "now()"})`, [
      ids[person],
      emails[person],
      `Persona di prova ${person}`,
    ]);
  }
  const memberships: Array<[string, Person, string]> = [
    [ids.ws, "builder", "function_lead"],
    [ids.ws, "contributor", "contributor"],
    [ids.ws, "colleague", "contributor"],
    [ids.ws, "unverified", "contributor"],
    [ids.wsOff, "contributor", "contributor"],
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

test("chi ha proposto risponde in «Serve info»: risposta in intake, in_review, IN_VALUTAZIONE, Storia senza testo, campanella dei revisori", opts, async () => {
  const card = await seed();
  const before = await row(card.id);
  assert.equal(status.connectorStatus({ ...toStatusInput(before) }).statusCode, "SERVONO_INFORMAZIONI");
  signIn("contributor");
  const answered = ok(await actions.answerInfoRequestAction(ids.ws, card.id, `  ${ANSWER}\r\n\r\n\r\n  `, QUESTION), "risposta");
  assert.equal(answered.message, "Risposta inviata. Lo use case torna in valutazione.");
  // Nessun dato della scheda esce dalla action: solo versione e toast.
  assert.deepEqual(Object.keys(answered).sort(), ["message", "ok", "version"]);
  assert.deepEqual(revalidated(), [`/dashboard/${ids.ws}/use-cases`, `/dashboard/${ids.ws}/use-cases/${card.id}`]);

  const after = await row(card.id);
  assert.equal(after.portfolio_review_status, "in_review");
  assert.equal(after.status, "proposed");
  assert.equal(after.public_note, QUESTION, "la domanda resta");
  assert.equal(Number(after.version), answered.version);
  const answers = (after.intake as { risposte?: Array<{ at: string; text: string }> }).risposte ?? [];
  assert.equal(answers.length, 1);
  assert.equal(answers[0].text, ANSWER, "testo semplice: a capo uniformi, senza spazi ai lati né righe vuote in più");
  assert.ok(!Number.isNaN(Date.parse(answers[0].at)));
  assert.deepEqual(Object.keys(answers[0]).sort(), ["at", "text"], "nessun dato su chi ha risposto");
  assert.equal(status.connectorStatus(toStatusInput(after)).statusCode, "IN_VALUTAZIONE");

  const [event] = (await storia(card.id)).slice(-1);
  assert.deepEqual(
    { action: event.action, channel: event.channel, actor: event.actor_kind, user: event.actor_user_id, fields: event.fields },
    { action: "modificato", channel: "pagina", actor: "proponente", user: null, fields: ["intake"] },
  );
  assert.equal(event.phase_before, "da_valutare.serve_info");
  assert.equal(event.phase_after, "da_valutare.nuova");
  assert.ok(!carriesAnswer(event), "la Storia non ha il testo");

  const [signal] = await signalsOf(card.id);
  assert.equal(signal.signal_type, "new_portfolio_item");
  assert.equal(signal.related_entity_type, "use_case");
  assert.ok(String(signal.title).startsWith(`Risposta ricevuta: ${card.code}`));
  assert.ok(!carriesAnswer(signal), "il segnale non ha il testo della risposta");
  assert.ok(!JSON.stringify(signal).includes(emails.contributor), "né chi ha risposto");
  // La campanella: i revisori lo vedono, i contributori no (D4).
  const forReviewer = await signals.getSignalsByWorkspace(ids.ws, 50, "function_lead");
  const forContributor = await signals.getSignalsByWorkspace(ids.ws, 50, "contributor");
  assert.ok(forReviewer.some((s) => s.relatedEntityId === card.id));
  assert.ok(!forContributor.some((s) => s.relatedEntityId === card.id));
});

test("i revisori leggono la risposta nella scheda; chi ha proposto rilegge solo la sua, e la lista torna «Da decidere»", opts, async () => {
  const card = await seed();
  signIn("contributor");
  ok(await actions.answerInfoRequestAction(ids.ws, card.id, ANSWER, QUESTION));
  const reviewer = await hub.getUseCaseDetail(ids.ws, card.id, viewer("builder", "function_lead"));
  assert.ok(reviewer && reviewer.projection !== "contributore");
  const answers = (reviewer.useCase.intake as { risposte?: Array<{ text: string }> } | null)?.risposte ?? [];
  assert.equal(answers.at(-1)?.text, ANSWER);
  assert.equal(reviewer.useCase.subState, "nuova");
  const own = await hub.getUseCaseDetail(ids.ws, card.id, viewer("contributor", "contributor"));
  assert.ok(own && own.projection === "contributore");
  // H7: chi ha proposto rilegge la sua risposta sotto la domanda, finché nessuno decide; la
  // proiezione (lista, REST, MCP) resta senza risposte.
  assert.equal(own.answer?.text, ANSWER, "la sua risposta, fuori dalla proiezione");
  assert.deepEqual(Object.keys(own.answer!).sort(), ["at", "text"]);
  // La proiezione non porta le risposte: il campo che le tiene (`intake.risposte`) non c'è, e il testo nemmeno.
  const projectedIntake = (own.useCase as { intake?: { risposte?: unknown } | null }).intake;
  assert.equal(projectedIntake?.risposte, undefined, "la proiezione non porta le risposte");
  assert.ok(!carriesAnswer(own.useCase), "la proiezione non porta il testo della risposta");
  const list = await hub.listHubItems(ids.ws, viewer("builder", "function_lead"));
  const item = list?.items.find((i) => i.id === card.id);
  assert.equal(item?.subState, "nuova", "torna in «Da decidere», non più «In attesa di risposta»");
  assert.equal(item && "answered" in item ? item.answered : null, true, "la riga dei revisori dice «Risposta ricevuta»");
  // Una risposta di altri non arriva a chi non l'ha proposta.
  const others = await hub.getUseCaseDetail(ids.ws, card.id, viewer("colleague", "contributor"));
  assert.ok(!others || (others.projection === "contributore" && others.answer === null));
});

/** Un giorno dopo oggi, `AAAA-MM-GG`: la data di «Rimanda». */
function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function versionOf(id: string): Promise<number> {
  return Number((await row(id)).version);
}

async function reviewerItem(id: string) {
  const list = await hub.listHubItems(ids.ws, viewer("builder", "function_lead"));
  const item = list?.items.find((i) => i.id === id);
  assert.ok(item && "answered" in item, "la riga dei revisori");
  return item;
}

test("dopo una decisione la risposta non è più in attesa: «Rimanda», «Riapri» dopo «Non avviare» (D17)", opts, async () => {
  // La risposta segna `intake.rispostaInAttesa` con la sua data.
  const postponed = await seed();
  signIn("contributor");
  ok(await actions.answerInfoRequestAction(ids.ws, postponed.id, ANSWER, QUESTION));
  const answeredRow = (await row(postponed.id)).intake as { risposte: Array<{ at: string }>; rispostaInAttesa?: string };
  assert.equal(answeredRow.rispostaInAttesa, answeredRow.risposte[0].at);
  assert.equal((await reviewerItem(postponed.id)).answered, true);

  // «Rimanda» con la nota nuova: niente più in attesa, né per i revisori né per chi ha proposto.
  signIn("builder");
  const note = `Ne riparliamo il mese prossimo ${suffix}`;
  ok(await actions.decideUseCaseAction(ids.ws, postponed.id, await versionOf(postponed.id), { type: "rimanda", reviewBy: inDays(30), publicNote: note }), "rimanda");
  const afterPostpone = await row(postponed.id);
  assert.equal(afterPostpone.public_note, note);
  assert.equal(Object.hasOwn(afterPostpone.intake as object, "rispostaInAttesa"), false);
  assert.equal((afterPostpone.intake as { risposte: unknown[] }).risposte.length, 1, "le risposte restano");
  const item = await reviewerItem(postponed.id);
  assert.equal(item.subState, "rimandata");
  assert.equal(item.answered, false, "rimandata: nessuna «Risposta ricevuta»");
  const own = await hub.getUseCaseDetail(ids.ws, postponed.id, viewer("contributor", "contributor"));
  assert.ok(own && own.projection === "contributore");
  assert.equal(own.answer, null, "chi ha proposto non rilegge la risposta come se fosse in attesa");
  assert.equal(own.useCase.subState, "valutata", "il parcheggio del team non arriva a chi ha proposto");

  // «Non avviare», poi «Riapri»: di nuovo «Nuova», non «Risposta ricevuta».
  const reopened = await seed();
  signIn("contributor");
  ok(await actions.answerInfoRequestAction(ids.ws, reopened.id, ANSWER, QUESTION));
  signIn("builder");
  ok(await actions.decideUseCaseAction(ids.ws, reopened.id, await versionOf(reopened.id), { type: "non_avviare", publicNote: "Non ora: manca il budget." }), "non avviare");
  ok(await actions.decideUseCaseAction(ids.ws, reopened.id, await versionOf(reopened.id), { type: "riapri" }), "riapri");
  const back = await reviewerItem(reopened.id);
  assert.deepEqual([back.phase, back.subState, back.answered], ["da_valutare", "nuova", false]);
  const ownBack = await hub.getUseCaseDetail(ids.ws, reopened.id, viewer("contributor", "contributor"));
  assert.ok(ownBack && ownBack.projection === "contributore" && ownBack.answer === null);
});

test("dopo una risposta la nota cambiata va con la decisione, in una scrittura: se la decisione non passa, la nota resta (D17)", opts, async () => {
  const card = await seed();
  signIn("contributor");
  ok(await actions.answerInfoRequestAction(ids.ws, card.id, ANSWER, QUESTION));
  signIn("builder");
  const version = await versionOf(card.id);
  const events = (await storia(card.id)).length;
  const note = `Archiviato: lo copre il nuovo gestionale ${suffix}`;
  const unchanged = async (label: string) => {
    const r = await row(card.id);
    assert.equal(r.public_note, QUESTION, label);
    assert.equal(r.portfolio_review_status, "in_review", label);
    assert.equal(Number(r.version), version, label);
    assert.equal((await storia(card.id)).length, events, label);
  };
  err(await actions.decideUseCaseAction(ids.ws, card.id, version - 1, { type: "archivia", reason: "superato", publicNote: note }), "versione_superata");
  await unchanged("versione superata");
  const long = err(await actions.decideUseCaseAction(ids.ws, card.id, version, { type: "archivia", reason: "superato", publicNote: "x".repeat(1001) }), "dati_non_validi");
  assert.ok(long.fieldErrors?.publicNote, "l'errore sul campo della nota");
  await unchanged("nota troppo lunga");

  ok(await actions.decideUseCaseAction(ids.ws, card.id, version, { type: "archivia", reason: "superato", publicNote: `  ${note}  ` }), "archivia");
  const r = await row(card.id);
  assert.equal(r.public_note, note);
  assert.equal(r.portfolio_review_status, "archived");
  assert.equal(Number(r.version), version + 1, "una scrittura sola");
  const added = (await storia(card.id)).slice(events);
  assert.equal(added.length, 1, "una riga di Storia");
  assert.equal(added[0].action, "decisione");
  assert.ok((added[0].fields as string[]).includes("nota_pubblica"));
});

test("rispondono solo chi ha proposto e solo in «Serve info»; area spenta, testo vuoto o troppo lungo: niente cambia", opts, async () => {
  const card = await seed();
  const untouched = async (label: string) => {
    const r = await row(card.id);
    assert.equal(r.portfolio_review_status, "needs_inputs", label);
    assert.equal((r.intake as Record<string, unknown> | null)?.risposte, undefined, label);
  };
  // Un collega contributore e il revisore che ha chiesto: non è una loro proposta.
  for (const person of ["colleague", "builder"] as const) {
    signIn(person);
    const refused = err(await actions.answerInfoRequestAction(ids.ws, card.id, ANSWER, QUESTION), "permesso_mancante", person);
    assert.equal(refused.message, "Puoi rispondere solo agli use case che hai proposto.");
    await untouched(person);
  }
  // Un'email non verificata non rende propria una proposta salvata con quell'email.
  const byEmail = await seed({ proposedBy: emails.unverified });
  signIn("unverified");
  err(await actions.answerInfoRequestAction(ids.ws, byEmail.id, ANSWER, QUESTION), "permesso_mancante", "email non verificata");
  // Per id utente vale sempre.
  const byId = await seed({ proposedBy: ids.unverified });
  ok(await actions.answerInfoRequestAction(ids.ws, byId.id, ANSWER, QUESTION), "proposta per id");

  signIn("contributor");
  for (const text of ["", "  ", "ok", "x".repeat(2_001)]) {
    const refused = err(await actions.answerInfoRequestAction(ids.ws, card.id, text, QUESTION), "dati_non_validi", `testo ${text.length}`);
    assert.ok(refused.fieldErrors?.risposta, "l'errore sta sotto il campo");
  }
  err(await actions.answerInfoRequestAction(ids.ws, card.id, 42, QUESTION), "dati_non_validi", "non è un testo");
  await untouched("testi non validi");

  // Fuori da «Serve info»: nuova (in_review) o già risposta.
  const fresh = await seed({ review: "in_review" });
  const notAsked = err(await actions.answerInfoRequestAction(ids.ws, fresh.id, ANSWER, QUESTION), "transizione_non_ammessa", "non in «Serve info»");
  assert.equal(notAsked.message, "Si risponde solo quando il team chiede informazioni.");
  ok(await actions.answerInfoRequestAction(ids.ws, card.id, ANSWER, QUESTION), "prima risposta");
  err(await actions.answerInfoRequestAction(ids.ws, card.id, ANSWER, QUESTION), "transizione_non_ammessa", "seconda risposta senza una nuova domanda");

  // Area spenta per il workspace.
  const off = await seed({ workspaceId: ids.wsOff });
  err(await actions.answerInfoRequestAction(ids.wsOff, off.id, ANSWER, QUESTION), "area_spenta");
  assert.equal((await row(off.id)).portfolio_review_status, "needs_inputs");
});

test("il servizio rifiuta i sistemi e l'AI: risponde una persona; la scheda, la Storia e la campanella non cambiano", opts, async () => {
  // Una proposta in «Serve info» ancora da rispondere: senza il controllo sulla persona la risposta passerebbe le altre regole.
  const card = await seed();
  const before = await row(card.id);
  const events = (await storia(card.id)).length;
  for (const [kind, channel] of [
    ["sistema", "script"],
    ["ai", "ai"],
  ] as const) {
    const refused = await svc.answerInfoRequest({ workspaceId: ids.ws, actor: { userId: null, role: null, isLateralSpace: false, kind }, channel }, card.id, ANSWER, QUESTION);
    assert.equal(refused.ok, false, kind);
    assert.equal(!refused.ok && refused.error, "permesso_mancante", kind);
    // Il rifiuto generico di chi non è una persona, non «non è una tua proposta».
    assert.equal(!refused.ok && refused.message, svc.SERVICE_MESSAGES.permesso_mancante, kind);
  }
  const after = await row(card.id);
  assert.equal(after.portfolio_review_status, "needs_inputs");
  assert.equal(Number(after.version), Number(before.version));
  assert.equal((after.intake as Record<string, unknown> | null)?.risposte, undefined);
  assert.equal((await storia(card.id)).length, events, "nessuna riga di Storia");
  assert.deepEqual(await signalsOf(card.id), [], "nessun segnale");
});

test("la risposta vale per la domanda letta (§6.8): domanda cambiata o nuova «Serve info» nel frattempo → versione superata, niente si salva", opts, async () => {
  const card = await seed();
  // Il revisore cambia la domanda mentre chi ha proposto scrive la risposta.
  const changed = "Quante richieste arrivano al giorno?";
  signIn("builder");
  ok(await actions.savePublicNoteAction(ids.ws, card.id, Number((await row(card.id)).version), changed), "nota cambiata");
  revalidated();
  signIn("contributor");
  const stale = err(await actions.answerInfoRequestAction(ids.ws, card.id, ANSWER, QUESTION), "versione_superata", "domanda di prima");
  assert.equal(stale.message, svc.SERVICE_MESSAGES.versione_superata);
  assert.deepEqual(revalidated(), [`/dashboard/${ids.ws}/use-cases`, `/dashboard/${ids.ws}/use-cases/${card.id}`], "la pagina si rilegge");
  let current = await row(card.id);
  assert.equal(current.portfolio_review_status, "needs_inputs");
  assert.equal((current.intake as Record<string, unknown> | null)?.risposte, undefined);
  // Con la domanda di adesso la risposta passa.
  ok(await actions.answerInfoRequestAction(ids.ws, card.id, ANSWER, changed), "domanda di adesso");

  // Due schede aperte: dalla seconda risponde alla prima domanda; il team ne fa una nuova; la
  // prima scheda, ancora con la domanda di prima, invia: niente si salva.
  const twice = await seed();
  ok(await actions.answerInfoRequestAction(ids.ws, twice.id, "Prima risposta di prova.", QUESTION), "prima risposta");
  signIn("builder");
  ok(await actions.decideUseCaseAction(ids.ws, twice.id, Number((await row(twice.id)).version), { type: "serve_info", publicNote: "E il sabato?" }), "nuova domanda");
  signIn("contributor");
  err(await actions.answerInfoRequestAction(ids.ws, twice.id, ANSWER, QUESTION), "versione_superata", "risposta alla domanda di prima");
  current = await row(twice.id);
  assert.equal(current.portfolio_review_status, "needs_inputs", "resta in «Serve info»");
  assert.deepEqual(((current.intake as { risposte: Array<{ text: string }> }).risposte ?? []).map((a) => a.text), ["Prima risposta di prova."]);
  // Un ingresso che la pagina non manda.
  err(await actions.answerInfoRequestAction(ids.ws, twice.id, ANSWER, 42), "dati_non_validi", "domanda non testo");
});

test("una nascosta altrui «non esiste» per chi non vede le nascoste (§1.2 punto 3, §6.9): come un id inventato", opts, async () => {
  const hidden = await seed({ proposedBy: emails.colleague, intake: { hiddenFromSearch: true } });
  signIn("contributor");
  const notFound = err(await actions.answerInfoRequestAction(ids.ws, hidden.id, ANSWER, QUESTION), "non_trovato", "nascosta altrui");
  const unknown = err(await actions.answerInfoRequestAction(ids.ws, randomUUID(), ANSWER, QUESTION), "non_trovato", "id inventato");
  assert.equal(notFound.message, unknown.message, "stesso messaggio: niente dice che la scheda c'è");
  // Il revisore vede le nascoste: per lui resta «non è una tua proposta».
  signIn("builder");
  err(await actions.answerInfoRequestAction(ids.ws, hidden.id, ANSWER, QUESTION), "permesso_mancante", "revisore");
  assert.equal((await row(hidden.id)).portfolio_review_status, "needs_inputs");
  // Chi l'ha proposta risponde.
  signIn("colleague");
  ok(await actions.answerInfoRequestAction(ids.ws, hidden.id, ANSWER, QUESTION), "propria nascosta");
});

test("una seconda domanda e una seconda risposta: le risposte si aggiungono; «Oscura testo» le toglie e tiene la data", opts, async () => {
  const card = await seed();
  signIn("contributor");
  ok(await actions.answerInfoRequestAction(ids.ws, card.id, "Prima risposta di prova.", QUESTION));
  // Il revisore chiede ancora (Serve info), chi ha proposto risponde di nuovo.
  signIn("builder");
  ok(await actions.decideUseCaseAction(ids.ws, card.id, Number((await row(card.id)).version), { type: "serve_info", publicNote: "E il sabato?" }), "serve info");
  signIn("contributor");
  ok(await actions.answerInfoRequestAction(ids.ws, card.id, "Seconda risposta di prova.", "E il sabato?"));
  const answers = ((await row(card.id)).intake as { risposte: Array<{ at: string; text: string }> }).risposte;
  assert.deepEqual(answers.map((a) => a.text), ["Prima risposta di prova.", "Seconda risposta di prova."]);

  const redacted = await svc.redactText(
    { workspaceId: ids.ws, actor: { userId: ids.builder, role: "function_lead", isLateralSpace: false, kind: "persona" }, channel: "pagina" },
    card.id,
    Number((await row(card.id)).version),
    ["intake"],
  );
  // L'AI Builder del cliente che non gestisce il workspace non oscura (§1.2 punto 10): lo fa chi gestisce.
  assert.equal(redacted.ok, false);
  await q(`UPDATE workspace_memberships SET role = 'exec_sponsor' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.builder]);
  try {
    const done = await svc.redactText(
      { workspaceId: ids.ws, actor: { userId: ids.builder, role: "exec_sponsor", isLateralSpace: false, kind: "persona" }, channel: "pagina" },
      card.id,
      Number((await row(card.id)).version),
      ["intake"],
    );
    assert.ok(done.ok, done.ok ? "" : done.message);
    const after = ((await row(card.id)).intake as { risposte: Array<{ at: string; text: string }> }).risposte;
    assert.deepEqual(after.map((a) => a.text), ["[testo rimosso]", "[testo rimosso]"]);
    assert.deepEqual(after.map((a) => a.at), answers.map((a) => a.at), "la data resta");
  } finally {
    await q(`UPDATE workspace_memberships SET role = 'function_lead' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.builder]);
  }
});

test("art. 15.4: la Storia e le letture non contano né raggruppano per chi ha proposto", opts, async () => {
  const mine = await seed();
  const other = await seed({ proposedBy: emails.colleague });
  signIn("contributor");
  ok(await actions.answerInfoRequestAction(ids.ws, mine.id, ANSWER, QUESTION));
  signIn("colleague");
  ok(await actions.answerInfoRequestAction(ids.ws, other.id, ANSWER, QUESTION));
  // Nessuna riga di Storia con una persona per le risposte: niente su cui contare per persona.
  const rows = await q(
    `SELECT count(*)::int AS n FROM use_case_events WHERE use_case_id = ANY($1::uuid[]) AND actor_kind = 'proponente' AND actor_user_id IS NOT NULL`,
    [[mine.id, other.id]],
  );
  assert.equal(rows[0].n, 0);
  // La lista dei revisori non porta chi ha proposto né chi ha risposto.
  const list = await hub.listHubItems(ids.ws, viewer("builder", "function_lead"));
  const text = JSON.stringify(list?.items.filter((i) => i.id === mine.id || i.id === other.id));
  for (const value of [emails.contributor, emails.colleague, ids.contributor, ids.colleague]) assert.ok(!text.includes(value), value);
});

/** Le colonne che `connectorStatus` legge, da una riga del database. */
function toStatusInput(r: Record<string, unknown>) {
  return {
    status: r.status as "proposed",
    portfolioReviewStatus: r.portfolio_review_status as "needs_inputs",
    reviewedBy: (r.reviewed_by as string | null) ?? null,
    publicNote: (r.public_note as string | null) ?? null,
    intake: (r.intake as Record<string, string> | null) ?? null,
    reviewBy: (r.review_by as string | null) ?? null,
  };
}
