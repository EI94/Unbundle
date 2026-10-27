/**
 * Invio della coda `uc_notifications` (PIANO §7.1, §5.7, b18).
 *
 * - **Campanella** (`in_app`): la riga è già la notifica; l'invio la segna
 *   `inviata`. La legge `unreadForUser` (solo membri Lateral Space del caso).
 * - **Email**: con `RESEND_API_KEY`, `UC_EMAIL_FROM` e l'indirizzo pubblico
 *   dell'app (`NEXT_PUBLIC_APP_URL`) si invia con Resend. Senza, la riga resta
 *   `in_coda` con `hold_reason = 'email_non_configurata'`: l'interfaccia lo dice
 *   e Lateral Space copia il link a mano. Un caso sospeso tiene la coda ferma
 *   (`caso_sospeso`), un caso chiuso la annulla.
 * - **Link**: il token nasce solo al momento dell'invio (`uc_request_live`
 *   ricontrollato nella stessa SQL), se ne salva solo l'impronta e va solo
 *   nell'email: mai nel payload, mai nei log. Se l'invio fallisce in modo certo
 *   il token si revoca; se l'esito è incerto (rete, 5xx) resta valido fino alla
 *   scadenza della richiesta, così un'email partita davvero ha un link che
 *   funziona.
 * - **Tentativi**: `errore` con `attempts + 1` e nuovo tentativo dopo 15 minuti,
 *   al massimo 3. Promemoria, segnalazioni all'Owner e riepiloghi partono solo
 *   nella finestra lun–ven 9–18 di Roma, festivi esclusi.
 * - **Nessun tracciamento**: testo semplice più HTML minimo, senza immagini né
 *   pixel (vedi `email-templates.ts`); il tracciamento di aperture e clic va
 *   spento sul dominio Resend (`AMBIENTE.md`).
 * - **Reply-to**: il mittente sta su un sottodominio che non riceve posta; con
 *   `UC_EMAIL_REPLY_TO` (un indirizzo semplice) le risposte arrivano lì. Senza,
 *   o con un valore non valido, nessuna intestazione reply-to.
 *
 * Il motore (`runDispatch`) e la decisione per riga (`planDelivery`) non toccano
 * il database: lo fanno le funzioni di `queries/uc-notifications-dispatch.ts`
 * attraverso `DispatchStore`. Così il motore si prova senza rete né database.
 * L'unico I/O di questo modulo è il client Resend, caricato solo se serve.
 */
import { inRomeSendWindow, isWorkingDay } from "../calendar.ts";
import { emailDomain } from "../lateral-space.ts";
import type { Json, Result } from "../types.ts";
import type { CaseStatus, RequestPurpose, RequestStatus } from "../vocab.ts";
import { renderEmail, type EmailInput, type RenderedEmail, type WeeklyCaseSummary } from "./email-templates.ts";
import { isoWeekRome, nextReminderAt, type WorkingCalendar } from "./schedule.ts";

// ── Costanti ──────────────────────────────────────────────────────────

/** Tentativi massimi per un'email. */
export const MAX_EMAIL_ATTEMPTS = 3;
/** Attesa prima di un nuovo tentativo. */
export const RETRY_DELAY_MINUTES = 15;
/** Una riga presa in carico non si riprende per questi minuti (due invii in parallelo non la mandano due volte). */
export const DISPATCH_LEASE_MINUTES = 10;
/** Righe email per giro di invio (cron). */
export const DISPATCH_BATCH_LIMIT = 50;
/** Righe email per giro dopo un comando (`after()`): il resto parte col cron. */
export const DISPATCH_AFTER_COMMAND_LIMIT = 30;
/** Tempo massimo di una chiamata a Resend: oltre, l'esito è incerto. */
export const SEND_TIMEOUT_MS = 15_000;
/**
 * Pausa minima tra due invii: Resend accetta di base 2 richieste al secondo per
 * account. Oltre, risponde `rate_limit_exceeded` e il giro si ferma.
 */
export const SEND_INTERVAL_MS = 550;

/** Email che partono solo nella finestra d'invio di Roma. */
export const WINDOWED_TEMPLATES = ["promemoria_1", "promemoria_2", "segnalazione_owner", "riepilogo_settimanale"] as const;

