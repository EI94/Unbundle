/**
 * L'invio delle email di «Chiedi al referente» (SPEC §3.6, §2.1 `dispatch.ts`): un motore puro con
 * la forma di `runDispatch` dei dossier, che riusa trasporto Resend, configurazione, pausa tra gli
 * invii, chiave di idempotenza e tentativi (`src/lib/uc/notify/dispatch.ts`).
 *
 * - **Configurazione**: senza chiave Resend, mittente o indirizzo pubblico le righe restano in coda
 *   (`email_non_configurata`).
 * - **Fornitori**: ogni email (richiesta, promemoria, conferma) vuole l'autorizzazione del cliente
 *   all'elenco dei sub-responsabili di adesso; senza, la riga aspetta (`sub_responsabili_mancanti`).
 * - **Destinatario**: un referente attivo, non anonimizzato, con un indirizzo semplice e mai di
 *   Lateral Space (nemmeno l'account collegato); altrimenti la riga si annulla.
 * - **Link**: un token nuovo per ogni richiesta dell'email, emesso solo al momento dell'invio, con
 *   l'impronta dell'indirizzo a cui parte; mai nel database in chiaro, mai nei log. Un invio fallito
 *   con certezza revoca i token emessi; un esito incerto li lascia validi.
 * - **Rispondi**: le risposte all'email arrivano a chi ha chiesto (`replyTo`), solo se ha ancora
 *   l'email verificata e un ruolo da revisore (lo decide chi legge i fatti). Altrimenti (chi ha
 *   chiesto non è più revisore, o un promemoria raccoglie richieste di persone diverse) il reply-to è
 *   `UC_EMAIL_REPLY_TO` se è configurato e valido; mai un altro indirizzo, mai uno non verificato.
 *   Il mittente sta su un sottodominio che non riceve posta: senza reply-to una risposta si perde.
 * - **Un promemoria al giorno per persona**: un promemoria raccoglie le richieste dovute della stessa
 *   persona (una voce per use case); se oggi le è già partito un promemoria, la riga aspetta.
 *
 * Nessun I/O qui: lo fanno le funzioni di `queries/use-case-referent-dispatch.ts` attraverso
 * `ReferentDispatchStore`. Modulo puro.
 */
import { inRomeSendWindow } from "../../uc/calendar.ts";
import { emailDomain } from "../../uc/lateral-space.ts";
import {
  RATE_LIMIT_CODE,
  SEND_INTERVAL_MS,
  createResendMailer,
  idempotencyKeyFor,
  isPlainAddress,
  ucEmailConfig,
  type DispatchEnv,
  type UcMailer,
} from "../../uc/notify/dispatch.ts";
import type { RenderedEmail } from "../../uc/notify/email-render.ts";
import type { ReferentEmailTemplate, ReferentReminderKind, ReferentRequestStatus } from "../../db/use-case-hub-referents-ddl.ts";
import { renderReferentEmail, type ReferentEmailInput, type ReminderEntry } from "./email.ts";
import { cardLink } from "./links.ts";
import { isStaleEmail, sameRomeDay } from "./schedule.ts";
import { recipientHash } from "./tokens.ts";

type UcRef = { code: string | null; title: string };

/** Righe per giro del cron e dopo un comando (`after()`). */
export const REFERENT_DISPATCH_LIMIT = 50;
export const REFERENT_DISPATCH_AFTER_LIMIT = 5;

export interface ClaimedReferentEmail {
  id: string;
  workspaceId: string;
  contactId: string;
  requestId: string | null;
  template: ReferentEmailTemplate;
  attempts: number;
  dedupeKey: string;
  dueAt: Date;
}

