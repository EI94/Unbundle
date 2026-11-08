import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// (Rilascio 5, SPEC §3.6, §6.2, §7.5, A2, A4) Le chiusure delle domande sulla pagina del referente, sul
// database di prova: «Non ce l'ho» ed «È già allegato» che si escludono e tolgono il testo, il commento solo
// con una chiusura senza testo, «Serve un file» che un testo non chiude, l'invio tutto o niente con una
// voce per domanda che manca, le domande nuove del team mentre la pagina era aperta, i conteggi della
// campanella, la vista in sola lettura.
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

let referents: Referents;
let pub: Public;
let dispatch: Dispatch;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), analyst: randomUUID() };
const BASE = "http://localhost:3000";
const storageDir = mkdtempSync(join(tmpdir(), "referenti-chiusure-"));
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

async function newCard(model: unknown): Promise<{ id: string; needs: string[] }> {
  const id = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, value_model)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Le fatture arrivano via PEC. Si risparmiano 4.000 € l''anno. Il controllo è a mano.', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed', $4::jsonb)`,
    [id, ids.ws, `RZ-${String(1000 + Math.floor(Math.random() * 8000))}`, model === null ? null : JSON.stringify(model)],
  );
  ok(await referents.prepareReferentQuestions(as(), id), "prepara");
  const rows = await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid ORDER BY n.sort_order, n.id`, [id]);
  return { id, needs: rows.map((r) => String(r.id)) };
}

let contactSeq = 0;
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
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione chiusure', $2)`, [ids.org, `hub-chiusure-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'TopJet prova')`, [ids.ws, ids.org]);
  for (const [id, role] of [[ids.builder, "function_lead"], [ids.analyst, "analyst"]] as const) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [id, `${role}.chiusure.${suffix}@cliente.test`, `Persona ${role}`]);
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


async function closedLink(questions: number, fileRequired: number[] = []) {
  const card = await newCard(null);
  const needIds = card.needs.slice(0, questions);
  const email = `referente.${contactSeq++}.${suffix}@topjet.test`;
  const sent = ok(
    await referents.sendReferentRequest(
      as(),
      card.id,
      { contact: { kind: "nuovo", displayName: "Bruna Esempio", email }, needIds, fileRequired: fileRequired.map((i) => needIds[i]) },
      { env: ENV, requester: { name: "Giulia Neri", emailVerified: true } },
    ),
    "invio",
  );
  const outbox: Mail[] = [];
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer: { async send(m: Mail) { outbox.push(m); return { ok: true as const }; } }, sendIntervalMs: 0 });
  const token = /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(outbox[0]?.text ?? "")?.[1] ?? "";
  assert.ok(token, "il link è nell'email");
  const first = await pub.resolveReferentToken(token, new Date());
  if (first.access !== "ok") throw new Error("link");
  okPub(await pub.acceptReferentPrivacy(first.link, { version: "ucq-2026-11-2" }, new Date()));
  const again = await pub.resolveReferentToken(token, new Date());
  if (again.access !== "ok") throw new Error("link");
  return { card, needIds, token, requestId: sent.requestId, link: again.link };
}
const CSV = new TextEncoder().encode("mese;fatture\nottobre;420\n");
async function answerRow(requestId: string, needId: string) {
  return (await q(`SELECT body, dont_know, already_attached, comment, status FROM use_case_need_answers WHERE request_id = $1::uuid AND need_id = $2::uuid`, [requestId, needId]))[0];
}