/** Email che il motore sa comporre. Le altre righe email si annullano. */
export const EMAIL_TEMPLATES = [
  "richiesta_inviata",
  "promemoria_1",
  "promemoria_2",
  "segnalazione_owner",
  "riepilogo_settimanale",
  "chiarimento",
  "delega",
  "richiesta_approvazione",
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATES)[number];

export const HOLD_EMAIL_NOT_CONFIGURED = "email_non_configurata";
export const HOLD_CASE_SUSPENDED = "caso_sospeso";

/** Calendario lavorativo unico (`calendar.ts`) per i solleciti e la finestra d'invio. */
export const ROME_WORKING_CALENDAR: WorkingCalendar = { isWorkingDay: (date) => isWorkingDay(date) };

const WAITING: ReadonlySet<RequestStatus> = new Set(["inviata", "aperta", "in_corso"]);

// ── Configurazione ────────────────────────────────────────────────────

/** Variabili lette dal motore (il chiamante passa `process.env`). */
export interface DispatchEnv {
  readonly [name: string]: string | undefined;
  RESEND_API_KEY?: string;
  UC_EMAIL_FROM?: string;
  /**
   * Indirizzo a cui arrivano le risposte alle email (un solo indirizzo semplice). Il mittente sta su
   * un sottodominio che non riceve posta: senza reply-to una risposta si perde. Facoltativa: assente
   * o non valida, le email partono senza reply-to.
   */
  UC_EMAIL_REPLY_TO?: string;
  NEXT_PUBLIC_APP_URL?: string;
  APP_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}

export interface UcEmailConfig {
  apiKey: string;
  /** Mittente, es. `Lateral Space via Unbundle <indirizzo@dominio-verificato>`. */
  from: string;
  /** Origine pubblica dell'app per i link (`https://…`, `http://` solo in locale). */
  origin: string;
  /** `UC_EMAIL_REPLY_TO` in minuscolo, solo se è un indirizzo semplice; assente altrimenti. */
  replyTo?: string;
}

export type EmailConfigCheck = { ok: true; config: UcEmailConfig } | { ok: false; missing: ("RESEND_API_KEY" | "UC_EMAIL_FROM" | "NEXT_PUBLIC_APP_URL")[] };

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/i;
const PLAIN_ADDRESS = /^[^\s@,;:<>()"'\\[\]]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const SENDER = /^(?:[^\r\n<>@"]{1,80}\s<)?[^\s@,;:<>()"'\\[\]]{1,64}@[a-z0-9.-]{3,253}>?$/i;

/** Un solo indirizzo email semplice: niente nomi, virgole o a capo (nessun destinatario in più). */
export function isPlainAddress(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length <= 320 && PLAIN_ADDRESS.test(value);
}

/**
 * Il reply-to delle email da `UC_EMAIL_REPLY_TO`: un solo indirizzo semplice, in minuscolo. Un nome
 * («Nome <a@b>»), una virgola, un a capo o qualunque altra forma non vale: null, e l'email parte
 * senza reply-to (mai un'intestazione costruita da un valore sporco).
 */
export function emailReplyTo(env: DispatchEnv): string | null {
  const raw = env.UC_EMAIL_REPLY_TO;
  if (typeof raw !== "string" || /[\r\n]/.test(raw)) return null;
  const value = raw.trim().toLowerCase();
  return isPlainAddress(value) ? value : null;
}

/**
 * Origine pubblica per i link nelle email: `NEXT_PUBLIC_APP_URL`, poi `APP_URL`,
 * poi il dominio di produzione Vercel. Mai l'URL della singola anteprima
 * (`VERCEL_URL`), che può essere protetto.
 */
export function emailOrigin(env: DispatchEnv): string | null {
  for (const raw of [env.NEXT_PUBLIC_APP_URL, env.APP_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    const value = raw?.trim();
    if (!value) continue;
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (url.username || url.password) continue;
      if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.test(url.hostname))) return url.origin;
    } catch {
      // valore non valido: si prova il successivo
    }
  }
  return null;
}

