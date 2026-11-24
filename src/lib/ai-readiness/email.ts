/**
 * Le email dell'AI Readiness (la metà email di «ogni funzione arriva con le sue notifiche», dopo la campanella
 * dell'ondata 7b del rilascio 10; la coda è la 0044, `ai_readiness_alert_emails`).
 *
 * - **Chi le riceve:** le stesse persone delle righe in campanella, cioè chi gestisce il workspace
 *   (`canManageWorkspaceSettings`, il ruolo di adesso), con un'email verificata. Mai nessun altro: né «Solo questo use
 *   case», né chi segue un corso, né un ruolo che il codice non conosce (il permesso è chiuso per default). Ognuno le
 *   spegne da sé («Avvisami per email sull'AI Readiness», accesa per default). Partono solo con l'ok del cliente sui
 *   sub-responsabili della versione di oggi, a tutti, Lateral Space compreso, come gli avvisi a chi ha chiesto al
 *   referente e «Pronto da avviare» (Resend è uno dei sub-responsabili, e l'email porta il nome del cliente e della
 *   rilevazione): senza, niente entra in coda, l'interruttore non si vede e all'invio la riga aspetta.
 * - **Che cosa:** le risposte nuove, al massimo un'email al giorno per rilevazione e persona, solo conteggi (le risposte
 *   nuove dall'ultima email, il totale, le attese), mai una persona; i risultati disponibili, un'email una volta, quando
 *   nasce la riga «i risultati ci sono» della campanella. Nel giorno in cui partono tutte e due, parte quella dei
 *   risultati e le risposte aspettano il giorno dopo.
 * - **Quando:** dal cron dei giorni feriali, nella finestra lun–ven 9–18 di Roma, feste escluse.
 * - **Mai due volte:** prima di chiamare Resend la riga segna il tentativo; un esito incerto (rete, 5xx, un processo
 *   interrotto) non si ripete mai e la riga si annulla («esito_incerto»). Un errore certo si riprova, al massimo tre
 *   volte. Le righe in attesa da più di due giorni lavorativi si annullano.
 * - **Il link** non ha né `?` né `#` (`checkEmailLink`): `/dashboard/<ws>/ai-readiness/aggiornamenti/<rilevazione>`
 *   (le risposte) o `…/<rilevazione>/risultati`, che controllano l'accesso come la pagina e rispondono 307.
 *
 * Testi, regole, piano e motore: tutto puro. Le letture e le scritture le fa `queries/ai-readiness-email.ts`
 * attraverso `AirEmailStore`.
 */
import { inRomeSendWindow } from "../uc/calendar.ts";
import { RATE_LIMIT_CODE, SEND_INTERVAL_MS, createResendMailer, isPlainAddress, ucEmailConfig, type DispatchEnv, type MailResult, type UcMailer } from "../uc/notify/dispatch.ts";
import { emailBrand, emailSubject, oneLine, render, type Block, type EmailBrand, type RenderedEmail } from "../uc/notify/email-render.ts";
import { checkEmailLink } from "../uc/notify/email-templates.ts";
import { isStaleAlert } from "../use-cases/referent/alerts.ts";
import { companyLabel } from "../use-cases/referent/labels.ts";
import { canManageWorkspaceSettings } from "../workspace-permissions.ts";
import type { AirEmailKind } from "../db/ai-readiness-email-ddl.ts";
import { formatCount } from "./dashboard-text.ts";
import { READINESS_ANCHORS, readinessHref } from "./dashboard-view.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Chi le riceve ─────────────────────────────────────────────────────

/** Perché una persona non riceve le email dell'AI Readiness di un workspace (la scelta della persona a parte). */
export type AirEmailBlock = "non_gestisce" | "email_non_verificata";

export interface AirEmailPerson {
  /** Il ruolo di adesso nel workspace (quello dell'organizzazione, o del workspace), o null. */
  role: string | null;
  email: string | null;
  /** `users.email_verified`: la stessa lettura per la coda, l'interruttore e l'invio. */
  verified: boolean;
}

/**
 * null quando la persona può ricevere le email dell'AI Readiness del workspace, adesso; altrimenti il motivo. La scelta
 * della persona non conta qui: decide chi vede l'interruttore, e l'interruttore decide il resto. L'ok del cliente sui
 * sub-responsabili è del workspace e vale per tutti: lo controlla chi chiama.
 */
export function airEmailBlock(p: AirEmailPerson): AirEmailBlock | null {
  if (!canManageWorkspaceSettings(p.role)) return "non_gestisce";
  if (!p.verified || !isPlainAddress(p.email?.trim().toLowerCase())) return "email_non_verificata";
  return null;
}

