/**
 * L'avviso per email a chi ha chiesto (SPEC §P2.7): quando il referente risponde, quando arrivano
 * documenti nuovi su una sua richiesta o quando dopo l'ultimo promemoria (o alla scadenza) restano
 * domande senza risposta. Al massimo un'email al giorno (di Roma) per persona e workspace, solo da
 * lunedì a venerdì dalle 9 alle 18, feste escluse; con il trasporto Resend dei dossier e gli stessi
 * controlli (email configurata, autorizzazione ai sub-responsabili, funzione accesa).
 *
 * Il testo nomina il caso d'uso (codice e titolo) e i conteggi (rilascio 5.1: fuori dalla dashboard
 * «caso d'uso», mai «use case»; l'oggetto comincia con il nome dell'azienda): mai il testo delle risposte, i nomi
 * dei file, il nome o l'email del referente, i titoli o i dettagli delle esigenze, punteggi o valori.
 * Il link porta alla scheda, a «Cosa serve»; una voce con il solo seguito («Nessuna risposta») a
 * «Richieste inviate», aperta, dove si chiede di nuovo.
 *
 * Calendario, pianificazione, testi e motore: tutto puro. Le letture e le scritture le fa
 * `queries/use-case-notifications.ts` attraverso `RequesterAlertStore`.
 */
import {
  addWorkingDays,
  inRomeSendWindow,
  nextRomeSendWindowStart,
  romeDate,
  romeLocalToUtc,
  workingDaysBetween,
  ROME_SEND_WINDOW,
} from "../../uc/calendar.ts";
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
import { emailBrand, oneLine, render, type Block, type EmailBrand, type RenderedEmail } from "../../uc/notify/email-render.ts";
import type { FollowUpReason } from "../../db/use-case-hub-referents-ddl.ts";
import { companyLabel } from "./labels.ts";
import { labelOfUseCase } from "./email.ts";
import { cardLink, cardLinkTo } from "./links.ts";

// ── Calendario ────────────────────────────────────────────────────────

export interface AlertSchedule {
  /** Data di Roma di adesso. */
  today: string;
  inWindow: boolean;
  /** Il giorno della prossima email, quando non può essere oggi. */
  nextDay: string;
  nextAt: Date;
}

/** Oggi, se siamo nella finestra; altrimenti (o per l'email del giorno dopo) le 9 del prossimo giorno lavorativo. */
export function alertSchedule(now: Date): AlertSchedule {
  const today = romeDate(now);
  const inWindow = inRomeSendWindow(now);
  const nextAt = inWindow ? romeLocalToUtc(addWorkingDays(today, 1), ROME_SEND_WINDOW.startHour) : nextRomeSendWindowStart(now);
  return { today, inWindow, nextDay: romeDate(nextAt), nextAt };
}

export const ALERT_STALE_AFTER_WORKING_DAYS = 2;

/** Troppo vecchio per partire: più di 2 giorni lavorativi dopo `due_at` (che i nuovi tentativi non spostano). */
export function isStaleAlert(dueAt: Date, now: Date): boolean {
  return workingDaysBetween(dueAt, now) > ALERT_STALE_AFTER_WORKING_DAYS;
}

// ── Fatti e piano ─────────────────────────────────────────────────────

export interface AlertItemFacts {
  requestId: string;
  useCaseId: string;
  code: string | null;
  title: string;
  createdAt: Date;
  answers: number;
  unknowns: number;
  documents: number;
  /** (Rilascio 6) Le domande del referente al team («Ho un dubbio»); assente: nessuna. */
  questions?: number;
  followUp: FollowUpReason | null;
  requestPurged: boolean;
  /**
   * La richiesta aspetta ancora, adesso: con «ultimo_promemoria» è viva con domande aperte, con
   * «scaduta» è scaduta con domande aperte e nessuno l'ha chiesta di nuovo. Falso → la frase
   * «restano domande senza risposta» non è più vera e si toglie (assente: vale ancora).
   */
  stillWaiting?: boolean;
}

export interface ClaimedAlert {
  id: string;
  workspaceId: string;
  recipientUserId: string;
  sendOn: string;
  scheduledAt: Date;
  dueAt: Date;
  attempts: number;
}

export interface AlertFacts {
  /** workspaces.name */
  company: string;
  /** referentAskEnabled(workspaceId, env) */
  featureOn: boolean;
  /** L'autorizzazione all'elenco dei sub-responsabili di adesso. */
  subprocessorsAuthorized: boolean;
  /** null quando l'utente non c'è più. email in minuscolo; reviewer = ruolo di adesso tra quelli da revisore. */
  recipient: { email: string | null; verified: boolean; reviewer: boolean; alertsOn: boolean } | null;
  /** Le voci dell'email, per data di creazione della richiesta. */
  items: AlertItemFacts[];
}

