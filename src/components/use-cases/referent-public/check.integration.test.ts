import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// (Rilascio 5, SPEC §6, §7.3, §7.4, §13, A4; rilascio 5.1) La conferma dello use case e l'impatto sulla
// pagina del referente, sul database di prova: la vista (descrizione filtrata, una riga per ogni voce di
// «Benefici e costi» con la cifra del team di quella voce, mai quota, ore liberate, fiducia, fonte,
// punteggi), la bozza del passo 1 (mai respinta da un cambio della stima), il passo 2 per beneficio (la
// freschezza di ogni riga, le scelte e i numeri della sua forma, il commento, il modello tolto), l'invio
// che vuole la conferma e ogni riga, la campanella e l'avviso con la conferma come una risposta sola, la
// rotta `POST …/check`.
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

/** Un modello del valore di prova: 3.000 volte l'anno, 12 minuti, il 50% che si risparmia; una cifra in euro; una voce qualitativa. */
const MODEL = {
  primaryLever: "tempo",
  components: [
    { kind: "ore", key: "tempo-1", lever: "tempo", label: "Controllo delle fatture", confidence: "ipotesi", volumeYear: 3000, unit: "pratiche", minutesPerUnit: 12, automatablePct: 50, basis: "FONTE-RISERVATA" },
    { kind: "euro", key: "costi-1", lever: "costi", label: "Meno solleciti", confidence: "ipotesi", eurYear: 4321 },
    { kind: "qualitativo", key: "qualita-1", lever: "qualita", label: "Meno errori nelle registrazioni", confidence: "da_misurare", indicator: "INDICATORE-RISERVATO" },
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
  ok(await pub.acceptReferentPrivacy(first.link, { version: "ucq-2026-11-1" }, new Date()) as never, "informativa");
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
/** La cifra del team che ogni riga mostra (torna come `seen`). */
const SEEN = {
  "tempo-1": { kind: "ore", volumeYear: 3000, minutes: 12, eurYear: null },
  "costi-1": { kind: "euro", volumeYear: null, minutes: null, eurYear: 4321 },
  "qualita-1": { kind: "qualitativo", volumeYear: null, minutes: null, eurYear: null },
} as const;
type Key = keyof typeof SEEN;
const benefit = (key: Key, answer: string | null, extra: Record<string, unknown> = {}) => ({ step: 2, benefit: { key, seen: SEEN[key], answer, ...extra } });
/** Ogni riga con una risposta (di solito «Sì»). */
async function answerAll(link: Link, answers: Partial<Record<Key, string>> = {}) {
  for (const key of Object.keys(SEEN) as Key[]) okPub(await pub.saveReferentCheck(link, benefit(key, answers[key] ?? "si"), new Date()), `riga ${key}`);
}
async function benefitRows(requestId: string) {
  return q(
    `SELECT component_key AS key, position, kind, label, team_volume_year::text AS tv, team_minutes::text AS tm, team_eur_year::text AS te, answer,
            times_per_month::text AS t, minutes_each::text AS m, eur_year::text AS e, comment
     FROM use_case_referent_check_benefits WHERE request_id = $1::uuid ORDER BY position`,
    [requestId],
  );
}
async function flagOf(requestId: string) {
  return (await q(`SELECT benefits FROM use_case_referent_checks WHERE request_id = $1::uuid`, [requestId]))[0]?.benefits;
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


test("la vista: la descrizione senza importi e una riga per ogni voce, con la cifra del team di quella voce e niente altro", opts, async () => {
  const card = await newCard(MODEL);
  const { token } = await referentLink(card.id, card.needs.slice(0, 2));
  const view = await viewOf(token);
  assert.equal(view.kind, "referente");
  assert.equal(view.state, "aperta");
  assert.ok(view.check);
  assert.equal(view.check?.description, "Le fatture arrivano via PEC. Il controllo è a mano.");
  assert.deepEqual(view.check?.benefits, [
    { key: "tempo-1", form: "ore", label: "Controllo delle fatture", team: SEEN["tempo-1"], draft: null },
    { key: "costi-1", form: "euro", label: "Meno solleciti", team: SEEN["costi-1"], draft: null },
    { key: "qualita-1", form: "fatto", label: "Meno errori nelle registrazioni", team: SEEN["qualita-1"], draft: null },
  ]);
  assert.deepEqual(view.check?.draft, { confirm: null, note: null, estimate: null, timesPerMonth: null, minutesEach: null, stale: false, savedAt: null });
  const json = JSON.stringify(view);
  // Gli euro di una voce in euro sì (decisione del 04/11/2026); mai quota, ore liberate, fonte, fiducia, indicatore, importi della descrizione.
  for (const secret of ["automatable", "FONTE-RISERVATA", "INDICATORE-RISERVATO", "4.000", "ipotesi", "da_misurare", "confidence", "pratiche"]) assert.ok(!json.includes(secret), `mai «${secret}»`);
  assert.doesNotMatch(json, /\b350\b|\b50%/, "mai le ore liberate né la quota");
  assert.deepEqual(keyPaths(view).filter((k) => !keys.includes(k)), [], "solo le chiavi del contratto");
  // Senza modello del valore: niente righe, i due numeri del tempo.
  const zero = await newCard(null);
  const z = await referentLink(zero.id, []);
  const zv = await viewOf(z.token);
  assert.equal(zv.state, "aperta", "una richiesta al referente senza domande è «aperta» finché la conferma non parte");
  assert.equal(zv.questions.length, 0);
  assert.equal(zv.check?.benefits, null);
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
  assert.deepEqual(named.warnings, [], "(rilascio 5.1) un nome non è più un avviso");
  // «Sì, è così» toglie la nota.
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "si", note: "resta?" }, now), "sì");
  assert.deepEqual([(await checkRow(requestId)).confirm, (await checkRow(requestId)).confirm_note], ["si", null]);
  // Il team cambia la stima: il passo 1 si salva lo stesso.
  await q(`UPDATE use_cases SET value_model = jsonb_set(value_model, '{components,0,minutesPerUnit}', '10') WHERE id = $1::uuid`, [card.id]);
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "correggi", note: "Arrivano anche via PEC." }, now), "dopo il cambio della stima");
});


