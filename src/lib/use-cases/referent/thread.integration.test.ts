import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// (Rilascio 6) «Il filo con il referente» sul database di prova: «Chiedi un chiarimento» sulla risposta a una
// domanda e su una voce (la richiesta completata torna «inviata», il link si rinnova, l'informazione torna
// «In attesa», l'email al referente parte con un'email al giorno), la risposta del referente (la richiesta
// torna «completata», la campanella e l'avviso a chi ha chiesto), «Ho un dubbio» e «Rispondi» (anche su una
// richiesta completata), «Fatto», le domande nuove alla stessa persona nella stessa richiesta («Nuove
// domande»), la modifica di una risposta fino a «A posto» (decisione 3), gli stati della lista e del blocco,
// le proposte dell'AI («Chiedi questo», «Lascia stare»), la cancellazione e la conservazione.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
// Nessuna email vera (mailer finto). Dati sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
}
const opts = { skip: !enabled };

type Mail = import("../../uc/notify/dispatch.ts").OutgoingEmail;
type Panel = import("./contract.ts").UseCaseReferentPanel;
type Link = import("../../db/queries/use-case-referent-public.ts").ReferentLink;

let referents: typeof import("../../db/queries/use-case-referents.ts");
let thread: typeof import("../../db/queries/use-case-referent-thread.ts");
let check: typeof import("../../db/queries/use-case-referent-check.ts");
let pub: typeof import("../../db/queries/use-case-referent-public.ts");
let dispatch: typeof import("../../db/queries/use-case-referent-dispatch.ts");
let states: typeof import("../../db/queries/use-case-referent-states.ts");
let needsMod: typeof import("../needs.ts");
let eraseMod: typeof import("./erase.ts");
let calendar: typeof import("../../uc/calendar.ts");
let ai: typeof import("../../db/queries/use-case-referent-ai.ts");
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), contributor: randomUUID() };
const storageDir = mkdtempSync(join(tmpdir(), "referenti-filo-"));
const ENV = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LOCAL_STORAGE_DIR: storageDir,
} as Record<string, string | undefined>;
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const ctx = (who: "builder" | "contributor" = "builder") => ({
  workspaceId: ids.ws,
  actor: { userId: ids[who], role: who === "builder" ? "function_lead" : "contributor", isLateralSpace: false, kind: "persona" as const },
  channel: "pagina" as const,
});
function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}
function refused(result: { ok: boolean; error?: string }, error: string, label = "rifiuto") {
  assert.equal(result.ok, false, label);
  assert.equal(result.error, error, label);
}
const pok = <T>(r: { ok: true; value: T } | { ok: false; code: string; message: string }, label = "esito"): T => {
  if (!r.ok) assert.fail(`${label}: atteso ok, ricevuto ${r.code} (${r.message})`);
  return r.value;
};

/** Un modello con una voce a ore: 3.000 volte l'anno, 12 minuti. */
const MODEL = {
  v: 1,
  primary: "tempo",
  components: [{ kind: "ore", key: "tempo-1", lever: "tempo", label: "Controllo delle fatture", confidence: "ipotesi", volumeYear: 3000, unit: "pratiche", minutesPerUnit: 12, automatablePct: 50, basis: "Dal team" }],
};
const SEEN = { kind: "ore", volumeYear: 3000, minutes: 12, eurYear: null };

/** Un giorno lavorativo di Roma dopo oggi, alle 10:30: l'ora delle novità del team in questi test (dentro la finestra). */
let NOW: Date;

