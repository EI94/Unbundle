/**
 * Il blocco «Referente» di «Cosa serve» (rilascio 5, SPEC §9.2): le righe e i pulsanti per ogni stato
 * del referente, dal pannello. Nessun pulsante pieno (quello della pagina sta nel riquadro «Prossimo
 * passo»), nessun conteggio per persona. Modulo puro: lo prova `referent-block-view.test.ts`.
 */
import type { ReferentBlockCheck, ReferentBlockView, ReferentRequestView } from "../../../../lib/use-cases/referent/contract.ts";
import { formatDecimalIt, hoursText, minutesText } from "../../../../lib/use-cases/referent/estimate.ts";
import { REFERENT_BLOCK_TEXT, REFERENT_UI_TEXT, fillText } from "../../../../lib/use-cases/referent/labels.ts";
import { REFERENT_STATE_TEXT, type ReferentStateKey } from "../../../../lib/use-cases/referent/use-case-state.ts";
import { formatDayInYear } from "../../../../lib/use-cases/format.ts";

const T = REFERENT_BLOCK_TEXT;

export type BlockButtonKey = "choose" | "askAgain" | "retry" | "correctionDone" | "adopt" | "keep" | "review" | "addEstimate" | "notNeeded" | "seen";
export interface BlockButton {
  key: BlockButtonKey;
  label: string;
  variant: "outline" | "ghost" | "link";
}

export type BlockMenuKey = "remind" | "askMore" | "change" | "revoke" | "correct" | "erase";
export interface BlockMenuItem {
  key: BlockMenuKey;
  label: string;
  allowed: boolean;
  reason: string | null;
}

export type BlockLine = { kind: "text" | "muted"; text: string } | { kind: "quote"; text: string };
/** Una riga della conferma e della stima: anche «Fatto» della correzione, subito sotto la nota che chiude (§9.2). */
export type CheckLine = BlockLine | { kind: "button"; button: BlockButton };

export interface ReferentBlockModel {
  state: ReferentStateKey;
  /** La persona (nome) e la riga grigia accanto («Ufficio acquisti · Fa parte del team»). */
  name: string | null;
  meta: string | null;
  /** Le righe dello stato: attesa, email, risposta. */
  lines: BlockLine[];
  /** Le righe della conferma e della stima, quando sono arrivate («Fatto» della correzione sotto la nota). */
  checkLines: CheckLine[];
  /** Al massimo tre pulsanti non pieni, nell'ordine in cui si mostrano. */
  buttons: BlockButton[];
  /** Le voci di «Altro». */
  menu: BlockMenuItem[];
}

export interface ReferentBlockInput {
  referent: ReferentBlockView | null;
  /** R, dal pannello. */
  request: ReferentRequestView | null;
  /** Chi guarda può scegliere e mandare (`assignEntry(panel).canOpen`). */
  canAssign: boolean;
  /** `canEditNeeds`. */
  canAsk: boolean;
  /** Il riquadro «Prossimo passo» ha già il pulsante pieno «Scegli il referente»: qui non si ripete. */
  boxOwnsChoose: boolean;
  /** «Chiedi al referente» (una richiesta di sole domande al referente) si può aprire. */
  canAskMore: boolean;
  /** Le azioni del team sulla risposta (§9.2, §9.3); con false solo le righe. */
  withReview?: boolean;
  /** `canEditValuation`: «Usa la stima di …» e «Aggiungi alla stima». */
  canEditValuation?: boolean;
  today: string;
}

function day(iso: string | null | undefined, today: string): string {
  return (iso ? formatDayInYear(iso, `${today}T12:00:00Z`) : null) ?? "";
}

/** «600 ore», «1 ora», «meno di un'ora». */
function hoursShort(hours: number): string {
  const h = Math.round(hours);
  if (h < 1) return T.hourLess;
  if (h === 1) return T.hourOne;
  return fillText(T.hoursShort, { n: formatDecimalIt(h) });
}

