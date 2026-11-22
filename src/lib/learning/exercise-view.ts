import { LEARNING_TEXT } from "./text.ts";
import { LIVE_REFRESH_WATCH_MS, clockLabel, shortWhen } from "./course-view.ts";
import type { AttemptResponses, LearnerActivityDTO } from "./types.ts";

/**
 * (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9, audit Fuori §4.3-§4.4) L'esercizio in regole
 * pure: il numero della barra fissa («3 di 5»), la frase della conferma breve, la frase di un problema (mai il gergo
 * del server: «versione server», «verifica tecnica»), la copia leggibile delle risposte e la frase dell'esercizio non
 * ancora aperto. Le regole che salvano, controllano e inviano le risposte restano nel componente, uguali. Modulo puro.
 */

const T = LEARNING_TEXT.exercise;

type Active = Pick<LearnerActivityDTO, "items" | "requiredTextFields" | "allowedModes">;

/** Un campo di testo è a posto quando sta fra il minimo e il massimo dei caratteri, come nel controllo prima dell'invio. */
function fieldDone(field: Active["requiredTextFields"][number], value: string | undefined): boolean {
  const length = value?.trim().length ?? 0;
  return length >= field.minChars && length <= field.maxChars;
}

/**
 * Il numero della barra fissa: le parti da completare nella fase e quante sono fatte, con le stesse regole del
 * controllo prima dell'invio. Le domande del caso (`decisions`), poi commento e «Come hai lavorato» (`reflection`); in
 * un esercizio a domande, tutto insieme (`questions`).
 */
export function exerciseProgress(active: Active, responses: AttemptResponses, step: "decisions" | "reflection" | "questions"): { done: number; total: number } {
  const items = step === "reflection" ? [] : active.items;
  const fields = step === "decisions" ? [] : active.requiredTextFields;
  const mode = step !== "decisions" && active.allowedModes.length > 0;
  const total = items.length + fields.length + (mode ? 1 : 0);
  const done =
    items.filter((item) => !!responses.answers[item.id]).length +
    fields.filter((field) => fieldDone(field, responses.fields[field.id])).length +
    (mode && active.allowedModes.includes(responses.mode ?? "") ? 1 : 0);
  return { done, total };
}

/** La frase della conferma breve: che cosa succede dopo l'invio. */
export function confirmDescription(i: { decisionsPending: boolean; isCase: boolean }): string {
  if (i.decisionsPending) return T.confirmDecisions;
  return i.isCase ? T.confirmReflection : T.confirmQuiz;
}

/**
 * La frase di un problema per chi risponde. I conflitti, gli errori tecnici e la sessione scaduta hanno le parole
 * dell'esercizio; gli altri (corso chiuso, campi da completare, account cambiato) tengono la spiegazione del server,
 * che dice il perché.
 */
export function problemSentence(code: string | null, message: string): string {
  if (code === "conflict") return T.conflict;
  if (code === "technical") return T.technical;
  if (code === "unauthenticated") return T.unauthenticated;
  return message.trim() || T.fallback;
}

/** La copia scaricabile delle risposte, in parole: titolo, domande con la risposta scelta, i testi, come si è lavorato. */
export function readableDraft(activity: Pick<LearnerActivityDTO, "title" | "items" | "requiredTextFields">, responses: AttemptResponses, modeTitle: (mode: string) => string): string {
  const lines = [T.copyTitle(activity.title), ""];
  activity.items.forEach((item, index) => {
    const chosen = item.options.find((option) => option.id === responses.answers[item.id])?.text;
    lines.push(T.copyQuestion(index + 1, item.prompt), chosen ? T.copyAnswer(chosen) : T.copyNoAnswer, "");
  });
  for (const field of activity.requiredTextFields) {
    const text = responses.fields[field.id]?.trim();
    if (text) lines.push(`${field.label}:`, text, "");
  }
  if (responses.mode) lines.push(T.copyMode(modeTitle(responses.mode)), "");
  return `${lines.join("\n").trimEnd()}\n`;
}

const dayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" });

/** L'esercizio non ancora aperto, in una frase: «Si apre alle 15:00, quando chi tiene il corso dà il via.». */
export function notOpenSentence(availability: { state: string; opensAt: string | null; reason: string | null }, now: number): string {
  if (availability.state === "scheduled" && availability.opensAt) {
    return dayKey.format(new Date(availability.opensAt)) === dayKey.format(new Date(now)) ? T.opensAt(clockLabel(availability.opensAt)) : T.opensOn(shortWhen(availability.opensAt));
  }
  return availability.reason ?? T.notOpen;
}

/** Quanto prima dell'apertura in programma la pagina dell'esercizio comincia a controllare da sola: la lezione intera. */
export const ACTIVITY_WATCH_LEAD_MS = 2 * 60 * 60_000;

/**
 * Da quando la pagina dell'esercizio non ancora aperto si controlla da sola (ogni 15 secondi, come il corso): dalle due
 * ore prima dell'apertura in programma, perché chi tiene il corso la può aprire prima. Null quando non c'è niente da
 * aspettare (un esercizio chiuso, o un'apertura fra più di 12 ore).
 */
export function activityWatchFrom(availability: { state: string; opensAt: string | null }, now: number): number | null {
  if (availability.state !== "scheduled" || !availability.opensAt) return null;
  const opens = Date.parse(availability.opensAt);
  if (!Number.isFinite(opens) || opens - now > LIVE_REFRESH_WATCH_MS) return null;
  return opens - ACTIVITY_WATCH_LEAD_MS;
}
