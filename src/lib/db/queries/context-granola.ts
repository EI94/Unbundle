import "server-only";
/**
 * Granola collegato a Unbundle (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4.12, §8): il collegamento
 * OAuth di una persona di Lateral Space, i token cifrati e il loro rinnovo, il giro che fa entrare le call nel
 * «Contesto» del cliente giusto, «Da smistare», le regole per workspace, lo scollegamento.
 *
 * - **Solo lettura.** Dell'MCP di Granola si usano solo gli strumenti che leggono (`mcp-client.ts`).
 * - **Chi.** Solo Lateral Space (`contextAbilities(…).canUseGranola`), riletto a ogni giro: chi non lo è più viene
 *   scollegato di notte.
 * - **Che cosa entra.** Una call che corrisponde a un solo cliente entra da sola, `da_leggere`: il giro non chiama mai
 *   il modello. Le altre restano in Granola: «Da smistare» si legge dal vivo e niente si salva, tranne l'id di una call
 *   lasciata fuori.
 * - **Sicurezza.** Token cifrati con `CONTEXT_TOKEN_KEY` (`token-crypto.ts`), mai in chiaro in una colonna, in un log o
 *   in una risposta. Il testo di Granola è un dato, mai un'istruzione. Nei log solo id, codici e numeri.
 * Questo modulo scrive solo le tabelle `context_granola_*`; gli appunti li scrive `upsertExternalNote` (context-sources.ts).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  contextGranolaClients,
  contextGranolaConnections,
  contextGranolaLinks,
  contextGranolaMeetings,
  contextGranolaOauthStates,
  contextGranolaRules,
  contextSources,
  users,
  workspaces,
} from "@/lib/db/schema";
import { granolaConfig, type GranolaConfig } from "@/lib/context/granola/config";
import { discoverGranola, GRANOLA_ENDPOINTS, type GranolaEndpoints } from "@/lib/context/granola/endpoints";
import { defaultTitleWords, emailDomainOf, matchMeeting, type WorkspaceMatchProfile } from "@/lib/context/granola/match";
import { callGranolaTool, GranolaMcpError, openGranolaSession, type GranolaMcpDeps, type GranolaReadTool, type GranolaSession } from "@/lib/context/granola/mcp-client";
import {
  authorizationUrl,
  callbackUrl,
  chooseClientMode,
  clientMetadataUrl,
  createPkce,
  createState,
  exchangeCode,
  granolaScopes,
  isStateShape,
  refreshTokens,
  registerClient,
  revokeToken,
  stateHash,
} from "@/lib/context/granola/oauth";
import { parseAccountInfo, parseFolders, parseGetMeetings, parseSearchMeetings, parseTranscript, type GranolaMeetingHead, type GranolaMeetingNote } from "@/lib/context/granola/parse";
import {
  cleanGranolaRules,
  composeGranolaNote,
  GRANOLA_LIMITS,
  needsFullRun,
  participantEmails,
  planGivesTranscripts,
  sameWords,
  searchWindow,
  stepFor,
  unsortedParticipants,
} from "@/lib/context/granola/sync-plan";
import { openGranolaTokens, openGranolaVerifier, sealGranolaTokens, sealGranolaVerifier } from "@/lib/context/granola/token-crypto";
import { scanNote } from "@/lib/context/scan";
import { contextActorForUser } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities, type ContextActor } from "@/lib/context/visibility";
import type { GranolaConnectionStatus, GranolaDecidedBy, GranolaDecision } from "@/lib/context/vocab";
import { logSafeError } from "@/lib/log/safe-error";
import { romeDate } from "@/lib/uc/calendar";
import { isEmailVerifiedValue, isLateralSpaceEmail, parseLsDomains } from "@/lib/uc/lateral-space";
import type { ServiceResult } from "@/lib/use-cases/types";
import { contextStoreReady } from "./context-store";
import { failure, gate, isUuid, notFound, ok, retry, rowsOf, toDate } from "./context-shared";
import { upsertExternalNote } from "./context-sources";

const LOG_SCOPE = "context/granola";
const TEXT = CONTEXT_TEXT.granola;

// ─── Che cosa usa il collegamento ────────────────────────────────────

/** Gli indirizzi di base, la `fetch` e l'attesa: in produzione quelli veri, nei test il server finto (`fake-granola.ts`). */
export interface GranolaRuntime {
  fetch: typeof fetch;
  base: GranolaEndpoints;
  sleep(ms: number): Promise<void>;
}

