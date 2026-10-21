// End-to-end acceptance for Casi d'uso on the isolated harness (PIANO §9.2, steps 1–11;
// DESIGN §8.3 WP13).
//
//   UC_TEST_ROOT=/private/tmp/<dir> node --no-warnings scripts/uc-test/acceptance.mjs
//
// The database checks run first; the journey needs the harness app (start-app.mjs), the
// Auth emulator, the login helper and the synthetic fixtures (seed-fixtures.mjs). Without
// the app the journey is reported as PENDING. Each part works on throw-away synthetic
// workspaces and removes them: steps 3–4 (acceptance-referente.mjs), 8 (acceptance-firme.mjs)
// and 1, 2, 5, 6, 7, 9, 10, 11.isolation on one dossier started from the browser
// (acceptance-collaudo.mjs). It talks only to 127.0.0.1 (app 53110, login 53112, DB 55449).
// Results and screens are saved under UC_TEST_ROOT/uc-evidence, never in Git. Exit code 1
// on any FAIL.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UC_TEST_APP_PORT, UC_TEST_DB, UC_TEST_HOST, UC_TEST_PORT, UC_TEST_USER, ucTestRoot } from "./config.mjs";
import { referentFixture, step3, step4 } from "./acceptance-referente.mjs";
import { step8 } from "./acceptance-firme.mjs";
import { collaudoFixture, step1, step10, step11, step2, step5, step6, step7, step9 } from "./acceptance-collaudo.mjs";

const requireFromApp = createRequire(resolve("package.json"));
const { Client } = requireFromApp("pg");
const root = ucTestRoot();
const app = `http://${UC_TEST_HOST}:${UC_TEST_APP_PORT}`;
const fixturesPath = join(root, "uc-fixtures", "synthetic-fixtures.json");
const fixtures = existsSync(fixturesPath) ? JSON.parse(readFileSync(fixturesPath, "utf8")) : null;

const results = [];
async function step(id, title, run) {
  if (!run) {
    results.push({ id, title, outcome: "PENDING" });
    return;
  }
  try {
    const note = await run();
    results.push({ id, title, outcome: "PASS", note: note ?? null });
  } catch (error) {
    results.push({ id, title, outcome: "FAIL", note: error instanceof Error ? error.message : String(error) });
  }
}

const db = new Client({ host: UC_TEST_HOST, port: UC_TEST_PORT, user: UC_TEST_USER, database: UC_TEST_DB });
await db.connect();

async function expectError(sqlText, params, pattern) {
  await db.query("SAVEPOINT uc_expect");
  try {
    await db.query(sqlText, params);
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT uc_expect");
    if (!pattern.test(error.message)) throw new Error(`unexpected error: ${error.message}`);
    return;
  }
  throw new Error(`statement succeeded but should fail: ${sqlText.slice(0, 60)}`);
}

