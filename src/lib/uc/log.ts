/**
 * Log strutturato della sezione «Casi d'uso» (DESIGN §7.1 P0-6).
 *
 * Una riga JSON per evento: `{level, area, op, code, pgCode, digest, workspaceId,
 * caseId, durationMs}`, più `route` (il percorso della rotta, con il token dei
 * link personali riscritto in `[token]`). Mai token, email, valori, testi
 * d'errore o nomi di file: ogni campo passa da un filtro che lascia solo
 * codici brevi, UUID e numeri. Il messaggio di un errore non si registra mai
 * (può contenere valori); restano il nome della classe, il codice uc o lo
 * SQLSTATE di Postgres.
 *
 * Modulo puro (niente `node:*`, niente `@/…`): lo usano le rotte, gli script,
 * `src/lib/db/ensure-schema.ts` e `src/instrumentation.ts`, anche nel runtime
 * edge.
 */
import { UUID } from "./ids.ts";

export type UcLogLevel = "info" | "warn" | "error";

export interface UcLogEntry {
  level: UcLogLevel;
  /** Area: `uc`, `uc.mcp`, `uc.cron`, `uc.schema`, `app`… */
  area: string;
  /** Operazione: nome breve del caricatore, del passo o del tipo di rotta. */
  op: string;
  code?: string | null;
  pgCode?: string | null;
  digest?: string | null;
  workspaceId?: string | null;
  caseId?: string | null;
  durationMs?: number | null;
  /** Percorso della rotta già ripulito (`redactUcPath`) o schema della rotta (`/r/[token]`). */
  route?: string | null;
}

/** La riga che finisce nel log: solo i campi presenti, sempre nello stesso ordine. */
export interface UcLogLine {
  level: UcLogLevel;
  area: string;
  op: string;
  code?: string;
  pgCode?: string;
  digest?: string;
  workspaceId?: string;
  caseId?: string;
  durationMs?: number;
  route?: string;
}

const SHORT_CODE = /^[A-Za-z][A-Za-z0-9_.:-]{0,59}$/;
const PG_CODE = /^[0-9A-Z]{5}$/;
const DIGEST = /^[A-Za-z0-9_-]{1,64}$/;
const LEVELS: readonly UcLogLevel[] = ["info", "warn", "error"];

function shortCode(value: unknown, fallback: string): string {
  return typeof value === "string" && SHORT_CODE.test(value) ? value : fallback;
}

function optionalCode(value: unknown): string | undefined {
  return typeof value === "string" && SHORT_CODE.test(value) ? value : undefined;
}

function uuidOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : undefined;
}

// ── Percorsi ──────────────────────────────────────────────────────────

/** Un segmento che non è un UUID e sembra un segreto (lungo e opaco) oppure contiene un'email. */
function looksSecret(segment: string): boolean {
  if (UUID.test(segment)) return false;
  if (segment.includes("@") || segment.includes("%40")) return true;
  return segment.length >= 24 && /^[A-Za-z0-9_~.-]+$/.test(segment) && /[0-9]/.test(segment) && /[A-Za-z]/.test(segment);
}

/**
 * Percorso da registrare: senza query né frammento, con il token dei link
 * personali (`/r/<token>`, `/api/r/<token>/…`, e quelli di «Chiedi al
 * referente» `/rispondi/<token>`, `/api/rispondi/<token>/…`) riscritto in `[token]` e ogni
 * altro segmento opaco o con un'email riscritto in `[redatto]`.
 */
