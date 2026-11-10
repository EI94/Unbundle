import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// (Rilascio 6) «Il filo con il referente»: i casi trovati dalla verifica del rilascio, sul database di prova.
// - Un dubbio del referente rinnova il link; dopo la scadenza un dubbio o un chiarimento senza risposta possibile
//   non tiene lo use case fermo su «Il referente ha chiesto qualcosa» (o una voce nascosta), nemmeno chiedendo di nuovo.
// - «Chiedi un chiarimento» su una richiesta completata quando la stessa persona ne ha un'altra «inviata»: il
//   chiarimento resta sulla completata, parte la sua email, il referente risponde; «Aggiungi domande» lì no.
// - Due «Chiedi un chiarimento» insieme sulla stessa risposta: uno solo passa.
// - «Modifica» ripetuta: una riga per l'AI in attesa, un tetto al giorno, una novità al giorno per la campanella,
//   l'avviso a chi ha chiesto e la Storia; il passo dell'AI del cron con un tempo massimo.
// - L'interruttore dell'AI spento: niente proposte a schermo, nemmeno quelle già calcolate.
// - Dopo «A posto» e un'aggiunta, «Modifica» resta chiusa (decisione 3).
// - L'email di un chiarimento chiesto da un altro revisore dice «Il team», mai il nome di chi ha chiesto.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
// Nessuna email vera (mailer finto), nessun modello vero (generatore finto). Dati sintetici, creati e cancellati qui.
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
let pub: typeof import("../../db/queries/use-case-referent-public.ts");
let dispatch: typeof import("../../db/queries/use-case-referent-dispatch.ts");
let states: typeof import("../../db/queries/use-case-referent-states.ts");
let needsMod: typeof import("../needs.ts");
let calendar: typeof import("../../uc/calendar.ts");
let ai: typeof import("../../db/queries/use-case-referent-ai.ts");
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), contributor: randomUUID(), builder2: randomUUID() };
const storageDir = mkdtempSync(join(tmpdir(), "referenti-filo-v-"));
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