test("passo 2 per beneficio: la cifra vista è quella di adesso, le scelte e i numeri della sua forma, il commento, una riga alla volta", opts, async () => {
  const card = await newCard(MODEL);
  const { link, requestId, token } = await referentLink(card.id, []);
  const now = new Date();
  failed(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "tempo-1", seen: { ...SEEN["tempo-1"], minutes: 11 }, answer: "si" } }, now), "stima_cambiata");
  failed(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "tempo-1", seen: SEEN["costi-1"], answer: "si" } }, now), "stima_cambiata", "un altro tipo");
  failed(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "assente", seen: SEEN["tempo-1"], answer: "si" } }, now), "stima_cambiata", "una voce che non c'è");
  // Una pagina di prima (la stima del tempo, o i due numeri) con un modello: si rilegge.
  failed(await pub.saveReferentCheck(link, { step: 2, teamSeen: { key: "tempo-1", volumeYear: 3000, minutes: 12 }, estimate: "si" }, now), "stima_cambiata");
  failed(await pub.saveReferentCheck(link, { step: 2, teamSeen: null, estimate: null, timesPerMonth: 20, minutesEach: 3 }, now), "stima_cambiata");
  assert.deepEqual(await benefitRows(requestId), [], "niente scritto");
  assert.equal(await flagOf(requestId), false);
  failed(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "tempo-1", seen: null, answer: "si" } }, now), "dati_non_validi");
  failed(await pub.saveReferentCheck(link, benefit("tempo-1", "no"), now), "dati_non_validi", "«No» non è di una voce a ore");
  failed(await pub.saveReferentCheck(link, benefit("qualita-1", "meno"), now), "dati_non_validi");
  failed(await pub.saveReferentCheck(link, benefit("tempo-1", "meno", { timesPerMonth: "abc" }), now), "numero_non_valido");
  failed(await pub.saveReferentCheck(link, benefit("costi-1", "meno", { eurYear: 1_000_000_001 }), now), "numero_non_valido");
  failed(await pub.saveReferentCheck(link, benefit("qualita-1", "no", { comment: "Il collega è in malattia per una visita medica" }), now), "testo_sanitario");
  failed(await pub.saveReferentCheck(link, benefit("qualita-1", "no", { comment: "x".repeat(501) }), now), "commento_troppo_lungo");
  // «È di meno» con i numeri; «Sì» non porta numeri; gli euro; «No» con un commento.
  okPub(await pub.saveReferentCheck(link, benefit("tempo-1", "meno", { timesPerMonth: "200", minutesEach: "1,5" }), now), "è di meno");
  okPub(await pub.saveReferentCheck(link, benefit("costi-1", "piu", { eurYear: "5.200", timesPerMonth: 9 }), now), "è di più");
  okPub(await pub.saveReferentCheck(link, benefit("qualita-1", "no", { comment: "  Succede solo a fine mese.  " }), now), "no");
  assert.deepEqual(await benefitRows(requestId), [
    { key: "tempo-1", position: 1, kind: "ore", label: "Controllo delle fatture", tv: "3000.00", tm: "12.00", te: null, answer: "meno", t: "200.00", m: "1.50", e: null, comment: null },
    { key: "costi-1", position: 2, kind: "euro", label: "Meno solleciti", tv: null, tm: null, te: "4321.00", answer: "piu", t: null, m: null, e: "5200.00", comment: null },
    { key: "qualita-1", position: 3, kind: "qualitativo", label: "Meno errori nelle registrazioni", tv: null, tm: null, te: null, answer: "no", t: null, m: null, e: null, comment: "Succede solo a fine mese." },
  ]);
  assert.equal(await flagOf(requestId), true);
  assert.equal((await checkRow(requestId)).team_component_key, null, "la stima del tempo del rilascio 5 resta vuota");
  okPub(await pub.saveReferentCheck(link, benefit("tempo-1", "si", { timesPerMonth: 5, minutesEach: 5 }), now), "sì");
  assert.deepEqual([(await benefitRows(requestId))[0].answer, (await benefitRows(requestId))[0].t], ["si", null]);
  // La vista ha le bozze di ogni riga.
  const drafts = (await viewOf(token)).check!.benefits!.map((b) => b.draft);
  assert.deepEqual(drafts, [
    { answer: "si", timesPerMonth: null, minutesEach: null, eurYear: null, comment: null, stale: false },
    { answer: "piu", timesPerMonth: null, minutesEach: null, eurYear: 5200, comment: null, stale: false },
    { answer: "no", timesPerMonth: null, minutesEach: null, eurYear: null, comment: "Succede solo a fine mese.", stale: false },
  ]);
  // Il team cambia i minuti della voce a ore: quella riga è «stale» e vuota, le altre restano.
  await q(`UPDATE use_cases SET value_model = jsonb_set(value_model, '{components,0,minutesPerUnit}', '10') WHERE id = $1::uuid`, [card.id]);
  const stale = (await viewOf(token)).check!.benefits!;
  assert.deepEqual(stale[0].draft, { answer: null, timesPerMonth: null, minutesEach: null, eurYear: null, comment: null, stale: true });
  assert.deepEqual(stale[0].team, { ...SEEN["tempo-1"], minutes: 10 });
  assert.equal(stale[1].draft?.answer, "piu");
  failed(await pub.saveReferentCheck(link, benefit("tempo-1", "si"), now), "stima_cambiata", "la riga di prima");
  okPub(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "tempo-1", seen: { ...SEEN["tempo-1"], minutes: 10 }, answer: "piu" } }, now), "con la cifra nuova");
  assert.deepEqual([(await benefitRows(requestId))[0].tm, (await benefitRows(requestId))[0].answer], ["10.00", "piu"]);
  assert.equal((await viewOf(token)).check!.benefits![0].draft?.stale, false);
  // Il team toglie il modello: niente righe, i due numeri del tempo; le risposte per beneficio vanno via.
  await q(`UPDATE use_cases SET value_model = NULL WHERE id = $1::uuid`, [card.id]);
  assert.equal((await viewOf(token)).check?.benefits, null);
  failed(await pub.saveReferentCheck(link, benefit("costi-1", "si"), now), "stima_cambiata");
  failed(await pub.saveReferentCheck(link, { step: 2, teamSeen: null, estimate: "si" }, now), "dati_non_validi");
  okPub(await pub.saveReferentCheck(link, { step: 2, teamSeen: null, estimate: null, timesPerMonth: 20, minutesEach: 30 }, now), "senza modello");
  assert.deepEqual(await checkRow(requestId), { confirm: null, confirm_note: null, team_component_key: null, team_volume_year: null, team_minutes: null, estimate: null, times_per_month: "20.00", minutes_each: "30.00", sent: false });
  assert.deepEqual(await benefitRows(requestId), []);
  assert.equal(await flagOf(requestId), false);
});

