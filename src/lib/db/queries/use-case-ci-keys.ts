/**
 * Le chiavi della CI (rilascio 8.2b, docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.2, §2.5, §2.7, §2.8): **l'unico modulo che
 * legge e scrive `use_case_ci_keys`** (una prova di guardia lo controlla). Le regole senza database stanno in
 * `src/lib/use-cases/ci/keys.ts`.
 *
 * - **Le azioni della pagina** (`createCiKey`, `rotateCiKey`, `revokeCiKeys`): ognuna in una transazione sola, sotto un
 *   advisory lock per workspace e repository (mai più di due chiavi vive), con il permesso di D6 riletto nella stessa
 *   istruzione (`ciKeyManagerSql`): chi chiama l'azione direttamente non passa. Una chiave nuova (anche di una rotazione)
 *   mette in coda l'e-mail `chiave_ci_creata` a chi gestisce le chiavi del repository, tranne chi l'ha creata.
 * - **Ogni richiesta della CI** (`authenticateCiKey`): l'impronta, una chiave né revocata né scaduta, l'ultimo uso; il
 *   primo invio con la chiave nuova di una rotazione revoca la vecchia (`ruotata`), nella stessa istruzione.
 * - **L'ambito** (`listCiKeyCases`, `findCiKeyCase`): i casi registrati sul repository della chiave nel suo workspace
 *   (con D1 «per caso», solo quel caso), con il dossier aperto.
 * - **Le revoche automatiche:** la chiave in un indirizzo (`revokeExposedCiKeys`, e-mail `chiave_ci_bloccata`); le chiavi
 *   di un repository senza casi (`runCiKeysSweep` nel cron, e `repo-unregister` con `revokeKeysOfUnregisteredRepoSql`);
 *   il workspace cancellato (cascade).
 * - **Il cron** (`runCiKeysSweep`): l'avviso a 14 giorni una volta (`chiave_ci_scade`), le revoche `senza_casi`, la
 *   cancellazione delle chiavi finite da più di 12 mesi.
 * - **Le letture per la pagina** (`loadCiKeyOverview`, `ciKeyManagedRepos`): solo date e prefissi, mai chi ha creato o
 *   revocato una chiave; nessuna lettura raggruppa o ordina per persona (art. 15.4).
 *
 * Mai la chiave in tabella, nei log, nelle e-mail o in una risposta dopo la creazione: esce solo da `createCiKey` e
 * `rotateCiKey`, una volta.
 * Modulo senza import dell'app (`@/…`, `server-only`): lo usano anche il cron, gli script dell'operatore e le prove.
 */
