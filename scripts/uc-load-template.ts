#!/usr/bin/env node
/**
 * Carica un template canonico in `uc_templates` (PIANO §4.3).
 *
 *   node --no-warnings scripts/uc-load-template.ts --file templates/uc/<key>/<version>.json
 *        [--publish] [--restrict-workspace <uuid>]
 *        [--apply --confirm-authorized --confirm-database host[:port]/db
 *         --environment local|preview|production [--production-approved] --actor <userId>]
 *   env: UC_ADMIN_DATABASE_URL   (mai .env né DATABASE_URL)
 *
 * - Dry run di default: valida, calcola `definition_hash`, stampa chiave,
 *   versione, impronta e conteggi. Nessun accesso al database.
 * - Un template `confidential` senza `--restrict-workspace` si rifiuta già nel dry run.
 * - `--apply`: idempotente. Stessa versione con la stessa impronta → `ALREADY_LOADED`
 *   (uscita 0, nessuna scrittura); impronta diversa → errore.
 * - `--publish`: stato `pubblicato` (da quel momento il template è immutabile).
 */
import { readFileSync, statSync } from "node:fs";
import { applyTemplateLoad } from "../src/lib/db/queries/uc-templates.ts";
import { ucExecutorForUrl } from "../src/lib/db/uc-executor.ts";
import { planSummary, planTemplateLoad } from "../src/lib/uc/template/load.ts";
import { TEMPLATE_LIMITS } from "../src/lib/uc/template/schema.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function fail(code: string, message: string, extra: Record<string, unknown> = {}): never {
  console.error(JSON.stringify({ status: "ERROR", code, message, ...extra }, null, 2));
  process.exit(1);
}

const args = process.argv.slice(2);
const values = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!key.startsWith("--") || values.has(key)) fail("opzioni", `Opzione non valida o ripetuta: ${key}`);
  values.set(key, args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true");
}
const KNOWN = new Set([
  "--file",
  "--publish",
  "--restrict-workspace",
  "--apply",
  "--confirm-authorized",
  "--confirm-database",
  "--environment",
  "--production-approved",
  "--actor",
]);
for (const key of values.keys()) if (!KNOWN.has(key)) fail("opzioni", `Opzione sconosciuta: ${key}`);
const flag = (key: string) => values.get(`--${key}`) === "true";
const option = (key: string): string | null => {
  const v = values.get(`--${key}`);
  if (v === undefined) return null;
  if (v === "true") fail("opzioni", `Manca il valore di --${key}`);
  return v;
};

const file = option("file");
if (!file) fail("opzioni", "Indica il template con --file templates/uc/<key>/<version>.json.");
const restrict = option("restrict-workspace");
if (restrict !== null && !UUID.test(restrict)) fail("opzioni", "--restrict-workspace deve essere l'id (uuid) di un workspace.");
const publish = flag("publish");
const apply = flag("apply");

// 1. Lettura e validazione stretta (anche nel dry run).
function readTemplateFile(path: string): string {
  try {
    if (statSync(path).size > TEMPLATE_LIMITS.maxBytes) fail("file_troppo_grande", "Il file supera 8 MB.");
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error) fail("file_non_leggibile", `Non riesco a leggere il file (${String(error.code)}).`);
    throw error;
  }
}
const planned = planTemplateLoad(readTemplateFile(file), { restrictToWorkspaceId: restrict, filePath: file });
if (!planned.ok) fail(planned.code, planned.message, planned.errors.length ? { errors: planned.errors.slice(0, 50) } : {});
const plan = planned.plan;
const summary = { ...planSummary(plan), publish };

if (!apply) {
  console.log(JSON.stringify({ status: "DRY_RUN_NO_DATABASE_ACCESS", ...summary }, null, 2));
  process.exit(0);
}

// 2. Apply: solo con conferme esplicite e URL del database passato a mano.
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
if (environment !== "local" && environment !== "preview" && environment !== "production") {
  fail("ambiente", "--environment deve essere local, preview o production.");
}
if (environment === "local" && !LOOPBACK.has(target.hostname)) fail("ambiente", "--environment local accetta solo un database su loopback.");
if (environment !== "local" && LOOPBACK.has(target.hostname)) fail("ambiente", "Un database su loopback si usa solo con --environment local.");
if (environment === "production" && !flag("production-approved")) fail("ambiente", "In produzione serve l'approvazione esplicita: --production-approved.");
const actor = option("actor");
if (!actor || !UUID.test(actor)) fail("opzioni", "--apply richiede --actor <id utente>.");

const result = await applyTemplateLoad(ucExecutorForUrl(databaseUrl), plan, { actorUserId: actor, publish });
if (!result.ok) fail(result.code, result.message, { key: plan.key, version: plan.version, hash: plan.hash });
console.log(
  JSON.stringify(
    {
      status: result.value.status,
      template_id: result.value.templateId,
      template_status: result.value.templateStatus,
      environment,
      database: fingerprint,
      ...summary,
    },
    null,
    2,
  ),
);
