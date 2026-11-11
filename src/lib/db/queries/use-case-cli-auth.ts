import "server-only";
/**
 * Il login della CLI di Unbundle e i suoi token (rilascio 8.0b, docs/rilascio-8/RILASCIO-8.0b-COSTRUZIONE.md §3).
 *
 * 1. `startCliLogin`: la CLI chiede un codice. Si salva l'impronta del codice della CLI e il codice da leggere,
 *    10 minuti.
 * 2. `decideCliLogin`: la persona, con l'accesso fatto, conferma («Collega questa CLI», scegliendo il workspace) o
 *    nega («Non l'ho chiesto io»). Solo un codice vivo e in attesa.
 * 3. `deliverCliLogin`: la CLI chiede il token con il suo codice. Se la persona ha confermato, in una sola
 *    transazione il login diventa «consegnato» e nasce il token (l'UPDATE con la condizione sullo stato fa sì che
 *    due richieste insieme non ne creino due). Il token si vede solo qui, una volta. Nella stessa transazione va in
 *    coda l'e-mail «CLI collegata» alla persona (`cli_collegata`, una per token): se il link di conferma glielo ha
 *    mandato qualcun altro, lo sa subito e revoca da Impostazioni.
 * 4. `authenticateCli`: ogni chiamata della CLI. Solo token della CLI, non revocati, non esposti, non scaduti, con
 *    una persona; l'accesso al workspace e i ruoli nel caso li rilegge chi chiama, a ogni richiesta.
 *
 * Il token sta in `workspace_integration_tokens` (provider `unbundle_cli`), come quello del MCP del team: la revoca
 * è la stessa colonna, e Impostazioni li mostra solo alla persona che li possiede.
 */
import type { UcExecutor } from "@/lib/db/uc-executor";
import { CLI_LIMITS, CLI_PROBE_SQL } from "@/lib/db/use-case-hub-cli-ddl";
import { cast, jsonb, raw, toStatement, ucSql } from "@/lib/uc/sql/statement";
import { fail, ok, type Result } from "@/lib/uc/types";
import { bearerTokenFromHeader } from "@/lib/connector/auth";
import {
  caseScopeOf,
  cleanClientLabel,
  cliScopes,
  CLI_POLL_INTERVAL_SECONDS,
  CLI_TOKEN_DAYS,
  CLI_TOKEN_PREFIX,
  CLI_TOKEN_PROVIDER,
  hashSecret,
  isDeviceCode,
  newCliToken,
  newDeviceCode,
  newUserCode,
  normalizeUserCode,
  tokenPrefixOf,
} from "@/lib/use-cases/cli/codes";

/** Vero se la 0031 è applicata (la stessa sonda di `ensureDbSchema`). */
export async function cliStoreReady(executor: UcExecutor): Promise<boolean> {
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT ${raw(CLI_PROBE_SQL)} AS ready`)]);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

const isUniqueViolation = (error: unknown) => (error as { code?: unknown } | null)?.code === "23505";

/** 1. Un login nuovo: il codice della CLI (da tenere) e quello da leggere. Riprova se il codice da leggere è già vivo. */
export async function startCliLogin(
  executor: UcExecutor,
  input: { clientLabel?: unknown },
): Promise<{ deviceCode: string; userCode: string; expiresInSeconds: number; intervalSeconds: number }> {
  const label = cleanClientLabel(input.clientLabel);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const deviceCode = newDeviceCode();
    const userCode = newUserCode();
    try {
      await executor.batch([
        // La pulizia: un codice scaduto lascia libero il suo codice da leggere; dopo una settimana la riga sparisce.
        toStatement(ucSql`UPDATE use_case_cli_logins SET status = 'scaduto' WHERE status IN ('in_attesa', 'confermato') AND expires_at <= now()`),
        toStatement(ucSql`DELETE FROM use_case_cli_logins WHERE expires_at < now() - make_interval(days => 7)`),
        toStatement(ucSql`INSERT INTO use_case_cli_logins (device_code_hash, user_code, client_label, expires_at)
VALUES (${cast(hashSecret(deviceCode), "text")}, ${cast(userCode, "text")}, ${cast(label, "text")}, now() + make_interval(mins => ${cast(CLI_LIMITS.loginMinutes, "int")}))`),
      ]);
      return { deviceCode, userCode, expiresInSeconds: CLI_LIMITS.loginMinutes * 60, intervalSeconds: CLI_POLL_INTERVAL_SECONDS };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Nessun codice libero dopo cinque tentativi");
}

export interface CliLoginView {
  userCode: string;
  clientLabel: string;
  /** «in_attesa» se si può ancora decidere; gli altri stati come sono; «scaduto» anche se il tempo è finito. */
  status: "in_attesa" | "confermato" | "negato" | "consegnato" | "scaduto";
  expiresAt: string;
}

/** Il login di un codice da leggere, per la pagina di conferma; null se il codice non esiste. */
export async function findCliLogin(executor: UcExecutor, userCodeInput: unknown): Promise<CliLoginView | null> {
  const userCode = normalizeUserCode(userCodeInput);
  if (!userCode) return null;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT user_code, client_label, expires_at, CASE WHEN status IN ('in_attesa', 'confermato') AND expires_at <= now() THEN 'scaduto' ELSE status END AS status
FROM use_case_cli_logins WHERE user_code = ${cast(userCode, "text")} ORDER BY created_at DESC LIMIT 1`),
  ]);
  const row = rows[0];
  if (!row) return null;
  return {
    userCode: String(row.user_code),
    clientLabel: String(row.client_label),
    status: String(row.status) as CliLoginView["status"],
    expiresAt: new Date(String(row.expires_at)).toISOString(),
  };
}

