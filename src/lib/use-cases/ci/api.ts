/**
 * L'API della CI (rilascio 8.2b, docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.2, §2.3, §2.9): le regole senza il database di
 * `GET /api/ci/casi` e `POST /api/ci/evals`, e le loro risposte, con le chiavi in italiano come quelle della CLI.
 *
 * - **Gli errori** (`CI_ERRORS`) sono `{ errore: { codice, messaggio } }` con il messaggio da mostrare com'è: quelli della
 *   chiave e del suo ambito (`CI_KEY_ERRORS`), più il metodo, l'origine, il corpo e i limiti, come le difese della CLI.
 *   `idempotenza` e `in_corso` (409) restano quelli della CLI (`executeIdempotentWrite`).
 * - **I casi** (`ciCasesBody`): il repository della chiave, i suoi casi registrati in Unbundle (aperti, o il perché),
 *   «solo main» e la scadenza della chiave. Mai una persona.
 * - **L'invio** (`parseCiEvals`): prima le regole della CI (`checkCiRun`: `ramo` uguale a `main` o 403 `solo_main`, il
 *   commit intero, l'esecuzione di GitHub di quel repository), poi quelle della 8.2a (`parseEvalRun`, con `senzaAi` dei
 *   casi senza AI).
 * - **L'idempotenza** (`ciEvalsWriteBody`): l'impronta è quella del corpo controllato più l'indirizzo dell'esecuzione,
 *   senza il tentativo: un job rilanciato con le stesse evals risponde «ripetuta» e non conta due volte; con altri numeri è
 *   un conflitto (`idempotenza`, 409), e le evals di quell'esecuzione restano quelle arrivate per prime.
 * - **Chi scrive** (`CiRunSource`, `checkCiRunSource`): la chiave e l'esecuzione su GitHub, mai una persona; solo `main`.
 * - **Il link all'esecuzione su GitHub** (`ciLinkVisible`): a chi costruisce il caso o è di Lateral Space; il cliente vede
 *   «dalla CI» senza link (là si vede chi ha unito, §2.7).
 * - **La versione del modello del repository** la dicono le evals di main della CI (`CI_VERSION_WINDOW_DAYS`).
 *
 * Modulo puro: import relativi `.ts`.
 */
import { CI_KEY_LIMITS, CI_REPO_RE, CI_RUN_URL_RE } from "../../db/use-case-hub-ci-keys-ddl.ts";
import { evalRunFingerprint, parseEvalRun, type EvalRunInput } from "../factory/benchmark-input.ts";
import { CI_COMMIT_RE, CI_KEY_ERRORS, CI_MAIN_BRANCH, checkCiRun, sameCiRepo, type CiRunRef } from "./keys.ts";

// ─── Limiti ──────────────────────────────────────────────────────────

/** I limiti per chiave (§2.2): 600 letture e 120 scritture l'ora; il corpo di un invio al massimo 64 KB, come la CLI. */
export const CI_ROUTE_LIMITS = Object.freeze({
  readsPerHour: 600,
  writesPerHour: 120,
  bodyBytes: 64 * 1024,
});

/**
 * Per quanti giorni le evals di main arrivate dalla CI fanno la versione del modello del repository: in questa finestra
 * la versione che dice `unbundle start` dal computer di una persona (anche da un ramo) non la cambia. Una CI ferma da
 * più di un mese non tiene la versione bloccata: torna a dirla `unbundle start`.
 */
export const CI_VERSION_WINDOW_DAYS = 30;

// ─── Errori ──────────────────────────────────────────────────────────

/** Gli errori dell'API della CI, con lo stato HTTP e il messaggio da mostrare com'è (§2.9). */
export const CI_ERRORS = Object.freeze({
  ...CI_KEY_ERRORS,
  troppe_richieste: Object.freeze({ status: 429, message: "Troppe richieste: riprova tra poco." }),
  metodo: Object.freeze({ status: 405, message: "Metodo non ammesso." }),
  origine: Object.freeze({ status: 403, message: "L'API della CI non si usa da un browser: la chiama «unbundle ci» da GitHub Actions." }),
  json: Object.freeze({ status: 415, message: "Serve un corpo JSON." }),
  troppo_grande: Object.freeze({ status: 413, message: "La richiesta è troppo grande." }),
});
export type CiErrorCode = keyof typeof CI_ERRORS;

/** 400 `idempotenza`: l'intestazione manca o non vale (la stessa regola della CLI, 8-128 caratteri). */
export const CI_IDEMPOTENCY_MISSING_MESSAGE = "Manca l'intestazione Idempotency-Key (8-128 caratteri): «unbundle ci evals» la mette da sola.";

/**
 * Il codice di un caso che la CI non può mandare (`findCiKeyCase`): 404 `non_trovato` (non è tra quelli del repository
 * della chiave), 409 `senza_dossier`, `caso_chiuso`, `caso_sospeso`. Un codice che non si conosce vale «non trovato».
 */
export function ciCaseFailureCode(code: string): "non_trovato" | "senza_dossier" | "caso_chiuso" | "caso_sospeso" {
  return code === "senza_dossier" || code === "caso_chiuso" || code === "caso_sospeso" ? code : "non_trovato";
}

// ─── GET /api/ci/casi ────────────────────────────────────────────────

/** Perché un caso del repository non riceve evals: chiuso, in pausa, senza la realizzazione (il dossier). */
export type CiCaseWhy = "chiuso" | "sospeso" | "senza_dossier";

/** Un caso del repository come lo legge la CI: il codice, la cartella, se è aperto e, se no, perché. */
export interface CiCaseEntry {
  caso: string;
  cartella: string;
  aperto: boolean;
  perche?: CiCaseWhy;
}

