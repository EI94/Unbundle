#!/usr/bin/env node
/**
 * Totali dei conti già salvati (DESIGN §3.8, WP5; `docs/use-case/DESIGN.md`
 * §10.10). Una tantum: prima di WP5 il salvataggio del conto scriveva solo le
 * righe, e le colonne `implementation_cost`, `annual_run_cost`,
 * `annual_benefit`, `break_even_months`, `value_5y` di `uc_roi_models` erano
 * vuote. Da WP5 le scrive `saveCaseRoi` a ogni salvataggio; questo script le
 * calcola con la stessa funzione (`roiTotals`) per i modelli che le hanno
 * diverse dalle righe, di ogni caso e scenario. Non tocca le righe né
 * `updated_at`. Si può ripetere: la seconda volta non trova nulla.
 *
 * Stesso modello di `scripts/uc-case-admin.ts`: dry run di default senza
 * accesso al database; con `--apply` legge il piano e lo stampa, e scrive solo
 * se `--confirm-models` è il numero di modelli del piano. URL del database
 * passato a mano (mai `.env`, mai `DATABASE_URL`).
 *
 *   node --no-warnings scripts/uc-roi-totals.ts
 *   node --no-warnings scripts/uc-roi-totals.ts --apply --confirm-authorized --confirm-database host[:port]/db \
 *        --environment local|preview|production [--production-approved] [--confirm-models <n>]
 *   env: UC_ADMIN_DATABASE_URL
 *
 * Stampa solo conteggi e id dei modelli: mai righe del conto né importi.
 */
import { applyRoiTotals, planRoiTotals } from "../src/lib/db/queries/uc-value.ts";
import { ucExecutorForUrl } from "../src/lib/db/uc-executor.ts";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const OPTIONS = ["--apply", "--confirm-authorized", "--confirm-database", "--environment", "--production-approved", "--confirm-models"];

function fail(code: string, message: string, extra: Record<string, unknown> = {}): never {
  console.error(JSON.stringify({ status: "ERROR", code, message, ...extra }, null, 2));
  process.exit(1);
}

const args = process.argv.slice(2);
const values = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!key.startsWith("--") || values.has(key) || !OPTIONS.includes(key)) fail("opzioni", `Opzione non valida, sconosciuta o ripetuta: ${key}`);
  values.set(key, args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true");
}
const flag = (key: string) => values.get(`--${key}`) === "true";
const option = (key: string): string | null => {
  const v = values.get(`--${key}`);
  if (v === undefined) return null;
  if (v === "true") fail("opzioni", `Manca il valore di --${key}`);
  return v;
};

const confirmModels = option("confirm-models");
if (confirmModels !== null && !/^\d{1,9}$/.test(confirmModels)) fail("opzioni", "--confirm-models è il numero di modelli letto nel piano.");

if (!flag("apply")) {
  console.log(
    JSON.stringify(
      {
        status: "DRY_RUN_NO_DATABASE_ACCESS",
        command: "roi-totals",
        does: "ricalcola i totali di uc_roi_models dalle righe salvate, dove sono diversi",
        next: "ripeti con --apply e le conferme per leggere il piano; poi con --confirm-models <n> per scrivere",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!flag("confirm-authorized")) fail("conferma", "--apply richiede --confirm-authorized dell'operatore responsabile.");
const databaseUrl = process.env.UC_ADMIN_DATABASE_URL;
if (!databaseUrl) fail("database", "Imposta UC_ADMIN_DATABASE_URL a mano: lo script non legge .env né DATABASE_URL.");
let target: URL;
try {
  target = new URL(databaseUrl);
} catch {
  fail("database", "UC_ADMIN_DATABASE_URL non è un URL valido.");
}
const fingerprint = `${target.hostname}${target.port ? `:${target.port}` : ""}${target.pathname}`;
if (option("confirm-database") !== fingerprint) fail("database", "--confirm-database deve essere esattamente host[:porta]/database dell'URL.");
const environment = option("environment");
if (environment !== "local" && environment !== "preview" && environment !== "production") fail("ambiente", "--environment deve essere local, preview o production.");
if (environment === "local" && !LOOPBACK.has(target.hostname)) fail("ambiente", "--environment local accetta solo un database su loopback.");
if (environment !== "local" && LOOPBACK.has(target.hostname)) fail("ambiente", "Un database su loopback si usa solo con --environment local.");
if (environment === "production" && !flag("production-approved")) fail("ambiente", "In produzione serve l'approvazione esplicita: --production-approved.");

const executor = ucExecutorForUrl(databaseUrl);
const plan = await planRoiTotals(executor);
const summary = {
  environment,
  database: fingerprint,
  modelsRead: plan.models,
  modelsToUpdate: plan.changes.length,
  becomeComputed: plan.changes.filter((c) => c.after.implementationCost !== null).length,
  becomeEmpty: plan.changes.filter((c) => c.after.implementationCost === null).length,
  cases: new Set(plan.changes.map((c) => c.caseId)).size,
  sampleModelIds: plan.changes.slice(0, 20).map((c) => c.id),
};
if (confirmModels === null || Number(confirmModels) !== plan.changes.length) {
  console.log(JSON.stringify({ status: "PLAN_ONLY", ...summary }, null, 2));
  if (plan.changes.length === 0) process.exit(0);
  fail("conferma", `Per scrivere i totali ripeti il comando con --confirm-models ${plan.changes.length}.`);
}
const result = await applyRoiTotals(executor, plan.changes);
console.log(JSON.stringify({ status: result.skipped.length ? "APPLIED_WITH_SKIPS" : "APPLIED", ...summary, updated: result.updated, skippedChangedMeanwhile: result.skipped }, null, 2));
process.exit(result.skipped.length ? 1 : 0);