const REAL_RUNTIME: GranolaRuntime = {
  fetch: (input, init) => globalThis.fetch(input, init),
  base: GRANOLA_ENDPOINTS,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
let runtimeForTests: GranolaRuntime | null = null;

/** Solo per i test: il server finto su 127.0.0.1 al posto di Granola (`null`: di nuovo quello vero). */
export function setGranolaRuntimeForTests(runtime: GranolaRuntime | null): void {
  runtimeForTests = runtime;
}

const runtime = (): GranolaRuntime => runtimeForTests ?? REAL_RUNTIME;
const config = (): GranolaConfig => granolaConfig(process.env);
const lsDomains = (): string[] => parseLsDomains(process.env.UC_LS_EMAIL_DOMAINS);

const off = <T>(): ServiceResult<T> => failure<T>("area_spenta", TEXT.unavailable);

/** Chiave `CONTEXT_TOKEN_KEY` valida, indirizzo pubblico noto, non un'anteprima di Vercel, `CONTEXT_GRANOLA` diverso da `off`. */
export function granolaAvailable(env?: Readonly<Record<string, string | undefined>>): boolean {
  return granolaConfig(env ?? process.env).available;
}

/** Granola si può usare adesso: l'ambiente lo permette e la 0038 c'è. */
async function granolaReady(): Promise<boolean> {
  return config().available && (await contextStoreReady());
}

function mcpDeps(rt: GranolaRuntime, endpoints: GranolaEndpoints): GranolaMcpDeps {
  return { fetch: rt.fetch, endpoints };
}

async function endpointsOf(rt: GranolaRuntime): Promise<GranolaEndpoints> {
  return discoverGranola({ fetch: rt.fetch, base: rt.base });
}

// ─── Il collegamento di una persona ──────────────────────────────────

type Connection = typeof contextGranolaConnections.$inferSelect;

async function readConnection(userId: string): Promise<Connection | null> {
  const [row] = await db.select().from(contextGranolaConnections).where(eq(contextGranolaConnections.userId, userId)).limit(1);
  return row ?? null;
}

/** La persona è ancora di Lateral Space (e-mail verificata in `UC_LS_EMAIL_DOMAINS`)? */
async function stillLateralSpace(userId: string): Promise<boolean> {
  const [user] = await db.select({ email: users.email, emailVerified: users.emailVerified }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(user) && isLateralSpaceEmail({ email: user.email, emailVerified: isEmailVerifiedValue(user.emailVerified) }, lsDomains());
}

/** Il collegamento va rifatto: `da_ricollegare`, con il codice. I token restano cifrati finché la persona non ricollega o scollega. */
async function markReconnect(userId: string, code: string): Promise<void> {
  await db.execute(sql`
    UPDATE context_granola_connections SET status = 'da_ricollegare', last_error = ${code}, refreshing_until = NULL, updated_at = now()
    WHERE user_id = ${userId}::uuid`);
}

export interface GranolaStatus {
  available: boolean;
  connected: boolean;
  status: GranolaConnectionStatus | null;
  accountEmail: string | null;
  plan: string | null;
  lastSyncAt: Date | null;
  /** Collegato, e l'ultimo giro ha più di 30 minuti. */
  stale: boolean;
  unsortedCount: number;
  /** Call di questo workspace fermate dal controllo dei testi. */
  blockedCount: number;
}

const STATUS_OFF: GranolaStatus = { available: false, connected: false, status: null, accountEmail: null, plan: null, lastSyncAt: null, stale: false, unsortedCount: 0, blockedCount: 0 };

export async function loadGranolaStatus(i: { userId: string; workspaceId: string; now?: Date }): Promise<GranolaStatus> {
  if (!isUuid(i?.userId) || !isUuid(i?.workspaceId)) return STATUS_OFF;
  try {
    if (!(await granolaReady())) return STATUS_OFF;
    const connection = await readConnection(i.userId);
    if (!connection) return { ...STATUS_OFF, available: true };
    const now = (i.now ?? new Date()).getTime();
    const [blocked] = rowsOf<{ n: number }>(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM context_granola_meetings
        WHERE user_id = ${i.userId}::uuid AND workspace_id = ${i.workspaceId}::uuid AND decision = 'bloccata'`),
    );
    const lastSyncAt = connection.lastSyncAt ?? null;
    return {
      available: true,
      connected: true,
      status: connection.status,
      accountEmail: connection.accountEmail,
      plan: connection.plan,
      lastSyncAt,
      stale: connection.status === "attiva" && (lastSyncAt === null || now - lastSyncAt.getTime() > GRANOLA_LIMITS.staleMinutes * 60_000),
      unsortedCount: connection.unsortedCount,
      blockedCount: Number(blocked?.n ?? 0),
    };
  } catch (error) {
    logSafeError(LOG_SCOPE, "stato_non_letto", error, { workspaceId: i.workspaceId });
    return STATUS_OFF;
  }
}

// ─── Collegare ───────────────────────────────────────────────────────

/** Il `client_id`: l'indirizzo del documento di metadati, oppure (riserva) quello della registrazione dinamica, una sola. */
async function clientIdFor(rt: GranolaRuntime, endpoints: GranolaEndpoints, cfg: GranolaConfig & { origin: string }): Promise<string | null> {
  if (chooseClientMode(endpoints, cfg.clientMode) === "cimd") return clientMetadataUrl(cfg.origin);
  const redirectUri = callbackUrl(cfg.origin);
  const where = and(eq(contextGranolaClients.issuer, endpoints.issuer), eq(contextGranolaClients.redirectUri, redirectUri));
  const [known] = await db.select({ clientId: contextGranolaClients.clientId }).from(contextGranolaClients).where(where).limit(1);
  if (known) return known.clientId;
  const registered = await registerClient({ fetch: rt.fetch, endpoints }, cfg.origin);
  if (!registered) return null;
  await db.insert(contextGranolaClients).values({ issuer: endpoints.issuer, redirectUri, clientId: registered }).onConflictDoNothing();
  // Due registrazioni insieme: vince la prima scritta, e tutti usano quella.
  const [row] = await db.select({ clientId: contextGranolaClients.clientId }).from(contextGranolaClients).where(where).limit(1);
  return row?.clientId ?? null;
}

/**
 * «Collega Granola»: lo stato (una volta sola, 10 minuti), il verifier PKCE cifrato, e l'indirizzo di Granola dove va
 * il browser. Solo Lateral Space, e solo se Granola è attivo.
 */
export async function startGranolaConnect(actor: ContextActor): Promise<ServiceResult<{ url: string }>> {
  const cfg = config();
  if (!cfg.available || !cfg.origin || !cfg.tokenKey) return off();
  const allowed = await gate(actor, "canUseGranola");
  if (!allowed.ok) return allowed;
  const rt = runtime();
  try {
    const endpoints = await endpointsOf(rt);
    const clientId = await clientIdFor(rt, endpoints, { ...cfg, origin: cfg.origin });
    if (!clientId) return failure("riprova", TEXT.connectFailed);
    const redirectUri = callbackUrl(cfg.origin);
    const { verifier, challenge } = createPkce();
    const { state, hash } = createState();
    const sealed = sealGranolaVerifier(cfg.tokenKey, actor.userId, verifier);
    if (!sealed.ok) return off();
    await db.insert(contextGranolaOauthStates).values({
      stateHash: hash,
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      verifierSealed: sealed.value,
      clientId,
      redirectUri,
      expiresAt: sql`now() + interval '10 minutes'`,
    });
    return ok({ url: authorizationUrl(endpoints, { clientId, redirectUri, scope: granolaScopes(endpoints), state, challenge }) });
  } catch (error) {
    logSafeError(LOG_SCOPE, "collegamento_non_iniziato", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

/**
 * Com'è andato il ritorno da Granola: dove porta la rotta di ritorno, e con quale riga (`?granola=…`). Per `scaduto`
 * il workspace è quello da cui la persona ha cominciato il suo ultimo collegamento (null se non ce n'è più traccia).
 */
export type GranolaConnectOutcome = { status: "collegato" | "annullato" | "errore"; workspaceId: string } | { status: "scaduto"; workspaceId: string | null };

/**
 * Lo stato non vale (sconosciuto, scaduto, già usato, di un'altra persona): la persona torna alle Impostazioni del
 * workspace da cui ha cominciato il suo ultimo collegamento, dove la riga dice che è scaduto. Lo stato della richiesta
 * non conta: solo le righe di chi ha fatto l'accesso. Nessun token si chiede.
 */
async function expiredOutcome(userId: string): Promise<GranolaConnectOutcome> {
  try {
    const [last] = rowsOf<{ workspace_id: string }>(
      await db.execute(sql`SELECT workspace_id FROM context_granola_oauth_states WHERE user_id = ${userId}::uuid ORDER BY created_at DESC LIMIT 1`),
    );
    return { status: "scaduto", workspaceId: last ? String(last.workspace_id) : null };
  } catch (error) {
    logSafeError(LOG_SCOPE, "stato_non_letto", error);
    return { status: "scaduto", workspaceId: null };
  }
}

/**
 * Il ritorno da Granola (`GET /api/granola/callback`). Nell'ordine: lo stato si prende una volta sola, e solo da chi
 * l'ha creato (sconosciuto, scaduto, già usato o di un'altra persona: `scaduto`, e niente altro); `error` o `code`
 * mancante: `annullato`; il codice in cambio dei token; l'account (e-mail e piano, se si leggono); i token cifrati.
 */
export async function completeGranolaConnect(i: { userId: string; state: string | null; code: string | null; error: string | null }): Promise<GranolaConnectOutcome> {
  if (!isUuid(i?.userId)) return { status: "scaduto", workspaceId: null };
  // Preso lo stato, un guasto riporta comunque la persona alle Impostazioni del suo workspace, con «errore».
  let workspaceId: string | null = null;
  try {
    if (!(await contextStoreReady())) return { status: "scaduto", workspaceId: null };
    if (!isStateShape(i.state)) return await expiredOutcome(i.userId);
    const [taken] = rowsOf<{ workspace_id: string; verifier_sealed: string; client_id: string; redirect_uri: string }>(
      await db.execute(sql`
        UPDATE context_granola_oauth_states SET used_at = now()
        WHERE state_hash = ${stateHash(i.state)} AND user_id = ${i.userId}::uuid AND used_at IS NULL AND expires_at > now()
        RETURNING workspace_id, verifier_sealed, client_id, redirect_uri`),
    );
    if (!taken) return await expiredOutcome(i.userId);
    workspaceId = String(taken.workspace_id);
    if (i.error || !i.code || i.code.length > 2_000) return { status: "annullato", workspaceId };
    const cfg = config();
    if (!cfg.available || !cfg.tokenKey) return { status: "errore", workspaceId };
    const actor = await contextActorForUser(i.userId, workspaceId, "granola");
    if (!actor || !contextAbilities(actor).canUseGranola) return { status: "errore", workspaceId };
    const verifier = openGranolaVerifier(cfg.tokenKey, i.userId, taken.verifier_sealed);
    if (!verifier.ok) return { status: "errore", workspaceId };
    const rt = runtime();
    const endpoints = await endpointsOf(rt);
    const exchanged = await exchangeCode({ fetch: rt.fetch, endpoints }, { code: i.code, redirectUri: taken.redirect_uri, clientId: taken.client_id, verifier: verifier.value });
    if (!exchanged.ok) {
      console.error(`[${LOG_SCOPE}] token_non_ricevuto`, JSON.stringify({ codice: exchanged.error }));
      return { status: "errore", workspaceId };
    }
    let account: { email: string | null; plan: string | null } = { email: null, plan: null };
    try {
      const deps = mcpDeps(rt, endpoints);
      const session = await openGranolaSession(exchanged.tokens.accessToken, deps);
      account = parseAccountInfo(await callGranolaTool(session, "get_account_info", {}, deps));
    } catch (error) {
      logSafeError(LOG_SCOPE, "account_non_letto", error);
    }
    const sealed = sealGranolaTokens(cfg.tokenKey, i.userId, exchanged.tokens);
    if (!sealed.ok) return { status: "errore", workspaceId };
    const expires = exchanged.expiresIn === null ? sql`NULL::timestamptz` : sql`now() + ${exchanged.expiresIn}::int * interval '1 second'`;
    await db.execute(sql`
      INSERT INTO context_granola_connections (user_id, tokens_sealed, access_expires_at, client_id, account_email, plan, status, connected_at, updated_at)
      VALUES (${i.userId}::uuid, ${sealed.value}, ${expires}, ${taken.client_id}, ${account.email}, ${account.plan}, 'attiva', now(), now())
      ON CONFLICT (user_id) DO UPDATE SET
        tokens_sealed = EXCLUDED.tokens_sealed, access_expires_at = EXCLUDED.access_expires_at, client_id = EXCLUDED.client_id,
        account_email = EXCLUDED.account_email, plan = EXCLUDED.plan, status = 'attiva', refreshing_until = NULL, last_error = NULL,
        connected_at = now(), updated_at = now(),
        synced_through = CASE WHEN context_granola_connections.account_email IS DISTINCT FROM EXCLUDED.account_email THEN NULL ELSE context_granola_connections.synced_through END`);
    return { status: "collegato", workspaceId };
  } catch (error) {
    logSafeError(LOG_SCOPE, "collegamento_non_finito", error);
    return workspaceId ? { status: "errore", workspaceId } : { status: "scaduto", workspaceId: null };
  }
}

/** Il ritorno da Granola come esito: il workspace da cui era partito il collegamento. */
export async function finishGranolaConnect(i: { userId: string; state: string; code: string }): Promise<ServiceResult<{ workspaceId: string }>> {
  const outcome = await completeGranolaConnect({ userId: i?.userId, state: i?.state ?? null, code: i?.code ?? null, error: null });
  if (outcome.status === "collegato") return ok({ workspaceId: outcome.workspaceId });
  if (outcome.status === "scaduto") return failure("non_trovato", TEXT.stateExpired);
  return failure("riprova", TEXT.connectFailed);
}

// ─── L'accesso: token valido, rinnovo, un turno solo ─────────────────

type AccessStop = "non_collegato" | "da_ricollegare" | "riprova";
type Access = { ok: true; token: string } | { ok: false; stop: AccessStop };
const RECONNECT_ERRORS = new Set(["invalid_grant", "invalid_client", "unauthorized_client"]);

/**
 * Un access token valido. Se scade entro 60 secondi (o è quello appena rifiutato), lo rinnova chi prende il turno
 * (`refreshing_until`, 30 secondi, e solo se i token non sono cambiati nel frattempo); gli altri aspettano 1,5 secondi
 * e rileggono, al massimo tre volte. `invalid_grant`, o nessun `refresh_token`: `da_ricollegare`.
 */
async function granolaAccess(userId: string, rt: GranolaRuntime, endpoints: GranolaEndpoints, rejected: string | null = null): Promise<Access> {
  const key = config().tokenKey;
  if (!key) return { ok: false, stop: "non_collegato" };
  for (let waits = 0; ; waits++) {
    const connection = await readConnection(userId);
    if (!connection) return { ok: false, stop: "non_collegato" };
    if (connection.status !== "attiva") return { ok: false, stop: "da_ricollegare" };
    const tokens = openGranolaTokens(key, userId, connection.tokensSealed);
    if (!tokens.ok) {
      await markReconnect(userId, "token_illeggibile");
      return { ok: false, stop: "da_ricollegare" };
    }
    const fresh = connection.accessExpiresAt === null || connection.accessExpiresAt.getTime() > Date.now() + 60_000;
    if (fresh && tokens.value.accessToken !== rejected) return { ok: true, token: tokens.value.accessToken };
    if (!tokens.value.refreshToken) {
      await markReconnect(userId, "token_scaduto");
      return { ok: false, stop: "da_ricollegare" };
    }
    const turn = rowsOf(
      await db.execute(sql`
        UPDATE context_granola_connections SET refreshing_until = now() + interval '30 seconds'
        WHERE user_id = ${userId}::uuid AND status = 'attiva' AND tokens_sealed = ${connection.tokensSealed}
          AND (refreshing_until IS NULL OR refreshing_until < now())
        RETURNING user_id`),
    );
    if (turn.length === 0) {
      // Qualcun altro sta rinnovando (o ha appena rinnovato): si aspetta e si rilegge.
      if (waits >= 3) return { ok: false, stop: "riprova" };
      await rt.sleep(1_500);
      continue;
    }
    const outcome = await refreshTokens({ fetch: rt.fetch, endpoints }, { refreshToken: tokens.value.refreshToken, clientId: connection.clientId });
    if (!outcome.ok) {
      if (RECONNECT_ERRORS.has(outcome.error)) {
        await markReconnect(userId, "token_scaduto");
        return { ok: false, stop: "da_ricollegare" };
      }
      console.error(`[${LOG_SCOPE}] rinnovo_non_riuscito`, JSON.stringify({ codice: outcome.error }));
      await db.execute(sql`UPDATE context_granola_connections SET refreshing_until = NULL WHERE user_id = ${userId}::uuid`);
      return { ok: false, stop: "riprova" };
    }
    // Il `refresh_token` può cambiare; se Granola non ne manda uno nuovo resta quello di prima.
    const next = { ...outcome.tokens, refreshToken: outcome.tokens.refreshToken ?? tokens.value.refreshToken };
    const sealed = sealGranolaTokens(key, userId, next);
    if (!sealed.ok) {
      await db.execute(sql`UPDATE context_granola_connections SET refreshing_until = NULL WHERE user_id = ${userId}::uuid`);
      return { ok: false, stop: "riprova" };
    }
    const expires = outcome.expiresIn === null ? sql`NULL::timestamptz` : sql`now() + ${outcome.expiresIn}::int * interval '1 second'`;
    await db.execute(sql`
      UPDATE context_granola_connections SET tokens_sealed = ${sealed.value}, access_expires_at = ${expires}, refreshing_until = NULL,
        status = 'attiva', last_error = NULL, updated_at = now()
      WHERE user_id = ${userId}::uuid`);
    return { ok: true, token: next.accessToken };
  }
}

/** Un giro o una lettura dal vivo si ferma: il collegamento va rifatto, non c'è, o si riprova dopo. */
class GranolaStop extends Error {
  readonly stop: AccessStop;
  constructor(stop: AccessStop) {
    super(`granola_${stop}`);
    this.name = "GranolaStop";
    this.stop = stop;
  }
}

/**
 * Le chiamate all'MCP di una persona, in fila, in una sessione. Un 401: un rinnovo e la chiamata di nuovo; un 401 anche
 * con il token appena rinnovato: `da_ricollegare`. `limite` con al massimo 5 secondi da aspettare: si aspetta e si
 * riprova una volta.
 */
class GranolaCaller {
  private session: GranolaSession | null = null;
  private token: string | null = null;
  private refreshedAfterRejection = false;
  readonly userId: string;
  readonly rt: GranolaRuntime;
  readonly endpoints: GranolaEndpoints;

  constructor(userId: string, rt: GranolaRuntime, endpoints: GranolaEndpoints) {
    this.userId = userId;
    this.rt = rt;
    this.endpoints = endpoints;
  }

  async call(tool: GranolaReadTool, args: Record<string, unknown>): Promise<string> {
    const deps = mcpDeps(this.rt, this.endpoints);
    let waitedForLimit = false;
    for (;;) {
      try {
        if (!this.token) {
          const access = await granolaAccess(this.userId, this.rt, this.endpoints);
          if (!access.ok) throw new GranolaStop(access.stop);
          this.token = access.token;
        }
        if (!this.session) this.session = await openGranolaSession(this.token, deps);
        const text = await callGranolaTool(this.session, tool, args, deps);
        this.refreshedAfterRejection = false;
        return text;
      } catch (error) {
        if (error instanceof GranolaMcpError && error.code === "non_autorizzato") {
          if (this.refreshedAfterRejection) {
            await markReconnect(this.userId, "token_rifiutato");
            throw new GranolaStop("da_ricollegare");
          }
          const access = await granolaAccess(this.userId, this.rt, this.endpoints, this.token);
          if (!access.ok) throw new GranolaStop(access.stop);
          this.token = access.token;
          this.session = null;
          this.refreshedAfterRejection = true;
          continue;
        }
        if (error instanceof GranolaMcpError && error.code === "limite" && !waitedForLimit && error.retryAfterSeconds !== null && error.retryAfterSeconds <= GRANOLA_LIMITS.shortWaitSeconds) {
          waitedForLimit = true;
          await this.rt.sleep(error.retryAfterSeconds * 1_000);
          continue;
        }
        throw error;
      }
    }
  }
}

// ─── Scollegare ──────────────────────────────────────────────────────

/**
 * «Scollega»: la revoca su Granola (il `refresh_token`, o l'access token; se non riesce si va avanti lo stesso), poi
 * il collegamento, i legami con i workspace e gli stati OAuth della persona. Gli appunti già entrati restano, e
 * restano le decisioni sulle call (`context_granola_meetings`, solo gli id delle call): ricollegato, una call assegnata
 * o lasciata fuori resta com'era.
 */
export async function disconnectGranola(userId: string): Promise<ServiceResult<true>> {
  if (!isUuid(userId)) return notFound();
  try {
    if (!(await contextStoreReady())) return failure("area_spenta", CONTEXT_TEXT.errors.notReady);
    const connection = await readConnection(userId);
    const key = config().tokenKey;
    if (connection && key) {
      const tokens = openGranolaTokens(key, userId, connection.tokensSealed);
      if (tokens.ok) {
        try {
          const rt = runtime();
          const endpoints = await endpointsOf(rt);
          const token = tokens.value.refreshToken ?? tokens.value.accessToken;
          const revoked = await revokeToken({ fetch: rt.fetch, endpoints }, { token, hint: tokens.value.refreshToken ? "refresh_token" : "access_token", clientId: connection.clientId });
          if (!revoked) console.error(`[${LOG_SCOPE}] revoca_non_riuscita`, JSON.stringify({ userId }));
        } catch (error) {
          logSafeError(LOG_SCOPE, "revoca_non_riuscita", error, { userId });
        }
      }
    }
    // Le decisioni sulle call restano: ricollegando, una call assegnata o lasciata fuori non torna in «Da smistare».
    await db.batch([
      db.delete(contextGranolaLinks).where(eq(contextGranolaLinks.userId, userId)),
      db.delete(contextGranolaOauthStates).where(eq(contextGranolaOauthStates.userId, userId)),
      db.delete(contextGranolaConnections).where(eq(contextGranolaConnections.userId, userId)),
    ]);
    return ok(true);
  } catch (error) {
    logSafeError(LOG_SCOPE, "scollegamento_non_riuscito", error, { userId });
    return retry();
  }
}

// ─── I profili dei workspace ─────────────────────────────────────────

interface WorkspaceProfile extends WorkspaceMatchProfile {
  name: string;
  wantTranscript: boolean;
  /** Le persone del cliente che Unbundle conosce già: i contatti e i referenti, fuori da Lateral Space. */
  knownPeople: number;
}

/** `uc_contacts` c'è? Il risultato positivo si tiene per il processo. */
let contactsTableSeen = false;
async function contactsTableReady(): Promise<boolean> {
  if (contactsTableSeen) return true;
  const [row] = rowsOf<{ ok: boolean }>(await db.execute(sql`SELECT to_regclass('public.uc_contacts') IS NOT NULL AS ok`));
  contactsTableSeen = row?.ok === true;
  return contactsTableSeen;
}

const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/**
 * I profili dei workspace dove la persona collegata è di Lateral Space e non segue solo un corso (§8.6): la sua
 * cartella; le persone del cliente, cioè le e-mail dei contatti attivi e non anonimizzati (i referenti sono lì) e quelle
 * aggiunte a mano, fuori dai domini di Lateral Space (un indirizzo intero in una casella pubblica vale per quella persona
 * sola, mai per il dominio); i domini aggiunti a mano; le parole nel titolo, salvate o predefinite. Un membro del
 * workspace non è per forza del cliente (chi costruisce da fuori, per esempio): non conta. In più quando una regola o una
 * cartella è cambiata l'ultima volta.
 */
async function loadProfiles(userId: string, onlyWorkspaceId?: string): Promise<{ profiles: WorkspaceProfile[]; rulesChangedAt: Date | null }> {
  const ls = lsDomains();
  const rows = rowsOf<{
    id: string;
    name: string;
    role: string | null;
    emails: unknown;
    domains: unknown;
    title_words: unknown;
    want_transcript: boolean | null;
    rules_updated_at: unknown;
    folder_id: string | null;
    link_updated_at: unknown;
  }>(
    await db.execute(sql`
      WITH ws AS (
        SELECT w.id, w.name, w.organization_id,
          coalesce(
            (SELECT m.role::text FROM memberships m WHERE m.organization_id = w.organization_id AND m.user_id = ${userId}::uuid LIMIT 1),
            (SELECT wm.role::text FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = ${userId}::uuid LIMIT 1)
          ) AS role
        FROM workspaces w
        WHERE (${onlyWorkspaceId ?? null}::uuid IS NULL OR w.id = ${onlyWorkspaceId ?? null}::uuid)
          AND (EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = w.organization_id AND m.user_id = ${userId}::uuid)
            OR EXISTS (SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = ${userId}::uuid))
      )
      SELECT ws.id, ws.name, ws.role,
        to_json(r.emails) AS emails, to_json(r.domains) AS domains, to_json(r.title_words) AS title_words, r.want_transcript, r.updated_at AS rules_updated_at,
        l.folder_id, l.updated_at AS link_updated_at
      FROM ws
      LEFT JOIN context_granola_rules r ON r.workspace_id = ws.id
      LEFT JOIN context_granola_links l ON l.workspace_id = ws.id AND l.user_id = ${userId}::uuid
      ORDER BY ws.id`),
  );
  const usable = rows.filter((row) => contextAbilities({ role: row.role, isLateralSpace: true }).canUseGranola);
  const contacts = new Map<string, string[]>();
  if (usable.length > 0 && (await contactsTableReady())) {
    const ids = usable.map((row) => row.id);
    const found = rowsOf<{ workspace_id: string; emails: unknown }>(
      await db.execute(sql`
        SELECT workspace_id, to_json(array_agg(DISTINCT lower(email))) AS emails FROM uc_contacts
        WHERE workspace_id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND is_active AND anonymized_at IS NULL AND email IS NOT NULL
        GROUP BY workspace_id`),
    );
    for (const row of found) contacts.set(row.workspace_id, asStrings(row.emails));
  }
  const outsideLs = (email: string) => {
    const domain = emailDomainOf(email);
    return domain !== null && !ls.some((base) => domain === base || domain.endsWith(`.${base}`));
  };
  let rulesChangedAt: Date | null = null;
  const profiles = usable.map((row): WorkspaceProfile => {
    // Le persone che Unbundle conosce già e gli indirizzi scritti a mano, fuori da Lateral Space. Un indirizzo in una
    // casella pubblica vale per sé, confrontato per uguale (`matchMeeting`): mai il suo dominio.
    const known = [...new Set((contacts.get(row.id) ?? []).filter(outsideLs))];
    const manual = asStrings(row.emails).filter(outsideLs);
    for (const changed of [toDate(row.rules_updated_at), toDate(row.link_updated_at)]) {
      if (changed && (!rulesChangedAt || changed > rulesChangedAt)) rulesChangedAt = changed;
    }
    const words = row.title_words === null || row.title_words === undefined ? defaultTitleWords(row.name) : asStrings(row.title_words);
    return {
      workspaceId: row.id,
      name: row.name,
      folderIds: row.folder_id ? [row.folder_id] : [],
      emails: [...new Set([...known, ...manual])],
      domains: asStrings(row.domains),
      titleWords: words,
      wantTranscript: row.want_transcript === true,
      knownPeople: known.length,
    };
  });
  return { profiles, rulesChangedAt };
}

// ─── Il giro ─────────────────────────────────────────────────────────

export type GranolaSyncStatus = "fatto" | "recente" | "in_corso" | "non_collegato" | "da_ricollegare" | "limite" | "non_riuscito";
export interface GranolaSyncResult {
  status: GranolaSyncStatus;
  imported: number;
  updated: number;
  blocked: number;
  unsorted: number;
}

const result = (status: GranolaSyncStatus, counts: Partial<Omit<GranolaSyncResult, "status">> = {}): GranolaSyncResult => ({
  status,
  imported: counts.imported ?? 0,
  updated: counts.updated ?? 0,
  blocked: counts.blocked ?? 0,
  unsorted: counts.unsorted ?? 0,
});

const MEETING_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

/** Tutte le pagine di una ricerca, al massimo 5. `complete`: nessuna pagina è rimasta da leggere. */
async function searchAll(caller: GranolaCaller, args: Record<string, unknown>, pages: number = GRANOLA_LIMITS.maxPages): Promise<{ meetings: GranolaMeetingHead[]; complete: boolean }> {
  const meetings: GranolaMeetingHead[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < pages; page++) {
    const text = await caller.call("search_meetings", { ...args, limit: GRANOLA_LIMITS.pageSize, max_participants: GRANOLA_LIMITS.maxParticipants, ...(cursor ? { cursor } : {}) });
    const parsed = parseSearchMeetings(text);
    meetings.push(...parsed.meetings);
    if (!parsed.hasMore) return { meetings, complete: true };
    if (!parsed.nextCursor || parsed.nextCursor === cursor) return { meetings, complete: false };
    cursor = parsed.nextCursor;
  }
  return { meetings, complete: false };
}

/** Le call di una ricerca, ognuna una volta, con le cartelle scelte in cui stanno. */
async function searchMeetings(caller: GranolaCaller, window: Record<string, unknown>, folderIds: string[], pages?: number) {
  const heads = new Map<string, GranolaMeetingHead>();
  const folders = new Map<string, Set<string>>();
  let complete = true;
  for (const folderId of folderIds.slice(0, GRANOLA_LIMITS.foldersMax)) {
    const found = await searchAll(caller, { ...window, folder_id: folderId }, pages);
    complete &&= found.complete;
    for (const meeting of found.meetings) {
      if (!heads.has(meeting.id)) heads.set(meeting.id, meeting);
      const set = folders.get(meeting.id) ?? new Set<string>();
      set.add(folderId);
      folders.set(meeting.id, set);
    }
  }
  const found = await searchAll(caller, window, pages);
  complete &&= found.complete;
  for (const meeting of found.meetings) if (!heads.has(meeting.id)) heads.set(meeting.id, meeting);
  return { heads, folders, complete };
}

/** Le decisioni della persona su queste call. */
async function loadDecisions(userId: string, meetingIds: readonly string[]) {
  const decisions = new Map<string, { decision: GranolaDecision; workspaceId: string | null; sourceId: string | null; meetingUpdatedAt: Date | null }>();
  for (let i = 0; i < meetingIds.length; i += 200) {
    const slice = meetingIds.slice(i, i + 200);
    const rows = await db
      .select({
        meetingId: contextGranolaMeetings.meetingId,
        decision: contextGranolaMeetings.decision,
        workspaceId: contextGranolaMeetings.workspaceId,
        sourceId: contextGranolaMeetings.sourceId,
        meetingUpdatedAt: contextGranolaMeetings.meetingUpdatedAt,
      })
      .from(contextGranolaMeetings)
      .where(and(eq(contextGranolaMeetings.userId, userId), inArray(contextGranolaMeetings.meetingId, slice)));
    for (const row of rows) decisions.set(row.meetingId, row);
  }
  return decisions;
}

/**
 * La decisione su una call (`context_granola_meetings`). Il giro (`regola`) non tocca mai una call lasciata fuori;
 * una persona sì (`overrideOut`).
 */
async function writeDecision(
  userId: string,
  meetingId: string,
  d: { decision: GranolaDecision; decidedBy: GranolaDecidedBy; workspaceId: string | null; sourceId: string | null; meetingUpdatedAt: string | null; blockCode: string | null },
  overrideOut: boolean,
): Promise<void> {
  const updatedAt = d.meetingUpdatedAt && !Number.isNaN(new Date(d.meetingUpdatedAt).getTime()) ? new Date(d.meetingUpdatedAt) : null;
  await db
    .insert(contextGranolaMeetings)
    .values({ userId, meetingId, decision: d.decision, decidedBy: d.decidedBy, workspaceId: d.workspaceId, sourceId: d.sourceId, meetingUpdatedAt: updatedAt, blockCode: d.blockCode })
    .onConflictDoUpdate({
      target: [contextGranolaMeetings.userId, contextGranolaMeetings.meetingId],
      set: {
        decision: sql`excluded.decision`,
        decidedBy: sql`excluded.decided_by`,
        workspaceId: sql`excluded.workspace_id`,
        sourceId: sql`excluded.source_id`,
        meetingUpdatedAt: sql`excluded.meeting_updated_at`,
        blockCode: sql`excluded.block_code`,
        decidedAt: sql`now()`,
      },
      ...(overrideOut ? {} : { setWhere: sql`${contextGranolaMeetings.decision} <> 'fuori'` }),
    });
}

/** Le note di queste call, a gruppi di 10; le call che Granola omette si chiedono una alla volta. */
async function fetchNotes(caller: GranolaCaller, ids: readonly string[]): Promise<Map<string, GranolaMeetingNote>> {
  const notes = new Map<string, GranolaMeetingNote>();
  const ask = async (batch: readonly string[]) => {
    const text = await caller.call("get_meetings", { meeting_ids: batch, attachments: "none", max_participants: GRANOLA_LIMITS.maxParticipants });
    for (const note of parseGetMeetings(text)) if (batch.includes(note.id)) notes.set(note.id, note);
  };
  for (let i = 0; i < ids.length; i += GRANOLA_LIMITS.notesBatch) {
    const batch = ids.slice(i, i + GRANOLA_LIMITS.notesBatch);
    await ask(batch);
    for (const id of batch) if (!notes.has(id) && batch.length > 1) await ask([id]);
  }
  return notes;
}

interface TranscriptState {
  /** Un errore `piano` spegne le trascrizioni per il resto del giro. */
  disabled: boolean;
}

/** La trascrizione a pezzi da 40.000 caratteri, fino a 200.000. null se non c'è, o se il piano non la dà. */
async function fetchTranscript(caller: GranolaCaller, meetingId: string, state: TranscriptState): Promise<{ text: string; partial: boolean } | null> {
  if (state.disabled) return null;
  let text = "";
  let offset = 0;
  try {
    for (let i = 0; i < Math.ceil(GRANOLA_LIMITS.transcriptMax / GRANOLA_LIMITS.transcriptChunk) + 1; i++) {
      const piece = parseTranscript(await caller.call("get_meeting_transcript", { meeting_id: meetingId, max_chars: GRANOLA_LIMITS.transcriptChunk, offset }));
      if (piece.unavailable || !piece.text) break;
      // I pezzi si uniscono com'è: Granola taglia a un numero di caratteri, non tra una frase e l'altra.
      text += piece.text;
      if (text.length >= GRANOLA_LIMITS.transcriptMax) return { text: text.slice(0, GRANOLA_LIMITS.transcriptMax), partial: true };
      if (piece.nextOffset === null || piece.nextOffset <= offset) break;
      offset = piece.nextOffset;
    }
  } catch (error) {
    if (error instanceof GranolaMcpError && error.code === "piano") {
      state.disabled = true;
      return null;
    }
    if (error instanceof GranolaMcpError && error.code === "protocollo") return text ? { text, partial: true } : null;
    throw error;
  }
  return text.trim() ? { text, partial: false } : null;
}

type ImportOutcome = "importata" | "aggiornata" | "uguale" | "bloccata" | "vuota" | "senza_accesso" | "fuori";

/**
 * Una call di Granola nel «Contesto» di un workspace: il testo (riassunto, note, trascrizione se il workspace la chiede),
 * il controllo dei testi (dati sanitari o discriminatori: `bloccata`, niente entra), `upsertExternalNote`, la decisione
 * `entrata`. L'appunto entra `da_leggere`: il giro non chiama il modello.
 */
async function importMeeting(
  ctx: { caller: GranolaCaller; userId: string; now: Date; transcripts: TranscriptState; actors: Map<string, ContextActor | null>; planTranscripts: boolean },
  note: GranolaMeetingNote,
  workspace: { id: string; wantTranscript: boolean },
  decidedBy: GranolaDecidedBy,
): Promise<{ outcome: ImportOutcome; sourceId: string | null }> {
  let actor = ctx.actors.get(workspace.id);
  if (actor === undefined) {
    actor = await contextActorForUser(ctx.userId, workspace.id, "granola");
    ctx.actors.set(workspace.id, actor);
  }
  if (!actor || !contextAbilities(actor).canAddNotes) return { outcome: "senza_accesso", sourceId: null };
  const transcript = workspace.wantTranscript && ctx.planTranscripts ? await fetchTranscript(ctx.caller, note.id, ctx.transcripts) : null;
  const composed = composeGranolaNote(note, transcript, ctx.now);
  if (!composed) return { outcome: "vuota", sourceId: null };
  const overrideOut = decidedBy === "persona";
  // Mentre il giro leggeva la nota, la persona può aver tolto l'appunto: allora la call resta fuori.
  if (!overrideOut && (await loadDecisions(ctx.userId, [note.id])).get(note.id)?.decision === "fuori") return { outcome: "fuori", sourceId: null };
  for (const text of [composed.title, composed.body, composed.participants ?? ""]) {
    const scan = scanNote(text);
    if (!scan.ok) {
      await writeDecision(ctx.userId, note.id, { decision: "bloccata", decidedBy, workspaceId: workspace.id, sourceId: null, meetingUpdatedAt: note.updatedAt, blockCode: scan.category }, overrideOut);
      return { outcome: "bloccata", sourceId: null };
    }
  }
  const saved = await upsertExternalNote(actor, {
    title: composed.title,
    occurredOn: composed.occurredOn,
    body: composed.body,
    participants: composed.participants,
    link: composed.link,
    origin: "granola",
    kind: composed.kind,
    externalId: note.id,
    externalUpdatedAt: note.updatedAt ? new Date(note.updatedAt) : null,
  });
  if (!saved.ok) {
    if (saved.error === "dati_non_validi") return { outcome: "vuota", sourceId: null };
    throw new GranolaStop("riprova");
  }
  await writeDecision(ctx.userId, note.id, { decision: "entrata", decidedBy, workspaceId: workspace.id, sourceId: saved.value.sourceId, meetingUpdatedAt: note.updatedAt, blockCode: null }, overrideOut);
  await db.execute(sql`
    INSERT INTO context_granola_links (user_id, workspace_id, last_imported_at) VALUES (${ctx.userId}::uuid, ${workspace.id}::uuid, now())
    ON CONFLICT (user_id, workspace_id) DO UPDATE SET last_imported_at = now()`);
  return { outcome: saved.value.created ? "importata" : saved.value.changed ? "aggiornata" : "uguale", sourceId: saved.value.sourceId };
}

/** Il codice dell'errore per `last_error` (`^[a-z0-9_]{2,40}$`). */
function errorCode(error: unknown): string {
  if (error instanceof GranolaStop) return error.stop === "da_ricollegare" ? "token_scaduto" : error.stop;
  if (error instanceof GranolaMcpError) return error.code;
  return "errore";
}

/**
 * Il giro di una persona (§8.7). `force` falso: `recente` se l'ultimo ha meno di 30 minuti. Il turno
 * (`syncing_until`, 3 minuti) lo tiene un giro solo; gli altri rispondono `in_corso`. Le call di un solo cliente entrano
 * `da_leggere`; le altre contano in «Da smistare» e non si salvano. `synced_through` si sposta solo se tutte le pagine
 * sono state lette.
 */
export async function syncGranolaForUser(userId: string, o?: { force?: boolean; budgetMs?: number; now?: Date }): Promise<GranolaSyncResult> {
  if (!isUuid(userId)) return result("non_collegato");
  const started = Date.now();
  const deadline = started + Math.max(1_000, o?.budgetMs ?? 90_000);
  const now = o?.now ?? new Date();
  try {
    if (!(await granolaReady())) return result("non_collegato");
    const connection = await readConnection(userId);
    if (!connection) return result("non_collegato");
    if (connection.status === "da_ricollegare") return result("da_ricollegare");
    if (!(await stillLateralSpace(userId))) return result("non_collegato");
    if (!o?.force && connection.lastSyncAt && now.getTime() - connection.lastSyncAt.getTime() < GRANOLA_LIMITS.staleMinutes * 60_000) return result("recente");
    const turn = rowsOf(
      await db.execute(sql`
        UPDATE context_granola_connections SET syncing_until = now() + interval '3 minutes'
        WHERE user_id = ${userId}::uuid AND status = 'attiva' AND (syncing_until IS NULL OR syncing_until < now())
        RETURNING user_id`),
    );
    if (turn.length === 0) return result("in_corso");
    return await runSync(userId, connection, { deadline, now, started });
  } catch (error) {
    logSafeError(LOG_SCOPE, "giro_non_riuscito", error, { userId });
    return result("non_riuscito");
  }
}

async function runSync(userId: string, connection: Connection, o: { deadline: number; now: Date; started: number }): Promise<GranolaSyncResult> {
  const counts = { imported: 0, updated: 0, blocked: 0, unsorted: 0 };
  let status: GranolaSyncStatus = "fatto";
  let complete = true;
  let newest: Date | null = null;
  let lastError: string | null = null;
  let unsortedCount = connection.unsortedCount;
  try {
    const { profiles, rulesChangedAt } = await loadProfiles(userId);
    // Nessun workspace da guardare: niente si cerca, e `synced_through` non si sposta (il primo workspace avrà il giro intero).
    if (profiles.length === 0) complete = false;
    if (profiles.length > 0) {
      const rt = runtime();
      const endpoints = await endpointsOf(rt);
      const caller = new GranolaCaller(userId, rt, endpoints);
      const full = needsFullRun({ syncedThrough: connection.syncedThrough, lastSyncOkAt: connection.lastSyncOkAt, rulesChangedAt });
      const window = searchWindow(full, connection.syncedThrough, o.now);
      const folderIds = [...new Set(profiles.flatMap((p) => p.folderIds))];
      const search = await searchMeetings(caller, window, folderIds);
      complete = search.complete;
      const heads = [...search.heads.values()];
      for (const head of heads) {
        const at = head.updatedAt ? new Date(head.updatedAt) : null;
        if (at && (!newest || at > newest)) newest = at;
      }
      const decisions = await loadDecisions(userId, heads.map((h) => h.id).filter((id) => MEETING_ID.test(id)));
      const byId = new Map(profiles.map((p) => [p.workspaceId, p]));
      const ls = lsDomains();
      const toImport: Array<{ id: string; workspace: WorkspaceProfile }> = [];
      const unsorted: GranolaMeetingHead[] = [];
      for (const head of heads) {
        if (!MEETING_ID.test(head.id)) continue;
        const known = decisions.get(head.id);
        const step = stepFor(head.updatedAt, known);
        if (step === "salta") continue;
        if (step === "rileggi" || step === "riprova") {
          const workspace = known?.workspaceId ? byId.get(known.workspaceId) : undefined;
          if (workspace) toImport.push({ id: head.id, workspace });
          continue;
        }
        const match = matchMeeting({ title: head.title, participantEmails: participantEmails(head.participants, connection.accountEmail), folderIds: [...(search.folders.get(head.id) ?? [])] }, profiles, ls);
        const single = match.workspaceIds.length === 1 ? byId.get(match.workspaceIds[0]) : undefined;
        if (single) toImport.push({ id: head.id, workspace: single });
        else unsorted.push(head);
      }
      counts.unsorted = unsorted.length;
      if (full) {
        unsortedCount = complete ? unsorted.length : Math.max(connection.unsortedCount, unsorted.length);
      } else {
        // Il giro breve vede solo le call cambiate: contano in più solo quelle registrate dopo l'ultimo giro.
        const since = connection.syncedThrough?.getTime() ?? 0;
        unsortedCount = connection.unsortedCount + unsorted.filter((h) => new Date(h.meetingAt ?? h.updatedAt ?? 0).getTime() > since).length;
      }
      const ctx = { caller, userId, now: o.now, transcripts: { disabled: false }, actors: new Map<string, ContextActor | null>(), planTranscripts: planGivesTranscripts(connection.plan) };
      for (let i = 0; i < toImport.length; i += GRANOLA_LIMITS.notesBatch) {
        if (Date.now() > o.deadline) {
          complete = false;
          break;
        }
        const batch = toImport.slice(i, i + GRANOLA_LIMITS.notesBatch);
        const notes = await fetchNotes(caller, batch.map((item) => item.id));
        for (const item of batch) {
          if (Date.now() > o.deadline) {
            complete = false;
            break;
          }
          // Una call che Granola elenca ma di cui non dà la nota (tolta nel frattempo, o non più condivisa) si salta: senza
          // una decisione, la riprende il prossimo giro intero. Non ferma `synced_through`, o il giro breve non andrebbe più avanti.
          const note = notes.get(item.id);
          if (!note) continue;
          const { outcome } = await importMeeting(ctx, note, { id: item.workspace.workspaceId, wantTranscript: item.workspace.wantTranscript }, "regola");
          if (outcome === "importata") counts.imported++;
          else if (outcome === "aggiornata") counts.updated++;
          else if (outcome === "bloccata") counts.blocked++;
        }
      }
    }
  } catch (error) {
    complete = false;
    lastError = errorCode(error);
    status = error instanceof GranolaStop ? (error.stop === "da_ricollegare" ? "da_ricollegare" : error.stop === "non_collegato" ? "non_collegato" : "non_riuscito") : error instanceof GranolaMcpError && error.code === "limite" ? "limite" : "non_riuscito";
    if (!(error instanceof GranolaStop) && !(error instanceof GranolaMcpError)) logSafeError(LOG_SCOPE, "giro_interrotto", error, { userId });
  }
  const ok = status === "fatto";
  const moveTo = ok && complete ? (newest ?? (connection.syncedThrough ? null : o.now)) : null;
  await db.execute(sql`
    UPDATE context_granola_connections SET
      syncing_until = NULL, last_sync_at = now(), updated_at = now(), last_error = ${lastError}, unsorted_count = ${Math.max(0, unsortedCount)},
      last_sync_ok_at = CASE WHEN ${ok && complete}::boolean THEN now() ELSE last_sync_ok_at END,
      synced_through = CASE WHEN ${moveTo ? moveTo.toISOString() : null}::timestamptz IS NULL THEN synced_through
        ELSE greatest(coalesce(synced_through, ${moveTo ? moveTo.toISOString() : null}::timestamptz), ${moveTo ? moveTo.toISOString() : null}::timestamptz) END
    WHERE user_id = ${userId}::uuid`);
  console.info(
    `[${LOG_SCOPE}] giro`,
    JSON.stringify({ stato: status, completo: complete, importate: counts.imported, aggiornate: counts.updated, bloccate: counts.blocked, daSmistare: counts.unsorted, durataMs: Date.now() - o.started }),
  );
  return result(status, counts);
}

/** Il giro della notte, per ogni persona collegata; toglie i collegamenti di chi non è più di Lateral Space e gli stati OAuth scaduti. */
export async function syncGranolaAll(o: { budgetMs: number; now?: Date }): Promise<{ users: number; imported: number; errors: number }> {
  const totals = { users: 0, imported: 0, errors: 0 };
  const deadline = Date.now() + Math.max(0, o?.budgetMs ?? 0);
  try {
    if (!(await granolaReady())) return totals;
    await db.execute(sql`DELETE FROM context_granola_oauth_states WHERE expires_at < now() - interval '1 day'`);
    const people = await db
      .select({ userId: contextGranolaConnections.userId, status: contextGranolaConnections.status })
      .from(contextGranolaConnections)
      .orderBy(sql`${contextGranolaConnections.lastSyncAt} ASC NULLS FIRST`, contextGranolaConnections.userId);
    // Senza domini di Lateral Space nessuno lo è: non si scollega nessuno per un errore di configurazione.
    const canCheck = lsDomains().length > 0;
    for (const person of people) {
      if (Date.now() > deadline - 3_000) break;
      try {
        if (canCheck && !(await stillLateralSpace(person.userId))) {
          await disconnectGranola(person.userId);
          continue;
        }
        if (person.status !== "attiva") continue;
        totals.users++;
        const done = await syncGranolaForUser(person.userId, { force: true, budgetMs: deadline - Date.now(), now: o?.now });
        totals.imported += done.imported;
        if (done.status === "non_riuscito" || done.status === "limite" || done.status === "da_ricollegare") totals.errors++;
      } catch (error) {
        totals.errors++;
        logSafeError(LOG_SCOPE, "giro_persona_non_riuscito", error, { userId: person.userId });
      }
    }
  } catch (error) {
    totals.errors++;
    logSafeError(LOG_SCOPE, "giro_notte_non_riuscito", error);
  }
  return totals;
}

// ─── «Da smistare», «Assegna», «Lascia fuori» ────────────────────────

export interface UnsortedMeeting {
  id: string;
  title: string;
  /** AAAA-MM-GG, o null. */
  date: string | null;
  participants: string;
}

/** Il messaggio di un giro dal vivo che si è fermato. */
function liveFailure<T>(error: unknown): ServiceResult<T> {
  if (error instanceof GranolaStop) {
    if (error.stop === "da_ricollegare") return failure("riprova", TEXT.expired);
    if (error.stop === "non_collegato") return failure("non_trovato", TEXT.notConnectedLine);
    return failure("riprova", TEXT.loadFailed);
  }
  if (error instanceof GranolaMcpError && error.code === "limite") return failure("riprova", TEXT.rateLimited);
  return failure("riprova", TEXT.loadFailed);
}

/** Il collegamento attivo di chi guarda, o l'esito per chi non l'ha. */
async function liveConnection(actor: ContextActor): Promise<{ ok: true; connection: Connection } | { ok: false; result: ServiceResult<never> }> {
  if (!config().available) return { ok: false, result: off() };
  const allowed = await gate(actor, "canUseGranola");
  if (!allowed.ok) return { ok: false, result: allowed };
  const connection = await readConnection(actor.userId);
  if (!connection) return { ok: false, result: failure("non_trovato", TEXT.notConnectedLine) };
  if (connection.status !== "attiva") return { ok: false, result: failure("riprova", TEXT.expired) };
  return { ok: true, connection };
}

/**
 * «Da smistare», letto dal vivo da Granola con il token di chi guarda: gli ultimi 30 giorni, una pagina da 100, meno le
 * call con una decisione, meno quelle che corrispondono a un solo workspace. Niente si salva: solo il conto.
 */
export async function listGranolaUnsorted(actor: ContextActor): Promise<ServiceResult<UnsortedMeeting[]>> {
  const live = await liveConnection(actor);
  if (!live.ok) return live.result;
  try {
    const { profiles } = await loadProfiles(actor.userId);
    const rt = runtime();
    const caller = new GranolaCaller(actor.userId, rt, await endpointsOf(rt));
    const now = new Date();
    const search = await searchMeetings(caller, searchWindow(true, null, now), [...new Set(profiles.flatMap((p) => p.folderIds))], 1);
    const heads = [...search.heads.values()].filter((h) => MEETING_ID.test(h.id));
    const decisions = await loadDecisions(actor.userId, heads.map((h) => h.id));
    const ls = lsDomains();
    const unsorted = heads.filter((head) => {
      if (decisions.has(head.id)) return false;
      const match = matchMeeting({ title: head.title, participantEmails: participantEmails(head.participants, live.connection.accountEmail), folderIds: [...(search.folders.get(head.id) ?? [])] }, profiles, ls);
      return match.workspaceIds.length !== 1;
    });
    await db.execute(sql`UPDATE context_granola_connections SET unsorted_count = ${unsorted.length} WHERE user_id = ${actor.userId}::uuid`);
    return ok(
      unsorted.map((head) => ({
        id: head.id,
        title: head.title || CONTEXT_TEXT.fact.sourceCallWord,
        date: head.meetingAt ? romeDate(new Date(head.meetingAt)) : null,
        // I nomi (o l'e-mail di chi non ha un nome), senza chi ha registrato, senza «(note creator)» e «from …».
        participants: unsortedParticipants(head.participants, live.connection.accountEmail),
      })),
    );
  } catch (error) {
    if (!(error instanceof GranolaStop) && !(error instanceof GranolaMcpError)) logSafeError(LOG_SCOPE, "da_smistare_non_letto", error, { workspaceId: actor.workspaceId });
    return liveFailure(error);
  }
}

/** Il conto di «Da smistare» dopo una scelta della persona. */
async function lowerUnsorted(userId: string, by: number): Promise<void> {
  if (by <= 0) return;
  await db.execute(sql`UPDATE context_granola_connections SET unsorted_count = greatest(unsorted_count - ${by}::int, 0) WHERE user_id = ${userId}::uuid`);
}

/** «Assegna a {cliente}»: la nota di quella call, il controllo dei testi, l'appunto nel workspace della pagina, la decisione `entrata` della persona. */
export async function assignGranolaMeeting(actor: ContextActor, meetingId: string): Promise<ServiceResult<{ sourceId: string }>> {
  if (typeof meetingId !== "string" || !MEETING_ID.test(meetingId) || /^evt_/i.test(meetingId)) return notFound();
  const live = await liveConnection(actor);
  if (!live.ok) return live.result;
  try {
    const known = (await loadDecisions(actor.userId, [meetingId])).get(meetingId);
    if (known?.decision === "entrata") {
      if (known.workspaceId !== actor.workspaceId) return notFound();
      if (known.sourceId) {
        const [source] = await db.select({ id: contextSources.id }).from(contextSources).where(and(eq(contextSources.id, known.sourceId), eq(contextSources.workspaceId, actor.workspaceId))).limit(1);
        if (source) return ok({ sourceId: source.id });
      }
    }
    const rt = runtime();
    const caller = new GranolaCaller(actor.userId, rt, await endpointsOf(rt));
    const note = (await fetchNotes(caller, [meetingId])).get(meetingId);
    if (!note) return notFound();
    const { profiles } = await loadProfiles(actor.userId, actor.workspaceId);
    const imported = await importMeeting(
      {
        caller,
        userId: actor.userId,
        now: new Date(),
        transcripts: { disabled: false },
        actors: new Map<string, ContextActor | null>([[actor.workspaceId, actor]]),
        planTranscripts: planGivesTranscripts(live.connection.plan),
      },
      note,
      { id: actor.workspaceId, wantTranscript: profiles[0]?.wantTranscript ?? false },
      "persona",
    );
    if (imported.outcome === "bloccata") return failure("dati_non_validi", TEXT.blocked(1));
    if (imported.outcome === "vuota") return failure("dati_non_validi", TEXT.noNotes);
    if (imported.outcome === "senza_accesso" || !imported.sourceId) return failure("permesso_mancante", CONTEXT_TEXT.errors.denied);
    if (!known || known.decision !== "entrata") await lowerUnsorted(actor.userId, 1);
    return ok({ sourceId: imported.sourceId });
  } catch (error) {
    if (!(error instanceof GranolaStop) && !(error instanceof GranolaMcpError)) logSafeError(LOG_SCOPE, "assegnazione_non_riuscita", error, { workspaceId: actor.workspaceId });
    return liveFailure(error);
  }
}

/** «Lascia fuori»: la decisione `fuori` della persona, con il solo id della call (niente titolo, niente workspace). */
export async function leaveOutGranolaMeetings(actor: ContextActor, meetingIds: readonly string[]): Promise<ServiceResult<{ left: number }>> {
  if (!config().available) return off();
  const allowed = await gate(actor, "canUseGranola");
  if (!allowed.ok) return allowed;
  const ids = [...new Set((Array.isArray(meetingIds) ? meetingIds : []).filter((id): id is string => typeof id === "string" && MEETING_ID.test(id) && !/^evt_/i.test(id)))];
  if (ids.length === 0 || ids.length > 100) return failure("dati_non_validi", CONTEXT_TEXT.errors.invalid);
  try {
    const connection = await readConnection(actor.userId);
    if (!connection) return failure("non_trovato", TEXT.notConnectedLine);
    const inserted = await db
      .insert(contextGranolaMeetings)
      .values(ids.map((meetingId) => ({ userId: actor.userId, meetingId, decision: "fuori" as const, decidedBy: "persona" as const })))
      .onConflictDoNothing()
      .returning({ meetingId: contextGranolaMeetings.meetingId });
    await lowerUnsorted(actor.userId, inserted.length);
    return ok({ left: inserted.length });
  } catch (error) {
    logSafeError(LOG_SCOPE, "lascia_fuori_non_riuscito", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

// ─── Le regole del workspace ─────────────────────────────────────────

export interface GranolaRulesView {
  /** Di chi guarda, per questo workspace. */
  folder: { id: string; name: string } | null;
  /** Persone del cliente che Unbundle conosce già. */
  knownPeople: number;
  emails: string[];
  domains: string[];
  /** Quelle salvate, o le predefinite dal nome. */
  titleWords: string[];
  titleWordsAreDefault: boolean;
  wantTranscript: boolean;
  transcriptAvailable: boolean;
}

export async function readGranolaRules(actor: ContextActor): Promise<GranolaRulesView | null> {
  if (!config().available) return null;
  const allowed = await gate(actor, "canUseGranola");
  if (!allowed.ok) return null;
  try {
    const [[workspace], [rules], [link], connection, { profiles }] = await Promise.all([
      db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, actor.workspaceId)).limit(1),
      db.select().from(contextGranolaRules).where(eq(contextGranolaRules.workspaceId, actor.workspaceId)).limit(1),
      db.select().from(contextGranolaLinks).where(and(eq(contextGranolaLinks.userId, actor.userId), eq(contextGranolaLinks.workspaceId, actor.workspaceId))).limit(1),
      readConnection(actor.userId),
      loadProfiles(actor.userId, actor.workspaceId),
    ]);
    if (!workspace) return null;
    const saved = rules?.titleWords ?? null;
    return {
      folder: link?.folderId ? { id: link.folderId, name: link.folderName ?? link.folderId } : null,
      knownPeople: profiles[0]?.knownPeople ?? 0,
      emails: rules?.emails ?? [],
      domains: rules?.domains ?? [],
      titleWords: saved ?? defaultTitleWords(workspace.name),
      titleWordsAreDefault: saved === null,
      wantTranscript: rules?.wantTranscript ?? false,
      transcriptAvailable: planGivesTranscripts(connection?.plan ?? null),
    };
  } catch (error) {
    logSafeError(LOG_SCOPE, "regole_non_lette", error, { workspaceId: actor.workspaceId });
    return null;
  }
}

/**
 * «Salva» delle regole: le regole valgono per il workspace (le scrive chi è di Lateral Space), la cartella è di chi
 * guarda. La data cambia solo se cambia qualcosa: così il giro dopo è intero solo quando serve.
 */
export async function saveGranolaRules(
  actor: ContextActor,
  input: { folderId: string | null; folderName: string | null; emails: string[]; domains: string[]; titleWords: string[]; wantTranscript: boolean },
): Promise<ServiceResult<true>> {
  if (!config().available) return off();
  const allowed = await gate(actor, "canUseGranola");
  if (!allowed.ok) return allowed;
  const cleaned = cleanGranolaRules(input, lsDomains());
  if (!cleaned.ok) return failure("dati_non_validi", CONTEXT_TEXT.errors.invalid, cleaned.fieldErrors);
  const rules = cleaned.value;
  try {
    const [workspace] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, actor.workspaceId)).limit(1);
    if (!workspace) return notFound();
    const titleWords = sameWords(rules.titleWords, defaultTitleWords(workspace.name)) ? null : rules.titleWords;
    await db
      .insert(contextGranolaRules)
      .values({ workspaceId: actor.workspaceId, emails: rules.emails, domains: rules.domains, titleWords, wantTranscript: rules.wantTranscript, updatedByUserId: actor.userId })
      .onConflictDoUpdate({
        target: contextGranolaRules.workspaceId,
        set: { emails: sql`excluded.emails`, domains: sql`excluded.domains`, titleWords: sql`excluded.title_words`, wantTranscript: sql`excluded.want_transcript`, updatedByUserId: sql`excluded.updated_by_user_id`, updatedAt: sql`now()` },
        setWhere: sql`(${contextGranolaRules.emails}, ${contextGranolaRules.domains}, ${contextGranolaRules.titleWords}, ${contextGranolaRules.wantTranscript}) IS DISTINCT FROM (excluded.emails, excluded.domains, excluded.title_words, excluded.want_transcript)`,
      });
    await db
      .insert(contextGranolaLinks)
      .values({ userId: actor.userId, workspaceId: actor.workspaceId, folderId: rules.folderId, folderName: rules.folderName })
      .onConflictDoUpdate({
        target: [contextGranolaLinks.userId, contextGranolaLinks.workspaceId],
        set: { folderId: sql`excluded.folder_id`, folderName: sql`excluded.folder_name`, updatedAt: sql`now()` },
        setWhere: sql`(${contextGranolaLinks.folderId}, ${contextGranolaLinks.folderName}) IS DISTINCT FROM (excluded.folder_id, excluded.folder_name)`,
      });
    return ok(true);
  } catch (error) {
    logSafeError(LOG_SCOPE, "regole_non_salvate", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

/** Le cartelle di Granola di chi guarda, per il menu delle regole. */
export async function listGranolaFolders(actor: ContextActor): Promise<ServiceResult<Array<{ id: string; name: string }>>> {
  const live = await liveConnection(actor);
  if (!live.ok) return live.result;
  try {
    const rt = runtime();
    const caller = new GranolaCaller(actor.userId, rt, await endpointsOf(rt));
    return ok(parseFolders(await caller.call("list_meeting_folders", {})));
  } catch (error) {
    if (!(error instanceof GranolaStop) && !(error instanceof GranolaMcpError)) logSafeError(LOG_SCOPE, "cartelle_non_lette", error, { workspaceId: actor.workspaceId });
    return liveFailure(error);
  }
}