import type { UcExecutor, UcRow } from "../uc-executor.ts";
import { CI_KEYS_PROBE_SQL, CI_KEY_REVOKED_REASONS, type CiKeyRevokedReason } from "../use-case-hub-ci-keys-ddl.ts";
import { rowDate, rowStringArray } from "../../uc/sql/readiness.ts";
import { cast, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { fail, ok, type Result } from "../../uc/types.ts";
import {
  CI_KEY_ACTION_TEXT,
  CI_KEY_DAYS,
  CI_KEY_ERRORS,
  CI_KEY_REMINDER_DAYS,
  CI_KEY_RETENTION_MONTHS,
  CI_KEY_ROTATION_GRACE_DAYS,
  ciKeyCandidates,
  ciKeyDisplayPrefix,
  ciKeyFromAuthorization,
  hashCiKey,
  newCiKey,
  normalizeCiRepo,
  type CiKeyActionRefusal,
  type CiKeyRow,
} from "../../use-cases/ci/keys.ts";
import { COLLABORATOR_ROLES_SQL, PORTFOLIO_REVIEWER_ROLES } from "../../workspace-permissions.ts";

// ─── Le e-mail della chiave (interne di Lateral Space, senza caso) ─────

/** I modelli delle tre e-mail: in coda in `uc_notifications` (`template_key` libero), composti da `renderCiKeyEmail`. */
export const CI_KEY_EMAIL_TEMPLATES = ["chiave_ci_creata", "chiave_ci_scade", "chiave_ci_bloccata"] as const;
export type CiKeyEmailTemplate = (typeof CI_KEY_EMAIL_TEMPLATES)[number];

// ─── Pronta? ─────────────────────────────────────────────────────────

/** Vero se la 0042 è applicata (la stessa sonda di `ensureDbSchema`). Falsa: `/api/ci/*` 503, la riga «Non ancora disponibile». */
export async function ciKeysStoreReady(executor: UcExecutor): Promise<boolean> {
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT ${raw(CI_KEYS_PROBE_SQL)} AS ready`)]);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

// ─── Chi gestisce le chiavi (D6), in SQL ─────────────────────────────

const DOMAIN = /^[a-z0-9.-]{1,253}$/;

/** I domini di Lateral Space come parametro `text[]`, solo nomi di dominio in minuscolo (senza domini nessuno è Lateral Space). */
function domainsParam(lsDomains: readonly string[]): SqlFragment {
  return cast(
    lsDomains.map((d) => d.trim().toLowerCase()).filter((d) => DOMAIN.test(d)),
    "text[]",
  );
}

/**
 * Il ruolo di `ckm_u` nel workspace `ckm_w`: prima quello nell'organizzazione, poi quello nel workspace
 * (`getWorkspaceAccessForUser`). Gli alias `ckm_*` sono solo di questo predicato: chi lo usa dentro un'altra istruzione
 * gli passa il repository con i suoi alias (`k.repo`, `created.repo`) senza che un alias interno lo nasconda.
 */
const ROLE_SQL = raw(`coalesce(
    (SELECT ckm_om.role::text FROM memberships ckm_om WHERE ckm_om.user_id = ckm_u.id AND ckm_om.organization_id = ckm_w.organization_id LIMIT 1),
    (SELECT ckm_wm.role::text FROM workspace_memberships ckm_wm WHERE ckm_wm.user_id = ckm_u.id AND ckm_wm.workspace_id = ckm_w.id LIMIT 1)
  )`);

/**
 * Chi gestisce le chiavi del repository `repo` nel workspace `workspace` (D6): le persone del workspace con l'e-mail
 * verificata in un dominio di Lateral Space e un ruolo da revisore (chi gestisce il workspace, `lsManager`), oppure
 * responsabili (`ls_lead`) di un caso aperto (dossier non chiuso) registrato sul repository. Mai chi segue solo un corso.
 * `repo` null: solo chi gestisce il workspace. Colonna `user_id`; `only`: una persona sola (il controllo di chi agisce).
 * Nessun ORDER BY, nessun conteggio.
 */
export function ciKeyManagersSql(workspace: SqlFragment, repo: SqlFragment | null, lsDomains: readonly string[], only: SqlFragment | null = null): SqlFragment {
  const leads = repo
    ? ucSql`
    OR EXISTS (SELECT 1 FROM uc_case_members ckm_m
      JOIN uc_cases ckm_c ON ckm_c.id = ckm_m.case_id AND ckm_c.workspace_id = ckm_w.id AND ckm_c.status <> 'chiuso'
      JOIN use_case_repos ckm_r ON ckm_r.use_case_id = ckm_c.portfolio_use_case_id AND ckm_r.workspace_id = ckm_c.workspace_id
      WHERE ckm_m.user_id = ckm_u.id AND ckm_m.role = 'ls_lead' AND lower(ckm_r.repo) = lower(${repo}))`
    : raw("");
  return ucSql`SELECT ckm_u.id AS user_id
FROM workspaces ckm_w
JOIN users ckm_u ON ckm_u.id IN (
  SELECT ckm_om.user_id FROM memberships ckm_om WHERE ckm_om.organization_id = ckm_w.organization_id
  UNION SELECT ckm_wm.user_id FROM workspace_memberships ckm_wm WHERE ckm_wm.workspace_id = ckm_w.id
)
CROSS JOIN LATERAL (SELECT ${ROLE_SQL} AS role) ckm_role
WHERE ckm_w.id = ${workspace}${only ? ucSql` AND ckm_u.id = ${only}` : raw("")}
  AND ckm_u.email_verified IS NOT NULL
  AND coalesce(lower(substring(btrim(ckm_u.email) from '@([^@]+)$')) = ANY(${domainsParam(lsDomains)}), false)
  AND ckm_role.role IN (${raw(COLLABORATOR_ROLES_SQL)})
  AND (ckm_role.role = ANY(${cast([...PORTFOLIO_REVIEWER_ROLES], "text[]")})${leads})
LIMIT 200`;
}

/**
 * I repository di cui la persona gestisce le chiavi nel workspace: `all` per chi gestisce il workspace (tutti), altrimenti
 * quelli dei casi aperti di cui è responsabile (in minuscolo). Per la pagina: chi vede «Collega la CI», «Ruota» e
 * «Revoca», e «Da fare per te».
 */
export async function ciKeyManagedRepos(
  executor: UcExecutor,
  input: { workspaceId: string; userId: string; lsDomains: readonly string[] },
): Promise<{ all: boolean; repos: ReadonlySet<string> }> {
  const ws = cast(input.workspaceId, "uuid");
  const me = cast(input.userId, "uuid");
  const [all, rows] = await executor.batch([
    toStatement(ucSql`SELECT EXISTS (${ciKeyManagersSql(ws, null, input.lsDomains, me)}) AS ok`),
    toStatement(ucSql`SELECT lower(reg.repo) AS repo, EXISTS (${ciKeyManagersSql(ws, raw("reg.repo"), input.lsDomains, me)}) AS manages
FROM (SELECT DISTINCT repo FROM use_case_repos WHERE workspace_id = ${ws}) reg`),
  ]);
  return { all: all[0]?.ok === true, repos: new Set(rows.filter((r) => r.manages === true).map((r) => String(r.repo))) };
}

// ─── Le azioni della pagina ──────────────────────────────────────────

/** Chi agisce dalla pagina: la persona della sessione, con l'accesso al workspace già controllato. */
export interface CiKeyActor {
  userId: string;
}

/** Una chiave appena creata (o nata da una rotazione): **la chiave si vede solo qui, una volta**. */
export interface CiKeyIssued {
  /** La chiave, da mostrare una volta e mai più. */
  key: string;
  keyId: string;
  /** Il repository come è registrato (`owner/nome`). */
  repo: string;
  /** `ub_ci_ab12`. */
  prefix: string;
  createdAt: Date;
  expiresAt: Date;
  /** Solo dopo una rotazione: la vecchia, e fino a quando vale al massimo. */
  replaced: { keyId: string; until: Date } | null;
  /** Le e-mail `chiave_ci_creata` in coda: da inviare subito dopo la risposta (`dispatchDue`). */
  noticeIds: string[];
}

const LOCK_PREFIX = "unbundle:use-case-ci-key:";
// Le durate in ore, non in giorni: `now() + interval 'N days'` segue il fuso della sessione e, a cavallo del cambio d'ora,
// darebbe un'ora in più o in meno. 180 giorni sono 4.320 ore, sempre.

/** L'advisory lock di un repository in un workspace: create, rotazioni e revoche dello stesso repository una alla volta. */
function repoLockSql(workspaceId: string, repo: string): UcStatement {
  return toStatement(ucSql`SELECT pg_advisory_xact_lock(hashtext(${cast(`${LOCK_PREFIX}${workspaceId.toLowerCase()}:${repo.toLowerCase()}`, "text")}))`);
}

/** Le chiavi del repository `repo` nel workspace `ws`, alias `k`. */
const ofRepo = (alias: string, ws: SqlFragment, repo: SqlFragment) => ucSql`${raw(alias)}.workspace_id = ${ws} AND lower(${raw(alias)}.repo) = lower(${repo})`;
/** Viva: né revocata né scaduta. */
const live = (alias: string) => raw(`${alias}.revoked_at IS NULL AND ${alias}.expires_at > now()`);

/** Le e-mail di una chiave a chi gestisce le chiavi del suo repository (tranne `except`), una per chiave, modello e persona. */
function keyNoticesSql(template: CiKeyEmailTemplate, from: string, lsDomains: readonly string[], except: SqlFragment | null): SqlFragment {
  const k = raw(from);
  return ucSql`INSERT INTO uc_notifications (workspace_id, recipient_user_id, channel, template_key, payload, status, dedupe_key, scheduled_at)
  SELECT ${k}.workspace_id, m.user_id, 'email', ${cast(template, "text")}, jsonb_build_object('keyId', ${k}.id::text), 'in_coda',
         ${cast(`${template}:`, "text")} || ${k}.id::text || ':' || m.user_id::text, now()
  FROM ${k} CROSS JOIN LATERAL (${ciKeyManagersSql(raw(`${from}.workspace_id`), raw(`${from}.repo`), lsDomains)}) m
  ${except ? ucSql`WHERE m.user_id IS DISTINCT FROM ${except}` : raw("")}
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id`;
}

const textArray = (v: unknown): string[] => rowStringArray(v);
/** Una data letta: `Date` o testo del driver; mai «Invalid Date» in una riga che la colonna dice NOT NULL. */
function at(v: unknown): Date {
  const d = rowDate(v);
  if (!d) throw new Error("Data della chiave della CI non leggibile");
  return d;
}

function refuse<T>(code: CiKeyActionRefusal): Result<T> {
  return fail(code, CI_KEY_ACTION_TEXT[code]);
}

/** Il primo «no», nell'ordine: il permesso, poi la registrazione del repository, poi le chiavi. */
function firstRefusal(row: UcRow | undefined, extra: () => CiKeyActionRefusal | null): CiKeyActionRefusal {
  if (!row || row.allowed !== true) return "permesso_negato";
  if (row.registered === null || row.registered === undefined) return "repo_senza_casi";
  return extra() ?? "non_riuscito";
}

/**
 * «Collega la CI» › «Crea la chiave»: una chiave nuova per il repository, se non ne ha una viva e ha casi registrati nel
 * workspace. 180 giorni. In coda `chiave_ci_creata` a chi gestisce le chiavi, tranne chi l'ha creata.
 */
export async function createCiKey(
  executor: UcExecutor,
  input: { workspaceId: string; repo: unknown; actor: CiKeyActor; lsDomains: readonly string[] },
): Promise<Result<CiKeyIssued>> {
  const repo = normalizeCiRepo(input.repo);
  if (!repo) return refuse("dati_non_validi");
  if (!(await ciKeysStoreReady(executor))) return refuse("non_disponibile");
  const key = newCiKey();
  const ws = cast(input.workspaceId, "uuid");
  const repoParam = cast(repo, "text");
  const actor = cast(input.actor.userId, "uuid");
  const [, rows] = await executor.batch([
    repoLockSql(input.workspaceId, repo),
    toStatement(ucSql`WITH facts AS (
  SELECT EXISTS (${ciKeyManagersSql(ws, repoParam, input.lsDomains, actor)}) AS allowed,
    (SELECT r.repo FROM use_case_repos r WHERE r.workspace_id = ${ws} AND lower(r.repo) = lower(${repoParam}) ORDER BY r.created_at, r.id LIMIT 1) AS registered,
    (SELECT count(*)::int FROM use_case_ci_keys k WHERE ${ofRepo("k", ws, repoParam)} AND ${live("k")}) AS live
), created AS (
  INSERT INTO use_case_ci_keys (workspace_id, repo, token_hash, token_prefix, created_by_user_id, expires_at)
  SELECT ${ws}, facts.registered, ${cast(hashCiKey(key), "text")}, ${cast(ciKeyDisplayPrefix(key), "text")}, ${actor}, now() + make_interval(hours => ${cast(CI_KEY_DAYS * 24, "int")})
  FROM facts WHERE facts.allowed AND facts.registered IS NOT NULL AND facts.live = 0
  RETURNING id, workspace_id, repo, created_at, expires_at
), notices AS (
  ${keyNoticesSql("chiave_ci_creata", "created", input.lsDomains, actor)}
)
SELECT facts.allowed, facts.registered, facts.live, created.id, created.repo, created.created_at, created.expires_at,
  coalesce((SELECT array_agg(notices.id::text) FROM notices), '{}'::text[]) AS notice_ids
FROM facts LEFT JOIN created ON true`),
  ]);
  const row = rows[0];
  if (!row?.id) return refuse(firstRefusal(row, () => (Number(row?.live ?? 0) > 0 ? "gia_collegata" : null)));
  return ok({
    key,
    keyId: String(row.id),
    repo: String(row.repo),
    prefix: ciKeyDisplayPrefix(key),
    createdAt: at(row.created_at),
    expiresAt: at(row.expires_at),
    replaced: null,
    noticeIds: textArray(row.notice_ids),
  });
}

/**
 * «Ruota la chiave»: una chiave nuova, che sostituisce quella viva; la vecchia vale ancora al più 7 giorni (e il primo
 * invio con la nuova la revoca). Si rifiuta senza una chiave viva (`nessuna_chiave`) e con una rotazione in corso: due
 * chiavi vive, o una chiave nuova mai usata la cui vecchia vale ancora (`rotazione_in_corso`, `rotationPending`). Finita la
 * vecchia, la nuova mai usata si può ruotare di nuovo. In coda `chiave_ci_creata`, come una chiave nuova.
 */
export async function rotateCiKey(
  executor: UcExecutor,
  input: { workspaceId: string; repo: unknown; actor: CiKeyActor; lsDomains: readonly string[] },
): Promise<Result<CiKeyIssued>> {
  const repo = normalizeCiRepo(input.repo);
  if (!repo) return refuse("dati_non_validi");
  if (!(await ciKeysStoreReady(executor))) return refuse("non_disponibile");
  const key = newCiKey();
  const ws = cast(input.workspaceId, "uuid");
  const repoParam = cast(repo, "text");
  const actor = cast(input.actor.userId, "uuid");
  const [, rows] = await executor.batch([
    repoLockSql(input.workspaceId, repo),
    toStatement(ucSql`WITH facts AS (
  SELECT EXISTS (${ciKeyManagersSql(ws, repoParam, input.lsDomains, actor)}) AS allowed,
    (SELECT r.repo FROM use_case_repos r WHERE r.workspace_id = ${ws} AND lower(r.repo) = lower(${repoParam}) ORDER BY r.created_at, r.id LIMIT 1) AS registered,
    (SELECT count(*)::int FROM use_case_ci_keys k WHERE ${ofRepo("k", ws, repoParam)} AND ${live("k")}) AS live,
    EXISTS (SELECT 1 FROM use_case_ci_keys k WHERE ${ofRepo("k", ws, repoParam)} AND ${live("k")} AND k.replaces_key_id IS NOT NULL AND k.last_used_at IS NULL
      AND EXISTS (SELECT 1 FROM use_case_ci_keys o WHERE o.id = k.replaces_key_id AND o.workspace_id = k.workspace_id AND ${live("o")})) AS pending
), current_key AS (
  SELECT k.id FROM use_case_ci_keys k WHERE ${ofRepo("k", ws, repoParam)} AND ${live("k")} ORDER BY k.created_at DESC, k.id DESC LIMIT 1
), created AS (
  INSERT INTO use_case_ci_keys (workspace_id, repo, token_hash, token_prefix, replaces_key_id, created_by_user_id, expires_at)
  SELECT ${ws}, facts.registered, ${cast(hashCiKey(key), "text")}, ${cast(ciKeyDisplayPrefix(key), "text")}, current_key.id, ${actor}, now() + make_interval(hours => ${cast(CI_KEY_DAYS * 24, "int")})
  FROM facts CROSS JOIN current_key
  WHERE facts.allowed AND facts.registered IS NOT NULL AND facts.live = 1 AND NOT facts.pending
  RETURNING id, workspace_id, repo, created_at, expires_at, replaces_key_id
), shortened AS (
  UPDATE use_case_ci_keys o SET expires_at = least(o.expires_at, now() + make_interval(hours => ${cast(CI_KEY_ROTATION_GRACE_DAYS * 24, "int")}))
  FROM created WHERE o.id = created.replaces_key_id AND o.workspace_id = created.workspace_id
  RETURNING o.id, o.expires_at
), notices AS (
  ${keyNoticesSql("chiave_ci_creata", "created", input.lsDomains, actor)}
)
SELECT facts.allowed, facts.registered, facts.live, facts.pending, created.id, created.repo, created.created_at, created.expires_at,
  shortened.id AS old_id, shortened.expires_at AS old_until,
  coalesce((SELECT array_agg(notices.id::text) FROM notices), '{}'::text[]) AS notice_ids
FROM facts LEFT JOIN created ON true LEFT JOIN shortened ON true`),
  ]);
  const row = rows[0];
  if (!row?.id) {
    return refuse(
      firstRefusal(row, () => {
        const n = Number(row?.live ?? 0);
        if (n === 0) return "nessuna_chiave";
        return n >= 2 || row?.pending === true ? "rotazione_in_corso" : null;
      }),
    );
  }
  return ok({
    key,
    keyId: String(row.id),
    repo: String(row.repo),
    prefix: ciKeyDisplayPrefix(key),
    createdAt: at(row.created_at),
    expiresAt: at(row.expires_at),
    replaced: row.old_id ? { keyId: String(row.old_id), until: at(row.old_until) } : null,
    noticeIds: textArray(row.notice_ids),
  });
}

/**
 * «Revoca la chiave»: da subito, le chiavi non revocate del repository (le vive, e una scaduta che resti), con il motivo
 * `a_mano` e chi l'ha fatto (solo nel registro). Senza chiavi da revocare: `nessuna_chiave`.
 */
export async function revokeCiKeys(
  executor: UcExecutor,
  input: { workspaceId: string; repo: unknown; actor: CiKeyActor; lsDomains: readonly string[] },
): Promise<Result<{ repo: string; revoked: number }>> {
  const repo = normalizeCiRepo(input.repo);
  if (!repo) return refuse("dati_non_validi");
  if (!(await ciKeysStoreReady(executor))) return refuse("non_disponibile");
  const ws = cast(input.workspaceId, "uuid");
  const repoParam = cast(repo, "text");
  const actor = cast(input.actor.userId, "uuid");
  const [, rows] = await executor.batch([
    repoLockSql(input.workspaceId, repo),
    toStatement(ucSql`WITH facts AS (
  SELECT EXISTS (${ciKeyManagersSql(ws, repoParam, input.lsDomains, actor)}) AS allowed
), revoked AS (
  UPDATE use_case_ci_keys k SET revoked_at = now(), revoked_reason = 'a_mano', revoked_by_user_id = ${actor}
  FROM facts WHERE facts.allowed AND ${ofRepo("k", ws, repoParam)} AND k.revoked_at IS NULL
  RETURNING k.id
)
SELECT facts.allowed, (SELECT count(*)::int FROM revoked) AS revoked FROM facts`),
  ]);
  const row = rows[0];
  if (row?.allowed !== true) return refuse("permesso_negato");
  const revoked = Number(row.revoked ?? 0);
  if (revoked === 0) return refuse("nessuna_chiave");
  return ok({ repo, revoked });
}

// ─── Ogni richiesta della CI ─────────────────────────────────────────

/** Chi chiama dalla CI: una chiave, un workspace, un repository. Nessuna persona. */
export interface CiKeyPrincipal {
  keyId: string;
  workspaceId: string;
  /** `owner/nome`, come è registrato. */
  repo: string;
  /** Con D1 «per caso» (più avanti) il solo caso della chiave; null: i casi registrati sul repository. */
  useCaseId: string | null;
  /** ISO: per l'avviso del job «scade il …». */
  expiresAt: string;
  /** Vero se questo è il primo invio con la chiave nuova di una rotazione: la vecchia è stata revocata adesso. */
  revokedPrevious: boolean;
}

/**
 * Chi chiama, dalla chiave (`Authorization: Bearer ub_ci_…`): null se manca, non è una chiave della CI, è revocata o
 * scaduta (401, senza dire perché). Aggiorna l'ultimo uso; se la chiave sostituisce una chiave ancora non revocata, quella
 * si revoca adesso (`ruotata`), nella stessa istruzione. La 0042 la controlla chi chiama (`ciKeysStoreReady`, 503).
 */
export async function authenticateCiKey(executor: UcExecutor, authorization: string | null): Promise<CiKeyPrincipal | null> {
  const key = ciKeyFromAuthorization(authorization);
  if (!key) return null;
  const [rows] = await executor.batch([
    toStatement(ucSql`WITH k AS (
  UPDATE use_case_ci_keys SET last_used_at = now()
  WHERE token_hash = ${cast(hashCiKey(key), "text")} AND revoked_at IS NULL AND expires_at > now()
  RETURNING id, workspace_id, repo, use_case_id, expires_at, replaces_key_id
), previous AS (
  UPDATE use_case_ci_keys o SET revoked_at = now(), revoked_reason = 'ruotata'
  FROM k WHERE o.id = k.replaces_key_id AND o.workspace_id = k.workspace_id AND o.revoked_at IS NULL
  RETURNING o.id
)
SELECT k.id, k.workspace_id, k.repo, k.use_case_id, k.expires_at, (SELECT count(*)::int FROM previous) AS previous FROM k`),
  ]);
  const row = rows[0];
  if (!row) return null;
  return {
    keyId: String(row.id),
    workspaceId: String(row.workspace_id),
    repo: String(row.repo),
    useCaseId: row.use_case_id === null || row.use_case_id === undefined ? null : String(row.use_case_id),
    expiresAt: at(row.expires_at).toISOString(),
    revokedPrevious: Number(row.previous ?? 0) > 0,
  };
}

/** Un caso del repository della chiave, come lo vede la CI: mai una persona. */
export interface CiKeyCase {
  useCaseId: string;
  /** Il codice dello use case (`XX-0012`). */
  code: string;
  /** `casi/xx-0012`. */
  folder: string;
  /** Il dossier (`uc_cases.id`), se c'è. */
  dossierId: string | null;
  /** Il dossier c'è ed è aperto: né chiuso né in pausa. */
  open: boolean;
  /** Perché non è aperto. */
  why: "chiuso" | "sospeso" | "senza_dossier" | null;
}

function caseOf(r: UcRow): CiKeyCase {
  const status = r.status === null || r.status === undefined ? null : String(r.status);
  const dossierId = r.case_id === null || r.case_id === undefined ? null : String(r.case_id);
  const why = !dossierId ? "senza_dossier" : status === "chiuso" ? "chiuso" : status === "sospeso" ? "sospeso" : null;
  return { useCaseId: String(r.use_case_id), code: String(r.code ?? ""), folder: String(r.folder), dossierId, open: why === null, why };
}

function casesOfKeySql(principal: CiKeyPrincipal, code: string | null): UcStatement {
  const onlyCase = principal.useCaseId ? ucSql` AND u.id = ${cast(principal.useCaseId, "uuid")}` : raw("");
  const onlyCode = code ? ucSql` AND upper(u.code) = upper(${cast(code, "text")})` : raw("");
  return toStatement(ucSql`SELECT u.id AS use_case_id, u.code, r.folder, c.id AS case_id, c.status
FROM use_case_repos r
JOIN use_cases u ON u.id = r.use_case_id AND u.workspace_id = r.workspace_id
LEFT JOIN uc_cases c ON c.portfolio_use_case_id = u.id AND c.workspace_id = u.workspace_id
WHERE r.workspace_id = ${cast(principal.workspaceId, "uuid")} AND lower(r.repo) = lower(${cast(principal.repo, "text")})${onlyCase}${onlyCode}
ORDER BY u.code NULLS LAST, r.folder, r.id
LIMIT 200`);
}

/** `GET /api/ci/casi`: i casi registrati sul repository della chiave nel suo workspace (con D1 «per caso», solo quello). */
export async function listCiKeyCases(executor: UcExecutor, principal: CiKeyPrincipal): Promise<CiKeyCase[]> {
  const [rows] = await executor.batch([casesOfKeySql(principal, null)]);
  return rows.map(caseOf);
}

const CASE_CODE = /^[A-Za-z0-9-]{3,40}$/;

/**
 * Il caso di un invio della CI: registrato sul repository della chiave e nel suo workspace (404 `non_trovato`), con il
 * dossier (409 `senza_dossier`), aperto (409 `caso_chiuso`, `caso_sospeso`). I messaggi sono quelli di `CI_KEY_ERRORS`.
 */
export async function findCiKeyCase(executor: UcExecutor, principal: CiKeyPrincipal, code: unknown): Promise<Result<CiKeyCase>> {
  if (typeof code !== "string" || !CASE_CODE.test(code.trim())) return fail("non_trovato", CI_KEY_ERRORS.non_trovato.message);
  const [rows] = await executor.batch([casesOfKeySql(principal, code.trim())]);
  if (rows.length === 0) return fail("non_trovato", CI_KEY_ERRORS.non_trovato.message);
  const found = rows.map(caseOf);
  const c = found.find((x) => x.open) ?? found[0];
  if (c.why === "senza_dossier") return fail("senza_dossier", CI_KEY_ERRORS.senza_dossier.message);
  if (c.why === "chiuso") return fail("caso_chiuso", CI_KEY_ERRORS.caso_chiuso.message);
  if (c.why === "sospeso") return fail("caso_sospeso", CI_KEY_ERRORS.caso_sospeso.message);
  return ok(c);
}

// ─── La chiave in un indirizzo ───────────────────────────────────────

/**
 * Le chiavi della CI trovate in un indirizzo (`findTokenInUrl`): si revocano subito (`esposta`), solo se erano vive, e
 * va in coda `chiave_ci_bloccata` a chi gestisce le chiavi del repository. Gli altri token si ignorano. Senza la 0042
 * non fa niente. `noticeIds`: da inviare subito dopo la risposta.
 */
export async function revokeExposedCiKeys(executor: UcExecutor, candidates: readonly string[], lsDomains: readonly string[]): Promise<{ revoked: number; noticeIds: string[] }> {
  const keys = ciKeyCandidates(candidates);
  if (keys.length === 0 || !(await ciKeysStoreReady(executor))) return { revoked: 0, noticeIds: [] };
  const [rows] = await executor.batch([
    toStatement(ucSql`WITH revoked AS (
  UPDATE use_case_ci_keys k SET revoked_at = now(), revoked_reason = 'esposta'
  WHERE k.token_hash = ANY(${cast(keys.map(hashCiKey), "text[]")}) AND ${live("k")}
  RETURNING k.id, k.workspace_id, k.repo
), notices AS (
  ${keyNoticesSql("chiave_ci_bloccata", "revoked", lsDomains, null)}
)
SELECT (SELECT count(*)::int FROM revoked) AS revoked, coalesce((SELECT array_agg(notices.id::text) FROM notices), '{}'::text[]) AS notice_ids`),
  ]);
  return { revoked: Number(rows[0]?.revoked ?? 0), noticeIds: textArray(rows[0]?.notice_ids) };
}

// ─── Le letture per la pagina ────────────────────────────────────────

/** Un repository dei casi del workspace con le sue chiavi, per la riga della famiglia e «Da fare per te». */
export interface CiKeyRepoOverview {
  /** `owner/nome`, come è registrato. */
  repo: string;
  /** Le chiavi del repository (vive, scadute o revocate, non ancora cancellate), dalla più nuova; al massimo 10. */
  keys: CiKeyRow[];
  /** I casi del repository con il progetto approvato e il dossier non chiuso: «Collega la CI» in «Da fare per te». */
  approvedCases: number;
}

const REVOKED_REASONS: ReadonlySet<string> = new Set(CI_KEY_REVOKED_REASONS);

function keyRowOf(r: UcRow): CiKeyRow {
  const date = (v: unknown) => rowDate(v);
  const reason = r.revoked_reason === null || r.revoked_reason === undefined ? null : String(r.revoked_reason);
  return {
    id: String(r.id),
    repo: String(r.repo),
    prefix: String(r.token_prefix),
    createdAt: at(r.created_at),
    expiresAt: at(r.expires_at),
    lastUsedAt: date(r.last_used_at),
    remindedAt: date(r.reminded_at),
    revokedAt: date(r.revoked_at),
    revokedReason: reason && REVOKED_REASONS.has(reason) ? (reason as CiKeyRevokedReason) : null,
    replacesKeyId: r.replaces_key_id === null || r.replaces_key_id === undefined ? null : String(r.replaces_key_id),
  };
}

/** Le colonne di una chiave che leggono la pagina e le regole: mai l'impronta, mai chi l'ha creata o revocata. */
const KEY_COLUMNS = raw("k.id, k.repo, k.token_prefix, k.created_at, k.expires_at, k.last_used_at, k.reminded_at, k.revoked_at, k.revoked_reason, k.replaces_key_id");

/**
 * I repository dei casi del workspace (quelli di `use_case_repos`), ognuno con le sue chiavi e i casi dal progetto
 * approvato in poi. La chiave della mappa è il repository in minuscolo. `ready` falso (la 0042 non c'è): nessuna chiave
 * letta, la riga dice «Non ancora disponibile».
 */
export async function loadCiKeyOverview(executor: UcExecutor, input: { workspaceId: string }): Promise<{ ready: boolean; repos: Map<string, CiKeyRepoOverview> }> {
  const ws = cast(input.workspaceId, "uuid");
  const ready = await ciKeysStoreReady(executor);
  const [repoRows, keyRows] = await executor.batch([
    toStatement(ucSql`SELECT min(r.repo) AS repo, lower(r.repo) AS repo_key,
  count(DISTINCT u.id) FILTER (WHERE EXISTS (SELECT 1 FROM use_case_projects p WHERE p.use_case_id = u.id AND p.workspace_id = u.workspace_id AND p.status = 'approvato')
    AND EXISTS (SELECT 1 FROM uc_cases c WHERE c.portfolio_use_case_id = u.id AND c.workspace_id = u.workspace_id AND c.status <> 'chiuso'))::int AS approved
FROM use_case_repos r JOIN use_cases u ON u.id = r.use_case_id AND u.workspace_id = r.workspace_id
WHERE r.workspace_id = ${ws}
GROUP BY lower(r.repo)`),
    ready
      ? toStatement(ucSql`SELECT ${KEY_COLUMNS} FROM (
  SELECT ${KEY_COLUMNS}, row_number() OVER (PARTITION BY lower(k.repo) ORDER BY k.created_at DESC, k.id DESC) AS n FROM use_case_ci_keys k WHERE k.workspace_id = ${ws}
) k WHERE k.n <= 10 ORDER BY lower(k.repo), k.created_at DESC, k.id DESC`)
      : toStatement(ucSql`SELECT NULL::uuid AS id WHERE false`),
  ]);
  const repos = new Map<string, CiKeyRepoOverview>();
  for (const r of repoRows) repos.set(String(r.repo_key), { repo: String(r.repo), keys: [], approvedCases: Number(r.approved ?? 0) });
  for (const r of keyRows) repos.get(String(r.repo).toLowerCase())?.keys.push(keyRowOf(r));
  return { ready, repos };
}

// ─── Le e-mail: i fatti al momento dell'invio ────────────────────────

/** Quello che serve a decidere e comporre un'e-mail della chiave: il repository, le date, e se chi riceve gestisce ancora le chiavi. */
export interface CiKeyMailFacts {
  repo: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: CiKeyRevokedReason | null;
  /** Chi riceve gestisce ancora le chiavi del repository (D6), riletto adesso. */
  recipientManages: boolean;
  /** Il repository ha una chiave viva più nuova: la rotazione è avvenuta (l'avviso di scadenza non serve più). */
  superseded: boolean;
}

/** I fatti di un'e-mail della chiave (`payload.keyId`), solo nel workspace della riga; null se la chiave non c'è più. */
export async function ciKeyMailFacts(
  executor: UcExecutor,
  input: { keyId: string; workspaceId: string; recipientUserId: string; lsDomains: readonly string[] },
): Promise<CiKeyMailFacts | null> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT k.repo, k.created_at, k.expires_at, k.revoked_at, k.revoked_reason,
  EXISTS (${ciKeyManagersSql(raw("k.workspace_id"), raw("k.repo"), input.lsDomains, cast(input.recipientUserId, "uuid"))}) AS manages,
  EXISTS (SELECT 1 FROM use_case_ci_keys n WHERE n.workspace_id = k.workspace_id AND lower(n.repo) = lower(k.repo) AND n.id <> k.id AND ${live("n")} AND n.created_at > k.created_at) AS superseded
FROM use_case_ci_keys k WHERE k.id = ${cast(input.keyId, "uuid")} AND k.workspace_id = ${cast(input.workspaceId, "uuid")}`),
  ]);
  const r = rows[0];
  if (!r) return null;
  const reason = r.revoked_reason === null || r.revoked_reason === undefined ? null : String(r.revoked_reason);
  return {
    repo: String(r.repo),
    createdAt: at(r.created_at),
    expiresAt: at(r.expires_at),
    revokedAt: rowDate(r.revoked_at),
    revokedReason: reason && REVOKED_REASONS.has(reason) ? (reason as CiKeyRevokedReason) : null,
    recipientManages: r.manages === true,
    superseded: r.superseded === true,
  };
}