let cards = 0;
async function newCard(): Promise<{ id: string; needs: string[] }> {
  const id = randomUUID();
  cards++;
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, value_model, target_quarter)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Le fatture arrivano via PEC.', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed', $4::jsonb, '2027-Q1')`,
    [id, ids.ws, `FL-${String(1000 + cards)}`, JSON.stringify(MODEL)],
  );
  const needs: string[] = [];
  for (const [n, title] of ["Volumi mensili", "Sistemi usati", "Esempio di pratica"].entries()) {
    const need = randomUUID();
    await q(`INSERT INTO use_case_needs (id, workspace_id, type, title, status, owner_side, sort_order) VALUES ($1::uuid, $2::uuid, 'requisito', $3, 'da_chiedere', 'cliente', $4)`, [need, ids.ws, title, n]);
    await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [need, id]);
    needs.push(need);
  }
  return { id, needs };
}

/** Le email in coda per una richiesta, mandate con un mailer finto all'ora `at`. */
async function send(requestId: string, at?: Date): Promise<Mail[]> {
  const outbox: Mail[] = [];
  await dispatch.dispatchReferentEmails({ requestId, env: ENV, now: at, mailer: { async send(m: Mail) { outbox.push(m); return { ok: true as const }; } }, sendIntervalMs: 0 });
  return outbox;
}

let seq = 0;
/** Il referente sceglie, riceve il link, conferma, risponde sulla voce e alle prime due domande, invia. */
async function answeredReferent(card: { id: string; needs: string[] }): Promise<{ requestId: string; contactId: string; link: Link; token: string }> {
  const sent = ok(
    await referents.sendReferentRequest(
      ctx(),
      card.id,
      { kind: "referente", expectedReferentRequestId: null, contact: { kind: "nuovo", displayName: "Aldo Prova", email: `aldo.${seq++}.${suffix}@rondine.test` }, needIds: card.needs.slice(0, 2) },
      { env: ENV, requester: { name: "Giulia Neri", emailVerified: true } },
    ),
    "invio",
  );
  const outbox = await send(sent.requestId);
  const token = /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(outbox[0]?.text ?? "")?.[1];
  assert.ok(token, "il link nell'email");
  const first = await pub.resolveReferentToken(token!, new Date());
  if (first.access !== "ok") assert.fail("link");
  pok(await pub.acceptReferentPrivacy(first.link, { version: "ucq-2026-11-2" }, new Date()) as never, "informativa");
  const link = await linkOf(token!);
  pok(await pub.saveReferentCheck(link, { step: 1, confirm: "si", note: null }, new Date()) as never, "passo 1");
  pok(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "tempo-1", seen: SEEN, answer: "meno", timesPerMonth: 200 } }, new Date()) as never, "passo 2");
  pok(await pub.saveReferentDraft(link, { needId: card.needs[0], text: "Circa 200 al mese", dontKnow: false }, new Date()) as never, "bozza 1");
  pok(await pub.saveReferentDraft(link, { needId: card.needs[1], text: "Il gestionale", dontKnow: false }, new Date()) as never, "bozza 2");
  pok(await pub.submitReferentAnswers(link, {}, new Date()) as never, "invia");
  // Il grazie dopo l'invio parte subito: le email dopo sono quelle del filo.
  assert.match((await send(sent.requestId)).map((m) => m.subject).join("|"), /grazie per le risposte/);
  const [row] = await q(`SELECT contact_id, status FROM use_case_referent_requests WHERE id = $1::uuid`, [sent.requestId]);
  assert.equal(row.status, "completata");
  return { requestId: sent.requestId, contactId: String(row.contact_id), link: await linkOf(token!), token: token! };
}

async function linkOf(token: string): Promise<Link> {
  const r = await pub.resolveReferentToken(token, new Date());
  if (r.access !== "ok") assert.fail(`link: ${r.access}`);
  return r.link;
}

async function panelOf(useCaseId: string): Promise<Panel> {
  const viewer = { userId: ids.builder, role: "function_lead", isLateralSpace: false, emailVerified: true, email: `builder.${suffix}@cliente.test` } as never;
  const all = await (await import("../../db/queries/use-case-needs.ts")).listWorkspaceNeeds(ids.ws, viewer);
  const panel = await referents.loadUseCaseReferentPanel({
    workspaceId: ids.ws,
    useCaseId,
    viewer,
    session: { id: ids.builder, name: "Giulia Neri", email: `builder.${suffix}@cliente.test`, emailVerified: true },
    role: "function_lead",
    needs: needsMod.needListsOfUseCase(all ?? [], useCaseId),
    eligible: true,
    env: ENV,
  });
  assert.ok(panel?.available, "il pannello c'è");
  return panel!;
}
async function listState(useCaseId: string): Promise<string | undefined> {
  const viewer = { userId: ids.builder, role: "function_lead", isLateralSpace: false, emailVerified: true, email: `builder.${suffix}@cliente.test` };
  const out = await states.listReferentStates(ids.ws, viewer as never, [{ id: useCaseId, phase: "approvato" }], { env: ENV });
  return out?.states[useCaseId.toLowerCase()];
}
const needStatus = async (id: string) => String((await q(`SELECT status FROM use_case_needs WHERE id = $1::uuid`, [id]))[0]?.status);
const requestOf = async (id: string) =>
  (await q(`SELECT status, reminder_count, reopened_at IS NOT NULL AS reopened, renewed_at IS NOT NULL AS renewed, expires_at, completed_at FROM use_case_referent_requests WHERE id = $1::uuid`, [id]))[0];
const messagesOf = async (requestId: string) =>
  (await q(`SELECT id, anchor, side, kind, body, handled_at IS NOT NULL AS handled, removed_reason FROM use_case_referent_messages WHERE request_id = $1::uuid ORDER BY created_at, id`, [requestId])).map((r) => ({ ...r }));
async function story(useCaseId: string): Promise<string[]> {
  return (await q(`SELECT phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND 'richiesta_referente' = ANY(fields) ORDER BY at, id`, [useCaseId])).map((r) => String(r.phase_after));
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  ENV.USE_CASE_HUB_WORKSPACES = ids.ws;
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  referents = await import("../../db/queries/use-case-referents.ts");
  thread = await import("../../db/queries/use-case-referent-thread.ts");
  check = await import("../../db/queries/use-case-referent-check.ts");
  pub = await import("../../db/queries/use-case-referent-public.ts");
  dispatch = await import("../../db/queries/use-case-referent-dispatch.ts");
  states = await import("../../db/queries/use-case-referent-states.ts");
  needsMod = await import("../needs.ts");
  eraseMod = await import("./erase.ts");
  calendar = await import("../../uc/calendar.ts");
  ai = await import("../../db/queries/use-case-referent-ai.ts");
  NOW = new Date(calendar.romeLocalToUtc(calendar.addWorkingDays(calendar.romeDate(new Date()), 1), 10).getTime() + 30 * 60_000);
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione filo', $2)`, [ids.org, `hub-filo-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Rondine prova')`, [ids.ws, ids.org]);
  for (const [id, role, email] of [[ids.builder, "function_lead", `builder.${suffix}@cliente.test`], [ids.contributor, "contributor", `contrib.${suffix}@cliente.test`]] as const) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [id, email, role === "function_lead" ? "Giulia Neri" : "Persona contributor"]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, id, role]);
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
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.builder, ids.contributor]]);
});