export interface ReferentRequestFacts {
  id: string;
  /** (Parte 3) Lo use case della richiesta, per il link alla scheda di un referente revisore. */
  useCaseId?: string;
  useCase: UcRef;
  status: ReferentRequestStatus;
  /** `inviata`, non revocata e non scaduta (orologio del database). */
  live: boolean;
  expiresAt: Date;
  sentAt: Date | null;
  reminderCount: number;
  lastEmailAt: Date | null;
  message: string | null;
  requesterName: string;
  requesterUserId: string | null;
  openItems: number;
  newQuestions: number;
  /** Solo conferma: le domande risposte oggi (Roma), per «la tua risposta» / «le tue risposte». */
  answeredToday?: number;
  /** Solo promemoria: il tipo della voce, e se una voce «inviata» dello stesso tipo c'è già per la richiesta. */
  item: { kind: ReferentReminderKind; alreadySent: boolean } | null;
  /**
   * Già partita, ma senza un link valido per l'indirizzo di adesso («Correggi l'email»): le email di
   * oggi sono andate al vecchio indirizzo, quindi «un'email al giorno» non le conta.
   */
  addressChanged?: boolean;
  /**
   * (Parte 3) Il referente è chi ha chiesto: lo stesso account, oppure l'email del contatto è l'email
   * verificata di chi ha chiesto. Riletto a ogni invio: nessuna email a se stessi.
   */
  selfRequest?: boolean;
}

export interface ReferentDeliveryFacts {
  company: string;
  /** `referentAskEnabled(workspaceId, env)`: falso (workspace escluso dall'area) → la riga aspetta. */
  featureOn?: boolean;
  /** L'autorizzazione del workspace all'elenco dei sub-responsabili di adesso. */
  subprocessorsAuthorized: boolean;
  /**
   * `teamAccess` (Parte 3): il referente è adesso un revisore del workspace con l'email verificata
   * uguale a quella del contatto (`referentPersonOf`, riletto a ogni invio). Solo allora l'email
   * aggiunge «Hai già accesso a Unbundle: …» e il link alla scheda; mai per corsisti, contributori o
   * persone senza account.
   */
  recipient: { email: string | null; active: boolean; anonymized: boolean; linkedUserIsLateralSpace: boolean; teamAccess?: boolean } | null;
  /** L'email di chi ha chiesto solo se verificata e ancora revisore del workspace; in minuscolo. */
  replyTo: string | null;
  /** richiesta/conferma: l'unica richiesta; promemoria: una per voce ancora «in_coda». */
  requests: ReferentRequestFacts[];
  /** Oggi (Roma) a questa persona è già partito un altro promemoria. */
  contactRemindedToday: boolean;
}

/** Quello che `markSent` scrive per ogni richiesta di un'email partita. */
export interface ReferentSendEffect {
  requestId: string;
  reminder: 1 | 2 | null;
  first: boolean;
  manual: boolean;
}

export type ReferentDeliveryPlan =
  | {
      action: "send";
      to: string;
      replyTo: string | null;
      links: { requestId: string; issuedFor: "richiesta" | "promemoria" }[];
      drop: { requestId: string; reason: string }[];
      /** links: requestId → indirizzo completo; vuoto per la conferma. */
      build: (links: Readonly<Record<string, string>>) => ReferentEmailInput;
      after: ReferentSendEffect[];
    }
  | { action: "hold"; reason: string }
  | { action: "cancel"; reason: string };

const cancel = (reason: string): ReferentDeliveryPlan => ({ action: "cancel", reason });
const hold = (reason: string): ReferentDeliveryPlan => ({ action: "hold", reason });

function linkOf(links: Readonly<Record<string, string>>, requestId: string): string {
  const link = links[requestId];
  if (!link) throw new Error("Manca il link dell'email");
  return link;
}

/** Perché una voce di promemoria non parte più, oppure null se parte. */
function dropReason(r: ReferentRequestFacts, now: Date): string | null {
  if (!r.live) return "richiesta_non_viva";
  if (r.openItems <= 0) return "nessuna_domanda_aperta";
  const item = r.item;
  if (!item) return "richiesta_non_viva";
  if (item.kind === "primo" && (r.reminderCount !== 0 || item.alreadySent)) return "promemoria_gia_fatto";
  if (item.kind === "ultimo" && (r.reminderCount !== 1 || item.alreadySent)) return "promemoria_gia_fatto";
  if (r.selfRequest) return "referente_sei_tu";
  if (!r.addressChanged && sameRomeDay(r.lastEmailAt, now)) return "gia_scritto_oggi";
  return null;
}

/** (Parte 3) Il link alla scheda di una richiesta, solo per un referente revisore e con l'origine pubblica. */
function cardLinkOf(e: ClaimedReferentEmail, f: ReferentDeliveryFacts, r: ReferentRequestFacts, origin: string | undefined): string | null {
  if (!f.recipient?.teamAccess || !origin || !r.useCaseId) return null;
  return cardLink(origin, e.workspaceId, r.useCaseId);
}

