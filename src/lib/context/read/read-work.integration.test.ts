import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fakeAppClaude, installAppModules, message, THINKING, type Captured, type Reply } from "../../ai/claude-test-kit.ts";

// «Contesto nel lavoro», la parte della lettura, sul database del pacchetto (RILASCIO-9b-COSTRUZIONE.md §5.6): le
// risposte del referente come fonte (solo con l'informativa ucq-2026-11-3, una per richiesta, da leggere di nuovo dopo
// una modifica, lette con il Claude finto, mai preselezionate, svuotate con la cancellazione dei dati del referente) e le
// richieste di «Cosa serve» a cui una call risponde (il legame nasce «proposta», alla conferma «aperta» con un fatto «Per
// tutti» e «scartata» con uno «Solo Lateral Space», la campanella dei revisori).
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Dati sintetici e
//   inventati (codici XX-…, persone «Persona …»), creati e cancellati qui. Nessun modello vero: risponde il Claude finto di
//   claude-test-kit.ts. Nessuna e-mail: le invia un postino finto.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let referents: typeof import("../../db/queries/use-case-referents.ts");
let pub: typeof import("../../db/queries/use-case-referent-public.ts");
let dispatch: typeof import("../../db/queries/use-case-referent-dispatch.ts");
let answersSource: typeof import("../../db/queries/context-referent.ts");
let reading: typeof import("../../db/queries/context-read.ts");
let proposals: typeof import("../../db/queries/context-proposals.ts");
let sources: typeof import("../../db/queries/context-sources.ts");
let needLinks: typeof import("../../db/queries/context-needs.ts");

const suffix = randomBytes(3).toString("hex");
const CODE = `XX-${String(1000 + Math.floor(Math.random() * 8000))}`;
const people = ["ls", "builder", "rev", "con"] as const;
type Person = (typeof people)[number];
const ids = { org: randomUUID(), ws: randomUUID(), useCase: randomUUID(), ...(Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>) };
const EMAIL: Record<Person, string> = {
  ls: `ls.lettura.${suffix}@ls.test`,
  builder: `builder.lettura.${suffix}@cliente.test`,
  rev: `rev.lettura.${suffix}@cliente.test`,
  con: `con.lettura.${suffix}@cliente.test`,
};
const ROLE: Record<Person, string> = { ls: "transformation_lead", builder: "function_lead", rev: "analyst", con: "contributor" };
const REFERENT_NAME = "Mario Rossi";
const REFERENT_EMAIL = `mario.rossi.${suffix}@rondine.test`;
const storageDir = mkdtempSync(join(tmpdir(), "lettura-"));

const ENV = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LOCAL_STORAGE_DIR: storageDir,
} as Record<string, string | undefined>;
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS", "USE_CASE_REFERENT_AI"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