test("«Chiedi un chiarimento» su una risposta: stessa richiesta riaperta, link rinnovato, «In attesa», «Chiarimento in attesa», un'email; poi la risposta del referente", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const before = await requestOf(r.requestId);
  assert.equal(await listState(card.id), "da_verificare", "la stima diversa e le risposte da verificare");
  // Il pannello offre «Chiedi un chiarimento» sulla risposta della domanda, sulla voce e sulla conferma.
  const panel = await panelOf(card.id);
  const answer = panel.needs[card.needs[0]].answers.find((a) => a.source === "referente")!;
  assert.equal(answer.clarify?.requestId, r.requestId);
  assert.equal(answer.clarify?.pending, null);
  assert.equal(panel.referent?.check?.benefits?.[0].clarify?.anchor, "beneficio");
  assert.equal(panel.referent?.check?.clarify?.anchor, "generale");
  assert.equal(panel.referent?.turn, null, "nessun filo ancora: nessun turno");

  const input = { requestId: r.requestId, anchor: "domanda", needId: card.needs[0], text: "Quante, più o meno, a fine mese?" };
  refused(await thread.askReferentClarification(ctx("contributor"), card.id, input, { env: ENV, now: NOW }), "permesso_mancante", "un contributore");
  refused(await thread.askReferentClarification(ctx(), card.id, { ...input, text: "x" }, { env: ENV, now: NOW }), "testo_vuoto");
  refused(await thread.askReferentClarification(ctx(), card.id, { ...input, text: "y".repeat(301) }, { env: ENV, now: NOW }), "riga_troppo_lunga");
  refused(await thread.askReferentClarification(ctx(), card.id, { ...input, text: "Ha una diagnosi di diabete, il codice è RSSMRA80A01H501U?" }, { env: ENV, now: NOW }), "testo_sanitario", "dati sanitari rifiutati");
  refused(await thread.askReferentClarification(ctx(), card.id, { ...input, needId: card.needs[2] }, { env: ENV, now: NOW }), "filo_non_disponibile", "una domanda senza risposta");
  const asked = ok(await thread.askReferentClarification(ctx(), card.id, { ...input, text: "Lo controlla Mario Rossi (mario@rondine.test)?" }, { env: ENV, now: NOW }), "chiarimento");
  refused(await thread.askReferentClarification(ctx(), card.id, input, { env: ENV, now: NOW }), "chiarimento_aperto", "un secondo chiarimento sulla stessa risposta");

  const reopened = await requestOf(r.requestId);
  assert.equal(reopened.status, "inviata", "riaperta");
  assert.equal(reopened.reopened, true);
  assert.equal(reopened.renewed, true);
  assert.equal(Number(reopened.reminder_count), 0);
  assert.ok(new Date(String(reopened.expires_at)).getTime() >= new Date(String(before.expires_at)).getTime(), "mai prima di prima");
  assert.ok(new Date(String(reopened.expires_at)).getTime() > Date.now() + 29 * 86_400_000, "30 giorni da adesso");
  const tokens = await q(`SELECT expires_at FROM use_case_referent_tokens WHERE request_id = $1::uuid AND revoked_at IS NULL`, [r.requestId]);
  assert.ok(tokens.length > 0 && tokens.every((t) => String(t.expires_at) === String(reopened.expires_at)), "i token valgono quanto la richiesta");
  assert.equal(await needStatus(card.needs[0]), "chiesta", "l'informazione torna «In attesa»");
  assert.deepEqual((await messagesOf(r.requestId)).map((m) => `${m.side}:${m.kind}:${m.anchor}:${m.handled}`), ["team:chiarimento:domanda:false"]);
  assert.equal(asked.messageId.length, 36);
  assert.equal(await listState(card.id), "da_verificare", "la stima diversa sulla voce aspetta ancora il team");
  // Il referente vede la novità nell'email del giorno (un'email al giorno, in orario d'ufficio).
  const [item] = await q(`SELECT it.kind, it.new_questions, it.clarifications, it.replies, e.scheduled_at FROM use_case_referent_email_items it JOIN use_case_referent_emails e ON e.id = it.email_id WHERE it.request_id = $1::uuid AND it.kind = 'nuove'`, [r.requestId]);
  assert.deepEqual([item.kind, item.new_questions, item.clarifications, item.replies], ["nuove", 1, 1, 0]);
  const mails = await send(r.requestId, new Date(NOW.getTime() + 60_000));
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /^Rondine prova: un chiarimento sul caso d'uso «FL-\d+ · Fatture fornitori»$/);
  assert.match(mails[0].text, /Il team ti chiede un chiarimento sul caso d'uso/);
  assert.ok(!mails[0].text.includes("Mario Rossi") && !mails[0].text.includes("fine mese"), "mai il testo del messaggio nell'email");
  assert.ok((await story(card.id)).includes("chiarimento"));
  // La scheda: il chiarimento in attesa sulla risposta, il turno al referente.
  const waiting = await panelOf(card.id);
  assert.match(waiting.needs[card.needs[0]].answers.find((a) => a.source === "referente")!.clarify?.pending ?? "", /Mario Rossi/);
  assert.equal(waiting.referent?.turn, "team", "la stima diversa è ancora del team");
  assert.equal(waiting.thread?.messages.length, 1);
  assert.equal(waiting.thread?.messages[0].waiting, true);

  // Il referente risponde dal suo link: la richiesta torna «completata», l'informazione «Da verificare».
  const link = await linkOf(r.token);
  const reply = await thread.replyToReferentClarification(link, { messageId: asked.messageId, text: "Circa 220, a fine mese di più." }, new Date());
  pok(reply as never, "risposta al chiarimento");
  assert.deepEqual((await messagesOf(r.requestId)).map((m) => `${m.side}:${m.kind}:${m.handled}`), ["team:chiarimento:true", "referente:risposta:false"]);
  assert.equal((await requestOf(r.requestId)).status, "completata", "niente più di aperto: completata");
  assert.equal(await needStatus(card.needs[0]), "in_verifica");
  const bell = await q(`SELECT kind, answers FROM use_case_notifications WHERE use_case_id = $1::uuid AND recipient_user_id = $2::uuid AND kind = 'risposte'`, [card.id, ids.builder]);
  assert.ok(bell.some((b) => Number(b.answers) >= 1), "la campanella del team");
  const alert = await q(`SELECT i.answers FROM use_case_requester_email_items i WHERE i.request_id = $1::uuid`, [r.requestId]);
  assert.ok(alert.some((a) => Number(a.answers) >= 1), "l'avviso a chi ha chiesto");
  assert.ok((await story(card.id)).includes("chiarimento_risposto"));
  // Una seconda risposta allo stesso chiarimento: non c'è più.
  assert.equal((await thread.replyToReferentClarification(link, { messageId: asked.messageId, text: "Di nuovo" }, new Date())).ok, false);
});