/** Che cosa fare di una riga: inviarla (con i link da emettere e gli effetti), tenerla in coda o annullarla. */
export function planReferentDelivery(
  e: ClaimedReferentEmail,
  f: ReferentDeliveryFacts,
  o: { lsDomains: readonly string[]; now: Date; origin?: string; fallbackReplyTo?: string | null },
): ReferentDeliveryPlan {
  if (f.featureOn === false) return hold("funzione_spenta");
  if (!f.subprocessorsAuthorized) return hold("sub_responsabili_mancanti");
  const r = f.recipient;
  const to = r?.email?.trim().toLowerCase() ?? null;
  if (!r || !r.active || r.anonymized || !isPlainAddress(to)) return cancel("destinatario_non_raggiungibile");
  const domain = emailDomain(to);
  if ((domain && o.lsDomains.includes(domain)) || r.linkedUserIsLateralSpace) return cancel("destinatario_lateral_space");
  const reply = f.replyTo?.trim().toLowerCase() ?? null;
  const replyTo = isPlainAddress(reply) ? reply : null;
  const replyToKnown = replyTo !== null;
  // Il reply-to di ripiego (`UC_EMAIL_REPLY_TO`, già controllato da `ucEmailConfig`): si ricontrolla qui
  // perché il piano è puro e si prova da solo. Non cambia il testo («arriva a {Nome}» vale solo per chi ha chiesto).
  const fallbackRaw = o.fallbackReplyTo?.trim().toLowerCase() ?? null;
  const fallback = isPlainAddress(fallbackRaw) ? fallbackRaw : null;

  if (e.template === "richiesta") {
    const req = f.requests.find((x) => x.id === e.requestId);
    if (!req || !req.live) return cancel("richiesta_non_viva");
    if (req.openItems <= 0) return cancel("nessuna_domanda_aperta");
    if (req.selfRequest) return cancel("referente_sei_tu");
    return {
      action: "send",
      to,
      replyTo: replyTo ?? fallback,
      links: [{ requestId: req.id, issuedFor: "richiesta" }],
      drop: [],
      build: (links) => ({
        template: "richiesta",
        company: f.company,
        useCase: req.useCase,
        requesterName: req.requesterName,
        questions: req.openItems,
        message: req.message,
        expiresAt: req.expiresAt,
        link: linkOf(links, req.id),
        replyToKnown,
        cardLink: cardLinkOf(e, f, req, o.origin),
      }),
      after: [{ requestId: req.id, reminder: null, first: true, manual: false }],
    };
  }

  if (e.template === "conferma") {
    const req = f.requests.find((x) => x.id === e.requestId);
    const confirmable = req && (req.status === "inviata" || req.status === "completata") && req.expiresAt.getTime() > o.now.getTime();
    if (!req || !confirmable) return cancel("richiesta_non_viva");
    // D-B24: mai un'email a chi ha chiesto, nemmeno la conferma (contatto collegato più tardi al suo account).
    if (req.selfRequest) return cancel("referente_sei_tu");
    const submitted = Math.max(1, req.answeredToday ?? 1);
    return {
      action: "send",
      to,
      replyTo: replyTo ?? fallback,
      links: [],
      drop: [],
      build: () => ({
        template: "conferma",
        company: f.company,
        useCase: req.useCase,
        requesterName: req.requesterName,
        submitted,
        openQuestions: req.live ? req.openItems : 0,
        expiresAt: req.expiresAt,
      }),
      after: [{ requestId: req.id, reminder: null, first: false, manual: false }],
    };
  }

  // Promemoria: una o più richieste della stessa persona.
  if (f.contactRemindedToday && !(f.requests.length > 0 && f.requests.every((x) => x.addressChanged === true))) return hold("gia_scritto_oggi");
  const drop: { requestId: string; reason: string }[] = [];
  const kept: ReferentRequestFacts[] = [];
  for (const req of f.requests) {
    const reason = dropReason(req, o.now);
    if (reason) drop.push({ requestId: req.id, reason });
    else kept.push(req);
  }
  if (kept.length === 0) return cancel("nessuna_voce");
  const sameRequester = kept.every((x) => x.requesterUserId !== null && x.requesterUserId === kept[0].requesterUserId);
  const replyName = replyToKnown && sameRequester ? kept[0].requesterName : null;
  return {
    action: "send",
    to,
    replyTo: (sameRequester ? replyTo : null) ?? fallback,
    links: kept.map((x) => ({ requestId: x.id, issuedFor: "promemoria" as const })),
    drop,
    build: (links) => ({
      template: "promemoria",
      company: f.company,
      replyToKnown: replyToKnown && sameRequester,
      replyName,
      // Solo le voci con il loro link: una richiesta non più viva all'emissione esce dall'email.
      entries: kept
        .filter((x) => Boolean(links[x.id]))
        .map(
          (x): ReminderEntry => ({
            useCase: x.useCase,
            requesterName: x.requesterName,
            kind: x.item!.kind,
            openQuestions: x.openItems,
            newQuestions: x.newQuestions,
            expiresAt: x.expiresAt,
            link: linkOf(links, x.id),
            cardLink: cardLinkOf(e, f, x, o.origin),
          }),
        ),
    }),
    after: kept.map((x) => ({
      requestId: x.id,
      reminder: x.item!.kind === "primo" ? 1 : x.item!.kind === "ultimo" ? 2 : null,
      first: false,
      manual: x.item!.kind === "manuale",
    })),
  };
}