/**
 * 2. La decisione della persona, con l'accesso fatto. `workspaceId` lo controlla chi chiama
 * (`requireWorkspaceAccess`): qui si scrive solo su un login vivo e in attesa.
 */
export async function decideCliLogin(
  executor: UcExecutor,
  input: { userCode: unknown; userId: string; workspaceId: string | null; confirm: boolean },
): Promise<Result<{ status: "confermato" | "negato" }>> {
  const userCode = normalizeUserCode(input.userCode);
  if (!userCode) return fail("dati_non_validi", "Il codice non è valido: controllalo nel terminale.");
  if (input.confirm && !input.workspaceId) return fail("dati_non_validi", "Scegli il workspace.");
  const status = input.confirm ? "confermato" : "negato";
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_cli_logins SET status = ${cast(status, "text")}, user_id = ${cast(input.userId, "uuid")},
  workspace_id = ${cast(input.confirm ? input.workspaceId : null, "uuid")}, decided_at = now()
WHERE user_code = ${cast(userCode, "text")} AND status = 'in_attesa' AND expires_at > now()
RETURNING id`),
  ]);
  if (!rows[0]) return fail("non_trovato", "Il codice è scaduto o è già stato usato: avvia di nuovo «unbundle login».");
  return ok({ status });
}

export type CliDelivery =
  | { status: "consegnato"; token: string; workspaceId: string; expiresAt: string; noticeId: string | null }
  | { status: "in_attesa" | "negato" | "scaduto" | "sconosciuto" | "gia_consegnato" };

/** L'e-mail alla persona quando nasce un token del login della CLI (`uc_notifications`, canale email). */
export const CLI_CONNECTED_TEMPLATE = "cli_collegata";

/**
 * 3. La CLI ritira il token. Prima i login scaduti diventano «scaduti»; poi, se la persona ha confermato, il login
 * diventa «consegnato» e il token nasce nella stessa istruzione, con l'e-mail «CLI collegata» in coda (la chiave di
 * deduplica è il token: una sola e-mail); infine si legge lo stato. `noticeId` è la riga dell'e-mail, da inviare
 * subito dopo la risposta.
 */
export async function deliverCliLogin(executor: UcExecutor, deviceCode: unknown): Promise<CliDelivery> {
  if (!isDeviceCode(deviceCode)) return { status: "sconosciuto" };
  const hash = cast(hashSecret(deviceCode), "text");
  const token = newCliToken();
  const tokenHash = cast(hashSecret(token), "text");
  const [, delivered, , current] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_cli_logins SET status = 'scaduto' WHERE device_code_hash = ${hash} AND status IN ('in_attesa', 'confermato') AND expires_at <= now()`),
    toStatement(ucSql`WITH done AS (
  UPDATE use_case_cli_logins SET status = 'consegnato', delivered_at = now()
  WHERE device_code_hash = ${hash} AND status = 'confermato' AND expires_at > now()
  RETURNING workspace_id, user_id, client_label
), created AS (
  INSERT INTO workspace_integration_tokens (workspace_id, label, provider, token_hash, token_prefix, scopes, created_by_user_id, owner_user_id, expires_at)
  SELECT done.workspace_id, done.client_label, ${cast(CLI_TOKEN_PROVIDER, "text")}, ${tokenHash}, ${cast(tokenPrefixOf(token), "text")}, ${jsonb(cliScopes())},
         done.user_id, done.user_id, now() + make_interval(days => ${cast(CLI_TOKEN_DAYS, "int")})
  FROM done
  RETURNING id, workspace_id, owner_user_id, expires_at
), notice AS (
  INSERT INTO uc_notifications (workspace_id, recipient_user_id, channel, template_key, payload, status, dedupe_key, scheduled_at)
  SELECT created.workspace_id, created.owner_user_id, 'email', ${cast(CLI_CONNECTED_TEMPLATE, "text")}, jsonb_build_object('tokenId', created.id::text), 'in_coda',
         ${cast(CLI_CONNECTED_TEMPLATE, "text")} || ':' || created.id::text, now()
  FROM created
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id
)
SELECT created.workspace_id, created.expires_at, (SELECT notice.id FROM notice) AS notice_id FROM created`),
    toStatement(ucSql`UPDATE use_case_cli_logins SET token_id = (SELECT id FROM workspace_integration_tokens WHERE token_hash = ${tokenHash})
WHERE device_code_hash = ${hash} AND status = 'consegnato' AND token_id IS NULL AND EXISTS (SELECT 1 FROM workspace_integration_tokens WHERE token_hash = ${tokenHash})`),
    toStatement(ucSql`SELECT status FROM use_case_cli_logins WHERE device_code_hash = ${hash}`),
  ]);
  const row = delivered[0];
  if (row) {
    return {
      status: "consegnato",
      token,
      workspaceId: String(row.workspace_id),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      noticeId: row.notice_id === null || row.notice_id === undefined ? null : String(row.notice_id),
    };
  }
  const status = current[0] ? String(current[0].status) : null;
  if (status === "consegnato") return { status: "gia_consegnato" };
  if (status === "in_attesa" || status === "negato" || status === "scaduto") return { status };
  return { status: "sconosciuto" };
}

