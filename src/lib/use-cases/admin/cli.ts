/**
 * `scripts/use-case-admin.ts`, lo script dell'operatore dell'area «Use case»
 * (docs/use-case/DESIGN.md §10.5; PIANO-LAVORI H2c): comandi, opzioni, ambito, conferma del
 * database e i tipi che lo smistatore passa a ogni comando.
 *
 * - Un file per comando in `scripts/use-case-admin/<comando>.ts`, che esporta
 *   `command: AdminCommand`. Lo smistatore lo carica, legge le sue opzioni, controlla
 *   l'ambito e il database, poi chiama `run(ctx)`. Un comando registrato senza il suo file
 *   risponde «non ancora disponibile» (`scoring-v2` ha il suo file da H3a).
 * - Il database è solo `USE_CASE_ADMIN_DATABASE_URL`, nella shell: lo script non legge file
 *   d'ambiente né `DATABASE_URL`. Senza la variabile si ferma, anche a secco.
 * - Prova a secco predefinita, in sola lettura. Si scrive solo con `--apply` e le conferme di
 *   `scripts/uc-case-admin.ts`: `--confirm-authorized`, `--confirm-database host[:porta]/database`
 *   uguale all'URL, `--environment local|preview|production` coerente con l'host (`local` solo
 *   su loopback, gli altri mai) e, in produzione, `--production-approved`. Prima di scrivere il
 *   comando stampa il piano, con database e ambiente.
 * - Ogni comando prende `--workspace <id>` oppure `--all`.
 *
 * Modulo puro: niente database, niente ambiente; solo import relativi `.ts`.
 */

/** I comandi, nell'ordine di DESIGN §10.5. */
export const ADMIN_COMMANDS = [
  "dossier-dups",
  "configs",
  "team-name",
  "origin",
  "codes",
  "dossier-links",
  "slack-drafts",
  "scoring-v2",
  "doctor",
  "erase-referent",
] as const;
export type AdminCommandName = (typeof ADMIN_COMMANDS)[number];

/** L'unica variabile con l'URL del database. */
export const ADMIN_DATABASE_ENV = "USE_CASE_ADMIN_DATABASE_URL";

/** Opzioni di tutti i comandi: con un valore, e senza. */
export const COMMON_VALUE_OPTIONS: readonly string[] = Object.freeze(["workspace", "confirm-database", "environment"]);
export const COMMON_FLAGS: readonly string[] = Object.freeze(["all", "apply", "confirm-authorized", "production-approved"]);

/** Le conferme che valgono solo con `--apply`. */
const APPLY_OPTIONS: readonly string[] = ["confirm-authorized", "confirm-database", "environment", "production-approved"];

/** `--environment`: dove sta il database su cui si scrive. */
export const ADMIN_ENVIRONMENTS = ["local", "preview", "production"] as const;
export type AdminEnvironment = (typeof ADMIN_ENVIRONMENTS)[number];

/** Gli host di un database locale: `local` solo qui, `preview` e `production` mai. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Le opzioni proprie di un comando, senza i due trattini. */
export interface AdminOptionSpec {
  values?: readonly string[];
  flags?: readonly string[];
}

export type AdminScope = { kind: "workspace"; workspaceId: string } | { kind: "all" };

export interface AdminArgs {
  scope: AdminScope;
  apply: boolean;
  /** Solo con `--apply`. */
  environment: AdminEnvironment | null;
  values: ReadonlyMap<string, string>;
  flags: ReadonlySet<string>;
}

export type AdminParse<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID.test(value);
}

const failure = (code: string, message: string) => ({ ok: false as const, code, message });

/** Il comando, primo argomento. */
export function parseCommandName(argv: readonly string[]): AdminParse<AdminCommandName> {
  const name = argv[0];
  if (!name || !(ADMIN_COMMANDS as readonly string[]).includes(name)) {
    return failure("comando", `Comando: ${ADMIN_COMMANDS.join(", ")}.`);
  }
  return { ok: true, value: name as AdminCommandName };
}

/**
 * Le opzioni dopo il comando. `--nome valore` per le opzioni con un valore, `--nome` per le
 * altre. Niente argomenti sciolti, niente opzioni ripetute o sconosciute. Esattamente uno tra
 * `--workspace <uuid>` e `--all`. `--apply` mai su un comando in sola lettura; con `--apply`
 * servono `--confirm-authorized`, `--confirm-database` (controllato con l'URL in
 * `checkDatabaseTarget`) e `--environment`, più `--production-approved` in produzione. Le
 * conferme senza `--apply` si rifiutano.
 */