/** La risposta di `GET /api/ci/casi`. */
export interface CiCasesBody {
  /** `owner/nome`, come è registrato in Unbundle. */
  repository: string;
  casi: CiCaseEntry[];
  /** La chiave manda solo le evals di main (D2). */
  soloMain: true;
  /** Quando scade la chiave (ISO): la CI avvisa a 14 giorni. */
  scade: string;
}

/** Un caso del repository della chiave, come lo legge il modulo delle chiavi (`listCiKeyCases`). */
export interface CiCaseFacts {
  code: string;
  folder: string;
  open: boolean;
  why: CiCaseWhy | null;
}

/**
 * La risposta di `GET /api/ci/casi`: i casi registrati sul repository della chiave nel suo workspace, nell'ordine della
 * lettura, senza doppioni (lo stesso caso e la stessa cartella registrati con il repository scritto in due modi) e
 * senza i casi senza codice (non si possono mandare). Un caso aperto non ha `perche`.
 */
export function ciCasesBody(key: { repo: string; expiresAt: string }, cases: readonly CiCaseFacts[]): CiCasesBody {
  const seen = new Set<string>();
  const casi: CiCaseEntry[] = [];
  for (const c of cases) {
    const code = c.code.trim();
    if (!code) continue;
    const id = `${code.toUpperCase()} ${c.folder}`;
    if (seen.has(id)) continue;
    seen.add(id);
    casi.push(c.open ? { caso: code, cartella: c.folder, aperto: true } : { caso: code, cartella: c.folder, aperto: false, perche: c.why ?? "senza_dossier" });
  }
  return { repository: key.repo, casi, soloMain: true, scade: key.expiresAt };
}

// ─── POST /api/ci/evals ──────────────────────────────────────────────

/** Un invio della CI controllato: quello che si salva e l'esecuzione di GitHub da cui arriva. */
export interface CiEvalsRequest {
  input: EvalRunInput;
  run: CiRunRef;
}

export type CiEvalsParse = { ok: true; value: CiEvalsRequest } | { ok: false; status: 400 | 403; code: "solo_main" | "dati_non_validi"; message: string };

/**
 * Il corpo di `POST /api/ci/evals`: quello di `POST /api/cli/evals` (`tipo` `evals` o `banco`) più `ci`. Prima le
 * regole della CI (`ramo` uguale a `main`, altrimenti 403 `solo_main`; il commit di 40 cifre; `ci` con l'esecuzione di
 * GitHub di `repo`, il repository della chiave), poi quelle della 8.2a, con i loro messaggi (400 `dati_non_validi`).
 */
export function parseCiEvals(body: Record<string, unknown>, repo: string): CiEvalsParse {
  const run = checkCiRun(body, repo);
  if (!run.ok) return { ok: false, status: run.code === "solo_main" ? 403 : 400, code: run.code, message: run.message };
  const parsed = parseEvalRun(body);
  if (!parsed.ok) return { ok: false, status: 400, code: "dati_non_validi", message: parsed.message };
  return { ok: true, value: { input: parsed.value, run: run.value } };
}

/**
 * Il corpo di cui si fa l'impronta per l'idempotenza: il caso, l'invio controllato e l'indirizzo dell'esecuzione. Il
 * tentativo (`ci.tentativo`) resta fuori: un job rilanciato con le stesse evals è la stessa richiesta («ripetuta»).
 * (Casi senza AI) L'invio come lo dice `evalRunFingerprint`: per gli altri invii la stessa impronta di prima.
 */
export function ciEvalsWriteBody(code: string, request: CiEvalsRequest): Record<string, unknown> {
  return { caso: code, ...evalRunFingerprint(request.input), ci: { url: request.run.url } };
}

// ─── Chi scrive: la CI, mai una persona ──────────────────────────────

/** (8.2b) Un'esecuzione mandata dalla CI: la chiave, l'esecuzione su GitHub, il repository della chiave. Nessuna persona. */
export interface CiRunSource {
  kind: "ci";
  keyId: string;
  /** `https://github.com/<owner>/<nome>/actions/runs/<numero>`, del repository della chiave. */
  runUrl: string;
  /** `owner/nome` della chiave. */
  repo: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Perché un'esecuzione della CI non si può scrivere (un messaggio), o null: la chiave, l'indirizzo dell'esecuzione di
 * quel repository, solo `main` con il commit intero. Le stesse regole della rotta, rilette da chi scrive.
 */
export function checkCiRunSource(source: CiRunSource, input: Pick<EvalRunInput, "branch" | "commit">): string | null {
  if (!UUID.test(source.keyId)) return "Chiave della CI non valida.";
  if (!CI_REPO_RE.test(source.repo)) return "Repository della chiave non valido.";
  if (source.runUrl.length > CI_KEY_LIMITS.runUrl || !CI_RUN_URL_RE.test(source.runUrl)) return "ci.url: l'indirizzo dell'esecuzione su GitHub di questo repository.";
  const [, owner, name] = new URL(source.runUrl).pathname.split("/");
  if (!sameCiRepo(`${owner}/${name}`, source.repo)) return "ci.url: l'indirizzo dell'esecuzione su GitHub di questo repository.";
  if (input.branch !== CI_MAIN_BRANCH) return CI_KEY_ERRORS.solo_main.message;
  if (typeof input.commit !== "string" || !CI_COMMIT_RE.test(input.commit)) return "commit: le 40 cifre del commit di main.";
  return null;
}

/**
 * Chi vede il link all'esecuzione su GitHub (§2.5, §2.7): chi costruisce il caso (anche da fuori Lateral Space) e le
 * persone di Lateral Space. Il cliente vede «dalla CI» senza link.
 */
export function ciLinkVisible(viewer: { isLateralSpace: boolean; builds: boolean }): boolean {
  return viewer.isLateralSpace || viewer.builds;
}