type Ctx = import("../../use-cases/service.ts").WriteContext;
const as = (person: Person): Ctx => ({ workspaceId: ids.ws, actor: { userId: ids[person], role: ROLE[person], isLateralSpace: person === "ls", kind: "persona" }, channel: "pagina" });
type Actor = import("../visibility.ts").ContextActor;
const actor = (person: Person): Actor => ({ workspaceId: ids.ws, userId: ids[person], role: ROLE[person], isLateralSpace: person === "ls", channel: "web" });

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string; fieldErrors?: Record<string, string> }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: ${result.error} (${result.message}) ${JSON.stringify(result.fieldErrors ?? {})}`);
  return result.value;
}
/** Un esito della pagina pubblica (`{ ok, value } | { ok: false, code }`). */
function pok<T>(result: { ok: true; value: T } | { ok: false; code: string; message?: string }, label = "pagina"): T {
  if (!result.ok) assert.fail(`${label}: ${result.code} (${result.message ?? ""})`);
  return result.value;
}

const json = (value: unknown): Reply => message([THINKING, { type: "text", text: JSON.stringify(value) }]);
const NOTHING_SKIPPED = { persone: 0, sanitari: 0, altriClienti: 0, clientiDelCliente: 0 };
const proposal = (over: Record<string, unknown>) => ({
  tipo: "nuovo",
  testo: "",
  citazione: "",
  base: "detto",
  sezione: "lavoro",
  visibilita: "tutti",
  fattoRif: null,
  domandaRif: null,
  esigenzaRif: null,
  useCase: [],
  parte: null,
  ruolo: null,
  entro: null,
  entita: [],
  collegamenti: [],
  ...over,
});
const answer = (proposte: Array<Record<string, unknown>>): Reply => json({ proposte, nonRiportati: NOTHING_SKIPPED });
/** Il testo che il modello finto ha ricevuto: le regole e il messaggio. */
const sent = (request: Captured) => ({ system: JSON.stringify(request.body.system), prompt: JSON.stringify(request.body.messages) });

function fakeMailer() {
  const outbox: Array<{ text: string }> = [];
  return { outbox, async send(m: { text: string }) { outbox.push(m); return { ok: true as const }; } };
}

const state = { requestId: "", contactId: "", token: "", needs: [] as string[], sourceId: "", questions: [] as string[] };

async function linkOf() {
  const resolved = await pub.resolveReferentToken(state.token, new Date());
  if (resolved.access !== "ok") return assert.fail(`link: ${resolved.access}`);
  return resolved.link;
}
async function answersSourceRow(): Promise<Row | undefined> {
  return (await q(`SELECT * FROM context_sources WHERE workspace_id = $1::uuid AND origin = 'rispondi' AND external_id = $2`, [ids.ws, state.requestId]))[0];
}
async function run(statements: ReadonlyArray<{ text: string; params: readonly unknown[] }>) {
  for (const st of statements) await q(st.text, [...st.params]);
}

before(async () => {
  if (!enabled) return;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  ENV.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  for (const key of ["UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS"] as const) delete process.env[key];
  // L'aiuto dell'AI nel filo resta fuori: qui si prova solo «Contesto».
  process.env.USE_CASE_REFERENT_AI = "off";
  await installAppModules({});
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  await (await import("../../db/ensure-schema.ts")).ensureDbSchema();
  referents = await import("../../db/queries/use-case-referents.ts");
  pub = await import("../../db/queries/use-case-referent-public.ts");
  dispatch = await import("../../db/queries/use-case-referent-dispatch.ts");
  answersSource = await import("../../db/queries/context-referent.ts");
  reading = await import("../../db/queries/context-read.ts");
  proposals = await import("../../db/queries/context-proposals.ts");
  sources = await import("../../db/queries/context-sources.ts");
  needLinks = await import("../../db/queries/context-needs.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione lettura di prova', $2)`, [ids.org, `org-lettura-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Rondine di prova')`, [ids.ws, ids.org]);
  for (const person of people) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], EMAIL[person], `Persona ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], ROLE[person]]);
  }
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Problema di prova', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
    [ids.useCase, ids.ws, CODE],
  );
  // L'ok ai sub-responsabili per la lista di oggi: la lettura con il modello si può fare.
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role)
     VALUES ($1::uuid, $2, 'Registrato per conto del cliente di prova.', $3::uuid, 'transformation_lead')`,
    [ids.ws, (await import("../../uc/legal/subprocessors.ts")).SUBPROCESSORS_VERSION, ids.ls],
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
  await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE $1`, [`%${ids.ws}%`]);
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [people.map((p) => ids[p])]);
});

// ─── Le risposte del referente come fonte (§2.11) ────────────────────

test("con l'informativa ucq-2026-11-3 l'invio delle risposte crea la fonte: una per richiesta, «Solo Lateral Space», senza testo, da leggere", opts, async () => {
  ok(await referents.prepareReferentQuestions(as("builder"), ids.useCase), "domande");
  state.needs = (await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid ORDER BY n.sort_order, n.id`, [ids.useCase])).map((r) => String(r.id));
  assert.ok(state.needs.length >= 2, String(state.needs.length));
  const request = ok(
    await referents.sendReferentRequest(
      as("builder"),
      ids.useCase,
      { contact: { kind: "nuovo", displayName: REFERENT_NAME, email: REFERENT_EMAIL }, needIds: state.needs.slice(0, 2), message: "Grazie" },
      { env: ENV, requester: { name: "Persona builder", emailVerified: true } },
    ),
    "richiesta",
  );
  state.requestId = request.requestId;
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: request.requestId, env: ENV, mailer, sendIntervalMs: 0 } as never);
  state.token = /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(mailer.outbox[0]?.text ?? "")?.[1] ?? "";
  assert.ok(state.token, "il link");
  state.contactId = String((await q(`SELECT contact_id FROM use_case_referent_requests WHERE id = $1::uuid`, [request.requestId]))[0].contact_id);
  state.questions = (await q(`SELECT question FROM use_case_referent_request_items WHERE request_id = $1::uuid ORDER BY position`, [request.requestId])).map((r) => String(r.question));
  const { REFERENT_PRIVACY_NOTICE } = await import("../../use-cases/referent/labels.ts");
  assert.equal(REFERENT_PRIVACY_NOTICE.version, "ucq-2026-11-3");
  pok(await pub.acceptReferentPrivacy(await linkOf(), { version: REFERENT_PRIVACY_NOTICE.version, shown: REFERENT_PRIVACY_NOTICE.version }, new Date()), "informativa");
  // La prima risposta con un testo; la seconda «Non ce l'ho», con un commento che fa un nome.
  pok(await pub.saveReferentDraft(await linkOf(), { needId: state.needs[0], text: "Circa 200 ordini al mese, quasi tutti per e-mail.", dontKnow: false }, new Date()), "bozza 1");
  pok(await pub.saveReferentDraft(await linkOf(), { needId: state.needs[1], text: null, dontKnow: true, comment: "Chiedete a Giulia Neri dell'amministrazione." }, new Date()), "bozza 2");
  pok(await pub.submitReferentAnswers(await linkOf(), { needIds: state.needs.slice(0, 2) }, new Date()), "invio");

  const rows = await q(`SELECT * FROM context_sources WHERE workspace_id = $1::uuid AND origin = 'rispondi'`, [ids.ws]);
  assert.equal(rows.length, 1, "una fonte per richiesta");
  const [source] = rows;
  state.sourceId = String(source.id);
  assert.deepEqual(
    [source.kind, source.external_id, source.visibility, source.body, source.body_chars, source.read_status, source.title, source.added_by_user_id],
    ["risposta", state.requestId, "ls", null, 0, "da_leggere", `Risposte del referente · ${CODE}`, null],
  );
  const events = await q(`SELECT action, channel, actor_user_id FROM context_events WHERE workspace_id = $1::uuid AND source_id = $2::uuid`, [ids.ws, state.sourceId]);
  assert.deepEqual(events, [{ action: "fonte_aggiunta", channel: "rispondi", actor_user_id: null }]);
  // La fonte non si toglie: le risposte vivono nella scheda dello use case.
  assert.equal((await sources.removeContextSource(actor("ls"), state.sourceId)).ok, false);
  // Il pannello della fonte porta allo use case della richiesta («Apri lo use case»), solo per Lateral Space.
  const detail = await sources.getContextSource(actor("ls"), state.sourceId);
  assert.equal(detail?.useCaseId, ids.useCase);
  assert.equal(await sources.getContextSource(actor("rev"), state.sourceId), null, "il cliente non vede la fonte");
});