export interface CliPrincipal {
  tokenId: string;
  workspaceId: string;
  userId: string;
  /** Lo use case del token di un caso solo, o null per un token di tutti i casi della persona. */
  caseUseCaseId: string | null;
  expiresAt: string | null;
}

/** 4. Chi chiama, dal token: null se il token non è valido (401, senza dire perché). */
export async function authenticateCli(executor: UcExecutor, authorization: string | null): Promise<CliPrincipal | null> {
  const token = bearerTokenFromHeader(authorization, CLI_TOKEN_PREFIX);
  if (!token) return null;
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE workspace_integration_tokens SET last_used_at = now()
WHERE token_hash = ${cast(hashSecret(token), "text")} AND provider = ${cast(CLI_TOKEN_PROVIDER, "text")} AND revoked_at IS NULL AND exposed_at IS NULL
  AND owner_user_id IS NOT NULL AND (expires_at IS NULL OR expires_at > now())
RETURNING id, workspace_id, owner_user_id, scopes, expires_at`),
  ]);
  const row = rows[0];
  if (!row) return null;
  const caseScope = caseScopeOf(row.scopes);
  if (caseScope === false) return null;
  return {
    tokenId: String(row.id),
    workspaceId: String(row.workspace_id),
    userId: String(row.owner_user_id),
    caseUseCaseId: caseScope,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
  };
}

/** `unbundle logout`: revoca il token con cui si chiama. */
export async function revokeCliTokenById(executor: UcExecutor, principal: CliPrincipal): Promise<boolean> {
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE workspace_integration_tokens SET revoked_at = now(), updated_at = now()
WHERE id = ${cast(principal.tokenId, "uuid")} AND owner_user_id = ${cast(principal.userId, "uuid")} AND provider = ${cast(CLI_TOKEN_PROVIDER, "text")} AND revoked_at IS NULL
RETURNING id`),
  ]);
  return Boolean(rows[0]);
}

