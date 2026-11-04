/**
 * Le email dei due avvisi della 0025 (`use_case_alert_emails`): «Pronto da avviare» ai revisori di
 * Lateral Space e «Autorizza i fornitori» a chi può dare l'«ok sui sub-responsabili» del cliente. Al
 * massimo un'email al giorno per persona e tipo, solo da lunedì a venerdì dalle 9 alle 18 di Roma,
 * feste escluse, con il trasporto Resend dei dossier e gli stessi controlli degli avvisi a chi ha
 * chiesto (`referent/alerts.ts`): email configurata, funzione accesa e, per «Pronto da avviare»,
 * l'autorizzazione ai sub-responsabili (l'email porta codice e titolo dello use case del cliente, e
 * Resend è uno dei sub-responsabili).
 *
 * (Rilascio 5.1) Fuori dalla dashboard «caso d'uso», mai «use case»; l'oggetto comincia con il nome
 * del cliente. «Pronto da avviare» nomina il caso d'uso (codice, titolo, trimestre) e il cliente; il link apre la
 * scheda a `?capitolo=realizzazione`, che sulla scheda ancora pronta arriva al riquadro «Prossimo
 * passo» con «Avvia la realizzazione» (`arrivalTarget`). «Autorizza i fornitori» non porta nessun
 * dato degli use case: solo il nome del cliente e il link a Impostazioni › Sub-responsabili, e
 * parte solo con `USE_CASE_CLIENT_NOTICES` acceso per il workspace. Mai le informazioni del cliente,
 * i valori, una persona.
 *
 * Calendario, piano, testi e motore: tutto puro. Le letture e le scritture le fa
 * `queries/use-case-alerts.ts` attraverso `CaseAlertStore`.
 */
import { inRomeSendWindow } from "../../uc/calendar.ts";
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
import type { CaseAlertKind } from "../../db/use-case-hub-alerts-ddl.ts";
import { quarterLabel } from "../quarter.ts";
import { isStaleAlert } from "../referent/alerts.ts";
import { labelOfUseCase } from "../referent/email.ts";
import { companyLabel } from "../referent/labels.ts";
import { cardLinkTo, settingsLink } from "../referent/links.ts";

// ── Righe e fatti ─────────────────────────────────────────────────────

export interface ClaimedCaseAlert {
  id: string;
  workspaceId: string;
  recipientUserId: string;
  kind: CaseAlertKind;
  sendOn: string;
  scheduledAt: Date;
  dueAt: Date;
  attempts: number;
}

export interface ReadyItemFacts {
  useCaseId: string;
  code: string | null;
  title: string;
  /** `target_quarter` di adesso. */
  quarter: string | null;
  /** Lo use case è ancora pronto adesso (`readyNowSql`). */
  stillReady: boolean;
  /** La riga «Pronto da avviare» di questa persona per lo use case c'è ed è ancora non letta. */
  unread: boolean;
}

export interface CaseAlertFacts {
  /** workspaces.name */
  company: string;
  /** `readyNoticesEnabled(workspaceId, env)`: area accesa e non un'anteprima. */
  readyNoticesOn: boolean;
  /** `referentAskEnabled(workspaceId, env)`: «Chiedi al referente» acceso. */
  referentsOn: boolean;
  /** `clientNoticesEnabled(workspaceId, env)`: `USE_CASE_CLIENT_NOTICES` acceso per il workspace. */
  clientNoticesOn: boolean;
  /** L'autorizzazione all'elenco dei sub-responsabili di adesso. */
  subprocessorsAuthorized: boolean;
  /**
   * null quando l'utente non c'è più. email in minuscolo; `lateralSpace` = email verificata di un
   * dominio di Lateral Space; `reviewer` = ruolo di adesso tra quelli da revisore; `canDeclare` =
   * `subprocessorDeclarerOf` = «cliente» adesso (rilascio 5.1: Lateral Space non riceve questo avviso).
   */
  recipient: { email: string | null; verified: boolean; lateralSpace: boolean; reviewer: boolean; canDeclare: boolean } | null;
  /** «Pronto da avviare»: gli use case dell'email, nell'ordine in cui sono diventati pronti. */
  items: ReadyItemFacts[];
  /** «Autorizza i fornitori»: la persona ha ancora una riga «Autorizza i fornitori» non letta. */
  suppliersRowUnread: boolean;
}

export interface ReadyEntry {
  useCase: { code: string | null; title: string };
  quarter: string | null;
  link: string;
}

