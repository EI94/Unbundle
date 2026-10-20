#!/usr/bin/env node
/**
 * Comandi dell'operatore sui casi d'uso (PIANO §3.3, §3.6, §12-a4; DESIGN §7.1
 * P0-8). Stesso modello di `scripts/learning-admin.ts` e
 * `scripts/uc-load-template.ts`: dry run di default senza accesso al database,
 * `--apply` solo con conferme esplicite e URL del database passato a mano (mai
 * `.env`, mai `DATABASE_URL`).
 *
 *   node --no-warnings scripts/uc-case-admin.ts confirm-gate-policy --case <uuid> --scope request_modules|letterale|unione [--note "…"] --actor <userId>
 *   node --no-warnings scripts/uc-case-admin.ts set-ai-environment --case <uuid> --approved true|false --evidence-file <fileId> --actor <userId>
 *   node --no-warnings scripts/uc-case-admin.ts set-ai-processing --case <uuid> --file <fileId> --allowed true|false --evidence-file <fileId> --actor <userId>
 *   node --no-warnings scripts/uc-case-admin.ts purge-case --case <uuid> [--confirm-code <CODICE>] [--allow-open]
 *        [--apply --confirm-authorized --confirm-database host[:port]/db --environment local|preview|production [--production-approved]]
 *   node --no-warnings scripts/uc-case-admin.ts anonymize-contact --case <uuid> --contact <uuid> [--apply …come sopra]
 *   node --no-warnings scripts/uc-case-admin.ts forget-personal-files [--confirm-files <n>] [--apply …come sopra]
 *   env: UC_ADMIN_DATABASE_URL; per purge-case anche gli archivi dei file:
 *        BLOB_READ_WRITE_TOKEN e UC_PERSONAL_BLOB_READ_WRITE_TOKEN (UC_LOCAL_STORAGE_DIR sul harness)
 *
 * - `confirm-gate-policy`: conferma la regola del gate (necessaria per approvare
 *   G1 sui casi a contratto) e, se cambia, ricalcola `in_gate_scope` e i default
 *   delle voci. Evento `caso.regola_gate_confermata`.
 * - `set-ai-environment` / `set-ai-processing`: ambiente AI del caso o
 *   trattamento AI di un file, con un file di prova scritta del caso (art. 10.3).
 *   Evento `caso.ambiente_ai`. Mai sui file della zona personale.
 * - `purge-case`: cancella il caso in cascata (tutte le tabelle uc del caso),
 *   toglie i suoi file dai due archivi (standard e zona personale), revoca i
 *   token MCP del caso e anonimizza i referenti del caso che nessun altro caso
 *   usa. Con `--apply` legge prima il piano (righe per tabella, oggetti, token,
 *   referenti) e lo stampa; procede solo se `--confirm-code` è il codice del
 *   caso e, per un caso non chiuso, con `--allow-open`. Restano gli eventi di
 *   audit e i referenti usati da altri casi. Procedura completa:
 *   `docs/casi-duso/RUNBOOK.md` §7.
 * - `anonymize-contact`: anonimizza un referente del workspace del caso, con le
 *   regole di Persone › «Anonimizza», quando la pagina non si può usare (caso
 *   chiuso). Per una richiesta dell'interessato (RUNBOOK §7.2).
 * - `forget-personal-files`: dopo la perdita della chiave e la cancellazione dello
 *   store della zona personale (RUNBOOK §6.2), chiude le righe dei file personali
 *   senza oggetto (`archivio_rimosso`). Si rifiuta se lo store è ancora
 *   configurato; procede solo se `--confirm-files` è il numero di file del piano.
 */
import { confirmGatePolicy, setAiFlag } from "../src/lib/db/queries/uc-cases.ts";
import { anonymizeContactAsOperator, forgetPersonalFiles, loadPersonalFilesPlan, loadPurgePlan, purgeCase } from "../src/lib/db/queries/uc-retention.ts";
import { ucExecutorForUrl } from "../src/lib/db/uc-executor.ts";
import { storeConfigured } from "../src/lib/uc/storage.ts";
import { GATE_POLICY_SCOPES, isVocab } from "../src/lib/uc/vocab.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const COMMANDS = ["confirm-gate-policy", "set-ai-environment", "set-ai-processing", "purge-case", "anonymize-contact", "forget-personal-files"] as const;
type Command = (typeof COMMANDS)[number];

