/**
 * Limite di richieste dei server MCP remoti, in Postgres (tabella
 * `connector_rate_limits` della 0019, sul modello di `uc_rate_limits`; niente
 * Upstash, che sarebbe un fornitore in più).
 *
 * Parte generica, con parametri: secchi con un prefisso (`conn` per il connettore,
 * `team` per il MCP del team, `docs/use-case/DESIGN.md` §9.4), finestre di un
 * minuto, un'ora o un giorno, un costo per regola (il MCP del team conta le schede
 * create). Le finestre si allineano al fuso della regola (`timeZone`, predefinito
 * UTC): un giorno va da mezzanotte a mezzanotte in quel fuso, quindi con l'ora
 * legale dura 23 o 25 ore (il calcolo è del database, `date_trunc` con il fuso e
 * l'aritmetica del calendario). Il MCP del team la usa senza modifiche.
 *
 * Un solo statement per chiamata (`neon-http` non ha transazioni interattive):
 *  1. legge i contatori della finestra corrente;
 *  2. se **tutti** i secchi hanno spazio, li incrementa insieme (upsert);
 *     altrimenti non incrementa nulla: una richiesta respinta non consuma, così un
 *     client che riprova a vuoto non esaurisce il secchio del giorno;
 *  3. se due richieste concorrenti passano insieme il controllo, quella che porta un
 *     contatore oltre il limite si respinge lo stesso: il limite non si supera mai.
 * Oltre il limite: `retryAfterSeconds` fino alla fine della finestra del secchio
 * pieno, calcolato sull'orologio del database; con più secchi pieni, quello che si
 * libera per ultimo (un invio respinto dall'ora e dal giorno riprova a mezzanotte).
 *
 * Pulizia: dopo una scrittura, con probabilità 1 su 100, si cancellano le finestre
 * più vecchie di 48 ore.
 *
 * Parte del connettore (prompt WP4), con i limiti di `workspace_connector_configs.limits`:
 *  - letture: `conn:<tokenId>:read`, un'ora;
 *  - invii: `conn:<tokenId>:submit`, un'ora, più `conn:ws:<workspaceId>:submit:day`,
 *    un giorno da mezzanotte a mezzanotte in ora italiana (`Europe/Rome`, decisione
 *    dell'arresto B); in fase 2 `conn:user:<identityId>:submit` al posto del token.
 * Contano **solo** le chiamate `tools/call`: `initialize`, le notifiche e
 * `tools/list` non consumano (`rateLimitKindForMessage` restituisce null).
 *
 * Modulo puro: il database arriva come funzione `SqlExecutor`
 * (nell'app `db.$client.query`); gira con `node --test`.
 */
import { connectorError, type ConnectorError } from "./contract.ts";
import type { ConnectorLimits } from "../db/connector-ddl.ts";
import { logSafeError } from "../log/safe-error.ts";

export type SqlExecutor = (text: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>;

export type RateWindow = "minute" | "hour" | "day";

export const RATE_WINDOW_SECONDS: Readonly<Record<RateWindow, number>> = Object.freeze({
  minute: 60,
  hour: 3_600,
  day: 86_400,
});

export interface RateLimitRule {
  bucket: string;
  window: RateWindow;
  /** Massimo per finestra (0 = tutto respinto). */
  limit: number;
  /** Unità consumate da questa richiesta; predefinito 1. */
  cost?: number;
  /** Fuso IANA a cui si allinea la finestra (es. `Europe/Rome`); predefinito `UTC`. */
  timeZone?: string;
}

export type RateLimitDenial = { ok: false; bucket: string; limit: number; retryAfterSeconds: number };

export type RateLimitDecision = { ok: true } | RateLimitDenial;

export const RATE_LIMIT_RETENTION_HOURS = 48;
export const RATE_LIMIT_CLEANUP_PROBABILITY = 0.01;
/** Fuso delle finestre quando la regola non ne indica uno. */
export const RATE_LIMIT_DEFAULT_TIME_ZONE = "UTC";

const PREFIX = /^[a-z]{1,10}$/;
const PART = /^[A-Za-z0-9_-]{1,64}$/;
const BUCKET = /^[a-z]{1,10}:[A-Za-z0-9:_-]{1,109}$/;
const LIMIT_MAX = 1_000_000_000;
const COST_MAX = 1_000;
const TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+-]{0,30}(\/[A-Za-z0-9_+-]{1,30}){0,2}$/;