// ── Il link ───────────────────────────────────────────────────────────

/** L'indirizzo pulito dell'email (senza `?` né `#`): le risposte, o i risultati. */
export function airEmailPath(workspaceId: string, assessmentId: string, kind: AirEmailKind): string {
  if (!UUID.test(workspaceId) || !UUID.test(assessmentId)) throw new Error("Link dell'email non valido");
  const base = `/dashboard/${workspaceId.toLowerCase()}/ai-readiness/aggiornamenti/${assessmentId.toLowerCase()}`;
  return kind === "risultati" ? `${base}/risultati` : base;
}

/** Il link assoluto dell'email, controllato come gli altri link delle email (`checkEmailLink`). */
export function airEmailLink(origin: string, workspaceId: string, assessmentId: string, kind: AirEmailKind): string {
  return checkEmailLink(`${origin.replace(/\/+$/, "")}${airEmailPath(workspaceId, assessmentId, kind)}`, "dashboard");
}

/** Dove porta l'indirizzo pulito, dopo l'accesso: le risposte a «Raccolta» › «Persone», i risultati a «Risultati». */
export function airEmailTarget(workspaceId: string, assessmentId: string, kind: AirEmailKind): string {
  return kind === "risultati"
    ? readinessHref(workspaceId, { assessmentId })
    : readinessHref(workspaceId, { assessmentId, tab: "raccolta", anchor: READINESS_ANCHORS.people });
}

// ── Testo ─────────────────────────────────────────────────────────────

export interface AirAnswersEmailInput {
  company: string;
  assessment: string;
  /** Le risposte arrivate dall'ultima email (o dalla prima risposta di questa). */
  newAnswers: number;
  total: number;
  expected: number | null;
  link: string;
}

export interface AirResultsEmailInput {
  company: string;
  assessment: string;
  total: number;
  expected: number | null;
  link: string;
}

const newAnswersText = (n: number) => (n === 1 ? "1 nuova risposta" : `${formatCount(n)} nuove risposte`);
const named = (name: string) => `«${oneLine(name, 120) || "AI Readiness"}»`;
/** Il totale dopo le risposte nuove: «ora sono 46 su 120 attese», «ora sono 46 in tutto», «è la prima delle 40 attese». */
const totalText = (total: number, expected: number | null) =>
  total === 1
    ? `è la prima${expected && expected > 1 ? ` delle ${formatCount(expected)} attese` : ""}`
    : `ora sono ${formatCount(total)}${expected && expected > 0 ? ` su ${formatCount(expected)} attese` : " in tutto"}`;

/** «5 risposte su 40 attese», «1 risposta». */
const answersText = (total: number, expected: number | null) =>
  `${total === 1 ? "1 risposta" : `${formatCount(total)} risposte`}${expected && expected > 0 ? ` su ${formatCount(expected)} attese` : ""}`;

/** Il piede delle due email: perché arriva e come si spegne, con calma. */
const footer = (company: string, extra: string) =>
  `Ricevi questa email perché gestisci l'AI Readiness di ${company}. ${extra} Puoi spegnere questi avvisi in «Il tuo account» › «Notifiche via email».`;

/** «12 nuove risposte all'AI Readiness», parola per parola: solo numeri, mai chi ha risposto. */
export function renderAirAnswersEmail(i: AirAnswersEmailInput, brand?: EmailBrand): RenderedEmail {
  if (!Number.isInteger(i.newAnswers) || i.newAnswers < 1) throw new Error("Email senza risposte nuove");
  const company = oneLine(companyLabel(i.company), 80);
  const blocks: Block[] = [
    { p: "Buongiorno," },
    { p: `${named(i.assessment)} ha ${newAnswersText(i.newAnswers)}: ${totalText(i.total, i.expected)}.` },
    { link: { href: i.link, label: "Apri la raccolta" } },
    { small: footer(company, "Al massimo una al giorno, solo con i numeri: mai chi ha risposto.") },
  ];
  return render(emailSubject(company, `${newAnswersText(i.newAnswers)} all'AI Readiness`), blocks, brand);
}

/** «I risultati dell'AI Readiness ci sono», parola per parola: una volta per rilevazione. */
export function renderAirResultsEmail(i: AirResultsEmailInput, brand?: EmailBrand): RenderedEmail {
  const company = oneLine(companyLabel(i.company), 80);
  const blocks: Block[] = [
    { p: "Buongiorno," },
    { p: `${named(i.assessment)} ha ${answersText(i.total, i.expected)}: bastano per leggere i risultati per area e per preparare la sintesi.` },
    { link: { href: i.link, label: "Apri i risultati" } },
    { small: footer(company, "Questo avviso arriva una volta sola per ogni rilevazione.") },
  ];
  return render(emailSubject(company, "i risultati dell'AI Readiness ci sono"), blocks, brand);
}