// ─── Il cron e l'operatore ───────────────────────────────────────────

/** Le chiavi del repository `repo` non revocate quando il workspace non ha più casi registrati lì: `senza_casi`. */
export function revokeKeysOfUnregisteredRepoSql(workspaceId: string, repo: string): UcStatement {
  const ws = cast(workspaceId, "uuid");
  const repoParam = cast(repo, "text");
  return toStatement(ucSql`UPDATE use_case_ci_keys k SET revoked_at = now(), revoked_reason = 'senza_casi'
WHERE ${ofRepo("k", ws, repoParam)} AND k.revoked_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM use_case_repos r WHERE r.workspace_id = ${ws} AND lower(r.repo) = lower(${repoParam}))
RETURNING k.id`);
}

/** Per `repo-unregister` a secco: le chiavi non revocate del repository nel workspace (si revocano se non restano casi). */
export function unrevokedKeysOfRepoSql(workspaceId: string, repo: string): UcStatement {
  return toStatement(ucSql`SELECT count(*)::int AS n FROM use_case_ci_keys k WHERE ${ofRepo("k", cast(workspaceId, "uuid"), cast(repo, "text"))} AND k.revoked_at IS NULL`);
}

/** L'espressione SQL vera se la tabella della 0042 c'è (per gli script dell'operatore: `repo-unregister`). */
export const CI_KEYS_PRESENT_SQL = "to_regclass('public.use_case_ci_keys') IS NOT NULL";

