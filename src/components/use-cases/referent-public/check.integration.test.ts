import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// (Rilascio 5, SPEC §6, §7.3, §7.4, §13, A4) La conferma dello use case e la stima del tempo sulla pagina
// del referente, sul database di prova: la vista (descrizione filtrata, stima del team in ore, mai euro,
// quota, ore liberate, punteggi), la bozza del passo 1 (mai respinta da un cambio della stima), la
// freschezza del passo 2 (`stima_cambiata`, l'istantanea che toglie la risposta di prima, la stima tolta),
// l'invio che vuole la conferma e la stima, la campanella e l'avviso con la conferma come una risposta,
// la rotta `POST …/check`.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Nessuna email vera (mailer finto). Dati sintetici, creati e cancellati qui.
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

type Referents = typeof import("../../../lib/db/queries/use-case-referents.ts");
type Public = typeof import("../../../lib/db/queries/use-case-referent-public.ts");
type Dispatch = typeof import("../../../lib/db/queries/use-case-referent-dispatch.ts");
type Mail = import("../../../lib/uc/notify/dispatch.ts").OutgoingEmail;
type Link = import("../../../lib/db/queries/use-case-referent-public.ts").ReferentLink;
type RouteModule = { POST?: (r: Request, c: { params: Promise<{ token: string }> }) => Promise<Response> };

let referents: Referents;
let pub: Public;
let dispatch: Dispatch;
let checkRoute: RouteModule;
let keys: readonly string[];
let keyPaths: (value: unknown) => string[];
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), analyst: randomUUID() };
const BASE = "http://localhost:3000";
const storageDir = mkdtempSync(join(tmpdir(), "referenti-check-"));
const ENV = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: BASE,
  UC_LOCAL_STORAGE_DIR: storageDir,
} as Record<string, string | undefined>;
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS", "NEXT_PUBLIC_APP_URL", "UC_LOCAL_STORAGE_DIR"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const as = () => ({ workspaceId: ids.ws, actor: { userId: ids.builder, role: "function_lead", isLateralSpace: false, kind: "persona" as const }, channel: "pagina" as const });
function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}
function failed(result: { ok: boolean; code?: string }, code: string, label = "rifiuto") {
  assert.equal(result.ok, false, label);
  assert.equal(result.code, code, label);
}

/** Un modello del valore di prova: 3.000 volte l'anno, 12 minuti, il 50% che si risparmia, una cifra in euro. */
const MODEL = {
  primaryLever: "tempo",
  components: [
    { kind: "ore", key: "tempo-1", lever: "tempo", label: "Controllo delle fatture", confidence: "ipotesi", volumeYear: 3000, unit: "pratiche", minutesPerUnit: 12, automatablePct: 50, basis: "FONTE-RISERVATA" },
    { kind: "euro", key: "costi-1", lever: "costi", label: "Meno solleciti", confidence: "ipotesi", eurYear: 4321 },
  ],
};

async function newCard(model: unknown): Promise<{ id: string; needs: string[] }> {
  const id = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, value_model)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Le fatture arrivano via PEC. Si risparmiano 4.000 € l''anno. Il controllo è a mano.', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed', $4::jsonb)`,
    [id, ids.ws, `RK-${String(1000 + Math.floor(Math.random() * 8000))}`, model === null ? null : JSON.stringify(model)],
  );
  ok(await referents.prepareReferentQuestions(as(), id), "prepara");
  const rows = await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid ORDER BY n.sort_order, n.id`, [id]);
  return { id, needs: rows.map((r) => String(r.id)) };
}