function fail(code: string, message: string, extra: Record<string, unknown> = {}): never {
  console.error(JSON.stringify({ status: "ERROR", code, message, ...extra }, null, 2));
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args.shift();
if (!command || !(COMMANDS as readonly string[]).includes(command)) fail("comando", `Comando: ${COMMANDS.join(", ")}.`);
const values = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!key.startsWith("--") || values.has(key)) fail("opzioni", `Opzione non valida o ripetuta: ${key}`);
  values.set(key, args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true");
}
const KNOWN: Readonly<Record<Command, readonly string[]>> = {
  "confirm-gate-policy": ["--case", "--scope", "--note", "--actor"],
  "set-ai-environment": ["--case", "--approved", "--evidence-file", "--actor"],
  "set-ai-processing": ["--case", "--file", "--allowed", "--evidence-file", "--actor"],
  "purge-case": ["--case", "--confirm-code", "--allow-open"],
  "anonymize-contact": ["--case", "--contact"],
  "forget-personal-files": ["--confirm-files"],
};
const APPLY_OPTIONS = ["--apply", "--confirm-authorized", "--confirm-database", "--environment", "--production-approved"];
for (const key of values.keys()) {
  if (!KNOWN[command as Command].includes(key) && !APPLY_OPTIONS.includes(key)) fail("opzioni", `Opzione sconosciuta per ${command}: ${key}`);
}
const flag = (key: string) => values.get(`--${key}`) === "true";
const option = (key: string): string | null => {
  const v = values.get(`--${key}`);
  if (v === undefined) return null;
  if (v === "true" && !["approved", "allowed"].includes(key)) fail("opzioni", `Manca il valore di --${key}`);
  return v;
};
const uuid = (key: string): string => {
  const v = option(key);
  if (!v || !UUID.test(v)) fail("opzioni", `--${key} deve essere un id (uuid).`);
  return v;
};
const bool = (key: string): boolean => {
  const v = option(key);
  if (v !== "true" && v !== "false") fail("opzioni", `--${key} deve essere true oppure false.`);
  return v === "true";
};

// Ogni comando è su un caso, tranne forget-personal-files (tutto lo store della zona personale).
const caseId = command === "forget-personal-files" ? "" : uuid("case");
const plan: Record<string, unknown> = caseId ? { command, caseId } : { command };
if (command === "forget-personal-files") {
  const count = option("confirm-files");
  if (count !== null && !/^\d{1,9}$/.test(count)) fail("opzioni", "--confirm-files è il numero di file letto nel piano.");
  plan.confirmFiles = count === null ? null : Number(count);
} else if (command === "purge-case") {
  const code = option("confirm-code");
  if (code !== null && !/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(code)) fail("opzioni", "--confirm-code è il codice del caso, in maiuscolo (es. XX-0012).");
  Object.assign(plan, { confirmCode: code, allowOpen: flag("allow-open") });
} else if (command === "anonymize-contact") {
  plan.contactId = uuid("contact");
} else {
  plan.actor = uuid("actor");
}
if (command === "confirm-gate-policy") {
  const scope = option("scope");
  if (!isVocab(GATE_POLICY_SCOPES, scope)) fail("opzioni", `--scope deve essere ${GATE_POLICY_SCOPES.join(", ")}.`);
  const note = option("note");
  if (note !== null && note.length > 500) fail("opzioni", "--note al massimo 500 caratteri (nessun nome di persona).");
  Object.assign(plan, { scope, note });
} else if (command === "set-ai-environment") {
  Object.assign(plan, { approved: bool("approved"), evidenceFileId: uuid("evidence-file") });
} else if (command === "set-ai-processing") {
  Object.assign(plan, { fileId: uuid("file"), allowed: bool("allowed"), evidenceFileId: uuid("evidence-file") });
}