test("con l'informativa di prima (ucq-2026-11-2), o con risposte date prima di accettarla, la fonte non nasce", opts, async () => {
  const original = (await q(`SELECT privacy_accepted_at FROM use_case_referent_requests WHERE id = $1::uuid`, [state.requestId]))[0].privacy_accepted_at;
  await q(`DELETE FROM context_events WHERE workspace_id = $1::uuid AND source_id = $2::uuid`, [ids.ws, state.sourceId]);
  await q(`DELETE FROM context_sources WHERE id = $1::uuid`, [state.sourceId]);
  await q(`UPDATE use_case_referent_requests SET privacy_notice_version = 'ucq-2026-11-2' WHERE id = $1::uuid`, [state.requestId]);
  assert.deepEqual(await answersSource.referentSourceStatements({ workspaceId: ids.ws, requestId: state.requestId }), [], "nessuno statement");
  // Anche lo statement da solo controlla l'informativa.
  await run([answersSource.referentSourceSql({ workspaceId: ids.ws, requestId: state.requestId, title: answersSource.answersSourceTitle(CODE, null) })]);
  assert.equal(await answersSourceRow(), undefined);
  assert.equal((await answersSource.readAnswersSource(ids.ws, state.requestId)).text, "", "la lettura non compone niente");
  // L'informativa nuova accettata dopo le risposte: quelle risposte restano fuori.
  await q(`UPDATE use_case_referent_requests SET privacy_notice_version = 'ucq-2026-11-3', privacy_accepted_at = now() + interval '1 hour' WHERE id = $1::uuid`, [state.requestId]);
  await run(await answersSource.referentSourceStatements({ workspaceId: ids.ws, requestId: state.requestId }));
  assert.equal(await answersSourceRow(), undefined);
  assert.equal((await answersSource.readAnswersSource(ids.ws, state.requestId)).text, "");
  // Com'era: la fonte torna, da leggere.
  await q(`UPDATE use_case_referent_requests SET privacy_accepted_at = $2::timestamptz WHERE id = $1::uuid`, [state.requestId, original]);
  await run(await answersSource.referentSourceStatements({ workspaceId: ids.ws, requestId: state.requestId }));
  const again = await answersSourceRow();
  assert.equal(again?.read_status, "da_leggere");
  state.sourceId = String(again?.id);
});

