/**
 * Il blocco «Referente» di «Cosa serve» (rilascio 5, SPEC §9.2): le righe e i pulsanti per ogni stato
 * del referente, dal pannello. Nessun pulsante pieno (quello della pagina sta nel riquadro «Prossimo
 * passo»), nessun conteggio per persona. Modulo puro: lo prova `referent-block-view.test.ts`.
 */
import type { ReferentBlockBenefit, ReferentBlockCheck, ReferentBlockView, ReferentRequestView } from "../../../../lib/use-cases/referent/contract.ts";
import { formatDecimalIt, hoursText, minutesText, referentHours } from "../../../../lib/use-cases/referent/estimate.ts";
import { euroText } from "../../../../lib/use-cases/referent/impact-text.ts";
import { REFERENT_BLOCK_TEXT, REFERENT_UI_TEXT, fillText } from "../../../../lib/use-cases/referent/labels.ts";
import { REFERENT_STATE_TEXT, type ReferentStateKey } from "../../../../lib/use-cases/referent/use-case-state.ts";
import { formatDayInYear } from "../../../../lib/use-cases/format.ts";

const T = REFERENT_BLOCK_TEXT;

export type BlockButtonKey = "choose" | "askAgain" | "retry" | "correctionDone" | "adopt" | "keep" | "review" | "addEstimate" | "notNeeded" | "seen";
export interface BlockButton {
  key: BlockButtonKey;
  label: string;
  variant: "outline" | "ghost" | "link";
  /** (Rilascio 5.1) La voce di «Benefici e costi» su cui agisce (le azioni per beneficio). */
  benefit?: string;
}

export type BlockMenuKey = "remind" | "askMore" | "change" | "revoke" | "correct" | "erase";
export interface BlockMenuItem {
  key: BlockMenuKey;
  label: string;
  allowed: boolean;
  reason: string | null;
}

export type BlockLine = { kind: "text" | "muted"; text: string } | { kind: "quote"; text: string };
/** (Rilascio 5.1) Una voce di «Benefici e costi» con la risposta del referente e, quando aspetta il team, i suoi pulsanti. */
export interface BenefitLines {
  key: string;
  /** «Controllo delle fatture: il team stimava 600 ore di lavoro l'anno.» */
  head: string;
  /** «Aldo: è di più. Circa 720 ore (300 al mese, 12 minuti).» */
  says: string;
  comment: string | null;
  /** Le righe grigie: la cifra cambiata, la voce tolta, la decisione del team. */
  notes: string[];
  buttons: BlockButton[];
}
/** Una riga della conferma e della stima: anche «Fatto» della correzione, subito sotto la nota che chiude (§9.2). */
export type CheckLine = BlockLine | { kind: "button"; button: BlockButton } | { kind: "benefit"; benefit: BenefitLines };

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

/** (Rilascio 5.1) La cifra del team che il referente ha visto su una voce, e la sua risposta, in parole. */
function benefitTexts(b: ReferentBlockBenefit, name: string): { head: string; says: string } {
  const label = b.label.replace(/[\s.:;,]+$/u, "");
  const t = b.team;
  if (b.form === "ore") {
    const head = fillText(T.benefitTeamOre, { label, ore: hoursText(((t.volumeYear ?? 0) * (t.minutes ?? 0)) / 60) });
    let says = fillText(b.answer === "meno" ? T.saysLess : b.answer === "piu" ? T.saysMore : T.saysYes, { Nome: name });
    if ((b.answer === "meno" || b.answer === "piu") && (b.timesPerMonth !== null || b.minutesEach !== null)) {
      const snapshot = { volumeYear: t.volumeYear ?? 0, minutes: t.minutes ?? 0 };
      const hours = referentHours(snapshot, { timesPerMonth: b.timesPerMonth, minutesEach: b.minutesEach }) ?? 0;
      says += fillText(T.numbersTail, { ore: hoursShort(hours), n: formatDecimalIt(b.timesPerMonth ?? snapshot.volumeYear / 12), m: minutesText(b.minutesEach ?? snapshot.minutes) });
    }
    return { head, says };
  }
  if (b.form === "ore_numeri") {
    const head = fillText(T.benefitTeamOreNone, { label });
    const hours = referentHours(null, { timesPerMonth: b.timesPerMonth, minutesEach: b.minutesEach });
    const says =
      hours !== null && b.timesPerMonth !== null && b.minutesEach !== null
        ? fillText(T.numbersNoTeam, { Nome: name, ore: hoursText(hours), n: formatDecimalIt(b.timesPerMonth), m: minutesText(b.minutesEach) })
        : fillText(T.saysYes, { Nome: name });
    return { head, says };
  }
  if (b.form === "euro") {
    const head = fillText(T.benefitTeamEuro, { label, euro: euroText(t.eurYear ?? 0) });
    let says = fillText(b.answer === "meno" ? T.saysLess : b.answer === "piu" ? T.saysMore : T.saysYes, { Nome: name });
    if ((b.answer === "meno" || b.answer === "piu") && b.eurYear !== null) says += fillText(T.euroTail, { euro: euroText(b.eurYear) });
    return { head, says };
  }
  const head = fillText(T.benefitTeamFatto, { label });
  const says = fillText(b.answer === "no" ? T.saysNotHappens : b.answer === "non_so" ? T.saysDunno : T.saysHappens, { Nome: name });
  return { head, says };
}

