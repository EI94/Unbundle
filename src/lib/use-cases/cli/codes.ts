/**
 * I codici e i token della CLI di Unbundle (rilascio 8.0b, docs/rilascio-8/RILASCIO-8.0b-COSTRUZIONE.md §1 e §3).
 *
 * - **Il codice della CLI** (`ub_dev_…`, 32 byte casuali): lo tiene la CLI e lo manda per ritirare il token. In
 *   Unbundle resta solo l'impronta SHA-256.
 * - **Il codice da leggere** (`BCDF-GHJK`): lo vede la persona nel terminale e nella pagina di conferma. Solo
 *   consonanti senza le ambigue (niente parole, niente 0/O), 20⁸ combinazioni; vale 10 minuti e una volta sola.
 * - **Il token** (`ub_cli_…`, 32 byte casuali): si consegna una volta sola, alla CLI che ha il codice giusto,
 *   dopo la conferma nel browser. Sta in `workspace_integration_tokens` (provider `unbundle_cli`), personale, di un
 *   workspace, 90 giorni. Ambiti: `cli`, più `caso:<id dello use case>` per il token di un caso solo (l'MCP).
 * - **L'etichetta** del collegamento la manda la CLI («CLI · macOS · repository-del-caso»): si tiene solo quello
 *   che serve a riconoscerla, mai un indirizzo e-mail.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { CLI_LIMITS, CLI_USER_CODE_ALPHABET } from "../../db/use-case-hub-cli-ddl.ts";

export const CLI_TOKEN_PREFIX = "ub_cli_";
export const CLI_DEVICE_CODE_PREFIX = "ub_dev_";
export const CLI_TOKEN_PROVIDER = "unbundle_cli";
export const CLI_SCOPE = "cli";
export const CLI_CASE_SCOPE_PREFIX = "caso:";
export const CLI_TOKEN_DAYS = 90;
/** Ogni quanti secondi la CLI chiede se la persona ha confermato. */
export const CLI_POLL_INTERVAL_SECONDS = 5;
export const CLI_DEFAULT_LABEL = "CLI di Unbundle";

const SECRET_BODY = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** L'impronta SHA-256 esadecimale di un codice o di un token: in tabella c'è solo questa. */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Un codice da leggere nuovo: otto consonanti, divise da un trattino. */
export function newUserCode(pick: (max: number) => number = randomInt): string {
  let letters = "";
  for (let i = 0; i < 8; i += 1) letters += CLI_USER_CODE_ALPHABET[pick(CLI_USER_CODE_ALPHABET.length)];
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

/**
 * Il codice da leggere come lo scrive una persona («bcdf ghjk», «BCDFGHJK», «bcdf-ghjk»), nella forma canonica;
 * null se non è un codice possibile.
 */
export function normalizeUserCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const letters = input.toUpperCase().replace(/[\s-]/g, "");
  if (letters.length !== 8) return null;
  for (const letter of letters) if (!CLI_USER_CODE_ALPHABET.includes(letter)) return null;
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

/** Il codice della CLI, nuovo. */
export function newDeviceCode(): string {
  return `${CLI_DEVICE_CODE_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Vero se ha la forma di un codice della CLI (prima di toccare il database). */
export function isDeviceCode(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(CLI_DEVICE_CODE_PREFIX) && SECRET_BODY.test(value.slice(CLI_DEVICE_CODE_PREFIX.length));
}

/** Un token della CLI, nuovo. */
export function newCliToken(): string {
  return `${CLI_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Le prime lettere del token, per riconoscerlo in Impostazioni senza mostrarlo. */
export function tokenPrefixOf(token: string): string {
  return token.slice(0, CLI_TOKEN_PREFIX.length + 4);
}

/**
 * L'etichetta del collegamento, pulita: solo lettere, cifre, spazi e « · . _ / ( ) - », niente e-mail, al
 * massimo 80 caratteri; vuota diventa «CLI di Unbundle».
 */
export function cleanClientLabel(input: unknown): string {
  if (typeof input !== "string") return CLI_DEFAULT_LABEL;
  const withoutEmails = input.replace(/\S+@\S+/g, " ");
  const kept = withoutEmails
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ·._/()-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CLI_LIMITS.clientLabel)
    .trim();
  return kept.length > 0 ? kept : CLI_DEFAULT_LABEL;
}

/** Gli ambiti di un token: `cli`, più il caso per il token di un caso solo. */
export function cliScopes(useCaseId?: string | null): string[] {
  if (!useCaseId) return [CLI_SCOPE];
  if (!UUID.test(useCaseId)) throw new Error("Use case non valido");
  return [CLI_SCOPE, `${CLI_CASE_SCOPE_PREFIX}${useCaseId}`];
}

/** Lo use case di un token di un caso solo, o null; `false` se gli ambiti non sono quelli della CLI. */
export function caseScopeOf(scopes: unknown): string | null | false {
  if (!Array.isArray(scopes) || !scopes.includes(CLI_SCOPE)) return false;
  const cases = scopes.filter((s): s is string => typeof s === "string" && s.startsWith(CLI_CASE_SCOPE_PREFIX)).map((s) => s.slice(CLI_CASE_SCOPE_PREFIX.length));
  if (cases.length === 0) return null;
  if (cases.length > 1 || !UUID.test(cases[0])) return false;
  return cases[0];
}
