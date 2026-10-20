import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { sql as sqlTag } from "drizzle-orm";
import { UC_DDL, UC_DDL_MARKER, UC_PROBE_SQL, UC_TABLE_NAMES, UC_UNIQUE_DOSSIER_INDEX, UC_UNIQUE_DOSSIER_INDEX_DDL, UC_VOCAB_CHECKS } from "./ddl.ts";
import { createUcExecutor, runUcBatch, type UcExecutor } from "../db/uc-executor.ts";
import { eventInsertFromSql, eventInsertSql } from "../db/queries/uc-events.ts";
import { cast, requireRows, toStatement, ucSql } from "./sql/statement.ts";
import { requestLiveSql, requestVisibleSql } from "./sql/requests.ts";

// Opt-in integration suite (PIANO §3.12). It needs the isolated local harness
// (scripts/uc-test, PostgreSQL on 127.0.0.1:55449) and an explicit marker; the
// ordinary unit run (`npm run test:uc`) never contacts a database. Run with:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test src/lib/uc/database.integration.test.ts
const url = process.env.UC_TEST_DATABASE_URL;
const enabled = Boolean(url);
if (url) {
  const parsed = new URL(url);
  if (process.env.UC_TEST_ISOLATED !== "true" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("uc DB tests require an explicitly isolated loopback database (UC_TEST_ISOLATED=true)");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== url) {
    throw new Error("DATABASE_URL must be unset or equal to UC_TEST_DATABASE_URL for the uc DB tests");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs (NODE_OPTIONS=--require=…) to reach the local harness");
  }
}
const opts = { skip: !enabled };

const sql = url ? neon(url) : null;
const exec: UcExecutor | null = sql ? createUcExecutor(sql) : null;
const q = (text: string, params: unknown[] = []) => sql!.query(text, params) as Promise<Record<string, unknown>[]>;
const hex64 = () => randomBytes(32).toString("hex");

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  ws2: randomUUID(),
  lsUser: randomUUID(),
  clientUser: randomUUID(),
  template: randomUUID(),
  case: randomUUID(),
  case2: randomUUID(),
  item: randomUUID(),
  personal: randomUUID(),
  health: randomUUID(),
  blocked: randomUUID(),
  other: randomUUID(),
  item2: randomUUID(),
  blockerActive: randomUUID(),
  blockerResolved: randomUUID(),
  contact: randomUUID(),
};

async function insertItem(id: string, caseId: string, key: string, privacy = "riservato_azienda") {
  await q(
    `INSERT INTO uc_items (id, case_id, key, kind, section, title, privacy_class) VALUES ($1::uuid, $2::uuid, $3, 'domanda', 'modello_dati', 'Domanda di prova', $4)`,
    [id, caseId, key, privacy],
  );
}

async function insertAnswer(itemId: string, caseId: string, version: number, value: unknown, extra: { encrypted?: boolean } = {}) {
  const rows = await q(
    `INSERT INTO uc_answers (case_id, item_id, version, kind, value, value_encrypted, source_kind)
     VALUES ($1::uuid, $2::uuid, $3, 'valore', $4::jsonb, CASE WHEN $5 THEN decode('00ff', 'hex') END, 'referente') RETURNING id`,
    [caseId, itemId, version, value === null ? null : JSON.stringify(value), extra.encrypted ?? false],
  );
  return rows[0].id as string;
}

before(async () => {
  if (!sql) return;
  // A clone of a harness template migrated before the current 0018 (older marker, no unique index)
  // gets the current uc DDL first, as the harness migration does: the suite also runs on its own.
  const [probe] = await q(UC_PROBE_SQL);
  if (probe.current !== true || probe.unique_index !== true) {
    await sql.transaction([sql.query("SELECT pg_advisory_xact_lock(hashtext('unbundle:uc-ddl'))"), ...UC_DDL.map((statement) => sql.query(statement))]);
  }
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova uc', $2)`, [ids.org, `uc-it-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova uc A'), ($2::uuid, $3::uuid, 'Prova uc B')`, [ids.ws, ids.ws2, ids.org]);
  await q(
    `INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $3, now()), ($2::uuid, $4, now())`,
    [ids.lsUser, ids.clientUser, `lead-${suffix}@ls.test`, `owner-${suffix}@cliente.test`],
  );
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.integrazione_${suffix}`, hex64(), ids.ws],
  );
  for (const [caseId, ws, code] of [
    [ids.case, ids.ws, `IT-${suffix.toUpperCase()}`],
    [ids.case2, ids.ws2, `IT2-${suffix.toUpperCase()}`],
  ]) {
    await q(
      `INSERT INTO uc_cases (id, workspace_id, organization_id, template_id, template_version, code, title, status, setup_completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, '1.0.0', $5, 'Caso di prova', 'raccolta', now())`,
      [caseId, ws, ids.org, ids.template, code],
    );
  }
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'ls_lead')`, [ids.case, ids.lsUser]);
  await insertItem(ids.item, ids.case, "q.prova.01");
  await insertItem(ids.personal, ids.case, "q.prova.02", "personale");
  await insertItem(ids.health, ids.case, "q.prova.03", "escluso_sanitario");
  await insertItem(ids.blocked, ids.case, "q.prova.04");
  await insertItem(ids.other, ids.case, "q.prova.05");
  await insertItem(ids.item2, ids.case2, "q.prova.01");
  await q(
    `INSERT INTO uc_blockers (id, workspace_id, case_id, key, label, status) VALUES
       ($1::uuid, $3::uuid, $4::uuid, 'a8', 'Scheda A.8', 'attivo'),
       ($2::uuid, $3::uuid, $4::uuid, 'accesso_sistema', 'Accesso al sistema', 'sciolto')`,
    [ids.blockerActive, ids.blockerResolved, ids.ws, ids.case],
  );
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $2::uuid, 'Referente di prova', $3)`, [
    ids.contact,
    ids.ws,
    `referente-${suffix}@cliente.test`,
  ]);
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1::uuid, $2::uuid)`, [ids.ws, ids.ws2]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, [ids.lsUser, ids.clientUser]);
});

/** The unique index between dossier and card (docs/use-case/DESIGN.md §10.4): present, unique, partial. */
async function uniqueDossierIndex(): Promise<{ present: boolean; unique: boolean; definition: string | null }> {
  const rows = await q(
    `SELECT i.indisunique AS unique, pg_get_indexdef(i.indexrelid) AS definition
       FROM pg_index i WHERE i.indexrelid = to_regclass($1)`,
    [`public.${UC_UNIQUE_DOSSIER_INDEX}`],
  );
  return rows.length === 0 ? { present: false, unique: false, definition: null } : { present: true, unique: rows[0].unique === true, definition: String(rows[0].definition) };
}

test("schema: 27 uc tables, validated vocabulary CHECKs, the unique dossier index and a current probe", opts, async () => {
  const tables = await q(`SELECT count(*)::int AS n FROM unnest($1::text[]) t(name) WHERE to_regclass('public.' || t.name) IS NOT NULL`, [UC_TABLE_NAMES]);
  assert.equal(tables[0].n, 27);
  const checks = await q(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = ANY($1::text[]) AND convalidated`, [UC_VOCAB_CHECKS.map((c) => c.name)]);
  assert.equal(checks[0].n, UC_VOCAB_CHECKS.length);
  const index = await uniqueDossierIndex();
  assert.equal(index.present && index.unique, true, "without duplicates the 0018 creates the unique index");
  assert.match(index.definition!, /\(portfolio_use_case_id\) WHERE \(portfolio_use_case_id IS NOT NULL\)$/);
  const old = await q(`SELECT to_regclass('public.uc_cases_portfolio_use_case_idx') IS NOT NULL AS present`);
  assert.equal(old[0].present, true, "the old non-unique index stays");
  const probe = await q(UC_PROBE_SQL);
  assert.equal(probe[0].current, true);
  assert.equal(probe[0].unique_index, true);
});