test("«Chiedi un chiarimento» su una voce: la voce aspetta il referente, poi la sua risposta aspetta il team fino a «Fatto»", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const before = await panelOf(card.id);
  assert.equal(before.referent?.check?.benefits?.[0].needsReview, true, "«È di meno» aspetta il team");
  const asked = ok(
    await thread.askReferentClarification(ctx(), card.id, { requestId: r.requestId, anchor: "beneficio", componentKey: "tempo-1", text: "Hai scritto «è di meno»: quanto, più o meno?" }, { env: ENV, now: NOW }),
    "chiarimento sulla voce",
  );
  const waiting = await panelOf(card.id);
  assert.equal(waiting.referent?.check?.benefits?.[0].needsReview, false, "con il chiarimento in attesa la voce aspetta il referente");
  assert.ok(waiting.referent?.check?.benefits?.[0].clarify?.pending);
  // Le due domande sono ancora «Da verificare»: tocca al team.
  assert.equal(waiting.referent?.state, "da_verificare");
  await q(`UPDATE use_case_needs SET status = 'validata', done_at = now() WHERE id = ANY($1::uuid[])`, [card.needs.slice(0, 2)]);
  assert.equal(await listState(card.id), "chiarimento", "solo il chiarimento: «Chiarimento in attesa»");
  assert.equal((await panelOf(card.id)).referent?.turn, "referente", "«Tocca al referente»");
  pok((await thread.replyToReferentClarification(await linkOf(r.token), { messageId: asked.messageId, text: "Circa la metà." }, new Date())) as never, "risposta");
  const news = await panelOf(card.id);
  assert.equal(news.referent?.state, "da_verificare");
  assert.equal(news.referent?.review, "stima", "la stima diversa torna da guardare");
  const replyView = news.thread!.messages.find((m) => m.side === "referente")!;
  assert.equal(replyView.canDone, true, "«Fatto» sulla risposta della voce");
  assert.equal(news.referent?.turn, "team", "«Tocca a noi»");
  refused(await thread.markReferentMessageDone(ctx("contributor"), card.id, replyView.id, { env: ENV }), "permesso_mancante");
  // «Tieni la nostra» sulla voce gestisce anche la risposta nel filo.
  const rv = Number((await q(`SELECT version FROM use_case_referent_requests WHERE id = $1::uuid`, [r.requestId]))[0].version);
  ok(await check.keepReferentBenefit(ctx(), card.id, r.requestId, "tempo-1", rv, ENV), "tieni la nostra");
  assert.deepEqual((await messagesOf(r.requestId)).map((m) => `${m.side}:${m.kind}:${m.handled}`), ["team:chiarimento:true", "referente:risposta:true"]);
  assert.equal(await listState(card.id), "fatto");
  ok(await thread.markReferentMessageDone(ctx(), card.id, replyView.id, { env: ENV }), "«Fatto» una seconda volta non cambia niente");
});

