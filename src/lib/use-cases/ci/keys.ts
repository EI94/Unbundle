/**
 * La chiave della CI (rilascio 8.2b, docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.2, §2.5, §2.7): le regole, senza il
 * database. Le letture e le scritture della tabella stanno in un modulo solo, `src/lib/db/queries/use-case-ci-keys.ts`.
 *
 * - **La chiave** (`ub_ci_…`, 32 byte casuali): del repository, non di una persona. Si vede una volta, alla creazione;
 *   in Unbundle restano l'impronta SHA-256 (la stessa dei token della CLI) e il prefisso da mostrare (`ub_ci_ab12`).
 *   Prefisso e tabella diversi da quelli della CLI: un token della CLI non entra in `/api/ci/*`, una chiave della CI non
 *   entra in `/api/cli/*`.
 * - **L'ambito:** i casi registrati sul repository della chiave, nel suo workspace (con D1 «per caso», solo quel caso);
 *   solo le evals e il banco di `main`, con il commit intero e l'esecuzione di GitHub di quel repository.
 * - **La durata:** 180 giorni, l'avviso a 14 giorni, una volta sola.
 * - **La rotazione:** la chiave nuova si vede una volta; la vecchia vale al più 7 giorni e il primo invio con la nuova la
 *   revoca (`ruotata`). Mai più di due chiavi vive per repository: una seconda rotazione, con la nuova mai usata, si
 *   rifiuta.
 * - **Chi la gestisce (D6):** solo Lateral Space, con l'e-mail verificata: chi gestisce il workspace (un ruolo da
 *   revisore, come `lsManager` della pagina «Agent Factory») o chi è responsabile (`ls_lead`) di un caso aperto
 *   registrato sul repository. Sviluppatori e analisti di Lateral Space, chi costruisce da fuori e il cliente mai.
 * - **La riga della famiglia e «Da fare per te»:** lo stato di un repository dalle sue chiavi (i testi li scrive la
 *   pagina).
 *
 * Mai la chiave in un log, in una risposta dopo la creazione o in un'e-mail. Mai una persona nelle letture per la pagina.
 * Modulo puro: import relativi `.ts`.
 */
import { randomBytes } from "node:crypto";
import { bearerTokenFromHeader } from "../../connector/auth.ts";
import { CI_REPO_RE, CI_RUN_URL_RE, type CiKeyRevokedReason } from "../../db/use-case-hub-ci-keys-ddl.ts";
import { canReviewWorkspacePortfolio } from "../../workspace-permissions.ts";
import { hashSecret } from "../cli/codes.ts";

// ─── Costanti ────────────────────────────────────────────────────────

/** Il prefisso delle chiavi della CI: lo riconoscono le difese contro i token negli indirizzi (`DEFAULT_TOKEN_PREFIXES`). */
export const CI_KEY_PREFIX = "ub_ci_";
/** Quanto vale una chiave (D7). */
export const CI_KEY_DAYS = 180;
/** Da quanti giorni prima della fine arrivano l'e-mail `chiave_ci_scade` e «Ruota la chiave». */
export const CI_KEY_REMINDER_DAYS = 14;
/** Dopo una rotazione la vecchia vale al massimo questi giorni (meno, se scadeva prima). */
export const CI_KEY_ROTATION_GRACE_DAYS = 7;
/** Le chiavi vive di un repository, al massimo: la vecchia e la nuova di una rotazione. */
export const CI_KEY_MAX_LIVE = 2;
/** Le chiavi finite (scadute o revocate) da più di questi mesi si cancellano (il cron). */
export const CI_KEY_RETENTION_MONTHS = 12;
/** «Metti su GitHub la chiave nuova…»: per una rotazione ferma da più di un giorno. */
export const CI_ROTATION_STALE_DAYS = 1;
/** Il solo ramo che la CI manda (D2). */
export const CI_MAIN_BRANCH = "main";
/** Il nome del segreto su GitHub. */
export const CI_SECRET_NAME = "UNBUNDLE_CI_TOKEN";
/** Il prefisso del registro dell'idempotenza per le richieste della CI: `ci:<id della chiave>`, mai il token di una persona. */
export const CI_IDEMPOTENCY_PREFIX = "ci:";
/** I byte casuali di una chiave. */
export const CI_KEY_BYTES = 32;