if (!flag("apply")) {
  console.log(JSON.stringify({ status: "DRY_RUN_NO_DATABASE_ACCESS", ...plan }, null, 2));
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

if (command === "purge-case") {
  // Fuori dal harness l'archivio locale non vale: i file stanno nei due store Blob.
  if (environment !== "local" && process.env.UC_LOCAL_STORAGE_DIR) fail("archivio", "UC_LOCAL_STORAGE_DIR vale solo con --environment local.");
  const purge = await loadPurgePlan(executor, caseId);
  if (!purge) fail("caso_non_trovato", "Caso non trovato in questo database.", { caseId });
  const summary = {
    caseId: purge.caseId,
    workspaceId: purge.workspaceId,
    code: purge.code,
    caseStatus: purge.status,
    rows: purge.rows,
    totalRows: purge.totalRows,
    eventsKept: purge.eventsKept,
    objects: { standard: purge.objects.standard.length, personale: purge.objects.personale.length },
    activeTokens: purge.activeTokens,
    contactsToAnonymize: purge.contactsToAnonymize.length,
  };
  if (plan.confirmCode !== purge.code) {
    console.log(JSON.stringify({ status: "PLAN_ONLY", environment, database: fingerprint, ...summary }, null, 2));
    fail("conferma", `Per cancellare ripeti il comando con --confirm-code ${purge.code}.`);
  }
  if (purge.status !== "chiuso" && !plan.allowOpen) fail("caso_aperto", `Il caso è «${purge.status}», non chiuso: per cancellarlo comunque aggiungi --allow-open.`, summary);
  const result = await purgeCase(executor, purge, process.env);
  if (!result.ok) fail(result.code, result.message, { ...summary, objectsDeleted: result.objectsDeleted });
  const clean = Object.keys(result.remaining).length === 0;
  console.log(
    JSON.stringify(
      {
        status: clean ? "APPLIED" : "APPLIED_WITH_LEFTOVERS",
        environment,
        database: fingerprint,
        ...summary,
        rowsDeleted: result.rowsDeleted,
        objectsDeleted: result.objectsDeleted,
        tokensRevoked: result.tokensRevoked,
        contactsAnonymized: result.contactsAnonymized,
        remaining: result.remaining,
        eventsKept: result.eventsKept,
      },
      null,
      2,
    ),
  );
  process.exit(clean ? 0 : 1);
}

if (command === "forget-personal-files") {
  if (storeConfigured("personale", process.env)) {
    fail("archivio", "Lo store della zona personale è ancora configurato: questo comando vale solo dopo averlo tolto (RUNBOOK §6.2).");
  }
  const forget = await loadPersonalFilesPlan(executor);
  const summary = { environment, database: fingerprint, files: forget.files, cases: forget.cases.length };
  if (plan.confirmFiles !== forget.files) {
    console.log(JSON.stringify({ status: "PLAN_ONLY", ...summary }, null, 2));
    if (forget.files === 0) process.exit(0);
    fail("conferma", `Per chiudere le righe ripeti il comando con --confirm-files ${forget.files}.`);
  }
  const closed = await forgetPersonalFiles(executor, forget);
  console.log(JSON.stringify({ status: "APPLIED", ...summary, filesClosed: closed }, null, 2));
  process.exit(0);
}

if (command === "anonymize-contact") {
  const result = await anonymizeContactAsOperator(executor, { caseId, contactId: plan.contactId as string });
  if (!result.ok) fail(result.code, result.message, { caseId, contactId: plan.contactId });
  console.log(JSON.stringify({ status: "APPLIED", environment, database: fingerprint, ...plan, workspaceId: result.workspaceId }, null, 2));
  process.exit(0);
}

const actor = plan.actor as string;
const result =
  command === "confirm-gate-policy"
    ? await confirmGatePolicy(executor, { caseId, actorUserId: actor, scope: plan.scope as (typeof GATE_POLICY_SCOPES)[number], note: (plan.note as string | null) ?? null })
    : await setAiFlag(executor, {
        caseId,
        actorUserId: actor,
        approved: command === "set-ai-environment" ? (plan.approved as boolean) : (plan.allowed as boolean),
        evidenceFileId: plan.evidenceFileId as string,
        fileId: command === "set-ai-processing" ? (plan.fileId as string) : null,
      });
if (!result.ok) fail(result.code, result.message, { command, caseId });
console.log(JSON.stringify({ status: "APPLIED", environment, database: fingerprint, ...plan, result: result.value }, null, 2));