/** Vero se la tabella della 0042 c'è: per gli script dell'operatore, che leggono la sonda da sé. */
export const CI_KEYS_TABLE_SQL = `SELECT ${CI_KEYS_PRESENT_SQL} AS ok`;

/** `use-case-admin ci-keys`: le chiavi del workspace, con repository, prefisso, date e stato. Mai la chiave, mai chi. */
export function ciKeysAdminListSql(workspaceId: string): UcStatement {
  return toStatement(ucSql`SELECT ${KEY_COLUMNS} FROM use_case_ci_keys k WHERE k.workspace_id = ${cast(workspaceId, "uuid")}
ORDER BY lower(k.repo), k.created_at DESC, k.id DESC LIMIT 500`);
}

/** La riga di `ciKeysAdminListSql` letta (per lo script). */
export function ciKeyRowFrom(row: Record<string, unknown>): CiKeyRow {
  return keyRowOf(row);
}

/** `use-case-admin ci-key-revoke --apply`: le chiavi non revocate del repository, revocate dall'operatore (`a_mano`, senza persona). */
export function ciKeyAdminRevokeSql(workspaceId: string, repo: string): UcStatement {
  return toStatement(ucSql`UPDATE use_case_ci_keys k SET revoked_at = now(), revoked_reason = 'a_mano'
WHERE ${ofRepo("k", cast(workspaceId, "uuid"), cast(repo, "text"))} AND k.revoked_at IS NULL
RETURNING k.id`);
}