/** Email configurata? Servono la chiave Resend, il mittente e l'indirizzo pubblico dell'app. */
export function ucEmailConfig(env: DispatchEnv): EmailConfigCheck {
  const apiKey = env.RESEND_API_KEY?.trim() ?? "";
  const from = env.UC_EMAIL_FROM?.trim() ?? "";
  const origin = emailOrigin(env);
  const missing: ("RESEND_API_KEY" | "UC_EMAIL_FROM" | "NEXT_PUBLIC_APP_URL")[] = [];
  if (!apiKey) missing.push("RESEND_API_KEY");
  if (!from || !SENDER.test(from)) missing.push("UC_EMAIL_FROM");
  if (!origin) missing.push("NEXT_PUBLIC_APP_URL");
  if (missing.length > 0 || !origin) return { ok: false, missing };
  const replyTo = emailReplyTo(env);
  return { ok: true, config: replyTo ? { apiKey, from, origin, replyTo } : { apiKey, from, origin } };
}

// ── Trasporto ─────────────────────────────────────────────────────────

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /**
   * Indirizzo a cui arrivano le risposte all'email. Le email dei dossier e gli avvisi ai revisori
   * usano `UC_EMAIL_REPLY_TO` (`UcEmailConfig.replyTo`); «Chiedi al referente» usa l'email verificata
   * di chi ha chiesto finché è revisore, altrimenti lo stesso `UC_EMAIL_REPLY_TO`. Assente: nessuna
   * intestazione. Resend lo accetta così com'è.
   */
  replyTo?: string;
}

/**
 * Esito dell'invio. `ambiguous`: non si sa se l'email è partita (rete, timeout,
 * 5xx); il token non si revoca. `code` è solo un codice, mai il messaggio del
 * fornitore (che potrebbe contenere l'indirizzo).
 */
export type MailResult = { ok: true } | { ok: false; code: string; ambiguous: boolean };

export interface UcMailer {
  send(email: OutgoingEmail, options: { idempotencyKey: string }): Promise<MailResult>;
}

/** Esito da un errore di Resend (`{ name, statusCode }`). */
export function mailResultFromError(error: unknown): MailResult {
  if (!error) return { ok: true };
  const e = error as { name?: unknown; statusCode?: unknown };
  const name = typeof e.name === "string" && /^[a-z_]{1,60}$/.test(e.name) ? e.name : "errore_invio";
  const status = typeof e.statusCode === "number" ? e.statusCode : null;
  const ambiguous = status === null || status >= 500 || name === "application_error" || name === "internal_server_error" || name === "errore_invio";
  return { ok: false, code: name, ambiguous };
}

/**
 * Client Resend creato solo al primo invio (il costruttore lancia un errore
 * senza chiave). Nessun log dell'email, dell'indirizzo o del link.
 */
export function createResendMailer(apiKey: string): UcMailer {
  let client: Promise<{ emails: { send: (payload: OutgoingEmail, options: { idempotencyKey: string }) => Promise<{ error: unknown }> } }> | null = null;
  return {
    async send(email, options) {
      try {
        client ??= import("resend").then(({ Resend }) => new Resend(apiKey));
        const resend = await client;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<{ error: unknown }>((resolve) => {
          timer = setTimeout(() => resolve({ error: { name: "timeout", statusCode: null } }), SEND_TIMEOUT_MS);
        });
        try {
          const { error } = await Promise.race([resend.emails.send(email, { idempotencyKey: options.idempotencyKey }), timeout]);
          return mailResultFromError(error);
        } finally {
          if (timer) clearTimeout(timer);
        }
      } catch {
        return { ok: false, code: "errore_invio", ambiguous: true };
      }
    },
  };
}

/**
 * Chiave di idempotenza per Resend: la chiave della coda più il tentativo. Ogni
 * tentativo porta un token nuovo, e Resend rifiuta la stessa chiave con un corpo
 * diverso: con la sola `dedupe_key` un nuovo tentativo dopo un errore non
 * partirebbe mai. Così un esito incerto può dare al massimo un doppione, mai
 * un'email persa.
 */
export function idempotencyKeyFor(dedupeKey: string, attempt: number): string {
  return `${dedupeKey}:a${attempt}`;
}

// ── Righe e fatti ─────────────────────────────────────────────────────

