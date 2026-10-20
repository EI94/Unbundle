/**
 * Confine HTTP delle API pubbliche a token `/api/r/[token]/…` (PIANO §5.5,
 * §5.6, §7.2; spec privacy 12 e 15).
 *
 * - **Origine**: ogni chiamata che scrive arriva dalla pagina del referente.
 *   Si confronta l'host dell'`Origin` con l'`Host` della richiesta (dietro il
 *   proxy di Vercel il protocollo interno può essere http, come in
 *   `src/app/api/auth/session/route.ts`), oppure con l'indirizzo pubblico
 *   configurato. Senza `Origin` la scrittura si rifiuta: i browser lo mandano
 *   sempre sulle POST e sulle PUT.
 * - **Corpo**: solo JSON, al massimo 256 KB, letto a blocchi (un
 *   `content-length` falso non basta a superare il limite), UTF-8 valido.
 * - **Errori uniformi** `{ error: codice, message: italiano }`, con gli `issues`
 *   dei campi quando servono. Token sbagliato, scaduto o revocato e sezione
 *   spenta danno sempre lo stesso `link_non_valido`.
 * - **Intestazioni**: `no-store`, `noindex`, `no-referrer`, `nosniff` su ogni risposta.
 * - **IP**: solo come impronta con chiave (`UC_SECRET`); senza segreto niente
 *   impronta e niente limite per IP (l'IP in chiaro non si salva mai, nemmeno
 *   come nome di un secchio).
 * - **Limiti di frequenza** (`uc_rate_limits`): per token 60/min per le bozze,
 *   20/min per gli invii (un invio a gruppi di al massimo 50 risposte conta una
 *   volta sola), 30/ora per i caricamenti; per impronta dell'IP 120/min
 *   (DESIGN §7.1 P0-11).
 * - **Segreto**: in produzione senza `UC_SECRET` le scritture pubbliche
 *   rispondono 503 (`publicWritesAvailable`, DESIGN §7.1 P0-7).
 *
 * Nessun import dell'app: lo usano i route handler e i test (`node --test`).
 */
import type { Issue } from "./answers/issues.ts";
import { parseLsDomains } from "./lateral-space.ts";
import { INVALID_LINK_MESSAGE, PAUSED_CASE_MESSAGE, PRIVACY_PENDING_MESSAGE } from "./public-view.ts";
import type { RateLimitHit } from "./sql/public.ts";
import { ipHashFromSecret } from "./tokens.ts";
import type { AnswerDevice } from "./vocab.ts";
import { UUID } from "./ids.ts";

// ── Intestazioni e risposte ───────────────────────────────────────────

export const PUBLIC_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

/** Limite del corpo JSON delle API pubbliche. */
export const PUBLIC_BODY_MAX_BYTES = 256 * 1024;

/**
 * Limite del corpo di un invio a gruppi (`POST …/answers`, al massimo 50
 * risposte): ogni risposta resta sotto i 256 KB della chiamata singola, e la
 * pagina divide gli invii più grandi in più chiamate.
 */
export const PUBLIC_BATCH_BODY_MAX_BYTES = 2 * 1024 * 1024;

interface ErrorSpec {
  status: number;
  message: string;
}

/** Codici noti, con stato HTTP e messaggio. I codici dei comandi non elencati qui passano da `publicStatusFor`. */
export const PUBLIC_ERRORS: Readonly<Record<string, ErrorSpec>> = {
  link_non_valido: { status: 404, message: INVALID_LINK_MESSAGE },
  origine_non_ammessa: { status: 403, message: "Richiesta non autorizzata. Apri di nuovo il link dalla tua email." },
  formato_non_ammesso: { status: 415, message: "La richiesta deve contenere JSON." },
  corpo_troppo_grande: { status: 413, message: "La risposta è troppo lunga. Allega un file." },
  dati_non_validi: { status: 400, message: "I dati inviati non sono validi. Aggiorna la pagina e riprova." },
  troppe_richieste: { status: 429, message: "Troppe richieste in poco tempo. Aspetta un minuto e riprova." },
  caso_sospeso: { status: 409, message: PAUSED_CASE_MESSAGE },
  informativa_da_leggere: { status: 409, message: PRIVACY_PENDING_MESSAGE },
  non_disponibile: { status: 503, message: "Il servizio non è disponibile in questo momento. Riprova tra poco." },
  errore: { status: 500, message: "Qualcosa non ha funzionato. Riprova tra poco." },
};

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  voce_non_disponibile: 404,
  conflitto: 409,
  stato_non_ammesso: 409,
  tipo_risposta_non_ammesso: 422,
  informativa_cambiata: 409,
  zona_personale_chiusa: 409,
  valore_sanitario: 409,
  bozza_non_ammessa: 409,
  testo_cambiato: 409,
  rifiuto_non_disponibile: 409,
  firma_gia_presente: 409,
  troppe_deleghe: 429,
  attore_non_ammesso: 403,
  firmatario_non_ammesso: 403,
  firmatario_non_designato: 403,
  firmatario_lateral_space: 403,
  referente_lateral_space: 422,
  approvazione_non_trovata: 404,
};

