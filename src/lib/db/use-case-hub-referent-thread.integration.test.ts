import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

// Schema della 0028 sul database di prova dell'hub («Il filo con il referente»): il file due volte e il
// self-heal due volte non cambiano niente, nemmeno la 0025 e la 0027 di nuovo; su un database con la sola
// 0027 il self-heal crea tutto e allarga i due CHECK (in una transazione annullata); ogni CHECK delle tabelle
// nuove rifiuta la riga sbagliata e accetta quella giusta; le scritture del rilascio 5.1 funzionano ancora;
// la pulizia di RUNBOOK §10.15 toglie solo quello che dice.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1):
//   lo schema lo porta il vero ensureDbSchema(); il file si applica come un unico testo (una transazione
//   implicita, come `psql --single-transaction`). Dati sintetici, creati e cancellati qui.
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

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let ddl: typeof import("./use-case-hub-referent-thread-ddl.ts");
let ensure: typeof import("./ensure-schema.ts");

const migration = readFileSync(new URL("../../../drizzle/0028_use_case_referent_thread.sql", import.meta.url), "utf8");
const migration0027 = readFileSync(new URL("../../../drizzle/0027_use_case_referent_benefits.sql", import.meta.url), "utf8");
const migration0025 = readFileSync(new URL("../../../drizzle/0025_use_case_alerts.sql", import.meta.url), "utf8");
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), useCase: randomUUID(), need: randomUUID(), user: randomUUID() };

const TABLES = [
  "use_case_referent_messages",
  "use_case_referent_suggestions",
  "use_case_referent_requests",
  "use_case_referent_request_items",
  "use_case_need_answers",
  "use_case_referent_email_items",
  "use_case_requester_email_items",
  "use_case_notifications",
];

async function schemaSnapshot(): Promise<string> {
  const list = TABLES.map((t) => `'${t}'`).join(", ");
  const columns = await q(
    `SELECT table_name, column_name, data_type, is_nullable, column_default, character_maximum_length
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${list}) ORDER BY table_name, ordinal_position`,
  );
  const constraints = await q(
    `SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint
     WHERE conrelid IN (${TABLES.map((t) => `'public.${t}'::regclass`).join(", ")}) ORDER BY 1, 2`,
  );
  const indexes = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN (${list}) ORDER BY 1`);
  return JSON.stringify({ columns, constraints, indexes });
}

async function probe(): Promise<boolean> {
  return (await q(`SELECT ${ddl.USE_CASE_REFERENT_THREAD_PROBE_SQL} AS ok`))[0]?.ok === true;
}

async function newRequest(status: "inviata" | "completata" | "revocata" = "inviata"): Promise<string> {
  const id = randomUUID();
  const revoked = status === "revocata";
  await q(
    `INSERT INTO use_case_referent_requests (id, workspace_id, use_case_id, contact_id, requester_name, status, expires_at, completed_at, revoked_at, revoked_reason)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Persona di prova', $5, now() + interval '30 days', $6::timestamptz, $7::timestamptz, $8)`,
    [id, ids.ws, ids.useCase, randomUUID(), status, status === "completata" ? new Date().toISOString() : null, revoked ? new Date().toISOString() : null, revoked ? "cancellazione" : null],
  );
  return id;
}

const messageSql = (keys: string[]) =>
  `INSERT INTO use_case_referent_messages (request_id, workspace_id, use_case_id${keys.map((k) => `, ${k}`).join("")})
   VALUES ($1::uuid, $2::uuid, $3::uuid${keys.map((_, i) => `, $${i + 4}`).join("")}) RETURNING id`;

async function newMessage(requestId: string, values: Record<string, unknown>): Promise<string> {
  const keys = Object.keys(values);
  const [row] = await q(messageSql(keys), [requestId, ids.ws, ids.useCase, ...keys.map((k) => values[k])]);
  return String(row.id);
}

const suggestionSql = (keys: string[]) =>
  `INSERT INTO use_case_referent_suggestions (request_id, workspace_id, use_case_id${keys.map((k) => `, ${k}`).join("")})
   VALUES ($1::uuid, $2::uuid, $3::uuid${keys.map((_, i) => `, $${i + 4}`).join("")}) RETURNING id`;

