#!/usr/bin/env node
/**
 * Script dell'operatore dell'area «Use case» (docs/use-case/DESIGN.md §10.4-10.9;
 * PIANO-LAVORI H2c). Smista i comandi: un file per comando in `scripts/use-case-admin/`.
 *
 *   node --no-warnings scripts/use-case-admin.ts <comando> (--workspace <uuid> | --all) [opzioni]
 *        [--apply --confirm-authorized --confirm-database host[:porta]/database
 *         --environment local|preview|production [--production-approved]]
 *   env: USE_CASE_ADMIN_DATABASE_URL (a mano, nella shell); UC_LS_EMAIL_DOMAINS (origin, codes, doctor);
 *        USE_CASE_HUB_WORKSPACES e USE_CASE_HUB_EXCLUDE, facoltative, come su Vercel (origin, codes,
 *        scoring-v2, doctor): con `*` l'area è accesa per ogni workspace del database, tranne gli esclusi
 *
 * Comandi, in quest'ordine (DESIGN §10.5):
 *   dossier-dups  [--detach <caseId>[,<caseId>…]]  doppioni tra dossier e scheda, prima della 0020
 *   configs       [--prefixes prefixes.json]       righe mancanti di workspace_connector_configs
 *   team-name                                      workspace con il nome del team «AI Transformation» (sola lettura)
 *   origin        [--decisions origin.json]        origine e «nascosta alla ricerca» dei dati esistenti
 *   codes         [--limit <n>]                    codici per le schede che non ce l'hanno
 *   dossier-links                                  schede madri per i dossier orfani, dopo la 0020
 *   slack-drafts                                   testi a NULL nelle bozze di Slack già inviate
 *   scoring-v2    [--revert]                       prima/dopo del punteggio v2, --apply e ritorno alla v1
 *   doctor                                         controlli prima dell'accensione (sola lettura)
 *   erase-referent --contact <uuid>                dati di un referente di «Chiedi al referente» (con --workspace)
 *
 * Regole (sul modello di `scripts/uc-case-admin.ts`):
 * - il database è solo `USE_CASE_ADMIN_DATABASE_URL`: lo script non legge file d'ambiente né
 *   `DATABASE_URL`. Senza la variabile si ferma, anche a secco;
 * - prova a secco predefinita, in transazioni di sola lettura; si scrive solo con `--apply`,
 *   `--confirm-authorized`, `--confirm-database` uguale a host[:porta]/database dell'URL e
 *   `--environment` coerente con l'host (`local` solo su loopback, `preview` e `production`
 *   mai), più `--production-approved` in produzione; prima di scrivere il comando stampa il
 *   piano, con database e ambiente;
 * - se manca lo schema che serve, il comando si ferma e lo dice;
 * - l'uscita è JSON (codice 0, oppure 1 se il comando si ferma); mai email, nomi di persone,
 *   token o messaggi del database.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import {
  ADMIN_DATABASE_ENV,
  AdminStop,
  checkDatabaseTarget,
  parseAdminOptions,
  parseCommandName,
  type AdminCommand,
  type AdminContext,
  type AdminDb,
  type AdminOutcome,
  type AdminOutput,
  type AdminRow,
} from "../src/lib/use-cases/admin/cli.ts";
import { summarizeError } from "../src/lib/log/safe-error.ts";
import { USE_CASE_HUB_EXCLUDE_ENV, USE_CASE_HUB_WORKSPACES_ENV, hubRollout, hubWorkspaceIds, hubWorkspacesAmong } from "../src/lib/use-cases/rollout.ts";

const MAX_JSON_FILE_BYTES = 1_000_000;

const json = (output: AdminOutput) => `${JSON.stringify(output, null, 2)}\n`;

function error(code: string, message: string, extra: Record<string, unknown> = {}): AdminOutcome {
  return { output: { status: "ERROR", code, message, ...extra }, exitCode: 1 };
}

function readJsonFile(path: string): unknown {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new AdminStop("file", `File non trovato: ${path}`);
  }
  if (size > MAX_JSON_FILE_BYTES) throw new AdminStop("file", `File troppo grande (massimo 1 MB): ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new AdminStop("file", `Il file non è JSON valido: ${path}`);
  }
}

async function main(argv: readonly string[]): Promise<AdminOutcome> {
  const name = parseCommandName(argv);
  if (!name.ok) return error(name.code, name.message);
  const commandName = name.value;

  const file = new URL(`./use-case-admin/${commandName}.ts`, import.meta.url);
  if (!existsSync(file)) {
    return { output: { status: "NOT_AVAILABLE", command: commandName, message: `Il comando ${commandName} non è ancora disponibile.` }, exitCode: 1 };
  }
  const command = ((await import(file.href)) as { command?: AdminCommand }).command;
  if (!command || command.name !== commandName || typeof command.run !== "function") {
    return error("comando", `scripts/use-case-admin/${commandName}.ts non esporta il comando ${commandName}.`);
  }

  const parsed = parseAdminOptions(argv.slice(1), command.options, command.readOnly === true);
  if (!parsed.ok) return error(parsed.code, parsed.message, { command: commandName });
  const args = parsed.value;

  const target = checkDatabaseTarget(process.env.USE_CASE_ADMIN_DATABASE_URL, args.apply, args.values.get("confirm-database"), args.environment);
  if (!target.ok) return error(target.code, target.message, { command: commandName, env: ADMIN_DATABASE_ENV });
  // Con --apply ogni documento dice dove si scrive.
  const where = { database: target.value.fingerprint, ...(args.environment ? { ambiente: args.environment } : {}) };

  let sql: ReturnType<typeof neon>;
  try {
    sql = neon(target.value.url);
  } catch {
    // Mai il messaggio del driver: può contenere l'URL, con la password.
    return error("database", `${ADMIN_DATABASE_ENV} non è un URL postgres valido.`, { command: commandName, env: ADMIN_DATABASE_ENV });
  }
  const db: AdminDb = {
    async read(text, params = []) {
      // Postgres stesso rifiuta ogni scrittura dentro una lettura.
      const results = await sql.transaction([sql.query("SET TRANSACTION READ ONLY"), sql.query(text, [...params])], { readOnly: true });
      return (results[1] ?? []) as AdminRow[];
    },
    async write(statements) {
      if (!args.apply) throw new AdminStop("sola_lettura", "Le scritture vogliono --apply.");
      if (statements.length === 0) return [];
      return (await sql.transaction(statements.map((s) => sql.query(s.text, [...s.params])))) as AdminRow[][];
    },
  };
  // L'interruttore dell'area come su Vercel. Con `*` vale per ogni workspace del database (anche
  // quelli nati dopo), tranne gli esclusi: si legge l'elenco dei workspace una volta, qui.
  const hubEnv = { [USE_CASE_HUB_WORKSPACES_ENV]: process.env.USE_CASE_HUB_WORKSPACES, [USE_CASE_HUB_EXCLUDE_ENV]: process.env.USE_CASE_HUB_EXCLUDE };
  let hubWorkspaces: ReadonlySet<string> = hubWorkspaceIds(hubEnv);
  if (hubRollout(hubEnv).all) {
    try {
      const rows = await db.read(`SELECT id FROM workspaces ORDER BY created_at, id`);
      hubWorkspaces = new Set(hubWorkspacesAmong(rows.map((row) => String(row.id)), hubEnv));
    } catch (caught) {
      return error("errore", "Non riesco a leggere i workspace per USE_CASE_HUB_WORKSPACES=*.", { command: commandName, error: summarizeError(caught) });
    }
  }
  const ctx: AdminContext = {
    command: commandName,
    scope: args.scope,
    apply: args.apply,
    value: (option) => args.values.get(option) ?? null,
    flag: (option) => args.flags.has(option),
    db,
    lsEmailDomains: process.env.UC_LS_EMAIL_DOMAINS?.trim() || null,
    hubWorkspaces,
    readJsonFile,
    // Il piano, prima delle scritture: nello stesso flusso, prima del risultato.
    print: (output) => process.stdout.write(json({ ...output, ...where })),
  };

  try {
    if (args.scope.kind === "workspace") {
      const rows = await db.read(`SELECT 1 AS found FROM workspaces WHERE id = $1::uuid`, [args.scope.workspaceId]);
      if (rows.length === 0) return error("workspace", "Workspace non trovato.", { command: commandName, workspace: args.scope.workspaceId });
    }
    const outcome = await command.run(ctx);
    return {
      output: { ...outcome.output, command: commandName, scope: args.scope.kind === "all" ? "all" : args.scope.workspaceId, ...where },
      exitCode: outcome.exitCode,
    };
  } catch (caught) {
    if (caught instanceof AdminStop) return error(caught.code, caught.message, { command: commandName, ...caught.details });
    // Mai il messaggio del database: contiene la query e i parametri.
    return error("errore", "Errore durante il comando. Ogni scrittura è una transazione: quelle già confermate restano. Rilancia a secco per vedere cosa manca.", {
      command: commandName,
      error: summarizeError(caught),
    });
  }
}

const outcome = await main(process.argv.slice(2));
// Si esce solo quando l'uscita è scritta: su una pipe stdout può essere asincrono.
process.stdout.write(json(outcome.output), () => process.exit(outcome.exitCode));