/**
 * Un fuso IANA che sia Node sia Postgres conoscono per nome (`Europe/Rome`, `UTC`).
 * Solo lettere, cifre, `_`, `+`, `-` e al massimo due `/`: il valore entra nello
 * statement come parametro, mai nel testo SQL.
 */
export function isRateLimitTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !TIME_ZONE.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Nome di un secchio: `<prefisso>:<parte>:<parte>…`, al massimo 120 caratteri. */
export function rateLimitBucket(prefix: string, ...parts: string[]): string {
  if (!PREFIX.test(prefix)) throw new Error("Prefisso del secchio non valido");
  if (parts.length === 0 || parts.some((p) => !PART.test(p))) throw new Error("Parte del secchio non valida");
  const bucket = [prefix, ...parts].join(":");
  if (bucket.length > 120) throw new Error("Secchio troppo lungo");
  return bucket;
}

function checkRules(rules: readonly RateLimitRule[]) {
  if (rules.length === 0) throw new Error("Nessun secchio");
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!BUCKET.test(rule.bucket) || rule.bucket.length > 120) throw new Error("Secchio non valido");
    if (!Object.hasOwn(RATE_WINDOW_SECONDS, rule.window)) throw new Error("Finestra non valida");
    if (!Number.isInteger(rule.limit) || rule.limit < 0 || rule.limit > LIMIT_MAX) throw new Error("Limite non valido");
    const cost = rule.cost ?? 1;
    if (!Number.isInteger(cost) || cost < 1 || cost > COST_MAX) throw new Error("Costo non valido");
    if (rule.timeZone !== undefined && !isRateLimitTimeZone(rule.timeZone)) throw new Error("Fuso non valido");
    if (seen.has(rule.bucket)) throw new Error("Secchio ripetuto");
    seen.add(rule.bucket);
  }
}

/**
 * Lo statement che controlla e consuma tutti i secchi insieme. Restituisce una riga
 * per secchio: `bucket`, `lim`, `used` (prima), `after_count` (dopo, null se non
 * consumato), `allowed`, `retry_after` (secondi alla fine della finestra).
 *
 * Parametri: `$1` le regole (JSON), `$2` l'istante della richiesta, null per l'orologio
 * del database (sempre, nell'app; i test passano un istante per provare i cambi d'ora).
 * Inizio della finestra: `date_trunc(unità, istante, fuso)`. Fine: per il giorno, la
 * mezzanotte dopo nel fuso (`+ 1 day` sull'ora locale, quindi 23 o 25 ore nei giorni
 * del cambio d'ora); per minuto e ora, l'inizio più la durata fissa.
 */
export const CONSUME_RATE_LIMITS_SQL = `WITH clock AS (
  SELECT coalesce($2::timestamptz, now()) AS at
),
req AS (
  SELECT x.bucket, x.lim, x.cost, x.unit, x.secs, x.tz, date_trunc(x.unit, clock.at, x.tz) AS window_start
  FROM jsonb_to_recordset($1::jsonb) AS x(bucket text, unit text, lim integer, cost integer, secs integer, tz text), clock
),
cur AS (
  SELECT req.bucket, req.lim, req.cost, req.window_start, coalesce(c.count, 0) AS used,
    CASE WHEN req.unit = 'day'
      THEN ((req.window_start AT TIME ZONE req.tz) + interval '1 day') AT TIME ZONE req.tz
      ELSE req.window_start + make_interval(secs => req.secs)
    END AS window_end
  FROM req
  LEFT JOIN connector_rate_limits c ON c.bucket = req.bucket AND c.window_start = req.window_start
),
verdict AS (
  SELECT coalesce(bool_and(cur.used + cur.cost <= cur.lim), false) AS allowed FROM cur
),
hit AS (
  INSERT INTO connector_rate_limits (bucket, window_start, count)
  SELECT req.bucket, req.window_start, req.cost FROM req, verdict WHERE verdict.allowed
  ON CONFLICT (bucket, window_start) DO UPDATE SET count = connector_rate_limits.count + EXCLUDED.count
  RETURNING bucket, count
)
SELECT cur.bucket, cur.lim, cur.used, cur.cost, hit.count AS after_count, verdict.allowed,
  greatest(1, ceil(extract(epoch FROM (cur.window_end - clock.at))))::integer AS retry_after
FROM cur CROSS JOIN verdict CROSS JOIN clock LEFT JOIN hit ON hit.bucket = cur.bucket`;