/** Riga email presa in carico (`claimDue`). */
export interface ClaimedNotification {
  id: string;
  workspaceId: string;
  caseId: string | null;
  requestId: string | null;
  recipientContactId: string | null;
  recipientUserId: string | null;
  templateKey: string;
  payload: Record<string, Json>;
  attempts: number;
  dedupeKey: string;
}

export interface DeliveryRequestFacts {
  id: string;
  purpose: RequestPurpose;
  status: RequestStatus;
  contactId: string;
  delegatedByContactId: string | null;
  /** `uc_request_live`, con l'orologio del database. */
  live: boolean;
  sentAt: Date | null;
  expiresAt: Date | null;
  reminderCount: number;
  escalatedAt: Date | null;
  /** Voci ancora `da_fare` o `bozza`. */
  openItems: number;
  minutes: number | null;
  /** Messaggio di chi ha inviato o delegato (già passato dalla scansione del testo). */
  message: string | null;
  /** Etichetta del ruolo per cui risponde il referente (mai un nome). */
  roleLabel: string | null;
}

/** Quello che serve per decidere e comporre un'email: niente valori delle risposte. */
export interface DeliveryFacts {
  /** Nome del cliente (workspace). */
  clientName: string;
  case: { id: string; code: string; title: string; status: CaseStatus; ownerContactId: string | null; designated: { owner: string | null; privacy: string | null } } | null;
  recipient: {
    kind: "contact" | "user";
    id: string;
    email: string | null;
    /** Contatto attivo e non anonimizzato, oppure utente esistente. */
    reachable: boolean;
    digestOptOut: boolean;
    /** Utente con email verificata in un dominio di Lateral Space. */
    lateralSpace: boolean;
  } | null;
  request: DeliveryRequestFacts | null;
  /** Chiarimento: titolo della voce. */
  itemTitle?: string | null;
  /** Segnalazione all'Owner: voci ancora aperte (chiave e titolo). */
  openItemList?: readonly { key: string; title: string }[];
  /** Link di approvazione: firme in attesa e controllo dell'email del firmatario. */
  approvals?: { pending: number; signer: Result<void> };
  /** Riepilogo settimanale: casi del destinatario. */
  weekly?: { cases: readonly (WeeklyCaseSummary & { caseId: string })[] };
}

export type AfterSent = { kind: "promemoria"; reminder: 1 | 2; nextReminderAt: Date | null } | { kind: "segnalazione" } | null;

export type DeliveryPlan =
  | {
      action: "send";
      to: string;
      /** Token da emettere al momento dell'invio, per il link `/r/<token>`. */
      link: { requestId: string; issuedFor: "invio" | "promemoria" | "delega" } | null;
      build: (link: string | null) => EmailInput;
      after: AfterSent;
    }
  | { action: "hold"; reason: string }
  | { action: "cancel"; reason: string };

const cancel = (reason: string): DeliveryPlan => ({ action: "cancel", reason });
const hold = (reason: string): DeliveryPlan => ({ action: "hold", reason });

function isEmailTemplate(key: string): key is EmailTemplateKey {
  return (EMAIL_TEMPLATES as readonly string[]).includes(key);
}

function needLink(link: string | null): string {
  if (!link) throw new Error("Manca il link dell'email");
  return link;
}

const WEEK = /^\d{4}-W\d{2}$/;

/**
 * Controlli comuni dei link ai referenti: la richiesta c'è, è dello stesso
 * contatto, ha lo scopo giusto ed è ancora viva; il destinatario non è di
 * Lateral Space.
 */
function referentRequest(
  f: DeliveryFacts,
  recipient: NonNullable<DeliveryFacts["recipient"]>,
  purpose: RequestPurpose,
  lsDomains: readonly string[],
): { ok: true; request: DeliveryRequestFacts } | { ok: false; plan: DeliveryPlan } {
  const r = f.request;
  if (!r || recipient.kind !== "contact") return { ok: false, plan: cancel("richiesta_assente") };
  if (r.purpose !== purpose) return { ok: false, plan: cancel("richiesta_non_ammessa") };
  if (!r.live || !r.expiresAt) return { ok: false, plan: cancel("richiesta_non_viva") };
  const domain = emailDomain(recipient.email);
  if (domain && lsDomains.includes(domain)) return { ok: false, plan: cancel("destinatario_lateral_space") };
  return { ok: true, request: r };
}