/** (Rilascio 5.1) La riga dopo la decisione del team su una voce, oppure null. */
export function benefitOutcomeLine(b: ReferentBlockBenefit, today: string): string | null {
  if (b.outcome === "adottata") return fillText(T.adoptedOn, { data: day(b.outcomeAt, today) });
  if (b.outcome !== "tenuta") return null;
  if (b.form === "ore_numeri") return T.notUsed;
  return b.adoptable ? T.kept : fillText(T.seenOn, { data: day(b.outcomeAt, today) });
}

/**
 * (Rilascio 5.1) I pulsanti del team su una voce che aspetta (§9.3 per beneficio). Una voce che il team
 * ha tolto da «Benefici e costi» dopo la risposta ha solo «Fatto»: non c'è più niente da usare o da
 * rivedere, ma senza un pulsante lo use case resterebbe in «Risposte da verificare».
 */
export function benefitButtonsOf(b: ReferentBlockBenefit, name: string, canEditValuation: boolean): BlockButton[] {
  if (!b.needsReview) return [];
  if (b.changed === "tolta") return [{ key: "seen", label: T.done, variant: "ghost", benefit: b.key }];
  const out: BlockButton[] = [];
  if (b.adoptable) {
    if (canEditValuation && b.changed === null) out.push({ key: "adopt", label: fillText(T.adopt, { Nome: name }), variant: "outline", benefit: b.key });
    out.push({ key: "keep", label: b.form === "ore_numeri" ? T.notNeeded : T.keep, variant: "ghost", benefit: b.key });
    return out;
  }
  if (b.form === "ore" || b.form === "euro") out.push({ key: "review", label: T.review, variant: "link", benefit: b.key });
  out.push({ key: "seen", label: T.done, variant: "ghost", benefit: b.key });
  return out;
}

/** (Rilascio 5.1) Le righe di una voce, senza i pulsanti (li aggiunge `referentBlockModel`). */
export function benefitLinesOf(b: ReferentBlockBenefit, name: string, today: string, withReview: boolean): BenefitLines {
  const { head, says } = benefitTexts(b, name);
  const notes: string[] = [];
  if (b.changed === "cambiata") notes.push(T.teamChanged);
  if (b.changed === "tolta") notes.push(T.benefitGone);
  if (withReview) {
    const outcome = benefitOutcomeLine(b, today);
    if (outcome) notes.push(outcome);
  }
  return { key: b.key, head, says, comment: b.comment, notes, buttons: [] };
}

/** Le righe della conferma e della stima (§9.2), più le righe dopo la decisione del team. */
export function checkLinesOf(check: ReferentBlockCheck, name: string, today: string, withReview: boolean): CheckLine[] {
  const out: CheckLine[] = [];
  if (!check.submittedAt) return [{ kind: "text", text: T.noConfirm }];
  out.push({ kind: "text", text: fillText(T.answeredOn, { data: day(check.submittedAt, today) }) });
  if (check.confirm === "correggi") {
    out.push({ kind: "text", text: check.correctionDoneAt ? fillText(T.corrected, { data: day(check.correctionDoneAt, today) }) : T.toCorrect });
    if (check.note) out.push({ kind: "quote", text: check.note });
  } else out.push({ kind: "text", text: T.confirmed });
  // (Rilascio 5.1) Le risposte per beneficio, nell'ordine delle righe che il referente ha visto.
  if (check.benefits) {
    for (const b of check.benefits) out.push({ kind: "benefit", benefit: benefitLinesOf(b, name, today, withReview) });
    return out;
  }
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

/** I pulsanti del team sulla risposta (§9.2), quando la decisione manca. (Rilascio 5.1) Per beneficio, quelli di ogni voce stanno sotto la voce. */
export function reviewButtonsOf(check: ReferentBlockCheck | null, name: string, canEditValuation: boolean): BlockButton[] {
  if (!check?.submittedAt) return [];
  const out: BlockButton[] = [];
  if (check.confirm === "correggi" && !check.correctionDoneAt) out.push({ key: "correctionDone", label: T.done, variant: "ghost" });
  if (check.benefits || check.outcome) return out;
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
    // (Rilascio 5.1) I pulsanti di ogni voce, sotto la voce.
    for (const line of checkLines) {
      if (line.kind !== "benefit") continue;
      const b = ref.check?.benefits?.find((x) => x.key === line.benefit.key);
      if (b) line.benefit.buttons = benefitButtonsOf(b, name, i.canEditValuation === true);
    }
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