export interface CliTokenView {
  id: string;
  label: string;
  prefix: string;
  /** Il codice dello use case per un token di un caso solo. */
  caseCode: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

/** I collegamenti attivi della persona nel workspace, per Impostazioni: solo i suoi. */
export async function listOwnCliTokens(executor: UcExecutor, input: { userId: string; workspaceId: string }): Promise<CliTokenView[]> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT t.id, t.label, t.token_prefix, t.created_at, t.last_used_at, t.expires_at,
  (SELECT u.code FROM use_cases u WHERE u.workspace_id = t.workspace_id AND ('caso:' || u.id::text) IN (SELECT jsonb_array_elements_text(t.scopes))) AS case_code
FROM workspace_integration_tokens t
WHERE t.owner_user_id = ${cast(input.userId, "uuid")} AND t.workspace_id = ${cast(input.workspaceId, "uuid")} AND t.provider = ${cast(CLI_TOKEN_PROVIDER, "text")}
  AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())
ORDER BY t.created_at DESC LIMIT 50`),
  ]);
  const at = (v: unknown) => (v === null || v === undefined ? null : new Date(String(v)).toISOString());
  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label),
    prefix: String(r.token_prefix),
    caseCode: r.case_code === null || r.case_code === undefined ? null : String(r.case_code),
    createdAt: at(r.created_at) ?? "",
    lastUsedAt: at(r.last_used_at),
    expiresAt: at(r.expires_at),
  }));
}

/**
 * La scheda «CLI di Unbundle» di Impostazioni: i collegamenti della persona nel workspace; null se la scheda non
 * va mostrata (la 0031 non c'è ancora, oppure la persona non è di Lateral Space e non ha collegamenti).
 */
export async function loadCliCard(
  executor: UcExecutor,
  input: { userId: string; workspaceId: string; lateralSpace: boolean },
): Promise<{ tokens: CliTokenView[] } | null> {
  if (!(await cliStoreReady(executor))) return null;
  const tokens = await listOwnCliTokens(executor, input);
  return tokens.length || input.lateralSpace ? { tokens } : null;
}

/** «Revoca» da Impostazioni: solo un token della persona, nel workspace. */
export async function revokeOwnCliToken(executor: UcExecutor, input: { userId: string; workspaceId: string; tokenId: string }): Promise<boolean> {
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE workspace_integration_tokens SET revoked_at = now(), updated_at = now()
WHERE id = ${cast(input.tokenId, "uuid")} AND owner_user_id = ${cast(input.userId, "uuid")} AND workspace_id = ${cast(input.workspaceId, "uuid")}
  AND provider = ${cast(CLI_TOKEN_PROVIDER, "text")} AND revoked_at IS NULL
RETURNING id`),
  ]);
  return Boolean(rows[0]);
}

/**
 * `unbundle mcp <ID>`: un token di un caso solo, per la configurazione MCP di un coding agent. Lo crea un token
 * della persona per tutti i suoi casi (mai un token di un caso solo: non si moltiplica da sé); chi chiama ha già
 * controllato che la persona sia nel team del caso.
 */
export async function createCaseCliToken(
  executor: UcExecutor,
  principal: CliPrincipal,
  input: { useCaseId: string; label: string },
): Promise<Result<{ token: string; expiresAt: string }>> {
  if (principal.caseUseCaseId !== null) return fail("permesso_negato", "Un token di un caso solo non crea altri token: usa «unbundle login».");
  const token = newCliToken();
  const [rows] = await executor.batch([
    toStatement(ucSql`INSERT INTO workspace_integration_tokens (workspace_id, label, provider, token_hash, token_prefix, scopes, created_by_user_id, owner_user_id, expires_at)
VALUES (${cast(principal.workspaceId, "uuid")}, ${cast(cleanClientLabel(input.label), "text")}, ${cast(CLI_TOKEN_PROVIDER, "text")}, ${cast(hashSecret(token), "text")},
  ${cast(tokenPrefixOf(token), "text")}, ${jsonb(cliScopes(input.useCaseId))}, ${cast(principal.userId, "uuid")}, ${cast(principal.userId, "uuid")},
  now() + make_interval(days => ${cast(CLI_TOKEN_DAYS, "int")}))
RETURNING expires_at`),
  ]);
  return ok({ token, expiresAt: new Date(String(rows[0].expires_at)).toISOString() });
}