test("uc_require aborts the whole batch and maps to a code", opts, async () => {
  const insert = toStatement(ucSql`INSERT INTO uc_milestones (case_id, key, title) VALUES (${cast(ids.case, "uuid")}, 'mai', 'Non deve restare')`);
  const result = await runUcBatch(exec!, [insert, { text: "SELECT uc_require(false, 'conflitto')", params: [] }]);
  assert.deepEqual(result.ok ? null : result.code, "conflitto");
  const rows = await q(`SELECT count(*)::int AS n FROM uc_milestones WHERE case_id = $1::uuid AND key = 'mai'`, [ids.case]);
  assert.equal(rows[0].n, 0, "the insert before uc_require was rolled back");
});

test("CAS: two concurrent transitions on the same item, exactly one wins with one event", opts, async () => {
  const transition = () =>
    runUcBatch(exec!, [
      toStatement(ucSql`WITH changed AS (
          UPDATE uc_items SET status = 'chiesta', status_changed_at = now()
          WHERE id = ${cast(ids.other, "uuid")} AND case_id = ${cast(ids.case, "uuid")} AND status = 'da_chiedere'
          RETURNING id, key),
        ev AS (${eventInsertFromSql({
          type: "voce.stato_cambiato",
          workspaceId: ids.ws,
          caseId: ids.case,
          actor: { type: "utente", userId: ids.lsUser },
          targetType: "voce",
          from: "changed",
          targetIdColumn: "changed.id",
          payload: { trigger: "invio_richiesta" },
          rowPayload: { item_key: "changed.key" },
        })})
        SELECT uc_require((SELECT count(*) FROM changed) = 1, 'conflitto') AS ok`),
    ]);
  const results = await Promise.all([transition(), transition()]);
  assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
  const loser = results.find((r) => !r.ok);
  assert.equal(loser && !loser.ok ? loser.code : null, "conflitto");
  const item = await q(`SELECT status FROM uc_items WHERE id = $1::uuid`, [ids.other]);
  assert.equal(item[0].status, "chiesta");
  const events = await q(`SELECT payload FROM uc_events WHERE target_id = $1::uuid AND event_type = 'voce.stato_cambiato'`, [ids.other]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload, { trigger: "invio_richiesta", item_key: "q.prova.05" });
  const cas = await runUcBatch(exec!, [
    toStatement(requireRows(ucSql`UPDATE uc_items SET status = 'chiesta' WHERE id = ${cast(ids.other, "uuid")} AND status = 'da_chiedere' RETURNING 1`, 1)),
  ]);
  assert.equal(cas.ok, false);
});