/** Le righe della conferma e della stima (§9.2), più le righe dopo la decisione del team. */
export function checkLinesOf(check: ReferentBlockCheck, name: string, today: string, withReview: boolean): BlockLine[] {
  const out: BlockLine[] = [];
  if (!check.submittedAt) return [{ kind: "text", text: T.noConfirm }];
  out.push({ kind: "text", text: fillText(T.answeredOn, { data: day(check.submittedAt, today) }) });
  if (check.confirm === "correggi") {
    out.push({ kind: "text", text: check.correctionDoneAt ? fillText(T.corrected, { data: day(check.correctionDoneAt, today) }) : T.toCorrect });
    if (check.note) out.push({ kind: "quote", text: check.note });
  } else out.push({ kind: "text", text: T.confirmed });
  const perMonth = check.timesPerMonth ?? (check.team ? check.team.volumeYear / 12 : null);
  const minutes = check.minutesEach ?? (check.team ? check.team.minutes : null);
  if (check.team) {
    out.push({ kind: "text", text: fillText(T.timeTeam, { ore: hoursText(check.team.hours) }) });
    const says = check.estimate === "meno" ? T.saysLess : check.estimate === "piu" ? T.saysMore : T.saysYes;
    let line = fillText(says, { Nome: name });
    if (check.referentHours !== null && perMonth !== null && minutes !== null) {
      line += fillText(T.numbersTail, { ore: hoursShort(check.referentHours), n: formatDecimalIt(perMonth), m: minutesText(minutes) });
    }
    out.push({ kind: "text", text: line });
    if (check.teamChanged) out.push({ kind: "muted", text: T.teamChanged });
  } else {
    out.push({ kind: "text", text: T.timeNoTeam });
    if (check.referentHours !== null && perMonth !== null && minutes !== null) {
      out.push({ kind: "text", text: fillText(T.numbersNoTeam, { Nome: name, ore: hoursText(check.referentHours), n: formatDecimalIt(perMonth), m: minutesText(minutes) }) });
    }
  }
  if (withReview) {
    const outcome = outcomeLine(check, today);
    if (outcome) out.push({ kind: "muted", text: outcome });
  }
  return out;
}

/** La riga dopo la decisione del team sulla stima, oppure null. */
export function outcomeLine(check: ReferentBlockCheck, today: string): string | null {
  const numbers = check.timesPerMonth !== null || check.minutesEach !== null;
  if (check.outcome === "adottata") return fillText(T.adoptedOn, { data: day(check.outcomeAt, today) });
  if (check.outcome === "tenuta") {
    if (!check.team) return T.notUsed;
    return numbers ? T.kept : fillText(T.seenOn, { data: day(check.outcomeAt, today) });
  }
  if (!check.team && check.teamNow && check.submittedAt) return T.teamAdded;
  return null;
}

/** I pulsanti del team sulla risposta (§9.2), quando la decisione manca. */
export function reviewButtonsOf(check: ReferentBlockCheck | null, name: string, canEditValuation: boolean): BlockButton[] {
  if (!check?.submittedAt) return [];
  const out: BlockButton[] = [];
  if (check.confirm === "correggi" && !check.correctionDoneAt) out.push({ key: "correctionDone", label: T.done, variant: "ghost" });
  if (check.outcome) return out;
  const numbers = check.timesPerMonth !== null || check.minutesEach !== null;
  if (check.team && (check.estimate === "meno" || check.estimate === "piu")) {
    if (numbers) {
      if (canEditValuation) out.push({ key: "adopt", label: fillText(T.adopt, { Nome: name }), variant: "outline" });
      out.push({ key: "keep", label: T.keep, variant: "ghost" });
    } else {
      out.push({ key: "review", label: T.review, variant: "link" });
      out.push({ key: "seen", label: T.done, variant: "ghost" });
    }
  } else if (!check.team && !check.teamNow) {
    if (canEditValuation) out.push({ key: "addEstimate", label: T.addEstimate, variant: "outline" });
    out.push({ key: "notNeeded", label: T.notNeeded, variant: "ghost" });
  }
  return out;
}

const SEP = " · ";