async function newSuggestion(requestId: string, values: Record<string, unknown>): Promise<string> {
  const keys = Object.keys(values);
  const [row] = await q(suggestionSql(keys), [requestId, ids.ws, ids.useCase, ...keys.map((k) => values[k])]);
  return String(row.id);
}

async function rejects(sqlText: string, params: unknown[], constraint: string) {
  await assert.rejects(q(sqlText, params), (error: unknown) => {
    const text = String((error as { message?: unknown })?.message ?? error);
    assert.ok(text.includes(constraint), `atteso ${constraint}, ricevuto: ${text}`);
    return true;
  });
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("./ensure-schema.ts");
  await ensure.ensureDbSchema();
  ddl = await import("./use-case-hub-referent-thread-ddl.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova 0028', $2)`, [ids.org, `org-0028-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova 0028')`, [ids.ws, ids.org]);
  await q(`INSERT INTO use_cases (id, workspace_id, title) VALUES ($1, $2, 'Scheda di prova 0028')`, [ids.useCase, ids.ws]);
  await q(`INSERT INTO use_case_needs (id, workspace_id, type, title, status) VALUES ($1, $2, 'requisito', 'Volumi mensili', 'in_verifica')`, [ids.need, ids.ws]);
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Persona di prova 0028')`, [ids.user, `prova-0028-${suffix}@example.test`]);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
});

test("lo schema della 0028 c'è; il file due volte, il self-heal due volte, la 0025 e la 0027 di nuovo non cambiano niente", opts, async () => {
  const [row] = await q(`SELECT current_database() AS db`);
  assert.equal(row.db, process.env.UC_TEST_PG_DB);
  assert.equal(await probe(), true);
  const first = await schemaSnapshot();
  await q(migration);
  await q(migration);
  assert.equal(await schemaSnapshot(), first, "il file due volte");
  await ensure.runUseCaseReferentThreadDdl();
  await ensure.runUseCaseReferentThreadDdl();
  assert.equal(await schemaSnapshot(), first, "il self-heal due volte");
  await q(migration0025);
  await q(migration0027);
  await ensure.runUseCaseAlertsDdl();
  assert.equal(await schemaSnapshot(), first, "la 0025 di nuovo non toglie «domanda»");
  assert.equal(await probe(), true);
  const [kinds] = await q(`SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conname = 'use_case_notifications_kind_check'`);
  assert.match(String(kinds.def), /'domanda'/);
  assert.match(String(kinds.def), /'pronto'[\s\S]*'fornitori'/);
  assert.equal(kinds.convalidated, true);
  const [news] = await q(`SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conname = 'use_case_requester_email_items_news_check'`);
  assert.match(String(news.def), /questions > 0/);
  assert.equal(news.convalidated, true);
});