/** Che cosa ha fatto il passo delle chiavi nel cron. */
export interface CiKeysSweepSummary {
  /** La 0042 c'è: senza, il passo non fa niente. */
  ready: boolean;
  /** Chiavi avvisate a 14 giorni dalla fine (e le e-mail in coda). */
  reminded: number;
  reminderNotices: number;
  /** Chiavi revocate perché il repository non ha più casi registrati. */
  revokedWithoutCases: number;
  /** Chiavi finite da più di 12 mesi, cancellate. */
  deleted: number;
}

/**
 * Il passo delle chiavi nel cron dei dossier (uc-reminders, giorni feriali, nella finestra d'invio, prima dell'invio):
 * 1. le chiavi di un repository che non ha più casi registrati nel workspace (o, con D1 «per caso», il cui caso non è più
 *    registrato lì) si revocano, `senza_casi`;
 * 2. l'avviso a 14 giorni, una volta (`reminded_at`): le chiavi vive entro 14 giorni dalla fine, non superate da una più
 *    nuova, con `chiave_ci_scade` in coda a chi gestisce le chiavi;
 * 3. le chiavi finite (revocate o scadute) da più di 12 mesi si cancellano.
 * `workspaceIds`: solo quei workspace (null: tutti; un elenco vuoto: nessuno, come gli altri passi del cron).
 */