export interface AlertEntry {
  useCase: { code: string | null; title: string };
  answers: number;
  unknowns: number;
  documents: number;
  /** (Rilascio 6) Le domande del referente al team; assente: nessuna. */
  questions?: number;
  followUp: FollowUpReason | null;
  link: string;
}

/** Le voci unite per use case (somme; «scaduta» vince su «ultimo_promemoria»). */
export interface RequesterAlertInput {
  company: string;
  entries: AlertEntry[];
}

export type AlertPlan =
  | { action: "send"; to: string; input: RequesterAlertInput; sentRequestIds: string[]; dropped: { requestId: string; reason: "dati_cancellati" }[] }
  | { action: "hold"; reason: "email_non_configurata" | "sub_responsabili_mancanti" | "funzione_spenta" }
  | { action: "cancel"; reason: "destinatario_non_valido" | "avvisi_spenti" | "nessuna_voce" | "troppo_vecchia" };

/** Il link alla scheda, al capitolo «Cosa serve» (`links.ts`, lo usa anche l'email al referente revisore). */
export { cardLink };

/**
 * Dove porta la voce di una scheda: con il solo seguito (ultimo promemoria, link scaduto) a
 * «Richieste inviate», dove si chiede di nuovo; con risposte, documenti o «Non ce l'ho» da guardare a
 * «Cosa serve».
 */
function entryLink(origin: string, workspaceId: string, useCaseId: string, e: Pick<AlertEntry, "answers" | "unknowns" | "documents" | "questions" | "followUp">): string {
  const followUpOnly = e.followUp !== null && e.answers === 0 && e.unknowns === 0 && e.documents === 0 && (e.questions ?? 0) === 0;
  return cardLinkTo(origin, workspaceId, useCaseId, followUpOnly ? "richieste" : "cosa-serve");
}

/** Il piano di una riga, nell'ordine di §P2.7.3. */
export function planRequesterAlert(e: ClaimedAlert, f: AlertFacts, o: { env: DispatchEnv; origin: string; now: Date }): AlertPlan {
  if (!ucEmailConfig(o.env).ok) return { action: "hold", reason: "email_non_configurata" };
  if (!f.featureOn) return { action: "hold", reason: "funzione_spenta" };
  if (!f.subprocessorsAuthorized) return { action: "hold", reason: "sub_responsabili_mancanti" };
  if (isStaleAlert(e.dueAt, o.now)) return { action: "cancel", reason: "troppo_vecchia" };
  const r = f.recipient;
  if (!r || !r.verified || !r.reviewer || !isPlainAddress(r.email)) return { action: "cancel", reason: "destinatario_non_valido" };
  if (!r.alertsOn) return { action: "cancel", reason: "avvisi_spenti" };
  const dropped = f.items.filter((i) => i.requestPurged).map((i) => ({ requestId: i.requestId, reason: "dati_cancellati" as const }));
  // Un seguito («ultimo promemoria», «link scaduto») si riguarda adesso: se nel frattempo è arrivata la
  // risposta, o qualcuno ha chiesto di nuovo, la frase cade; una voce senza altro da dire esce.
  const kept = f.items
    .filter((i) => !i.requestPurged)
    .map((i) => (i.followUp !== null && i.stillWaiting === false ? { ...i, followUp: null } : i))
    .filter((i) => i.answers > 0 || i.unknowns > 0 || i.documents > 0 || (i.questions ?? 0) > 0 || i.followUp !== null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.requestId < b.requestId ? -1 : 1));
  if (kept.length === 0) return { action: "cancel", reason: "nessuna_voce" };
  const byUseCase = new Map<string, AlertEntry>();
  for (const item of kept) {
    const key = item.useCaseId.toLowerCase();
    const current = byUseCase.get(key);
    if (!current) {
      byUseCase.set(key, {
        useCase: { code: item.code, title: item.title },
        answers: item.answers,
        unknowns: item.unknowns,
        documents: item.documents,
        ...((item.questions ?? 0) > 0 ? { questions: item.questions } : {}),
        followUp: item.followUp,
        // Il capitolo si decide sulla voce unita, qui sotto.
        link: "",
      });
      continue;
    }
    current.answers += item.answers;
    current.unknowns += item.unknowns;
    current.documents += item.documents;
    if ((item.questions ?? 0) > 0) current.questions = (current.questions ?? 0) + (item.questions ?? 0);
    current.followUp = current.followUp === "scaduta" || item.followUp === "scaduta" ? "scaduta" : (current.followUp ?? item.followUp);
  }
  return {
    action: "send",
    to: r.email.trim().toLowerCase(),
    input: { company: f.company, entries: [...byUseCase].map(([useCaseId, entry]) => ({ ...entry, link: entryLink(o.origin, e.workspaceId, useCaseId, entry) })) },
    sentRequestIds: kept.map((i) => i.requestId),
    dropped,
  };
}