export interface ReadyAlertInput {
  company: string;
  entries: ReadyEntry[];
}

export type CaseAlertPlan =
  | { action: "send"; to: string; rendered: RenderedEmail; useCaseIds: string[] }
  | { action: "hold"; reason: "email_non_configurata" | "funzione_spenta" | "sub_responsabili_mancanti" }
  | {
      action: "cancel";
      reason: "troppo_vecchia" | "destinatario_non_valido" | "nessuna_voce" | "avvisi_cliente_spenti" | "autorizzazione_data" | "gia_vista";
    };

/**
 * «Autorizza i fornitori», in quest'ordine: configurazione, funzione, interruttore del cliente, ok
 * già dato, età, destinatario (chi può dare l'ok, adesso), riga già aperta.
 */
function planSuppliersAlert(e: ClaimedCaseAlert, f: CaseAlertFacts, o: { origin: string; now: Date }): CaseAlertPlan {
  if (!f.referentsOn) return { action: "hold", reason: "funzione_spenta" };
  if (!f.clientNoticesOn) return { action: "cancel", reason: "avvisi_cliente_spenti" };
  if (f.subprocessorsAuthorized) return { action: "cancel", reason: "autorizzazione_data" };
  if (isStaleAlert(e.dueAt, o.now)) return { action: "cancel", reason: "troppo_vecchia" };
  const r = f.recipient;
  if (!r || !r.canDeclare || !isPlainAddress(r.email)) return { action: "cancel", reason: "destinatario_non_valido" };
  if (!f.suppliersRowUnread) return { action: "cancel", reason: "gia_vista" };
  return { action: "send", to: r.email.trim().toLowerCase(), rendered: renderSuppliersAlert({ company: f.company, link: settingsLink(o.origin, e.workspaceId) }, emailBrand(o.origin)), useCaseIds: [] };
}