// ── Righe, fatti e piano ──────────────────────────────────────────────

export interface ClaimedAirEmail {
  id: string;
  workspaceId: string;
  assessmentId: string;
  recipientUserId: string;
  kind: AirEmailKind;
  scheduledAt: Date;
  /** Quando la riga è nata: dopo due giorni lavorativi in attesa è troppo vecchia. */
  createdAt: Date;
  attempts: number;
}

export interface AirEmailFacts {
  /** `workspaces.name`. */
  company: string;
  /** La rilevazione, se c'è ancora in questo workspace. */
  assessment: { name: string; expected: number | null; threshold: number } | null;
  /** null quando la persona non c'è più. `switchOn`: «Avvisami per email sull'AI Readiness». */
  recipient: (AirEmailPerson & { switchOn: boolean }) | null;
  /** L'ok del cliente sui sub-responsabili della versione di oggi: senza, l'email non parte per nessuno. */
  workspaceAck: boolean;
  /** Le risposte inviate arrivate dall'ultima email della persona per la rilevazione (o dalla prima di questa riga). */
  newAnswers: number;
  /** Tutte le risposte inviate della rilevazione. */
  total: number;
  /** L'istante del conteggio (l'orologio del database): la prossima email conta da qui. */
  countedUntil: Date;
}

export type AirEmailCancelReason =
  | "troppo_vecchia"
  | "rilevazione_assente"
  | "destinatario_non_valido"
  | AirEmailBlock
  | "email_spenta"
  | "nessuna_risposta_nuova"
  | "sotto_la_soglia";

export type AirEmailPlan =
  | { action: "send"; to: string; rendered: RenderedEmail; countedUntil: Date }
  | { action: "hold"; reason: "email_non_configurata" | "sub_responsabili_mancanti" }
  | { action: "cancel"; reason: AirEmailCancelReason };

/**
 * Il piano di una riga, in quest'ordine: configurazione, l'ok del cliente sui sub-responsabili (senza, la riga aspetta,
 * come gli avvisi a chi ha chiesto al referente e «Pronto da avviare»), età, rilevazione, destinatario (chi gestisce
 * adesso, con l'email verificata), la sua scelta, poi il contenuto.
 */
export function planAirEmail(e: ClaimedAirEmail, f: AirEmailFacts, o: { env: DispatchEnv; origin: string; now: Date }): AirEmailPlan {
  if (!ucEmailConfig(o.env).ok) return { action: "hold", reason: "email_non_configurata" };
  if (!f.workspaceAck) return { action: "hold", reason: "sub_responsabili_mancanti" };
  if (isStaleAlert(e.createdAt, o.now)) return { action: "cancel", reason: "troppo_vecchia" };
  if (!f.assessment) return { action: "cancel", reason: "rilevazione_assente" };
  const r = f.recipient;
  if (!r) return { action: "cancel", reason: "destinatario_non_valido" };
  const block = airEmailBlock(r);
  if (block) return { action: "cancel", reason: block };
  if (!r.switchOn) return { action: "cancel", reason: "email_spenta" };
  const to = (r.email ?? "").trim().toLowerCase();
  const brand = emailBrand(o.origin);
  const link = airEmailLink(o.origin, e.workspaceId, e.assessmentId, e.kind);
  if (e.kind === "risultati") {
    if (f.total < Math.max(1, f.assessment.threshold)) return { action: "cancel", reason: "sotto_la_soglia" };
    const rendered = renderAirResultsEmail({ company: f.company, assessment: f.assessment.name, total: f.total, expected: f.assessment.expected, link }, brand);
    return { action: "send", to, rendered, countedUntil: f.countedUntil };
  }
  if (f.newAnswers < 1) return { action: "cancel", reason: "nessuna_risposta_nuova" };
  const rendered = renderAirAnswersEmail(
    { company: f.company, assessment: f.assessment.name, newAnswers: f.newAnswers, total: f.total, expected: f.assessment.expected, link },
    brand,
  );
  return { action: "send", to, rendered, countedUntil: f.countedUntil };
}

// ── Motore ────────────────────────────────────────────────────────────