// ── Testo (§P2.7.4) ───────────────────────────────────────────────────

function joinFacts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  const last = parts[parts.length - 1];
  // (Rilascio 5.1) «… ed è partito l'ultimo promemoria», mai «e è».
  return `${parts.slice(0, -1).join(", ")} ${/^[eè]/i.test(last) ? "ed" : "e"} ${last}`;
}

function factsOf(e: AlertEntry): string[] {
  const out: string[] = [];
  // (Rilascio 6) Prima di tutto: il referente ha chiesto qualcosa al team.
  const q = e.questions ?? 0;
  if (q > 0) out.push(q === 1 ? "il referente ha una domanda per il team" : `il referente ha ${q} domande per il team`);
  if (e.answers > 0) out.push(e.answers === 1 ? "è arrivata 1 risposta" : `sono arrivate ${e.answers} risposte`);
  if (e.unknowns > 0) out.push(e.unknowns === 1 ? "il referente non ha l'informazione per 1 domanda" : `il referente non ha l'informazione per ${e.unknowns} domande`);
  if (e.documents > 0) out.push(e.documents === 1 ? "c'è 1 documento nuovo" : `ci sono ${e.documents} documenti nuovi`);
  return out;
}

/** (Rilascio 5.1) Il seguito è una frase a sé, mai attaccato ai fatti con un'altra «e». */
function followUpSentence(e: AlertEntry): string | null {
  if (e.followUp === "ultimo_promemoria") return "È partito l'ultimo promemoria e restano domande senza risposta.";
  if (e.followUp === "scaduta") return "Il link è scaduto e restano domande senza risposta.";
  return null;
}

/**
 * La riga di una voce: `lead` («ci sono novità sul caso d'uso «…» di Rondine» con una voce sola, ««Ordini»»
 * con più voci), i fatti («: sono arrivate 2 risposte e c'è 1 documento nuovo.») e il seguito. Con solo il
 * seguito: «… di Rondine. Il link è scaduto …» (una voce), ««Ordini»: il link è scaduto …» (più voci).
 */
function entryLine(lead: string, e: AlertEntry, single: boolean): string {
  const facts = factsOf(e);
  const follow = followUpSentence(e);
  if (facts.length > 0) return `${lead}: ${joinFacts(facts)}.${follow ? ` ${follow}` : ""}`;
  if (!follow) return `${lead}.`;
  return single ? `${lead}. ${follow}` : `${lead}: ${follow.charAt(0).toLowerCase()}${follow.slice(1)}`;
}

function subjectOf(i: RequesterAlertInput): string {
  const company = oneLine(companyLabel(i.company), 80);
  if (i.entries.length !== 1) return `${company}: novità su ${i.entries.length} casi d'uso`;
  const e = i.entries[0];
  const uc = labelOfUseCase(e.useCase);
  if ((e.questions ?? 0) > 0) return `${company}: il referente ha una domanda sul caso d'uso «${uc}»`;
  if (e.answers > 0) return `${company}: risposte arrivate sul caso d'uso «${uc}»`;
  if (e.documents > 0) return `${company}: nuovi documenti sul caso d'uso «${uc}»`;
  // Con il link scaduto l'oggetto non dice «non sa rispondere»: restano domande senza risposta.
  if (e.unknowns > 0 && e.followUp !== "scaduta") return `${company}: il referente non sa rispondere sul caso d'uso «${uc}»`;
  return `${company}: nessuna risposta sul caso d'uso «${uc}»`;
}

/** L'email a chi ha chiesto, parola per parola. (Rilascio 5.1) Con `brand` l'HTML ha in cima il marchio. */
export function renderRequesterAlert(i: RequesterAlertInput, brand?: EmailBrand): RenderedEmail {
  if (i.entries.length === 0) throw new Error("Avviso senza voci");
  const company = oneLine(companyLabel(i.company), 80);
  const blocks: Block[] = [{ p: "Buongiorno," }];
  // (Rilascio 5.1) Con un caso d'uso solo, il titolo una volta: «ci sono novità sul caso d'uso «…» di
  // {Azienda}: …». Con più casi d'uso, una riga per ognuno.
  const single = i.entries.length === 1;
  if (!single) blocks.push({ p: `ci sono novità su ${i.entries.length} casi d'uso di ${company}.` });
  for (const e of i.entries) {
    const label = `«${labelOfUseCase(e.useCase)}»`;
    blocks.push({ p: entryLine(single ? `ci sono novità sul caso d'uso ${label} di ${company}` : label, e, single) });
    if ((e.questions ?? 0) > 0) blocks.push({ small: "Rispondi dalla scheda, in «Cosa serve»." });
    else if (e.answers > 0 || e.documents > 0) blocks.push({ small: "Da verificare in «Cosa serve»." });
    if (e.unknowns > 0 && !e.followUp) blocks.push({ small: "Per i «Non ce l'ho» puoi chiedere a un'altra persona." });
    if (e.followUp) blocks.push({ small: "Puoi chiedere di nuovo o chiedere a un'altra persona." });
    blocks.push({ link: { href: e.link, label: "Apri «Cosa serve»" } });
  }
  blocks.push({
    small: "Ricevi questa email perché hai chiesto tu queste informazioni al referente. Per non riceverle più, togli la spunta «Avvisami per email» nella campanella di Unbundle.",
  });
  return render(oneLine(subjectOf(i), 200), blocks, brand);
}