/**
 * Decide che cosa fare di una riga email: inviarla (con il link e l'aggiornamento
 * della richiesta dopo l'invio), tenerla in coda o annullarla. Funzione pura.
 */
export function planDelivery(n: ClaimedNotification, f: DeliveryFacts, o: { origin: string; lsDomains: readonly string[]; now: Date }): DeliveryPlan {
  const tpl = n.templateKey;
  if (!isEmailTemplate(tpl)) return cancel("modello_non_previsto");
  const recipient = f.recipient;
  if (!recipient || !recipient.reachable || !isPlainAddress(recipient.email)) return cancel("destinatario_non_raggiungibile");
  const to = recipient.email.trim().toLowerCase();

  if (tpl === "riepilogo_settimanale") return planWeekly(n, f, recipient, to, o);

  const c = f.case;
  if (!c) return cancel("caso_assente");
  if (c.status === "chiuso") return cancel("caso_chiuso");
  if (c.status === "sospeso") return hold(HOLD_CASE_SUSPENDED);
  const base = { clientName: f.clientName, caseTitle: c.title };

  switch (tpl) {
    case "richiesta_inviata": {
      const checked = referentRequest(f, recipient, "raccolta", o.lsDomains);
      if (!checked.ok) return checked.plan;
      const r = checked.request;
      if (r.contactId !== recipient.id) return cancel("destinatario_cambiato");
      if (r.openItems <= 0) return cancel("nessuna_domanda_aperta");
      return {
        action: "send",
        to,
        link: { requestId: r.id, issuedFor: "invio" },
        build: (link) => ({ ...base, template: "richiesta_inviata", questions: r.openItems, minutes: r.minutes, expiresAt: r.expiresAt as Date, link: needLink(link), message: r.message }),
        after: null,
      };
    }
    case "promemoria_1":
    case "promemoria_2": {
      const reminder = tpl === "promemoria_1" ? 1 : 2;
      const checked = referentRequest(f, recipient, "raccolta", o.lsDomains);
      if (!checked.ok) return checked.plan;
      const r = checked.request;
      if (r.contactId !== recipient.id) return cancel("destinatario_cambiato");
      if (!WAITING.has(r.status)) return cancel("richiesta_completata");
      if (r.reminderCount !== reminder - 1) return cancel("promemoria_gia_fatto");
      if (r.openItems <= 0) return cancel("nessuna_domanda_aperta");
      const next = nextReminderAt(
        { status: r.status, purpose: r.purpose, sentAt: r.sentAt, expiresAt: r.expiresAt, revokedAt: null, reminderCount: reminder, escalatedAt: r.escalatedAt, caseStatus: c.status },
        o.now,
        ROME_WORKING_CALENDAR,
      );
      return {
        action: "send",
        to,
        link: { requestId: r.id, issuedFor: "promemoria" },
        build: (link) => ({ ...base, template: tpl, questions: r.openItems, minutes: r.minutes, expiresAt: r.expiresAt as Date, link: needLink(link) }),
        after: { kind: "promemoria", reminder, nextReminderAt: next },
      };
    }
    case "chiarimento": {
      const checked = referentRequest(f, recipient, "raccolta", o.lsDomains);
      if (!checked.ok) return checked.plan;
      const r = checked.request;
      if (r.contactId !== recipient.id) return cancel("destinatario_cambiato");
      return {
        action: "send",
        to,
        link: { requestId: r.id, issuedFor: "invio" },
        build: (link) => ({ ...base, template: "chiarimento", itemTitle: f.itemTitle ?? null, expiresAt: r.expiresAt as Date, link: needLink(link) }),
        after: null,
      };
    }
    case "delega": {
      const checked = referentRequest(f, recipient, "raccolta", o.lsDomains);
      if (!checked.ok) return checked.plan;
      const r = checked.request;
      if (r.contactId === recipient.id) {
        if (r.openItems <= 0) return cancel("nessuna_domanda_aperta");
        return {
          action: "send",
          to,
          link: { requestId: r.id, issuedFor: "delega" },
          build: (link) => ({
            ...base,
            template: "delega",
            audience: "collega",
            fromRoleLabel: r.roleLabel,
            questions: r.openItems,
            minutes: r.minutes,
            expiresAt: r.expiresAt as Date,
            link: needLink(link),
            message: r.message,
          }),
          after: null,
        };
      }
      if (r.delegatedByContactId && r.delegatedByContactId === recipient.id) {
        const questions = typeof n.payload.items === "number" && n.payload.items > 0 ? n.payload.items : r.openItems;
        return { action: "send", to, link: null, build: () => ({ ...base, template: "delega", audience: "delegante", questions }), after: null };
      }
      return cancel("destinatario_cambiato");
    }
    case "richiesta_approvazione": {
      const checked = referentRequest(f, recipient, "approvazioni", o.lsDomains);
      if (!checked.ok) return checked.plan;
      const r = checked.request;
      if (r.contactId !== recipient.id) return cancel("destinatario_cambiato");
      const designation = n.payload.designation === "privacy" ? "privacy" : n.payload.designation === "owner" ? "owner" : null;
      if (!designation || c.designated[designation] !== recipient.id) return cancel("firmatario_cambiato");
      if (!f.approvals || !f.approvals.signer.ok) return cancel("firmatario_non_ammesso");
      const pending = f.approvals.pending;
      if (pending <= 0) return cancel("nessuna_firma_in_attesa");
      return {
        action: "send",
        to,
        link: { requestId: r.id, issuedFor: "invio" },
        build: (link) => ({ ...base, template: "richiesta_approvazione", designation, pending, expiresAt: r.expiresAt as Date, link: needLink(link) }),
        after: null,
      };
    }
    case "segnalazione_owner": {
      const r = f.request;
      if (!r || recipient.kind !== "contact") return cancel("richiesta_assente");
      if (r.purpose !== "raccolta" || !r.live) return cancel("richiesta_non_viva");
      if (!WAITING.has(r.status) || r.openItems <= 0) return cancel("richiesta_completata");
      if (r.reminderCount < 2) return cancel("promemoria_mancanti");
      if (r.escalatedAt) return cancel("gia_segnalata");
      if (recipient.id === r.contactId) return cancel("destinatario_cambiato");
      const owner = c.ownerContactId ?? c.designated.owner;
      if (owner !== recipient.id) return cancel("owner_cambiato");
      const domain = emailDomain(recipient.email);
      if (domain && o.lsDomains.includes(domain)) return cancel("destinatario_lateral_space");
      const items = f.openItemList ?? [];
      return {
        action: "send",
        to,
        link: null,
        build: () => ({ ...base, template: "segnalazione_owner", roleLabel: r.roleLabel, items }),
        after: { kind: "segnalazione" },
      };
    }
  }
  return cancel("modello_non_previsto");
}