test("la bozza: «Non ce l'ho» ed «È già allegato» si escludono e tolgono il testo; il commento solo con una chiusura senza testo", opts, async () => {
  const { link, needIds, requestId, token } = await closedLink(3);
  const [a, b, c] = needIds;
  const now = new Date();
  failed(await pub.saveReferentDraft(link, { needId: a, text: null, dontKnow: true, alreadyAttached: true }, now), "dati_non_validi");
  failed(await pub.saveReferentDraft(link, { needId: a, text: "Testo", dontKnow: false, comment: "Un commento" }, now), "dati_non_validi", "un commento con il solo testo");
  failed(await pub.saveReferentDraft(link, { needId: a, text: null, dontKnow: true, comment: "Il collega è in malattia per una visita medica" }, now), "testo_sanitario");
  failed(await pub.saveReferentDraft(link, { needId: a, text: null, dontKnow: false, alreadyAttached: "sì" }, now), "dati_non_validi");
  okPub(await pub.saveReferentDraft(link, { needId: a, text: "resta?", dontKnow: true, comment: "Lo sa l'ufficio acquisti" }, now), "non ce l'ho");
  assert.deepEqual(await answerRow(requestId, a), { body: null, dont_know: true, already_attached: false, comment: "Lo sa l'ufficio acquisti", status: "bozza" });
  okPub(await pub.saveReferentDraft(link, { needId: b, text: "resta?", dontKnow: false, alreadyAttached: true, comment: "È nel file della domanda 3." }, now), "è già allegato");
  assert.deepEqual(await answerRow(requestId, b), { body: null, dont_know: false, already_attached: true, comment: "È nel file della domanda 3.", status: "bozza" });
  // Un file che si può inviare porta il commento anche senza le due scelte.
  okPub(await pub.uploadReferentFileServer(link, { needId: c, fileName: "volumi.csv", declaration: true, bytes: CSV }, ENV) as never, "file");
  okPub(await pub.saveReferentDraft(link, { needId: c, text: null, dontKnow: false, comment: "Il file di ottobre" }, now), "commento col file");
  // La vista torna le chiusure come sono salvate.
  const view = await viewOf(token);
  assert.deepEqual(
    view.questions.map((q) => q.draft && [q.draft.text, q.draft.dontKnow, q.draft.alreadyAttached, q.draft.comment]),
    [["", true, false, "Lo sa l'ufficio acquisti"], ["", false, true, "È nel file della domanda 3."], ["", false, false, "Il file di ottobre"]],
  );
});