const DAY_MS = 86_400_000;
/** Il corpo di una chiave: 32 byte in base64url, senza riempimento. */
const KEY_BODY = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Il commit di `main` che la CI manda: le 40 cifre, in minuscolo. */
export const CI_COMMIT_RE = /^[0-9a-f]{40}$/;

// ─── La chiave ───────────────────────────────────────────────────────

/** Una chiave nuova: `ub_ci_` e 32 byte casuali in base64url. Si mostra una volta sola. */
export function newCiKey(): string {
  return `${CI_KEY_PREFIX}${randomBytes(CI_KEY_BYTES).toString("base64url")}`;
}

/** Vero se ha la forma di una chiave della CI (prima di toccare il database). */
export function isCiKey(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(CI_KEY_PREFIX) && KEY_BODY.test(value.slice(CI_KEY_PREFIX.length));
}

/** L'impronta SHA-256 esadecimale della chiave: in tabella c'è solo questa (la stessa funzione dei token della CLI). */
export function hashCiKey(key: string): string {
  return hashSecret(key);
}

/** Le prime lettere della chiave, per riconoscerla senza mostrarla: `ub_ci_ab12`. */
export function ciKeyDisplayPrefix(key: string): string {
  return key.slice(0, CI_KEY_PREFIX.length + 4);
}

/** La chiave da `Authorization: Bearer ub_ci_…`, o null. Un token della CLI (`ub_cli_…`) o di altro tipo: null. */
export function ciKeyFromAuthorization(header: string | null | undefined): string | null {
  const token = bearerTokenFromHeader(header ?? null, CI_KEY_PREFIX);
  return token && isCiKey(token) ? token : null;
}

/** I token trovati in un indirizzo che sono chiavi della CI (da revocare come `esposta`). */
export function ciKeyCandidates(candidates: readonly string[]): string[] {
  return [...new Set(candidates.filter((c) => typeof c === "string" && c.startsWith(CI_KEY_PREFIX)))];
}

/** Chi scrive nel registro dell'idempotenza per una richiesta della CI: `ci:<id della chiave>`. */
export function ciIdempotencyOwner(keyId: string): string {
  if (!UUID.test(keyId)) throw new Error("Chiave della CI non valida");
  return `${CI_IDEMPOTENCY_PREFIX}${keyId.toLowerCase()}`;
}

// ─── Il repository ───────────────────────────────────────────────────

/** `owner/nome` come lo registra la CLI, `.git` alla fine tolto; null se non vale. */
export function normalizeCiRepo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const repo = value.trim().replace(/\.git$/i, "");
  return CI_REPO_RE.test(repo) ? repo : null;
}

/** Lo stesso repository, senza badare alle maiuscole (GitHub non ci bada). */
export function sameCiRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** `{nome}` dei testi: il repository senza l'organizzazione. */
export function ciRepoName(repo: string): string {
  const at = repo.indexOf("/");
  return at >= 0 ? repo.slice(at + 1) : repo;
}

// ─── L'invio della CI: solo main, il commit, l'esecuzione di quel repository ──

/** Gli errori dell'API della CI che riguardano la chiave e il suo ambito (§2.9), con il messaggio da mostrare com'è. */
export const CI_KEY_ERRORS = Object.freeze({
  chiave: Object.freeze({ status: 401, message: "Chiave della CI mancante, scaduta o revocata: ruotala dall'Agent Factory e aggiorna il segreto UNBUNDLE_CI_TOKEN." }),
  chiave_nell_indirizzo: Object.freeze({ status: 400, message: "La chiave non va mai nell'indirizzo: è stata bloccata. Creane una nuova dall'Agent Factory." }),
  non_trovato: Object.freeze({ status: 404, message: "Questo caso non è tra quelli del repository della chiave." }),
  solo_main: Object.freeze({ status: 403, message: "La chiave della CI manda solo le evals di main." }),
  // Gli stessi testi della CLI (`cliWriteDenial` in src/lib/use-cases/cli/case.ts e `resolveCliCase`).
  caso_chiuso: Object.freeze({ status: 409, message: "Il caso è chiuso: il progetto si legge soltanto." }),
  caso_sospeso: Object.freeze({ status: 409, message: "Il caso è in pausa: si riprende da Impostazioni del caso." }),
  senza_dossier: Object.freeze({ status: 409, message: "Il caso non ha ancora una realizzazione: si avvia dalla sua pagina in Unbundle." }),
  non_disponibile: Object.freeze({ status: 503, message: "Unbundle non riceve ancora le evals dalla CI: riprova tra qualche minuto." }),
});
export type CiKeyErrorCode = keyof typeof CI_KEY_ERRORS;