let contactSeq = 0;
/** Una richiesta al referente con il suo link (dal mailer finto) e l'informativa letta. */
async function referentLink(useCaseId: string, needIds: string[]): Promise<{ token: string; requestId: string; link: Link }> {
  const email = `referente.${contactSeq++}.${suffix}@topjet.test`;
  const sent = ok(
    await referents.sendReferentRequest(as(), useCaseId, { kind: "referente", expectedReferentRequestId: null, contact: { kind: "nuovo", displayName: "Aldo Prova", email }, needIds }, { env: ENV, requester: { name: "Giulia Neri", emailVerified: true } }),
    "invio",
  );
  const outbox: Mail[] = [];
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer: { async send(m: Mail) { outbox.push(m); return { ok: true as const }; } }, sendIntervalMs: 0 });
  const token = /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(outbox[0]?.text ?? "")?.[1];
  assert.ok(token, "il link è nell'email");
  const first = await pub.resolveReferentToken(token, new Date());
  assert.ok(first.access === "ok");
  if (first.access !== "ok") throw new Error("link");
  ok(await pub.acceptReferentPrivacy(first.link, { version: "ucq-2026-10-1" }, new Date()) as never, "informativa");
  const again = await pub.resolveReferentToken(token, new Date());
  if (again.access !== "ok") throw new Error("link");
  return { token, requestId: sent.requestId, link: again.link };
}
const okPub = <T>(r: { ok: true; value: T } | { ok: false; code: string; message: string }, label = "esito"): T => {
  if (!r.ok) assert.fail(`${label}: atteso ok, ricevuto ${r.code} (${r.message})`);
  return r.value;
};
async function viewOf(token: string) {
  const page = await pub.loadReferentAskPage(token, { env: ENV, now: new Date() });
  assert.equal(page.access, "ok");
  if (page.access !== "ok") throw new Error("vista");
  return page.view;
}
async function checkRow(requestId: string) {
  return (await q(`SELECT confirm, confirm_note, team_component_key, team_volume_year, team_minutes, estimate, times_per_month, minutes_each, submitted_at IS NOT NULL AS sent FROM use_case_referent_checks WHERE request_id = $1::uuid`, [requestId]))[0];
}
const teamSeen = { key: "tempo-1", volumeYear: 3000, minutes: 12 };

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  ENV.USE_CASE_HUB_WORKSPACES = ids.ws;
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.NEXT_PUBLIC_APP_URL = BASE;
  process.env.UC_LOCAL_STORAGE_DIR = storageDir;
  referents = await import("../../../lib/db/queries/use-case-referents.ts");
  pub = await import("../../../lib/db/queries/use-case-referent-public.ts");
  dispatch = await import("../../../lib/db/queries/use-case-referent-dispatch.ts");
  checkRoute = (await import("../../../app/api/rispondi/[token]/check/route.ts")) as RouteModule;
  const view = await import("../../../lib/use-cases/referent/view.ts");
  keys = view.PUBLIC_VIEW_KEYS;
  keyPaths = (value) => view.keyPaths(value);
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione conferma', $2)`, [ids.org, `hub-conferma-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'TopJet prova')`, [ids.ws, ids.org]);
  for (const [id, role] of [[ids.builder, "function_lead"], [ids.analyst, "analyst"]] as const) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [id, `${role}.conferma.${suffix}@cliente.test`, `Persona ${role}`]);
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
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.builder, ids.analyst]]);
});

test("la vista: la descrizione senza importi, la stima del team in ore, mai euro, quota, fonte o punteggi", opts, async () => {
  const card = await newCard(MODEL);
  const { token } = await referentLink(card.id, card.needs.slice(0, 2));
  const view = await viewOf(token);
  assert.equal(view.kind, "referente");
  assert.equal(view.state, "aperta");
  assert.ok(view.check);
  assert.equal(view.check?.description, "Le fatture arrivano via PEC. Il controllo è a mano.");
  assert.deepEqual(view.check?.team, { key: "tempo-1", volumeYear: 3000, minutes: 12, hours: 600, perMonth: 250, perYear: null, unit: "pratiche", label: null }, "una sola voce «ore»: niente nome della voce");
  assert.deepEqual(view.check?.draft, { confirm: null, note: null, estimate: null, timesPerMonth: null, minutesEach: null, stale: false, savedAt: null });
  const json = JSON.stringify(view);
  for (const secret of ["4321", "4.321", "€", "automatable", "FONTE-RISERVATA", "costi-1", "Meno solleciti", "4.000", "ipotesi", "confidence"]) assert.ok(!json.includes(secret), `mai «${secret}»`);
  assert.doesNotMatch(json, /\b350\b|\b50%/, "mai le ore liberate né la quota");
  assert.deepEqual(keyPaths(view).filter((k) => !keys.includes(k)), [], "solo le chiavi del contratto");
  // Una richiesta al referente senza domande è «aperta» finché la conferma non parte.
  const zero = await newCard(null);
  const z = await referentLink(zero.id, []);
  const zv = await viewOf(z.token);
  assert.equal(zv.state, "aperta");
  assert.equal(zv.questions.length, 0);
  assert.equal(zv.check?.team, null);
});