export async function runCiKeysSweep(
  executor: UcExecutor,
  input: { lsDomains: readonly string[]; workspaceIds?: readonly string[] | null },
): Promise<CiKeysSweepSummary> {
  if (!(await ciKeysStoreReady(executor))) return { ready: false, reminded: 0, reminderNotices: 0, revokedWithoutCases: 0, deleted: 0 };
  if (input.workspaceIds && input.workspaceIds.length === 0) return { ready: true, reminded: 0, reminderNotices: 0, revokedWithoutCases: 0, deleted: 0 };
  const scope = (alias: string) =>
    input.workspaceIds && input.workspaceIds.length > 0 ? ucSql` AND ${raw(alias)}.workspace_id = ANY(${cast([...input.workspaceIds], "uuid[]")})` : raw("");
  const [unregistered, reminders, deleted] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_ci_keys k SET revoked_at = now(), revoked_reason = 'senza_casi'
WHERE k.revoked_at IS NULL${scope("k")}
  AND (NOT EXISTS (SELECT 1 FROM use_case_repos r WHERE r.workspace_id = k.workspace_id AND lower(r.repo) = lower(k.repo))
    OR (k.use_case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM use_case_repos r WHERE r.workspace_id = k.workspace_id AND r.use_case_id = k.use_case_id AND lower(r.repo) = lower(k.repo))))