/** `dati_non_validi` per `ci`: l'esecuzione su GitHub di questo repository. */
export const CI_RUN_URL_MESSAGE = "ci.url: l'indirizzo dell'esecuzione su GitHub di questo repository.";
/** `dati_non_validi` per `commit`. */
export const CI_COMMIT_MESSAGE = "commit: le 40 cifre del commit di main.";

/** L'esecuzione di GitHub da cui arriva un invio della CI: il numero, il tentativo, l'indirizzo. */
export interface CiRunRef {
  /** `GITHUB_RUN_ID`, in cifre. */
  runId: string;
  /** `GITHUB_RUN_ATTEMPT`, da 1. */
  attempt: number;
  /** `https://github.com/<owner>/<nome>/actions/runs/<numero>`, del repository della chiave. */
  url: string;
}

export type CiRunCheck = { ok: true; value: CiRunRef } | { ok: false; code: "solo_main" | "dati_non_validi"; message: string };

/**
 * Le regole di un invio della CI oltre a quelle della 8.2a (`parseEvalRun`): `ramo` uguale a `main` (403 `solo_main`),
 * `commit` di 40 cifre, `ci` con l'esecuzione di GitHub di questo repository (`esecuzione` uguale al numero
 * nell'indirizzo, `tentativo` da 1 a 100). `repo` è quello della chiave.
 */
export function checkCiRun(input: { ramo?: unknown; commit?: unknown; ci?: unknown }, repo: string): CiRunCheck {
  if (input.ramo !== CI_MAIN_BRANCH) return { ok: false, code: "solo_main", message: CI_KEY_ERRORS.solo_main.message };
  if (typeof input.commit !== "string" || !CI_COMMIT_RE.test(input.commit)) return { ok: false, code: "dati_non_validi", message: CI_COMMIT_MESSAGE };
  const bad = { ok: false as const, code: "dati_non_validi" as const, message: CI_RUN_URL_MESSAGE };
  const ci = input.ci;
  if (!ci || typeof ci !== "object" || Array.isArray(ci)) return bad;
  const { esecuzione, tentativo, url } = ci as Record<string, unknown>;
  if (typeof url !== "string" || !CI_RUN_URL_RE.test(url)) return bad;
  const parsed = new URL(url);
  const [, owner, name, , , runId] = parsed.pathname.split("/");
  if (!sameCiRepo(`${owner}/${name}`, repo)) return bad;
  const run = typeof esecuzione === "number" && Number.isSafeInteger(esecuzione) ? String(esecuzione) : esecuzione;
  if (run !== runId) return bad;
  const attempt = tentativo === undefined ? 1 : tentativo;
  if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 1 || attempt > 100) return bad;
  return { ok: true, value: { runId, attempt, url } };
}

// ─── Le chiavi di un repository: vive, rotazione, avviso, cancellazione ──

/** Una chiave come la leggono le regole e la pagina: mai l'impronta, mai chi l'ha creata o revocata. */
export interface CiKeyRow {
  id: string;
  repo: string;
  /** `ub_ci_ab12`. */
  prefix: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  remindedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: CiKeyRevokedReason | null;
  /** La chiave che questa sostituisce (rotazione). */
  replacesKeyId: string | null;
}

/** Quello che le regole leggono di una chiave (una riga intera va bene). */
type KeyFacts = Pick<CiKeyRow, "id" | "createdAt" | "expiresAt" | "lastUsedAt" | "revokedAt" | "replacesKeyId"> & Partial<CiKeyRow>;

/** Viva: né revocata né scaduta. */
export function isLiveCiKey(k: Pick<CiKeyRow, "revokedAt" | "expiresAt">, now: Date): boolean {
  return k.revokedAt === null && k.expiresAt.getTime() > now.getTime();
}