test("passo 1: la bozza della conferma, i controlli della nota, mai respinta da un cambio della stima", opts, async () => {
  const card = await newCard(MODEL);
  const { link, requestId } = await referentLink(card.id, []);
  const now = new Date();
  failed(await pub.saveReferentCheck({ ...link, privacyAccepted: false }, { step: 1, confirm: "si", note: null }, now), "informativa_da_leggere");
  failed(await pub.saveReferentCheck(link, { step: 3 }, now), "dati_non_validi");
  failed(await pub.saveReferentCheck(link, { step: 1, confirm: "forse", note: null }, now), "dati_non_validi");
  failed(await pub.saveReferentCheck(link, { step: 1, confirm: "correggi", note: "Il collega è in malattia per una visita medica" }, now), "testo_sanitario");
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "correggi", note: null }, now), "correggi senza nota");
  assert.deepEqual([(await checkRow(requestId)).confirm, (await checkRow(requestId)).confirm_note], ["correggi", null]);
  const named = okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "correggi", note: "Le controlla Mario Bianchi, anche via PEC" }, now), "con un nome");
  assert.ok(named.warnings.length > 0, "un nome è un avviso nella bozza");
  // «Sì, è così» toglie la nota.
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "si", note: "resta?" }, now), "sì");
  assert.deepEqual([(await checkRow(requestId)).confirm, (await checkRow(requestId)).confirm_note], ["si", null]);
  // Il team cambia la stima: il passo 1 si salva lo stesso.
  await q(`UPDATE use_cases SET value_model = jsonb_set(value_model, '{components,0,minutesPerUnit}', '10') WHERE id = $1::uuid`, [card.id]);
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "correggi", note: "Arrivano anche via PEC." }, now), "dopo il cambio della stima");
});

test("passo 2: la stima vista è quella di adesso, l'istantanea toglie la risposta di prima, la stima tolta", opts, async () => {
  const card = await newCard(MODEL);
  const { link, requestId, token } = await referentLink(card.id, []);
  const now = new Date();
  failed(await pub.saveReferentCheck(link, { step: 2, teamSeen: { ...teamSeen, minutes: 11 }, estimate: "si" }, now), "stima_cambiata");
  failed(await pub.saveReferentCheck(link, { step: 2, teamSeen: null, estimate: null, timesPerMonth: 20, minutesEach: 3 }, now), "stima_cambiata");
  assert.equal((await checkRow(requestId)).team_component_key, null, "niente scritto");
  failed(await pub.saveReferentCheck(link, { step: 2, teamSeen, estimate: "meno", timesPerMonth: "abc" }, now), "numero_non_valido");
  failed(await pub.saveReferentCheck(link, { step: 2, teamSeen, estimate: "meno", timesPerMonth: 8_333_334 }, now), "numero_non_valido");
  okPub(await pub.saveReferentCheck(link, { step: 2, teamSeen, estimate: "meno", timesPerMonth: "200", minutesEach: "1,5" }, now), "è di meno");
  assert.deepEqual(await checkRow(requestId), { confirm: null, confirm_note: null, team_component_key: "tempo-1", team_volume_year: "3000.00", team_minutes: "12.00", estimate: "meno", times_per_month: "200.00", minutes_each: "1.50", sent: false });
  // «Sì» non porta numeri.
  okPub(await pub.saveReferentCheck(link, { step: 2, teamSeen, estimate: "si", timesPerMonth: 5, minutesEach: 5 }, now), "sì");
  assert.deepEqual([(await checkRow(requestId)).estimate, (await checkRow(requestId)).times_per_month], ["si", null]);
  // Il team cambia la stima: la vista è «stale», la scelta vuota.
  await q(`UPDATE use_cases SET value_model = jsonb_set(value_model, '{components,0,volumeYear}', '4000') WHERE id = $1::uuid`, [card.id]);
  const stale = (await viewOf(token)).check!;
  assert.equal(stale.draft.stale, true);
  assert.equal(stale.draft.estimate, null);
  assert.equal(stale.team?.volumeYear, 4000);
  // Con la stima nuova si salva, e l'istantanea è quella nuova.
  okPub(await pub.saveReferentCheck(link, { step: 2, teamSeen: { ...teamSeen, volumeYear: 4000 }, estimate: "piu" }, now), "è di più");
  assert.deepEqual([(await checkRow(requestId)).team_volume_year, (await checkRow(requestId)).estimate, (await checkRow(requestId)).times_per_month], ["4000.00", "piu", null]);
  assert.equal((await viewOf(token)).check?.draft.stale, false);
  // Il team toglie la stima: il passo 2 chiede i due numeri, l'istantanea si svuota con la risposta.
  await q(`UPDATE use_cases SET value_model = NULL WHERE id = $1::uuid`, [card.id]);
  assert.equal((await viewOf(token)).check?.draft.stale, true);
  failed(await pub.saveReferentCheck(link, { step: 2, teamSeen: null, estimate: "si" }, now), "dati_non_validi");
  okPub(await pub.saveReferentCheck(link, { step: 2, teamSeen: null, estimate: null, timesPerMonth: 20, minutesEach: 30 }, now), "senza stima");
  assert.deepEqual(await checkRow(requestId), { confirm: null, confirm_note: null, team_component_key: null, team_volume_year: null, team_minutes: null, estimate: null, times_per_month: "20.00", minutes_each: "30.00", sent: false });
});