test("una voce a ore senza i numeri del team: i due numeri, tutti e due per inviare; una voce in euro senza cifra: «Succede davvero?»", opts, async () => {
  const model = {
    v: 1,
    primary: "tempo",
    components: [
      { kind: "ore", key: "tempo-2", lever: "tempo", label: "Archiviazione", confidence: "ipotesi", volumeYear: 0, minutesPerUnit: 0, automatablePct: 40 },
      { kind: "euro", key: "costi-2", lever: "costi", label: "Meno carta", confidence: "ipotesi", eurYear: 0 },
    ],
  };
  const card = await newCard(model);
  const { link, requestId, token } = await referentLink(card.id, []);
  const now = new Date();
  const rows = (await viewOf(token)).check!.benefits!;
  assert.deepEqual(rows.map((r) => [r.key, r.form]), [["tempo-2", "ore_numeri"], ["costi-2", "fatto"]]);
  const seen = Object.fromEntries(rows.map((r) => [r.key, r.team]));
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "si", note: null }, now));
  failed(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "tempo-2", seen: seen["tempo-2"], answer: "si" } }, now), "dati_non_validi", "nessuna scelta, solo i numeri");
  failed(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "costi-2", seen: seen["costi-2"], answer: "meno", eurYear: 100 } }, now), "dati_non_validi");
  okPub(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "tempo-2", seen: seen["tempo-2"], answer: null, timesPerMonth: "20" } }, now));
  okPub(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "costi-2", seen: seen["costi-2"], answer: "non_so", eurYear: 100 } }, now));
  failed(await pub.submitReferentAnswers(link, {}, now), "stima_mancante", "manca un numero");
  okPub(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "tempo-2", seen: seen["tempo-2"], answer: null, timesPerMonth: "20", minutesEach: "4" } }, now));
  okPub(await pub.submitReferentAnswers(link, {}, now), "invio");
  assert.deepEqual((await benefitRows(requestId)).map((b) => [b.key, b.answer, b.t, b.m, b.e]), [["tempo-2", null, "20.00", "4.00", null], ["costi-2", "non_so", null, null, null]]);
  const codes = (await q(`SELECT phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND 'richiesta_referente' = ANY(fields)`, [card.id])).map((r) => String(r.phase_after));
  assert.equal(codes.filter((c) => c === "stima_diversa").length, 1, "i due numeri del referente sono una stima da vedere");
});