test("answers are append-only: no UPDATE, no DELETE, only privacy erasure", opts, async () => {
  const answerId = await insertAnswer(ids.item, ids.case, 1, { text: "valore di prova" });
  await q(`UPDATE uc_items SET current_answer_id = $1::uuid WHERE id = $2::uuid`, [answerId, ids.item]);
  await assert.rejects(() => q(`UPDATE uc_answers SET note = 'cambiata' WHERE id = $1::uuid`, [answerId]), /uc:sola_aggiunta/);
  await assert.rejects(() => q(`DELETE FROM uc_answers WHERE id = $1::uuid`, [answerId]), /uc:sola_aggiunta/);
  await assert.rejects(() => insertAnswer(ids.item, ids.case, 1, { text: "doppia" }), /unique|duplicate/i);
  // Erasure that also touches another column is refused.
  await assert.rejects(
    () =>
      q(`UPDATE uc_answers SET value = NULL, erased_at = now(), erasure_reason = 'richiesta_interessato', source_ref = 'altro' WHERE id = $1::uuid`, [answerId]),
    /uc:sola_aggiunta/,
  );
  await q(
    `UPDATE uc_answers SET value = NULL, value_normalized = NULL, value_encrypted = NULL, note = NULL, erased_at = now(), erasure_reason = 'richiesta_interessato' WHERE id = $1::uuid`,
    [answerId],
  );
  await assert.rejects(() => q(`UPDATE uc_answers SET erasure_reason = 'altro' WHERE id = $1::uuid`, [answerId]), /uc:sola_aggiunta/);
  const rows = await q(`SELECT value, erased_at FROM uc_answers WHERE id = $1::uuid`, [answerId]);
  assert.equal(rows[0].value, null);
  assert.ok(rows[0].erased_at);
});

test("answers and current answers stay inside their case and item", opts, async () => {
  await assert.rejects(() => insertAnswer(ids.item, ids.case2, 7, { text: "altro caso" }), /foreign key/i);
  const otherAnswer = await insertAnswer(ids.blocked, ids.case, 1, { text: "voce diversa" });
  await assert.rejects(() => q(`UPDATE uc_items SET current_answer_id = $1::uuid WHERE id = $2::uuid`, [otherAnswer, ids.item]), /foreign key/i);
});

test("personal values only encrypted, health values never", opts, async () => {
  await assert.rejects(() => insertAnswer(ids.personal, ids.case, 1, { text: "in chiaro" }), /uc:valore_personale_in_chiaro/);
  await insertAnswer(ids.personal, ids.case, 1, null, { encrypted: true });
  await assert.rejects(() => insertAnswer(ids.health, ids.case, 1, null, { encrypted: true }), /uc:valore_sanitario/);
});

test("events, validations and catalog versions are append-only", opts, async () => {
  const [event] = await exec!.batch([
    toStatement(ucSql`${eventInsertSql({ type: "caso.creato", workspaceId: ids.ws, caseId: ids.case, actor: { type: "sistema" }, payload: { items: 6 } })} RETURNING id`),
  ]);
  const eventId = event[0].id as string;
  await assert.rejects(() => q(`UPDATE uc_events SET payload = '{}' WHERE id = $1::uuid`, [eventId]), /uc:sola_aggiunta/);
  await assert.rejects(() => q(`DELETE FROM uc_events WHERE id = $1::uuid`, [eventId]), /uc:sola_aggiunta/);

  const [validation] = await q(
    `INSERT INTO uc_validations (case_id, item_id, check_key, kind, outcome, message) VALUES ($1::uuid, $2::uuid, 'tipo', 'automatica', 'ok', 'Va bene') RETURNING id`,
    [ids.case, ids.item],
  );
  await assert.rejects(() => q(`UPDATE uc_validations SET outcome = 'errore' WHERE id = $1::uuid`, [validation.id]), /uc:sola_aggiunta/);
  await assert.rejects(() => q(`DELETE FROM uc_validations WHERE id = $1::uuid`, [validation.id]), /uc:sola_aggiunta/);

  const [version] = await q(
    `INSERT INTO uc_catalog_versions (case_id, version, reason, diff, snapshot, snapshot_hash, approved_by) VALUES ($1::uuid, 1, 'gate', '{}', '{}', $2, '[]') RETURNING id`,
    [ids.case, hex64()],
  );
  await assert.rejects(() => q(`UPDATE uc_catalog_versions SET change_note = 'x' WHERE id = $1::uuid`, [version.id]), /uc:sola_aggiunta/);
  await assert.rejects(() => q(`DELETE FROM uc_catalog_versions WHERE id = $1::uuid`, [version.id]), /uc:sola_aggiunta/);
  await assert.rejects(
    () => q(`INSERT INTO uc_catalog_versions (case_id, version, reason, diff, snapshot, snapshot_hash, approved_by) VALUES ($1::uuid, 1, 'gate', '{}', '{}', $2, '[]')`, [ids.case, hex64()]),
    /unique|duplicate/i,
  );
});

test("rows of an active blocker cannot be deleted, rows of a resolved one can", opts, async () => {
  await q(
    `INSERT INTO uc_item_blockers (item_id, blocker_id, origin) VALUES ($1::uuid, $2::uuid, 'template'), ($1::uuid, $3::uuid, 'scope')`,
    [ids.blocked, ids.blockerActive, ids.blockerResolved],
  );
  await assert.rejects(() => q(`DELETE FROM uc_item_blockers WHERE item_id = $1::uuid AND blocker_id = $2::uuid`, [ids.blocked, ids.blockerActive]), /uc:blocco_attivo/);
  await q(`DELETE FROM uc_item_blockers WHERE item_id = $1::uuid AND blocker_id = $2::uuid`, [ids.blocked, ids.blockerResolved]);
  await assert.rejects(
    () => q(`INSERT INTO uc_blockers (workspace_id, case_id, key, label, status) VALUES ($1::uuid, $2::uuid, 'sanitario', 'Dati sanitari', 'attivo')`, [ids.ws, ids.case]),
    /uc_blockers_sanitario_permanent_chk/,
  );
});