/** Stato HTTP di un codice d'esito: noto, oppure 422 per i dati non validi e 409 per il resto. */
export function publicStatusFor(code: string): number {
  const known = PUBLIC_ERRORS[code]?.status ?? STATUS_BY_CODE[code];
  if (known) return known;
  if (code.startsWith("testo_") || code.endsWith("_non_valido") || code.endsWith("_non_valida") || code.endsWith("_mancante") || code === "valore_non_valido") return 422;
  if (code.endsWith("_non_trovato") || code.endsWith("_non_trovata")) return 404;
  return 409;
}

/** Risposta JSON delle API pubbliche, sempre con le intestazioni di `PUBLIC_HEADERS`. */
export function publicJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...PUBLIC_HEADERS, ...extra } });
}

/** Esito riuscito: `{ ok: true, data }`. */
export function publicData(data: unknown, status = 200): Response {
  return publicJson({ ok: true, data }, status);
}

/**
 * Errore uniforme `{ ok: false, error, message, issues? }`. Il messaggio di
 * default viene da `PUBLIC_ERRORS`; i messaggi dei comandi sono già in italiano
 * semplice e non contengono mai i valori scritti dal referente.
 */
export function publicError(code: string, opts: { message?: string; issues?: readonly Issue[]; status?: number; retryAfterSeconds?: number } = {}): Response {
  const known = PUBLIC_ERRORS[code];
  const message = opts.message ?? known?.message ?? PUBLIC_ERRORS.errore.message;
  const body: Record<string, unknown> = { ok: false, error: code, message };
  if (opts.issues && opts.issues.length > 0) body.issues = opts.issues.slice(0, 50).map((i) => ({ code: i.code, message: i.message, ...(i.field ? { field: i.field } : {}) }));
  const extra: Record<string, string> = opts.retryAfterSeconds ? { "Retry-After": String(Math.max(1, Math.ceil(opts.retryAfterSeconds))) } : {};
  return publicJson(body, opts.status ?? publicStatusFor(code), extra);
}

/** La scheda «Questo link non è più valido», per ogni token non utilizzabile. */
export function invalidLinkResponse(): Response {
  return publicError("link_non_valido");
}

// ── Origine ───────────────────────────────────────────────────────────

/**
 * La scrittura arriva dalla pagina del referente: l'`Origin` (obbligatorio,
 * http o https) ha lo stesso host della richiesta, oppure quello
 * dell'indirizzo pubblico configurato (`NEXT_PUBLIC_APP_URL`).
 */
export function publicOriginAllowed(headers: { get(name: string): string | null }, publicUrl?: string | null): boolean {
  const origin = headers.get("origin");
  if (!origin || origin === "null") return false;
  let originHost: string;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    originHost = parsed.host.toLowerCase();
  } catch {
    return false;
  }
  const host = headers.get("host")?.trim().toLowerCase();
  if (host && originHost === host) return true;
  const configured = publicUrl?.trim();
  if (!configured) return false;
  try {
    return new URL(configured.startsWith("http") ? configured : `https://${configured}`).host.toLowerCase() === originHost;
  } catch {
    return false;
  }
}

// ── Corpo JSON ────────────────────────────────────────────────────────

export type BodyResult = { ok: true; value: unknown } | { ok: false; code: "formato_non_ammesso" | "corpo_troppo_grande" | "dati_non_validi" };

/** Corpo JSON della richiesta, letto a blocchi con un limite di byte e UTF-8 valido. */
export async function readPublicJson(request: Request, maxBytes = PUBLIC_BODY_MAX_BYTES): Promise<BodyResult> {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") return { ok: false, code: "formato_non_ammesso" };
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) return { ok: false, code: "corpo_troppo_grande" };
  if (!request.body) return { ok: false, code: "dati_non_validi" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "corpo_troppo_grande" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return { ok: false, code: "dati_non_validi" };
  } finally {
    reader.releaseLock();
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, code: "dati_non_validi" };
  }
}

// ── IP, user agent, dispositivo ───────────────────────────────────────