export interface AirEmailStore {
  /** Senza configurazione: le righe in attesa restano lì, segnate. */
  holdUnconfigured(): Promise<number>;
  /**
   * Le righe in attesa da più di due giorni lavorativi («troppo_vecchia») e i tentativi interrotti a metà (il segno del
   * tentativo c'è, il lease è finito: «esito_incerto», mai ripetuti).
   */
  cancelStale(now: Date): Promise<number>;
  /**
   * Solo nella finestra di Roma: le righe dovute, una per rilevazione e persona (prima i risultati), mai per una coppia
   * che oggi ha già avuto un'email o che ha una riga presa; lease di 5 minuti.
   */
  claimDue(i: { limit: number; now: Date }): Promise<ClaimedAirEmail[]>;
  loadFacts(e: ClaimedAirEmail): Promise<AirEmailFacts>;
  /** Il segno del tentativo, prima di chiamare Resend: il numero del tentativo, o null se la riga non è più di questo giro. */
  beginAttempt(e: ClaimedAirEmail, countedUntil: Date): Promise<number | null>;
  /** Partita: `inviata`; e se intanto sono arrivate risposte, la riga del giorno dopo. */
  markSent(e: ClaimedAirEmail): Promise<void>;
  /** Un errore certo (l'email non è partita): si riprova dopo 15 minuti, finché ci sono tentativi; poi si annulla. */
  markFailed(e: ClaimedAirEmail, code: string): Promise<void>;
  /** Un esito incerto: annullata, mai ripetuta. */
  markUncertain(e: ClaimedAirEmail, code: string): Promise<void>;
  /** Un errore prima del tentativo (una lettura): si riprova dopo 15 minuti, senza contare un tentativo. */
  markRetry(e: ClaimedAirEmail, code: string): Promise<void>;
  markHeld(e: ClaimedAirEmail, reason: string): Promise<void>;
  markCancelled(e: ClaimedAirEmail, reason: string): Promise<void>;
}

export interface AirEmailSummary {
  sent: number;
  failed: number;
  held: number;
  cancelled: number;
  notConfigured: number;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const CODE = /^[a-z0-9_]{1,60}$/;
const code = (value: string) => (CODE.test(value) ? value : "errore_invio");

/** La chiave di Resend di un tentativo: la riga e il numero del tentativo (un tentativo incerto non si ripete mai). */
export const airEmailIdempotencyKey = (id: string, attempt: number) => `air:${id}:a${attempt}`;

/** Un giro di invio (solo dal cron dei giorni feriali; la campanella è subito). */
export async function runAirEmailDispatch(
  store: AirEmailStore,
  o: { env: DispatchEnv; now?: Date; limit?: number; mailer?: UcMailer; sendIntervalMs?: number },
): Promise<AirEmailSummary> {
  const now = o.now ?? new Date();
  const summary: AirEmailSummary = { sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };
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
  const claimed = await store.claimDue({ limit: Math.max(1, Math.min(o.limit ?? 50, 200)), now });
  let lastCall = 0;
  for (const e of claimed) {
    // Dopo il segno del tentativo l'esito non si sa più da qui: la riga non si rimette mai in coda.
    let attempted = false;
    try {
      const plan = planAirEmail(e, await store.loadFacts(e), { env: o.env, origin: config.origin, now });
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
      const wait = lastCall + interval - Date.now();
      if (lastCall > 0 && wait > 0) await pause(wait);
      const attempt = await store.beginAttempt(e, plan.countedUntil);
      if (attempt === null) continue;
      attempted = true;
      let result: MailResult;
      try {
        result = await mailer.send(
          { from: config.from, to: plan.to, subject: plan.rendered.subject, text: plan.rendered.text, html: plan.rendered.html, ...(config.replyTo ? { replyTo: config.replyTo } : {}) },
          { idempotencyKey: airEmailIdempotencyKey(e.id, attempt) },
        );
      } catch {
        result = { ok: false, code: "errore_invio", ambiguous: true };
      } finally {
        lastCall = Date.now();
      }
      if (result.ok) {
        await store.markSent(e);
        summary.sent++;
        continue;
      }
      if (result.ambiguous) {
        await store.markUncertain(e, code(result.code));
        summary.cancelled++;
        continue;
      }
      await store.markFailed(e, code(result.code));
      summary.failed++;
      if (result.code === RATE_LIMIT_CODE) break;
    } catch {
      summary.failed++;
      console.error("[ai-readiness.email] avviso non inviato");
      // Prima del tentativo si riprova; dopo, la riga resta segnata e il prossimo giro la annulla («esito_incerto»).
      if (!attempted) {
        try {
          await store.markRetry(e, "errore_lettura");
        } catch {
          // la riga resta presa fino alla fine del lease
        }
      }
    }
  }
  return summary;
}