export function redactUcPath(path: unknown): string {
  if (typeof path !== "string" || path.length === 0) return "/";
  let p = path;
  const cut = p.search(/[?#]/);
  if (cut >= 0) p = p.slice(0, cut);
  if (!p.startsWith("/")) {
    // URL assoluto: si tiene solo il percorso.
    const m = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i.exec(p);
    p = m ? (m[1] ?? "/") : `/${p}`;
  }
  const segments = p.split("/");
  const out: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const prev = out[out.length - 1];
    const prev2 = out[out.length - 2];
    if (s && (prev === "r" || prev === "rispondi") && (out.length === 2 || (prev2 === "api" && out.length === 3))) {
      out.push("[token]");
    } else if (s && looksSecret(s)) {
      out.push("[redatto]");
    } else {
      out.push(s.length > 80 ? "[redatto]" : s);
    }
  }
  return out.join("/") || "/";
}

/** Area del log dal percorso: le rotte uc hanno la loro, il resto è `app`. */
export function areaForPath(path: string): string {
  if (/^\/(api\/)?r(\/|$)/.test(path)) return "uc.r";
  // «Chiedi al referente» (area «Use case»): la stessa area di `logReferentPublicError`.
  if (/^\/(api\/)?rispondi(\/|$)/.test(path)) return "use-case.rispondi";
  if (/^\/api\/mcp\/casi(\/|$)/.test(path)) return "uc.mcp";
  if (/^\/api\/cron\/uc-/.test(path)) return "uc.cron";
  if (/^\/dashboard\/[^/]+\/casi-duso(\/|$)/.test(path)) return "uc";
  return "app";
}

/** Workspace e caso dal percorso `/dashboard/<ws>/casi-duso/<caso>/…`, solo se sono UUID. */
export function idsFromPath(path: string): { workspaceId?: string; caseId?: string } {
  const m = /^\/dashboard\/([^/]+)(?:\/casi-duso\/([^/]+))?/.exec(path);
  if (!m) return {};
  const workspaceId = uuidOrUndefined(m[1]);
  const caseId = uuidOrUndefined(m[2]);
  return { ...(workspaceId ? { workspaceId } : {}), ...(caseId ? { caseId } : {}) };
}

// ── Errori ────────────────────────────────────────────────────────────

/**
 * Codice di un errore: il codice uc (`UcAccessError.code`, `uc:<codice>` dei
 * trigger), altrimenti il nome della classe. Mai il messaggio.
 */
export function errorCodeOf(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; name?: unknown; message?: unknown };
    if (typeof e.code === "string" && /^[a-z][a-z_]{1,40}$/.test(e.code)) return e.code;
    if (typeof e.message === "string") {
      const m = /^uc:([a-z_]{1,40})$/.exec(e.message.trim());
      if (m) return m[1];
    }
    if (typeof e.name === "string" && /^[A-Za-z]{1,40}$/.test(e.name)) return e.name;
  }
  return "errore";
}

/** SQLSTATE di Postgres (`23505`, `42P01`…), dall'errore o dalla sua causa. */
export function pgCodeOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && PG_CODE.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** `digest` di React/Next per un errore del server, se c'è. */
export function digestOf(error: unknown): string | undefined {
  const digest = error && typeof error === "object" ? (error as { digest?: unknown }).digest : undefined;
  return typeof digest === "string" && DIGEST.test(digest) ? digest : undefined;
}

// ── Riga ──────────────────────────────────────────────────────────────

/** Riga ripulita: ogni campo filtrato, i campi vuoti tolti. */
export function ucLogLine(entry: UcLogEntry): UcLogLine {
  const line: UcLogLine = {
    level: LEVELS.includes(entry.level) ? entry.level : "info",
    area: shortCode(entry.area, "uc"),
    op: shortCode(entry.op, "altro"),
  };
  const code = optionalCode(entry.code);
  if (code) line.code = code;
  if (typeof entry.pgCode === "string" && PG_CODE.test(entry.pgCode)) line.pgCode = entry.pgCode;
  if (typeof entry.digest === "string" && DIGEST.test(entry.digest)) line.digest = entry.digest;
  const workspaceId = uuidOrUndefined(entry.workspaceId);
  if (workspaceId) line.workspaceId = workspaceId;
  const caseId = uuidOrUndefined(entry.caseId);
  if (caseId) line.caseId = caseId;
  if (typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs) && entry.durationMs >= 0) {
    line.durationMs = Math.round(entry.durationMs);
  }
  if (typeof entry.route === "string" && entry.route) line.route = redactUcPath(entry.route);
  return line;
}

export type UcLogSink = (level: UcLogLevel, text: string) => void;

const consoleSink: UcLogSink = (level, text) => {
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.info(text);
};

/** Scrive una riga JSON (sul `console` del livello giusto, o sul `sink` dei test). */
export function ucLog(entry: UcLogEntry, sink: UcLogSink = consoleSink): UcLogLine {
  const line = ucLogLine(entry);
  sink(line.level, JSON.stringify(line));
  return line;
}

/** Riga d'errore da un'eccezione: codice, SQLSTATE e digest, mai il messaggio. */
export function ucLogError(base: Omit<UcLogEntry, "level" | "code" | "pgCode" | "digest">, error: unknown, sink?: UcLogSink): UcLogLine {
  return ucLog({ ...base, level: "error", code: errorCodeOf(error), pgCode: pgCodeOf(error), digest: digestOf(error) }, sink);
}

/**
 * Durata di un caricatore: una riga `info` con `durationMs` se va a buon fine,
 * una riga `error` con il codice se fallisce (e l'errore riparte).
 */
export async function timeUc<T>(
  base: Omit<UcLogEntry, "level" | "durationMs">,
  run: () => Promise<T>,
  o: { sink?: UcLogSink; now?: () => number } = {},
): Promise<T> {
  const now = o.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const started = now();
  try {
    const value = await run();
    ucLog({ ...base, level: "info", durationMs: now() - started }, o.sink);
    return value;
  } catch (error) {
    ucLog({ ...base, level: "error", code: errorCodeOf(error), pgCode: pgCodeOf(error), digest: digestOf(error), durationMs: now() - started }, o.sink);
    throw error;
  }
}