/** IP del chiamante: primo valore di `x-forwarded-for`, poi `x-real-ip`. Solo per l'impronta. */
export function clientIp(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

/** Impronta con chiave dell'IP (`UC_SECRET`), oppure null: niente impronta senza segreto. */
export function requestIpHash(headers: { get(name: string): string | null }, secret: string | null | undefined): string | null {
  return ipHashFromSecret(secret, clientIp(headers));
}

/** User agent ripulito dai caratteri di controllo e troncato a 300 caratteri. */
export function requestUserAgent(headers: { get(name: string): string | null }): string | null {
  const ua = headers.get("user-agent");
  if (!ua) return null;
  const clean = ua.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return clean ? clean.slice(0, 300) : null;
}

/** `mobile` o `desktop` dallo user agent (colonna `uc_answers.device`). */
export function deviceFromUserAgent(ua: string | null | undefined): AnswerDevice | null {
  if (!ua) return null;
  return /Mobi|Android|iPhone|iPad|iPod|Windows Phone|Opera Mini|IEMobile/i.test(ua) ? "mobile" : "desktop";
}

// ── Segreto obbligatorio in produzione ────────────────────────────────

/**
 * Le scritture pubbliche si accettano? In produzione (`VERCEL_ENV=production`)
 * serve `UC_SECRET`: senza, niente impronta dell'IP e niente limite per IP, e
 * le API che scrivono rispondono 503 (DESIGN §7.1 P0-7). Fuori produzione si
 * scrive anche senza, come sul harness.
 */
export function publicWritesAvailable(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.VERCEL_ENV !== "production") return true;
  return Boolean(env.UC_SECRET?.trim());
}

// ── Ambiente della chiamata ───────────────────────────────────────────

type HeaderReader = { get(name: string): string | null };

/** Ambiente di una chiamata pubblica: lo usano le API `/api/r/…` e la pagina `/r/[token]`. */
export interface PublicCallEnv {
  /** `UC_LS_EMAIL_DOMAINS`. */
  lsDomains: string[];
  /** Impronta con chiave dell'IP (`UC_SECRET`), oppure null. */
  ipHash: string | null;
  userAgent: string | null;
  device: AnswerDevice | null;
  /** `RESEND_API_KEY` e `UC_EMAIL_FROM` presenti: le email partono davvero. */
  emailConfigured: boolean;
  /** `UC_PERSONAL_ZONE_KEY`: senza, la zona personale resta chiusa. */
  personalZoneKey: string | null;
}

/**
 * Ambiente della chiamata dalle intestazioni e dalle variabili passate
 * (`process.env` nel chiamante): l'IP diventa subito un'impronta e non esce di qui.
 */
export function publicCallEnv(headers: HeaderReader, env: Readonly<Record<string, string | undefined>>): PublicCallEnv {
  const userAgent = requestUserAgent(headers);
  return {
    lsDomains: parseLsDomains(env.UC_LS_EMAIL_DOMAINS),
    ipHash: requestIpHash(headers, env.UC_SECRET),
    userAgent,
    device: deviceFromUserAgent(userAgent),
    emailConfigured: Boolean(env.RESEND_API_KEY?.trim() && env.UC_EMAIL_FROM?.trim()),
    personalZoneKey: env.UC_PERSONAL_ZONE_KEY?.trim() || null,
  };
}

// ── Limiti di frequenza ───────────────────────────────────────────────

export type RateLimitKind = "bozza" | "invio" | "apertura" | "upload";

export interface RateLimitRule extends RateLimitHit {
  limit: number;
}

/**
 * Limiti del PIANO §5.5, più l'apertura e l'informativa (leggere ma con un
 * tetto). Un invio a gruppi conta come un invio (DESIGN §7.1 P0-11); i
 * caricamenti sono 30 all'ora per token.
 */
export const RATE_LIMITS = {
  ip: { limit: 120, unit: "minute" },
  bozza: { limit: 60, unit: "minute" },
  invio: { limit: 20, unit: "minute" },
  apertura: { limit: 30, unit: "minute" },
  upload: { limit: 30, unit: "hour" },
} as const satisfies Record<string, { limit: number; unit: "minute" | "hour" }>;

/** Secchio per l'impronta dell'IP (solo se c'è l'impronta). */
export function ipRateLimitRule(ipHash: string | null): RateLimitRule | null {
  if (!ipHash || !/^[0-9a-f]{16,64}$/.test(ipHash)) return null;
  return { bucket: `ip:${ipHash}`, unit: RATE_LIMITS.ip.unit, limit: RATE_LIMITS.ip.limit };
}

/** Secchio per il token del link e il tipo di chiamata. */
export function tokenRateLimitRule(tokenId: string, kind: RateLimitKind): RateLimitRule {
  if (!UUID.test(tokenId)) throw new Error("Token non valido");
  const spec = RATE_LIMITS[kind];
  return { bucket: `tok:${tokenId.toLowerCase()}:${kind}`, unit: spec.unit, limit: spec.limit };
}

/** La prima regola superata, con i conteggi restituiti da `rateLimitHitSql`. */
export function firstExceeded(rules: readonly RateLimitRule[], counts: ReadonlyMap<string, number>): RateLimitRule | null {
  return rules.find((r) => (counts.get(r.bucket) ?? 0) > r.limit) ?? null;
}

/** Secondi fino alla prossima finestra. */
export function retryAfter(unit: "minute" | "hour", now: Date = new Date()): number {
  const ms = unit === "minute" ? 60_000 : 3_600_000;
  return Math.max(1, Math.ceil((ms - (now.getTime() % ms)) / 1000));
}