// ── Motore ────────────────────────────────────────────────────────────

export interface RequesterAlertStore {
  holdUnconfigured(): Promise<number>;
  /** Righe in attesa il cui `due_at` ha più di 2 giorni lavorativi. */
  cancelStale(now: Date): Promise<number>;
  /** Solo nella finestra di Roma; scheduled_at <= now; lease di 5 minuti. */
  claimDue(i: { recipientUserId: string | null; limit: number; now: Date }): Promise<ClaimedAlert[]>;
  loadFacts(e: ClaimedAlert): Promise<AlertFacts>;
  markSent(e: ClaimedAlert): Promise<void>;
  /** attempts+1, scheduled_at + RETRY_DELAY_MINUTES, stato errore. */
  markFailed(e: ClaimedAlert, code: string): Promise<void>;
  markHeld(e: ClaimedAlert, reason: string): Promise<void>;
  markCancelled(e: ClaimedAlert, reason: string): Promise<void>;
}

export interface RequesterAlertSummary {
  sent: number;
  failed: number;
  held: number;
  cancelled: number;
  notConfigured: number;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const CODE = /^[a-z0-9_]{1,60}$/;
const code = (value: string) => (CODE.test(value) ? value : "errore_invio");

/** Un giro di invio degli avvisi: senza configurazione restano in coda; le righe vecchie si annullano. */
export async function runRequesterAlertDispatch(
  store: RequesterAlertStore,
  o: { env: DispatchEnv; now?: Date; recipientUserId?: string | null; limit?: number; mailer?: UcMailer; sendIntervalMs?: number },
): Promise<RequesterAlertSummary> {
  const now = o.now ?? new Date();
  const summary: RequesterAlertSummary = { sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };
  const configured = ucEmailConfig(o.env);
  if (!configured.ok) {
    summary.notConfigured = await store.holdUnconfigured();
    return summary;
  }
  const { config } = configured;
  summary.cancelled += await store.cancelStale(now);
  if (!inRomeSendWindow(now)) return summary;
  const mailer = o.mailer ?? createResendMailer(config.apiKey);
  const interval = Math.max(0, o.sendIntervalMs ?? SEND_INTERVAL_MS);
  const claimed = await store.claimDue({ recipientUserId: o.recipientUserId ?? null, limit: Math.max(1, Math.min(o.limit ?? 50, 200)), now });
  let lastCall = 0;
  for (const e of claimed) {
    try {
      const plan = planRequesterAlert(e, await store.loadFacts(e), { env: o.env, origin: config.origin, now });
      if (plan.action === "hold") {
        await store.markHeld(e, plan.reason);
        summary.held++;
        continue;
      }
      if (plan.action === "cancel") {
        await store.markCancelled(e, plan.reason);
        summary.cancelled++;
        continue;
      }
      const rendered = renderRequesterAlert(plan.input, emailBrand(config.origin));
      const wait = lastCall + interval - Date.now();
      if (lastCall > 0 && wait > 0) await pause(wait);
      let result;
      try {
        result = await mailer.send(
          // Il reply-to è `UC_EMAIL_REPLY_TO` (se configurato): il mittente non riceve posta.
          { from: config.from, to: plan.to, subject: rendered.subject, text: rendered.text, html: rendered.html, ...(config.replyTo ? { replyTo: config.replyTo } : {}) },
          { idempotencyKey: idempotencyKeyFor(`ra:${e.id}`, e.attempts + 1) },
        );
      } finally {
        lastCall = Date.now();
      }
      if (result.ok) {
        await store.markSent(e);
        summary.sent++;
        continue;
      }
      await store.markFailed(e, code(result.code));
      summary.failed++;
      if (result.code === RATE_LIMIT_CODE) break;
    } catch {
      summary.failed++;
      console.error("[use-case.referenti] avviso a chi ha chiesto non inviato");
      try {
        await store.markFailed(e, "errore_invio");
      } catch {
        // la riga resta presa fino alla fine del lease
      }
    }
  }
  return summary;
}