test("«Chiedi al contesto» e ask_context: una risposta del referente arriva solo con l'informativa che lo permette, data dopo averla accettata", opts, async () => {
  const asking = await import("../../db/queries/context-ask.ts");
  const ANSWER = "Circa 200 ordini al mese, quasi tutti per e-mail.";
  const found = async () => (await asking.searchContext(actor("rev"), "Quanti ordini al mese?")).filter((s) => s.kind === "referente").map((s) => s.excerpt);
  assert.deepEqual(await found(), [ANSWER]);
  const [original] = await q(`SELECT privacy_notice_version, privacy_accepted_at FROM use_case_referent_requests WHERE id = $1::uuid`, [state.requestId]);
  try {
    // L'informativa di prima («Le usiamo solo per questo»): la risposta resta nella scheda e non va al modello.
    await q(`UPDATE use_case_referent_requests SET privacy_notice_version = 'ucq-2026-11-2' WHERE id = $1::uuid`, [state.requestId]);
    assert.deepEqual(await found(), []);
    // L'informativa nuova accettata dopo la risposta: nemmeno.
    await q(`UPDATE use_case_referent_requests SET privacy_notice_version = 'ucq-2026-11-3', privacy_accepted_at = now() + interval '1 hour' WHERE id = $1::uuid`, [state.requestId]);
    assert.deepEqual(await found(), []);
  } finally {
    await q(`UPDATE use_case_referent_requests SET privacy_notice_version = $2, privacy_accepted_at = $3::timestamptz WHERE id = $1::uuid`, [state.requestId, original.privacy_notice_version, original.privacy_accepted_at]);
  }
  assert.deepEqual(await found(), [ANSWER]);
});

// ─── La lettura con il Claude finto ──────────────────────────────────