const newestFirst = <T extends Pick<CiKeyRow, "createdAt" | "id">>(a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Le chiavi vive di un repository, dalla più nuova. */
export function liveCiKeys<T extends KeyFacts>(keys: readonly T[], now: Date): T[] {
  return keys.filter((k) => isLiveCiKey(k, now)).sort(newestFirst);
}

/** Una rotazione aspetta la chiave nuova su GitHub: una chiave viva che ne sostituisce un'altra e non è mai stata usata. */
export function rotationPending(keys: readonly KeyFacts[], now: Date): boolean {
  return keys.some((k) => isLiveCiKey(k, now) && k.replacesKeyId !== null && k.lastUsedAt === null);
}

/** Perché «Crea la chiave» non si può: il repository ha già una chiave viva. */
export function createRefusal(keys: readonly KeyFacts[], now: Date): "gia_collegata" | null {
  return liveCiKeys(keys, now).length > 0 ? "gia_collegata" : null;
}

/**
 * Perché «Ruota la chiave» non si può: nessuna chiave viva, oppure una rotazione già in corso (la nuova mai usata, o già
 * {@link CI_KEY_MAX_LIVE} chiavi vive).
 */
export function rotateRefusal(keys: readonly KeyFacts[], now: Date): "nessuna_chiave" | "rotazione_in_corso" | null {
  const live = liveCiKeys(keys, now);
  if (live.length === 0) return "nessuna_chiave";
  if (live.length >= CI_KEY_MAX_LIVE || rotationPending(keys, now)) return "rotazione_in_corso";
  return null;
}

/** La scadenza di una chiave creata adesso. */
export function ciKeyExpiresAt(now: Date): Date {
  return new Date(now.getTime() + CI_KEY_DAYS * DAY_MS);
}

/** Dopo una rotazione, la vecchia vale fino a qui: al più tardi adesso più 7 giorni, prima se scadeva prima. */
export function rotatedOldUntil(oldExpiresAt: Date, now: Date): Date {
  return new Date(Math.min(oldExpiresAt.getTime(), now.getTime() + CI_KEY_ROTATION_GRACE_DAYS * DAY_MS));
}

/** Vero se la chiave scade entro 14 giorni (ed è ancora viva). */
export function ciKeyExpiringSoon(k: Pick<CiKeyRow, "revokedAt" | "expiresAt">, now: Date): boolean {
  return isLiveCiKey(k, now) && k.expiresAt.getTime() - now.getTime() <= CI_KEY_REMINDER_DAYS * DAY_MS;
}

/**
 * L'avviso a 14 giorni (`chiave_ci_scade`) tocca a questa chiave? Viva, entro 14 giorni dalla fine, mai avvisata, e non
 * superata da una chiave più nuova dello stesso repository (la vecchia di una rotazione non si avvisa: la si sta
 * cambiando).
 */
export function ciKeyReminderDue(key: KeyFacts & Pick<CiKeyRow, "remindedAt">, keys: readonly KeyFacts[], now: Date): boolean {
  if (key.remindedAt !== null || !ciKeyExpiringSoon(key, now)) return false;
  return !keys.some((other) => other.id !== key.id && isLiveCiKey(other, now) && other.createdAt.getTime() > key.createdAt.getTime());
}

/** La chiave è finita (revocata o scaduta) da più di 12 mesi: si cancella. */
export function ciKeyRetentionDue(k: Pick<CiKeyRow, "revokedAt" | "expiresAt">, now: Date): boolean {
  const end = k.revokedAt && k.revokedAt.getTime() < k.expiresAt.getTime() ? k.revokedAt : k.expiresAt;
  const limit = new Date(now.getTime());
  limit.setUTCMonth(limit.getUTCMonth() - CI_KEY_RETENTION_MONTHS);
  return end.getTime() < limit.getTime();
}

// ─── La riga della famiglia e «Da fare per te» (i testi li scrive la pagina) ──

/**
 * Lo stato della CI di un repository, per la riga della famiglia (§2.6):
 * - `non_disponibile`: la 0042 non è pronta;
 * - `non_collegata`: nessuna chiave viva (e l'ultima non è solo scaduta);
 * - `mai_usata`: una chiave viva, mai usata («CI collegata il …: le evals arrivano alla prossima unione su main»);
 * - `usata`: una chiave viva, usata («CI collegata · ultimo invio … · la chiave scade il …»);
 * - `in_scadenza`: una chiave viva che scade entro 14 giorni («Ruota la chiave»);
 * - `rotazione`: la vecchia e la nuova vive, la nuova da mettere su GitHub (la vecchia vale fino a `old.expiresAt`);
 * - `scaduta`: nessuna chiave viva e l'ultima è scaduta, non revocata («Crea una chiave nuova»).
 */
export type CiRowState =
  | { kind: "non_disponibile" }
  | { kind: "non_collegata" }
  | { kind: "mai_usata"; key: CiKeyRow }
  | { kind: "usata"; key: CiKeyRow }
  | { kind: "in_scadenza"; key: CiKeyRow }
  | { kind: "rotazione"; old: CiKeyRow; fresh: CiKeyRow }
  | { kind: "scaduta"; key: CiKeyRow };

/** Lo stato della riga della famiglia, dalle chiavi del repository (anche revocate o scadute). */
export function ciRowState(keys: readonly CiKeyRow[], now: Date, ready = true): CiRowState {
  if (!ready) return { kind: "non_disponibile" };
  const live = liveCiKeys(keys, now);
  if (live.length >= 2) return { kind: "rotazione", fresh: live[0], old: live[1] };
  if (live.length === 1) {
    const key = live[0];
    if (ciKeyExpiringSoon(key, now)) return { kind: "in_scadenza", key };
    return key.lastUsedAt ? { kind: "usata", key } : { kind: "mai_usata", key };
  }
  const latest = [...keys].sort(newestFirst)[0];
  return latest && latest.revokedAt === null ? { kind: "scaduta", key: latest } : { kind: "non_collegata" };
}

/**
 * «Da fare per te» di un repository, solo a chi gestisce le chiavi (§2.6):
 * - `collega`: nessuna chiave viva e almeno un caso dal progetto approvato in poi;
 * - `ruota`: la chiave scade entro 14 giorni;
 * - `metti`: una rotazione ferma da più di un giorno (la chiave nuova non è ancora arrivata da GitHub).
 */
export type CiTodoKind = "collega" | "ruota" | "metti";

export function ciKeyTodo(state: CiRowState, input: { approvedCases: number }, now: Date): CiTodoKind | null {
  switch (state.kind) {
    case "non_collegata":
    case "scaduta":
      return input.approvedCases > 0 ? "collega" : null;
    case "in_scadenza":
      return "ruota";
    case "rotazione":
      return now.getTime() - state.fresh.createdAt.getTime() > CI_ROTATION_STALE_DAYS * DAY_MS ? "metti" : null;
    default:
      return null;
  }
}

// ─── Chi gestisce le chiavi (D6) ──────────────────────────────────────

/**
 * La regola di D6, per chi ha già passato il controllo dell'accesso al workspace: Lateral Space (e-mail verificata) e
 * chi gestisce il workspace (ruolo da revisore) o è responsabile di un caso aperto registrato sul repository. Chi segue
 * solo un corso (`learner`) mai. La stessa regola, in SQL, la rilegge ogni scrittura (`ciKeyManagerSql`).
 */
export function canManageCiKeysRule(i: { isLateralSpace: boolean; workspaceRole: string | null | undefined; leadsOpenCaseOfRepo: boolean }): boolean {
  if (!i.isLateralSpace || !i.workspaceRole || i.workspaceRole === "learner") return false;
  return canReviewWorkspacePortfolio(i.workspaceRole) || i.leadsOpenCaseOfRepo;
}

// ─── I testi delle azioni (rifiuti ed esiti) ──────────────────────────

/** I rifiuti di «Collega la CI», «Ruota» e «Revoca» (§2.6), e gli esiti. Il codice per i test, il messaggio per la persona. */
export const CI_KEY_ACTION_TEXT = Object.freeze({
  permesso_negato: "La chiave della CI la gestisce Lateral Space: chi è responsabile di un caso di questo repository, o chi gestisce il workspace.",
  gia_collegata: "Questo repository ha già una chiave: per cambiarla, «Ruota la chiave».",
  rotazione_in_corso: "C'è già una chiave nuova da mettere su GitHub: mettila, oppure revoca e ricomincia.",
  repo_senza_casi: "Questo repository non ha casi registrati in questo workspace.",
  non_disponibile: "Non ancora disponibile: riprova tra qualche minuto.",
  /** Ruota o revoca senza una chiave da cambiare (la pagina non mostra il pulsante: arriva solo chiamando l'azione). */
  nessuna_chiave: "Questo repository non ha una chiave della CI: «Collega la CI».",
  dati_non_validi: "Il repository non è valido.",
  non_riuscito: "Non è stato possibile: riprova tra poco.",
  creata: "Chiave nuova creata: mettila su GitHub.",
  revocata: "Chiave revocata.",
});
export type CiKeyActionRefusal = Exclude<keyof typeof CI_KEY_ACTION_TEXT, "creata" | "revocata">;