test("l'invio vuole la conferma e la stima; poi la richiesta senza domande si completa, con la campanella e l'avviso", opts, async () => {
  const card = await newCard(MODEL);
  const { link, requestId, token } = await referentLink(card.id, []);
  const now = new Date();
  failed(await pub.submitReferentAnswers(link, {}, now), "conferma_mancante");
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "correggi", note: null }, now));
  failed(await pub.submitReferentAnswers(link, {}, now), "conferma_mancante", "correggi senza nota");
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "si", note: null }, now));
  failed(await pub.submitReferentAnswers(link, {}, now), "stima_mancante");
  okPub(await pub.saveReferentCheck(link, { step: 2, teamSeen, estimate: "si" }, now));
  const done = okPub(await pub.submitReferentAnswers(link, {}, now), "invio");
  assert.deepEqual(done, { submitted: 1, open: 0, state: "completata" });
  assert.equal((await checkRow(requestId)).sent, true);
  assert.equal((await q(`SELECT status FROM use_case_referent_requests WHERE id = $1::uuid`, [requestId]))[0].status, "completata");
  const codes = (await q(`SELECT phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND 'richiesta_referente' = ANY(fields)`, [card.id])).map((r) => String(r.phase_after));
  for (const code of ["referente", "conferma", "risposte", "completata"]) assert.ok(codes.includes(code), `${code} in ${codes}`);
  assert.ok(!codes.includes("stima_diversa"));
  // La conferma conta come una risposta: la campanella di ogni revisore e l'avviso a chi ha chiesto.
  const notes = await q(`SELECT recipient_user_id::text AS who, kind, answers FROM use_case_notifications WHERE use_case_id = $1::uuid ORDER BY recipient_user_id`, [card.id]);
  assert.deepEqual(notes.map((n) => [n.who, n.kind, n.answers]), [ids.builder, ids.analyst].sort().map((who) => [who, "risposte", 1]));
  const alerts = await q(`SELECT i.answers FROM use_case_requester_email_items i WHERE i.request_id = $1::uuid`, [requestId]);
  assert.deepEqual(alerts.map((a) => a.answers), [1]);
  assert.equal((await q(`SELECT 1 FROM use_case_referent_emails WHERE request_id = $1::uuid AND template = 'conferma'`, [requestId])).length, 1);
  const view = await viewOf(token);
  assert.equal(view.state, "completata");
  assert.ok(view.check?.submittedAt);
  // Un secondo invio non scrive niente.
  const second = await pub.submitReferentAnswers((await pub.resolveReferentToken(token, now)).access === "ok" ? link : link, {}, now);
  assert.equal(second.ok, false);
});