test("«Ho un dubbio» e «Rispondi»: «Il referente ha chiesto qualcosa», la campanella «domanda», l'avviso a chi ha chiesto; la risposta del team anche su una richiesta completata", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  await q(`UPDATE use_case_needs SET status = 'validata', done_at = now() WHERE id = ANY($1::uuid[])`, [card.needs.slice(0, 2)]);
  const rv = Number((await q(`SELECT version FROM use_case_referent_requests WHERE id = $1::uuid`, [r.requestId]))[0].version);
  ok(await check.keepReferentBenefit(ctx(), card.id, r.requestId, "tempo-1", rv, ENV), "voce chiusa");
  assert.equal(await listState(card.id), "fatto");
  const link = await linkOf(r.token);
  assert.equal(link.status, "completata", "il link vive dopo «Invia»");
  refused({ ok: false, error: (await thread.postReferentDoubt(link, { anchor: "domanda", needId: card.needs[2], text: "?" }, new Date()) as { code?: string }).code } as never, "domanda_non_disponibile", "una domanda che non è sua");
  const doubt = pok((await thread.postReferentDoubt(link, { anchor: "beneficio", componentKey: "tempo-1", text: "Contate anche le fatture estere?" }, new Date())) as never, "dubbio") as { messageId: string };
  assert.equal(await listState(card.id), "ha_chiesto", "«Il referente ha chiesto qualcosa»");
  const panel = await panelOf(card.id);
  assert.equal(panel.referent?.state, "ha_chiesto");
  assert.equal(panel.referent?.turn, "team");
  assert.equal(panel.thread?.messages.find((m) => m.id === doubt.messageId)?.canReply, true);
  const [bell] = await q(`SELECT kind, answers FROM use_case_notifications WHERE use_case_id = $1::uuid AND recipient_user_id = $2::uuid AND kind = 'domanda'`, [card.id, ids.builder]);
  assert.equal(bell?.kind, "domanda", "la campanella del team");
  const [alert] = await q(`SELECT i.questions, i.answers FROM use_case_requester_email_items i WHERE i.request_id = $1::uuid AND i.questions > 0`, [r.requestId]);
  assert.equal(Number(alert?.questions), 1, "l'avviso a chi ha chiesto");
  assert.ok((await story(card.id)).includes("dubbio"));

  refused(await thread.answerReferentDoubt(ctx("contributor"), card.id, { messageId: doubt.messageId, text: "Sì, anche quelle." }, { env: ENV, now: NOW }), "permesso_mancante");
  const answered = ok(await thread.answerReferentDoubt(ctx(), card.id, { messageId: doubt.messageId, text: "Sì, anche quelle estere." }, { env: ENV, now: NOW }), "risposta del team");
  refused(await thread.answerReferentDoubt(ctx(), card.id, { messageId: doubt.messageId, text: "Di nuovo" }, { env: ENV, now: NOW }), "messaggio_gestito");
  assert.deepEqual((await messagesOf(r.requestId)).map((m) => `${m.side}:${m.kind}:${m.handled}`), ["referente:dubbio:true", "team:risposta:false"]);
  assert.equal((await requestOf(r.requestId)).status, "completata", "una risposta del team non riapre la richiesta");
  assert.equal(await listState(card.id), "fatto");
  assert.ok(answered.messageId);
  const mails = await send(r.requestId, new Date(NOW.getTime() + 60_000));
  assert.equal(mails.length, 1, "l'email della risposta parte anche con la richiesta completata");
  assert.match(mails[0].subject, /^Rondine prova: una risposta sul caso d'uso «FL-\d+ · Fatture fornitori»$/);
  assert.ok(!mails[0].text.includes("estere"), "mai il testo nell'email");
});