test("«Serve un file»: un testo non la chiude; un file, «È già allegato» o «Non ce l'ho» sì; l'invio dice quali mancano", opts, async () => {
  const { link, needIds, requestId, token } = await closedLink(3, [0]);
  const [f, t, x] = needIds;
  const now = new Date();
  const view = await viewOf(token);
  assert.deepEqual(view.questions.map((q) => q.fileRequired), [true, false, false]);
  okPub(await pub.saveReferentDraft(link, { needId: f, text: "Lo mando dopo", dontKnow: false }, now));
  okPub(await pub.saveReferentDraft(link, { needId: t, text: "Circa 20 al giorno", dontKnow: false }, now));
  const open = await pub.submitReferentAnswers(link, {}, now);
  assert.ok(!open.ok && open.code === "domande_aperte", JSON.stringify(open));
  if (!open.ok) {
    assert.deepEqual(open.issues?.map((i) => [i.field, i.message]), [
      [f, "Per chiudere: allega il file o scegli «Non ce l'ho»."],
      [x, "Per chiudere: rispondi, allega un file o scegli «Non ce l'ho»."],
    ]);
    assert.equal(open.message, "Mancano ancora alcune domande: le trovi evidenziate.");
  }
  assert.equal((await q(`SELECT status FROM use_case_referent_requests WHERE id = $1::uuid`, [requestId]))[0].status, "inviata", "niente di scritto");
  okPub(await pub.uploadReferentFileServer(link, { needId: f, fileName: "volumi.csv", declaration: true, bytes: CSV }, ENV) as never, "file");
  okPub(await pub.saveReferentDraft(link, { needId: x, text: null, dontKnow: false, alreadyAttached: true }, now));
  // Una domanda nuova del team mentre la pagina era aperta: rilegge.
  const shown = view.questions.filter((q) => q.state === "aperta").map((q) => q.needId);
  const card = (await q(`SELECT use_case_id::text AS id FROM use_case_referent_requests WHERE id = $1::uuid`, [requestId]))[0].id as string;
  const [r] = await q(`SELECT version FROM use_case_referent_requests WHERE id = $1::uuid`, [requestId]);
  const extra = (await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid AND n.status = 'da_chiedere' ORDER BY n.sort_order, n.id LIMIT 1`, [card]))[0].id as string;
  ok(await referents.addToReferentRequest(as(), card, requestId, Number(r.version), { needIds: [extra] }, { env: ENV }), "aggiungi domande");
  const fresh = await pub.submitReferentAnswers(link, { shown }, now);
  assert.ok(!fresh.ok && fresh.code === "domande_nuove", JSON.stringify(fresh));
  if (!fresh.ok) {
    assert.deepEqual(fresh.issues?.map((i) => i.field), [extra]);
    assert.equal(fresh.message, "Ci sono domande nuove: le trovi qui sotto.");
  }
  okPub(await pub.saveReferentDraft(link, { needId: extra, text: null, dontKnow: true, comment: "Tra una settimana" }, now));
  const done = okPub(await pub.submitReferentAnswers(link, { shown: [...shown, extra] }, now), "invio");
  assert.deepEqual(done, { submitted: 4, open: 0, state: "completata" });
  // Il testo che non chiudeva la domanda con il file non parte; «È già allegato» è una risposta da verificare.
  assert.deepEqual(await answerRow(requestId, f), { body: null, dont_know: false, already_attached: false, comment: null, status: "inviata" });
  assert.deepEqual(await answerRow(requestId, x), { body: null, dont_know: false, already_attached: true, comment: null, status: "inviata" });
  assert.deepEqual(await answerRow(requestId, extra), { body: null, dont_know: true, already_attached: false, comment: "Tra una settimana", status: "inviata" });
  const statuses = await q(`SELECT id::text AS id, status FROM use_case_needs WHERE id = ANY($1::uuid[])`, [[f, t, x, extra]]);
  const byId = Object.fromEntries(statuses.map((s) => [s.id, s.status]));
  assert.deepEqual([byId[f], byId[t], byId[x], byId[extra]], ["in_verifica", "in_verifica", "in_verifica", "mancante"]);
  const items = await q(`SELECT need_id::text AS id, state FROM use_case_referent_request_items WHERE request_id = $1::uuid ORDER BY position`, [requestId]);
  assert.deepEqual(items.map((i) => i.state), ["risposta", "risposta", "risposta", "non_so"]);
  // La campanella: due risposte (il testo e «È già allegato»), un «Non ce l'ho», un documento.
  const notes = await q(`SELECT answers, unknowns, documents FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'risposte'`, [card]);
  assert.ok(notes.length > 0 && notes.every((n) => [n.answers, n.unknowns, n.documents].map(Number).join() === "2,1,1"), JSON.stringify(notes));
  // In sola lettura: «Non ce l'ho», «È già allegato», «Chi potrebbe saperlo».
  const after = await viewOf(token);
  assert.equal(after.state, "completata");
  const answers = after.questions.map((q) => q.answer && [q.answer.dontKnow, q.answer.alreadyAttached, q.answer.comment]);
  assert.deepEqual(answers, [[false, false, null], [false, false, null], [false, true, null], [true, false, "Tra una settimana"]]);
});

test("«Non ce l'ho» con un file: l'invio lo rifiuta, come prima", opts, async () => {
  const { link, needIds } = await closedLink(1);
  const now = new Date();
  okPub(await pub.uploadReferentFileServer(link, { needId: needIds[0], fileName: "volumi.csv", declaration: true, bytes: CSV }, ENV) as never, "file");
  okPub(await pub.saveReferentDraft(link, { needId: needIds[0], text: null, dontKnow: true }, now));
  failed(await pub.submitReferentAnswers(link, {}, now), "non_so_con_file");
});