test("su un database con la sola 0027 il self-heal crea il filo e allarga i due CHECK (in una transazione annullata)", opts, async () => {
  // Tutto in un solo testo, quindi in una transazione implicita: la 0028 tolta (tabelle, colonne, CHECK come
  // nella 0024 e nella 0025), la sonda falsa, gli statement del self-heal, le prove, poi un errore voluto.
  const marker = `prova-0028-annullata-${suffix}`;
  const text = [
    `DROP TABLE use_case_referent_suggestions;`,
    `DROP TABLE use_case_referent_messages;`,
    `ALTER TABLE use_case_referent_requests DROP COLUMN reopened_at, DROP COLUMN renewed_at;`,
    `ALTER TABLE use_case_referent_request_items DROP COLUMN follow_up;`,
    `ALTER TABLE use_case_need_answers DROP COLUMN edited_at;`,
    `ALTER TABLE use_case_referent_email_items DROP COLUMN clarifications, DROP COLUMN replies;`,
    `DELETE FROM use_case_notifications WHERE kind = 'domanda';`,
    `DELETE FROM use_case_requester_email_items WHERE questions > 0;`,
    `ALTER TABLE use_case_requester_email_items DROP CONSTRAINT use_case_requester_email_items_news_check;`,
    `ALTER TABLE use_case_requester_email_items DROP COLUMN questions;`,
    `ALTER TABLE use_case_requester_email_items ADD CONSTRAINT use_case_requester_email_items_news_check CHECK (answers > 0 OR unknowns > 0 OR documents > 0 OR follow_up IS NOT NULL);`,
    `ALTER TABLE use_case_notifications DROP CONSTRAINT use_case_notifications_kind_check;`,
    `ALTER TABLE use_case_notifications ADD CONSTRAINT use_case_notifications_kind_check CHECK (kind IN ('risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori'));`,
    `DO $$ BEGIN IF ${ddl.USE_CASE_REFERENT_THREAD_PROBE_SQL} THEN RAISE EXCEPTION 'la 0028 non è stata tolta'; END IF; END $$;`,
    ...ddl.USE_CASE_REFERENT_THREAD_DDL,
    `DO $$ DECLARE req uuid := gen_random_uuid(); msg uuid; BEGIN
  IF NOT ${ddl.USE_CASE_REFERENT_THREAD_PROBE_SQL} THEN RAISE EXCEPTION 'sonda falsa dopo il self-heal'; END IF;
  INSERT INTO use_case_referent_requests (id, workspace_id, use_case_id, contact_id, requester_name, status, expires_at, reopened_at, renewed_at)
    VALUES (req, '${ids.ws}', '${ids.useCase}', gen_random_uuid(), 'Persona di prova', 'inviata', now() + interval '30 days', now(), now());
  INSERT INTO use_case_referent_messages (request_id, workspace_id, use_case_id, anchor, need_id, side, kind, body)
    VALUES (req, '${ids.ws}', '${ids.useCase}', 'domanda', '${ids.need}', 'team', 'chiarimento', 'Quante, più o meno?') RETURNING id INTO msg;
  INSERT INTO use_case_referent_messages (request_id, workspace_id, use_case_id, anchor, need_id, side, kind, reply_to_id, body)
    VALUES (req, '${ids.ws}', '${ids.useCase}', 'domanda', '${ids.need}', 'referente', 'risposta', msg, 'Circa duecento.');
  INSERT INTO use_case_referent_suggestions (request_id, workspace_id, use_case_id, anchor, component_key, source_at)
    VALUES (req, '${ids.ws}', '${ids.useCase}', 'beneficio', 'tempo-1', now());
  INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day)
    VALUES ('${ids.ws}', '${ids.useCase}', '${ids.user}', 'domanda', current_date);
  RAISE EXCEPTION '${marker}';
END $$;`,
  ].join("\n");
  await rejects(text, [], marker);
  // Annullata: la 0028 c'è ancora, come prima.
  assert.equal(await probe(), true);
});