RETURNING k.id`),
    toStatement(ucSql`WITH due AS (
  UPDATE use_case_ci_keys k SET reminded_at = now()
  WHERE ${live("k")} AND k.reminded_at IS NULL AND k.expires_at <= now() + make_interval(hours => ${cast(CI_KEY_REMINDER_DAYS * 24, "int")})${scope("k")}
    AND NOT EXISTS (SELECT 1 FROM use_case_ci_keys n WHERE n.workspace_id = k.workspace_id AND lower(n.repo) = lower(k.repo) AND n.id <> k.id AND ${live("n")} AND n.created_at > k.created_at)
  RETURNING k.id, k.workspace_id, k.repo
), notices AS (
  ${keyNoticesSql("chiave_ci_scade", "due", input.lsDomains, null)}
)
SELECT (SELECT count(*)::int FROM due) AS reminded, (SELECT count(*)::int FROM notices) AS notices`),
    toStatement(ucSql`DELETE FROM use_case_ci_keys k
WHERE least(k.revoked_at, k.expires_at) < now() - make_interval(months => ${cast(CI_KEY_RETENTION_MONTHS, "int")})${scope("k")}
RETURNING k.id`),
  ]);
  return {
    ready: true,
    reminded: Number(reminders[0]?.reminded ?? 0),
    reminderNotices: Number(reminders[0]?.notices ?? 0),
    revokedWithoutCases: unregistered.length,
    deleted: deleted.length,
  };
}
