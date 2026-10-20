/**
 * `scripts/connector-admin.ts`, lo script dell'operatore del connettore (prompt WP8,
 * pacchetto K8): comandi, opzioni, conferma del database e i tipi che lo smistatore
 * (`main.ts`) passa a ogni comando. Stesse regole di `scripts/uc-case-admin.ts` e dello
 * script `use-case-admin` dell'hub, scritte qui perché il connettore non importa dall'hub:
 *
 * - Il database è solo `CONNECTOR_ADMIN_DATABASE_URL`, nella shell: lo script non legge file
 *   d'ambiente né `DATABASE_URL`. Senza la variabile si ferma, anche a secco.
 * - Prova a secco predefinita, con letture in transazioni di sola lettura: stampa le
 *   differenze e non scrive nulla. Si scrive solo con `--apply` e le conferme:
 *   `--confirm-authorized`, `--confirm-database host[:porta]/database` uguale all'URL,
 *   `--environment local|preview|production` coerente con l'host (`local` solo su loopback,
 *   gli altri mai) e, in produzione, `--production-approved`. Prima di scrivere il comando
 *   stampa il piano, con database e ambiente.
 * - Ogni comando prende `--workspace <id>`: il connettore è di un workspace alla volta.
 *
 * Modulo puro: niente database, niente ambiente.
 */

/** I comandi, nell'ordine d'uso: riga, profilo, guida, token, codici. */
export const CONNECTOR_ADMIN_COMMANDS = ["config", "profile", "guide", "token", "backfill-codes"] as const;
export type ConnectorAdminCommandName = (typeof CONNECTOR_ADMIN_COMMANDS)[number];

/**
 * Comandi che non ci sono: `scoring-model` (KPI del modello di punteggio allineati alla
 * rubrica) passa all'hub, area «Use case», punteggio v2 (decisione del 19/10/2026).
 */
export const CONNECTOR_ADMIN_DEFERRED: Readonly<Record<string, string>> = Object.freeze({
  "scoring-model":
    "Il comando scoring-model non c'è: l'allineamento dei KPI del modello di punteggio alla rubrica passa all'hub (area «Use case», punteggio v2).",
});

/** L'unica variabile con l'URL del database. */
export const CONNECTOR_ADMIN_DATABASE_ENV = "CONNECTOR_ADMIN_DATABASE_URL";

const COMMON_VALUES: readonly string[] = ["workspace", "confirm-database", "environment"];
const COMMON_FLAGS: readonly string[] = ["apply", "confirm-authorized", "production-approved"];
/** Le conferme che valgono solo con `--apply`. */
const APPLY_OPTIONS: readonly string[] = ["confirm-authorized", "confirm-database", "environment", "production-approved"];

export const CONNECTOR_ADMIN_ENVIRONMENTS = ["local", "preview", "production"] as const;
export type ConnectorAdminEnvironment = (typeof CONNECTOR_ADMIN_ENVIRONMENTS)[number];

/** Host di un database locale: `local` solo qui, `preview` e `production` mai. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Le opzioni proprie di un comando, senza i due trattini. */
export interface AdminOptionSpec {
  values?: readonly string[];
  flags?: readonly string[];
}

export interface AdminArgs {
  workspaceId: string;
  apply: boolean;
  /** Solo con `--apply`. */
  environment: ConnectorAdminEnvironment | null;
  values: ReadonlyMap<string, string>;
  flags: ReadonlySet<string>;
}

export type AdminParse<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

const failure = (code: string, message: string) => ({ ok: false as const, code, message });

/** Il comando, primo argomento; `scoring-model` dice dove è andato. */
export function parseCommandName(argv: readonly string[]): AdminParse<ConnectorAdminCommandName> {
  const name = argv[0];
  if (name && name in CONNECTOR_ADMIN_DEFERRED) return failure("non_disponibile", CONNECTOR_ADMIN_DEFERRED[name]);
  if (!name || !(CONNECTOR_ADMIN_COMMANDS as readonly string[]).includes(name)) {
    return failure("comando", `Comando: ${CONNECTOR_ADMIN_COMMANDS.join(", ")}.`);
  }
  return { ok: true, value: name as ConnectorAdminCommandName };
}

/**
 * Le opzioni dopo il comando: `--nome valore` per le opzioni con un valore, `--nome` per le
 * altre. Niente argomenti sciolti, niente opzioni ripetute o sconosciute. `--workspace
 * <uuid>` obbligatorio. Con `--apply` servono `--confirm-authorized`, `--confirm-database`
 * (controllato con l'URL in `checkDatabaseTarget`) e `--environment`, più
 * `--production-approved` in produzione; senza `--apply` le conferme si rifiutano.
 */