export function parseAdminOptions(
  argv: readonly string[],
  spec: AdminOptionSpec = {},
  readOnly = false,
): AdminParse<AdminArgs> {
  const valueNames = new Set([...COMMON_VALUE_OPTIONS, ...(spec.values ?? [])]);
  const flagNames = new Set([...COMMON_FLAGS, ...(spec.flags ?? [])]);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--") || token.length < 3) return failure("opzioni", `Argomento non previsto: ${token}`);
    const name = token.slice(2);
    if (values.has(name) || flags.has(name)) return failure("opzioni", `Opzione ripetuta: ${token}`);
    if (valueNames.has(name)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return failure("opzioni", `Manca il valore di ${token}`);
      values.set(name, next);
      i++;
    } else if (flagNames.has(name)) {
      flags.add(name);
    } else {
      return failure("opzioni", `Opzione sconosciuta: ${token}`);
    }
  }
  const workspace = values.get("workspace");
  const all = flags.has("all");
  if (workspace !== undefined && all) return failure("ambito", "Usa --workspace <id> oppure --all, non tutti e due.");
  if (workspace === undefined && !all) return failure("ambito", "Serve --workspace <id> oppure --all.");
  if (workspace !== undefined && !isUuid(workspace)) return failure("ambito", "--workspace deve essere un id (uuid).");
  const apply = flags.has("apply");
  if (apply && readOnly) return failure("sola_lettura", "Questo comando non scrive: niente --apply.");
  if (!apply) {
    const stray = APPLY_OPTIONS.find((option) => values.has(option) || flags.has(option));
    if (stray) return failure("opzioni", `--${stray} serve solo con --apply.`);
  }
  let environment: AdminEnvironment | null = null;
  if (apply) {
    if (!flags.has("confirm-authorized")) return failure("conferma", "--apply richiede --confirm-authorized dell'operatore responsabile.");
    const value = values.get("environment");
    if (!(ADMIN_ENVIRONMENTS as readonly string[]).includes(value ?? "")) {
      return failure("ambiente", "--apply richiede --environment local, preview o production.");
    }
    environment = value as AdminEnvironment;
    if (environment === "production" && !flags.has("production-approved")) {
      return failure("ambiente", "In produzione serve l'approvazione esplicita: --production-approved.");
    }
  }
  const scope: AdminScope = workspace !== undefined ? { kind: "workspace", workspaceId: workspace.toLowerCase() } : { kind: "all" };
  return { ok: true, value: { scope, apply, environment, values, flags } };
}

function parsePostgresUrl(url: string): URL | null {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") return null;
  // Come `neon()`: senza utente, host o database l'URL non vale.
  if (!target.username || !target.hostname || target.pathname.length < 2) return null;
  return target;
}

/** `host[:porta]/database` dell'URL: quello che `--confirm-database` deve ripetere. */
export function databaseFingerprint(url: string): string | null {
  const target = parsePostgresUrl(url);
  if (!target) return null;
  return `${target.hostname}${target.port ? `:${target.port}` : ""}${target.pathname}`;
}

/**
 * L'URL del database e, con `--apply`, le sue conferme: `--confirm-database` uguale a
 * host[:porta]/database e `--environment` coerente con l'host (`local` solo su loopback;
 * `preview` e `production` mai su loopback).
 */
export function checkDatabaseTarget(
  url: string | undefined,
  apply: boolean,
  confirm: string | undefined,
  environment: AdminEnvironment | null = null,
): AdminParse<{ url: string; fingerprint: string }> {
  if (!url || !url.trim()) {
    return failure("database", `Imposta ${ADMIN_DATABASE_ENV} a mano: lo script non legge file d'ambiente né DATABASE_URL.`);
  }
  const target = parsePostgresUrl(url.trim());
  const fingerprint = databaseFingerprint(url.trim());
  if (!target || !fingerprint) return failure("database", `${ADMIN_DATABASE_ENV} non è un URL postgres valido.`);
  if (apply) {
    if (confirm !== fingerprint) {
      return failure("database", "Con --apply serve --confirm-database uguale a host[:porta]/database dell'URL.");
    }
    const loopback = LOOPBACK_HOSTS.has(target.hostname);
    if (environment === null) return failure("ambiente", "--apply richiede --environment local, preview o production.");
    if (environment === "local" && !loopback) return failure("ambiente", "--environment local accetta solo un database su loopback.");
    if (environment !== "local" && loopback) return failure("ambiente", "Un database su loopback si usa solo con --environment local.");
  }
  return { ok: true, value: { url: url.trim(), fingerprint } };
}

