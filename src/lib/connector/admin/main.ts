/**
 * Lo smistatore di `scripts/connector-admin.ts` (prompt WP8, pacchetto K8): legge il comando
 * e le opzioni, controlla `CONNECTOR_ADMIN_DATABASE_URL` e le conferme di `--apply`, apre il
 * database (letture in transazioni di sola lettura, scritture solo con `--apply`), controlla
 * lo schema e il workspace, poi chiama il comando. Lo script lo chiama con `process.argv` e
 * `process.env`; i test lo chiamano direttamente, sul database locale o con un database finto.
 *
 * L'uscita è JSON (codice 0, oppure 1 se il comando si ferma), con database (host[:porta]/db,
 * mai la password) e ambiente. Mai messaggi del database: possono contenere query e valori.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { summarizeError } from "../../log/safe-error.ts";
import {
  AdminStop,
  checkDatabaseTarget,
  CONNECTOR_ADMIN_DATABASE_ENV,
  parseAdminOptions,
  parseCommandName,
  type AdminCommand,
  type AdminContext,
  type AdminDb,
  type AdminOutcome,
  type AdminOutput,
  type AdminRow,
  type ConnectorAdminCommandName,
} from "./cli.ts";
import { command as backfillCodes } from "./backfill-codes.ts";
import { command as config } from "./config.ts";
import { command as guide } from "./guide.ts";
import { command as profile } from "./profile.ts";
import { command as token, newConnectorTokenSecret } from "./token.ts";

const COMMANDS: Readonly<Record<ConnectorAdminCommandName, AdminCommand>> = Object.freeze({
  config,
  profile,
  guide,
  token,
  "backfill-codes": backfillCodes,
});

const MAX_JSON_FILE_BYTES = 1_000_000;

export function readJsonFile(path: string): unknown {
  if (!existsSync(path)) throw new AdminStop("file", `File non trovato: ${path}`);
  if (statSync(path).size > MAX_JSON_FILE_BYTES) throw new AdminStop("file", `File troppo grande (massimo 1 MB): ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new AdminStop("file", `Il file non è JSON valido: ${path}`);
  }
}

/** Il database dello script: letture di sola lettura, scritture solo con `--apply`. */
export function neonAdminDb(url: string, apply: boolean): AdminDb {
  const sql = neon(url);
  return {
    async read(text, params = []) {
      // Postgres stesso rifiuta ogni scrittura dentro una lettura.
      const results = await sql.transaction([sql.query("SET TRANSACTION READ ONLY"), sql.query(text, [...params])], { readOnly: true });
      return (results[1] ?? []) as AdminRow[];
    },
    async write(statements) {
      if (!apply) throw new AdminStop("sola_lettura", "Le scritture vogliono --apply.");
      if (statements.length === 0) return [];
      return (await sql.transaction(statements.map((s) => sql.query(s.text, [...s.params])))) as AdminRow[][];
    },
  };
}

export interface ConnectorAdminRunOptions {
  env: Readonly<Record<string, string | undefined>>;
  /** Dove stampare i documenti intermedi (il piano prima di scrivere). */
  print?: (output: AdminOutput) => void;
  /** Database finto (test); altrimenti Neon sull'URL della variabile. */
  db?: (url: string, apply: boolean) => AdminDb;
  /** Segreto del token (test). */
  newTokenSecret?: () => string;
}

function error(code: string, message: string, extra: Record<string, unknown> = {}): AdminOutcome {
  return { output: { status: "ERROR", code, message, ...extra }, exitCode: 1 };
}

export async function runConnectorAdmin(argv: readonly string[], opts: ConnectorAdminRunOptions): Promise<AdminOutcome> {
  const name = parseCommandName(argv);
  if (!name.ok) return name.code === "non_disponibile" ? { output: { status: "NOT_AVAILABLE", command: argv[0], message: name.message }, exitCode: 1 } : error(name.code, name.message);
  const command = COMMANDS[name.value];
  const parsed = parseAdminOptions(argv.slice(1), command.options);
  if (!parsed.ok) return error(parsed.code, parsed.message, { command: command.name });
  const args = parsed.value;

  const target = checkDatabaseTarget(opts.env[CONNECTOR_ADMIN_DATABASE_ENV], args.apply, args.values.get("confirm-database"), args.environment);
  if (!target.ok) return error(target.code, target.message, { command: command.name, env: CONNECTOR_ADMIN_DATABASE_ENV });
  const where = { database: target.value.fingerprint, ...(args.environment ? { ambiente: args.environment } : {}) };

  let db: AdminDb;
  try {
    db = (opts.db ?? neonAdminDb)(target.value.url, args.apply);
  } catch {
    // Mai il messaggio del driver: può contenere l'URL, con la password.
    return error("database", `${CONNECTOR_ADMIN_DATABASE_ENV} non è un URL postgres valido.`, { command: command.name });
  }
  const print = opts.print ?? ((output: AdminOutput) => process.stdout.write(`${JSON.stringify(output, null, 2)}\n`));
  const ctx: AdminContext = {
    command: command.name,
    workspaceId: args.workspaceId,
    apply: args.apply,
    value: (option) => args.values.get(option) ?? null,
    flag: (option) => args.flags.has(option),
    db,
    readJsonFile,
    print: (output) => print({ ...output, ...where }),
    newTokenSecret: opts.newTokenSecret ?? newConnectorTokenSecret,
  };
  try {
    const outcome = await command.run(ctx);
    return { output: { ...outcome.output, command: command.name, workspace: args.workspaceId, ...where }, exitCode: outcome.exitCode };
  } catch (caught) {
    if (caught instanceof AdminStop) return error(caught.code, caught.message, { command: command.name, ...caught.details, ...where });
    return error(
      "errore",
      "Errore durante il comando. Ogni scrittura è una transazione: quelle già confermate restano. Rilancia a secco per vedere cosa manca.",
      { command: command.name, error: summarizeError(caught), ...where }
    );
  }
}