test("domande nuove alla stessa persona: la stessa richiesta, «Nuove domande», riaperta e rinnovata; «Aggiungi domande» su una richiesta completata", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const sent = ok(
    await referents.sendReferentRequest(
      ctx(),
      card.id,
      { kind: "domande", contact: { kind: "esistente", contactId: r.contactId }, needIds: [card.needs[2]], message: "Un'ultima cosa." },
      { env: ENV, requester: { name: "Giulia Neri", emailVerified: true }, now: NOW },
    ),
    "domande nuove",
  );
  assert.equal(sent.requestId, r.requestId, "nessuna richiesta nuova");
  const [count] = await q(`SELECT count(*)::int AS n FROM use_case_referent_requests WHERE use_case_id = $1::uuid`, [card.id]);
  assert.equal(count.n, 1);
  const req = await requestOf(r.requestId);
  assert.equal(req.status, "inviata");
  assert.equal(req.reopened, true);
  const items = await q(`SELECT need_id::text AS need, follow_up FROM use_case_referent_request_items WHERE request_id = $1::uuid ORDER BY position`, [r.requestId]);
  assert.deepEqual(items.map((i) => i.follow_up), [false, false, true], "la domanda nuova sta sotto «Nuove domande»");
  assert.equal(await needStatus(card.needs[2]), "chiesta");
  const [msg] = await q(`SELECT message FROM use_case_referent_requests WHERE id = $1::uuid`, [r.requestId]);
  assert.equal(msg.message, "Un'ultima cosa.");
  const [item] = await q(`SELECT new_questions, clarifications FROM use_case_referent_email_items WHERE request_id = $1::uuid AND kind = 'nuove'`, [r.requestId]);
  assert.deepEqual([item.new_questions, item.clarifications], [1, 0]);
  assert.equal(await listState(card.id), "da_verificare", "le risposte di prima aspettano ancora il team");
  // La pagina del referente (rilascio 5.1) mostra la domanda nuova da rispondere con lo stesso link.
  const link = await linkOf(r.token);
  assert.equal(link.status, "inviata");
  pok(await pub.saveReferentDraft(link, { needId: card.needs[2], text: "Allego un esempio", dontKnow: false }, new Date()) as never, "bozza");
  pok(await pub.submitReferentAnswers(link, {}, new Date()) as never, "invia");
  assert.equal((await requestOf(r.requestId)).status, "completata");
  // «Aggiungi domande» su una richiesta completata con il link valido: torna «inviata».
  const fourth = randomUUID();
  await q(`INSERT INTO use_case_needs (id, workspace_id, type, title, status, owner_side, sort_order) VALUES ($1::uuid, $2::uuid, 'requisito', 'Tempi di consegna', 'da_chiedere', 'cliente', 9)`, [fourth, ids.ws]);
  await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [fourth, card.id]);
  const version = Number((await q(`SELECT version FROM use_case_referent_requests WHERE id = $1::uuid`, [r.requestId]))[0].version);
  ok(await referents.addToReferentRequest(ctx(), card.id, r.requestId, version, { needIds: [fourth] }, { env: ENV, now: NOW }), "aggiungi domande");
  assert.equal((await requestOf(r.requestId)).status, "inviata");
  assert.equal(await listState(card.id), "da_verificare");
});

test("la modifica di una risposta: possibile finché il team non la segna «A posto» (decisione 3); dopo solo «Aggiungi qualcosa»", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const link = await linkOf(r.token);
  const edited = pok((await thread.editReferentAnswer(link, { needId: card.needs[0], text: "Circa 250 al mese" }, new Date())) as never, "modifica") as { editedAt: string };
  assert.ok(edited.editedAt);
  const [answer] = await q(`SELECT body, edited_at IS NOT NULL AS edited FROM use_case_need_answers WHERE request_id = $1::uuid AND need_id = $2::uuid`, [r.requestId, card.needs[0]]);
  assert.deepEqual({ ...answer }, { body: "Circa 250 al mese", edited: true });
  assert.equal(await needStatus(card.needs[0]), "in_verifica");
  const panel = await panelOf(card.id);
  assert.match(panel.needs[card.needs[0]].answers.find((a) => a.source === "referente")?.editedLabel ?? "", /^Aggiornata il /);
  // «A posto»: la risposta non si modifica più.
  await q(`UPDATE use_case_needs SET status = 'validata', done_at = now() WHERE id = $1::uuid`, [card.needs[0]]);
  const locked = await thread.editReferentAnswer(link, { needId: card.needs[0], text: "Circa 300" }, new Date());
  assert.equal(locked.ok, false);
  assert.equal((locked as { code: string }).code, "risposta_chiusa");
  const [still] = await q(`SELECT body FROM use_case_need_answers WHERE request_id = $1::uuid AND need_id = $2::uuid`, [r.requestId, card.needs[0]]);
  assert.equal(still.body, "Circa 250 al mese", "niente cambiato");
  // «Aggiungi qualcosa» resta, e riporta l'informazione «Da verificare».
  pok((await thread.addToReferentAnswer(link, { anchor: "domanda", needId: card.needs[0], text: "Anche il sabato." }, new Date())) as never, "aggiunta");
  assert.equal(await needStatus(card.needs[0]), "in_verifica");
  assert.ok((await story(card.id)).includes("aggiunta"));
  // Testi rifiutati come all'invio: dati sanitari.
  const health = await thread.addToReferentAnswer(link, { anchor: "generale", text: "Ha una diagnosi di diabete" }, new Date());
  assert.equal(health.ok, false);
});