/** Un titolo per le liste dell'operatore: al massimo 60 caratteri, con «…» se tagliato. */
export function truncateTitle(title: unknown, max = 60): string {
  const text = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * L'ambito per le query dei comandi: `withWorkspace` dice se la query ha il filtro `$1` sul
 * workspace, `params` è `[id]` oppure vuoto.
 */
export function scopeQuery(scope: AdminScope): { withWorkspace: boolean; params: string[] } {
  return scope.kind === "workspace" ? { withWorkspace: true, params: [scope.workspaceId] } : { withWorkspace: false, params: [] };
}

// ─── Contesto e risultato di un comando ──────────────────────────────

export type AdminRow = Record<string, unknown>;

export interface AdminStatement {
  readonly text: string;
  readonly params: readonly unknown[];
}

export interface AdminDb {
  /** Una lettura, dentro una transazione di sola lettura. */
  read(text: string, params?: readonly unknown[]): Promise<AdminRow[]>;
  /** Le istruzioni in una sola transazione, nell'ordine. Solo con `--apply`. */
  write(statements: readonly AdminStatement[]): Promise<AdminRow[][]>;
}

export type AdminStatus =
  | "DRY_RUN"
  | "PLAN"
  | "APPLIED"
  | "NOTHING_TO_DO"
  | "REPORT"
  | "SCHEMA_MISSING"
  | "NOT_AVAILABLE"
  | "GREEN"
  | "RED"
  | "ERROR";

export interface AdminOutput {
  status: AdminStatus;
  [key: string]: unknown;
}

export interface AdminOutcome {
  output: AdminOutput;
  exitCode: 0 | 1;
}

export interface AdminContext {
  command: AdminCommandName;
  scope: AdminScope;
  apply: boolean;
  /** Valore di un'opzione propria del comando, senza trattini; `null` se manca. */
  value(name: string): string | null;
  flag(name: string): boolean;
  db: AdminDb;
  /** `UC_LS_EMAIL_DOMAINS` della shell, letta dallo smistatore; `null` se manca. */
  lsEmailDomains: string | null;
  /**
   * I workspace con l'area accesa, da `USE_CASE_HUB_WORKSPACES` e `USE_CASE_HUB_EXCLUDE` della
   * shell (facoltative, come su Vercel): lì le proposte dal web nuove le decide il servizio.
   * Con `*` sono tutti i workspace del database meno gli esclusi (lo smistatore li legge una
   * volta). Vuota se manca.
   */
  hubWorkspaces: ReadonlySet<string>;
  /** Un file JSON dell'operatore (`--prefixes`, `--decisions`), al massimo 1 MB. */
  readJsonFile(path: string): unknown;
  /** Stampa un documento subito: il piano, prima di scrivere. */
  print(output: AdminOutput): void;
}

export interface AdminCommand {
  name: AdminCommandName;
  options?: AdminOptionSpec;
  /** Vero per i comandi che non scrivono mai: `--apply` si rifiuta. */
  readOnly?: boolean;
  run(ctx: AdminContext): Promise<AdminOutcome>;
}

/** Un comando si ferma e lo dice: lo smistatore stampa `ERROR` con codice e messaggio. */
export class AdminStop extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AdminStop";
    this.code = code;
    this.details = details;
  }
}

/** Esito con codice d'uscita 0. */
export function done(output: AdminOutput): AdminOutcome {
  return { output, exitCode: 0 };
}

/** Esito con codice d'uscita 1. */
export function stopped(output: AdminOutput): AdminOutcome {
  return { output, exitCode: 1 };
}

/** Manca lo schema che serve al comando: si ferma e lo dice (DESIGN §10.5). */
export function schemaMissing(command: AdminCommandName, needs: string, message: string): AdminOutcome {
  return stopped({ status: "SCHEMA_MISSING", command, needs, message });
}

/** La parola giusta per un numero: `plural(1, "scheda", "schede")` è «scheda»; con 0 o 2, «schede». */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Il numero con la sua parola: «1 scheda», «2 schede». */
export function counted(count: number, one: string, many: string): string {
  return `${count} ${plural(count, one, many)}`;
}

/** Il messaggio delle prove a secco. */
export const DRY_RUN_NOTE =
  "Prova a secco: niente è stato scritto. Per scrivere: --apply --confirm-authorized --confirm-database host[:porta]/database --environment local|preview|production (in produzione anche --production-approved).";