test("ogni CHECK del filo rifiuta la riga sbagliata e accetta quella giusta", opts, async () => {
  const req = await newRequest();
  const chiarimento = await newMessage(req, { anchor: "domanda", need_id: ids.need, side: "team", kind: "chiarimento", author_user_id: ids.user, body: "Quante, più o meno?" });
  await newMessage(req, { anchor: "domanda", need_id: ids.need, side: "referente", kind: "risposta", reply_to_id: chiarimento, body: "Circa duecento al mese." });
  await newMessage(req, { anchor: "beneficio", component_key: "tempo-1", side: "referente", kind: "dubbio", body: "Contate anche il sabato?" });
  await newMessage(req, { anchor: "generale", side: "referente", kind: "aggiunta", body: "Aggiungo una cosa." });
  const keys = ["anchor", "need_id", "component_key", "side", "kind", "author_user_id", "reply_to_id", "body", "removed_at", "removed_reason", "handled_at", "handled_by_user_id"];
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ anchor: "altro", side: "team", kind: "chiarimento", body: "x" }, "use_case_referent_messages_anchor_check"],
    [{ anchor: "domanda", side: "team", kind: "chiarimento", body: "x" }, "use_case_referent_messages_shape_check"],
    [{ anchor: "beneficio", need_id: ids.need, component_key: "k", side: "team", kind: "chiarimento", body: "x" }, "use_case_referent_messages_shape_check"],
    [{ anchor: "generale", component_key: "k", side: "team", kind: "chiarimento", body: "x" }, "use_case_referent_messages_shape_check"],
    [{ anchor: "generale", side: "cliente", kind: "chiarimento", body: "x" }, "use_case_referent_messages_side_check"],
    [{ anchor: "generale", side: "team", kind: "nota", body: "x" }, "use_case_referent_messages_kind_check"],
    [{ anchor: "generale", side: "team", kind: "dubbio", body: "x" }, "use_case_referent_messages_side_kind_check"],
    [{ anchor: "generale", side: "referente", kind: "chiarimento", body: "x" }, "use_case_referent_messages_side_kind_check"],
    [{ anchor: "generale", side: "referente", kind: "dubbio", author_user_id: ids.user, body: "x" }, "use_case_referent_messages_author_check"],
    [{ anchor: "generale", side: "referente", kind: "risposta", body: "x" }, "use_case_referent_messages_reply_check"],
    [{ anchor: "generale", side: "referente", kind: "dubbio", reply_to_id: chiarimento, body: "x" }, "use_case_referent_messages_reply_check"],
    [{ anchor: "generale", side: "referente", kind: "dubbio", body: null }, "use_case_referent_messages_body_check"],
    [{ anchor: "generale", side: "referente", kind: "dubbio", body: "   " }, "use_case_referent_messages_body_check"],
    [{ anchor: "generale", side: "referente", kind: "dubbio", body: "x", removed_at: new Date().toISOString(), removed_reason: "cancellazione" }, "use_case_referent_messages_body_check"],
    [{ anchor: "generale", side: "referente", kind: "dubbio", body: null, removed_at: new Date().toISOString() }, "use_case_referent_messages_removed_check"],
    [{ anchor: "generale", side: "referente", kind: "dubbio", body: null, removed_at: new Date().toISOString(), removed_reason: "revisore" }, "use_case_referent_messages_removed_reason_check"],
    [{ anchor: "generale", side: "referente", kind: "dubbio", body: "x", handled_by_user_id: ids.user }, "use_case_referent_messages_handled_check"],
  ];
  for (const [values, constraint] of bad) {
    const row = Object.fromEntries(keys.map((k) => [k, values[k] ?? null]));
    await rejects(messageSql(keys), [req, ids.ws, ids.useCase, ...keys.map((k) => row[k])], constraint);
  }
  // Un messaggio tolto: niente testo, con il motivo.
  await newMessage(req, { anchor: "generale", side: "referente", kind: "dubbio", body: null, removed_at: new Date().toISOString(), removed_reason: "conservazione" });
  // Gestito da una persona del team.
  await newMessage(req, { anchor: "generale", side: "referente", kind: "dubbio", body: "x", handled_at: new Date().toISOString(), handled_by_user_id: ids.user });
  // La risposta sparisce con il messaggio a cui risponde; il messaggio sparisce con la richiesta.
  const [count] = await q(`SELECT count(*)::int AS n FROM use_case_referent_messages WHERE request_id = $1::uuid`, [req]);
  assert.equal(count.n, 6);
  await q(`DELETE FROM use_case_referent_messages WHERE id = $1::uuid`, [chiarimento]);
  const [left] = await q(`SELECT count(*)::int AS n FROM use_case_referent_messages WHERE request_id = $1::uuid`, [req]);
  assert.equal(left.n, 4);
  await q(`DELETE FROM use_case_referent_requests WHERE id = $1::uuid`, [req]);
  const [none] = await q(`SELECT count(*)::int AS n FROM use_case_referent_messages WHERE request_id = $1::uuid`, [req]);
  assert.equal(none.n, 0);
});