test("l'invio vuole la conferma e ogni riga; poi la richiesta senza domande si completa, con la campanella e l'avviso come una risposta sola", opts, async () => {
  const card = await newCard(MODEL);
  const { link, requestId, token } = await referentLink(card.id, []);
  const now = new Date();
  failed(await pub.submitReferentAnswers(link, {}, now), "conferma_mancante");
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "correggi", note: null }, now));
  failed(await pub.submitReferentAnswers(link, {}, now), "conferma_mancante", "correggi senza nota");
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "si", note: null }, now));
  failed(await pub.submitReferentAnswers(link, {}, now), "stima_mancante");
  okPub(await pub.saveReferentCheck(link, benefit("tempo-1", "si"), now));
  okPub(await pub.saveReferentCheck(link, benefit("costi-1", "si"), now));
  failed(await pub.submitReferentAnswers(link, {}, now), "stima_mancante", "manca la terza riga");
  okPub(await pub.saveReferentCheck(link, benefit("qualita-1", null, { comment: "Solo un commento" }), now));
  failed(await pub.submitReferentAnswers(link, {}, now), "stima_mancante", "un commento non è una risposta");
  okPub(await pub.saveReferentCheck(link, benefit("qualita-1", "si"), now));
  const done = okPub(await pub.submitReferentAnswers(link, {}, now), "invio");
  assert.deepEqual(done, { submitted: 1, open: 0, state: "completata" }, "tre voci, una risposta sola");
  assert.equal((await checkRow(requestId)).sent, true);
  assert.equal((await q(`SELECT status FROM use_case_referent_requests WHERE id = $1::uuid`, [requestId]))[0].status, "completata");
  const codes = (await q(`SELECT phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND 'richiesta_referente' = ANY(fields)`, [card.id])).map((r) => String(r.phase_after));
  for (const code of ["referente", "conferma", "risposte", "completata"]) assert.ok(codes.includes(code), `${code} in ${codes}`);
  assert.ok(!codes.includes("stima_diversa"), "tutto «Sì»");
  // La conferma conta come una risposta: la campanella di ogni revisore e l'avviso a chi ha chiesto.
  const notes = await q(`SELECT recipient_user_id::text AS who, kind, answers FROM use_case_notifications WHERE use_case_id = $1::uuid ORDER BY recipient_user_id`, [card.id]);
  assert.deepEqual(notes.map((n) => [n.who, n.kind, n.answers]), [ids.builder, ids.analyst].sort().map((who) => [who, "risposte", 1]));
  const alerts = await q(`SELECT i.answers FROM use_case_requester_email_items i WHERE i.request_id = $1::uuid`, [requestId]);
  assert.deepEqual(alerts.map((a) => a.answers), [1]);
  assert.equal((await q(`SELECT 1 FROM use_case_referent_emails WHERE request_id = $1::uuid AND template = 'conferma'`, [requestId])).length, 1);
  // Dopo l'invio la pagina mostra quello che è partito, in sola lettura.
  const view = await viewOf(token);
  assert.equal(view.state, "completata");
  assert.ok(view.check?.submittedAt);
  assert.deepEqual(view.check?.benefits?.map((b) => [b.key, b.draft?.answer]), [["tempo-1", "si"], ["costi-1", "si"], ["qualita-1", "si"]]);
  // Un secondo invio non scrive niente.
  const second = await pub.submitReferentAnswers(link, {}, now);
  assert.equal(second.ok, false);
});