function planWeekly(
  n: ClaimedNotification,
  f: DeliveryFacts,
  recipient: NonNullable<DeliveryFacts["recipient"]>,
  to: string,
  o: { origin: string; lsDomains: readonly string[]; now: Date },
): DeliveryPlan {
  const week = typeof n.payload.week === "string" && WEEK.test(n.payload.week) ? n.payload.week : isoWeekRome(o.now);
  const cases = f.weekly?.cases ?? [];
  if (recipient.kind === "contact") {
    if (recipient.digestOptOut) return cancel("riepilogo_disattivato");
    const domain = emailDomain(recipient.email);
    if (domain && o.lsDomains.includes(domain)) return cancel("destinatario_lateral_space");
    if (cases.length === 0) return cancel("nessun_caso");
    // All'Owner: barra, G1, voci mancanti e prossima tappa; nessun link interno.
    const owned: WeeklyCaseSummary[] = cases.map((c) => ({ ...summaryCore(c), redItems: c.redItems ?? [], link: null }));
    return { action: "send", to, link: null, build: () => ({ template: "riepilogo_settimanale", audience: "owner", clientName: f.clientName, week, cases: owned }), after: null };
  }
  if (!recipient.lateralSpace) return cancel("destinatario_non_lateral_space");
  if (cases.length === 0) return cancel("nessun_caso");
  // A Lateral Space: lo stato di tutti i suoi casi, con il link alla pagina del caso.
  const internal: WeeklyCaseSummary[] = cases.map((c) => ({
    ...summaryCore(c),
    link: `${o.origin}/dashboard/${n.workspaceId.toLowerCase()}/casi-duso/${c.caseId.toLowerCase()}`,
  }));
  return { action: "send", to, link: null, build: () => ({ template: "riepilogo_settimanale", audience: "ls", clientName: f.clientName, week, cases: internal }), after: null };
}