// ── Motore ────────────────────────────────────────────────────────────

export interface ReferentDispatchStore {
  holdUnconfigured(scope: { requestId: string | null }): Promise<number>;
  /** Righe in coda o in errore il cui `due_at` è troppo vecchio → annullata «troppo_vecchia». */
  cancelStale(now: Date, isStale: (dueAt: Date) => boolean): Promise<number>;
  claimDue(i: { requestId: string | null; limit: number; includeWindowed: boolean; now: Date }): Promise<ClaimedReferentEmail[]>;
  loadFacts(e: ClaimedReferentEmail, now: Date): Promise<ReferentDeliveryFacts>;
  issueToken(i: { requestId: string; workspaceId: string; issuedFor: "richiesta" | "promemoria"; recipientHash: string }): Promise<{ ok: true; token: string; tokenId: string } | { ok: false; code: string }>;
  revokeToken(tokenId: string): Promise<void>;
  /** tokenIds: requestId → id del token emesso per questa email. */
  markSent(e: ClaimedReferentEmail, effects: readonly ReferentSendEffect[], tokenIds: Readonly<Record<string, string>>, dropped: readonly { requestId: string; reason: string }[]): Promise<void>;
  /** attempts+1, scheduled_at + RETRY_DELAY_MINUTES, stato errore (`due_at` non cambia). */
  markFailed(e: ClaimedReferentEmail, code: string): Promise<void>;
  markHeld(e: ClaimedReferentEmail, reason: string): Promise<void>;
  markCancelled(e: ClaimedReferentEmail, reason: string): Promise<void>;
}

export interface ReferentDispatchOptions {
  env: DispatchEnv;
  lsDomains: readonly string[];
  now?: Date;
  requestId?: string | null;
  limit?: number;
  mailer?: UcMailer;
  sendIntervalMs?: number;
}

export interface ReferentDispatchSummary {
  sent: number;
  failed: number;
  held: number;
  cancelled: number;
  notConfigured: number;
}

const CODE = /^[a-z0-9_]{1,60}$/;
const code = (value: string) => (CODE.test(value) ? value : "errore_invio");
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Delivered = "sent" | "failed" | "held" | "cancelled" | "rate_limited";

/**
 * Un giro di invio. Senza configurazione le righe restano in coda con il motivo. Prima le righe
 * troppo vecchie si annullano; poi le righe dovute (i promemoria solo nella finestra di Roma).
 * Tra due chiamate a Resend passa almeno `sendIntervalMs`; al primo «troppe richieste» il giro si
 * ferma e le righe già prese ripartono alla fine del lease.
 */