try {
  // ── Database (runs now) ───────────────────────────────────────────
  await step("0.schema", "Le 28 tabelle uc esistono e il probe del self-heal è vero", async () => {
    const { UC_PROBE_SQL, UC_TABLE_NAMES } = await import("../../src/lib/uc/ddl.ts");
    const tables = await db.query("SELECT count(*)::int AS n FROM unnest($1::text[]) t(name) WHERE to_regclass('public.' || t.name) IS NOT NULL", [UC_TABLE_NAMES]);
    if (tables.rows[0].n !== UC_TABLE_NAMES.length) throw new Error(`${tables.rows[0].n} tables`);
    const probe = await db.query(UC_PROBE_SQL);
    if (probe.rows[0].current !== true) throw new Error("probe false");
    return `${UC_TABLE_NAMES.length} tabelle, probe vero`;
  });

  await step("11.append_only", "UPDATE e DELETE diretti su uc_answers falliscono (dati sintetici, transazione annullata)", async () => {
    await db.query("BEGIN");
    try {
      const ids = { org: randomUUID(), ws: randomUUID(), tpl: randomUUID(), case: randomUUID(), item: randomUUID() };
      await db.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Acceptance', $2)", [ids.org, `uc-acc-${ids.org}`]);
      await db.query("INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Acceptance')", [ids.ws, ids.org]);
      await db.query(
        "INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id) VALUES ($1, 'prova.acceptance', '1.0.0', 'x', 'x', '{}', repeat('0', 64), $2)",
        [ids.tpl, ids.ws],
      );
      await db.query(
        "INSERT INTO uc_cases (id, workspace_id, organization_id, template_id, template_version, code, title, setup_completed_at) VALUES ($1, $2, $3, $4, '1.0.0', 'ACC-1', 'Acceptance', now())",
        [ids.case, ids.ws, ids.org, ids.tpl],
      );
      await db.query("INSERT INTO uc_items (id, case_id, key, kind, section, title) VALUES ($1, $2, 'q.acc.01', 'domanda', 'modello_dati', 'Domanda')", [ids.item, ids.case]);
      const answer = await db.query(
        "INSERT INTO uc_answers (case_id, item_id, version, kind, value, source_kind) VALUES ($1, $2, 1, 'valore', '{\"text\":\"x\"}', 'referente') RETURNING id",
        [ids.case, ids.item],
      );
      await expectError("UPDATE uc_answers SET note = 'x' WHERE id = $1", [answer.rows[0].id], /uc:sola_aggiunta/);
      await expectError("DELETE FROM uc_answers WHERE id = $1", [answer.rows[0].id], /uc:sola_aggiunta/);
    } finally {
      await db.query("ROLLBACK");
    }
    return "uc:sola_aggiunta su UPDATE e DELETE";
  });

  // ── App (runs only if the harness app answers) ────────────────────
  const appUp = await fetch(`${app}/login`, { redirect: "manual" }).then((r) => r.status < 500, () => false);
  await step("0.app", "L'app del harness risponde su 127.0.0.1:53110", appUp ? async () => "ok" : null);
  await step("0.fixtures", "Dati sintetici presenti (seed-fixtures.mjs)", fixtures ? async () => `${Object.keys(fixtures.accounts).length} account` : null);

  // ── Journey (PIANO §9.2 «Percorso E2E») ───────────────────────────
  // Steps 1, 2, 5, 6, 7, 9, 10 and 11.isolation (WP13): one dossier started from the browser
  // in a throw-away synthetic workspace, removed at the end (acceptance-collaudo.mjs).
  const journey = appUp && fixtures;
  let collaudo = null;
  let collaudoError = null;
  if (journey) {
    try {
      collaudo = await collaudoFixture(db, fixtures);
    } catch (error) {
      collaudoError = error instanceof Error ? error.message : String(error);
    }
  }
  /** A step of the collaudo dossier: PENDING without the app, FAIL if its workspace could not be prepared. */
  const onCollaudo = (run) => (!journey ? null : collaudo ? () => run(collaudo) : async () => Promise.reject(new Error(`workspace di prova non pronto: ${collaudoError}`)));
  try {
    await step("1", "Creazione del caso dal template d'esempio: «Avvia la realizzazione» dallo use case, nel browser (WP10/WP13)", onCollaudo(step1));
    await step("2", "Referenti, assegnazione per ruolo, invio «in coda, email non configurata», «Copia link», revoca → da_chiedere (WP6/WP13)", onCollaudo(step2));
    // Steps 3 and 4 (WP8): a throw-away synthetic referent case, removed right after (acceptance-referente.mjs).
    let referent = null;
    await step("3", "Link a 400 px: nessuno scorrimento orizzontale, tema chiaro, noindex (WP8)", appUp ? async () => step3((referent = await referentFixture(db))) : null);
    await step("4", "Risposte tipizzate, tabella da Excel, allegato, «Non lo so», delega, «Non si applica», conferma del dichiarato (WP8)", referent ? () => step4(referent) : null);
    await referent?.cleanup();
    await step("5", "Validazione da un utente LS diverso da chi ha risposto; chi ha risposto non può (WP3/WP13)", onCollaudo(step5));
    await step("6", "Firma A.8 a due firme (la seconda su /firme) e sblocco automatico (WP9/WP13)", onCollaudo(step6));
    await step("7", "CSV e PDF con «visita medica» rifiutati e cancellati, con evento (WP3/WP13)", onCollaudo(step7));
    // Step 8 (WP9): a throw-away synthetic workspace, the via signed on /firme by owner-cliente (acceptance-firme.mjs).
    await step("8", "G1 da chiuso a pronto, proposta, approvazione owner_cliente su /firme, catalogo v1; @ls.test non firma come cliente (WP9)", appUp && fixtures ? () => step8(db, fixtures) : null);
    await step("9", "Export JSON, Markdown ed Excel della v1 (WP7/WP13)", onCollaudo(step9));
    await step("10", "MCP: solo voci validate o non applicabili della v1 (WP11/WP13)", onCollaudo(step10));
    await step("11.isolation", "Utente estraneo 404; link revocato o scaduto → scheda generica (WP8/WP13)", onCollaudo(step11));
  } finally {
    await collaudo?.cleanup().catch(() => undefined);
  }
} finally {
  await db.end();
}

const counts = results.reduce((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
for (const r of results) console.log(`${r.outcome.padEnd(7)} ${r.id.padEnd(14)} ${r.title}${r.note ? ` — ${r.note}` : ""}`);
console.log(`\nPASS ${counts.PASS ?? 0} · FAIL ${counts.FAIL ?? 0} · PENDING ${counts.PENDING ?? 0}`);
const evidence = join(root, "uc-evidence");
mkdirSync(evidence, { recursive: true });
writeFileSync(join(evidence, `acceptance-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify({ results, counts }, null, 2));
process.exit(counts.FAIL ? 1 : 0);