/** Pulizia delle finestre vecchie (più di 48 ore). */
export const CLEANUP_RATE_LIMITS_SQL = `DELETE FROM connector_rate_limits WHERE window_start < now() - make_interval(hours => ${RATE_LIMIT_RETENTION_HOURS})`;

export function consumeRateLimitsParams(rules: readonly RateLimitRule[], at: Date | null = null): unknown[] {
  checkRules(rules);
  if (at !== null && !(at instanceof Date && Number.isFinite(at.getTime()))) throw new Error("Istante non valido");
  return [
    JSON.stringify(
      rules.map((r) => ({
        bucket: r.bucket,
        unit: r.window,
        lim: r.limit,
        cost: r.cost ?? 1,
        secs: RATE_WINDOW_SECONDS[r.window],
        tz: r.timeZone ?? RATE_LIMIT_DEFAULT_TIME_ZONE,
      }))
    ),
    at ? at.toISOString() : null,
  ];
}

function toBool(value: unknown) {
  return value === true || value === "t" || value === "true";
}

function toInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface ConsumeOptions {
  /** Numero casuale in [0, 1): per i test della pulizia. */
  random?: () => number;
  cleanupProbability?: number;
  log?: Pick<Console, "error">;
  /** Istante della richiesta, solo per i test (cambi d'ora); senza, l'orologio del database. */
  at?: Date;
}

/**
 * Controlla e consuma i secchi di una richiesta. Un errore del database si propaga:
 * chi chiama decide la risposta (il connettore risponde `internal_error`).
 */
export async function consumeRateLimits(
  exec: SqlExecutor,
  rules: readonly RateLimitRule[],
  opts: ConsumeOptions = {}
): Promise<RateLimitDecision> {
  const params = consumeRateLimitsParams(rules, opts.at ?? null);
  const rows = await exec(CONSUME_RATE_LIMITS_SQL, params);
  const byBucket = new Map(rows.map((row) => [String(row.bucket), row]));
  if (rules.some((r) => !byBucket.has(r.bucket))) throw new Error("Risposta del limite incompleta");

  const deny = (rule: RateLimitRule): RateLimitDenial => ({
    ok: false,
    bucket: rule.bucket,
    limit: rule.limit,
    retryAfterSeconds: Math.max(1, toInt(byBucket.get(rule.bucket)!.retry_after) ?? RATE_WINDOW_SECONDS[rule.window]),
  });
  // Con più secchi pieni vale quello che si libera per ultimo: prima la richiesta
  // sarebbe respinta di nuovo (l'ora finisce, il giorno di Roma no). A pari attesa,
  // il primo nell'ordine delle regole.
  const denyLongest = (full: readonly RateLimitRule[]): RateLimitDenial =>
    full.map(deny).reduce((longest, next) => (next.retryAfterSeconds > longest.retryAfterSeconds ? next : longest));

  const allowed = rules.every((r) => toBool(byBucket.get(r.bucket)!.allowed));
  if (!allowed) {
    const full = rules.filter((r) => (toInt(byBucket.get(r.bucket)!.used) ?? 0) + (r.cost ?? 1) > r.limit);
    return denyLongest(full.length > 0 ? full : [rules[0]]);
  }

  const random = opts.random ?? Math.random;
  if (random() < (opts.cleanupProbability ?? RATE_LIMIT_CLEANUP_PROBABILITY)) {
    try {
      await exec(CLEANUP_RATE_LIMITS_SQL, []);
    } catch (error) {
      logSafeError("rate-limit", "cleanup_failed", error, {}, opts.log);
    }
  }

  // Due richieste concorrenti possono passare insieme il controllo: chi ha portato
  // un contatore oltre il limite si respinge (le sue unità restano consumate).
  const overshoot = rules.filter((r) => (toInt(byBucket.get(r.bucket)!.after_count) ?? 0) > r.limit);
  return overshoot.length > 0 ? denyLongest(overshoot) : { ok: true };
}