test("le proposte dell'AI: solo ai revisori, «Chiedi questo» le usa con il chiarimento, «Lascia stare» le scarta; mai inviate da sole", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const [s1] = await q(
    `INSERT INTO use_case_referent_suggestions (request_id, workspace_id, use_case_id, anchor, need_id, source_at, status, body, model) VALUES ($1::uuid, $2::uuid, $3::uuid, 'domanda', $4::uuid, now(), 'proposta', 'Quante al mese, più o meno?', 'modello-di-prova') RETURNING id`,
    [r.requestId, ids.ws, card.id, card.needs[0]],
  );
  const [s2] = await q(
    `INSERT INTO use_case_referent_suggestions (request_id, workspace_id, use_case_id, anchor, need_id, source_at, status, body, model) VALUES ($1::uuid, $2::uuid, $3::uuid, 'domanda', $4::uuid, now(), 'proposta', 'Quale gestionale?', 'modello-di-prova') RETURNING id`,
    [r.requestId, ids.ws, card.id, card.needs[1]],
  );
  const panel = await panelOf(card.id);
  assert.deepEqual(panel.thread?.suggestions.map((s) => s.text).sort(), ["Quale gestionale?", "Quante al mese, più o meno?"]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM use_case_referent_messages WHERE request_id = $1::uuid`, [r.requestId]))[0].n, 0, "niente parte da solo");
  ok(await thread.askReferentClarification(ctx(), card.id, { requestId: r.requestId, anchor: "domanda", needId: card.needs[0], text: "Quante al mese, più o meno?", suggestionId: String(s1.id) }, { env: ENV, now: NOW }), "chiedi questo");
  refused(await thread.dismissReferentSuggestion(ctx("contributor"), card.id, String(s2.id), { env: ENV }), "permesso_mancante");
  ok(await thread.dismissReferentSuggestion(ctx(), card.id, String(s2.id), { env: ENV }), "lascia stare");
  refused(await thread.dismissReferentSuggestion(ctx(), card.id, String(s2.id), { env: ENV }), "suggerimento_non_trovato");
  const rows = await q(`SELECT body, status, decided_by_user_id::text AS by FROM use_case_referent_suggestions WHERE request_id = $1::uuid AND body IS NOT NULL ORDER BY body`, [r.requestId]);
  assert.deepEqual(rows.map((x) => `${x.body}:${x.status}:${x.by === ids.builder}`), ["Quale gestionale?:scartata:true", "Quante al mese, più o meno?:usata:true"]);
  assert.deepEqual((await panelOf(card.id)).thread?.suggestions, []);
});

test("cancellazione dei dati e conservazione: i testi del filo si tolgono, le proposte dell'AI si cancellano", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const asked = ok(await thread.askReferentClarification(ctx(), card.id, { requestId: r.requestId, anchor: "generale", text: "Chi controlla le fatture?" }, { env: ENV, now: NOW }), "chiarimento");
  pok((await thread.replyToReferentClarification(await linkOf(r.token), { messageId: asked.messageId, text: "La contabilità." }, new Date())) as never, "risposta");
  await q(
    `INSERT INTO use_case_referent_suggestions (request_id, workspace_id, use_case_id, anchor, source_at, status, body) VALUES ($1::uuid, $2::uuid, $3::uuid, 'generale', now(), 'proposta', 'Quante persone?')`,
    [r.requestId, ids.ws, card.id],
  );
  // La conservazione di 12 mesi, su una copia della richiesta: gli stessi statement del cron.
  const purge = eraseMod.referentPurgeStatements({ workspaceId: ids.ws, requestId: r.requestId });
  for (const st of purge) await q(st.text, st.params as unknown[]);
  assert.deepEqual((await messagesOf(r.requestId)).map((m) => `${m.body}:${m.removed_reason}`), ["null:conservazione", "null:conservazione"]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM use_case_referent_suggestions WHERE request_id = $1::uuid`, [r.requestId]))[0].n, 0);
  // «Cancella i dati di questa persona» su un'altra richiesta.
  const card2 = await newCard();
  const r2 = await answeredReferent(card2);
  pok((await thread.postReferentDoubt(await linkOf(r2.token), { anchor: "generale", text: "Posso allegare un esempio?" }, new Date())) as never, "dubbio");
  ok(await referents.eraseReferentData(ctx(), card2.id, r2.contactId, { env: ENV }), "cancellazione");
  assert.deepEqual((await messagesOf(r2.requestId)).map((m) => `${m.body}:${m.removed_reason}`), ["null:cancellazione"]);
  const after = await panelOf(card2.id);
  assert.equal(after.thread?.messages.length, 0, "le richieste revocate non mostrano il filo");
});