/** Il piano di una riga, in quest'ordine: configurazione, funzione, autorizzazione, età, destinatario, voci. */
export function planCaseAlert(e: ClaimedCaseAlert, f: CaseAlertFacts, o: { env: DispatchEnv; origin: string; now: Date }): CaseAlertPlan {
  if (!ucEmailConfig(o.env).ok) return { action: "hold", reason: "email_non_configurata" };
  if (e.kind === "fornitori") return planSuppliersAlert(e, f, o);
  if (e.kind !== "pronto") return { action: "cancel", reason: "nessuna_voce" };
  if (!f.readyNoticesOn) return { action: "hold", reason: "funzione_spenta" };
  if (!f.subprocessorsAuthorized) return { action: "hold", reason: "sub_responsabili_mancanti" };
  if (isStaleAlert(e.dueAt, o.now)) return { action: "cancel", reason: "troppo_vecchia" };
  const r = f.recipient;
  // Mai a una persona del cliente: solo un revisore di Lateral Space, ricontrollato adesso.
  if (!r || !r.verified || !r.lateralSpace || !r.reviewer || !isPlainAddress(r.email)) return { action: "cancel", reason: "destinatario_non_valido" };
  const seen = new Set<string>();
  const kept = f.items.filter((i) => {
    const key = i.useCaseId.toLowerCase();
    if (!i.stillReady || !i.unread || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (kept.length === 0) return { action: "cancel", reason: "nessuna_voce" };
  const input: ReadyAlertInput = {
    company: f.company,
    entries: kept.map((i) => ({ useCase: { code: i.code, title: i.title }, quarter: i.quarter, link: cardLinkTo(o.origin, e.workspaceId, i.useCaseId, "realizzazione") })),
  };
  return { action: "send", to: r.email.trim().toLowerCase(), rendered: renderReadyAlert(input, emailBrand(o.origin)), useCaseIds: kept.map((i) => i.useCaseId) };
}

// ── Testo ─────────────────────────────────────────────────────────────

const READY_FOOTER = "Ricevi questa email perché sei di Lateral Space e puoi avviare la realizzazione.";

const quarterText = (q: string | null) => (q ? quarterLabel(q) : "un trimestre");

/** «Pronto da avviare», parola per parola: una scheda, o più schede in un'email sola. */
export function renderReadyAlert(i: ReadyAlertInput, brand?: EmailBrand): RenderedEmail {
  if (i.entries.length === 0) throw new Error("Avviso senza voci");
  const company = oneLine(companyLabel(i.company), 80);
  const blocks: Block[] = [{ p: "Buongiorno," }];
  if (i.entries.length === 1) {
    const e = i.entries[0];
    const uc = labelOfUseCase(e.useCase);
    blocks.push(
      { p: `il caso d'uso «${uc}» di ${company} è pronto da avviare: è approvato per ${quarterText(e.quarter)} e non manca niente dal cliente.` },
      { link: { href: e.link, label: "Apri il caso d'uso" } },
      { small: READY_FOOTER },
    );
    return render(oneLine(`${company}: il caso d'uso «${uc}» è pronto da avviare`, 200), blocks, brand);
  }
  blocks.push({ p: `ci sono ${i.entries.length} casi d'uso di ${company} pronti da avviare: sono approvati e non manca niente dal cliente.` });
  for (const e of i.entries) {
    blocks.push({ p: `«${labelOfUseCase(e.useCase)}» · ${quarterText(e.quarter)}` }, { link: { href: e.link, label: "Apri il caso d'uso" } });
  }
  blocks.push({ small: READY_FOOTER });
  return render(oneLine(`${company}: ${i.entries.length} casi d'uso pronti da avviare`, 200), blocks, brand);
}

/** «Autorizza i fornitori», parola per parola: il nome del cliente e il link, nessun dato degli use case. */
export function renderSuppliersAlert(i: { company: string; link: string }, brand?: EmailBrand): RenderedEmail {
  const company = oneLine(companyLabel(i.company), 80);
  return render(oneLine(`${company}: serve il tuo ok sui fornitori di Lateral Space`, 200), [
    { p: "Buongiorno," },
    {
      p: `per raccogliere le informazioni sui casi d'uso di ${company}, Lateral Space usa alcuni fornitori, per esempio quello delle email. Prima serve l'ok di una persona di ${company} con il tuo ruolo.`,
    },
    { link: { href: i.link, label: "Apri Impostazioni › Sub-responsabili" } },
    { small: `Ricevi questa email perché puoi dare questa autorizzazione per ${company}. Quando qualcuno l'avrà data, non ne riceverai altre.` },
  ], brand);
}

// ── Motore ────────────────────────────────────────────────────────────

export interface CaseAlertStore {
  holdUnconfigured(): Promise<number>;
  /** Righe in attesa il cui `due_at` ha più di 2 giorni lavorativi. */
  cancelStale(now: Date): Promise<number>;
  /** Solo nella finestra di Roma; scheduled_at <= now; lease di 5 minuti. */
  claimDue(i: { limit: number; now: Date }): Promise<ClaimedCaseAlert[]>;
  loadFacts(e: ClaimedCaseAlert): Promise<CaseAlertFacts>;
  markSent(e: ClaimedCaseAlert): Promise<void>;
  /** attempts+1, scheduled_at + RETRY_DELAY_MINUTES, stato errore. */
  markFailed(e: ClaimedCaseAlert, code: string): Promise<void>;
  markHeld(e: ClaimedCaseAlert, reason: string): Promise<void>;
  markCancelled(e: ClaimedCaseAlert, reason: string): Promise<void>;
}

export interface CaseAlertSummary {
  sent: number;
  failed: number;
  held: number;
  cancelled: number;
  notConfigured: number;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const CODE = /^[a-z0-9_]{1,60}$/;
const code = (value: string) => (CODE.test(value) ? value : "errore_invio");

/** Un giro di invio: senza configurazione restano in coda; le righe vecchie si annullano. */
export async function runCaseAlertDispatch(
  store: CaseAlertStore,
  o: { env: DispatchEnv; now?: Date; limit?: number; mailer?: UcMailer; sendIntervalMs?: number },
): Promise<CaseAlertSummary> {
  const now = o.now ?? new Date();
  const summary: CaseAlertSummary = { sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };
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
    try {
      const plan = planCaseAlert(e, await store.loadFacts(e), { env: o.env, origin: config.origin, now });
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
      let result;
      try {
        result = await mailer.send(
          // Il mittente (UC_EMAIL_FROM, sul sottodominio delle notifiche) non riceve posta: il reply-to è UC_EMAIL_REPLY_TO.
          { from: config.from, to: plan.to, subject: plan.rendered.subject, text: plan.rendered.text, html: plan.rendered.html, ...(config.replyTo ? { replyTo: config.replyTo } : {}) },
          { idempotencyKey: idempotencyKeyFor(`ca:${e.id}`, e.attempts + 1) },
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
      console.error("[use-case.avvisi] avviso non inviato");
      try {
        await store.markFailed(e, "errore_invio");
      } catch {
        // la riga resta presa fino alla fine del lease
      }
    }
  }
  return summary;
}