test("una voce aggiunta dal team mentre la pagina era aperta riporta al passo 2; le risposte su voci tolte non partono; «No» è una stima da vedere, una riga sola", opts, async () => {
  const card = await newCard(MODEL);
  const { link, requestId } = await referentLink(card.id, []);
  const now = new Date();
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "si", note: null }, now));
  await answerAll(link, { "costi-1": "meno", "qualita-1": "no" });
  const added = { kind: "qualitativo", key: "rischio-1", lever: "rischio", label: "Meno sanzioni", confidence: "ipotesi" };
  await q(`UPDATE use_cases SET value_model = jsonb_set(value_model, '{components}', (value_model->'components') || $2::jsonb) WHERE id = $1::uuid`, [card.id, JSON.stringify([added])]);
  const refused = await pub.submitReferentAnswers(link, {}, now);
  failed(refused, "stima_mancante");
  if (!refused.ok) assert.deepEqual((await import("./steps-state.ts")).stepOfSubmitRefusal(refused), { step: 2, message: refused.message });
  okPub(await pub.saveReferentCheck(link, { step: 2, benefit: { key: "rischio-1", seen: { kind: "qualitativo", volumeYear: null, minutes: null, eurYear: null }, answer: "si" } }, now));
  // Il team toglie la voce in euro: quella risposta non parte.
  await q(`UPDATE use_cases SET value_model = jsonb_set(value_model, '{components}', (value_model->'components') - 1) WHERE id = $1::uuid`, [card.id]);
  okPub(await pub.submitReferentAnswers(link, {}, now), "invio");
  assert.deepEqual((await benefitRows(requestId)).map((b) => [b.key, b.answer]), [["tempo-1", "si"], ["qualita-1", "no"], ["rischio-1", "si"]]);
  const codes = (await q(`SELECT phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND 'richiesta_referente' = ANY(fields)`, [card.id])).map((r) => String(r.phase_after));
  assert.equal(codes.filter((c) => c === "stima_diversa").length, 1);
});