const ctx = (who: "builder" | "contributor" | "builder2" = "builder") => ({
  workspaceId: ids.ws,
  actor: { userId: ids[who], role: who === "contributor" ? "contributor" : "function_lead", isLateralSpace: false, kind: "persona" as const },
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
function prefused(result: { ok: boolean; code?: string }, code: string, label = "rifiuto") {
  assert.equal(result.ok, false, label);
  assert.equal(result.code, code, label);
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
  pub = await import("../../db/queries/use-case-referent-public.ts");
  dispatch = await import("../../db/queries/use-case-referent-dispatch.ts");
  states = await import("../../db/queries/use-case-referent-states.ts");
  needsMod = await import("../needs.ts");
  calendar = await import("../../uc/calendar.ts");
  ai = await import("../../db/queries/use-case-referent-ai.ts");
  NOW = new Date(calendar.romeLocalToUtc(calendar.addWorkingDays(calendar.romeDate(new Date()), 1), 10).getTime() + 30 * 60_000);
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione filo verifica', $2)`, [ids.org, `hub-filo-v-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Rondine prova')`, [ids.ws, ids.org]);
  for (const [id, role, email] of [[ids.builder, "function_lead", `builder.${suffix}@cliente.test`], [ids.contributor, "contributor", `contrib.${suffix}@cliente.test`], [ids.builder2, "function_lead", `builder2.${suffix}@cliente.test`]] as const) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [id, email, id === ids.builder2 ? "Bruna Esempio" : role === "function_lead" ? "Giulia Neri" : "Persona contributor"]);
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
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.builder, ids.contributor, ids.builder2]]);
});

/** La richiesta scade adesso (come dopo i 30 giorni): il link e i token non valgono più. */
async function expireNow(requestId: string) {
  await q(`UPDATE use_case_referent_requests SET created_at = created_at - interval '31 days', sent_at = sent_at - interval '31 days', expires_at = now() - interval '1 minute' WHERE id = $1::uuid`, [requestId]);
  await q(`UPDATE use_case_referent_tokens SET expires_at = now() - interval '1 minute' WHERE request_id = $1::uuid AND expires_at > now()`, [requestId]);
}
async function panelWith(useCaseId: string, env: Record<string, string | undefined>): Promise<Panel> {
  const viewer = { userId: ids.builder, role: "function_lead", isLateralSpace: false, emailVerified: true, email: `builder.${suffix}@cliente.test` } as never;
  const all = await (await import("../../db/queries/use-case-needs.ts")).listWorkspaceNeeds(ids.ws, viewer);
  const panel = await referents.loadUseCaseReferentPanel({ workspaceId: ids.ws, useCaseId, viewer, session: { id: ids.builder, name: "Giulia Neri", email: `builder.${suffix}@cliente.test`, emailVerified: true }, role: "function_lead", needs: needsMod.needListsOfUseCase(all ?? [], useCaseId), eligible: true, env });
  assert.ok(panel?.available, "il pannello c'è");
  return panel!;
}
const statusesOf = async (useCaseId: string) => (await q(`SELECT status FROM use_case_referent_requests WHERE use_case_id = $1::uuid ORDER BY created_at, id`, [useCaseId])).map((x) => String(x.status));

test("un dubbio del referente rinnova il link; dopo la scadenza non tiene lo use case su «Il referente ha chiesto qualcosa», nemmeno chiedendo di nuovo", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const before = await requestOf(r.requestId);
  const d = pok((await thread.postReferentDoubt(await linkOf(r.token), { anchor: "generale", text: "Contate anche le pratiche estere?" }, new Date())) as never, "dubbio") as { messageId: string };
  const renewed = await requestOf(r.requestId);
  assert.equal(renewed.renewed, true, "il dubbio rinnova il link");
  assert.ok(new Date(String(renewed.expires_at)).getTime() > new Date(String(before.expires_at)).getTime(), "il link vale di più");
  const [token] = await q(`SELECT max(expires_at) AS at FROM use_case_referent_tokens WHERE request_id = $1::uuid AND revoked_at IS NULL`, [r.requestId]);
  assert.equal(new Date(String(token.at)).getTime(), new Date(String(renewed.expires_at)).getTime(), "anche il token");
  assert.equal(await listState(card.id), "ha_chiesto");
  const live = await panelOf(card.id);
  assert.equal(live.referent?.state, "ha_chiesto");
  assert.equal(live.thread?.messages.find((m) => m.id === d.messageId)?.canReply, true, "il team può rispondere");

  // Nessuno ha risposto e la richiesta è scaduta: il dubbio non aspetta più il team, lo stato va avanti.
  await expireNow(r.requestId);
  const stuck = ["ha_chiesto"];
  assert.ok(!stuck.includes(String(await listState(card.id))), "la lista non resta su «Il referente ha chiesto qualcosa»");
  const expired = await panelOf(card.id);
  assert.ok(!stuck.includes(String(expired.referent?.state)), "il blocco nemmeno");
  const line = expired.thread?.messages.find((m) => m.id === d.messageId);
  assert.ok(line, "il dubbio resta nel filo, da leggere");
  assert.equal(line!.canReply, false, "senza «Rispondi»: la richiesta non è più attiva");
  assert.equal(line!.waiting, false, "e non aspetta più nessuno");
  refused(await thread.answerReferentDoubt(ctx(), card.id, { messageId: d.messageId, text: "Sì, anche quelle." }, { env: ENV, now: NOW }), "filo_non_disponibile");

  // «Chiedi al referente» di nuovo alla stessa persona: una richiesta nuova, e lo stato non torna lì.
  const again = ok(
    await referents.sendReferentRequest(ctx(), card.id, { kind: "domande", contact: { kind: "esistente", contactId: r.contactId }, needIds: [card.needs[2]], message: "Un'ultima cosa." }, { env: ENV, requester: { name: "Giulia Neri", emailVerified: true }, now: NOW }),
    "di nuovo",
  );
  assert.notEqual(again.requestId, r.requestId);
  assert.ok(!stuck.includes(String(await listState(card.id))));
  assert.ok(!stuck.includes(String((await panelOf(card.id)).referent?.state)));
});

test("un chiarimento senza risposta su una voce, poi la scadenza: la voce torna da guardare («stima»), nella lista e nel blocco", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  ok(await thread.askReferentClarification(ctx(), card.id, { requestId: r.requestId, anchor: "beneficio", componentKey: "tempo-1", text: "Quanto di meno, più o meno?" }, { env: ENV, now: NOW }), "chiarimento sulla voce");
  const waiting = await panelOf(card.id);
  assert.equal(waiting.referent?.review ?? null, null, "mentre aspetta il referente, la voce non chiede niente al team");
  assert.equal(waiting.referent?.check?.benefits?.find((b) => b.key === "tempo-1")?.needsReview, false);
  await expireNow(r.requestId);
  const panel = await panelOf(card.id);
  assert.equal(panel.referent?.review, "stima", "dopo la scadenza «È di meno» torna da guardare");
  assert.equal(panel.referent?.check?.benefits?.find((b) => b.key === "tempo-1")?.needsReview, true, "la voce chiede di nuovo di guardarla");
  assert.notEqual(panel.referent?.state, "chiarimento");
  assert.equal(await listState(card.id), "da_verificare");
});

test("«Chiedi un chiarimento» su una richiesta completata mentre la stessa persona ne ha un'altra «inviata»: resta sulla completata, parte la sua email, il referente risponde; «Aggiungi domande» lì no", opts, async () => {
  const card = await newCard();
  // R1: domande alla persona, che risponde (completata, link valido).
  const r1 = ok(
    await referents.sendReferentRequest(ctx(), card.id, { kind: "domande", contact: { kind: "nuovo", displayName: "Carla Esempio", email: `carla.${seq++}.${suffix}@rondine.test` }, needIds: [card.needs[0]], message: "Una domanda." }, { env: ENV, requester: { name: "Giulia Neri", emailVerified: true } }),
    "R1",
  );
  const token = /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec((await send(r1.requestId))[0]?.text ?? "")?.[1];
  assert.ok(token, "il link di R1");
  const first = await pub.resolveReferentToken(token!, new Date());
  if (first.access !== "ok") assert.fail("link");
  pok(await pub.acceptReferentPrivacy(first.link, { version: "ucq-2026-11-2" }, new Date()) as never, "informativa");
  pok(await pub.saveReferentDraft(await linkOf(token!), { needId: card.needs[0], text: "Circa 200 al mese", dontKnow: false }, new Date()) as never, "bozza");
  pok(await pub.submitReferentAnswers(await linkOf(token!), {}, new Date()) as never, "invia");
  await send(r1.requestId);
  const [row] = await q(`SELECT contact_id FROM use_case_referent_requests WHERE id = $1::uuid`, [r1.requestId]);
  // R2: «Scegli il referente» alla stessa persona (le regole del rilascio 5: una richiesta nuova, «inviata»).
  const r2 = ok(
    await referents.sendReferentRequest(ctx(), card.id, { kind: "referente", expectedReferentRequestId: null, contact: { kind: "esistente", contactId: String(row.contact_id) }, needIds: [card.needs[1]] }, { env: ENV, requester: { name: "Giulia Neri", emailVerified: true }, now: NOW }),
    "R2",
  );
  assert.notEqual(r2.requestId, r1.requestId);
  assert.deepEqual(await statusesOf(card.id), ["completata", "inviata"]);

  const panel = await panelOf(card.id);
  const answer = panel.needs[card.needs[0]].answers.find((a) => a.source === "referente");
  assert.ok(answer?.clarify, "«Chiedi un chiarimento» sotto la risposta di R1");
  const add = panel.requests.find((x) => x.id === r1.requestId)?.actions.add;
  assert.deepEqual(add, { allowed: false, reason: null }, "«Aggiungi domande» non su R1: le domande nuove vanno a R2");
  refused(await referents.addToReferentRequest(ctx(), card.id, r1.requestId, panel.requests.find((x) => x.id === r1.requestId)!.version, { needIds: [card.needs[2]] }, { env: ENV, now: NOW }), "richiesta_aperta", "«Aggiungi domande» su R1");
  assert.deepEqual(await statusesOf(card.id), ["completata", "inviata"], "niente cambiato");

  const c = ok(await thread.askReferentClarification(ctx(), card.id, { requestId: r1.requestId, anchor: "domanda", needId: card.needs[0], text: "Quante al mese, più o meno?" }, { env: ENV, now: NOW }), "chiarimento su R1");
  assert.deepEqual(await statusesOf(card.id), ["completata", "inviata"], "R1 resta completata accanto a R2");
  assert.equal(await listState(card.id), "chiarimento");
  assert.equal(await needStatus(card.needs[0]), "chiesta", "«In attesa»");
  const view = await pub.loadReferentAskView(await linkOf(token!), { env: ENV, now: new Date() });
  assert.equal(view.thread.open, true);
  assert.equal(view.thread.messages.filter((m) => m.waiting).length, 1, "il chiarimento aspetta il referente sulla pagina di R1");
  const mails = await send(r1.requestId, new Date(NOW.getTime() + 60_000));
  assert.equal(mails.length, 1, "l'email del chiarimento parte");
  assert.match(mails[0].subject, /^Rondine prova: un chiarimento sul caso d'uso «FL-\d+ · Fatture fornitori»$/);
  assert.match(mails[0].text, /Il team ti chiede un chiarimento/);
  assert.ok(mails[0].text.includes(`/rispondi/`));
  pok((await thread.replyToReferentClarification(await linkOf(token!), { messageId: c.messageId, text: "Circa 220." }, new Date())) as never, "la risposta");
  assert.deepEqual(await statusesOf(card.id), ["completata", "inviata"]);
  assert.equal(await needStatus(card.needs[0]), "in_verifica");
  assert.equal(await listState(card.id), "da_verificare");
  // Dopo la risposta, nessuna email che chiede ancora il chiarimento.
  assert.equal((await send(r1.requestId, new Date(NOW.getTime() + 2 * 86_400_000))).filter((m) => /chiarimento/.test(m.subject)).length, 0);
});

test("due «Chiedi un chiarimento» insieme sulla stessa risposta: uno passa, l'altro «chiarimento_aperto»; un chiarimento aperto solo", opts, async () => {
  for (let i = 0; i < 4; i++) {
    const card = await newCard();
    const r = await answeredReferent(card);
    const input = { requestId: r.requestId, anchor: "domanda", needId: card.needs[0], text: "Quante, più o meno?" };
    const results = await Promise.all([
      thread.askReferentClarification(ctx(), card.id, input, { env: ENV, now: NOW }),
      thread.askReferentClarification(ctx("builder2"), card.id, { ...input, text: "Quante a fine mese?" }, { env: ENV, now: NOW }),
    ]);
    assert.deepEqual(results.map((x) => (x.ok ? "ok" : x.error)).sort(), ["chiarimento_aperto", "ok"], `giro ${i + 1}`);
    const [n] = await q(`SELECT count(*)::int AS n FROM use_case_referent_messages WHERE request_id = $1::uuid AND side = 'team' AND kind = 'chiarimento' AND handled_at IS NULL`, [r.requestId]);
    assert.equal(n.n, 1, `giro ${i + 1}: un chiarimento aperto`);
  }
});

test("«Modifica» ripetuta della stessa risposta: una riga dell'AI in attesa, al massimo cinque al giorno; una novità al giorno per la campanella, l'avviso e la Storia", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const counts = async () => ({
    aiPending: Number((await q(`SELECT count(*)::int AS n FROM use_case_referent_suggestions WHERE request_id = $1::uuid AND anchor = 'domanda' AND need_id = $2::uuid AND status = 'da_fare'`, [r.requestId, card.needs[0]]))[0].n),
    aiRows: Number((await q(`SELECT count(*)::int AS n FROM use_case_referent_suggestions WHERE request_id = $1::uuid AND anchor = 'domanda' AND need_id = $2::uuid`, [r.requestId, card.needs[0]]))[0].n),
    bell: Number((await q(`SELECT coalesce(sum(answers), 0)::int AS n FROM use_case_notifications WHERE use_case_id = $1::uuid AND recipient_user_id = $2::uuid AND kind = 'risposte'`, [card.id, ids.builder]))[0].n),
    alert: Number((await q(`SELECT coalesce(sum(answers), 0)::int AS n FROM use_case_requester_email_items WHERE request_id = $1::uuid`, [r.requestId]))[0].n),
    story: (await story(card.id)).filter((x) => x === "risposta_cambiata").length,
  });
  const base = await counts();
  assert.equal(base.aiPending, 1, "la risposta inviata ha la sua riga");
  for (let i = 0; i < 5; i++) pok((await thread.editReferentAnswer(await linkOf(r.token), { needId: card.needs[0], text: `Circa ${201 + i} al mese` }, new Date())) as never, `modifica ${i + 1}`);
  const after5 = await counts();
  assert.equal(after5.aiPending, 1, "una riga in attesa per risposta: legge il testo di adesso quando parte");
  assert.equal(after5.bell, base.bell + 1, "la campanella conta la prima modifica del giorno");
  assert.equal(after5.alert, base.alert + 1, "l'avviso a chi ha chiesto anche");
  assert.equal(after5.story, 1, "una riga «risposta cambiata» al giorno per risposta");
  const prompts: string[] = [];
  await ai.processReferentSuggestions({ requestId: r.requestId, env: { ANTHROPIC_API_KEY: "finta" }, limit: 50, generate: async ({ prompt }) => { prompts.push(prompt); return { complete: true, question: null }; } });
  const onAnswer = prompts.filter((p) => p.includes("Volumi mensili"));
  assert.equal(onAnswer.length, 1, "una chiamata per la risposta, non una per modifica");
  assert.ok(onAnswer[0].includes("Circa 205 al mese"), "con il testo di adesso");
  // Modifiche una dopo l'altra, ognuna calcolata: al massimo cinque righe per la stessa risposta in 24 ore.
  for (let i = 0; i < 8; i++) {
    pok((await thread.editReferentAnswer(await linkOf(r.token), { needId: card.needs[0], text: `Circa ${300 + i} al mese` }, new Date())) as never, `modifica ${i + 6}`);
    await ai.processReferentSuggestions({ requestId: r.requestId, env: { ANTHROPIC_API_KEY: "finta" }, limit: 50, generate: async () => ({ complete: true, question: null }) });
  }
  assert.equal((await counts()).aiRows, 5, "il tetto del giorno");
  assert.equal((await counts()).bell, base.bell + 1, "sempre una novità al giorno");
});

test("il passo dell'AI del cron ha un tempo massimo: finito il tempo, le righe prese tornano in coda senza contare il tentativo", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const pending = async () => (await q(`SELECT attempts, lease_until IS NULL AS free FROM use_case_referent_suggestions WHERE request_id = $1::uuid AND status = 'da_fare' ORDER BY created_at, id`, [r.requestId])).map((x) => `${x.attempts}:${x.free}`);
  const before = await pending();
  assert.ok(before.length >= 1);
  let calls = 0;
  let t = 0;
  const summary = await ai.processReferentSuggestions({ requestId: r.requestId, env: { ANTHROPIC_API_KEY: "finta" }, limit: 50, budgetMs: 10, clock: () => (t += 10), generate: async () => { calls++; return { complete: true, question: null }; } });
  assert.equal(calls, 0, "nessuna chiamata dopo il tempo");
  assert.deepEqual(summary, { proposed: 0, none: 0, failed: 0 });
  assert.deepEqual(await pending(), before, "di nuovo in coda come prima");
  await ai.processReferentSuggestions({ requestId: r.requestId, env: { ANTHROPIC_API_KEY: "finta" }, limit: 50, generate: async () => { calls++; return { complete: true, question: null }; } });
  assert.ok(calls >= 1, "il giro dopo le calcola");
  assert.deepEqual(await pending(), [], "niente più in coda");
});

test("l'interruttore dell'AI spento: nessuna proposta a schermo, nemmeno già calcolata; «Chiedi questo» con il suo id non la usa", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  const [s] = await q(
    `INSERT INTO use_case_referent_suggestions (request_id, workspace_id, use_case_id, anchor, need_id, source_at, status, body, model) VALUES ($1::uuid, $2::uuid, $3::uuid, 'domanda', $4::uuid, now() + interval '1 second', 'proposta', 'Quante al mese, più o meno?', 'modello-di-prova') RETURNING id`,
    [r.requestId, ids.ws, card.id, card.needs[0]],
  );
  assert.deepEqual((await panelWith(card.id, ENV)).thread?.suggestions.map((x) => x.text), ["Quante al mese, più o meno?"], "accesa: la proposta c'è");
  const OFF = { ...ENV, USE_CASE_REFERENT_AI: "off" };
  process.env.USE_CASE_REFERENT_AI = "off";
  try {
    assert.deepEqual((await panelWith(card.id, OFF)).thread?.suggestions, [], "spenta: niente a schermo");
    ok(await thread.askReferentClarification(ctx(), card.id, { requestId: r.requestId, anchor: "domanda", needId: card.needs[0], text: "Quante al mese, più o meno?", suggestionId: String(s.id) }, { env: OFF, now: NOW }), "il chiarimento parte come riga della persona");
    const [row] = await q(`SELECT status FROM use_case_referent_suggestions WHERE id = $1::uuid`, [s.id]);
    assert.equal(row.status, "proposta", "la proposta non risulta usata");
  } finally {
    delete process.env.USE_CASE_REFERENT_AI;
  }
});

test("(decisione 3) dopo «A posto» un'aggiunta riporta l'informazione «Da verificare», ma «Modifica» resta chiusa", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  await q(`UPDATE use_case_needs SET status = 'validata', done_at = now() WHERE id = $1::uuid`, [card.needs[0]]);
  prefused(await thread.editReferentAnswer(await linkOf(r.token), { needId: card.needs[0], text: "Circa 300" }, new Date()), "risposta_chiusa");
  pok((await thread.addToReferentAnswer(await linkOf(r.token), { anchor: "domanda", needId: card.needs[0], text: "A dicembre sono la metà." }, new Date())) as never, "aggiunta");
  assert.equal(await needStatus(card.needs[0]), "in_verifica");
  const view = await pub.loadReferentAskView(await linkOf(r.token), { env: ENV, now: new Date() });
  const question = view.questions.find((x) => x.needId.toLowerCase() === card.needs[0].toLowerCase());
  assert.equal(question?.editable, false, "sulla pagina solo «Aggiungi qualcosa»");
  prefused(await thread.editReferentAnswer(await linkOf(r.token), { needId: card.needs[0], text: "Tutt'altra risposta" }, new Date()), "risposta_chiusa");
  const [answer] = await q(`SELECT body FROM use_case_need_answers WHERE request_id = $1::uuid AND need_id = $2::uuid`, [r.requestId, card.needs[0]]);
  assert.equal(answer.body, "Circa 200 al mese", "la risposta «A posto» non cambia");
  // Un'altra informazione, mai segnata «A posto», si modifica ancora.
  pok((await thread.editReferentAnswer(await linkOf(r.token), { needId: card.needs[1], text: "Il gestionale e un foglio" }, new Date())) as never, "modifica dell'altra");
});

test("l'email di un chiarimento chiesto da un altro revisore dice «Il team», mai il nome di chi ha chiesto né di chi scrive", opts, async () => {
  const card = await newCard();
  const r = await answeredReferent(card);
  ok(await thread.askReferentClarification(ctx("builder2"), card.id, { requestId: r.requestId, anchor: "domanda", needId: card.needs[0], text: "Quante, più o meno?" }, { env: ENV, now: NOW }), "chiarimento di Bruna");
  const mails = await send(r.requestId, new Date(NOW.getTime() + 60_000));
  assert.equal(mails.length, 1);
  assert.match(mails[0].text, /Il team ti chiede un chiarimento sul caso d'uso «FL-\d+ · Fatture fornitori»: lo trovi con lo stesso link\./);
  assert.ok(!/Giulia Neri ti chiede|Bruna Esempio ti chiede|Bruna Esempio/.test(mails[0].text), "nessun nome come autore del chiarimento");
  assert.ok(!mails[0].text.includes("Quante, più o meno?"), "mai il testo del messaggio nell'email");
});