test("«Correggi» e una stima diversa: la Storia lo dice; con domande si invia solo quando sono tutte chiuse", opts, async () => {
  const card = await newCard(null);
  const { link, requestId } = await referentLink(card.id, card.needs.slice(0, 2));
  const now = new Date();
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "correggi", note: "Le fatture arrivano anche via PEC." }, now));
  okPub(await pub.saveReferentCheck(link, { step: 2, teamSeen: null, estimate: null, timesPerMonth: "20", minutesEach: "30" }, now));
  okPub(await pub.saveReferentDraft(link, { needId: card.needs[0], text: "Circa 20 al giorno", dontKnow: false }, now));
  const open = await pub.submitReferentAnswers(link, {}, now);
  assert.ok(!open.ok && open.code === "domande_aperte");
  if (!open.ok) assert.deepEqual(open.issues?.map((i) => i.field), [card.needs[1]]);
  assert.equal((await checkRow(requestId)).sent, false, "niente di scritto");
  okPub(await pub.saveReferentDraft(link, { needId: card.needs[1], text: null, dontKnow: true, comment: "Lo sa l'ufficio acquisti" }, now));
  const done = okPub(await pub.submitReferentAnswers(link, {}, now), "invio");
  assert.deepEqual(done, { submitted: 3, open: 0, state: "completata" });
  assert.equal((await checkRow(requestId)).sent, true);
  const codes = (await q(`SELECT phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND 'richiesta_referente' = ANY(fields)`, [card.id])).map((r) => String(r.phase_after));
  for (const code of ["correzione", "stima_diversa", "risposte"]) assert.ok(codes.includes(code), `${code} in ${codes}`);
  const notes = await q(`SELECT answers, unknowns FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'risposte'`, [card.id]);
  assert.ok(notes.length > 0 && notes.every((n) => Number(n.answers) === 2 && Number(n.unknowns) === 1), JSON.stringify(notes));
  const [sent] = await q(`SELECT dont_know, comment FROM use_case_need_answers WHERE request_id = $1::uuid AND need_id = $2::uuid`, [requestId, card.needs[1]]);
  assert.deepEqual(sent, { dont_know: true, comment: "Lo sa l'ufficio acquisti" }, "«Chi potrebbe saperlo?» parte con «Non ce l'ho»");
});

test("la rotta POST …/check: la bozza dal link, con gli stessi controlli e i suoi codici HTTP", opts, async () => {
  const card = await newCard(MODEL);
  const { token, requestId } = await referentLink(card.id, []);
  const post = async (body: unknown) => {
    const headers = new Headers({ accept: "application/json", origin: BASE, "content-type": "application/json" });
    const res = await checkRoute.POST!(new Request(`${BASE}/api/rispondi/${token}/check`, { method: "POST", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ token }) });
    return { status: res.status, json: (await res.json()) as { ok: boolean; error?: string; data?: { savedAt?: string } } };
  };
  const yes = await post({ step: 1, confirm: "si", note: null });
  assert.equal(yes.status, 200);
  assert.ok(yes.json.ok && yes.json.data?.savedAt);
  const changed = await post({ step: 2, teamSeen: { ...teamSeen, volumeYear: 1 }, estimate: "si" });
  assert.equal(changed.status, 409);
  assert.equal(changed.json.error, "stima_cambiata");
  const bad = await post({ step: 2, teamSeen, estimate: "meno", minutesEach: "-3" });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error, "numero_non_valido");
  const wrong = await post({ step: 1, confirm: "si" });
  assert.equal(wrong.status, 200);
  assert.equal((await checkRow(requestId)).confirm, "si");
  // Un link sbagliato: la risposta uniforme.
  const res = await checkRoute.POST!(
    new Request(`${BASE}/api/rispondi/ucq_${"Z".repeat(32)}/check`, { method: "POST", headers: new Headers({ origin: BASE, "content-type": "application/json" }), body: "{}" }),
    { params: Promise.resolve({ token: `ucq_${"Z".repeat(32)}` }) },
  );
  assert.equal(res.status, 404);
});