test("la lettura compone il testo dal vivo, senza «Non ce l'ho» né nomi; il prompt non ha i fatti «Solo Lateral Space»; le proposte sono dello use case e mai preselezionate", opts, async () => {
  await q(
    `INSERT INTO context_facts (workspace_id, section, statement, basis, visibility, origin) VALUES
       ($1::uuid, 'regole', 'Il contratto con Lateral Space vale 40.000 euro.', 'detto', 'ls', 'manuale'),
       ($1::uuid, 'sistemi', 'Il gestionale è SAP Business One.', 'detto', 'tutti', 'manuale')`,
    [ids.ws],
  );
  const requests = fakeAppClaude([
    answer([
      proposal({ testo: "Arrivano circa 200 ordini al mese.", citazione: "Circa 200 ordini al mese" }),
      proposal({ tipo: "impegno", testo: "Mandare l'elenco dei fornitori.", citazione: "quasi tutti per e-mail", sezione: null, parte: "cliente", ruolo: "responsabile acquisti" }),
      // Un riferimento a una richiesta di «Cosa serve»: le risposte non ricevono l'elenco, non vale.
      proposal({ testo: "Gli ordini arrivano quasi tutti per e-mail.", citazione: "quasi tutti per e-mail", esigenzaRif: "R1" }),
    ]),
  ]);
  const outcome = ok(await reading.readContextSource(actor("ls"), state.sourceId), "lettura");
  assert.deepEqual(outcome, { status: "letto", proposals: 3, skipped: {} });
  assert.equal(requests.length, 1);
  const { system, prompt } = sent(requests[0]);
  assert.match(system, /Leggi le risposte che un referente del cliente ha dato alle domande del team/);
  assert.match(prompt, /<risposte-[a-z0-9]{12}>/);
  assert.ok(prompt.includes(JSON.stringify(`Domanda: ${state.questions[0]}\nRisposta: Circa 200 ordini al mese, quasi tutti per e-mail.`).slice(1, -1)), "la domanda e la risposta, dal vivo");
  assert.equal(prompt.includes(state.questions[1].slice(0, 30)), false, "«Non ce l'ho» resta fuori");
  for (const secret of ["Giulia Neri", REFERENT_NAME, REFERENT_EMAIL, "40.000"]) assert.equal(`${system}${prompt}`.includes(secret), false, secret);
  assert.ok(prompt.includes("Il gestionale è SAP Business One."), "i fatti «Per tutti» ci sono");
  assert.match(prompt, /RICHIESTE APERTE DI «COSA SERVE» \(riferimento \| use case \| richiesta\)\\n\(nessuno\)/);

  const open = await proposals.listOpenProposals(actor("ls"), { sourceId: state.sourceId });
  assert.ok(open);
  assert.equal(open.sources[0].kind, "risposta");
  const all = [...open.proposals, ...open.reconfirmed];
  assert.equal(all.length, 3);
  for (const p of all) {
    assert.equal(p.preselected, false, "una fonte del cliente: mai preselezionata");
    assert.ok(p.useCases.some((u) => u.id === ids.useCase), "legata allo use case della richiesta");
    assert.equal(p.answersNeed, null);
  }
  assert.equal((await q(`SELECT count(*)::int AS n FROM context_need_links WHERE workspace_id = $1::uuid`, [ids.ws]))[0].n, 0, "nessun legame");
});

test("una risposta cambiata rimette la fonte da leggere: le proposte aperte non corrette diventano superate, quelle corrette restano", opts, async () => {
  const open = (await proposals.listOpenProposals(actor("ls"), { sourceId: state.sourceId }))!;
  const fact = open.proposals.find((p) => p.statement === "Arrivano circa 200 ordini al mese.")!;
  ok(await proposals.editProposal(actor("ls"), fact.id, fact.version, { statement: "Arrivano circa 200 ordini al mese, per e-mail." }), "correzione");
  pok(await pub.editReferentAnswer(await linkOf(), { needId: state.needs[0], text: "Circa 250 ordini al mese, quasi tutti per e-mail." }, new Date()), "modifica");
  const source = await answersSourceRow();
  assert.deepEqual([source?.read_status, source?.read_attempts, source?.parts_read, source?.read_reason], ["da_leggere", 0, 0, null]);
  const rows = await q(`SELECT statement, status, edited FROM context_proposals WHERE source_id = $1::uuid ORDER BY position`, [state.sourceId]);
  assert.deepEqual(
    rows.map((r) => [r.status, r.edited]),
    [
      ["aperta", true],
      ["superata", false],
      ["superata", false],
    ],
  );
  const events = await q(`SELECT action, channel, actor_user_id, detail FROM context_events WHERE source_id = $1::uuid AND action = 'fonte_aggiornata'`, [state.sourceId]);
  assert.deepEqual(events, [{ action: "fonte_aggiornata", channel: "rispondi", actor_user_id: null, detail: { origine: "rispondi", tipo: "risposta", superate: 2 } }]);
});