test("(rilascio 5.1) il commento di una riga con un nome o un'email passa; con un codice fiscale la bozza si salva, «Invia» lo respinge e la pagina torna al passo 2", opts, async () => {
  const steps = await import("./steps-state.ts");
  const named = await newCard(MODEL);
  const first = await referentLink(named.id, []);
  const now = new Date();
  okPub(await pub.saveReferentCheck(first.link, { step: 1, confirm: "si", note: null }, now));
  await answerAll(first.link);
  okPub(await pub.saveReferentCheck(first.link, benefit("costi-1", "si", { comment: "Lo sa mario.rossi@acme.test, oppure Mario Rossi al +39 333 1234567." }), now), "bozza con l'email");
  okPub(await pub.submitReferentAnswers(first.link, {}, now), "invio con nome, email e telefono");
  assert.equal((await checkRow(first.requestId)).sent, true);

  const card = await newCard(MODEL);
  const { link, requestId } = await referentLink(card.id, []);
  okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "si", note: null }, now));
  await answerAll(link);
  okPub(await pub.saveReferentCheck(link, benefit("costi-1", "si", { comment: "Il codice è RSSMRA80A01H501U." }), now), "bozza con il codice fiscale");
  const sent = await pub.submitReferentAnswers(link, {}, now);
  assert.equal(sent.ok, false);
  if (!sent.ok) {
    assert.equal(sent.code, "risposte_da_correggere");
    assert.deepEqual([...new Set((sent.issues ?? []).map((i) => i.field))], ["beneficio.costi-1"]);
    assert.equal(steps.stepOfSubmitRefusal(sent)?.step, 2);
  }
  assert.equal((await checkRow(requestId)).sent, false, "niente è partito");
  okPub(await pub.saveReferentCheck(link, benefit("costi-1", "si", { comment: "Lo sa l'ufficio acquisti." }), now));
  okPub(await pub.submitReferentAnswers(link, {}, now), "invio");
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
  const changed = await post({ step: 2, benefit: { key: "tempo-1", seen: { ...SEEN["tempo-1"], volumeYear: 1 }, answer: "si" } });
  assert.equal(changed.status, 409);
  assert.equal(changed.json.error, "stima_cambiata");
  const bad = await post({ step: 2, benefit: { key: "tempo-1", seen: SEEN["tempo-1"], answer: "meno", minutesEach: "-3" } });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error, "numero_non_valido");
  const row = await post({ step: 2, benefit: { key: "costi-1", seen: SEEN["costi-1"], answer: "meno", eurYear: "3.900" } });
  assert.equal(row.status, 200);
  assert.deepEqual((await benefitRows(requestId)).map((b) => [b.key, b.answer, b.e]), [["costi-1", "meno", "3900.00"]]);
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

test("(rilascio 5.1) la nota di «Correggi» con un nome o un'email si salva senza avvisi e parte; con un codice fiscale la bozza ha l'avviso, «Invia» la respinge sul campo «conferma» e la pagina torna al passo 1", opts, async () => {
  const steps = await import("./steps-state.ts");
  for (const note of ["Le fatture le manda mario.rossi@acme.test ogni lunedì.", "Il controllo lo fa Mario Rossi, non l'ufficio acquisti."]) {
    const card = await newCard(MODEL);
    const { link, requestId } = await referentLink(card.id, []);
    const now = new Date();
    const saved = okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "correggi", note }, now), "bozza");
    assert.equal(steps.stepOneWarning({ step: 1 }, saved.warnings), null, `nessun avviso: ${note}`);
    await answerAll(link);
    okPub(await pub.submitReferentAnswers(link, { shown: [] }, now), `invio: ${note}`);
    assert.equal((await checkRow(requestId)).sent, true);
  }
  const card = await newCard(MODEL);
  const { link, requestId } = await referentLink(card.id, []);
  const now = new Date();
  const saved = okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "correggi", note: "Il codice del fornitore è RSSMRA80A01H501U." }, now), "bozza con l'avviso");
  const warning = steps.stepOneWarning({ step: 1 }, saved.warnings);
  assert.ok(warning, "l'avviso sotto «Cosa cambieresti?»");
  await answerAll(link);
  const sent = await pub.submitReferentAnswers(link, { shown: [] }, now);
  assert.equal(sent.ok, false);
  if (!sent.ok) {
    assert.equal(sent.code, "risposte_da_correggere");
    assert.deepEqual([...new Set((sent.issues ?? []).map((i) => i.field))], ["conferma"]);
    // La pagina torna al passo 1 con il messaggio del server, lo stesso dell'avviso.
    const back = steps.stepOfSubmitRefusal(sent);
    assert.deepEqual(back, { step: 1, message: sent.issues![0].message });
    assert.equal(back?.message, warning);
  }
  assert.equal((await checkRow(requestId)).sent, false, "niente è partito");
  const clean = okPub(await pub.saveReferentCheck(link, { step: 1, confirm: "correggi", note: "Il controllo lo fa l'ufficio contabilità." }, now), "nota pulita");
  assert.equal(steps.stepOneWarning({ step: 1 }, clean.warnings), null);
  okPub(await pub.submitReferentAnswers(link, { shown: [] }, now), "invio");
  assert.equal((await checkRow(requestId)).sent, true);
});