test("a decided gate review is frozen, except the SET NULL cascade on its evidence file", opts, async () => {
  const [file] = await q(
    `INSERT INTO uc_files (workspace_id, case_id, file_name, privacy_class, max_size_bytes) VALUES ($1::uuid, $2::uuid, 'prova.csv', 'nessuna', 1000) RETURNING id`,
    [ids.ws, ids.case],
  );
  const [review] = await q(
    `INSERT INTO uc_gate_reviews (case_id, gate_key, computed, catalog_revision, summary_text_hash, written_evidence_file_id) VALUES ($1::uuid, 'G1', '{}', 0, $2, $3::uuid) RETURNING id`,
    [ids.case, hex64(), file.id],
  );
  await assert.rejects(
    () => q(`INSERT INTO uc_gate_reviews (case_id, gate_key, computed, catalog_revision, summary_text_hash) VALUES ($1::uuid, 'G1', '{}', 0, $2)`, [ids.case, hex64()]),
    /unique|duplicate/i,
    "only one open proposal per gate",
  );
  await q(`UPDATE uc_gate_reviews SET notes = 'in attesa' WHERE id = $1::uuid`, [review.id]);
  await q(`UPDATE uc_gate_reviews SET decision = 'approvato', decided_at = now() WHERE id = $1::uuid`, [review.id]);
  await assert.rejects(() => q(`UPDATE uc_gate_reviews SET notes = 'riscritta' WHERE id = $1::uuid`, [review.id]), /uc:gate_deciso_immutabile/);
  await q(`DELETE FROM uc_files WHERE id = $1::uuid`, [file.id]);
  const rows = await q(`SELECT written_evidence_file_id, decision FROM uc_gate_reviews WHERE id = $1::uuid`, [review.id]);
  assert.equal(rows[0].written_evidence_file_id, null);
  assert.equal(rows[0].decision, "approvato");
});

test("a published template is immutable and can only be retired once", opts, async () => {
  await q(`UPDATE uc_templates SET status = 'pubblicato', published_at = now() WHERE id = $1::uuid`, [ids.template]);
  await assert.rejects(() => q(`UPDATE uc_templates SET definition = '{"confidential": false, "x": 1}' WHERE id = $1::uuid`, [ids.template]), /uc:template_pubblicato_immutabile/);
  await assert.rejects(() => q(`UPDATE uc_templates SET status = 'bozza' WHERE id = $1::uuid`, [ids.template]), /uc:template_pubblicato_immutabile/);
  await q(`UPDATE uc_templates SET status = 'ritirato' WHERE id = $1::uuid`, [ids.template]);
  await assert.rejects(() => q(`UPDATE uc_templates SET status = 'pubblicato' WHERE id = $1::uuid`, [ids.template]), /uc:template_pubblicato_immutabile/);
  await assert.rejects(
    () => q(`INSERT INTO uc_templates (key, version, name, archetype, definition, definition_hash) VALUES ($1, '1.0.0', 'x', 'x', '{"confidential": true}', $2)`, [`prova.riservato_${suffix}`, hex64()]),
    /uc_templates_confidential_restricted_chk/,
  );
});

test("link predicates: draft never live, suspended visible read-only, closed never visible", opts, async () => {
  const insertRequest = async (status: string, expires: string | null, epoch: number) =>
    (
      await q(
        `INSERT INTO uc_requests (case_id, contact_id, share_epoch, status, expires_at, sent_at) VALUES ($1::uuid, $2::uuid, $3, $4, ${expires ?? "NULL"}, now()) RETURNING id`,
        [ids.case, ids.contact, epoch, status],
      )
    )[0].id as string;
  const live = await insertRequest("inviata", "now() + interval '30 days'", 0);
  const draft = await insertRequest("bozza", null, 0);
  await insertRequest("inviata", "now() - interval '1 hour'", 0);
  await insertRequest("aperta", "now() + interval '30 days'", 1);
  await assert.rejects(() => insertRequest("inviata", null, 0), /uc_requests_expiry_when_sent_chk/);

  const select = async (visible: boolean) => {
    const predicate = visible ? requestVisibleSql("r", "c") : requestLiveSql("r", "c");
    const s = toStatement(ucSql`SELECT r.id FROM uc_requests r JOIN uc_cases c ON c.id = r.case_id WHERE r.case_id = ${cast(ids.case, "uuid")} AND ${predicate}`);
    return (await q(s.text, [...s.params])).map((r) => r.id);
  };
  assert.deepEqual(await select(false), [live]);
  await q(`UPDATE uc_cases SET status = 'sospeso', status_before_suspension = 'raccolta' WHERE id = $1::uuid`, [ids.case]);
  assert.deepEqual(await select(false), []);
  assert.deepEqual(await select(true), [live]);
  await q(`UPDATE uc_cases SET status = 'chiuso', closed_reason = 'prova' WHERE id = $1::uuid`, [ids.case]);
  assert.deepEqual(await select(true), []);
  await q(`UPDATE uc_cases SET status = 'raccolta', status_before_suspension = NULL WHERE id = $1::uuid`, [ids.case]);

  // At most one active request per item.
  await q(`INSERT INTO uc_request_items (case_id, request_id, item_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`, [ids.case, live, ids.blocked]);
  await assert.rejects(() => q(`INSERT INTO uc_request_items (case_id, request_id, item_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`, [ids.case, draft, ids.blocked]), /unique|duplicate/i);
  await q(`INSERT INTO uc_request_items (case_id, request_id, item_id, state) VALUES ($1::uuid, $2::uuid, $3::uuid, 'riassegnata')`, [ids.case, draft, ids.blocked]);
  await assert.rejects(() => q(`INSERT INTO uc_request_items (case_id, request_id, item_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`, [ids.case2, live, ids.item2]), /foreign key/i);
});

// ── Self-heal separato (PIANO §2.5, D35) ─────────────────────────────

type EnsureModule = typeof import("../db/ensure-schema.ts");
type DbModule = typeof import("../db/index.ts");