export async function runReferentDispatch(store: ReferentDispatchStore, o: ReferentDispatchOptions): Promise<ReferentDispatchSummary> {
  const now = o.now ?? new Date();
  const summary: ReferentDispatchSummary = { sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };
  const configured = ucEmailConfig(o.env);
  if (!configured.ok) {
    summary.notConfigured = await store.holdUnconfigured({ requestId: o.requestId ?? null });
    return summary;
  }
  const { config } = configured;
  summary.cancelled += await store.cancelStale(now, (dueAt) => isStaleEmail(dueAt, now));
  const mailer = o.mailer ?? createResendMailer(config.apiKey);
  const interval = Math.max(0, o.sendIntervalMs ?? SEND_INTERVAL_MS);
  const limit = Math.max(1, Math.min(o.limit ?? REFERENT_DISPATCH_LIMIT, 200));
  const claimed = await store.claimDue({ requestId: o.requestId ?? null, limit, includeWindowed: inRomeSendWindow(now), now });
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
  for (const e of claimed) {
    let outcome: Delivered;
    try {
      outcome = await deliverOne(store, paced, config, e, { lsDomains: o.lsDomains, now });
    } catch {
      // La riga resta presa in carico fino alla fine del lease, poi si riprova. Nessun dettaglio nel log.
      summary.failed++;
      console.error("[use-case.referenti] invio di un'email non riuscito", e.template);
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
  store: ReferentDispatchStore,
  mailer: UcMailer,
  config: { from: string; origin: string; replyTo?: string },
  e: ClaimedReferentEmail,
  o: { lsDomains: readonly string[]; now: Date },
): Promise<Delivered> {
  let plan: ReferentDeliveryPlan;
  try {
    plan = planReferentDelivery(e, await store.loadFacts(e, o.now), { ...o, origin: config.origin, fallbackReplyTo: config.replyTo ?? null });
  } catch {
    await store.markFailed(e, "dati_non_letti");
    return "failed";
  }
  if (plan.action === "cancel") {
    await store.markCancelled(e, code(plan.reason));
    return "cancelled";
  }
  if (plan.action === "hold") {
    await store.markHeld(e, code(plan.reason));
    return "held";
  }

  const tokens: Record<string, { token: string; tokenId: string }> = {};
  const dropped = [...plan.drop];
  const hash = recipientHash(plan.to);
  for (const link of plan.links) {
    const issued = await store.issueToken({ requestId: link.requestId, workspaceId: e.workspaceId, issuedFor: link.issuedFor, recipientHash: hash });
    if (issued.ok) {
      tokens[link.requestId] = { token: issued.token, tokenId: issued.tokenId };
      continue;
    }
    if (issued.code === "richiesta_non_viva" && e.template === "promemoria") {
      dropped.push({ requestId: link.requestId, reason: "richiesta_non_viva" });
      continue;
    }
    for (const t of Object.values(tokens)) await store.revokeToken(t.tokenId);
    if (issued.code === "richiesta_non_viva") {
      await store.markCancelled(e, "richiesta_non_viva");
      return "cancelled";
    }
    await store.markFailed(e, code(issued.code));
    return "failed";
  }
  if (plan.links.length > 0 && Object.keys(tokens).length === 0) {
    await store.markCancelled(e, "nessuna_voce");
    return "cancelled";
  }

  const revokeAll = async () => {
    for (const t of Object.values(tokens)) await store.revokeToken(t.tokenId);
  };
  let rendered: RenderedEmail;
  let effects: ReferentSendEffect[];
  try {
    const links = Object.fromEntries(Object.entries(tokens).map(([requestId, t]) => [requestId, `${config.origin}/rispondi/${t.token}`]));
    const input = plan.build(links);
    // Le voci senza token (richiesta non più viva al momento dell'emissione) escono dall'email (`build`).
    if (input.template === "promemoria") {
      const keptIds = new Set(Object.keys(tokens));
      rendered = renderReferentEmail(input);
      effects = plan.after.filter((x) => keptIds.has(x.requestId));
    } else {
      rendered = renderReferentEmail(input);
      effects = plan.after;
    }
  } catch {
    await revokeAll();
    await store.markFailed(e, "testo_non_valido");
    return "failed";
  }

  const result = await mailer.send(
    { from: config.from, to: plan.to, subject: rendered.subject, text: rendered.text, html: rendered.html, ...(plan.replyTo ? { replyTo: plan.replyTo } : {}) },
    { idempotencyKey: idempotencyKeyFor(e.dedupeKey, e.attempts + 1) },
  );
  if (result.ok) {
    await store.markSent(e, effects, Object.fromEntries(Object.entries(tokens).map(([requestId, t]) => [requestId, t.tokenId])), dropped);
    return "sent";
  }
  if (!result.ambiguous) await revokeAll();
  await store.markFailed(e, code(result.code));
  return result.code === RATE_LIMIT_CODE ? "rate_limited" : "failed";
}