/** Il blocco per lo stato di adesso. */
export function referentBlockModel(i: ReferentBlockInput): ReferentBlockModel {
  const ref = i.referent;
  if (!ref) {
    return {
      state: "manca",
      name: null,
      meta: null,
      lines: [{ kind: "text", text: T.missing }],
      checkLines: [],
      buttons: i.canAsk && i.canAssign && !i.boxOwnsChoose ? [{ key: "choose", label: T.choose, variant: "outline" }] : [],
      menu: [],
    };
  }
  const r = i.request;
  const name = ref.contact.name;
  const meta = [ref.contact.roleLabel, ref.contact.team ? T.teamTag : null].filter((x): x is string => Boolean(x)).join(SEP) || null;
  const lines: BlockLine[] = [];
  const buttons: BlockButton[] = [];
  const menu: BlockMenuItem[] = [];
  const answered = Boolean(ref.check?.submittedAt);
  const waiting = ref.state === "in_attesa" || ref.state === "nessuna_risposta" || (!answered && ref.live);
  if (waiting && r) {
    const expired = !ref.live;
    let line = fillText(expired ? T.expiredLine : T.waitingLine, {
      stato: REFERENT_STATE_TEXT[ref.state === "nessuna_risposta" ? "nessuna_risposta" : "in_attesa"],
      inviata: day(r.sentAt ?? r.createdAt, i.today),
      scade: day(r.expiresAt, i.today),
    });
    if (r.lastReminderAt) line += fillText(T.remindedTail, { data: day(r.lastReminderAt, i.today) });
    lines.push({ kind: "muted", text: line });
    if (r.email.state !== "partita" && r.email.label) lines.push({ kind: "muted", text: r.email.label });
    for (const notice of r.notices) lines.push({ kind: "muted", text: notice });
  }
  const checkLines: CheckLine[] = answered && ref.check ? checkLinesOf(ref.check, name, i.today, i.withReview === true) : waiting ? [] : [{ kind: "text", text: T.noConfirm }];
  if (i.canAsk && r) {
    if (r.actions.retry) buttons.push({ key: "retry", label: REFERENT_UI_TEXT.retry, variant: "outline" });
    else if (ref.state === "nessuna_risposta" && r.actions.askAgain && i.canAssign) buttons.push({ key: "askAgain", label: REFERENT_UI_TEXT.askAgain, variant: "outline" });
  }
  if (i.canAsk && i.withReview) {
    const review = reviewButtonsOf(ref.check, name, i.canEditValuation === true);
    // «Fatto» della correzione chiude la nota: sta subito sotto di lei (o sotto «Lo use case: da
    // correggere.»), mai accanto ai pulsanti della stima, che hanno anche loro un «Fatto».
    const fix = review.find((b) => b.key === "correctionDone");
    if (fix) {
      const quote = checkLines.findIndex((l) => l.kind === "quote");
      const toCorrect = checkLines.findIndex((l) => l.kind === "text" && l.text === T.toCorrect);
      const at = quote >= 0 ? quote + 1 : toCorrect >= 0 ? toCorrect + 1 : checkLines.length;
      checkLines.splice(at, 0, { kind: "button", button: fix });
    }
    buttons.push(...review.filter((b) => b.key !== "correctionDone"));
  }
  if (i.canAsk) {
    if (r && ref.live) menu.push({ key: "remind", label: REFERENT_UI_TEXT.remind, allowed: r.actions.remind.allowed, reason: r.actions.remind.allowed ? null : r.actions.remind.reason });
    if (!ref.live && i.canAskMore) menu.push({ key: "askMore", label: T.askMore, allowed: true, reason: null });
    if (i.canAssign) menu.push({ key: "change", label: T.change, allowed: true, reason: null });
    // «Revoca il link» solo su una richiesta al referente viva e senza risposta: un referente che ha
    // risposto non si toglie per sbaglio.
    if (r && ref.live && !answered && r.actions.revoke) menu.push({ key: "revoke", label: REFERENT_UI_TEXT.revoke, allowed: true, reason: null });
    if (r && (ref.live || ref.state === "nessuna_risposta")) menu.push({ key: "correct", label: REFERENT_UI_TEXT.correctEmail, allowed: r.actions.correctEmail, reason: r.actions.correctEmail ? null : REFERENT_UI_TEXT.correctEmailInDossier });
    if (r?.actions.erase) menu.push({ key: "erase", label: REFERENT_UI_TEXT.erase, allowed: true, reason: null });
  }
  return { state: ref.state, name, meta, lines, checkLines, buttons, menu };
}

/** «Referente: Aldo Prova · In attesa del referente» (§9.1); null senza referente. */
export function referentHeaderLine(referent: Pick<ReferentBlockView, "contact" | "state"> | null | undefined): string | null {
  if (!referent) return null;
  return fillText(T.headerLine, { Nome: referent.contact.name, stato: REFERENT_STATE_TEXT[referent.state] });
}