/** Lets Node load the app modules (extensionless and `@/` imports) for this test only. */
function installAppResolver(): void {
  const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const srcUrl = pathToFileURL(srcRoot).href;
  type Resolve = (specifier: string, context: { parentURL?: string }) => unknown;
  const registerHooks = (nodeModule as unknown as { registerHooks?: (hooks: { resolve: (s: string, c: { parentURL?: string }, next: Resolve) => unknown }) => unknown }).registerHooks;
  if (!registerHooks) throw new Error("Node ≥ 22.15 is required (module.registerHooks)");
  registerHooks({
    resolve(specifier, context, next) {
      let target = specifier;
      if (target.startsWith("@/")) target = pathToFileURL(resolve(srcRoot, target.slice(2))).href;
      const local = target.startsWith(".") || target.startsWith(srcUrl);
      if (!local || !context.parentURL?.startsWith(srcUrl)) return next(target, context);
      try {
        return next(target, context);
      } catch (error) {
        for (const extra of [".ts", ".tsx", "/index.ts"]) {
          try {
            return next(target === "." ? `./index.ts` : `${target}${extra}`, context);
          } catch {
            /* try the next candidate */
          }
        }
        throw error;
      }
    },
  });
}

let app: { ensure: EnsureModule; db: DbModule } | null = null;
async function loadApp() {
  if (app) return app;
  process.env.DATABASE_URL = url;
  installAppResolver();
  const ensure = (await import("../db/ensure-schema.ts")) as EnsureModule;
  const db = (await import("../db/index.ts")) as DbModule;
  app = { ensure, db };
  return app;
}

test("a broken uc DDL fails only the uc self-heal; ensureDbSchema and existing queries stay green", opts, async () => {
  const { ensure, db } = await loadApp();
  await ensure.ensureDbSchema();
  const broken = ensure.createUcSchemaEnsurer({
    enabled: () => true,
    ensureBase: ensure.ensureDbSchema,
    probe: async () => ({ current: false, uniqueIndex: false }),
    apply: ensure.runUcOnce,
    ddl: ["SELECT this is not valid sql"],
    log: { warn: () => {}, error: () => {} },
  });
  await assert.rejects(() => broken.ensure(), /syntax/i);
  await ensure.ensureDbSchema();
  const rows = await db.db.execute(sqlTag`SELECT count(*)::int AS n FROM workspaces WHERE id = ${ids.ws}::uuid`);
  assert.equal((rows.rows[0] as { n: number }).n, 1);
  assert.equal(await ensure.ucSchemaLooksCurrent(), true, "the failed batch left nothing half-applied");

  const previous = process.env.UC_ENABLED;
  delete process.env.UC_ENABLED;
  await assert.rejects(() => ensure.ensureUcSchema(), (e: Error) => e.name === "UcSchemaDisabledError");
  process.env.UC_ENABLED = "true";
  await ensure.ensureUcSchema();
  if (previous === undefined) delete process.env.UC_ENABLED;
  else process.env.UC_ENABLED = previous;
});