export function parseAdminOptions(argv: readonly string[], spec: AdminOptionSpec = {}): AdminParse<AdminArgs> {
  const valueNames = new Set([...COMMON_VALUES, ...(spec.values ?? [])]);
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
  if (workspace === undefined) return failure("workspace", "Serve --workspace <id>.");
  if (!UUID.test(workspace)) return failure("workspace", "--workspace deve essere un id (uuid).");
  const apply = flags.has("apply");
  if (!apply) {
    const stray = APPLY_OPTIONS.find((option) => values.has(option) || flags.has(option));
    if (stray) return failure("opzioni", `--${stray} serve solo con --apply.`);
  }
  let environment: ConnectorAdminEnvironment | null = null;
  if (apply) {
    if (!flags.has("confirm-authorized")) return failure("conferma", "--apply richiede --confirm-authorized dell'operatore responsabile.");
    const value = values.get("environment");
    if (!(CONNECTOR_ADMIN_ENVIRONMENTS as readonly string[]).includes(value ?? "")) {
      return failure("ambiente", "--apply richiede --environment local, preview o production.");
    }
    environment = value as ConnectorAdminEnvironment;
    if (environment === "production" && !flags.has("production-approved")) {
      return failure("ambiente", "In produzione serve l'approvazione esplicita: --production-approved.");
    }
  }
  return { ok: true, value: { workspaceId: workspace.toLowerCase(), apply, environment, values, flags } };
}

function parsePostgresUrl(url: string): URL | null {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") return null;
  if (!target.username || !target.hostname || target.pathname.length < 2) return null;
  return target;
}

/** `host[:porta]/database` dell'URL: quello che `--confirm-database` deve ripetere. Mai la password. */
export function databaseFingerprint(url: string): string | null {
  const target = parsePostgresUrl(url);
  if (!target) return null;
  return `${target.hostname}${target.port ? `:${target.port}` : ""}${target.pathname}`;
}

/**
 * L'URL del database e, con `--apply`, le sue conferme: `--confirm-database` uguale a
 * host[:porta]/database e `--environment` coerente con l'host.
 */
export function checkDatabaseTarget(
  url: string | undefined,
  apply: boolean,
  confirm: string | undefined,
  environment: ConnectorAdminEnvironment | null = null
): AdminParse<{ url: string; fingerprint: string }> {
  if (!url || !url.trim()) {
    return failure("database", `Imposta ${CONNECTOR_ADMIN_DATABASE_ENV} a mano: lo script non legge file d'ambiente né DATABASE_URL.`);
  }
  const target = parsePostgresUrl(url.trim());
  const fingerprint = databaseFingerprint(url.trim());
  if (!target || !fingerprint) return failure("database", `${CONNECTOR_ADMIN_DATABASE_ENV} non è un URL postgres valido.`);
  if (apply) {
    if (confirm !== fingerprint) return failure("database", "Con --apply serve --confirm-database uguale a host[:porta]/database dell'URL.");
    const loopback = LOOPBACK_HOSTS.has(target.hostname);
    if (environment === null) return failure("ambiente", "--apply richiede --environment local, preview o production.");
    if (environment === "local" && !loopback) return failure("ambiente", "--environment local accetta solo un database su loopback.");
    if (environment !== "local" && loopback) return failure("ambiente", "Un database su loopback si usa solo con --environment local.");
  }
  return { ok: true, value: { url: url.trim(), fingerprint } };
}

/**
 * JSON con le chiavi in ordine, per confrontare valori: `jsonb` riordina le chiavi, quindi
 * un oggetto riletto dal database e lo stesso oggetto del file danno lo stesso testo.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Un titolo per le liste dell'operatore: al massimo 60 caratteri, con «…» se tagliato. */
export function truncateTitle(title: unknown, max = 60): string {
  const text = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
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

export type AdminStatus = "DRY_RUN" | "PLAN" | "APPLIED" | "NOTHING_TO_DO" | "SCHEMA_MISSING" | "NOT_AVAILABLE" | "ERROR";

export interface AdminOutput {
  status: AdminStatus;
  [key: string]: unknown;
}

export interface AdminOutcome {
  output: AdminOutput;
  exitCode: 0 | 1;
}

export interface AdminContext {
  command: ConnectorAdminCommandName;
  workspaceId: string;
  apply: boolean;
  /** Valore di un'opzione propria del comando, senza trattini; `null` se manca. */
  value(name: string): string | null;
  flag(name: string): boolean;
  db: AdminDb;
  /** Un file JSON dell'operatore (`--file`), al massimo 1 MB. */
  readJsonFile(path: string): unknown;
  /** Stampa un documento subito: il piano, prima di scrivere. */
  print(output: AdminOutput): void;
  /** Genera il segreto di un token (test: un valore fisso). */
  newTokenSecret(): string;
}

export interface AdminCommand {
  name: ConnectorAdminCommandName;
  options?: AdminOptionSpec;
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

export function done(output: AdminOutput): AdminOutcome {
  return { output, exitCode: 0 };
}

export function stopped(output: AdminOutput): AdminOutcome {
  return { output, exitCode: 1 };
}

/** Il messaggio delle prove a secco. */
export const DRY_RUN_NOTE =
  "Prova a secco: niente è stato scritto. Per scrivere: --apply --confirm-authorized --confirm-database host[:porta]/database --environment local|preview|production (in produzione anche --production-approved).";