test("ogni CHECK delle proposte dell'AI rifiuta la riga sbagliata e accetta quella giusta; una sola proposta per risposta", opts, async () => {
  const req = await newRequest("completata");
  const at = new Date().toISOString();
  await newSuggestion(req, { anchor: "domanda", need_id: ids.need, source_at: at });
  await newSuggestion(req, { anchor: "beneficio", component_key: "tempo-1", source_at: at, status: "proposta", body: "Quante volte al mese?", model: "modello-di-prova" });
  await newSuggestion(req, { anchor: "generale", source_at: at, status: "scartata", body: "Chi controlla?", decided_at: at, decided_by_user_id: ids.user });
  await newSuggestion(req, { anchor: "beneficio", component_key: "costi-1", source_at: at, status: "nessuna" });
  const keys = ["anchor", "need_id", "component_key", "source_at", "status", "body", "attempts", "decided_at", "decided_by_user_id"];
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ anchor: "domanda", need_id: ids.need, source_at: at }, "use_case_referent_suggestions_target_unique"],
    [{ anchor: "generale", need_id: ids.need, source_at: at }, "use_case_referent_suggestions_shape_check"],
    [{ anchor: "generale", source_at: at, status: "inviata" }, "use_case_referent_suggestions_status_check"],
    [{ anchor: "generale", source_at: at, status: "proposta" }, "use_case_referent_suggestions_body_check"],
    [{ anchor: "generale", source_at: at, status: "nessuna", body: "Una domanda" }, "use_case_referent_suggestions_body_check"],
    [{ anchor: "generale", source_at: at, status: "usata", body: "Una domanda" }, "use_case_referent_suggestions_decided_check"],
    [{ anchor: "generale", source_at: at, status: "proposta", body: "Una domanda", decided_at: at }, "use_case_referent_suggestions_decided_check"],
    [{ anchor: "generale", source_at: at, attempts: 4 }, "use_case_referent_suggestions_attempts_check"],
  ];
  for (const [values, constraint] of bad) {
    const row = Object.fromEntries(keys.map((k) => [k, values[k] ?? (k === "status" ? "da_fare" : k === "attempts" ? 0 : null)]));
    await rejects(suggestionSql(keys), [req, ids.ws, ids.useCase, ...keys.map((k) => row[k])], constraint);
  }
  // Una risposta nuova (un altro `source_at`) ha la sua proposta.
  await newSuggestion(req, { anchor: "domanda", need_id: ids.need, source_at: new Date(Date.now() + 1000).toISOString() });
});