test("la cancellazione dei dati del referente toglie le citazioni nate dalle sue risposte; i fatti restano", opts, async () => {
  fakeAppClaude([
    answer([
      proposal({ tipo: "impegno", testo: "Mandare l'elenco dei fornitori.", citazione: "quasi tutti per e-mail", sezione: null, parte: "cliente", ruolo: "responsabile acquisti" }),
      proposal({ testo: "Gli ordini arrivano quasi tutti per e-mail.", citazione: "quasi tutti per e-mail" }),
    ]),
  ]);
  const outcome = ok(await reading.readContextSource(actor("ls"), state.sourceId), "lettura dopo la modifica");
  assert.equal(outcome.status, "letto");
  const open = (await proposals.listOpenProposals(actor("ls"), { sourceId: state.sourceId }))!;
  const edited = open.proposals.find((p) => p.statement === "Arrivano circa 200 ordini al mese, per e-mail.")!;
  const commitment = open.proposals.find((p) => p.kind === "impegno")!;
  const left = open.proposals.find((p) => p.statement === "Gli ordini arrivano quasi tutti per e-mail.")!;
  assert.ok(edited && commitment && left);
  ok(await proposals.confirmProposals(actor("ls"), [{ id: edited.id, version: edited.version }, { id: commitment.id, version: commitment.version }]), "conferma");
  const [fact] = await q(`SELECT id, statement, quote, status FROM context_facts WHERE source_id = $1::uuid`, [state.sourceId]);
  assert.deepEqual([fact.statement, fact.quote, fact.status], ["Arrivano circa 200 ordini al mese, per e-mail.", "Circa 200 ordini al mese", "attivo"]);
  assert.equal((await q(`SELECT quote FROM context_commitments WHERE source_id = $1::uuid`, [state.sourceId]))[0].quote, "quasi tutti per e-mail");

  ok(await referents.eraseReferentData(as("builder"), ids.useCase, state.contactId, { env: ENV }), "cancellazione");
  const source = await answersSourceRow();
  assert.ok(source?.text_purged_at, "la fonte non si legge più");
  assert.equal(source?.read_status, "letto");
  assert.deepEqual((await q(`SELECT statement, quote, status FROM context_facts WHERE id = $1::uuid`, [fact.id]))[0], { statement: "Arrivano circa 200 ordini al mese, per e-mail.", quote: null, status: "attivo" });
  assert.equal((await q(`SELECT quote FROM context_commitments WHERE source_id = $1::uuid`, [state.sourceId]))[0].quote, null);
  const after = await q(`SELECT status, quote FROM context_proposals WHERE source_id = $1::uuid ORDER BY position`, [state.sourceId]);
  assert.ok(after.every((p) => p.quote === null), "nessuna citazione resta");
  assert.ok(after.every((p) => p.status !== "aperta"), "le proposte aperte sono superate");
  assert.equal((await q(`SELECT id FROM context_proposals WHERE id = $1::uuid`, [left.id]))[0] !== undefined, true);
  assert.deepEqual(
    await q(`SELECT channel, actor_user_id FROM context_events WHERE source_id = $1::uuid AND action = 'testo_cancellato'`, [state.sourceId]),
    [{ channel: "rispondi", actor_user_id: null }],
  );
  // Senza testo la fonte non si rilegge; una seconda cancellazione non cambia niente.
  assert.equal((await reading.readContextSource(actor("ls"), state.sourceId, { again: true })).ok, false);
  const version = (await answersSourceRow())?.version;
  await run(answersSource.referentSourcesEraseStatements({ workspaceId: ids.ws, contactId: state.contactId }));
  assert.equal((await answersSourceRow())?.version, version);
});

// ─── Una call che risponde a «Cosa serve» (§2.2) ─────────────────────