test("(decisione 2) l'aiuto dell'AI: le righe nascono con la risposta; senza chiave «nessuna»; con un modello finto una domanda; un errore si riprova; spento o con un'informativa vecchia niente", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const rowsOf = async () =>
    (await q(`SELECT anchor, need_id::text AS need, component_key AS key, status, body, model, attempts FROM use_case_referent_suggestions WHERE request_id = $1::uuid ORDER BY anchor, need_id, component_key`, [r.requestId])).map((x) => ({ ...x }));
  // L'invio ha messo in coda le due risposte con un testo e la voce «È di meno»: niente calcolato ancora.
  const queued = await rowsOf();
  assert.deepEqual(queued.map((x) => `${x.anchor}:${x.status}`).sort(), ["beneficio:da_fare", "domanda:da_fare", "domanda:da_fare"]);
  // Senza la chiave del fornitore: «nessuna», in silenzio, nessuna chiamata.
  const calls: string[] = [];
  const none = await ai.processReferentSuggestions({ requestId: r.requestId, env: {} });
  assert.deepEqual(none, { proposed: 0, none: 3, failed: 0 });
  assert.ok((await rowsOf()).every((x) => x.status === "nessuna" && x.body === null));
  // Una risposta nuova (il referente aggiunge qualcosa): una riga nuova; il modello finto propone una domanda.
  const link = await linkOf(r.token);
  pok((await thread.addToReferentAnswer(link, { anchor: "domanda", needId: card.needs[0], text: "Dipende dal mese." }, new Date())) as never, "aggiunta");
  const fake: import("../../db/queries/use-case-referent-ai.ts").FollowUpGenerator = async ({ prompt, model }) => {
    calls.push(model);
    assert.ok(prompt.includes("<risposta>Dipende dal mese.</risposta>"), "il testo del referente dentro il tag");
    assert.ok(!prompt.includes("Giulia") && !prompt.includes("aldo."), "niente nomi né email nel prompt");
    return { complete: false, question: "Quante al mese, più o meno, nei mesi pieni?" };
  };
  const proposed = await ai.processReferentSuggestions({ requestId: r.requestId, env: { ANTHROPIC_API_KEY: "finta" }, generate: fake });
  assert.deepEqual(proposed, { proposed: 1, none: 0, failed: 0 });
  assert.equal(calls.length, 1);
  const panel = await panelOf(card.id);
  assert.deepEqual(panel.thread?.suggestions.map((x) => x.text), ["Quante al mese, più o meno, nei mesi pieni?"]);
  assert.equal(panel.thread?.suggestions[0].anchorKey, `d:${card.needs[0]}`);
  const [row] = (await rowsOf()).filter((x) => x.status === "proposta");
  assert.equal(row.model, "claude-sonnet-5-5", "il modello dell'app");
  // Un errore del modello: «errore», poi il giro dopo (il cron) riprova; una risposta inutilizzabile è «nessuna».
  pok((await thread.addToReferentAnswer(link, { anchor: "domanda", needId: card.needs[1], text: "Anche Excel." }, new Date())) as never, "aggiunta 2");
  const failed = await ai.processReferentSuggestions({ requestId: r.requestId, env: { ANTHROPIC_API_KEY: "finta" }, generate: async () => { throw new Error("rete"); } });
  assert.deepEqual(failed, { proposed: 0, none: 0, failed: 1 });
  const errored = (await rowsOf()).find((x) => x.status === "errore");
  assert.equal(Number(errored?.attempts), 1);
  const retried = await ai.processReferentSuggestions({ requestId: r.requestId, env: { ANTHROPIC_API_KEY: "finta" }, generate: async () => ({ complete: false, question: "Una frase senza punto di domanda" }) });
  assert.deepEqual(retried, { proposed: 0, none: 1, failed: 0 });
  // Un chiarimento già in attesa sull'ancora: niente proposta.
  ok(await thread.askReferentClarification(ctx(), card.id, { requestId: r.requestId, anchor: "generale", text: "Chi controlla?" }, { env: ENV, now: NOW }), "chiarimento");
  const before = (await rowsOf()).length;
  // Spento: nessuna riga nuova, nessuna chiamata.
  process.env.USE_CASE_REFERENT_AI = "off";
  try {
    pok((await thread.addToReferentAnswer(link, { anchor: "domanda", needId: card.needs[0], text: "Ancora una cosa." }, new Date())) as never, "aggiunta spenta");
    assert.equal((await rowsOf()).length, before, "spento: nessuna riga");
    assert.deepEqual(await ai.processReferentSuggestions({ requestId: r.requestId, env: { USE_CASE_REFERENT_AI: "off", ANTHROPIC_API_KEY: "finta" }, generate: fake }), { proposed: 0, none: 0, failed: 0 });
  } finally {
    delete process.env.USE_CASE_REFERENT_AI;
  }
  // Un'informativa che non dice dell'AI: nessuna riga.
  await q(`UPDATE use_case_referent_requests SET privacy_notice_version = 'ucq-2026-11-1' WHERE id = $1::uuid`, [r.requestId]);
  const st = ai.suggestionQueueSql({ workspaceId: ids.ws, requestId: r.requestId, anchors: [{ anchor: "generale", needId: null, componentKey: null }], env: {} })!;
  await q(st.text, st.params as unknown[]);
  assert.equal((await rowsOf()).length, before, "informativa vecchia: niente");
  assert.equal(ai.suggestionQueueSql({ workspaceId: ids.ws, requestId: r.requestId, anchors: [{ anchor: "generale", needId: null, componentKey: null }], env: { USE_CASE_REFERENT_AI: "off" } }), null);
  // Il contributore non vede il pannello (e quindi nessuna proposta).
  const contributorPanel = await referents.loadUseCaseReferentPanel({
    workspaceId: ids.ws,
    useCaseId: card.id,
    viewer: { userId: ids.contributor, role: "contributor", isLateralSpace: false, emailVerified: true, email: `contrib.${suffix}@cliente.test` } as never,
    session: { id: ids.contributor, name: "Persona contributor", email: `contrib.${suffix}@cliente.test`, emailVerified: true },
    role: "contributor",
    needs: { requirements: [], steps: [] } as never,
    eligible: true,
    env: ENV,
  });
  assert.equal(contributorPanel, null);
});