function summaryCore(c: WeeklyCaseSummary): WeeklyCaseSummary {
  return { code: c.code, title: c.title, total: c.total, counts: c.counts, greenPct: c.greenPct, g1: c.g1, nextMilestone: c.nextMilestone ?? null };
}

// ── Motore ────────────────────────────────────────────────────────────

export type IssuedLinkResult = { ok: true; token: string; tokenId: string } | { ok: false; code: string };

/** Parte della coda su cui lavora un giro: tutta, un workspace o un caso. */
export interface DispatchScope {
  caseId: string | null;
  workspaceId: string | null;
}

/** Accesso al database del motore (vedi `queries/uc-notifications-dispatch.ts`). */
export interface DispatchStore {
  /** Campanella: righe `in_app` in coda → `inviata`. */
  markInAppDelivered(i: DispatchScope): Promise<number>;
  /** Email senza servizio configurato: restano in coda con `email_non_configurata`. */
  holdUnconfigured(i: DispatchScope): Promise<number>;
  /** Righe email da inviare, prese in carico per `DISPATCH_LEASE_MINUTES`. */
  claimDue(i: DispatchScope & { limit: number; includeWindowed: boolean }): Promise<ClaimedNotification[]>;
  loadFacts(n: ClaimedNotification): Promise<DeliveryFacts>;
  issueToken(i: { workspaceId: string; caseId: string; requestId: string; issuedFor: "invio" | "promemoria" | "delega" }): Promise<IssuedLinkResult>;
  revokeToken(i: { caseId: string; tokenId: string }): Promise<void>;
  markSent(n: ClaimedNotification, after: AfterSent): Promise<void>;
  markFailed(n: ClaimedNotification, code: string): Promise<void>;
  markHeld(n: ClaimedNotification, reason: string): Promise<void>;
  markCancelled(n: ClaimedNotification, reason: string): Promise<void>;
}

export interface DispatchSummary {
  /** Notifiche della campanella consegnate. */
  bell: number;
  sent: number;
  failed: number;
  held: number;
  cancelled: number;
  /** Email ferme perché il servizio non è configurato (righe segnate in questo giro). */
  notConfigured: number;
}

export interface DispatchOptions {
  env: DispatchEnv;
  lsDomains: readonly string[];
  now?: Date;
  caseId?: string | null;
  /** Solo la coda di un workspace (cron per un workspace, test sul harness). */
  workspaceId?: string | null;
  limit?: number;
  /** Trasporto: di default Resend con la chiave dell'ambiente. */
  mailer?: UcMailer;
  /** Pausa tra due invii (default `SEND_INTERVAL_MS`; 0 nei test). */
  sendIntervalMs?: number;
}

const RECIPIENT_CODE = /^[a-z0-9_]{1,60}$/;

function code(value: string): string {
  return RECIPIENT_CODE.test(value) ? value : "errore_invio";
}

/** Codice di Resend per il limite di richieste al secondo: il giro si ferma e riprende dopo il lease. */
export const RATE_LIMIT_CODE = "rate_limit_exceeded";

type Delivered = "sent" | "failed" | "held" | "cancelled" | "rate_limited";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Un giro di invio: campanella consegnata, poi le email arrivate a scadenza.
 * Senza configurazione le email restano in coda con un motivo chiaro. Tra due
 * chiamate a Resend passa almeno `sendIntervalMs`; al primo «troppe richieste»
 * il giro si ferma e le righe già prese ripartono alla fine del lease.
 */