// ── Connettore ───────────────────────────────────────────────────────

export const CONNECTOR_BUCKET_PREFIX = "conn";

/**
 * Fuso del secchio giornaliero del workspace: il giorno ricomincia a mezzanotte in
 * Italia, anche nei giorni del cambio d'ora (decisione dell'arresto B, 14/10/2026).
 */
export const CONNECTOR_DAY_TIME_ZONE = "Europe/Rome";

export type ConnectorRateKind = "read" | "submit";

/** `submit_contribution` consuma il secchio degli invii; ogni altro tool quello delle letture. */
export function connectorToolRateKind(tool: string): ConnectorRateKind {
  return tool === "submit_contribution" ? "submit" : "read";
}

/**
 * Il secchio di un messaggio JSON-RPC: solo `tools/call` consuma. `initialize`,
 * notifiche, `tools/list`, `ping` e le risposte danno null.
 */
export function rateLimitKindForMessage(message: unknown): ConnectorRateKind | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const { method, params } = message as { method?: unknown; params?: unknown };
  if (method !== "tools/call") return null;
  const name = params && typeof params === "object" ? (params as { name?: unknown }).name : undefined;
  return connectorToolRateKind(typeof name === "string" ? name : "");
}

/** I secchi di un corpo JSON-RPC (messaggio singolo o lotto), nell'ordine. */
export function rateLimitKindsForBody(body: unknown): ConnectorRateKind[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages.map(rateLimitKindForMessage).filter((k): k is ConnectorRateKind => k !== null);
}

export interface RateLimitPrincipal {
  workspaceId: string;
  /** Fase 1: token di workspace. */
  tokenId: string | null;
  /** Fase 2: identità verificata; se c'è, i secchi sono per persona. */
  identityId: string | null;
}

/** Le regole di una chiamata del connettore, con i limiti del workspace. */
export function connectorRateLimitRules(
  principal: RateLimitPrincipal,
  kind: ConnectorRateKind,
  limits: ConnectorLimits,
  prefix: string = CONNECTOR_BUCKET_PREFIX
): RateLimitRule[] {
  const credential = principal.identityId ? ["user", principal.identityId] : principal.tokenId ? [principal.tokenId] : null;
  if (!credential) throw new Error("Principal senza credenziale");
  if (kind === "read") {
    return [{ bucket: rateLimitBucket(prefix, ...credential, "read"), window: "hour", limit: limits.readsPerHour }];
  }
  return [
    {
      bucket: rateLimitBucket(prefix, ...credential, "submit"),
      window: "hour",
      limit: principal.identityId ? limits.submitsPerHourPerUser : limits.submitsPerHour,
    },
    {
      bucket: rateLimitBucket(prefix, "ws", principal.workspaceId, "submit", "day"),
      window: "day",
      limit: limits.submitsPerDayWorkspace,
      timeZone: CONNECTOR_DAY_TIME_ZONE,
    },
  ];
}

/**
 * Consuma il limite di una chiamata `tools/call` del connettore. Oltre il limite:
 * `rate_limited` con `retryAfterSeconds`. Un errore del database diventa
 * `internal_error`, con un log senza dati della richiesta.
 */
export async function consumeConnectorRateLimit(
  exec: SqlExecutor,
  input: { principal: RateLimitPrincipal; tool: string; limits: ConnectorLimits },
  opts: ConsumeOptions = {}
): Promise<{ ok: true } | { ok: false; error: ConnectorError }> {
  try {
    const rules = connectorRateLimitRules(input.principal, connectorToolRateKind(input.tool), input.limits);
    const decision = await consumeRateLimits(exec, rules, opts);
    if (decision.ok) return { ok: true };
    return { ok: false, error: connectorError("rate_limited", { retryAfterSeconds: decision.retryAfterSeconds }) };
  } catch (error) {
    logSafeError("connector", "rate_limit_failed", error, {}, opts.log);
    return { ok: false, error: connectorError("internal_error") };
  }
}