test("una call risponde a «Cosa serve»: il legame nasce «proposta»; alla conferma «aperta» con un fatto «Per tutti», «scartata» con uno «Solo Lateral Space»; i revisori lo sanno", opts, async () => {
  const need = { pec: randomUUID(), erp: randomUUID() };
  // Le due richieste più recenti del workspace: R1 e R2 nel prompt.
  await q(
    `INSERT INTO use_case_needs (id, workspace_id, type, title, status, owner_side, created_at) VALUES
       ($1::uuid, $3::uuid, 'requisito', 'Come arrivano gli ordini dei fornitori?', 'da_chiedere', 'cliente', now() + interval '2 days'),
       ($2::uuid, $3::uuid, 'requisito', 'Quale gestionale usate?', 'chiesta', NULL, now() + interval '1 day')`,
    [need.pec, need.erp, ids.ws],
  );
  await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $3::uuid), ($2::uuid, $3::uuid)`, [need.pec, need.erp, ids.useCase]);
  const note = ok(
    await sources.addContextNote(actor("ls"), {
      title: "Call sugli ordini",
      occurredOn: "2026-11-14",
      body: `Call sugli ordini (${suffix}).\nGli ordini dei fornitori arrivano per PEC.\nIl listino riservato vale 40.000 euro.\nIl gestionale è Odoo da gennaio.`,
      origin: "web",
    }),
    "appunti",
  );
  const requests = fakeAppClaude([
    answer([
      proposal({ testo: "Gli ordini dei fornitori arrivano per PEC.", citazione: "Gli ordini dei fornitori arrivano per PEC.", esigenzaRif: "R1" }),
      proposal({ testo: "Il listino riservato vale 40.000 euro.", citazione: "Il listino riservato vale 40.000 euro.", visibilita: "ls", sezione: "regole", esigenzaRif: "R2" }),
      proposal({ testo: "Il gestionale è Odoo da gennaio.", citazione: "Il gestionale è Odoo da gennaio.", sezione: "sistemi", esigenzaRif: "R2" }),
      proposal({ tipo: "impegno", testo: "Mandare un esempio di PEC.", citazione: "", sezione: null, parte: "cliente", esigenzaRif: "R1" }),
    ]),
  ]);
  assert.equal(ok(await reading.readContextSource(actor("ls"), note.sourceId), "lettura").status, "letto");
  const { system, prompt } = sent(requests[0]);
  assert.match(system, /Se un fatto nuovo risponde a una richiesta aperta dell'elenco, metti il suo riferimento in esigenzaRif\./);
  assert.ok(prompt.includes(`RICHIESTE APERTE DI «COSA SERVE» (riferimento | use case | richiesta)\\nR1 | ${CODE} | Come arrivano gli ordini dei fornitori?\\nR2 | ${CODE} | Quale gestionale usate?`), "le richieste aperte, le più recenti per prime");

  const links = await q(`SELECT l.id, l.need_id, l.status, p.statement FROM context_need_links l JOIN context_proposals p ON p.id = l.proposal_id WHERE l.workspace_id = $1::uuid ORDER BY p.position`, [ids.ws]);
  assert.deepEqual(
    links.map((l) => [l.statement, l.need_id, l.status]),
    [
      ["Gli ordini dei fornitori arrivano per PEC.", need.pec, "proposta"],
      ["Il listino riservato vale 40.000 euro.", need.erp, "proposta"],
      ["Il gestionale è Odoo da gennaio.", need.erp, "proposta"],
    ],
    "un impegno non fa un legame",
  );
  const open = (await proposals.listOpenProposals(actor("ls"), { sourceId: note.sourceId }))!;
  const byText = new Map(open.proposals.map((p) => [p.statement, p]));
  const pec = byText.get("Gli ordini dei fornitori arrivano per PEC.")!;
  const price = byText.get("Il listino riservato vale 40.000 euro.")!;
  const erp = byText.get("Il gestionale è Odoo da gennaio.")!;
  assert.deepEqual(pec.answersNeed, { needId: need.pec, title: "Come arrivano gli ordini dei fornitori?", code: CODE });
  assert.equal(byText.get("Mandare un esempio di PEC.")?.answersNeed, null);

  // «Scarta»: il legame si scarta con la proposta.
  ok(await proposals.discardProposals(actor("ls"), [erp.id]), "scarto");
  const discarded = (await q(`SELECT status, decided_at, fact_id FROM context_need_links WHERE proposal_id = $1::uuid`, [erp.id]))[0];
  assert.equal(discarded.status, "scartata");
  assert.ok(discarded.decided_at);

  ok(await proposals.confirmProposals(actor("ls"), [{ id: pec.id, version: pec.version }, { id: price.id, version: price.version }]), "conferma");
  const pecFact = (await q(`SELECT id, visibility FROM context_facts WHERE statement = 'Gli ordini dei fornitori arrivano per PEC.' AND workspace_id = $1::uuid`, [ids.ws]))[0];
  const priceFact = (await q(`SELECT id, visibility FROM context_facts WHERE statement = 'Il listino riservato vale 40.000 euro.' AND workspace_id = $1::uuid`, [ids.ws]))[0];
  assert.deepEqual([pecFact.visibility, priceFact.visibility], ["tutti", "ls"]);
  const [opened] = await q(`SELECT status, fact_id, decided_at FROM context_need_links WHERE proposal_id = $1::uuid`, [pec.id]);
  assert.deepEqual([opened.status, opened.fact_id, opened.decided_at], ["aperta", pecFact.id, null], "«Per tutti»: aperta, con il fatto");
  const [closed] = await q(`SELECT status, fact_id, decided_by_user_id FROM context_need_links WHERE proposal_id = $1::uuid`, [price.id]);
  assert.deepEqual([closed.status, closed.fact_id, closed.decided_by_user_id], ["scartata", null, ids.ls], "«Solo Lateral Space»: scartata, il testo non arriva al cliente");
  assert.deepEqual(
    await q(`SELECT fact_id, detail, actor_user_id FROM context_events WHERE workspace_id = $1::uuid AND action = 'richiesta_dalla_call'`, [ids.ws]),
    [{ fact_id: pecFact.id, detail: { esigenza: need.pec }, actor_user_id: null }],
  );
  // La campanella dei revisori, mai a chi ha confermato né a chi contribuisce.
  const bell = await q(`SELECT recipient_user_id FROM use_case_notifications WHERE workspace_id = $1::uuid AND kind = 'dalla_call' AND use_case_id = $2::uuid`, [ids.ws, ids.useCase]);
  const recipients = new Set(bell.map((r) => String(r.recipient_user_id)));
  assert.ok(recipients.has(ids.builder) && recipients.has(ids.rev), JSON.stringify([...recipients]));
  assert.equal(recipients.has(ids.ls), false);
  assert.equal(recipients.has(ids.con), false);
  // Nella scheda, per i revisori: «Una call del 14 nov risponde: …», solo con il fatto «Per tutti».
  const shown = await needLinks.listNeedLinks(actor("rev"), ids.useCase);
  assert.deepEqual(Object.keys(shown), [need.pec]);
  assert.deepEqual([shown[need.pec].statement, shown[need.pec].from], ["Gli ordini dei fornitori arrivano per PEC.", "call"]);
});

test("la pulizia dei 12 mesi degli appunti non tocca le fonti delle risposte: le chiude la conservazione del referente", opts, async () => {
  // Due fonti di due anni fa, mai cancellate: un appunto e le risposte di una richiesta (inventata).
  const [note] = await q(
    `INSERT INTO context_sources (workspace_id, kind, origin, title, occurred_on, body, body_chars, visibility, read_status, parts_total, parts_read, created_at)
     VALUES ($1::uuid, 'appunti', 'web', 'Appunti vecchi', '2024-11-14', 'Testo di prova.', 15, 'ls', 'letto', 1, 1, now() - interval '2 years') RETURNING id::text AS id`,
    [ids.ws],
  );
  const [answers] = await q(
    `INSERT INTO context_sources (workspace_id, kind, origin, title, occurred_on, body, body_chars, external_id, visibility, read_status, parts_total, parts_read, created_at)
     VALUES ($1::uuid, 'risposta', 'rispondi', 'Risposte del referente · XX-0099', '2024-11-14', NULL, 0, $2, 'ls', 'letto', 1, 1, now() - interval '2 years') RETURNING id::text AS id`,
    [ids.ws, randomUUID()],
  );
  await sources.purgeExpiredNoteText(new Date());
  const rows = await q(`SELECT id::text AS id, text_purged_at FROM context_sources WHERE id = ANY($1::uuid[])`, [[note.id, answers.id]]);
  const purged = new Map(rows.map((r) => [String(r.id), r.text_purged_at !== null]));
  assert.equal(purged.get(String(note.id)), true, "l'appunto di due anni fa perde il testo");
  assert.equal(purged.get(String(answers.id)), false, "la fonte delle risposte resta: la chiude la conservazione del referente");
});