export async function runDispatch(store: DispatchStore, o: DispatchOptions): Promise<DispatchSummary> {
  const now = o.now ?? new Date();
  const scope: DispatchScope = { caseId: o.caseId ?? null, workspaceId: o.workspaceId ?? null };
  const summary: DispatchSummary = { bell: 0, sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };
  summary.bell = await store.markInAppDelivered(scope);
  const configured = ucEmailConfig(o.env);
  if (!configured.ok) {
    summary.notConfigured = await store.holdUnconfigured(scope);
    return summary;
  }
  const { config } = configured;
  const mailer = o.mailer ?? createResendMailer(config.apiKey);
  const interval = Math.max(0, o.sendIntervalMs ?? SEND_INTERVAL_MS);
  const limit = Math.max(1, Math.min(o.limit ?? DISPATCH_BATCH_LIMIT, 200));
  const claimed = await store.claimDue({ ...scope, limit, includeWindowed: inRomeSendWindow(now) });
  let lastCall = 0;
  const paced: UcMailer = {
    async send(email, options) {
      const wait = lastCall + interval - Date.now();
      if (lastCall > 0 && wait > 0) await pause(wait);
      try {
        return await mailer.send(email, options);
      } finally {
        lastCall = Date.now();
      }
    },
  };
  for (const n of claimed) {
    let outcome: Delivered;
    try {
      outcome = await deliverOne(store, paced, config, n, { lsDomains: o.lsDomains, now });
    } catch {
      // La riga resta presa in carico fino alla fine del lease, poi si riprova.
      // Nessun dettaglio nel log: potrebbe contenere l'indirizzo o il link.
      summary.failed++;
      console.error("[uc] invio di una notifica non riuscito", n.templateKey);
      continue;
    }
    if (outcome === "rate_limited") {
      summary.failed++;
      break;
    }
    summary[outcome]++;
  }
  return summary;
}

async function deliverOne(
  store: DispatchStore,
  mailer: UcMailer,
  config: UcEmailConfig,
  n: ClaimedNotification,
  o: { lsDomains: readonly string[]; now: Date },
): Promise<Delivered> {
  let plan: DeliveryPlan;
  try {
    plan = planDelivery(n, await store.loadFacts(n), { origin: config.origin, lsDomains: o.lsDomains, now: o.now });
  } catch {
    await store.markFailed(n, "dati_non_letti");
    return "failed";
  }
  if (plan.action === "cancel") {
    await store.markCancelled(n, code(plan.reason));
    return "cancelled";
  }
  if (plan.action === "hold") {
    await store.markHeld(n, code(plan.reason));
    return "held";
  }

  let issued: { token: string; tokenId: string } | null = null;
  if (plan.link) {
    if (!n.caseId) {
      await store.markCancelled(n, "caso_assente");
      return "cancelled";
    }
    const r = await store.issueToken({ workspaceId: n.workspaceId, caseId: n.caseId, requestId: plan.link.requestId, issuedFor: plan.link.issuedFor });
    if (!r.ok) {
      if (r.code === "richiesta_non_viva") {
        await store.markCancelled(n, "richiesta_non_viva");
        return "cancelled";
      }
      await store.markFailed(n, code(r.code));
      return "failed";
    }
    issued = { token: r.token, tokenId: r.tokenId };
  }

  let rendered: RenderedEmail;
  try {
    rendered = renderEmail(plan.build(issued ? `${config.origin}/r/${issued.token}` : null));
  } catch {
    if (issued && n.caseId) await store.revokeToken({ caseId: n.caseId, tokenId: issued.tokenId });
    await store.markFailed(n, "testo_non_valido");
    return "failed";
  }

  const result = await mailer.send(
    { from: config.from, to: plan.to, subject: rendered.subject, text: rendered.text, html: rendered.html, ...(config.replyTo ? { replyTo: config.replyTo } : {}) },
    { idempotencyKey: idempotencyKeyFor(n.dedupeKey, n.attempts + 1) },
  );
  if (result.ok) {
    await store.markSent(n, plan.after);
    return "sent";
  }
  if (issued && n.caseId && !result.ambiguous) await store.revokeToken({ caseId: n.caseId, tokenId: issued.tokenId });
  await store.markFailed(n, code(result.code));
  return result.code === RATE_LIMIT_CODE ? "rate_limited" : "failed";
}