test("le scritture del rilascio 5.1 funzionano ancora con le colonne nuove; le novità nuove stanno nei CHECK allargati", opts, async () => {
  // Una richiesta, una domanda, una risposta inviata, come le scrive il rilascio 5.1 (senza nominare le colonne nuove).
  const req = await newRequest();
  await q(`INSERT INTO use_case_referent_request_items (request_id, need_id, workspace_id, position, question) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'Volumi mensili')`, [req, ids.need, ids.ws]);
  await q(
    `INSERT INTO use_case_need_answers (workspace_id, use_case_id, need_id, request_id, source, body, status, submitted_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'referente', 'Circa 200', 'inviata', now())`,
    [ids.ws, ids.useCase, ids.need, req],
  );
  const [item] = await q(`SELECT follow_up FROM use_case_referent_request_items WHERE request_id = $1::uuid`, [req]);
  assert.equal(item.follow_up, false);
  const [answer] = await q(`SELECT edited_at FROM use_case_need_answers WHERE request_id = $1::uuid`, [req]);
  assert.equal(answer.edited_at, null);
  // La voce «nuove» del rilascio 5.1: solo `new_questions`.
  const [email] = await q(
    `INSERT INTO use_case_referent_emails (workspace_id, contact_id, request_id, template, dedupe_key) VALUES ($1::uuid, gen_random_uuid(), NULL, 'promemoria', $2) RETURNING id`,
    [ids.ws, `pm-0028-${suffix}`],
  );
  await q(`INSERT INTO use_case_referent_email_items (email_id, request_id, workspace_id, kind, new_questions) VALUES ($1::uuid, $2::uuid, $3::uuid, 'nuove', 2)`, [email.id, req, ids.ws]);
  const [stored] = await q(`SELECT clarifications, replies FROM use_case_referent_email_items WHERE email_id = $1::uuid`, [email.id]);
  assert.deepEqual({ ...stored }, { clarifications: 0, replies: 0 });
  await rejects(`UPDATE use_case_referent_email_items SET clarifications = 21 WHERE email_id = $1::uuid`, [email.id], "use_case_referent_email_items_clarifications_check");
  await rejects(`UPDATE use_case_referent_email_items SET replies = -1 WHERE email_id = $1::uuid`, [email.id], "use_case_referent_email_items_replies_check");
  // L'email a chi ha chiesto: le risposte come prima; le sole domande del referente adesso valgono, niente resta vietato.
  const [alert] = await q(
    `INSERT INTO use_case_requester_emails (workspace_id, recipient_user_id, send_on, scheduled_at, due_at) VALUES ($1::uuid, $2::uuid, current_date, now(), now()) RETURNING id`,
    [ids.ws, ids.user],
  );
  await q(`INSERT INTO use_case_requester_email_items (email_id, request_id, workspace_id, use_case_id, answers) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 1)`, [alert.id, req, ids.ws, ids.useCase]);
  const other = await newRequest("completata");
  await q(`INSERT INTO use_case_requester_email_items (email_id, request_id, workspace_id, use_case_id, questions) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 1)`, [alert.id, other, ids.ws, ids.useCase]);
  const third = await newRequest("completata");
  await rejects(
    `INSERT INTO use_case_requester_email_items (email_id, request_id, workspace_id, use_case_id) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [alert.id, third, ids.ws, ids.useCase],
    "use_case_requester_email_items_news_check",
  );
  // La campanella: i tipi di prima e «domanda»; un tipo inventato no.
  for (const kind of ["risposte", "pronto", "domanda"]) {
    await q(`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, current_date)`, [ids.ws, ids.useCase, ids.user, kind]);
  }
  await rejects(
    `INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day) VALUES ($1::uuid, $2::uuid, $3::uuid, 'chiacchiera', current_date)`,
    [ids.ws, ids.useCase, ids.user],
    "use_case_notifications_kind_check",
  );
  // La riapertura del rilascio 6 rispetta i CHECK di sempre della 0024 (completed_at resta, lo stato torna «inviata»).
  const done = await newRequest("completata");
  await q(`UPDATE use_case_referent_requests SET status = 'inviata', reopened_at = now(), renewed_at = now(), reminder_count = 0, expires_at = now() + interval '30 days', version = version + 1 WHERE id = $1::uuid`, [done]);
  // Ma due richieste vive alla stessa persona sullo stesso use case restano vietate.
  const [contact] = await q(`SELECT contact_id FROM use_case_referent_requests WHERE id = $1::uuid`, [done]);
  await rejects(
    `INSERT INTO use_case_referent_requests (workspace_id, use_case_id, contact_id, requester_name, status, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 'Persona di prova', 'inviata', now() + interval '30 days')`,
    [ids.ws, ids.useCase, contact.contact_id],
    "use_case_referent_requests_live_unique",
  );
});

test("la pulizia di RUNBOOK §10.15: i testi dei messaggi e le proposte delle richieste cancellate, e niente altro", opts, async () => {
  const at = new Date().toISOString();
  const erased = await newRequest("revocata");
  await q(`UPDATE use_case_referent_requests SET purged_at = now(), message = NULL WHERE id = $1::uuid`, [erased]);
  await newMessage(erased, { anchor: "generale", side: "referente", kind: "dubbio", body: "Un dubbio" });
  await newSuggestion(erased, { anchor: "generale", source_at: at, status: "proposta", body: "Una domanda" });
  const kept = await newRequest("completata");
  await q(`UPDATE use_case_referent_requests SET purged_at = now(), message = NULL WHERE id = $1::uuid`, [kept]);
  await newMessage(kept, { anchor: "generale", side: "team", kind: "chiarimento", body: "Un chiarimento" });
  const live = await newRequest();
  await newMessage(live, { anchor: "generale", side: "referente", kind: "dubbio", body: "Un dubbio vivo" });
  await newSuggestion(live, { anchor: "generale", source_at: at, status: "proposta", body: "Una domanda viva" });

  for (let round = 0; round < 2; round++) for (const statement of ddl.REFERENT_THREAD_SWEEP_SQL) await q(statement);

  const messagesOf = async (requestId: string) =>
    (await q(`SELECT body, removed_reason, removed_at IS NOT NULL AS removed FROM use_case_referent_messages WHERE request_id = $1::uuid`, [requestId])).map((r) => ({ ...r }));
  const suggestionsOf = async (requestId: string) => (await q(`SELECT count(*)::int AS n FROM use_case_referent_suggestions WHERE request_id = $1::uuid`, [requestId]))[0]?.n;
  assert.deepEqual(await messagesOf(erased), [{ body: null, removed_reason: "cancellazione", removed: true }]);
  assert.equal(await suggestionsOf(erased), 0);
  assert.deepEqual(await messagesOf(kept), [{ body: null, removed_reason: "conservazione", removed: true }]);
  assert.deepEqual(await messagesOf(live), [{ body: "Un dubbio vivo", removed_reason: null, removed: false }]);
  assert.equal(await suggestionsOf(live), 1);
});