test("with the uc self-heal off (flag off, or production) only the probe runs: a stale schema is refused until it is fixed by hand", opts, async () => {
  const { ensure } = await loadApp();
  let applied = 0;
  let base = 0;
  let state = { current: false, uniqueIndex: false };
  const offEnsurer = (duplicates: () => Promise<boolean>) => {
    const notices: string[] = [];
    const ensurer = ensure.createUcSchemaEnsurer({
      enabled: () => true,
      ensureBase: async () => {
        base++;
      },
      probe: async () => state,
      apply: async () => {
        applied++;
      },
      ddl: UC_DDL,
      selfHeal: () => false,
      duplicates,
      log: { warn: () => {}, error: () => {} },
      missingIndex: (code, op) => {
        notices.push(`${op}:${code}`);
      },
    });
    return { ensurer, notices };
  };
  const { ensurer: off } = offEnsurer(async () => false);
  await assert.rejects(() => off.ensure(), (e: Error) => e.name === "UcSchemaNotCurrentError" && (e as Error & { code?: string }).code === "schema_non_aggiornato");
  await assert.rejects(() => off.ensure(), /UC_SCHEMA_SELF_HEAL|non aggiornato/, "not memoized as a success, still refused");
  assert.equal(applied, 0, "the DDL never runs from a request");
  assert.equal(base, 0, "nor the app self-heal");
  // The migration is applied by hand: the next request goes through without a redeploy.
  state = { current: true, uniqueIndex: true };
  await off.ensure();
  assert.equal(applied, 0);

  // The 0018 applied by hand with a duplicate dossier skips the unique index: the section stays
  // available and the log names the remedy (dossier-dups, or the 0018 again once the duplicates are gone).
  state = { current: true, uniqueIndex: false };
  for (const [duplicates, expected] of [
    [async () => true, "sonda:doppioni_dossier"],
    [async () => false, "sonda:indice_unico_assente"],
    [async () => Promise.reject(new Error("lettura non riuscita")), "sonda:doppioni_dossier"],
  ] as const) {
    const { ensurer, notices } = offEnsurer(duplicates);
    await ensurer.ensure();
    await ensurer.ensure();
    assert.deepEqual(notices, [expected], "one line per cold start, the success is memoized");
  }
  assert.equal(applied, 0, "still no DDL from a request");
  assert.equal(base, 0);

  // The real wiring of ensureUcSchema (`selfHeal: () => ucSelfHealEnabled(process.env)`), on a fresh
  // copy of the module: the shared one has already memoized a success and would not read the flag.
  // A refusal is not memoized, so the same copy reads the variables again at each call.
  const wiring = `../db/ensure-schema.ts?wiring=${suffix}`;
  const fresh = (await import(wiring)) as EnsureModule;
  const previous = { flag: process.env.UC_ENABLED, heal: process.env.UC_SCHEMA_SELF_HEAL, vercel: process.env.VERCEL_ENV };
  const restore = (name: "UC_ENABLED" | "UC_SCHEMA_SELF_HEAL" | "VERCEL_ENV", value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  const notCurrent = (e: Error) => e.name === "UcSchemaNotCurrentError";
  process.env.UC_ENABLED = "true";
  try {
    // A stale schema: one vocabulary CHECK narrower than vocab.ts (NOT VALID, as in the drift test).
    await q(`ALTER TABLE uc_items DROP CONSTRAINT uc_items_status_chk`);
    await q(`ALTER TABLE uc_items ADD CONSTRAINT uc_items_status_chk CHECK (status IN ('da_chiedere', 'chiesta', 'validata')) NOT VALID`);
    assert.equal(await ensure.ucSchemaLooksCurrent(), false);

    process.env.UC_SCHEMA_SELF_HEAL = "off";
    delete process.env.VERCEL_ENV;
    await assert.rejects(() => fresh.ensureUcSchema(), notCurrent, "flag off: only the probe");
    assert.equal(await ensure.ucSchemaLooksCurrent(), false, "the DDL did not run");

    delete process.env.UC_SCHEMA_SELF_HEAL;
    process.env.VERCEL_ENV = "production";
    await assert.rejects(() => fresh.ensureUcSchema(), notCurrent, "production with the flag unset: only the probe");
    assert.equal(await ensure.ucSchemaLooksCurrent(), false, "the DDL did not run in production");

    delete process.env.VERCEL_ENV;
    await fresh.ensureUcSchema();
    assert.equal(await ensure.ucSchemaLooksCurrent(), true, "outside production with the flag unset the self-heal repairs");
  } finally {
    if (!(await ensure.ucSchemaLooksCurrent())) await ensure.runUcOnce();
    restore("UC_ENABLED", previous.flag);
    restore("UC_SCHEMA_SELF_HEAL", previous.heal);
    restore("VERCEL_ENV", previous.vercel);
  }
});

test("with the schema current and only the unique index missing, the self-heal applies only the index block, and a failure there keeps the section available", opts, async () => {
  const { ensure } = await loadApp();
  type State = { current: boolean; uniqueIndex: boolean };
  const run = async (states: State[], apply: (statements: readonly string[]) => Promise<void>) => {
    const applied: (readonly string[])[] = [];
    const notices: string[] = [];
    let base = 0;
    let probes = 0;
    const ensurer = ensure.createUcSchemaEnsurer({
      enabled: () => true,
      ensureBase: async () => {
        base++;
      },
      probe: async () => states[Math.min(probes++, states.length - 1)],
      apply: async (statements) => {
        applied.push(statements);
        await apply(statements);
      },
      ddl: UC_DDL,
      duplicates: async () => true,
      log: { warn: () => {}, error: () => {} },
      missingIndex: (code, op) => {
        notices.push(`${op}:${code}`);
      },
      indexFailed: (err) => {
        notices.push(`indexFailed:${(err as Error).message}`);
      },
    });
    await ensurer.ensure();
    await ensurer.ensure();
    return { applied, notices, base };
  };
  const missing = { current: true, uniqueIndex: false };

  // The duplicate is still there: only the guarded index block runs, never the ~150 statements that
  // lock every uc table, and the log names the remedy once per cold start.
  const skipped = await run([missing, missing], async () => {});
  assert.deepEqual(skipped.applied, [[UC_UNIQUE_DOSSIER_INDEX_DDL]]);
  assert.deepEqual(skipped.notices, ["self_heal:doppioni_dossier"]);
  assert.equal(skipped.base, 1);

  // The duplicate is gone: the same block creates the index, silently.
  const created = await run([missing, { current: true, uniqueIndex: true }], async () => {});
  assert.deepEqual(created.applied, [[UC_UNIQUE_DOSSIER_INDEX_DDL]]);
  assert.deepEqual(created.notices, []);

  // The block fails (lock, deadlock, network): the schema is current, so the section stays available,
  // the success is memoized and the log says both what failed and what is missing.
  const failed = await run([missing], async () => {
    throw new Error("deadlock detected");
  });
  assert.deepEqual(failed.applied, [[UC_UNIQUE_DOSSIER_INDEX_DDL]]);
  assert.deepEqual(failed.notices, ["indexFailed:deadlock detected", "self_heal:doppioni_dossier"]);

  // A stale schema still gets the whole DDL, and a failure there still refuses the section.
  const stale = await run([{ current: false, uniqueIndex: false }, missing], async () => {});
  assert.deepEqual(stale.applied, [UC_DDL]);
  assert.deepEqual(stale.notices, ["self_heal:doppioni_dossier"]);
  await assert.rejects(
    () => run([{ current: false, uniqueIndex: false }], async () => Promise.reject(new Error("ddl rotto"))),
    /ddl rotto/,
  );
});

test("vocabulary drift is detected by the probe and healed with NOT VALID + VALIDATE", opts, async () => {
  const { ensure } = await loadApp();
  await q(`ALTER TABLE uc_items DROP CONSTRAINT uc_items_status_chk`);
  // NOT VALID: the shared harness may hold rows in other states.
  await q(`ALTER TABLE uc_items ADD CONSTRAINT uc_items_status_chk CHECK (status IN ('da_chiedere', 'chiesta', 'validata')) NOT VALID`);
  assert.equal(await ensure.ucSchemaLooksCurrent(), false);
  const healer = ensure.createUcSchemaEnsurer({
    enabled: () => true,
    ensureBase: ensure.ensureDbSchema,
    probe: ensure.ucSchemaState,
    apply: ensure.runUcOnce,
    ddl: UC_DDL,
  });
  await healer.ensure();
  assert.equal(await ensure.ucSchemaLooksCurrent(), true);
  const rows = await q(`SELECT convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'uc_items_status_chk'`);
  assert.equal(rows[0].convalidated, true);
  assert.match(rows[0].def as string, /non_applicabile/);
});

test("uc self-heal with a duplicate dossier: the unique index is skipped, the section stays available (self-heal on and off) and the log says so; without duplicates the index is created", opts, async () => {
  const { ensure } = await loadApp();
  assert.equal((await uniqueDossierIndex()).present, true);
  const [card] = await q(`INSERT INTO use_cases (workspace_id, title) VALUES ($1::uuid, 'Scheda con due dossier') RETURNING id`, [ids.ws]);
  const dossier = { complete: randomUUID(), incomplete: randomUUID(), third: randomUUID() };
  const insertDossier = (id: string, code: string, complete: boolean) =>
    q(
      `INSERT INTO uc_cases (id, workspace_id, organization_id, template_id, template_version, code, title, portfolio_use_case_id, setup_completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, '1.0.0', $5, 'Dossier sulla stessa scheda', $6::uuid, ${complete ? "now()" : "NULL"})`,
      [id, ids.ws, ids.org, ids.template, `${code}-${suffix.toUpperCase()}`, card.id],
    );
  const duplicate = /unique|duplicate/i;

  // With the index, a second dossier on the same card is refused, even an incomplete one.
  await insertDossier(dossier.complete, "DUP1", true);
  await assert.rejects(() => insertDossier(dossier.incomplete, "DUP2", false), duplicate);

  // A database where the duplicate came first: no index yet, a complete and an incomplete row on one card.
  await q(`DROP INDEX ${UC_UNIQUE_DOSSIER_INDEX}`);
  await insertDossier(dossier.incomplete, "DUP2", false);
  assert.deepEqual(await ensure.ucSchemaState(), { current: true, uniqueIndex: false }, "the probe sees the missing index apart from the schema");
  assert.equal(await ensure.ucSchemaLooksCurrent(), false, "the self-heal still has the index to do");

  // Real wiring of ensureUcSchema, on fresh copies of the module: each copy is a cold start with its
  // own memoized promise. The self-heal is on outside production and off in production.
  const previous = { flag: process.env.UC_ENABLED, heal: process.env.UC_SCHEMA_SELF_HEAL, vercel: process.env.VERCEL_ENV };
  const restore = (name: "UC_ENABLED" | "UC_SCHEMA_SELF_HEAL" | "VERCEL_ENV", value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  const coldStart = async (label: string) => {
    const fresh = (await import(`../db/ensure-schema.ts?${label}=${suffix}`)) as EnsureModule;
    const lines: string[] = [];
    const { warn, error } = console;
    console.warn = console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      await fresh.ensureUcSchema();
      await fresh.ensureUcSchema();
    } finally {
      console.warn = warn;
      console.error = error;
    }
    const logged = lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    return logged.filter((l) => l.area === "uc.schema").map((l) => `${l.level}:${l.op}:${l.code}`);
  };
  const production = (on: boolean) => {
    delete process.env.UC_SCHEMA_SELF_HEAL;
    if (on) process.env.VERCEL_ENV = "production";
    else delete process.env.VERCEL_ENV;
  };
  process.env.UC_ENABLED = "true";
  try {
    // Production (self-heal off): the 0018 was applied by hand while the duplicate existed. The
    // section is served, not refused with a 503, and the log names the remedy.
    production(true);
    assert.deepEqual(await coldStart("production-duplicate"), ["warn:sonda:doppioni_dossier"]);
    assert.equal((await uniqueDossierIndex()).present, false, "no DDL from a request in production");

    // Self-heal on, upgrade path: a database on the old 0018 (older marker) that already holds the
    // duplicate. The whole DDL runs, skips the index instead of failing, commits the rest (the new
    // marker) and the log says why. The post-DDL warning is only for a schema the DDL did not fix.
    production(false);
    const markerOf = async () =>
      (await q(`SELECT obj_description(to_regprocedure('public.uc_require(boolean,text)'), 'pg_proc') AS marker`))[0].marker;
    await q(`COMMENT ON FUNCTION uc_require(boolean, text) IS 'uc-ddl:stale'`);
    assert.deepEqual(await ensure.ucSchemaState(), { current: false, uniqueIndex: false }, "an old 0018: stale schema, no index");
    const withDuplicate = await coldStart("duplicate");
    assert.deepEqual(withDuplicate, ["warn:self_heal:doppioni_dossier"]);
    assert.equal((await uniqueDossierIndex()).present, false, "the DDL skipped the index instead of failing");
    assert.equal(await markerOf(), UC_DDL_MARKER, "the rest of the DDL was committed");
    assert.deepEqual(await ensure.ucSchemaState(), { current: true, uniqueIndex: false }, "only the index is missing while the duplicate exists");
    const rows = await q(`SELECT count(*)::int AS n FROM uc_cases WHERE portfolio_use_case_id = $1::uuid`, [card.id]);
    assert.equal(rows[0].n, 2);

    // Next cold start, schema current and the duplicate still there: only the index block runs, not
    // the whole DDL. A plain uc index the probe does not look at, dropped here, stays dropped.
    const plainIndex = "uc_rate_limits_window_idx";
    const plainIndexDdl = UC_DDL.find((s) => s.startsWith(`CREATE INDEX IF NOT EXISTS ${plainIndex} `));
    assert.ok(plainIndexDdl, plainIndex);
    await q(`DROP INDEX ${plainIndex}`);
    try {
      assert.deepEqual(await coldStart("duplicate-again"), ["warn:self_heal:doppioni_dossier"]);
      const plain = await q(`SELECT to_regclass($1) IS NOT NULL AS present`, [`public.${plainIndex}`]);
      assert.equal(plain[0].present, false, "the whole DDL did not run again");
      assert.deepEqual(await ensure.ucSchemaState(), { current: true, uniqueIndex: false });
    } finally {
      await q(plainIndexDdl);
    }

    // After dossier-dups (here: the incomplete row deleted). In production the index waits for the
    // 0018 applied again, and the log says that; the section is still served.
    await q(`DELETE FROM uc_cases WHERE id = $1::uuid`, [dossier.incomplete]);
    production(true);
    assert.deepEqual(await coldStart("production-healed"), ["warn:sonda:indice_unico_assente"]);
    assert.equal((await uniqueDossierIndex()).present, false);

    // With the self-heal on, the next cold start creates the index (the index block alone), silently.
    production(false);
    const healed = await coldStart("healed");
    assert.deepEqual(healed, []);
    const index = await uniqueDossierIndex();
    assert.equal(index.present && index.unique, true);
    assert.equal(await ensure.ucSchemaLooksCurrent(), true);
    await assert.rejects(() => insertDossier(dossier.third, "DUP3", true), duplicate);
  } finally {
    await q(`DELETE FROM uc_cases WHERE portfolio_use_case_id = $1::uuid`, [card.id]);
    await q(`DELETE FROM use_cases WHERE id = $1::uuid`, [card.id]);
    if (!(await ensure.ucSchemaLooksCurrent())) await ensure.runUcOnce();
    restore("UC_ENABLED", previous.flag);
    restore("UC_SCHEMA_SELF_HEAL", previous.heal);
    restore("VERCEL_ENV", previous.vercel);
  }
});

test("deleting a case keeps its audit; deleting the workspace cascades through append-only tables", opts, async () => {
  await insertAnswer(ids.item2, ids.case2, 1, { text: "secondo caso" });
  await exec!.batch([toStatement(eventInsertSql({ type: "caso.creato", workspaceId: ids.ws2, caseId: ids.case2, actor: { type: "sistema" } }))]);
  await q(
    `INSERT INTO uc_catalog_versions (case_id, version, reason, diff, snapshot, snapshot_hash, approved_by) VALUES ($1::uuid, 1, 'gate', '{}', '{}', $2, '[]')`,
    [ids.case2, hex64()],
  );
  await q(`DELETE FROM uc_cases WHERE id = $1::uuid`, [ids.case2]);
  const kept = await q(`SELECT count(*)::int AS n FROM uc_events WHERE case_id = $1::uuid`, [ids.case2]);
  assert.equal(kept[0].n, 1, "the audit survives the case");

  // Every deferred NO ACTION reference inside the workspace: request → contact,
  // answer → request/contact, validation → answer/dataset, version → gate review, run → version.
  const [request] = await q(
    `INSERT INTO uc_requests (case_id, contact_id, share_epoch, status, expires_at, sent_at) VALUES ($1::uuid, $2::uuid, 0, 'inviata', now() + interval '1 day', now()) RETURNING id`,
    [ids.case, ids.contact],
  );
  const [answer] = await q(
    `INSERT INTO uc_answers (case_id, item_id, version, kind, value, source_kind, responder_contact_id, request_id)
     VALUES ($1::uuid, $2::uuid, 2, 'valore', '{"text":"x"}', 'referente', $3::uuid, $4::uuid) RETURNING id`,
    [ids.case, ids.blocked, ids.contact, request.id],
  );
  const [dataset] = await q(
    `INSERT INTO uc_datasets (case_id, source_key, dataset_version, data_controller_label) VALUES ($1::uuid, 'src.prova.estrazione', 1, 'da indicare') RETURNING id`,
    [ids.case],
  );
  await q(
    `INSERT INTO uc_validations (case_id, item_id, answer_id, dataset_id, check_key, kind, outcome, message) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'dq.prova', 'automatica', 'avviso', 'Da controllare')`,
    [ids.case, ids.blocked, answer.id, dataset.id],
  );
  const [review] = await q(
    `INSERT INTO uc_gate_reviews (case_id, gate_key, computed, catalog_revision, summary_text_hash, decision) VALUES ($1::uuid, 'G1', '{}', 0, $2, 'approvato') RETURNING id`,
    [ids.case, hex64()],
  );
  await q(
    `INSERT INTO uc_catalog_versions (case_id, version, reason, gate_review_id, diff, snapshot, snapshot_hash, approved_by) VALUES ($1::uuid, 2, 'gate', $2::uuid, '{}', '{}', $3, '[]')`,
    [ids.case, review.id, hex64()],
  );
  await q(`INSERT INTO uc_model_runs (case_id, kind, catalog_version, recorded_by) VALUES ($1::uuid, 'casi_prova', 2, 'utente')`, [ids.case]);
  await assert.rejects(() => q(`DELETE FROM uc_contacts WHERE id = $1::uuid`, [ids.contact]), /foreign key/i, "a contact with requests is not deleted directly");

  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  for (const table of ["uc_answers", "uc_validations", "uc_catalog_versions", "uc_items", "uc_item_blockers"]) {
    const column = table === "uc_item_blockers" ? "item_id" : "case_id";
    const value = table === "uc_item_blockers" ? ids.blocked : ids.case;
    const rows = await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1::uuid`, [value]);
    assert.equal(rows[0].n, 0, table);
  }
  const events = await q(`SELECT count(*)::int AS n FROM uc_events WHERE workspace_id = $1::uuid`, [ids.ws]);
  assert.equal(events[0].n, 0);
  const template = await q(`SELECT count(*)::int AS n FROM uc_templates WHERE id = $1::uuid`, [ids.template]);
  assert.equal(template[0].n, 0, "the restricted template goes with its workspace");
});

